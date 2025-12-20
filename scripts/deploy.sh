#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
TapCanvas deploy helper (Cloudflare Wrangler).

Usage:
  ./scripts/deploy.sh [--web] [--api] [--ai-backend] [--all]

Defaults:
  --all (deploy web + hono-api + ai-fullstack backend)

Notes:
  - Uses per-project wrangler config:
    - web: root `wrangler.toml`/`wrangler.jsonc` (repo root)
    - api: `apps/hono-api/wrangler.jsonc`
    - ai backend: `apps/ai-fullstack/backend/wrangler.jsonc`
  - If Wrangler has permission issues writing to user config dirs, this sets XDG_CONFIG_HOME to a local `.xdg/`.
EOF
}

want_web=0
want_api=0
want_ai_backend=0

if [ $# -eq 0 ]; then
  want_web=1
  want_api=1
  want_ai_backend=1
else
  while [ $# -gt 0 ]; do
    case "$1" in
      -h|--help|help)
        usage
        exit 0
        ;;
      --all)
        want_web=1
        want_api=1
        want_ai_backend=1
        ;;
      --web)
        want_web=1
        ;;
      --api)
        want_api=1
        ;;
      --ai-backend|--langgraph)
        want_ai_backend=1
        ;;
      *)
        echo "Unknown arg: $1" >&2
        usage
        exit 1
        ;;
    esac
    shift
  done
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

deploy_web() {
  echo "[deploy] web (root wrangler config)"
  (
    cd "$repo_root"
    pnpm --filter @tapcanvas/web build
    XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$PWD/.xdg}" npx wrangler deploy --config wrangler.toml
  )
}

deploy_api() {
  echo "[deploy] hono-api (apps/hono-api/wrangler.jsonc)"
  (
    cd "$repo_root/apps/hono-api"
    XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$PWD/.xdg}" npx wrangler deploy --config wrangler.jsonc
  )
}

deploy_ai_backend() {
  echo "[deploy] ai-fullstack backend (apps/ai-fullstack/backend/wrangler.jsonc)"
  (
    cd "$repo_root/apps/ai-fullstack/backend"
    XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$PWD/.xdg}" npx wrangler deploy --config wrangler.jsonc
  )
}

if [ "$want_web" = "1" ]; then deploy_web; fi
if [ "$want_api" = "1" ]; then deploy_api; fi
if [ "$want_ai_backend" = "1" ]; then deploy_ai_backend; fi
