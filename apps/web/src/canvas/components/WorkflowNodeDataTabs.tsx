import React from 'react'
import { ActionIcon } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { useRFStore } from '../store'
import { isWorkflowCollection } from '@tapcanvas/workflow-kernel-protocol'
import { useUIStore } from '../../ui/uiStore'
import { stringifyWorkflowValue } from '../workflowJavascriptSandbox'
import { workflowPortFromHandle } from '../workflowCanvasPorts'
import { readWorkflowItemRuns } from '../workflowItemRuns'
import {
  toWorkflowNodeRunHistoryView,
  workflowNodeEmptyOutputMessage,
  workflowNodeRunStatusLabel,
  type WorkflowNodeRunHistoryView,
} from '../workflowNodeRunHistory'
import { PersistedWorkflowField, dataRecord, nodeLabel, nodeOperation, readString, resolveConnectedInput } from './workflowNodeInspectorShared'
import { WorkflowItemOutputList } from './WorkflowItemOutputList'
import { loadWorkflowNodeRunHistory } from '../workflowNodeHistoryLoader'
import { WorkflowAgentContextOverview } from './WorkflowAgentContextOverview'
import {
  isWorkflowAgentNode,
  readWorkflowAgentExecutionProvenance,
  readWorkflowAgentExecutionProvenanceHistory,
} from '../workflowAgentContext'

type ConnectedInputHistory = Readonly<{
  sourceNodeId: string
  sourceLabel: string
  sourcePort: string
  targetPort: string
  run: WorkflowNodeRunHistoryView | null
}>

function hasPreviewValue(value: unknown): boolean {
  if (value === null || typeof value === 'undefined') return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

function effectiveOutputRun(runs: readonly WorkflowNodeRunHistoryView[]): WorkflowNodeRunHistoryView | null {
  return runs.find((run) => (
    typeof run.output !== 'undefined'
    || run.itemRuns.length > 0
    || run.artifactIds.length > 0
  )) ?? null
}

export function InputTab(props: Readonly<{
  nodeId: string
  data: Record<string, unknown>
  readOnly: boolean
}>): React.JSX.Element {
  const nodes = useRFStore((state) => state.nodes)
  const edges = useRFStore((state) => state.edges)
  const flowId = useUIStore((state) => String(state.currentFlow.id || '').trim())
  const incoming = edges.filter((edge) => edge.target === props.nodeId)
  const incomingIdentity = incoming.map((edge) => (
    `${edge.id}\u0000${edge.source}\u0000${edge.sourceHandle ?? ''}\u0000${edge.targetHandle ?? ''}`
  )).join('\u0001')
  const incomingRuntimeIdentity = incoming.map((edge) => {
    const source = nodes.find((candidate) => candidate.id === edge.source)
    const sourceData = dataRecord(source?.data)
    return `${edge.source}\u0000${readString(sourceData, 'workflowRunId')}\u0000${readString(sourceData, 'workflowGeneratedAt')}`
  }).join('\u0001')
  const [durableInputs, setDurableInputs] = React.useState<readonly ConnectedInputHistory[]>([])
  const [durableLoading, setDurableLoading] = React.useState(false)
  const [durableError, setDurableError] = React.useState<string | null>(null)
  const [durableReloadRevision, setDurableReloadRevision] = React.useState(0)
  const [contextRun, setContextRun] = React.useState<WorkflowNodeRunHistoryView | null>(null)
  const [contextLoading, setContextLoading] = React.useState(false)
  const [contextError, setContextError] = React.useState<string | null>(null)
  const operation = nodeOperation(props.data)
  const agentNode = isWorkflowAgentNode(props.data)
  let inputPreview: unknown = null
  let inputPreviewError = ''
  try {
    inputPreview = resolveConnectedInput(props.nodeId)
  } catch (error: unknown) {
    inputPreviewError = error instanceof Error ? error.message : '无法解析上游输入'
  }

  React.useEffect(() => {
    let active = true
    if (!flowId || incoming.length === 0) {
      setDurableInputs([])
      setDurableLoading(false)
      setDurableError(null)
      return () => { active = false }
    }
    setDurableLoading(true)
    setDurableInputs([])
    setDurableError(null)
    void Promise.all(incoming.map(async (edge): Promise<ConnectedInputHistory> => {
      const source = nodes.find((candidate) => candidate.id === edge.source)
      const sourceData = dataRecord(source?.data)
      const runs = await loadWorkflowNodeRunHistory({ flowId, nodeId: edge.source, data: sourceData, limit: 20 })
      return {
        sourceNodeId: edge.source,
        sourceLabel: nodeLabel(sourceData, edge.source),
        sourcePort: workflowPortFromHandle(edge.sourceHandle, 'output') ?? '未声明',
        targetPort: workflowPortFromHandle(edge.targetHandle, 'input') ?? '未声明',
        run: effectiveOutputRun(runs.map(toWorkflowNodeRunHistoryView)),
      }
    }))
      .then((result) => {
        if (active) setDurableInputs(result)
      })
      .catch((error: unknown) => {
        if (!active) return
        setDurableInputs([])
        setDurableError(error instanceof Error ? error.message : '无法读取上游持久输出')
      })
      .finally(() => {
        if (active) setDurableLoading(false)
      })
    return () => { active = false }
  // The serialized identity is deliberate: React Flow recreates edge arrays during selection changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId, incomingIdentity, incomingRuntimeIdentity, durableReloadRevision])

  React.useEffect(() => {
    let active = true
    if (!flowId || !agentNode) {
      setContextRun(null)
      setContextLoading(false)
      setContextError(null)
      return () => { active = false }
    }
    setContextLoading(true)
    setContextError(null)
    void loadWorkflowNodeRunHistory({ flowId, nodeId: props.nodeId, data: props.data, limit: 1 })
      .then((runs) => {
        if (!active) return
        setContextRun(runs[0] ? toWorkflowNodeRunHistoryView(runs[0]) : null)
      })
      .catch((error: unknown) => {
        if (!active) return
        setContextRun(null)
        setContextError(error instanceof Error ? error.message : '无法读取本轮上下文证据')
      })
      .finally(() => {
        if (active) setContextLoading(false)
      })
    return () => { active = false }
  }, [agentNode, durableReloadRevision, flowId, props.nodeId, props.data.workflowRunId, props.data.workflowRunHistoryIds])

  const hasCurrentInput = !inputPreviewError && hasPreviewValue(inputPreview)
  const executionProvenance = readWorkflowAgentExecutionProvenance(contextRun?.outputRefs)
  const executionProvenanceHistory = readWorkflowAgentExecutionProvenanceHistory(contextRun?.outputRefs)
  return (
    <div className="workflow-node-inspector__tab-content">
      <section className="workflow-node-inspector__section" aria-label="输入连接">
        <h3 className="workflow-node-inspector__section-title">输入连接</h3>
        {incoming.length > 0 ? (
          <ul className="workflow-node-inspector__connection-list">
            {incoming.map((edge) => {
              const source = nodes.find((candidate) => candidate.id === edge.source)
              return (
                <li className="workflow-node-inspector__connection" key={edge.id}>
                  <strong className="workflow-node-inspector__connection-name">{nodeLabel(dataRecord(source?.data), edge.source)}</strong>
                  <span className="workflow-node-inspector__connection-port">
                    {workflowPortFromHandle(edge.sourceHandle, 'output') ?? '未声明'} → {workflowPortFromHandle(edge.targetHandle, 'input') ?? '未声明'}
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="workflow-node-inspector__empty">当前节点没有上游连接。</p>
        )}
      </section>
      {agentNode ? (
        <WorkflowAgentContextOverview
          className="workflow-node-data__agent-context"
          nodeId={props.nodeId}
          data={props.data}
          provenance={executionProvenance}
          provenanceHistory={executionProvenanceHistory}
          runtimeLoading={contextLoading}
          runtimeError={contextError}
          showRuntime
        />
      ) : null}
      {(operation === 'javascript' || operation === 'collection_split') && incoming.length === 0 ? (
        <PersistedWorkflowField
          nodeId={props.nodeId}
          dataKey="workflowNodeTestInput"
          label="独立测试输入（JSON）"
          placeholder={operation === 'collection_split'
            ? '[{"id":"item-1","text":"第一项"}]'
            : '{ "text": "hello" }'}
          value={readString(props.data, 'workflowNodeTestInput')}
          readOnly={props.readOnly}
          multiline
          code
        />
      ) : null}
      <section className="workflow-node-inspector__section" aria-label="当前画布输入">
        <h3 className="workflow-node-inspector__section-title">当前画布输入</h3>
        {hasCurrentInput ? (
          <pre className="workflow-node-inspector__code-block">{stringifyWorkflowValue(inputPreview)}</pre>
        ) : (
          <p className={inputPreviewError ? 'workflow-node-inspector__help workflow-node-inspector__help--error' : 'workflow-node-inspector__empty'}>
            {inputPreviewError || '当前画布还没有活动运行输出；下面会读取上游最近一次有效持久产出。'}
          </p>
        )}
      </section>
      {incoming.length > 0 ? (
        <section className="workflow-node-inspector__section" aria-label="上游持久输入">
          <div className="workflow-node-inspector__section-heading">
            <h3 className="workflow-node-inspector__section-title">上游最近有效产出</h3>
            <div className="workflow-node-inspector__section-actions">
              <span className="workflow-node-inspector__section-count">
                {durableLoading ? '读取中' : `${durableInputs.filter((input) => input.run).length}/${incoming.length} 路`}
              </span>
              {durableError ? (
                <ActionIcon
                  className="workflow-node-inspector__section-action"
                  aria-label="重新读取上游产出"
                  title="重新读取上游产出"
                  variant="subtle"
                  size="sm"
                  onClick={() => setDurableReloadRevision((revision) => revision + 1)}
                >
                  <IconRefresh className="workflow-node-inspector__section-action-icon" size={14} aria-hidden="true" />
                </ActionIcon>
              ) : null}
            </div>
          </div>
          {durableError ? <p className="workflow-node-inspector__help workflow-node-inspector__help--error">{durableError}</p> : null}
          {!durableLoading && !durableError ? durableInputs.map((input) => (
            <article className="workflow-node-inspector__durable-input" key={`${input.sourceNodeId}:${input.sourcePort}:${input.targetPort}`}>
              <header className="workflow-node-inspector__durable-input-heading">
                <strong className="workflow-node-inspector__connection-name">{input.sourceLabel}</strong>
                <span className="workflow-node-inspector__connection-port">{input.sourcePort} → {input.targetPort}</span>
              </header>
              {input.run ? (
                <>
                  <p className="workflow-node-inspector__evidence">
                    {new Date(input.run.createdAt).toLocaleString('zh-CN', { hour12: false })} · {workflowNodeRunStatusLabel(input.run.status, input.run.outputRefs)}
                  </p>
                  {input.run.itemRuns.length > 0 ? (
                    <WorkflowItemOutputList items={input.run.itemRuns} ariaLabel={`${input.sourceLabel} 持久逐项输入`} />
                  ) : hasPreviewValue(input.run.output) ? (
                    <pre className="workflow-node-inspector__code-block">{stringifyWorkflowValue(input.run.output)}</pre>
                  ) : (
                    <p className="workflow-node-inspector__empty">最近的有效记录没有声明可展示输出端口。</p>
                  )}
                </>
              ) : (
                <p className="workflow-node-inspector__empty">这个上游节点还没有有效持久产出。</p>
              )}
            </article>
          )) : null}
        </section>
      ) : null}
    </div>
  )
}

export function OutputTab(props: Readonly<{
  nodeId: string
  data: Record<string, unknown>
}>): React.JSX.Element {
  const flowId = useUIStore((state) => String(state.currentFlow.id || '').trim())
  const [latestRun, setLatestRun] = React.useState<WorkflowNodeRunHistoryView | null>(null)
  const [latestOutputRun, setLatestOutputRun] = React.useState<WorkflowNodeRunHistoryView | null>(null)
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const [historyError, setHistoryError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let active = true
    if (!flowId) {
      setLatestRun(null)
      setLatestOutputRun(null)
      setHistoryError(null)
      setHistoryLoading(false)
      return () => { active = false }
    }
    setHistoryLoading(true)
    setHistoryError(null)
    void loadWorkflowNodeRunHistory({ flowId, nodeId: props.nodeId, data: props.data, limit: 20 })
      .then((runs) => {
        if (!active) return
        const history = runs.map(toWorkflowNodeRunHistoryView)
        setLatestRun(history[0] ?? null)
        setLatestOutputRun(effectiveOutputRun(history))
      })
      .catch((error: unknown) => {
        if (!active) return
        setLatestRun(null)
        setLatestOutputRun(null)
        setHistoryError(error instanceof Error ? error.message : '无法读取最近一次节点输出')
      })
      .finally(() => {
        if (active) setHistoryLoading(false)
      })
    return () => { active = false }
  }, [flowId, props.nodeId, props.data.workflowKey, props.data.workflowNodeId, props.data.workflowRunId, props.data.workflowRunHistoryIds])

  const output = latestOutputRun
    ? latestOutputRun.output
    : props.data.workflowLocalTestOutput
  const executionEvidence = latestOutputRun
    ? latestOutputRun.evidence
    : props.data.workflowExecutionEvidence
  const resultSummary = latestOutputRun ? '' : readString(props.data, 'workflowResultSummary')
  const errorDetail = latestRun
    ? latestRun.errorMessage ?? ''
    : readString(props.data, 'workflowLocalTestError') || readString(props.data, 'workflowErrorDetail')
  const liveArtifactIds = Array.isArray(props.data.workflowOutputArtifactIds)
    ? props.data.workflowOutputArtifactIds.filter((item): item is string => typeof item === 'string')
    : []
  const artifactIds = latestOutputRun?.artifactIds ?? liveArtifactIds
  const mediaAssets = latestOutputRun?.mediaAssets ?? []
  const provenance = latestOutputRun?.provenance ?? null
  const liveItemRuns = readWorkflowItemRuns(props.data.workflowItemRuns)
  const itemRuns = latestOutputRun ? latestOutputRun.itemRuns : liveItemRuns
  const outputRecord = dataRecord(output)
  const collection = Object.values(outputRecord).find(isWorkflowCollection) ?? null
  const outputText = stringifyWorkflowValue(output)
  const isShowingEarlierOutput = Boolean(
    latestRun
    && latestOutputRun
    && latestRun.id !== latestOutputRun.id,
  )
  return (
    <div className="workflow-node-inspector__tab-content">
      {latestRun ? (
        <section className="workflow-node-inspector__section" aria-label="最近持久执行">
          <div className="workflow-node-inspector__section-heading">
            <h3 className="workflow-node-inspector__section-title">最近持久执行</h3>
            <span className="workflow-node-inspector__section-count">{workflowNodeRunStatusLabel(latestRun.status, latestRun.outputRefs)}</span>
          </div>
          <p className="workflow-node-inspector__evidence">
            {latestRun.executionId} · {new Date(latestRun.createdAt).toLocaleString('zh-CN', { hour12: false })}
          </p>
        </section>
      ) : null}
      {isShowingEarlierOutput && latestOutputRun ? (
        <section className="workflow-node-inspector__section" aria-label="历史有效产出">
          <div className="workflow-node-inspector__section-heading">
            <h3 className="workflow-node-inspector__section-title">历史有效产出</h3>
            <span className="workflow-node-inspector__section-count">保留展示</span>
          </div>
          <p className="workflow-node-inspector__evidence">
            最新运行没有产出，下面展示 {new Date(latestOutputRun.createdAt).toLocaleString('zh-CN', { hour12: false })} 的最近一次有效结果。
          </p>
        </section>
      ) : null}
      <section className="workflow-node-inspector__section" aria-label="节点输出">
        <div className="workflow-node-inspector__section-heading">
          <h3 className="workflow-node-inspector__section-title">节点输出</h3>
          {itemRuns.length > 0
            ? <span className="workflow-node-inspector__section-count">{itemRuns.length} 条运行记录</span>
            : collection
              ? <span className="workflow-node-inspector__section-count">{collection.items.length} 项</span>
              : null}
        </div>
        {itemRuns.length > 0 ? (
          <WorkflowItemOutputList items={itemRuns} ariaLabel="逐项运行输出" />
        ) : collection ? (
          <ol className="workflow-node-inspector__collection" aria-label="集合输出数据项">
            {collection.items.map((item) => (
              <li className="workflow-node-inspector__collection-item" key={item.itemId}>
                <details className="workflow-node-inspector__collection-details">
                  <summary className="workflow-node-inspector__collection-summary">
                    <span className="workflow-node-inspector__collection-index">#{item.index + 1}</span>
                    <strong className="workflow-node-inspector__collection-id">{item.itemId}</strong>
                    <span className="workflow-node-inspector__collection-lineage">{item.lineage.length} 级来源</span>
                  </summary>
                  <pre className="workflow-node-inspector__code-block workflow-node-inspector__code-block--collection">{stringifyWorkflowValue(item.value)}</pre>
                </details>
              </li>
            ))}
          </ol>
        ) : outputText ? (
          <pre className="workflow-node-inspector__code-block">
            {outputText}
          </pre>
        ) : (
          <p className="workflow-node-inspector__empty">
            {workflowNodeEmptyOutputMessage(latestOutputRun ?? latestRun, historyLoading)}
          </p>
        )}
      </section>
      {historyError ? (
        <section className="workflow-node-inspector__section" aria-label="输出读取错误">
          <h3 className="workflow-node-inspector__section-title">输出读取错误</h3>
          <pre className="workflow-node-inspector__code-block workflow-node-inspector__code-block--error">{historyError}</pre>
        </section>
      ) : null}
      {resultSummary ? (
        <section className="workflow-node-inspector__section" aria-label="工作流结果摘要">
          <h3 className="workflow-node-inspector__section-title">工作流结果摘要</h3>
          <p className="workflow-node-inspector__evidence">{resultSummary}</p>
        </section>
      ) : null}
      {errorDetail ? (
        <section className="workflow-node-inspector__section" aria-label="运行错误">
          <h3 className="workflow-node-inspector__section-title">运行错误</h3>
          <pre className="workflow-node-inspector__code-block workflow-node-inspector__code-block--error">{errorDetail}</pre>
        </section>
      ) : null}
      {typeof executionEvidence !== 'undefined' ? (
        <section className="workflow-node-inspector__section" aria-label="执行证据">
          <h3 className="workflow-node-inspector__section-title">执行证据</h3>
          <pre className="workflow-node-inspector__code-block">{stringifyWorkflowValue(executionEvidence)}</pre>
        </section>
      ) : null}
      {provenance ? (
        <section className="workflow-node-inspector__section" aria-label="运行来源">
          <h3 className="workflow-node-inspector__section-title">运行来源</h3>
          <p className="workflow-node-inspector__evidence">
            {provenance.nodeRunId} · 第 {provenance.attempt} 次尝试 · {provenance.inputBindings.length} 条上游绑定
          </p>
          <pre className="workflow-node-inspector__code-block">{stringifyWorkflowValue(provenance)}</pre>
        </section>
      ) : null}
      {mediaAssets.length > 0 ? (
        <section className="workflow-node-inspector__section" aria-label="媒体资产">
          <h3 className="workflow-node-inspector__section-title">媒体资产</h3>
          <pre className="workflow-node-inspector__code-block">{mediaAssets.map((asset) => `${asset.kind} · ${asset.url}`).join('\n')}</pre>
        </section>
      ) : null}
      <section className="workflow-node-inspector__section" aria-label="交付证据">
        <h3 className="workflow-node-inspector__section-title">交付证据</h3>
        <p className="workflow-node-inspector__evidence">
          {artifactIds.length > 0 ? artifactIds.join('\n') : '尚无持久产物身份'}
        </p>
      </section>
    </div>
  )
}
