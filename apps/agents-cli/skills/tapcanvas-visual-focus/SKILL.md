---
name: tapcanvas-visual-focus
description: 基于图片理解提取“视觉重点/注意力分配/关键要素”，并根据用户对话目标输出可执行的要点清单与提示词骨架（默认用 tapcanvas_vision + modelAlias=gemini-3.1-flash-image-preview）。
---

# TapCanvas 视觉重点提取（Visual Focus）

适用场景：
- 用户给了图片（URL 或 DataURL），并希望你提取“视觉重点/关键要素/注意力在哪里/风格要点/拍摄布光要点”。
- 用户的目标来自对话：例如“复现这张图”“做同风格海报”“做分镜/视频风格对齐”“提炼这张图的视觉主轴”。

## 目标

- 不“看图编故事”：只基于图中可见内容；不确定就标注“推测/不清晰”。
- 把“视觉重点”拆成可执行清单：**必须保留** vs **可以替换**。
- 给出后续生成/改图可直接用的“提示词骨架”（必要时给英文 prompt + negative prompt）。

## 工作流（按对话驱动）

1) **拿到图片输入**
- 优先使用用户给的 `imageUrl`（http(s) 或相对路径 `/...`）。
- 其次 `imageData`（`data:image/*;base64,...`）。
- 如果用户没给图片或给的是 `blob:`/本地路径，先让用户上传为可访问 URL，或让其提供 DataURL。

2) **从对话中抽取“用户想要的视觉重点”**
- 用途：复现/改图/海报/视频/风格对齐
- 强调：主体、材质、文字、光线、氛围、配色、构图、镜头
- 忽略：不想要的元素（背景、道具、文字等）
- 输出偏好：要中文总结、要 JSON、要英文 prompt、要负面词等

3) **调用图片理解工具（必做）**
- 使用 `tapcanvas_vision`。
- 默认：`modelAlias="gemini-3.1-flash-image-preview"`、`temperature=0.2`。
- 若上游已经提供外部 `prompt`，直接透传；若未提供，再使用下方推荐模板。
- 若需要固定厂商（避免 auto 路由到其它厂商），传 `vendorCandidates`（例如仅允许某个厂商）。

建议给 `tapcanvas_vision.prompt` 的模板（把对话目标填进去）：

“你是资深视觉导演与提示词工程师。请基于输入图片，结合我的目标：<用户目标>，提取我需要的视觉重点。输出严格有效 JSON（不要代码块/多余文字），字段如下：
- summaryZh: 一句话画面摘要
- focusPoints: 数组，每项包含 pointZh（重点）、importance（1-5）、evidence（图中依据/位置特征）、mustKeep（true/false）、canVary（可替换/可变化的方向）
- composition: 构图与镜头（景别/视角/主体位置/景深与焦段倾向；推测需标注）
- lighting: 光线（主光方向、软硬、色温、阴影特征）
- colorPalette: 主色/辅色与氛围
- styleTags: 风格标签数组（摄影/插画/3D/动漫等）
- textInImage: 画面可见文字（不清晰就写不清晰）
- englishPrompt: 可复现英文提示词（只输出提示词正文）
- negativePrompt: 建议的反向提示词（可选）

注意：不要编造不存在的品牌/文字/认证信息；对不确定内容用‘推测/可能’。””

4) **把结果变成“可执行”输出**
- 如果返回是 JSON：优先按 focusPoints 输出，并补齐“必须保留/可以替换/提示词骨架”。
- 如果返回不是 JSON：按同样结构用中文整理一份（不要臆测）。

## 推荐输出模板（中文）

- 视觉重点（Top 5-10）：（每条含重要度、必须保留/可替换）
- 必须保留：用于风格对齐/复现的关键要素
- 可以替换：在不破坏风格前提下可变化的要素
- 提示词骨架（用于生成/改图）：中文要点 +（如需要）英文 prompt
- 反向提示词建议（可选）

## 调用示例（工具参数示意）

- `tapcanvas_vision` 参数要点：
  - `vendor: "auto"`
  - `vendorCandidates: ["<可选：限制候选厂商>"]`
  - `modelAlias: "gemini-3.1-flash-image-preview"`
  - `temperature: 0.2`
  - `imageUrl` 或 `imageData`
  - `prompt: "<按上面模板拼装的任务描述>"`
