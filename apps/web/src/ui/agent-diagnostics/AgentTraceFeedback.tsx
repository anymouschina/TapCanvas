import React from 'react'
import { Button, Group, Stack, TextInput } from '@mantine/core'
import type {
  AgentAnnotationQueueItemV1,
  AgentHumanFeedbackV1,
} from '@tapcanvas/agent-observability'
import {
  captureAdminAgentRegressionExample,
  submitAdminAgentDiagnosticsFeedback,
} from '../../api/server'
import { toast } from '../toast'

type AgentTraceFeedbackProps = {
  traceId: string
  threadId: string | null
  existing: AgentHumanFeedbackV1[]
  annotationItems: AgentAnnotationQueueItemV1[]
  onChanged: () => void
}

export default function AgentTraceFeedback(props: AgentTraceFeedbackProps): JSX.Element {
  const { traceId, threadId, existing, annotationItems, onChanged } = props
  const [comment, setComment] = React.useState('')
  const [datasetKey, setDatasetKey] = React.useState('ai-diagnostics-regression')
  const [saving, setSaving] = React.useState(false)
  const latest = existing.find((item) => item.traceId === traceId) ?? null
  const pendingAnnotations = annotationItems.filter((item) => item.status === 'pending')

  const submit = React.useCallback(async (value: AgentHumanFeedbackV1['value']) => {
    setSaving(true)
    try {
      await submitAdminAgentDiagnosticsFeedback({
        traceId,
        threadId,
        feedbackKey: 'delivery_quality',
        value,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      })
      toast('反馈已写入标注闭环', 'success')
      onChanged()
    } catch (error) {
      toast(error instanceof Error ? error.message : '保存反馈失败', 'error')
    } finally {
      setSaving(false)
    }
  }, [comment, onChanged, threadId, traceId])

  const capture = React.useCallback(async () => {
    const key = datasetKey.trim()
    if (!key) {
      toast('请填写回归数据集名称', 'error')
      return
    }
    setSaving(true)
    try {
      const example = await captureAdminAgentRegressionExample({ traceId, datasetKey: key })
      toast(`已加入 ${example.datasetKey} v${example.datasetVersion}`, 'success')
      onChanged()
    } catch (error) {
      toast(error instanceof Error ? error.message : '加入回归数据集失败', 'error')
    } finally {
      setSaving(false)
    }
  }, [datasetKey, onChanged, traceId])

  return (
    <Stack className="agent-trace-feedback" gap={6}>
      <Group className="agent-trace-feedback-actions" gap={4} wrap="wrap">
        <Button className="agent-trace-feedback-accept" size="compact-xs" variant="subtle" color="green" loading={saving} onClick={() => void submit('accepted')}>
          交付正确
        </Button>
        <Button className="agent-trace-feedback-revise" size="compact-xs" variant="subtle" color="yellow" loading={saving} onClick={() => void submit('needs_revision')}>
          需要修改
        </Button>
        <Button className="agent-trace-feedback-reject" size="compact-xs" variant="subtle" color="red" loading={saving} onClick={() => void submit('rejected')}>
          交付错误
        </Button>
        {latest ? (
          <span className={`agent-trace-feedback-latest agent-trace-feedback-latest-${latest.value}`}>
            {`latest ${latest.value}`}
          </span>
        ) : null}
        {pendingAnnotations.length > 0 ? (
          <span className="agent-trace-feedback-annotation-pending">
            {`pending annotation ${pendingAnnotations.length}`}
          </span>
        ) : annotationItems.length > 0 ? (
          <span className="agent-trace-feedback-annotation-reviewed">annotation reviewed</span>
        ) : null}
      </Group>
      <TextInput
        className="agent-trace-feedback-comment"
        size="xs"
        aria-label="诊断反馈说明"
        placeholder="可选：说明失败事实或期望修正"
        value={comment}
        onChange={(event) => setComment(event.currentTarget.value)}
      />
      <Group className="agent-trace-feedback-regression" gap={6} wrap="nowrap">
        <TextInput
          className="agent-trace-feedback-dataset"
          size="xs"
          aria-label="回归数据集名称"
          value={datasetKey}
          onChange={(event) => setDatasetKey(event.currentTarget.value)}
        />
        <Button className="agent-trace-feedback-capture" size="compact-xs" variant="light" loading={saving} onClick={() => void capture()}>
          {pendingAnnotations.length > 0 ? '加入回归集并完成标注' : '加入回归集'}
        </Button>
      </Group>
    </Stack>
  )
}
