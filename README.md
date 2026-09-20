<p align="center">
  <img src="./apps/web/public/tapcanvas-app-icon.svg" width="128" alt="TapCanvas" />
</p>

<p align="center">
  面向 AI 影视、漫剧与多模态内容生产的 Agent 原生无限画布
</p>

<p align="center">
  <a href="https://github.com/anymouschina/TapCanvas/stargazers"><img src="https://img.shields.io/github/stars/anymouschina/TapCanvas?style=flat-square" alt="GitHub Stars" /></a>
  <a href="https://atomgit.com/anymouschina/TapCanvas" target="_blank" rel="noopener noreferrer"><img src="https://atomgit.com/anymouschina/TapCanvas/star/badge.svg" alt="AtomGit Star" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript strict" />
  <img src="https://img.shields.io/badge/pnpm-10.8.1-f69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm 10.8.1" />
</p>

# TapCanvas 社区版

TapCanvas 把创意、脚本、角色与场景资产、分镜、图像、视频和最终成片放进同一个可追溯的画布工作流。它不是单次模型调用器：Agents 会读取真实项目与画布状态，自主选择 Skills 和工具，执行多步生产，并以节点、资产和运行记录交付结果。在线网站核心功能及样式与当前项目完全一致。

> **版本边界：** 本仓库是 TapCanvas 社区版，在线商业版是独立产品，功能、服务与条款均不相同。社区版不提供短信验证码与在线支付；模型渠道由使用者自行配置。

<p align="center">
  <img src="./apps/web/readme-canvas.png" width="100%" alt="TapCanvas 章节画布、角色场景资产与分镜预览" />
</p>

## 核心能力

- **无限画布**：用强类型节点、端口和连线组织文档、角色、分镜、图像、视频、音频、字幕与工作流。
- **Agent 原生执行**：`POST /public/agents/chat` 统一进入 DeepSeek Harness Bridge，由 Agents 负责语义理解、规划、Skills、子代理与最终交付自检。
- **成片生产底座（需编排）**：支持章节上下文、角色/场景资产、结构化分镜、连续镜头、首尾帧承接、视频生成与合成；固定的一键成片入口尚未上线。
- **多模型网关**：文本、图像、视频和音频模型由鲁班 API（`apps/new-api`）统一接入、计量和动态下发，前端不写死模型列表。
- **项目化资产**：素材库、版本、生成历史、任务状态、交付证据与项目本地元数据持续沉淀，生成成功的资产不会被后处理丢弃。
- **工作流与协作**：支持可复用 DAG、异步 Worker、失败恢复、分享/发布、团队作用域与实时画布状态。

## HeyRoute 注册福利与渠道配置

通过 [HeyRoute 推广链接注册](https://heyroute.ai/r/c/ch_iiq2tvtmrc)可领取 **$15 额度**，可使用 Codex、Claude、Gemini 对话及平台提供的生图能力（具体领取条件与可用模型以 HeyRoute 页面为准）。

社区版内置 7 个 HeyRoute 渠道，共 31 个模型：15 个对话模型（Claude、GPT、Grok、Gemini、Kimi）、5 个图片模型和 11 个视频模型。新增视频包括 Grok、MiniMax H3 与 Seedance 系列，文本、图片和视频均支持渠道独立计价。首次部署后，在鲁班 API（new-api）管理台的渠道列表或编辑窗口点击 **申请 API Key**，通过上述链接注册，填写自己的 Key 并启用所需渠道。新增渠道默认停用且 Key 为空，不包含维护者私人凭据；升级保留已有 Key 和启用状态。初始化配置见 [`004-expand-heyroute-channels.sql`](apps/new-api/patches/2026-09-11/004-expand-heyroute-channels.sql)，详细说明见 [HeyRoute 接入说明](apps/new-api/docs/heyroute.md)。

## 当前架构

<p align="center">
  <a href="./docs/tapcanvas-high-level-architecture.html">
    <img src="./assets/tapcanvas-high-level-architecture.png" width="100%" alt="TapCanvas 高层架构：Agents 调用生产工作流驱动 AIGC，并通过持久任务和交付验收实现稳定输出" />
  </a>
</p>

主链路是 **无限画布 → Agents Bridge → 生产工作流内核 → 任务与媒体 Workers → 可验证交付**。Agents 根据真实项目状态按需调用 Skills、MCP、子代理与工作流；图片、视频和音频任务经鲁班 API 进入 AIGC 模型，再由任务账本、队列、租约、幂等、重试与 reconcile，以及真实资产 URL 和 delivery evidence，保证长链路生产可恢复、可追溯、可验收。

> **一键成片边界：** 底层 AIGC、工作流编排、异步执行与交付验收能力已经具备，但固定的一键成片产品入口尚未上线，当前需要自行编排工作流。点击架构图可打开带导览与节点说明的交互版本。

Monorepo 的职责边界：`apps/web` 负责交互与确定性画布执行，`apps/hono-api` 负责协议、权限、任务与事实证据，`apps/agents-cli` 是 DeepSeek Harness 的 TapCanvas Bridge，`apps/new-api` 负责模型网关，`packages/schemas` 保存前后端共享契约。AI 对话架构细节见 [apps/hono-api/README.md](./apps/hono-api/README.md)，Bridge 说明见 [apps/agents-cli/README.md](./apps/agents-cli/README.md)。

## 快速开始

Docker 启动只需要 Docker、Docker Compose 和 OpenSSL；不要求宿主机安装 Node.js、pnpm、Bun 或 Go。

```bash
git clone https://github.com/anymouschina/TapCanvas.git
cd TapCanvas
./scripts/dev.sh docker
```

这条命令会识别 `docker compose` 或 `docker-compose`，为全新安装生成一次性的强随机本地密钥，随后从已提交的源码和锁文件逐个构建 Web、API、鲁班 API、Agents Bridge 与 Workers，避免冷构建并发耗尽 Docker 内存。密钥只写入被 Git 和 Docker 构建上下文排除的 `apps/hono-api/.env`，不会打印；如果该文件已经存在，脚本只追加缺失的启动项，不覆盖任何现有值，因此已有的 lluban 或其他模型渠道配置会保留。

打开 Web [http://localhost:5175](http://localhost:5175)，API 位于 [http://localhost:8788](http://localhost:8788)，鲁班 API 管理台位于 [http://localhost:4455](http://localhost:4455)。首次生成的两个管理员密码保存在私有 `.env` 文件中，不会显示在终端。冷构建可能需要较长时间，可通过容器状态与日志查看真实进度。

需要完全忽略已有构建缓存并重新拉取基础镜像时运行：

```bash
./scripts/dev.sh docker --fresh-build
```

本地源码开发仍可使用 Node.js `^22.19.0` 或 `>=24` 与 pnpm `10.8.1`：

```bash
corepack enable
pnpm -w install --frozen-lockfile
pnpm dev:web
```

本地浏览器入口统一使用 `http://localhost:5175`。通过 `127.0.0.1` 或 `[::1]` 打开 Web 时，应用启动前会跳转到 `localhost`，保留协议、端口、路径、查询参数与 hash；源码开发、预览和 Docker 静态构建使用同一入口规则。浏览器不会在这些主机名之间共享 Cookie 或 localStorage，统一入口可避免登录态割裂和跨站 Cookie 丢失。GitHub OAuth 本地回调也应配置为 `http://localhost:5175/oauth/github`。

### 环境变量

README 不复制整份配置，避免与代码漂移；[API 模板](./apps/hono-api/.env.example) 和 [Web 模板](./apps/web/.env.example) 是唯一入口。首次启动只需确认以下分组：

| 分组     | 关键变量                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| 数据库   | `POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`、`DATABASE_URL_DOCKER`                               |
| 服务鉴权 | `JWT_SECRET`、`INTERNAL_WORKER_TOKEN`、`AGENTS_BRIDGE_TOKEN`；首次 Docker 启动自动生成                     |
| 模型网关 | `NEW_API_INTERNAL_TOKEN`、`NEW_API_SESSION_SECRET`、`NEW_API_CRYPTO_SECRET`、`NEW_API_USD_EXCHANGE_RATE` |
| Web      | Docker 镜像默认同源访问 `/api`；GitHub OAuth 与对象存储可按模板启用                                      |

模型供应商凭据在鲁班 API 管理台配置；不要把真实密钥提交到 Git。缺失关键配置会显式失败，不会自动选择默认模型或静默降级。

```bash
pnpm build          # Web + API + Agents
pnpm test           # 全量测试
docker-compose --env-file apps/hono-api/.env ps # 当前主机使用 standalone Compose
./scripts/dev.sh docker-down                     # 停止服务，不删除数据卷
```

## 许可证

TapCanvas 根项目及未另行声明的代码按 [MIT License](./LICENSE) 发布。`apps/new-api` 是独立上游衍生组件，继续适用其目录中的 [GNU AGPL-3.0 License](./apps/new-api/LICENSE) 与原始归属声明；其他第三方组件分别适用各自许可证。在线商业版不适用本仓库协议。

## 鸣谢

感谢以下平台与开源项目，TapCanvas 的托管、推广与实现都建立在它们之上。

- **[AtomGit](https://atomgit.com/gcw_PzejWSbY/TapCanvas) / GitCode**：提供代码托管、开源社区推广与 Badge 数据服务，上述链接即本项目在 AtomGit 的项目入口。

上游开源项目：

| 项目                                                                              | 在本仓库中的职责                                          |
| --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [new-api](https://github.com/QuantumNous/new-api)（上游为 [One API](https://github.com/songquanpeng/one-api)） | `apps/new-api` 模型网关的来源实现，负责渠道接入、计量与模型下发 |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)                | `apps/agents-cli` Bridge 的官方运行时、主代理循环与工具能力 |
| [React Flow](https://github.com/xyflow/xyflow)（`@xyflow/react`）                    | 无限画布的节点、端口与连线内核                            |
| [Mantine](https://github.com/mantinedev/mantine)                                   | Web 端 UI 组件与主题                                      |
| [Hono](https://github.com/honojs/hono)                                             | `apps/hono-api` 的 Worker 路由与 OpenAPI 层               |
| [Prisma](https://github.com/prisma/prisma)                                         | 数据模型与数据库访问                                      |
| [Vite](https://github.com/vitejs/vite) / [Vitest](https://github.com/vitest-dev/vitest) | Web 构建与测试                                        |
| [AI SDK](https://github.com/vercel/ai)、[Zustand](https://github.com/pmndrs/zustand)、[Tabler Icons](https://github.com/tabler/tabler-icons) | 模型调用、前端状态管理与图标 |

具体依赖版本以 `apps/*/package.json` 与 `pnpm-lock.yaml` 为准；第三方组件各自适用其上游许可证，见[许可证](#许可证)。

## 感谢贡献者

感谢每一位通过代码、文档、Issue、评审、测试与使用反馈帮助 TapCanvas 持续完善的贡献者。

<p align="center">
  <a href="https://github.com/anymouschina/TapCanvas/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=anymouschina/TapCanvas&v=20260905" alt="TapCanvas Contributors" />
  </a>
</p>

每一次贡献都在帮助社区版变得更统一、更稳定，也让多模态内容生产工作流能够服务更多创作者。欢迎阅读现有 Issues、提交修复或分享你的工作流实践。

## 作者与反馈

作者：**Beq（李碧强）** · 邮箱：[beq.li@qq.com](mailto:beq.li@qq.com)

<img src="./assets/connect/wechat.jpg" width="180" alt="作者微信二维码" />

Bug、功能建议与贡献请通过 [Issues](https://github.com/anymouschina/TapCanvas/issues) 或 Pull Request 提交。

## Star 趋势

[![TapCanvas Star History](https://star-history.dera.page/svg?repos=anymouschina/TapCanvas&type=Date)](https://star-history.dera.page/#anymouschina/TapCanvas&Date)
