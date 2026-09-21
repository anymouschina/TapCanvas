# 设计板 v2→v5 演进经验

> 本文档是 `tapcanvas-generate-shot-placeholders` skill 的踩坑账本。第一章 4 场（s01 强拆 / s02 分钱 / s03 离别 / s04 异变）共 17 次出图，从 `nano-banana-pro` 一路打磨到 `gpt-image-2`，每次失败的具体形态、根因、修复手段都记在这里，作为新章节出图时的"高压线"参考。
>
> 原始记录：`test/ch1/05-board-v2/version-log.md`

## 时间轴

| 阶段 | 模型 | 关键发现 / 痛点 |
|------|------|----------------|
| v2（手工/无 ref）| nano-banana-pro | 模板里 `5%` `75%` `20%` zone 比例百分比被当作可见文字渲染；缺底部全景；汉字泄露在古书页 |
| v3（加文字/编号唯一约束）| nano-banana-pro | s03 部分修好；s04 古书"abstract calligraphic strokes"措辞仍触发汉字先验 |
| v4（功能性留白 + base64 ref）| nano-banana-pro | s04 古书左页彻底空白；引入 base64 ref 后 s01 layout 错乱、s02 渲染出"ZONE 1/2/3"大字 |
| v5（结构标签禁渲染 + 单角色场不补圆）| nano-banana-pro | s01/s03/s04 全合格；s02 多人物同环境**仍然塌成 2×2 grid + cut 重号**，3 次迭代不可逆 |
| v5+（换 gpt-image-2 + R2 公网 ref）| gpt-image-2 | s02 layout 立刻稳定 1×3 单列 + cut 唯一编号；但画风偏写实电影感 |

## 高压线明细

### 红线 1：单数字 cut 编号必塌

**症状**：`Cut 1 / Cut 2 / Cut 3` 在多人物同环境场景下被模型重号（"Cut 2" 出现两次，"Cut 3" 缺失）。

**根因**：模型对"3 个 cut"和"3 个相似格子"在同环境下倾向画 2×2 grid，第 4 格 metadata 不知填啥就复制 cut 02 的文本。

**修复**：一律用 `Cut 01 / Cut 02 / Cut 03` 零填充。s01-v4（强拆，多 cut 异质场景）+ s04-v5（单角色多 cut）实测零填充无重号。

**残留风险**：s02-v5（多人物同环境）即使零填充也仍重号 → 这种场景必须切 `gpt-image-2`。

### 红线 2：模板里写"Zone X" → 模型当画面文字渲染

**症状**：prompt 里写 `[Zone 1 - Title bar]` `[Zone 2 - Body]` `[Zone 3 - Scene wide shot]`，出图左上角和底部全景里出现"ZONE 1"、"ZONE 2"、"ZONE 3"白底大字。

**根因**：base64 ref 加入后，模型对结构性 markdown 标签的"这是给我看的、不是要画的"敏感度下降。模板里出现的字面文字，模型倾向当文字内容渲染。

**修复**：
1. 模板把 `[Zone N - …]` 改成 `[Title bar at top]` / `[Body, split LEFT / RIGHT]` / `[Bottom panorama strip]`
2. 显式新增 **CRITICAL STRUCTURAL-LABEL RULE** 段，列出禁渲染的所有 markdown 锚点（Zone/CUT/RIGHT/LEFT/[Cut thumbnail]/百分比）
3. 白名单"画面里允许出现的文字仅有：title bar、角色名+age/trait、Cut N metadata strip、camera-diagram CAM 标签"

### 红线 3："古书 / scroll / page of small characters" → 强制汉字泄露

**症状**：Cut 2 的"古书"在画面里被模型自动填上中日混合假字符。即使 prompt 显式说 "all visible text must be ENGLISH ONLY"。

**根因**：nano-banana-pro 对"ancient Chinese book"等高文化先验词组的视觉 prior 极强，会把 "ancient" 自动绑定 "calligraphy on yellowed paper"。

**修复**：放弃"用安全文字替代危险文字"思路，改为"取消该区域的文字承载"——把书页强行设为 **completely blank aged paper, no glyphs of any kind, paper grain only**。

**经验沉淀（功能性留白原则）**：当道具的视觉先验和文字约束冲突时，留白比"安全替代"更可靠。

### 红线 4：硬性"3 portraits stacked"塞进不在场角色

**症状**：s04 是李长安独自看书穿越的单人戏，但角色立绘强行塞了 LI LAO TOU（已死）+ HEI LAO DA（不在场）。

**根因**：generator system prompt 里有句 "If scene has only one main character, still output 3 panels (use supporting characters from the scene)"——这条规则误把"凑足 3 圆"当成审美需求。

**修复**：圆数 = 实际在场角色数（统计该组 cut 中出现过的不同 subject）。1 个就 1 个圆，最多 3 个，不补足。

### 红线 5：不传角色 ref → 跨 board 形象漂移 + 古风设定让现代角色穿古装

**症状**：
- 同一个李长安，在 s02 是浅色对襟长袍古风、在 s03 是黑立领夹克、在 s04 cut 4 直接扎髻穿古装
- 跨 board 面相完全不是同一张脸
- 古风场景（如 cut 4 "crude earth hut + moonlight"）让模型自动给现代角色"换装"

**根因**：纯文本 prompt 不可能让多次出图复刻同一张脸。模型对"古风设定"的整体 prior 会蔓延到角色造型。

**修复**：
1. 主角出场的 cut 必须把 character ref node 的 `referenceImages[]` 通过 `images: [...]` 字段附带传入
2. prompt 显式说 "MUST exactly match the attached reference image"
3. 跨时空 cut 加显式锁定 "Despite the ancient setting, character REMAINS in his MODERN clothing — do NOT redraw him as ancient-costume figure with hair bun"

### 红线 6：gpt-image-2 不接受 base64 data URL

**症状**：直接 POST `images: ["data:image/jpeg;base64,..."]` 到 gpt-image-2 → 502 `apimart task failed`。

**修复**：gpt-image-2 的 ref 必须是 https 公网 URL。项目走 R2（`R2_PUBLIC_BASE_URL` = `https://file.beqlee.icu`）。

`nano-banana-pro` 二者皆可（base64 / https 都跑通）。

### 红线 7：nano-banana-pro 多人物同环境 → 不可逆 2×2 grid

**症状**：s02 分钱场景（同一个院子里多个亲戚传钱），无论 prompt 怎么强约束 "EXACTLY 3 cut strips, single vertical column, NEVER 2x2 or 3x1 horizontal grid"，都被画成 2×2 方阵。3 次迭代（v2 / v3 / v4 / v5）不可逆。

**根因**：nano-banana-pro 的视觉先验对"3 个相似场景的 cut"倾向"4 格审美平衡"。同环境（同院子、同光线、同人群）令该先验更顽固。

**修复**：换 `gpt-image-2`。实测 1 次直出 1×3 单列 + cut 唯一编号，layout 稳定。代价是画风偏写实电影感（"清雅国风插画"约束被部分忽略）。

### 红线 8：单板超过 15s / 无衔接列 → 后续视频化断裂

**症状**：把一整段剧情压进一张设计板时，表格看似完整，但单板对应的视频段落会超过 15 秒；下游 `generate_video_nodes` 很难判断哪些镜头属于同一个短视频片段。若只写镜头内容、不写「衔接」，画面之间会像摘要列表，缺少动作、声音、视线或道具上的连续性。

**根因**：设计板图片不是章节总览图，而是下游视频生产的短片段蓝图。一个设计板如果超过 15s，就同时承担了多段视频节奏；没有衔接列时，LLM 会把相邻 Cut 当并列信息，而不是连续镜头。

**修复**：
1. 每张设计板必须满足 `sum(shotDurations) <= 15`，这是硬约束；超过就按连续动作或情绪落点拆成下一张板。
2. 保留 `≤7 镜` 只是布局上限，不是时长充分条件；即使只有 4 镜，只要总时长 >15s 也必须拆板。
3. 图片 prompt 和 `shotText/storyboardScript` 都必须有「衔接」列，写真实可拍的承接方式：动作连续、视线方向、声音桥、道具匹配、烟尘/光线溶接、构图方向等。
4. 禁止用“自然衔接 / 继续推进 / 镜头切换”这类空泛词替代转场逻辑。

### 红线 9：抽象心理 / 板尾无钩子 → 分镜像解说稿

**症状**：分镜表看似覆盖剧情，但 `内容` 和 `画面描述` 写成“看清算计、感到失落、眷恋断裂、情绪复杂”。读者能理解意思，图像/视频模型却只能生成泛化表情；板与板之间也常停在“本段结束”，下游视频没有可承接动作。

**根因**：编剧审稿只保留了叙事判断，没有把判断翻译成镜头里的可见证据。导演审镜缺少板尾承接目标，导致每板像独立摘要。

**修复**：
1. 所有抽象心理必须改成可见动作、站位、道具、光线或声音证据。例如“看清算计”改成“看孩子一眼，再看大伯母口袋，嘴角只压出很淡的笑”。
2. 每块设计板最后一镜必须留下下一板钩子：动作、声音、道具、光线或情绪落点。
3. “不刺激”的铺垫段不能随意省略。若后续奇遇依赖主角失去归属感，分钱冷落和祖屋倒塌就是情感根基。
4. 同主体连续感官体验（看书、耳鸣、扭曲、按桌、抬头到异界）应写成关键帧序列的连续依据，禁止默认每格渐隐。

### 红线 10：缺少人像摄影减法 → 画面信息满但情绪稀释

**症状**：设计板覆盖了剧情、人物、道具和环境，但每格都像舞台全景说明。人物脸、手、眼神和关键道具没有从背景中分离，群戏铺满画面，观众一眼看完所有信息，反而读不到主角的迟疑、被排斥、羞辱或恐惧。

**根因**：导演只做了影视调度，没有以人像摄影方式先选择情绪主体、证据细节和留白方向。为了“说明清楚”，prompt 把完整环境、所有角色和所有道具同时塞进一格，导致图像模型生成热闹但不纯粹的画面。

**修复**：
1. 每个 Cut 先确定唯一情绪主体，再只保留 1-2 个证据细节；其他信息通过画外声、虚焦、肩背、手势、门框、桌角或空间边缘暗示。
2. `画面` 描述必须写清主体/背景分离方式：浅景深、侧逆光、眼神光、虚焦背景、前景遮挡、明暗反差或轮廓光。
3. 人物情绪镜头优先 85mm / 100mm / 135mm 压缩背景；人物关系用 35mm / 50mm；广角只用于空间压迫或环境吞没人像。
4. 留白必须有功能：孤立、迟疑、被排斥、未知、画外威胁或下一镜承接。无功能的空画面不是留白。
5. 群戏仍按人像拍：先抓主角反应或关系轴，其他角色退为虚焦轮廓、边缘肩线、手部动作或画外声。

## 模型与场景类型的匹配建议

| 场景类型 | 推荐模型 | 理由 |
|---------|---------|------|
| 单角色多 cut（思考、独白、独自行动）| nano-banana-pro | 国风插画画风优势明显，layout 不易塌 |
| 异质多 cut（每 cut 环境/构图差异大，如强拆三幕）| nano-banana-pro | layout 自然分异，画风加分 |
| 多人物同环境（如分钱、对话、群戏）| **gpt-image-2** | 避免不可逆 2×2 grid 塌方 |
| 跨时空（现代/古代切换）| 任一 + 必传 ref + 显式锁定 | 不传 ref 必出"自动换装"，传了仍要 prompt 显式声明"clothing transition has NOT happened" |

## 调用记录

| 场 | 最佳版 | 模型 | 用时 | 关键修复 |
|----|--------|------|------|---------|
| s01 强拆 | v4 | nano-banana-pro | 30s | 结构标签禁渲染 + cut 编号零填充 + 角色 ref base64 |
| s02 分钱 | gpt-image-2 v2 | gpt-image-2 | 75s | 切换模型解 layout 顽固 + R2 公网 ref |
| s03 离别 | v4 | nano-banana-pro | 35s | 角色 ref base64 加锚定 |
| s04 穿越 | v5 | nano-banana-pro | 38s | 功能性留白（古书空白）+ 单角色 1 圆 + 跨时空衣着锁定 |
