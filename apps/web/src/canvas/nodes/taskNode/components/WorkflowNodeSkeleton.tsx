import React from 'react'
import { ManagedImage } from '../../../../domain/resource-runtime'
import { resolveWorkflowMediaPreview } from '../../../workflowMediaPreview'
import { resolveWorkflowNodePresentation } from '../../../workflowNodePresentation'
import { WorkflowNodeGlyph } from './WorkflowNodeGlyph'
import { useWorkflowNodeElapsedTime } from './useWorkflowNodeElapsedTime'
import './WorkflowNodeSkeleton.css'

type WorkflowNodeSkeletonProps = Readonly<{
  nodeId: string
  data: Record<string, unknown>
  label: string
  overview: boolean
}>

type WorkflowCanvasStatus = Readonly<{
  key: string
  label: string
}>

type WorkflowReferenceItem = Readonly<{
  name: string
  actualRead: boolean
}>

function workflowReferenceItems(value: unknown): readonly WorkflowReferenceItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!name) return []
    return [{
      name,
      actualRead: record.evidenceState === 'actual_read',
    }]
  })
}

function compactReferenceNames(items: readonly WorkflowReferenceItem[]): string {
  const names = Array.from(new Set(items.map((item) => item.name)))
  if (names.length === 0) return ''
  return names.length === 1 ? names[0] ?? '' : `${names[0] ?? ''} +${names.length - 1}`
}

function workflowCanvasStatus(data: Record<string, unknown>): WorkflowCanvasStatus {
  const rawStatus = typeof data.workflowStatus === 'string'
    ? data.workflowStatus.trim()
    : typeof data.triggerStatus === 'string'
      ? data.triggerStatus.trim()
      : ''
  if (rawStatus === 'running') return { key: rawStatus, label: '执行中' }
  if (rawStatus === 'waiting_external') {
    const waitingReasonLabel = typeof data.workflowWaitingReasonLabel === 'string'
      ? data.workflowWaitingReasonLabel.trim()
      : ''
    return { key: rawStatus, label: waitingReasonLabel || '等待外部' }
  }
  if (rawStatus === 'succeeded') return { key: rawStatus, label: '已完成' }
  if (rawStatus === 'partial') return { key: rawStatus, label: '部分完成' }
  if (rawStatus === 'failed') return { key: rawStatus, label: '失败' }
  if (rawStatus === 'cancelled') return { key: rawStatus, label: '已取消' }
  if (rawStatus === 'requested') return { key: rawStatus, label: '已触发' }
  if (rawStatus === 'queued') return { key: rawStatus, label: '等待执行' }
  return { key: 'idle', label: '未运行' }
}

export function WorkflowNodeSkeleton({ nodeId, data, label, overview }: WorkflowNodeSkeletonProps): React.JSX.Element {
  const presentation = resolveWorkflowNodePresentation(data)
  const media = resolveWorkflowMediaPreview(data)
  const status = workflowCanvasStatus(data)
  const elapsed = useWorkflowNodeElapsedTime(data)
  const showsResult = Boolean(media.kind && media.displayMode === 'result')
  const isReferenceAggregate = data.workflowRuntimeReferenceAggregate === true
  const referenceKind = data.workflowRuntimeReferenceKind === 'skill' ? 'skill' : 'knowledge'
  const referenceCount = typeof data.workflowRuntimeReferenceCount === 'number'
    ? data.workflowRuntimeReferenceCount
    : 0
  const referenceActualReadCount = typeof data.workflowRuntimeReferenceActualReadCount === 'number'
    ? data.workflowRuntimeReferenceActualReadCount
    : 0
  const referenceItems = workflowReferenceItems(data.workflowRuntimeReferenceItems)
  const actualReferenceItems = referenceItems.filter((item) => item.actualRead)
  const referenceNameSummary = compactReferenceNames(actualReferenceItems)
  const referenceCaption = referenceCount === 0
    ? `全库可检索 · 本轮未读取`
    : `本轮实际读取 ${referenceActualReadCount}${referenceNameSummary ? ` · ${referenceNameSummary}` : ''}`
  const resultLabel = showsResult
    ? media.primaryAsset
      ? `结果外显，共 ${media.assets.length} 个真实资产`
      : '结果外显，尚无真实资产'
    : '图标外显'
  const accessibleLabel = [label, presentation.categoryLabel, presentation.operationLabel, resultLabel, status.label, elapsed?.description]
    .filter(Boolean)
    .join(' · ')
  return (
    <article
      className={`tc-workflow-node-shell tc-workflow-node-shell--${presentation.variant}${showsResult ? ' tc-workflow-node-shell--result' : ''}${overview ? ' tc-workflow-node-shell--overview' : ''}`}
      data-workflow-variant={presentation.variant}
      data-workflow-display={showsResult ? 'result' : 'icon'}
      data-workflow-status={status.key}
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      {showsResult ? (
        <div className="tc-workflow-node-shell__preview-frame">
          {media.primaryAsset?.kind === 'image' ? (
            <ManagedImage
              className="tc-workflow-node-shell__preview-image"
              src={media.primaryAsset.url}
              alt={`${label || presentation.operationLabel}输出结果`}
              priority={overview ? 'prefetch' : 'visible'}
              ownerNodeId={nodeId}
              ownerSurface="task-node-skeleton"
              ownerRequestKey={`workflow-result:${nodeId}:${media.primaryAsset.url}`}
              draggable={false}
              decoding="async"
              referrerPolicy="no-referrer"
            />
          ) : media.primaryAsset?.kind === 'video' ? (
            <video
              className="tc-workflow-node-shell__preview-video nodrag nopan nowheel"
              src={media.primaryAsset.url}
              aria-label={`${label || presentation.operationLabel}输出视频`}
              controls={!overview}
              muted
              playsInline
              preload="metadata"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <span className="tc-workflow-node-shell__preview-empty" aria-hidden="true">
              <WorkflowNodeGlyph
                presentation={presentation}
                className="tc-workflow-node-shell__glyph"
                size={overview ? 26 : 32}
                nodeId={nodeId}
              />
            </span>
          )}
          {media.assets.length > 1 ? (
            <span className="tc-workflow-node-shell__preview-count" aria-label={`另有 ${media.assets.length - 1} 个结果`}>
              +{media.assets.length - 1}
            </span>
          ) : null}
        </div>
      ) : (
        <span className="tc-workflow-node-shell__icon-frame" aria-hidden="true">
          <WorkflowNodeGlyph
            presentation={presentation}
            className="tc-workflow-node-shell__glyph"
            size={overview ? 21 : 25}
            nodeId={nodeId}
          />
          {isReferenceAggregate ? (
            <span className={`tc-workflow-node-shell__reference-count tc-workflow-node-shell__reference-count--${referenceKind}`}>
              {referenceCount > 0 ? referenceCount : '全'}
            </span>
          ) : null}
        </span>
      )}
      {isReferenceAggregate ? (
        <span className={`tc-workflow-node-shell__reference-caption tc-workflow-node-shell__reference-caption--${referenceKind}`} aria-hidden="true">
          {referenceCaption}
        </span>
      ) : null}
      {!overview && (status.key === 'running' || status.key === 'waiting_external' || status.key === 'partial' || status.key === 'failed') ? (
        <span
          className={`tc-workflow-node-shell__execution-label tc-workflow-node-shell__execution-label--${status.key}`}
          aria-hidden="true"
        >
          {status.label}{elapsed ? ` · ${elapsed.compact}` : ''}
        </span>
      ) : null}
      {!overview && elapsed && status.key !== 'running' && status.key !== 'waiting_external' && status.key !== 'partial' && status.key !== 'failed' ? (
            <span
              className={`tc-workflow-node-shell__elapsed tc-workflow-node-shell__elapsed--${status.key}`}
              aria-label={elapsed.description}
              title={elapsed.description}
            >
              {elapsed.compact}
            </span>
      ) : null}
      <span
        className={`tc-workflow-node-shell__status tc-workflow-node-shell__status--${status.key}`}
        aria-hidden="true"
      />
    </article>
  )
}
