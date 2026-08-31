import React from 'react'
import { Textarea, TextInput } from '@mantine/core'
import {
  createEventWorkflowTriggerSpec,
  createWebhookWorkflowTriggerSpec,
  parseWorkflowTriggerSpec,
} from '@tapcanvas/workflow-kernel-protocol'
import { toast } from '../../ui/toast'
import { useRFStore } from '../store'

function scalarFilter(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('事件过滤器必须是 JSON 对象')
  const filter: Record<string, string | number | boolean | null> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== null && typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
      throw new Error(`过滤字段 ${key} 必须是字符串、数字、布尔值或 null`)
    }
    filter[key] = item
  }
  return filter
}

export function WorkflowExternalTriggerConfiguration(props: Readonly<{
  nodeId: string
  spec: unknown
  readOnly: boolean
}>): React.JSX.Element {
  const parsed = parseWorkflowTriggerSpec(props.spec)
  const webhook = parsed.success && parsed.data.kind === 'webhook' ? parsed.data : null
  const event = parsed.success && parsed.data.kind === 'event' ? parsed.data : null
  const [identity, setIdentity] = React.useState(webhook?.webhookId ?? event?.topic ?? '')
  const [secretRef, setSecretRef] = React.useState(webhook?.secretRef ?? '')
  const [filterJson, setFilterJson] = React.useState(event ? JSON.stringify(event.filter, null, 2) : '{}')

  React.useEffect(() => {
    setIdentity(webhook?.webhookId ?? event?.topic ?? '')
    setSecretRef(webhook?.secretRef ?? '')
    setFilterJson(event ? JSON.stringify(event.filter, null, 2) : '{}')
  }, [props.spec])

  const saveWebhook = (): void => {
    try {
      const workflowTriggerSpec = createWebhookWorkflowTriggerSpec({ webhookId: identity, secretRef })
      useRFStore.getState().updateNodeData(props.nodeId, { workflowTriggerSpec })
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : 'Webhook 配置无效', 'error')
    }
  }

  const saveEvent = (): void => {
    try {
      const filter = scalarFilter(JSON.parse(filterJson) as unknown)
      const workflowTriggerSpec = createEventWorkflowTriggerSpec({ topic: identity, filter })
      useRFStore.getState().updateNodeData(props.nodeId, { workflowTriggerSpec })
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '事件触发配置无效', 'error')
    }
  }

  if (webhook) {
    return (
      <div className="workflow-node-inspector__tab-content">
        <TextInput
          className="workflow-node-inspector__field"
          classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input' }}
          label="Webhook 身份"
          aria-label="Webhook 身份"
          value={identity}
          disabled={props.readOnly}
          onChange={(changeEvent) => setIdentity(changeEvent.currentTarget.value)}
          onBlur={saveWebhook}
        />
        <TextInput
          className="workflow-node-inspector__field"
          classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input' }}
          label="密钥引用"
          aria-label="Webhook 密钥引用"
          placeholder="env://TAPCANVAS_WORKFLOW_WEBHOOK_SECRET"
          value={secretRef}
          disabled={props.readOnly}
          onChange={(changeEvent) => setSecretRef(changeEvent.currentTarget.value)}
          onBlur={saveWebhook}
        />
        <p className="workflow-node-inspector__help">公开入口：POST /workflow-triggers/webhooks/{identity || ':webhookId'}。请求必须携带 x-tapcanvas-delivery-id，以及 x-tapcanvas-signature: sha256=&lt;HMAC-SHA256(rawBody)&gt;。画布只保存 env:// 引用，不保存密钥。</p>
      </div>
    )
  }

  if (event) {
    return (
      <div className="workflow-node-inspector__tab-content">
        <TextInput
          className="workflow-node-inspector__field"
          classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input' }}
          label="事件 Topic"
          aria-label="事件 Topic"
          value={identity}
          disabled={props.readOnly}
          onChange={(changeEvent) => setIdentity(changeEvent.currentTarget.value)}
          onBlur={saveEvent}
        />
        <Textarea
          className="workflow-node-inspector__field"
          classNames={{ label: 'workflow-node-inspector__field-label', input: 'workflow-node-inspector__field-input' }}
          label="结构过滤器 JSON"
          aria-label="事件结构过滤器 JSON"
          autosize
          minRows={4}
          value={filterJson}
          disabled={props.readOnly}
          onChange={(changeEvent) => setFilterJson(changeEvent.currentTarget.value)}
          onBlur={saveEvent}
        />
        <p className="workflow-node-inspector__help">由已认证管理员调用 POST /executions/events/deliver。过滤器仅做 payload 顶层标量字段的严格比较，不执行语义匹配。</p>
      </div>
    )
  }

  return <p className="workflow-node-inspector__help">{parsed.success ? '触发器类型不受此配置器支持' : parsed.error.message}</p>
}
