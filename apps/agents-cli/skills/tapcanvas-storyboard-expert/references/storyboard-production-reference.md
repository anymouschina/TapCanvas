# 延伸参考

## 分镜表格输出格式 — 统一 13 列规范（渲染视图格式定义·全项目权威来源）

> **本表格是全项目分镜列定义的唯一真相源**。`tapcanvas-generate-shot-placeholders`（设计板执行器）的 `shotText` 与图片 TABLE HEADER ROW 均以本表格为准，有冲突以本节为准。
> **⭐定位（2026-07-04 起）**：在**出片链路**（video-workflow → orchestrate）里，13 列表**不再是手写工序**——小T 只写结构化 shots JSON，13 列表由**服务端从 shots 确定性渲染**（画布面板/对话里的展示视图），本节仅定义那个渲染视图的列格式。仅当宿主明确要求「文本分镜表交付物」（不出片、直接给人看/给设计板用）时，才按本节手写输出。

**当宿主要求输出故事板 / 分镜表 / 分镜脚本（文本交付物）时，输出如下 Markdown 表格**，将原文内容逐镜拆分填入：

| 镜号 | 画面（分镜图）| 时长 | 镜头 | 景别 | 内容 | 台词 | 镜头运动 | 画面描述 | 人物站位（俯视站位图）| 音效 | 衔接 | 备注 |
|------|------|------|------|------|------|------|----------|----------|------|------|------|------|
| SHOT_01 | `[待生成]` | 3s（0:00-0:03）| 50mm 平视 | 中近景（街口）| 角色A走向门口，转身回望，手指收紧门把 | “我不会回来了。”（低声） | 缓推 / Slow Push-in `▢─→` | 昏黄室内光，角色A背影居中，门缝透出冷蓝光，浅景深背景虚焦 | `<俯视站位图 nodeId>` | 风声低吟、木地板脚步声 | 从上一镜手部特写接此镜背影中景 | 分离落点 |

### 表头说明

| 列名 | 填写规则 |
|------|---------|
| **镜号** | `SHOT_01` 格式，与 JSON `shotId` 对齐 |
| **画面（分镜图）** | 分镜设计板生成后填入其 `nodeId` 或 `assetId`；设计板生成前写 `[待生成]`。禁止填图片 URL |
| **时长** | `Ns（0:AA-0:BB）`，如 `3s（0:00-0:03）`；**独立列，禁止与站位图合并**。忠实快切分支默认每个内部 shot 为 `1–3s`，超过 3 秒须在备注写不可再切理由 |
| **镜头** | 机位描述：焦段 mm + 角度，如”50mm 平视”、”24mm 低角”、”85mm 仰拍” |
| **景别** | `<景别枚举>（<功能 tag>）`：远景 / 全景 / 中景 / 近景 / 特写 / 大特写 |
| **内容** | **3-5 句**，依次覆盖：①核心视觉动态②角色外观细节（发丝/衣摆/肢体微动）③画面内每个出镜人物的自然反应与面部/眼神/姿态证据④光影变化过程⑤收尾落点或下镜钩子；禁止只写”某人做某事”一句话，也禁止给所有人套同一种夸张表情 |
| **台词** | `@<角色>（<行为动词>）：「<台词>」`；OS 用 `（OS）`；VO 用 `（VO）`；无台词写 `[无台词]`。忠实快切分支中，中文单次发言去标点后超过 8 字必须跨 2 个以上有功能差异的 shot，分段拼接后逐字还原原句 |
| **镜头运动** | 双语 `<中文运镜> / <English Term>`，并附 sketch 示意，如 `缓推 / Slow Push-in ▢─→` |
| **画面描述** | 可执行的图像/视频生成描述：主体外形 + 构图裁切 + 情绪证据 + 主体/背景分离 + 功能性留白 + 光线气氛（1-2 句） |
| **人物站位（俯视站位图）** | **空间敏感/多人/对峙镜必填**：用 `tapcanvas_render_blocking_diagram` 渲俯视站位图（角色站位+朝向+走位、机位+视锥、180°轴线），填入结果图片节点/资产 ID。禁用 gpt-image-2 脑补画，禁止填 URL。单人纯空镜写「——」 |
| **音效** | 环境音 / 人物音 / 配乐线，顿号分隔；无声段写 `[静默]`。忠实快切分支默认无 BGM、无字幕，只保留环境/动作/呼吸衣料/对白与功能性静默 |
| **衔接** | 与上/下镜的动作、视线、声音、道具、光线衔接逻辑；**禁止**写”自然衔接 / 继续推进”等空泛词 |
| **备注** | 该镜的 `来源映射 + 情绪/叙事功能`；如”原场次 2 第 3 句｜听者反应 / 分离落点 / 动作钩子”。超过 3 秒或偏离合同必须补原因；空写 `[无]` |

### 从原文拆分的方法

1. 按**场景切换**或**动作段落**划分镜号边界。
2. **内容**列提取原文可见动作（不写内心活动）。
3. **台词**列直接复制原文对白引号内文字；旁白/心理活动标注 `（OS）`。
4. **画面描述**列基于原文环境线索补全光线/空间，不得凭空创造原文未提及的场景元素。
5. 若原文某段无法拆出独立镜头（纯心理描写、时间跳跃），可合并到相邻镜头并在**内容**列注明”含OS”。

## `@引用` 协议（强制）

当章节剧本、`shotPrompts`、镜头正文或补充说明里需要引用角色卡、场景锚点、道具锚点、风格锚点时，统一使用 `@名称` 语法作为可机器消费的资产绑定 token。

- `@引用` 是协议字段，不是修辞写法；下游前端 / runner 会把它解析为真实参考资产。
- `@引用` 不要求前后带空格；允许直接与中文正文连写。
- `@引用` 允许与连词、并列结构和中文/英文标点紧邻，例如：
  - `严格延续@火塘宿夜与@借袍问鬼`
  - `参考@黄符、@鬼物图册、@人皮伪装`
  - `角色锁定@李长安、@老道`
- 生成时不得依赖“空格分词”才能成立；要默认消费端会按 `@token` 边界解析。
- `@引用` 的名称部分应尽量与项目内真实资产名、角色名、`visualRefName`、`scenePropRefName` 保持一致，避免使用临时别名、模糊简称或只对当前上下文可读的代称。
- 若同名资源存在歧义，应显式加可区分信息，而不是赌下游猜中。
- 若当前镜头没有命中任何可复用资产，不要伪造 `@引用`；应直接写普通文本约束，或显式指出缺少哪类锚点。

该协议同样适用于：

- `prompt`
- `shotPrompts`
- `storyboardContent` 中的镜头正文展开
- Seedance / 视频片段派生脚本里的资产引用说明

## 强制输出协议

1. 必须输出多个镜头，不得只给单段大提示词。
2. 顶层必须包含：
   - `schemaVersion`
   - `chapter`
   - `globalStyle`
   - `cast`
   - `relationshipGraph`
   - `modelingSpec`
   - `stopMotionSpec`
   - `atmosphereSpec`
   - `shots`
3. 每个镜头必须包含导演与生产关键字段：
   - `shotId`
   - `durationSec`
   - `narrativeGoal`
   - `subjectAnchors`
   - `crowdRelations`
   - `scene`
   - `rigAndPose`
   - `camera`
   - `lighting`
   - `actionChain`
   - `composition`
   - `dramaticBeat`
   - `performance`
   - `continuity`
   - `continuityLocks`
   - `readabilityChecks`
   - `failureRisks`
   - `negativeConstraints`
   - `prompt`
4. 章节证据不足时必须显式失败并指出缺什么，不得脑补关键剧情。

## 编剧 / 导演双审流程（强制）

章节分镜、故事板、设计板和 Seedance 片段脚本都必须先过编剧审稿，再过导演审镜。该流程是 agents-cli 的创作内审，不允许下沉给前端或后端用关键词/正则兜底判断。

### 编剧审稿

编剧负责判断故事是否成立：

- 提炼本段核心冲突、人物欲望、阻力、转折和悬念落点。
- 检查所有镜头合并后是否覆盖原文关键因果；不得只挑高潮画面，遗漏铺垫、反应或后果。
- 检查每个镜头的 `narrativeGoal` / `dramaticBeat` 是否推动信息、关系、选择、压力或情绪变化；若只是换角度重复同一信息，必须合并或重写。
- 检查台词、OS、VO 是否落在正确镜头，且与人物当下动机一致。
- 检查每个 15 秒片段或设计板的段尾是否有可承接的动作、视线、声音、道具或情绪钩子（供 exitState 文字接力）。

编剧审稿失败时，必须先重排剧情节拍和镜头边界，再继续输出。

### 导演审镜

导演负责判断镜头是否可拍、可剪、可视频化。**判据以 `references/镜头语言规则.md` 为准（拆镜前必读）**，核心闸口：

- **调度先于景别**：先写人物站位/朝向/距离/谁占画面优势；关系不变不得只靠换景别凑镜头。
- **轴线/视线**：对话/追逐/打斗锁 180° 轴线 + 视线匹配 + 出入画方向；越轴必须有中性镜/转身/重建空间解释。
- **景别+焦段+机位角度**：三者都要有理由——对话主力是 OTS 正反打而非"默认跟随特写"；焦段写心理含义（广角压迫/长焦隔离/标准自然）；俯仰角写权力关系。
- **构图/景深**：交付权力关系（位置/视线空间/留白用途/前中后景层次）；写浅景深+前景遮挡破 AI 贴片感。
- **运镜绑动作/心理**，不装饰；"慢"用"动作减少+凝视+缓推+长保持"，**不写真高帧慢动作**。
- **高潮不千篇一律**：除特写+缓推外，可静止远景/切黑/反应留白/声音抽空。
- **声音+表演链**：写环境音/静默/J-cut·L-cut + 可拍的微表演链（犹豫→视线逃避→呼吸停顿→手指收紧）。
- **镜尾可接力收束**：每镜结尾动作收住并形成客观 `exitState`；若选 `bridge_frames`，落幅还必须与真实目标尾帧逐项一致。单镜 `durationSec` 控 2–8s。
- `continuity` / `continuityLocks` 必须能解释上镜到下镜的空间、动作、视线、道具、光线或声音承接。

导演审镜失败时，必须重写相机、调度、衔接、时长或段尾收束描述；禁止用抽象“氛围好”“高级感”掩盖不可执行镜头。

**拆完镜头表后必须调 `tapcanvas_shot_table_critic` 做独立自检**（评审执行身份精确继承主代理本轮模型与协议，非主代理自评；一轮制）：文本分镜/分镜表必须显式传 `reviewMode="text_storyboard"`、准备交付的完整 `shotTable`，有来源材料时同时传完整 `sourceMaterial`，宿主给出 `reviewContract` 时必须原样传入；实际出片 clips 审批则显式传 `reviewMode="video_clips"` 和对应 `runId` 或完整 clips 合同。两种模式禁止混参。按返回 `topFixes` 改一轮后直接交付或进入下一生产阶段，禁止第二次调用文本分镜 critic，也禁止反复调到 pass。

### 输出前自检

最终输出前必须确认：

1. 编剧线：核心冲突、情绪弧线、人物动机、因果覆盖、段尾钩子完整。
2. 导演线：景别、机位、运镜、光线、空间、连续性、时长全部可执行。
3. 生产线：`@引用`、参考图职责、负面约束、画质约束、人脸唯一性和下游视频连续性没有缺口。
4. 任一项不满足时继续修正；不得输出看似完整但缺少可拍性的分镜。

## 镜头数量规则

> 忠实快节奏分支不使用“按章节字数估镜头数”的通用范围；它由 90/105/120 秒总时长、15 秒单元、1–3 秒内部 shot、原台词容量和真实戏剧密度共同决定，详见 `references/忠实快节奏分镜.md`。

- 短章节（<=1200字）：`6-8` 镜头
- 中章节（1201-2500字）：`8-12` 镜头
- 长章节（>2500字）：`12-16` 镜头

若用户指定镜头数，以用户要求为准。

## 叙事镜头景别偏好

> 规则来源：镜头设计板的景别约束，优先级高于默认相机模板。

> ⚠️ 以 `references/镜头语言规则.md` 为准：**对话主力是 OTS 过肩正反打**，不是"默认跟随特写"。先判断关系再选景别。

| 场景类型 | 优先景别 / 运镜 |
|---------|----------------|
| 双人对话 | **OTS 过肩正反打**（锁 180°轴线+视线匹配）；必要时双人同框/单人孤立/反应镜头 |
| 单人情感推进 | 中近景，缓推绑情绪；50–85mm 标准焦段读情绪 |
| 战斗、冲突、群像调度 | 全景 / 宽景（wide/full） |
| 过渡、环境建立 | 全景或空镜可用 |

- 对话**先调度后景别**：谁占优势、视线方向、出入画方向锁定后再选机位。
- 跟随/缓推只在**绑动作或心理变化**时用，不得作为对话默认装饰运镜。
- 情绪/对话镜默认中近景；若选 `wide`/`full`/`extreme wide` 必须在 `failureRisks` 标 `shotSizeJustificationMissing` 并给理由。
- 战斗/冲突镜头可切换全景，但切换必须在 `narrativeGoal` 中给出明确理由（如"展示包围圈"、"呈现战场规模"）。
- 生成前自检新增：对话/情感镜头若景别为 `wide` / `full` / `extreme wide`，必须在 `failureRisks` 中标注 `shotSizeJustificationMissing`，并给出书面理由。

## Seedance 片段节奏规则

> 本节是普通 Seedance 派生建议。用户明确要求 3 秒内快切的忠实分镜时，以 `references/忠实快节奏分镜.md` 的 1–3 秒内部 shot 和逐镜台词容量为准，不套用下列常规数量。

当需要把镜头转换成 15 秒视频片段时，优先遵循：

- 对话 / 情感片段：`3-4` 个镜头
- 动作 / 冲突片段：`5-7` 个镜头
- 蒙太奇 / 快节奏序列：`6-8` 个镜头

默认情绪节拍：

- `0-3s` 建立场景与情绪
- `3-9s` 推进动作或冲突
- `9-12s` 打到高潮 / 关键揭示
- `12-15s` 落版 / 余韵 / 悬念

若当前章节镜头要继续驱动 Seedance 片段，必须保证每个镜头都能被压缩或聚合进这一节奏框架，而不是只给静态图片 prompt。

## 视觉可执行约束（CV 友好）

每个镜头都必须满足：

1. 主体明确：至少给出 1 个稳定身份锚点（年龄段/外观/服饰/独特特征）。
2. 群像关系明确：至少写清 `谁与谁`、`关系类型`、`强度`、`冲突/合作状态`。
3. 场景明确：地点 + 时间 + 天气/环境状态至少三要素中的两项。
4. 动作明确：使用可见动作动词，避免“情绪化空话”。
4. 空间明确：前景/中景/远景或左右前后关系至少一种。
5. 相机明确：景别 + 机位 + 运镜 + 焦段，优先补充 `shutterAngleDeg`；叙事/对话镜头默认选**半身跟随特写**，战斗/群像才切全景（见《叙事镜头景别偏好》）。
6. 光照明确：主光方向 + 主光角度 + 色温 + 对比关系至少四项。
7. 建模明确：材质、表面磨损、尺度、姿态约束不可缺失。
8. 定格明确：`fpsBase` + `on ones/twos/threes` + `microJitterPx` 至少三项。
9. 连续性明确：和上一镜头至少 1 个共用锚点（角色、道具、方位、时间推进）。
10. 负面约束明确：写出至少 2 条“不要什么”。
11. **画风/渲染锁明确（防漂成插画/动漫 · 实测必踩）**：写实/电影类（`styleTone=clean-real` 或 `cinematic`）的故事板图与关键帧 prompt **必须显式锁实拍画风**——正向写 `photorealistic cinematic film still, real photography, shot on 35mm film, true-to-life skin and fabric`，负向显式钉 `illustration, anime, cartoon, comic, manga, 2D, cel-shaded, drawing, sketch, painterly, CGI cartoon`。**尤其注意：prompt 里出现裸 `storyboard`/`分镜板`/`网格分镜` 字样时，gpt-image-2 会偶发把整张画成"插画版分镜草图/二次元"**（实测：用户看到"怎么变成动漫视频了"）——所以 photoreal 类宁可把图称作 `cinematic keyframe / film still / production still`，少用裸 `storyboard` 词，且无论如何都把上面那串"实拍正向 + 反插画负向"钉进 prompt。只有 `styleTone=anime/stylized` 才反过来主动跟随该二次元画风。
12. **关键运动选择正确的帧合同**：普通运镜镜头用单格构图锚 + 时间轴动作即可；机位 A→B、形态 A→B、精确转场或落幅不可自由发挥时，选择 `bridge_frames` 并生成两张独立单格真实起/尾帧，提示词写出物理可达的中间路径。多格网格整图永不进入视频模型。图上画箭头不等于轨迹控制。

## 参考图策略（连续性）

- **⭐参考图纯净度规则以 `tapcanvas-video-workflow` 步骤 6 为唯一权威，此处不重抄**（要旨：视频模型吃图不吃字；紧景别 cut 只喂主角＋当前单主体的干净单体卡，群像图只属真·多主体同框的宽景/建立镜，宁冗余不压缩）。
- 首镜头可在无参考图情况下启动，不做强阻断。
- 非首镜头通常应携带至少 1 个经验证的参考图片 ID（角色卡/场景卡/关键帧，通过 `referenceImageNodeIds/referenceAssetIds`），用于角色与场景连续性锁定。
- 若非首镜头缺少参考图：允许继续输出，但必须在 `failureRisks` 中显式标注 `referenceMissing` 或等价风险，并在 `continuity`/`continuityLocks` 里写明补救策略。
- 禁止把“无参考图”伪装成“连续性已锁定”。
- 若镜头后续要转成 Seedance / 视频片段 prompt，参考图语义必须可映射到图位职责：
  - 图1：主体 / 角色一致性
  - 图2：场景 / 光线 / 构图延续
  - 逐镜写明 `continuityMode`；普通剪辑用多锚点，关键跃迁用真实首尾帧，真实运动续接才引用上一段视频

## 角色卡前置规划（强制方法论）

- 在生成 chapter-grounded 关键帧、分镜图或镜头提示词前，先检查本章反复出现的主体是否已有可用角色锚点。
- **可用角色锚点来源（优先级从高到低）：**
  1. **角色圣经已确认视觉资产**：`tapcanvas_storyboard_continuity_get` 返回的 `roleReferenceEntries` 中，角色圣经条目若有真实 node/asset/card ID，直接用 ID 通过 `tapcanvas_image_refs_get` 验证，**无需重复生成角色卡**。不要寻找或复制 `imageUrl`。
  2. **已确认角色卡（confirmed role card）**：使用结构化 `referenceType="character" + roleName` 和真实资产状态识别，按 canonical 身份或精确状态版本使用。
  3. **当前项目节点资产**：`tapcanvas_material_assets_list`（可按 `kind=character|scene` 过滤）实时列出项目画布、全部章节画布和镜头画布的持久节点投影，包括图片、视频、音频与文本节点。每条返回 `id/referenceAssetIds/nodeId/ownerType/ownerId/ownerLabel/flowId/name/stateKey/updatedAt/hasImage/hasVideo/hasAudio` 等无 URL 事实；跨画布消费时，`referenceAssetIds` 必须原样使用返回的完整稳定 `project-node:<ownerType>:<ownerId>:<nodeId>` ID，绝不能把来源画布的裸 `nodeId` 当作当前章节的 `referenceImageNodeIds`，也不能因为同名空文本占位而重新生成。默认顺序是 `updatedAt` 最近者优先；状态资产必须用精确 `stateKey`，指定章节或节点时使用精确 `sourceChapterId/nodeId`，禁止拿另一个状态或章节静默替代。结果默认分页 40 条、最多 100 条，必须在 `hasMore=true` 时用 `nextOffset` 继续读取，禁止把“当前页”误当成完整项目。也可用 `tapcanvas_storyboard_anchor_candidates` 取得候选名称与原始节点引用，再用 `tapcanvas_image_refs_get` 验证对应的完整稳定资产 ID 并通过 `referenceAssetIds` 出板。
- **出分镜前默认先读上述锚点来源（不是可选）**：项目已有可复用角色卡/场景卡却脱锚裸文生分镜 → 人物必漂移，会被服务端 `agents_tool_storyboard_anchor_required` 硬拒（服务端默认开启，只有显式运维配置关闭才停用）。
- 若角色圣经视觉条目和已确认角色卡同时存在同一 `roleName`，优先使用当前已确认且状态精确匹配的 canonical 角色卡。
- 仅当 `missingRequiredRoleNames` 非空（角色既无角色圣经图片、又无已确认角色卡）时，才需要创建新角色卡节点。
- 对本章会重复出现、后续多个镜头要复用的角色，只有 `character-card/v3` identity anchor 或结构等价的已确认角色圣经视觉资产才算 canonical 锚；普通肖像、pose、ensemble 和空节点不算。
- 若 `missingRequiredRoleNames` 非空，先加载并执行 `tapcanvas-character-card`，让它基于完整 cast 一次完成事实分层、压力测试、正交设计、真实生图与对账；本 skill 禁止自行写角色卡 prompt 或复制旧模板。
- 角色卡节点必须使用结构化 `referenceType="character" + roleName + characterAssetRole + characterProfileVersion`，状态卡另带精确状态身份；label 只展示，不参与绑定。
- 后续镜头 prompt 可以直接使用 `@角色名` 或 `@角色名-状态` 语法，例如 `@方源-少年 从床上醒来`；当对应角色卡或角色圣经条目存在时，运行时会把它解析成真实参考图绑定，而不是只把它当普通文本。
- 若同名角色存在多张角色卡，必须在镜头约束里给出可区分的年龄/状态/时期证据；若仍无法唯一锁定，应显式失败并指出需要先补哪一张角色卡。
- 这一步属于 agents 的证据规划与产物编排职责，不应假设后端或前端会替你自动决定”先做角色卡还是先出镜头”。

## 场景/道具前置规划（强制方法论）

- 在生成 chapter-grounded 分镜前，若章节元数据已暴露稳定场景或关键道具（例如固定房间、课堂、木盒、法器、载具、机关），必须先检查这些锚点是否已有可执行参考图。
- 对会跨镜头复用的场景/道具，普通文本描述不算完成；必须存在真实视觉参考资产，并能回写到书籍 `visualRefs`。
- 若场景/道具锚点缺失，先创建对应独立 `image` 节点，再继续创建镜头节点；不要在镜头 prompt 里假装“场景已锁定”。
- 这类参考节点应显式携带 `sourceBookId`、`materialChapter`、`visualRefId`、`visualRefName`、`visualRefCategory`；当是 `scene_prop` 锚点时，同时写 `scenePropRefId` / `scenePropRefName`，避免后续节点只能看到不可读的 taskId。

## 节点语义绑定（强制）

- 任何新建的图片/分镜节点，只要绑定了角色或可复用场景/道具，都必须把语义字段直接写进节点数据；禁止依赖 taskId、临时 label 或运行时猜测回填。
- 角色节点最少要带：`roleName`，必要时补 `roleId` / `roleCardId` / `referenceView`。
- 场景/道具节点最少要带：`visualRefName`，必要时补 `visualRefId` / `visualRefCategory` / `scenePropRefName`。
- 若当前证据不足以唯一确定绑定对象，应显式失败并指出缺哪个 `character-card/v3` 身份锚、精确状态卡或场景/道具参考图，不要写入模糊绑定。

## 剧本正文表达约束（当宿主要求脚本体时）

若宿主需要“剧本正文 / Seedance 分镜脚本”而不只是结构化 JSON，采用下列表达规范：

1. 每个镜头行以 `△ ` 开头。
2. 对白标记使用：
   - `角色名（os）`：内心独白 / 画外音
   - `角色名（vo）`：人物不在画面中的画外音
   - `角色名（怒/惊/喜）`：带情绪对白
3. 特殊结构使用：
   - `【空镜】`
   - `【闪回】` / `【闪回结束】`
   - `【字幕：xxx】`
4. 镜头语言必须具体，不接受空泛“氛围镜头”：
   - 景别：远景 / 全景 / 中景 / 近景 / 特写 / 大特写
   - 运镜：推 / 拉 / 摇 / 移 / 跟 / 环绕 / 升降 / 手持 / 希区柯克变焦 / 一镜到底
5. 连续动作链优先使用 `A -> B -> C` 或 `A → B → C` 表达。

该正文格式是默认 JSON 的可读展开视图，不得与 JSON 语义冲突。

## 资产规划（当宿主要求补齐角色/场景/道具时）

若本轮目标包含“先补齐资产再继续镜头”，可采用以下稳定编号习惯：

- 角色：`C01-C99`
- 场景：`S01-S99`
- 道具：`P01-P99`

每个资产至少明确：

- 名称
- 类别
- 视觉锚点
- 与章节的关系
- 后续要给哪类镜头 / 视频片段复用

资产规划是为了服务执行，不是产出一份脱离 TapCanvas 的独立素材文档。

## Seedance 时间轴派生规则

若宿主明确要求 `Seedance prompt`，从结构化镜头派生时应生成：

- 从 `globalStyle/filmBible` 继承风格，不逐拍重复
- 按动作、揭示、接触或摄影机阶段划分连续时间轴；无缝覆盖目标时长，禁止固定 3 秒等分
- `【声音】`：仅写真实需要的底声、动作声、对白、音乐或静默，不按配额捏造
- `【参考】`：`图1 / 图2` 或 `@资产名` 的职责说明
- `Exit State`：记录段尾主体、服装、发型、伤污、持物、位置/朝向、构图、光线与声场终态；下一片段无论采用哪种连续性模式都必须继承这些客观事实，除非有明确重置原因。

禁止直接把章节摘要粗暴压成 15 秒时间轴。必须先有结构化 shot 级理解，再做时间轴派生。

### Seedance 收敛编译纪律

- 派生前完整读取 `references/优化分镜.md`，按“空间 → 动作因果 → 长镜/切镜 → 声音 → 正向约束”编译并自检。
- 时间轴只作执行视图；下游唯一协议仍是 `clips[].shots[]`，不得维护 `performance_timeline/style_lock/negative_prompt` 等平行 JSON。一镜到底零剪辑词；切镜须有动机。
- 中文为默认，英文只消歧；安全、版权或输入合同阻断时显式失败。

## Seedance 任务模板矩阵

除章节分镜主链外，本 skill 还必须覆盖原 Seedance 模板矩阵。若任务明显属于以下类型，应优先按对应模板派生，而不是套一个抽象通用模版：

- 叙事故事类
- 产品展示类
- 角色动作类
- 风景旅拍类
- 视频延长 / 续拍
- 视频编辑 / 剧情颠覆
- 情感冲突类
- 产品动效展示类
- 空间漫游类
- 角色对战类
- 口播类
- 音乐卡点类
- 战争场景类
- 长镜头追踪类
- 伪纪录片类

这些模板的完整写法、时间轴组织、`@素材` 引用方式与特殊注意事项，统一见 `references/seedance-manual.md`。

## 图片质量强制约束

所有分镜图生成 prompt 必须满足以下两条硬性要求：

### 1. 画面清晰（禁止模糊）

每个镜头的 `negativeConstraints` 必须包含（中文）：

```
“无运动模糊”, “无失焦”, “无虚化模糊”, “无低分辨率”, “无噪点”
```

`prompt.cn` 的画质层必须包含（中文）：

```
清晰对焦，细节锐利，4K 画质，边缘清晰，无模糊
```

若生成后图片仍模糊，优先排查：焦段是否过短、prompt 是否缺少画质约束、参考图分辨率是否低于 512px。

### 2. 人脸唯一性（禁止人脸重复）

- 同一章节内**不同角色**的人脸特征必须可区分；禁止用同一参考图或相同外貌描述对应多个角色。
- 每个角色 `anchorTraits` 必须包含至少 1 项**独特面部特征**（如”眼角疤痕”、”高颧骨”、”瞳色异常”），不得只写通用词（如”英俊”、”漂亮”）。
- `negativeConstraints` 必须包含（中文）：
  ```
  “不同角色人脸不重复”, “无人脸混用/串脸”
  ```
- 若同场景多角色，必须在 `crowdRelations` 和 `composition` 里给每个角色指定可区分的空间位置和朝向，防止模型混用角色身份。

### 3. gpt-image-2 防噪点（模型级高频伪影规避 · 出图必读）

> **背景**：gpt-image-2 有一个**模型级高频伪影（high-frequency artifact）**缺陷——画面里浮出碎形噪声、网格状斑点、像素点彩、JPEG 似的压缩感。OpenAI 已公开确认是 bug、正在修，但**修好前要靠 prompt 主动规避**，否则故事板/角色卡/场景卡都会带噪点。规律：**画面越平、越暗、越是大面积纯色/平滑渐变、越是细密有机纹理（毛发/织物/自然环境），噪点越重**；暗部与渐变是噪点最爱藏的地方。下列规则对 **clean-real / 写实 / 电商 / 角色卡 / 场景卡 默认全部生效**；若画风明确要胶片颗粒做旧（cinematic 风格化档），第①条放宽（颗粒是风格手段），但②③④仍须守。

1. **删掉"主动加颗粒"触发词**：`prompt.cn` 里**禁出现** `胶片颗粒 / film grain / analog / 复古质感 / 做旧 / lo-fi / 高感光 / 噪点增加真实感` 这类词——它们会让 gpt-image-2 主动注入高频颗粒，大尺寸下被进一步放大。要做旧质感的，挪到**视频 clip prompt 层或后期**，别焊进 gpt-image-2 出的故事板图。
2. **画质层显式钉干净**：`prompt.cn` 画质层在「清晰对焦，细节锐利，4K 画质」之外，再加 **「画面整体干净无噪点，暗部色彩纯净，背景过渡平滑无颗粒感」**。
3. **模糊"深色背景"换成具体纯色 hex + 禁渐变**：把"深色背景/暗调背景"这类模糊描述改成 **`纯色背景 #3A3A3A，无渐变`**（或浅灰 `#E8E8E8`）。**噪点在纯色上比渐变上更难藏**，纯色背景反而更干净。
4. **柔光替硬光，暗部保留细节、禁纯黑死光**：暗场景给明确主光 + 边缘/轮廓光 + 可见光源，"阴影区保留细节而非全黑"（纯黑死光 = gpt-image-2 噪点重灾区）。
5. **信息过载/细密纹理拆开生成**：满屏细密重复结构（毛发、织物、自然环境、光效）易糊成噪点簇——复杂场景加 `LESS DETAILS` 或拆成主体+背景分层生成，别一次性渲染满屏微纹理。
6. **`negativeConstraints` 加高频噪点项**（中文）：`"无高频噪点", "无碎形颗粒", "无网格斑点", "无 JPEG 压缩感"`（与第 1 条"无噪点"并存）。
7. **重生成 1-2 次仍超阈值就收手**：这是模型级 bug，无限重跑不稳定还烧钱——重生成 1-2 次仍明显，直接接受当前最优或转后期降噪（对背景/暗部用蒙版选择性降噪，保留主体质感），不要在退化链上死循环。

## Seedance 提示词优化公式

产出单条 Seedance prompt 前完整读取 `references/优化分镜.md`。八层公式只是不确定性检查表；静态身份/look 继承真实资产与 `filmBible`，字符优先给变化、方向、因果声音和终态，不用慢动作、器材/4K 口号或负向词表代替事实。

## 故事转剧本结构化步骤

当用户给的是故事、小说、短篇、真实事件，而不是现成分镜时，先按以下顺序拆解，再产出 JSON 或正文：

1. 提炼核心梗（2-4 字）
2. 补齐故事梗概六要素：
   - 故事背景
   - 开场冲突
   - 主角画像
   - 主线事件
   - 结局
3. 写一句话卖点
4. 为主要角色建立人物小传
5. 选择三幕式 / 四幕式骨架
6. 规划每个 15 秒片段的镜头数、情绪弧线与段间承接（exitState 文字接力）
7. 再派生出：
   - `storyboard-director/v1.2` JSON
   - `△` 正文剧本
   - `Seedance timeline prompt`

这一整套步骤的细版模板与检查清单见 `references/故事转视频脚本-转换工具.md`。

## 质量检查补充

除本文件的导演 schema 自检外，若宿主要求正文剧本或 Seedance prompt，还必须额外确认：

- 是否通过编剧/导演双审，且不是流水账镜头表
- 是否有明确的情绪弧线
- 是否包含足够的感官细节（视觉 + 听觉，必要时触觉）
- 是否控制在 15 秒可执行范围内
- 段尾 `exitState` 是否足够客观、完整；每镜是否显式裁决连续性模式，bridge/reference_video 是否具有对应真实媒体证据
- 是否按冻结剧情与声场合同提供必要的对白、环境底声、动作声、音乐或叙事静默；没有的声音层不得为凑配额补写
- 是否使用了清晰的 `@素材` 语法并标明各素材职责

若输出是专门给 Seedance 的单条 prompt，还需再核对一次 `references/优化分镜.md`，但只吸收与本文件收敛编译纪律一致的动作、镜头和连续性方法；其中任何固定字段配额、通用防崩词或平行输出格式均不得覆盖当前合同。

## 禁止项

- 禁止整段堆叠抽象词（如“史诗感、高级感、宿命感”）而无具体可视化细节。
- 禁止同镜头里塞入过多冲突场景/时空跳变。
- 禁止只写文学化描述，不写镜头参数。
- 图片分镜禁止省略 schema 要求的 `negativeConstraints`；Seedance 视频 prompt 不得为凑字段另造 `negative_prompt`。
- 禁止跳过 `relationshipGraph` 或 `crowdRelations`。
- 禁止省略光照方向与角度描述。
- 禁止省略 `rigAndPose` 或 `stopMotionSpec`。
- 禁止只写”氛围很好”而不写可观察代理（风、颗粒、湿度、可视化声源）。
- 图片分镜的 `prompt.cn` 必须遵守《图片质量强制约束》；视频阶段不得机械重复 4K、器材或画质口号挤占动作预算。
- 禁止在图片分镜 `prompt.cn` 中使用英文；画质/约束关键词统一改写为中文等价表达（如 "sharp focus" → "清晰对焦，细节锐利"）。Seedance 时间轴只允许用于消歧的短英文术语。
- 禁止不同角色共用相同外貌描述或同一参考图，导致人脸重复。

## JSON 模板（必须遵守）

```json
{
  "schemaVersion": "storyboard-director/v1.2",
  "chapter": {
    "bookTitle": "string",
    "chapterTitle": "string",
    "sourceSpan": "string"
  },
  "globalStyle": {
    "genre": "string",
    "visualTone": "string",
    "palette": "string",
    "aspectRatio": "16:9",
    "fps": 24
  },
  "modelingSpec": {
    "unitScale": "1m",
    "topologyDetail": "mid-high",
    "materialStyle": "stylized-pbr",
    "textureAging": "blood-stain + dust",
    "clothBehavior": "stiff-heavy"
  },
  "stopMotionSpec": {
    "fpsBase": 24,
    "cadence": "onTwos",
    "microJitterPx": 0.8,
    "holdFrames": [2, 3],
    "imperfectionPolicy": "allow tactile handmade wobble"
  },
  "atmosphereSpec": {
    "tensionLevel": 0.9,
    "airDensity": "dusty-thin",
    "humidityCue": "dry-wind",
    "windVector": "left-to-right",
    "particleType": ["dust", "blood-mist"],
    "soundProxySources": ["cloth-flap", "weapon-hum", "distant-shout"]
  },
  "storyFactsContext": {
    "mode": "book_ledger",
    "bookId": "book-id",
    "ledgerRevision": 12,
    "effectiveAt": { "chapter": 1, "sequence": 10, "label": "本组起点" },
    "consumedFactIds": ["fact_visible_01", "fact_hidden_02"],
    "consumedContextKeys": []
  },
  "cast": [
    {
      "id": "char_fangyuan",
      "name": "方源",
      "anchorTraits": ["苍白肤色", "眼神幽深", "黑发", "残破碧绿袍"]
    }
  ],
  "relationshipGraph": [
    {
      "from": "char_fangyuan",
      "to": "group_zhengdao",
      "relationType": "hostile",
      "intensity": 0.95,
      "state": "encirclement"
    }
  ],
  "shots": [
    {
      "shotId": "SHOT_01",
      "durationSec": 3.5,
      "beatRole": "opening",
      "narrativeGoal": "string",
      "subjectAnchors": ["string"],
      "crowdRelations": [
        {
          "group": "group_zhengdao",
          "relationToSubject": "hostile",
          "blocking": "ring",
          "distance": "mid"
        }
      ],
      "scene": {
        "location": "string",
        "timeOfDay": "string",
        "weather": "string",
        "environmentDetails": ["string"]
      },
      "rigAndPose": {
        "centerOfMass": "mid-low",
        "limbConstraints": ["no hyperextension"],
        "forbiddenPoses": ["heroic-victory-pose"],
        "keyPoseNotes": "string"
      },
      "camera": {
        "shotSize": "wide",
        "angle": "high",
        "height": "crane-high",
        "lensMm": 35,
        "shutterAngleDeg": 180,
        "movement": "slow push-in",
        "focusTarget": "char_fangyuan"
      },
      "lighting": {
        "keyDirection": "back-left",
        "keyAngleDeg": 35,
        "colorTempK": 4300,
        "contrastRatio": "high",
        "fillStyle": "minimal",
        "rimLight": "sunset edge"
      },
      "actionChain": ["A -> B -> C"],
      "composition": {
        "foreground": "string",
        "midground": "string",
        "background": "string",
        "spatialRule": "triangular balance"
      },
      "dramaticBeat": {
        "before": "string",
        "during": "string",
        "after": "string"
      },
      "performance": {
        "emotion": "string",
        "microExpression": "string",
        "bodyLanguage": "string"
      },
      "continuity": {
        "fromPrev": "string",
        "persistentAnchors": ["string"],
        "forbiddenDrifts": ["string"]
      },
      "continuityLocks": {
        "identityLock": ["string"],
        "propLock": ["string"],
        "spaceLock": ["string"],
        "lightLock": ["string"]
      },
      "exitState": "镜尾可客观复用的人物姿态、站位、持物、伤况、场景与声音状态",
      "storyFactLocks": {
        "effectiveAt": { "chapter": 1, "sequence": 10, "label": "SHOT_01" },
        "bindings": [
          {
            "source": "story_fact",
            "factId": "fact_visible_01",
            "category": "character_state",
            "status": "confirmed",
            "visibility": "objective",
            "directive": "只写当前镜头允许客观呈现的状态约束"
          },
          {
            "source": "story_fact",
            "factId": "fact_hidden_02",
            "category": "relationship",
            "status": "confirmed",
            "visibility": "hidden"
          }
        ],
        "revealGuards": [
          {
            "source": "story_fact",
            "factId": "fact_hidden_02",
            "notBefore": { "chapter": 3, "sequence": 0, "label": "正式揭示点" },
            "blockedChannels": [
              "relationship_graph",
              "visual_prompt",
              "dialogue",
              "caption",
              "flashback",
              "prop",
              "background",
              "audio"
            ]
          }
        ]
      },
      "readabilityChecks": {
        "subjectReadable": true,
        "relationshipReadable": true,
        "lightingConsistent": true
      },
      "failureRisks": ["identityDrift", "lightFlip"],
      "negativeConstraints": ["string", "string"],
      "prompt": {
        "cn": "string",
        "enOptional": "string"
      }
    }
  ]
}
```

非 book 任务只替换同一 schema 中的来源合同：

```json
{
  "storyFactsContext": {
    "mode": "task_context",
    "sourceLabel": "用户本轮提供的独立故事材料",
    "bookId": null,
    "ledgerRevision": null,
    "effectiveAt": null,
    "consumedFactIds": [],
    "consumedContextKeys": ["ctx_001"]
  },
  "storyFactLocks": {
    "effectiveAt": null,
    "bindings": [
      {
        "source": "task_context",
        "contextKey": "ctx_001",
        "sourceLabel": "用户明确给出的可见伤况",
        "category": "character_state",
        "status": "confirmed",
        "visibility": "objective",
        "directive": "角色左腕固定，不用左手承重"
      }
    ],
    "revealGuards": []
  }
}
```

## 生成前自检

输出前逐条检查：

1. 是否为“多镜头 JSON”而非“单段大提示词”
2. 是否每个镜头字段完整
3. 是否每个镜头都可独立执行
4. 是否存在跨镜头主体漂移风险
5. 是否包含明确负面约束
6. 是否包含群像关系与光照角度
7. 是否包含建模/姿态/定格节奏字段
8. 是否包含氛围代理（风/颗粒/可视化声源）
9. 若镜头 prompt 使用了 `@角色名` / `@角色名-状态`，是否已有对应角色卡或已先补角色卡节点
10. 若当前章需要新的年龄/状态形态，是否先完成角色卡再继续分镜
11. 若宿主要求 Seedance 时间轴，是否已经把结构化镜头压成可执行的 `0-15s` 节奏，而不是只复制镜头标题
12. 若宿主要求剧本正文，是否使用了 `△ / os / vo / 闪回 / 字幕` 的规范表达，且与 JSON 事实一致

13. 对话/情感镜头景别是否为半身跟随特写；若选了全景，是否在 `failureRisks` 中写明 `shotSizeJustificationMissing` 并给出理由
14. 每个镜头 `negativeConstraints` 是否包含防模糊约束（no motion blur / no defocus / no soft focus）
15. 每个角色 `anchorTraits` 是否有至少 1 项独特面部特征，且不同角色描述不相同
16. 若宿主要求故事板/分镜表，是否已输出包含所有 13 列的 Markdown 表格（与本文件《分镜表格输出格式》一致），且内容来自原文拆分而非虚构
17. 若章节关联真实 book，是否已读完 story facts 全部分页并按目标故事点应用；顶层 `bookId/ledgerRevision/effectiveAt` 是否来自同一份完整快照，而不是猜测或混页
18. `consumedFactIds / consumedContextKeys` 是否与所有镜头 binding 引用的并集完全一致；book/task 两种来源是否没有混用或伪造
19. `inferred` 是否只使用 `viewpoint_only`；`draft_choice` 是否已经得到当前正式创作合同采纳；尚未揭示秘密是否只保留不透明引用与 reveal guard，完全没有真相正文或暗示文案进入任何生成 prompt
20. 每镜是否都有独立 `exitState`；从第二镜开始，`continuity.fromPrev` 是否逐字等于上一镜 `exitState`
21. 隐藏 binding 是否没有 `directive/sourceLabel`，并具有完整八通道 `revealGuards`；当前故事点/镜头是否仍严格早于 `notBefore/notBeforeShotId`
22. 生成的分镜、图片或视频是否只消费 story facts，没有反向新增、关闭或升级账本事实

任一项不满足，先修正再输出。

## OUTPUT CONSTRAINTS
- MUST output valid JSON matching the schema — no prose wrapping
- NEVER omit required fields; use "" or [] for required fields instead of null
- NEVER wrap JSON in markdown code blocks
- NEVER add explanations outside the JSON structure
- NEVER use metaphors, similes, or poetic language in visual description fields
- NEVER use future/progressive tense in frame descriptions (write present-state snapshots)
- NEVER write camera movement inside shot description text (belongs in motion_desc or camera_movement field only)
- NEVER invent narrator/voiceover content that is absent from the source. Source-confirmed OS/VO must keep its channel identity: in JSON use the structured speaker/dialogue fields, and in an explicitly requested screenplay/table view use `（OS）` / `（VO）` as defined above
- NEVER reference shot numbers inside description text
- `storyboard-director/v1.2` 的 `beatRole` MUST be one of: opening / escalation / payoff；只有派生的 `shot_design_v1` 展示格式使用 `beat_role`

## Intent: generate_group_storyboard（群组级故事板生成）
> **generate_group_storyboard（recipe 群组故事板专用） 的完整规则已移到 `references/group-storyboard-intent.md`** —— 仅当本次走该模式（autoGenerate / 带 recipeId 群组）时 `read_file` 它再执行；叙事章节常规拆镜用不到、不必读。

## 自动生成编排（autoGenerate=true 时的智能编排）
> **自动生成编排（autoGenerate=true 专用） 的完整规则已移到 `references/autoGenerate-orchestration.md`** —— 仅当本次走该模式（autoGenerate / 带 recipeId 群组）时 `read_file` 它再执行；叙事章节常规拆镜用不到、不必读。
