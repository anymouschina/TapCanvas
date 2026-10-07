---
name: tapcanvas-storyboard-expert
description: 统一的 TapCanvas 小说/剧本章节分镜专家。用户要求根据小说或剧本生成分镜、镜头脚本、人物资产后的镜头设计，或同时交付“人物资产和分镜”时使用；也覆盖漫剧创作、分镜提示词、Seedance 片段脚本、章节出镜头、剧情确认后的 story_preview 九宫格预演，以及“不改剧情、3 秒内切镜、多特写/反应镜、1 分 30 秒到 2 分钟、表格分镜”的忠实快节奏拍摄脚本。默认输出 storyboard-director/v1.2 JSON，用户明确只要表格时输出统一 13 列分镜表。
disable-model-invocation: false
requires-skills:
  - tapcanvas-character-card
  - tapcanvas-scene-card
  - tapcanvas-prop-card
knowledge-role: storyboard
knowledge-domains:
  - 角色一致性
  - 提示词工程
  - AI视频提示词
---

# TapCanvas Storyboard Expert

场景空间身份、状态版本和灯光设计只使用 `tapcanvas-scene-card`。本 skill 消费已验真的 `scene-card/v1` ID 与 `scene-lighting/v1` 连续性事实来做调度和镜头设计，不另写场景卡 prompt、固定光型或世界观模板。

会被拿取、交接、操作、损坏、变形或跨镜追踪的可复用道具只使用 `tapcanvas-prop-card`。本 skill 消费已验真的 `prop-card/v1`、`prop-board/v1`、`prop-function/v1` 和精确状态版本来设计持物关系、受力与连续性，不自行重写道具结构、固定视图模板或把单镜动作焊进 canonical 道具卡。

## 复现角色身份包（循环角色默认前置资产）

角色身份包的设计、生成、反趋同、状态派生和去模板化只使用 `tapcanvas-character-card`。本 skill 只消费已经落地并经 ID 验真的 `character-card/v3` 资产，不再维护平行的视图数量、体型、介质、面部 DNA、negative prompt 或母版裂变规则。

循环出场角色不能用头像、姿态图、表情图、群像图或某场戏剧照冒充 canonical identity anchor。镜头只继承身份卡授权的五官、身体结构、发型轮廓、肤色/材质、基准服装与身份物件，不继承卡面背景、排版、偶然姿势或机位；状态变化使用同名精确状态版本。

## 图片引用 ID 协议（硬切）

- 主 agents、分镜 specialist 与最终提示词都不得读取、复制、输出图片存储 URL。画面身份只以资产名称、`nodeId`、`assetId`、`assetRefId` 表达。
- 用 `tapcanvas_flow_get` / `tapcanvas_flow_search` 找画布图片节点，用素材工具找资产/版本 ID；需要确认真实可执行时调用 `tapcanvas_image_refs_get({nodeIds?,assetIds?})`。需要看图时调用 `tapcanvas_analyze_image({nodeId})` 或 `tapcanvas_analyze_image({assetId})`。
- 创建生图/视频节点时只写 `referenceImageNodeIds` / `referenceAssetIds`，不得写 `referenceImages`、`styleImages`、`assetInputs[].url`、`imageUrl` 或 `lastFrameUrl`。项目全局画风由服务端自动注入，不需要逐镜复制。
- 任一引用 ID 无法解析时必须在付费提交前显式失败。禁止把 URL-only、planned metadata、节点连线或提示词里的“参考某图”当作真实媒体证据。

## 何时使用

当用户要你根据小说/剧本章节生成可执行提示词，并明确要求：

- 分多个镜头输出
- 每个镜头要素齐全
- 可直接用于图像/视频模型生成

### 忠实快节奏分镜分支

用户要求“不改变剧情，只丰富镜头”、3 秒内切镜、长台词换机位、自然主义表演、多特写/反应镜/空镜、每集 90–120 秒或表格拍摄脚本时，必须读取并服从 `references/忠实快节奏分镜.md`。该分支锁定剧情事实、台词顺序、总时长和连续性，只允许丰富可见表演与镜头覆盖；它的时长、镜头数、声音和表格规则优先于本文件的通用章节镜头数量与 Seedance 节奏建议。

> **边界（重要）**：本 skill 产出**文本分镜 / storyboard-director v1.2 JSON / 人读镜头说明 / 单张合成故事板图**，主要服务 **text 节点**的故事板/脚本生成——**这些产物不是供应商可执行视频提示词，也不进 orchestrate 出片**。用户要求“可直接生成/写入视频节点/真实出片”时，必须把本 skill 的分镜事实交给 `tapcanvas-video-workflow`；其正式 `video-prompt-writer` 按唯一结构化 shots 合同编译，并在同一上下文使用 `tapcanvas-video-reviewer` 复盘后修订。旧八段文本 clipPrompt 路径已下线，服务端拒收；不得拿 v1.2 JSON、13 列展示表或本 skill 的 Seedance 示例直接绕过 writer 提交，也不得在本 skill 里自行串多镜出视频+拼接。
>
> 若用户明确选择“故事板做视频”或要求先看、编辑故事板再出片，主 agents 必须将这里的文本分镜进一步执行为画布上的真实 `storyboardImage` 资产；每个用于视频的板都要有 `productionLayer=design_board`、`creationStage=beat_keyframe`，且其节点 ID 必须经 `tapcanvas_image_refs_get` 验证为 ready，再由 `tapcanvas-video-workflow` 的 `storyPlan.visualPreproduction={kind:"storyboard",requiredClipIndexes:[...],requiredAssetNodeIdsByClip:[...]}` 和对应 clip 的 `storyboardImageNodeId` 精确绑定。若图片先于 BeatSheet/clip 计划生成，必须在节点 data 中同时写入同一视频的 `clipRunId` 与绝对 `clipIndex`，并写 `storyboardScope="clip"`；服务端只按这些精确字段回填消费关系，不按标题、prompt、位置或连线猜测。每个命名人物、场景、道具或 VFX 都要由 agents 结构化列入该镜的真实资产输入清单，既作为故事板生图输入，也列进视频 clip 的 `referenceImageNodeIds`；不能扫描 prompt 猜名词，更不能创建了卡却不实际使用。文本 JSON、角色卡、场景卡和计划 metadata 都不能替代该视觉前置。

## Story Preview 分支（剧情预演九宫格，通用能力）

这是帮助用户快速看懂故事构建是否成立的视觉草图，不是视频生产设计板。它由小T在对话中根据用户“用图预览剧情 / 看九宫格分镜 / 先看故事是否成立”等请求触发，也可以在章节剧情确认后自动交接。所有入口共用同一套 preview 资产协议，不得再为某个章节、题材或人物写专用九宫格模板。

1. 章节入口以 `tapcanvas_project_chapter_get` / `tapcanvas_project_chapter_update` 返回的 `canvasRevision` 与 `sourceHash` 锁定唯一剧情版本；普通项目文本入口以当前 `sourceNodeId` 和真实 flow/node 事实锁定来源。若又发生剧情更新，旧 preview 系列保留为历史，但新系列必须使用新 `previewSeriesId`，不得覆盖或冒充最新版。
2. 只要用户在对话中说出总时长、片段时长或预览区间（例如“整章 60s”“先看 0~15s”），立即把它视为已确认的创作事实，不要求用户另说“冻结”。先 fresh-read `tapcanvas_project_chapter_get`；若现有 `storyPreviewContract` 已逐字段满足本轮要求，直接复用，禁止为了同一要求重复更新。只有合同时长、窗口、采样间隔或参考资产确实变化时，才调用 `tapcanvas_project_chapter_update`，并必须携带 fresh-read 返回的 `expectedCanvasRevision`，在锁定的 chapter seed 中完整覆盖保存：`schemaVersion="story-preview-contract/v1"`、`storyDurationSeconds`、`previewScope`、`frameIntervalSeconds` 和完整 `requiredReferences`。**默认是全预览**：用户没有明确指定局部预览窗口时，必须写 `previewScope="full_story"` 并省略 `previewWindow`，服务端确定性归一化为 `0~storyDurationSeconds`；只有用户明确说“先看前 15 秒”“预览 20~30 秒”等范围时，才写 `previewScope="user_window"` 与 `previewWindow.startSeconds/endSeconds`。禁止 agents 因九宫格数量、模型上下文、上次预览或示例自行裁短。`frameIntervalSeconds` 是本次预览合同参数：用户明确“每秒一格”时写 `1`，明确其它采样间隔时逐字服从；用户未指定时由 agents 根据当前预览目标形成明确值，Hono/Web 不提供默认值。如果用户随后改了时长、窗口、采样间隔、角色、场景或道具，必须提交一份完整的新合同；不能只补一个遗漏字段。
3. `storyDurationSeconds` 是整章/整段的目标总时长。归一化后的 `previewWindow` 默认等于完整故事，仅在用户明确指定局部预览时才缩短。局部预览只覆盖窗口内的节拍，不能把 60 秒的终局、反转或完整战斗压缩到 0~15 秒；窗口外的故事必须留给后续板。每格必须填写数值 `startSeconds/endSeconds`，并严格落在当前窗口内。
4. 生图前读取项目已有角色卡和场景卡，用精确 `nodeId/assetId` 验真并作为本次预览图的输入引用。项目已有 canonical 角色卡时必须使用，禁止因为是 preview 就重新捏脸或只靠文字描述人物。把本次故事实际出现的所有角色、场景、关键道具和必须保持的内容资产全部列入 `requiredReferences`；不能只引用当前画面最显眼的一个主体。
5. 时间格数量、板数、当前板格数与每格绝对时码由服务端根据 `previewWindow + frameIntervalSeconds` 确定性计算；agent 不计算、不缓存、不复述猜测结果。每板最多 9 格。调用 `tapcanvas_story_preview_orchestrate.begin` 后，runtime 每次只开放当前缺失板的精确 `put_board_N` schema，并在 `progressCursor/allowedNextActions/expectedCellCount` 中给出唯一下一步；agent 只按回执逐板填内容。禁止把长时间窗摘要成少量代表图，也严禁改用通用生图的 `node` / `nodes[]` 生成逐格独立图片。服务端会从冻结合同创建一个真实 `storyboardImage` 九宫格板，并自动完整写入：
   - `assetUsage="preview_only"`
   - `assetPurpose="story_preview"`
   - `productionEligible=false`
   - `productionLayer="preview"`
   - `creationStage="story_preview"`
   - 同一系列共享的 `previewSeriesId`
   - `previewBoardIndex`（从 0 开始）、`previewBoardCount`
   - `previewShotCount`（1～9）
   - `sourceChapterRevision` 与 `sourceHash`
   - `storyPreviewContract`：逐字复制章节 seed 中已保存的合同，不得自行缩短 `storyDurationSeconds` 或改写 `previewWindow`
   - `referenceManifest`：逐项复制合同的 `requiredReferences`，成员、职责、身份必须完全一致
   - `storyPreviewCells`：每格至少包含 `cellIndex`、`startSeconds`、`endSeconds`、`timeRange`、`narrativeFunction`、`frameDescription`、`visibleAction`、`stateBefore`、`stateAfter`、`causeFromPrevious`、`transitionToNext`、`blocking`、`cameraState`、`motionTransition`、`physicalFeedback`、`environmentChange` 和 `subjectRefIds`
6. 每格是该时间区间的可视状态，不是段落标题。首次生成时，模型填写紧凑格字段 `frame / mid / end / camera / feedback / environment / subjectRefIds`；`subjectRefIds` 必须从动态 schema 给出的 `referenceOptions[].refId` 中精确选择本格真实可见主体/场景/道具，不得全量复制、读名称猜测或默认补主角。服务端据此自动生成并在图上显示精确 `timeRange`，同时补齐 `stateBefore/stateAfter/motionTransition/physicalFeedback/environmentChange` 等权威字段。`frame` 写这一秒代表帧中的姿态、视线、持物、相对距离与构图落点；`mid` 写约 0.5 秒时重心、脚步、武器和视线如何运动；`end` 写下一秒可直接继承的完整状态；`feedback` 写接触、受力、反作用或明确的未接触压力变化；`environment` 写尘土、碎片、光线与 VFX 的可见变化。相邻格必须让陌生观众追得上主体从哪里来、怎样运动、与谁接触、怎样受力以及下一秒往哪里去。故事中的关键进入动作、现实/幻想切换、冲突触发、道具揭示和结尾钩子必须直接可见，不能做成无因果的 PPT 海报拼贴。服务端在付费提交前只核对确定性事实：板数、格数和每格起止时间严格匹配 `previewWindow + frameIntervalSeconds`，每个 `subjectRefId` 属于冻结合同，且来源 revision/hash 仍是当前章节版本；剧情忠实度由 agent 在当前链内对 `sourceExcerpt` 自检并修订，不下沉为 Hono 文案门禁。
7. preview 图片载体不得设置 `productionMetadata`、`clipRunId`、`clipIndex`、`storyboardScope`、`masterBoardNodeId` 或 `storyboardImageNodeId`，不得写入 BeatSheet/clip 绑定，也不得作为后续图片、视频或首尾帧参考。若用户后来决定正式出片，必须从同一权威章节文本重新制作 production 设计板，不能把 preview 改标签后复用。

### 小T 对话入口的生图合同

当用户要求用图预览剧情时，小T必须把“九宫格”当作**一条实际的生图请求**，而不是先创建一个空节点、等待用户再操作，也不是只返回一段文字提示词：

- 先读取当前对话已确认的完整故事、真实项目上下文、canonical 角色/场景资产和当前视觉风格；如果剧情仍缺关键事实，先在对话中补齐，不凭空画出人物关系或结局。
- 形成按时间顺序分页的 3×3 九宫格内容；九格按左到右、从上到下阅读。每格对应服务端合同中的一个 `frameIntervalSeconds` 时间格，不再按“一个大节拍一格”压缩。每个 cell 内必须同时写 `frame` 起始可见状态、`mid` 半程承接状态与 `end` 退出状态，因此“一秒至少有起/承两状态”不等于一秒单独生成两张图片。是否需要下一张板及下一板格数只服从服务端 `allowedNextActions/expectedCellCount`，不得由模型预估。`nodes[]` 是独立图片批量生成分支，不是剧情预览分页能力。
- 先调用 `tapcanvas_story_preview_orchestrate` 的 `{"mode":"begin"}`。服务端读取唯一章节合同与画布 checkpoint，返回唯一 `allowedNextActions`；runtime 自动加载当前 `put_board_N` 的精确 schema。失败重试、异步续跑或会话恢复再次调用 `begin` 或 `status` 即可，不能自行扫描、猜 boardIndex 或重复付费生成。
- 动态 schema 中的 `sourceExcerpt` 是服务端按本板时间窗切出的完整重叠原文章节，`referenceOptions` 是唯一可绑定的冻结引用集合。Agent 必须在同链完成来源覆盖与视觉实体盘点；上一板的结束状态只负责物理连续性，不能覆盖新分段在边界处要求的转场、反转、世界切换或不可逆结果。`frame/mid/end` 必须写实际画面状态，禁止只填“54s/55s”、镜头编号或“继续战斗/走向远方”一类概括。
- 每次提交前由 agent 回拼当前板全部格，与 `sourceExcerpt` 检查事实、事件顺序、转场和结局是否守恒；发现遗漏或误改就在当前 agents-cli 链重写同一 `put_board_N`，不得修改章节原文、不得跳板、不得把纠偏交给 Hono/Web 文案匹配，也不得改走通用生图工具。
- 参考资产只服从逐格 `subjectRefIds` 的精确声明。跨世界/跨场景后的板不能因为旧 Boss 名称出现在对白、照片或屏幕 UI 中，就继续绑定上一场景、Boss 对战动作规划；嵌套画面与当前物理空间必须分别声明。没有匹配引用时如实依照 `sourceExcerpt` 描述，不得沿用旧场景或伪造引用 ID。
- **一张九宫格就是一次工具调用**：每板最多 9 个 `cells`，整板一次提交；不得把服务端要求的多板合成一个巨型调用，也不得把一板拆成 9 次逐格调用。每板参数只写紧凑的 `frame / mid / end / camera / feedback / environment / subjectRefIds`，不重复合同、时间码、角色长设定或 prompt 公共前缀。
- 全程只调用 `tapcanvas_story_preview_orchestrate`，不直接调用通用 `tapcanvas_image_generate_to_canvas`，不调用 `flow_patch`，不手写 `node.data`，不传 `prompt`、模型、分辨率、引用 URL、`storyPreviewContract`、`referenceManifest`、时间码或 preview 元数据。服务端根据章节唯一真源负责选择当前图片偏好，并把全部格 `subjectRefIds` 的精确并集作为本板有效参考，生成真实九宫格 prompt、创建 `storyboardImage / preview` 节点并回填当前画布；服务端不会从格文案补人物或改引用。
- 每板 `cells` 数量必须与服务端返回的 `expectedCellCount` 完全一致；不得自行推导后续板号或格数，不得用粗粒度摘要内容填充更细的合同，也不得在一次 `put_board_N` 调用中提交多板。
- 生图工具返回真实受理结果后，小T向用户说明“九格分别讲了什么、是否覆盖起因/攻防/逆转/结局”，并展示实际图片；不得用一段“已生成节点”的报告代替图片交付。用户确认后，正式出片仍从同一权威正文重新编译 production design board。

首次生成单板时使用下面这个短调用；一次调用直接生成一张最多九格的真实九宫格板，不是九张独立图片，也不是前端节点模板：

```json
{
	"mode": "put_board_0",
    "openingState": "本板第一秒开始时，主体、武器、空间位置、伤势与视线的完整可见状态",
		"cells": [{
			"frame": "本秒代表帧：主体姿态、持物、相对位置与构图落点",
			"mid": "约0.5秒时重心、肢体、武器和视线的连续变化",
			"end": "本秒结束、可直接交给下一秒继承的完整状态",
			"camera": "景别、机位、观察方向、焦点与连续路径",
			"feedback": "接触点、受力方向与双方反作用；未接触则写惯性或距离压力",
			"environment": "光、尘、雾、碎片、地面或背景相对上一秒的可见变化",
			"subjectRefIds": ["node:从动态 referenceOptions 精确选择"]
		}]
}
```

模板只示范紧凑字段形状，不得照抄内容；所有 cell 必须从本轮真实剧情推导，并按本板时间顺序放在同一个 `cells` 数组内。时间码、板数、当前板格数、引用与最终 prompt 由服务端按冻结合同生成，模型不得另造或向用户宣称未经回执验证的数量。用户要求每秒预览时，`frameIntervalSeconds` 必须为 1；服务端会拒绝格数不足、时间网格有洞或来源版本变化。工具返回的 `running` 只表示该九宫格已受理，不是失败；不得因为等待图片就重复提交。

## 核心目标

把“叙事文本”转换成“可执行的镜头生产 JSON”，并让输出可同时服务：

- 3D 建模师（形体/材质/姿态约束）
- 导演（调度/镜头/光线/节奏）
- 编剧（因果、冲突、人物动机、情绪弧线）
- 定格动画（帧步进/微抖动/手工痕迹）
- Seedance / 短剧视频生成（15 秒片段时间轴、镜头节奏、参考图图位；镜间承接=并发独立+exitState 文字接力）

## 统一职责边界

本 skill 是当前仓库里唯一的章节分镜与 Seedance 派生产物主技能，统一负责：

- 章节正文 -> 章节剧本 / 分镜结构
- 角色 / 场景 / 道具资产规划
- Seedance 15 秒片段时间轴脚本
- 对白、OS、VO、闪回、字幕的脚本表达
- 片段间连续性收口：逐镜选择有意剪辑、真实首尾帧桥接或上一段真实视频续接，并保留可追溯的 exitState 物理状态接力

若任务需要 Seedance 风格片段脚本，也必须在本 skill 内完成，不允许再切出平行分镜方法论。豁免：**交互式分支叙事游戏**（画布分镜图选支玩法）走 `tapcanvas-storyboard-adventure`，不受此排他约束。

## 首要纪律：叙事完整与承前启后（ch129《诛魔》实证·不可违）

拆任何章节前，先守这四条，否则必然缺剧情、段间硬跳：

1. **先读完整章节正文再分段**：确认拿到的是【全文】而非被截断的前半截/预览（ch129 漏读后半段→整个结局缺失）。分镜必须**逐句覆盖到原文结尾**。
2. **按戏剧节拍分段，不按时间均匀切**：段数随剧情定，**15s 是单段时长上限、不是分段尺子**。连接性因果小节（脱身/传音回报/铺垫/因果转折）是钉因果链的胶水，**照样占镜头、不当过场省掉**。
3. **连续性必须先设计再选择媒体合同**：所有相邻段先对齐上段 `exitState` 与下段进入态，再由 agents 逐镜选择 `editorial_cut/bridge_frames/reference_video`。普通剪辑不需要像素级咬合；形态跃迁、精确落幅或复杂转场用真实首尾帧；只有真实运动惯性、连续运镜或声场不可由状态文字重建时才续接上一段视频。
4. **交付前自检：反向映射回原文**：把每个分镜段映射回它覆盖的原文句子，**列出没有任何镜头覆盖的句子=缺的节拍**，补齐后再逐对查相邻段接不接得上。出片后审片已下线（2026-07-10），质检左移到提示词阶段——这一步自己在交付前过一遍。

## 权威叙事状态前置（真实 book 强制）

章节属于真实 book 时，拆镜前并行读取完整章节与 `tapcanvas_story_facts_get`。记录第一页账本 `revision`，按 `offset/nextOffset` 翻页直到 `hasMore=false`；所有分页 revision 必须一致，变化时丢弃混合结果并从 offset=0 重读。目标镜头对应的故事点明确时，用 `at={chapter,sequence}` 读取当时有效事实。`story-facts.json` 是结构化权威层，`STORY_STATE.md` 只是人可读投影，不能因为投影更短就忽略来源、status 或有效区间。

先把本轮事实快照写进顶层 `storyFactsContext`，再把实际影响当前镜头的事实编译进每镜 `storyFactLocks`：

- 真实 book 使用 `mode="book_ledger"`，逐字记录真实 `bookId`、本次完整分页读取到的 `ledgerRevision`、目标 `effectiveAt={chapter,sequence,label?}`、真正被镜头消费的 `consumedFactIds`，并令 `consumedContextKeys=[]`；禁止把“读到过但没影响任何镜头”的 fact 塞进消费清单。
- 非 book / standalone 使用 `mode="task_context"`，记录安全的总来源标签、`bookId=null / ledgerRevision=null / effectiveAt=null / consumedFactIds=[]`，并用本轮稳定且不冒充账本事实的 `consumedContextKeys` 追踪输入约束。
- `category` 逐字沿用 story fact 的 `subject.kind` 或本轮上下文给出的结构化类别，不在本地维护题材枚举、别名表或关键词映射。
- 每个 book binding 的 `factId` 必须属于顶层 `consumedFactIds`；每个 task binding 的 `contextKey` 必须属于 `consumedContextKeys`。两个集合都必须与所有镜头实际引用的并集完全一致。

事实投射规则：

- `confirmed` 锁人物位置、伤况、持物、关系、已知信息与已经发生的事件；
- `inferred` 只能作为某个视角的怀疑、误判或证据方向，禁止直接画成客观答案；
- `draft_choice` 只有被用户或当前正式剧本合同采纳后才可进入镜头，否则保留未决；
- `visibility="objective"` 才能作为客观可见状态；`visibility="viewpoint_only"` 只能把角色相信、怀疑或误判的行为线索写进 `directive`；`inferred + objective` 是非法组合；
- 尚未到揭示点的秘密必须使用 `visibility="hidden"`，binding 只保留不透明 `factId/contextKey + category + status`，**不得携带 `directive`、真相摘要、关系文本或暗示文案**；同时建立只含不透明引用、揭示窗口与完整 `blockedChannels` 的 `revealGuards`。隐藏事实正文不得进入 `relationshipGraph`、`prompt.cn`、图片/视频 prompt、负面 prompt、对白、字幕、闪回、道具说明、背景彩蛋或声音提示。下游只接收不含真相正文的通用禁泄露指令；
- 道具易主、伤势变化、衣物破损、位置移动后，后续镜头继承新状态，关闭的旧事实只能用于对应历史时间点。

输出 `storyboard-director/v1.2` 时，`relationshipGraph` 只描述目标故事点已经生效且允许观众理解的表层行动关系；没有真实关系时必须输出 `[]`，禁止制造占位敌我关系。每镜独立写客观、可复用的 `exitState`；从第二镜开始，`continuity.fromPrev` 必须逐字等于上一镜 `exitState`，禁止用“大致承接”掩盖道具、伤势、站位或人物认知跳变。`dramaticBeat.after` 仍写戏剧结果，不能代替物理退出态。伤况和人物认知边界同时进入 `storyFactLocks`、`continuity.persistentAnchors / forbiddenDrifts` 与 `performance`，道具归属同时进入可见 fact binding 与 `continuityLocks.propLock`。没有群像或某类连续性锁时输出空数组，不写“无/不适用”伪内容。禁止创造 schema 外字段后假装结构校验已通过。

分镜 JSON、文本提示词、故事板图片和视频产物都是叙事事实的消费者，不会因为“已经生成”就自动改变 story facts。若分镜需要改剧情，先回到正式正文/剧本原地保存并通过对应写作 skill 提交事实增量，再重新拆受影响镜头。

## 附属参考资料

本 skill 附带以下权威参考资料：

- `references/忠实快节奏分镜.md` ← **不改剧情 + 丰富镜头 + 快切表格任务必读**：剧情/台词/时长锁、1–3 秒内部 shot、长台词跨机位、自然主义表演、15 秒单元、统一 13 列表格与逐镜语速审计
- `references/镜头语言规则.md` ← **叙事/剧情片拆镜前必读**：调度先于景别、180°轴线、焦段心理、机位角度、构图权力、景深破贴片、慢镜正确实现、声音设计、表演行为链、镜尾可接力收束
- `references/coverage-and-boundary.md` ← **拆镜责任与账目必读**：原文落实责任清单与动作落实表（每个来源动作只有一个主要落实镜头）、相连边界与"关键帧只投影镜头起始边界"、单集时长加总（不允许镜头无声漏掉）、工作景别与离开标记、切点必须带来可见变化、水平角度/机位高度/焦段是三件不同的事、竖屏景别收窄、交付面遮挡、尾帧成对、一镜到底还是切开
- `references/产品商业摄影.md` ← **电商广告/产品片拆镜必读**：电商也是商业摄影、干净≠平淡——按材质选光的布光体系(金属侧光/玻璃背光透亮/磨砂柔光)、产品 hero 精密运镜(微距推进/环绕轨道/升格质感/推近定格)、质感渲染(水珠/蒸汽/光泽)、构图焦段、带货节奏(钩子→卖点→质感→CTA)
- `references/拆镜范例.md` ← 逐镜带"为什么这么拍"标注的范例库（few-shot）
- `references/电商TVC视频提示词范例.md` ← **电商/品牌/产品 TVC 类视频节点(S6 clipPrompt)必读**：用户金标范例 + 可复用骨架（定调头 / 参考图按用途分配+一致性硬锁 / 全局纪律 / 分段时间轴 / 风格收束）。做电商带货 TVC 视频时按它调整，换主体/卖点/场景、骨架不变
- `references/seedance-manual.md`
- `references/故事转视频脚本-转换工具.md`
- `references/优化分镜.md`
- `references/好剧本.md`

当用户任务明确落在以下场景时，应主动读取对应 reference，而不是只依赖本文件摘要：

- 用户要求忠实原剧本、快节奏切镜、多特写/反应镜/空镜、90–120 秒单集或 Markdown 分镜表
- 多模态 Seedance 输入限制、参考图/参考视频/参考音频用法、视频延长、视频编辑、音乐卡点
- 产品展示、角色动作、旅拍、空间漫游、口播、战争、长镜头追踪、伪纪录片等专门模板
- 从原始故事抽取核心梗、人物小传、三幕/四幕结构、15 秒集数弧线、段间承接检查
- Seedance 提示词优化公式、动作/镜头/光影/画质/约束关键词

## Seedance 多模态能力边界

当宿主明确要求输出可直接用于 Seedance 的提示词时，同时遵守以下多模态边界：

- 最多 12 个输入文件
- 图片参考 `<= 9`
- 视频参考 `<= 3`，总时长 `<= 15s`
- 音频参考 `<= 3`，总时长 `<= 15s`
- 支持的 Seedance 任务模式包括：
  - 参考图像生成
  - 参考视频复刻
  - 视频延长 / 续拍
  - 视频编辑 / 剧情改写
  - 音频驱动口播
  - 音乐卡点剪辑
- 不支持把“写实真人脸部素材”当成稳定可复刻输入；若用户强依赖此能力，必须显式提示限制

这些是 Seedance 侧操作约束，不得在派生 prompt 时遗漏。

## Seedance 任务询问框架

当用户给的信息不足以直接写出稳定的 Seedance 提示词时，先补齐以下信息：

1. 这条视频讲什么故事，核心冲突或卖点是什么
2. 时长是多少，默认是否为 15 秒
3. 现有参考素材有哪些：图片 / 视频 / 音频
4. 画幅比例：`9:16 / 16:9 / 2.35:1`
5. 整体风格、色调和氛围
6. 镜头语言：景别、运镜、转场
7. 动作节奏：舒缓 / 急促 / 是否卡音乐拍点
8. 声音设计：配乐、环境音、对白、旁白

若这些信息无法从上下文证据中恢复，必须显式指出缺口，而不是脑补。

## 输出模式（默认）

默认输出 `JSON`，除非用户明确要求其他格式。

- 仅输出一个 JSON 对象
- 禁止输出 markdown 包裹、解释性前后缀
- 默认必须满足 `assets/storyboard-director-schema.v1.2.json` 的结构约束
- 缺关键输入时显式失败，不输出伪完整 JSON
- **所有 `prompt.cn` 字段必须使用中文**；`enOptional` 为可选，默认不填
- 每镜必须有 `beatRole / exitState / storyFactLocks`；缺任一字段都属于合同失败，不得回退旧 schema 或把锁塞回自然语言备注
- 真实 book 与 task context 共用唯一 v1.2 schema，只通过 `storyFactsContext.mode` 区分来源；禁止另建 standalone 旧格式
- `visibility="hidden"` 的 binding 禁止出现 `directive/sourceLabel`；秘密只以不透明引用和 `revealGuards` 留在导演元数据中

## 输出模式（扩展）

除默认 JSON 外，当宿主明确要求”视频片段脚本 / Seedance 时间轴 / 剧本正文格式 / 素材清单”时，可在同一套章节理解基础上派生以下补充产物：

- `Seedance timeline prompt`
- `章节剧本正文`
- `资产清单`
- `Exit state 承接注记` + 本镜 `continuityMode` 裁决；bridge 镜同时列出真实起幅与目标尾帧资产

但这些都属于默认 JSON 的派生产物，不得替代默认 JSON 成为唯一交付，除非宿主或用户明确要求只要这些格式。

## 延伸参考

`references/storyboard-production-reference.md`：当交付分镜 JSON、表格或资产规划时，读取对应输出协议、字段格式与生成前自检；仅阅读主文件不能视为已取得完整输出合同。
