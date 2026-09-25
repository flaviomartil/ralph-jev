#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
USER_CFG="$HOME/.ralph/config.yml"

cargo build --release -p ralph-cli --manifest-path "$ROOT/Cargo.toml"
mkdir -p "$BIN_DIR"
RALPH_BIN="${CARGO_TARGET_DIR:-$ROOT/target}/release/ralph"
case "$RALPH_BIN" in /*) ;; *) RALPH_BIN="$PWD/$RALPH_BIN" ;; esac
ln -sf "$RALPH_BIN" "$BIN_DIR/ralph-jev"
ln -sf "$ROOT/jev/ralph-jev-judge.mjs" "$BIN_DIR/ralph-jev-judge"
ln -sf "$ROOT/jev/ralph-jev-hook.mjs" "$BIN_DIR/ralph-jev-hook"

if [ -f "$USER_CFG" ] && grep -q "jev-progress" "$USER_CFG"; then
  echo "ralph-jev: Jev already configured in $USER_CFG"
elif [ ! -f "$USER_CFG" ]; then
  mkdir -p "$(dirname "$USER_CFG")"
  cp "$ROOT/jev/ralph.jev.yml" "$USER_CFG"
  echo "ralph-jev: created $USER_CFG with Jev judge and hooks"
elif ! grep -qE "^(event_loop|hooks):" "$USER_CFG"; then
  cp "$USER_CFG" "$USER_CFG.bak.$(date +%s)"
  printf '\n' >> "$USER_CFG"
  cat "$ROOT/jev/ralph.jev.yml" >> "$USER_CFG"
  echo "ralph-jev: appended Jev judge and hooks to $USER_CFG"
else
  echo "ralph-jev: merge jev/ralph.jev.yml into $USER_CFG manually"
fi
