# NANO_COMIC_PIPELINE_PHASE1_BACKEND_MIGRATION_AND_IMPLEMENTATION_CHECKLIST

## Goal

为 `Phase 1` 提供后端落地 checklist，覆盖：

- 数据表迁移
- chapter 模块实现
- storyboard 兼容增强
- 聚合接口
- 默认入口策略

## Phase 1 Backend Success Criteria

- [ ] 具备 `chapter` 一等对象
- [ ] 旧项目可自动映射章节
- [ ] 章节工作台有聚合接口
- [ ] storyboard shot 可挂到章节
- [ ] 接口支持章节裁剪，不默认返回整项目内容

## Database Migration Checklist

## 1. Create Chapters Table

- [ ] 新建 `chapters` 表 migration
- [ ] 主键使用现有项目统一 ID 策略
- [ ] 建立 `project_id` 外键或等价约束
- [ ] 为 `project_id + chapter_index` 建唯一索引
- [ ] 为 `project_id + sort_order` 建索引
- [ ] 为 `project_id + last_worked_at` 建索引

建议字段：

- [ ] `id`
- [ ] `project_id`
- [ ] `chapter_index`
- [ ] `title`
- [ ] `summary`
- [ ] `status`
- [ ] `sort_order`
- [ ] `cover_asset_id`
- [ ] `continuity_context`
- [ ] `style_profile_override`
- [ ] `last_worked_at`
- [ ] `created_at`
- [ ] `updated_at`

## 2. Extend Storyboard Shot

- [ ] 为 shot 表或其对应存储增加 `chapter_id`
- [ ] 保留 `chunk_index` 兼容字段
- [ ] 为 `chapter_id + shot_index` 建索引
- [ ] 为 `project_id + chunk_index` 保持兼容查询能力

## 3. Legacy Migration

- [ ] 编写历史 `chunkIndex -> chapter` 自动映射脚本
- [ ] 为每个 `projectId + chunkIndex` 创建一个 chapter
- [ ] 回填 shot 的 `chapter_id`
- [ ] 对无法映射的极端数据做好 fallback

## Chapter Module Checklist

## 1. Schema

- [ ] 新增 `chapter.schemas.ts`
- [ ] 定义 `ChapterSchema`
- [ ] 定义 `CreateChapterSchema`
- [ ] 定义 `UpdateChapterSchema`
- [ ] 定义 `ListProjectChaptersResponseSchema`
- [ ] 定义 `ChapterWorkbenchResponseSchema`

## 2. Repo

- [ ] 新增 `chapter.repo.ts`
- [ ] 实现 `createChapter`
- [ ] 实现 `listChaptersByProject`
- [ ] 实现 `getChapterById`
- [ ] 实现 `updateChapter`
- [ ] 实现 `findLatestWorkedChapterByProject`

## 3. Service

- [ ] 新增 `chapter.service.ts`
- [ ] 封装章节排序与默认编号逻辑
- [ ] 封装“最近章节”策略
- [ ] 封装章节工作台聚合逻辑

## 4. Routes

- [ ] 新增 `chapter.routes.ts`
- [ ] 接入 app 主路由
- [ ] 提供 `GET /projects/:projectId/chapters`
- [ ] 提供 `POST /projects/:projectId/chapters`
- [ ] 提供 `PATCH /chapters/:chapterId`
- [ ] 提供 `GET /chapters/:chapterId`
- [ ] 提供 `GET /chapters/:chapterId/workbench`

## Storyboard Compatibility Checklist

- [ ] 在 `storyboard.schemas.ts` 增加 `chapterId`
- [ ] 在 repo 查询中优先按 `chapterId`
- [ ] 兼容无 `chapterId` 情况下按 `chunkIndex` 回退
- [ ] 新增 `listShotsByChapter`
- [ ] 新增 `upsertShotInChapter`

## Workbench Aggregate Checklist

`GET /chapters/:chapterId/workbench` 至少应包含：

- [ ] chapter 元信息
- [ ] chapter 下 shots 列表
- [ ] chapter 统计摘要
- [ ] chapter 最近任务摘要

严禁第一阶段把整项目镜头和整项目任务全塞进 workbench 接口。

## Default Entry Strategy Checklist

## Option A: Dedicated API

- [ ] 新增 `GET /projects/:projectId/default-entry`
- [ ] 优先返回最近工作章节

## Option B: Derived In Project Service

- [ ] 项目详情响应中带 `defaultChapterId`

建议：

- [ ] 第一阶段选一种，不要两种都做
- [ ] 更推荐 dedicated API，前端语义更清晰

## Security And Auth Checklist

- [ ] 所有 chapter 读写接口沿用 project 归属鉴权
- [ ] 创建 chapter 时校验 project 所属权限
- [ ] 获取 chapter workbench 时必须校验 chapter 属于当前 project/用户

## Test Checklist

- [ ] `list chapters by project` 测试
- [ ] `create chapter` 测试
- [ ] `update chapter` 测试
- [ ] `default entry returns latest chapter` 测试
- [ ] `chapter workbench only returns chapter-scoped data` 测试
- [ ] `legacy chunkIndex mapping` 测试

## Chapter-Only Rendering Contract

为配合前端章节裁剪，后端必须承诺：

- [ ] `chapter workbench` 不返回其他章节镜头
- [ ] `chapter shots list` 不返回其他章节镜头
- [ ] `chapter tasks summary` 不返回其他章节任务

这部分建议直接写成测试断言。

## Suggested Execution Order

- [ ] 先落 migration
- [ ] 先落 chapter repo/service/routes
- [ ] 再补 storyboard `chapterId`
- [ ] 再落 chapter workbench 聚合接口
- [ ] 最后补 default-entry

## Rollback Safety

- [ ] migration 应可重复执行或安全失败
- [ ] 历史 shot 若未回填 chapter，服务仍可按 `chunkIndex` 回退
- [ ] 前端如未启用章节页面，旧项目页仍可使用

## Exit Criteria

- [ ] `chapter` 模块可用
- [ ] 历史数据可自动映射章节
- [ ] `chapter workbench` 聚合接口可用
- [ ] `default-entry` 或等效机制可用
- [ ] 后端已满足章节裁剪渲染契约
