﻿# TapCanvas 一键部署（Windows 10/11，兼容 Windows PowerShell 5.1 与 PowerShell 7）。
# macOS / Linux 请使用 deploy.sh。
#
# 单独下载即可运行（PowerShell 或 cmd 中执行）：
#   powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; iwr -useb https://raw.githubusercontent.com/anymouschina/TapCanvas/main/deploy.ps1 -OutFile deploy.ps1; .\deploy.ps1"
#
# 脚本会：安装 WSL2 与 Docker Desktop → 获取项目源码 → 生成私有配置与默认账号 →
# 拉取预构建镜像（失败时本地构建）→ 启动全部服务 → 打印访问地址与账号。
param(
  [Parameter(Position = 0)][string]$Command = 'install',
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)][string[]]$Rest = @()
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

function Get-EnvOr([string]$Name, [string]$Default) {
  $v = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrEmpty($v)) { return $Default } else { return $v }
}

$RepoUrl = Get-EnvOr 'TAPCANVAS_REPO_URL' 'https://github.com/anymouschina/TapCanvas.git'
$Branch = Get-EnvOr 'TAPCANVAS_BRANCH' 'main'
$ArchiveUrl = Get-EnvOr 'TAPCANVAS_ZIP_URL' "https://codeload.github.com/anymouschina/TapCanvas/zip/refs/heads/$Branch"
$ImageNamespace = Get-EnvOr 'TAPCANVAS_IMAGE_NAMESPACE' 'beqlee'
$ImageTag = Get-EnvOr 'TAPCANVAS_IMAGE_TAG' 'latest'
# pull: 优先拉取预构建镜像，失败的服务自动改为本地构建；build: 全部从源码构建。
$DeployMode = Get-EnvOr 'TAPCANVAS_DEPLOY_MODE' 'pull'
$WaitTimeout = [int](Get-EnvOr 'TAPCANVAS_WAIT_TIMEOUT' '1800')

$AppServices = [ordered]@{
  'new-api'       = 'NEW_API_IMAGE'
  'agents-bridge' = 'TAPCANVAS_AGENTS_BRIDGE_IMAGE'
  'api'           = 'TAPCANVAS_API_IMAGE'
  'web'           = 'TAPCANVAS_WEB_IMAGE'
  'media-worker'  = 'TAPCANVAS_MEDIA_WORKER_IMAGE'
}

function Write-Info([string]$m) { Write-Host "[TapCanvas] $m" -ForegroundColor Cyan }
function Write-Ok([string]$m) { Write-Host "[TapCanvas] $m" -ForegroundColor Green }
function Write-Warn2([string]$m) { Write-Host "[TapCanvas] 注意: $m" -ForegroundColor Yellow }
function Fail([string]$m) {
  Write-Host "[TapCanvas] 错误: $m" -ForegroundColor Red
  exit 1
}

function Show-Usage {
  @"
TapCanvas 一键部署

用法: .\deploy.ps1 [命令]      （或双击 / 运行 deploy.cmd）

命令:
  install   安装并启动（默认）。缺少 WSL2 / Docker Desktop 时自动安装
  update    更新源码与镜像后重启
  start     启动服务
  stop      停止服务（保留数据）
  restart   重启服务
  status    查看服务状态
  logs [服务] 查看日志，例如: .\deploy.ps1 logs api
  info      显示访问地址与默认账号
  help      显示帮助

常用环境变量:
  TAPCANVAS_DIR             单独下载脚本运行时的安装目录（默认 .\TapCanvas）
  TAPCANVAS_DEPLOY_MODE     pull（默认，拉取预构建镜像）或 build（本地构建）
  TAPCANVAS_ADMIN_PASSWORD  首次部署时的 TapCanvas 管理员密码（默认随机生成）
  NEW_API_ROOT_PASSWORD     首次部署时的鲁班 API 管理员密码（默认随机生成）
  DOCKERHUB_REGISTRY        Docker Hub 镜像代理（网络受限时使用）
  TAPCANVAS_NO_OPEN=1       部署完成后不自动打开浏览器
"@ | Write-Host
}

function Test-Cmd([string]$Name) { return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# Windows PowerShell 5.1 在 Stop 模式下会把原生命令的 stderr 当作异常，这里统一隔离。
function Invoke-Quiet([string]$Exe, [string[]]$Arguments) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  $global:LASTEXITCODE = 1
  try { & $Exe @Arguments *> $null } catch { $global:LASTEXITCODE = 1 }
  $code = $global:LASTEXITCODE
  $ErrorActionPreference = $prev
  return $code
}

function Invoke-Capture([string]$Exe, [string[]]$Arguments) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  $out = $null
  try { $out = & $Exe @Arguments 2> $null } catch {}
  $ErrorActionPreference = $prev
  if ($null -eq $out) { return '' }
  return (($out | Out-String).Trim())
}

# 前台执行原生命令并显示其输出，只返回退出码（stdout 不能混入函数返回值）。
function Invoke-Native([string]$Exe, [string[]]$Arguments) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $global:LASTEXITCODE = 0
  try { & $Exe @Arguments | Out-Host } catch { Write-Host $_ -ForegroundColor Red; $global:LASTEXITCODE = 1 }
  $code = $global:LASTEXITCODE
  $ErrorActionPreference = $prev
  return $code
}

# ---------------------------------------------------------------- 源码
function Test-ProjectDir([string]$Dir) {
  if ([string]::IsNullOrEmpty($Dir)) { return $false }
  return (Test-Path (Join-Path $Dir 'docker-compose.yml')) -and (Test-Path (Join-Path $Dir 'apps\hono-api')) -and (Test-Path (Join-Path $Dir 'deploy.ps1'))
}

function Test-GitUsable { return (Test-Cmd 'git') -and ((Invoke-Quiet 'git' @('--version')) -eq 0) }

function Get-Source([string]$Dir) {
  if ((Test-Path (Join-Path $Dir '.git')) -and (Test-GitUsable)) {
    Write-Info "更新源码: $Dir"
    if ((Invoke-Native 'git' @('-C', $Dir, 'pull', '--ff-only')) -ne 0) {
      Write-Warn2 '源码更新失败（可能有本地修改），继续使用当前版本'
    }
    return
  }
  if ((Test-Path $Dir) -and -not (Test-ProjectDir $Dir) -and (Get-ChildItem -Force $Dir | Select-Object -First 1)) {
    Fail "目录 $Dir 已存在且不是 TapCanvas 项目，请设置 TAPCANVAS_DIR 指定其他目录"
  }
  if (-not (Test-ProjectDir $Dir) -and (Test-GitUsable)) {
    Write-Info "克隆源码到 $Dir ..."
    # 保持 LF 换行，容器内的 shell 脚本才能执行；开启长路径支持。
    $code = Invoke-Native 'git' @('-c', 'core.autocrlf=false', '-c', 'core.longpaths=true', 'clone', '--depth', '1', '--branch', $Branch, $RepoUrl, $Dir)
    if ($code -eq 0) {
      Invoke-Quiet 'git' @('-C', $Dir, 'config', 'core.autocrlf', 'false') | Out-Null
      Invoke-Quiet 'git' @('-C', $Dir, 'config', 'core.longpaths', 'true') | Out-Null
      return
    }
    Write-Warn2 'git clone 失败，改为下载源码压缩包'
  }
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("tapcanvas-src-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'src.zip'
  Write-Info '下载源码压缩包 ...'
  Invoke-WebRequest -UseBasicParsing -Uri $ArchiveUrl -OutFile $zip
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $extract = Join-Path $tmp 'x'
  [IO.Compression.ZipFile]::ExtractToDirectory($zip, $extract)
  $root = Get-ChildItem -Directory $extract | Select-Object -First 1
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  # 覆盖复制：保留 .env 等本地文件，不删除任何已有数据。
  Copy-Item -Path (Join-Path $root.FullName '*') -Destination $Dir -Recurse -Force
  Remove-Item -Recurse -Force $tmp
}

# ---------------------------------------------------------------- Docker
$script:ComposeFlavor = ''

function Add-DockerPath {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Docker\Docker\resources\bin')
  )
  foreach ($p in $candidates) {
    if ((Test-Path (Join-Path $p 'docker.exe')) -and -not (($env:Path -split ';') -contains $p)) {
      $env:Path = "$p;$env:Path"
    }
  }
}

function Get-DockerDesktopExe {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Docker\Docker\Docker Desktop.exe')
  )
  foreach ($p in $candidates) { if (Test-Path $p) { return $p } }
  return $null
}

function Test-DockerReady { return (Test-Cmd 'docker') -and ((Invoke-Quiet 'docker' @('info')) -eq 0) }

function Install-Wsl {
  if ((Invoke-Quiet 'wsl.exe' @('--status')) -eq 0) { return $false }
  Write-Warn2 '未检测到 WSL2，开始安装（会弹出管理员授权窗口）'
  $cmd = 'wsl.exe --install --no-distribution || (dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart & dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart)'
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmd -Verb RunAs -Wait
  return $true
}

function Install-DockerDesktop {
  if (Test-Cmd 'winget') {
    Write-Info '通过 winget 安装 Docker Desktop（会弹出管理员授权窗口）...'
    $code = Invoke-Native 'winget' @('install', '-e', '--id', 'Docker.DockerDesktop', '--accept-package-agreements', '--accept-source-agreements')
    if ($code -eq 0 -or (Get-DockerDesktopExe)) { return }
    Write-Warn2 "winget 安装失败（退出码 ${code}），改为下载官方安装包"
  }
  $arch = 'amd64'
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
  $installer = Join-Path ([IO.Path]::GetTempPath()) 'DockerDesktopInstaller.exe'
  Write-Info "下载 Docker Desktop 安装包（${arch}，约 600MB）..."
  Invoke-WebRequest -UseBasicParsing -Uri "https://desktop.docker.com/win/main/$arch/Docker%20Desktop%20Installer.exe" -OutFile $installer
  Write-Info '安装 Docker Desktop（会弹出管理员授权窗口）...'
  $p = Start-Process -FilePath $installer -ArgumentList 'install', '--quiet', '--accept-license', '--backend=wsl-2' -Verb RunAs -Wait -PassThru
  if ($p.ExitCode -ne 0) { Fail "Docker Desktop 安装失败（退出码 $($p.ExitCode)）" }
  Remove-Item -Force $installer -ErrorAction SilentlyContinue
}

function Register-ResumeAfterReboot {
  # 重启后自动继续部署（仅当前用户、仅一次）。
  $exe = (Get-Process -Id $PID).Path
  $value = "`"$exe`" -NoProfile -ExecutionPolicy Bypass -NoExit -File `"$PSCommandPath`" install"
  New-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' -Force | Out-Null
  Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' -Name 'TapCanvasDeploy' -Value $value
}

function Initialize-Docker {
  Add-DockerPath
  $needReboot = $false
  if (-not (Test-Cmd 'docker') -and -not (Get-DockerDesktopExe)) {
    Write-Warn2 '未检测到 Docker，开始自动安装'
    if (Install-Wsl) { $needReboot = $true }
    Install-DockerDesktop
    Add-DockerPath
    if ($needReboot) {
      Register-ResumeAfterReboot
      Write-Host ''
      Write-Ok 'WSL2 与 Docker Desktop 已安装，需要重启电脑后生效。'
      Write-Ok '重启并登录后会自动继续部署；也可以重启后手动重新运行本脚本。'
      exit 0
    }
  }
  if (-not (Test-DockerReady)) {
    $desktop = Get-DockerDesktopExe
    if ($desktop) {
      Write-Info '启动 Docker Desktop ...'
      Start-Process -FilePath $desktop
    }
    Write-Info '等待 Docker 就绪；首次启动 Docker Desktop 时请在弹出的窗口中同意服务条款。'
    $waited = 0
    while (-not (Test-DockerReady)) {
      if ($waited -ge 300) {
        Fail 'Docker 未能在 5 分钟内就绪。请确认 BIOS 已开启虚拟化、Docker Desktop 能正常打开，然后重新运行本脚本。'
      }
      Start-Sleep -Seconds 5
      $waited += 5
      Add-DockerPath
    }
  }
  if ((Invoke-Quiet 'docker' @('compose', 'version')) -eq 0) {
    $script:ComposeFlavor = 'plugin'
  } elseif ((Test-Cmd 'docker-compose') -and ((Invoke-Quiet 'docker-compose' @('version')) -eq 0)) {
    $script:ComposeFlavor = 'standalone'
  } else {
    Fail '未找到 Docker Compose，请升级 Docker Desktop 后重试'
  }
  $ver = Invoke-Capture 'docker' @('version', '--format', '{{.Server.Version}}')
  Write-Ok "Docker 已就绪（${ver}）"
}

function Invoke-Compose([string[]]$Arguments) {
  if ($script:ComposeFlavor -eq 'plugin') {
    return (Invoke-Native 'docker' (@('compose', '--env-file', $script:EnvFile) + $Arguments))
  }
  return (Invoke-Native 'docker-compose' (@('--env-file', $script:EnvFile) + $Arguments))
}

function Test-Resources {
  $mem = Invoke-Capture 'docker' @('info', '--format', '{{.MemTotal}}')
  $memBytes = 0L
  if ([long]::TryParse($mem, [ref]$memBytes) -and $memBytes -gt 0 -and $memBytes -lt 7000000000) {
    Write-Warn2 ("Docker 可用内存约 {0}GB，建议 8GB 以上（WSL2 可在 %UserProfile%\.wslconfig 设置 memory=8GB）" -f [math]::Floor($memBytes / 1GB))
  }
  try {
    $drive = (Get-Item $script:ProjectDir).PSDrive
    if ($drive.Free -and $drive.Free -lt 20GB) {
      Write-Warn2 ("{0}: 盘剩余空间约 {1}GB，首次部署建议预留 20GB 以上" -f $drive.Name, [math]::Floor($drive.Free / 1GB))
    }
  } catch {}
}

# ---------------------------------------------------------------- 配置
$Utf8NoBom = New-Object Text.UTF8Encoding($false)
$script:EnvHeaderWritten = $false

function Read-EnvValue([string]$Key) {
  if (-not (Test-Path $script:EnvFileFull)) { return '' }
  $value = ''
  foreach ($line in [IO.File]::ReadAllLines($script:EnvFileFull)) {
    if ($line -match ('^\s*' + [regex]::Escape($Key) + '\s*=(.*)$')) { $value = $Matches[1].TrimEnd("`r") }
  }
  if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  return $value
}

function Get-EnvValueOr([string]$Key, [string]$Default) {
  $v = Read-EnvValue $Key
  if ([string]::IsNullOrEmpty($v)) { return $Default } else { return $v }
}

function New-HexSecret([int]$Bytes) {
  $buf = New-Object byte[] $Bytes
  $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
  $rng.GetBytes($buf)
  $rng.Dispose()
  return (($buf | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Add-EnvIfMissing([string]$Key, [string]$Value) {
  # 只追加缺失的键，从不改写已有值；统一使用 LF 与无 BOM 的 UTF-8。
  if (-not [string]::IsNullOrEmpty((Read-EnvValue $Key))) { return }
  $text = ''
  if (-not $script:EnvHeaderWritten) {
    $text += "`n# Added by deploy.ps1 on $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'); existing values above remain unchanged.`n"
    $script:EnvHeaderWritten = $true
  }
  $text += "$Key=$Value`n"
  [IO.File]::AppendAllText($script:EnvFileFull, $text, $Utf8NoBom)
}

function Test-PortInUse([int]$Port) {
  $client = New-Object Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    if ($task.Wait(500)) { return $client.Connected }
    return $false
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Test-StackRunning {
  $flavorArgs = @('compose', '--env-file', $script:EnvFile, 'ps', '-q')
  $exe = 'docker'
  if ($script:ComposeFlavor -eq 'standalone') { $exe = 'docker-compose'; $flavorArgs = @('--env-file', $script:EnvFile, 'ps', '-q') }
  return -not [string]::IsNullOrEmpty((Invoke-Capture $exe $flavorArgs))
}

function Select-Ports {
  # 只在服务未运行时检查；被其他程序占用且未显式配置的端口自动顺延。
  if (Test-StackRunning) { return }
  $ports = [ordered]@{
    'WEB_DEV_HOST_PORT' = 5175; 'API_HOST_PORT' = 8788; 'NEW_API_PORT' = 4455
    'POSTGRES_PORT' = 5432; 'AGENTS_BRIDGE_HOST_PORT' = 8799; 'REDIS_HOST_PORT' = 6379
  }
  foreach ($key in $ports.Keys) {
    $current = Read-EnvValue $key
    if (-not [string]::IsNullOrEmpty($current)) {
      if (Test-PortInUse ([int]$current)) { Write-Warn2 "端口 ${current}（${key}）已被占用，启动可能失败；可在 $($script:EnvFile) 中修改" }
      continue
    }
    $port = [int]$ports[$key]
    while (Test-PortInUse $port) { $port++ }
    if ($port -ne [int]$ports[$key]) {
      Write-Warn2 "端口 $($ports[$key]) 已被占用，$key 改用 $port"
      Add-EnvIfMissing $key "$port"
    }
  }
}

function Initialize-Env {
  if (-not (Test-Path $script:EnvFileFull)) {
    Write-Info "生成私有配置 $($script:EnvFile)（含随机密钥与默认管理员账号）"
    $header = "# Generated once by deploy.ps1. Keep this file private.`n" +
      "# Existing files are never overwritten, so manually added provider keys are preserved.`n" +
      "POSTGRES_DB=tapcanvas`nPOSTGRES_USER=tapcanvas`n"
    [IO.File]::WriteAllText($script:EnvFileFull, $header, $Utf8NoBom)
    $script:EnvHeaderWritten = $true
  } else {
    Write-Info "保留已有配置 $($script:EnvFile)，只补充缺失项"
  }
  Add-EnvIfMissing 'POSTGRES_PASSWORD' (New-HexSecret 24)
  Add-EnvIfMissing 'JWT_SECRET' (New-HexSecret 32)
  Add-EnvIfMissing 'INTERNAL_WORKER_TOKEN' (New-HexSecret 32)
  Add-EnvIfMissing 'AGENTS_BRIDGE_TOKEN' (New-HexSecret 32)
  Add-EnvIfMissing 'NEW_API_INTERNAL_TOKEN' ('sk-' + (New-HexSecret 24))
  Add-EnvIfMissing 'NEW_API_SESSION_SECRET' (New-HexSecret 32)
  Add-EnvIfMissing 'NEW_API_CRYPTO_SECRET' (New-HexSecret 32)
  Add-EnvIfMissing 'NEW_API_USD_EXCHANGE_RATE' '7.3'
  Add-EnvIfMissing 'TAP_CREDITS_PER_CNY' '100'
  Add-EnvIfMissing 'TAPCANVAS_ADMIN_USERNAME' (Get-EnvOr 'TAPCANVAS_ADMIN_USERNAME' 'admin')
  Add-EnvIfMissing 'TAPCANVAS_ADMIN_PASSWORD' (Get-EnvOr 'TAPCANVAS_ADMIN_PASSWORD' ('Tc' + (New-HexSecret 6)))
  Add-EnvIfMissing 'NEW_API_ROOT_USERNAME' (Get-EnvOr 'NEW_API_ROOT_USERNAME' 'admin')
  Add-EnvIfMissing 'NEW_API_ROOT_PASSWORD' (Get-EnvOr 'NEW_API_ROOT_PASSWORD' ('Tc' + (New-HexSecret 6)))
  foreach ($svc in $AppServices.Keys) {
    Add-EnvIfMissing $AppServices[$svc] "docker.io/$ImageNamespace/tapcanvas-${svc}:$ImageTag"
  }
  # 透传用户给出的镜像代理等可选项，之后的启动保持一致。
  foreach ($k in @('DOCKERHUB_REGISTRY', 'NPM_REGISTRY', 'APT_MIRROR', 'APK_MIRROR')) {
    $v = [Environment]::GetEnvironmentVariable($k)
    if (-not [string]::IsNullOrEmpty($v)) { Add-EnvIfMissing $k $v }
  }
  $token = (Read-EnvValue 'NEW_API_INTERNAL_TOKEN')
  if ($token.StartsWith('sk-')) { $token = $token.Substring(3) }
  if ($token.Length -ne 48) { Fail "$($script:EnvFile) 中 NEW_API_INTERNAL_TOKEN 去掉 sk- 前缀后必须是 48 个字符" }
  if ((Read-EnvValue 'TAPCANVAS_ADMIN_PASSWORD').Length -lt 6) { Fail 'TAPCANVAS_ADMIN_PASSWORD 至少需要 6 个字符' }
}

# ---------------------------------------------------------------- 镜像
function Test-ImageExists([string]$Image) { return (Invoke-Quiet 'docker' @('image', 'inspect', $Image)) -eq 0 }

function Build-Service([string]$Service) {
  Write-Info "本地构建 $Service 镜像（首次可能需要 10~30 分钟）..."
  if ((Invoke-Compose @('build', $Service)) -ne 0) { Fail "$Service 镜像构建失败" }
}

function Initialize-Images([bool]$Refresh) {
  foreach ($svc in $AppServices.Keys) {
    $image = Get-EnvValueOr $AppServices[$svc] "tapcanvas/${svc}:local"
    if (-not $Refresh -and (Test-ImageExists $image)) { continue }
    if ($DeployMode -eq 'build' -or $image.EndsWith(':local')) { Build-Service $svc; continue }
    Write-Info "拉取镜像 $image ..."
    if ((Invoke-Native 'docker' @('pull', $image)) -eq 0) { continue }
    if ($Refresh -and (Test-ImageExists $image)) {
      Write-Warn2 "拉取 $image 失败，继续使用本地已有版本"
      continue
    }
    Write-Warn2 "拉取 $image 失败（网络受限可设置 DOCKERHUB_REGISTRY 或 Docker Desktop 镜像加速），改为本地构建"
    Build-Service $svc
  }
}

# ---------------------------------------------------------------- 启动
function Start-Stack {
  Write-Info '启动服务（首次启动会在容器内安装依赖并初始化数据库，可能需要 5~15 分钟）...'
  if ((Invoke-Compose @('up', '-d', '--no-build')) -ne 0) {
    Write-Warn2 '部分服务启动失败，最近的 API 日志：'
    Invoke-Compose @('logs', '--tail', '60', 'api') | Out-Null
    Fail "启动失败。可运行 '.\deploy.ps1 logs api' 查看完整日志，修复后重新运行 '.\deploy.ps1'"
  }
}

function Wait-Web {
  $url = "http://localhost:$(Get-EnvValueOr 'WEB_DEV_HOST_PORT' '5175')/"
  Write-Info "等待 Web 就绪 $url ..."
  $waited = 0
  while ($waited -lt $WaitTimeout) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) { return $true }
    } catch {}
    Start-Sleep -Seconds 5
    $waited += 5
    if ($waited % 60 -eq 0) { Write-Info "仍在启动中（已等待 $($waited / 60) 分钟），可另开窗口运行 '.\deploy.ps1 logs' 查看进度" }
  }
  Write-Warn2 "等待超时，服务可能仍在初始化。可运行 '.\deploy.ps1 status' 查看状态"
  return $false
}

function Show-Info {
  $web = Get-EnvValueOr 'WEB_DEV_HOST_PORT' '5175'
  $api = Get-EnvValueOr 'API_HOST_PORT' '8788'
  $newApi = Get-EnvValueOr 'NEW_API_PORT' '4455'
  Write-Host ''
  Write-Host '================ TapCanvas 已部署 ================' -ForegroundColor Green
  Write-Host "  Web 画布       http://localhost:$web"
  Write-Host "    账号 $(Get-EnvValueOr 'TAPCANVAS_ADMIN_USERNAME' 'admin')   密码 $(Get-EnvValueOr 'TAPCANVAS_ADMIN_PASSWORD' '123456')"
  Write-Host "  鲁班 API 管理台 http://localhost:$newApi"
  Write-Host "    账号 $(Get-EnvValueOr 'NEW_API_ROOT_USERNAME' 'admin')   密码 $(Get-EnvValueOr 'NEW_API_ROOT_PASSWORD' '123456')"
  Write-Host "  API            http://localhost:$api"
  Write-Host ''
  Write-Host '  下一步：登录鲁班 API 管理台，在「渠道」中填写模型供应商的 API Key 并启用。'
  Write-Host '  账号只在首次初始化数据库时创建；之后若在页面中改过密码，以修改后的为准。'
  Write-Host "  配置文件：$($script:EnvFileFull)（请勿提交或分享）"
  Write-Host '  常用命令：.\deploy.ps1 status | logs | stop | update | info'
  Write-Host '==================================================' -ForegroundColor Green
}

# ---------------------------------------------------------------- 入口
$Command = $Command.ToLowerInvariant()
if (@('-h', '--help', 'help', '/?') -contains $Command) { Show-Usage; exit 0 }
if (-not (@('install', 'update', 'start', 'stop', 'restart', 'status', 'logs', 'info') -contains $Command)) {
  Show-Usage
  Fail "未知命令: $Command"
}

$hostExe = (Get-Process -Id $PID).Path

# 单独下载运行：先获取源码，再交给源码中同版本的 deploy.ps1 继续执行。
if (-not (Test-ProjectDir $PSScriptRoot)) {
  if ($env:TAPCANVAS_DEPLOY_BOOTSTRAPPED -eq '1') { Fail '源码中缺少 deploy.ps1，无法继续' }
  $target = Get-EnvOr 'TAPCANVAS_DIR' (Join-Path (Get-Location).Path 'TapCanvas')
  if (-not (Test-ProjectDir $target) -or $Command -eq 'update') { Get-Source $target }
  if (-not (Test-ProjectDir $target)) { Fail "源码获取失败：$target" }
  $env:TAPCANVAS_DEPLOY_BOOTSTRAPPED = '1'
  $env:TAPCANVAS_DEPLOY_SOURCE_UPDATED = '1'
  Write-Info "项目目录: $target"
  & $hostExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $target 'deploy.ps1') $Command @Rest
  exit $LASTEXITCODE
}

$script:ProjectDir = $PSScriptRoot
Set-Location $script:ProjectDir
$script:EnvFile = Get-EnvOr 'TAPCANVAS_ENV_FILE' './apps/hono-api/.env'
# compose 把不以 . 或 / 开头的卷来源当作命名卷，相对路径必须带 ./ 前缀。
if (-not [IO.Path]::IsPathRooted($script:EnvFile) -and -not $script:EnvFile.StartsWith('.')) {
  $script:EnvFile = './' + $script:EnvFile
}
if ([IO.Path]::IsPathRooted($script:EnvFile)) { $script:EnvFileFull = $script:EnvFile }
else { $script:EnvFileFull = Join-Path $script:ProjectDir $script:EnvFile }
$env:TAPCANVAS_ENV_FILE = $script:EnvFile

if ($Command -eq 'update' -and $env:TAPCANVAS_DEPLOY_SOURCE_UPDATED -ne '1') {
  Get-Source $script:ProjectDir
  $env:TAPCANVAS_DEPLOY_SOURCE_UPDATED = '1'
  & $hostExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $script:ProjectDir 'deploy.ps1') update @Rest
  exit $LASTEXITCODE
}

if ($Command -eq 'info') {
  if (-not (Test-Path $script:EnvFileFull)) { Fail '尚未部署，请先运行 .\deploy.ps1' }
  Show-Info
  exit 0
}

Initialize-Docker

switch ($Command) {
  { @('install', 'start', 'update') -contains $_ } {
    Initialize-Env
    Select-Ports
    Test-Resources
    Initialize-Images ($Command -eq 'update')
    Start-Stack
    if (Wait-Web) {
      Show-Info
      if ($Command -eq 'install' -and $env:TAPCANVAS_NO_OPEN -ne '1') {
        Start-Process "http://localhost:$(Get-EnvValueOr 'WEB_DEV_HOST_PORT' '5175')"
      }
    }
  }
  'stop' {
    if (-not (Test-Path $script:EnvFileFull)) { Write-Info '尚未部署，无需停止'; exit 0 }
    if ((Invoke-Compose @('down')) -eq 0) { Write-Ok '已停止（数据卷已保留）' }
  }
  'restart' { if ((Invoke-Compose @('restart')) -eq 0) { Write-Ok '已重启' } }
  'status' { Invoke-Compose @('ps') | Out-Null }
  'logs' {
    if ($Rest.Count -gt 0) { Invoke-Compose (@('logs', '-f', '--tail', '200') + $Rest) | Out-Null }
    else { Invoke-Compose @('logs', '-f', '--tail', '100') | Out-Null }
  }
}
exit 0
