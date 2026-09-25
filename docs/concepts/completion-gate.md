# Completion gate

![Completion gate](../architecture/completion-gate.png)

[Open the interactive diagram](../architecture/completion-gate.html)

In any agent loop, the agent eventually says `LOOP_COMPLETE` even though the work isn't finished: a missing piece, a test that never ran, a plan written up as if it were the result. The completion gate checks the claim before the loop is allowed to end.

## Contract

`event_loop.completion_judge.command` is any program. It gets the loop context as JSON on stdin (objective, completion promise, iteration, rejections so far, workspace, loop id, closed tasks) and prints one line:

```json
{"verdict": "pass", "reason": "..."}
```

Because the judge is just a command, you can swap Jev for a test script, a linter or another model without touching Rust.

## The Jev judge

`ralph-jev-judge` collects evidence (see [Judge evidence](judge-evidence.md)) and asks Jev:

| Question | Default threshold | Env var |
|---|---|---|
| `objective_met`: is every part of the objective accomplished? | 0.6 | `RALPH_JEV_DONE_THRESHOLD` |
| `verified`: did tests, a build or another check actually run and pass? | 0.5 | `RALPH_JEV_VERIFIED_THRESHOLD` |
| `gap`: what is missing? | choice | |

The gap is one of: implementation missing, tests not run, checks failing, change off the objective, or nothing. On a fail it turns into the next step in the reason, for example `gap=checks_failing; next: fix the failing checks and rerun them`.

## Safety bounds

- **Fail-open**: if the judge errors, times out or Jev's circuit is open, the completion is accepted unless `fail_closed: true`.
- **Rejection budget**: after `max_rejections` rejections the completion is accepted.
- **Circuit breaker**: a 429 or 5xx from Jev pauses Jev calls for `JEV_COOLDOWN_MS` (default 5 minutes), shared across processes through `~/.cache/ralph-jev/circuit.json`.
