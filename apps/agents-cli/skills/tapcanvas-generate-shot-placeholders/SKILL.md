---
name: tapcanvas-generate-shot-placeholders
description: TapCanvas 镜头设计板意图技能（v16 一镜到底决策）。用于章节正文 / 视频脚本 / 单镜头文本节点上的 `generate_shot_placeholders` intent：编剧定节拍、导演拆 Cut，每板 1 个 `kind=image` 节点（默认 6-7 镜、≤15s），逐板提交真实图片并保留节点与任务回执。Seedance/即梦视频脚本会自动判断采用「一镜到底」或「2s 一切镜」模式（决策见 §4.13）。所有数字与必填硬约束集中在「硬约束速查表」一节，其余章节只描述创作纪律与字段规范。
disable-model-invocation: false
requires-skills:
  - tapcanvas-generate-scene-references
  - tapcanvas-character-card
  - tapcanvas-scene-card
produces:
  - canvas-node productionLayer=design_board kind=image（分镜设计板）
knowledge-role: storyboard
knowledge-domains:
  - 视听语言演出
  - 提示词工程
  - 角色一致性
---

# TapCanvas Generate Shot Storyboard Design Boards

> **职责边界**：本 skill 是「设计板**落地执行器**」——把镜头表落成画布上的 `kind=image` 设计板节点（intent=generate_shot_placeholders）。**拆镜/镜头表方法论（调度/景别/轴线/焦段/运镜/节拍）的真相源是 `tapcanvas-storyboard-expert`**（含 `镜头语言规则.md`）；本 skill 不另立一套拆镜规则，冲突以 storyboard-expert 为准。**分镜表格列定义（13 列）的唯一权威也是 `tapcanvas-storyboard-expert § 分镜表格输出格式`**；本 skill 的 `shotText`（§6.2）与图片 TABLE HEADER ROW（§6.1）均须与该 13 列规范对齐，不得另立冲突列序。

## 0. 调用合同（一句话）

读取源文本、章节上下文与用户生成参数，由 Agent 拆分完整设计板清单。每板完成镜头和引用设计后，通过 `tapcanvas-api` 当前工具目录读取 schema，使用 `tapcanvas_image_generate_to_canvas` 提交真实生图，不必先写完全部板。独立板可同轮并发；有前置视觉依赖的板等待真实资产就绪。已受理或成功的节点按原 ID 对账，不能重新提交。用户明确只要占位或文本时才只创建节点。

创建图片节点不等于生成图片，`tapcanvas_flow_patch` 只证明画布写入。结束前逐项核对清单的真实复用证据、受理回执与未执行原因；第一张受理不能结束整章请求。最终如实报告已提交、实际完成与剩余项，不调用已退役的 finalize 工具。技能中的创作规范用于同链自检与修订，不得成为运行时语义硬闸。

> 所有量化与必填项见 §1「硬约束速查表」。本节只解释流程顺序。

## 1. 硬约束速查表（单一权威）

下表列出本 skill 的全部强制约束。本文件其余章节均**不得**重复约束数值，只解释如何满足。任一项未达标必须修改后再进行交付核对。

### 1.1 工具与节点

| 项 | 约束 |
| --- | --- |
| 执行工具 | 以当前工具目录与动态 schema 为准；生图用 `tapcanvas_image_generate_to_canvas`，结构写入用 `tapcanvas_flow_patch` |
| 工具事实 | 不调用当前目录不存在的动作；允许读取动态 schema |
| 结果说明 | 依据真实节点、任务与资产证据区分已创建、已提交、已完成和未执行 |
| 节点 `kind` | 必须 `"image"`，禁止 `"text"`，禁止空壳节点 |
| `imageModel` | `generationConfig.imageModel`；缺失时 `"gpt-image-2"` |
| `imageSize` | `generationConfig.imageSize`；缺失时 `"4K"` |
| `aspect` | **必须 `"16:9"`，禁止 `"9:16"`**（分镜表格是横板；最终视频比例和这里无关） |
| **`prompt` 格式** | **由 §2.5 场景类型决策确定：`boardFormat=table` 时必须以 `Film storyboard table —` 开头（§6.1 模板）；`boardFormat=design_doc` 时必须以 `Film production design document —` 开头（§6.1b 模板）。禁止写成单张场景描述或任何不含结构化面板的 prompt。⚠️ **当 styleTone 为写实/电影类（`clean-real`/`cinematic`）时——无论 `fullColor` 与否——一律选 `boardFormat=design_doc`（`Film production design document —` 开头），避免 `storyboard` 一词触发 gpt-image-2 输出动漫插画风格**（本仓 CV#11 实测：裸 `storyboard`/分镜板字样会让写实类偶发画成二次元，详见 `tapcanvas-storyboard-expert §3 CV#11`）；仅当确属「非写实的黑白分镜草图」需求才用 `Film storyboard table —`。**`fullColor` 只决定填色与否，不再单独作为避词触发条件——触发判据是 styleTone。** | |
| **使用 `tapcanvas_image_generate_to_canvas` 直接出图时** | **同样必须遵守本 §1.1 全部约束**（aspect=16:9、prompt 以 `Film storyboard table —` 或 `Film production design document —` 开头、13 列格式、有 shotText 字段）。**禁止写"3 large panels, no lettering, no captions"此类纯视觉概念图格式**——那不是分镜表，没有运镜/站位/时长信息，无法驱动视频生成。** |
| **画面渲染风格** | **默认：黑白线稿**（`画面` 分镜格：纯黑色轮廓线稿，线条清晰锐利，**零填色、零灰调、零晕染、零渐变**；背景为白底黑线或黑底白线 chalk 风；禁止任何彩色像素渗入）。`variantParams.fullColor=true` 时切换为 §2.2 全彩 CG 模式。 |

### 1.2 单板时长 / 镜数

> **动态时长范围（5～15s）**：单板总时长 `boardDuration` 由 §2.5 场景类型决策自动确定（范围 5～15s），**禁止所有场景统一使用最大值 15s**。`variantParams.shotDuration` 显式传入时优先使用该值。AI 须先按 §2.5 确定 `boardDuration`，再从该时长反推镜数与每镜秒数。

| 项 | 约束 |
| --- | --- |
| 单板总时长 | `sum(data.shotDurations) ≤ boardDuration`（由 §2.5 确定，5～15s；`variantParams.shotDuration` 存在时优先） |
| 单板默认镜数 | 由 §2.5 场景类型决定（建立/过渡：3～4；对话/叙事：3～5；情绪/超自然：4～6；动作/表演：6～7） |
| 单板硬上限镜数 | `8`，**只**当本板含 1s 转场空镜 / 反应插帧 / 声音桥时允许，必须在 `boardMeta.boardNote` 写明原因 |
| 单板结构下限镜数 | `3`，仅用于本 skill 的表格式设计板布局合同。若本轮真实叙事只有 1–2 个必要 Cut，agent 应在同链内改用更合适的板式或重组相邻节拍，不得把经验评分变成独立运行时质量闸门。 |
| 单板下限例外 | `3-5` 镜仅当本板是某场景的最后残量、自然 Cut 不足时允许，必须在 `boardMeta.boardNote` 写明原因 |
| 单镜时长 | 由场景类型决定（见 §2.5 每镜时长参考）；1s 仅限转场空镜 / 反应插帧 / 声音桥 |
| 优先级冲突 | 当时长上限与镜数下限冲突时，**时长 ≤ boardDuration 优先**，必须开新板 |
| 跨场景 | 跨场景必须开新板，禁止共板 |

### 1.3 必填字段四件套

| 字段 | 性质 | 备注 |
| --- | --- | --- |
| `prompt` | 必填硬字段（英文**分镜表格图**生成提示） | 必须以 `Film storyboard table —` 开头，按 §6.1 完整模板输出；**禁止**写成单张场景描述或单镜头图片词；不得改名为 `imagePrompt` / `boardPrompt` 等；bridge 只认 `data.prompt` |
| `shotText` | 必填（中文可读分镜表） | 见 §6.2 模板 |
| `shotDurations` | 必填（按 Cut 顺序的秒数数组） | 求和必须 ≤ `variantParams.shotDuration`（缺失时 ≤15） |
| `shotBlockings` | 必填（按 Cut 顺序的站位文字描述数组） | 每项格式：`摄像机@位置, 角色A@位置+朝向, 角色B@位置+朝向`；纯空镜写 `[空镜，无人物站位]`；见 §6.3 |

> 字段不足时在同链修订当前板，不终止整批任务。`storyboardScript` 与 `shotText` 完全相同时省略，bridge 会确定性复制。

### 1.4 boardMeta 五件套

`boardMeta.styleTags / cameraParams / actionArc / audioArc / totalDuration` **全部非空**。`actionArc / audioArc` 必须按 Cut 顺序对应到逐镜核心动作 / 核心音效，禁止脱离表格内容自由发挥。

### 1.5 数组长度对齐

`shotDurations.length == shotTimecodes.length == shotAudios.length == directorNotes.length == shotBlockings.length == 表格 Cut 数量`。`shotTimecodes` 由 `shotDurations` 累计推导，第 1 项以 `0:00` 起，最后一项右端等于 `boardMeta.totalDuration`。

### 1.6 角色与参考绑定

- `charactersOnScreen` 只能列本板真实出镜 / 出声 / 明确 OS-VO 归属的角色；纯被提及、上一板出现、同章节其他场景的角色不得列入。
- `characterReferenceNodeIds` 只能绑定 `charactersOnScreen` 中角色对应的参考图节点，禁止接错人物（如李长安独处镜头不得绑定大伯母）。
- 多角色正反打 / 群体冲突必须为所有主要可见角色都绑定各自参考图。
- 纯空镜 / 道具镜：`charactersOnScreen` 与 `characterReferenceNodeIds` 都为 `[]`。

### 1.7 边连接

| 关系 | 是否允许 |
| --- | --- |
| 源文本节点 → 设计板节点 | **禁止**（只通过 `data.sourceNodeId` / `chapterId` 追溯） |
| 角色 / 场景参考图节点 → 设计板节点 | 允许，`sourceHandle: "out-image"`、`targetHandle: "in-image"` |
| 把同章节所有参考图都接到每块板 | 禁止；只接本板真实出场角色 / 场景对应的参考图 |

> **【参考图硬上限 16·只挂内容需要的图·2026-06-18 用户拍板】** gpt-image-2 单次出图 `referenceImages`+风格图合计**最多 16 张**，超了上游直接 `reference_images exceeds max 16` build 失败、整张设计板挂掉（实测 ch129：一张覆盖全章 9 格的设计板把 11+ 张角色/场景锚全挂上 + 服务端自动注入 → 撞上限）。**两条铁律**：①**只注入&链接本板内容真正需要的图**（风格锚 1 张 + 本板出场的少数角色/场景，去重），绝不堆全量锚定卡；②**一张设计板覆盖的镜数/角色数要可控**——若某章出场角色多、单板会引用 >12 张参考图，**必须按节拍/场景拆成多张设计板**（每板 3-4 格、只引该板出场的少数角色），而不是硬塞一张全章大板（既撞 16 上限、单图又过重易超时）。服务端虽有 ≤16 兜底截断，但截断会丢图致漂移，**别依赖兜底，前端就控住**。

### 1.8 全局覆盖

全部设计板合计必须**完整覆盖整章剧情**，不得只覆盖高潮而漏掉因果铺垫。

---

## 2. 输入识别

按以下顺序读源文本：

1. `chapterText`
2. `chapterContext.sourceNode.data.prompt`
3. `chapterContext.sourceNode.data.text`
4. `chapterContext.sourceNode.data.storyboardScript`

支持三种输入形态：

1. **带场景编号剧本**（如 `1-1 简陋手术室 日 内`）：按场景编号切，每场景可拆多板
2. **章节正文（无场景编号）**：从地点 / 时间 / 叙事节拍变换识别场景切换
3. **单镜头文本**：只生成 1 个节点

### 2.1 variantParams 读取

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `variantParams.shotDuration` | 正整数（秒） | 直接覆盖 `boardDuration`，优先于 §2.5 自动决策 |
| `variantParams.lineArt` | `true` | （已废弃；黑板线稿现为默认，无需显式传入） |
| `variantParams.fullColor` | `true` | 全彩 CG 模式：§2.2 电影质感底座全量注入；默认不传 = 黑板线稿 |

## 2.2 风格五模块自动推断（章节级一次，全章共用；场景级每板各一次）

读完源文本后，在进入 §2.5 场景类型识别之前，执行风格推断，生成 `styleModules`。`userHints` 中明确提供风格时，以用户内容覆盖对应块。

### Step 1：读取章节信号

| 信号维度 | 读取内容 |
|---|---|
| 时代 / 题材 | 现代都市 / 古风仙侠 / 奇幻魔法 / 哥特暗黑 / 科幻赛博 / 武侠战争… |
| 情绪基调 | 暗黑压抑 / 唯美虐恋 / 热血动感 / 悬疑惊悚 / 温暖治愈 / 史诗宏大… |
| 色彩线索 | 文中出现的颜色 / 光源 / 天气 / 特效关键词（血月、灵气、霓虹、冰晶、烛火…）|
| 场景特质 | 室内 / 室外、日 / 夜、标志材质（冰晶殿、竹林、废墟城堡、赛博街道）|
| 渲染基调 | 写实 CG / 水墨 / 赛博朋克 / 国风写意 / 哥特电影… |

### Step 2：撰写章节级四块（英文，全章共用）

**固定质感底座**（仅 `variantParams.fullColor=true` 时注入；默认黑板线稿模式**跳过**此底座）：
`cinematic quality, cinematic lighting and cinematography, 8K ultra-high detail, photorealistic CG rendering, Unreal Engine 5 visuals`

| 块 | 内容范围 | 写法 |
|---|---|---|
| **Block 1 核心电影风格** | 固定底座 + 题材画风基底（CG渲染/水墨/写实）+ 整体色调方向 | 1-2句，含渲染技术关键词 |
| **Block 2 光影设计** | 打光策略（chiaroscuro / 伦勃朗 / 逆光 / 顶光）+ 主光方向 + 阴影对比 + 特殊光效 | 1-2句，含打光流派名词 + 具体方向 |
| **Block 3 色调调控** | 饱和度 + 色温冷暖 + 特定色系 + 粒子 / 微光特效 | 1-2句，含色温方向 + 特效描述 |
| **Block 4 整体氛围** | 整体情绪关键词 + 空间感 + 题材特有意境词 | 1-2句，含情绪词 + 意境词串 |

禁止堆砌空洞形容词；每块必须让图像模型能直接识别并执行。

### Step 3：撰写场景专属描述（每块板独立，随场景变化）

每块设计板额外撰写一段 **场景专属描述（scene-specific descriptor）**，描述本场景的：
- 空间材质（冰晶 / 竹木 / 石砌 / 钢铁 / 土墙…）
- 标志道具（古琴 / 符文圆盘 / 魔法法阵 / 机械装置…）
- 特有光效（冰晶折射 / 魔法粒子 / 烛火跳动 / 霓虹反射…）
- 场景独有情绪（清冷圣洁 / 幽深诡谲 / 热血沸腾 / 神秘孤寂…）

### Step 4：撰写负面提示词（Block 5，全章共用）

英文关键词串，覆盖两层：
1. 与题材冲突的渲染错误（如暗黑哥特题材 → `bright daylight, pastel colors, cheerful tone`；仙侠题材 → `modern city, sci-fi equipment`）
2. 通用 AI 生图错误：`deformed anatomy, extra fingers, fused limbs, distorted face, floating props, text watermark, random Chinese characters`

### 注入规则

| 目标字段 | 内容来源 |
|---|---|
| `prompt` 前缀（表格之前） | Block 1 → Block 2 → Block 3 → Block 4 → 场景专属描述，英文，各块空行分隔 |
| `prompt` 末尾 | `Avoid: [Block 5]` |
| `boardMeta.styleTags` | Block 1-4 + 场景专属的中文关键词摘要，顿号分隔 |
| `boardMeta.cameraParams` | Block 2 光影参数摘要 |

**禁止**在 Cut 的 `画面` 列重复堆叠全局风格词；全局风格只写一次（prompt 前缀）。

## 2.5 场景类型识别与格式/时长决策（必须在拆镜前完成）

每块设计板在拆 Cut 之前，先从本段情节信号词完成以下两项决策，写入 `boardMeta.boardNote`：

- **`boardFormat`**：`table`（标准分镜表格）或 `design_doc`（综合制作设计文档）
- **`boardDuration`**：本板总时长上限（5～15s 动态范围）

### 决策树

```
判断本板情节信号词
│
├─ 命中任一 → 【表演 / MV 场景】
│    演奏 / 演唱 / 弹琴 / 舞蹈 / 演出 / MV / 音乐表演 / 节目 / 登台
│    music performance / dance / concert / showcase / recital
│    → boardFormat=design_doc，boardDuration=12～15s，镜数 6～7
│
├─ 命中任一 → 【动作 / 追逐场景】
│    打斗 / 追逐 / 逃跑 / 冲锋 / 连招 / 追车 / 格斗 / 搏斗 / 武打
│    → boardFormat=table（§4.13 一镜到底决策），boardDuration=10～15s
│    ⚡ 【动作节奏硬规则·必须设计快慢对比，禁止全镜同速】
│      - 快切段（冲击/连招/爆发）：每镜 1～2s，运镜用 快推/横扫/跟拍/抽切；
│        占全板 60%～70% 的镜数
│      - 慢戏剧段（命中瞬间/情绪峰值）：每镜 3～4s，bullet-time/升格/定格；
│        全板至多 1～2 个，且只用于决定性命中或英雄时刻
│      - 收尾/呼吸段（余波/重建）：每镜 2～3s，拉镜/推镜渐缓
│      - **禁止**全板每镜都写 bullet-time / slow motion / slow push；
│        慢镜必须有快镜衬托才有冲击力，否则全程慢 = 无节奏无力度
│      - `boardMeta.boardNote` 必须写明快/慢/收三段的镜号分配，如：
│        "Cut01-04 快切(1-2s), Cut05 bullet-time(3s), Cut06 收势(2s)"
│
├─ 命中任一 → 【超自然 / 异界场景】
│    穿越 / 附身 / 幻觉 / 异界 / 灵异 / 耳鸣 / 空间扭曲 / 鬼怪 / 道法 / 召唤
│    → boardFormat=table（§4.8 五拍），boardDuration=8～12s，镜数 5～6
│
├─ 命中任一 → 【情绪爆发 / 转折场景】
│    哭泣 / 怒吼 / 崩溃 / 震惊 / 告白 / 告别 / 下定决心 / 心碎 / 绝望 / 悔恨
│    → boardFormat=table，boardDuration=7～10s，镜数 4～5
│
├─ 命中任一 → 【建立 / 过渡场景】
│    走进 / 走出 / 时间流逝 / 纯空镜 / 场景切换 / 过渡 / 环境建立（无人物对话或动作）
│    → boardFormat=table（3～4 镜），boardDuration=5～6s
│
└─ 默认 → 【对话 / 叙事场景】
     对话 / 商量 / 争论 / 独白 / 日常行动 / 叙述推进
     → boardFormat=table，boardDuration=5～8s，镜数 3～5
```

### 每镜时长参考

| 场景类型 | boardDuration | 镜数 | 每镜时长 |
|---------|--------------|------|---------|
| 建立 / 过渡 | 5～6s | 3～4 | 1.5～2s |
| 对话 / 叙事 | 5～8s | 3～5 | 2～3s |
| 情绪转折 | 7～10s | 4～5 | 2～3s |
| 超自然 / 异界 | 8～12s | 5～6 | 1.5～3s |
| 动作 / 追逐 | 10～15s | 一镜到底或密集快切（8～12 拍·无固定上限） | **快切1～2s（电光火石·逐秒≠碎镜）· 慢戏剧3～4s · 禁全镜同速** |
| 表演 / MV | 12～15s | 6～7 | 2～3s |

（旧 4s 下限教条已废·2026-07-17 拍板「密度守恒」：出片拍长由 video-prompt-writer 子agent 按内容自主分析定长（打斗 1~2s 电光火石、叙事/情绪拍可 3~5s+），硬要求=描述密度与时长守恒（过稀长拍会被写入闸退回补密）；本 skill 只管设计板落地，不管出片时长。）

**强制规则**：
- 同一段情节含多种信号时，**优先级从高到低**：表演/MV > 超自然/异界 > 动作/追逐 > 情绪转折 > 建立/过渡 > 对话/叙事
- `boardMeta.boardNote` 必须记录：`场景类型：<类型> · boardFormat=<format> · boardDuration=<Xs> · 理由：<信号词>`
- `variantParams.shotDuration` 存在时直接使用，跳过场景类型时长决策（但 `boardFormat` 仍由场景类型决定）

## 3. 拆镜流程

### 3.1 编剧定节拍（每场景）

抽出"起因 → 压力 → 转折 → 反应 → 落点"的情绪节拍。再从台词、动作、节拍中拆出连续 Cut：

- 1 个视觉瞬间 = 1 个 Cut
- 每个 Cut 必须独立描述，不与相邻 Cut 共用主体
- 对白 / OS / VO 全部分配到具体 Cut
- 心理必须外化为可见证据（手部、视线、站位、道具、光线、声音）

### 3.2 导演按 6-7 镜 / ≤上限时长 拆板

在同一场景内，按 Cut 顺序连续分组（上限时长 = `variantParams.shotDuration` 或默认 15s）：

- 镜数与时长按 §1.2 约束
- 触及任一边界（上限时长或镜数上限）就开新板
- 如某 Cut > 2s（建立镜或转折点 3-5s），其他 Cut 压回 2s 保证 6-7 镜可装下
  - 例（默认 15s）：`4+2+2+2+2+2 = 14s / 6 镜`，或 `3+2+2+2+2+2+2 = 15s / 7 镜`
  - 例（shotDuration=30s）：`5+4+4+4+4+4+5 = 30s / 7 镜`
- 单场景本身超上限时长时按连续动作或情绪落点拆多板

### 3.3 镜头字段表（每个 Cut）

> **13 列定义以 `tapcanvas-storyboard-expert § 分镜表格输出格式` 为唯一权威，此处不重抄。** 每个 Cut 的逐列填写规则（景别/镜头/时长/内容/台词/镜头运动/站位/音效/衔接/画面/备注）均按该规范执行；本 skill 的 `shotText`（§6.2）与 prompt 表格（§6.1）按同一 13 列规范对齐。

---

## 4. 创作纪律（Director Discipline）
> **完整创作纪律已移到 `references/director-discipline.md`（同目录）——拆镜/写画面描述前先 `read_file` 它、逐条应用**，别只凭下面骨架硬写（漏了=PPT感/换脸/双静对峙）。
> 骨架要点（细则在 reference）：①抽象心理→可见物理证据，禁纯 VO+静帧；②景别叙事链一档景别一个主信息；③每镜=有幅度物理动作+独立运镜句+spoken dialogue 原文对白；④逐主体分别写运动，禁双静对峙（主角静则反派/环境必动）；⑤轴线/银幕方向全程锁定；⑥特写给情绪叙事权；⑦导演签名段落统一母题。

## 5. 编剧 / 导演双审门禁

每板提交生图前必须连续审稿。

### 5.1 编剧审稿（先保证"故事成立"）——要点清单

- 剧情覆盖：本板起点/终点/承接清楚；所有板合并覆盖整章关键事件
- 冲突递进：每 Cut 推动信息揭示/压力增强/人物选择/关系变化/悬念落点至少一项
- 人物动机可读：从 `内容` 与 `画面描述` 看得出角色为何震动/迟疑/恐惧/行动
- 台词归属准确：原文对白/OS/VO 分配给真正发生该情绪或信息的 Cut
- 板间钩子明确：末镜留可承接的动作/视线/声音/道具/情绪落点

不通过 → 重排剧情节拍后重新拆 Cut，禁止直接进入图片 prompt。

### 5.2 导演审镜（再保证"能拍、能剪、能视频化"）——要点清单

- 景别有理由：建立用全景、关系/对话用中景/中近景；特写必须携带微表情/手部/视线/物件/声音触发证据
- 插入/物件内容镜构图铁律：先「角色在看」交互镜、再接内容插入特写；严禁书页/信件正面摊平朝观众（朝向服从角色视线）
- 一个 Cut 一个清晰节拍·禁压缩：跨场景/跨时间必须拆独立 Cut/板/clip，禁为丝滑转场把多场多时压进一条短片段
- 同一 clip 内多 Cut 无时间跳跃必须显式标「时间连续 / one continuous take, no time jump」（用户 2026-06-23 定调），否则连续戏被剁成碎镜 PPT；口诀：跨时间→拆＋过渡，不跨时间→合＋标连续
- 场景/时间切换必须有过渡（用户定调）：换场先建立镜、跳时先渐隐+环境变化，过渡单独给镜
- 人像摄影减法成立：明确情绪主体、1-2 个证据细节、功能性留白（见 §4.5）
- 运镜服务动作：镜头运动绑主体动作/情绪变化，禁无目的「缓推」
- 衔接可执行：能转成动作连续/视线匹配/声音桥/道具匹配/光线延续/构图方向
- 空间关系稳定：同场景左右/前后/距离/视线不无故跳变，跳变须在 `衔接` 写明原因
- 节奏可拍：镜数/动作密度/台词长度匹配单镜时长（见 §1.2）

不通过 → 重写镜头/景别/运镜/衔接/时长。**完整双审流程以 `tapcanvas-storyboard-expert §「编剧 / 导演双审流程」`为准。**

### 5.3 shot_table_critic 提示词预检（提示词是唯一免费返工点）

> **核心原则：提示词质量决定产物质量。生图之前把提示词改对，产物一次过；生图之后才发现问题再重生成，是双倍额度浪费。视觉复查（analyze_image）是事后学习工具，绝不是生产环节——禁止靠"出图→视觉发现问题→重出"循环来保质量。**

完成内部双审后，**在提交生图之前**，将本板的 `shotText`（完整 13 列分镜表内容）连同 `boardMeta.boardNote` 一起传入 `tapcanvas_shot_table_critic`；必须显式使用 `reviewMode="text_storyboard"`，`shotTable=shotText`，`brief=boardMeta.boardNote`：

```
调用规则：
- 最多调用 1 次（禁止反复调到 pass，会无限循环）
- 按返回的 topFixes 逐条改写对应 Cut 的字段（镜头运动 / 时长 / 景别 / 站位 / 内容）
- 改完 1 次后，无论 score 是否达满分，直接进 §5.4 生图
- 生图后禁止再以"视觉质检结果"为由触发重生成——那说明提示词预检没做好，要回头改流程，不是烧额度补救
```

**动作/打斗场景必须关注的 critic 项**（这些是提示词层面的检查，不是图像层面）：
- 快慢节奏对比：shotText 中是否写了快切段（1-2s/格）+ 慢镜情绪峰值（3-4s）；boardNote 有无镜号分配说明
- 景别覆盖：建立层（宽/全）→ 动作层（60-70%中景/中近）→ 强调层（特写/大特写）三层是否都有对应 Cut
- 站位/轴线：每 Cut 的站位图列是否有真实 ▲⊙ 图示（非纯文字），boardNote 是否说明轴线方向

**工具调用**：`tapcanvas_call_tool` → `tapcanvas_shot_table_critic`，直接调用，无需先查 schema。**禁止用 `tapcanvas_analyze_image` 代替**——analyze_image 是图像视觉工具，此步在生图前调用，没有图，必须走 shot_table_critic 做文本预检。

### 5.5 交付前对照速查表

交付前**逐项**对照 §1 各小节确认：

1. §1.1 工具与节点合法
2. §2.5 场景类型已识别；`boardFormat` / `boardDuration` 已写入 `boardMeta.boardNote`
3. §1.2 时长满足 `sum(shotDurations) ≤ boardDuration`；**单板 ≥ 3 镜**（硬下限），镜数偏离默认范围已在 `boardMeta.boardNote` 说明
4. §1.3 prompt / shotText / shotDurations 三件套齐全；**`boardFormat=table` 时 prompt 以 `Film storyboard table —` 开头；`boardFormat=design_doc` 时以 `Film production design document —` 开头（§6.1b）；禁止单图描述**
5. §1.4 boardMeta 五件套全非空；`totalDuration` 与 `boardDuration` 一致
6. §1.5 数组长度对齐
7. §1.6 角色绑定无错位
8. §1.7 边连接无源文本→设计板
9. §1.8 整章剧情完整覆盖
10. §4 创作纪律自检全部通过
11. **语义一致性复核**：由当前 agent 结合整板上下文检查同一 Cut 的运动方式、时空、板式、画面材质与摄影意图是否互相否定；禁止用关键词表、正则或退役 R1–R7 代替语义判断。发现矛盾时在同一创作链内修订相关字段；该复核不得实现为 Hono/Web 的运行时语义闸门。
12. **可执行性复核**（§4.2b）：由当前 agent 判断抽象描述是否已经投影为模型可执行的可见状态变化、运动路径或材料反馈；不足时同链具体化，不按词语命中机械拦截。

任一项不满足 → 修订当前板的内容；**禁止**在结果说明中 声称已通过。

---

## 6. 字段规范

### 6.1 prompt 模板（英文图片生成提示）

`prompt` 字段是实际传给所选图片模型的提示。**图片内所有文字标注用中文**；视觉风格关键词（anime、linework 等）保留英文以确保模型正确解析。

#### 全局风格包注入（来自 §2.2 自动推断，强制）

每板在写 prompt 之前，先从 §2.2 取出 `styleModules`（Block 1-4 + 场景专属描述），写入以下字段：

- `boardMeta.styleTags`：Block 1-4 + 场景专属的中文关键词摘要，顿号分隔
- `boardMeta.cameraParams`：Block 2 光影参数摘要（中英混合）
- `prompt` 前缀：Block 1 → Block 2 → Block 3 → Block 4 → 场景专属描述，英文，各块空行分隔

`userHints` / `generationConfig` 中明确提供风格时，以用户内容覆盖对应块，其余块保留自动推断结果。

每个 Cut 的 `画面` 列只负责该镜的主体 / 构图 / 动作 / 光线落点 / 关键证据；全局风格词只写一次（prompt 前缀），**禁止**在 `画面` 列重复堆叠。

#### prompt 主模板

> 下方 TABLE HEADER ROW 的 13 列：**列定义权威在 `tapcanvas-storyboard-expert`，此处仅为渲染模板**（本节及 §6.1b 是全 skill 唯一的一份图片 prompt 模板 + RENDER RULES，其他小节不得重抄）。

```
Film storyboard table — [场景标签，英文] — [N] cuts, 16:9, table layout with header row + [N] data rows + bottom META FOOTER bar.
BLACK CHALKBOARD STORYBOARD STYLE: matte black background throughout the entire image. Each panel cell contains a chalk white line art sketch — gestural rough strokes, no color fill, no gradients, no photorealistic shading, pure sketch line quality only. The 画面 column panels use bold black-and-white line art: crisp clean linework, high contrast black lines on white background (or chalk white lines on matte black), zero color fill, zero gray shading, zero hatching, pure contour lines only. Table grid lines in dim chalk-gray. Header bar in dark slate with white chalk-style Chinese labels.
[仅 variantParams.fullColor=true 时，删除上方黑板线稿行，替换为：§2.2 Block 1 核心电影风格 + Block 2 光影设计 + Block 3 色调调控 + Block 4 整体氛围 + 场景专属描述（英文，各块空行分隔）]
Portrait-photography-first composition: one emotional subject per panel, functional negative space, subject-background separation, restrained background detail, off-frame implication. No random decorative Chinese characters, no watermarks.

TABLE HEADER ROW (bold dark bar, white Chinese labels, 13 columns):
镜号 | 画面 | 时长 | 镜头 | 景别 | 内容 | 台词 | 镜头运动 | 画面描述 | 人物站位 | 音效 | 衔接 | 备注

[Cut 01 · SHOT_SIZE · Ns · MOVEMENT]
画面：[black-and-white line art storyboard sketch — crisp clean black contour lines on white background; no color fill, no gray shading, no hatching; pure linework only. Subject: 英文视觉描述，描述情绪主体、构图裁切、留白方向、主体/背景分离、光线（以线条疏密和明暗对比表现）、1-2 个关键证据；不要铺满全部环境；不要重复整板全局风格包]
时长：[Ns（0:AA-0:BB），如 3s（0:00-0:03）]
镜头：[焦段+角度，中文，如 50mm 平视]
景别：[中文景别（功能 tag），如 中近景（街口）]
内容：[3-5句，中文；①本镜核心视觉动态（粒子/光效/运动的具体状态变化）②角色外观细节（发丝/衣摆/肢体在光影气流中的微动）③面部/眼神/姿态的情绪证据④光影变化过程（启动/收拢/消散/明暗流转）⑤收尾落点或下镜钩子；禁止只写"某人做某事"一句话]
台词：[@<角色>（<行为>）：「<台词>」 或 [无台词]]
镜头运动：[<中文运镜> / <English Term>，如 缓推 / Slow Push-in，并在该格内画 sketch 示意图：摄影机方框 + 方向元素]
站位图：[MANDATORY bird's-eye blocking diagram — draw the actual schematic, do NOT replace with text only. Chalk white line art on matte black cell background. Layout template to follow EXACTLY:

┌──────────────┐
│  ⊙名A        │  ← chalk rectangle = scene boundary
│       ▲cam   │  ← ▲ = camera with arrow pointing at subjects
│    ⊙名B ···>│  ← ⊙ = character circle + Chinese name
└──────────────┘  ← ··· = dotted movement arrow if character moves

Rules: (1) chalk white lines on matte black, no color fill, no shading; (2) ▲ marks camera position + a short arrow indicating lens direction; (3) each character gets ⊙ circle with their Chinese name beside it; (4) if character moves this cut, add dotted arrow showing path; (5) label the scene boundary with a simple rectangle; (6) BELOW the diagram, add one text line: 摄像机@位置, 角色A@画左/画右+朝向, 角色B@位置+朝向. (7) 纯空镜写 [空镜] in center of cell. (8) Show only characters actually on screen this cut.]
音效：[环境音/人物音/配乐线，最多 3 条用顿号分隔，或 [静默]]
衔接：[中文，说明与上一镜/下一镜的动作、视线、声音、道具、光线或构图衔接]
备注：[该镜在情绪弧线中的功能判断，1句，或 [无]]

[Cut 02 · ...]
...
[Cut NN · ...]

META FOOTER BAR (bottom of image, 5 equal-width cards with small icons, bold dark bar, white Chinese labels):
🎨 整体风格：[styleTags 顿号串接]
📷 摄影参数：[cameraParams 顿号串接]
👥 动作设计：[actionArc 顿号串接]
🔊 音效设计：[audioArc 顿号串接]
⏱️ 时长总计：[totalDuration，如 0:15 (15秒)]

RENDER RULES: (1) Bold header row at top with 13 Chinese column labels. (2) 画面 column follows the linework style already defined in the preamble (or §2.2 CG style pack when variantParams.fullColor=true); one emotional subject per panel, functional negative space, subject-background separation. (3) 时长 column: per-cut seconds + cumulative timecode range. (4) 镜头运动 column must include a small sketch icon (camera box + arrow/dot/dual-frame) next to the bilingual label. (5) 站位图 column: MUST contain an actual drawn bird's-eye blocking diagram exactly per the 站位图 field spec above (▲ camera + ⊙ named characters + boundary rectangle + dotted paths + one text line below); a text-only cell with no drawn symbols (▲ ⊙ rectangle) is a render failure. (6) 衔接 column: concrete shot-to-shot transition logic, not generic words. (7) 音效 column: explicit sound layers, no abstract mood words. (8) 备注 column: director's emotional-function note for this cut, including negative-space function when used. (9) All label and content text in Chinese. (10) Clean table grid lines. (11) Unique zero-padded cut numbers. (12) No random hanzi outside designated table cells. (13) Bottom META FOOTER BAR with 5 equal-width cards is mandatory — never omit. (14) Global style pack written once in preamble — do NOT repeat style keywords inside individual cut panels.
```

#### 字段对应规则

- `SHOT_SIZE`（prompt 内英文缩写）：全景=`WIDE`，中景=`MEDIUM`，中近景=`MCU`，近景=`CU`，特写=`ECU`，航拍=`AERIAL`
- `MOVEMENT`：固定=`STATIC`，缓推=`SLOW PUSH`，后拉=`PULL BACK`，手持=`HANDHELD`，跟随=`TRACKING`，快切=`RAPID CUTS`，定格=`HOLD`
- `画面` 列（storyboard sketch）描述用**英文**，这是给图像模型渲染内容图的核心约束，混入中文易导致汉字泄露
- `画面` 列像人像摄影师写给摄影指导的指令：明确主体 / 裁切 / 留白方向 / 背景减法 / 景深 / 光线如何读脸/手/关键道具
- 全局风格包必须集中写在 prompt 前部并同步映射到 `boardMeta.styleTags / cameraParams`；**禁止**在每个 Cut 的 `画面` 列重复堆叠 `UE5 / 8K / cold blue / movie-level lighting / 3D CG`
- 其余 10 个文字列（时长 / 镜头 / 景别 / 内容 / 台词 / 镜头运动 / 音效 / 衔接 / 备注 + 表头）全部用**中文**
- `镜头运动` 列必须双语 + sketch 示意图。典型示意：
  - `缓推 / Slow Push-in`：`▢ ─→`
  - `后拉 / Pull Back`：`▢ ←─`
  - `手持快切 / Rapid Cuts`：`▢→ ←▢`
  - `定格 / Hold`：`▢ •`
  - `手持/双人对峙 / Handheld Standoff`：`▢ ▢▢`
- `音效` 列与 `boardMeta.audioArc` 必须保持一致：单镜逐镜列出，audioArc 是把所有镜头压成一条全局弧线
- 有角色参考图（`characterReferenceNodeIds` 非空）时，prompt 末尾追加：
  `Character appearance MUST exactly match the attached reference image. 不同角色人脸不重复，无串脸。`
- **禁用结构标签**：`Zone 1/2/3` / `LEFT/RIGHT` / 百分比等不得出现在 prompt 中（会被模型渲染成可见文字）

### 6.1b prompt 模板 — 综合制作设计文档（boardFormat=design_doc 专用）

> 仅当 §2.5 判定 `boardFormat=design_doc`（表演/MV 场景）时使用。其他场景类型一律使用 §6.1 标准分镜表格模板。

本格式生成一张包含多个面板的综合制作设计文档图，替代 §6.1 的表格 prompt，其余字段合同（§6.3 data、§6.2 shotText）不变。

> 全局风格包注入：同 §6.1（强制），规则不重抄。

#### design_doc prompt 主模板

```
Film production design document — [SCENE_LABEL, English] — [N] key cuts, 16:9, structured multi-panel layout. [GLOBAL STYLE PACK IN ENGLISH]. Production design board for performance/MV scene pre-production.

TITLE BAR (top strip, dark background, white text):
"[场景中文名] カット構成・カメラワーク設計図" — scene type label on right side

UPPER SECTION (two columns, side by side):
LEFT column (40% width) — Character design panel labeled "キャラクター参考":
  Multi-angle character sheet on neutral light-gray background — front view / side view / back view / face close-up, arranged in a horizontal row; costume and hair annotation labels in Chinese.
  Character: [角色名、服装、发型、骨相、气质 — 英文描述]
  Character appearance MUST exactly match the attached reference image (if provided). No facial duplication between characters.

RIGHT column (60% width) — split into two rows:
  TOP row (scene reference panel, labeled "シーンアート参考"):
    [SCENE_DESCRIPTION in English — environment, lighting atmosphere, materials, no characters present]
    Cinematic concept art, 16:9 crop within panel, no human figures.
  BOTTOM row (camera position floor plan, labeled "カメラポジション図"):
    Overhead schematic line-art diagram (top-down view, minimal style, not photorealistic):
    - Camera positions labeled ①②③[④] with thin directional arrows
    - North / East compass labels
    - Subject/performer position marked with X or circle
    - Stage/room boundary shown as simple rectangle
    - Sub-labels: 摄像机位置 / 表演区域

MIDDLE SECTION (horizontal row of panels):
  LEFTMOST panel (labeled "ライティング参考"):
    [LIGHTING_DESCRIPTION in English — warm/cool, key light source type, mood, color temperature]
    Reference mood image, cinematic quality, no characters.
  Cut panels ([N] panels, each labeled "Cut 0N"):
    Each cut panel contains:
    (a) A cinematic rendered image for that cut — [CUT_N_VISUAL_DESCRIPTION]
    (b) Technical annotation strip directly below the image (small text, 2 lines):
        Line 1: 焦点長:[X]mm　カメラ移動:[中文运镜]
        Line 2: 高さ:[X]cm　深度差野:[X]%

RIGHT SIDEBAR (vertical column, production notes, labeled "制作注意事项"):
  推奨レンズ：[lens type in Chinese + English, e.g. シネマティック アナモルフィック / Cinematic Anamorphic]
  カラーグレーディング：[color grading keywords in Chinese, e.g. ウォームアンバー / Warm Amber]
  注意：[1-2 lines of key production notes relevant to this scene type]

META FOOTER BAR：逐字复用 §6.1 模板末尾的五卡片 META FOOTER BAR（🎨整体风格 / 📷摄影参数 / 👥动作设计 / 🔊音效设计 / ⏱️时长总计）。

RENDER RULES（仅 design_doc 增量；黑板线稿画风、禁乱字、禁水印、META FOOTER 必带等通用项同 §6.1 RENDER RULES，不重抄）:
(1) Camera floor plan must be minimal schematic line-art — NOT photorealistic; black lines on white, no shading.
(2) Character panel: multi-angle poses horizontally arranged, clear silhouettes, linework style per §6.1 preamble.
(3) Scene reference panel: render style follows global style pack in preamble; no human figures or silhouettes — environment and atmosphere only.
(4) Each cut panel carries a technical annotation text strip below it; panel render style per §6.1 rule (2).
(5) All panel labels in Chinese/Japanese bilingual; clean thin border lines between panels; production notes sidebar is plain text list, no decorative images.
```

#### 字段对应规则（design_doc 专用）

- `[SCENE_LABEL]`：场景英文简称，如 `Piano Recital Hall — Performance Scene`
- `[GLOBAL STYLE PACK]`：同 §6.1，全局风格包英文，放在 prompt 前部
- `[角色描述]`：从 `characterReferenceNodeIds` 对应参考图 label + prompt 提取，英文写入 prompt；有参考图 URL 时写 `Character appearance MUST exactly match the attached reference image`
- `[CUT_N_VISUAL_DESCRIPTION]`：每个 Cut 的画面描述，英文，同 §6.1 `画面` 列规范（情绪主体 / 构图裁切 / 留白 / 主体分离 / 光线）
- 技术标注数值来源：`boardMeta.cameraParams` 中提取焦距、运动方式；高度和景深由导演按场景类型标注（无固定默认值，必须有具体数字）
- `shotText` 仍按 §6.2 格式输出（design_doc 格式不影响 shotText 内容）

### 6.2 shotText 模板（中文可读，供下游消费）

`shotText` 是中文可读的分镜脚本，存入节点 data，供下游 `tapcanvas-video-workflow` 作为事实型设计板输入；真正提交给供应商的可执行视频提示词仍必须由 `video-prompt-writer` 按 `tapcanvas/video-prompt-authoring@3.7.0` 编译，并在同一上下文完成 embedded authoring 自检。列定义以 `tapcanvas-storyboard-expert § 分镜表格输出格式`（13 列规范）为准；`画面（分镜图）`列在图片中以 §2.2 推断的风格渲染，`shotText` 里写 `[待生成]` 或 URL 占位符。

```
【场景 <编号> · <场景名> · <日/夜> <内/外>】设计板 <NN>
推荐时长 ~<X>s · <N> 个镜头

<13 列 Markdown 表（镜号→备注）：列序、列名与逐列填写规则以 tapcanvas-storyboard-expert《分镜表格输出格式》为唯一权威，此处不重抄；每 Cut 一行，`画面（分镜图）`列写 [待生成] 或 URL 占位>
| Cut 01 | ... |
| Cut 02 | ... |

──────────────────────────────────────
🎨 整体风格：<styleTags 顿号串接>
📷 摄影参数：<cameraParams 顿号串接>
👥 动作设计：<actionArc 顿号串接>
🔊 音效设计：<audioArc 顿号串接>
⏱️ 时长总计：<totalDuration，如 0:15 (15秒)>
──────────────────────────────────────
```

> - `画面`（分镜图）列在图片中以 §2.2 推断的风格渲染；`shotText` 中不重复列出；`画面描述` 列即原 `画面` 文字字段
> - `衔接` / `音效` / `备注` 列分别是下游视频生成 / 配音 BGM / 剪辑节奏的专用通道，不能省略
> - 末尾五行 META 摘要带必须输出，且与图片底部 META FOOTER BAR 内容一致

### 6.3 节点 data 最小契约

```json
{
  "kind": "image",
  "imageModel": "<generationConfig.imageModel 或 gpt-image-2>",
  "imageSize": "<generationConfig.imageSize 或 4K>",
  "aspect": "16:9",
  "label": "<场景编号 + 场景名 + 设计板 NN>",
  "draftByAgent": true,
  "creationStage": "intent_generate_shot_design_board",
  "productionLayer": "design_board",
  "prompt": "<英文图片生成 prompt，见 §6.1>",
  "shotText": "<中文分镜脚本，见 §6.2>",
  "storyboardScript": "<可省略；省略时 bridge 复制 shotText>",
  "shotDurations": [3, 2, 2, 2, 2, 2, 2],
  "shotTimecodes": ["0:00-0:03", "0:03-0:05", "0:05-0:07", "0:07-0:09", "0:09-0:11", "0:11-0:13", "0:13-0:15"],
  "shotAudios": [
    "远处车流声、风过巷口的低响、低频心跳压底",
    "心跳拉到顶、环境音瞬间抽空(Audio Drop)",
    "..."
  ],
  "directorNotes": [
    "黄昏暖光建立基调，冲突第一秒爆发",
    "情绪爆发点，台词+微表情双重推高张力",
    "..."
  ],
  "shotBlockings": [
    "摄像机@正面中景, 李长安@画面中央距镜头3m朝向摄像机, 独处无对戏角色",
    "摄像机@侧面45°, 李长安@前景左1.5m背对摄像机, 大伯母@背景右3m面朝李长安, 两人斜线对视"
  ],
  "boardFormat": "<table | design_doc>",
  "boardDuration": "<由 §2.5 决策的秒数，如 8>",
  "boardMeta": {
    "styleTags": ["韩国都市爱情", "黄昏暖光", "浅景深", "35mm 胶片质感", "克制隐忍"],
    "cameraParams": ["24fps", "85mm 人像压缩", "Shallow DOF", "Functional Negative Space", "侧逆光眼神光"],
    "actionArc": ["甩手对峙", "正反打吵架", "凑唇一吻", "紧紧拥抱", "沉默收束"],
    "audioArc": ["环境底噪", "心跳压底", "Audio Drop", "弦乐起始渐强", "戛然收束"],
    "totalDuration": "<由 boardDuration 决定，如 0:08 (8秒)>",
    "boardNote": "<必填：场景类型 · boardFormat=<format> · boardDuration=<Xs> · 理由：<信号词>；如有镜数偏离默认值也在此说明>"
  },
  "sourceNodeId": "<sourceTextNodeId>",
  "chapterId": "<chapterId>",
  "chapterTitle": "<章节标题，若已知>",
  "sceneReferenceNodeIds": [],
  "characterReferenceNodeIds": [],
  "charactersOnScreen": ["<本板实际出镜或出声的角色名>"],
  "anchorBindings": [
    { "kind": "character", "label": "<角色名>", "entityId": "<roleSlug 若已知>", "refId": "<已验真的 character-card/v3 node/material/version ID>" }
  ],
  "shotGroupStart": 1,
  "shotGroupEnd": 7,
  "sceneDuration": "<~Xs>",
  "sceneLabel": "<场景编号，如 1-1>"
}
```

字段补充：

- `boardMeta.styleTags / cameraParams / actionArc / audioArc` 都是字符串数组，长度 3-6 为佳
- `boardMeta.actionArc` 与 `boardMeta.audioArc` 必须按 Cut 顺序对应到逐镜核心动作 / 核心音效，不得脱离表格内容自由发挥
- `shotBlockings` 是字符串数组，长度必须与 Cut 数相等；每项格式：`摄像机@位置, 角色A@相对位置+朝向[, 角色B@...]`；纯空镜写 `[空镜，无人物站位]`；供下游视频生成 / 导演台 3D 摆场参考

### 6.4 节点 ID 与布局

- ID 格式：`agent-generate_shot_placeholders-<batchUlid>-board-<twoDigitIndex>`
- 起始位置：源节点位置未知 → `(780, 220)`；可推断 → `(source.x + 360, source.y)`
- 前端画布会自动重排为横向行（同 y，x 递增），无需精确计算每个节点 x

### 6.5 角色 / 场景参考节点收集

遍历 `flowSummary.nodes`，按以下**优先级顺序**为每个 `charactersOnScreen` 中的角色收集参考节点：

#### 场景参考（sceneReferenceNodeIds）

扫描条件：`referenceType === "scene"` 且 `sourceNodeId` 与当前源节点匹配（或同 chapterId）。

#### 角色参考（characterReferenceNodeIds）——canonical 单轨

每个 `charactersOnScreen` 角色只接受以下锚点：

- `referenceType === "character"`；
- 精确 `roleName` 与 canonical 出镜名逐字一致；
- `characterAssetRole === "identity_anchor"`，或当前镜明确要求且精确匹配的 `state_variant`；
- 节点/资产 ID 经 `tapcanvas_image_refs_get` 验证为真实 ready 图片。

`draftByAgent` 空节点、role portrait、pose、ensemble、label 命中、prompt 外观描述和跨章节 URL 都不能替代 identity anchor。跨章节复用只使用素材目录返回的完整稳定 ID，并保持精确 `roleName/stateKey/stateVersionId`。

无 `chapterContext` 时通过 `tapcanvas-api` 读取当前 flow 和项目素材目录，仍只按上述结构化字段收集。缺角色锚时回到同一逻辑任务，调用 `tapcanvas-character-card` 生成并 reconcile 后再出设计板；当前受限 intent 没有生图能力时显式返回缺失的 canonical 角色资产，不得裸生成或用文字外观兜底。

**结果写入规则**：

```json
{
  "sceneReferenceNodeIds": ["<scene_ref_id>"],
  "characterReferenceNodeIds": ["<char_ref_id>"],
  "anchorBindings": [
    {
      "kind": "character",
      "label": "<角色名>",
      "entityId": "<roleSlug，若已知>",
      "refId": "<与 characterReferenceNodeIds 一致的真实 node/asset descriptor>"
    }
  ]
}
```

纯空镜允许 `characterReferenceNodeIds=[]`。只要 `charactersOnScreen` 非空，每个 canonical 角色都必须有经验证的角色卡 ID；缺失时先补角色卡，不能以空数组继续。

`characterReferenceNodeIds` / `sceneReferenceNodeIds` 非空时，建立 `source=refNodeId → target=boardNodeId` 的边（`sourceHandle: "out-image"`, `targetHandle: "in-image"`）。

### 6.6 交付核对

按本轮设计板清单核对真实画布节点和媒体任务回执。只有 prompt/shotText 的板尚未生图，继续提交授权范围内的剩余项；已受理任务不重放。提交后由持久媒体执行器回填，不能把 queued/running 当作图片成功。用户只要求占位时明确报告占位交付。
