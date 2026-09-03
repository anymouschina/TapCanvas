ARG DOCKERHUB_REGISTRY=docker.io
ARG BUN_IMAGE=${DOCKERHUB_REGISTRY}/oven/bun:1@sha256:0733e50325078969732ebe3b15ce4c4be5082f18c4ac1a0f0ca4839c2e4e42a7
ARG NODE_IMAGE=${DOCKERHUB_REGISTRY}/library/node:22.19.0-bookworm-slim
ARG GO_IMAGE=${DOCKERHUB_REGISTRY}/golang:1.26.1-alpine@sha256:2389ebfa5b7f43eeafbd6be0c3700cc46690ef842ad962f6c5bd6be49ed82039
ARG RUNTIME_IMAGE=${DOCKERHUB_REGISTRY}/debian:bookworm-slim@sha256:f06537653ac770703bc45b4b113475bd402f451e85223f0f2837acbf89ab020a
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG GO_PROXY=https://goproxy.cn,direct
ARG APT_MIRROR=deb.debian.org
ARG HTTP_PROXY=
ARG HTTPS_PROXY=
ARG NO_PROXY=
ARG ALL_PROXY=
ARG http_proxy=
ARG https_proxy=
ARG no_proxy=
ARG all_proxy=

# Pull and prepare the runtime/toolchain bases before the memory-intensive Vite
# build. This keeps BuildKit from decompressing Go/runtime layers concurrently
# with the dashboard build on a typical 8 GiB Docker Desktop VM.
FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS go-base
RUN touch /image-ready

FROM --platform=$BUILDPLATFORM ${BUN_IMAGE} AS bun-base

FROM ${RUNTIME_IMAGE} AS runtime-base

ARG APT_MIRROR
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ARG ALL_PROXY
ARG http_proxy
ARG https_proxy
ARG no_proxy
ARG all_proxy
ENV HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    NO_PROXY=${NO_PROXY} \
    ALL_PROXY=${ALL_PROXY} \
    http_proxy=${http_proxy} \
    https_proxy=${https_proxy} \
    no_proxy=${no_proxy} \
    all_proxy=${all_proxy}

RUN sed -i "s|http://deb.debian.org|http://${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata libasan8 wget \
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates \
    && touch /image-ready

# The dashboard is platform-independent and is always built from the checked-in
# source plus bun.lock. Bun installs the exact lock; Node runs Vite with an
# explicit heap ceiling so the builder cannot consume the whole Docker VM.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS web-builder

ARG NPM_REGISTRY
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ARG ALL_PROXY
ARG http_proxy
ARG https_proxy
ARG no_proxy
ARG all_proxy
ENV HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    NO_PROXY=${NO_PROXY} \
    ALL_PROXY=${ALL_PROXY} \
    http_proxy=${http_proxy} \
    https_proxy=${https_proxy} \
    no_proxy=${no_proxy} \
    all_proxy=${all_proxy}

WORKDIR /build
COPY --from=bun-base /usr/local/bin/bun /usr/local/bin/bun
COPY --from=go-base /image-ready /tmp/go-image-ready
COPY --from=runtime-base /image-ready /tmp/runtime-image-ready
COPY ./web .
COPY ./VERSION .
RUN test -f bun.lock || { echo "web/bun.lock is required" >&2; exit 1; }
RUN NPM_CONFIG_REGISTRY="${NPM_REGISTRY}" bun install --frozen-lockfile
RUN DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$(cat VERSION) \
    node --max-old-space-size=3072 node_modules/vite/bin/vite.js build \
    && touch /web-build-ready

# --platform=$BUILDPLATFORM：go 编译器跑在宿主原生架构(arm64)，靠 GOARCH=$TARGETARCH 交叉编译出
# 目标 amd64 二进制（CGO_ENABLED=0 纯 Go）。避开 QEMU 模拟 amd64 跑 go build 的 SIGSEGV(modindex.dirHash)。
FROM go-base AS builder2

ARG GO_PROXY
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ARG ALL_PROXY
ARG http_proxy
ARG https_proxy
ARG no_proxy
ARG all_proxy
ENV GO111MODULE=on CGO_ENABLED=0
ENV GOPROXY=${GO_PROXY} \
    HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    NO_PROXY=${NO_PROXY} \
    ALL_PROXY=${ALL_PROXY} \
    http_proxy=${http_proxy} \
    https_proxy=${https_proxy} \
    no_proxy=${no_proxy} \
    all_proxy=${all_proxy}
ENV GOMODCACHE=/go/pkg/mod \
    GOCACHE=/root/.cache/go-build

ARG TARGETOS
ARG TARGETARCH
ENV GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64}
ENV GOEXPERIMENT=greenteagc

WORKDIR /build

# Establish the dependency before Go module download/build begins so BuildKit
# does not overlap those memory-heavy stages with Vite.
COPY --from=web-builder /web-build-ready /tmp/web-build-ready

ADD go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod,sharing=locked \
    --mount=type=cache,target=/root/.cache/go-build,sharing=locked \
    go mod download

COPY . .
COPY --from=web-builder /build/dist ./web/dist
RUN --mount=type=cache,target=/go/pkg/mod,sharing=locked \
    --mount=type=cache,target=/root/.cache/go-build,sharing=locked \
    go build -ldflags "-s -w -X 'github.com/QuantumNous/new-api/common.Version=$(cat VERSION)'" -o new-api

FROM runtime-base

COPY --from=builder2 /build/new-api /
EXPOSE 4455
WORKDIR /data
ENTRYPOINT ["/new-api"]
