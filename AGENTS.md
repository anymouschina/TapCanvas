# Repository Guidelines

## Project Structure & Modules

- Monorepo: `apps/`, `packages/`, `infra/`.
- Web app: `apps/web` (Vite + React + TypeScript, Mantine UI, React Flow canvas).
  - Canvas and UI: `apps/web/src/canvas`, `apps/web/src/ui`, `apps/web/src/flows`, `apps/web/src/assets`.
- Shared libs: `packages/schemas`, `packages/sdk`, `packages/pieces`.
- Local orchestration (optional): `infra/` (Docker Compose setup).

## Build, Test, and Dev

- Install deps (workspace): `pnpm -w install`
- Dev web: `pnpm dev:web` (or `pnpm --filter @tapcanvas/web dev`)
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
- Keep modules focused; colocate component styles in `apps/web/src`.

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

- Shared tool contracts live in `apps/api/src/ai/tool-schemas.ts`. This file describes what the canvas can actually do (tool names, parameters, and descriptions) from a **frontend capability** perspective, but is only imported on the backend to build LLM tools.
- Whenever you change or add frontend AI canvas functionality (e.g. new `CanvasService` handlers, new tool names, new node kinds that tools can operate on), you **must** update `apps/api/src/ai/tool-schemas.ts` in the same change so that backend LLM tool schemas stay in sync.
- Do not declare tools or node types in `canvasToolSchemas` that are not implemented on the frontend. The schemas are not aspirational docs; they must reflect real, callable capabilities.
- Node type + model feature descriptions live in `canvasNodeSpecs` inside the same file. This object documents what each logical node kind (image/composeVideo/audio/subtitle/character etc.) is for, and which models are recommended / supported for it（例如 Nano Banana / Nano Banana Pro / Sora2 / Veo 3.1 的适用场景与提示词策略）。Model-level prompt tips（如 Banana 的融合/角色锁、Sora2 的镜头/物理/时序指令）也应集中维护在这里或 `apps/api/src/ai/constants.ts` 的 SYSTEM_PROMPT 中，避免分散。
- When you add or change node kinds, or enable new models for an existing kind, update `canvasNodeSpecs` 与相关系统提示（SYSTEM_PROMPT）以匹配真实接入的模型能力（不要列出实际上未接入的模型或特性）。

## Multi-user Data Isolation

- All server-side entities (projects, flows, executions, model providers/tokens, assets) must be scoped by the authenticated user.
- Never share or read another user's data: every query must filter by `userId`/`ownerId` derived from the JWT (e.g. `req.user.sub`).
- When adding new models or APIs, always design relations so they attach to `User` and are permission-checked on every read/write.
