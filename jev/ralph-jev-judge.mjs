#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const JEV_API = process.env.JEV_API_URL || "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = process.env.JEV_MODEL || "jev-latest";
const DONE_THRESHOLD = Number(process.env.RALPH_JEV_DONE_THRESHOLD || "0.6");
const VERIFIED_THRESHOLD = Number(process.env.RALPH_JEV_VERIFIED_THRESHOLD || "0.5");
const TIMEOUT_MS = Number(process.env.RALPH_JEV_TIMEOUT_MS || "30000");
const COOLDOWN_MS = Number(process.env.JEV_COOLDOWN_MS || "300000");
const CIRCUIT_FILE = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "ralph-jev", "circuit.json");

function readEnvKey(path) {
  if (!path || !existsSync(path)) return null;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=\s*"?([^"\s]+)"?/);
    if (m) return m[1];
  }
  return null;
}

function loadApiKey() {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  const dir = join(homedir(), ".config", "jev-browser-use");
  const fromDir = readEnvKey(join(dir, ".env"));
  if (fromDir) return fromDir;
  try {
    const cfg = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    return readEnvKey(cfg.envFile);
  } catch {
    return null;
  }
}

function circuitOpen() {
  try {
    const { openUntil } = JSON.parse(readFileSync(CIRCUIT_FILE, "utf8"));
    return Date.now() < openUntil;
  } catch {
    return false;
  }
}

function tripCircuit(reason) {
  mkdirSync(dirname(CIRCUIT_FILE), { recursive: true });
  writeFileSync(CIRCUIT_FILE, JSON.stringify({ openUntil: Date.now() + COOLDOWN_MS, reason }));
}

function sh(cwd, cmd, args) {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000 }).trim();
  } catch {
    return "";
  }
}

function tail(text, max) {
  return text.length > max ? text.slice(text.length - max) : text;
}

function recentEvents(workspace) {
  const marker = join(workspace, ".ralph", "current-events");
  const path = existsSync(marker)
    ? resolve(workspace, readFileSync(marker, "utf8").trim())
    : join(workspace, ".ralph", "events.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .slice(-15)
    .map((line) => {
      try {
        const e = JSON.parse(line);
        return { topic: e.topic, payload: String(e.payload ?? "").slice(0, 300) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function gatherEvidence(req) {
  const ws = req.workspace || process.cwd();
  return {
    objective: String(req.objective || "").slice(0, 4000),
    iteration: req.iteration,
    previous_rejections: req.rejections,
    closed_tasks: (req.closed_tasks || []).slice(-30),
    recent_commits: sh(ws, "git", ["log", "--oneline", "-15"]),
    uncommitted_changes: sh(ws, "git", ["status", "--short"]).slice(0, 2000),
    diff_stat: tail(sh(ws, "git", ["diff", "--stat", "HEAD~5"]), 2000),
    recent_events: recentEvents(ws),
  };
}

const QUESTIONS = {
  objective_met: {
    type: "noul",
    instructions:
      "Does the evidence in the state (commits, changed files, closed tasks and recent events) show that every part of `objective` has been accomplished in the workspace? Answer false when any requested part is missing, only planned, or only described.",
  },
  verified: {
    type: "noul",
    instructions:
      "Do `recent_events`, `closed_tasks` or `recent_commits` show that the work was checked by running tests, a build, a typecheck or another concrete verification that passed, rather than only being claimed as done?",
  },
};

async function askJev(state) {
  const key = loadApiKey();
  if (!key) throw new Error("TYPESAFE_API_KEY not configured");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(JEV_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: JEV_MODEL, state, questions: QUESTIONS }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = `Jev HTTP ${res.status}`;
      if (res.status === 429 || res.status >= 500) tripCircuit(err);
      throw new Error(err);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function verdictFrom(answers) {
  const done = answers?.objective_met?.noul;
  const verified = answers?.verified?.noul;
  if (typeof done !== "number" || typeof verified !== "number") {
    throw new Error("Jev response missing noul answers");
  }
  const scores = `objective_met=${done.toFixed(2)} verified=${verified.toFixed(2)}`;
  if (done < DONE_THRESHOLD) {
    return { verdict: "fail", reason: `Jev does not see the objective fully accomplished (${scores})` };
  }
  if (verified < VERIFIED_THRESHOLD) {
    return { verdict: "fail", reason: `Jev sees no passing verification evidence such as tests or build (${scores})` };
  }
  return { verdict: "pass", reason: scores };
}

async function main() {
  const raw = readFileSync(0, "utf8");
  const req = JSON.parse(raw || "{}");
  if (circuitOpen()) {
    process.stderr.write("ralph-jev-judge: circuit open\n");
    process.exit(2);
  }
  const data = await askJev(gatherEvidence(req));
  process.stdout.write(`${JSON.stringify(verdictFrom(data.answers))}\n`);
}

main().catch((e) => {
  process.stderr.write(`ralph-jev-judge: ${e.message}\n`);
  process.exit(1);
});
