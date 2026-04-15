# NANO_COMIC_PIPELINE_PHASE1_CHAPTER_API_AND_SCHEMA_DRAFT

## Scope

本草案只覆盖 `Phase 1` 的最小可开工范围：

- 引入 `chapter` 一级对象
- 允许项目管理下钻到章节管理
- 支持章节级工作台只渲染章节相关内容
- 保持与现有 `project`、`storyboard shot` 兼容

本草案不覆盖：

- flow 全量宿主化
- 资源图谱化
- shot 全量 review/version 系统
- 全量历史数据清洗

## Product Decision

### Why Chapter Must Be First-Class

当前 `project` 粒度过粗，无法承担生产工作台职责。

`chapter` 被提升为一级对象后，才能同时满足：

- 项目级共享资源不被打散
- 工作台局部渲染成立
- AI 上下文可裁剪
- 镜头管理有稳定父级
- 大项目不会默认加载整项目全量内容

### Project Management Can Have Lower-Level Containers

项目管理允许出现更下一级别的管理单元，例如 `chapter`。

这里不是简单增加树层级，而是定义真实工作边界：

- `project` 管理作品范围、资源共享、协作、默认配置
- `chapter` 管理局部生产面、局部任务面、局部渲染边界

这意味着“项目管理中下钻到章节”是设计要求，不是附属功能。

## Data Model Draft

### 1. Existing Project

沿用现有 `project` 结构，不做激进改动。

建议仅在聚合接口层新增与 `chapter` 的关系输出，不急于改 `project` 基本 schema。

### 2. New Chapter Table

建议表名：

- `chapters`

建议字段：

```ts
type ChapterRow = {
  id: string
  project_id: string
  chapter_index: number
  title: string
  summary: string | null
  status: 'draft' | 'planning' | 'producing' | 'review' | 'approved' | 'locked'
  sort_order: number
  cover_asset_id: string | null
  continuity_context: string | null
  style_profile_override: string | null
  last_worked_at: string | null
  created_at: string
  updated_at: string
}
```

字段说明：

- `chapter_index`
用于用户可理解的“第几章”，稳定展示用
- `sort_order`
用于拖拽排序，不与逻辑编号强绑定
- `continuity_context`
存章节承接说明或阶段性连续性摘要
- `style_profile_override`
章节局部风格偏移，不覆盖项目默认风格
- `last_worked_at`
用于“最近章节”排序

### 3. Chapter DTO

```ts
type ChapterDto = {
  id: string
  projectId: string
  index: number
  title: string
  summary?: string
  status: 'draft' | 'planning' | 'producing' | 'review' | 'approved' | 'locked'
  sortOrder: number
  coverAssetId?: string
  continuityContext?: string
  styleProfileOverride?: string
  lastWorkedAt?: string
  createdAt: string
  updatedAt: string
}
```

### 4. Storyboard Shot Compatibility Extension

当前不立刻重写 `storyboard`，只做兼容增强。

建议在现有 shot 结构中新增：

```ts
type StoryboardShotCompatExtension = {
  chapterId?: string
}
```

兼容期内保留：

- `projectId`
- `chunkIndex`
- `shotIndex`

新逻辑增加：

- `chapterId`

兼容规则：

- 若存在 `chapterId`，以 `chapterId` 为准
- 若不存在 `chapterId`，则用 `projectId + chunkIndex` 推导默认章节

### 5. Chapter Workbench Aggregate DTO

这是章节工作台推荐使用的聚合结构。

```ts
type ChapterWorkbenchDto = {
  project: {
    id: string
    name: string
  }
  chapter: ChapterDto
  shots: Array<{
    id: string
    shotIndex: number
    title?: string
    summary?: string
    status: string
    thumbnailUrl?: string
    sceneAssetId?: string
    characterAssetIds: string[]
    updatedAt: string
  }>
  stats: {
    totalShots: number
    generatedShots: number
    reviewShots: number
    reworkShots: number
  }
  recentTasks: Array<{
    id: string
    kind: string
    status: string
    ownerType: 'chapter' | 'shot'
    ownerId: string
    updatedAt: string
  }>
}
```

目标：

- 章节页面一次请求即可首屏可用
- 避免前端为了章节页拼接大量 project-only 接口

## API Draft

## 1. List Chapters By Project

### Route

`GET /projects/:projectId/chapters`

### Purpose

获取某项目下的章节目录，供项目页和章节切换器使用。

### Response

```json
{
  "projectId": "proj_123",
  "items": [
    {
      "id": "chap_001",
      "projectId": "proj_123",
      "index": 1,
      "title": "第一章：雨夜入城",
      "summary": "主角首次进入主舞台并遭遇冲突",
      "status": "producing",
      "sortOrder": 10,
      "lastWorkedAt": "2026-04-11T10:00:00.000Z",
      "createdAt": "2026-04-10T08:00:00.000Z",
      "updatedAt": "2026-04-11T10:00:00.000Z"
    }
  ]
}
```

### Requirements

- 必须按 `sortOrder, createdAt` 排序
- 可补充统计摘要，但第一版不是必需

## 2. Create Chapter

### Route

`POST /projects/:projectId/chapters`

### Request

```json
{
  "title": "第一章：雨夜入城",
  "summary": "主角首次进入主舞台并遭遇冲突"
}
```

### Server Behavior

- 自动分配 `chapter_index`
- 自动写入 `sort_order`
- 默认状态为 `draft`

## 3. Update Chapter

### Route

`PATCH /chapters/:chapterId`

### Request

```json
{
  "title": "第一章：夜雨入城",
  "summary": "更聚焦入城冲突",
  "status": "planning"
}
```

### Notes

- 第一阶段允许更新 `title/summary/status/sortOrder`
- 不建议第一阶段开放过多字段

## 4. Get Chapter Workbench

### Route

`GET /chapters/:chapterId/workbench`

### Purpose

作为章节工作台首屏聚合接口。

### Requirements

- 返回 chapter 元信息
- 返回本章节镜头列表
- 返回本章节最近任务
- 只返回章节相关内容，不默认拉整项目全量内容

### Rendering Boundary

这个接口必须遵守“章节裁剪”原则：

- 只查当前 `chapterId` 下的 shot
- 只查当前 `chapterId` 相关的任务
- 不返回整项目所有 shot
- 不返回整项目所有任务

## 5. List Shots By Chapter

### Route

`GET /chapters/:chapterId/shots`

### Purpose

为章节镜头板、镜头排序、章节筛选提供最小镜头数据。

### Response Shape

```json
{
  "chapterId": "chap_001",
  "items": [
    {
      "id": "shot_001",
      "projectId": "proj_123",
      "chapterId": "chap_001",
      "shotIndex": 1,
      "title": "城门全景",
      "summary": "主角在雨夜抵达城门",
      "status": "generated",
      "thumbnailUrl": "https://...",
      "characterAssetIds": [],
      "updatedAt": "2026-04-11T10:00:00.000Z"
    }
  ]
}
```

## 6. Optional Phase 1 Redirect API

### Route

`GET /projects/:projectId/default-entry`

### Purpose

告诉前端打开项目后默认该进入哪里。

### Response

```json
{
  "entryType": "chapter",
  "projectId": "proj_123",
  "chapterId": "chap_001"
}
```

### Why It Helps

可以把“默认进入最近章节”的策略封装在后端，不让前端在多个接口中自行推断。

## Frontend State Draft

第一阶段建议至少拆出以下 UI 状态：

```ts
type WorkbenchContextState = {
  currentProjectId: string | null
  currentChapterId: string | null
  currentShotId: string | null
}
```

禁止继续把“当前项目”当成唯一上下文。

### Phase 1 Minimum UI Rules

- 项目页可显示章节目录
- 进入章节页时，UI store 必须写入 `currentChapterId`
- 章节页内切镜头时，UI store 必须写入 `currentShotId`
- 所有章节工作台数据请求必须优先使用 `chapterId`

## Frontend Rendering Draft

### Project Overview

项目页第一阶段应显示：

- 作品信息
- 章节目录
- 项目共享资源入口
- 模型/协作设置入口

不应继续默认显示：

- 全项目所有镜头列表
- 全项目所有任务流
- 默认项目大画布

### Chapter Workbench

章节页第一阶段应显示：

- 章节头部
- 章节镜头板
- 章节最近任务
- 章节级 AI chat 入口

并遵守：

- 默认只渲染当前章节相关内容
- 不默认渲染整项目镜头
- 不默认渲染整项目评论或任务

## Migration Draft

### Safe Compatibility Plan

1. 新增 `chapters` 表
2. 对历史项目按 `chunkIndex` 自动生成 chapter
3. 将历史 shot 的 `chapterId` 回填为映射结果
4. 项目默认入口优先指向最近章节
5. 旧项目页仍可作为兼容入口存在

### Legacy Mapping Rule

```ts
legacyChapterKey = `${projectId}:${chunkIndex}`
```

若某 shot 没有 `chapterId`：

- 查找 `projectId + chunkIndex` 映射的 chapter
- 找不到则按该 `chunkIndex` 创建缺失章节

### Important Constraint

迁移期间不要要求历史数据立即完整、完美、人工整理完毕。

第一目标是：

- 新系统能打开旧项目
- 旧数据能映射出章节
- 新页面能先跑起来

## Suggested Implementation Order

- [ ] 先落 `chapters` 表和模块
- [ ] 先落 `GET /projects/:projectId/chapters`
- [ ] 先落 `GET /chapters/:chapterId/workbench`
- [ ] 前端先做章节页骨架
- [ ] 项目页先加章节目录和默认跳转
- [ ] 再补 `shot.chapterId` 显式化

## Review Questions

设计评审时必须回答这几个问题：

- [ ] chapter 的状态机是否足够简单且可执行
- [ ] chapter 是否真的成为页面和接口中的一级对象
- [ ] 项目页是否被明确降级为容器页
- [ ] 章节页是否真的做到只渲染章节相关内容
- [ ] 历史 `chunkIndex` 映射是否足够稳定
- [ ] 前端是否已拆分 `currentProject/currentChapter/currentShot`

## Exit Criteria

- [ ] 可以创建章节
- [ ] 可以列出项目章节
- [ ] 可以从项目进入某章节
- [ ] 章节工作台可独立渲染
- [ ] 默认打开项目时可跳转最近章节
- [ ] 历史项目可被映射到章节模型中
