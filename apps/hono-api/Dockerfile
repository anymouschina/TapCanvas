# syntax=docker.1ms.run/docker/dockerfile:1.7

ARG DOCKERHUB_REGISTRY=docker.io
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG APT_MIRROR=mirrors.aliyun.com
FROM ${DOCKERHUB_REGISTRY}/node:22-bookworm-slim

ARG PREINSTALL_APP_DEPS=0

WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  mirror="${APT_MIRROR:-mirrors.aliyun.com}" \
  && printf "deb http://%s/debian bookworm main\n" "$mirror" > /etc/apt/sources.list \
  && printf "deb http://%s/debian bookworm-updates main\n" "$mirror" >> /etc/apt/sources.list \
  && printf "deb http://%s/debian-security bookworm-security main\n" "$mirror" >> /etc/apt/sources.list \
  && rm -f /etc/apt/sources.list.d/debian.sources \
  && apt-get update -o Acquire::Retries=5 -o Acquire::http::Timeout=30 \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && mkdir -p /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update -o Acquire::Retries=5 -o Acquire::http::Timeout=30 \
  && apt-get install -y --no-install-recommends sqlite3 postgresql-client-16 python3 python3-pil fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
ENV COREPACK_NPM_REGISTRY="${NPM_REGISTRY}"
ENV HTTP_PROXY=""
ENV HTTPS_PROXY=""
ENV http_proxy=""
ENV https_proxy=""
ENV NO_PROXY=""
ENV no_proxy=""
ENV npm_config_proxy=""
ENV npm_config_https_proxy=""
ENV npm_config_registry="${NPM_REGISTRY}"
ENV PNPM_CONFIG_REGISTRY="${NPM_REGISTRY}"
ENV PNPM_STORE_DIR="/pnpm/store"

RUN --mount=type=cache,target=/root/.npm,sharing=locked \
  rm -f /root/.npmrc \
  && npm config delete proxy || true \
  && npm config delete https-proxy || true \
  && npm config set proxy "" \
  && npm config set https-proxy "" \
  && npm config set registry "${NPM_REGISTRY}" \
  && /usr/bin/env -i PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
     npm_config_registry="${NPM_REGISTRY}" \
     npm_config_proxy="" \
     npm_config_https_proxy="" \
     npm install -g pnpm@10.8.1

COPY package.json ./
COPY pnpm-lock.yaml ./
COPY prisma ./prisma

RUN --mount=type=cache,target=/pnpm/store,sharing=locked \
    if [ "${PREINSTALL_APP_DEPS}" = "1" ]; then \
      pnpm install --frozen-lockfile --child-concurrency=1 --network-concurrency=1 --registry "${NPM_REGISTRY}"; \
    else \
      mkdir -p /app/node_modules; \
    fi

COPY tsconfig.json ./
COPY schema.sql ./
COPY scripts ./scripts
COPY src ./src

EXPOSE 8788

CMD ["sh", "-lc", "pnpm dev"]
