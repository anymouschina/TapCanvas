# GPT Image 2 API Parameters Reference

本文档仅为 **gpt-image-2 参数方法论**。实际出图走本项目自有链路：画布 `image` 节点 / `tapcanvas_image_generate_to_canvas` → new-api 的 `gpt-image-2` 渠道。**不直连外部 API、不需要任何外部 API key、不要 curl 外部端点。** 下面的参数语义直接套用到本项目生图工具的入参。

## Model Overview

| Model | Use Case | Key Inputs |
|-------|----------|------------|
| `gpt-image-2` | Text-to-image, image editing, batch generation | prompt (+ optional reference images) |

## Parameters

| Parameter | Type | Default | Required | Description |
|-----------|------|---------|----------|-------------|
| `model` | string | — | Yes | Must be `gpt-image-2` |
| `prompt` | string | — | Yes | Image description or editing instructions. Max 32,000 characters (Unicode) |
| `image_urls` | array | — | No | Reference image URLs for editing (1-16 images, <=50MB each). Formats: .jpeg, .jpg, .png, .webp |
| `size` | string | `auto` | No | Image dimensions — ratio, pixel, or auto (see Size section) |
| `resolution` | string | `1K` | No | Resolution tier: 1K, 2K, 4K. Only with ratio sizes |
| `quality` | string | `medium` | No | Render quality: low, medium, high |
| `n` | integer | `1` | No | Number of images to generate (1-10) |
| `callback_url` | string | — | No | HTTPS callback URL for task completion |

---

## Size Parameter

Supports three formats:

### 1. Ratio Format (15 presets)

| Ratio | Description |
|-------|-------------|
| `1:1` | Square |
| `1:2` / `2:1` | Extreme portrait / landscape |
| `1:3` / `3:1` | Ultra portrait / landscape (max ratio) |
| `2:3` / `3:2` | Standard portrait / landscape |
| `3:4` / `4:3` | Traditional portrait / landscape |
| `4:5` / `5:4` | Social media common |
| `9:16` / `16:9` | Phone / desktop widescreen |
| `9:21` / `21:9` | Ultra widescreen |

### 2. Pixel Format

`WxH` (e.g., `1024x1024`, `1536x1024`, `3840x2160`)

Constraints:
- Width and height must be multiples of **16**
- Each dimension: **16 - 3840** pixels
- Pixel budget: **655,360 <= W*H <= 8,294,400** (~0.65MP to ~8.3MP)
- Max aspect ratio: **3:1**
- `resolution` parameter is **ignored** in pixel format

### 3. Auto

`auto` — model decides the best size. `resolution` does not apply.

---

## Resolution Parameter

Only applies when `size` is in ratio format.

| Tier | Pixel Budget | Example (1:1) | Example (16:9) |
|------|-------------|---------------|----------------|
| `1K` | ~1MP (1,048,576) | 1024x1024 | 1360x768 |
| `2K` | ~4MP (4,194,304) | 2048x2048 | 2736x1536 |
| `4K` | ~8.29MP (8,294,400) | 2880x2880 | 3840x2160 (UHD) |

### Full Resolution Table (Landscape / Square)

| Ratio | 1K | 2K | 4K |
|-------|----|----|-----|
| `1:1` | 1024x1024 | 2048x2048 | 2880x2880 |
| `2:1` | 1456x720 | 2896x1456 | 3840x1904* |
| `3:1` | 1776x592 | 3552x1184 | 3840x1280* |
| `3:2` | 1248x832 | 2512x1680 | 3520x2352 |
| `4:3` | 1184x880 | 2368x1776 | 3312x2480* |
| `5:4` | 1152x912 | 2288x1824 | 3216x2576 |
| `16:9` | 1360x768 | 2736x1536 | 3840x2160 |
| `21:9` | 1568x672 | 3136x1344 | 3840x1632* |

\* Auto-scaled down to fit pixel budget. Portrait ratios swap width/height.

---

## Quality Parameter

| Quality | Tile Base | Relative Cost (1024²) | Best For |
|---------|-----------|----------------------|----------|
| `low` | 16 | ~0.11x | Drafts, quick iterations |
| `medium` | 48 | 1.0x | General use (default) |
| `high` | 96 | ~4.0x | Final production, print |

Text input tokens scale linearly with `n` (count).

---

## Image Editing (image_urls)

- **Count**: 1-16 images per request
- **Max size per image**: 50MB
- **Supported formats**: `.jpeg`, `.jpg`, `.png`, `.webp`
- **URLs must be directly accessible** (direct download, not behind auth)
- Reference images consume additional image input tokens

---

## Callback URL

- **Protocol**: HTTPS only
- **No private IPs**: 127.0.0.1, 10.x.x.x, 172.16-31.x.x, 192.168.x.x are blocked
- **Max length**: 2,048 characters
- **Timeout**: 10 seconds
- **Retries**: Up to 3 times on failure (1s / 2s / 4s intervals)
- **Success**: 2xx response = success, other status codes trigger retry
- **Payload format**: Same as task query response

---

## Response Format

### Generation Response (Task Created)
```json
{
  "id": "task-unified-1757156493-imcg5zqt",
  "object": "image.generation.task",
  "created": 1757156493,
  "model": "gpt-image-2",
  "status": "pending",
  "progress": 0,
  "type": "image",
  "task_info": {
    "can_cancel": true,
    "estimated_time": 100
  },
  "usage": {
    "billing_rule": "per_call",
    "credits_reserved": 2.5,
    "user_group": "default"
  }
}
```

### Status Response (Completed)
```json
{
  "id": "task-unified-1757156493-imcg5zqt",
  "status": "completed",
  "progress": 100,
  "results": ["https://cdn.example.com/image1.png"]
}
```

### Status Response (Multiple Images)
```json
{
  "id": "task-unified-1757156493-imcg5zqt",
  "status": "completed",
  "progress": 100,
  "results": [
    "https://cdn.example.com/image1.png",
    "https://cdn.example.com/image2.png",
    "https://cdn.example.com/image3.png"
  ]
}
```

## Task Status Values

| Status | Description | Action |
|--------|-------------|--------|
| `pending` | Task queued | Continue polling |
| `processing` | Generation in progress | Continue polling |
| `completed` | Image(s) ready | Retrieve URLs from results |
| `failed` | Generation failed | Check error field |

## Error Codes

| Code | Meaning | Common Causes | Solutions |
|------|---------|---------------|-----------|
| `200` | Success | — | Process response |
| `400` | Bad Request | Invalid params, content blocked, file too large | Check parameters |
| `401` | Unauthorized | 渠道鉴权问题 | 在本项目 new-api 渠道配置中核对（非外部 key） |
| `402` | Payment Required | 余额不足 | 在本项目计费/渠道侧补额度 |
| `403` | Access Denied | Token lacks model access | Check API key permissions |
| `429` | Rate Limited | Too many requests | Wait and retry |
| `500` | Internal Error | Server error | Retry later |

## Polling Strategy

### Recommended Pattern
1. **Fast polling**: Every 3 seconds for first 20 seconds
2. **Slower polling**: Every 8 seconds after 20 seconds
3. **Timeout**: Stop after 5 minutes with warning

### Typical Generation Times
- **1K, low quality**: 5-15 seconds
- **1K, medium quality**: 10-30 seconds
- **2K, high quality**: 20-60 seconds
- **4K, high quality**: 30-90 seconds
- **Batch (n=4+)**: 30-120 seconds

## Output URLs

- **Validity**: 24 hours from generation
- **Format**: PNG/JPEG image files
- **CDN delivery**: High-speed download
- **Save promptly**: URLs expire after 24 hours

## Best Practices

### Prompt Writing
- Be specific and descriptive
- Include style, mood, lighting details
- Max 32,000 characters but concise prompts often work better
- For editing: clearly describe what to add/change/remove

### Cost Optimization
- Use `low` quality for drafts and iterations
- Use `1K` resolution for testing, scale up for finals
- Batch with `n` to explore variations efficiently
- Use ratio format + resolution instead of pixel format for convenience
