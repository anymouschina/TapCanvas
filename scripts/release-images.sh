#!/usr/bin/env bash
# Build and push the prebuilt multi-arch images that ./deploy.sh pulls.
#
# Images are built from `git archive <ref>` (tracked files only), so untracked
# local state such as .env, secrets/, cert/ or project-data never reaches a
# public registry, even if a .dockerignore misses it.
#
# Usage:
#   docker login
#   ./scripts/release-images.sh [service...]
#
# Env:
#   TAPCANVAS_IMAGE_NAMESPACE  registry namespace (default: beqlee)
#   TAPCANVAS_RELEASE_REF      git ref to build (default: HEAD)
#   TAPCANVAS_RELEASE_WORKTREE=1  build uncommitted changes to tracked files
#                              (tags get a -dirty suffix; untracked files stay out)
#   TAPCANVAS_PLATFORMS        buildx platforms (default: linux/amd64,linux/arm64)
#   TAPCANVAS_EXTRA_TAG        extra tag besides latest and the short commit
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
namespace="${TAPCANVAS_IMAGE_NAMESPACE:-beqlee}"
ref="${TAPCANVAS_RELEASE_REF:-HEAD}"
platforms="${TAPCANVAS_PLATFORMS:-linux/amd64,linux/arm64}"
builder="${TAPCANVAS_BUILDX_BUILDER:-tapcanvas-release}"
all_services=(new-api agents-bridge api web media-worker)

log() { printf '[release] %s\n' "$*"; }

sha="$(git -C "$repo_root" rev-parse --short=12 "$ref")"
revision="$(git -C "$repo_root" rev-parse "$ref")"
if [ "${TAPCANVAS_RELEASE_WORKTREE:-0}" = "1" ]; then
  # `git stash create` snapshots tracked changes as a dangling commit without
  # touching the working tree, index or stash list.
  snapshot="$(git -C "$repo_root" stash create || true)"
  if [ -n "$snapshot" ]; then
    ref="$snapshot"
    sha="${sha}-dirty"
  fi
fi
src="$(mktemp -d "${TMPDIR:-/tmp}/tapcanvas-release-${sha}.XXXXXX")"
trap 'rm -rf "$src"' EXIT
git -C "$repo_root" archive --format=tar "$ref" | tar -x -C "$src"
log "exported $ref ($sha) to $src"

if ! docker buildx inspect "$builder" >/dev/null 2>&1; then
  docker buildx create --name "$builder" --driver docker-container >/dev/null
fi
docker buildx inspect "$builder" --bootstrap >/dev/null

# Build args mirror the defaults in docker-compose.yml so pulled images behave
# exactly like locally built ones.
no_proxy_args=(
  --build-arg HTTP_PROXY= --build-arg HTTPS_PROXY= --build-arg NO_PROXY=
  --build-arg http_proxy= --build-arg https_proxy= --build-arg no_proxy=
)

build_one() {
  local service="$1"
  local context="" dockerfile="" args=()
  case "$service" in
    new-api)
      context="apps/new-api"; dockerfile="apps/new-api/Dockerfile"
      args=(
        --build-arg DOCKERHUB_REGISTRY=docker.io
        --build-arg BUN_IMAGE=docker.io/oven/bun:1.3.11
        --build-arg NODE_IMAGE=docker.io/library/node:22.19.0-bookworm-slim
        --build-arg GO_IMAGE=docker.m.daocloud.io/library/golang:1.26.1-alpine
        --build-arg RUNTIME_IMAGE=docker.m.daocloud.io/library/debian:bookworm-slim
        --build-arg NPM_REGISTRY=https://registry.npmmirror.com
        --build-arg GO_PROXY=https://goproxy.cn,direct
        --build-arg APT_MIRROR=mirrors.aliyun.com
        --build-arg ALL_PROXY= --build-arg all_proxy=
      )
      ;;
    agents-bridge)
      context="apps/hono-api"; dockerfile="apps/hono-api/Dockerfile.agents-bridge"
      args=(
        --build-arg DOCKERHUB_REGISTRY=docker.io
        --build-arg NPM_REGISTRY=https://registry.npmmirror.com
      )
      ;;
    api)
      context="apps/hono-api"; dockerfile="apps/hono-api/Dockerfile"
      args=(
        --build-arg DOCKERHUB_REGISTRY=docker.io
        --build-arg NPM_REGISTRY=https://registry.npmmirror.com
        --build-arg APT_MIRROR=mirrors.aliyun.com
        --build-arg PREINSTALL_APP_DEPS=0
        --build-arg SKIP_HYPERFRAMES=1
      )
      ;;
    web)
      context="."; dockerfile="apps/web/Dockerfile"
      args=(
        --build-arg DOCKERHUB_REGISTRY=docker.io
        --build-arg NPM_REGISTRY=https://registry.npmmirror.com
        --build-arg VITE_API_BASE=/api
      )
      ;;
    media-worker)
      context="apps/media-worker"; dockerfile="apps/media-worker/Dockerfile"
      args=(
        --build-arg DOCKERHUB_REGISTRY=docker.io
        --build-arg GO_IMAGE=docker.m.daocloud.io/library/golang:1.24.4-alpine
        --build-arg RUNTIME_IMAGE=docker.m.daocloud.io/library/alpine:3.20
        --build-arg GO_PROXY=https://goproxy.cn,direct
        --build-arg APK_MIRROR=mirrors.aliyun.com
      )
      ;;
    *) echo "[release] unknown service: $service" >&2; return 1 ;;
  esac

  local image="docker.io/${namespace}/tapcanvas-${service}"
  local tags=(-t "${image}:latest" -t "${image}:${sha}")
  if [ -n "${TAPCANVAS_EXTRA_TAG:-}" ]; then
    tags+=(-t "${image}:${TAPCANVAS_EXTRA_TAG}")
  fi

  log "building $image ($platforms)"
  # One image at a time: concurrent cold Vite/Bun/Go builds exhaust an 8 GiB VM.
  docker buildx build \
    --builder "$builder" \
    --platform "$platforms" \
    --provenance=false \
    -f "$src/$dockerfile" \
    "${args[@]}" "${no_proxy_args[@]}" \
    "${tags[@]}" \
    --label "org.opencontainers.image.source=https://github.com/anymouschina/TapCanvas" \
    --label "org.opencontainers.image.revision=${revision}" \
    --push \
    "$src/$context"
  log "pushed ${image}:latest and ${image}:${sha}"
}

services=("$@")
if [ "${#services[@]}" -eq 0 ]; then
  services=("${all_services[@]}")
fi
for service in "${services[@]}"; do
  build_one "$service"
done
log "done: ${services[*]}"
