# 纳米漫剧流水线组件拆分建议

目标：在正式进入 `apps/web` 实现前，先把页面组件边界、职责和组合方式钉死，避免 UI 落地后出现超大文件和状态逻辑缠绕。

相关文档：

- [Sitemap](./NANO_COMIC_PIPELINE_SITEMAP.md)
- [Review Center Wireframe](./NANO_COMIC_PIPELINE_REVIEW_CENTER_WIREFRAME.md)
- [Review Panel Wireframe](./NANO_COMIC_PIPELINE_REVIEW_PANEL_WIREFRAME.md)
- [Shot Workspace Sidebar](./NANO_COMIC_PIPELINE_SHOT_WORKSPACE_SIDEBAR.md)
- [Shot List Row](./NANO_COMIC_PIPELINE_SHOT_LIST_ROW.md)
- [Status System](./NANO_COMIC_PIPELINE_STATUS_SYSTEM.md)

## 1. 拆分原则

- 页面组件只负责布局，不承担业务细节
- 列表组件只负责展示和选择，不负责详情逻辑
- 右侧栏组件只负责当前对象详情，不负责全局列表状态
- 审核组件必须可复用到资产、镜头、视频
- 状态徽标必须独立组件化，不能散落在每个行组件里

## 2. 页面级组件

### 2.0 项目内工作台宿主

建议先补一层项目内宿主组件：

- `NanoComicWorkspaceHost`
- `NanoComicWorkspaceHeader`
- `NanoComicWorkspaceTabs`

职责说明：

- `NanoComicWorkspaceHost`
  - 挂载在当前 `CanvasApp` 内
  - 控制打开/关闭状态
  - 承接 `currentProject`
- `NanoComicWorkspaceHeader`
  - 展示项目名、阶段、快速统计、关闭按钮
- `NanoComicWorkspaceTabs`
  - 切换 `概览 / 分镜 / 审核`

### 2.1 审核中心页

建议拆成：

- `ReviewCenterPage`
- `ReviewCenterStats`
- `ReviewCenterFilters`
- `ReviewCenterList`
- `ReviewCenterListRow`
- `ReviewCenterBulkBar`
- `ReviewCenterDetailDrawer`

职责说明：

- `ReviewCenterPage`
  - 页面布局
  - 数据源拼装
  - 选择状态管理
- `ReviewCenterStats`
  - 顶部统计卡片
- `ReviewCenterFilters`
  - 左侧筛选面板
- `ReviewCenterList`
  - 中间列表容器
- `ReviewCenterListRow`
  - 单行展示与快捷操作
- `ReviewCenterBulkBar`
  - 批量操作
- `ReviewCenterDetailDrawer`
  - 打开统一审核面板

### 2.2 镜头工作台页

建议拆成：

- `ShotWorkspacePage`
- `ShotSceneSection`
- `ShotList`
- `ShotListRow`
- `ShotPreviewStage`
- `ShotWorkspaceSidebar`

职责说明：

- `ShotWorkspacePage`
  - 页面三栏布局
  - 当前选中镜头状态
- `ShotSceneSection`
  - Scene 分组头
- `ShotList`
  - 镜头列表容器
- `ShotListRow`
  - 镜头单行
- `ShotPreviewStage`
  - 当前镜头主预览
- `ShotWorkspaceSidebar`
  - 右侧详情、风险、审核、评论

## 3. 跨页面复用组件

### 3.1 状态组件

- `StatusBadge`
- `StatusGroup`
- `StatusSummaryCard`

### 3.2 审核组件

- `ReviewActionBar`
- `ReviewRejectForm`
- `ReviewTimeline`
- `ReviewStateHeader`

### 3.3 评论组件

- `CommentThread`
- `CommentList`
- `CommentComposer`

### 3.4 风险组件

- `RiskSummaryCard`
- `ImpactList`
- `DependencyNotice`

### 3.5 候选结果组件

- `CandidateResultGrid`
- `CandidateResultCard`
- `CandidateSwitcher`

### 3.6 画布联动组件

- `CanvasInsertActionBar`
- `CanvasLinkedBadge`
- `CanvasLocationButton`

职责说明：

- `CanvasInsertActionBar`
  - 当前产物的 `加入画布 / 定位画布 / 从画布打开` 操作
- `CanvasLinkedBadge`
  - 展示当前产物是否已入画布
- `CanvasLocationButton`
  - 聚焦或跳转到已存在的画布节点

## 4. 状态管理建议

### 4.1 页面级状态

留在页面组件：

- 当前选中对象 ID
- 当前筛选条件
- 当前批量选中集合
- 当前打开的 drawer / panel

### 4.2 组件级状态

留在子组件：

- hover
- 局部折叠/展开
- 局部 tab
- 输入框草稿

### 4.3 不要这样做

- 不要把所有 UI 状态塞进一个超大 store
- 不要让列表行组件自己请求详情数据
- 不要让审核 drawer 反向控制整个页面筛选

## 5. 文件组织建议

建议未来在 `apps/web/src/ui/nano-comic/` 下面拆：

```text
nano-comic/
  host/
    NanoComicWorkspaceHost.tsx
    NanoComicWorkspaceHeader.tsx
    NanoComicWorkspaceTabs.tsx
  pages/
    ReviewCenterPage.tsx
    ShotWorkspacePage.tsx
    ProjectOverviewPage.tsx
  review-center/
    ReviewCenterStats.tsx
    ReviewCenterFilters.tsx
    ReviewCenterList.tsx
    ReviewCenterListRow.tsx
    ReviewCenterBulkBar.tsx
    ReviewCenterDetailDrawer.tsx
  shot-workspace/
    ShotList.tsx
    ShotListRow.tsx
    ShotPreviewStage.tsx
    ShotWorkspaceSidebar.tsx
    ShotSceneSection.tsx
  review/
    ReviewActionBar.tsx
    ReviewRejectForm.tsx
    ReviewTimeline.tsx
    ReviewStateHeader.tsx
  comment/
    CommentThread.tsx
    CommentList.tsx
    CommentComposer.tsx
  risk/
    RiskSummaryCard.tsx
    ImpactList.tsx
    DependencyNotice.tsx
  canvas/
    CanvasInsertActionBar.tsx
    CanvasLinkedBadge.tsx
    CanvasLocationButton.tsx
  status/
    StatusBadge.tsx
    StatusGroup.tsx
    status-tokens.ts
```

## 6. 首版最小组件集

如果要严格收敛，首版先实现这些：

- `ReviewCenterPage`
- `ReviewCenterListRow`
- `NanoComicWorkspaceHost`
- `ShotWorkspacePage`
- `ShotListRow`
- `ShotWorkspaceSidebar`
- `CanvasInsertActionBar`
- `StatusBadge`
- `ReviewActionBar`
- `CommentThread`

其他组件可以后续再拆。

## 7. 反模式

不要这样落地：

- 一个 `ShotWorkspace.tsx` 写 3000 行
- 一个 `ReviewCenter.tsx` 同时管筛选、列表、详情、批量操作
- 每个页面自己定义 badge 和状态文案
- 审核逻辑散落在按钮点击函数里

## 8. 下一步

建议继续补：

1. 核心组件 props 草案
2. 页面级 state 结构草案
3. mock data shape 草案
