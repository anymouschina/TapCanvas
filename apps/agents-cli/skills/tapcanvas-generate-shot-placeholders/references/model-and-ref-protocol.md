# 设计板出图模型与参考图协议参考

> 本文档是 `tapcanvas-generate-shot-placeholders` skill 的运行时辅料。说明在出设计板时如何选模型、如何附带角色/场景参考图、协议层细节。来源：第一章 4 场 17 次出图实测（2026-04-27），见 `test/ch1/05-board-v2/version-log.md`。

## 网关入口

固定走 `http://localhost:4455/v1/images/generations`（OpenAI 兼容 image generation 协议），鉴权 `Authorization: Bearer $NEW_API_INTERNAL_TOKEN`（取自 `apps/hono-api/.env`）。

请求体最小骨架：

```json
{
  "model": "gpt-image-2",
  "prompt": "<完整 design board prompt>",
  "images": ["https://file.beqlee.icu/.../li-changan.jpg"],
  "n": 1,
  "size": "1536x1024",
  "user": "tapcanvas-test"
}
```

响应：`data[0].url`（公网 URL）+ `b64_json`（部分模型也回填，gpt-image-2 仅返回 URL）。

## 模型对比（实测）

| 维度 | `gpt-image-2`（默认）| `nano-banana-pro` |
|------|---------------------|------------------|
| size 支持 | 1536x1024（实测）/ 1024x1024 / 1792x1024 等 OpenAI 标准 | 1024x1024 / 1920x1080（自由度更高）|
| ref 协议 | **仅 https URL**（`images: [...]`）；base64 data URL → 502 | https URL **或** base64 data URL 都接受 |
| 单次出图耗时 | 60-75s（含上游 backup task 排队）| 30-40s |
| 输出格式 | PNG（via apimart URL，需 followup curl 下载）| 直接 b64_json 内嵌 |
| 输出体积 | 2.5MB PNG | 700-900KB JPEG |
| **layout 稳定性** | ✅ 稳定 1×N 单列 + 底部全景；cut 编号唯一 | ⚠️ 多人物同环境场景倾向 2×2 grid + cut 重号 |
| **画风** | ❌ 偏写实电影感，"清雅国风插画"约束被弱化 | ✅ 守住清雅国风插画，与 `02b-scene-refs/` 风格一致 |
| **角色一致性（带 ref）**| ✅ 带 ref 锚定 | ✅ 带 ref 锚定 |

选型决策树：

- **追求章节制作板的整齐 layout** → `gpt-image-2`（接受写实倾向）
- **追求"清雅国风插画"画风统一** → `nano-banana-pro` + 简单单角色场（多人物同环境会塌）
- **风格已由 globalStyleGuide 主导（其他 image 节点都用 nano-banana-pro）** → 跟随 `nano-banana-pro` 保持视觉统一

## 参考图传递

### 必传场景

下列两类节点几乎必须随 prompt 附带参考图，否则跨 board 角色 / 场景外观会漂移：

- 主角出现的 cut（角色锚点）
- 关键场景出现的 cut（场景锚点）

### 上游节点字段约定

设计板 image 节点的 `data` 上有：

```json
{
  "sceneReferenceNodeIds": ["<scene_ref_node_id_01>", "..."],
  "characterReferenceNodeIds": ["<char_ref_node_id_01>", "..."]
}
```

宿主在出图前，遍历这两组 ID，从对应的 image 节点上取 `referenceImages[]`（`generate_scene_references` skill 已写好的 R2 公网 URL 数组），合并去重后写入 image generation 请求的 `images: [...]` 字段。

### gpt-image-2 必走 R2

gpt-image-2 上游不接受 base64 data URL（实测 502 `apimart task failed`）。如果上游 ref 节点的 `referenceImages[]` 还是 base64 / blob: / 本地路径，必须先上传到 R2 拿 https URL：

```python
# 简化片段，详见 test/ch1/05-board-v2/version-log.md "v3→v4 修复手段"
import boto3, os
s3 = boto3.client('s3',
    endpoint_url='https://<account>.r2.cloudflarestorage.com',
    aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
    aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
    region_name='auto')
key = f'tapcanvas/{chapter_id}/{role_or_scene}.jpg'
s3.upload_file(local_path, 'canvas-pro', key,
    ExtraArgs={'ContentType':'image/jpeg','CacheControl':'public, max-age=3600'})
public_url = f'{os.environ["R2_PUBLIC_BASE_URL"].rstrip("/")}/{key}'
```

R2 配置取自 `apps/hono-api/.env` 的 `R2_*` 段。

### 多 ref 处理

`gpt-image-2` 实测可吞 1~2 张 ref；如果同时传角色 + 场景 ref，模型会按"主导参考图"（数组第一张）锁主体，第二张做风格混入。**安全做法**：每张 board 只传 1 张主导 ref（角色 ref 优先，场景 ref 退让到 prompt 文字描述）。

## prompt 与 ref 的耦合写法

prompt 必须显式声明角色锚定，让模型读 ref：

```
LEFT (character mini panel):
- LI CHANG'AN is bound to the verified character-card/v3 identity reference ID.
  Preserve that asset's visible identity anchors; this prompt adds only the current shot state.

# CUT 01
Subject: LI CHANG'AN, bound to the verified identity asset. Current-shot delta:
  calm detached expression, dark gray mandarin-collar cotton jacket over white
  tee, dark indigo jeans. Do not restate or redesign unchanging identity traits.
```

不做这个声明时，即使传了 ref，模型也可能"看一眼但不照搬"。

## 已知限制 / 未来工作

- **gpt-image-2 同步等待 60-75s**：4 张 board 一章串行 ~5min。可引入异步队列（`/v1/videos` 模式的 task_id + 轮询）。
- **画风家族不统一**：`nano-banana-pro`（v2 风格图）+ `gpt-image-2`（设计板）不能交叉接续。要么全章统一一种模型，要么接受设计板与场景图风格差异。
- **R2 上传无去重**：每次出图都重传同一张角色 ref 浪费带宽。可加 `key = sha256(image)` 缓存层。
