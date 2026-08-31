import React from 'react'
import { Button, Select, Switch, TextInput } from '@mantine/core'
import { parseWorkflowTriggerSpec } from '@tapcanvas/workflow-kernel-protocol'
import { previewWorkflowSchedule } from '../../api/server'
import { toast } from '../../ui/toast'
import { useRFStore } from '../store'
import { dataRecord, readString } from './workflowNodeInspectorShared'

export function WorkflowScheduleTriggerConfiguration(props: Readonly<{
  nodeId: string
  data: Record<string, unknown>
  readOnly: boolean
}>): React.JSX.Element {
  const draft = dataRecord(props.data.workflowTriggerSpec)
  const [preview, setPreview] = React.useState<readonly string[]>([])
  const [validationError, setValidationError] = React.useState('')
  const [validating, setValidating] = React.useState(false)
  const enabled = draft.enabled === true

  const saveDraft = React.useCallback((patch: Readonly<Record<string, unknown>>, keepEnabled = false): void => {
    useRFStore.getState().updateNodeData(props.nodeId, {
      workflowTriggerSpec: {
        ...draft,
        ...patch,
        ...(keepEnabled ? {} : { enabled: false }),
      },
    })
    setPreview([])
    setValidationError('')
  }, [draft, props.nodeId])

  const validate = React.useCallback(async (shouldEnable: boolean): Promise<void> => {
    const candidate = { ...draft, enabled: shouldEnable }
    const parsed = parseWorkflowTriggerSpec(candidate)
    if (!parsed.success || parsed.data.kind !== 'schedule') {
      const message = parsed.success ? '当前节点不是定时触发器' : parsed.error.message
      setValidationError(message)
      toast(message, 'error')
      return
    }
    setValidating(true)
    setValidationError('')
    try {
      const result = await previewWorkflowSchedule(parsed.data)
      setPreview(result.nextRuns)
      if (shouldEnable) {
        useRFStore.getState().updateNodeData(props.nodeId, {
          workflowTriggerSpec: parsed.data,
        })
        toast('定时合同已验证并启用；保存画布后调度生效', 'success')
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '定时表达式验证失败'
      setValidationError(message)
      toast(message, 'error')
    } finally {
      setValidating(false)
    }
  }, [draft, props.nodeId])

  return (
    <div className="workflow-node-inspector__tab-content workflow-node-inspector__schedule">
      <TextInput
        className="workflow-node-inspector__field"
        classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input workflow-node-inspector__field-input--code' }}
        label="Cron 表达式"
        aria-label="定时触发 Cron 表达式"
        description="5 或 6 段 cron；修改配置会自动关闭当前调度"
        value={readString(draft, 'cron')}
        disabled={props.readOnly}
        onChange={(event) => saveDraft({ cron: event.currentTarget.value })}
      />
      <TextInput
        className="workflow-node-inspector__field"
        classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input' }}
        label="IANA 时区"
        aria-label="定时触发 IANA 时区"
        description="例如 Asia/Taipei；不使用服务器本地时区猜测"
        value={readString(draft, 'timezone')}
        disabled={props.readOnly}
        onChange={(event) => saveDraft({ timezone: event.currentTarget.value })}
      />
      <Select
        className="workflow-node-inspector__field"
        classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input', dropdown: 'workflow-node-inspector__dropdown' }}
        label="错过触发时"
        aria-label="定时触发错过策略"
        value={draft.misfirePolicy === 'run_once' ? 'run_once' : 'skip'}
        disabled={props.readOnly}
        data={[
          { value: 'skip', label: '跳过已错过时刻' },
          { value: 'run_once', label: '停机恢复后补跑一次' },
        ]}
        onChange={(value) => {
          if (value === 'skip') saveDraft({ misfirePolicy: value, maxCatchUpRuns: 0 })
          if (value === 'run_once') saveDraft({ misfirePolicy: value, maxCatchUpRuns: 1 })
        }}
      />
      <div className="workflow-node-inspector__schedule-actions">
        <Button
          className="workflow-node-inspector__button"
          variant="subtle"
          size="compact-sm"
          loading={validating}
          disabled={props.readOnly}
          onClick={() => void validate(false)}
        >
          验证并预览
        </Button>
        <Switch
          className="workflow-node-inspector__schedule-switch"
          classNames={{ label: 'workflow-node-inspector__field-label' }}
          label={enabled ? '已启用' : '未启用'}
          aria-label="启用定时触发器"
          checked={enabled}
          disabled={props.readOnly || validating}
          onChange={(event) => {
            if (event.currentTarget.checked) void validate(true)
            else saveDraft({ enabled: false }, true)
          }}
        />
      </div>
      {validationError ? (
        <p className="workflow-node-inspector__help workflow-node-inspector__help--error" role="alert">{validationError}</p>
      ) : null}
      {preview.length > 0 ? (
        <section className="workflow-node-inspector__schedule-preview" aria-label="未来触发预览">
          <h4 className="workflow-node-inspector__section-title">未来触发时刻</h4>
          <ol className="workflow-node-inspector__schedule-times">
            {preview.map((item) => <li className="workflow-node-inspector__schedule-time" key={item}>{item}</li>)}
          </ol>
        </section>
      ) : null}
      <p className="workflow-node-inspector__help">
        只有已保存到服务端的画布版本会被调度。每个计划时刻使用稳定 occurrence 身份，同一时刻不会重复创建运行。
      </p>
    </div>
  )
}
