import React from 'react'
import { ActionIcon, Button, Loader, Tooltip } from '@mantine/core'
import { IconBinaryTree, IconChevronDown, IconChevronRight, IconPin, IconPinnedOff, IconRefresh } from '@tabler/icons-react'
import { toast } from '../../ui/toast'
import { useRFStore } from '../store'
import { materializeWorkflowTextItems, materializeWorkflowVideoItems } from '../workflowRuntimeMaterialization'
import { stringifyWorkflowValue } from '../workflowJavascriptSandbox'
import {
  toWorkflowNodeRunHistoryView,
  workflowNodeRunStatusLabel,
  type WorkflowNodeRunHistoryView,
} from '../workflowNodeRunHistory'
import { WorkflowItemOutputList } from './WorkflowItemOutputList'
import { workflowItemRunErrorSummary } from '../workflowItemRuns'
import { loadWorkflowNodeRunHistory } from '../workflowNodeHistoryLoader'
import { requestWorkflowExecutionSync } from '../workflowExecutionRequest'
import './WorkflowNodeHistorySection.css'

function formatRunDate(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function WorkflowNodeHistorySection(props: Readonly<{
  flowId: string
  nodeId: string
  readOnly: boolean
  data?: Record<string, unknown>
}>): React.JSX.Element {
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [runs, setRuns] = React.useState<readonly WorkflowNodeRunHistoryView[]>([])
  const [expandedRunId, setExpandedRunId] = React.useState<string | null>(null)
  const requestSequence = React.useRef(0)
  const pinnedSource = record(props.data?.workflowPinnedOutputSource)
  const pinnedNodeRunId = typeof pinnedSource.sourceNodeRunId === 'string'
    ? pinnedSource.sourceNodeRunId.trim()
    : ''

  const load = React.useCallback(async (): Promise<void> => {
    const requestId = requestSequence.current + 1
    requestSequence.current = requestId
    if (!props.flowId) {
      setRuns([])
      setExpandedRunId(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await loadWorkflowNodeRunHistory({
        flowId: props.flowId,
        nodeId: props.nodeId,
        data: props.data ?? {},
        limit: 20,
      })
      if (requestSequence.current !== requestId) return
      const nextRuns = result.map(toWorkflowNodeRunHistoryView)
      setRuns(nextRuns)
      requestWorkflowExecutionSync()
      setExpandedRunId((current) => current && nextRuns.some((run) => run.id === current)
        ? current
        : nextRuns[0]?.id ?? null)
    } catch (loadError: unknown) {
      if (requestSequence.current !== requestId) return
      setRuns([])
      setExpandedRunId(null)
      setError(loadError instanceof Error ? loadError.message : '无法加载节点执行历史')
    } finally {
      if (requestSequence.current === requestId) setLoading(false)
    }
  }, [props.flowId, props.nodeId, props.data?.workflowKey, props.data?.workflowNodeId, props.data?.workflowRunId, props.data?.workflowRunHistoryIds])

  React.useEffect(() => {
    void load()
    return () => {
      requestSequence.current += 1
    }
  }, [load])

  const projectRunToCanvas = React.useCallback((run: WorkflowNodeRunHistoryView): void => {
    useRFStore.getState().updateNodeData(props.nodeId, {
      workflowExecutionId: run.executionId,
      workflowStatus: run.status === 'success' ? 'succeeded' : run.status,
      workflowItemRuns: run.itemRunPayload,
      workflowCompletedUnits: run.completedItems,
      workflowTotalUnits: run.totalItems,
      workflowErrorCount: run.failedItems,
      workflowErrorDetail: run.errorMessage ?? undefined,
      workflowRuntimeExpanded: true,
    })
    try {
      if (run.videoItems.length > 0) {
        const result = materializeWorkflowVideoItems(props.nodeId)
        toast(result.created > 0
          ? `已铺开 ${result.created} 个可编辑视频节点`
          : `${result.existing} 个视频节点已在画布中`, 'success')
        return
      }
      const result = materializeWorkflowTextItems(props.nodeId)
      toast(result.created > 0
        ? `已铺开 ${result.created} 个可编辑文本节点`
        : `${result.existing} 个文本节点已在画布中`, 'success')
    } catch (materializeError: unknown) {
      toast(materializeError instanceof Error ? materializeError.message : '铺开历史结果节点失败', 'error')
    }
  }, [props.nodeId])

  const pinRun = React.useCallback((run: WorkflowNodeRunHistoryView): void => {
    if (run.status !== 'success' || record(run.outputRefs).protocolVersion !== '1') {
      toast('只能固定具有正式输出合同的成功执行记录', 'error')
      return
    }
    useRFStore.getState().updateNodeData(props.nodeId, {
      workflowPinnedOutputSource: {
        version: 1,
        sourceExecutionId: run.executionId,
        sourceNodeRunId: run.id,
      },
    })
    toast('已固定这次真实输出；保存后运行会跳过本节点执行器', 'success')
  }, [props.nodeId])

  const clearPin = React.useCallback((): void => {
    useRFStore.getState().updateNodeData(props.nodeId, { workflowPinnedOutputSource: undefined })
    toast('已取消固定输出，后续运行会重新执行本节点', 'success')
  }, [props.nodeId])

  return (
    <section
      className="workflow-node-inspector__section workflow-node-history"
      aria-label="节点执行记录"
      aria-busy={loading}
    >
      <div className="workflow-node-history__heading">
        <div className="workflow-node-history__title-group">
          <h3 className="workflow-node-inspector__section-title">执行记录</h3>
          <span className="workflow-node-history__count">最近 {runs.length} 次</span>
          {pinnedNodeRunId ? <span className="workflow-node-history__count">已固定真实输出</span> : null}
        </div>
        <div className="workflow-node-history__heading-actions">
          {pinnedNodeRunId ? (
            <Tooltip className="workflow-node-history__unpin-tooltip" label="取消固定输出" withArrow>
              <ActionIcon
                className="workflow-node-history__unpin"
                variant="subtle"
                aria-label="取消固定输出"
                disabled={props.readOnly}
                onClick={clearPin}
              >
                <IconPinnedOff className="workflow-node-history__unpin-icon" size={15} aria-hidden="true" />
              </ActionIcon>
            </Tooltip>
          ) : null}
          <Tooltip className="workflow-node-history__refresh-tooltip" label="刷新执行记录" withArrow>
            <ActionIcon
              className="workflow-node-history__refresh"
              variant="subtle"
              aria-label="刷新执行记录"
              loading={loading}
              onClick={() => void load()}
            >
              <IconRefresh className="workflow-node-history__refresh-icon" size={15} aria-hidden="true" />
            </ActionIcon>
          </Tooltip>
        </div>
      </div>
      {!props.flowId ? (
        <p className="workflow-node-inspector__empty">先保存当前画布，执行记录会按工作流和节点永久归档。</p>
      ) : null}
      {loading && runs.length === 0 ? (
        <div className="workflow-node-history__loading" role="status">
          <Loader className="workflow-node-history__loader" size={15} />
          <span className="workflow-node-history__loading-label">读取执行记录</span>
        </div>
      ) : null}
      {error ? <p className="workflow-node-inspector__help workflow-node-inspector__help--error">{error}</p> : null}
      {!loading && !error && props.flowId && runs.length === 0 ? (
        <p className="workflow-node-inspector__empty">这个节点还没有执行记录。</p>
      ) : null}
      {runs.length > 0 ? (
        <ol className="workflow-node-history__list">
          {runs.map((run) => {
            const expanded = expandedRunId === run.id
            const runOutput = stringifyWorkflowValue(run.output)
            const runError = run.itemRuns
              .map(workflowItemRunErrorSummary)
              .find((message): message is string => Boolean(message))
              ?? run.errorMessage
            return (
              <li className={'workflow-node-history__run workflow-node-history__run--' + run.status} key={run.id}>
                <button
                  className="workflow-node-history__run-toggle"
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpandedRunId(expanded ? null : run.id)}
                >
                  {expanded
                    ? <IconChevronDown className="workflow-node-history__chevron" size={14} aria-hidden="true" />
                    : <IconChevronRight className="workflow-node-history__chevron" size={14} aria-hidden="true" />}
                  <span className="workflow-node-history__run-date">{formatRunDate(run.createdAt)}</span>
                  <strong className="workflow-node-history__run-status">{workflowNodeRunStatusLabel(run.status, run.outputRefs)}</strong>
                  <span className="workflow-node-history__run-count">
                    {run.itemRuns.length > 0 ? `${run.completedItems}/${run.totalItems} 项` : '单次'}
                    {run.videoItems.length > 0 ? ` · ${run.videoItems.length} 视频` : ''}
                  </span>
                </button>
                {expanded ? (
                  <div className="workflow-node-history__run-detail">
                    {runError ? <p className="workflow-node-inspector__help workflow-node-inspector__help--error">{runError}</p> : null}
                    {run.itemRuns.length > 0 ? (
                      <WorkflowItemOutputList items={run.itemRuns} ariaLabel={`${formatRunDate(run.createdAt)} 逐项运行输出`} />
                    ) : runOutput ? (
                      <pre className="workflow-node-inspector__code-block">{runOutput}</pre>
                    ) : (
                      <p className="workflow-node-inspector__empty">这次运行没有逐项输出。</p>
                    )}
                    {run.itemRuns.length > 0 ? (
                      <Button
                        className="workflow-node-history__project-button"
                        variant="subtle"
                        leftSection={<IconBinaryTree className="workflow-node-history__project-icon" size={15} aria-hidden="true" />}
                        disabled={props.readOnly}
                        onClick={() => projectRunToCanvas(run)}
                      >
                        {run.videoItems.length > 0
                          ? `铺开本次 ${run.videoItems.length} 个视频节点`
                          : `铺开本次 ${run.textItems.length} 个文本节点`}
                      </Button>
                    ) : null}
                    {run.status === 'success' && record(run.outputRefs).protocolVersion === '1' ? (
                      <Button
                        className="workflow-node-history__pin-button"
                        variant="subtle"
                        leftSection={<IconPin className="workflow-node-history__pin-icon" size={15} aria-hidden="true" />}
                        disabled={props.readOnly || pinnedNodeRunId === run.id}
                        onClick={() => pinRun(run)}
                      >
                        {pinnedNodeRunId === run.id ? '本次输出已固定' : '固定为测试数据'}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ol>
      ) : null}
    </section>
  )
}
