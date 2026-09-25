use crate::config::CompletionJudgeConfig;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
pub struct JudgeRequest<'a> {
    pub schema_version: u32,
    pub objective: Option<&'a str>,
    pub completion_promise: &'a str,
    pub iteration: u32,
    pub rejections: u32,
    pub workspace: String,
    pub loop_id: Option<String>,
    pub closed_tasks: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct JudgeVerdict {
    pub verdict: JudgeDecision,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JudgeDecision {
    Pass,
    Fail,
}

pub fn run_judge(
    config: &CompletionJudgeConfig,
    workspace: &Path,
    request: &JudgeRequest<'_>,
) -> Result<JudgeVerdict, String> {
    let Some((program, args)) = config.command.split_first() else {
        return Err("completion_judge.command is empty".to_string());
    };
    let payload = serde_json::to_vec(request).map_err(|e| e.to_string())?;

    let mut command = Command::new(program);
    if !workspace.as_os_str().is_empty() {
        command.current_dir(workspace);
    }
    let mut child = command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to spawn judge '{program}': {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(&payload)
            .map_err(|e| format!("failed to write judge stdin: {e}"))?;
    }

    let mut stdout = child.stdout.take().ok_or("judge stdout unavailable")?;
    let reader = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout.read_to_string(&mut buf);
        buf
    });

    let deadline = Instant::now() + Duration::from_secs(config.timeout_seconds.max(1));
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "judge timed out after {}s",
                    config.timeout_seconds
                ));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(format!("failed to wait for judge: {e}")),
        }
    };

    let output = reader.join().unwrap_or_default();
    if !status.success() {
        return Err(format!("judge exited with {status}"));
    }
    parse_verdict(&output)
}

fn parse_verdict(output: &str) -> Result<JudgeVerdict, String> {
    let line = output
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .ok_or("judge produced no output")?;
    serde_json::from_str(line.trim()).map_err(|e| format!("invalid judge verdict: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::TempDir;

    fn script(dir: &TempDir, body: &str) -> String {
        let path = dir.path().join("judge.sh");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path.to_string_lossy().into_owned()
    }

    fn request() -> JudgeRequest<'static> {
        JudgeRequest {
            schema_version: 1,
            objective: Some("ship it"),
            completion_promise: "LOOP_COMPLETE",
            iteration: 3,
            rejections: 0,
            workspace: "/tmp".to_string(),
            loop_id: None,
            closed_tasks: vec![],
        }
    }

    fn config(command: String, timeout_seconds: u64) -> CompletionJudgeConfig {
        CompletionJudgeConfig {
            command: vec![command],
            timeout_seconds,
            ..CompletionJudgeConfig::default()
        }
    }

    #[test]
    fn parses_fail_verdict_from_last_line() {
        let dir = TempDir::new().unwrap();
        let cmd = script(
            &dir,
            "cat >/dev/null\necho noise\necho '{\"verdict\":\"fail\",\"reason\":\"tests missing\"}'",
        );
        let verdict = run_judge(&config(cmd, 5), dir.path(), &request()).unwrap();
        assert_eq!(verdict.verdict, JudgeDecision::Fail);
        assert_eq!(verdict.reason, "tests missing");
    }

    #[test]
    fn judge_receives_objective_on_stdin() {
        let dir = TempDir::new().unwrap();
        let cmd = script(
            &dir,
            "if grep -q 'ship it'; then echo '{\"verdict\":\"pass\"}'; else echo '{\"verdict\":\"fail\"}'; fi",
        );
        let verdict = run_judge(&config(cmd, 5), dir.path(), &request()).unwrap();
        assert_eq!(verdict.verdict, JudgeDecision::Pass);
    }

    #[test]
    fn nonzero_exit_is_error() {
        let dir = TempDir::new().unwrap();
        let cmd = script(&dir, "cat >/dev/null\nexit 3");
        assert!(run_judge(&config(cmd, 5), dir.path(), &request()).is_err());
    }

    #[test]
    fn timeout_is_error() {
        let dir = TempDir::new().unwrap();
        let cmd = script(&dir, "sleep 5");
        let err = run_judge(&config(cmd, 1), dir.path(), &request()).unwrap_err();
        assert!(err.contains("timed out"));
    }
}
