---
name: tapcanvas-api
description: 统一的 TapCanvas API skill。凡是要通过 TapCanvas 项目的 `/public/*` 接口、受保护的 `/projects` 接口、或 `/agents/llm/*` 推理接口（含视频理解 videoUnderstand）完成 chat、draw、vision、video、tasks/result、flows 读写、视频内容分析时，都必须使用这个 skill。agents bridge 通过已注入的 TapCanvas 远程工具面执行，终端环境通过同目录脚本执行；两者共用同一后端契约与显式失败策略。
metadata:
  contracts:
    - tapcanvas/video-prompt-authoring@4.0.0
---

# TapCanvas API

协议诊断或离线 Agent 评估需要直接测试已启用文本模型时，终端通过 `llmChat` endpoint 调用现有 `/agents/llm/v1/chat/completions` 用户鉴权代理，显式提供 model/messages 和所需协议字段。该调用不创建用户画布产物，也不自动执行返回的工具调用；不能作为一键成片的平行生产链。真实推理会正常计费，不切换模型或绕过自有网关。

TapCanvas 对外 API 的唯一 skill：统一入口、统一凭据、明确失败（不静默降级、不猜默认接口、不切旧 skill）。

用户只要视频节点时，在装配工作流调用中显式传 `triggerPayload.onlyVideoNodes=true`；该参数优先于章节默认设置。保留全章生产与真实素材链，验收视频节点、完整提示词和引用已持久化，不提交视频生成。

## 工作流恢复

用户已授权重试失败图片时，`executionResume` 可传 `mediaRetries:[{nodeId,itemId,taskId}]`，三项必须取自同一次 `executionNodeRuns` 的精确失败图片回执。服务端验证旧项 failed、旧 taskId 一致、没有产物及下游已受理副作用，再沿原执行族创建独立幂等的新图片尝试；旧失败节点和成功兄弟项保留。普通空对象 resume 不授权重复提交媒体。正在执行、已成功、身份不符或已有资产的项不能重试；不得通过新建完整工作流绕过。该模式与其他 resume 修订模式互斥，不修改模型、提示词或来源。

引用被判为废弃但公开删除清单没有对应节点时，用 `chapterCanvasMembership --chapterId <真实章节ID>` 读取只读归属诊断（需管理员身份并核对章节权限）；核对精确节点/任务 ID、可见性、明确删除、执行脱离与保留事实。此接口不恢复节点、不允许据诊断自行复活用户已删除素材。

本地运维诊断已生成图片的读取/解码故障，可运行本 skill 的 `scripts/inspect-execution-image-resources.mjs --profile local --execution-id <真实 executionId> --node-id <真实图片集合节点> --container <本地执行器容器名>`。脚本仅通过正式 CLI executionNodeRuns 取得 asset-bindings，在指定执行器中探测原图片 HTTP 响应并解码，输出身份、状态码、MIME、字节数、哈希、尺寸及具体异常；不输出 URL/图片正文，不调用理解模型、不生成或回写资产。这是网络和解码事实，不是视觉语义理解。

已确认未提交媒体的计划结构错误，可用同族 `tapcanvas_workflow_resume` 的 `planningRevision={nodeId,instruction,refreshAssetIds:[]}` 交回精确作者修订。空列表明确表示保留全部冻结素材与观察，不刷新资产；修复指令依据本次真实失败证据，不更改用户目标、来源或模型。背景计划同 assetId 必须对应同一份完整计划，若作者需要不同背景状态则由作者赋予不同 ID，不由本地选择、合并提示词或覆盖旧结果。

带背景站位图沿正式图片工具先生成场景 Skill 编写的俯视底图，再调用 `tapcanvas_render_blocking_diagram`。新图传结构化 characters/compositionContract 和 backgroundNodeId；旧图新增背景版本传 sourceDiagramNodeId + backgroundNodeId。工具直接持久化并回读新节点，返回 nodeId/状态/构图来源，不返回图片 URL。底图和源图必须属于当前授权画布，原图与下游引用不改写。

若历史 BeatSheet 在同一字段的添加/删除间反复重试，先核对 Agent 提交 schema、Agent 校验和宿主校验实际加载的共享 `clip-reference-selection` 合同。字段缺失只修订同一候选；修复部署后沿原持久执行继续，不新建工作流、不复制输入素材、不把仍在修订说成供应商生成中。

费用预估因结构化模型目录合同缺失时，持久执行器先立即重读一次权威目录；仍缺失则保留 `dependencyObservation` 与 `externalCheck`，等待后台按原节点重查。`waitingReason=external_dependency_unavailable` 表示等待目录事实修复，不是正在生成视频；精确模型、缺失字段、首次观察时间与次数在 evidence 中读取。不要手动反复 resume、换模型、猜容量或重建 family。结构化作者稿件被校验退回时，运行时先保存原稿和 `outputRepair`，再立即给同一作者一次修订机会；未修好继续已有持久恢复，已成功素材不重生成。历史已 failed 的执行不会因代码更新自行改写，恢复仍按本节原执行族合同进行。

用户要求采用已有图片修正素材引用时，失败执行可通过 `tapcanvas_workflow_resume` 的 `mediaAdoptions:[{nodeId,itemId,assetId}]` 追加引用修订。先以 executionNodeRuns 取得精确图片集合节点与已结束 itemId，再用素材目录与已有理解回执核对 assetId；名称相同不等于内容相同。该模式只采用当前项目真实就绪图片，不生成图片、不改写原画布图片或原执行回执。被替换项必须已成功或已失败，仍在途的任务及已有下游付费回执不得被替换；其他项继续保留。不得把采用旧图描述为新生图成功。调用后回读新执行逐项 evidence 的 `reuseSource=explicit_media_adoption` 与 `adoptedAssetId`，再核对后续生产引用。

用户授权修正未提交的计划、采用现有素材新版本时，可使用 `tapcanvas_workflow_resume` 的 `planningRevision={nodeId,instruction,refreshAssetIds}`。先读取 executionNodeRuns/executionContext 确认失败、精确规划 Agent ID 和已冻结资产 ID；通过动态 schema 调用。instruction 只传本次已授权的修订要求，不编造新用户事实。新执行保留同族、原文和模型，更新列出的资产快照，从该 Agent 重做；下游已有供应商任务或产物时该动作会拒绝，不能另开整条工作流规避。禁止将单纯等待或查询超时当作重新规划授权。

图片已由供应商生成但 OSS 上传失败时，taskResult 与同族 workflow_resume 从已保存的 hosting 检查点或可校验的 storage-put 失败回执恢复物化，仅重新上传和回填原 taskId；不得重新生图。hosting pending 是已生成资产等待自有存储的事实，不是供应商仍在生图。

工作流 `project_context` 来源执行只消费受理时配对冻结的 callerCanvasSnapshot 与 ProjectContext，不重新读取实时画布；浏览器未保存 seed 或启动后编辑不改变本次来源。

章节生产的正文由服务端按章节 narrative 或绑定书籍的真实章节来源建立只读快照，不依赖页面先保存 seed。若历史执行缺失 canonical 输入，普通同族 resume 可以在原 sourceNodeId 作用域补齐未绑定节点/descriptor；已有冻结来源与已受理任务不刷新，原失败快照保留。不要通过复制正文、整图覆盖或重新发起完整工作流修补此类输入缺失。

工作流启动/恢复的 queued/running 回执携带 `completionBoundary="submission"`、`executionOwner="durable_executor"` 与稳定 runId 时，对话完成交接；后续生产、结构修复和交付验收由 Workflow IR 持久执行器独立推进。不得在对话中继续轮询、另开素材识别任务、重新索取已冻结选择或等待用户发送“继续”。交接不是媒体生成成功，结果以 execution/family 的真实状态和资产证据为准。

供应商状态查询返回的 `error.code/error.type` 是失败来源的协议证据，视频对账会保留为节点 `errorCode` 与工作流 `providerErrorCode`。供应商明确返回 `status=failed` 时，不得仅因文案包含“查询超时”就改报 running；本地查询动作异常也不能证明供应商生成失败。先读取原任务回执；新的付费尝试只走用户授权的 `tapcanvas_video_retry`，保留原任务及已有资产，不从错误文案推导自动重提或模型切换。

失败工作流通过 `tapcanvas_workflow_resume` 恢复原执行族，复用成功输出与已受理任务回执。历史 `workflowExecutionRecoveryPolicy=fresh_only` 已退役，不能否决恢复；禁止据此另起完整付费工作流。恢复范围由冻结 DAG、失败证据、执行族并发隔离及幂等合同决定，原任务计时不重置。 显式恢复同时刷新等待项与带持久回执的失败项，仅查询已有任务；视频沿原节点的稳定 retryIndex 身份接回已授权重试结果，不重复付费提交。集合内一个失败、另一个仍被供应商执行时，保留失败证据并继续等待在途结果；不能丢弃成功兄弟项或提前停止回填。

## 视频提示词运行时激活

当前权威合同为 `tapcanvas/video-prompt-authoring@4.0.0`。

- 任何准备写入视频节点或提交供应商执行的模型提示词，都必须进入 `tapcanvas-video-workflow` 的统一 BeatSheet 路径：只交付提示词时使用 `executionScope="prompt_only"`，真实出片时使用 `executionScope="media_delivery"`。两种范围都由正式 `video-prompt-writer` 角色编译每个 clip；不得由主代理凭记忆、旧节点 prompt、聊天样例、通用 Seedance Skill 或本 skill 自行拼装一条可执行提示词后直接调用 `tapcanvas_flow_patch` / `tapcanvas_video_generate_to_canvas` 绕过该路径。
- 正式 `video-prompt-writer` 角色预载 `tapcanvas-video-prompt-writer` 与 `tapcanvas-video-reviewer`；writer 的 `autoload-resources` 已包含 `tapcanvas/video-prompt-authoring@4.0.0`，reviewer 仅在同一 writer 上下文提供 embedded authoring 复盘方法，不另起 reviewer agent、不输出独立门票。writer 在唯一模型响应内部完成首稿复盘与最终稿，并在提交前把没有明确授权事实的第三方视听联想投影成原创供应商可见表达；runtime 不在提交后调用模型纠偏。agents 根据本轮真实剧情与动作关系，在确有方法缺口时从 writer 自身 references 中精确选择至多一份文戏、战斗或 VFX reference；其它导演、分镜、情绪、镜头或 Seedance Skill 只能向父任务提供领域方法与结构化事实，不得改写 writer 的正式输出合同。该判断只属于 agents，不得由 Hono/Web/本地关键词、正则、别名表或 route 完成。
- 最终提示词服从逐 clip 的最小充分信息量：完整覆盖冻结剧情、逐字对白、时间/场景/人物状态、主体动作、空间关系、摄影机、必要材质响应与声音即可，禁止为了固定字符数重复状态、堆砌镜头术语或扩写原文事实。若因果或可执行动作尚未闭合，当前 agent 在同一执行链补足缺失维度；信息已经充分时立即收口。历史 `minimumPromptCharacters` 只作非阻塞诊断，不得成为 writer/Hono/Web 的运行时质量闸门、自动截断或用户重试条件。参考图片只通过 node/asset ID 锁身份、道具、空间与材质，不能替代动作正文。
- 一键成片与 `prompt_only` 使用同一服务端编译的 `temporalFrameTrack`：每个物理 clip 从 0 秒开始按不超过 1 秒的连续窗口提供 `startFrame → transition → carryFrame`，后一窗机器状态逐字继承前一窗承态。writer 只提交有序 shots 及每镜实际拍出的 `depictedStoryEventIndices`；服务端只验证结构、事件顺序和时钟相交，并据此编译 `sourceEventCoverage`，再根据冻结 `storyEvents` 与 shot 时钟编译 `temporalFrameTrack/temporalFrameCoverage`。完整状态轨保留为结构化追溯证据；renderer 只投影参考绑定、镜头声画和同钟人声。stateAnchors 连同 continuity/editRhythm/exitState/visualTask/motionDynamics 保留为内部证据，不拼入供应商正文；必要状态和切点由 writer 写进实际镜头，不把采样检查点当作进行中姿态。这里约束的是显式事件证据、时间覆盖、状态接力和真实镜头映射，不是最低字数、固定镜头数或语义关键词闸门。

## 媒体理解职责边界

- 图片理解只能调用 `tapcanvas_analyze_image({nodeId})` 或 `tapcanvas_analyze_image({assetId})`，使用当前服务端工具合同声明的图片理解模型（部署配置 `IMAGE_UNDERSTANDING_MODEL_KEY`）。主代理和其他工具不得接收、下载、复制或回显图片存储 URL，也不得覆盖图片理解模型。公开 `/public/vision` 接口可直接传入 http(s) `imageUrl`，服务端会将其作为真实 URL 图片输入交给视觉模型。
- 视频理解只能调用 `tapcanvas_analyze_video`，由服务端固定使用 `doubao-seed-2-0-lite-260428`，并统一承担代理转码、按真实时长切段、逐段理解和 provenance。不得用底层 `videoUnderstand` endpoint 绕过业务工具完成正式成片学习。
- 图片或视频理解失败时原地报告真实错误；禁止跨媒体换模型、自动降级、让 GPT 主模型下载媒体，或把本地抽帧观察冒充正式工具分析结果。
- 终端 `videoUnderstand` endpoint 只用于调试其 HTTP 协议本身，不构成画布视频分析、正式成片学习或 outcome 证据；凡任务目标涉及真实画布视频或 V2/V3 成片诊断，必须走 `toolExecute -> tapcanvas_analyze_video`。

## 图片引用 ID 硬协议

成功图片理解返回 `provenance`：`version/mediaType/modelKey/taskId/referenceId/promptHash/analysisHash/analyzedAt`，均来自实际成功任务与本次问题/分析。它只证明真实执行和结果来源，不替 Agent 判断产品性能。失败保留原始错误码并记录 `media_understanding` 诊断，不自动换模型或原样重试；同一图片、同一问题的成功结果可在同一 run 复用。理解属于付费推理，不能因不改画布就当成可无限重试的免费读取。

- 主模型和 skill 只使用图片资产名称、`nodeId`、`assetId`、`assetRefId`；不得从 prompt、flow、工具结果或日志中寻找、复制、拼接、输出图片存储 URL。
- 先用 `tapcanvas_flow_get` / `tapcanvas_flow_search` 找节点 ID，或用素材工具取得资产/版本 ID；需要确认引用真实可执行时调用 `tapcanvas_image_refs_get({nodeIds?,assetIds?})`。该工具只返回名称、ID、来源、媒体类型与 ready 状态，不返回 URL；章节级只读清单会在服务端按付费执行批大小确定性拆批，这不改变任何单 clip 模型引用预算。
- 工作流会将显式选中的当前画布图片节点冻结为稳定 selectedAssetIds；焦点节点不自动等同素材选择。BeatSheet 对同一对象允许绑定多张原图，referenceImageNodeIds 只解析本次 canvasId 内真实就绪图片，跨画布引用使用稳定 referenceAssetIds。后续资产计划逐图复用这些精确引用，不按展示名换图，也不把缺少资产计划补成无参考文生图。
- `tapcanvas_material_assets_list` 返回的项目节点 `referenceAssetIds` 采用完整稳定 ID：`project-node:<ownerType>:<ownerId>:<nodeId>`。同项目跨章节复用时必须把该 ID 原样传给 `assetIds/referenceAssetIds`；结果中的裸 `nodeId` 只属于 `origin.ownerId` 指定的来源画布，禁止把它作为当前章节的 `nodeIds/referenceImageNodeIds`。服务端按项目权限回源读取真实节点，跨项目引用显式失败。
- 用户在画布上删除的节点即「已废弃」：其图片/视频资产、设定库副本与 generation 资产行都不得再被任何生成链路引用或重新召回（`nodeIds`、`assetIds/referenceAssetIds`、`selectedAssetIds` 三条路径都执行同一裁决）。服务端按媒体 URL、画布节点 id、供应商 taskId 三类稳定身份判定，只要该身份仍被任一可见画布持有就不算废弃；判定不使用展示名或语义相似度。引用已删资产会在付费提交前以 `agents_tool_image_reference_deprecated`（422，`details.deprecatedAssetIds`）显式失败。需要复用时必须让用户在画布上重新生成或重新选定，禁止换同名资产、换 URL 变体或换版本绕过。
- 启动 `tapcanvas_equipped_workflow_run` 时，`selectedAssetIds[]` 只能使用当前项目素材列表返回且已有真实图片 URL 的稳定资产 ID。当项目里已有 agents 判定可复用的跨章节资产时，直接提交完整 ID，禁止重复生图；Hono 仅做稳定 ID、权限与媒体事实验真，不判断两个展示名是否语义等价。
- `sourceMode=project_context` 的完整视频工作流会在受理边界冻结 canonical 章节正文、画布、全量可见资产快照和选择事实。若用户没有要求代理在启动前做素材取舍，根代理记录 intent 后应立即调用 `tapcanvas_equipped_workflow_run`，不得为了重抄这些宿主已冻结的事实而先串行读取章节、画布或素材清单。只有当代理确实要选择某个现有资产作为本轮显式语义引用时，才先调用一次 `tapcanvas_material_assets_list`，随后必须把已选稳定 ID 放入同一次 workflow 调用的 `selectedAssetIds`；禁止“读取了素材但启动时丢掉选择”，也禁止把无关只读巡检放到供应商受理之前。
- `requiredAssets[]` 带 `stateKey/stateVersionId` 时表示人物状态锚：先复用同名基准身份卡作为图片编辑引用，只改变 `visualFacts` 声明的可见变量；新图片节点必须写入逐字相同的 `roleName/stateKey/stateVersionId/visualStateFacts`，并把该基准卡的当前画布 `nodeId` 写入 `referenceImageNodeIds`。该 binding 只能提交当前画布真实 `nodeId` 并逐字携带 `stateKey/stateVersionId`，禁止使用基态、另一状态或跨章 `referenceAssetId` 替代。状态锚缺失时由同一 run 继续补图与 reconcile，不重新创建 BeatSheet 或视频 run。
- 通过 `tapcanvas_flow_patch` 或 `tapcanvas_image_generate_to_canvas` 新建可复用角色卡、场景卡、道具卡时，必须显式写入 `referenceType`，并分别写入精确 `roleName`、`sceneName`、`propName`。人物状态锚还必须写入精确 `stateKey/stateVersionId/visualStateFacts`。可复用道具统一使用 `propAssetRole`、`propProfileVersion="prop-card/v1"`、`propAnchors`、`propBoardSpec`、`propFunctionSpec` 与 `materialIdentity`；基态为 `materialIdentity.mode="base"`，状态版必须以 `mode="state"` 绑定精确 `canonicalAssetId/stateKey/stateDescription`。`label` 只用于展示；禁止依赖标题、关键词或正则让后端猜资产类型与身份。
- 普通生图与视频节点只提交 `referenceImageNodeIds` / `referenceAssetIds`；当图片任务必须显式区分布局、风格、身份或内容职责时，图片节点改用 `referenceAssetBindings:[{assetId,role,strength?}]`。`role` 只能是 `layout/style/identity/content`；服务端把 layout/content/identity 投影为构图参考、把 style 投影为独立风格输入，并把可选 strength 作为模型能力允许时的 weight 与持久 provenance。禁止同时用同一个 assetId 占多个职责，也禁止向 agent-facing 工具传 `referenceImages`、`styleImages`、`styleReferenceImages`、`assetInputs[].url`、`imageUrl` 或 `lastFrameUrl`。
- `tapcanvas_get_style_reference` 只返回是否已锁画风、数量与执行策略；项目全局画风由服务端在每个图片/视频媒体付费执行边界统一注入。图片与视频都必须沿同一 `style` 职责消费项目风格参考图；图片与视频必须保留任务所需的完整真实引用，不以模型目录参考图数量进行预检拦截或裁剪；供应商拒绝仅记录对应子任务错误，交给用户抉择，其他可交付子任务继续；禁止 Agent 自行丢弃、复制或另造第二套画风。首次设置或显式更新画风使用 `tapcanvas_set_style_reference({nodeIds?,assetIds?})`，不得提交 URL。
- BeatSheet / storyPlan / `status(includeBeatSheet=true)` 不保存或返回 `styleReferenceImageUrl`；旧 run 中遗留的该字段也会在 agent-facing 读口移除。项目风格图由服务端在最终视频 manifest 中以 `style` 职责注入，Agent 不接收 URL；它与本镜业务图片一起按冻结的供应商参考图合同计数，不能被静默丢弃或当作剧情内容。
- `tapcanvas_video_extract_last_frame` 抽帧后会登记真实图片资产，返回 descriptor 与 `referenceAssetIds`；下一任务直接复用该 ID。
- Hono 只在真正提交付费图片/视频任务前 fresh-read 授权画布与资产库，把 ID 解析成真实 URL。任一 ID 不存在、越权、不是图片或没有真实媒体时，必须在付费提交前显式失败，禁止丢引用、猜 URL、换模型或走默认工作流。

## 唯一路径

凡调用下方 endpoint 清单中的任一接口（含视频理解 `videoUnderstand`），只能使用本 skill。

禁止：再用分散的 TapCanvas API skill；在不同 skill 各自维护一套凭据；未经确认改用其他 endpoint 或本地伪造结果。

终端运行面需要核实当前生成模型目录时，使用 `newApiModels` 只读查询真实 `GET /new-api-models`。它返回当前 New API 目录，支持 `kind`、`enabled`、`refresh`、`selectable`、`include_action_models` 查询参数；一般生成选择可显式传 `--enabled true --selectable true`，按真实任务传 `--kind image|video`。`modelCatalogModels` 对应独立的 `/model-catalog/models` 目录，空结果不能据此判定当前生成模型不可用。查询目录不等于授权切换模型、修改模型状态或提交生成；完整工作流仍消费服务端冻结的模型合同。

## 配置

终端运行面由已安装的 `tapcanvas` CLI 读取用户级 `~/.tapcanvas/config.json`；仓库开发环境也可通过 `TAPCANVAS_HOME` 指向隔离配置目录。配置固定使用 `version: 2`，并在 `profiles.local` 与 `profiles.production` 下分别保存：
- `apiBaseUrl`: 当前环境的 API 地址，不带尾部斜杠；`local` 只能是 loopback，`production` 必须是非 loopback HTTPS。
- `apiKey`: 当前环境的用户 API Key（`tc_sk_xxx`），用于公开接口与受保护用户接口。
- `authToken`: 可选的当前环境浏览器登录 JWT。官方 CLI 安装授权产生的用户 API Key 已是完整用户身份；所有 CLI 支持的用户路由都必须接受它，不能再要求额外复制浏览器 token。

每个网络命令都必须显式传 `--profile local|production`，或显式设置 `TAPCANVAS_PROFILE`；缺失 profile 直接失败，禁止读取“默认环境”、按 URL 猜环境或自动切换。底层字段优先级仍为：命令显式参数 > 所选 profile > 环境变量 `TAPCANVAS_API_BASE_URL` / `TAPCANVAS_API_KEY` / `TAPCANVAS_AUTH_TOKEN`。Skill 不读取、复制或回显长期凭据。

profile 同时冻结确定性的反代路径：`production` 的受保护用户接口使用 `/api/*`，公开接口仍使用根路径下的 `/public/*`；`local` 直接连接后端端口，公开与受保护接口都使用根路径。endpoint 的访问面由本 skill 的固定目录声明决定，禁止先请求错误路径再依据 404/HTML 自动重试另一前缀。

配置凭据只能通过 stdin 写入仓库外的 0600 用户配置：`tapcanvas config set --profile <local|production> --api-base-url <url> --api-key-stdin`。`tapcanvas config list` 只返回 profile、地址和 `hasApiKey/hasAuthToken`，不得返回凭据值。仓库内 `tapcanvas-api/config.json` 只能是无密钥结构示例；禁止把长期 key 写入 skill、源码、日志或命令行参数。

旧的单环境 `version: 1` 配置不再兼容，必须显式重建两个 profile。所选 profile 缺少 `apiBaseUrl`，或同时缺少 `apiKey` 和 `authToken` 时必须直接失败。

## 执行方式

先依据当前真实工具面选择唯一可执行入口，不得把一种运行面的工具假设带到另一种运行面：

### agents bridge / 小T 会话

对话 Agent 到工作流的用户目标由 runtime 自动通过 `parentUserIntentContract` envelope 传递并冻结为 `workflowUserIntent`；不要在 args/triggerPayload 中复制这两个字段。启动前使用已有 `record_user_intent` 把仍适用的前文要求和本轮新增要求记录完整，采用的结论与素材/分析身份放在 confirmedFacts 并保留原来源，不能只记录最后一句承接语。风格字段只表达风格，不能代替用户目标。下游 Agent 从同一执行快照读取完整父目标，但仍只执行自己的节点职责。

当工具面存在 `tapcanvas_get_tool_schema` 与 `tapcanvas_call_tool` 时，当前运行面就是 agents bridge：

1. 用 `tapcanvas_get_tool_schema({name:"<真实 TapCanvas 业务工具名>"})` 读取当前请求作用域下的动态 schema。
2. 用 `tapcanvas_call_tool({name:"<同一业务工具名>",args:{...}})` 执行；例如一键成片只能查询并调用 `tapcanvas_equipped_workflow_run`，不能查询或调用 shell 包装器。
3. `canvasProjectId`、`canvasFlowId`、`chapterId` 等真实作用域由 bridge 外层协议传递，按业务工具 schema 组装 `args`；禁止把 `toolExecute` HTTP envelope 再套进业务工具参数。

agents bridge **不暴露 `exec_command`**。严禁调用 `tapcanvas_get_tool_schema({name:"exec_command"})`，严禁 `tapcanvas_call_tool({name:"exec_command",...})`，也严禁尝试运行本 skill 的本地脚本；任一所需业务工具未注入时必须显式失败并报告缺失工具名。

新建完整成片与章节一键成片沿 `tapcanvas_equipped_workflow_run` 单轨执行。对已经存在的具体视频节点，查状态/回填使用 `tapcanvas_video_reconcile`；用户授权重试该失败节点时使用 `tapcanvas_video_retry`，不重建 BeatSheet、提示词或重新启动整条工作流。重试参数是原始 nodeId、retryIndex（1 或 2，首次生成之外最多两次重试）、稳定 idempotencyKey；服务端复用保存好的生成输入并先确认旧任务状态，返回已成功或仍在执行的旧任务时禁止再次提交。查询失败不等于生成失败，`awaiting_receipt_confirmation` 表示等待确认，不得声称正在生成或已完成。需要整片时由 agents 根据真实成功资产选择后续合成动作。attachment 为 `sourceMode=project_context` 时，根代理不得创建文本节点或提交 `source/sourceGroupId` 复制用户原话，也不得在启动前为了重建同一来源而串行读取章节/画布。只有不带章节作用域的公开画布聊天才由宿主以可信 `publicTurnId` 将同一回合不可变的 `request.accepted.prompt` 冻结为工作流的 `public_chat_turn` 来源；带 `chapterId` 的公开聊天与其它章节调用始终按 attachment 的 ProjectContext 合同冻结 canonical 章节正文，禁止用短聊天指令覆盖章文。公开请求中已经结构化提交的 `assetInputs[].assetId` 属于用户显式选择，宿主必须与 Agent 传入的 `selectedAssetIds` 去重合并并冻结进同一 Workflow ProjectContext；不得因根 Agent 漏抄参数而降为空选择，也不得从名称或 prompt 猜额外资产。

agents bridge 也不暴露本 skill 终端脚本中的 `models`、`modelCatalogModels`、`newApiModels` endpoint key；它们不是远程业务工具名。禁止用 `tapcanvas_get_tool_schema` 或 `tapcanvas_call_tool` 查询/调用这些 endpoint。完整成片所需的视频生成合同由 Workflow IR 的视频节点在服务端解析并冻结，根 agent 不应另起模型目录查询任务。

项目级连续创作必须区分三份独立事实：上传书籍、项目根画布、项目章节目录。`tapcanvas_books_list` 为空只表示未上传书籍，不能据此声称没有手动章节；项目根画布为空也不能否定 `chapters` 表或章节独立画布。先用 `tapcanvas_project_chapters_list` 读取包含手动章与书籍关联章的权威目录，再用 `tapcanvas_project_chapter_get({chapterId})` 读取该章 metadata、手动构思 summary 与 `chapters.canvas_flow`。默认节点为 slim；需要正文或 prompt 时携带该次返回的精确 nodeId，并显式声明 `fields`。

章节画布里的本章剧情采用单一写入口：先 `tapcanvas_project_chapter_get` fresh-read `canvasRevision`，再调用 `tapcanvas_project_chapter_update({chapterId,expectedCanvasRevision,title?,summary?})`。它会原子更新 chapter metadata 与锁定的 `chapter-seed-*`，返回新 `canvasRevision/sourceHash`。禁止用 `tapcanvas_node_text_edit` 分别改 `chapterText/content/prompt`，也禁止只把新剧情留在聊天记忆。剧情更新成功后，若任务要求章节剧情可视化，preview 分镜图必须逐板携带该 revision/hash。

跨章节共享的世界规则、故事/人物圣经、全书总纲、未决伏笔与章节计划统一以项目上下文中的版本化 `CREATIVE_BRIEF.md` 为文字真相源。项目根画布和章节画布都可调用 `tapcanvas_project_context_get` 读取；用户明确要求建立或更新这些全书设定时，先读当前版本，再按动态 schema 调 `tapcanvas_project_creative_brief_update` 提交完整新文档。该写入保留版本历史，不是局部 patch；禁止把自动生成的 `PROJECT.md`、`RULES.md`、`CHARACTERS.md` 或 `STORY_STATE.md` 当成可长期手改的替代真源。

### Codex / 终端会话

只有当前运行面真实提供 shell/`exec_command`、且没有 agents bridge 远程工具面时，才使用平台 CLI：`tapcanvas api call --profile <local|production> --endpoint <name> --payload '<json>'`。安装后先执行 `tapcanvas doctor --profile <local|production> --json` 验证 CLI、所选凭据与所选 API；失败时原地报告，不得退回仓库相对路径脚本。大 payload 可用 `--payloadFile /abs/path/request.json`，或通过 stdin 传入并使用 `--payload -`。常用只读入口可使用 `tapcanvas projects list --profile <local|production>`、`tapcanvas flows list --profile <local|production> --project-id <id>` 与 `tapcanvas flows get --profile <local|production> --flow-id <id>`。

用户明确要求创建新的项目画布时，终端可使用同一 skill 的两个受保护正式入口：先调用 `projectCreate`，payload 为 `{ "name": "<非空名称>" }`；再调用 `flowCreate`，payload 必须包含服务端刚返回的真实 `projectId`、非空 `name`、序列化 flow `data`、`ownerType:"project"`、`ownerId:<同一 projectId>` 与 `source:"user"`，并由服务端生成稳定 flow id。创建完成后必须立即用 `projects`/`flows`/`flowGet` 回读归属与初始节点事实，后续节点写入仍只使用 `tapcanvas_flow_patch`。这两个入口只用于用户本轮明确授权的新画布，不得拿来复制、覆盖或替换已有项目。

用户明确要求跨环境同步完整项目时，仍只走本 skill：先分别 `doctor` 并用 `projects` 查重，目标存在同名项目时禁止覆盖；再用 `projectCreate` / `flowCreate` 创建新目标，以 `bookIndex` / `bookChapter` 读取源书籍并用 `bookIngest` 写入目标，按章节号建立源/目标章节映射，通过 `chapterGet` / `chapterUpdate` / `chapterFlowGet` / `chapterFlowPut` 同步章节事实与画布。项目资产必须沿 `assets` 的 cursor 读完并逐条 `assetCreate`，媒体 URL 只允许在 CLI 进程管道中原样传递，不得回显给主模型。公开创作过程使用 `communityPublish`，并用 `communityProjectGet` 回读社区详情；若同时发布 TV 快照，必须使用已同步的真实成片与封面资产创建 `publishRecord`。任一步失败都保留已经创建的项目、画布与资产并报告部分成功，禁止删除或覆盖补偿。

终端需要把用户明确指定的本地图片、视频或音频作为真实项目资产输入时，使用 `tapcanvas assets upload --profile <local|production> --file <绝对路径> --project-id <id> [--name <名称>]`。命令只接受单个不超过 30MB 的真实图片、视频或音频，命中所选环境受保护的 `/assets/upload` 正式接口并返回 `assetId/name/mediaType/ready/projectId`；不会向主模型回显存储 URL。需要核对项目资产登记事实时使用 `tapcanvas api call --profile <local|production> --endpoint assets --projectId <id> [--kind generation] [--limit 200] [--fullData 1]`，不得绕过 skill 直查数据库。后续必须把返回的 `assetId` 原样放入 `referenceAssetIds` 或图片专用 `referenceAssetBindings`，不得把本地路径、base64 或上传响应中的 URL 写进 prompt/flow。若用户要求在工作流中看见上传原图，必须通过动态工具 `tapcanvas_asset_add_to_canvas` 把该 assetId 落成真实 `kind=image` 预览节点，并显式写入 `referenceRole`；禁止用 `workflowInput` 文本节点或假 URL 冒充预览。上传失败原地报告，不得创建本地预览占位或改用外部托管。

### Agent API 接入（异步成片）

输入媒体必须以本次 job 的 projectId/flowId 和稳定输入节点身份完成项目内托管，并按当前 owner 回读持久 assetId、项目归属、媒体类型与 URL。已有其他项目或未归属项目的输入资产只作为来源，在目标项目登记新的引用资产，不改写原资产；不得在持久化失败时仅传 URL 或原跨项目 ID。工作流冻结必须保留这些精确已选身份，诊断 `workflow_asset_selection_frozen` 可核对请求、选中与未解析 ID；画布回显不是这条资产链的执行前提。

当外部程序、自动化脚本或终端用户明确要把“需求 + 图片 + 视频”一次性交给小T加工，并以轮询方式取得最终成片时，使用 Agent API，不要自行拼接 `/public/agents/chat`、视频业务工具或供应商 API：

```bash
tapcanvas agent-api submit \
  --profile '<local|production>' \
  --prompt '把产品图片和演示素材剪成 15 秒竖屏广告' \
  --model-key '<当前已启用的语言模型 modelKey>' \
  --image-url 'https://input.example/product.png' \
  --video-url 'https://input.example/demo.mp4' \
  --target-duration-seconds '15' \
  --aspect-ratio '9:16'
```

- `projectId` 可省略；服务端会按当前 API key owner 与 active billing team 的正常项目作用域创建项目。`flowId` 只能和 `projectId` 同时提供；未传 `flowId` 时始终创建该 job 的专属画布，不猜默认画布。
- `targetDurationSeconds` 可省略；显式值必须是 1–180 的整数，表达最终成片总时长。统一视频工作流按所选视频模型的实时单 clip 合法档位拆段并合成，禁止把 180 秒作为单次供应商请求时长；超过 180 秒必须在受理前显式失败，禁止自动截短。
- 提交前服务端必须同时验真 Redis 队列连接和至少一个已注册的 `agent-api-worker`。Redis 可达但没有消费者时返回 `503 agent_api_worker_unavailable`，队列不可达时返回 `503 agent_api_queue_unavailable`；两者都发生在创建项目和 job 之前，调用方不得把失败请求当作已受理或自行绕过 Agent API。
- 每个媒体必须由调用方显式声明为图片或视频。CLI 的 `--image-url/--video-url` 可重复；已有 TapCanvas 上传资产可重复传 `--image-asset-id/--video-asset-id`；需要完整 role/name/note 时使用 `--media-json '<数组>'`。禁止用文件扩展名、prompt 关键词或模型猜媒体类型。
- 外部 `sourceUrl` 只作为 worker 的托管来源，且必须是公网 HTTP(S) 地址；环回、私网、链路本地、云元数据、base64 与本地路径会显式失败。worker 必须先把每项媒体写入自有 OSS 并以稳定 assetId/显式媒体类型交给 agents-cli；Agent API job 自身的持久 prompt 是 standalone BeatSheet 的冻结 source authority。专属画布输入节点只作可观测回显，投影失败必须持久记录，但不得阻断后端生成、拼接或交付。托管失败仍是 job 失败，禁止把第三方临时 URL 或占位节点交给生产链。
- submit 只接受 `202 + object=agent.video.job + status=queued` 为异步受理；随后保存响应中的稳定 `id`，只轮询该 job：

```bash
tapcanvas agent-api status --profile '<local|production>' --job-id '<job-id>'
tapcanvas agent-api wait --profile '<local|production>' --job-id '<job-id>' --interval 5 --timeout 1800
```

- `queued/running` 不是成片，继续等待即可；`needs_input` 必须把结构化问题交还调用方，禁止猜答案或把它写成成功；`failed` 原样报告 `error.code/error.message`；只有 `succeeded` 且存在自有 OSS 的 `result.videoUrl` 才能声明交付完成。
- 状态 GET 是事实读取，不是执行触发器：没有真实 agent turn 且持久 phase 仍为 `queued` 时必须保持 `queued`；只有 worker 已持久化执行阶段或真实 turn 证据才可报告 `running`。相同事实的重复轮询不得刷新 `updatedAt` 或伪造 `startedAt`，runtime 查询失败也不得制造运行进度。
- `wait` 只查询稳定 job 资源，不轮询供应商、不重复提交、不调用 `drive/reconcile`。超时只表示本次 CLI 等待结束，不改变服务端任务状态；调用方可继续用同一个 jobId 查询。
- Agent API 内部仍复用统一 agents bridge、UserIntentContract、视频工作流、异步 continuation 与 `expectedDelivery -> deliveryEvidence -> deliveryVerification` 验收链；它不是新的本地 prompt 路由或第二套视频 SOP。
- Agent API 提交身份必须来自当前已启用的用户 API Key；浏览器 JWT 不能单独替代该接入凭据。队列只持久化 `apiKeyId/userId/billing scope`，禁止保存长期 key 明文。worker 在执行前重新验证原 key 仍启用并属于同一 owner，再用版本化内部委托凭证进入统一 agents bridge；每个远程工具回调继续恢复原 `apiKeyId`、角色和计费归属。原 key 被撤销、内部 worker token 缺失或身份归属漂移时必须在 Agent 开始付费生产前显式失败，禁止匿名运行、降级为无 key 调用或等待下游返回 `auth_missing`。

Agent 单图与图片多变体统一使用持久异步合同；`node.data.waitForResult` 只能省略或显式为 `false`，`true` 会在付费提交前被拒绝。多变体复用 `tapcanvas_image_generate_to_canvas.nodes[]`，单批最多 8 张独立异步任务。省略每个节点的 `seed` 表示随机新变体；显式整数 seed 会原样传给支持该参数的供应商。供应商受理后的 running 节点、nodeId 与 taskId 就是持久证据；工具只在节点与 taskId 都已落库时返回 `completionBoundary="submission"`，对话父任务随即成功结束，不再监听资产物化。原图片节点继续由 SSE/reconcile 收取同一任务并回写 `success|error`；这不表示提交时已经出图。禁止因 HTTP 返回尚无 URL 而重复付费提交。批量只在全部子项提交成功时携带该边界；任一失败仍保留已受理资产，但不得把父任务误报为成功。

业务工具执行固定使用“目录 → 动态合同 → 调用”三步：

1. `tapcanvas tools list --profile <local|production> --project-id <id> [--flow-id <id> | --chapter-id <id>] [--book-id <id>] [--node-id <id>] [--execution-id <id>]` 列出所选环境、当前用户、当前真实作用域可见的全部注册业务工具、说明和执行语义。
2. `tapcanvas tools schema --profile <local|production> --name <tool> --project-id <id> [同一组 scope flags]` 读取当前动态合同。多 operation 工具若返回 `selectorRequired`，必须按返回的精确字段和值再次读取 schema。
3. `tapcanvas tools call --profile <local|production> --name <tool> --project-id <id> [同一组 scope flags] --input '<json>'` 执行。CLI 会把 scope 中的 `bookId/nodeId/executionId` 注入对应业务参数；显式参数与作用域冲突时原地失败。

项目级工具不再强制提供 flow/chapter；章节画布继续只传真实 `chapterId`，规范 `book-<bookId>-ch<N>` 会确定性推导 book scope。CLI 与网页端使用同一用户身份、工具注册表、项目归属、计费、幂等和危险操作校验；“网页用户可见/可操作”不等于管理员、内部恢复或宿主运维能力，后者不会因 CLI 登录而开放。禁止凭记忆补参数或用 `api call` 绕过工具目录。

两种入口最终都命中本节下方声明的同一组 TapCanvas API 与注册业务工具；这是运行面适配，不是语义路由、旧接口回退或平行业务流程。

## 延伸参考

`references/endpoint-reference.md`：执行接口动作前读取对应 Endpoint 和参数段；失败语义与真实画布验证前提也在此，不能用接口名称猜请求格式。

### 有序节点来源合同

flow_patch 的 data.sourceNodeIds 是当前画布内真实节点 ID 的有序数组。必须从 flow_get 返回的 ID 原样引用；不得重写、缩短或猜测 ID。显式更新中引用不存在会返回 flow_node_reference_missing，数组/元素类型错误返回 flow_node_reference_invalid；同次 createNodes 的稳定 ID 可以引用。修正对应单个动作并沿同链继续，不重生成已有媒体。更新后用 flow_get 的 fields:["sourceNodeIds"] 逐项读回，patchedNodes 计数不能代替内容和顺序验证。

## 按次调整工作流媒体参数

一键成片允许通过动态工具 schema 中的 `triggerPayload` 可选字段调整 `videoResolution`、`videoAspectRatio`、`videoSize`、`videoModelKey`、`imageSize`、`imageAspectRatio`、`imageModelKey`。`requiredTriggerPayloadFields` 只表示必须提交的字段，不是允许字段白名单。省略可选字段时继承已装配配置；明确调整时按实时供应商目录验证并冻结到本次执行，不反写共享模板，不自动切换模型。参数校验失败时修正同一工具调用并保持幂等键，不另起裸媒体生成作为隐式替代；已有供应商回执先对账，禁止重复付费。

### 图片理解回执交接

`tapcanvas_analyze_image` 相同真实图片、问题和模型复用成功任务正文。工作流以 `projectContext.mediaUnderstanding` 保存原文、原问题、稳定素材 ID 与 provenance，分析中的观察和推断均不自动成为用户 confirmedFacts。`executionContext` 的 `mediaUnderstanding.frozen=false` 表示回执可读取但不在旧冻结快照中，不能据此声称旧剧本使用了这些证据；恢复时须保留原素材选择与用户目标。

### 素材元数据与观察的区分

`tapcanvas_material_assets_list` 的 `kind` 是素材库分类，不是媒体类型。实际媒体以 `mediaTypes` 与 hasImage/hasVideo/hasAudio 为准；普通上传图可以是 kind=text、mediaTypes=[image]。`evidenceScope=asset_metadata` 仅证明资产身份和可用性，不证明已经理解图片内容。已有素材尚未观察不能描述为用户没有提供；需要内容事实时复用成功理解回执或使用已授权的媒体理解工具。旧候选回复和代理记录的未决问题不具备用户指令权威，不能替代原始目标或覆盖较新的真实观察。

### 一键成片复用素材的章节展示

运行时复用已验真项目图片时，沿同一 `tapcanvas_asset_add_to_canvas` 入口在交付画布创建或复用原资产的预览节点，保留 sourceAssetId，不生成新媒体。节点执行证据中的 `assetReferenceProjection` 区分展示成功与失败；展示失败不代表源图不可用，也不得重新付费生成。画布看到图片不等于每个视频片段已消费它，逐段引用以实际 assetObjectContracts、referenceAssetIds 和供应商提交快照为准。

章节画布的成功图片与成功视频均为持久结果；旧整图保存不得把同一图片节点的 imageUrl/imageResults/status 降级。看到占位仍在运行时先通过原 nodeId/taskId 回执对账，禁止由展示状态推导重新生图。

### 场景参考资产结构传递

一键成片场景资产作者只提交 `sceneCard.spacePrompt/negativePrompt` 作为空间生图文本，不提交通用顶层 prompt。`sceneCard` 还包含 `sceneProfileVersion=scene-card/v1`、`sceneAssetRole=space_anchor`、`sceneOccupancy=none` 与 `sceneLightingSpec`，顶层 `identityAnchors/prohibitedDrift` 分别逐字投影为节点 `sceneAnchors/prohibitedSceneDrift`。图片执行与素材登记保留这些字段；独立场景节点使用同样的 scene 字段及最终空间 prompt。所有场景卡无人，人物状态仍由现有 clip writer 从 BeatSheet 写入视频。结构性错配回灌作者同链修复，不通过关键词扫描或重生成已有媒体补救。


## 只生成视频节点（显式用户选择）

本章入口的 `onlyVideoNodes=true` 是交付范围事实。章节 film-spec 在受理时读取并冻结到 trigger；使用同一 `full_video` Workflow IR 中的条件分支，不另起提示词专用工作流。仍完成章节规划、参考资产准备和逐段提示词；分支只调用 `tapcanvas.video.prepare/v1`，把完整 prompt、精确资产 ID、模型规格、真实片段序号写入画布并回读。此时以全部 `tapcanvas.video-node/v1` 持久化回执为完成证据，不要求视频 URL，不继续提交视频任务或合成。不要把“待手动生成”描述为失败、阻塞或已生成视频。关闭开关时沿原视频提交、合成与视频 URL 验证分支执行。已受理执行保留冻结选择，不受之后修改开关影响。

工作流单个对象的多图绑定由宿主编译为 `assetObjectContracts[].assetIds`（单图为 `assetId`），对应当前 clip 显式选定的全部身份，而非全局 objectRegistry 引用池。逐段 objectStates.referenceAssetIds/referenceImageNodeIds 是选择真源，复用计划逐图保留 consumerClipIds。Writer 只创作 shots，不手抄或裁剪机器身份集合；每张实际引用继续独立保留并参与精确集合验证。


### 视频集合部分交付

新受理工作流在执行快照冻结 `workflowMediaDeliveryPolicy={version:1,maxRetries:1,exhausted:"deliver_successes"}`：失败视频沿原节点的稳定 retryIndex=1 身份最多追加一次受理尝试，复用已经成功或在途的回执，不重做成功片段。仍有失败且至少一个片段成功时，等待全部在途片段结束后按冻结片段顺序拼接成功项。Agent API 的 result.delivery 明确返回 status=partial、requestedDurationSeconds、actualDurationSeconds、completedItemIds 与 missingItemIds；顶层 succeeded 表示已经交付可播放结果，调用方必须读取 delivery.status 判断是否完整。全部片段失败仍返回失败；不得补黑帧、拉长片段或称短片为完整目标时长。此策略只在新执行受理时冻结，不改写历史任务。

### 冻结工作流资产详情（只读）

Workflow 提供的 `projectAssetCandidates` 是全量精简身份目录，不包含完整来源描述。需要核对详情时，通过本 Skill 的 `toolExecute` 调用 `tapcanvas_workflow_execution_inspect`，参数 `{executionId, view:"assets", assetIds:[精确候选ID]}`。返回该执行冻结快照中的 sourceFacts、analysisEvidence 与 analysisDiagnostics；不得把目录缺少详情解释为资产不存在，也不得猜测详情。按任务相关性自主选择读取零项、一项或多项，没有最低读取数。此视图不接受 cursor/limit，未知或越界 ID 整批显式拒绝，不改读实时数据。它不授权任何媒体生成或资产修改。

新生成场景底图显式使用 `assetPurpose=blocking_background`（与 `story_preview` 共用唯一枚举合同），并保留作者 displayName、scene 类型与 sourcePlanAssetId。素材目录携带原始角色/场景结构及提示词，供后续读取语义事实；物理资产身份不由展示名推断。

背景 referenceAssetBindings[].assetId 与对象表 referenceAssetIds 使用同一个冻结真实图片目录，只能逐字使用合法句柄，不能按章节或节点命名方式拼接引用。作者工具 schema 将这些字段限制为真实目录枚举，缺候选时允许空引用数组继续原创。
