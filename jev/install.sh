#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
USER_CFG="$HOME/.ralph/config.yml"

cargo build --release -p ralph-cli --manifest-path "$ROOT/Cargo.toml"
mkdir -p "$BIN_DIR"
ln -sf "$ROOT/target/release/ralph" "$BIN_DIR/ralph-jev"
ln -sf "$ROOT/jev/ralph-jev-judge.mjs" "$BIN_DIR/ralph-jev-judge"

if [ -f "$USER_CFG" ] && grep -q "completion_judge" "$USER_CFG"; then
  echo "ralph-jev: judge already configured in $USER_CFG"
elif [ ! -f "$USER_CFG" ]; then
  mkdir -p "$(dirname "$USER_CFG")"
  cp "$ROOT/jev/ralph.jev.yml" "$USER_CFG"
  echo "ralph-jev: created $USER_CFG with Jev completion judge"
elif ! grep -q "^event_loop:" "$USER_CFG"; then
  cp "$USER_CFG" "$USER_CFG.bak.$(date +%s)"
  printf '\n' >> "$USER_CFG"
  cat "$ROOT/jev/ralph.jev.yml" >> "$USER_CFG"
  echo "ralph-jev: appended Jev completion judge to $USER_CFG"
else
  echo "ralph-jev: merge jev/ralph.jev.yml into the event_loop section of $USER_CFG manually"
fi
