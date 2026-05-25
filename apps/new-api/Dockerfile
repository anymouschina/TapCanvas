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

FROM ${BUN_IMAGE} AS builder

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
RUN if [ "${SKIP_WEB_BUILD}" = "1" ]; then \
      mkdir -p /build/dist && \
      printf '%s\n' '<!doctype html><html><head><meta charset="utf-8"><title>new-api</title></head><body><div id="root"></div></body></html>' > /build/dist/index.html; \
    else \
      test -f bun.lock || { echo "web/bun.lock is required when SKIP_WEB_BUILD!=1" >&2; exit 1; } && \
      DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$(cat VERSION) bun run build; \
    fi

FROM ${GO_IMAGE} AS builder2

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
