# Canvas Resource Manager Checklist

目标：为海量画布节点的图片/缩略图/拼图素材建立独立的 `ResourceManager` 资源域，统一负责资源申请、调度、缓存、回收与观测，避免大量 `<img>` 自发下载和解码打爆主线程、内存与 GPU 纹理预算。

## 核心原则

- [x] 单一入口：禁止业务组件继续直接裸用远端 `src` 作为资源生命周期入口；节点只能通过 `ResourceManager` 申请资源句柄。
- [x] 单一拥有者：组件只能借用资源，不能拥有资源；`Blob`、`ObjectURL`、`ImageBitmap` 的真实生命周期全部归 `ResourceManager`。
- [x] 显式失败：下载失败、解码失败、回收失败必须记录可检索日志，禁止静默 fallback 到假图或默认图。
- [x] 视口优先：资源分配以“当前视口真实可见节点”为最高优先级，禁止视口外节点持续抢占下载/解码预算。
- [x] 可回收：所有中间资源都必须存在显式 `release` 路径，禁止只创建不释放。

## 最新问题记录（2026-03-31）

- [x] 已修复：节点聚焦/失焦只应更新资源优先级，不应因为 `priority` 变化触发 `release -> acquire`，导致图片短暂回到 `loading`
- [x] 已修复：同一节点本地文件上传进行中时，重复聚焦/重复触发不能再创建第二条平行上传流程
- [x] 已修复：同一批次文件选择内的重复文件去重已正式接入主上传入口
- [x] 待完成：刷新/关闭后的上传恢复策略仍未定义，当前只做到风险提示，不支持续传恢复

## Domain 划分

### 1. Domain Model

- [x] 新建资源域目录：`apps/web/src/domain/resource-runtime/`
- [x] 定义 `ResourceId` 值对象，统一表达 `kind + canonicalUrl + variantKey`
- [x] 定义 `ResourceDescriptor`，至少包含：
  - [x] `id`
  - [x] `kind: image | thumbnail | preview | mosaicSource | videoFrame`
  - [x] `url`
  - [x] `priority: critical | visible | prefetch | background`
  - [x] `requestedSize`
  - [x] `cachePolicy`
- [x] 定义 `ResourceHandle` 聚合根，至少包含：
  - [x] `state: idle | queued | loading | ready | failed | released`
  - [x] `refCount`
  - [x] `lastAccessAt`
  - [x] `failureReason`
  - [x] `estimatedBytes`
- [x] 定义 `DecodedImageResource`，明确承载：
  - [x] `blob`
  - [x] `objectUrl`
  - [x] `imageBitmap`
  - [x] `width`
  - [x] `height`

### 1A. ResourceDescriptor 契约细化

- [x] `requestedSize` 至少能表达：
  - [x] `width`
  - [x] `height`
  - [x] `dpr`
  - [x] `fit: cover | contain | fill`
- [x] `cachePolicy` 至少区分：
  - [x] `ephemeral`：只服务当前展示，release 后优先被 trim
  - [x] `viewport`：服务视口内节点，允许短暂保留
  - [x] `session`：服务本轮会话批处理，可跨组件复用
- [x] `variantKey` 不能只用裸 URL，必须可区分：
  - [x] `thumbnail`
  - [x] `preview`
  - [x] `original`
  - [x] `mosaic-source`
  - [x] `video-frame`
- [x] `canonicalUrl` 生成规则必须稳定：
  - [x] 去掉无意义 query noise
  - [x] 保留真正影响资源内容的参数
  - [x] 对 `blob:` / `data:` 单独归类，禁止误并入远端 URL key

### 1B. ResourceHandle / State Machine 约束

- [x] 允许的最小状态迁移：
  - [x] `idle -> queued -> loading -> ready`
  - [x] `idle|queued|loading -> failed`
  - [x] `ready|failed -> released`
- [x] 禁止的状态迁移：
  - [x] `released -> ready` 直接复活
  - [x] `failed -> ready` 且没有重新 acquire / invalidate
  - [x] `ready -> idle` 静默倒退
- [x] `refCount=0` 不等于立刻删除；允许进入 trim 候选池，但不能继续被 UI 当 active handle 使用
- [x] `ready` 必须满足：
  - [x] 至少有一个可渲染来源 `renderUrl | imageBitmap | imageElement`
  - [x] `lastAccessAt` 已更新
  - [x] `failureReason=null`
- [x] `failed` 必须满足：
  - [x] 保留最近失败阶段
  - [x] 保留最近失败时间
  - [x] 保留最近失败 message

### 1C. Ownership 模型

- [x] 每个资源 handle 至少能追踪最近 owner：
  - [x] `ownerNodeId`
  - [x] `ownerSurface`
  - [x] `ownerRequestKey`
- [x] `ownerSurface` 枚举至少包含：
  - [x] `task-node-main-image`
  - [x] `task-node-candidate`
  - [x] `task-node-upstream-reference`
  - [x] `preview-modal`
  - [x] `mosaic-runner`
  - [x] `reference-sheet`
- [x] 同一资源可被多个 owner 借用，但释放必须按 `refCount` 聚合，而不是按最后一个 owner 粗暴覆盖

### 2. Domain Services

- [x] `ResourceManager`：资源申请、引用计数、状态迁移、统一释放
- [x] `ResourceScheduler`：网络下载与解码并发调度
- [x] `ResourceCache`：内存对象缓存与 LRU 记录
- [x] `ResourceReaper`：TTL/LRU/预算超限时的回收执行器
- [x] `ViewportResourcePolicy`：根据视口和交互状态产出资源优先级
- [x] `MemoryPressurePolicy`：根据估算内存和运行状态决定收缩策略

### 2A. Service Boundary 约束

- [x] `ResourceManager` 只负责事实写入与生命周期 orchestration，不直接做 UI 判断
- [x] `ResourceScheduler` 只负责队列和并发，不拥有业务 owner 概念
- [x] `ResourceCache` 只负责缓存索引与指标，不直接发起下载
- [x] `ResourceReaper` 只根据 policy 给出的 trim plan 执行释放，不自行推断业务优先级
- [x] `ViewportResourcePolicy` 只根据 viewport/selection/focus 输出优先级 patch，不直接操作 DOM
- [x] `MemoryPressurePolicy` 只根据指标输出 budget action，不读取组件局部状态

### 2B. Policy Input / Output 契约

- [x] `ViewportResourcePolicy` 输入至少包含：
  - [x] `viewportRect`
  - [x] `zoom`
  - [x] `isDragging`
  - [x] `isPanning`
  - [x] `selectedNodeIds`
  - [x] `focusedNodeId`
  - [x] `previewNodeId`
- [x] `ViewportResourcePolicy` 输出至少包含：
  - [x] `acquire[]`
  - [x] `release[]`
  - [x] `priorityPatches[]`
  - [x] `deferred[]`
- [x] `MemoryPressurePolicy` 输入至少包含：
  - [x] `activeResourceCount`
  - [x] `activeDecodedCount`
  - [x] `totalEstimatedBytes`
  - [x] `visibleOriginalCount`
  - [x] `interactionMode`
- [x] `MemoryPressurePolicy` 输出至少包含：
  - [x] `targetBudget`
  - [x] `trimReason`
  - [x] `trimCandidates[]`
  - [x] `pauseBackground`

### 3. App Use Cases

- [x] `ensureNodePreviewReady(nodeId)`
- [x] `prefetchViewportResources(viewportSnapshot)`
- [x] `releaseNodeResources(nodeId)`
- [x] `pauseBackgroundLoading()`
- [x] `resumeBackgroundLoading()`
- [x] `trimToBudget(reason)`
- [x] `invalidateResource(resourceId)`

### 3A. Use Case 输入输出约束

- [x] `ensureNodePreviewReady(nodeId)`：
  - [x] 输入至少能定位 `nodeId + ownerSurface + preferredVariant`
  - [x] 输出至少返回 `resourceId | handleState | failureReason`
  - [x] 若节点不存在真实资源 URL，必须显式失败，不做假图 fallback
- [x] `prefetchViewportResources(viewportSnapshot)`：
  - [x] 只接受增量 viewport snapshot，不接受整棵节点树全量对象
  - [x] 输出必须是 acquire/release patch，而不是直接重建整个 runtime map
- [x] `releaseNodeResources(nodeId)`：
  - [x] 需要一次性覆盖主图、候选图、参考图、预览图 owner
  - [x] 只 release 该节点关联 handle，不得误伤共享资源的其他 owner
- [x] `pauseBackgroundLoading()`：
  - [x] 只暂停 `prefetch/background`
  - [x] 不得阻塞 `critical/visible`
- [x] `resumeBackgroundLoading()`：
  - [x] 必须从当前队列快照继续，而不是全量重排重建
- [x] `trimToBudget(reason)`：
  - [x] 输入 `reason` 必须来自固定枚举
  - [x] 输出需返回本次 trim 的统计结果
- [x] `invalidateResource(resourceId)`：
  - [x] 必须让旧 ready/failed 状态失效
  - [x] 下次 acquire 触发重新下载/解码

### 3B. Cutover Hard Rules

- [x] use case 实装后，组件层不得继续绕过 use case 直接操作 runtime store
- [x] 任何 use case 若需要写节点数据，必须通过明确 commit 点完成，禁止半路写一半的中间态长期滞留
- [x] 同一语义动作只能保留一条路径：
  - [x] 资源 acquire 走 resource use case
  - [x] 上传中事实走 upload-runtime use case
  - [x] 批处理取图走 batch loader use case

## 资源调度清单

### Phase 1: 调度与限流

- [x] 建立网络下载并发上限，初始建议 `4-8`
- [x] 建立图片解码并发上限，初始建议 `2-4`
- [x] 建立 CPU 重任务单独队列，至少覆盖 `mosaic/referenceSheet`
- [x] 拖拽/缩放期间暂停 `prefetch/background`
- [x] 当前选中节点和预览弹窗主图必须可抢占低优先级队列
- [x] 禁止因为某个节点请求升级而触发全量队列重建

### Phase 1A: 队列不变量

- [x] 同一 `resourceId` 在任一时刻最多只能存在于一个主队列位置，禁止重复入队
- [x] priority 升级只能做局部重排，禁止重建整队列
- [x] 下载、解码、CPU 批处理三类队列必须分开统计
- [x] 交互冻结期间：
  - [x] `critical` 允许继续
  - [x] `visible` 允许继续
  - [x] `prefetch/background` 必须暂停
- [x] 队列被暂停不等于状态丢失；恢复后必须沿用原有 pending 项

### Phase 2: 视口门控

- [x] 只为视口内节点申请真实图片资源
- [x] 只为视口边缘 buffer 区域节点做低优先预取
- [x] 视口外节点默认降级为占位态或极小缩略图态
- [x] 视口切换时做增量申请/释放，禁止每帧全量扫描节点
- [x] 拖拽热路径上不得因图片资源状态变化触发全量节点派生

### Phase 2A: Viewport Snapshot 契约

- [x] 视口快照最少包含：
  - [x] `viewportRect`
  - [x] `zoom`
  - [x] `visibleNodeIds`
  - [x] `bufferNodeIds`
  - [x] `selectedNodeIds`
- [x] `visibleNodeIds/bufferNodeIds` 需要来自增量计算结果，禁止每帧从全量 nodes 重新求交
- [x] buffer ring 需要固定策略，至少区分：
  - [x] immediate visible
  - [x] near viewport buffer
  - [x] out-of-range
- [x] 节点从 visible 离开后，不要求立刻销毁，但必须转为 trim candidate

### Phase 3: 资源表达

- [x] 节点卡片默认只吃缩略图，不直接挂原图
- [x] 预览弹窗再申请中图/原图
- [x] 批量处理链路优先复用 `Blob` / `ImageBitmap`，不要赌 URL 级 HTTP cache
- [x] 服务端如可提供 thumbnail URL，前端必须优先使用 thumbnail 契约
- [x] 所有 `ObjectURL` 都必须记录来源 `ResourceId`

### Phase 3A: Render Source 优先级

- [x] 节点卡片优先级：
  - [x] thumbnail
  - [x] preview
  - [x] original
- [x] 预览弹窗优先级：
  - [x] preview
  - [x] original
  - [x] thumbnail（仅兜底占位，不代表完成）
- [x] 批处理优先级：
  - [x] decoded bitmap
  - [x] blob/objectUrl
  - [x] direct image element
- [x] direct remote URL 只能作为 transport 输入，不能当成“已进入资源域”的完成态

## 内存与回收清单

### 本地上传运行时

- [x] 本地文件上传的运行时状态不能只放在组件本地 `useState`，必须有跨 remount 的全局事实源
- [x] 同一节点在本地文件仍在上传时，重复聚焦/重复触发上传必须被去重，不能再次创建平行上传流程
- [x] pending upload 记录需要能回溯到 `ownerNodeId`，避免只有全局提示条、没有节点归属
- [x] 图片节点在本地上传进行中时必须展示显式“上传中”状态，不能因为 focus/filter 切换丢失

### 回收路径

- [x] 组件卸载时 release 对应资源句柄
- [x] 节点图片切换时 release 旧主图句柄
- [x] 节点删除时批量 release 其关联资源
- [x] 预览弹窗关闭时 release 高分辨率资源
- [x] 拼图/参考板完成后 release 中间 `ImageBitmap`
- [x] 批量任务取消时立即清理未再引用的 `Blob/ObjectURL`

### 回收顺序

- [x] 先 `ImageBitmap.close()`
- [x] 再 `URL.revokeObjectURL(objectUrl)`
- [x] 最后释放 `Blob` 与元数据引用
- [x] 对已经 `released` 的句柄禁止再次渲染使用

### 预算控制

- [x] 设定内存预算阈值，例如：
  - [x] `maxActiveDecodedImages`
  - [x] `maxEstimatedBytes`
  - [x] `maxVisibleOriginals`
- [x] 超预算时优先回收：
  - [x] 视口外资源
  - [x] 最久未访问资源
  - [x] 低优先级预取资源
- [x] 拖拽、框选、缩放期间主动压低后台预算

### 预算控制建议默认值（待压测确认）

- [x] `maxConcurrentDownloads = 4`
- [x] `maxConcurrentDecodes = 2`
- [x] `maxBatchCpuJobs = 1`
- [x] `maxVisibleOriginals = 1-2`
- [x] `maxEstimatedBytes = 160MB-256MB`
- [x] `maxActiveDecodedImages = 48-96`
- [x] 交互期间预算折扣：
  - [x] `prefetch/background` 直接暂停
  - [x] `maxVisibleOriginals` 压到 `1`
  - [x] `trimToBudget('interaction')` 可按需触发一次

## React / Canvas 集成清单

### 节点集成

- [x] `TaskNode` 图片主图先接入 `ResourceManager`
- [x] 候选图、上游参考图随后接入同一资源入口
- [x] 组件只订阅单资源句柄状态，禁止订阅整个资源表
- [x] 节点结构状态与资源运行时状态分离，避免图片进度导致大面积 React 重渲染

### 画布集成

- [x] `Canvas` 层提供视口快照给 `ViewportResourcePolicy`
- [x] 拖动、缩放、框选 lifecycle 要显式通知 `ResourceScheduler`
- [x] 视口状态变化不能把 `ResourceManager` 变成顶层高频大订阅源

### 批量图片处理集成

- [x] `mosaicRunner` 接入资源域，避免自行维护一套下载/解码逻辑
- [x] `referenceSheet` 接入资源域，复用位图句柄和释放路径
- [x] 后续 storyboard/reference collage 等批处理统一迁移到资源域

## Diagnostics 清单

- [x] 建立资源诊断面板或调试入口，至少展示：
  - [x] active handles
  - [x] queued downloads
  - [x] decoding jobs
  - [x] ready bitmaps
  - [x] revoked objectUrls
  - [x] total estimated bytes
  - [x] LRU trim count
  - [x] failure count
- [x] 每次资源失败日志至少包含：
  - [x] `resourceId`
  - [x] `url`
  - [x] `kind`
  - [x] `priority`
  - [x] `ownerNodeId`
  - [x] `phase: fetch | decode | attach | release`
- [x] 内存修剪与回收必须有结构化 trace，便于确认是否真的生效

### Diagnostics 字段语义约束

- [x] `active handles` 统计的是 `refCount > 0` 的 handle，不是 runtime map 全量条目数
- [x] `queued downloads` 不包含 decode 队列与 CPU batch 队列
- [x] `ready bitmaps` 统计的是尚未 `close()` 的位图数，不是历史累计
- [x] `revoked objectUrls` 需要区分：
  - [x] `manual release`
  - [x] `reaper trim`
  - [x] `upload replacement`
- [x] `failure count` 需要至少区分：
  - [x] `fetch`
  - [x] `decode`
  - [x] `attach`
  - [x] `release`

## 实施顺序

### Milestone 1: 骨架

- [x] 建立 `resource-runtime` 目录与类型契约
- [x] 实现 `ResourceManager`、`ResourceScheduler`、`ResourceHandle`
- [x] 完成最小 `acquire/release` 流程

### Milestone 2: 主图接管

- [x] `TaskNode` 主图改走资源句柄
- [x] 当前节点主图支持高优先级立即加载
- [x] 视口外主图释放回收生效

### Milestone 3: 视口与限流

- [x] 画布接入视口感知策略
- [x] 背景加载暂停/恢复接入拖拽缩放生命周期
- [x] 网络下载并发上限实装，解码并发上限仍待补

### Milestone 4: 批处理统一

- [x] `mosaicRunner` 迁入资源域
- [x] `referenceSheet` 迁入资源域
- [x] 中间位图和 blob 回收纳入统一 reaper

### Milestone 5: Diagnostics 与验收

- [x] 完成资源诊断面板
- [x] 对海量节点场景做压测
- [x] 输出预算调优建议和默认阈值

### Milestone 6: Upload Runtime 收口

- [x] 为本地上传建立独立 `upload-runtime` 边界，避免继续把上传状态零散塞在 `uiStore` 与组件本地状态之间
- [x] 抽象 `UploadRequestId` / `UploadOwner` / `UploadHandle`，与 `ResourceHandle` 平行存在但职责独立
- [x] 本地上传与资源句柄建立桥接契约：
  - [x] 本地 `blob:` 预览资源进入 `ResourceManager`
  - [x] 远端托管成功后替换为 remote resource handle
  - [x] 旧 `blob:` 资源只在 replacement commit 成功后释放
- [x] 同一批次文件内重复项统一去重，避免一次选择就生成平行上传任务
- [x] 同一 `requestKey` 命中已有上传时，所有 `ownerNodeId` 都能正确绑定到同一 upload handle
- [x] 上传中的节点切换项目 / 聚焦 / 过滤 / remount 时，节点态与底栏提示保持一致
- [x] 明确“上传意图”与“HTTP 请求进行中”的区别，禁止只用一个布尔值混用两个阶段

### Milestone 6A: Upload Runtime 最小 PR 切分

- [x] PR-1：把 `pendingUploads` 与 `activeNodeImageUploadIds` 从 `uiStore` 拆到 `upload-runtime/store`
- [x] PR-2：为上传运行时补 `requestKey -> owners[]` 聚合模型，统一节点归属
- [x] PR-3：把同批次去重逻辑真正接到 `TaskNode.handleImageUpload()` 与 `Canvas.importImagesFromFiles()`
- [x] PR-4：为上传态补 diagnostics snapshot，避免再靠 UI 文案推断真实状态

### Milestone 6B: Upload Runtime 契约细化

- [x] `UploadHandle` 最小字段：
  - [x] `id: UploadRequestId`
  - [x] `requestKey`
  - [x] `status: intent-created | queued | uploading | hosted | failed | canceled`
  - [x] `ownerNodeIds`
  - [x] `localPreviewResourceId`
  - [x] `remoteResourceId`
  - [x] `startedAt`
  - [x] `updatedAt`
  - [x] `error`
- [x] `upload-runtime/store` 只存事实，不直接拼 UI 文案：
  - [x] `handlesById`
  - [x] `handleIdsByOwnerNodeId`
  - [x] `duplicateBlockedCount`
  - [x] `lastFailureByHandleId`
- [x] `upload-runtime/actions` 需要显式阶段 API：
  - [x] `registerUploadIntent`
  - [x] `bindUploadOwner`
  - [x] `markUploadStarted`
  - [x] `commitUploadHosted`
  - [x] `failUpload`
  - [x] `finishUpload`
- [x] `commitUploadHosted` 必须原子完成：
  - [x] 节点 `imageUrl / imageResults / serverAssetId` 一次性切到 remote
  - [x] 旧 local preview resource 在 replacement commit 成功后释放
  - [x] pending upload handle 同步收口
- [x] 上传失败不允许伪装成成功：
  - [x] 保留 local preview
  - [x] 记录失败阶段、`requestKey`、`ownerNodeId`
  - [x] 明确节点处于“仅本地预览”而不是“已托管”

### Milestone 7: Refresh / Close 恢复策略

- [x] 定义刷新/关闭页面时的期望语义：
  - [x] 仅提示用户风险
  - [x] 自动恢复本地草稿
  - [x] 支持 resumable upload
- [x] 若选择“提示但不恢复”，文案必须明确说明只保证本地预览，不保证上传续跑
- [x] 若选择“自动恢复”，需要新增持久化结构：
  - [x] `pendingUploadDrafts`
  - [x] `ownerNodeIds`
  - [x] `localObjectUrl` 或可重建的 file handle 引用
  - [x] `startedAt`
  - [x] `phase`
- [x] 调研浏览器真实可用能力：
  - [x] `beforeunload` 只能提示不能保存文件句柄
  - [x] File System Access API 是否可用于恢复
  - [x] 是否需要 Service Worker / Background Sync
- [x] 未明确恢复策略前，禁止把现有提示文案改写成“可自动恢复”

### Milestone 7A: 风险提示与 guard 文案约束

- [x] `PendingUploadsBar`、项目切换 guard、页面离开 guard 必须共用同一事实源，禁止各自维护一套“待上传数量”
- [x] 在未实现 resumable upload 前，文案中禁止出现“会自动恢复”“稍后会继续上传”“已安全保存上传进度”
- [x] 若当前只有本地 `blob:` 预览，文案必须显式说明“远程任务暂不可用”，禁止暗示已托管
- [x] 若未来引入恢复能力，必须在文案中区分：
  - [x] “本地草稿恢复”
  - [x] “远端 HTTP 续传恢复”
  - [x] “仅恢复节点占位，不恢复真实上传”

### Milestone 8: Thumbnail / Original 双轨资源

- [x] 为图片节点补齐 thumbnail/original 两级资源契约
- [x] `TaskNode` 默认只消费 thumbnail 资源
- [x] `PreviewModal` 打开时再申请 original 资源
- [x] 关闭预览后释放 original handle，仅保留 thumbnail
- [x] `imageResults` / `serverAssetId` / 未来 model result schema 需要能表达 thumbnail 来源
- [x] 若后端尚无 thumbnail 能力，先定义前端 placeholder contract，不允许继续默认直挂原图

### Milestone 8A: Thumbnail Contract 最小字段

- [x] 节点主数据至少能表达：
  - [x] `thumbnailUrl`
  - [x] `originalUrl`
  - [x] `thumbnailResourceId`
  - [x] `originalResourceId`
- [x] `imageUrl` 不再同时承担 thumbnail/original 双语义，只表示“当前主消费 URL”
- [x] `imageResults[]` 每项最少能表达：
  - [x] `url`
  - [x] `thumbnailUrl`
  - [x] `assetId`
  - [x] `width / height`（若已知）
- [x] 前端 placeholder contract 至少包含：
  - [x] `thumbnailState: absent | pending | ready`
  - [x] `originalState: remote-only | ready`
  - [x] `preferredVariant: thumbnail | original`
- [x] 当 `thumbnailState=absent` 时，UI 仍必须走 `ResourceManager`，禁止回退到裸远端原图

### Milestone 9: Reaper / Cache / Budget

- [x] 建立 `ResourceCache`，至少记录：
  - [x] `lastAccessAt`
  - [x] `retainCount`
  - [x] `estimatedBytes`
  - [x] `transport`
- [x] 建立 `ResourceReaper`，至少支持：
  - [x] TTL trim
  - [x] LRU trim
  - [x] budget exceeded trim
  - [x] viewport-out trim
- [x] 预算收缩顺序必须固定：
  - [x] background
  - [x] prefetch
  - [x] invisible visible
  - [x] critical 之外的 original
- [x] trim 操作必须幂等，禁止多次释放同一 object URL / imageBitmap
- [x] trim 结果要产出可诊断统计，禁止“悄悄释放”

### Milestone 9A: Reaper 落地细则

- [x] trim 候选列表必须由非热路径 snapshot 生成，禁止在 drag/move 每帧重新全量排序
- [x] candidate score 至少考虑：
  - [x] `priority`
  - [x] `isVisible`
  - [x] `lastAccessAt`
  - [x] `estimatedBytes`
  - [x] `transport`
- [x] `estimatedBytes` 估算规则先统一：
  - [x] remote blob 优先取 `blob.size`
  - [x] decoded bitmap 取 `width * height * 4`
  - [x] 无法估算时记 `null`，禁止伪造 `0`
- [x] reaper reason 枚举固定：
  - [x] `manual`
  - [x] `interaction`
  - [x] `ttl`
  - [x] `lru`
  - [x] `budget-exceeded`
  - [x] `viewport-out`
- [x] reaper 只负责释放，不负责语义判断；是否该 trim 由 policy 决定

### Milestone 10: Batch Processor Cutover

- [x] `mosaicRunner` 改为依赖统一 batch image source loader，不再自行 `fetch/createImageBitmap`
- [x] `referenceSheet` 改为依赖统一 image source loader
- [x] batch processor 结束时显式调用 `release`
- [x] 批处理失败时保留失败日志，但必须释放已不再引用的中间资源
- [x] 为后续 `storyboard/reference collage/frame extraction` 预留统一 worker 队列入口

### Milestone 10A: Batch Loader 抽象接口

- [x] 统一 `loadImageSourceForBatch(input)` 返回：
  - [x] `resourceId`
  - [x] `source: ImageBitmap | HTMLImageElement`
  - [x] `width`
  - [x] `height`
  - [x] `release()`
- [x] `mosaicRunner` / `referenceSheet` 只消费该接口，不再自行 `fetch/createImageBitmap`
- [x] CPU 重任务必须挂到单独队列，避免与节点主图争抢下载/解码预算
- [x] 调用方必须在 `finally` 中 release 全部批处理句柄，禁止依赖 GC 撞运气

### Milestone 11: Diagnostics Panel

- [x] 新增 diagnostics store snapshot，不直接让 UI 订阅整个 runtime map
- [x] 提供最小调试入口：
  - [x] active resources
  - [x] pending uploads
  - [x] queued downloads
  - [x] active decodes
  - [x] revoked object urls
  - [x] total estimated bytes
  - [x] last trim reason
  - [x] top offenders
- [x] 每个资源 handle 可追踪最近 owner：
  - [x] `ownerNodeId`
  - [x] `ownerSurface`
  - [x] `priority`
  - [x] `phase`
- [x] diagnostics 面板默认只在 debug/stats 模式可见，禁止污染主画布交互

### Milestone 11A: Diagnostics 首版字段

- [x] `resource.activeCount`
- [x] `resource.visibleCount`
- [x] `resource.prefetchCount`
- [x] `resource.backgroundCount`
- [x] `resource.readyObjectUrlCount`
- [x] `resource.readyBitmapCount`
- [x] `resource.totalEstimatedBytes`
- [x] `resource.lastTrimReason`
- [x] `upload.activeRequestCount`
- [x] `upload.ownerBindingErrors`
- [x] `upload.duplicateBlockedCount`
- [x] `upload.pendingSinceOldestMs`

### Milestone 11B: Diagnostics Trace 事件

- [x] 结构化事件最少覆盖：
  - [x] `resource.acquire`
  - [x] `resource.queue`
  - [x] `resource.ready`
  - [x] `resource.release`
  - [x] `resource.trim`
  - [x] `resource.fail`
  - [x] `upload.intent`
  - [x] `upload.bind-owner`
  - [x] `upload.commit-remote`
  - [x] `upload.fail`
- [x] 每条事件至少带：
  - [x] `timestamp`
  - [x] `resourceId` 或 `uploadId`
  - [x] `requestKey`
  - [x] `ownerNodeId`
  - [x] `reason`
  - [x] `traceId`

## 当前实现快照（2026-03-31）

- [x] 已建立最小 `resource-runtime` 目录、类型、store、manager、hook、通用图片组件
- [x] `TaskNode` 主图、候选图、编辑预览图、上游参考图已接入统一资源入口
- [x] 画布拖拽与 viewport move 已接入资源调度冻结，`prefetch/background` 会在交互中暂停
- [x] 主图与 `ManagedImage` 已接入基于 `IntersectionObserver` 的可见区门控
- [x] 资源优先级变化（如 focus/unfocus）现在只更新 priority，不再触发同 URL 的重新 acquire
- [x] 本地上传已具备跨 remount 的节点级“上传中”事实源
- [x] 同一节点重复触发本地上传已被去重，并能回溯到 `ownerNodeId`
- [x] `upload-runtime/store` 已建立，`TaskNode` / `PendingUploadsBar` / `pendingUploadGuard` / `api.server` 已切到同一事实源
- [x] 仍未完成 thumbnail/original 双轨、预算化回收、batch processor cutover、diagnostics 面板

## 当前代码事实快照与剩余缺口（2026-03-31）

- [x] `ResourceManager` 已承载 `estimatedBytes` 与 revoke/trim diagnostics，但仍未承载 `Blob / ImageBitmap`
- [x] 下载并发上限已在 `resourceRuntimeStore.maxConcurrentDownloads` 落地，CPU 重任务队列与图片解码并发也已独立
- [x] `TaskNode` 已不再依赖组件本地 `uploading` 布尔态，而是直接读取 `upload-runtime/store`
- [x] `pendingUploads` 与 `activeNodeImageUploadIds` 已从 `uiStore` 收敛到 `upload-runtime/store`
- [x] `localUploadDedup.ts` 已接到 `TaskNode.handleImageUpload()` 与 `Canvas.importImagesFromFiles()`
- [x] `upload-runtime` 当前已完成 store 级抽取与 diagnostics snapshot，但仍缺少 `UploadHandle` 模型与 service 层
- [x] `resourceCache.ts` / `resourceReaper.ts` 已落地最小实现：可汇总 `estimatedBytes`、统计 `revoke/trim`、并只 trim 无引用资源
- [x] `mosaicRunner` 与 `referenceSheet` 已切到统一 `batchImageSourceLoader`
- [x] 刷新/关闭页面当前只有风险提示，没有持久化草稿、file handle 恢复或 resumable upload

## 文件级落点

### 已落文件

- [x] `apps/web/src/domain/resource-runtime/model/resourceTypes.ts`
- [x] `apps/web/src/domain/resource-runtime/store/resourceRuntimeStore.ts`
- [x] `apps/web/src/domain/resource-runtime/services/resourceManager.ts`
- [x] `apps/web/src/domain/resource-runtime/hooks/useImageResource.ts`
- [x] `apps/web/src/domain/resource-runtime/hooks/useViewportVisibility.ts`
- [x] `apps/web/src/domain/resource-runtime/components/ManagedImage.tsx`
- [x] `apps/web/src/canvas/nodes/taskNode/components/ImageContent.tsx`
- [x] `apps/web/src/canvas/nodes/taskNode/components/UpstreamReferenceStrip.tsx`
- [x] `apps/web/src/canvas/Canvas.tsx`
- [x] `apps/web/src/domain/upload-runtime/store/uploadRuntimeStore.ts`
- [x] `apps/web/src/domain/resource-runtime/services/resourceCache.ts`
- [x] `apps/web/src/domain/resource-runtime/services/resourceReaper.ts`
- [x] `apps/web/src/ui/uiStore.ts`
- [x] `apps/web/src/api/server.ts`

### 待落文件

- [x] `apps/web/src/domain/resource-runtime/policies/viewportResourcePolicy.ts`
- [x] `apps/web/src/domain/resource-runtime/policies/memoryPressurePolicy.ts`
- [x] `apps/web/src/domain/upload-runtime/*`
- [x] `apps/web/src/utils/localUploadDedup.ts` 接入真实上传入口
- [x] `apps/web/src/domain/resource-runtime/services/batchImageSourceLoader.ts`
- [x] `apps/web/src/ui/stats/...` 或等价 diagnostics 入口
- [x] `apps/web/src/runner/mosaicRunner.ts`
- [x] `apps/web/src/runner/referenceSheet.ts`

### 建议目录模板

- [x] `apps/web/src/domain/resource-runtime/model/`
  - [x] `resourceTypes.ts`
  - [x] `resourceOwnership.ts`
  - [x] `resourceDiagnostics.ts`
- [x] `apps/web/src/domain/resource-runtime/services/`
  - [x] `resourceManager.ts`
  - [x] `resourceScheduler.ts`
  - [x] `resourceCache.ts`
  - [x] `resourceReaper.ts`
  - [x] `batchImageSourceLoader.ts`
- [x] `apps/web/src/domain/resource-runtime/policies/`
  - [x] `viewportResourcePolicy.ts`
  - [x] `memoryPressurePolicy.ts`
- [x] `apps/web/src/domain/resource-runtime/use-cases/`
  - [x] `ensureNodePreviewReady.ts`
  - [x] `prefetchViewportResources.ts`
  - [x] `releaseNodeResources.ts`
  - [x] `trimToBudget.ts`
- [x] `apps/web/src/domain/upload-runtime/`
  - [x] `model/uploadTypes.ts`
  - [x] `store/uploadRuntimeStore.ts`
  - [x] `services/uploadRuntimeService.ts`
  - [x] `diagnostics/uploadDiagnostics.ts`

### 模块职责模板

- [x] `resourceTypes.ts` 只放纯类型和值对象，禁止塞副作用 helper
- [x] `resourceScheduler.ts` 只放队列与并发，不读写 React hooks
- [x] `resourceManager.ts` 只组织 acquire/release/commit，不直接渲染或 toast
- [x] `resourceReaper.ts` 只执行 trim plan，不定义 trim 规则
- [x] `viewportResourcePolicy.ts` / `memoryPressurePolicy.ts` 维持纯函数输出，便于单测
- [x] `uploadRuntimeService.ts` 只负责上传阶段状态流转与 owner 绑定，不负责资源下载

## 下一轮直接执行顺序

- [x] Step 1：把 `localUploadDedup` 正式接入 `TaskNode.handleImageUpload()` 与 `Canvas.importImagesFromFiles()`
- [x] Step 2：抽出 `upload-runtime`，把上传进行中事实从 `uiStore` 收敛出去
- [x] Step 3：实现 `resourceCache/resourceReaper`，先补 `estimatedBytes + objectUrl revoke stats`
- [x] Step 4：给 `mosaicRunner/referenceSheet` 改成统一资源 loader
- [x] Step 5：补首版 diagnostics 面板，验证对象 URL 与上传 owner 绑定是否真实生效

## 下一轮每步完成定义

### Step 1 完成定义

- [x] 两个主入口都在“建节点前/发请求前”完成批次去重，而不是上传中途再碰运气合并
- [x] 被去重的文件只弹一次汇总提示，禁止逐文件 toast 打断用户
- [x] 同一批次内重复文件不会生成多余节点，也不会创建多条 pending upload

### Step 2 完成定义

- [x] `TaskNode` 不再依赖组件本地 `uploading` 作为最终事实，只把 runtime store 当唯一事实源
- [x] `PendingUploadsBar`、节点徽标、项目切换 guard 都读取同一 upload-runtime snapshot
- [x] 任何一个 `requestKey` 都能反查到全部 `ownerNodeId`

### Step 3 完成定义

- [x] 资源 ready 后能拿到可追踪的 `estimatedBytes`
- [x] `resource-runtime` 管辖范围内的每次 `URL.revokeObjectURL` 都进入 diagnostics 统计
- [x] trim 不会误释放仍被引用的 visible/critical 资源

### Step 4 完成定义

- [x] `mosaicRunner` 与 `referenceSheet` 不再直接 `fetch/createImageBitmap`
- [x] 批处理失败路径也会走统一 release
- [x] worker 队列与主图加载不会互相拖死

### Step 5 完成定义

- [x] diagnostics 能同时回答“谁在占资源”和“谁在重复上传”
- [x] upload owner 绑定错误可直接从 snapshot 读到，而不是靠 UI 文案猜测
- [x] trim reason、revoked object URL、duplicate blocked 都有可检索计数

## 硬切换迁移顺序

- [x] 阶段 1：先加新 runtime 和 diagnostics，但暂时不删旧状态读取点
- [x] 阶段 2：把单一入口切到新 runtime：
  - [x] `TaskNode.handleImageUpload()`
  - [x] `Canvas.importImagesFromFiles()`
  - [x] `PendingUploadsBar`
  - [x] `pendingUploadGuard`
- [x] 阶段 3：确认所有读路径已切换后，再删除旧 `uiStore.pendingUploads / activeNodeImageUploadIds` 读写
- [x] 阶段 4：再切 batch processor，避免资源域和上传域同时大改导致定位困难
- [x] 阶段 5：最后接 diagnostics 面板，基于新 runtime 事实出图，不反向驱动业务逻辑

### 硬切换禁令

- [x] 禁止长期保留“新 runtime + 旧 uiStore”双写双读
- [x] 禁止通过适配层把旧布尔态包成“看起来像 runtime handle”的假对象
- [x] 禁止为了过渡把 batch processor 再复制一套旧 loader 到新目录
- [x] 禁止在 cutover 未完成时，把失败吞掉改成默认图或默认成功文案

### 删除旧逻辑前检查

- [x] 所有 `pendingUploads` 读取点都已迁移
- [x] 所有 `activeNodeImageUploadIds` 读取点都已迁移
- [x] 所有直接 `fetch/createImageBitmap` 的 batch 入口都已迁移
- [x] 所有新建 `objectUrl` 的路径都能追到 release

## 验证矩阵

### 资源加载

- [x] 同一图片节点在 `selected=false -> true -> false` 循环中，不应重新出现 `loading` 态
- [x] 同一图片节点在视口内滚动、出视口、再回到视口时，应表现为：
  - [x] 出视口后释放 handle 或降级到占位态
  - [x] 回到视口后重新 acquire
  - [x] 不产生重复 object URL 泄漏
- [x] 当前选中节点图片应始终高于候选图和上游参考图优先级
- [x] 画布拖拽/缩放时，`prefetch/background` 资源不得继续抢下载槽位

### 本地上传

- [x] 同一节点连续点击上传两次同一文件，只产生一条上传记录
- [x] 同一批次文件中包含重复文件时，最终只上传一份
- [x] 上传进行中切换 focus/filter 后，节点仍显示“上传中”
- [x] 上传进行中切换项目时，提示文案与节点状态一致
- [x] 上传成功后：
  - [x] 本地 `blob:` 预览被远端资源替换
  - [x] 旧 local object URL 被释放
  - [x] pending upload 记录被清除

### 批处理

- [x] `mosaicRunner` 处理 9 张图后，中间 bitmap 被释放
- [x] `referenceSheet` 处理完成后，不保留无主 object URL
- [x] 批处理失败时能看到失败阶段日志，且不留下已失去引用的中间资源

### Diagnostics

- [x] diagnostics 面板中的 active handles 与真实可见资源数量大致一致
- [x] revoked object URL 计数会随着释放增长
- [x] trim 后 `lastTrimReason` 可见
- [x] upload owner 绑定错误为 0

## 反回归检索清单

- [x] 裸远端图片入口：
  - [x] `rg -n "<img[^>]+src=|src=\\{.*https?://|src=\\{.*imageUrl" apps/web/src`
- [x] 直接 `createImageBitmap` 入口：
  - [x] `rg -n "createImageBitmap\\(" apps/web/src`
- [x] 直接 `URL.createObjectURL` 入口：
  - [x] `rg -n "URL\\.createObjectURL\\(" apps/web/src`
- [x] 直接 `URL.revokeObjectURL` 入口：
  - [x] `rg -n "URL\\.revokeObjectURL\\(" apps/web/src`
- [x] 旧上传事实源残留：
  - [x] `rg -n "pendingUploads|activeNodeImageUploadIds" apps/web/src`
- [x] batch 自行下载残留：
  - [x] `rg -n "fetch\\(|new Image\\(|createImageBitmap\\(" apps/web/src/runner`

### 反回归判断规则

- [x] 检索命中不等于错误，但每个命中都必须回答：
  - [x] 是否已进入 `ResourceManager` 或 `upload-runtime`
  - [x] 是否有显式 release
  - [x] 是否只是 diagnostics / 测试代码
- [x] 若新增命中无法解释 owner、release、phase，默认视为回退

## PR 合并门禁

- [x] 任一 PR 若引入新的裸 `<img src={remoteUrl}>` 且未走 `ManagedImage` / `ResourceManager`，默认不通过
- [x] 任一 PR 若再次把上传进行中事实只放回组件本地 `useState`，默认不通过
- [x] 任一 PR 若通过“默认图/静默 fallback”掩盖资源失败，默认不通过
- [x] 任一 PR 若在拖拽热路径中新增图片资源全量扫描、全量 map/filter 派生，默认不通过
- [x] 任一 PR 若新增 object URL 创建但没有对应释放路径，默认不通过

### Review Checklist

- [x] 这次改动有没有引入新的平行生命周期入口
- [x] 这次改动有没有让同一语义动作同时走两套事实源
- [x] 这次改动有没有把 diagnostics 做成新的业务事实源
- [x] 这次改动有没有把 release 逻辑放进组件局部 `useEffect` 零散处理
- [x] 这次改动有没有让拖拽热路径重新依赖全量资源表
- [x] 这次改动有没有新加 `blob:` 预览但没说明 replacement commit 点

## Blockers 与依赖

- [x] thumbnail/original 双轨能力依赖后端或资产层提供稳定 thumbnail 契约；若暂无后端支持，前端必须先定义 placeholder contract
- [x] refresh/close 后的上传恢复能力依赖浏览器文件句柄或 resumable upload 方案；在方案确认前只能维持显式风险提示
- [x] `estimatedBytes` 的准确预算可能依赖图片真实尺寸与 blob 大小采集；若浏览器返回信息不足，需要接受“估算”而不是伪造精确值
- [x] batch processor cutover 需要先有统一 loader/reaper，否则只是把旧逻辑平移到新目录

### 待决策项的出结论标准

- [x] “刷新/关闭后的上传恢复策略” 需要先回答：
  - [x] 目标是防误解，还是要真恢复 HTTP 上传
  - [x] 浏览器能力是否足以重建 file handle
  - [x] 恢复失败时用户看到什么真实状态
- [x] “thumbnail 来源” 需要先回答：
  - [x] 是否已有后端稳定字段
  - [x] 若前端临时派生，成本是否会反噬主线程/GPU
  - [x] 没有 thumbnail 时是否接受只显示占位而不直挂原图

## 决策矩阵

### 刷新 / 关闭恢复策略

- [x] Option A：只提示不恢复
  - [x] 优点：实现最小，语义真实
  - [x] 缺点：用户体验保守
  - [x] 当前默认建议，直到 resumable upload 被证实可行
- [x] Option B：恢复本地草稿，不恢复真实上传
  - [x] 优点：节点不会丢视觉占位
  - [x] 缺点：容易被误解为“上传也恢复了”，文案要求极严
- [x] Option C：支持 resumable upload
  - [x] 优点：体验最好
  - [x] 缺点：实现和浏览器能力依赖都最高，当前没有证据说明可直接上

### Thumbnail 来源策略

- [x] Option A：后端资产层提供 thumbnail URL
  - [x] 优点：最符合资源域目标
  - [x] 缺点：依赖后端改造
- [x] Option B：前端本地派生 thumbnail
  - [x] 优点：可先跑通 UI 契约
  - [x] 缺点：最容易反噬主线程与内存预算，只能作为明确受限过渡态
- [x] Option C：没有 thumbnail 时只显示占位
  - [x] 优点：不会偷跑原图
  - [x] 缺点：体验保守，但语义最真实

## 决策日志

- [x] 决定优先用 `IntersectionObserver` 做视口门控，而不是在拖拽热路径做节点矩形全量求交
- [x] 决定先实现下载并发与交互冻结，再做预算化回收
- [x] 决定上传运行时与资源运行时平行建模，不把 upload 混进 `ResourceHandle`
- [x] 决定 focus/unfocus 只更新 priority，不再触发同 URL 重新 acquire
- [x] 待决策：刷新/关闭后的上传恢复是“只提示”还是“可恢复续传”
- [x] 待决策：thumbnail 由后端生成还是前端本地派生

## Definition Of Done

- [x] 所有图片展示入口都能回答：
  - [x] 它的资源句柄从哪里 acquire
  - [x] 什么时候 release
  - [x] 失败日志记录在哪
  - [x] 是否参与 viewport gating
  - [x] 是否有 thumbnail/original 分层
- [x] 所有本地上传入口都能回答：
  - [x] requestKey 如何生成
  - [x] ownerNodeId 如何绑定
  - [x] 重复触发如何去重
  - [x] refresh/close 语义是什么
- [x] diagnostics 足够支撑定位：
  - [x] 谁在占资源
  - [x] 谁没释放
  - [x] 谁在重复上传
  - [x] 为什么 trim 没生效

## 非目标

- [x] 不是为了把所有图片流量强行塞进一个巨型全局 store
- [x] 不是为了给所有图片路径都加静默 fallback
- [x] 不是为了引入“视口变化 -> 全量节点扫描 -> 全量重算”的重路径
- [x] 不是为了在未解决 thumbnail/original 契约前继续默认直挂大图

## 验收标准

- [x] 同屏海量图片节点下，拖拽/缩放不再因图片加载产生周期性假死
- [x] 视口外节点资源能在预算压力下稳定释放
- [x] `ObjectURL` 与 `ImageBitmap` 无持续泄漏
- [x] 批量拼图/参考板流程结束后中间资源被回收
- [x] 资源失败可通过日志定位到具体节点、URL 与阶段
- [x] 所有图片相关重资源流程都通过 `ResourceManager` 统一进入，不再保留平行隐式生命周期
