import React, { useEffect } from 'react'
import { Modal, TextInput, Textarea, NumberInput, Select, Button, Group } from '@mantine/core'
import { useUIStore } from './uiStore'
import { useRFStore } from '../canvas/store'
import { defaultsFor } from '../inspector/forms'

type FormSetter = (k: string, v: any) => void

function renderVideoStoryboardSection(form: any, setField: FormSetter) {
  return (
    <>
      <Textarea className="param-modal-field" label="分镜/脚本" autosize minRows={4} value={form.storyboard||''} onChange={(e)=>setField('storyboard', e.currentTarget.value)} />
      <Group className="param-modal-row" grow mt={8}>
        <NumberInput className="param-modal-field" label="Duration(s)" min={1} max={600} value={form.duration||30} onChange={(v)=>setField('duration', Number(v)||30)} />
        <NumberInput className="param-modal-field" label="FPS" min={1} max={60} value={form.fps||24} onChange={(v)=>setField('fps', Number(v)||24)} />
      </Group>
    </>
  )
}

function renderStoryboardImageSection(form: any, setField: FormSetter) {
  return (
    <>
      <Group className="param-modal-row" grow mt={2}>
        <NumberInput
          className="param-modal-field"
          label="分镜数"
          min={4}
          max={16}
          value={form.storyboardCount ?? 4}
          onChange={(v) => setField('storyboardCount', Math.max(4, Math.min(16, Math.floor(Number(v) || 4))))}
        />
        <Select
          className="param-modal-field"
          label="镜头比例"
          data={[
            { value: '16:9', label: '16:9 横屏' },
            { value: '9:16', label: '9:16 竖屏' },
          ]}
          value={form.storyboardAspectRatio === '9:16' ? '9:16' : '16:9'}
          onChange={(v) => setField('storyboardAspectRatio', v === '9:16' ? '9:16' : '16:9')}
          withinPortal
        />
      </Group>
      <Select
        className="param-modal-field"
        mt={8}
        label="风格"
        data={[
          { value: 'realistic', label: '写实' },
          { value: 'comic', label: '美漫' },
          { value: 'sketch', label: '草图' },
          { value: 'strip', label: '条漫' },
        ]}
        value={form.storyboardStyle || 'realistic'}
        onChange={(v) => setField('storyboardStyle', v || 'realistic')}
        withinPortal
      />
      <Textarea
        className="param-modal-field"
        mt={8}
        label="分镜脚本（可选）"
        autosize
        minRows={6}
        value={form.storyboardScript || ''}
        onChange={(e) => setField('storyboardScript', e.currentTarget.value)}
        placeholder="建议每行一个镜头提示词；若留空，将使用 Prompt 作为剧情主题。"
      />
    </>
  )
}

function renderPromptSection(form: any, setField: FormSetter) {
  return (
    <Textarea
      className="param-modal-field"
      label="Prompt"
      autosize
      minRows={4}
      value={form.prompt || ''}
      onChange={(e) => setField('prompt', e.currentTarget.value)}
      placeholder="填写或粘贴生成提示词（英文，可含动作/光影/对白/音效描述）"
    />
  )
}

function renderSubtitleAlignSection(form: any, setField: FormSetter) {
  return (
    <>
      <TextInput className="param-modal-field" label="音频 URL" value={form.audioUrl||''} onChange={(e)=>setField('audioUrl', e.currentTarget.value)} />
      <Textarea className="param-modal-field" mt={8} label="字幕文本" autosize minRows={4} value={form.transcript||''} onChange={(e)=>setField('transcript', e.currentTarget.value)} />
    </>
  )
}

export default function ParamModal(): JSX.Element {
  const nodeId = useUIStore(s => s.paramNodeId)
  const close = useUIStore(s => s.closeParam)
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
  const isVideoStoryboardKind = kind === 'video'
  const isStoryboardImageKind = false
  const isPromptSupportedKind =
    kind === 'image' ||
    kind === 'video'
  const isSubtitleAlignKind = kind === 'subtitle'

  return (
    <Modal className="param-modal" opened={!!nodeId} onClose={close} title="参数" centered>
      {!n && <div className="param-modal-empty">节点不存在</div>}
      {n && (
        <div className="param-modal-body">
          {isVideoStoryboardKind && renderVideoStoryboardSection(form, setField)}
          {isStoryboardImageKind && renderStoryboardImageSection(form, setField)}
          {isPromptSupportedKind && renderPromptSection(form, setField)}
          {isSubtitleAlignKind && renderSubtitleAlignSection(form, setField)}
          <Group className="param-modal-footer" justify="flex-end" mt={12}>
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
