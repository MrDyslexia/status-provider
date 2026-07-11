#!/bin/sh
set -eu

cat <<'EOF'
status-provider clean user sandbox

Fresh environment:
- HOME=/sandbox
- opencode-ai is installed globally
- status-provider is NOT pre-installed
- repo/dist/auth are NOT mounted

Useful checks:
  opencode --version
  npx status-provider init
  bun add -g status-provider && status-provider init
  opencode /sandbox

EOF

exec sh
