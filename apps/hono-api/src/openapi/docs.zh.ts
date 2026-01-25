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
}) {
	const title = escapeHtml(options.title);
	const markdownEscaped = escapeHtml(options.markdown);
	const openapiJsonUrl = escapeHtml(options.openapiJsonUrl);
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

