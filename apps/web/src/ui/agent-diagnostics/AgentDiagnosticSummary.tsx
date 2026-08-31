import React from 'react'
import { ActionIcon, Tooltip } from '@mantine/core'
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCircleCheck,
  IconClock,
  IconInfoCircle,
  IconRefresh,
} from '@tabler/icons-react'
import type {
  AgentDiagnosticAssessmentV1,
  AgentDiagnosticIssueV1,
  AgentDiagnosticStateV1,
} from '@tapcanvas/agent-observability'

type AgentDiagnosticSummaryProps = {
  diagnosis: AgentDiagnosticAssessmentV1
  onFocusNode: (nodeId: string) => void
}

function stateLabel(state: AgentDiagnosticStateV1): string {
  if (state === 'healthy') return '已闭环'
  if (state === 'running') return '执行中'
  if (state === 'waiting') return '等待证据'
  if (state === 'needs_input') return '需要输入'
  if (state === 'repair_required') return '需要修复'
  if (state === 'failed') return '执行失败'
  return '证据不足'
}

function StateIcon({ state }: { state: AgentDiagnosticStateV1 }): React.JSX.Element {
  const className = 'agent-diagnostic-summary__state-icon'
  if (state === 'healthy') return <IconCircleCheck className={className} size={17} aria-hidden="true" />
  if (state === 'running' || state === 'waiting') return <IconClock className={className} size={17} aria-hidden="true" />
  if (state === 'repair_required') return <IconRefresh className={className} size={17} aria-hidden="true" />
  if (state === 'failed' || state === 'needs_input') return <IconAlertTriangle className={className} size={17} aria-hidden="true" />
  return <IconInfoCircle className={className} size={17} aria-hidden="true" />
}

function IssueRow(props: {
  issue: AgentDiagnosticIssueV1
  onFocusNode: (nodeId: string) => void
}): React.JSX.Element {
  const canFocus = Boolean(props.issue.nodeId)
  return (
    <article className={`agent-diagnostic-summary__issue agent-diagnostic-summary__issue--${props.issue.severity}`}>
      <div className="agent-diagnostic-summary__issue-copy">
        <div className="agent-diagnostic-summary__issue-heading">
          <span className="agent-diagnostic-summary__issue-stage">{props.issue.stage}</span>
          <strong className="agent-diagnostic-summary__issue-title">{props.issue.title}</strong>
        </div>
        <p className="agent-diagnostic-summary__issue-detail">{props.issue.detail}</p>
      </div>
      {canFocus ? (
        <Tooltip className="agent-diagnostic-summary__focus-tooltip" label="定位相关节点" withArrow>
          <ActionIcon
            className="agent-diagnostic-summary__focus-action"
            variant="subtle"
            size="sm"
            aria-label={`定位诊断节点：${props.issue.title}`}
            onClick={() => props.issue.nodeId && props.onFocusNode(props.issue.nodeId)}
          >
            <IconArrowRight className="agent-diagnostic-summary__focus-icon" size={15} aria-hidden="true" />
          </ActionIcon>
        </Tooltip>
      ) : null}
    </article>
  )
}

function FactList(props: { label: string; values: string[] }): React.JSX.Element | null {
  if (props.values.length === 0) return null
  return (
    <div className="agent-diagnostic-summary__facts">
      <strong className="agent-diagnostic-summary__facts-label">{props.label}</strong>
      <ul className="agent-diagnostic-summary__facts-list">
        {props.values.map((value) => (
          <li className="agent-diagnostic-summary__facts-item" key={`${props.label}-${value}`}>{value}</li>
        ))}
      </ul>
    </div>
  )
}

export default function AgentDiagnosticSummary(props: AgentDiagnosticSummaryProps): React.JSX.Element {
  const visibleIssues = props.diagnosis.issues.slice(0, 4)
  return (
    <section
      className={`agent-diagnostic-summary agent-diagnostic-summary--${props.diagnosis.state}`}
      aria-label="AI 诊断结论"
    >
      <header className="agent-diagnostic-summary__header">
        <div className="agent-diagnostic-summary__state">
          <StateIcon state={props.diagnosis.state} />
          <span className="agent-diagnostic-summary__state-label">{stateLabel(props.diagnosis.state)}</span>
        </div>
        <div className="agent-diagnostic-summary__heading">
          <strong className="agent-diagnostic-summary__headline">{props.diagnosis.headline}</strong>
          <p className="agent-diagnostic-summary__summary">{props.diagnosis.summary}</p>
        </div>
      </header>
      {props.diagnosis.missingCriteria.length > 0 || props.diagnosis.requiredActions.length > 0 ? (
        <div className="agent-diagnostic-summary__fact-grid">
          <FactList label="尚缺标准" values={props.diagnosis.missingCriteria} />
          <FactList label="同链下一步" values={props.diagnosis.requiredActions} />
        </div>
      ) : null}
      {visibleIssues.length > 0 ? (
        <div className="agent-diagnostic-summary__issues" aria-label="诊断问题">
          {visibleIssues.map((issue, index) => (
            <IssueRow
              issue={issue}
              onFocusNode={props.onFocusNode}
              key={`${issue.code}-${issue.nodeId ?? 'global'}-${index}`}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}
