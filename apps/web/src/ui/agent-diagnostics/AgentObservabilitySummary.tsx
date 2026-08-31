import React from 'react'
import { Badge, Button, Group, Stack, Text } from '@mantine/core'
import type {
  AgentAnnotationQueueItemV1,
  AgentDiagnosticsMetricsV1,
  AgentEvaluationResultV1,
  AgentHumanFeedbackV1,
  AgentSpanStatus,
  AgentTraceSpanV1,
} from '@tapcanvas/agent-observability'
import AgentTraceFeedback from './AgentTraceFeedback'
import './AgentObservability.css'

type AgentObservabilitySummaryProps = {
  spans: AgentTraceSpanV1[]
  metrics: AgentDiagnosticsMetricsV1 | null
  evaluations: AgentEvaluationResultV1[]
  humanFeedback: AgentHumanFeedbackV1[]
  annotationQueue: AgentAnnotationQueueItemV1[]
  nextCursor: string | null
  loading: boolean
  onLoadMore: () => void
  onChanged: () => void
}

function durationLabel(value: number | null): string {
  if (value === null) return 'n/a'
  if (value < 1_000) return `${value}ms`
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}s`
}

function statusColor(status: AgentSpanStatus): string {
  if (status === 'succeeded') return 'green'
  if (status === 'accepted_async' || status === 'suspended') return 'blue'
  if (status === 'needs_input') return 'yellow'
  if (status === 'running') return 'cyan'
  return 'red'
}

function metricValue(value: number | null): string {
  return value === null ? 'n/a' : Math.round(value).toLocaleString()
}

function uniqueTraceRoots(spans: AgentTraceSpanV1[]): AgentTraceSpanV1[] {
  return spans
    .filter((span) => span.kind === 'request')
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
}

export default function AgentObservabilitySummary(props: AgentObservabilitySummaryProps): JSX.Element {
  const {
    spans,
    metrics,
    evaluations,
    humanFeedback,
    annotationQueue,
    nextCursor,
    loading,
    onLoadMore,
    onChanged,
  } = props
  const [expandedTraceId, setExpandedTraceId] = React.useState<string | null>(null)
  const traceRoots = React.useMemo(() => uniqueTraceRoots(spans), [spans])

  return (
    <Stack className="agent-observability" gap="sm">
      <Group className="agent-observability-metrics" gap={6} wrap="wrap">
        <span className="agent-observability-metric"><b className="agent-observability-metric-value">{metrics?.traceCount ?? 0}</b><span className="agent-observability-metric-label">traces</span></span>
        <span className="agent-observability-metric"><b className="agent-observability-metric-value">{metrics?.succeededCount ?? 0}</b><span className="agent-observability-metric-label">succeeded</span></span>
        <span className="agent-observability-metric"><b className="agent-observability-metric-value">{metrics?.failedCount ?? 0}</b><span className="agent-observability-metric-label">failed</span></span>
        <span className="agent-observability-metric"><b className="agent-observability-metric-value">{metrics?.partialCount ?? 0}</b><span className="agent-observability-metric-label">partial</span></span>
        <span className="agent-observability-metric"><b className="agent-observability-metric-value">{metrics?.needsInputCount ?? 0}</b><span className="agent-observability-metric-label">needs input</span></span>
        <span className="agent-observability-metric"><b className="agent-observability-metric-value">{metrics?.acceptedAsyncCount ?? 0}</b><span className="agent-observability-metric-label">async accepted</span></span>
        <span className="agent-observability-metric"><b className="agent-observability-metric-value">{metrics?.materializedAsyncCount ?? 0}</b><span className="agent-observability-metric-label">materialized</span></span>
        <span className="agent-observability-metric"><b className="agent-observability-metric-value">{metrics?.staleAsyncCount ?? 0}</b><span className="agent-observability-metric-label">stale async</span></span>
        <span className="agent-observability-metric"><b className="agent-observability-metric-value">{metricValue(metrics?.p95DurationMs ?? null)}</b><span className="agent-observability-metric-label">p95 ms</span></span>
        <span className="agent-observability-metric"><b className="agent-observability-metric-value">{metricValue(metrics?.totalTokens ?? null)}</b><span className="agent-observability-metric-label">tokens</span></span>
        <span className="agent-observability-metric"><b className="agent-observability-metric-value">{metrics?.degradedCount ?? 0}</b><span className="agent-observability-metric-label">degraded</span></span>
      </Group>

      <Stack className="agent-observability-traces" gap={4}>
        {traceRoots.length === 0 ? (
          <Text className="agent-observability-empty" size="xs" c="dimmed">当前筛选范围没有 canonical span</Text>
        ) : traceRoots.map((root) => {
          const expanded = expandedTraceId === root.traceId
          const children = spans
            .filter((span) => span.traceId === root.traceId && span.spanId !== root.spanId)
            .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))
          const traceEvaluations = evaluations.filter((item) => item.traceId === root.traceId)
          return (
            <Stack className="agent-observability-trace" key={root.traceId} gap={4}>
              <button
                className="agent-observability-trace-toggle"
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpandedTraceId(expanded ? null : root.traceId)}
              >
                <span className="agent-observability-trace-main">
                  <span className="agent-observability-trace-id">{root.traceId.slice(0, 12)}</span>
                  <span className="agent-observability-trace-model">{root.modelKey ?? 'model unreported'}</span>
                  <span className="agent-observability-trace-scope">{root.scope.workflowKey ?? root.scope.label ?? 'unscoped'}</span>
                </span>
                <span className="agent-observability-trace-facts">
                  <Badge className="agent-observability-trace-status" size="xs" variant="light" color={statusColor(root.status)}>{root.status}</Badge>
                  <span className="agent-observability-trace-duration">{durationLabel(root.durationMs)}</span>
                  <span className="agent-observability-trace-tokens">{`${root.totalTokens} tok`}</span>
                </span>
              </button>
              {expanded ? (
                <Stack className="agent-observability-trace-detail" gap={4}>
                  <Group className="agent-observability-evaluations" gap={4} wrap="wrap">
                    {traceEvaluations.length === 0 ? (
                      <Badge className="agent-observability-evaluation-missing" size="xs" variant="outline" color="gray">evaluation missing</Badge>
                    ) : traceEvaluations.map((evaluation) => (
                      <Badge
                        className="agent-observability-evaluation"
                        key={evaluation.id}
                        size="xs"
                        variant="light"
                        color={evaluation.status === 'passed' ? 'green' : evaluation.status === 'failed' ? 'red' : 'gray'}
                      >
                        {`${evaluation.evaluatorKey} · ${evaluation.status}`}
                      </Badge>
                    ))}
                  </Group>
                  <div className="agent-observability-timeline">
                    {children.map((span) => (
                      <div className="agent-observability-span" key={span.id}>
                        <span className="agent-observability-span-kind">{span.kind}</span>
                        <span className="agent-observability-span-name">{span.name}</span>
                        <span className={`agent-observability-span-status agent-observability-span-status-${span.status}`}>{span.status}</span>
                        <span className="agent-observability-span-duration">{durationLabel(span.durationMs)}</span>
                        <span className="agent-observability-span-tokens">{span.totalTokens > 0 ? `${span.totalTokens} tok` : ''}</span>
                      </div>
                    ))}
                  </div>
                  <AgentTraceFeedback
                    traceId={root.traceId}
                    threadId={root.threadId}
                    existing={humanFeedback}
                    annotationItems={annotationQueue.filter((item) => item.traceId === root.traceId)}
                    onChanged={onChanged}
                  />
                </Stack>
              ) : null}
            </Stack>
          )
        })}
      </Stack>
      {nextCursor ? (
        <Button className="agent-observability-load-more" size="compact-xs" variant="subtle" loading={loading} onClick={onLoadMore}>
          加载更早 spans
        </Button>
      ) : null}
    </Stack>
  )
}
