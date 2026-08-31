import React from 'react'
import { Button } from '@mantine/core'
import { IconDeviceFloppy } from '@tabler/icons-react'
import { toast } from '../../ui/toast'
import { saveCurrentCanvasSnapshot } from '../persistence/saveCurrentCanvasSnapshot'

type WorkflowNodeSaveActionProps = Readonly<{
  readOnly: boolean
}>

export function WorkflowNodeSaveAction(props: WorkflowNodeSaveActionProps): React.JSX.Element {
  const [saving, setSaving] = React.useState(false)

  const save = React.useCallback(async (): Promise<void> => {
    if (props.readOnly || saving) return
    setSaving(true)
    try {
      const saved = await saveCurrentCanvasSnapshot()
      if (!saved) {
        toast('节点配置保存失败：当前画布没有可用的保存通道', 'error')
        return
      }
      toast('节点配置已保存', 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '节点配置保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }, [props.readOnly, saving])

  return (
    <div className="workflow-node-inspector__save-action">
      <p className="workflow-node-inspector__save-description">
        保存会写入当前节点的完整配置数据，包括模型、参数、提示词、图标地址与执行合同。
      </p>
      <Button
        className="workflow-node-inspector__save-button"
        leftSection={<IconDeviceFloppy className="workflow-node-inspector__button-icon" size={15} aria-hidden="true" />}
        loading={saving}
        disabled={props.readOnly}
        onClick={() => { void save() }}
      >
        保存节点配置
      </Button>
    </div>
  )
}
