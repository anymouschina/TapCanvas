# TapCanvas Pro 功能同步 TODO

核对日期：2026-10-25。初轮来源为同级 `TapCanvas-pro` 工作区，HEAD `fb391726d23cf3c7a3ac85a5a46aec35f7079943`；目标 TapCanvas HEAD `6274546e6c38473b3a5596178f1904c6680bc003`。2026-10-26 按用户选择实施 F04、F06、F09，随后同步 F13 应用内更新日志（来源与范围见独立交付记录），其他项仍待选。未部署或提交真实生成任务。

## 本轮筛选范围

按用户要求，只列不涉及 TapCanvas Pro Agent 内核能力的功能：界面、确定性数据处理、媒体服务及独立公开接口。保留社区版现有 DSH Harness；不迁入 Pro 的 Agent loop、记忆、子代理、任务编排、Workflow IR 执行器或交付校验器。

下表的规模是源码审查估计，不是工期承诺；“可选”不表示可以整文件覆盖。需要沿用社区版接口、设计系统和鉴权，具体同步范围在选定后实施。

## 可选清单

| 编号 | 待同步功能 | 社区版现状与实际增量 | 规模 |
| --- | --- | --- | --- |
| F01 | [ ] 剪辑转场与片段控制 | 已有裁剪、分割、删除；补交叉淡化/溶解/淡黑/淡白、交叠时长、片段重排、独立音量和完整时间线撤销 | 大 |
| F02 | [ ] 字幕时间线与样式 | 已有基础识别和字幕编辑；补独立字幕轨、时间调整、字体/颜色/描边/位置/背景，以及预览和导出一致性 | 大 |
| F03 | [ ] 首页统一创作输入框 | 首页目前为简单输入与技能选择；补图片/文本附件、素材 @ 引用、画布引用及模型偏好交互，沿用现有聊天提交链 | 中大 |
| F04 | [x] 保材质的手动去噪/增强 | 已有去噪按钮；修正“8K 增强”强加 C4D/Octane 风格的指令，补真实忙碌反馈，保留构图、颜色和材质 | 小 |
| F05 | [ ] 角色立绘编辑与新版本 | 已有角色库浏览/筛选/应用；补基于原角色改外观、年龄版本、异步生图回执、保存独立角色版本及加入画布 | 中大 |
| F06 | [x] 通过 AI 助手接入 MCP | 已有 MCP 地址与占位密钥命令；补专用密钥签发、生成接入提示词和复制，密钥只在本次弹窗内存展示 | 小中 |
| F07 | [ ] 独立 CLI / Skill 安装入口 | 补账号中心安装引导、平台 CLI 的 API 调用/资产上传/事件订阅与配置；不迁入 Pro Codex worker、Agent Bridge 或任务执行内核 | 中大 |
| F08 | [ ] 首页“灵光一现” | 补三个创意方向、换一批及回填创意框；使用独立模型请求和按需创作 Skill，不依赖 Pro Agent loop | 中 |
| F09 | [x] 多章节剧本 TXT 导出 | 补章节选择、全选及逐 Clip 提示词导出；只读取现有已保存内容，不新增剧本生成流程 | 中 |
| F10 | [ ] 画布保存协调与提交版本确认 | 已有自动保存与快照保存；补串行保存协调、等待目标 revision、提交前保存校验，避免服务端读到旧画布 | 中 |
| F11 | [ ] 动态模型规格与能力展示 | 已有动态模型目录；补 execution/specification 分离、能力字段、参考图上限、尺寸规格及前后端合同对齐 | 中 |
| F12 | [ ] 按需媒体诊断接口 | 补按当前账户 storageKey 检测 SHA-256、解码、声道、LUFS/true peak 并保存独立报告；不改生成结果或交付状态 | 中 |
| F13 | [x] 应用内更新日志 | 门户顶部手动打开、关闭与重开日志弹窗，展示社区版已实现功能；补未读标记及本地已读状态，存储失败可见 | 小 |
| F14 | [ ] 产品介绍与 SEO 页面 | 补公开产品页、页面标题/描述等 metadata；产品文案仅描述社区版实际能力 | 小中 |
| F15 | [ ] parse-video 独立服务 | 补 Go 视频链接解析服务及社区版接入、任务错误反馈；本项只导入视频，不包含自动复刻或 Agent 创作流程 | 中大 |
| F16 | [ ] TapOps 运维面板 | 补主机指标、日志、数据库清单等监控能力；只纳入运维界面及服务，不纳入 Pro 运维 Agent、自动部署或网站交付能力 | 大 |

## 来源、落点与验收边界

以下路径以对应仓库根目录为基准。源码存在及当前差异已经核查；尚未运行来源功能、浏览器验收或真实模型生成，不把源码审查当成运行验证。

| 编号 | Pro 来源 | 社区版落点 / 同步要求 |
| --- | --- | --- |
| F01 | `apps/web/src/canvas/nodes/taskNode/components/VideoEditorTransitionControls.tsx`、`composeTransitionTimeline.ts`、`editorTimelineHistory.ts`；`packages/schemas/video-transition/`；`apps/hono-api/src/modules/video-compose/` | 现有 `VideoComposeEditorModal.tsx` / `useVideoCompose.ts`；前端时间线、预览、共享 schema 和服务端合成一起对齐，不能只搬控制按钮 |
| F02 | `apps/web/src/canvas/nodes/taskNode/components/subtitles/SubtitleTimelineTracks.tsx`、`SubtitleStyleControls.tsx`；`apps/web/src/api/videoSubtitles.ts`；`apps/hono-api/src/modules/video-compose/subtitle-transcription.ts` | 现有 `components/subtitles/SubtitlePanel.tsx`；保留真实识别回执，校验字幕时间边界，导出结果与预览样式一致；识别所需模型必须来自动态目录 |
| F03 | `apps/web/src/portal/HomeCreationLauncher.tsx`、`apps/web/src/ui/creation/CreationComposer.tsx` | 现有 `portal/NeoTvPage.tsx` 与聊天输入组件；仅同步输入和上下文收集，不迁入 Pro 的语义路由、固定工作流启动或聊天内核 |
| F04 | `apps/web/src/canvas/nodes/taskNode/imageDenoiseAction.ts`；`TaskNode.tsx` 的 `handleDenoise` | 现有 `TaskNode.tsx` 的手动去噪；只同步手动指令和交互，不纳入多阶段自动去噪规划/pipeline，不承诺模型未实际提供的 8K 分辨率 |
| F05 | `apps/web/src/ui/assets/CharacterPortraitEditor.tsx`、`CharacterLibraryStudio.tsx`、`useCharacterPortraitTask.ts` | 现有 `AiCharacterLibraryModal.tsx` / `CanvasCharacterLibraryPanel.tsx`；复用真实 `/public/draw` 与角色库接口，保留原角色并创建新版本；不承诺 Pro 尚未接通的官方角色库或音色生成 |
| F06 | `apps/web/src/portal/account/McpAgentConnectDialog.tsx`、`mcpAgentConnectSupport.ts` | 现有 `McpIntegrationView.tsx`；复用社区版密钥接口与实际 scopes，不改 MCP 到 Agent 的执行内核；失败可见，关闭弹窗清除内存凭据 |
| F07 | `apps/web/src/portal/account/CliSkillView.tsx`、`CliSkillInstallDialog.tsx`；`packages/connect-cli/src/platform-cli.mjs`、`platform-asset-upload.mjs` | 社区版账号中心和独立安装包；只开放社区版已实现的 API 命令，剔除 host worker、Pro 专有接口、商业端点与内核安装依赖；该包不能整包复制 |
| F08 | `apps/web/src/portal/InspirationDirectionModal.tsx`；`apps/hono-api/src/modules/inspiration/`；`apps/agents-cli/skills/tapcanvas-inspiration-directions/SKILL.md` | 首页独立灵感弹窗与接口；仅使用方法 Skill 和社区版已有模型代理，适配 Pro 共享池的商业计费依赖，不迁入其账单实现，不写死模型或静默换模型 |
| F09 | `apps/web/src/canvas/workbench/ScriptExportPopover.tsx`、`apps/web/src/api/chapterScripts.ts`；`apps/hono-api/src/modules/chapter/chapter.script-export.ts` | `PipelineProductionControls.tsx` 与 project routes；同步 `GET /projects/:id/script-plans`、`POST /projects/:id/script-export`，按当前账户授权读取，缺剧本内容显式报告 |
| F10 | `apps/web/src/canvas/persistence/createCanvasSaveCoordinator.ts`、`createCanvasAutosaveScheduler.ts`、`persistCanvasBeforeSubmission.ts` | 社区版 `App.tsx`、现有 `saveCurrentCanvasSnapshot.ts` 和提交入口；覆盖并发编辑、切项目、保存失败、版本不一致；不能在拖动每帧全量扫描/序列化 |
| F11 | `apps/hono-api/src/modules/new-api-models/new-api-models.service.ts` 及 `new-api-video-analysis-model.ts` | 同名社区模块及 SDK/前端模型选择；规格可读不等于渠道可执行；不移植默认模型、自动替换模型或 Pro 工作流媒体配置 |
| F12 | `apps/hono-api/src/modules/media-diagnostics/media-diagnostics.ts` 及公开 API 注册 | 社区版 API 与 media-worker 协议；按需独立调用，验证用户归属，保留所有已生成资产，不变成生成后质量门禁 |
| F13 | `apps/web/src/portal/changelog/ChangelogDialog.tsx`、`entries.ts` | 适配社区版 `PortalHeader` 入口；用社区版已实现功能替换 Pro 发布记录，验证手动打开、关闭、重开和已读状态；来源实现没有已读持久化，社区版按本清单补全，不自动弹出 |
| F14 | `apps/web/src/seo/ProductOverview.tsx`、`productContent.ts`、`pageMetadata.ts` | 社区版公开路由；核对路由标题/描述、公开访问与实际功能文案，不复制商业承诺 |
| F15 | `apps/parse-video/` | 社区版新增独立服务及其实际 API 接入；先核对上游 LICENSE、平台接口配置和容器依赖，不携带源仓库凭据或用户样例，不静默跳过解析错误 |
| F16 | `apps/server-ops/src/web/`、`src/server/` 及节点监控采集相关模块 | 社区版独立运维服务；移除 Pro 环境/主机信息并适配鉴权，仅监控范围；数据库变更、部署或真实主机操作须在实施时单独明确范围 |

## 与已有路线图的关系

README 原有待办继续保留：视频合成/字幕细化为 F01/F02，新版创作框为 F03，媒体诊断/更新日志/SEO/parse-video/TapOps 对应 F12–F16。本清单没有将已有图片对比、基础字幕、基础剪辑、角色库和 MCP 基础接入再次计为新增。

原路线图的“视频复刻”暂不列入本轮可选清单：Pro 完整链路涉及其工作流启动与执行，尚不能按纯界面同步认定为独立功能。故事线/小说工作台、全章仅节点交付、音色卡生产、资产规划 Jobs API、内核记忆和编排等候选同样不在本轮范围。

本轮已实施 F04、F06、F09、F13，未选择项保持待办。前三项的实现、截图与验证边界见 `docs/deliveries/2026-10-26-manual-tools-sync.md`；F13 见 `docs/deliveries/2026-10-26-changelog-sync.md`。
