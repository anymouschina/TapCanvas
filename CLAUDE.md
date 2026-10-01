# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repo.

## Common Commands

```bash
# Install deps for every workspace package (`pnpm -w install` only installs the root)
pnpm install

# Web dev (Vite)
pnpm dev:web                  # http://localhost:5173

# API dev (Node + Hono, Postgres via Prisma)
pnpm dev:api                  # http://localhost:8788

# Tests
pnpm test:web                 # vitest (apps/web/_test/vitest.config.ts)
pnpm test:api                 # vitest (needs `pnpm --filter @tapcanvas/api prisma:generate` once)
pnpm build:agents && pnpm test:agents   # agents-cli tests run from dist/


# One-command full stack (Docker) — run from repo root (docker-compose.yml lives there)
# Generates apps/hono-api/.env secrets on first run; see docs/docker.md
pnpm compose:up
docker compose --env-file apps/hono-api/.env logs -f api
pnpm compose:down

# Build web (outputs to repo root `dist/`)
pnpm build
```

## Key Files

- Web app: `apps/web`
- API (Node/Hono): `apps/hono-api`
- AI tool contracts + node specs: `apps/hono-api/src/modules/ai/tool-schemas.ts`
- Docs index: `docs/README.md`

