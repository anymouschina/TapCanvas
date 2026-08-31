import React from 'react'

import type {
  ExecutionPromptAssembly,
  ExecutionPromptAssemblySource,
} from './executionGraph.types'

type VideoPromptAssemblyInspectorProps = {
  assemblies: ExecutionPromptAssembly[]
}

function assemblyStateLabel(state: ExecutionPromptAssembly['state']): string {
  if (state === 'complete') return '来源完整'
  if (state === 'pending') return '组装中'
  return '部分可追溯'
}

function sourceStatusLabel(status: ExecutionPromptAssemblySource['status']): string {
  if (status === 'applied') return '已使用'
  if (status === 'not_used') return '本轮未用'
  if (status === 'pending') return '等待回传'
  return '不可追溯'
}

function EvidenceBlock(props: { title: string; value: string | null }): JSX.Element | null {
  if (!props.value) return null
  return (
    <details className="agent-execution-prompt__evidence">
      <summary className="agent-execution-prompt__evidence-summary">{props.title}</summary>
      <pre className="agent-execution-prompt__evidence-content">{props.value}</pre>
    </details>
  )
}

function PromptAssemblyItem(props: { assembly: ExecutionPromptAssembly; defaultOpen: boolean }): JSX.Element {
  const { assembly, defaultOpen } = props
  const [open, setOpen] = React.useState(defaultOpen)
  const sourceById = new Map(assembly.sources.map((source) => [source.id, source]))
  return (
    <details
      className="agent-execution-prompt__item"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="agent-execution-prompt__item-summary">
        <span className="agent-execution-prompt__clip">Clip {assembly.clipIndex}</span>
        <span className="agent-execution-prompt__artifact">{assembly.artifactKey}</span>
        <span className={`agent-execution-prompt__state agent-execution-prompt__state--${assembly.state}`}>
          {assemblyStateLabel(assembly.state)}
        </span>
      </summary>
      <div className="agent-execution-prompt__item-body">
        <p className="agent-execution-prompt__summary">{assembly.assemblySummary}</p>
        <section className="agent-execution-prompt__contract" aria-label={`Clip ${assembly.clipIndex} 冻结创作合同`}>
          <header className="agent-execution-prompt__section-header">
            <strong className="agent-execution-prompt__section-title">逐段冻结事实</strong>
            <span className="agent-execution-prompt__section-count">可展开核对</span>
          </header>
          <div className="agent-execution-prompt__evidence-list">
            <EvidenceBlock title="完整原文跨度" value={assembly.contractSnapshot.sourceSpanText} />
            <EvidenceBlock title="逐字对白合同" value={assembly.contractSnapshot.dialogueScriptJson} />
            <EvidenceBlock title="时间层与状态作用域" value={assembly.contractSnapshot.temporalContextJson} />
            <EvidenceBlock title="子场景入口与退出" value={assembly.contractSnapshot.sceneStateJson} />
            <EvidenceBlock title="角色状态卡映射" value={assembly.contractSnapshot.characterStatesJson} />
            <EvidenceBlock title="可见人物状态版本" value={assembly.contractSnapshot.characterStateVersionsJson} />
            <EvidenceBlock title="起始关键帧" value={assembly.contractSnapshot.startKeyframe} />
            <EvidenceBlock title="结束关键帧" value={assembly.contractSnapshot.endKeyframe} />
            <EvidenceBlock title="上一段退出态" value={assembly.contractSnapshot.previousExitState} />
            <EvidenceBlock title="当前段退出态" value={assembly.contractSnapshot.exitState} />
            <EvidenceBlock title="Writer 冻结 JSON（不含重复 prompt）" value={assembly.contractSnapshot.writerOutputJson} />
          </div>
        </section>
        <ol className="agent-execution-prompt__steps" aria-label={`Clip ${assembly.clipIndex} 视频提示词组装顺序`}>
          {assembly.steps.map((step) => (
            <li className="agent-execution-prompt__step" key={step.id}>
              <span className="agent-execution-prompt__step-index">{step.order}</span>
              <div className="agent-execution-prompt__step-content">
                <strong className="agent-execution-prompt__step-title">{step.title}</strong>
                <p className="agent-execution-prompt__step-explanation">{step.explanation}</p>
                <div className="agent-execution-prompt__step-sources" aria-label={`${step.title} 的来源`}>
                  {step.sourceIds.map((sourceId) => {
                    const source = sourceById.get(sourceId)
                    return source ? (
                      <span className={`agent-execution-prompt__source-chip agent-execution-prompt__source-chip--${source.status}`} key={source.id}>
                        {source.label}
                      </span>
                    ) : null
                  })}
                </div>
              </div>
            </li>
          ))}
        </ol>
        <section className="agent-execution-prompt__sources" aria-label={`Clip ${assembly.clipIndex} 引用来源`}>
          <header className="agent-execution-prompt__section-header">
            <strong className="agent-execution-prompt__section-title">真实引用来源</strong>
            <span className="agent-execution-prompt__section-count">{assembly.sources.length}</span>
          </header>
          <div className="agent-execution-prompt__source-list">
            {assembly.sources.map((source) => (
              <article className={`agent-execution-prompt__source agent-execution-prompt__source--${source.status}`} key={source.id}>
                <header className="agent-execution-prompt__source-header">
                  <strong className="agent-execution-prompt__source-label">{source.label}</strong>
                  <span className="agent-execution-prompt__source-status">{sourceStatusLabel(source.status)}</span>
                </header>
                <p className="agent-execution-prompt__source-summary">{source.summary}</p>
                <code className="agent-execution-prompt__source-ref">{source.ref}</code>
              </article>
            ))}
          </div>
        </section>
        {assembly.finalPrompt ? (
          <details className="agent-execution-prompt__final">
            <summary className="agent-execution-prompt__final-summary">
              <span className="agent-execution-prompt__final-title">查看完整编译提示词（资产绑定前）</span>
              <span className="agent-execution-prompt__final-count">{assembly.finalPrompt.characterCount} 字符</span>
            </summary>
            <div className="agent-execution-prompt__final-body">
              <p className="agent-execution-prompt__final-label">{assembly.finalPrompt.label}</p>
              {assembly.finalPrompt.hash ? <code className="agent-execution-prompt__final-hash">{assembly.finalPrompt.hash}</code> : null}
              <pre className="agent-execution-prompt__final-preview">{assembly.finalPrompt.text}</pre>
            </div>
          </details>
        ) : (
          <p className="agent-execution-prompt__pending">Writer 尚未冻结结构化 shots，当前没有可展示的执行提示词投影。</p>
        )}
      </div>
    </details>
  )
}

export default function VideoPromptAssemblyInspector(props: VideoPromptAssemblyInspectorProps): JSX.Element | null {
  if (props.assemblies.length === 0) return null
  return (
    <section className="agent-execution-prompt" aria-label="视频提示词组装与引用来源">
      <header className="agent-execution-prompt__header">
        <div className="agent-execution-prompt__heading">
          <strong className="agent-execution-prompt__title">视频提示词如何组装</strong>
          <p className="agent-execution-prompt__description">按真实执行顺序展示结构来源；未加载的文档会明确标记。</p>
        </div>
        <span className="agent-execution-prompt__count">{props.assemblies.length} clips</span>
      </header>
      <div className="agent-execution-prompt__list">
        {props.assemblies.map((assembly, index) => (
          <PromptAssemblyItem
            assembly={assembly}
            defaultOpen={index === 0}
            key={`${assembly.artifactKey}-${assembly.clipIndex}`}
          />
        ))}
      </div>
    </section>
  )
}
