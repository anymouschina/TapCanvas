#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
TapCanvas deploy helper.

Usage:
  ./scripts/deploy.sh [--web] [--all] [--api]

Defaults:
  --web (deploy web to Cloudflare)

Notes:
  - Uses root wrangler config for web: `wrangler.toml`/`wrangler.jsonc` (repo root)
  - API has migrated to NestJS (Node.js); Wrangler deploy is no longer applicable.
  - If Wrangler has permission issues writing to user config dirs, this sets XDG_CONFIG_HOME to a local `.xdg/`.
EOF
}

want_web=0
want_api=0

if [ $# -eq 0 ]; then
  want_web=1
else
  while [ $# -gt 0 ]; do
    case "$1" in
      -h|--help|help)
        usage
        exit 0
        ;;
      --all)
        want_web=1
        ;;
      --web)
        want_web=1
        ;;
      --api)
        want_api=1
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
  echo "[deploy] api"
  echo "[deploy] API 已迁移到 NestJS(Node.js)，请使用 Docker/你的部署平台部署 apps/hono-api。" >&2
  return 1
}

if [ "$want_web" = "1" ]; then deploy_web; fi
if [ "$want_api" = "1" ]; then deploy_api; fi
