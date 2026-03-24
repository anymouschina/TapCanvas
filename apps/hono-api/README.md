# TapCanvas Hono API

TapCanvas 主后端，基于 Cloudflare Workers + Hono，负责 AI 路由、鉴权、D1 数据与前端画布工具契约。

## 本地开发

默认开发方式是在各自目录内直接启动，不再把 `docker-compose` 作为日常开发首选。

1. 在仓库根目录安装依赖：`pnpm -w install`
2. 进入当前目录：`cd apps/hono-api`
3. 启动 API：`npm run dev`
4. 新开一个终端启动前端：`cd ../web && npm run dev`

本地地址：

- API: `http://localhost:8788`
- Web: `http://localhost:5173`
- Swagger / API docs: `http://localhost:8788/`

说明：

- `npm run dev` 会先执行 `db:update:local`，再启动 `wrangler dev --port 8788`
- `docker-compose` 目前仅作为可选方案保留，暂不推荐作为默认本地开发方式

## 常用命令

```bash
npm run dev
npm run dev:log
npm run db:update:local
npm run deploy
```

## Project structure

1. 主入口路由位于 `src/index.ts`
2. AI 相关模块位于 `src/modules/ai`
3. 认证、数据库与业务模块位于 `src/modules/*`
4. Worker 配置与 D1 schema 位于当前目录下的 `wrangler.jsonc`、`schema.sql`

### Local HTTP debug logs

- Run `npm run dev:log` to tee JSON logs into `log.txt` (includes downstream + upstream URL / request body / response).
- Env flags:
  - `DEBUG_HTTP_LOG=1` enable logging
  - `DEBUG_HTTP_LOG_BODY_LIMIT=16384` max bytes captured per body snippet
  - `DEBUG_HTTP_LOG_UNSAFE=1` disable redaction (use only locally)

## SmallT Server-Orchestrated Chat (SSE)

TapCanvas already has a front-end driven "小T" (LangGraph overlay). In addition, the Worker backend now provides a **server-orchestrated chat SSE** API inspired by mainstream agent runtimes:

- `POST /ai/chat/submit_messages` (SSE `text/event-stream`)
- `POST /ai/chat/update_message` (store UI option selections / message kwargs)
- `GET /ai/chat/sessions` / `GET /ai/chat/history` / `PATCH|DELETE /ai/chat/sessions/:id` (basic persistence via D1: `chat_sessions`, `chat_messages`)

This is a minimal scaffold that:
- asks for film meta via `selectFilmMeta`
- after receiving a `CONTINUE` payload, asks for emotion keyword via `selectFilmEmotionKeyword`

### Quick curl loop

1) Submit initial user message (expect SSE with `selectFilmMeta`):

```bash
curl -N 'http://localhost:8788/ai/chat/submit_messages' \
  -H 'Authorization: Bearer <YOUR_TOKEN>' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "conversation": { "type": "conversation", "data": { "id": "demo-conv-1", "status": "streaming" } },
    "localizationOptions": { "language": "zh" },
    "messages": [
      { "type": "human", "data": { "id": "human_1", "content": "一个转学生来到异世界高中，发现同学们都有各种超能力", "additional_kwargs": {} } }
    ],
    "tools": [],
    "workspace": { "workspaceId": "demo-workspace-1", "name": "demo" }
  }'
```

2) (Optional) Record UI selection via `update_message` (matches the oiioii pattern; stored into `chat_messages.raw`):

```bash
curl 'http://localhost:8788/ai/chat/update_message' \
  -H 'Authorization: Bearer <YOUR_TOKEN>' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "conversation": { "type": "conversation", "data": { "id": "demo-conv-1" } },
    "messageId": "<MESSAGE_ID_TO_UPDATE>",
    "kwargsUpdates": {
      "optionArgs": {
        "filmMeta": { "aspectRatio": "9x16", "duration": "long" },
        "optionChoosed": true
      }
    }
  }'
```

3) Continue with `CONTINUE` payload (expect SSE with `selectFilmEmotionKeyword`):

```bash
curl -N 'http://localhost:8788/ai/chat/submit_messages' \
  -H 'Authorization: Bearer <YOUR_TOKEN>' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "conversation": { "type": "conversation", "data": { "id": "demo-conv-1", "status": "streaming" } },
    "messages": [
      { "type": "human", "data": { "id": "human_2", "content": "信息已确认\n```hide\nCONTINUE\n{\"questionType\":\"selectFilmMeta\",\"filmMeta\":{\"aspectRatio\":\"9x16\",\"duration\":\"long\"}}\n```" } }
    ]
  }'
```

4) Continue with emotion keyword:

```bash
curl -N 'http://localhost:8788/ai/chat/submit_messages' \
  -H 'Authorization: Bearer <YOUR_TOKEN>' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "conversation": { "type": "conversation", "data": { "id": "demo-conv-1", "status": "streaming" } },
    "messages": [
      { "type": "human", "data": { "id": "human_3", "content": "信息已确认\n```hide\nCONTINUE\n{\"questionType\":\"selectFilmEmotionKeyword\",\"value\":\"诡秘\"}\n```" } }
    ]
  }'
```
