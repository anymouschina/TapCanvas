# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repo.

## Common Commands

```bash
# Install deps (pnpm workspace)
pnpm -w install

# Web dev (Vite)
pnpm dev:web                  # http://localhost:5173

# API dev (Cloudflare Workers + Hono)
pnpm --filter ./apps/hono-api dev  # http://localhost:8788

# Init local D1 (optional, recommended)
pnpm --filter ./apps/hono-api db:update:local

# One-command full stack (Docker)
docker compose up -d
docker compose logs -f api
docker compose logs -f web
docker compose down

# Build web (outputs to repo root `dist/`)
pnpm build
```

## Key Files

- Web app: `apps/web`
- API (Worker): `apps/hono-api`
- AI tool contracts + node specs: `apps/hono-api/src/modules/ai/tool-schemas.ts`
- Docs index: `docs/README.md`

