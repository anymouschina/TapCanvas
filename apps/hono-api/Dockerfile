# syntax=docker.m.daocloud.io/docker/dockerfile:1.7

ARG DOCKERHUB_REGISTRY=docker.io
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG APT_MIRROR=mirrors.aliyun.com
FROM ${DOCKERHUB_REGISTRY}/node:22-bookworm-slim

ARG PREINSTALL_APP_DEPS=0
# 注意：FROM 之前声明的 ARG 在 stage 内不可见（APT_MIRROR 等全靠 shell 的 :- 兜底生效），所以这里在 FROM 后声明
ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/

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
  && apt-get install -y --no-install-recommends sqlite3 postgresql-client-16 python3 python3-pip python3-pil fonts-noto-cjk ffmpeg libgl1-mesa-glx chromium \
  && rm -rf /var/lib/apt/lists/* \
  # PySceneDetect: 视频镜头切分（detect-content / list-scenes），供 decompose 镜头分解复用。
  # 依赖 ffmpeg(已装) 抽帧 + opencv(libgl1-mesa-glx 提供运行时 libGL)。
  # yt-dlp: 把 web_search 找到的视频播放页(B站/YouTube/官方站等)抓取最佳画质视频流，
  #   依赖 ffmpeg(已装) merge 音视频，落成 mp4 转存 TOS，供 decompose_video 拆解复刻。
  # pip 必须走国内镜像：opencv 单包 ~73MB，默认 PyPI 国际线路只有几十 kB/s（实测拖垮整次构建 40min+）
  && pip install --no-cache-dir --break-system-packages -i "${PIP_INDEX_URL:-https://mirrors.aliyun.com/pypi/simple/}" 'scenedetect[opencv]' yt-dlp

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

# hyperframes 渲染栈（剪辑师包装层工具 tapcanvas_hyperframes_render 用）：
# - CLI/producer 预装到 /opt/hyperframes，运行时禁 npx 现拉（容器出网受限）
# - 浏览器用 apt 的 chromium（Chrome for Testing 无 linux-arm64 构建，puppeteer 下载必败，
#   故 PUPPETEER_SKIP_DOWNLOAD=1 + PRODUCER_HEADLESS_SHELL_PATH 指向系统 chromium）
# - CJK 字体走上面已装的 fonts-noto-cjk
ENV PUPPETEER_SKIP_DOWNLOAD="1"
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="1"
ENV PRODUCER_HEADLESS_SHELL_PATH="/usr/bin/chromium"
ENV HYPERFRAMES_BROWSER_PATH="/usr/bin/chromium"
ENV HYPERFRAMES_CLI_ENTRY="/opt/hyperframes/node_modules/hyperframes/dist/cli.js"
# 非阻塞安装：hyperframes 的传递依赖 onnxruntime-node 会下载原生二进制，国内线上服务器
# 常因 GitHub/CDN 302 重定向而失败。该工具(tapcanvas_hyperframes_render)是可降级的——
# hyperframes-render.ts 在 cli.js 缺失时会优雅报 "not installed"，不影响主视频管线/出图/出片。
# 因此安装失败时不中断构建，而是清掉残留 node_modules，让运行时 existsSync(cliEntry) 干净返回
# false（避免装一半在运行时崩）。要恢复完整能力，修好该服务器出网后重建即可。
#
# SKIP_HYPERFRAMES=1 显式跳过本层（本地开发用）：onnxruntime-node 拉原生二进制常耗数分钟，
# 而本地迭代主视频管线/校验器根本不碰 tapcanvas_hyperframes_render。跳过后与"安装失败"落到
# 完全相同的终态（/opt/hyperframes 无 node_modules → 运行时干净报 not installed），
# 因此无需运行时改动。默认空值＝线上行为逐字不变，不传 arg 就照原样装。
# ARG 刻意紧贴本层：改它只失效这一层，前面 apt/pnpm 等重层缓存全部保留。
ARG SKIP_HYPERFRAMES=""
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
  mkdir -p /opt/hyperframes \
  && cd /opt/hyperframes \
  && printf '{"name":"hyperframes-runtime","private":true}\n' > package.json \
  && if [ "${SKIP_HYPERFRAMES}" = "1" ]; then \
       echo "[build] SKIP_HYPERFRAMES=1：跳过 hyperframes 安装，运行时将报 not installed（主管线不受影响）"; \
     else \
  ( /usr/bin/env -i PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
       HOME=/root \
       npm_config_registry="${NPM_REGISTRY}" \
       npm_config_proxy="" \
       npm_config_https_proxy="" \
       PUPPETEER_SKIP_DOWNLOAD=1 PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 \
       npm install --no-audit --no-fund hyperframes@0.6.88 @hyperframes/producer@0.6.88 \
     && test -f /opt/hyperframes/node_modules/hyperframes/dist/cli.js ) \
     || ( echo "[build] WARN: hyperframes 可选安装失败(多为 onnxruntime-node 下载受阻)，移除残留，运行时将报 not installed" \
          && rm -rf /opt/hyperframes/node_modules ); \
     fi

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
COPY marketplace-skills ./marketplace-skills
COPY src ./src

EXPOSE 8788

CMD ["sh", "-lc", "pnpm dev"]
