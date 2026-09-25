# Getting started

## Requirements

Rust (edition 2024), Node.js 18+, git, a builder agent CLI. A TypeSafe API key for Jev.

## Install

```bash
git clone https://github.com/flaviomartil/ralph-jev.git
cd ralph-jev
jev/install.sh
```

The installer builds the release binary, links `ralph-jev`, `ralph-jev-judge` and `ralph-jev-hook` into `~/.local/bin`, and adds `jev/ralph.jev.yml` to `~/.ralph/config.yml` when it can do so without conflicts.

Set `CARGO_TARGET_DIR` before running the installer to build somewhere else (for example on a bigger disk). `BIN_DIR` changes where the commands go.

## Jev credentials

Set `TYPESAFE_API_KEY` in your environment, or keep it in `~/.config/jev-browser-use/.env` as `TYPESAFE_API_KEY=...`. Without a key the hooks skip and the judge fails open (see [Configuration](guide/configuration.md)).

## First run

Check the environment first:

```bash
ralph-jev doctor
ralph-jev hooks validate
```

Then give the loop an objective with a checkable definition of done:

```bash
ralph-jev run -p "$(cat <<'EOF'
Add a header before the <p> tag.

## Acceptance criteria
- An <h1> header appears before the <p> tag in index.html
- A test script verifies the header order and passes
EOF
)" --max-iterations 30
```

Useful while it runs:

- `RALPH_JEV_VERIFY_CMD="npm test"` makes the judge run your tests before asking Jev.
- `ralph-jev events` shows the event history, including judge rejections.
- `.ralph/current-objective.md` holds the full objective the hooks are reading.
