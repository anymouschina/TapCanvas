ARG DOCKERHUB_REGISTRY=docker.io
ARG BUN_IMAGE=${DOCKERHUB_REGISTRY}/oven/bun:1@sha256:0733e50325078969732ebe3b15ce4c4be5082f18c4ac1a0f0ca4839c2e4e42a7
ARG GO_IMAGE=${DOCKERHUB_REGISTRY}/golang:1.26.1-alpine@sha256:2389ebfa5b7f43eeafbd6be0c3700cc46690ef842ad962f6c5bd6be49ed82039
ARG RUNTIME_IMAGE=${DOCKERHUB_REGISTRY}/debian:bookworm-slim@sha256:f06537653ac770703bc45b4b113475bd402f451e85223f0f2837acbf89ab020a
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG GO_PROXY=https://goproxy.cn,direct
ARG APT_MIRROR=deb.debian.org
ARG SKIP_WEB_BUILD=0
ARG HTTP_PROXY=
ARG HTTPS_PROXY=
ARG NO_PROXY=
ARG ALL_PROXY=
ARG http_proxy=
ARG https_proxy=
ARG no_proxy=
ARG all_proxy=

# --platform=$BUILDPLATFORM：在宿主原生架构(arm64 Mac)实例化，不进 QEMU。
# web 产物平台无关（且 SKIP_WEB_BUILD=1 时只校验宿主预构建的 dist），无需 target 架构。
FROM --platform=$BUILDPLATFORM ${BUN_IMAGE} AS builder

ARG NPM_REGISTRY
ARG SKIP_WEB_BUILD
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
COPY ./web .
COPY ./VERSION .
# SKIP_WEB_BUILD=1（默认部署路径）：用宿主机原生预构建的 web/dist（COPY ./web 已带入）。
#   web 前端产物平台无关，宿主机(arm64 Mac)原生 bun run build 又快又有充足内存，避开 QEMU
#   amd64 模拟下 vite build 的 OOM(ResourceExhausted)。产物随后 go:embed 进二进制，镜像自包含。
# SKIP_WEB_BUILD=0：镜像内 bun install + vite build（仅在原生 amd64 构建机上可行；QEMU 模拟会 OOM）。
# 注意：RUN 续行内禁止插 # 注释（拼成单行后会把后续命令一并注释掉）。
RUN if [ "${SKIP_WEB_BUILD}" = "1" ]; then \
      test -f /build/dist/index.html || { echo "SKIP_WEB_BUILD=1 需要预构建好的 web/dist：请先在宿主机 cd apps/new-api/web && bun install && bun run build" >&2; exit 1; }; \
      echo "[build] 使用宿主预构建的 web/dist，跳过镜像内 vite build"; \
    else \
      test -f bun.lock || { echo "web/bun.lock is required when SKIP_WEB_BUILD!=1" >&2; exit 1; } && \
      NPM_CONFIG_REGISTRY="${NPM_REGISTRY}" bun install --frozen-lockfile && \
      DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$(cat VERSION) bun run build; \
    fi

# --platform=$BUILDPLATFORM：go 编译器跑在宿主原生架构(arm64)，靠 GOARCH=$TARGETARCH 交叉编译出
# 目标 amd64 二进制（CGO_ENABLED=0 纯 Go）。避开 QEMU 模拟 amd64 跑 go build 的 SIGSEGV(modindex.dirHash)。
FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS builder2

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

ADD go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod,sharing=locked \
    --mount=type=cache,target=/root/.cache/go-build,sharing=locked \
    go mod download

COPY . .
COPY --from=builder /build/dist ./web/dist
RUN --mount=type=cache,target=/go/pkg/mod,sharing=locked \
    --mount=type=cache,target=/root/.cache/go-build,sharing=locked \
    go build -ldflags "-s -w -X 'github.com/QuantumNous/new-api/common.Version=$(cat VERSION)'" -o new-api

FROM ${RUNTIME_IMAGE}

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
    && update-ca-certificates

COPY --from=builder2 /build/new-api /
EXPOSE 4455
WORKDIR /data
ENTRYPOINT ["/new-api"]
