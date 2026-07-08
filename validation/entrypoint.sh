#!/bin/sh
set -eu

show_menu() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  status-provider validation sandbox"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  1) Launch opencode"
  echo "  2) Open a shell"
  echo "  3) Run status-provider config wizard"
  echo "  q) Quit"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  printf "Choice [1]: "
}

while true; do
  show_menu
  read -r choice || exit 0
  case "${choice:-1}" in
    1)
      opencode /project
      ;;
    2)
      sh
      ;;
    3)
      node /project/dist/bin/status-provider.js config
      ;;
    q|Q)
      exit 0
      ;;
    *)
      echo "Unknown choice: ${choice}"
      ;;
  esac
  echo ""
  echo "─────────────────────────────────────"
  echo "  Back to menu in 1s... (Ctrl+C twice to exit)"
  echo "─────────────────────────────────────"
  sleep 1
done
