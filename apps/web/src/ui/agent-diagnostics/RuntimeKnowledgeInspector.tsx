import React from 'react'

import type { ExecutionKnowledgeReceipt, ExecutionKnowledgeSource } from './executionGraph.types'

type RuntimeKnowledgeInspectorProps = {
  receipt: ExecutionKnowledgeReceipt
}

const GROUPS: Array<{
  id: string
  label: string
  kinds: ExecutionKnowledgeSource['kind'][]
}> = [
  { id: 'skills', label: 'Skill 与实际读取的 Reference', kinds: ['skill', 'skill_reference'] },
  { id: 'knowledge', label: '知识库文档', kinds: ['knowledge'] },
  { id: 'facts', label: '项目与 Clip 事实', kinds: ['project_fact', 'clip_fact'] },
  { id: 'rules', label: '确定性执行规则', kinds: ['compiler', 'asset_binding'] },
]

function statusLabel(status: ExecutionKnowledgeSource['status']): string {
  if (status === 'applied') return '已使用'
  if (status === 'not_used') return '本轮未用'
  if (status === 'pending') return '等待回传'
  return '不可追溯'
}

function stateLabel(state: ExecutionKnowledgeReceipt['state']): string {
  if (state === 'complete') return '来源完整'
  if (state === 'pending') return '仍在收集'
  return '部分可追溯'
}

export default function RuntimeKnowledgeInspector(props: RuntimeKnowledgeInspectorProps): JSX.Element {
  const { receipt } = props
  return (
    <section className="agent-execution-prompt agent-execution-knowledge" aria-label="小T本轮使用的 Knowledge 与运行来源">
      <header className="agent-execution-prompt__header agent-execution-knowledge__header">
        <div className="agent-execution-prompt__heading agent-execution-knowledge__heading">
          <strong className="agent-execution-prompt__title agent-execution-knowledge__title">小T本轮实际使用的上下文</strong>
          <p className="agent-execution-prompt__description agent-execution-knowledge__description">
            只展示实际加载的 Skill、Reference、知识库文档、项目事实和执行规则；不展示 Skill 正文。
          </p>
        </div>
        <span className={`agent-execution-prompt__state agent-execution-prompt__state--${receipt.state}`}>
          {stateLabel(receipt.state)}
        </span>
      </header>
      <p className="agent-execution-prompt__summary agent-execution-knowledge__summary">{receipt.summary}</p>
      <div className="agent-execution-prompt__list agent-execution-knowledge__groups">
        {GROUPS.map((group) => {
          const sources = receipt.sources.filter((source) => group.kinds.includes(source.kind))
          if (sources.length === 0) return null
          return (
            <details className="agent-execution-prompt__item agent-execution-knowledge__group" key={group.id}>
              <summary className="agent-execution-prompt__item-summary agent-execution-knowledge__group-summary">
                <strong className="agent-execution-prompt__clip agent-execution-knowledge__group-title">{group.label}</strong>
                <span className="agent-execution-prompt__artifact agent-execution-knowledge__group-note">按本轮真实证据聚合</span>
                <span className="agent-execution-prompt__section-count agent-execution-knowledge__group-count">{sources.length}</span>
              </summary>
              <div className="agent-execution-prompt__item-body agent-execution-knowledge__group-body">
                <div className="agent-execution-prompt__source-list agent-execution-knowledge__source-list">
                  {sources.map((source) => (
                    <article className={`agent-execution-prompt__source agent-execution-prompt__source--${source.status} agent-execution-knowledge__source`} key={sourceKey(source)}>
                      <header className="agent-execution-prompt__source-header agent-execution-knowledge__source-header">
                        <strong className="agent-execution-prompt__source-label agent-execution-knowledge__source-label">{source.label}</strong>
                        <span className="agent-execution-prompt__source-status agent-execution-knowledge__source-status">{statusLabel(source.status)}</span>
                      </header>
                      <p className="agent-execution-prompt__source-summary agent-execution-knowledge__source-summary">{source.summary}</p>
                      <p className="agent-execution-prompt__source-summary agent-execution-knowledge__used-by">使用者：{source.usedBy.join('、')}</p>
                      <code className="agent-execution-prompt__source-ref agent-execution-knowledge__source-ref">{source.ref}</code>
                      {source.contentHash ? (
                        <code className="agent-execution-prompt__source-ref agent-execution-knowledge__source-hash">
                          version={source.contentHash}
                        </code>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
            </details>
          )
        })}
      </div>
      {receipt.rootExecutionId ? (
        <code className="agent-execution-prompt__source-ref agent-execution-knowledge__execution-id">executionId={receipt.rootExecutionId}</code>
      ) : null}
    </section>
  )
}

function sourceKey(source: ExecutionKnowledgeSource): string {
  return `${source.kind}:${source.ref}`
}
