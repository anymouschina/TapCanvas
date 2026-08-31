import React from 'react'
import { Textarea, TextInput } from '@mantine/core'
import { useRFStore } from '../store'
import { type WorkflowJsonValue } from '../workflowJavascriptSandbox'
import { workflowPortFromHandle } from '../workflowCanvasPorts'

type WorkflowFieldProps = Readonly<{
  nodeId: string
  dataKey: string
  label: string
  placeholder: string
  value: string
  readOnly: boolean
  multiline?: boolean
  code?: boolean
  buildPersistedPatch?: (value: string) => Record<string, unknown>
}>

export function readString(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  return typeof value === 'string' ? value : ''
}

export function dataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function nodeOperation(data: Record<string, unknown>): string {
  return readString(dataRecord(data.workflowAtomicSpec), 'operation').trim()
}

export function nodeLabel(data: Record<string, unknown>, nodeId: string): string {
  return readString(data, 'label').trim() || readString(data, 'workflowNodeId').trim() || nodeId
}

export function PersistedWorkflowField(props: WorkflowFieldProps): React.JSX.Element {
  const [draft, setDraft] = React.useState(props.value)
  React.useEffect(() => setDraft(props.value), [props.value])

  const persist = React.useCallback((): void => {
    if (props.readOnly || draft === props.value) return
    const patch = props.buildPersistedPatch?.(draft) ?? { [props.dataKey]: draft }
    useRFStore.getState().updateNodeData(props.nodeId, patch)
  }, [draft, props.buildPersistedPatch, props.dataKey, props.nodeId, props.readOnly, props.value])

  if (props.multiline) {
    return (
      <Textarea
        className={'workflow-node-inspector__field' + (props.code ? ' workflow-node-inspector__field--code' : '')}
        classNames={{
          label: 'workflow-node-inspector__field-label',
          input: 'workflow-node-inspector__field-input' + (props.code ? ' workflow-node-inspector__field-input--code' : ''),
        }}
        label={props.label}
        aria-label={props.label}
        placeholder={props.placeholder}
        value={draft}
        disabled={props.readOnly}
        autosize={!props.code}
        minRows={props.code ? 10 : 4}
        maxRows={props.code ? 18 : 10}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={persist}
      />
    )
  }
  return (
    <TextInput
      className="workflow-node-inspector__field"
      classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input' }}
      label={props.label}
      aria-label={props.label}
      placeholder={props.placeholder}
      value={draft}
      disabled={props.readOnly}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={persist}
    />
  )
}

function resolveSourceValue(data: Record<string, unknown>, sourceHandle?: string | null): unknown {
  if (data.workflowLocalTestOutput !== undefined) {
    const port = workflowPortFromHandle(sourceHandle, 'output')
    const output = dataRecord(data.workflowLocalTestOutput)
    if (port && Object.prototype.hasOwnProperty.call(output, port)) return output[port]
    return data.workflowLocalTestOutput
  }
  if (typeof data.workflowTextInput === 'string') return data.workflowTextInput
  if (typeof data.workflowSourceText === 'string') return data.workflowSourceText
  if (typeof data.workflowInputDescription === 'string') return data.workflowInputDescription
  if (typeof data.workflowResultSummary === 'string') return data.workflowResultSummary
  return null
}

function isWorkflowJsonValue(value: unknown): value is WorkflowJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isWorkflowJsonValue)
  if (!value || typeof value !== 'object') return false
  return Object.values(value as Record<string, unknown>).every(isWorkflowJsonValue)
}

export function resolveConnectedInput(nodeId: string): WorkflowJsonValue | null {
  const store = useRFStore.getState()
  const incoming = store.edges.filter((edge) => edge.target === nodeId)
  if (incoming.length === 0) return null
  if (incoming.length === 1) {
    const source = store.nodes.find((candidate) => candidate.id === incoming[0]?.source)
    const value = resolveSourceValue(dataRecord(source?.data), incoming[0]?.sourceHandle)
    if (!isWorkflowJsonValue(value)) throw new Error('上游节点输出不是可序列化的 JSON 值')
    return value
  }
  const values: Record<string, WorkflowJsonValue> = {}
  for (const edge of incoming) {
    const source = store.nodes.find((candidate) => candidate.id === edge.source)
    const value = resolveSourceValue(dataRecord(source?.data), edge.sourceHandle)
    if (!isWorkflowJsonValue(value)) throw new Error('上游节点输出不是可序列化的 JSON 值')
    const port = workflowPortFromHandle(edge.targetHandle, 'input') ?? edge.id
    values[port] = value
  }
  return values
}
