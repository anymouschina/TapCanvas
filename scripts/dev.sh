#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
TapCanvas one-click dev launcher.

Local (recommended for fastest HMR):
  ./scripts/dev.sh local [--install] [--all] [--webcut] [--langgraph] [--ai-backend]

Docker Compose (HMR via bind mount; slower, but closer to prod):
  ./scripts/dev.sh docker [--langgraph] [--build]

Examples:
  ./scripts/dev.sh local --install
  ./scripts/dev.sh local --all
  ./scripts/dev.sh local --langgraph
  ./scripts/dev.sh docker
  ./scripts/dev.sh docker --langgraph
EOF
}

has_env_key() {
  local file="$1"
  local key="$2"
  [ -f "$file" ] || return 1
  grep -Eq "^[[:space:]]*${key}[[:space:]]*=" "$file"
}

read_env_value() {
  local file="$1"
  local key="$2"
  [ -f "$file" ] || return 1
  local line=""
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$file" | head -n 1 || true)"
  [ -n "$line" ] || return 1
  local value="${line#*=}"
  value="${value%$'\r'}"
  # Trim surrounding quotes if present.
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf "%s" "$value"
  return 0
}

detect_compose() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "docker"
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1; then
    echo "docker-compose"
    return 0
  fi
  return 1
}

compose() {
  local flavor=""
  flavor="$(detect_compose || true)"
  if [ "$flavor" = "docker" ]; then
    docker compose "$@"
    return $?
  fi
  if [ "$flavor" = "docker-compose" ]; then
    docker-compose "$@"
    return $?
  fi
  echo "[dev.sh] docker compose not available (neither 'docker compose' nor 'docker-compose')" >&2
  return 1
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
    start_langgraph=0
    start_ai_backend=0
    start_webcut=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --install) install=1 ;;
        --all) start_langgraph=1; start_ai_backend=1; start_webcut=1 ;;
        --webcut) start_webcut=1 ;;
        --langgraph) start_langgraph=1 ;;
        --ai-backend) start_ai_backend=1 ;;
        *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
      esac
      shift
    done

    if [ "$install" = "1" ]; then
      pnpm -w install
    fi

    langgraph_url=""
    langgraph_mode="off"

    if [ "$start_langgraph" = "1" ]; then
      if [ -f "apps/ai-fullstack/backend/scripts/dev-langgraph.sh" ] && [ -f "apps/ai-fullstack/backend/.venv/bin/langgraph" ]; then
        langgraph_mode="local"
        langgraph_url="http://localhost:8001"
      else
        langgraph_mode="docker"
        langgraph_url="http://localhost:8123"
        echo "[dev.sh] Starting LangGraph services via docker compose profile 'langgraph'..." >&2
        compose --profile langgraph up -d langgraph-redis langgraph-postgres langgraph-api
        echo "[dev.sh] LangGraph should be available at ${langgraph_url}" >&2
      fi
    fi

    inferred_web_github_client_id=""
    if [ -z "${VITE_GITHUB_CLIENT_ID:-}" ]; then
      if ! has_env_key "apps/web/.env" "VITE_GITHUB_CLIENT_ID" \
        && ! has_env_key "apps/web/.env.local" "VITE_GITHUB_CLIENT_ID" \
        && ! has_env_key "apps/web/.env.development" "VITE_GITHUB_CLIENT_ID" \
        && ! has_env_key "apps/web/.env.development.local" "VITE_GITHUB_CLIENT_ID"; then
        inferred_web_github_client_id="$(read_env_value "apps/hono-api/.dev.vars" "GITHUB_CLIENT_ID" || true)"
        if [ -z "$inferred_web_github_client_id" ]; then
          echo "[dev.sh] Note: GitHub login is disabled unless you set VITE_GITHUB_CLIENT_ID in apps/web/.env(.local)." >&2
        else
          echo "[dev.sh] Using apps/hono-api/.dev.vars GITHUB_CLIENT_ID as VITE_GITHUB_CLIENT_ID for web dev." >&2
        fi
      fi
    fi

    pids=()
    cleanup() {
      for pid in "${pids[@]:-}"; do
        kill "$pid" 2>/dev/null || true
      done
      wait 2>/dev/null || true
    }
    trap cleanup EXIT INT TERM

    (cd apps/hono-api && pnpm dev) &
    pids+=("$!")

    if [ "$start_ai_backend" = "1" ]; then
      if [ -f "apps/ai-fullstack/backend/scripts/dev-uvicorn.sh" ] && [ -f "apps/ai-fullstack/backend/.venv/bin/python" ]; then
        (cd apps/ai-fullstack/backend && bash ./scripts/dev-uvicorn.sh) &
        pids+=("$!")
        echo "[dev.sh] ai-fullstack backend (uvicorn) on http://localhost:8080" >&2
      else
        echo "[dev.sh] Skip ai-backend: missing apps/ai-fullstack/backend/.venv or scripts/dev-uvicorn.sh" >&2
      fi
    fi

    if [ "$start_langgraph" = "1" ] && [ "$langgraph_mode" = "local" ]; then
      (cd apps/ai-fullstack/backend && bash ./scripts/dev-langgraph.sh) &
      pids+=("$!")
      echo "[dev.sh] LangGraph dev on ${langgraph_url}" >&2
    fi

    if [ "$start_webcut" = "1" ]; then
      if [ -f "apps/webcut-main/package.json" ]; then
        (cd apps/webcut-main && pnpm dev:app --host 0.0.0.0 --port 5174) &
        pids+=("$!")
        echo "[dev.sh] webcut app on http://localhost:5174" >&2
      else
        echo "[dev.sh] Skip webcut: apps/webcut-main/package.json not found" >&2
      fi
    fi

    (
      cd apps/web
      extra_vite_env=()
      if [ "$start_langgraph" = "1" ]; then
        if [ -z "${VITE_LANGGRAPH_API_URL:-}" ] \
          && ! has_env_key ".env" "VITE_LANGGRAPH_API_URL" \
          && ! has_env_key ".env.local" "VITE_LANGGRAPH_API_URL" \
          && ! has_env_key ".env.development" "VITE_LANGGRAPH_API_URL" \
          && ! has_env_key ".env.development.local" "VITE_LANGGRAPH_API_URL"; then
          if [ -n "${langgraph_url:-}" ]; then
            extra_vite_env+=(VITE_LANGGRAPH_API_URL="$langgraph_url")
          fi
        fi
      fi

      if [ -n "${VITE_GITHUB_CLIENT_ID:-}" ]; then
        if [ "${#extra_vite_env[@]}" -gt 0 ]; then
          env "${extra_vite_env[@]}" pnpm dev
        else
          pnpm dev
        fi
      elif [ -n "$inferred_web_github_client_id" ]; then
        if [ "${#extra_vite_env[@]}" -gt 0 ]; then
          env VITE_GITHUB_CLIENT_ID="$inferred_web_github_client_id" "${extra_vite_env[@]}" pnpm dev
        else
          env VITE_GITHUB_CLIENT_ID="$inferred_web_github_client_id" pnpm dev
        fi
      else
        if [ "${#extra_vite_env[@]}" -gt 0 ]; then
          env "${extra_vite_env[@]}" pnpm dev
        else
          pnpm dev
        fi
      fi
    ) &
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

    compose "${args[@]}"
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
