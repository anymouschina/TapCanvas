---
name: tapcanvas-video-workflow
description: TapCanvas 一键成片、首视频验证与完整视频生产唯一主路径。凡终态交付是真实视频、从小说章节一键成片、只生成第一条视频、完整成片、拆段验证、恢复或中断视频工作流，都必须使用本 skill，并启动当前用户已装配的 Workflow IR；禁止由根代理直接调用裸视频生成、普通工作流或已退役黑盒入口建立平行生产链。
knowledge-role: director
knowledge-domains:
  - 视听语言演出
  - AI视频提示词
  - AI视频剪辑衔接
  - 角色一致性
  - 场景一致性
  - 提示词工程
  - 竞品工作流研究
  - 叙事结构节奏
  - 灯光打光
  - 音乐声音设计
  - 调色色彩
  - 字幕花字包装
  - 配音口播
  - 视觉特效VFX
knowledge-retrieval-policy: required_non_blocking
metadata:
  contracts:
    - tapcanvas/video-prompt-authoring@4.0.0
    - UserIntentContract@2
    - StageExecutionPacket@1
consumes:
  - 已冻结的用户交付合同
  - 真实项目、章节与 image-ready 素材事实
  - 当前用户已装配 Workflow IR 的动态工具 schema
produces:
  - 持久 Workflow execution 回执
  - 用户范围对应的真实视频 URL 与交付验证证据
required-evidence:
  - 当前 attachment 与 execution 的稳定身份
  - 目标节点成功状态及真实资产 URL
  - expectedDelivery、deliveryEvidence 与 deliveryVerification
side-effects:
  - 可提交付费图片、音频与视频任务；必须遵守用户授权、幂等与中断合同
self-check:
  - 所有项目、章节、素材、attachment 与 execution 身份均来自真实工具事实
  - 工作流只启动一次，受理后不更换幂等键重复提交
  - 按冻结交付范围验证：成片要求目标视频 URL 持久化；只生成视频节点要求全部节点、提示词和引用持久化后才宣称完成
requires-skills:
  - cinematic-feel-director
---

完整章节生产的持久 Workflow 已拆分职责：`tapcanvas.chapter-beat-plan/v1`、`tapcanvas.chapter-asset-plan/v1`、`tapcanvas.clip-design/v1` 分别按 `tapcanvas-video-authoring-stages` 交付；不能要求其中任何一个节点再写整份 BeatSheet。最终 BeatSheet 由确定性组装器生成，现有来源、对象与下游 writer 合同继续有效。首 Clip 快速验证的独立单 Clip 合同保持按其声明的 artifact 执行。


# TapCanvas 视频 Workflow IR

## 使命

把用户的视频目标交给一条可观察、可拆分、可中断、可恢复的持久 Workflow IR。根代理负责冻结用户范围、读取真实项目事实并启动工作流；BeatSheet、逐 Clip writer、资产验真与补齐、配音清单、生产交接、视频生成、合成和交付验证都由已保存 DAG 的明确节点承担。

系统只有这一条一键成片路径：

```text
真实项目/章节/素材事实
-> 当前已装配 Workflow IR
-> typed ports 与逐节点持久状态
-> 真实媒体任务与资产 URL
-> workflow output 交付证据
```

### 高能超自然动作扩展（同一 Workflow IR 内）

动漫/超能力都市、校园战斗或其它高动力片段仍走上述唯一路径。BeatSheet 先冻结角色卡、场景卡、能力主形、动作结果和真实时长；逐 Clip writer 再按结构化创作判断加载通用战斗标准，并可追加 `tapcanvas-high-energy-action` 领域扩展。该扩展只增加动作因果、快切信息功能、环绕/复合运镜、造型—能力视觉耦合与低熵交接的表达方法，不新增 route、模型、镜头配额、字数门槛或质量闸门。用户指定 15 秒时，15 秒进入当前 Clip 的 `generationContract`；镜头数量与切点仍由真实事件完成、对白可读度、连续性和交接状态决定。具体依赖与交付证据见 `references/high-energy-action-workflow.md`。

人物交流、关系冲突和对白主导的片段也走同一 Workflow IR。BeatSheet 先冻结信息差、逐字对白、SpeechEvent、VO/OS 裁决与关系状态；writer 可追加 `tapcanvas-dialogue-drama` 扩展，补充潜台词、话轮、停顿、blocking、镜头覆盖、道具承载和跨 Clip 声音连续性。该扩展不新增对白、不替换 `dramatic-direction-contract`，也不把文戏质量转成本地评分或门禁。具体依赖与交付证据见 `references/dialogue-drama-workflow.md`。

## 完整展开版默认合同

章节一键成片默认交付完整展开版。根代理将完整来源覆盖、演出扩写、润色、运镜和适用特效的要求写入现有 UserIntentContract 的目标、成功标准与保留事实，由编剧及章级改编 Agent 按 `tapcanvas-dramatic-adapter/references/detailed-chapter-production.md` 执行；不在宿主添加固定创作模板。先完善整章再推导时长，预算估算不转为秒数上限、片段配额或最低字数。“完整”不授权改写原文事实、结尾或启动未获授权的媒体任务；用户明确短版、限时、首视频或 onlyVideoNodes 时保持该范围。

来源清单还有未承载项时，不能把局部提示词、前缀批次或 concat URL 声明为整章完整交付。Agent 依据真实证据在同一任务内补规划、修订提示词或沿已有合法恢复路径推进；不新增语义质量闸门，不覆盖或丢弃已生成结果。

## 成功定义

一次生产只有同时满足以下事实才算完成：

- 使用 `tapcanvas_equipped_workflow_run` 启动当前工具 schema 中列出的真实 attachment。
- 工作流 execution 已受理，并取得稳定 `executionId/runId`。
- 用户要求的终点节点达到成功；首视频验证必须出现恰好一条真实 `videoUrl`，完整成片必须出现真实最终视频 URL；onlyVideoNodes=true 时验收全部视频节点、提示词与引用的持久化回执，不要求视频 URL。
- 原目标为完整章节时，Agent 已按原文逐项核对全章实际视听承载；技术批次状态或账本字段存在不能替代这次判断。未满足时保留缺口并继续同链工作，不宣称全章完成。
- 结果通过 `expectedDelivery -> deliveryEvidence -> deliveryVerification` 验收；脚本、提示词、估价、节点数量或供应商受理回执不能冒充视频。
- 已生成媒体始终保留。后续诊断或语义复盘只能追加证据或新版本，不得回滚、覆盖或丢弃资产。

`acceptedAsync=true` 只表示工作流已由持久执行器接管，不表示视频已经生成。拿到受理回执后不得换 idempotency key 重提；后续通过 execution/family/attempt 的权威事实恢复或交付。

## 工作流

### 1. 冻结用户交付合同

继承已装配配置时，省略 delivery 中未由用户明确给出的 durationSeconds、clipCount、size、resolution、aspect、model，以及 triggerPayload 中对应的可选覆盖字段。不要把“继承配置”的说明文字写成参数，不用 60 秒或 1 段表达未知。说明属于策略，具体执行值由已装配工作流解析。

启动前出现协议错误时核对原始用户要求与工具回执；如果是自己误记的可选规格，在 authoringCorrectionAllowed=true 时，用 record_user_intent 的 authoringCorrection={previousContractHash,reason} 纠正，保持目标与来源事实，然后以原幂等身份提交修正后的参数。禁止重复原样调用。已有受理回执后不改合同、不重启。


在任何有副作用的动作前，用 `record_user_intent` 冻结真实目标：

- 交付类型与数量；
- 完整章节、限定时长、指定 Clip 或只到首视频的范围；
- 画幅、分辨率与用户明确给出的物理 Clip 数量/逐段时长；
- 当前已装配完整成片 Workflow IR 自身冻结的 `max clip` 只限定本次最多生产的有序 Clip 前缀，不等同于用户指定全章必须恰好具有的 `requestedClipCount`；
- 必须保留与禁止发生的事实；
- 是否已授权付费生成。

用户明确要求“后续默认”时，将原话、适用范围、来源与可覆盖条件保存为用户级长期偏好；本轮与后续创作先由 agents 从宿主传入的 Account user preference facts（账户中显式保存的偏好事实，含原话与来源）及真实记忆中选择适用偏好，写入同一 UserIntentContract，再由父级规划与 writer 共同消费。当前明确指令优先于旧偏好；旧风格包中的摄影、剪辑建议不能反向覆盖用户选择。偏好不改变冻结剧情、供应商参数或付费授权，也不由本地关键词识别场景或转换为镜头数、帧率、时长阈值。

不要把模型默认值、测试名称或工作流模板参数写成用户事实。用户没有指定物理 Clip 数量时，不得推断 `requestedClipCount`；没有指定逐段时长时，不得提交 `requestedClipDurationsSeconds`。

完整成片 Workflow IR 若存在 `max_clip -> video.beat-sheet.take/v1` 节点，必须原样执行其冻结的 `workflowBeatSheetTakeCount`。它是工作流作者显式保存的结构数量边界：BeatSheet 产出后只保留前 N 个 Clip，后续资产、writer、估价、视频、concat 和交付只验收该集合；N 个 Clip 完成只表示该前缀批次交付成功；用户目标为完整章节时，仍须保留上限之外的来源范围与后续交付义务，不得把批次成功声明为整章完成。启动前由 Agent 核对并解决配置与全章目标的冲突，不能假设仅截取前缀就会自动续完。根代理不得把该配置改写为 `requestedClipCount`，也不得在运行中根据剧情完整度、输出文案或失败数量重新决定 N。

### 2. 读取一手事实

用户要求保持参考人物与同一件服装/商品时，把原图中可观察的身份、商品本色、纹样、面料、结构与配件分工写入同一对象事实并在各 clip 原样继承；未观察到的颜色不得从场景、风格或名称猜测。街拍、直播间、影棚等场景与照明变化只改变环境和明暗，不授权换色、换款或重造商品。若需要新场景参考，它只提供场景，原人物与服装仍绑定用户原图；不得让场景生成图中的人物或服装替代原图。与原图冲突的规划描述由同一作者在提交前修订，不用提交后的语义拦截丢弃已经生成的资产。



优先复用宿主本轮已经提供的项目、章节、当前选择与用户显式资产 ID。`sourceMode=project_context` 的服务端会冻结 canonical 章文、画布与资产快照，根代理不再为抄写这些事实串行调用章节列表、章节详情、画布和素材清单。

仅在作用域确实不明确或需要主动选择已有资产时，读取能消除该缺口的对应工具；已选稳定资产 ID 原样传入。根代理只负责启动与交接，不先写一版剧本、镜头表、角色卡或视频提示词，也不预载编剧、writer、reviewer、角色卡与场景卡整套 Skill。各节点依赖在 Workflow IR 内装配一次，由所属节点完成。

用户上传或明确选中的图片是本轮对象身份的一手证据。BeatSheet 作者按冻结 selectedAssetSnapshot / selection 核对原物；若现有文字事实不足以知道图片里的产品、外观或用途，由当前 Agent 调用 `tapcanvas_analyze_image` 取得视觉事实后再创作，不能从文件名、通用“产品主体”或电商套路编造品类、屏幕、按钮与功能。单个对象可绑定多张原图，按动态 schema 在 objectRegistry 的 referenceAssetIds / 当前画布 referenceImageNodeIds 中保留全部所需视角，禁止为了单图合同重画替代产品。镜头与背景可以创作，对象身份与功能必须来自输入事实。已有明确引用的对象沿同一资产链复用；确实缺少的独立对象才提交其创作计划，role 与已声明对象的精确身份一致。结构性缺项在同一逻辑任务内按 outputRepair 修订；不得要求用户重新上传或以无参考文生图补位。

实际产出 assetPlans 的 BeatSheet 创作节点首次编译场景图片时遵循 `tapcanvas-scene-card` 的“首轮生图：空间职责与洁净材质”：把剧情调度转为空间事实，按场景职责消费项目画风，生成无人且保留自然材质的空间资产。完整场景合同与图片 prompt 按节点输出 schema 一起交付；不以标题代替合同，不整包复制人物/视频风格，不把出图后去人去噪或自动付费编辑设为工作流步骤。该方法由资产作者在同一节点消费；场景合同按角色类型贯穿计划、展开和生图元数据，人物与人群继续由现有 clip writer 按 Beat 内容写入视频，根代理不另起场景设计或补人物流程。

### 3. 选择当前已装配工作流

画布素材可见性与用户显式选择是两种事实：未手动点选不表示没有可用素材。用户要求使用画布素材时，工作流内的创作 Agent 根据已冻结的图片候选与真实理解结果决定对象归并和引用；根代理仍只启动和交接，不建立第二套看图/写稿流水线。素材驱动的原创、产品演示与口播按 `tapcanvas-dramatic-adapter/references/media-grounded-creation.md` 的证据方法完成。图片理解失败只提供失败证据，不能说成已看懂、改用文件名猜测或反复调用同一不可用模型。

查询 `tapcanvas_equipped_workflow_run` 的动态 schema，只能从 enum 中选择当前用户真实装配的 `attachmentId`，并遵守该 attachment 声明的 `sourceMode` 与必填输入合同。

视频工作流若未在冻结定义中固定模型，动态 schema 必须把 `triggerPayload.videoModelKey` 声明为必填。逐字复制当前 `enabledVideoModels` 中已启用的 canonical modelKey：用户显式选择优先，否则使用本轮系统上下文已经注入的账号生成偏好。禁止猜展示名、写静态默认值或省略后让服务端兜底。

没有可用 attachment、输入合同不完整或 attachment 已失效时，原地显式失败；禁止改调裸视频工具、普通 `tapcanvas_workflow_run`、已退役黑盒入口或本地模板兜底。

### 4. 一次启动

用唯一、稳定、描述当前逻辑任务的 `idempotencyKey` 调用：

单一已装配工作流、项目上下文来源的最小调用示例（30秒必须来自用户要求）：

```json
{
  "idempotencyKey": "当前逻辑任务稳定键",
  "triggerPayload": { "targetDurationSeconds": 30 }
}
```

只有动态 schema 要求选择 attachment 时才提供其真实 ID。`source/sourceGroupId` 分别仅用于对应的 inline_text/canvas_group 模式；按需调整媒体规格使用 `videoAspectRatio/videoResolution`，不要使用未声明的 `aspectRatio/resolution`。模型和规格可省略继承配置。


`sourceMode=project_context` 时依赖服务器冻结的 ProjectContext；不要复制用户原话创建文本节点，也不要同时伪造 `source`。章节集成测试应让隔离项目携带真实 chapter/book/canvas facts，再启动工作流。

若用户已经逐项指定稳定资产 ID，根代理必须在调用前把这组 ID 与 `triggerPayload.selectedAssetIds` 做逐项、无遗漏核对，并原样提交。只在意图合同里复述资产 ID、却没有把它们放进真实工作流调用，不构成资产冻结；此时禁止启动工作流。未被明确选中的旧画布图片也不得冒充本次 canonical 资产。

用户明确限定首视频时，选择已保存的首视频验证 Workflow IR；它在生产交接后以 `workflow.collection.take/v1` 只取第一项，再执行一次 `tapcanvas.video.generate/v1` 并从 `workflow.output/v1` 交付。不要在根代理里用文本含义或数组下标临时截断。

### 5. 交给持久执行器

工作流受理回执携带 `completionBoundary="submission"`、`executionOwner="durable_executor"` 与稳定 execution/runId 后，当前对话完成交接。后续规划、素材理解、结构修复、生成和最终验收都由 Workflow IR 的持久执行器接管，不注册对话 continuation、不在对话里另开前置识别任务或要求用户发送“继续”。交接成功不表示成片完成。用户另行询问状态时读取一次有界事实即可，最终状态和必要用户输入由 execution 的真实证据呈现：

- `queued/running`：继续等待持久节点推进；
- `success`：读取 output port 与真实资产 URL，完成交付验收；
- `failed`：保留成功节点与媒体，依据结构化失败节点决定同 family 恢复；
- `canceled`：只有用户明确撤销取消后才允许恢复；
- `provider_balance_required`：只在用户明确确认余额恢复后继续。

恢复使用 `tapcanvas_workflow_resume`，且 `sourceExecutionId` 必须来自真实工作流回执或已授权的持久执行查询。禁止创建替代 execution family、修改幂等键绕过失败或重复扣费。

### 6. 中断

用户中断正在运行的工作流时，调用当前 execution 的取消能力；UI 必须显示可中断按钮并基于服务端权威 `interruptible` 状态启用。中断只阻止尚未受理的后续动作：供应商已受理或已生成的媒体必须回收并保留，不能删除或伪装成从未发生。

## 工作流、Skill 与执行代码的单一职责

工作流节点只声明职责、冻结输入和结构化输出合同，创作规则来自所属 Skill；禁止在节点 instruction 或前端模板内复制人物出场、对白、战斗或资产生成方法，避免已装配版本与 Skill 形成两套规则。结构错误依据真实字段路径回灌同一逻辑任务，不把“一次提交”写成禁止修复的流程约束。

BeatSheet 作者在冻结前逐段完成视觉依赖自检：实际入画角色、场景、持用道具与需要连续性的群像/构图对象均映射至 objectRegistry 与当前 beat.objectStates。状态不变仍属于出场；画外发声和真实入画分别判断。该语义工作由 tapcanvas-dramatic-adapter 完成，资产投影代码只能消费已声明对象，不能从正文补主角或按名称猜配。

资产节点依据精确引用复用项目已有图片，并在交付画布投影来源预览；逐 Clip 的对象合同、解析后图片引用和供应商实际 manifest 才是消费证据，画布有同名图不代表已绑定。未知对象 ID 必须返回结构性拒因，由当前作者链修订，不按对象种类或列表次序替换。已有供应商回执和媒体始终保留。

writer 保留独立结构化 speechEvents 与 shots 的共同时间轴，最终展示由统一 renderer 将台词放进开始发声的镜头，跨镜只显示接续，完整台词只出现一次；不另列平行对白块，也不机械切字或改写冻结对白。修复验收应覆盖规划合同、逐段资产投影、供应商引用和声音展示，不以手改某段产物代替链路验证。

## Workflow IR 质量职责

根代理不手工拼装 BeatSheet 或 Clip prompt。质量来自 DAG 内的专职节点及其同链修订：

- BeatSheet agent：以真实章节建立完整、可拍的事件与对白范围；
- Clip writer：逐 Clip 输出动作、连续性、摄影、光线、材质、声音与 speech event；
- 资产节点：先复用真实 image-ready 资产，只为缺失身份/场景补图。正式整章只能存在一套章级 canonical 资产分支，全部 Clip 复用同一个人物身份版本；禁止先让首 Clip 无参考文生出一张脸，再从第二段切换角色卡，也禁止首段与其余段各生成一套同名人物图；
- 新建人物资产必须调用并遵守 `tapcanvas-character-card`，以 `referenceType=character`、`characterAssetRole=identity_anchor`、`characterProfileVersion=character-card/v3`、精确 `roleName`、非空 `identityAnchors/prohibitedDrift` 持久化为 identity-board/v3。基态只锁定骨相、体型、发型剪影、服装结构和身份物件；表演、伤势、附体、污损和换装进入状态/构图资产，不得重造人物基态；
- voice manifest：为所有明确发声行提供可执行配音清单；
- production handoff：只装配已经过 typed-port 验真的输入；
- video generate：逐项提交真实供应商任务并持久化 taskId/videoUrl；
- output/concat：按验证变体交付第一条视频或完整成片。
- max clip：完整成片图在 BeatSheet 后、资产与视频生产前确定性冻结前 N 个 Clip；它只缩小本次物理生产集合，不评价片段语义是否完整，也不触发运行中纠偏。

语义质量不足必须在对应 agent 节点的同一执行链内修订，不能变成 Hono/Web 的关键词、字数、评分或风格闸门。协议 schema、权限、计费幂等、真实资产 URL 与供应商硬上限仍必须严格执行。

## 评测规则

首视频集成评测必须验证：

- 来源确实是隔离项目中上传书籍的第一章；
- 工作流包含并成功经过 BeatSheet、Clip writer、资产处理、voice manifest、production handoff；
- 首个视频供应商 receipt 的 reference manifest 已包含该 Clip 冻结对象合同要求的人物身份锚，不允许显式空资产集合或纯 T2V 身份起跑；
- `workflow.collection.take/v1` 只输出一项；
- `tapcanvas.video.generate/v1` 只有一个成功 item；
- `workflow.output/v1` 提供一条可访问真实视频 URL；
- 统计从评测开始到该 URL 首次持久化的墙钟耗时。

Clip 提示词质量是独立 prompt-only 集成评测：只审章节忠实、因果连续、入/出状态、镜头任务、运镜动机、空间轴、物理动作、光影材质、声音透视与对白时窗。它不生成媒体，也不拦截已受理媒体。

## 禁止动作

- 禁止调用或恢复已退役的黑盒视频生产链。
- 禁止根代理直接调用裸 `tapcanvas_video_generate_to_canvas` 交付视频终态。
- 禁止用普通 `tapcanvas_workflow_run` 绕过当前用户装配关系。
- 禁止把 attachment 缺失静默降级成其他模型、其他工作流或本地模板。
- 禁止把文本资产冒充真实图片 URL。
- 禁止把 `acceptedAsync`、提示词、供应商 taskId 或估价当成视频交付。
- 禁止因后处理质量诊断删除、覆盖或回滚已生成媒体。
- 禁止为某一章节、某一模型或某个 run 增加 case-specific 分支；新缺口必须扩展通用 Workflow IR、typed port、executor 或 verifier。

## 最终自检

结束前逐项核对：

1. 是否读取了真实项目/章节/素材事实；
2. 是否只调用了当前 schema 中存在的 attachment；
3. 是否只启动一次并保留稳定 execution identity；
4. 是否按用户范围停在视频节点、首视频或完整成片，而没有扩大付费生成；
5. 若工作流冻结了 max clip，本批次数量是否按前缀集合验真，且没有把未覆盖章尾的批次成功误报为全章成功；
6. 是否具备冻结范围对应的交付证据：视频节点准备回执，或真实、可访问、已持久化的目标视频 URL；
7. 是否保留所有已生成资产与失败证据；
8. 是否让 delivery verifier 基于真实 execution/node/output 事实裁决。

任何一项不满足，都不能宣称完成。

## 按次调整工作流媒体参数

一键成片允许通过动态工具 schema 中的 `triggerPayload` 可选字段调整 `videoResolution`、`videoAspectRatio`、`videoSize`、`videoModelKey`、`imageSize`、`imageAspectRatio`、`imageModelKey`。`requiredTriggerPayloadFields` 只表示必须提交的字段，不是允许字段白名单。省略可选字段时继承已装配配置；明确调整时按实时供应商目录验证并冻结到本次执行，不反写共享模板，不自动切换模型。参数校验失败时修正同一工具调用并保持幂等键，不另起裸媒体生成作为隐式替代；已有供应商回执先对账，禁止重复付费。


## 只生成视频节点（显式用户选择）

本章入口的 `onlyVideoNodes=true` 是交付范围事实。章节 film-spec 在受理时读取并冻结到 trigger；使用同一 `full_video` Workflow IR 中的条件分支，不另起提示词专用工作流。仍完成章节规划、参考资产准备和逐段提示词；分支只调用 `tapcanvas.video.prepare/v1`，把完整 prompt、精确资产 ID、模型规格、真实片段序号写入画布并回读。此时以全部 `tapcanvas.video-node/v1` 持久化回执为完成证据，不要求视频 URL，不继续提交视频任务或合成。不要把“待手动生成”描述为失败、阻塞或已生成视频。关闭开关时沿原视频提交、合成与视频 URL 验证分支执行。已受理执行保留冻结选择，不受之后修改开关影响。

逐段素材消费采用 BeatSheet v22：objectRegistry 保存全局引用池，objectStates 显式选择本段 referenceAssetIds/referenceImageNodeIds 子集。素材复用集合逐图记录 consumerClipIds，不能按同角色把全局多图重新注入每个片段。完整素材覆盖按整片核对；writer 只消费本段冻结绑定，不自行丢图或补入其他段图片。
