#!/bin/sh
set -eu

cd /app

rewrite_localhost_proxy() {
  # Rewrite localhost proxy (inside container) to host.docker.internal for Docker Desktop.
  # Handles values like: http://127.0.0.1:1087, socks5://localhost:1087, etc.
  val="$1"
  echo "$val" | sed -e 's#://127\\.0\\.0\\.1:#://host.docker.internal:#g' -e 's#://localhost:#://host.docker.internal:#g'
}

if [ "${DISABLE_PROXY:-}" = "1" ]; then
  unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy || true
else
  for k in HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy; do
    eval "v=\${$k:-}"
    if [ -n "${v:-}" ]; then
      nv="$(rewrite_localhost_proxy "$v")"
      eval "export $k=\$nv"
    fi
  done
fi

NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
export npm_config_registry="$NPM_REGISTRY"

PNPM_VERSION="${PNPM_VERSION:-10.8.1}"
if ! command -v pnpm >/dev/null 2>&1; then
  npm i -g "pnpm@${PNPM_VERSION}"
else
  cur="$(pnpm -v 2>/dev/null || true)"
  if [ "$cur" != "$PNPM_VERSION" ]; then
    npm i -g "pnpm@${PNPM_VERSION}"
  fi
fi

LOCK_DIR="${PNPM_INSTALL_LOCK_DIR:-/app/.pnpm-store/.pnpm-install-lock}"
WAIT_SECS="${PNPM_INSTALL_LOCK_WAIT_SECS:-120}"

start_ts="$(date +%s)"
while ! mkdir "$LOCK_DIR" 2>/dev/null; do
  now_ts="$(date +%s)"
  if [ $((now_ts - start_ts)) -ge "$WAIT_SECS" ]; then
    echo "Timed out waiting for pnpm install lock at $LOCK_DIR" >&2
    exit 1
  fi
  sleep 1
done

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

PNPM_FILTER_ARGS="${PNPM_FILTER_ARGS:---filter @tapcanvas/web... --filter cloudflare-workers-openapi...}"
# shellcheck disable=SC2086
pnpm install --prefer-offline --frozen-lockfile $PNPM_FILTER_ARGS

cleanup
trap - EXIT INT TERM

exec "$@"
