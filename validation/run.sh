#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE="status-provider-validation"
CONTAINER="$IMAGE"
SANDBOX_STATE="$SCRIPT_DIR/sandbox-state"
HOST_AUTH_DIR="$HOME/.local/share/opencode"
PORT="${PORT:-3004}"

usage() {
  echo ""
  echo "  status-provider validation"
  echo ""
  echo "  Usage: ./validation/run.sh [--build] [--stop] [--help]"
  echo ""
  echo "    --build       Rebuild validation image before running"
  echo "    --stop        Stop validation container"
  echo "    PORT=XXXX     Expose a different host port (default: 3004)"
  echo ""
  exit 0
}

[[ "${1:-}" == "--help" ]] && usage

if [[ "${1:-}" == "--stop" ]]; then
  podman stop "$CONTAINER" 2>/dev/null && echo "Stopped $CONTAINER" || echo "$CONTAINER was not running"
  exit 0
fi

mkdir -p "$SANDBOX_STATE/.local/share/opencode"
mkdir -p "$SANDBOX_STATE/.config/opencode"

for f in auth.json auth-v2.json; do
  if [[ -f "$HOST_AUTH_DIR/$f" ]]; then
    cp "$HOST_AUTH_DIR/$f" "$SANDBOX_STATE/.local/share/opencode/$f"
    echo "auth: copied $f"
  fi
done

if [[ "${1:-}" == "--build" ]] || ! podman image exists "$IMAGE" 2>/dev/null; then
  podman build -t "$IMAGE" "$SCRIPT_DIR"
fi

if podman ps --format "{{.Names}}" 2>/dev/null | grep -q "^${CONTAINER}$"; then
  echo "$CONTAINER already running. Use ./validation/run.sh --stop first."
  exit 1
fi

if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
  bun install --cwd "$REPO_ROOT"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Validation: status-provider"
echo "  URL:        http://localhost:${PORT}"
echo "  Config:     $SANDBOX_STATE/.config/opencode/status-provider/config.json"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

podman run --rm \
  --name "$CONTAINER" \
  -p "${PORT}:3002" \
  -v "$REPO_ROOT":/project:z \
  -v "$SANDBOX_STATE/.local":/sandbox/.local:z \
  -v "$SANDBOX_STATE/.config/opencode":/sandbox/.config/opencode:z \
  --env-host=false \
  -e HOME=/sandbox \
  -e TERM=xterm-256color \
  -e OPENCODE_CONFIG_DIR=/sandbox/.config/opencode \
  "$IMAGE"
