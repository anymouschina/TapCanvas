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

## Multi-user Data Isolation
- All server-side entities (projects, flows, executions, model providers/tokens, assets) must be scoped by the authenticated user.
- Never share or read another user's data: every query must filter by `userId`/`ownerId` derived from the JWT (e.g. `req.user.sub`).
- When adding new models or APIs, always design relations so they attach to `User` and are permission-checked on every read/write.
