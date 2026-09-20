import React from 'react'
import { NumberInput } from '@mantine/core'
import { useRFStore } from '../store'
import { dataRecord } from './workflowNodeInspectorShared'

export function WorkflowRetryConfiguration(props: Readonly<{
  nodeId: string
  data: Record<string, unknown>
  readOnly: boolean
}>): React.JSX.Element {
  const policy = dataRecord(props.data.workflowRetryPolicy)
  const attempts = policy.maxAttempts
  return <NumberInput
    className="workflow-node-inspector__field"
    classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input' }}
    label="提交失败重试次数"
    description="首次尝试之外的次数。已受理任务沿用原回执；结果未知时先对账。"
    placeholder="执行器默认：2 次"
    value={typeof attempts === 'number' && Number.isInteger(attempts) ? attempts - 1 : ''}
    min={0}
    max={7}
    allowDecimal={false}
    disabled={props.readOnly}
    onChange={(value) => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 7) return
      useRFStore.getState().updateNodeData(props.nodeId, { workflowRetryPolicy: { maxAttempts: value + 1 } })
    }}
  />
}
