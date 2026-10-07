import React from 'react'
import { ActionIcon, Badge, Group, Loader, Select, Text, Tooltip, UnstyledButton } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'

import type { AgentDiagnosticsTraceDto, AgentPipelineRunDto } from '../../api/server'
import ExecutionEventLogInspector from './ExecutionEventLogInspector'
import './AgentApiExecutionChain.css'

type AgentApiExecutionChainProps = {
  jobs: AgentPipelineRunDto[]
  jobsLoading: boolean
  jobsError: string
  selectedJobId: string
  traces: AgentDiagnosticsTraceDto[]
  diagnosticsLoading: boolean
  onSelectJob: (jobId: string) => void
  onRefreshJobs: () => void
}

type AgentApiVideoProgress = {
  product: 'agent_api_video'
  flowId: string | null
  phase: string | null
  message: string | null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function readAgentApiVideoProgress(value: unknown): AgentApiVideoProgress | null {
  const record = readRecord(value)
  if (record?.product !== 'agent_api_video') return null
  return {
    product: 'agent_api_video',
    flowId: readString(record.flowId),
    phase: readString(record.phase),
    message: readString(record.message),
  }
}

export function isAgentApiVideoRun(run: AgentPipelineRunDto): boolean {
  return readAgentApiVideoProgress(run.progress) !== null
}

export function buildAgentTraceFamily(
  traces: AgentDiagnosticsTraceDto[],
  jobId: string,
): AgentDiagnosticsTraceDto[] {
  const normalizedJobId = jobId.trim()
  if (!normalizedJobId) return []
  return traces
    .filter((trace) => (
      trace.id === normalizedJobId
      || trace.rootTraceId === normalizedJobId
      || trace.logicalTaskId === normalizedJobId
    ))
    .sort((left, right) => {
      const leftTime = Date.parse(left.startedAt || left.createdAt)
      const rightTime = Date.parse(right.startedAt || right.createdAt)
      return leftTime - rightTime
    })
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function statusColor(status: string): string {
  if (status === 'succeeded') return 'green'
  if (status === 'failed' || status === 'cancelled') return 'red'
  if (status === 'waiting_async' || status === 'accepted_async') return 'yellow'
  if (status === 'running' || status === 'queued') return 'blue'
  return 'gray'
}

function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 12)}…${value.slice(-5)}` : value
}

export default function AgentApiExecutionChain(props: AgentApiExecutionChainProps): JSX.Element {
  const {
    jobs,
    jobsLoading,
    jobsError,
    selectedJobId,
    traces,
    diagnosticsLoading,
    onSelectJob,
    onRefreshJobs,
  } = props
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null
  const traceFamily = React.useMemo(
    () => buildAgentTraceFamily(traces, selectedJobId),
    [selectedJobId, traces],
  )
  const [selectedPhysicalTraceId, setSelectedPhysicalTraceId] = React.useState('')

  React.useEffect(() => {
    setSelectedPhysicalTraceId((current) => {
      if (traceFamily.some((trace) => trace.id === current)) return current
      return traceFamily[traceFamily.length - 1]?.id ?? ''
    })
  }, [traceFamily])

  const jobOptions = React.useMemo(() => jobs.map((job) => ({
    value: job.id,
    label: `${job.title} · ${job.status} · ${formatTimestamp(job.createdAt)} · ${shortId(job.id)}`,
  })), [jobs])
  const progress = readAgentApiVideoProgress(selectedJob?.progress)

  return (
    <section className="agent-api-execution-chain" aria-label="Agent API 真实执行链">
      <header className="agent-api-execution-chain__header">
        <div className="agent-api-execution-chain__heading">
          <Text className="agent-api-execution-chain__title" fw={650}>Agent API 真实执行链</Text>
          <Text className="agent-api-execution-chain__description" size="xs" c="dimmed">
            选择持久 job，查看根执行、continuation、真实工具调用与供应商事件；固定阶段图不作为这一区域的执行真相。
          </Text>
        </div>
        <Tooltip className="agent-api-execution-chain__refresh-tooltip" label="刷新 Agent API 调用列表">
          <ActionIcon
            className="agent-api-execution-chain__refresh"
            variant="subtle"
            aria-label="刷新 Agent API 调用列表"
            loading={jobsLoading}
            onClick={onRefreshJobs}
          >
            <IconRefresh className="agent-api-execution-chain__refresh-icon" size={15} />
          </ActionIcon>
        </Tooltip>
      </header>

      <div className="agent-api-execution-chain__selector-row">
        <Select
          className="agent-api-execution-chain__job-select"
          label="Agent API 调用"
          placeholder={jobsLoading ? '正在读取持久任务…' : '选择一个 job'}
          searchable
          data={jobOptions}
          value={selectedJobId || null}
          nothingFoundMessage="没有找到 Agent API 视频任务"
          onChange={(value) => {
            if (value) onSelectJob(value)
          }}
        />
        {jobsLoading ? <Loader className="agent-api-execution-chain__jobs-loader" size="xs" /> : null}
      </div>
      {jobsError ? <Text className="agent-api-execution-chain__error" size="xs" c="red">{jobsError}</Text> : null}

      {selectedJob ? (
        <div className="agent-api-execution-chain__job-summary">
          <Group className="agent-api-execution-chain__job-badges" gap="xs" wrap="wrap">
            <Badge className="agent-api-execution-chain__job-status" color={statusColor(selectedJob.status)} variant="light">
              {selectedJob.status}
            </Badge>
            {progress?.phase ? <Badge className="agent-api-execution-chain__job-phase" variant="outline">{progress.phase}</Badge> : null}
            <Badge className="agent-api-execution-chain__trace-count" variant="outline">{traceFamily.length} 次物理执行</Badge>
          </Group>
          <Text className="agent-api-execution-chain__job-title" size="sm" fw={600}>{selectedJob.title}</Text>
          {selectedJob.goal ? <Text className="agent-api-execution-chain__job-goal" size="xs" c="dimmed">{selectedJob.goal}</Text> : null}
          <div className="agent-api-execution-chain__job-identities">
            <code className="agent-api-execution-chain__identity">job={selectedJob.id}</code>
            <code className="agent-api-execution-chain__identity">project={selectedJob.projectId}</code>
            {progress?.flowId ? <code className="agent-api-execution-chain__identity">flow={progress.flowId}</code> : null}
          </div>
          {progress?.message ? <Text className="agent-api-execution-chain__job-message" size="xs" c="dimmed">{progress.message}</Text> : null}
        </div>
      ) : (
        <Text className="agent-api-execution-chain__empty" size="xs" c="dimmed">
          从上方选择一条 Agent API 调用后，将显示它的完整物理执行家族。
        </Text>
      )}

      {selectedJob ? (
        <div className="agent-api-execution-chain__runs">
          <Text className="agent-api-execution-chain__runs-title" size="xs" fw={650}>物理执行 / Continuation</Text>
          {diagnosticsLoading && traceFamily.length === 0 ? (
            <Loader className="agent-api-execution-chain__traces-loader" size="sm" />
          ) : traceFamily.length === 0 ? (
            <Text className="agent-api-execution-chain__traces-empty" size="xs" c="dimmed">
              该 job 尚未读取到 execution trace；刷新后仍为空即表示持久执行记录缺失。
            </Text>
          ) : (
            <div className="agent-api-execution-chain__run-list">
              {traceFamily.map((trace, index) => {
                const selected = trace.id === selectedPhysicalTraceId
                return (
                  <UnstyledButton
                    className={`agent-api-execution-chain__run${selected ? ' agent-api-execution-chain__run--selected' : ''}`}
                    key={trace.id}
                    aria-pressed={selected}
                    onClick={() => setSelectedPhysicalTraceId(trace.id)}
                  >
                    <span className="agent-api-execution-chain__run-index">{index === 0 ? 'ROOT' : `C${index}`}</span>
                    <span className="agent-api-execution-chain__run-main">
                      <span className="agent-api-execution-chain__run-kind">{trace.requestKind}</span>
                      <code className="agent-api-execution-chain__run-id">{trace.id}</code>
                    </span>
                    <span className={`agent-api-execution-chain__run-status agent-api-execution-chain__run-status--${trace.status}`}>
                      {trace.status}
                    </span>
                    <span className="agent-api-execution-chain__run-time">{formatTimestamp(trace.startedAt || trace.createdAt)}</span>
                  </UnstyledButton>
                )
              })}
            </div>
          )}
        </div>
      ) : null}

      {selectedPhysicalTraceId ? (
        <ExecutionEventLogInspector traceId={selectedPhysicalTraceId} />
      ) : null}
    </section>
  )
}
