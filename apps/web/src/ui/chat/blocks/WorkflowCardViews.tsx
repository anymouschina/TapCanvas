import React from 'react'
import { IconChevronDown, IconCopy, IconFileText, IconSparkles } from '@tabler/icons-react'
import { focusCanvasNode, sendChatAction } from './blockActions'
import type { DataBlock, GenerationTaskPayload, SourceContractPayload } from './types'
import type { BlockViewProps } from './registry'

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : []
}

export function SourceContractView({ block }: BlockViewProps<DataBlock>) {
  const payload = block.payload as SourceContractPayload | null
  const source = String(payload?.source || '').trim()
  const scope = String(payload?.scope || '').trim()
  const mode = String(payload?.mode || '').trim()
  if (!source || !scope || !mode) return null
  const confirmed = readStringList(payload?.confirmed)
  const assumptions = readStringList(payload?.assumptions)
  const unresolved = readStringList(payload?.unresolved)
  const nodeId = String(payload?.nodeId || '').trim()
  return (
    <div className="tc-ai-card tc-ai-card--source-contract">
      <div className="tc-ai-card__header tc-ai-source-contract__header">
        <div className="tc-ai-source-contract__heading">
          <span className="tc-ai-source-contract__icon"><IconFileText className="tc-ai-source-contract__icon-svg" size={15} /></span>
          <div className="tc-ai-source-contract__heading-copy">
            <div className="tc-ai-card__title">{String(payload?.title || '本轮创作范围')}</div>
            {String(payload?.target || '').trim() ? <div className="tc-ai-source-contract__target">{payload?.target}</div> : null}
          </div>
        </div>
        {nodeId ? <button type="button" className="tc-ai-card__chip tc-ai-source-contract__locate" onClick={() => focusCanvasNode(nodeId)}>定位原文</button> : null}
      </div>
      <dl className="tc-ai-source-contract__facts">
        <div className="tc-ai-source-contract__fact"><dt className="tc-ai-source-contract__fact-label">来源</dt><dd className="tc-ai-source-contract__fact-value">{source}</dd></div>
        <div className="tc-ai-source-contract__fact"><dt className="tc-ai-source-contract__fact-label">范围</dt><dd className="tc-ai-source-contract__fact-value">{scope}</dd></div>
        <div className="tc-ai-source-contract__fact"><dt className="tc-ai-source-contract__fact-label">方式</dt><dd className="tc-ai-source-contract__fact-value">{mode}</dd></div>
      </dl>
      {confirmed.length ? <ContractSection blockId={block.id} items={confirmed} label="已确认" name="confirmed" /> : null}
      {assumptions.length ? <ContractSection blockId={block.id} items={assumptions} label="推断" name="assumption" tone="assumption" /> : null}
      {unresolved.length ? <ContractSection blockId={block.id} items={unresolved} label="待确认" name="unresolved" tone="unresolved" /> : null}
    </div>
  )
}

function ContractSection({ blockId, items, label, name, tone }: {
  blockId: string
  items: string[]
  label: string
  name: string
  tone?: 'assumption' | 'unresolved'
}): JSX.Element {
  return (
    <div className={`tc-ai-source-contract__section${tone ? ` tc-ai-source-contract__section--${tone}` : ''}`}>
      <span className="tc-ai-source-contract__label">{label}</span>
      <ul className="tc-ai-source-contract__list">{items.map((item, index) => <li className="tc-ai-source-contract__list-item" key={`${blockId}_${name}_${index}`}>{item}</li>)}</ul>
    </div>
  )
}

const GENERATION_STATUS_LABELS: Record<GenerationTaskPayload['status'], string> = {
  proposal: '待确认',
  queued: '排队中',
  running: '生成中',
  accepted_async: '已异步受理',
  succeeded: '已完成',
  partial: '部分完成',
  failed: '失败',
  cancelled: '已取消',
}

export function GenerationTaskView({ block }: BlockViewProps<DataBlock>) {
  const payload = block.payload as GenerationTaskPayload | null
  const [expanded, setExpanded] = React.useState(false)
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle')
  const title = String(payload?.title || '').trim()
  const status = payload?.status
  const kind = payload?.kind
  if (!title || !status || !kind || !GENERATION_STATUS_LABELS[status]) return null
  const prompt = String(payload?.prompt || '').trim()
  const action = String(payload?.action || '').trim()
  const nodeId = String(payload?.nodeId || '').trim()
  const assetUrl = String(payload?.assetUrl || '').trim()
  const parameters = Array.isArray(payload?.parameters)
    ? payload.parameters.filter((item) => item && String(item.label || '').trim() && String(item.value || '').trim())
    : []
  const generationProposal = prompt
    ? {
        version: 1 as const,
        proposalId: block.id,
        kind,
        title,
        prompt,
        ...(String(payload?.model || '').trim() ? { model: String(payload?.model).trim() } : {}),
        ...(parameters.length ? { parameters } : {}),
        ...(action ? { action } : {}),
        ...(nodeId ? { nodeId } : {}),
      }
    : undefined
  const cost = Number(payload?.cost)
  const copyPrompt = async (): Promise<void> => {
    if (!navigator.clipboard) {
      setCopyState('failed')
      return
    }
    try {
      await navigator.clipboard.writeText(prompt)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }
  return (
    <div className={`tc-ai-card tc-ai-card--generation-task tc-ai-card--generation-task-${status}`}>
      <div className="tc-ai-generation-task__header">
        <span className="tc-ai-generation-task__icon"><IconSparkles className="tc-ai-generation-task__icon-svg" size={15} /></span>
        <span className="tc-ai-generation-task__heading">
          <span className="tc-ai-generation-task__title">{title}</span>
          {String(payload?.summary || '').trim() ? <span className="tc-ai-generation-task__summary">{payload?.summary}</span> : null}
        </span>
        <span className="tc-ai-generation-task__status">{GENERATION_STATUS_LABELS[status]}</span>
      </div>
      {parameters.length || String(payload?.model || '').trim() ? (
        <div className="tc-ai-generation-task__parameters">
          {String(payload?.model || '').trim() ? <span className="tc-ai-generation-task__parameter">{payload?.model}</span> : null}
          {parameters.map((item, index) => <span className="tc-ai-generation-task__parameter" key={`${block.id}_parameter_${index}`}><span className="tc-ai-generation-task__parameter-label">{item.label}</span><strong className="tc-ai-generation-task__parameter-value">{item.value}</strong></span>)}
        </div>
      ) : null}
      {prompt ? (
        <div className="tc-ai-generation-task__prompt">
          <div className="tc-ai-generation-task__prompt-head">
            <span className="tc-ai-generation-task__prompt-label">生成提示词</span>
            <span className="tc-ai-generation-task__prompt-actions">
              <span className={`tc-ai-generation-task__copy-state tc-ai-generation-task__copy-state--${copyState}`} aria-live="polite">{copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : ''}</span>
              <button type="button" className="tc-ai-generation-task__prompt-action" aria-label="复制生成提示词" onClick={() => void copyPrompt()}><IconCopy className="tc-ai-generation-task__prompt-action-icon" size={13} /></button>
              <button type="button" className="tc-ai-generation-task__prompt-action" aria-label={expanded ? '收起生成提示词' : '展开生成提示词'} onClick={() => setExpanded((current) => !current)}><IconChevronDown className={`tc-ai-generation-task__prompt-action-icon${expanded ? ' is-open' : ''}`} size={13} /></button>
            </span>
          </div>
          {expanded ? <p className="tc-ai-generation-task__prompt-body">{prompt}</p> : null}
        </div>
      ) : null}
      {String(payload?.failureReason || '').trim() ? <div className="tc-ai-generation-task__failure">{payload?.failureReason}</div> : null}
      <div className="tc-ai-generation-task__footer">
        <span className="tc-ai-generation-task__evidence">{String(payload?.taskId || '').trim() ? `任务 ${payload?.taskId}` : status === 'proposal' ? '尚未提交' : '状态来自当前任务事实'}</span>
        <span className="tc-ai-generation-task__actions">
          {nodeId ? <button type="button" className="tc-ai-generation-task__action" onClick={() => focusCanvasNode(nodeId)}>定位节点</button> : null}
          {assetUrl ? <a className="tc-ai-generation-task__action" href={assetUrl} target="_blank" rel="noreferrer">查看资产</a> : null}
          {status === 'proposal' && generationProposal ? <button type="button" className="tc-ai-generation-task__primary" onClick={() => sendChatAction(action || '提交当前生成提案', { generationProposal })}>生成{Number.isFinite(cost) && cost > 0 ? ` ✦${cost}` : ''}</button> : action ? <button type="button" className="tc-ai-generation-task__primary" onClick={() => sendChatAction(action)}>继续{Number.isFinite(cost) && cost > 0 ? ` ✦${cost}` : ''}</button> : null}
        </span>
      </div>
    </div>
  )
}
