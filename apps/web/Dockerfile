# syntax=docker.io/docker/dockerfile:1.7

# Build context is the repository root. The Web application imports shared
# protocol sources from packages/ and two deterministic contracts from hono-api,
# so a clean image build must receive those sources explicitly.
ARG DOCKERHUB_REGISTRY=docker.io
ARG NPM_REGISTRY=https://registry.npmjs.org

FROM ${DOCKERHUB_REGISTRY}/node:22.19.0-bookworm-slim AS builder
ARG NPM_REGISTRY
ARG VITE_API_BASE=/api
ARG VITE_OBJECT_STORAGE_PROVIDER=tos
ARG VITE_TOS_PUBLIC_BASE_URL=https://tanvas-ai.tos-cn-guangzhou.volces.com
ARG VITE_R2_PUBLIC_BASE_URL=https://assets.tapcanvas.uk
ARG VITE_GITHUB_CLIENT_ID=
ARG VITE_GITHUB_REDIRECT_URI=

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:${PATH} \
    npm_config_registry=${NPM_REGISTRY} \
    PNPM_CONFIG_REGISTRY=${NPM_REGISTRY} \
    VITE_API_BASE=${VITE_API_BASE} \
    VITE_OBJECT_STORAGE_PROVIDER=${VITE_OBJECT_STORAGE_PROVIDER} \
    VITE_TOS_PUBLIC_BASE_URL=${VITE_TOS_PUBLIC_BASE_URL} \
    VITE_R2_PUBLIC_BASE_URL=${VITE_R2_PUBLIC_BASE_URL} \
    VITE_GITHUB_CLIENT_ID=${VITE_GITHUB_CLIENT_ID} \
    VITE_GITHUB_REDIRECT_URI=${VITE_GITHUB_REDIRECT_URI}

RUN npm install --global pnpm@10.8.1

WORKDIR /workspace/apps/web
COPY apps/web/package.json apps/web/pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --ignore-workspace \
      --child-concurrency=1 --network-concurrency=1 \
      --registry "${NPM_REGISTRY}"

COPY tsconfig.base.json /workspace/tsconfig.base.json
COPY packages /workspace/packages
COPY apps/hono-api/src/modules/flow/flow.anchor-bindings.ts \
     /workspace/apps/hono-api/src/modules/flow/flow.anchor-bindings.ts
COPY apps/hono-api/src/modules/project-directory/project-directory.contract.ts \
     /workspace/apps/hono-api/src/modules/project-directory/project-directory.contract.ts
COPY apps/web /workspace/apps/web

RUN pnpm build

FROM ${DOCKERHUB_REGISTRY}/nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /workspace/apps/web/dist /usr/share/nginx/html

EXPOSE 80
