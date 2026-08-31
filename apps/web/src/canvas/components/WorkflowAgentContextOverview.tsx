import React from 'react'
import { useRFStore } from '../store'
import { workflowPortFromHandle } from '../workflowCanvasPorts'
import { buildRuntimeKnowledgeReceipt } from '../../ui/agent-diagnostics/runtimeKnowledgeEvidence'
import type { AgentExecutionProvenanceDto } from '../../api/server'
import {
  readWorkflowAgentDeclaredContext,
  workflowAgentContextPortLabel,
  workflowAgentToolLabel,
  type WorkflowAgentContextPort,
} from '../workflowAgentContext'
import { dataRecord, nodeLabel } from './workflowNodeInspectorShared'

type WorkflowAgentContextOverviewProps = Readonly<{
  className: string
  nodeId: string
  data: Record<string, unknown>
  provenance?: AgentExecutionProvenanceDto | null
  provenanceHistory?: readonly AgentExecutionProvenanceDto[]
  runtimeLoading?: boolean
  runtimeError?: string | null
  showRuntime?: boolean
}>

function contextSourceKindLabel(kind: string): string {
  if (kind === 'skill') return 'Skill'
  if (kind === 'skill_reference') return 'Reference'
  if (kind === 'knowledge') return '知识文档'
  if (kind === 'project_fact') return '项目事实'
  if (kind === 'clip_fact') return 'Clip 事实'
  if (kind === 'compiler') return '执行规则'
  return '资产绑定'
}

export function WorkflowAgentContextOverview(props: WorkflowAgentContextOverviewProps): React.JSX.Element {
  const nodes = useRFStore((state) => state.nodes)
  const edges = useRFStore((state) => state.edges)
  const declared = readWorkflowAgentDeclaredContext(props.data)
  const contextConnections = edges.flatMap((edge) => {
    if (edge.target !== props.nodeId) return []
    const port = workflowPortFromHandle(edge.targetHandle, 'input')
    if (!port || !declared.optionalContextPorts.includes(port as WorkflowAgentContextPort)) return []
    const source = nodes.find((node) => node.id === edge.source)
    return [{
      id: edge.id,
      label: nodeLabel(dataRecord(source?.data), edge.source),
      port: port as WorkflowAgentContextPort,
    }]
  })
  const knowledgeAccess = declared.allowedTools.includes('knowledge_search')
    && declared.allowedTools.includes('knowledge_read')
  const provenanceHistory = props.provenanceHistory?.length
    ? [...props.provenanceHistory]
    : props.provenance
      ? [props.provenance]
      : []
  const runtimeReceipts = provenanceHistory.flatMap((provenance) => {
    const receipt = buildRuntimeKnowledgeReceipt({ provenance, promptAssemblies: [] })
    return receipt ? [{ provenance, receipt }] : []
  })
  const latestProvenance = provenanceHistory[provenanceHistory.length - 1] ?? null

  return (
    <section className={`workflow-node-inspector__section workflow-agent-context ${props.className}`} aria-label="能力与上下文">
      <div className="workflow-node-inspector__section-heading workflow-agent-context__heading">
        <h3 className="workflow-node-inspector__section-title workflow-agent-context__title">能力与上下文</h3>
        <span className="workflow-node-inspector__section-count workflow-agent-context__policy">
          {knowledgeAccess ? '知识按需读取' : '无动态知识权限'}
        </span>
      </div>
      <div className="workflow-agent-context__declared" aria-label="节点能力范围">
        <p className="workflow-agent-context__group-label">统一知识能力</p>
        <p className="workflow-node-inspector__evidence workflow-agent-context__summary">
          默认可检索完整 Skill 目录与完整向量知识库；Agent 根据本轮任务选择并渐进读取，无需节点挂载。
        </p>
        {declared.allowedTools.length > 0 ? (
          <ul className="workflow-agent-context__list" aria-label="允许工具">
            {declared.allowedTools.map((tool) => (
              <li className="workflow-agent-context__row" key={`tool:${tool}`}>
                <strong className="workflow-agent-context__name">{workflowAgentToolLabel(tool)}</strong>
                <code className="workflow-agent-context__ref">{tool}</code>
              </li>
            ))}
          </ul>
        ) : null}
        {contextConnections.length > 0 ? (
          <ul className="workflow-agent-context__list" aria-label="上下文连接">
            {contextConnections.map((connection) => (
              <li className="workflow-agent-context__row" key={connection.id}>
                <strong className="workflow-agent-context__name">{connection.label}</strong>
                <span className="workflow-agent-context__meta">{workflowAgentContextPortLabel(connection.port)}</span>
              </li>
            ))}
          </ul>
        ) : declared.optionalContextPorts.length > 0 ? (
          <p className="workflow-node-inspector__empty workflow-agent-context__empty">
            已开放 {declared.optionalContextPorts.map(workflowAgentContextPortLabel).join('、')}；当前没有固定上游输入。
          </p>
        ) : null}
      </div>
      {props.showRuntime ? (
        <div className="workflow-agent-context__runtime" aria-label="本轮实际读取">
          <div className="workflow-agent-context__runtime-heading">
            <p className="workflow-agent-context__group-label">本轮实际读取</p>
            {latestProvenance ? (
              <span className="workflow-agent-context__model">{latestProvenance.model}</span>
            ) : null}
          </div>
          {props.runtimeError ? (
            <p className="workflow-node-inspector__help workflow-node-inspector__help--error workflow-agent-context__runtime-state">{props.runtimeError}</p>
          ) : props.runtimeLoading ? (
            <p className="workflow-node-inspector__empty workflow-agent-context__runtime-state">正在读取最近一次运行证据…</p>
          ) : runtimeReceipts.length > 0 ? (
            <div className="workflow-agent-context__physical-runs" aria-label="物理执行窗口">
              {runtimeReceipts.map(({ provenance, receipt }, index) => (
                <div className="workflow-agent-context__physical-run" key={provenance.executionId}>
                  {runtimeReceipts.length > 1 ? (
                    <p className="workflow-agent-context__group-label">
                      物理窗口 {index + 1}/{runtimeReceipts.length}
                    </p>
                  ) : null}
                  <p className="workflow-node-inspector__evidence workflow-agent-context__summary">{receipt.summary}</p>
                  <ul className="workflow-agent-context__list workflow-agent-context__list--runtime" aria-label="实际加载来源">
                    {receipt.sources.map((source) => (
                      <li className="workflow-agent-context__source" key={`${provenance.executionId}:${source.kind}:${source.ref}`}>
                        <div className="workflow-agent-context__source-heading">
                          <strong className="workflow-agent-context__name">{source.label}</strong>
                          <span className="workflow-agent-context__meta">{contextSourceKindLabel(source.kind)} · {source.status === 'applied' ? '已使用' : '等待证据'}</span>
                        </div>
                        <span className="workflow-agent-context__source-summary">{source.summary}</span>
                        <code className="workflow-agent-context__ref workflow-agent-context__source-ref">{source.ref}</code>
                      </li>
                    ))}
                  </ul>
                  <code className="workflow-agent-context__execution-id">executionId={provenance.executionId}</code>
                </div>
              ))}
            </div>
          ) : (
            <p className="workflow-node-inspector__empty workflow-agent-context__runtime-state">
              最近一次运行没有 executionProvenance；无法把目录权限或候选召回冒充为实际读取。
            </p>
          )}
        </div>
      ) : (
        <p className="workflow-node-inspector__help workflow-agent-context__help">
          配置页显示统一可用范围；实际加载的 Skill、Reference 和知识文档会在“输入”页按运行证据回显。
        </p>
      )}
    </section>
  )
}
