import React, { useEffect } from 'react'
import { Modal, TextInput, Textarea, NumberInput, Select, Button, Group, ActionIcon, Tooltip } from '@mantine/core'
import { IconSparkles } from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import { useRFStore } from '../canvas/store'
import { defaultsFor } from '../inspector/forms'
import { prefillLangGraphChatWithRefs } from '../ai/langgraph-chat/submitEvent'

export default function ParamModal(): JSX.Element {
  const nodeId = useUIStore(s => s.paramNodeId)
  const close = useUIStore(s => s.closeParam)
  const viewOnly = useUIStore(s => s.viewOnly)
  const nodes = useRFStore(s => s.nodes)
  const edges = useRFStore(s => s.edges)
  const update = useRFStore(s => s.updateNodeData)
  const runSelected = useRFStore(s => s.runSelected)
  const n = nodes.find(n => n.id === nodeId)
  const kind = (n?.data as any)?.kind as string | undefined
  const [form, setForm] = React.useState<any>({})
  useEffect(()=>{
    if (n) {
      const base = defaultsFor(kind)
      setForm({ ...base, ...(n.data||{}) })
    }
  },[nodeId])

  const setField = (k: string, v: any) => setForm((f:any)=>({ ...f, [k]: v }))
  const saveRun = () => { if (!n) return; update(n.id, form); runSelected(); close() }

  const sendToLittleT = () => {
    if (!n || !nodeId) return
    if (viewOnly) return

    prefillLangGraphChatWithRefs({ nodeIds: [nodeId] })
    close()
  }

  return (
    <Modal className="param-modal" opened={!!nodeId} onClose={close} title="参数" centered>
      {!n && <div className="param-modal-empty">节点不存在</div>}
      {n && (
        <div className="param-modal-body">
          {(kind === 'composeVideo' || kind === 'storyboard') && (
            <>
              <Textarea className="param-modal-field" label="分镜/脚本" autosize minRows={4} value={form.storyboard||''} onChange={(e)=>setField('storyboard', e.currentTarget.value)} />
              <Group className="param-modal-row" grow mt={8}>
                <NumberInput className="param-modal-field" label="Duration(s)" min={1} max={600} value={form.duration||30} onChange={(v)=>setField('duration', Number(v)||30)} />
                <NumberInput className="param-modal-field" label="FPS" min={1} max={60} value={form.fps||24} onChange={(v)=>setField('fps', Number(v)||24)} />
              </Group>
            </>
          )}
          {(kind === 'composeVideo' || kind === 'storyboard' || kind === 'image' || kind === 'textToImage') && (
            <>
              <Textarea
                className="param-modal-field"
                label="Prompt"
                autosize
                minRows={4}
                value={form.prompt || ''}
                onChange={(e) => setField('prompt', e.currentTarget.value)}
                placeholder="填写或粘贴生成提示词（英文，可含动作/光影/对白/音效描述）"
              />
            </>
          )}
          {kind === 'subtitleAlign' && (
            <>
              <TextInput className="param-modal-field" label="音频 URL" value={form.audioUrl||''} onChange={(e)=>setField('audioUrl', e.currentTarget.value)} />
              <Textarea className="param-modal-field" mt={8} label="字幕文本" autosize minRows={4} value={form.transcript||''} onChange={(e)=>setField('transcript', e.currentTarget.value)} />
            </>
          )}
          <Group className="param-modal-footer" justify="space-between" mt={12}>
            <Group className="param-modal-footer-left" gap="xs">
              <Tooltip className="param-modal-sparkle-tooltip" label="发给小T" withArrow>
                <ActionIcon className="param-modal-sparkle" variant="light" disabled={viewOnly} aria-label="发给小T" onClick={() => sendToLittleT()}>
                  <IconSparkles className="param-modal-sparkle-icon" size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
            <Group className="param-modal-footer-actions" gap="xs">
              <Button className="param-modal-cancel" variant="subtle" onClick={close}>取消</Button>
              <Button className="param-modal-save" onClick={saveRun}>保存并执行</Button>
            </Group>
          </Group>
        </div>
      )}
    </Modal>
  )
}
