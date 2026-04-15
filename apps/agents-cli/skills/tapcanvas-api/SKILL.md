---
name: tapcanvas-api
description: 统一的 TapCanvas API skill。凡是要通过 TapCanvas 项目的 `/public/*` 接口完成 chat、draw、vision、video、tasks/result、flows 读写时，都必须使用这个 skill，而不是再使用分散的 tapcanvas-vision、tapcanvas-public-chat-ui-code 或其他平行 API skill。此 skill 通过同目录 `config.json` 配置 `apiBaseUrl` 和 `apiKey`，并通过脚本统一发起请求。
---

# TapCanvas API

这是 TapCanvas 项目对外 API 的唯一 skill。

目标：
- 为 TapCanvas 项目的公共接口提供唯一调用入口。
- 用一个统一配置文件管理 `apiBaseUrl` 和 `apiKey`。
- 明确失败，不做静默降级、不猜测默认接口、不切换到旧 skill。

## 唯一路径

涉及以下任一场景时，只能使用本 skill：
- 调用 `/public/agents/chat`
- 调用 `/public/draw`
- 调用 `/public/vision`
- 调用 `/public/video`
- 调用 `/public/tasks/result`
- 调用 `/public/flows` 相关接口

禁止：
- 再使用分散的 TapCanvas API skill
- 在不同 skill 里各自维护一套 `apiKey` / `apiBaseUrl`
- 未经确认地改用其他 endpoint 或本地伪造结果

## 配置

必须读取同目录下的 `config.json`：

```json
{
  "apiBaseUrl": "http://localhost:8788",
  "apiKey": "tc_sk_xxx"
}
```

字段说明：
- `apiBaseUrl`: TapCanvas API 域名或本地开发地址，不带尾部斜杠更清晰
- `apiKey`: 当前用户生成的 API Key

优先级：
1. 脚本参数显式传入
2. `config.json`
3. 环境变量 `TAPCANVAS_API_BASE_URL` / `TAPCANVAS_API_KEY`

如果最终缺少 `apiBaseUrl` 或 `apiKey`，必须直接失败。

## 执行方式

统一使用脚本：

```bash
node apps/agents-cli/skills/tapcanvas-api/scripts/call.mjs \
  --endpoint chat \
  --payload '{"vendor":"auto","prompt":"你好"}'
```

也支持 payload 文件：

```bash
node apps/agents-cli/skills/tapcanvas-api/scripts/call.mjs \
  --endpoint draw \
  --payloadFile /abs/path/request.json
```

## Endpoint 规则

可用 endpoint：
- `chat` -> `POST /public/agents/chat`
- `draw` -> `POST /public/draw`
- `vision` -> `POST /public/vision`
- `video` -> `POST /public/video`
- `taskResult` -> `POST /public/tasks/result`
- `flows` -> `GET /public/projects/:projectId/flows`
- `flowGet` -> `GET /public/flows/:id`
- `flowPatch` -> `POST /public/flows/:id/patch`

规则：
- `chat/draw/vision/video/taskResult` 必须传 `payload`
- `flows` 必须传 `--projectId`
- `flowGet` 必须传 `--flowId`
- `flowPatch` 必须同时传 `--flowId` 和 `payload`
- 当前公开接口没有“列出当前用户全部 projects / flows”的 discovery endpoint；要验证或操作真实用户画布数据，调用方必须先提供真实 `projectId` 或 `flowId`

## 推荐请求模板

### chat

```json
{
  "vendor": "auto",
  "prompt": "请帮我完成当前任务",
  "temperature": 0.2
}
```

### draw

```json
{
  "vendor": "auto",
  "prompt": "一个极简风格的白色产品海报",
  "extras": {
    "modelAlias": "nano-banana-pro",
    "aspectRatio": "1:1"
  }
}
```

### vision

```json
{
  "vendor": "auto",
  "imageUrl": "https://example.com/demo.png",
  "prompt": "请分析这张图片并给出可复现英文提示词",
  "modelAlias": "gemini-3.1-flash-image-preview",
  "temperature": 0.2
}
```

### video

```json
{
  "vendor": "auto",
  "prompt": "一只白猫在雨夜霓虹街头慢慢走过",
  "durationSeconds": 10,
  "extras": {
    "modelAlias": "veo-3.1"
  }
}
```

### taskResult

```json
{
  "taskId": "your-task-id",
  "taskKind": "text_to_video"
}
```

## 工作流

1. 先判定用户目标属于哪个 endpoint。
2. 从 `config.json` 读取 `apiBaseUrl` 和 `apiKey`。
3. 组装最小必要 payload。
4. 调用统一脚本。
5. 原样检查接口结果。
6. 若返回错误，直接暴露错误与 endpoint，不做吞错。

## 画布数据验证前提

- 若目标是验证或读取真实用户画布数据，优先走：
  - 已知 `projectId`：先调用 `flows`
  - 已知 `flowId`：直接调用 `flowGet`
- 若既没有 `projectId` 也没有 `flowId`，必须直接说明“当前公开 API 不具备 discovery 能力”，而不是猜测、扫描本地状态、或绕过本 skill 走其他数据路径。

## 失败策略

- 缺少配置：直接失败。
- payload 非法：直接失败。
- 网络错误：直接报具体 URL 和系统错误。
- 后端返回 4xx/5xx：保留原始响应摘要并失败。
- 禁止自动切换到旧 skill、旧 endpoint 或匿名模式。

## 评审标准

一个合格的调用必须满足：
- 使用了本 skill，而不是平行 skill
- 配置来自 `config.json` 或显式覆盖
- endpoint 与 payload 对应正确
- 返回结果来自真实接口
- 所有失败都能定位到真实原因
