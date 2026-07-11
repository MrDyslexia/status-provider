#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VALIDATION_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE="status-provider-clean-user-sandbox"
CONTAINER="$IMAGE"
SANDBOX_STATE="$SCRIPT_DIR/sandbox-state"
PORT="${PORT:-5001}"

usage() {
  echo ""
  echo "  status-provider clean user sandbox"
  echo ""
  echo "  Usage: ./validation/clean-user-sandbox/run.sh [--build] [--reset] [--detach] [--stop] [--help]"
  echo ""
  echo "    --build       Rebuild the sandbox image before running"
  echo "    --reset       Delete sandbox HOME before running"
  echo "    --detach      Run container in the background"
  echo "    --stop        Stop the sandbox container"
  echo "    PORT=XXXX     Expose a different host port (default: 5001)"
  echo ""
  echo "  This sandbox simulates a normal user: terminal only, fresh opencode-ai,"
  echo "  no status-provider package, no repo mount, no copied auth.json."
  echo ""
  exit 0
}

BUILD=false
RESET=false
DETACH=false
for arg in "$@"; do
  case "$arg" in
    --help)
      usage
      ;;
    --build)
      BUILD=true
      ;;
    --reset)
      RESET=true
      ;;
    --detach)
      DETACH=true
      ;;
    --stop)
      podman rm -f "$CONTAINER" 2>/dev/null && echo "Removed $CONTAINER" || echo "$CONTAINER was not present"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage
      ;;
  esac
done

if [[ "$RESET" == true ]]; then
  rm -rf "$SANDBOX_STATE"
fi
mkdir -p "$SANDBOX_STATE"

if [[ "$BUILD" == true ]] || ! podman image exists "$IMAGE" 2>/dev/null; then
  podman build -t "$IMAGE" -f "$SCRIPT_DIR/Containerfile" "$VALIDATION_DIR"
fi

if podman ps --format "{{.Names}}" 2>/dev/null | grep -q "^${CONTAINER}$"; then
  echo "$CONTAINER already running. Use ./validation/clean-user-sandbox/run.sh --stop first."
  exit 1
fi

podman rm "$CONTAINER" 2>/dev/null || true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Clean user sandbox: status-provider"
echo "  URL:        http://localhost:${PORT}"
echo "  Browser:    http://192.168.1.158:${PORT}"
echo "  HOME:       $SANDBOX_STATE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

RUN_ARGS=(--rm)
if [[ "$DETACH" == true ]]; then
  RUN_ARGS=(-d)
fi

podman run "${RUN_ARGS[@]}" \
  --name "$CONTAINER" \
  -p "${PORT}:3002" \
  -v "$SANDBOX_STATE":/sandbox:z \
  --env-host=false \
  -e HOME=/sandbox \
  -e TERM=xterm-256color \
  "$IMAGE"
