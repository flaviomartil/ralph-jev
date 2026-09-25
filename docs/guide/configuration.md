# Configuration

## Layers

Configuration is merged from these sources, later ones winning:

1. The user config: `$RALPH_USER_CONFIG` if set, otherwise `~/.ralph/config.yml`. A missing file is simply skipped.
2. The project config: `-c <file|url>`, else `$RALPH_CONFIG`, else `ralph.yml` in the workspace.
3. `-c core.field=value` overrides.

Maps are merged key by key; lists are replaced as a whole. So a project `ralph.yml` that defines `hooks.events.pre.loop.start` replaces the user list for that event instead of appending to it.

Hat collections come separately, with `-H builtin:<name>` or `-H <file>`. `ralph init --list-presets` lists the builtin collections.

## Using it next to ralph-jev-gauntlet

[ralph-jev-gauntlet](https://github.com/flaviomartil/ralph-jev-gauntlet) installs a wrapper that sets `RALPH_USER_CONFIG=~/.ralph/gauntlet.yml`, so both can be enabled at the same time: `ralph-jev` keeps using `~/.ralph/config.yml` and the Jev judge, and `ralph-jev-gauntlet` uses its own file and the gauntlet judge.

## Completion judge

```yaml
event_loop:
  completion_judge:
    command: ["ralph-jev-judge"]
    timeout_seconds: 60
    max_rejections: 3
    fail_closed: false
```

| Field | Default | Meaning |
|---|---|---|
| `command` | empty (gate off) | Program and arguments; gets JSON on stdin, prints `{"verdict","reason"}` |
| `timeout_seconds` | 60 | The whole process group is killed after this |
| `max_rejections` | 3 | Rejections before a completion is accepted anyway; `0` means unlimited |
| `fail_closed` | false | Reject instead of accept when the judge errors or times out |

## Hooks

```yaml
hooks:
  enabled: true
  events:
    pre.loop.start:
      - name: jev-triage
        command: ["ralph-jev-hook", "triage"]
        on_error: warn
        mutate:
          enabled: true
    pre.iteration.start:
      - name: jev-progress
        command: ["ralph-jev-hook", "progress"]
        on_error: warn
        mutate:
          enabled: true
```

`on_error` is `warn`, `block` or `suspend`. `mutate.enabled` lets the hook's metadata flow into later hook payloads. Check the wiring with `ralph-jev hooks validate`. See [Jev hooks](../concepts/jev-hooks.md).

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `RALPH_USER_CONFIG` | `~/.ralph/config.yml` | User config file |
| `RALPH_CONFIG` | `ralph.yml` | Project config when `-c` is not given |
| `TYPESAFE_API_KEY` | from `~/.config/jev-browser-use/.env` | Jev credentials |
| `JEV_API_URL` | `https://api.typesafe.ai/v1/systemone` | Jev endpoint |
| `JEV_MODEL` | `jev-latest` | Jev model |
| `JEV_COOLDOWN_MS` | 300000 | Pause after a 429 or 5xx from Jev |
| `RALPH_JEV_TIMEOUT_MS` | 30000 | Per-request Jev timeout |
| `RALPH_JEV_VERIFY_CMD` | unset | Shell command run before judging, for example `npm test` |
| `RALPH_JEV_VERIFY_TIMEOUT_MS` | 300000 | Verify command time limit |
| `RALPH_JEV_VERIFIED_THRESHOLD` | 0.5 | `verified` threshold |
| `RALPH_JEV_DONE_THRESHOLD` | 0.6 | `objective_met` threshold |
| `RALPH_JEV_AMBIGUOUS_THRESHOLD` | 0.7 | Triage warning threshold |
| `RALPH_JEV_STALL_THRESHOLD` | 0.75 | Stall warning threshold |
| `RALPH_JEV_PROGRESS_MIN_ITERATION` | 3 | First iteration the stall check runs |
