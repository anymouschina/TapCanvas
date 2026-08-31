import React from 'react'
import { Button, Loader } from '@mantine/core'

import {
  fetchAdminProductionWorkflowNodeEvents,
  type ProductionWorkflowNodeEventDto,
} from '../../api/server'
import type {
  ExecutionGraphNode,
  ExecutionGraphNodeStatus,
  ExecutionKnowledgeReceipt,
  ExecutionToolInvocation,
  ExecutionToolInvocationStatus,
  ExecutionToolIssue,
} from './executionGraph.types'
import { formatElapsedDuration, formatExecutionTimestamp, invocationElapsedMs } from './executionTiming'
import VideoPromptAssemblyInspector from './VideoPromptAssemblyInspector'
import RuntimeKnowledgeInspector from './RuntimeKnowledgeInspector'
import ExecutionEventLogInspector from './ExecutionEventLogInspector'

type WorkflowNodeInspectorProps = {
  node: ExecutionGraphNode
  statusLabel: (status: ExecutionGraphNodeStatus) => string
  observedAtMs: number
  knowledgeReceipt?: ExecutionKnowledgeReceipt
  executionTraceId?: string | null
}

function invocationStatusLabel(status: ExecutionToolInvocationStatus): string {
  if (status === 'succeeded') return '成功'
  if (status === 'failed') return '失败'
  if (status === 'blocked') return '被阻止'
  if (status === 'denied') return '被拒绝'
  if (status === 'running') return '执行中'
  return '结果未知'
}

function issueTitle(issue: ExecutionToolIssue): string {
  if (issue.keyword === 'required') return '缺少必填字段'
  if (issue.keyword === 'additionalProperties') return '出现合同未允许字段'
  if (issue.keyword === 'type') return '字段类型不匹配'
  if (issue.keyword === 'enum') return '字段值不在允许范围'
  return '参数合同不匹配'
}

function ToolInvocationRow(props: { invocation: ExecutionToolInvocation; index: number; observedAtMs: number }): JSX.Element {
  const { invocation, index, observedAtMs } = props
  const hasFailureDetail = Boolean(invocation.errorCode || invocation.errorMessage || invocation.issues.length > 0)
  return (
    <article className={`agent-execution-inspector__invocation agent-execution-inspector__invocation--${invocation.status}`}>
      <header className="agent-execution-inspector__invocation-header">
        <span className="agent-execution-inspector__invocation-index">{index + 1}</span>
        <div className="agent-execution-inspector__invocation-heading">
          <strong className="agent-execution-inspector__invocation-name">{invocation.toolName}</strong>
          <span className="agent-execution-inspector__invocation-operation">{invocation.operation || '未提供 operation selector'}</span>
        </div>
        <span className={`agent-execution-inspector__invocation-status agent-execution-inspector__invocation-status--${invocation.status}`}>
          {invocationStatusLabel(invocation.status)}
        </span>
      </header>
      <dl className="agent-execution-inspector__invocation-meta">
        <div className="agent-execution-inspector__invocation-meta-item">
          <dt className="agent-execution-inspector__invocation-meta-label">时间</dt>
          <dd className="agent-execution-inspector__invocation-meta-value">{formatExecutionTimestamp(invocation.startedAt)}</dd>
        </div>
        <div className="agent-execution-inspector__invocation-meta-item">
          <dt className="agent-execution-inspector__invocation-meta-label">耗时</dt>
          <dd className="agent-execution-inspector__invocation-meta-value">{formatElapsedDuration(invocationElapsedMs(invocation, observedAtMs))}</dd>
        </div>
        <div className="agent-execution-inspector__invocation-meta-item">
          <dt className="agent-execution-inspector__invocation-meta-label">调用 ID</dt>
          <dd className="agent-execution-inspector__invocation-meta-value agent-execution-inspector__invocation-meta-value--code">{invocation.toolCallId}</dd>
        </div>
        {invocation.transportToolName ? (
          <div className="agent-execution-inspector__invocation-meta-item">
            <dt className="agent-execution-inspector__invocation-meta-label">传输工具</dt>
            <dd className="agent-execution-inspector__invocation-meta-value agent-execution-inspector__invocation-meta-value--code">{invocation.transportToolName}</dd>
          </div>
        ) : null}
      </dl>
      {hasFailureDetail ? (
        <section className="agent-execution-inspector__failure" aria-label="调用失败详情">
          <header className="agent-execution-inspector__failure-header">
            <strong className="agent-execution-inspector__failure-title">失败原因</strong>
            {invocation.errorCode ? <code className="agent-execution-inspector__failure-code">{invocation.errorCode}</code> : null}
          </header>
          {invocation.errorMessage ? <p className="agent-execution-inspector__failure-message">{invocation.errorMessage}</p> : null}
          {invocation.issues.length > 0 ? (
            <div className="agent-execution-inspector__issue-list" aria-label="无效参数路径">
              {invocation.issues.map((issue, issueIndex) => (
                <div className="agent-execution-inspector__issue" key={`${invocation.toolCallId}-${issue.path}-${issueIndex}`}>
                  <div className="agent-execution-inspector__issue-heading">
                    <strong className="agent-execution-inspector__issue-title">{issueTitle(issue)}</strong>
                    {issue.keyword ? <span className="agent-execution-inspector__issue-keyword">{issue.keyword}</span> : null}
                  </div>
                  <code className="agent-execution-inspector__issue-path">{issue.path || '$'}</code>
                  {issue.message ? <p className="agent-execution-inspector__issue-message">{issue.message}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="agent-execution-inspector__failure-missing">后端未提供结构化无效路径；请结合原始结果定位。</p>
          )}
        </section>
      ) : null}
      {invocation.input || invocation.output ? (
        <details className="agent-execution-inspector__raw">
          <summary className="agent-execution-inspector__raw-summary">请求与原始结果</summary>
          {invocation.input ? (
            <div className="agent-execution-inspector__raw-block">
              <span className="agent-execution-inspector__raw-label">调用参数</span>
              <pre className="agent-execution-inspector__raw-value">{invocation.input}</pre>
            </div>
          ) : null}
          {invocation.output ? (
            <div className="agent-execution-inspector__raw-block">
              <span className="agent-execution-inspector__raw-label">原始结果</span>
              <pre className="agent-execution-inspector__raw-value">{invocation.output}</pre>
            </div>
          ) : null}
        </details>
      ) : null}
    </article>
  )
}

export default function WorkflowNodeInspector(props: WorkflowNodeInspectorProps): JSX.Element {
  const { node, statusLabel, observedAtMs, knowledgeReceipt, executionTraceId } = props
  const hasPromptAssemblies = (node.promptAssemblies?.length ?? 0) > 0
  const workflowRunId = node.details.find((detail) => detail.label === 'workflowRunId')?.value ?? ''
  const workflowNodeId = node.details.find((detail) => detail.label === 'workflowNodeId')?.value ?? node.id
  const [events, setEvents] = React.useState<ProductionWorkflowNodeEventDto[]>([])
  const [nextBeforeSeq, setNextBeforeSeq] = React.useState<number | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const requestGeneration = React.useRef(0)

  const loadEvents = React.useCallback(async (beforeSeq: number | null, appendOlder: boolean) => {
    if (!workflowRunId || !workflowNodeId) return
    const generation = requestGeneration.current + 1
    requestGeneration.current = generation
    setLoading(true)
    setError('')
    try {
      const page = await fetchAdminProductionWorkflowNodeEvents({
        workflowRunId,
        workflowNodeId,
        beforeSeq,
        limit: 30,
      })
      if (requestGeneration.current !== generation) return
      setEvents((current) => {
        const combined = appendOlder ? [...page.events, ...current] : [...page.events]
        const byId = new Map(combined.map((event) => [event.eventId, event]))
        return [...byId.values()].sort((left, right) => left.seq - right.seq)
      })
      setNextBeforeSeq(page.nextBeforeSeq)
    } catch (loadError: unknown) {
      if (requestGeneration.current !== generation) return
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      if (requestGeneration.current === generation) setLoading(false)
    }
  }, [workflowNodeId, workflowRunId])

  React.useEffect(() => {
    setEvents([])
    setNextBeforeSeq(null)
    void loadEvents(null, false)
    return () => {
      requestGeneration.current += 1
    }
  }, [loadEvents])

  return (
    <aside className="agent-execution-inspector" aria-label={`${node.title} 节点数据检查器`}>
      <header className="agent-execution-inspector__header">
        <span className="agent-execution-inspector__eyebrow">
          {hasPromptAssemblies ? '提示词组装' : '节点数据'}
        </span>
        <strong className="agent-execution-inspector__title">{node.title}</strong>
        <span className={`agent-execution-inspector__status agent-execution-inspector__status--${node.status}`}>
          {statusLabel(node.status)}
        </span>
      </header>
      <div className="agent-execution-inspector__body">
        {node.timing ? (
          <section className="agent-execution-inspector__timing" aria-label="节点执行计时">
            <div className="agent-execution-inspector__timing-item">
              <span className="agent-execution-inspector__timing-label">开始</span>
              <time className="agent-execution-inspector__timing-value" dateTime={node.timing.startedAt}>{formatExecutionTimestamp(node.timing.startedAt)}</time>
            </div>
            <div className="agent-execution-inspector__timing-item">
              <span className="agent-execution-inspector__timing-label">最近进度</span>
              <time className="agent-execution-inspector__timing-value" dateTime={node.timing.updatedAt}>{formatExecutionTimestamp(node.timing.updatedAt)}</time>
            </div>
            <div className="agent-execution-inspector__timing-item">
              <span className="agent-execution-inspector__timing-label">{node.timing.live ? '实时耗时' : '总耗时'}</span>
              <strong className="agent-execution-inspector__timing-duration">{formatElapsedDuration(node.timing.elapsedMs)}</strong>
            </div>
          </section>
        ) : null}
        {node.diagnostics ? (
          <section className="agent-execution-inspector__diagnostics" aria-label="节点诊断结论">
            <div className="agent-execution-inspector__scope-statuses">
              <div className="agent-execution-inspector__scope-status">
                <span className="agent-execution-inspector__scope-label">整个任务</span>
                <strong className={`agent-execution-inspector__scope-value agent-execution-inspector__scope-value--${node.diagnostics.taskStatus}`}>
                  {statusLabel(node.diagnostics.taskStatus)}
                </strong>
              </div>
              <div className="agent-execution-inspector__scope-status">
                <span className="agent-execution-inspector__scope-label">当前节点</span>
                <strong className={`agent-execution-inspector__scope-value agent-execution-inspector__scope-value--${node.status}`}>
                  {statusLabel(node.status)}
                </strong>
              </div>
            </div>
            <p className="agent-execution-inspector__conclusion">{node.diagnostics.conclusion}</p>
            <section className="agent-execution-inspector__invocations" aria-label="工具调用详情">
              <header className="agent-execution-inspector__section-header">
                <strong className="agent-execution-inspector__section-title">工具调用</strong>
                <span className="agent-execution-inspector__section-count">{node.diagnostics.invocations.length}</span>
              </header>
              {node.diagnostics.invocations.length > 0 ? (
                <div className="agent-execution-inspector__invocation-list">
                  {node.diagnostics.invocations.map((invocation, index) => (
                    <ToolInvocationRow invocation={invocation} index={index} observedAtMs={observedAtMs} key={invocation.toolCallId} />
                  ))}
                </div>
              ) : <p className="agent-execution-inspector__section-empty">本节点尚无工具调用事实。</p>}
            </section>
            <section className="agent-execution-inspector__roles" aria-label="子 Agent 委派详情">
              <header className="agent-execution-inspector__section-header">
                <strong className="agent-execution-inspector__section-title">子 Agent 委派</strong>
                <span className="agent-execution-inspector__section-count">{node.diagnostics.roles.length}</span>
              </header>
              {node.diagnostics.roles.length > 0 ? node.diagnostics.roles.map((role, index) => (
                <div className="agent-execution-inspector__role" key={`${role.agentId}-${role.occurredAt}-${index}`}>
                  <strong className="agent-execution-inspector__role-name">{role.roleName || '未命名 Agent'}</strong>
                  <span className="agent-execution-inspector__role-status">{role.status}</span>
                  <p className="agent-execution-inspector__role-summary">{role.summary || '未提供进度摘要'}</p>
                  <time className="agent-execution-inspector__role-time" dateTime={role.occurredAt}>{formatExecutionTimestamp(role.occurredAt)}</time>
                </div>
              )) : <p className="agent-execution-inspector__section-empty">本节点未委派子 Agent。</p>}
            </section>
            {node.diagnostics.warnings.length > 0 || node.diagnostics.errors.length > 0 ? (
              <section className="agent-execution-inspector__global-issues" aria-label="节点级异常">
                <header className="agent-execution-inspector__section-header">
                  <strong className="agent-execution-inspector__section-title">节点级异常</strong>
                  <span className="agent-execution-inspector__section-count">{node.diagnostics.warnings.length + node.diagnostics.errors.length}</span>
                </header>
                {[...node.diagnostics.errors, ...node.diagnostics.warnings].map((message, index) => (
                  <p className="agent-execution-inspector__global-issue" key={`${node.id}-global-issue-${index}`}>{message}</p>
                ))}
              </section>
            ) : null}
          </section>
        ) : null}
        {node.promptAssemblies && node.promptAssemblies.length > 0 ? (
          <VideoPromptAssemblyInspector assemblies={node.promptAssemblies} />
        ) : null}
        {knowledgeReceipt ? <RuntimeKnowledgeInspector receipt={knowledgeReceipt} /> : null}
        {executionTraceId ? <ExecutionEventLogInspector traceId={executionTraceId} workflowNodeId={workflowNodeId} /> : null}
        <details className="agent-execution-inspector__facts">
          <summary className="agent-execution-inspector__facts-summary">节点事实字段 · {node.details.length}</summary>
          <div className="agent-execution-inspector__facts-body">
            {node.details.map((detail) => (
              <div className="agent-execution-inspector__row" key={`${node.id}-${detail.label}`}>
                <span className="agent-execution-inspector__label">{detail.label}</span>
                <code className="agent-execution-inspector__value">{detail.value}</code>
              </div>
            ))}
          </div>
        </details>
        <section className="agent-execution-inspector__events" aria-label="节点执行事件">
          <header className="agent-execution-inspector__events-header">
            <strong className="agent-execution-inspector__events-title">执行事件</strong>
            <span className="agent-execution-inspector__events-count">{events.length}</span>
          </header>
          {nextBeforeSeq !== null ? (
            <Button
              className="agent-execution-inspector__load-older"
              variant="subtle"
              size="compact-xs"
              disabled={loading}
              onClick={() => void loadEvents(nextBeforeSeq, true)}
            >
              加载更早事件
            </Button>
          ) : null}
          {loading ? <Loader className="agent-execution-inspector__events-loader" size="xs" /> : null}
          {error ? <p className="agent-execution-inspector__events-error">{error}</p> : null}
          {!loading && !error && events.length === 0 ? (
            <p className="agent-execution-inspector__events-empty">当前节点尚无追加事件</p>
          ) : null}
          <div className="agent-execution-inspector__event-list">
            {events.map((event) => (
              <article className="agent-execution-inspector__event" key={event.eventId}>
                <header className="agent-execution-inspector__event-header">
                  <span className="agent-execution-inspector__event-seq">#{event.seq}</span>
                  <strong className="agent-execution-inspector__event-kind">{event.kind}</strong>
                  <time className="agent-execution-inspector__event-time" dateTime={event.occurredAt}>{formatExecutionTimestamp(event.occurredAt)}</time>
                </header>
                <code className="agent-execution-inspector__event-ref">{event.payloadRef ?? '无 payloadRef'}</code>
                {event.artifactIds.length > 0 ? <span className="agent-execution-inspector__event-assets">{`artifacts · ${event.artifactIds.join(', ')}`}</span> : null}
                {event.effectIds.length > 0 ? <span className="agent-execution-inspector__event-effects">{`effects · ${event.effectIds.join(', ')}`}</span> : null}
              </article>
            ))}
          </div>
        </section>
      </div>
    </aside>
  )
}
