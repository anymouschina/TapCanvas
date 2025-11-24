import React, { useEffect } from 'react'
import { Modal, TextInput, Textarea, NumberInput, Select, Button, Group } from '@mantine/core'
import { useUIStore } from './uiStore'
import { useRFStore } from '../canvas/store'
import { textToImageSchema, composeVideoSchema, ttsSchema, subtitleAlignSchema, defaultsFor } from '../inspector/forms'

export default function ParamModal(): JSX.Element {
  const nodeId = useUIStore(s => s.paramNodeId)
  const close = useUIStore(s => s.closeParam)
  const nodes = useRFStore(s => s.nodes)
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

  return (
    <Modal opened={!!nodeId} onClose={close} title="参数" centered>
      {!n && <div>节点不存在</div>}
      {n && (
        <div>
          {kind === 'textToImage' && (
            <>
              <Textarea label="提示词" autosize minRows={3} value={form.prompt||''} onChange={(e)=>setField('prompt', e.currentTarget.value)} />
              <Group grow mt={8}>
                <NumberInput label="Steps" min={1} max={100} value={form.steps||30} onChange={(v)=>setField('steps', Number(v)||30)} />
                <NumberInput label="Seed" value={form.seed||''} onChange={(v)=>setField('seed', v===undefined? undefined : Number(v))} />
              </Group>
              <Select mt={8} label="比例" data={[{value:'16:9',label:'16:9'},{value:'1:1',label:'1:1'},{value:'9:16',label:'9:16'}]} value={form.aspect||'16:9'} onChange={(v)=>setField('aspect', v||'16:9')} />
            </>
          )}
          {(kind === 'composeVideo' || kind === 'storyboard') && (
            <>
              <Textarea label="分镜/脚本" autosize minRows={4} value={form.storyboard||''} onChange={(e)=>setField('storyboard', e.currentTarget.value)} />
              <Group grow mt={8}>
                <NumberInput label="Duration(s)" min={1} max={600} value={form.duration||30} onChange={(v)=>setField('duration', Number(v)||30)} />
                <NumberInput label="FPS" min={1} max={60} value={form.fps||24} onChange={(v)=>setField('fps', Number(v)||24)} />
              </Group>
            </>
          )}
          {kind === 'tts' && (
            <>
              <Textarea label="文本" autosize minRows={3} value={form.text||''} onChange={(e)=>setField('text', e.currentTarget.value)} />
              <Group grow mt={8}>
                <Select label="声音" data={[{value:'female',label:'female'},{value:'male',label:'male'}]} value={form.voice||'female'} onChange={(v)=>setField('voice', v||'female')} />
                <NumberInput label="速度" step={0.1} min={0.5} max={1.5} value={form.speed||1} onChange={(v)=>setField('speed', Number(v)||1)} />
              </Group>
            </>
          )}
          {kind === 'subtitleAlign' && (
            <>
              <TextInput label="音频 URL" value={form.audioUrl||''} onChange={(e)=>setField('audioUrl', e.currentTarget.value)} />
              <Textarea mt={8} label="字幕文本" autosize minRows={4} value={form.transcript||''} onChange={(e)=>setField('transcript', e.currentTarget.value)} />
            </>
          )}
          <Group justify="flex-end" mt={12}>
            <Button variant="subtle" onClick={close}>取消</Button>
            <Button onClick={saveRun}>保存并执行</Button>
          </Group>
        </div>
      )}
    </Modal>
  )
}
