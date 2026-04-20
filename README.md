<p align="center">
  <a href="https://github.com/anymouschina/TapCanvas">
    <img src="https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white" alt="GitHub" />
  </a>
</p>

<p align="center">
  <strong>简体中文</strong> |
  <a href="./README_EN.md">English</a>
</p>

<div align="center">

# TapCanvas Pro

<p align="center">
  <b>
    AI 可视化内容生产工作台
    <br />
    在一张画布里完成文本、图像、视频与分镜的连续生产
    <br />
    Agents 编排 × 多模型接入 × 项目化资产沉淀
  </b>
</p>

<p align="center">
  <a href="https://github.com/anymouschina/TapCanvas/stargazers">
    <img src="https://img.shields.io/github/stars/anymouschina/TapCanvas?style=for-the-badge&logo=github" alt="Stars Badge" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=for-the-badge" alt="Apache-2.0 License Badge" />
  </a>
</p>

> 一套面向长流程 AI 创作的画布式工作台：把项目、上下文、资产、Agents 和多模型执行统一到同一条生产链。

</div>

---

# 🌟 项目简介

TapCanvas Pro 是一个以无限画布为核心的 AI 内容生产平台，聚合文本、图像、视频、分镜和项目素材管理能力，适合把“创意 -> 结构化脚本 -> 参考图 -> 镜头图 -> 视频”串成同一条工作流。

它不是单点模型调用器，而是一个强调项目化、连续性和可追溯执行的工作台：

- ✅ **无限画布工作流**
  用节点和连线组织文档、角色、分镜、图片、视频与执行关系，支持在同一画布内持续迭代。
- ✅ **Agents 驱动的 AI 对话与执行**
  当前统一通过 `POST /public/agents/chat` 进入 Agents Bridge，由 `apps/agents-cli` 负责语义理解、技能选择、取证、规划与执行。
- ✅ **多模型统一接入**
  支持文本、图像、视频等多类模型接入，并在前端画布里以统一节点协议运行。
- ✅ **项目化资产沉淀**
  角色卡、视觉参考、语义资产、章节分镜脚本与运行记录可随项目持续积累，而不是停留在一次性对话里。
- ✅ **章节化创作链路**
  面向小说改编、分镜续写、章节资产补齐等长链路创作场景，支持围绕章节范围做上下文注入与资产承接。
- ✅ **前后端协议收敛**
  前端画布能力、后端 AI tool schema、Agents 运行时能力以统一契约维护，便于继续扩展。

---

# 📦 主要能力

- **画布化内容生产**
  在同一界面中编排文本、参考图、图片生成、视频生成、分镜脚本与项目素材。
- **项目生产运行（Agents Pipeline Runs）**
  支持把项目与章节范围内的素材交给 agents 做结构化生产，并把结果回写到项目素材库。
- **图像到视频链路**
  图片节点可作为视频节点的首帧、尾帧或参考资产，形成连续生成闭环。
- **参考图与资产拖拽复用**
  已生成图片、视频抽帧和项目素材可继续作为下游节点输入。
- **Hono API + NestJS Node Runtime**
  后端运行在 Node.js 服务中，并复用既有 Hono/OpenAPI 路由与 AI 模块。
- **独立 Agents CLI**
  仓库内置 `apps/agents-cli`，提供 `plan -> tool -> report` 的最小 agent loop，并支持 skills、memory、subagent 与 HTTP bridge。

![视频抽帧拖拽生成参考图](./assets/video-to-image.jpg)

---

# 🧩 适用场景

- 小说改编为分镜与视频
- AI 短片 / 漫剧 / 连续镜头生产
- 角色卡、场景图、道具图的项目化沉淀
- 需要 Agents 协作的多步内容生产工作流
- 需要在同一工作台里管理模型、素材、执行记录与结果资产的团队

---

# 🔰 安装与启动

下面这部分按“第一次接触这个项目”的标准来写。

你有两种本地使用方式：

- **方式 A：Docker Compose 启动**
  适合先把项目跑起来，步骤少，接近容器化环境。
- **方式 B：本地源码开发启动**
  适合需要改代码、热更新、调试前后端逻辑的开发者。

如果你只是想先看到项目跑起来，优先走 **方式 A**。
如果你要长期开发这个项目，走 **方式 B**。

## 先理解目录

这个仓库是一个 **monorepo**，也就是前端、后端、agents-cli 放在同一个仓库里统一管理。

你当前应该站在仓库根目录，也就是：

```bash
cd TapCanvas-pro
```

后面如果没有特别说明，命令都默认在这个目录执行。

为什么依赖要在这里安装：

- 根目录有 `pnpm-workspace.yaml`
- `apps/web`、`apps/hono-api`、`apps/agents-cli` 都属于这个 workspace
- 所以依赖安装应在 **仓库根目录** 执行，而不是分别进入每个子目录各装一遍

## 1. 先确认你当前所在目录

你应该先进入仓库根目录：

```bash
cd TapCanvas-pro
```

后面如果没有特别说明，命令都默认在这个目录执行。

## 2. 安装基础环境

### 方式 A：如果你想用 Docker Compose 启动

本地至少需要：

- Docker
- Docker Compose

推荐检查方式：

```bash
docker -v
docker compose version
```

如果你的机器没有 `docker compose` 子命令，也可能是旧版：

```bash
docker-compose -v
```

### 方式 B：如果你想本地源码开发

本地至少需要这些软件：

- Node.js
- pnpm
- PostgreSQL

推荐检查方式：

```bash
node -v
pnpm -v
```

如果 `pnpm` 没装，可以先执行：

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

## 3. 先选启动方式

### 方式 A：Docker Compose 启动

这是最适合技术小白的本地启动方式。

执行目录：

`TapCanvas-pro` 项目根目录

直接启动：

```bash
docker compose up -d
```

如果你的 Docker 版本较旧，就用：

```bash
docker-compose up -d
```

也可以用仓库自带脚本：

```bash
./scripts/dev.sh docker
```

如果你希望第一次启动时强制重建镜像：

```bash
./scripts/dev.sh docker --build
```

启动后默认地址：

- Web: `http://localhost:5173`
- API: `http://localhost:8788`

这种方式的特点：

- 优点：命令少，容器里会自动处理 Web 和 API 的依赖与启动
- 优点：更接近容器化部署环境
- 缺点：热更新和调试通常不如本地源码方式直接

### 方式 B：本地源码开发

如果你需要改代码，再继续看下面几步。

## 4. 在仓库根目录安装依赖

执行目录：

`TapCanvas-pro` 项目根目录

执行命令：

```bash
pnpm -w install
```

说明：

- `-w` 表示在 workspace 根目录安装
- 这一步会把前端、API、共享 packages、agents-cli 需要的依赖统一装好
- 安装过程中会自动为 `apps/hono-api` 生成 Prisma Client，无需再手动执行 `prisma generate`
- 不需要再手动分别去 `apps/web`、`apps/hono-api`、`apps/agents-cli` 里单独 `install`

## 5. 配置后端 API

先复制 API 的环境变量模板。

执行目录：

`TapCanvas-pro` 项目根目录

执行命令：

```bash
cp apps/hono-api/.env.example apps/hono-api/.env
```

然后打开这个文件：

`apps/hono-api/.env`

至少先改这几项：

- `DATABASE_URL`：PostgreSQL 连接地址
- `JWT_SECRET`：登录鉴权密钥，开发环境可以先随便写一个字符串
- `INTERNAL_WORKER_TOKEN`：内部 worker token，开发环境先写一个固定值即可
- `AGENTS_BRIDGE_BASE_URL`：指向本地 agents bridge

一个最小可启动示例：

```env
PORT=8788
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/tapcanvas
JWT_SECRET=dev-secret
INTERNAL_WORKER_TOKEN=change-me
AGENTS_BRIDGE_BASE_URL=http://127.0.0.1:8799
```

如果你本机还没有 PostgreSQL，这一步不要继续猜。先把 Postgres 准备好，再回头填 `DATABASE_URL`。

## 6. 配置前端 Web

前端也有自己的环境变量文件。

执行目录：

`TapCanvas-pro` 项目根目录

执行命令：

```bash
cp apps/web/.env.example apps/web/.env
```

最少先确认这一项：

```env
VITE_API_BASE="http://localhost:8788"
```

这表示前端页面启动后，会请求你本机的 API 服务。

如果你暂时不用 GitHub 登录，下面两项可以先不填真实值：

- `VITE_GITHUB_CLIENT_ID`
- `VITE_GITHUB_REDIRECT_URI`

## 7. 配置 `agents-cli`

TapCanvas 的 AI 对话与执行链路依赖 `apps/agents-cli`。

当前仓库里的实际配置文件是：

`apps/agents-cli/agents.config.json`

当前可见配置中，关键项是：

```json
{
  "apiBaseUrl": "https://right.codes/codex/v1",
  "model": "gpt-5.4",
  "apiStyle": "responses",
  "stream": true
}
```

如果你要核对重点，只看这几个字段就够了：

- `apiBaseUrl`：模型接口基础地址
- `apiKey`：模型接口密钥
- `model`：当前使用 `gpt-5.4`
- `apiStyle`：当前使用 `responses`
- `stream`：是否流式输出

如果这里没有可用的 `apiKey`，那 `agents-cli` 会启动，但实际调用模型时会失败。

## 8. 本地源码开发的启动顺序

建议开 3 个终端窗口，都从仓库根目录启动：

### 终端 1：启动 agents bridge

执行目录：

`TapCanvas-pro` 项目根目录

执行命令：

```bash
pnpm --filter agents dev -- serve --port 8799
```

作用：

- 启动 `apps/agents-cli` 的 HTTP 服务
- 供后端 `POST /public/agents/chat` 转发调用

### 终端 2：启动 API

执行目录：

`TapCanvas-pro` 项目根目录

执行命令：

```bash
pnpm dev:api
```

如果你的本地环境或容器环境对文件监听数量有限制，`pnpm dev:api` 可能会因为 `node --watch` 触发 `EMFILE`。这时请改用不带 watch 的稳定模式：

```bash
pnpm dev:api:stable
```

默认地址：

- API: `http://localhost:8788`

### 终端 3：启动 Web

执行目录：

`TapCanvas-pro` 项目根目录

执行命令：

```bash
pnpm dev:web
```

默认地址：

- Web: `http://localhost:5173`

也可以直接用仓库自带的一键脚本：

```bash
./scripts/dev.sh local --install
```

这个命令会做两件事：

- 自动执行 `pnpm -w install`
- 同时启动本地 API 和 Web

如果你还需要顺带启动 WebCut：

```bash
./scripts/dev.sh local --install --webcut
```

注意：

- `./scripts/dev.sh local` 主要是帮你启动 Web 和 API
- 如果你的使用场景依赖 `agents-cli` 的独立 bridge，对话链路仍建议单独确认 `pnpm --filter agents dev -- serve --port 8799` 已启动

## 9. 启动成功后怎么判断

你可以用这组最简单的判断方式：

- 如果你用的是 Docker Compose：
  - `docker compose ps` 能看到容器在运行
- 如果你用的是本地源码启动：
  - 启动命令所在终端没有直接报错退出
- 浏览器打开 `http://localhost:5173`，前端页面能出来
- 打开 `http://localhost:8788`，API 有响应
- `agents bridge` 终端没有直接报错退出

如果前端能打开，但 AI 对话不能用，优先检查这三件事：

1. `apps/hono-api/.env` 里的 `AGENTS_BRIDGE_BASE_URL` 是否是 `http://127.0.0.1:8799`
2. `apps/agents-cli/agents.config.json` 里是否有可用 `apiKey`
3. PostgreSQL 是否真的启动了，且 `DATABASE_URL` 可连通

## 10. 常用停止命令

如果你用的是 Docker Compose：

```bash
docker compose down
```

旧版 Docker：

```bash
docker-compose down
```

如果你用的是本地源码方式：

- 回到启动命令所在终端
- 按 `Ctrl + C`

## 常用命令

```bash
# 构建前端
pnpm build

# 构建 API
pnpm build:api

# 运行全部测试
pnpm test

# 前端单测
pnpm --filter @tapcanvas/web test

# API 测试
pnpm --filter @tapcanvas/api test
```

---

# 🚀 部署方式

## 方式一：Docker Compose

`apps/hono-api` 目录内提供了 Docker Compose 方案，可一并启动：

- `postgres`
- `redis`
- `agents-bridge`
- `api`

示例：

```bash
cd apps/hono-api
docker-compose up --build -d
```

如果你的共享目录不是默认 monorepo 布局，可先设置：

```bash
export TAPCANVAS_SHARED_ROOT=..
```

详细说明见：

- [apps/hono-api/README.md](./apps/hono-api/README.md)
- [docs/docker.md](./docs/docker.md)

## 方式二：源码部署

```bash
pnpm -w install
pnpm --filter @tapcanvas/api prisma:generate
pnpm build:api
pnpm --filter @tapcanvas/api start
```

前端可单独构建并部署静态产物：

```bash
pnpm build
pnpm --filter @tapcanvas/web preview
```

---

# 🗂️ 项目结构

```text
TapCanvas-pro/
├── apps/
│   ├── web/           # Vite + React + Mantine + React Flow 前端
│   ├── hono-api/      # NestJS + Node.js API，挂载 Hono/OpenAPI 路由
│   └── agents-cli/    # 独立 Agents CLI / HTTP bridge
├── packages/
│   ├── schemas/       # 共享 schema
│   ├── sdk/           # 共享 SDK
│   └── pieces/        # 通用模块
├── docs/              # 项目文档
├── infra/             # 可选基础设施编排
└── assets/            # README 与演示素材
```

---

# 📚 文档入口

- [文档索引](./docs/README.md)
- [Docker 快速启动](./docs/docker.md)
- [本地开发说明](./docs/development.md)
- [AI / 后端契约与扩展](./docs/INTELLIGENT_AI_IMPLEMENTATION.md)
- [Hono API / Agents Bridge / AI 对话架构](./apps/hono-api/README.md)
- [Agents CLI 说明](./apps/agents-cli/README.md)

---

# 🏗️ 当前技术栈

- **前端**：Vite、React 18、TypeScript、Mantine、React Flow、Zustand、Vitest、Playwright
- **后端**：NestJS、Hono、Node.js、Prisma、Postgres、Redis
- **AI 接入**：AI SDK、Agents Bridge、自定义 tool schemas、项目化上下文注入
- **Monorepo**：pnpm workspace

---

# 📜 许可证

TapCanvas Pro 基于 Apache-2.0 协议开源发布，并附有补充商业协议。

许可证详情：https://www.apache.org/licenses/LICENSE-2.0

## 补充协议

- 若将本软件以产品形式分发给 **2 个及以上独立第三方**使用，须取得作者方 **书面商业授权**。
- **≤ 5 个法人**联合运营内部使用，不对外提供服务的，视为内部使用，**无需授权**。
- 不得删除或修改 TapCanvas Pro 中的标识或版权信息。

## 永久免费场景

- ✅ 用 TapCanvas Pro 制作内容并获得平台分账
- ✅ 二次开发供自己团队内部使用
- ✅ ≤ 5 个法人联合运营内部使用
- ✅ 个人学习、研究、非商业用途

## 商业授权定价

| 阶段      | 年销售额      | 年费                       |
| --------- | ------------- | -------------------------- |
| 🌱 扶持期 | < ¥10 万     | **申请即可免费授权** |
| 🚀 初创期 | ¥10–50 万   | ¥5,000/年                 |
| 📈 成长期 | ¥50–150 万  | ¥20,000/年                |
| 🏢 规模期 | ¥150–500 万 | ¥80,000/年                |
| 🌐 企业级 | > ¥500 万    | 面议                       |

> **不追溯条款**：若历史版本曾基于其他开源协议使用，已按当时协议合规使用的用户，继续按原协议执行，不受后续协议调整追溯影响。

完整协议详见 [LICENSE](./LICENSE) 文件。

---

# ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=anymouschina/TapCanvas&type=Date)](https://star-history.com/#anymouschina/TapCanvas&Date)

---

# 🤝 联系与反馈

邮箱：beq.li@qq.com

欢迎加入交流群交流反馈与共创：

![交流群](./assets/group.jpg)

如需合作或问题沟通，可联系作者：

![联系作者](./assets/author.jpg)

如有部署问题需要答疑，可扫码添加微信：

![部署答疑](./assets/connect/wecaht.jpg)
