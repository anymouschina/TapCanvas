# TapCanvas 主前端镜像：nginx serve 宿主预构建的 SPA dist + 同源反代 /api、/public 到 api 容器。
#
# 为什么不在镜像内 build：vite build 这类重型前端在 colima(8G/无swap)+QEMU amd64 模拟下会 OOM
#   (跟 new-api web 同病)。dist 由 deploy.sh 在【宿主机原生】pnpm build 预构建（web 产物平台无关），
#   本镜像只做 nginx + COPY 静态资源——纯 COPY、零 RUN 执行，不碰 QEMU。
# nginx:alpine 是多架构 manifest，buildx 按 target(amd64) 直接拉对应架构层，无需模拟。
#
# 构建（context=apps/web，见 deploy.sh build_one）：
#   docker buildx build --platform linux/amd64 -f apps/web/Dockerfile -t <registry>/tapcanvas/web:<tag> --push apps/web
ARG DOCKERHUB_REGISTRY=docker.io
FROM ${DOCKERHUB_REGISTRY}/nginx:1.27-alpine

COPY nginx.conf /etc/nginx/nginx.conf
COPY dist /usr/share/nginx/html

EXPOSE 80
