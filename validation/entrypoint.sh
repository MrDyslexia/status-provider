#!/bin/sh
set -eu

while true; do
  opencode
  echo ""
  echo "─────────────────────────────────────"
  echo "  OpenCode ended. Restarting in 2s..."
  echo "  (Ctrl+C twice to exit completely)"
  echo "─────────────────────────────────────"
  sleep 2
done
