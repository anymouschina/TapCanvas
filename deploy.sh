#!/usr/bin/env bash
# TapCanvas 一键部署（macOS / Linux）。Windows 请使用 deploy.ps1 / deploy.cmd。
#
# 单独下载即可运行：
#   curl -fsSL https://raw.githubusercontent.com/anymouschina/TapCanvas/main/deploy.sh -o deploy.sh && bash deploy.sh
#
# 脚本会：安装/启动 Docker → 获取项目源码 → 生成私有配置与默认账号 →
# 拉取预构建镜像（失败时本地构建）→ 启动全部服务 → 打印访问地址与账号。
# 兼容 macOS 自带的 bash 3.2。
set -euo pipefail

REPO_URL="${TAPCANVAS_REPO_URL:-https://github.com/anymouschina/TapCanvas.git}"
BRANCH="${TAPCANVAS_BRANCH:-main}"
ARCHIVE_URL="${TAPCANVAS_ARCHIVE_URL:-https://codeload.github.com/anymouschina/TapCanvas/tar.gz/refs/heads/${BRANCH}}"
IMAGE_NAMESPACE="${TAPCANVAS_IMAGE_NAMESPACE:-beqlee}"
IMAGE_TAG="${TAPCANVAS_IMAGE_TAG:-latest}"
# pull: 优先拉取预构建镜像，失败的服务自动改为本地构建；build: 全部从源码构建。
DEPLOY_MODE="${TAPCANVAS_DEPLOY_MODE:-pull}"
WAIT_TIMEOUT="${TAPCANVAS_WAIT_TIMEOUT:-1800}"

# 服务名与 compose 镜像变量一一对应（bash 3.2 没有关联数组）。
APP_SERVICES="new-api agents-bridge api web media-worker"

c_red=""; c_green=""; c_yellow=""; c_blue=""; c_bold=""; c_reset=""
if [ -t 1 ]; then
  c_red=$'\033[31m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_blue=$'\033[36m'; c_bold=$'\033[1m'; c_reset=$'\033[0m'
fi
info() { printf '%s[TapCanvas]%s %s\n' "$c_blue" "$c_reset" "$*"; }
ok() { printf '%s[TapCanvas]%s %s\n' "$c_green" "$c_reset" "$*"; }
warn() { printf '%s[TapCanvas] 注意:%s %s\n' "$c_yellow" "$c_reset" "$*" >&2; }
die() { printf '%s[TapCanvas] 错误:%s %s\n' "$c_red" "$c_reset" "$*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

usage() {
  cat <<EOF
TapCanvas 一键部署

用法: bash deploy.sh [命令]

命令:
  install   安装并启动（默认）。缺少 Docker 时自动安装
  update    更新源码与镜像后重启
  start     启动服务
  stop      停止服务（保留数据）
  restart   重启服务
  status    查看服务状态
  logs [服务] 查看日志，例如: bash deploy.sh logs api
  info      显示访问地址与默认账号
  help      显示帮助

常用环境变量:
  TAPCANVAS_DIR             单独下载脚本运行时的安装目录（默认 ./TapCanvas）
  TAPCANVAS_DEPLOY_MODE     pull（默认，拉取预构建镜像）或 build（本地构建）
  TAPCANVAS_ADMIN_PASSWORD  首次部署时的 TapCanvas 管理员密码（默认随机生成）
  NEW_API_ROOT_PASSWORD     首次部署时的鲁班 API 管理员密码（默认随机生成）
  DOCKERHUB_REGISTRY        Docker Hub 镜像代理（网络受限时使用）
  TAPCANVAS_NO_OPEN=1       部署完成后不自动打开浏览器
EOF
}

OS="$(uname -s)"
ARCH="$(uname -m)"

# ---------------------------------------------------------------- 源码
script_dir=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

is_project_dir() {
  [ -f "$1/docker-compose.yml" ] && [ -d "$1/apps/hono-api" ] && [ -f "$1/deploy.sh" ]
}

download() {
  # download <url> <output>
  if has curl; then
    curl -fL --retry 3 --connect-timeout 20 -o "$2" "$1"
  elif has wget; then
    wget -O "$2" "$1"
  else
    die "需要 curl 或 wget 来下载文件"
  fi
}

git_usable() {
  has git && git --version >/dev/null 2>&1
}

fetch_source() {
  local dir="$1"
  if [ -d "$dir/.git" ] && git_usable; then
    info "更新源码: $dir"
    git -C "$dir" pull --ff-only || warn "源码更新失败（可能有本地修改），继续使用当前版本"
    return 0
  fi
  if is_project_dir "$dir" && [ ! -d "$dir/.git" ]; then
    info "更新源码（压缩包）: $dir"
  elif [ -e "$dir" ] && [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then
    die "目录 $dir 已存在且不是 TapCanvas 项目，请设置 TAPCANVAS_DIR 指定其他目录"
  fi
  mkdir -p "$dir"
  if [ ! -f "$dir/docker-compose.yml" ] && git_usable; then
    info "克隆源码到 $dir ..."
    # 保持 LF 换行，容器内的 shell 脚本才能执行。
    if git -c core.autocrlf=false clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$dir"; then
      return 0
    fi
    warn "git clone 失败，改为下载源码压缩包"
  fi
  local tmp=""
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/tapcanvas-src.XXXXXX")"
  info "下载源码压缩包 ..."
  download "$ARCHIVE_URL" "$tmp/src.tar.gz"
  # 覆盖解压：保留 .env 等本地文件，不删除任何已有数据。
  tar -xzf "$tmp/src.tar.gz" -C "$dir" --strip-components=1
  rm -rf "$tmp"
}

# ---------------------------------------------------------------- Docker
DOCKER_SUDO=0
dk() {
  if [ "$DOCKER_SUDO" = "1" ]; then sudo docker "$@"; else docker "$@"; fi
}

COMPOSE_FLAVOR=""
detect_compose() {
  if dk compose version >/dev/null 2>&1; then
    COMPOSE_FLAVOR="plugin"
  elif has docker-compose && docker-compose version >/dev/null 2>&1; then
    COMPOSE_FLAVOR="standalone"
  else
    COMPOSE_FLAVOR=""
  fi
}

dc() {
  if [ "$COMPOSE_FLAVOR" = "plugin" ]; then
    dk compose --env-file "$ENV_FILE" "$@"
  elif [ "$DOCKER_SUDO" = "1" ]; then
    sudo docker-compose --env-file "$ENV_FILE" "$@"
  else
    docker-compose --env-file "$ENV_FILE" "$@"
  fi
}

add_docker_desktop_path() {
  local p=""
  for p in /Applications/Docker.app/Contents/Resources/bin "$HOME/.docker/bin" /usr/local/bin /opt/homebrew/bin; do
    if [ -x "$p/docker" ]; then
      case ":$PATH:" in *":$p:"*) ;; *) PATH="$p:$PATH" ;; esac
    fi
  done
  export PATH
}

install_docker_macos() {
  if has brew; then
    info "通过 Homebrew 安装 Docker Desktop ..."
    brew install --cask docker-desktop || brew install --cask docker || die "Homebrew 安装 Docker Desktop 失败"
    return 0
  fi
  local arch_dir="amd64"
  [ "$ARCH" = "arm64" ] && arch_dir="arm64"
  local tmp="" mnt=""
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/tapcanvas-docker.XXXXXX")"
  mnt="$tmp/mnt"
  info "下载 Docker Desktop（${arch_dir}，约 500MB）..."
  download "https://desktop.docker.com/mac/main/${arch_dir}/Docker.dmg" "$tmp/Docker.dmg"
  mkdir -p "$mnt"
  hdiutil attach -nobrowse -quiet -mountpoint "$mnt" "$tmp/Docker.dmg"
  info "安装 Docker Desktop 到 /Applications（可能需要输入本机密码）..."
  if [ -w /Applications ]; then
    cp -R "$mnt/Docker.app" /Applications/
  else
    sudo cp -R "$mnt/Docker.app" /Applications/
  fi
  hdiutil detach -quiet "$mnt" || true
  rm -rf "$tmp"
}

install_docker_linux() {
  info "通过官方脚本安装 Docker Engine 与 Compose 插件 ..."
  local tmp=""
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/tapcanvas-docker.XXXXXX")"
  download "https://get.docker.com" "$tmp/get-docker.sh"
  local mirror_args=""
  # 国内网络可设置 TAPCANVAS_DOCKER_INSTALL_MIRROR=Aliyun
  if [ -n "${TAPCANVAS_DOCKER_INSTALL_MIRROR:-}" ]; then
    mirror_args="--mirror ${TAPCANVAS_DOCKER_INSTALL_MIRROR}"
  fi
  if [ "$(id -u)" = "0" ]; then
    sh "$tmp/get-docker.sh" $mirror_args
  else
    sudo sh "$tmp/get-docker.sh" $mirror_args
  fi
  rm -rf "$tmp"
}

start_docker_daemon() {
  case "$OS" in
    Darwin)
      if [ -d /Applications/Docker.app ]; then
        info "启动 Docker Desktop ..."
        open -a Docker
      elif has colima; then
        info "启动 colima ..."
        colima start --cpu 4 --memory 8 || colima start
      elif [ -d /Applications/OrbStack.app ]; then
        info "启动 OrbStack ..."
        open -a OrbStack
      fi
      ;;
    Linux)
      if has systemctl; then
        if [ "$(id -u)" = "0" ]; then systemctl enable --now docker; else sudo systemctl enable --now docker; fi
      elif has service; then
        if [ "$(id -u)" = "0" ]; then service docker start; else sudo service docker start; fi
      fi
      ;;
  esac
}

wait_for_docker() {
  local waited=0
  while [ "$waited" -lt 300 ]; do
    add_docker_desktop_path
    if has docker && docker info >/dev/null 2>&1; then
      DOCKER_SUDO=0
      return 0
    fi
    # 当前用户不在 docker 组时改用 sudo（只在首次询问一次密码）。
    if [ "$OS" = "Linux" ] && [ "$(id -u)" != "0" ] && has sudo && sudo docker info >/dev/null 2>&1; then
      DOCKER_SUDO=1
      return 0
    fi
    if [ "$waited" -eq 0 ] && [ "$OS" = "Darwin" ]; then
      info "等待 Docker 就绪；首次启动 Docker Desktop 时请在弹出的窗口中同意服务条款并授权。"
    fi
    sleep 5
    waited=$((waited + 5))
  done
  return 1
}

ensure_docker() {
  add_docker_desktop_path
  if ! has docker; then
    warn "未检测到 Docker，开始自动安装"
    case "$OS" in
      Darwin) install_docker_macos ;;
      Linux) install_docker_linux ;;
      *) die "不支持的系统 ${OS}；Windows 请运行 deploy.cmd 或 deploy.ps1" ;;
    esac
    add_docker_desktop_path
  fi
  if ! docker info >/dev/null 2>&1; then
    start_docker_daemon
    wait_for_docker || die "Docker 未能在 5 分钟内就绪。请手动启动 Docker 后重新运行本脚本。"
  fi
  detect_compose
  if [ -z "$COMPOSE_FLAVOR" ]; then
    if [ "$OS" = "Linux" ]; then
      info "安装 Docker Compose 插件 ..."
      if has apt-get; then sudo apt-get update && sudo apt-get install -y docker-compose-plugin
      elif has dnf; then sudo dnf install -y docker-compose-plugin
      elif has yum; then sudo yum install -y docker-compose-plugin
      fi
      detect_compose
    elif [ "$OS" = "Darwin" ] && has brew; then
      brew install docker-compose || true
      detect_compose
    fi
  fi
  [ -n "$COMPOSE_FLAVOR" ] || die "未找到 Docker Compose（docker compose 或 docker-compose），请安装后重试"
  ok "Docker 已就绪（$(dk version --format '{{.Server.Version}}' 2>/dev/null || echo unknown)）"
}

check_resources() {
  local mem=""
  mem="$(dk info --format '{{.MemTotal}}' 2>/dev/null || echo 0)"
  if [ -n "$mem" ] && [ "$mem" -gt 0 ] 2>/dev/null && [ "$mem" -lt 7000000000 ]; then
    warn "Docker 可用内存约 $((mem / 1024 / 1024 / 1024))GB，建议 8GB 以上（Docker Desktop: Settings → Resources；colima: colima start --memory 8）"
  fi
  local free_kb=""
  free_kb="$(df -Pk "$PROJECT_DIR" 2>/dev/null | awk 'NR==2{print $4}')"
  if [ -n "$free_kb" ] && [ "$free_kb" -lt 20971520 ] 2>/dev/null; then
    warn "磁盘剩余空间约 $((free_kb / 1024 / 1024))GB，首次部署建议预留 20GB 以上"
  fi
}

# ---------------------------------------------------------------- 配置
read_env_value() {
  local file="$1" key="$2" line="" value=""
  [ -f "$file" ] || return 1
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$file" | tail -n 1 || true)"
  [ -n "$line" ] || return 1
  value="${line#*=}"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then value="${value:1:${#value}-2}"; fi
  if [[ "$value" == \'*\' && "$value" == *\' ]]; then value="${value:1:${#value}-2}"; fi
  printf '%s' "$value"
}

random_hex() {
  if has openssl; then
    openssl rand -hex "$1"
  else
    od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'
  fi
}

ENV_HEADER_WRITTEN=0
set_env_if_missing() {
  # set_env_if_missing <key> <value>: 只追加缺失的键，从不改写已有值。
  local key="$1" value="$2" current=""
  current="$(read_env_value "$ENV_FILE" "$key" || true)"
  [ -n "$current" ] && return 0
  if [ "$ENV_HEADER_WRITTEN" = "0" ]; then
    printf '\n# Added by ./deploy.sh on %s; existing values above remain unchanged.\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$ENV_FILE"
    ENV_HEADER_WRITTEN=1
  fi
  printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
}

image_var_for() {
  case "$1" in
    new-api) echo NEW_API_IMAGE ;;
    agents-bridge) echo TAPCANVAS_AGENTS_BRIDGE_IMAGE ;;
    api) echo TAPCANVAS_API_IMAGE ;;
    web) echo TAPCANVAS_WEB_IMAGE ;;
    media-worker) echo TAPCANVAS_MEDIA_WORKER_IMAGE ;;
  esac
}

port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
}

stack_running() {
  [ -n "$(dc ps -q 2>/dev/null || true)" ]
}

choose_ports() {
  # 只在服务未运行时检查；被其他程序占用且未显式配置的端口自动顺延。
  stack_running && return 0
  local pair="" key="" def="" current="" port=""
  for pair in WEB_DEV_HOST_PORT:5175 API_HOST_PORT:8788 NEW_API_PORT:4455 POSTGRES_PORT:5432 AGENTS_BRIDGE_HOST_PORT:8799 REDIS_HOST_PORT:6379; do
    key="${pair%%:*}"; def="${pair##*:}"
    current="$(read_env_value "$ENV_FILE" "$key" || true)"
    if [ -n "$current" ]; then
      port_in_use "$current" && warn "端口 ${current}（${key}）已被占用，启动可能失败；可在 $ENV_FILE 中修改"
      continue
    fi
    port="$def"
    while port_in_use "$port"; do port=$((port + 1)); done
    if [ "$port" != "$def" ]; then
      warn "端口 $def 已被占用，$key 改用 $port"
      set_env_if_missing "$key" "$port"
    fi
  done
}

ensure_env() {
  umask 077
  if [ ! -f "$ENV_FILE" ]; then
    info "生成私有配置 ${ENV_FILE}（含随机密钥与默认管理员账号）"
    {
      printf '%s\n' '# Generated once by ./deploy.sh. Keep this file private.'
      printf '%s\n' '# Existing files are never overwritten, so manually added provider keys are preserved.'
      printf 'POSTGRES_DB=tapcanvas\n'
      printf 'POSTGRES_USER=tapcanvas\n'
    } > "$ENV_FILE"
    ENV_HEADER_WRITTEN=1
  else
    info "保留已有配置 ${ENV_FILE}，只补充缺失项"
  fi
  set_env_if_missing POSTGRES_PASSWORD "$(random_hex 24)"
  set_env_if_missing JWT_SECRET "$(random_hex 32)"
  set_env_if_missing INTERNAL_WORKER_TOKEN "$(random_hex 32)"
  set_env_if_missing AGENTS_BRIDGE_TOKEN "$(random_hex 32)"
  set_env_if_missing NEW_API_INTERNAL_TOKEN "sk-$(random_hex 24)"
  set_env_if_missing NEW_API_SESSION_SECRET "$(random_hex 32)"
  set_env_if_missing NEW_API_CRYPTO_SECRET "$(random_hex 32)"
  set_env_if_missing NEW_API_USD_EXCHANGE_RATE "7.3"
  set_env_if_missing TAP_CREDITS_PER_CNY "100"
  set_env_if_missing TAPCANVAS_ADMIN_USERNAME "${TAPCANVAS_ADMIN_USERNAME:-admin}"
  set_env_if_missing TAPCANVAS_ADMIN_PASSWORD "${TAPCANVAS_ADMIN_PASSWORD:-Tc$(random_hex 6)}"
  set_env_if_missing NEW_API_ROOT_USERNAME "${NEW_API_ROOT_USERNAME:-admin}"
  set_env_if_missing NEW_API_ROOT_PASSWORD "${NEW_API_ROOT_PASSWORD:-Tc$(random_hex 6)}"
  local var="" svc="" value=""
  for svc in $APP_SERVICES; do
    var="$(image_var_for "$svc")"
    set_env_if_missing "$var" "docker.io/${IMAGE_NAMESPACE}/tapcanvas-${svc}:${IMAGE_TAG}"
  done
  # 透传用户在命令行里给出的镜像代理等可选项，之后的启动保持一致。
  for var in DOCKERHUB_REGISTRY NPM_REGISTRY APT_MIRROR APK_MIRROR; do
    eval "value=\${$var:-}"
    if [ -n "$value" ]; then set_env_if_missing "$var" "$value"; fi
  done
  chmod 600 "$ENV_FILE"

  local token=""
  token="$(read_env_value "$ENV_FILE" NEW_API_INTERNAL_TOKEN)"
  token="${token#sk-}"
  [ "${#token}" -eq 48 ] || die "$ENV_FILE 中 NEW_API_INTERNAL_TOKEN 去掉 sk- 前缀后必须是 48 个字符"
  local pw=""
  pw="$(read_env_value "$ENV_FILE" TAPCANVAS_ADMIN_PASSWORD)"
  [ "${#pw}" -ge 6 ] || die "TAPCANVAS_ADMIN_PASSWORD 至少需要 6 个字符"
}

# ---------------------------------------------------------------- 镜像
image_exists() { dk image inspect "$1" >/dev/null 2>&1; }

build_service() {
  info "本地构建 $1 镜像（首次可能需要 10~30 分钟）..."
  dc build "$1"
}

ensure_images() {
  # ensure_images <refresh: 0|1>
  local refresh="$1" svc="" var="" image=""
  for svc in $APP_SERVICES; do
    var="$(image_var_for "$svc")"
    image="$(read_env_value "$ENV_FILE" "$var" || true)"
    [ -n "$image" ] || image="tapcanvas/${svc}:local"
    if [ "$refresh" = "0" ] && image_exists "$image"; then
      continue
    fi
    if [ "$DEPLOY_MODE" = "build" ] || [[ "$image" == *:local ]]; then
      build_service "$svc"
      continue
    fi
    info "拉取镜像 $image ..."
    if dk pull "$image"; then
      continue
    fi
    if image_exists "$image" && [ "$refresh" = "1" ]; then
      warn "拉取 $image 失败，继续使用本地已有版本"
      continue
    fi
    warn "拉取 $image 失败（网络受限可设置 DOCKERHUB_REGISTRY 或 Docker 镜像加速），改为本地构建"
    build_service "$svc"
  done
}

# ---------------------------------------------------------------- 启动
env_or_default() {
  local v=""
  v="$(read_env_value "$ENV_FILE" "$1" || true)"
  printf '%s' "${v:-$2}"
}

http_ok() {
  if has curl; then
    curl -fsS -o /dev/null --max-time 5 "$1"
  else
    wget -q -O /dev/null -T 5 "$1"
  fi
}

compose_up() {
  info "启动服务（首次启动会在容器内安装依赖并初始化数据库，可能需要 5~15 分钟）..."
  if ! dc up -d --no-build; then
    warn "部分服务启动失败，最近的 API 日志："
    dc logs --tail 60 api || true
    die "启动失败。可运行 'bash deploy.sh logs api' 查看完整日志，修复后重新运行 'bash deploy.sh'"
  fi
}

wait_for_web() {
  local web_port="" waited=0
  web_port="$(env_or_default WEB_DEV_HOST_PORT 5175)"
  info "等待 Web 就绪 http://localhost:${web_port} ..."
  while [ "$waited" -lt "$WAIT_TIMEOUT" ]; do
    if http_ok "http://localhost:${web_port}/"; then
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
    if [ $((waited % 60)) -eq 0 ]; then info "仍在启动中（已等待 $((waited / 60)) 分钟），可另开终端运行 'bash deploy.sh logs' 查看进度"; fi
  done
  warn "等待超时，服务可能仍在初始化。可运行 'bash deploy.sh status' 查看状态"
  return 1
}

print_info() {
  local web_port="" api_port="" new_api_port=""
  web_port="$(env_or_default WEB_DEV_HOST_PORT 5175)"
  api_port="$(env_or_default API_HOST_PORT 8788)"
  new_api_port="$(env_or_default NEW_API_PORT 4455)"
  cat <<EOF

${c_bold}================ TapCanvas 已部署 ================${c_reset}
  Web 画布       http://localhost:${web_port}
    账号 $(env_or_default TAPCANVAS_ADMIN_USERNAME admin)   密码 $(env_or_default TAPCANVAS_ADMIN_PASSWORD 123456)
  鲁班 API 管理台 http://localhost:${new_api_port}
    账号 $(env_or_default NEW_API_ROOT_USERNAME admin)   密码 $(env_or_default NEW_API_ROOT_PASSWORD 123456)
  API            http://localhost:${api_port}

  已内置并启用鲁班渠道（lluban-recommended），登录 Web 即可使用；需要其他模型时，
  在鲁班 API 管理台「渠道」中添加自己的 Key。
  账号只在首次初始化数据库时创建；之后若在页面中改过密码，以修改后的为准。
  配置文件：${ENV_FILE}（请勿提交或分享）
  常用命令：bash deploy.sh status | logs | stop | update | info
${c_bold}==================================================${c_reset}
EOF
}

open_browser() {
  [ "${TAPCANVAS_NO_OPEN:-0}" = "1" ] && return 0
  [ -t 1 ] || return 0
  local url="http://localhost:$(env_or_default WEB_DEV_HOST_PORT 5175)"
  if [ "$OS" = "Darwin" ]; then open "$url" >/dev/null 2>&1 || true
  elif has xdg-open && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then xdg-open "$url" >/dev/null 2>&1 || true
  fi
}

# ---------------------------------------------------------------- 入口
cmd="${1:-install}"
[ $# -gt 0 ] && shift

case "$cmd" in
  -h|--help|help) usage; exit 0 ;;
  install|update|start|stop|restart|status|logs|info) ;;
  *) usage; die "未知命令: $cmd" ;;
esac

# 单独下载运行：先获取源码，再交给源码中同版本的 deploy.sh 继续执行。
if [ -z "$script_dir" ] || ! is_project_dir "$script_dir"; then
  [ "${TAPCANVAS_DEPLOY_BOOTSTRAPPED:-0}" = "1" ] && die "源码中缺少 deploy.sh，无法继续"
  target="${TAPCANVAS_DIR:-$PWD/TapCanvas}"
  if ! is_project_dir "$target" || [ "$cmd" = "update" ]; then
    fetch_source "$target"
  fi
  is_project_dir "$target" || die "源码获取失败：$target"
  export TAPCANVAS_DEPLOY_BOOTSTRAPPED=1 TAPCANVAS_DEPLOY_SOURCE_UPDATED=1
  info "项目目录: $target"
  exec bash "$target/deploy.sh" "$cmd" "$@"
fi

PROJECT_DIR="$script_dir"
cd "$PROJECT_DIR"
ENV_FILE="${TAPCANVAS_ENV_FILE:-./apps/hono-api/.env}"
# compose 把不以 . 或 / 开头的卷来源当作命名卷，相对路径必须带 ./ 前缀。
case "$ENV_FILE" in
  /*|./*|../*) ;;
  *) ENV_FILE="./$ENV_FILE" ;;
esac
export TAPCANVAS_ENV_FILE="$ENV_FILE"

if [ "$cmd" = "update" ] && [ "${TAPCANVAS_DEPLOY_SOURCE_UPDATED:-0}" != "1" ]; then
  fetch_source "$PROJECT_DIR"
  export TAPCANVAS_DEPLOY_SOURCE_UPDATED=1
  exec bash "$PROJECT_DIR/deploy.sh" update "$@"
fi

if [ "$cmd" = "info" ]; then
  [ -f "$ENV_FILE" ] || die "尚未部署，请先运行 bash deploy.sh"
  print_info
  exit 0
fi

ensure_docker

case "$cmd" in
  install|start|update)
    ensure_env
    choose_ports
    check_resources
    if [ "$cmd" = "update" ]; then ensure_images 1; else ensure_images 0; fi
    compose_up
    if wait_for_web; then
      print_info
      if [ "$cmd" = "install" ]; then open_browser; fi
    fi
    ;;
  stop)
    [ -f "$ENV_FILE" ] || { info "尚未部署，无需停止"; exit 0; }
    dc down
    ok "已停止（数据卷已保留）"
    ;;
  restart)
    dc restart
    ok "已重启"
    ;;
  status)
    dc ps
    ;;
  logs)
    if [ $# -gt 0 ]; then dc logs -f --tail 200 "$@"; else dc logs -f --tail 100; fi
    ;;
esac
