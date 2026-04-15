# 纳米漫剧流水线组件 Props 草案

目标：在 UI 实现前先定义关键组件的数据边界，避免组件写出来后频繁改 props 和状态结构。

相关文档：

- [Component Split](./NANO_COMIC_PIPELINE_COMPONENT_SPLIT.md)
- [Status System](./NANO_COMIC_PIPELINE_STATUS_SYSTEM.md)
- [Review Center Wireframe](./NANO_COMIC_PIPELINE_REVIEW_CENTER_WIREFRAME.md)
- [Shot Workspace Sidebar](./NANO_COMIC_PIPELINE_SHOT_WORKSPACE_SIDEBAR.md)

## 1. 通用类型草案

### 1.1 状态

```ts
type ProductionStatus =
  | 'draft'
  | 'ready'
  | 'queued'
  | 'running'
  | 'candidate_ready'
  | 'completed'
  | 'failed'
  | 'archived'

type ReviewStatus =
  | 'pending_review'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'rejected'
  | 'pending_director_confirmation'
  | 'director_confirmed'
  | 'director_rejected'

type RiskStatus = 'normal' | 'warning' | 'stale' | 'blocked'
```

### 1.2 审核对象

```ts
type ReviewEntityType = 'asset' | 'shot' | 'video_segment'
```

## 2. 状态组件

### 2.1 `StatusBadge`

```ts
type StatusBadgeProps = {
  kind: 'production' | 'review' | 'risk' | 'collaboration'
  value: string
  compact?: boolean
  withIcon?: boolean
  className?: string
}
```

### 2.2 `StatusGroup`

```ts
type StatusGroupProps = {
  productionStatus?: ProductionStatus | null
  reviewStatus?: ReviewStatus | null
  riskStatus?: RiskStatus | null
  compact?: boolean
  className?: string
}
```

## 3. 审核中心

### 3.1 `ReviewCenterStats`

```ts
type ReviewCenterStatsProps = {
  totalPending: number
  directorConfirmCount: number
  highRiskCount: number
  reworkCount: number
  blockedCount: number
  onQuickFilter?: (preset: string) => void
}
```

### 3.2 `ReviewCenterFilters`

```ts
type ReviewCenterFiltersValue = {
  projectId?: string
  episodeId?: string
  entityType?: ReviewEntityType | 'all'
  reviewStatus?: ReviewStatus | 'all'
  riskStatus?: RiskStatus | 'all'
  assigneeUserId?: string
  reviewerUserId?: string
  requiresDirectorConfirmation?: boolean
  isBlockingDownstream?: boolean
}

type ReviewCenterFiltersProps = {
  value: ReviewCenterFiltersValue
  onChange: (next: ReviewCenterFiltersValue) => void
  onReset: () => void
}
```

### 3.3 `ReviewCenterListRow`

```ts
type ReviewCenterRowItem = {
  id: string
  entityType: ReviewEntityType
  title: string
  summary: string
  projectName: string
  episodeName?: string | null
  productionStatus?: ProductionStatus | null
  reviewStatus: ReviewStatus
  riskStatus: RiskStatus
  assigneeName?: string | null
  reviewerName?: string | null
  downstreamImpactCount: number
  updatedAtLabel: string
  requiresDirectorConfirmation?: boolean
  isBlockingDownstream?: boolean
}

type ReviewCenterListRowProps = {
  item: ReviewCenterRowItem
  selected?: boolean
  onSelect?: (checked: boolean) => void
  onOpenDetail: () => void
  onApprove?: () => void
  onRequestChanges?: () => void
  onReject?: () => void
}
```

### 3.4 `ReviewCenterBulkBar`

```ts
type ReviewCenterBulkBarProps = {
  selectedCount: number
  canApprove?: boolean
  canRequestChanges?: boolean
  canReject?: boolean
  canAssign?: boolean
  onApprove?: () => void
  onRequestChanges?: () => void
  onReject?: () => void
  onAssign?: () => void
}
```

## 4. 审核面板

### 4.1 `ReviewStateHeader`

```ts
type ReviewStateHeaderProps = {
  entityTitle: string
  reviewStatus: ReviewStatus
  riskStatus?: RiskStatus | null
  assigneeName?: string | null
  reviewerName?: string | null
  updatedAtLabel?: string | null
  requiresDirectorConfirmation?: boolean
  isBlockingDownstream?: boolean
  downstreamImpactCount?: number
}
```

### 4.2 `ReviewActionBar`

```ts
type ReviewActionBarProps = {
  canSubmit?: boolean
  canApprove?: boolean
  canRequestChanges?: boolean
  canReject?: boolean
  canMarkDirectorConfirmation?: boolean
  disabledReason?: string | null
  onSubmit?: () => void
  onApprove?: () => void
  onRequestChanges?: () => void
  onReject?: () => void
  onMarkDirectorConfirmation?: () => void
}
```

### 4.3 `ReviewRejectForm`

```ts
type ReviewRejectFormValue = {
  reasonCode: string
  subReasonCode?: string
  comment: string
  isBlockingDownstream: boolean
  assigneeUserId?: string
  dueAt?: string
}

type ReviewRejectFormProps = {
  mode: 'changes_requested' | 'rejected'
  value: ReviewRejectFormValue
  onChange: (next: ReviewRejectFormValue) => void
  onSubmit: () => void
  onCancel?: () => void
}
```

### 4.4 `ReviewTimeline`

```ts
type ReviewTimelineItem = {
  id: string
  action: string
  actorName: string
  createdAtLabel: string
  summary?: string
}

type ReviewTimelineProps = {
  items: ReviewTimelineItem[]
}
```

## 5. 镜头工作台

### 5.1 `ShotListRow`

```ts
type ShotListRowItem = {
  id: string
  shotNo: number
  title: string
  summary: string
  thumbnailUrl?: string | null
  productionStatus?: ProductionStatus | null
  reviewStatus?: ReviewStatus | null
  riskStatus?: RiskStatus | null
  sceneName?: string | null
  downstreamVideoCount?: number
  updatedAtLabel?: string | null
}

type ShotListRowProps = {
  item: ShotListRowItem
  active?: boolean
  onSelect: () => void
  onPreview?: () => void
  onOpenReview?: () => void
  onRerender?: () => void
}
```

### 5.2 `ShotWorkspaceSidebar`

```ts
type ShotWorkspaceSidebarProps = {
  shot: ShotListRowItem | null
  previousShotSummary?: string | null
  nextShotSummary?: string | null
  contextSummary?: Array<{ label: string; value: string }>
  riskItems?: Array<{ id: string; level: RiskStatus; title: string; detail?: string }>
  candidateCount?: number
  onSubmitReview?: () => void
  onApprove?: () => void
  onRequestChanges?: () => void
  onReject?: () => void
}
```

### 5.3 `CandidateResultCard`

```ts
type CandidateResultCardProps = {
  id: string
  imageUrl?: string | null
  selected?: boolean
  label?: string
  status?: string
  onSelect?: () => void
  onPreview?: () => void
}
```

## 6. 评论组件

### 6.1 `CommentThread`

```ts
type CommentItem = {
  id: string
  authorName: string
  content: string
  createdAtLabel: string
}

type CommentThreadProps = {
  items: CommentItem[]
  draft: string
  onDraftChange: (next: string) => void
  onSubmit: () => void
}
```

## 7. 风险组件

### 7.1 `RiskSummaryCard`

```ts
type RiskSummaryCardProps = {
  title: string
  level: RiskStatus
  detail?: string
  recommendation?: string
}
```

### 7.2 `ImpactList`

```ts
type ImpactListItem = {
  id: string
  label: string
  entityType: string
  riskStatus: RiskStatus
}

type ImpactListProps = {
  items: ImpactListItem[]
  onOpenItem?: (id: string) => void
}
```

## 8. 首版建议

首版进入实现时，建议先把这些 props 固定下来：

1. `StatusBadgeProps`
2. `ReviewCenterListRowProps`
3. `ReviewActionBarProps`
4. `ShotListRowProps`
5. `ShotWorkspaceSidebarProps`

## 9. 下一步

建议继续补：

1. 页面级 state 草案
2. mock data shape
3. UI 静态壳的目录与路由建议

