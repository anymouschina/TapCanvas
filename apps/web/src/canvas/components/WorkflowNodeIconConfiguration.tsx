import React from 'react'
import { TextInput } from '@mantine/core'
import { useRFStore } from '../store'
import { resolveWorkflowIconUrl, resolveWorkflowNodePresentation } from '../workflowNodePresentation'
import { WorkflowNodeGlyph } from '../nodes/taskNode/components/WorkflowNodeGlyph'

type WorkflowNodeIconConfigurationProps = Readonly<{
  nodeId: string
  data: Record<string, unknown>
  readOnly: boolean
}>

export function WorkflowNodeIconConfiguration(props: WorkflowNodeIconConfigurationProps): React.JSX.Element {
  const persistedValue = typeof props.data.workflowIconUrl === 'string' ? props.data.workflowIconUrl : ''
  const [draft, setDraft] = React.useState(persistedValue)
  React.useEffect(() => setDraft(persistedValue), [persistedValue])

  const trimmedDraft = draft.trim()
  const resolvedDraftUrl = resolveWorkflowIconUrl(trimmedDraft)
  const hasInvalidUrl = Boolean(trimmedDraft) && !resolvedDraftUrl
  const presentation = resolveWorkflowNodePresentation(props.data)
  const previewPresentation = { ...presentation, iconUrl: resolvedDraftUrl }

  const persist = React.useCallback((): void => {
    if (props.readOnly || hasInvalidUrl || trimmedDraft === persistedValue) return
    useRFStore.getState().updateNodeData(props.nodeId, {
      workflowIconUrl: trimmedDraft || undefined,
    })
  }, [hasInvalidUrl, persistedValue, props.nodeId, props.readOnly, trimmedDraft])

  return (
    <div className="workflow-node-inspector__tab-content workflow-node-inspector__icon-configuration">
      <div className="workflow-node-inspector__icon-preview" aria-label="节点图标预览">
        <span className="workflow-node-inspector__icon-preview-frame" aria-hidden="true">
          <WorkflowNodeGlyph
            presentation={previewPresentation}
            className="workflow-node-inspector__icon-preview-image"
            size={24}
            nodeId={props.nodeId}
          />
        </span>
        <span className="workflow-node-inspector__icon-preview-copy">
          <strong className="workflow-node-inspector__icon-preview-title">节点图标</strong>
          <span className="workflow-node-inspector__icon-preview-description">
            留空使用系统的操作级图标；填写在线地址后只覆盖当前节点。
          </span>
        </span>
      </div>
      <TextInput
        className="workflow-node-inspector__field"
        classNames={{
          label: 'workflow-node-inspector__field-label',
          input: 'workflow-node-inspector__field-input',
          error: 'workflow-node-inspector__field-error',
        }}
        label="在线图标 URL"
        aria-label="在线图标 URL"
        placeholder="https://static.example.com/workflow-icon.png"
        value={draft}
        error={hasInvalidUrl ? '必须是完整的 http:// 或 https:// 图片地址' : undefined}
        disabled={props.readOnly}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={persist}
      />
    </div>
  )
}
