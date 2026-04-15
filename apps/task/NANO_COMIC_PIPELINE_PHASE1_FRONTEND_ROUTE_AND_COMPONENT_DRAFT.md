# NANO_COMIC_PIPELINE_PHASE1_FRONTEND_ROUTE_AND_COMPONENT_DRAFT

## Goal

将 `Phase 1` 的前端改造范围压缩为一组可拆分、可并行、可评审的页面与组件任务。

第一阶段只解决 4 件事：

- `chapter` 成为真实页面对象
- `project` 页面支持下钻到 `chapter`
- 打开项目后默认进入最近章节
- `chapter` 工作台只渲染章节相关内容

## Phase 1 Frontend Success Criteria

- [ ] 用户从项目进入章节无障碍
- [ ] 章节工作台有独立页面与独立状态
- [ ] 镜头列表以章节为单位展示
- [ ] 不再默认展示整项目全量镜头
- [ ] `currentProject/currentChapter/currentShot` 三层状态拆分完成

## Route Draft

第一阶段建议最少新增或明确以下路由：

- [ ] `/workspace`
- [ ] `/projects`
- [ ] `/projects/:projectId`
- [ ] `/projects/:projectId/chapters/:chapterId`
- [ ] `/projects/:projectId/chapters/:chapterId/shots/:shotId`

说明：

- `/projects/:projectId` 仍存在，但定位为项目概览
- `/projects/:projectId/chapters/:chapterId` 成为默认生产入口
- `/projects/:projectId/chapters/:chapterId/shots/:shotId` 先保留为轻量镜头详情页，不要求第一阶段做完整画布改造

## Route Behavior

### 1. `/projects/:projectId`

职责：

- 展示项目总览
- 展示章节目录
- 提供“继续上次章节”入口

不应承担：

- 默认项目级生产工作台
- 整项目全量镜头编辑

### 2. `/projects/:projectId/chapters/:chapterId`

职责：

- 章节工作台主页面
- 默认只拉取并渲染当前章节相关数据

必须展示：

- 章节头部
- 镜头板
- 章节最近任务
- 章节级 chat 入口

### 3. `/projects/:projectId/chapters/:chapterId/shots/:shotId`

职责：

- 镜头详情或最小工作台

第一阶段应展示：

- 镜头基础信息
- 当前结果缩略图
- 当前状态
- 打开画布入口
- chat 上下文带 `chapterId + shotId`

## State Draft

建议新增或明确以下 UI store 状态：

```ts
type WorkbenchScopeState = {
  currentProjectId: string | null
  currentChapterId: string | null
  currentShotId: string | null
}
```

禁止继续只用 `currentProject` 驱动整套工作台。

### Derived UI Rules

- [ ] 进入项目页时写入 `currentProjectId`
- [ ] 进入章节页时写入 `currentProjectId + currentChapterId`
- [ ] 进入镜头页时写入 `currentProjectId + currentChapterId + currentShotId`
- [ ] 离开章节时清理不相关的 `currentShotId`

## Component Split Draft

## 1. Keep And Downgrade

### `ProjectPanel`

现有文件：

- [`ProjectPanel.tsx`](/Users/libiqiang/workspace/TapCanvas-pro/apps/web/src/ui/ProjectPanel.tsx)

第一阶段职责调整：

- [ ] 保留项目列表与项目管理入口
- [ ] 增加章节目录入口
- [ ] 增加“继续最近章节”按钮
- [ ] 去掉“项目即生产工作台”的默认心智

## 2. New Components

### `ChapterPanel` or `ChapterSidebar`

职责：

- 当前项目章节列表
- 当前章节高亮
- 新建章节入口
- 章节切换入口

建议最小 props：

```ts
type ChapterSidebarProps = {
  projectId: string
  currentChapterId?: string
  onSelectChapter: (chapterId: string) => void
}
```

### `ChapterWorkbenchPage`

职责：

- 章节页聚合容器

建议子模块：

- `ChapterHeader`
- `ChapterShotBoard`
- `ChapterTaskPanel`
- `ChapterContextPanel`

### `ChapterHeader`

展示：

- 章节标题
- 状态
- 镜头数
- 最近修改时间
- 批量操作入口

### `ChapterShotBoard`

展示：

- 当前章节镜头卡片列表
- 镜头状态筛选
- 排序入口
- 新建镜头入口

### `ShotCard`

最小信息：

- shot 编号
- 缩略图
- 标题或摘要
- 状态
- 角色标签
- 最近更新时间

### `ShotWorkbenchPage`

职责：

- 单镜头轻量工作台

第一阶段最少包含：

- `ShotHeader`
- `ShotPreviewPanel`
- `ShotMetaPanel`
- `ShotActionPanel`

## Data Fetching Draft

### Project Overview

优先使用：

- `GET /projects/:projectId/chapters`
- 可选 `GET /projects/:projectId/default-entry`

### Chapter Workbench

优先使用聚合接口：

- `GET /chapters/:chapterId/workbench`

不要在第一阶段用多个 project-only 接口拼章节页。

### Shot Page

优先使用：

- `GET /shots/:shotId`
- 如有需要再补充 `GET /shots/:shotId/workbench`

## Rendering Boundary Checklist

章节工作台必须做到以下几项：

- [ ] 不默认请求整项目所有镜头
- [ ] 不默认请求整项目所有任务
- [ ] 不默认请求整项目所有评论
- [ ] 不默认请求整项目所有 flow
- [ ] 资源区优先渲染当前章节相关内容

这 5 条如果做不到，第一阶段就不算完成。

## Default Entry Flow

用户路径建议：

1. 用户进入 `/projects/:projectId`
2. 页面请求 `default-entry` 或按本地最近状态解析最近章节
3. 用户一键进入最近章节
4. 默认进入 `/projects/:projectId/chapters/:chapterId`

如要更激进，也可直接在项目进入时自动跳章节，但第一阶段先保留“项目概览可见 + 明确继续入口”更稳。

## Suggested Implementation Order

- [ ] 先拆 UI store 的 project/chapter/shot 三层状态
- [ ] 再做章节侧栏
- [ ] 再做章节工作台页容器
- [ ] 再把项目页接入章节目录
- [ ] 最后再做默认入口跳转

## Parallel Work Split

### Frontend Worker A

- [ ] UI store 增 `currentChapterId/currentShotId`
- [ ] 项目页加入章节目录
- [ ] 默认章节跳转入口

### Frontend Worker B

- [ ] `ChapterWorkbenchPage`
- [ ] `ChapterHeader`
- [ ] `ChapterShotBoard`

### Frontend Worker C

- [ ] `ShotWorkbenchPage`
- [ ] `ShotCard`
- [ ] `ShotHeader`

## Exit Criteria

- [ ] 项目页可看章节目录
- [ ] 可进入章节工作台
- [ ] 章节工作台只渲染章节相关内容
- [ ] 镜头可从章节进入
- [ ] 项目默认入口可引导到最近章节
