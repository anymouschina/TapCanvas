#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
TapCanvas one-click dev launcher.

Local (recommended for fastest HMR):
  ./scripts/dev.sh local [--install]

Docker Compose (HMR via bind mount; slower, but closer to prod):
  ./scripts/dev.sh docker [--langgraph] [--build]

Examples:
  ./scripts/dev.sh local --install
  ./scripts/dev.sh docker
  ./scripts/dev.sh docker --langgraph
EOF
}

cmd="${1:-local}"
shift || true

case "$cmd" in
  -h|--help|help)
    usage
    exit 0
    ;;
  local)
    install=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --install) install=1 ;;
        *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
      esac
      shift
    done

    if [ "$install" = "1" ]; then
      pnpm -w install
    fi

    pids=()
    cleanup() {
      for pid in "${pids[@]:-}"; do
        kill "$pid" 2>/dev/null || true
      done
      wait 2>/dev/null || true
    }
    trap cleanup EXIT INT TERM

    pnpm dev:api &
    pids+=("$!")
    pnpm dev:web &
    pids+=("$!")

    wait
    ;;
  docker)
    with_langgraph=0
    build=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --langgraph) with_langgraph=1 ;;
        --build) build=1 ;;
        *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
      esac
      shift
    done

    args=(up)
    if [ "$with_langgraph" = "1" ]; then
      args+=(--profile langgraph)
    fi
    args+=(-d)
    if [ "$build" = "1" ]; then
      args+=(--build)
    fi

    docker compose "${args[@]}"
    echo "Web: http://localhost:5173"
    echo "API: http://localhost:8788"
    if [ "$with_langgraph" = "1" ]; then
      echo "LangGraph: http://localhost:8123"
    fi
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac

