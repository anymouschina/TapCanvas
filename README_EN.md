<p align="center">
  <img src="assets/logo.png" alt="TapCanvas Logo" width="1000" />
</p>

<h1 align="center">TapCanvas</h1>

TapCanvas is a multi-model AI content creation platform built around a visual canvas: orchestrate text, image, video and other generation workflows in one place, with fast iteration across multi-step creative pipelines.

**Language:** [中文](README.md) | English

## Latest Capabilities

- **Video-to-image reference via frame preview**: drag a frame from the video preview directly onto the canvas to use it as a reference image for image generation.

<p align="center">
  <img src="assets/video-to-image.jpg" alt="Drag frame to generate reference image" width="1000" />
</p>

## Quick Start

### Local dev (recommended)

```bash
# 1) Install deps
pnpm install

# 2) Configure env
cp apps/web/.env.example apps/web/.env
cp apps/hono-api/.env.example apps/hono-api/.env

# 3) Start (two terminals)
pnpm dev:web
pnpm dev:api
```

### One-command full stack (Docker)

```bash
docker compose up -d

cp apps/web/.env.example apps/web/.env
cp apps/hono-api/.env.example apps/hono-api/.env

# Reload env (optional)
docker compose restart
```

## Architecture / Tech Stack

- **Monorepo**: pnpm workspaces (`apps/`, `packages/`)
- **Web**: Vite + React 18 + TypeScript, Mantine UI, React Flow canvas, Zustand state
- **API**: NestJS (Node.js) + Hono (route reuse), OpenAPI 3.1 + request validation
- **Storage**: SQLite (local), S3-compatible optional for asset hosting

## Environment

- Web (Vite): `apps/web/.env*`
- API: `apps/hono-api/.env` (or `apps/hono-api/.dev.vars`)
- Root `.env.example` is optional (scripts/tools only)

## Verify

- Web: `http://localhost:5173`
- API: `http://localhost:8788`
- API docs: `http://localhost:8788/`

## Docs

- `docs/README.md` (index)
- `docs/docker.md` (Docker)
- `docs/development.md` (local dev)
- `docs/INTELLIGENT_AI_IMPLEMENTATION.md` (AI tool contracts)
- `docs/AI_VIDEO_REALISM_GUIDE.md` (prompt tips)

## TODO / Roadmap

- **Sora 2 watermark removal**: smarter cleanup for generated videos
- **Video stitching**: seamless multi-clip concatenation + transitions
- **Basic video editing**: trim/split/merge inside TapCanvas

## Contributing

- Issues: https://github.com/anymouschina/TapCanvas/issues
- Discussions: https://github.com/anymouschina/TapCanvas/discussions

## License

Apache-2.0
