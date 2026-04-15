# 外站 Public API（X-API-Key）

用于“其他网站”通过你在 `/stats` 里生成的 `API Key` 调用绘图/视频/任务查询接口。

## 1. 认证与安全

- Header（推荐）：
  - `X-API-Key: tc_sk_...`
  - 或 `Authorization: Bearer tc_sk_...`
- CORS：
  - 已允许任意 `Origin` 跨站调用（仍需 `X-API-Key` 鉴权）。

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
  "extras": { "modelAlias": "nano-banana-pro", "aspectRatio": "1:1" }
}
```

说明：
- `vendor=auto` 会在可用厂商中自动回退（按任务类型）。
- `extras.modelAlias` 用于选择模型（Public 统一别名；推荐）。不同厂商可以配置同一个别名，从而让外部调用不用关心具体厂商的 modelKey。
- 兼容：仍支持 `extras.modelKey`（厂商内 modelKey），但不建议对外暴露。

请求体（完整字段，按需填写）：
- `vendor?: string`（默认 `auto`；会在系统级已启用且已配置的厂商列表中依次重试；顺序可能基于近期成功率动态排序）
- `vendorCandidates?: string[]`（可选；仅当 `vendor=auto` 时生效：限制候选厂商范围，例如 `["apimart"]`）
- `kind?: "text_to_image" | "image_edit"`（默认 `text_to_image`）
- `prompt: string`（必填）
- `negativePrompt?: string`（可选；不同厂商可能忽略）
- `seed?: number`（可选；不同厂商可能忽略）
- `width?: number` / `height?: number`（可选；像素。`qwen` 会严格使用（默认 `1328×1328`）；`vendor=auto` 时其他厂商可能忽略或仅用于推断横竖构图）
- `steps?: number` / `cfgScale?: number`（可选；不同厂商可能忽略）
- `extras?: object`（可选；透传给模型/网关，常用字段：）
  - `extras.modelAlias?: string`（模型别名选择；推荐）
  - `extras.modelKey?: string`（模型 Key（厂商内）；兼容）
  - `extras.aspectRatio?: string`（建议值：`16:9` / `9:16` / `1:1` / `4:3` / `3:4` / `4:5` / `5:4` / `21:9`，或 `auto`）
  - `extras.resolution?: string`（分辨率；部分通道支持，例如 `1024x1024` / `1536x1024`；不支持时会被忽略）
  - `extras.imageResolution?: string`（`resolution` 的别名；部分通道兼容）
  - `extras.referenceImages?: string[]`（参考图/首图；可为 `https://...` 或 `data:image/*;base64,...`）

尺寸/分辨率示例：

- 严格像素宽高（推荐：显式指定 `vendor=qwen`）：

```json
{
  "vendor": "qwen",
  "kind": "text_to_image",
  "prompt": "一张电影感海报，中文“TapCanvas”，高细节，干净背景",
  "width": 1328,
  "height": 1328,
  "extras": { "modelAlias": "qwen-image-plus" }
}
```

- 仅控制构图比例（`vendor=auto` 常用；不同通道支持不一）：

```json
{
  "vendor": "auto",
  "kind": "text_to_image",
  "prompt": "一张电影感海报，中文“TapCanvas”，高细节，干净背景",
  "extras": { "modelAlias": "nano-banana-pro", "aspectRatio": "16:9" }
}
```

### 3.2 生成视频

`POST /public/video`

请求体（简化版）：

```json
{
  "vendor": "auto",
  "prompt": "雨夜霓虹街头，一只白猫缓慢走过…",
  "durationSeconds": 10,
  "extras": { "modelAlias": "veo3.1-fast" }
}
```

说明：
- `vendor=auto` 默认优先 `veo` / `sora2api`，如带首帧参数也会尝试 `minimax`。
- MiniMax（hailuo）通常需要首帧图片，放在 `extras.firstFrameUrl` / `extras.firstFrameImage` / `extras.first_frame_image` / `extras.url` 等字段中。

请求体（完整字段，按需填写）：
- `vendor?: string`（默认 `auto`）
- `prompt: string`（必填）
- `durationSeconds?: number`（可选；会写入 `extras.durationSeconds`；不同厂商会做归一化/截断）
- `extras?: object`（可选；透传给模型/网关，常用字段：）
  - `extras.modelAlias?: string`（模型别名选择；推荐）
  - `extras.modelKey?: string`（模型 Key（厂商内）；兼容）
  - `extras.durationSeconds?: number`（等价于顶层 `durationSeconds`）
  - `extras.firstFrameUrl?: string` / `extras.firstFrameImage?: string` / `extras.first_frame_image?: string` / `extras.url?: string`（首帧；MiniMax 必填）
  - `extras.lastFrameUrl?: string`（尾帧；Veo 可选）
  - `extras.urls?: string[]` / `extras.referenceImages?: string[]`（参考图；Veo 可选）
  - `extras.orientation?: "portrait" | "landscape"`（Sora2API 可选）
  - `extras.size?: string`（Sora2API 可选；部分通道支持 `1280x720` / `720x1280`）
  - `extras.resolution?: string`（MiniMax 可选）
  - `extras.promptOptimizer?: boolean` / `extras.prompt_optimizer?: boolean`（MiniMax 可选）

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
  "vendorCandidates": ["apimart"],
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

可选：`mode="auto"` + `referenceImages` 可用于“直出”类场景（例如：选中参考图后直接扩写为一组画布可执行图片节点），服务端会为 LLM 注入更强的系统约束（不追问语言/图片、优先使用参考图）。

```json
{
  "vendor": "agents",
  "mode": "auto",
  "referenceImages": ["https://example.com/reference.png"],
  "prompt": "基于这张参考图扩出 4 张同场景的连续镜头参考图，并保持人物与光线一致",
  "systemPrompt": "请始终用中文回答。",
  "temperature": 0.7
}
```

可选（本地开发）：如果后端配置了 `AGENTS_BRIDGE_BASE_URL`，则当 `vendor=auto` 且请求 kind 为 `chat/prompt_refine` 时，会优先尝试走 `vendor=agents`（通过 HTTP 调用本地 `apps/agents-cl 进程）。你也可以显式传 `vendor: "agents"` 强制走该通道。

说明：当走 `vendor=agents` 时，请求会转发给本地 Agents CLI（`agents serve`）。该智能体支持 `Skill`（从 `AGENTS_SKILLS_DIR` 目录加载）以及 `tapcanvas_*` 工具（用于调用本后端的 `/public/*` 接口生成资产/图像理解/视频等），并默认中文输出。

### 3.6 图像理解（可选）

`POST /public/vision`

请求体：

```json
{
  "vendor": "auto",
  "imageUrl": "https://github.com/dianping/cat/raw/master/cat-home/src/main/webapp/images/logo/cat_logo03.png",
  "prompt": "请详细分析我提供的图片，推测可用于复现它的英文提示词，包含主体、环境、镜头、光线和风格。输出必须是纯英文提示词，不要添加中文备注或翻译。",
  "modelAlias": "gemini-1.5-pro-latest",
  "temperature": 0.2
}
```

说明：
- 图片输入二选一：`imageUrl`（http(s)）或 `imageData`（`data:image/*;base64,...`）。
- `vendor=auto` 会在系统级已启用且已配置的厂商列表中依次重试，直到成功或候选耗尽。
- `modelAlias`（推荐）/`modelKey`（兼容）用于选模。

返回：

```json
{
  "id": "task_01HXYZ...",
  "vendor": "yunwu",
  "text": "A clean minimal logo of a cat..."
}
```

## 4. 渠道（grsai/comfly）与自动均衡

- 渠道 Key/Host 在 `/stats -> 系统管理 -> 渠道配置` 中由管理员配置。
- 当同一能力同时启用多个渠道（例如 grsai 与 comfly 都启用且都可代理某 vendor）时，后端会参考近 7 天成功率优先选择更稳定的渠道，以提升整体可用性。

## 5. 本地查看与提示

- 服务端内置的 OpenAPI（演示接口）入口：`http://localhost:8788/`
- Public API 的快速示例代码也可在 `/stats -> 系统管理` 页面直接复制。
