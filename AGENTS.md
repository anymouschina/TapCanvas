# AI Assistant Skills / 能力说明

- Model: GPT-5.1 running in Codex CLI，专注于代码编辑和重构。
- Can:
  - 阅读、理解并修改本仓库内的所有 TypeScript/React/Mantine/React Flow 代码。
  - 调用 shell 命令（如 `pnpm`、`rg`、`git log`）在工作区内查找问题、跑构建/测试。
  - 在 monorepo 结构中跨 `apps/`、`packages/`、`infra/` 进行联动修改（保持变更聚焦、最小化）。
  - 设计和实现新组件、新 hooks、新 Zustand store 以及 AI canvas 相关逻辑（前后端工具契约保持同步）。
  - 帮助梳理/重写提示词（SYSTEM_PROMPT）、tool schemas、node specs，并给出多步方案和重构建议。
  - 使用在线搜索获取最新库/框架用法（如 Mantine、React Flow、Vite、Cloudflare Workers 等）。
- Won't:
  - 不会主动创建 Git 分支或提交 `git commit`（除非你明确要求）。
  - 不会修改与当前任务无关的大范围代码或重构整个架构。
  - 不会引入与现有技术栈冲突的新框架或大型依赖，除非经过确认。
- How to use me:
  - 直接描述你要完成的任务（可以是中文或英文），包括目标页面/模块、交互和约束。
  - 如果希望我跑构建或测试，可以明确说“帮我跑一下构建/测试并修到通过为止”。
  - 复杂任务我会先给出分步 plan，并在实现过程中更新进度。
  - 我同时会按需调用 Codex 本地 skills（`~/.codex/skills`）作为“专家模式”，当前可用的包括：`web`、`api`、`devops`、`test`、`debugger`、`security`、`perf`、`docs`、`review`、`git`、`ux`、`a11y`、`analytics`、`copy`、`pricing`、`custdev`、`coach`、`obsidian`、`orchestrator`、`research`、`ios` 等。
- Review & Orchestration:
  - 在每次认为“任务已完成”之前，必须先执行一次显式 review：对照用户最初的需求、当前的计划（plan）和已做的改动/输出，确认是否覆盖所有预期；如有缺口则继续迭代而不是立即结束回复。
  - 默认以 orchestrator 模式运行复杂任务：维护和更新 To-Do plan（使用 Codex 的计划工具），拆分子任务并在每个阶段后做小结，直到明确满足用户目标才停止。
  - 在合适的场景下，可以通过命令来辅助确认完成状态，例如：`codex exec "count the total number of lines of code in this project"`、`pnpm --filter @tapcanvas/web build` 或简单的 `rg`/`ls` 检查；这些命令用于验证和 sanity check，而不是替代逻辑上的需求对齐。
  - 如果 review 发现任何一项用户预期尚未满足（功能缺失、覆盖不全、验证未做、实现偏离需求等），必须：1）更新计划（plan），2）继续执行新的子任务直至问题解决；在这些检查通过之前，不得将当前用户请求视为“完成”并结束回复。
  - 代码与设计强制原则：遵循 DDD 分层/契约一致性、雅虎军规式前端性能优化、单一职责拆分，以及能用纯函数就不用有副作用的实现；新增能力时保持前后端 schema/模型同步。

# Repository Guidelines

## Project Structure & Modules

- Monorepo: `apps/`, `packages/`, `infra/`.
- Web app: `apps/web` (Vite + React + TypeScript, Mantine UI, React Flow canvas).
  - Canvas and UI: `apps/web/src/canvas`, `apps/web/src/ui`, `apps/web/src/flows`, `apps/web/src/assets`.
- Backend API: `apps/hono-api` (Cloudflare Workers + Hono).
- Shared libs: `packages/schemas`, `packages/sdk`, `packages/pieces`.
- Local orchestration (optional): `infra/` (Docker Compose setup).

## Build, Test, and Dev

- Install deps (workspace): `pnpm -w install`
- Dev web: `pnpm dev:web` (or `pnpm --filter @tapcanvas/web dev`)
- Dev api: `pnpm --filter ./apps/hono-api dev` (Wrangler dev)
- Build all: `pnpm build`
- Preview web: `pnpm --filter @tapcanvas/web preview`
- Compose up/down (optional): `pnpm compose:up` / `pnpm compose:down`
- Tests: currently minimal; placeholder in `apps/web`.

## Coding Style & Naming

- Language: TypeScript (strict), React function components.
- UI: Mantine (dark theme), React Flow for canvas; Zustand for local stores.
- UI aesthetic: keep components borderless for a clean, frameless look.
- Filenames: React components PascalCase (`TaskNode.tsx`), utilities kebab/camel case (`mock-runner.ts`, `useCanvasStore.ts`).
- Types/interfaces PascalCase; variables/functions camelCase.
- Readability & maintainability first: prefer small, focused modules and consistent naming; avoid hidden side effects.
- Prefer curried functions where it improves reuse/composability, and favor pure functions over side-effectful logic.
- JSX/TSX: every tag must include a descriptive, named `className` for easier targeting and debugging.
- Keep modules focused; colocate component styles in `apps/web/src`.

## Modularity & Performance

- 一个文件不应过大；当组件/服务超过单一职责时拆分为更小的子组件、hooks、utils，保持渲染与副作用/数据逻辑解耦。
- 函数化与抽象优先：重复逻辑提炼为纯函数或共享工具；跨页面/画布的通用行为放入 packages 层以复用。
- 遵循“雅虎军规”式前端性能准则：减少请求次数（合并资源/雪碧图/内联关键 CSS）、使用 CDN 与长缓存、开启 gzip/br（或 vite 静态压缩）、压缩/去重/按需加载 JS/CSS、避免阻塞渲染的同步脚本、减少 DNS 解析与重定向。
- 交付优化：懒加载重型路由/模型、尽量使用异步加载与 prefetch/prerender、避免重复拉取同一资源，保持资源路径和依赖有清晰的 owner。

## Testing Guidelines

- Preferred: Vitest for new tests (TBD in repo).
- Test files: `*.test.ts` / `*.test.tsx`, colocated near source.
- Run (when added): `pnpm test` or `pnpm --filter @tapcanvas/web test`.

## Commit & PR

- Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`; scope when relevant, e.g., `feat(web): multi-select group overlay`.
- PRs include: summary, screenshots/GIFs for UI, steps to run (`pnpm -w install && pnpm dev:web`), and any migration notes.

## Canvas Dev Tips

- Use `ReactFlowProvider` at the app level; hooks like `useReactFlow` require the provider.
- Canvas fills the viewport; header is transparent with only TapCanvas (left) and GitHub icon (right).

## AI Tools & Models

- Image nodes default to `nano-banana-pro` and are designed for text-to-image, storyboard stills from long-form plots, and image-to-image refinement.
- Prefer `nano-banana-pro` when building flows that need consistent visual style across scenes; other image models are optional fallbacks.
- When wiring tools, treat image nodes as the primary source of “base frames” for Sora/Veo video nodes, especially for novel-to-animation workflows.

## AI Tool Schemas (backend)

- Shared tool contracts live in `apps/hono-api/src/modules/ai/tool-schemas.ts`. This file describes what the canvas can actually do (tool names, parameters, and descriptions) from a **frontend capability** perspective, but is only imported on the backend to build LLM tools.
- Whenever you change or add frontend AI canvas functionality (e.g. new `CanvasService` handlers, new tool names, new node kinds that tools can operate on), you **must** update `apps/hono-api/src/modules/ai/tool-schemas.ts` in the same change so that backend LLM tool schemas stay in sync.
- Do not declare tools or node types in `canvasToolSchemas` that are not implemented on the frontend. The schemas are not aspirational docs; they must reflect real, callable capabilities.
- Node type + model feature descriptions live in `canvasNodeSpecs` inside the same file. This object documents what each logical node kind (image/composeVideo/audio/subtitle/character etc.) is for, and which models are recommended / supported for it（例如 Nano Banana / Nano Banana Pro / Sora2 / Veo 3.1 的适用场景与提示词策略）。Model-level prompt tips（如 Banana 的融合/角色锁、Sora2 的镜头/物理/时序指令）也应集中维护在这里或 `apps/hono-api/src/modules/ai/constants.ts` 的 SYSTEM_PROMPT 中，避免分散。
- When you add or change node kinds, or enable new models for an existing kind, update `canvasNodeSpecs` 与相关系统提示（SYSTEM_PROMPT）以匹配真实接入的模型能力（不要列出实际上未接入的模型或特性）。

## Multi-user Data Isolation

- All server-side entities (projects, flows, executions, model providers/tokens, assets) must be scoped by the authenticated user.
- Never share or read another user's data: every query must filter by `userId`/`ownerId` derived from the JWT (e.g. `req.user.sub`).
- When adding new models or APIs, always design relations so they attach to `User` and are permission-checked on every read/write.
