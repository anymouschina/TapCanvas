export const API_DOCS_ZH_MD = `# TapCanvas Hono API 接口文档（可复制）

- OpenAPI JSON：\`GET /openapi.json\`
- Markdown 原文：\`GET /docs.md\`

## 数据结构

### DemoTask

\`\`\`ts
type DemoTask = {
  name: string
  slug: string
  description?: string
  completed: boolean
  due_date: string // ISO 8601 datetime
}
\`\`\`

## Demo Tasks（示例任务）

### 1) 列出任务

- \`GET /api/tasks\`
- Query
  - \`page\`：number，默认 \`0\`
  - \`isCompleted\`：\`true\` | \`false\`（可选）

参考响应（200）：

\`\`\`json
{
  "success": true,
  "tasks": [
    {
      "name": "lorem",
      "slug": "lorem-1",
      "description": "任务描述（可选）",
      "completed": false,
      "due_date": "2026-01-01T00:00:00.000Z"
    }
  ]
}
\`\`\`

### 2) 创建任务

- \`POST /api/tasks\`
- Body（\`application/json\`）：DemoTask

参考响应（200）：

\`\`\`json
{
  "success": true,
  "task": {
    "name": "lorem",
    "slug": "lorem-1",
    "description": "任务描述（可选）",
    "completed": false,
    "due_date": "2026-01-01T00:00:00.000Z"
  }
}
\`\`\`

参考响应（409）：

\`\`\`json
{
  "success": false,
  "error": "Task slug already exists"
}
\`\`\`

### 3) 获取单个任务

- \`GET /api/tasks/{taskSlug}\`

参考响应（200）：

\`\`\`json
{
  "success": true,
  "task": {
    "name": "lorem",
    "slug": "lorem-1",
    "description": "任务描述（可选）",
    "completed": false,
    "due_date": "2026-01-01T00:00:00.000Z"
  }
}
\`\`\`

参考响应（404）：

\`\`\`json
{
  "success": false,
  "error": "Task not found"
}
\`\`\`

### 4) 删除任务

- \`DELETE /api/tasks/{taskSlug}\`

参考响应（200）：

\`\`\`json
{
  "success": true,
  "task": {
    "name": "lorem",
    "slug": "lorem-1",
    "description": "任务描述（可选）",
    "completed": false,
    "due_date": "2026-01-01T00:00:00.000Z"
  }
}
\`\`\`

参考响应（404）：

\`\`\`json
{
  "success": false,
  "error": "Task not found"
}
\`\`\`

## 通用校验错误（OpenAPI 路由）

- HTTP 400

\`\`\`json
{
  "success": false,
  "error": "请求参数不合法",
  "issues": []
}
\`\`\`

---

## 外站 Public API（JWT / X-API-Key）

用于“其他网站”或“画布内登录用户”调用绘图/视频/任务查询接口：\`JWT\` 或 \`API Key\` 二选一即可。

### 1) 认证与安全

- 登录用户（画布内推荐）：
  - \`Authorization: Bearer <tap_token>\`（登录 JWT；用于鉴权/计费/资源归属）
- 外部系统（推荐）：
  - \`X-API-Key: tc_sk_...\`
  - 或（兼容）\`Authorization: Bearer tc_sk_...\`
- 同时携带（可选）：
  - \`X-API-Key: tc_sk_...\`（通道 Key）
  - \`Authorization: Bearer <tap_token>\`（登录 JWT）
  - 计费与归属：优先使用 JWT 对应的用户（“谁用扣谁的费”）
- CORS：
  - 已允许任意 \`Origin\` 跨站调用（仍需具备 JWT 或 API Key）。

### 2) 通用返回结构

大部分接口返回：

\`\`\`json
{
  "vendor": "auto 或具体厂商",
  "result": {
    "id": "task id",
    "kind": "text_to_image | image_edit | text_to_video | ...",
    "status": "queued | running | succeeded | failed",
    "assets": [{ "type": "image|video", "url": "...", "thumbnailUrl": null }],
    "raw": {}
  }
}
\`\`\`

当 \`status\` 为 \`queued/running\` 时，用 \`/public/tasks/result\` 轮询结果。

### 3) 绘图

- \`POST /public/draw\`

请求体（简化版）：

\`\`\`json
{
  "vendor": "auto",
  "prompt": "一张电影感海报…",
  "kind": "text_to_image",
  "extras": { "modelAlias": "nano-banana-pro", "aspectRatio": "1:1" }
}
\`\`\`

说明：
- \`vendor=auto\` 会在系统级已启用且已配置的厂商列表中依次尝试，直到成功或候选耗尽（可用厂商来自 \`/model-catalog/vendors\`；顺序可能基于近期成功率动态排序）。
- \`extras.modelAlias\` 用于选择模型（Public 统一别名；推荐；默认=同 modelKey）。不同厂商可以配置同一个别名，从而让外部调用不用关心具体厂商的 modelKey。
- 兼容：仍支持 \`extras.modelKey\`（厂商内 modelKey），但不建议对外暴露。
- 当 \`vendor=auto\` 且未传 \`extras.modelAlias\` 时，服务端会优先按 \`extras.modelKey\` 做真实 \`model_key\` 匹配；只有在找不到可用 \`model_key\` 时，才会把它当作别名做兼容解析。
- 当调用方把真实 \`model_key\` 误传进 \`extras.modelAlias\` 时，服务端也会先按 alias 查找；若 alias 不存在，再按精确 \`model_key\` 做兼容解析。

请求体（完整字段，按需填写）：
- \`vendor?: string\`（默认 \`auto\`）
- \`vendorCandidates?: string[]\`（可选；仅当 \`vendor=auto\` 时生效：限制候选厂商范围，例如 \`["apimart"]\`）
- \`kind?: "text_to_image" | "image_edit"\`（默认 \`text_to_image\`）
- \`prompt: string\`（必填）
- \`negativePrompt?: string\`（可选；不同厂商可能忽略）
- \`seed?: number\`（可选；不同厂商可能忽略）
- \`width?: number\` / \`height?: number\`（可选；像素。\`qwen\` 会严格使用（默认 \`1328×1328\`）；其他厂商可能忽略或仅用于推断横竖构图）
- \`steps?: number\` / \`cfgScale?: number\`（可选；不同厂商可能忽略）
- \`extras?: object\`（可选；透传给模型/网关，常用字段：\`modelKey\` / \`aspectRatio\` / \`referenceImages\` / \`resolution\` / \`imageResolution\`）
  - \`extras.modelAlias?: string\`（模型别名选择；推荐）
  - \`extras.modelKey?: string\`（模型 Key（厂商内）；兼容）

尺寸/分辨率示例：

- 严格像素宽高（推荐：显式指定 \`vendor=qwen\`）：

\`\`\`json
{
  "vendor": "qwen",
  "kind": "text_to_image",
  "prompt": "一张电影感海报，中文“TapCanvas”，高细节，干净背景",
  "width": 1328,
  "height": 1328,
  "extras": { "modelAlias": "qwen-image-plus" }
}
\`\`\`

- 仅控制构图比例（\`vendor=auto\` 常用；不同通道支持不一）：

\`\`\`json
{
  "vendor": "auto",
  "kind": "text_to_image",
  "prompt": "一张电影感海报，中文“TapCanvas”，高细节，干净背景",
  "extras": { "modelAlias": "nano-banana-pro", "aspectRatio": "16:9" }
}
\`\`\`

### 4) 图像理解

- \`POST /public/vision\`

请求体：

\`\`\`json
{
  "vendor": "auto",
  "imageUrl": "https://github.com/dianping/cat/raw/master/cat-home/src/main/webapp/images/logo/cat_logo03.png",
  "prompt": "请详细分析我提供的图片，推测可用于复现它的英文提示词，包含主体、环境、镜头、光线和风格。输出必须是纯英文提示词，不要添加中文备注或翻译。",
  "modelAlias": "gemini-3.1-flash-image-preview",
  "temperature": 0.2
}
\`\`\`

说明：
- 图片输入二选一：\`imageUrl\`（http(s)）或 \`imageData\`（\`data:image/*;base64,...\`）。
- \`vendor=auto\` 会在系统级已启用且已配置的厂商列表中依次尝试，直到成功或候选耗尽（顺序可能基于近期成功率动态排序）。
- \`modelAlias\`（推荐）/ \`modelKey\`（兼容）用于选模；只有两者都未传时，才会默认使用 \`gemini-3.1-flash-image-preview\`。
- 若 \`modelAlias\` 本身就是一个真实 \`model_key\`，服务端会在 alias 查找失败后自动切到精确 \`model_key\` 匹配。

参考响应（200）：

\`\`\`json
{
  "id": "task_01HXYZ...",
  "vendor": "yunwu",
  "text": "A clean minimal logo of a cat..."
}
\`\`\`

### 5) 生成视频

- \`POST /public/video\`

请求体（简化版）：

\`\`\`json
{
  "vendor": "auto",
  "prompt": "雨夜霓虹街头，一只白猫缓慢走过…",
  "durationSeconds": 10,
  "extras": { "modelAlias": "<YOUR_VIDEO_MODEL_ALIAS>" }
}
\`\`\`

说明：
- \`vendor=auto\` 会在系统级已启用且已配置的厂商列表中依次尝试，直到成功或候选耗尽（顺序可能基于近期成功率动态排序）。
- 视频任务如果需要“参考图/首帧图”，推荐传 \`extras.firstFrameUrl\`；也兼容简写 \`extras.url\`（单图）或 \`extras.urls\` / \`extras.referenceImages\`（多图）。

请求体（完整字段，按需填写）：
- \`vendor?: string\`（默认 \`auto\`）
- \`vendorCandidates?: string[]\`（可选；仅当 \`vendor=auto\` 时生效：限制候选厂商范围，例如 \`["apimart"]\`）
- \`prompt: string\`（必填）
- \`durationSeconds?: number\`（可选；会写入 \`extras.durationSeconds\`；不同厂商会做归一化/截断）
- \`extras?: object\`（可选；透传给模型/网关，常用字段：\`modelKey\` / \`durationSeconds\` / \`firstFrameUrl\` / \`firstFrameImage\` / \`first_frame_image\` / \`url\` / \`lastFrameUrl\` / \`urls\` / \`referenceImages\` / \`orientation\` / \`size\` / \`resolution\` / \`promptOptimizer\`）
  - \`extras.modelAlias?: string\`（模型别名选择；推荐）
  - \`extras.modelKey?: string\`（模型 Key（厂商内）；兼容）

参考响应（200）：

\`\`\`json
{
  "vendor": "veo",
  "result": {
    "id": "task_01HXYZ...",
    "kind": "text_to_video",
    "status": "queued",
    "assets": [],
    "raw": {}
  }
}
\`\`\`
`;

function escapeHtml(raw: string) {
	return raw
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

export function renderCopyableDocsHtml(options: {
	title: string;
	markdown: string;
	openapiJsonUrl: string;
	rawMarkdownUrl: string;
	endpointExplorerUrl?: string;
}) {
	const title = escapeHtml(options.title);
	const markdownEscaped = escapeHtml(options.markdown);
	const openapiJsonUrl = escapeHtml(options.openapiJsonUrl);
	const rawMarkdownUrl = escapeHtml(options.rawMarkdownUrl);
	const endpointExplorerUrl = options.endpointExplorerUrl
		? escapeHtml(options.endpointExplorerUrl)
		: null;

	return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"; }
      .page { max-width: 980px; margin: 0 auto; padding: 24px 16px 40px; }
      .top { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; justify-content: space-between; }
      .title { font-size: 18px; font-weight: 700; }
      .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .btn { cursor: pointer; border: 1px solid rgba(127,127,127,.4); background: rgba(127,127,127,.12); padding: 8px 10px; border-radius: 10px; font-size: 13px; }
      .btn:active { transform: translateY(1px); }
      .link { font-size: 13px; opacity: .9; }
      .hint { margin: 12px 0 10px; font-size: 13px; opacity: .75; }
      .md { width: 100%; min-height: 72vh; padding: 12px; border-radius: 12px; border: 1px solid rgba(127,127,127,.35); background: rgba(127,127,127,.08); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; line-height: 1.5; }
      .status { font-size: 12px; opacity: .75; }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="top">
        <div class="title">${title}</div>
        <div class="actions">
          <button class="btn" id="copyBtn" type="button">一键复制 Markdown</button>
          ${
						endpointExplorerUrl
							? `<a class="link" href="${endpointExplorerUrl}">单接口可视化</a>`
							: ""
					}
          <a class="link" href="${rawMarkdownUrl}">打开 Markdown 原文</a>
          <a class="link" href="${openapiJsonUrl}">打开 OpenAPI JSON</a>
        </div>
      </div>
      <div class="hint">提示：点击「一键复制 Markdown」即可复制整份文档（含接口定义与参考响应）。</div>
      <textarea class="md" id="md" spellcheck="false">${markdownEscaped}</textarea>
      <div class="status" id="status"></div>
    </div>
    <script>
      const md = document.getElementById('md')
      const status = document.getElementById('status')
      const copyBtn = document.getElementById('copyBtn')
      function setStatus(text) { status.textContent = text || '' }
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(md.value)
          setStatus('已复制到剪贴板')
          setTimeout(() => setStatus(''), 1500)
        } catch (e) {
          setStatus('复制失败：浏览器可能禁用了 clipboard API（可手动全选复制）')
        }
      })
    </script>
  </body>
</html>`;
}

export function renderEndpointExplorerHtml(options: {
	title: string;
	openapiJsonUrl: string;
	copyableDocsUrl: string;
	rawMarkdownUrl: string;
}) {
	const title = escapeHtml(options.title);
	const openapiJsonUrl = escapeHtml(options.openapiJsonUrl);
	const copyableDocsUrl = escapeHtml(options.copyableDocsUrl);
	const rawMarkdownUrl = escapeHtml(options.rawMarkdownUrl);

	return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"; }
      a { color: inherit; }
      .app { display: grid; grid-template-columns: 340px 1fr; height: 100vh; }
      .side { border-right: 1px solid rgba(127,127,127,.25); padding: 14px; overflow: auto; background: rgba(127,127,127,.04); }
      .main { padding: 18px; overflow: auto; }
      .top { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
      .title { font-size: 16px; font-weight: 700; }
      .links { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; opacity: .9; }
      .search { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(127,127,127,.35); background: rgba(127,127,127,.08); font-size: 13px; margin: 12px 0; }
      .list { display: grid; gap: 8px; }
      .item { cursor: pointer; display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: center; padding: 10px 10px; border-radius: 12px; border: 1px solid rgba(127,127,127,.25); background: rgba(127,127,127,.06); }
      .item:hover { background: rgba(127,127,127,.10); }
      .item.active { border-color: rgba(84, 166, 255, .65); background: rgba(84, 166, 255, .12); }
      .method { font-size: 11px; font-weight: 800; letter-spacing: .06em; padding: 3px 8px; border-radius: 999px; border: 1px solid rgba(127,127,127,.35); }
      .m-get { background: rgba(40, 167, 69, .18); }
      .m-post { background: rgba(0, 123, 255, .18); }
      .m-put { background: rgba(255, 193, 7, .18); }
      .m-patch { background: rgba(255, 193, 7, .18); }
      .m-delete { background: rgba(220, 53, 69, .18); }
      .path { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; }
      .summary { font-size: 12px; opacity: .8; margin-top: 2px; }
      .section { margin-top: 18px; }
      .h2 { font-size: 13px; font-weight: 800; margin: 0 0 10px; }
      .meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; opacity: .85; margin-top: 6px; }
      .pill { padding: 3px 8px; border-radius: 999px; border: 1px solid rgba(127,127,127,.3); background: rgba(127,127,127,.06); }
      .grid { display: grid; gap: 10px; }
      .card { border: 1px solid rgba(127,127,127,.25); border-radius: 14px; padding: 12px; background: rgba(127,127,127,.05); }
      .row { display: grid; grid-template-columns: 140px 1fr; gap: 10px; padding: 8px 0; border-top: 1px dashed rgba(127,127,127,.25); }
      .row:first-child { border-top: none; padding-top: 0; }
      .k { font-size: 12px; opacity: .8; }
      .v { font-size: 12px; }
      pre { margin: 8px 0 0; padding: 10px; border-radius: 12px; border: 1px solid rgba(127,127,127,.25); background: rgba(127,127,127,.08); overflow: auto; font-size: 12px; line-height: 1.45; }
      .btn { cursor: pointer; border: 1px solid rgba(127,127,127,.4); background: rgba(127,127,127,.12); padding: 6px 10px; border-radius: 10px; font-size: 12px; }
      .btn:active { transform: translateY(1px); }
      .btnRow { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
      .muted { opacity: .75; }
      .empty { opacity: .75; font-size: 13px; padding: 10px 0; }
      @media (max-width: 920px) { .app { grid-template-columns: 1fr; height: auto; } .side { border-right: none; border-bottom: 1px solid rgba(127,127,127,.25); } }
    </style>
  </head>
  <body>
    <div class="app">
      <aside class="side">
        <div class="top">
          <div class="title">${title}</div>
          <div class="links">
            <a href="${copyableDocsUrl}">可复制文档</a>
            <a href="${rawMarkdownUrl}">Markdown</a>
            <a href="${openapiJsonUrl}">OpenAPI</a>
          </div>
        </div>
        <input class="search" id="search" placeholder="搜索：path / summary / tag（例如 /tasks 或 创建）" />
        <div class="list" id="list"></div>
        <div class="empty" id="listEmpty" style="display:none">没有匹配的接口</div>
      </aside>
      <main class="main">
        <div id="detail" class="empty">加载中…</div>
      </main>
    </div>
    <script>
      const OPENAPI_URL = ${JSON.stringify(openapiJsonUrl)}

      const methodsOrder = ['get','post','put','patch','delete','options','head','trace']
      const listEl = document.getElementById('list')
      const listEmptyEl = document.getElementById('listEmpty')
      const searchEl = document.getElementById('search')
      const detailEl = document.getElementById('detail')

      function escapeHtml(raw) {
        return String(raw ?? '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('\"', '&quot;')
          .replaceAll(\"'\", '&#039;')
      }

      function schemaType(schema) {
        const t = schema?.type
        if (Array.isArray(t)) return t.find(x => x !== 'null') || t[0]
        return t
      }

      function resolveRef(spec, ref) {
        const prefix = '#/components/schemas/'
        if (typeof ref !== 'string' || !ref.startsWith(prefix)) return null
        const name = ref.slice(prefix.length)
        return spec?.components?.schemas?.[name] ? { __ref: name, ...spec.components.schemas[name] } : null
      }

      function unwrapSchema(spec, schema) {
        if (!schema) return null
        if (schema.$ref) return unwrapSchema(spec, resolveRef(spec, schema.$ref) || schema)
        if (Array.isArray(schema.allOf) && schema.allOf.length) return unwrapSchema(spec, schema.allOf[0])
        if (Array.isArray(schema.anyOf) && schema.anyOf.length) return unwrapSchema(spec, schema.anyOf[0])
        if (Array.isArray(schema.oneOf) && schema.oneOf.length) return unwrapSchema(spec, schema.oneOf[0])
        return schema
      }

      function buildExampleFromSchema(spec, schema) {
        const s = unwrapSchema(spec, schema) || schema
        if (!s) return null
        if (s.example !== undefined) return s.example
        if (s.default !== undefined) return s.default
        if (Array.isArray(s.enum) && s.enum.length) return s.enum[0]

        const t = schemaType(s)
        if (t === 'object') {
          const out = {}
          const props = s.properties || {}
          for (const key of Object.keys(props)) {
            out[key] = buildExampleFromSchema(spec, props[key])
          }
          return out
        }
        if (t === 'array') {
          return [buildExampleFromSchema(spec, s.items)]
        }
        if (t === 'string') {
          if (s.format === 'date-time') return '2026-01-01T00:00:00.000Z'
          if (s.format === 'uuid') return '00000000-0000-0000-0000-000000000000'
          if (s.minLength && s.minLength > 0) return 'string'
          return 'string'
        }
        if (t === 'integer' || t === 'number') {
          if (typeof s.minimum === 'number') return s.minimum
          return 0
        }
        if (t === 'boolean') return false
        return null
      }

      function pickJsonExample(spec, media) {
        if (!media) return null
        if (media.example !== undefined) return media.example
        const schema = media.schema
        const unwrapped = unwrapSchema(spec, schema) || schema
        if (unwrapped?.example !== undefined) return unwrapped.example
        return buildExampleFromSchema(spec, unwrapped)
      }

      function fmt(obj) {
        try { return JSON.stringify(obj, null, 2) } catch { return String(obj) }
      }

      function methodClass(method) {
        return method === 'get' ? 'm-get' :
               method === 'post' ? 'm-post' :
               method === 'put' ? 'm-put' :
               method === 'patch' ? 'm-patch' :
               method === 'delete' ? 'm-delete' : ''
      }

      function buildOperations(spec) {
        const out = []
        const paths = spec?.paths || {}
        for (const path of Object.keys(paths)) {
          const item = paths[path] || {}
          for (const method of methodsOrder) {
            if (!item[method]) continue
            const op = item[method]
            out.push({
              path,
              method,
              summary: op.summary || '',
              tags: Array.isArray(op.tags) ? op.tags : [],
              op,
            })
          }
        }
        return out
      }

      function renderList(ops, selected) {
        listEl.innerHTML = ''
        listEmptyEl.style.display = ops.length ? 'none' : 'block'
        for (const o of ops) {
          const btn = document.createElement('div')
          btn.className = 'item' + (selected && selected.path === o.path && selected.method === o.method ? ' active' : '')
          btn.dataset.path = o.path
          btn.dataset.method = o.method
          btn.innerHTML = \`
            <div class="method \${methodClass(o.method)}">\${escapeHtml(o.method.toUpperCase())}</div>
            <div>
              <div class="path">\${escapeHtml(o.path)}</div>
              <div class="summary">\${escapeHtml(o.summary || (o.tags[0] ? ('[' + o.tags[0] + ']') : ''))}</div>
            </div>\`
          btn.addEventListener('click', () => selectOperation(o))
          listEl.appendChild(btn)
        }
      }

      function updateUrlQuery(path, method) {
        const url = new URL(window.location.href)
        url.searchParams.set('path', path)
        url.searchParams.set('method', method)
        window.history.replaceState({}, '', url.toString())
      }

      function copyText(text) {
        return navigator.clipboard.writeText(text)
      }

      function renderParams(spec, op) {
        const params = Array.isArray(op.parameters) ? op.parameters : []
        if (!params.length) return '<div class="empty">无</div>'
        return params.map(p => {
          const schema = unwrapSchema(spec, p.schema) || p.schema
          const t = schemaType(schema) || ''
          const fmtStr = schema?.format ? (' (' + schema.format + ')') : ''
          const ex = p.example ?? schema?.example ?? schema?.default ?? (Array.isArray(schema?.enum) ? schema.enum[0] : undefined)
          return \`
            <div class="row">
              <div class="k">\${escapeHtml(p.name)} <span class="muted">(\${escapeHtml(p.in)})</span></div>
              <div class="v">
                <div><span class="pill">\${escapeHtml(String(t) + fmtStr)}</span> \${p.required ? '<span class="pill">必填</span>' : '<span class="pill">可选</span>'}</div>
                \${p.description ? ('<div class="muted" style="margin-top:6px">' + escapeHtml(p.description) + '</div>') : ''}
                \${ex !== undefined ? ('<pre>' + escapeHtml(fmt(ex)) + '</pre>') : ''}
              </div>
            </div>\`
        }).join('')
      }

      function renderBody(spec, op) {
        const rb = op.requestBody
        if (!rb || !rb.content) return '<div class="empty">无</div>'
        const content = rb.content || {}
        const entries = Object.keys(content)
        if (!entries.length) return '<div class="empty">无</div>'
        return entries.map(ct => {
          const media = content[ct]
          const schema = unwrapSchema(spec, media?.schema) || media?.schema
          const ex = pickJsonExample(spec, media) ?? buildExampleFromSchema(spec, schema)
          return \`
            <div class="card">
              <div><span class="pill">\${escapeHtml(ct)}</span> \${rb.required ? '<span class="pill">必填</span>' : '<span class="pill">可选</span>'}</div>
              \${ex !== null && ex !== undefined ? ('<pre>' + escapeHtml(fmt(ex)) + '</pre>') : ''}
              <details style="margin-top:10px">
                <summary class="muted">查看 Schema</summary>
                <pre>\${escapeHtml(fmt(schema))}</pre>
              </details>
            </div>\`
        }).join('')
      }

      function renderResponses(spec, op) {
        const res = op.responses || {}
        const codes = Object.keys(res).sort((a,b) => {
          const na = Number(a); const nb = Number(b)
          if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
          return a.localeCompare(b)
        })
        if (!codes.length) return '<div class="empty">无</div>'
        return codes.map(code => {
          const r = res[code]
          const desc = r?.description || ''
          const content = r?.content || {}
          const cts = Object.keys(content)
          const blocks = cts.length ? cts.map(ct => {
            const media = content[ct]
            const schema = unwrapSchema(spec, media?.schema) || media?.schema
            const ex = pickJsonExample(spec, media) ?? buildExampleFromSchema(spec, schema)
            return \`
              <div class="card">
                <div><span class="pill">\${escapeHtml(ct)}</span></div>
                \${ex !== null && ex !== undefined ? ('<pre>' + escapeHtml(fmt(ex)) + '</pre>') : ''}
                <details style="margin-top:10px">
                  <summary class="muted">查看 Schema</summary>
                  <pre>\${escapeHtml(fmt(schema))}</pre>
                </details>
              </div>\`
          }).join('') : '<div class="empty">无 body</div>'
          return \`
            <div class="card">
              <div><span class="pill">HTTP \${escapeHtml(code)}</span> \${desc ? '<span class="muted">' + escapeHtml(desc) + '</span>' : ''}</div>
              <div class="grid" style="margin-top:10px">\${blocks}</div>
            </div>\`
        }).join('')
      }

      let spec = null
      let operations = []
      let filtered = []
      let selected = null

      function selectOperation(o) {
        selected = o
        updateUrlQuery(o.path, o.method)
        renderList(filtered, selected)
        const op = o.op
        const header = \`
          <div class="title"><span class="method \${methodClass(o.method)}">\${escapeHtml(o.method.toUpperCase())}</span>
            <span class="path" style="margin-left:8px">\${escapeHtml(o.path)}</span>
          </div>\`
        const summary = op.summary ? ('<div class="muted" style="margin-top:6px">' + escapeHtml(op.summary) + '</div>') : ''
        const tags = (Array.isArray(op.tags) && op.tags.length)
          ? ('<div class="meta">' + op.tags.map(t => '<span class="pill">' + escapeHtml(t) + '</span>').join('') + '</div>')
          : ''
        const btnRow = \`
          <div class="btnRow">
            <button class="btn" id="copyOpJson" type="button">复制该接口 JSON</button>
            <button class="btn" id="copyLink" type="button">复制直达链接</button>
          </div>\`

        detailEl.innerHTML = \`
          \${header}
          \${summary}
          \${tags}
          \${btnRow}
          <div class="section">
            <div class="h2">参数（Parameters）</div>
            <div class="card">\${renderParams(spec, op)}</div>
          </div>
          <div class="section">
            <div class="h2">请求体（Request Body）</div>
            <div class="grid">\${renderBody(spec, op)}</div>
          </div>
          <div class="section">
            <div class="h2">响应（Responses）</div>
            <div class="grid">\${renderResponses(spec, op)}</div>
          </div>
        \`

        const opJsonBtn = document.getElementById('copyOpJson')
        const linkBtn = document.getElementById('copyLink')
        opJsonBtn?.addEventListener('click', async () => {
          try {
            await copyText(fmt(op))
            opJsonBtn.textContent = '已复制'
            setTimeout(() => opJsonBtn.textContent = '复制该接口 JSON', 1200)
          } catch {
            opJsonBtn.textContent = '复制失败'
            setTimeout(() => opJsonBtn.textContent = '复制该接口 JSON', 1200)
          }
        })
        linkBtn?.addEventListener('click', async () => {
          try {
            await copyText(window.location.href)
            linkBtn.textContent = '已复制'
            setTimeout(() => linkBtn.textContent = '复制直达链接', 1200)
          } catch {
            linkBtn.textContent = '复制失败'
            setTimeout(() => linkBtn.textContent = '复制直达链接', 1200)
          }
        })
      }

      function applyFilter() {
        const q = String(searchEl.value || '').trim().toLowerCase()
        if (!q) {
          filtered = operations.slice()
        } else {
          filtered = operations.filter(o => {
            const hay = (o.path + ' ' + o.method + ' ' + (o.summary || '') + ' ' + (o.tags || []).join(' ')).toLowerCase()
            return hay.includes(q)
          })
        }
        if (selected && !filtered.some(o => o.path === selected.path && o.method === selected.method)) {
          selected = filtered[0] || null
        }
        renderList(filtered, selected)
        if (selected) selectOperation(selected)
        if (!selected) detailEl.innerHTML = '<div class="empty">没有可显示的接口</div>'
      }

      async function main() {
        try {
          const res = await fetch(OPENAPI_URL)
          spec = await res.json()
          operations = buildOperations(spec)

          const url = new URL(window.location.href)
          const qpPath = url.searchParams.get('path')
          const qpMethod = (url.searchParams.get('method') || '').toLowerCase()
          const initial = qpPath && qpMethod
            ? operations.find(o => o.path === qpPath && o.method === qpMethod)
            : operations[0]
          selected = initial || null
          filtered = operations.slice()
          renderList(filtered, selected)
          if (selected) selectOperation(selected)
          searchEl.addEventListener('input', () => applyFilter())
        } catch (e) {
          detailEl.innerHTML = '<div class="empty">加载失败：请确认 /openapi.json 可访问</div>'
        }
      }

      main()
    </script>
  </body>
</html>`
}
