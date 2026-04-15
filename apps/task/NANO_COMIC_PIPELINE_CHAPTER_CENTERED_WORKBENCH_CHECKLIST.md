# NANO_COMIC_PIPELINE_CHAPTER_CENTERED_WORKBENCH_CHECKLIST

## Goal

将当前以 `project` 为主工作颗粒度的漫剧工作台，重构为以 `chapter -> shot` 为主工作颗粒度的生产系统。

## Current Status

- Phase 1 recommended version is complete as of `2026-04-11`.
- Current shipped chain:
  - root entry: no project -> project management, has project -> workspace dashboard
  - project creation: blank or text-upload, with art style + visual rules + director manual
  - project setup: Toonflow-inspired preset library for art style and director manual
  - chapter workbench: chapter binding, source text window, chapter import from source book, smart bind for current chapter
  - shot workbench: create / edit / delete shot in chapter, batch status update for selected/filter-result shots
  - shot production: build prompt -> generate image -> poll result -> persist selected result
  - workspace dashboard: continue latest chapter + production metrics + rework queue + running tasks
  - owner-aware studio: chapter flow / shot flow can open in dedicated studio context, with explicit host badge
  - resource diagnostics: current shot scene asset + impacted shots + outdated refs are visible in chapter workbench
- Remaining work is no longer “whether chapter-centered workbench exists”, but deeper product operations on top of it.

核心原则：

- `project` 负责共享资源、协作边界、默认配置、发布与归档
- `chapter` 负责生产推进、内容裁剪、局部渲染边界
- `shot` 负责最小执行、生成、返工、审阅
- `flow/canvas` 负责附着在 `project/chapter/shot` 宿主上的编辑工作区

补充原则：

- 项目管理层必须允许出现更下一级别的管理容器，例如 `chapter`
- 当用户进入 `chapter` 级工作台时，系统应只渲染该章节相关内容，而不是整项目全量内容
- 所有需要“当前上下文”的功能，都必须明确支持 `project context + chapter context + shot context`

## Non-Goals

- 本阶段不追求一次性重写全部历史数据
- 本阶段不追求一次性替换全部旧版 project-only 路径
- 本阶段不追求先做复杂资源图谱，再做章节工作台

## Final Product Shape

- 首页以“最近章节 / 待处理镜头 / 运行中任务”为主，而不是项目列表为主
- 项目页退化为作品空间总览
- 章节页成为默认生产入口
- 镜头页成为最小执行入口
- 画布从“项目级总平面”转成“宿主明确的编辑器”

## Hard Decisions

- [x] `chapter` 必须成为一级对象，不能继续只作为 `chunkIndex` 的 UI 包装
- [x] `shot` 必须成为明确实体，不能继续只是 storyboard 的隐式子结构
- [x] `flow` 必须增加 `ownerType/ownerId`
- [ ] `asset/material/task/chat` 必须逐步支持 `chapter` 和 `shot` 作用域
- [x] 打开项目后的默认入口必须从 `project` 切到 `chapter`

## Rendering Boundary Principle

当工作焦点位于 `chapter` 时，前后端必须都遵守“章节裁剪”原则：

- [x] 前端列表只展示当前章节下的镜头、任务、评论、历史
- [ ] AI chat 默认只携带当前章节与当前镜头上下文，项目上下文作为背景层
- [x] 资源选择器优先展示当前章节相关资源，其次才展示项目共享资源
- [x] flow 面板默认只显示挂在当前章节或当前镜头的 flow
- [ ] 统计面板默认显示当前章节指标，不默认拉整项目全量指标

这条原则的目标不是隐藏数据，而是降低主工作面噪音，提升局部生产效率。

## Phase 0: Decision Lock

目标：在编码前锁死对象层级与宿主边界，避免继续围绕 `project` 补丁式迭代。

- [x] 确认正式对象层级：`project -> chapter -> shot`
- [x] 确认 `project` 的职责仅为共享、配置、协作、发布
- [x] 确认 `chapter` 的职责为推进、组织、裁剪、局部上下文
- [x] 确认 `shot` 的职责为生成、返工、审片、版本
- [x] 确认 `flow` 为附着对象，不再作为默认顶层概念
- [x] 确认首页默认不再以项目列表作为唯一主入口
- [x] 确认迁移期间允许 `chunkIndex -> chapterId` 自动映射

交付物：

- [x] 本文档评审通过
- [x] 页面与对象命名冻结
- [x] API 命名与数据表命名冻结

## Phase 1: Introduce Chapter As First-Class Object

目标：让 `chapter` 成为真实对象，但尽量少破坏现有逻辑。

### Backend

- [x] 新增 `chapter` 模块
- [x] 新增 `chapter.schemas.ts`
- [x] 新增 `chapter.repo.ts`
- [x] 新增 `chapter.service.ts`
- [x] 新增 `chapter.routes.ts`
- [x] 新增 `chapters` 表
- [x] `chapters` 表至少包含：
- [x] `id`
- [x] `project_id`
- [x] `index`
- [x] `title`
- [x] `summary`
- [x] `status`
- [x] `sort_order`
- [x] `last_worked_at`
- [x] `created_at`
- [x] `updated_at`

### API

- [x] `GET /projects/:projectId/chapters`
- [x] `POST /projects/:projectId/chapters`
- [x] `PATCH /chapters/:chapterId`
- [x] `GET /chapters/:chapterId`

### Frontend

- [x] 新增章节列表视图
- [x] 项目页增加章节目录入口
- [x] 打开项目后支持跳转到最近工作章节
- [ ] 新增章节选择状态到 UI store

### Compatibility

- [x] 历史项目可无痛生成默认章节
- [ ] 未完成 chapter 迁移的历史项目仍可继续使用

交付物：

- [x] 能创建章节
- [x] 能列出章节
- [x] 能从项目进入章节

## Phase 2: Promote Shot To Real Execution Unit

目标：将现有 storyboard shot 提升为真实的生产实体。

### Schema

- [x] `storyboard shot` 增加 `chapterId`
- [x] 保留 `chunkIndex` 作为兼容字段
- [x] 为 `shot` 补齐：
- [x] `id`
- [x] `projectId`
- [x] `chapterId`
- [x] `shotIndex`
- [x] `title`
- [x] `summary`
- [x] `status`
- [ ] `sceneAssetId`
- [ ] `characterAssetIds`
- [ ] `propAssetIds`
- [ ] `cameraPlan`
- [ ] `lightingPlan`
- [ ] `performanceNotes`
- [ ] `selectedRenderJobId`
- [ ] `createdAt`
- [ ] `updatedAt`

### API

- [ ] `GET /chapters/:chapterId/shots`
- [x] `POST /chapters/:chapterId/shots`
- [x] `PATCH /shots/:shotId`
- [ ] `GET /shots/:shotId`
- [ ] `POST /chapters/:chapterId/shots/reorder`

### Frontend

- [x] 新增章节镜头板
- [x] 镜头卡片展示最小生产信息
- [x] 支持从章节页直接进入镜头工作台
- [x] 支持章节内镜头排序
- [x] 支持按状态筛选镜头

交付物：

- [x] 用户能在章节内管理镜头
- [x] 用户能以镜头为单位执行生成与返工

## Phase 3: Move Default Work Entry From Project To Chapter

目标：完成产品主入口切换。

### Product

- [x] 首页增加“最近章节”
- [x] 首页增加“待返工镜头”
- [x] 首页增加“运行中任务”
- [ ] 首页增加“最近生成结果”
- [x] 项目页从“生产入口”降级为“作品空间总览”

### Frontend Routing

- [x] 新增 `/workspace`
- [x] 新增 `/projects/:projectId/chapters/:chapterId`
- [x] 新增 `/projects/:projectId/chapters/:chapterId/shots/:shotId`
- [x] 打开项目后默认跳最近章节，而不是默认停留项目概览

### UI State

- [ ] `currentProject`
- [ ] `currentChapter`
- [ ] `currentShot`
- [ ] 这三个状态必须分离，不再混成一个 project-level 当前上下文

交付物：

- [x] 用户进入项目后，默认看到章节工作台
- [x] 产品主工作流从 project-centered 切为 chapter-centered

## Recommended Next Phase

- [ ] 章节归档
- [x] 镜头批量操作
- [x] 将镜头选中结果提升为章节/项目级物料
- [x] 首页生产总览（最近章节 / 待返工镜头 / 运行中任务）
- [x] `flow` 宿主化

## Phase 4: Attach Flow To Explicit Owners

目标：让 `flow/canvas` 成为宿主明确的编辑工作区，而不是项目级总平面。

### Data Model

- [x] `flow` 增加 `ownerType`
- [x] `flow` 增加 `ownerId`
- [ ] `flow` 增加 `kind`

建议枚举：

- [ ] `ownerType = project | chapter | shot`
- [ ] `kind = world | chapter-planning | shot-edit | review | scratch`

### API

- [x] `GET /projects/:projectId/flows`
- [x] `GET /chapters/:chapterId/flows`
- [x] `GET /shots/:shotId/flows`
- [x] 新建 flow 时必须显式写宿主

### Frontend

- [x] 项目页只展示项目级 flow
- [x] 章节页默认展示章节级 flow
- [x] 镜头页默认展示镜头级 flow
- [ ] 打开 flow 时 UI 顶部清晰展示其宿主

交付物：

- [x] flow 不再默认等于整个项目工作台
- [x] 章节和镜头都可拥有自己的局部画布

## Phase 5: Scope Assets And Materials

目标：把“共享资源”从隐式关系改成显式作用域。

### Data Model

- [ ] `asset` 增加 `scopeType`
- [ ] `asset` 增加 `scopeId`
- [ ] `asset` 增加 `originType`
- [ ] `asset` 增加 `promotedFromAssetId`
- [ ] `material` 也补齐对应作用域字段

建议枚举：

- [ ] `scopeType = project | chapter | shot`
- [ ] `originType = upload | generated | derived | imported | promoted`

### Product Behavior

- [ ] 支持将镜头生成结果提升为章节参考
- [ ] 支持将章节参考提升为项目共享资源
- [ ] 支持在资源选择器中优先显示当前章节资源
- [ ] 支持查看某资源被哪些章节或镜头引用

交付物：

- [ ] 资源共享边界清晰
- [ ] 支持章节局部渲染与资源裁剪

## Phase 6: Make Task And Chat Chapter-Aware

目标：让任务系统与 AI 上下文具备章节感知能力。

### Task

- [ ] `task` 增加 `ownerType`
- [ ] `task` 增加 `ownerId`
- [ ] 支持查询章节级任务
- [ ] 支持查询镜头级任务

### Chat / Agents

- [ ] chat 请求参数增加 `chapterId`
- [ ] chat 请求参数增加 `shotId`
- [ ] project context service 升级为三层上下文：
- [ ] project context
- [ ] chapter context
- [ ] shot context

### Frontend

- [ ] 在章节页打开 chat 时默认附带当前 `chapterId`
- [ ] 在镜头页打开 chat 时默认附带当前 `chapterId + shotId`
- [ ] chat 历史按章节或镜头聚合展示

交付物：

- [ ] AI 不再只理解“当前项目”
- [ ] AI 能理解“当前章、当前镜头”

## Phase 7: Review, Versioning, And Continuity On Shot

目标：将返工、审阅、版本、连续性真正绑定到 shot。

- [ ] 每个 shot 支持版本列表
- [ ] 每个 shot 支持当前选中版本
- [ ] 每个 shot 支持 review 状态
- [ ] 每个 shot 支持评论与待办
- [ ] 每个 shot 支持连续性摘要
- [ ] 支持标记上一镜/下一镜承接关系

交付物：

- [ ] 镜头成为最小可追踪生产单元

## Phase 8: Performance And Rendering Isolation

目标：利用 `chapter` 边界显著降低大项目工作台负担。

- [ ] 章节页只拉本章节镜头，不默认拉整项目镜头
- [ ] 章节页只拉本章节任务，不默认拉整项目任务
- [ ] 章节页只拉本章节评论，不默认拉整项目评论
- [ ] 章节级 flow 单独加载
- [ ] 资源选择器分层加载：先章节，再项目共享
- [ ] chapter 级页面实现分页或虚拟化

交付物：

- [ ] 大项目下章节工作台仍保持可用性能
- [ ] “只渲染章节相关内容”成为真实能力，而不是 UI 文案

## Phase 9: Migration Strategy

目标：平滑迁移历史数据，不阻塞现网使用。

- [ ] 为历史项目自动创建章节
- [ ] 根据 `chunkIndex` 生成 `chapterId`
- [ ] 将旧 shot 自动回填到 chapter
- [ ] 旧 flow 默认挂到 `project`
- [ ] 旧 task 默认挂到 `project`
- [ ] 旧 asset 默认挂到 `project`
- [ ] 允许管理界面手动重整章节结构

交付物：

- [ ] 旧项目可继续打开
- [ ] 新项目默认使用 chapter-centered 模型

## Phase 10: Rollout

- [ ] 先灰度给内部项目
- [ ] 先打开只读章节工作台
- [ ] 再打开章节内镜头操作
- [ ] 再切换默认入口
- [ ] 最后逐步废弃 project-only 工作入口

## Phase 1 Must-Have Scope

如果只做最小可见成果，必须包含以下内容：

- [ ] `chapter` 一级对象
- [ ] 项目可进入章节
- [ ] 章节可列镜头
- [ ] 首页或项目进入后默认落到最近章节
- [ ] chat 至少支持 `chapterId`
- [ ] 前端章节页只渲染章节相关内容

## Explicit Recommendation

建议在产品语义上引入“项目管理可下钻到章节管理”的明确概念。

这不是简单的树状目录，而是新的渲染与工作边界：

- `project` 页面看的是共享与总览
- `chapter` 页面看的是局部生产面
- 进入 `chapter` 后，页面默认只渲染该章节相关内容

这一条建议应视为本次工作台改造的基础设计，而不是可选优化。

## Done Criteria

- [ ] 用户进入作品后，5 秒内能定位到具体章节
- [ ] 用户能在章节维度推进生产
- [ ] 用户能在镜头维度执行、返工、审阅
- [ ] UI 和 API 都能做到章节裁剪渲染
- [ ] flow、task、chat、asset 都具备明确宿主或作用域
- [ ] 项目管理与章节管理边界清晰
