# Seedance 2.0 API Parameters Reference

本文档仅为 **Seedance 2.0 参数方法论**。实际出视频走本项目自有链路：画布 `video` 节点 / `tapcanvas_video_generate_to_canvas` → new-api 的 doubao-seedance 官渠（官渠已直接支持真人，**项目无任何 `-face` 模型，禁止输出 -face 变体**）。**不直连外部 API、不需要任何外部 API key、不要 curl 外部端点。** 下面的参数语义直接套用到本项目生视频工具的入参。

## Models Overview

Seedance 2.0 provides three models, all sharing the same generation endpoint:

| Model | Use Case | Key Inputs |
|-------|----------|------------|
| `seedance-2.0-text-to-video` | Generate video from text prompt only | prompt (+ optional web search) |
| `seedance-2.0-image-to-video` | Animate from 1-2 reference images | prompt + 1-2 images |
| `seedance-2.0-reference-to-video` | Multimodal remix, edit, extend video | prompt + images(0-9) + videos(0-3) + audio(0-3) |

## Common Parameters

These parameters are shared across all three models:

| Parameter | Type | Default | Options | Description |
|-----------|------|---------|---------|-------------|
| `model` | string | — | See models above | **Required.** Model name |
| `prompt` | string | — | — | **Required.** Text description of desired video. Supports Chinese and English. Recommended: ≤500 chars (Chinese) or ≤1000 words (English) |
| `duration` | integer | `5` | `4`–`15` | Video duration in seconds |
| `quality` | string | `"720p"` | `"480p"`, `"720p"` | Video resolution |
| `aspect_ratio` | string | `"16:9"` | `"16:9"`, `"9:16"`, `"1:1"`, `"4:3"`, `"3:4"`, `"21:9"`, `"adaptive"` | Video aspect ratio. `adaptive` lets the model choose based on inputs |
| `generate_audio` | boolean | `true` | `true`, `false` | Generate synchronized audio (voice, SFX, music) at no additional charge |
| `callback_url` | string | — | HTTPS URL | Optional callback for task completion/failure/cancellation. Must be HTTPS, no private IPs, ≤2048 chars. Retries up to 3 times on failure |

### Aspect Ratio Pixel Values

| Aspect Ratio | 480p | 720p |
|:------:|:----:|:----:|
| 16:9 | 864x496 | 1280x720 |
| 4:3 | 752x560 | 1112x834 |
| 1:1 | 640x640 | 960x960 |
| 3:4 | 560x752 | 834x1112 |
| 9:16 | 496x864 | 720x1280 |
| 21:9 | 992x432 | 1470x630 |

---

## Model 1: seedance-2.0-text-to-video

Generate video from text prompts only. No image, video, or audio inputs accepted.

### Unique Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `model_params.web_search` | boolean | `false` | When enabled, the model autonomously decides whether to search web content based on the prompt. May increase latency. Fees charged only when searches are actually triggered |

### Constraints

- Does **not** accept `image_urls`, `video_urls`, or `audio_urls`
- Duration: 4–15 seconds
- Quality: 480p, 720p

### Example Payload

```json
{
  "model": "seedance-2.0-text-to-video",
  "prompt": "A macro lens focuses on a green glass frog on a leaf. The focus gradually shifts from its smooth skin to its completely transparent abdomen, where a bright red heart is beating powerfully and rhythmically.",
  "duration": 8,
  "quality": "720p",
  "aspect_ratio": "16:9",
  "generate_audio": true
}
```

### Example with Web Search

```json
{
  "model": "seedance-2.0-text-to-video",
  "prompt": "Today's New York weather forecast, with city skyline animation and temperature overlay display",
  "duration": 8,
  "aspect_ratio": "16:9",
  "model_params": {
    "web_search": true
  }
}
```

---

## Model 2: seedance-2.0-image-to-video

Generate video from 1-2 reference images. The model automatically determines the behavior:

| Image Count | Behavior | Role |
|:-----------:|----------|------|
| 1 image | First-frame video generation | Image used as `first_frame` |
| 2 images | First-last-frame video generation | 1st image -> `first_frame`, 2nd image -> `last_frame` |

### Unique Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `image_urls` | array | **Yes** | 1-2 image URLs |

### Image Constraints

- **Supported formats**: `.jpeg`, `.png`, `.webp`
- **Aspect ratio** (width/height): `0.4` ~ `2.5`
- **Dimensions**: `300` ~ `6000` px (width and height)
- **Max size per image**: 30MB
- **Total request body**: ≤64MB (do not use Base64 encoding)
- When providing first and last frames, both images can be identical. If aspect ratios differ, the first frame takes priority and the last frame is auto-cropped
- Image URLs must be directly accessible by the server

### Example Payload (First-Frame)

```json
{
  "model": "seedance-2.0-image-to-video",
  "prompt": "The camera slowly zooms in, the scene gradually comes to life",
  "image_urls": [
    "https://example.com/first-frame.jpg"
  ],
  "duration": 5,
  "aspect_ratio": "adaptive",
  "generate_audio": true
}
```

### Example Payload (First + Last Frame)

```json
{
  "model": "seedance-2.0-image-to-video",
  "prompt": "A smooth transition between two scenes",
  "image_urls": [
    "https://example.com/first.jpg",
    "https://example.com/last.jpg"
  ],
  "duration": 6,
  "aspect_ratio": "16:9",
  "generate_audio": true
}
```

---

## Model 3: seedance-2.0-reference-to-video

Multimodal reference-based video generation. Combine images, video clips, and audio to create, edit, or extend video. The prompt can reference inputs by number (e.g., "use image 1 as first frame", "use video 1's camera movement", "use audio 1 as background music").

### Unique Parameters

| Parameter | Type | Count | Description |
|-----------|------|-------|-------------|
| `image_urls` | array | 0–9 | Reference images (style reference, product shots, first/last frame via prompt) |
| `video_urls` | array | 0–3 | Reference videos (camera reference, motion reference, video to edit/extend) |
| `audio_urls` | array | 0–3 | Reference audio (background music, sound effects, voice reference) |

**Constraint**: Must provide at least 1 image OR 1 video. Cannot be audio-only.

### Image Constraints

Same as image-to-video model (see above).

### Video Constraints

- **Supported formats**: `.mp4`, `.mov`
- **Resolution**: 480p, 720p
- **Duration per video**: `2`–`15` seconds; max 3 videos; total duration ≤ `15` seconds
- **Aspect ratio** (width/height): `0.4` ~ `2.5`
- **Dimensions**: `300` ~ `6000` px
- **Pixel count** (width x height): `409,600` ~ `927,408` (e.g., 640x640 ~ 834x1112)
- **Max size per video**: 50MB
- **Frame rate**: `24`–`60` FPS
- **Total request body**: ≤64MB (do not use Base64)
- Video input duration is billed separately
- Video URLs must be directly accessible by the server

### Audio Constraints

- **Supported formats**: `.wav`, `.mp3`
- **Duration per audio**: `2`–`15` seconds; max 3 files; total duration ≤ `15` seconds
- **Max size per file**: 15MB
- **Total request body**: ≤64MB (do not use Base64)
- Audio URLs must be directly accessible by the server

### Example Payload (Multimodal)

```json
{
  "model": "seedance-2.0-reference-to-video",
  "prompt": "Use video 1's first-person camera movement throughout. Use audio 1 as background music. First-person perspective fruit tea promotional ad...",
  "image_urls": [
    "https://example.com/product.jpg",
    "https://example.com/scene.jpg"
  ],
  "video_urls": [
    "https://example.com/reference.mp4"
  ],
  "audio_urls": [
    "https://example.com/bgm.mp3"
  ],
  "duration": 10,
  "quality": "720p",
  "aspect_ratio": "16:9",
  "generate_audio": true
}
```

### Example Payload (Video Editing)

```json
{
  "model": "seedance-2.0-reference-to-video",
  "prompt": "Replace the perfume in the gift box from video 1 with the cream from image 1, keep the camera movement unchanged",
  "image_urls": [
    "https://example.com/cream.jpg"
  ],
  "video_urls": [
    "https://example.com/original.mp4"
  ],
  "duration": 5,
  "aspect_ratio": "16:9"
}
```

### Example Payload (Video Extension)

```json
{
  "model": "seedance-2.0-reference-to-video",
  "prompt": "The arched window in video 1 opens, entering an art gallery interior, then continue with video 2, then the camera enters the painting, continue with video 3",
  "video_urls": [
    "https://example.com/part1.mp4",
    "https://example.com/part2.mp4",
    "https://example.com/part3.mp4"
  ],
  "duration": 8,
  "aspect_ratio": "16:9",
  "generate_audio": true
}
```

---

## Response Format

### Generation Response
```json
{
  "id": "task-unified-1774857405-abc123",
  "object": "video.generation.task",
  "created": 1761313744,
  "model": "seedance-2.0-text-to-video",
  "status": "pending",
  "progress": 0,
  "type": "video",
  "task_info": {
    "can_cancel": true,
    "estimated_time": 165,
    "video_duration": 8
  },
  "usage": {
    "billing_rule": "per_second",
    "credits_reserved": 50,
    "user_group": "default"
  }
}
```

### Status Response (Completed)
```json
{
  "id": "task-unified-1774857405-abc123",
  "status": "completed",
  "progress": 100,
  "results": ["https://cdn.example.com/video.mp4"]
}
```

## Task Status Values

| Status | Description | Action Required |
|--------|-------------|-----------------|
| `pending` | Task queued | Continue polling |
| `processing` | Generation in progress | Continue polling |
| `completed` | Video ready | Retrieve video URL from results |
| `failed` | Generation failed | Check error field |

## Error Codes

### HTTP Status Codes

| Code | Meaning | Common Causes | Solutions |
|------|---------|---------------|-----------|
| `200` | Success | — | Process response |
| `400` | Bad Request | Invalid parameters, content blocked, file too large | Check parameters and content |
| `401` | Unauthorized | 渠道鉴权问题 | 在本项目 new-api 渠道配置中核对（非外部 key） |
| `402` | Payment Required | 余额不足 | 在本项目计费/渠道侧补额度 |
| `403` | Access Denied | Token does not have model access | Check API key permissions |
| `429` | Rate Limited | Too many requests | Wait and retry |
| `500` | Internal Error | Server error | Retry later |

### Common Error Messages

#### Content Blocking (400)
- **Trigger**: Realistic human faces, inappropriate content
- **Message**: Contains "face" keywords
- **Solution**: Modify prompt to avoid restricted content

#### File Size — Images (400)
- **Trigger**: Images >30MB
- **Message**: Contains "file" and "large" or "size exceed"
- **Solution**: Compress images before upload

#### File Size — Videos (400)
- **Trigger**: Videos >50MB or total duration >15 seconds
- **Message**: Contains "video" and "large" or "size"
- **Solution**: Compress videos; ensure total video duration ≤15s

#### 鉴权失败 (401)
- **Message**: "Invalid API key" or similar
- **Solution**: 在本项目 new-api 渠道配置中核对鉴权（非外部 key）

#### 余额不足 (402)
- **Message**: "Insufficient balance" or similar
- **Solution**: 在本项目计费/渠道侧补额度

## Polling Strategy

### Recommended Pattern
1. **Frequent polling**: Every 5 seconds for first 30 seconds
2. **Slower polling**: Every 10 seconds after 30 seconds
3. **Timeout**: Stop after 5 minutes with warning

### Typical Generation Times
- **4-5 seconds, 480p**: 20-45 seconds
- **5-8 seconds, 720p**: 30-90 seconds
- **10-15 seconds, 720p**: 60-180 seconds

### Timeout Handling
After 5 minutes, inform user that generation may still be processing and suggest checking back later.

## Rate Limits

- **Generation requests**: Varies by plan
- **Status queries**: Higher limit, safe to poll frequently
- **Concurrent tasks**: Varies by plan

Contact support for specific rate limit details for your account.

## Output URLs

- **Validity**: 24 hours from generation
- **Format**: MP4 video files
- **CDN delivery**: High-speed download
- **Audio**: Synchronized audio included by default (voice, sound effects, background music)

## Best Practices

### Prompt Writing
- Be specific and descriptive
- Include visual details (colors, lighting, movement)
- Avoid realistic human faces
- Use cinematic language for better results
- For reference-to-video: use numbered references ("image 1", "video 2", "audio 1") to specify how each input should be used

### Performance Optimization
- Start with 480p for testing
- Use shorter durations for faster generation
- Provide clear, high-quality reference media
- Batch similar requests to optimize costs

### Error Resilience
- Always handle all error codes
- Provide user-friendly error messages with action links
- Implement exponential backoff for rate limits
- Set reasonable timeouts for polling

