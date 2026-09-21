# 延伸参考

视频提交的参考图绑定头保留对象合同中已有的 `identityInvariant` 与 `forbiddenTransfer`，与该对象真实 `@图N` 一同投影；缺字段不生成默认限制，多视图仍绑定同一对象。动作、接触、起终态必须由 writer 编译到逐镜执行字段，不能只写在内部状态账本。该机制不推断人物关系，也不作成片质量判定。

## Endpoint 规则

`executionResume.mediaRetries` 是精确图片重试授权：`[{nodeId,itemId,taskId}]` 来自真实失败集合项，旧回执必须保持失败且没有产物。新尝试沿原执行族使用独立幂等标识，保留全部旧记录；成功项复用，未授权的失败项不重提。与 planningRevision/mediaAdoptions/nodeId/模型或配置切换互斥。

可用 endpoint：
- `agentApiVideoSubmit` -> `POST /public/agent-api/video-jobs`（异步提交需求与显式图片/视频输入；CLI 使用 `tapcanvas agent-api submit`）
- `agentApiVideoStatus` -> `GET /public/agent-api/video-jobs/:jobId`（只读轮询持久 job；CLI 使用 `tapcanvas agent-api status/wait`）
- `chat` -> `POST /public/agents/chat`
- `openAiChat` -> `POST /public/v1/chat/completions`（OpenAI 兼容宿主画布 facade；脚本只输出 SSE 时延、计数与脱敏 flow patch 摘要）
- `llmChat` -> `POST /agents/llm/v1/chat/completions`（已存在的用户鉴权 LLM 代理；用于明确授权的协议诊断与离线 Agent 评估。必须显式传真实模型和 messages；不创建画布任务，不替代一键成片编排，不自动执行响应中的工具调用。请求按正常推理计费。）
- `chatStatus` -> `POST /public/agents/chat/status`（只读 durable 回合状态）
- `chatResume` -> `POST /public/agents/chat/resume`（仅凭同一次权威 status 的 `sessionKey + turnId` 原子认领服务端已持久化的物理预算 continuation；同时支持正常 physical-budget suspension，以及进程退出/传输断开后 inactive `unknown/failed` checkpoint，不接受 prompt、runId 或 cursor，不创建新业务 run）
- `chatInterrupt` -> `POST /public/agents/chat/interrupt`（只接受同一次 `chatStatus` 返回的精确 `sessionKey + turnId`；`cancellationScope=physical_only` 只关闭 transport/runtime/continuation，`cancellationScope=logical_task` 还会沿本轮持久归属取消仍在运行的工作流及其 Agent 节点；供应商已受理的媒体与已生成资产继续保留）
- `draw` -> `POST /public/draw`
- `vision` -> `POST /public/vision`
- `video` -> `POST /public/video`
- `taskResult` -> `POST /public/tasks/result`
- `models` -> `GET /public/v1/models`（只读当前动态启用的文本模型目录；用于显式选择 agents/chat 模型，禁止硬编码候选或把禁用模型当回退来源）
- `modelCatalogModels` -> `GET /model-catalog/models`（受保护，只读系统模型目录；通过 `--vendorKey`、`--kind`、`--enabled` 传递当前后端支持的筛选参数，用于按真实目录选择图片/视频模型）
- `newApiModels` -> `GET /new-api-models`（受保护，只读当前 New API 生成模型目录；支持 `--kind text|image|video|audio`、`--enabled true|false`、`--refresh true|false`、`--selectable true|false`、`--include_action_models true|false`；不传 payload。`refresh=true` 请求目录刷新，`selectable=true` 仅返回可选模型，`include_action_models=true` 显式包含动作专用模型。空的 `/model-catalog/models` 结果不代表本目录为空；不提供修改模型状态能力。）
- `videoUnderstand` -> `POST /agents/llm/v1/video-understand`（视频内容理解）
- `projects` -> `GET /projects`（统一鉴权路由，支持登录令牌或 API Key，只读列出当前凭据属主可见项目）
- `projectCreate` -> `POST /projects`（受保护，只在用户明确授权的新项目或跨环境同步目标中创建项目）
- `projectChapters` -> `GET /projects/:projectId/chapters`（受保护，只读项目权威章节目录）
- `chapterCreate` -> `POST /projects/:projectId/chapters`（受保护，在已授权新目标项目中创建章节）
- `chapterGet` -> `GET /chapters/:id`（受保护，只读章节完整元数据）
- `chapterUpdate` -> `PATCH /chapters/:id`（受保护，按公开 `UpdateChapterSchema` 更新目标章节元数据）
- `assetCreate` -> `POST /assets`（受保护，将已确认的真实资产元数据登记到指定项目；仅用于跨环境同步，不负责下载、生成或伪造媒体）
- `assetUpdate` -> `PATCH /assets/:id/data`（受保护，跨环境同步建立完整 ID 映射后更新目标资产内部引用）
- `publishedAssets` -> `GET /assets/published`（受保护，只读公开 TV 作品快照，用于发布后验收）
- `capabilityBayProjectAdopt` -> `PUT /agents/capability-bay/projects/:projectId`（受保护，将一个已有且至少含一张合法已保存工作流的普通项目显式纳入工作流项目；只写 `project_kind` 与更新时间，不复制或改写 Flow）
- `capabilityBayGet` -> `GET /agents/capability-bay`（受保护，只读当前用户可见的内置能力、Skills 与已装配工作流能力；可用 `--projectId` 精确筛选工作流项目）
- `capabilityBayInspect` -> `POST /agents/capability-bay/inspect`（受保护，依据 payload `{ "flowId": "<真实 flowId>" }` 对当前已保存 Workflow IR 生成精确的 `sourceVersionId`、`descriptorSha256`、一次性 `inspectionToken` 与冲突报告；不执行装配）
- `capabilityBayWorkflowEquip` -> `PUT /agents/capability-bay/workflows/:flowId`（受保护，只接受同一次 `capabilityBayInspect` 返回的版本、摘要、token 及按冲突报告逐项作出的 `resolutions`，原子创建或更新当前用户的工作流能力附件；禁止猜测或复用旧检查结果）
- `capabilityBayWorkflowUnequip` -> `DELETE /agents/capability-bay/workflows/:flowId`（受保护，只移除当前用户对该工作流能力的附件；不删除工作流、版本、执行历史或产物。仅在用户明确要求停用该路径后调用）
- `books` -> `GET /assets/books?projectId=:projectId`（受保护，只读当前登录用户在指定项目下的书籍索引摘要）
- `bookIndex` -> `GET /assets/books/:bookId/index?projectId=:projectId`（受保护，只读完整书籍索引）
- `bookChapter` -> `GET /assets/books/:bookId/chapter?projectId=:projectId&chapter=:chapter`（受保护，只读单章原文与结构化元数据）
- `bookIngest` -> `POST /assets/books/ingest`（受保护，将明确来源的完整书籍正文导入已授权目标项目）
- `bookUploadStart` / `bookUploadAppend` / `bookUploadFinish` / `bookUploadJob` -> `/assets/books/upload/*`（受保护，使用 2MB 内分块上传并轮询持久任务；用于整本导入连接无法可靠保持时）
- `projectSessions` -> `POST /memory/project-sessions`（受保护，只读指定项目/画布/章节作用域的真实会话清单）
- `memoryContext` -> `POST /memory/context`（受保护，只读指定 `sessionKey` 的最近真实对话与分层记忆上下文）
- `memoryWrite` -> `POST /memory/write`（受保护，用户明确授权保存偏好后追加记忆）
- `memorySearch` -> `POST /memory/search`（受保护，只读核对已保存记忆）

长期偏好：先 `memoryContext`（payload 可为 `{}`）核对当前用户作用域，再 `memorySearch` 查重；用户明确要求记录后 `memoryWrite` 传 `{entries:[{scopeType:"user",scopeId:<当前用户的真实 id>,memoryType:"preference",title,summaryText,content:{...},sourceKind:"user_input",sourceId?,importance,tags}]}`。参数来自 `memory.schemas.ts` 的 `MemoryWriteRequestSchema`，追加新条目而非覆盖历史。`memorySearch` payload 支持 `{query?,scopes:[{scopeType,scopeId}],memoryTypes:["preference"],status:"active",limit}`；回读精确返回 id 与内容后方可声明保存。用户级偏好供 agents 按真实上下文选择，不能转为本地语义路由或默认生成参数。
- `flows` -> `GET /public/projects/:projectId/flows`
- `flowGet` -> `GET /public/flows/:id`
- `flowVersions` -> `GET /flows/:id/versions`（受保护，只读列出当前用户有权访问的不可变工作流版本）
- `flowRollback` -> `POST /flows/:id/rollback`（受保护，高风险写入；按精确 `versionId` 恢复完整节点与连线并追加新版本，不覆盖历史）
- `chapterCanvasMembership` -> `GET /chapters/:id/canvas-membership`（Admin 只读诊断，传 `--chapterId`；仍验证章节归属，只返回节点/执行/任务 ID、可见性、明确删除/执行脱离/保留事实和媒体哈希，不返回媒体 URL 或内容，不恢复节点）
- `chapterFlowGet` -> `GET /chapters/:id/canvas-flow`（受保护章节画布，只读真实 `chapters.canvas_flow`）
- `chapterFlowPut` -> `PUT /chapters/:id/canvas-flow`（受保护章节画布，必须携带本次回读的 `expectedRevision`）
- `communityPublish` -> `PATCH /community/projects/:projectId/publish`（受保护，公开或取消公开源项目创作过程）
- `communityProjectGet` -> `GET /community/projects/:projectId`（受保护，只读社区公开项目详情与互动计数）
- `agentDiagnostics` -> `GET /admin/agents/diagnostics`（受保护，只读当前用户可见的 Agent 聚合诊断）
- `agentDiagnosticEvents` -> `GET /admin/agents/diagnostics/executions/:traceId/events`（受保护，按精确 traceId 分页只读 append-only 执行事件；使用 `--afterSeq/--beforeSeq/--limit`，不得依据聚合摘要猜 reviewer 失败原因）
- `flowPatch` -> `POST /public/flows/:id/patch`
  用户明确撤销误删时可传 `{ "restoredNodeIds": ["<原节点 ID>"] }`：只从服务端最新保留记录恢复可见性，不提交旧节点数据、不覆盖媒体结果；owner 权限和 fresh-read revision 仍校验。节点已不存在时返回 `canvas_restore_node_missing`，禁止伪造节点或重提生成。恢复后用 flowGet 回读，并由 SSE 的 restoredNodeIds 清除客户端同 ID 删除标记。
- `flowScopeRepair` -> `POST /public/projects/:projectId/flows/:id/scope/repair`（仅修复归属缺失的项目根画布；高风险写入，必须先获得用户明确授权并满足下述精确前置条件）
- `executions` -> `GET /executions?flowId=:flowId&limit=:limit`（只读列出当前用户在真实 flow 下的持久工作流执行）
- `executionRun` -> `POST /executions/run`（Admin 专用；从显式 trigger 节点启动持久工作流，payload 必须服从公开 `RunFlowExecutionRequestSchema`）
- `executionGet` -> `GET /executions/:executionId`（只读一个持久执行的权威状态、版本与错误）
- `executionCancel` -> `POST /executions/:executionId/cancel`（Admin 专用；按精确 execution identity 幂等中断，保留已完成产物与历史，停止尚未完成节点和后续调度）
- `executionNodeRuns` -> `GET /executions/:executionId/node-runs`（只读该执行的逐节点输入、输出、证据、逐项历史、耗时与错误）
- `executionAttempts` -> `GET /executions/:executionId/attempts?cursor=:cursor&limit=:limit`（分页只读该物理执行的 append-only 节点尝试账本，包含冻结语义、恢复/重试触发原因、provider receipt、错误与时间；必须沿 `nextCursor` 读到 `null` 才代表证据页完整）
- `executionFamily` -> `GET /executions/:executionId/family?cursor=:cursor&limit=:limit`（分页只读该逻辑执行家族的根执行与 resume/rerun 后代；同时返回最新执行状态、活跃执行、执行总数、成功执行数和节点尝试总数，不替 agents 裁决用户级逻辑终态；逐次尝试需再按每个物理 execution 调 `executionAttempts`）
- `executionContext` -> `GET /executions/:executionId/context`（只读该次运行冻结的 ProjectContext 与可见资产快照；另返回 mediaUnderstanding.evidence/diagnostics 和 frozen 标记，frozen=false 只表示启动前成功回执现在可供恢复读取，不能宣称旧 Agent 已消费；不改写原执行）
- `executionSnapshot` -> `GET /executions/:executionId/snapshot`（只读该次运行的不可变 Workflow IR 快照；用于核验冻结控制合同、节点与连线，不得据此回写或覆盖画布）
- `executionMetrics` -> `GET /executions/metrics?flowId=:flowId`（只读成功率、节点失败率、恢复成功率及版本/节点/工具/模型/项目资产使用拆分）
- `executionResume` -> `POST /executions/:executionId/resume`（统一的同家族续跑入口。普通失败恢复传空对象 `{}`，仅 Admin 可调用；若最新成员已取消且用户明确撤销该取消并要求继续同一任务，则传 `{"cancellationRevoked":true}`，只能恢复精确最新 canceled 成员；若 Agent 节点已以 `provider_balance_required` 持久暂停，且用户明确确认同一供应商余额已经恢复，则传 `{"providerBalanceRestored":true}`，该事实型恢复信号允许执行 owner 调用，并保持冻结的 Agent 模型与 API style 不变；若用户明确选择了新的 Agent 模型，则传 `{"agentModelCutover":{"targetModelKey":"<精确模型键>","apiStyle":"chat|responses"}}`。三种事实型恢复模式互斥。检查点被后续失败/取消成员盖过时，只有服务端逐成员证明后续全部是 replay/pin、无副作用执行或未物化外部能力，才允许回到该精确余额检查点；任何未对账 Agent mutation、供应商提交、子工作流、拼接或未知执行都会保持 stale-source 冲突。服务端先围栏旧 Agent turn 与旧物理执行，再复用成功祖先、checkpoint、资产和供应商收据，在原 `executionFamilyId` 内幂等创建恢复成员。禁止根据等待时长或错误文案推断余额已恢复或取消已撤销，禁止把它当自动模型降级。）
- 工作流恢复统一依据 owner 权限、最新 execution family 状态、旧 Agent 的停止回执、冻结 DAG 与逐节点输出/副作用证据。workflowExecutionRecoveryPolicy 及 fresh_only 已退役，不再是恢复或启动的授权来源；历史冻结字段只作审计保留。恢复必须复用成功输出和原根任务时间，不得新开 family 重跑已受理/成功的媒体。
- `executionResume.definitionCutover` -> 用户已明确授权把已经持久化的工作流配置修复应用到同一失败任务时，传 `{"definitionCutover":{"mode":"current_flow"}}`。服务端只在节点集、边、句柄、executor、executionMode 与端口合同完全不变时采用当前节点配置；原 invocation facts、source snapshots、成功资产和供应商收据保持冻结。该模式与余额恢复、取消撤销、模型切换互斥，禁止把普通“继续”推断为配置切换授权。
- `executionResume.planningRevision` -> 修复同一失败任务中的 Agent 计划，传 `{"planningRevision":{"nodeId":"<精确作者节点>","instruction":"<依据已确认错误的修订要求>","refreshAssetIds":[]}}`。追加新恢复成员，沿原图重新执行受影响的无副作用下游；如果受影响后代已有媒体受理、产物或未知外部副作用则拒绝修订，保留全部旧回执。独立分支成功资产复用。非空 refreshAssetIds 只能指定原冻结可见目录中的真实资产，不猜测身份。该模式与其它恢复模式互斥，不创建新执行家族、不重置验收计时。
- `executionNodeHistory` -> `GET /executions/node-history?flowId=:flowId&nodeId=:nodeId&limit=:limit`（Admin 专用；只读一个画布节点跨执行的历史产出）
- `toolExecute` -> `POST /public/agents/tools/execute`（查询当前授权工具目录/动态 schema，或调用已注册的 TapCanvas agent 工具；payload 必须包含 `toolName`、真实 scope 与结构化 `args`）
- `taskLogs` -> `GET /tasks/logs`（只读查询当前认证用户的真实 vendor task request/response 日志；用 `--taskId` 精确核验某个节点任务实际提交的模型输入）
- `taskReceiptInspect` -> `POST /tasks/receipt-inspect`（仅管理员，只读；payload `{ "requestId": "<网关真实请求 ID>" }`。通过受保护的网关内部接口返回迟到受理任务的稳定 ID、状态与原始 prompt SHA-256，不返回媒体 URL。不按名称或文本相似度绑定，不提交、重试或修改任何任务。零回执只表示尚未查到，不能证明未受理。）
- `mediaRecoveryTick` -> `POST /internal/media-recovery/run`（只对账已被供应商受理的媒体任务并保护真实资产，不启动、恢复或推进创作工作流。必须通过同目录 `scripts/internal-media-recovery-tick.mjs` 在 API 容器内执行并使用容器已有 `INTERNAL_WORKER_TOKEN`，禁止从容器导出 token）

规则：`chat/openAiChat/chatStatus/chatResume/chatInterrupt/draw/vision/video/taskResult/videoUnderstand/capabilityBayProjectAdopt/capabilityBayInspect/capabilityBayWorkflowEquip/projectSessions/memoryContext/flowRollback/flowPatch/flowScopeRepair/toolExecute` 必须传 `payload`；`capabilityBayProjectAdopt` 必须先用 `projects` 与 `flows` 验证真实项目/工作流归属、获得用户明确授权，再用 `--projectId` 与精确 payload `{ "projectKind": "ai_workflow" }` 提交；`capabilityBayInspect` 必须传当前授权目标的精确 `{ "flowId": "<id>" }`，随后 `capabilityBayWorkflowEquip` 必须用同一次检查返回的 `sourceVersionId + descriptorSha256 + inspectionToken`，并将报告中每个需要确认的冲突逐项映射为合法 `resolutions`；版本、摘要、token、冲突身份或附件状态任一漂移时原地失败并重新检查，禁止沿用旧值。`flowRollback` 的 payload 必须且只能依据本次 `flowVersions` 返回的真实版本身份提交 `{ "versionId": "<id>" }`，执行前必须获得用户对目标 flow 的明确覆盖授权；恢复后必须再用 `flowGet` 核对节点与连线事实。`chatStatus` 只读查询 agents-cli 持久回合 checkpoint，payload 必须带精确 `sessionKey`，禁止据浏览器内存猜测运行态；`chatResume` payload 必须只有同一次 `chatStatus` 返回的精确 `sessionKey + turnId`。服务端只认领属于当前用户的 `physical_budget` continuation：正常 suspended 状态认领 waiting receipt；进程退出或传输断开留下 inactive `unknown/failed` checkpoint 时，只重领仍在上限内且带失败证据的同一 root physical receipt。普通自然语言 `chat` 绝不作为续跑替代；`models/modelCatalogModels/newApiModels/taskLogs/flowVersions/capabilityBayGet` 不传 payload，`modelCatalogModels` 只接受当前后端 schema 已有的 `vendorKey/kind/enabled` 查询参数，`taskLogs` 只接受当前后端 schema 已有的 `page/pageSize/taskId/vendor/status/taskKind/createdFrom/createdTo` 查询参数；官方 CLI 配置中的用户 API Key 对 `projects/modelCatalogModels/projectSessions/memoryContext/taskLogs/books/flowVersions/flowRollback/chapterFlowGet` 与其它受保护用户路由均代表同一完整用户身份，`authToken` 仅是可选的浏览器会话凭据；`capabilityBayProjectAdopt/books/flows/capabilityBayGet` 须按需传 `--projectId`；`capabilityBayWorkflowEquip/capabilityBayWorkflowUnequip/flowGet/flowVersions/flowRollback` 须 `--flowId`；`chapterFlowGet` 须 `--chapterId`；`flowPatch` 须 `--flowId`+`payload`；`flowScopeRepair` 须同时提供 `--projectId`、`--flowId` 与精确前置条件 payload。`toolExecute` 必须携带真实画布作用域：项目根画布传 `canvasProjectId + canvasFlowId`；章节画布传 `canvasProjectId + chapterId`，由服务端路由到 `chapters.canvas_flow`，不得伪造或补传项目根 flowId。不得调用未注册或没有真实实现的工具。
`executionRun` 与 `executionResume` 必须显式传 payload；`executionResume` 的普通失败恢复也必须传 `{}`，不得依赖空请求体或默认模型。`executionCancel` 不接收 payload，必须用 `--executionId` 精确指定目标；只读 `executions/executionGet/executionNodeRuns/executionAttempts/executionFamily/executionContext/executionSnapshot/executionMetrics/executionNodeHistory` 禁止携带 payload，分别用 `--flowId`、`--executionId`、`--nodeId` 指定精确事实作用域。诊断恢复链时优先读 `executionFamily` 并沿 `nextCursor` 读取所需执行页，不得把单个物理 execution 的终态直接当作整个逻辑任务终态；需要检查一次物理执行内的逐次输入/输出与收据时读 `executionAttempts` 并沿其 `nextCursor` 读取完整证据。

终端 CLI 对 `executions / executionRun / executionGet / executionCancel / executionResume` 只投影紧凑执行状态，固定移除 `projectContext / assetSnapshot / userInput`，避免把服务端重上下文写入模型可见输出。需要核验冻结上下文时必须显式调用 `executionContext`；需要核验不可变 Workflow IR 与控制合同时调用 `executionSnapshot`；需要节点或恢复证据时使用对应的分页/有界诊断 endpoint。该投影只改变读取面，不删除服务端持久事实。

在小 T / agents bridge 内不走终端 endpoint，而使用同一真实实现的 `tapcanvas_workflow_execution_inspect`：`view="family"` 分页读取恢复执行链与聚合事实，family 成员是紧凑执行投影，不包含 `userInput/projectContext/assetSnapshot`；确需重上下文时再按 execution 调用专用详情接口。`view="attempts"` 分页读取指定物理 execution 的不可变尝试账本。`tapcanvas_workflow_run` 与 `tapcanvas_equipped_workflow_run` 返回 `tapcanvas.workflow-execution-receipt/v1`，其中 `runId/executionId/executionFamilyId/status/acceptedAsync` 与 `inspection` 是后续 continuation 的稳定事实；必须按回执里的 inspection 工具追踪，禁止把 workflow execution id 误传给 pipeline-run 工具。若 family inspection 证明最新 execution 已失败、交付仍未满足且没有活跃 recovery，必须在同一小 T 逻辑任务内调用 `tapcanvas_workflow_resume {"sourceExecutionId":"<latest failed execution id>"}`；它复用管理员 resume 的同一 guard/fence/snapshot/output-reuse 实现，创建同 `executionFamilyId` 的恢复成员。若用户明确授权采用同一工作流已持久化的当前配置修复，则在该恢复调用中传 `"definitionCutover":{"mode":"current_flow"}`；未经授权仍只传普通恢复参数。若最新成员是 canceled，只有用户明确说明误取消或明确撤销取消并要求继续同一任务时，才调用 `tapcanvas_workflow_resume {"sourceExecutionId":"<latest canceled execution id>","cancellationRevoked":true}`；禁止把普通“继续”或后台恢复需求猜成撤销取消。若 family 的唯一活跃 execution 以 `provider_balance_required` 暂停，用户明确确认同一供应商余额已经恢复时，调用 `tapcanvas_workflow_resume {"sourceExecutionId":"<该活跃 execution id>","providerBalanceRestored":true}`，保持冻结模型与 API style 不变；用户明确选择当前父 Agent 的实际模型时，才可改用 `tapcanvas_workflow_resume {"sourceExecutionId":"<该活跃 execution id>","agentModelCutover":{"targetModelKey":"<当前父 Agent 实际模型>","apiStyle":"<当前父 Agent 实际 apiStyle>"}}`，工具会校验目标必须等于调用者真实模型并记录迁移账本。四种恢复模式互斥；禁止根据错误文案、等待时长或探测请求推断余额恢复或取消撤销，禁止静默切模。禁止用新的 `tapcanvas_workflow_run` 或新的 idempotency key 建立替代执行家族；若 family 已有其他 queued/running recovery，则继续 inspection，不重复调用恢复。
上述恢复规则对所有工作流使用同一条证据与幂等路径；不可用、未知受理、权限不足或旧 Agent 未停止等具体动作边界必须如实处理，不得盲目重投或切换模型。
`chatInterrupt` 与 `chatResume` 一样，payload 必须逐字复用同一次权威 `chatStatus` 返回的 `sessionKey + turnId`；禁止只按 session 猜测或中断已经变化的回合。用户显式要求停止当前任务时必须额外传 `cancellationScope: "logical_task"`；会话切换、HMR 或仅清理物理传输时传 `cancellationScope: "physical_only"`（省略时服务端也只按 physical-only 处理）。
`tapcanvas_flow_patch` 的 `productionLayer/creationStage/approvalStatus` 是下游生产门禁会消费的执行证据，不是可丢弃提示。必须使用动态 schema 暴露的合法枚举；非法值会使整次 patch 显式失败，禁止剥离字段后继续创建节点。空间站位证据使用 `blocking_diagram/spatial_blocking`，单格 beat 关键帧使用 `keyframe/beat_keyframe`。
`tapcanvas_flow_patch` 成功回执只返回 patch 统计，以及新建节点/边的标识型 descriptor；不会再回显完整 flow、长 prompt 或媒体存储 URL。后续精读节点必须显式调用 `tapcanvas_flow_get`：单节点可读完整脱敏 data；批量 nodeIds 默认只返回受控执行事实字段，若确实需要 prompt/镜头表等语义字段，必须显式传 `fields:[...]`，避免一批长文本把 post-tool continuation 卡在模型侧。
章节会话中的全部 flow-scoped 工具统一读取 `chapters.canvas_flow`。这包括通过 `nodeId` 取媒体的 `tapcanvas_analyze_image` / `tapcanvas_analyze_video` 等只读工具；不得改读项目根 flow，也不得因节点在章节画布中而要求 agent 复制 URL、复制节点或绕过本 skill。
`/public/*` 没有“列出当前用户全部 projects / flows”的 discovery endpoint；当前用户项目列表需走受保护的 `GET /projects`。

### flowScopeRepair（项目根画布归属修复）

该 endpoint 只用于已确认的 `__tapcanvasFlowOwner` 缺失/同项目部分缺失事故，不能作为正常保存路径或自动兜底。执行前必须先获得用户对目标 flow 的明确写入授权，并依次用 `flows` 与 `flowGet` 读取真实 `projectId`、`flowId`、`updatedAt`、`nodes.length`、`edges.length`。payload 必须逐项来自本次读取：

```json
{
  "expectedUpdatedAt": "2026-08-01T00:00:00.000Z",
  "expectedNodeCount": 9,
  "expectedEdgeCount": 4
}
```

服务端会同时校验 flow 仍属于路径中的 `projectId`、更新时间未变化、节点/边数量未变化、现有 owner scope 不冲突，再只补写 `{ownerType:"project", ownerId:projectId}` 并追加版本记录。任一条件不匹配必须 409 原地失败；已存在完整归属也必须失败。禁止重试时更新猜测值，必须重新 `flowGet` 核验并再次判断是否仍获授权。该操作不删除、不移动、不改写任何节点或边。

Workflow execution 的后台 worker 负责异常断连后的节点租约回收、供应商任务对账与已生成资产保护。正常 `tapcanvas_equipped_workflow_run` 只负责原子受理并返回稳定 `acceptedAsync + executionId/runId` receipt；受理回执声明 completionBoundary="submission" 与 executionOwner="durable_executor"；对话结束交接，不为工作流注册 chat continuation，后续状态由工作流事件呈现。恢复必须针对同一 execution family 使用 `tapcanvas_workflow_resume`，禁止循环调用、禁止新建替代 family。

个人中心安装的外部 CLI 不携带 `internal-media-recovery-tick.mjs`，也不暴露 `mediaRecoveryTick` 命令；离开 API 运维仓库和容器环境时必须显式失败，不得用普通 API 调用替代。

## 请求参数

各 endpoint 的完整参数以当前后端请求 schema 为准；此处不再重抄模板（2026-07-10 瘦身）。agents-cli 会话内部必须用 `tapcanvas_get_tool_schema` 查询被延迟加载的远程业务工具 schema，再用 `tapcanvas_call_tool` 调该业务工具；二者都不是 `/public/agents/tools/execute` 的注册业务工具，禁止通过 `toolExecute` 套娃调用。终端环境直接使用本 skill 的 `toolExecute` endpoint 时，必须先依据当前仓库 `apps/hono-api/src/modules/task/task.agents-bridge.ts` 中对应工具的真实注册 schema 组装 `args`。

schema 不承载的行为要点：
- 会话历史只读：先用 `projectSessions` 传 `{projectId, flowId?, chapterId?, limit?}` 获取当前登录用户真实可见的 `sessionKey`；再用 `memoryContext` 传 `{sessionKey, recentConversationLimit, limitPerScope}` 读取该会话。禁止猜测 sessionKey，禁止把 `promptText` 当作原始对话；验收泄露问题时只依据 `context.recentConversation[]` 的真实 `role/content/createdAt`。
- chat 画布执行模式：必须同时传 `canvasProjectId`、`canvasFlowId`、`mode:"auto"`、`sessionKey`（建议 `canvas-main:<flowId前8位>`）；结果经 flowPatch 写回；`canvasProjectId` 是数据库 projects 表 ID，非 studio URL 的 query param。
- 配音卡到视频节点的可视化溯源边必须使用确定性合同：`id=e-voice-reference-<sourceNodeId>-<targetNodeId>`、`sourceHandle=out-audio`、`targetHandle=in-any`、`type=typed`、`label=音色`，且 `data={edgeType:"audio",relationKind:"voice_reference",executionRole:"reference_only",label:"音色"}`。写入前必须 fresh-read 目标 flow，逐项核对 source 是 `kind=audio,audioType=voice_card`、target 是视频节点且 `voiceBinding[].nodeId` 真实匹配；只创建获授权的精确边，不给未使用配音卡补边。该边不属于执行依赖，不得改成普通 audio edge 触发 DAG、合成或 dub。
- `plan/drive/reconcile` 都不是完整成片的公开 mode。agents 必须先把当前模型目录与用户规格中已知的 `videoModel / aspect / resolution / targetDurationSeconds` 写入不含 beats 的 `beatSheetHeader`，依次执行 `preflight_begin -> preflight_put_beat -> preflight_commit`。章节作用域由服务端冻结当前章节原文；普通项目/独立 flow 必须先创建或选定当前授权 flow 中一个 `kind=text` 且 `content` 非空的源节点，并在 `preflight_begin` 顶层显式传 `sourceNodeId`。服务端把该节点 ID、逐字文本与指纹冻结为同一 run 的 source authority；后续 get/put/patch/commit/loop 只读这份快照，禁止再传另一个节点、按标签猜节点或因物理续跑切换来源。资产引用变化或结构 warning 需要修订已有节点时，必须先以同一 `runId/draftRevision/clipIndex` 调 `preflight_get_beat` 读取完整当前 beat 与 `beatRevision`，只修正错误路径，再携带 `replaceBeatRevision` 写回。最后以最新 `preflightRevision/preflightFingerprint` 调用 `mode:"loop" + beatSheetRef:"preflight"`。模型唯一合法字段路径是 `args.beatSheetHeader.meta.videoModel`，必须填写当前动态 schema/本轮真实上下文提供的 canonical `modelKey`，禁止放在工具顶层、自然语言说明中，也禁止用展示名或渠道别名替代。`loop` 不再接受内联完整 BeatSheet。服务端只在内部构造 timing plan；每拍显式裁决 `continuityMode` 后执行拓扑才是 `resolved`，禁止默认填 `editorial_cut`。
- `repair_scope` 不是普通创作入口，只用于修复旧版本在当前章节 `collecting`、尚未进入付费生产的 run 丢失作用域事实。调用必须带当前 `chapterId` 与同一 `runId`；服务端会 fresh-read 当前章节画布的持久化 `video-run-status` 节点，逐字核对 `runId / runCreatedAt`，并且只在 `owner_id / flow_id / project_id / chapter_id` 事实满足“当前用户、三个作用域字段全部为空、生产态仍为 collecting、authoringState 属于提交前阶段”时以 CAS 补齐 scope。若已有任何非空或冲突 scope、状态已离开 collecting、投影不一致或 run 不存在，原地失败；修复后复用同一同步 authoring driver，禁止重吐/覆盖 BeatSheet、writer 工件、模型或已产资产，也禁止把该 mode 当作新 run 或付费重试入口。
- `video_generation_model_required` 的确定性含义仅是本次请求的 `beatSheet.meta.videoModel` 为空；它不证明模型未启用、账号无权限或项目配置缺失。该错误发生且 run 尚未创建时，必须留在当前 Todo，修正同一 BeatSheet 的该字段后按同一 `runId` 重提；不得查询不存在的 `models/modelCatalogModels` 远程工具、不得把可推导的字段缺失升级为用户输入。只有服务端返回 `video_model_not_enabled:<key>`、`video_model_runtime_contract_missing:<key>` 或明确权限错误时，才可依据对应事实报告目录/权限问题。
- 整章结构合同只走逐节点草稿图：`preflight_begin` 初始化一次 header 与 `expectedBeatCount`，逐 beat 用同一 `draftRevision` 写入绝对 `clipIndex`，`preflight_commit` 只有在节点齐全时才汇编冻结。相同 begin 幂等返回原 revision；变更 header 必须携带当前 `draftRevision` 作为替换围栏，禁止无围栏重复 begin。每个 beat 的当前内容都有 `beatRevision` 并保留不可变历史：新节点可直接 put；已有节点必须先 get，再用返回的 revision 作为 `replaceBeatRevision` 精确替换，禁止盲写或根据截断历史重构整个节点。每拍必须显式提交 `continuityMode ∈ {editorial_cut,bridge_frames,reference_video}`；Hono 不从 prompt 猜模式。`bridge_frames` 必须绑定真实 `lastFrameImageNodeId`，`reference_video` 仅允许非首镜；agent 不提交执行字段 `chainFromPrev`，也不以根级 `clipChaining` 覆盖逐镜决策。不发送 `commit_beats`、`reuseStoredBeatSheet`、v1 或内联全量 patch；非法合同显式失败。
- 若在 draft 尚未创建时误调用 preflight read/write/commit，服务端返回 `beat_sheet_draft_invalid + recovery.kind=restart_preflight` 与唯一 `allowedNextActions=["preflight_begin"]` 的持久游标；agents 必须在同一逻辑任务、同一 session、同一模型内按该游标重新 begin，不得要求用户重提任务或复用旧 run/revision。Redis/数据库不可用与单 beat 缺失不使用该恢复语义，必须保留精确失败。
- Beat 视觉与对象合同：每拍 `assetObjectContracts` 覆盖角色、妆造、场景、道具、VFX、色卡与构图锚，并逐项提交 `referenceImageNodeIds/referenceAssetIds/referenceRole/forbiddenTransfer`。纯文生视频或用户明确不要生成/绑定参考图时，仅承担提示词事实的对象必须显式使用 `referenceRole="none"`；对象仍进入 writer，但不进入 authoring 生图 DAG。当前章节图片用 node id；同项目跨章节复用必须先由 agents 读取 `tapcanvas_material_assets_list(scope:"project")`，完成语义选择后把返回的完整稳定 ID 原样写入该对象的 `referenceAssetIds`（最多一项）。Hono 不依据名称、别名或 prompt 猜测等价，只校验项目归属、资产类别、真实图片和显式拒绝状态，再确定性投影成当前章节节点。对象身份参考的每个 node/asset id 必须经 `tapcanvas_image_refs_get` 证明 ready；多视图身份包逐张列出。服务端 fresh-read 后解析真实 URL、装入最终参考 manifest，并把职责与禁止迁移维度写入权威媒体映射。`storyboardImageNodeId` 是独立的可选关键帧槽：普通单状态 image 或 2～3 状态故事板 image 均合法；editorial/reference_video 中是参考图片，bridge 中是真实起幅且尾帧也必须验真。若通过 `tapcanvas_image_generate_to_canvas` 先生成 clip 关键帧，节点必须携带同一 `clipRunId`、绝对 `clipIndex`、`storyboardScope="clip"`、`creationStage="beat_keyframe"`（多状态再带 1～3 的 `storyboardFrameCount`）；只允许用同一草稿 revision 重新 `preflight_put_beat` 受影响节点并再次 `preflight_commit`，绝不按 label/prompt/位置/邻边猜归属。空间镜的 blocking/构图合同继续按真实 hash provenance 校验。
- 视频引用预算必须从当前启用模型目录反推：`generationContract.referenceImagePolicy` 冻结模型的 `maxReferenceImages` 与 `unique_url` 计数单位，最终 manifest 中的业务图片与项目 `style` 风格图统一按真实 unique URL 计数，不设置隐藏的风格预留槽，也不允许静默丢弃风格锚；禁止在 agent、Hono 或 skill 中另写固定业务槽上限。实时目录未声明参考图能力时冻结零容量，纯 T2V 合法，任何真实图片引用（包括项目风格图）都按零容量显式失败；目录声称支持却缺上限仍是合同错误。`generationContract.referenceAudioPolicy` 同理：未声明能力冻结 `0~0s` 且不阻断无参考音频任务，真实音频绑定时显式失败。已有 source run 派生新版本前，agents 先形成拟议的 storyboard 与精选资产 operations，再调用 `mode:"reference_budget" + sourceRunId + operations`；服务端在内存中应用该提案，返回新关键帧成本、每个候选 nodeId 展开的真实 unique URL 数、剩余额度与 `budgetRevision`，并把原始 operations 以同一用户/项目/画布/sourceRunId 作用域保存为 opaque proposal。随后 `prepare_beats` 只提交 `sourceRunId + runId + budgetRevision`，禁止再次发送或由模型重写 operations；服务端取回原提案、fresh-read 模型合同和 URL 成本后再应用。JSON Pointer `set` 修改数组时，末段可使用标准 `-` 或等于数组当前 `length` 来表示尾部追加；`remove/removeValue` 不得使用 `-`，任何数字下标都禁止跳过当前 length 制造空洞。`assetObjectContracts[].referenceImageNodeIds` 是完整对象事实，也是唯一 `videoReferenceNodeIds` 的确定性编译输入；authoring 按首次声明顺序合并、去重并冻结，执行器不得忽略或静默裁剪任何已声明对象引用。所有已选业务节点按真实 unique URL 计入供应商上限，不再按 design/master 等来源标签静默剔除。proposal 缺失、越权或预算漂移必须显式失败；禁止拿未带拟议 operations 的源预算 revision 去提交新关键帧，禁止先超配再根据 `clip_reference_budget_exceeded` 数字反复裁剪；若语义必需资产无法容纳，必须在任何新增生成或生产提交前由 agents 决定合成群像/单图资产或拆 clip。
- 独立 `tapcanvas_video_generate_to_canvas` 入口及其底层 vendor adapter 也必须服从所选模型的动态 `maxReferenceImages`。Seedance/Comfly/Sora 的多模态参考图在提交前按最终 unique URL manifest 校验；目录明确零容量或引用超额时显式失败，禁止使用供应商名固定 9 图常量、`.slice(0,8)` 数组截断或模型降级。
- 图片、音频、单节点视频与完整成片的 `accepted_async/running/queued/scheduled` 都不表示资产已经渲染。拿到稳定 `nodeId/taskId/runId` 后必须停止同回合补证，不得轮询、查替代工具或重复提交。后续交付责任由回执的结构化边界决定：画布生图的 `completionBoundary="submission"` 只表示该节点提交已完成、后台继续生成；主代理继续处理其余独立交付，最终核对全量提交回执后结束对话；未携带该边界的音频、视频回执仍由 task/node/SSE 事件和 durable continuation 推进原逻辑任务。工作流启动/恢复回执统一携带 `completionBoundary="submission" + executionOwner="durable_executor"`，当前对话完成交接，后续由工作流独立推进；agent 不手工驱动节点，也不在单个 HTTP 请求里同步等待最终 URL。
- `preflight_commit` 只能创建新 run，或更新同 owner、同作用域且生产态仍为 `collecting` 的 run。已经进入 `scheduled/video_running/video_success` 或 `failed/cancelled/concatenated` 的 run 会显式拒绝，禁止通过重提 BeatSheet 清空 story plan、生产进度或已有视频资产。
- 完整 `preflight_commit` 的 `adaptationStrategy` 是本次 BeatSheet 的原子权威版本。旧版本不做语义 diff、不并集、不回填。策略或 beat 输入变化只使 sourceHash 变化的 clip 重新写作；输入未变且已有 ready 输出的 clip 保持冻结。
- 整章 writer/装配合同：服务端为每个 clip 派一个无工具 writer，一次只收一条绝对镜号一致的 clip；`outputContract` 在唯一模型提交前冻结精确数组长度与按当前资产/时长计算的可编辑字符串预算。writer 必须在这次提交内部完成创作、自检与最终定稿；0 条、2 条、错误镜号、超预算、超时或结构 preflight 失败只写入原始候选、哈希和精确拒因，并按 `single_submission_record_and_fail` 立即结束该 clip。禁止向模型返回错误、局部纠正、候选筛选/合并、整包再生、同 run 重派或把失败投影成 waiting；历史 `repairable/repairAttempt/repairProblems` 只作审计字段，不再取得调度权。ready sibling 原样保留。结构通过后完整 clip 内嵌冻结到对应 `clip:N` artifact；全部 ready 后只按精确 artifact key、绝对 `clipIndex` 与双内容哈希重建权威 clips，不读取旧累加器作为装配或说话人 coverage 输入。验证通过后才精确覆盖下游累加器与 durable `story_plan`，再验真 durable 角色/场景/道具 URL 和说话人 voiceId、fresh estimate、一次 start、逐 clip 生成并拼接。完成必须有各段真实 `videoUrl` 与最终 `concatVideoUrl`。
- `estimate_ready` 是内部瞬时态，driver 必须直接用同一 runId 执行唯一一次 start，不等待用户批准、不重吐 BeatSheet/storyPlan。durable `story_plan.targetDurationSeconds` 来自冻结 BeatSheet 时长求和；历史 run 缺该字段时，服务端只能从全部冻结 clip 的真实时长精确恢复。缺任一 clip 时长即显式失败，禁止默认镜长。
- `mode:"status"` 是只读查询：查询合同成功后恒为 `ok:true`。run 尚未创建时返回 `exists:false / terminal:false / success:false / lifecycleOutcome:"absent" / code:"video_run_not_found"`，首次整章生产应继续完成 `preflight_begin -> preflight_put_beat -> preflight_commit -> loop`；已有 run 自身失败则用 `terminal:true / success:false / lifecycleOutcome:"failed" / runFailure:true / errorMessage` 表达。只有缺少必填参数、存储不可达等查询执行失败才是 `ok:false`，禁止把资源不存在或资源失败误判成工具调用失败而截断用户明确授权的后续动作。
- `mode:"resume_pre_submit"` 不是第二次 start：它只恢复已 `authoring_done` 且失败于上游任务创建前的同一 run。服务端逐失败节点验真无 taskId、无真实视频 URL、无上游提交不确定证据后，才重置失败槽并以 CAS 恢复为 `scheduled`，返回同一 run 的异步 receipt，由 worker 继续推进；不改 runId、BeatSheet、story plan、clipsDone 或已产资产。旧代码误写的 `upstream_uncertain` 只能由服务端用冻结 clipPrompt 与 vendor request 的源前缀投影精确相等、synthetic failed id 且无 task result/ref/ledger 的完整事实链纠正。允许的结构化 rejection 只有套餐并发 `status=429 + code=membership_concurrency_limit_reached`，或 Seedance 非法媒体混用：请求 manifest 含 `first_frame/last_frame`，并同时含普通 `reference_image/reference_audio` 或真实 `upstreamVideoUrl`，响应逐层命中 `400 / newapi:newapi_request_failed / upstreamStatus=400 / fail_to_fetch_task / InvalidParameter(param=content,type=BadRequest)`；禁止匹配错误文案。取证从 run 的稳定 `created_at` 开始，并与 `updated_at/last_drive_at` 一起取最早值，防止后续 claim 隐藏此前日志；同一冻结 prompt 与首帧存在多次失败时只评估最新一次精确候选，较早的可恢复证据不得在后续不同失败后重复放行。历史 vendor 日志因统一上限只保留长 prompt 前 1800 字时，必须逐字命中全部保留字符并核对序列化器声明的原始长度，禁止相似度或任意短前缀匹配。证据不足必须显式失败并读取 `evidenceDiagnostics` 中逐节点、逐候选日志的结构化 mismatch reason；诊断不含完整 prompt，且不得据此降低事实门禁。禁止用于审核拒绝或可能已创建上游任务的失败。
- videoUnderstand：仅用于调试底层 HTTP 协议，必须显式传 payload；不用于正式画布视频诊断。正式视频理解走 `tapcanvas_analyze_video`，固定 `doubao-seed-2-0-lite-260428`，返回带 `videoUrl/model/fps/promptHash/analysisHash/segmentCount/analyzedAt` 的可核验证据。
- 书级画风修正：通过 `toolExecute` 调 `tapcanvas_book_style_confirm`，传真实 `canvasProjectId`、`bookId` 与结构化 `styleName / visualDirectives / negativeDirectives / consistencyRules / referenceImageNodeIds / referenceAssetIds`。它受用户/项目作用域保护，服务端解析 ID 后写入现有 Style Bible 真源。Style Bible 不保存角色生成模板；角色卡统一走 `tapcanvas-character-card`。禁止绕过本 skill 直接改 `index.json`。
- 项目视觉圣经：用 `tapcanvas_project_look_bible_get` 读取当前激活版本；用户从「项目视觉圣经」入口明确授权追加或更新第一方文字后，保留未覆盖的开放 `sections`，先通过 `tapcanvas_flow_patch` 新建 `kind=text / productionLayer=anchors / semanticKind=projectLookBible` 候选节点，再调用 `tapcanvas_project_look_bible_confirm({sourceNodeId,lookBible})`。确认工具 fresh-read 节点、保存不可变项目资产版本并标记节点 approved；不得把聊天正文、候选节点或旧 `styleLock.stylePrompt` 冒充已应用。Project Look Bible 的文字投影进入视频；项目画风锚图片由服务端作为独立 `style` 职责同步注入图片与视频。它不能被当作人物/场景/道具内容参考，是否占用供应商视频参考图容量必须按当前模型合同确定性计算，不能由 Agent 静默删除或硬编码预留/截断。
- 道具状态图：通过 `toolExecute` 调 `tapcanvas_image_generate_to_canvas` 时，`node.data` 必须带 `referenceType:"prop"` 与 `materialIdentity`。基态为 `{mode:"base",canonicalName}`；状态态为 `{mode:"state",canonicalName,canonicalAssetId,stateKey,stateDescription}`。服务端会核对 canonicalAssetId 属于当前项目且名称一致，并在付费边界内部注入最新无状态版本；无法解析真实基态资产时显式失败，agent 不接收其 URL。
- 图片生产元数据分支：工具 schema 根据当前请求中真实 `chapterId` 作用域确定性装配。普通项目画布生图根本不暴露 `node.data.productionMetadata`，调用时必须完全省略该字段，禁止发送 `chapterGrounded:false` 或 `authorityBaseFrame.status:"not_required"` 来表达“非章节”。章节内的正式生产图片要求完整 `productionMetadata`，其中 `chapterGrounded` 必须逐字为 `true`，`authorityBaseFrame.status` 只能逐字为 `planned` 或 `confirmed`。本章剧情预览不属于这个通用生图分支：必须只调用 `tapcanvas_story_preview_orchestrate`，先 `mode=begin/status` 读取持久 frontier，再执行唯一开放的 `put_board_N`；`tapcanvas_image_generate_to_canvas` 不暴露也不接受 `previewBoard`，禁止手写 preview 节点或元数据。专用动态 schema 给出精确格数、`sourceExcerpt` 与冻结 `referenceOptions`；每格提交 `frame/mid/end/camera/feedback/environment/subjectRefIds`，其中 `subjectRefIds` 只能从可选 ID 中精确选择本格真实可见引用。服务端按 `previewWindow + frameIntervalSeconds` 推导时间格、分页和时码，并展开 `assetUsage="preview_only" / assetPurpose="story_preview" / productionEligible=false / productionLayer="preview" / creationStage="story_preview" / previewSeries* / sourceChapterRevision / sourceHash` 等持久字段；它只验证时间、ID 与来源版本，不从正文猜人物或补默认引用。preview 可由 `tapcanvas_image_refs_get` / `tapcanvas_analyze_image` 只读查看，但图片、视频、BeatSheet 和 Workflow 资产解析器都会拒绝把它作为生产引用；正式出片必须重新生成 production 设计板。
- 素材版本登记：只允许通过 `toolExecute` 调 `tapcanvas_material_asset_version_create`，传精确 `assetId`、逐字 `expectedName` 与当前授权画布的 `sourceNodeId`。省略 `stateKey/stateDescription` 表示追加当前 canonical 基态；两者同时提供表示追加状态版本。服务端会解析该节点的真实图片、重新核对当前项目资产，只追加新版本，绝不覆盖历史，也不向主模型返回 URL。
- 错误素材清理：只允许通过 `toolExecute` 调 `tapcanvas_material_asset_delete`，同时传精确 `assetId` 与 `expectedName`。服务端会重新列举当前项目素材并逐字核对名称后只删除该一项；禁止绕过本 skill 直接删数据库记录。

**Flow ID 发现路径**（studio URL 的 projectId 未必等于数据库 project.id）：
1. 用 `flows` endpoint 查 `GET /public/projects/:projectId/flows`
2. 若返回空，查数据库：`SELECT id, project_id FROM flows WHERE name LIKE '%关键词%' ORDER BY updated_at DESC`
3. 得到真实 flowId 后用 `flowGet` 验证内容
4. 同时拿 `project_id` 字段作为 `canvasProjectId`

## sseSubscribe（画布实时订阅）

订阅 `GET /public/flows/:id/events`，实时感知画布节点/边变更（创作后监听结果回写、感知用户操作触发的节点状态变化、代替轮询 `flowGet`）。

命令：`tapcanvas events subscribe --profile <local|production> --flow-id <flowId> [--wait-for flow_updated --timeout 300]`；项目/章节权威画布事件分别使用 `--project-id <projectId>` 或 `--chapter-id <chapterId>`，例如 `--profile production --project-id <id> --wait-for run-status-snapshot --timeout 30`。诊断持久工作流时使用 `--execution-id <executionId> [--after <seq>]` 读取受 owner 保护的 `GET /executions/:id/events`，它先回放 `seq > after` 的 DB 事件再持续追尾；不得据终端聚合状态猜取消、恢复或失败顺序。四个作用域参数必须且只能提供一个。默认打印所有事件，Ctrl+C 退出；带 `--wait-for/--timeout` 等到指定 event 后自动退出。

每行输出：`{"event":"<event_name>","data":{...}}`。事件类型：`conn-id`=建连分配的连接 ID；`subscribed`=确认订阅，含 `{flowId, channelId}`；`message`=画布 SyncPatch，含 `upsertNodes/removeNodeIds/upsertEdges/removeEdgeIds`，章节画布的服务端持久化写入还会附带写入后的 `revision`；`keepalive`=心跳（每 20s）。

**flowPatch → SSE 链路**：调用 `flowPatch` 后，服务端自动广播 SyncPatch 到项目 SSE 频道，浏览器画布实时更新，subscribe.mjs 同步收到事件。

## 画布数据验证前提

读真实画布数据：全部项目用 `projects`；已知 `projectId` 先 `flows`；已知 `flowId` 直接 `flowGet`；已知章节行 ID 时直接用 `chapterFlowGet` 读取该章 `canvas_flow`。若既无 `authToken` 又无可验证的 `projectId`/`flowId`/`chapterId`，直接说明无法发现当前用户项目，禁止猜测、扫描本地状态或绕过本 skill。

## 失败策略

缺少配置或 payload 非法：直接失败；网络错误：直接报具体 URL 和系统错误；后端 4xx/5xx：保留原始响应摘要并失败。禁止自动切换到旧 skill、旧 endpoint 或匿名模式。

启动断连恢复：若执行尚未 started 且不存在任何节点运行，普通 executionResume 会在 owner/执行族校验与条件更新后重新投递原 execution ID，不创建新成员。新启动遇到网络异常或 408/429/5xx 时保持 queued，由后台自动补发；不得把 queued 说成视频已生成。确定性调度拒绝仍显式失败。
