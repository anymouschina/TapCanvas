import React from 'react'
import { Badge, Button } from '@mantine/core'
import { IconFileText, IconX } from '@tabler/icons-react'
import type { WorkflowNodeRunDto, WorkflowNodeRunHistoryDto } from '../api/server'
import { ManagedImage } from '../domain/resource-runtime'
import {
  toWorkflowNodeRunHistoryView,
  type WorkflowNodeRunHistoryView,
} from '../canvas/workflowNodeRunHistory'
import { workflowNodeRunStatusLabel } from './workflowExecutionHistory'
import type { WorkflowExecutionSnapshotNode } from './workflowExecutionSnapshotGraph'

function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value
  return new Date(parsed).toLocaleString('zh-CN', { hour12: false })
}

function formatRunDuration(run: WorkflowNodeRunDto): string {
  const start = Date.parse(run.startedAt ?? run.createdAt)
  if (!Number.isFinite(start)) return '—'
  const finish = Date.parse(run.finishedAt ?? '')
  if (!Number.isFinite(finish)) {
    return run.status === 'running' || run.status === 'waiting_external' || run.status === 'queued' ? '进行中' : '—'
  }
  const durationMs = Math.max(0, finish - start)
  if (durationMs < 1_000) return `${durationMs} ms`
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} 秒`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.floor((durationMs % 60_000) / 1_000)
  return `${minutes} 分 ${seconds} 秒`
}

function statusColor(status: WorkflowNodeRunDto['status'] | null): string {
  if (status === 'success') return 'teal'
  if (status === 'failed') return 'red'
  if (status === 'running') return 'blue'
  if (status === 'queued' || status === 'waiting_external') return 'yellow'
  return 'gray'
}

function toHistoryView(run: WorkflowNodeRunDto): WorkflowNodeRunHistoryView {
  const historyDto: WorkflowNodeRunHistoryDto = {
    ...run,
    executionStatus: 'running',
    executionCreatedAt: run.createdAt,
    executionFinishedAt: run.finishedAt ?? null,
  }
  return toWorkflowNodeRunHistoryView(historyDto)
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true
  return typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0
}

function isEmptyOutput(view: WorkflowNodeRunHistoryView): boolean {
  return view.mediaAssets.length === 0
    && view.itemRuns.length === 0
    && isBlank(view.output)
    && isBlank(view.evidence)
}

function kindLabel(node: WorkflowExecutionSnapshotNode): string {
  const data = node.data as Record<string, unknown>
  const kind = typeof data.kind === 'string' && data.kind.trim() ? data.kind.trim() : node.type
  if (kind === 'workflowStage') return '工作流阶段'
  if (kind === 'workflowTrigger') return '工作流入口'
  if (kind === 'io-in') return '入口'
  if (kind === 'io-out') return '出口'
  return kind || node.type || 'taskNode'
}

type RuntimeReferenceStatus = Readonly<{
  label: string
  color: string
  description: string
  searchAttemptCount: number
  searchFailureCount: number
  candidateCount: number
  actualReadCount: number
}>

function nonNegativeCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

function runtimeReferenceStatus(node: WorkflowExecutionSnapshotNode): RuntimeReferenceStatus | null {
  const data = node.data as Record<string, unknown>
  if (data.workflowRuntimeReferenceAggregate !== true) return null
  const evidenceState = typeof data.workflowRuntimeReferenceEvidenceState === 'string'
    ? data.workflowRuntimeReferenceEvidenceState
    : 'available'
  const description = typeof data.workflowRuntimeReferenceDescription === 'string'
    && data.workflowRuntimeReferenceDescription.trim()
    ? data.workflowRuntimeReferenceDescription.trim()
    : '本轮没有参考证据'
  const label = evidenceState === 'actual_read'
    ? '已读取'
    : evidenceState === 'searched'
      ? '已检索'
      : evidenceState === 'search_failed'
        ? '检索异常'
        : evidenceState === 'unrecorded'
          ? '证据未采集'
        : '未使用'
  return {
    label,
    color: evidenceState === 'actual_read' || evidenceState === 'searched'
      ? 'teal'
      : evidenceState === 'search_failed'
        ? 'yellow'
        : evidenceState === 'unrecorded'
          ? 'yellow'
        : 'gray',
    description,
    searchAttemptCount: nonNegativeCount(data.workflowRuntimeReferenceSearchAttemptCount),
    searchFailureCount: nonNegativeCount(data.workflowRuntimeReferenceSearchFailureCount),
    candidateCount: nonNegativeCount(data.workflowRuntimeReferenceCandidateCount),
    actualReadCount: nonNegativeCount(data.workflowRuntimeReferenceActualReadCount),
  }
}

export function SnapshotNodeRunDetail(props: Readonly<{
  node: WorkflowExecutionSnapshotNode
  run: WorkflowNodeRunDto | null
  executionId: string
  onClose: () => void
  onOpenLog?: (executionId: string) => void
}>): React.JSX.Element {
  const { node, run } = props
  const view = run ? toHistoryView(run) : null
  const errorMessage = run?.errorMessage?.trim() || view?.errorMessage || null
  const hasMedia = view !== null && view.mediaAssets.length > 0
  const nodeDataJson = React.useMemo(() => prettyJson(node.data), [node.data])
  const referenceStatus = runtimeReferenceStatus(node)
  const displayedStatus = run
    ? workflowNodeRunStatusLabel(run.status, run.outputRefs)
    : referenceStatus?.label ?? '未运行'
  const displayedStatusColor = run ? statusColor(run.status) : referenceStatus?.color ?? 'gray'

  return (
    <aside className="workflow-snapshot-detail nodrag nopan" aria-label="节点运行结果与过程" data-ux-panel>
      <header className="workflow-snapshot-detail__header">
        <div className="workflow-snapshot-detail__identity">
          <strong className="workflow-snapshot-detail__title">{String((node.data as Record<string, unknown>).label ?? '') || node.id}</strong>
          <span className="workflow-snapshot-detail__kind">{kindLabel(node)}</span>
        </div>
        <div className="workflow-snapshot-detail__header-actions">
          <Badge className="workflow-snapshot-detail__status" size="sm" variant="light" color={displayedStatusColor}>
            {displayedStatus}
          </Badge>
          <button className="workflow-snapshot-detail__close" type="button" aria-label="关闭节点详情" onClick={props.onClose}>
            <IconX className="workflow-snapshot-detail__close-icon" size={15} />
          </button>
        </div>
      </header>

      <div className="workflow-snapshot-detail__body">
        <section className="workflow-snapshot-detail__section" aria-label="运行过程">
          <h3 className="workflow-snapshot-detail__section-title">运行过程</h3>
          <dl className="workflow-snapshot-detail__facts">
            <div className="workflow-snapshot-detail__fact">
              <dt>状态</dt>
              <dd>{run
                ? workflowNodeRunStatusLabel(run.status, run.outputRefs)
                : referenceStatus?.description ?? '该节点在这次执行中没有运行记录'}</dd>
            </div>
            {!run && referenceStatus ? (
              <>
                <div className="workflow-snapshot-detail__fact">
                  <dt>节点性质</dt>
                  <dd>Agent 运行证据聚合视图，不是独立 DAG 执行节点</dd>
                </div>
                <div className="workflow-snapshot-detail__fact">
                  <dt>检索尝试</dt>
                  <dd>{referenceStatus.searchAttemptCount} 次（{referenceStatus.searchFailureCount} 次异常）</dd>
                </div>
                <div className="workflow-snapshot-detail__fact">
                  <dt>案例候选</dt>
                  <dd>{referenceStatus.candidateCount} 项</dd>
                </div>
                <div className="workflow-snapshot-detail__fact">
                  <dt>正文读取</dt>
                  <dd>{referenceStatus.actualReadCount} 项</dd>
                </div>
              </>
            ) : null}
            {run ? (
              <>
                <div className="workflow-snapshot-detail__fact">
                  <dt>执行身份</dt>
                  <dd><code className="workflow-snapshot-detail__code">{run.id}</code></dd>
                </div>
                <div className="workflow-snapshot-detail__fact">
                  <dt>尝试</dt>
                  <dd>第 {run.attempt} 次</dd>
                </div>
                <div className="workflow-snapshot-detail__fact">
                  <dt>创建</dt>
                  <dd>{formatTime(run.createdAt)}</dd>
                </div>
                <div className="workflow-snapshot-detail__fact">
                  <dt>开始</dt>
                  <dd>{formatTime(run.startedAt)}</dd>
                </div>
                <div className="workflow-snapshot-detail__fact">
                  <dt>结束</dt>
                  <dd>{formatTime(run.finishedAt)}</dd>
                </div>
                <div className="workflow-snapshot-detail__fact">
                  <dt>耗时</dt>
                  <dd>{formatRunDuration(run)}</dd>
                </div>
				{view && view.configuredItemConcurrency > 0 ? (
					<>
						<div className="workflow-snapshot-detail__fact">
							<dt>逐项进度</dt>
							<dd>{view.startedItems}/{view.totalItems} 已启动，{view.completedItems} 完成，{view.waitingItems} 等待供应商</dd>
						</div>
						<div className="workflow-snapshot-detail__fact">
							<dt>真实并发</dt>
							<dd>{view.activeItems} 活动 / {view.configuredItemConcurrency} 配置，峰值 {view.peakActiveItems}</dd>
						</div>
					</>
				) : null}
              </>
            ) : null}
          </dl>
          {errorMessage ? (
            <p className="workflow-snapshot-detail__error">{errorMessage}</p>
          ) : null}
        </section>

        {view && (hasMedia || view.itemRuns.length > 0 || !isEmptyOutput(view)) ? (
          <section className="workflow-snapshot-detail__section" aria-label="运行结果">
            <h3 className="workflow-snapshot-detail__section-title">运行结果</h3>
            {hasMedia ? (
              <ul className="workflow-snapshot-detail__assets">
                {view.mediaAssets.map((asset) => (
                  <li className={`workflow-snapshot-detail__asset workflow-snapshot-detail__asset--${asset.kind}`} key={asset.url}>
                    {asset.kind === 'image' ? (
                      <ManagedImage
                        className="workflow-snapshot-detail__asset-image"
                        src={asset.url}
                        alt={String((node.data as Record<string, unknown>).label ?? '') || node.id}
                        priority="visible"
                        ownerNodeId={node.id}
                        ownerSurface="task-node-skeleton"
                        ownerRequestKey={`snapshot-run-asset:${node.id}:${asset.url}`}
                        draggable={false}
                        decoding="async"
                        referrerPolicy="no-referrer"
                      />
                    ) : asset.kind === 'video' ? (
                      <video className="workflow-snapshot-detail__asset-video" src={asset.url} controls preload="metadata" />
                    ) : (
                      <audio className="workflow-snapshot-detail__asset-audio" src={asset.url} controls preload="metadata" />
                    )}
                    <span className="workflow-snapshot-detail__asset-meta">
                      {asset.kind}
                      {asset.durationSeconds != null ? ` · ${Math.round(asset.durationSeconds)}s` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {view.itemRuns.length > 0 ? (
              <ol className="workflow-snapshot-detail__item-runs">
                {view.itemRuns.map((item) => (
                  <li className={`workflow-snapshot-detail__item-run workflow-snapshot-detail__item-run--${item.status}`} key={item.runtimeNodeId}>
                    <div className="workflow-snapshot-detail__item-run-head">
                      <span className="workflow-snapshot-detail__item-run-index">#{item.index + 1}</span>
                      <strong className="workflow-snapshot-detail__item-run-id">{item.itemId}</strong>
                      <span className="workflow-snapshot-detail__item-run-status">
                        {item.status === 'success' ? '完成' : item.status === 'waiting_external' ? '等待外部结果' : item.status === 'running' ? '运行中' : '失败'}
                      </span>
                    </div>
                    {item.videoUrl ? (
                      <video className="workflow-snapshot-detail__item-run-video" src={item.videoUrl} controls preload="metadata" />
                    ) : item.textOutput ? (
                      <pre className="workflow-snapshot-detail__code-block">{item.textOutput}</pre>
                    ) : Object.keys(item.output).length > 0 ? (
                      <pre className="workflow-snapshot-detail__code-block">{prettyJson(item.output)}</pre>
                    ) : null}
                    {item.errorMessage ? <p className="workflow-snapshot-detail__error">{item.errorMessage}</p> : null}
                  </li>
                ))}
              </ol>
            ) : null}
            {view.output !== undefined && view.output !== null && Object.keys(view.output).length > 0 ? (
              <details className="workflow-snapshot-detail__collapsible">
                <summary className="workflow-snapshot-detail__collapsible-summary">输出端口</summary>
                <pre className="workflow-snapshot-detail__code-block">{prettyJson(view.output)}</pre>
              </details>
            ) : null}
            {view.evidence !== undefined && view.evidence !== null && Object.keys(view.evidence).length > 0 ? (
              <details className="workflow-snapshot-detail__collapsible">
                <summary className="workflow-snapshot-detail__collapsible-summary">交付证据</summary>
                <pre className="workflow-snapshot-detail__code-block">{prettyJson(view.evidence)}</pre>
              </details>
            ) : null}
          </section>
        ) : null}
        {run && view && !hasMedia && view.itemRuns.length === 0 && isEmptyOutput(view) && run.status !== 'failed' ? (
          <p className="workflow-snapshot-detail__empty">本次运行成功，但执行器没有声明输出端口。</p>
        ) : null}

        <section className="workflow-snapshot-detail__section" aria-label="快照节点数据">
          <h3 className="workflow-snapshot-detail__section-title">快照节点数据</h3>
          <details className="workflow-snapshot-detail__collapsible" open>
            <summary className="workflow-snapshot-detail__collapsible-summary">冻结在流版本里的节点 data</summary>
            <pre className="workflow-snapshot-detail__code-block">{nodeDataJson}</pre>
          </details>
        </section>
      </div>

      {props.onOpenLog ? (
        <footer className="workflow-snapshot-detail__footer">
          <Button
            className="workflow-snapshot-detail__log-button"
            variant="default"
            size="xs"
            leftSection={<IconFileText className="workflow-snapshot-detail__log-button-icon" size={14} />}
            onClick={() => props.onOpenLog?.(props.executionId)}
          >
            查看完整执行日志
          </Button>
        </footer>
      ) : null}
    </aside>
  )
}
