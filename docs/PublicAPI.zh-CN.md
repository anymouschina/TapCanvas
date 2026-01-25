# 外站 Public API（X-API-Key）

用于“其他网站”通过你在 `/stats` 里生成的 `API Key` 调用绘图/视频/任务查询接口。

## 1. 认证与安全

- Header（推荐）：
  - `X-API-Key: tc_sk_...`
  - 或 `Authorization: Bearer tc_sk_...`
- Origin 白名单：
  - 浏览器跨站调用会自动携带 `Origin`，必须命中你创建 Key 时配置的白名单。
  - 纯服务端（Node/Go/Java）请求通常没有 `Origin`：此时请在 Key 的 `allowedOrigins` 配置 `*`，或自行补 `Origin` 请求头。

## 2. 通用返回结构

大部分接口返回：

```json
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
```

当 `status` 为 `queued/running` 时，用 `/public/tasks/result` 轮询结果。

## 3. 接口列表

### 3.1 绘图

`POST /public/draw`

请求体（简化版）：

```json
{
  "vendor": "auto",
  "prompt": "一张电影感海报…",
  "kind": "text_to_image",
  "extras": { "modelKey": "nano-banana-pro" }
}
```

说明：
- `vendor=auto` 会在可用厂商中自动回退（按任务类型）。
- `extras.modelKey` 可用于选择模型（例如 Nano Banana 系列）。

### 3.2 生成视频

`POST /public/video`

请求体（简化版）：

```json
{
  "vendor": "auto",
  "prompt": "雨夜霓虹街头，一只白猫缓慢走过…",
  "durationSeconds": 10,
  "extras": { "modelKey": "veo3.1-fast" }
}
```

说明：
- `vendor=auto` 默认优先 `veo` / `sora2api`，如带首帧参数也会尝试 `minimax`。
- MiniMax（hailuo）通常需要首帧图片，放在 `extras.firstFrameUrl` / `extras.firstFrameImage` / `extras.first_frame_image` / `extras.url` 等字段中。

### 3.3 查任务（轮询）

`POST /public/tasks/result`

请求体（建议传 `taskKind`）：

```json
{
  "taskId": "xxxx",
  "taskKind": "text_to_video"
}
```

说明：
- 一般不需要传 `vendor`：后端会基于任务创建时写入的映射自动推断。
- 若你自己保存了 vendor，也可传 `vendor`（支持 `auto` / `veo` / `sora2api` / `minimax` 等）。

### 3.4 统一入口（高级）

`POST /public/tasks`

请求体：

```json
{
  "vendor": "auto",
  "request": {
    "kind": "text_to_image",
    "prompt": "…",
    "extras": {}
  }
}
```

当你希望完全复用内部 `TaskRequest` 结构时使用。

### 3.5 文本（可选）

`POST /public/chat`

请求体：

```json
{
  "vendor": "auto",
  "prompt": "你好，请用中文回答…",
  "systemPrompt": "请用中文回答。",
  "temperature": 0.7
}
```

## 4. 渠道（grsai/comfly）与自动均衡

- 渠道 Key/Host 在 `/stats -> 系统管理 -> 渠道配置` 中由管理员配置。
- 当同一能力同时启用多个渠道（例如 grsai 与 comfly 都启用且都可代理某 vendor）时，后端会参考近 7 天成功率优先选择更稳定的渠道，以提升整体可用性。

## 5. 本地查看与提示

- 服务端内置的 OpenAPI（演示接口）入口：`http://localhost:8788/`
- Public API 的快速示例代码也可在 `/stats -> 系统管理` 页面直接复制。

