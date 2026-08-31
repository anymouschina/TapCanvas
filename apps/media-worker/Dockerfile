# media-worker：Go gRPC 媒体处理服务（ffmpeg/ffprobe + TOS 直连）。
# protobuf 产物(gen/)已提交进仓库，构建无需 protoc/buf。
ARG DOCKERHUB_REGISTRY=docker.io
ARG GO_IMAGE=docker.m.daocloud.io/library/golang:1.24.4-alpine
ARG RUNTIME_IMAGE=docker.m.daocloud.io/library/alpine:3.20

FROM ${GO_IMAGE} AS build
ARG GO_PROXY=https://goproxy.cn,direct
WORKDIR /src
COPY go.mod go.sum ./
RUN GOPROXY=${GO_PROXY} go mod download
COPY . .
RUN CGO_ENABLED=0 GOPROXY=${GO_PROXY} go build -trimpath -ldflags="-s -w" -o /out/media-worker ./cmd/media-worker

FROM ${RUNTIME_IMAGE}
ARG APK_MIRROR=mirrors.aliyun.com
RUN sed -i "s/dl-cdn.alpinelinux.org/${APK_MIRROR}/g" /etc/apk/repositories \
    && apk add --no-cache ffmpeg ca-certificates tzdata
COPY --from=build /out/media-worker /usr/local/bin/media-worker
EXPOSE 9090
ENTRYPOINT ["media-worker"]
