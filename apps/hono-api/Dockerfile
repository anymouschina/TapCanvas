ARG DOCKERHUB_REGISTRY=docker.1ms.run
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG APT_MIRROR=mirrors.aliyun.com
FROM ${DOCKERHUB_REGISTRY}/library/node:20-bookworm-slim

WORKDIR /app

RUN mirror="${APT_MIRROR:-deb.debian.org}" \
  && printf "deb http://%s/debian bookworm main\n" "$mirror" > /etc/apt/sources.list \
  && printf "deb http://%s/debian bookworm-updates main\n" "$mirror" >> /etc/apt/sources.list \
  && printf "deb http://%s/debian-security bookworm-security main\n" "$mirror" >> /etc/apt/sources.list \
  && rm -f /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends sqlite3 ca-certificates \
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

RUN rm -f /root/.npmrc \
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
COPY tsconfig.json ./
COPY schema.sql ./
COPY wrangler.jsonc ./
COPY src ./src

EXPOSE 8788

CMD ["sh", "-lc", "pnpm dev:docker"]
