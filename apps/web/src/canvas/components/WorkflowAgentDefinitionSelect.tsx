import React from 'react'
import { TextInput } from '@mantine/core'
import { useRFStore } from '../store'

export function WorkflowAgentDefinitionSelect(props: Readonly<{
  nodeId: string
  value: string
  readOnly: boolean
}>): React.JSX.Element {
  return (
    <div className="workflow-node-inspector__agent-select">
      <TextInput
        className="workflow-node-inspector__field"
        classNames={{
          label: 'workflow-node-inspector__field-label',
          input: 'workflow-node-inspector__field-input',
        }}
        label="Agent 角色标识"
        aria-label="Agent 角色标识"
        placeholder="填写运行时支持的精确角色标识"
        value={props.value}
        readOnly={props.readOnly}
        onChange={(event) => {
          useRFStore.getState().updateNodeData(props.nodeId, {
            workflowAgentDefinitionId: event.currentTarget.value.trim() || undefined,
          })
        }}
      />
      <p className="workflow-node-inspector__help">
        该字段是工作流的显式执行合同；不再通过外部 Agent Card 目录装载。未知角色会在执行时显式失败。
      </p>
    </div>
  )
}
