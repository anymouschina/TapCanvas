#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
TapCanvas one-click dev launcher.

Local (recommended for fastest HMR):
  ./scripts/dev.sh local [--install] [--webcut]

Docker Compose (self-contained images; no host dependencies required):
  ./scripts/dev.sh docker [--no-build|--fresh-build|--init-only]
  ./scripts/dev.sh docker-down

Examples:
  ./scripts/dev.sh local --install
  ./scripts/dev.sh local --webcut
  ./scripts/dev.sh docker
  ./scripts/dev.sh docker --fresh-build
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
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$file" | tail -n 1 || true)"
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

generate_hex_secret() {
  local bytes="$1"
  if ! command -v openssl >/dev/null 2>&1; then
    echo "[dev.sh] openssl is required to generate the first-run Docker secrets." >&2
    return 1
  fi
  openssl rand -hex "$bytes"
}

create_docker_env() {
  local file="$1"
  local postgres_password=""
  local jwt_secret=""
  local internal_worker_token=""
  local agents_bridge_token=""
  local new_api_internal_token=""
  local new_api_session_secret=""
  local new_api_crypto_secret=""
  local tapcanvas_admin_password=""
  local new_api_root_password=""

  postgres_password="$(generate_hex_secret 24)"
  jwt_secret="$(generate_hex_secret 32)"
  internal_worker_token="$(generate_hex_secret 32)"
  agents_bridge_token="$(generate_hex_secret 32)"
  new_api_internal_token="sk-$(generate_hex_secret 24)"
  new_api_session_secret="$(generate_hex_secret 32)"
  new_api_crypto_secret="$(generate_hex_secret 32)"
  tapcanvas_admin_password="$(generate_hex_secret 12)"
  new_api_root_password="$(generate_hex_secret 12)"

  umask 077
  {
    printf '%s\n' '# Generated once by ./scripts/dev.sh docker. Keep this file private.'
    printf '%s\n' '# Existing files are never overwritten, so manually added provider keys are preserved.'
    printf 'POSTGRES_DB=tapcanvas\n'
    printf 'POSTGRES_USER=tapcanvas\n'
    printf 'POSTGRES_PASSWORD=%s\n' "$postgres_password"
    printf 'JWT_SECRET=%s\n' "$jwt_secret"
    printf 'INTERNAL_WORKER_TOKEN=%s\n' "$internal_worker_token"
    printf 'AGENTS_BRIDGE_TOKEN=%s\n' "$agents_bridge_token"
    printf 'NEW_API_INTERNAL_TOKEN=%s\n' "$new_api_internal_token"
    printf 'NEW_API_SESSION_SECRET=%s\n' "$new_api_session_secret"
    printf 'NEW_API_CRYPTO_SECRET=%s\n' "$new_api_crypto_secret"
    printf 'NEW_API_USD_EXCHANGE_RATE=7.3\n'
    printf 'TAP_CREDITS_PER_CNY=100\n'
    printf 'TAPCANVAS_ADMIN_USERNAME=admin\n'
    printf 'TAPCANVAS_ADMIN_PASSWORD=%s\n' "$tapcanvas_admin_password"
    printf 'NEW_API_ROOT_USERNAME=admin\n'
    printf 'NEW_API_ROOT_PASSWORD=%s\n' "$new_api_root_password"
  } > "$file"
  chmod 600 "$file"
  echo "[dev.sh] Created private Docker configuration at $file (values were not printed)."
}

validate_docker_env() {
  local file="$1"
  local required_keys=(
    POSTGRES_PASSWORD
    JWT_SECRET
    INTERNAL_WORKER_TOKEN
    AGENTS_BRIDGE_TOKEN
    NEW_API_INTERNAL_TOKEN
    NEW_API_SESSION_SECRET
    NEW_API_CRYPTO_SECRET
    NEW_API_USD_EXCHANGE_RATE
  )
  local missing_keys=()
  local key=""
  local value=""

  for key in "${required_keys[@]}"; do
    value="$(read_env_value "$file" "$key" || true)"
    if [ -z "$value" ]; then
      missing_keys+=("$key")
    fi
  done
  if [ "${#missing_keys[@]}" -gt 0 ]; then
    echo "[dev.sh] Existing $file is missing required Docker keys:" >&2
    printf '  - %s\n' "${missing_keys[@]}" >&2
    echo "[dev.sh] The file was preserved. Add those keys, then run the command again." >&2
    return 1
  fi

  value="$(read_env_value "$file" "NEW_API_INTERNAL_TOKEN")"
  value="${value#sk-}"
  if [ "${#value}" -ne 48 ]; then
    echo "[dev.sh] NEW_API_INTERNAL_TOKEN in $file must contain exactly 48 characters after an optional sk- prefix." >&2
    return 1
  fi
}

append_missing_docker_env_values() {
  local file="$1"
  local required_keys=(
    POSTGRES_PASSWORD
    JWT_SECRET
    INTERNAL_WORKER_TOKEN
    AGENTS_BRIDGE_TOKEN
    NEW_API_INTERNAL_TOKEN
    NEW_API_SESSION_SECRET
    NEW_API_CRYPTO_SECRET
    NEW_API_USD_EXCHANGE_RATE
  )
  local added_keys=()
  local key=""
  local current_value=""
  local generated_value=""

  umask 077
  for key in "${required_keys[@]}"; do
    current_value="$(read_env_value "$file" "$key" || true)"
    if [ -n "$current_value" ]; then
      continue
    fi
    case "$key" in
      POSTGRES_PASSWORD) generated_value="$(generate_hex_secret 24)" ;;
      JWT_SECRET|INTERNAL_WORKER_TOKEN|AGENTS_BRIDGE_TOKEN|NEW_API_SESSION_SECRET|NEW_API_CRYPTO_SECRET)
        generated_value="$(generate_hex_secret 32)"
        ;;
      NEW_API_INTERNAL_TOKEN) generated_value="sk-$(generate_hex_secret 24)" ;;
      NEW_API_USD_EXCHANGE_RATE) generated_value="7.3" ;;
      *)
        echo "[dev.sh] No generator is defined for required key $key." >&2
        return 1
        ;;
    esac
    if [ "${#added_keys[@]}" -eq 0 ]; then
      printf '\n%s\n' '# Added by ./scripts/dev.sh docker; existing values above remain unchanged.' >> "$file"
    fi
    printf '%s=%s\n' "$key" "$generated_value" >> "$file"
    added_keys+=("$key")
  done
  chmod 600 "$file"
  if [ "${#added_keys[@]}" -gt 0 ]; then
    echo "[dev.sh] Added missing Docker settings without printing their values:"
    printf '  - %s\n' "${added_keys[@]}"
  fi
}

ensure_docker_env() {
  local file="$1"
  if [ ! -f "$file" ]; then
    create_docker_env "$file"
  else
    echo "[dev.sh] Preserving existing values in $file; provider credentials were not changed."
    append_missing_docker_env_values "$file"
  fi
  validate_docker_env "$file"
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

build_docker_images() {
  local env_file="$1"
  local fresh="$2"
  local build_args=()
  local service=""
  local build_services=(new-api agents-bridge api web media-worker)

  if [ "$fresh" = "1" ]; then
    build_args+=(--pull --no-cache)
  fi

  # A cold Vite, Bun, Node, and Go build can exceed an 8 GiB Docker VM when
  # Compose schedules all images concurrently. Build one image at a time.
  for service in "${build_services[@]}"; do
    echo "[dev.sh] Building $service image..."
    compose --env-file "$env_file" build "${build_args[@]}" "$service"
  done
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
    build=1
    fresh_build=0
    init_only=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --build) build=1 ;;
        --no-build) build=0 ;;
        --fresh-build) build=1; fresh_build=1 ;;
        --init-only) init_only=1 ;;
        *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
      esac
      shift
    done

    docker_env_file="${TAPCANVAS_ENV_FILE:-apps/hono-api/.env}"
    ensure_docker_env "$docker_env_file"
    if [ "$init_only" = "1" ]; then
      echo "[dev.sh] Docker configuration is ready."
      exit 0
    fi

    compose_args=(--env-file "$docker_env_file")
    if [ "$build" = "1" ]; then
      build_docker_images "$docker_env_file" "$fresh_build"
    fi
    if [ "$fresh_build" = "1" ]; then
      compose "${compose_args[@]}" up -d --no-build --force-recreate
    else
      args=(up -d --no-build)
      compose "${compose_args[@]}" "${args[@]}"
    fi
    echo "Web: http://localhost:5175"
    echo "API: http://localhost:8788"
    echo "Lluban API: http://localhost:4455"
    echo "Generated local credentials stay in $docker_env_file and are never printed."
    ;;
  docker-down)
    docker_env_file="${TAPCANVAS_ENV_FILE:-apps/hono-api/.env}"
    if [ ! -f "$docker_env_file" ]; then
      echo "[dev.sh] No $docker_env_file exists; there is no initialized local stack to stop."
      exit 0
    fi
    compose --env-file "$docker_env_file" down
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac
