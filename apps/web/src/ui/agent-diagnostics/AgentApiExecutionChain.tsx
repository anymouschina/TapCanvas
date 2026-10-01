import React from 'react'
import { Alert, Badge, Button, Group, Loader, Select, Stack, Text } from '@mantine/core'
import type {
  AgentDiagnosticsTraceDto,
  AgentPipelineRunDto,
  AgentPipelineRunStatus,
  AgentPipelineStage,
} from '../../api/server'

const STAGE_LABELS: Record<AgentPipelineStage, string> = {
  material_ingest: '素材接入',
  script_breakdown: '剧本拆解',
  storyboard_generation: '分镜生成',
  shot_planning: '镜头规划',
  image_generation: '图片生成',
  video_generation: '视频生成',
  qc_publish: '质检发布',
}

const STATUS_LABELS: Record<AgentPipelineRunStatus, string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  canceled: '已取消',
}

function statusColor(status: AgentPipelineRunStatus): string {
  if (status === 'succeeded') return 'green'
  if (status === 'running') return 'cyan'
  if (status === 'queued') return 'blue'
  if (status === 'canceled') return 'gray'
  return 'red'
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value
}

/** Agent API video jobs are pipeline runs whose declared stages end in video generation. */
export function isAgentApiVideoRun(run: AgentPipelineRunDto): boolean {
  return Array.isArray(run.stages) && run.stages.includes('video_generation')
}

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

/**
 * Shows Agent API video jobs and, for the selected job, its declared stage chain
 * plus the diagnostics traces that were recorded under that job id.
 */
export default function AgentApiExecutionChain({
  jobs,
  jobsLoading,
  jobsError,
  selectedJobId,
  traces,
  diagnosticsLoading,
  onSelectJob,
  onRefreshJobs,
}: AgentApiExecutionChainProps): JSX.Element | null {
  const selectedJob = React.useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  )
  const jobTraces = React.useMemo(() => {
    if (!selectedJob) return []
    return traces
      .filter((trace) => (
        trace.id === selectedJob.id
        || trace.scopeId === selectedJob.id
        || trace.taskId === selectedJob.id
        || trace.workflowRunId === selectedJob.id
        || trace.rootTraceId === selectedJob.id
      ))
      .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))
  }, [selectedJob, traces])

  if (!jobsLoading && !jobsError && jobs.length === 0) return null

  return (
    <Stack className="agent-api-execution-chain" gap="xs">
      <Group className="agent-api-execution-chain-header" justify="space-between" align="flex-end" wrap="wrap">
        <Select
          className="agent-api-execution-chain-select"
          size="xs"
          label="Agent API 视频任务"
          placeholder={jobsLoading ? '加载中…' : '选择任务查看执行链'}
          data={jobs.map((job) => ({
            value: job.id,
            label: `${job.title || job.id} · ${STATUS_LABELS[job.status] ?? job.status}`,
          }))}
          value={selectedJob?.id ?? null}
          onChange={(value) => onSelectJob(value ?? '')}
          searchable
          clearable
          style={{ minWidth: 260, flex: 1 }}
        />
        <Button
          className="agent-api-execution-chain-refresh"
          size="compact-xs"
          variant="subtle"
          loading={jobsLoading}
          onClick={onRefreshJobs}
        >
          刷新任务
        </Button>
      </Group>

      {jobsError ? (
        <Alert className="agent-api-execution-chain-error" color="red" variant="light">
          {`加载 Agent API 任务失败：${jobsError}`}
        </Alert>
      ) : null}

      {selectedJob ? (
        <Stack className="agent-api-execution-chain-detail" gap={6}>
          <Group gap="xs" wrap="wrap">
            <Badge color={statusColor(selectedJob.status)} variant="light">
              {STATUS_LABELS[selectedJob.status] ?? selectedJob.status}
            </Badge>
            <Text size="xs" c="dimmed">{`创建 ${formatTime(selectedJob.createdAt)}`}</Text>
            <Text size="xs" c="dimmed">{`开始 ${formatTime(selectedJob.startedAt)}`}</Text>
            <Text size="xs" c="dimmed">{`结束 ${formatTime(selectedJob.finishedAt)}`}</Text>
          </Group>
          {selectedJob.goal ? <Text size="sm">{selectedJob.goal}</Text> : null}
          <Group className="agent-api-execution-chain-stages" gap={4} wrap="wrap">
            {selectedJob.stages.map((stage, index) => (
              <React.Fragment key={stage}>
                {index > 0 ? <Text size="xs" c="dimmed">→</Text> : null}
                <Badge variant="outline" color="gray">{STAGE_LABELS[stage] ?? stage}</Badge>
              </React.Fragment>
            ))}
          </Group>
          {selectedJob.errorMessage ? (
            <Alert color="red" variant="light">{selectedJob.errorMessage}</Alert>
          ) : null}
          {diagnosticsLoading ? (
            <Group gap="xs"><Loader size="xs" /><Text size="xs" c="dimmed">加载执行记录…</Text></Group>
          ) : jobTraces.length === 0 ? (
            <Text size="xs" c="dimmed">该任务暂无关联的诊断记录。</Text>
          ) : (
            <Stack className="agent-api-execution-chain-traces" gap={4}>
              {jobTraces.map((trace) => (
                <Group key={trace.id} gap="xs" wrap="nowrap">
                  <Badge size="xs" variant="light" color={trace.errorCode ? 'red' : 'gray'}>{trace.status}</Badge>
                  <Text size="xs" style={{ flex: 1 }} lineClamp={1}>
                    {trace.resultSummary || trace.inputSummary || trace.requestKind}
                  </Text>
                  <Text size="xs" c="dimmed">{formatTime(trace.startedAt)}</Text>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>
      ) : null}
    </Stack>
  )
}
