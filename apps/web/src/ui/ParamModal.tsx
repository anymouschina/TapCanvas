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
    <Modal opened={!!nodeId} onClose={close} title="参数" centered>
      {!n && <div>节点不存在</div>}
      {n && (
        <div>
                                                                    {(kind === 'composeVideo' || kind === 'storyboard') && (
            <>
              <Textarea label="分镜/脚本" autosize minRows={4} value={form.storyboard||''} onChange={(e)=>setField('storyboard', e.currentTarget.value)} />
              <Group grow mt={8}>
                <NumberInput label="Duration(s)" min={1} max={600} value={form.duration||30} onChange={(v)=>setField('duration', Number(v)||30)} />
                <NumberInput label="FPS" min={1} max={60} value={form.fps||24} onChange={(v)=>setField('fps', Number(v)||24)} />
              </Group>
            </>
          )}
          {(kind === 'composeVideo' || kind === 'storyboard' || kind === 'image' || kind === 'textToImage') && (
            <>
              <Textarea
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
              <TextInput label="音频 URL" value={form.audioUrl||''} onChange={(e)=>setField('audioUrl', e.currentTarget.value)} />
              <Textarea mt={8} label="字幕文本" autosize minRows={4} value={form.transcript||''} onChange={(e)=>setField('transcript', e.currentTarget.value)} />
            </>
          )}
          <Group justify="space-between" mt={12}>
            <Group gap="xs">
              <Tooltip label="发给小T" withArrow>
                <ActionIcon variant="light" disabled={viewOnly} aria-label="发给小T" onClick={() => sendToLittleT()}>
                  <IconSparkles size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
            <Group gap="xs">
              <Button variant="subtle" onClick={close}>取消</Button>
              <Button onClick={saveRun}>保存并执行</Button>
            </Group>
          </Group>
        </div>
      )}
    </Modal>
  )
}
