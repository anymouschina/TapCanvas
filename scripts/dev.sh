#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
TapCanvas one-click dev launcher.

Local (recommended for fastest HMR):
  ./scripts/dev.sh local [--install] [--webcut]

Docker Compose (HMR via bind mount; slower, but closer to prod):
  ./scripts/dev.sh docker [--build]

Examples:
  ./scripts/dev.sh local --install
  ./scripts/dev.sh local --webcut
  ./scripts/dev.sh docker
  ./scripts/dev.sh docker --build
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
    start_webcut=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --install) install=1 ;;
        --webcut) start_webcut=1 ;;
        *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
      esac
      shift
    done

    if [ "$install" = "1" ]; then
      pnpm -w install
    fi

    inferred_web_github_client_id=""
    if [ -z "${VITE_GITHUB_CLIENT_ID:-}" ]; then
      if ! has_env_key "apps/web/.env" "VITE_GITHUB_CLIENT_ID" \
        && ! has_env_key "apps/web/.env.local" "VITE_GITHUB_CLIENT_ID" \
        && ! has_env_key "apps/web/.env.development" "VITE_GITHUB_CLIENT_ID" \
        && ! has_env_key "apps/web/.env.development.local" "VITE_GITHUB_CLIENT_ID"; then
        inferred_web_github_client_id="$(read_env_value "apps/hono-api/.env" "GITHUB_CLIENT_ID" || true)"
        if [ -z "$inferred_web_github_client_id" ]; then
          inferred_web_github_client_id="$(read_env_value "apps/hono-api/.dev.vars" "GITHUB_CLIENT_ID" || true)"
        fi
        if [ -z "$inferred_web_github_client_id" ]; then
          echo "[dev.sh] Note: GitHub login is disabled unless you set VITE_GITHUB_CLIENT_ID in apps/web/.env(.local)." >&2
        else
          echo "[dev.sh] Using apps/hono-api (.env/.dev.vars) GITHUB_CLIENT_ID as VITE_GITHUB_CLIENT_ID for web dev." >&2
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
      if [ -n "${VITE_GITHUB_CLIENT_ID:-}" ]; then
        pnpm dev
      elif [ -n "$inferred_web_github_client_id" ]; then
        env VITE_GITHUB_CLIENT_ID="$inferred_web_github_client_id" pnpm dev
      else
        pnpm dev
      fi
    ) &
    pids+=("$!")

    wait
    ;;
  docker)
    build=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --build) build=1 ;;
        *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
      esac
      shift
    done

    args=(up)
    args+=(-d)
    if [ "$build" = "1" ]; then
      args+=(--build)
    fi

    compose "${args[@]}"
    echo "Web: http://localhost:5173"
    echo "API: http://localhost:8788"
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac
