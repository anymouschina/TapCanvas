# Cloudflare Workers OpenAPI 3.1

This is a Cloudflare Worker with OpenAPI 3.1 using [chanfana](https://github.com/cloudflare/chanfana) and [Hono](https://github.com/honojs/hono).

This is an example project made to be used as a quick start into building OpenAPI compliant Workers that generates the
`openapi.json` schema automatically from code and validates the incoming request to the defined parameters or request body.

## Get started

1. Sign up for [Cloudflare Workers](https://workers.dev). The free tier is more than enough for most use cases.
2. Clone this project and install dependencies with `npm install`
3. Run `wrangler login` to login to your Cloudflare account in wrangler
4. Run `wrangler deploy` to publish the API to Cloudflare Workers

## Project structure

1. Your main router is defined in `src/index.ts`.
2. Each endpoint has its own file in `src/endpoints/`.
3. For more information read the [chanfana documentation](https://chanfana.pages.dev/) and [Hono documentation](https://hono.dev/docs).

## Development

1. Run `wrangler dev` to start a local instance of the API.
2. Open `http://localhost:8787/` in your browser to see the Swagger interface where you can try the endpoints.
3. Changes made in the `src/` folder will automatically trigger the server to reload, you only need to refresh the Swagger interface.

### Local HTTP debug logs

- Run `pnpm dev:log` to tee JSON logs into `log.txt` (includes downstream + upstream URL / request body / response).
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
