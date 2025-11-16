import React, { useEffect, useMemo } from 'react'
import { useRFStore } from '../canvas/store'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { textToImageSchema, composeVideoSchema, ttsSchema, subtitleAlignSchema, defaultsFor } from './forms'
import { TextInput, Textarea, NumberInput, Select, Button, Title, Divider, Text, Group } from '@mantine/core'

export default function NodeInspector(): JSX.Element {
  const nodes = useRFStore((s) => s.nodes)
  const updateNodeLabel = useRFStore((s) => s.updateNodeLabel)
  const cancelNode = useRFStore((s) => s.cancelNode)
  const runSelected = useRFStore((s) => s.runSelected)

  const selected = useMemo(() => nodes.find((n) => n.selected), [nodes])
  const logs = (selected?.data as any)?.logs as string[] | undefined
  const result = (selected?.data as any)?.lastResult as any

  const kind = (selected?.data as any)?.kind as string | undefined
  const subflowRef = (selected?.data as any)?.subflowRef as string | undefined
  const subflowIO = (selected?.data as any)?.io as any
  const bindings = (selected?.data as any)?.ioBindings as { inputs?: Record<string,string>; outputs?: Record<string,string> } || { inputs: {}, outputs: {} }

  const form = useForm<any>({
    resolver: zodResolver(
      kind === 'textToImage' ? textToImageSchema :
      kind === 'composeVideo' ? composeVideoSchema :
      kind === 'tts' ? ttsSchema :
      kind === 'subtitleAlign' ? subtitleAlignSchema :
      textToImageSchema
    ),
    defaultValues: defaultsFor(kind)
  })

  useEffect(() => {
    if (selected) {
      const data = { ...defaultsFor(kind), ...(selected.data || {}) }
      // exclude non-form fields
      const { label, kind: _k, ...rest } = data as any
      form.reset(rest)
    }
  }, [selected?.id, kind])

  if (!selected) {
    return (
      <div>
        <h2 style={{ margin: '8px 0 12px', fontSize: 16 }}>属性</h2>
        <div style={{ fontSize: 12, opacity: .7 }}>选中一个节点以编辑属性。</div>
      </div>
    )
  }

  return (
    <div>
      <Title order={6} style={{ margin: '2px 0 8px' }}>属性</Title>
      <Text size="xs" c="dimmed" style={{ marginBottom: 6 }}>ID: {selected.id}</Text>
      <Text size="xs" c="dimmed" style={{ marginBottom: 8 }}>状态：{(selected.data as any)?.status ?? 'idle'}</Text>
      <Group gap="xs" style={{ margin: '4px 0 10px' }}>
        <Button size="xs" onClick={() => runSelected()}>运行</Button>
        <Button size="xs" variant="light" color="red" onClick={() => cancelNode(selected.id)}>停止</Button>
        <Button size="xs" variant="subtle" onClick={() => useRFStore.getState().updateNodeData(selected.id, { logs: [] })}>清空日志</Button>
      </Group>

      {kind === 'subflow' && (
        <div style={{ padding: 10, border: '1px dashed rgba(127,127,127,.35)', borderRadius: 8, marginBottom: 10 }}>
          <Text size="xs" c="dimmed" mb={6}>子工作流模式：{subflowRef ? `引用 (${subflowRef})` : '嵌入'}</Text>
          {!subflowRef && (
            <Group gap="xs" wrap="wrap">
              <Button size="xs" onClick={() => useUIStore.getState().openSubflow(selected.id)}>打开子工作流</Button>
              <Button size="xs" variant="subtle" onClick={() => {
                const flows = require('../flows/registry') as any
                const list = flows.listFlows?.() || []
                if (!list.length) { alert('库中暂无工作流'); return }
                const pick = prompt('输入要引用的 Flow 名称：\n' + list.map((f:any)=>`- ${f.name} (${f.id})`).join('\n'))
                const match = list.find((f:any)=> f.name === pick || f.id === pick)
                if (match) {
                  const rec = flows.getFlow?.(match.id)
                  useRFStore.getState().updateNodeData(selected.id, { subflowRef: match.id, label: match.name, subflow: undefined, io: rec?.io })
                }
              }}>转换为引用</Button>
            </Group>
          )}
          {subflowRef && (
            <Group gap="xs" wrap="wrap">
              <Button size="xs" variant="subtle" onClick={() => {
                const flows = require('../flows/registry') as any
                const rec = flows.getFlow?.(subflowRef)
                if (!rec) { alert('引用的 Flow 不存在'); return }
                useRFStore.getState().updateNodeData(selected.id, { subflow: { nodes: rec.nodes, edges: rec.edges }, subflowRef: undefined })
              }}>解除引用并嵌入副本</Button>
              <Button size="xs" variant="subtle" onClick={() => {
                const flows = require('../flows/registry') as any
                const rec = flows.getFlow?.(subflowRef)
                if (!rec) { alert('Flow 不存在'); return }
                useRFStore.getState().updateNodeData(selected.id, { io: rec.io })
              }}>同步 IO</Button>
            </Group>
          )}
        </div>
      )}
      <TextInput
        label="标题"
        size="sm"
        value={(selected.data as any)?.label ?? ''}
        onChange={(e) => updateNodeLabel(selected.id, e.currentTarget.value)}
      />

      {kind === 'textToImage' && (
        <form onSubmit={form.handleSubmit((values) => useRFStore.getState().updateNodeData(selected.id, values))} style={{ marginTop: 12 }}>
          <Textarea label="提示词" autosize minRows={3} {...form.register('prompt')} error={form.formState.errors.prompt?.message as any} />
          <Group grow mt={8}>
            <Controller name="steps" control={form.control} render={({ field }) => (
              <NumberInput label="Steps" min={1} max={100} value={field.value} onChange={(v)=>field.onChange(Number(v))} />
            )} />
            <Controller name="seed" control={form.control} render={({ field }) => (
              <NumberInput label="Seed" value={field.value ?? ''} onChange={(v)=>field.onChange(v===undefined? undefined : Number(v))} />
            )} />
          </Group>
          <Controller name="aspect" control={form.control} render={({ field }) => (
            <Select mt={8} label="比例" data={[{value:'16:9',label:'16:9'},{value:'1:1',label:'1:1'},{value:'9:16',label:'9:16'}]} value={field.value} onChange={field.onChange} />
          )} />
          <Button type="submit" mt={10}>应用</Button>
        </form>
      )}

      {kind === 'composeVideo' && (
        <form onSubmit={form.handleSubmit((values) => useRFStore.getState().updateNodeData(selected.id, values))} style={{ marginTop: 12 }}>
          <Textarea label="分镜/脚本" autosize minRows={4} {...form.register('storyboard')} error={form.formState.errors.storyboard?.message as any} />
          <Group grow mt={8}>
            <Controller name="duration" control={form.control} render={({ field }) => (
              <NumberInput label="Duration(s)" min={1} max={600} value={field.value} onChange={(v)=>field.onChange(Number(v))} />
            )} />
            <Controller name="fps" control={form.control} render={({ field }) => (
              <NumberInput label="FPS" min={1} max={60} value={field.value} onChange={(v)=>field.onChange(Number(v))} />
            )} />
          </Group>
          <TextInput
            label="Remix 目标 ID（可选）"
            placeholder="例如：gen_01ka5v1x58e5ksd0s62qr1exyb"
            {...form.register('remixTargetId')}
            error={form.formState.errors.remixTargetId?.message as any}
            mt={8}
          />
          <Button type="submit" mt={10}>应用</Button>
        </form>
      )}

      {kind === 'tts' && (
        <form onSubmit={form.handleSubmit((values) => useRFStore.getState().updateNodeData(selected.id, values))} style={{ marginTop: 12 }}>
          <Textarea label="文本" autosize minRows={3} {...form.register('text')} error={form.formState.errors.text?.message as any} />
          <Group grow mt={8}>
            <Controller name="voice" control={form.control} render={({ field }) => (
              <Select label="声音" data={[{value:'female',label:'female'},{value:'male',label:'male'}]} value={field.value} onChange={field.onChange} />
            )} />
            <Controller name="speed" control={form.control} render={({ field }) => (
              <NumberInput label="速度" step={0.1} min={0.5} max={1.5} value={field.value} onChange={(v)=>field.onChange(Number(v))} />
            )} />
          </Group>
          <Button type="submit" mt={10}>应用</Button>
        </form>
      )}

      {kind === 'subtitleAlign' && (
        <form onSubmit={form.handleSubmit((values) => useRFStore.getState().updateNodeData(selected.id, values))} style={{ marginTop: 12 }}>
          <TextInput label="音频 URL" {...form.register('audioUrl')} error={form.formState.errors.audioUrl?.message as any} />
          <Textarea mt={8} label="字幕文本" autosize minRows={4} {...form.register('transcript')} error={form.formState.errors.transcript?.message as any} />
          <Button type="submit" mt={10}>应用</Button>
        </form>
      )}

      {kind === 'subflow' && subflowIO && (
        <div style={{ marginTop: 14 }}>
          <h3 style={{ margin: '8px 0 8px', fontSize: 14 }}>IO 映射</h3>
          <div style={{ fontSize: 12, opacity: .7, marginBottom: 6 }}>配置父级变量名/键，与子工作流 IO 对应（占位实现）。</div>
          <div style={{ fontWeight: 600, margin: '6px 0' }}>Inputs</div>
          {(subflowIO.inputs || []).length === 0 && <div style={{ fontSize: 12, opacity: .6 }}>无</div>}
          {(subflowIO.inputs || []).map((p: any) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ width: 120, fontSize: 12 }}>{p.label} <span style={{ opacity: .6 }}>({p.type})</span></span>
              <input
                placeholder="父级变量名"
                value={bindings.inputs?.[p.id] || ''}
                onChange={(e) => useRFStore.getState().updateNodeData(selected.id, { ioBindings: { inputs: { ...bindings.inputs, [p.id]: e.target.value }, outputs: bindings.outputs } })}
                style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(127,127,127,.35)' }}
              />
            </div>
          ))}
          <div style={{ fontWeight: 600, margin: '6px 0' }}>Outputs</div>
          {(subflowIO.outputs || []).length === 0 && <div style={{ fontSize: 12, opacity: .6 }}>无</div>}
          {(subflowIO.outputs || []).map((p: any) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ width: 120, fontSize: 12 }}>{p.label} <span style={{ opacity: .6 }}>({p.type})</span></span>
              <input
                placeholder="父级输出键"
                value={bindings.outputs?.[p.id] || ''}
                onChange={(e) => useRFStore.getState().updateNodeData(selected.id, { ioBindings: { inputs: bindings.inputs, outputs: { ...bindings.outputs, [p.id]: e.target.value } } })}
                style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(127,127,127,.35)' }}
              />
            </div>
          ))}
        </div>
      )}

      <Divider my={12} />
      <Title order={6}>运行日志</Title>
      <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid rgba(127,127,127,.25)', borderRadius: 8, padding: '8px 10px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12 }}>
        {(logs && logs.length) ? logs.map((l, i) => (<div key={i}>{l}</div>)) : <Text size="xs" c="dimmed">暂无日志</Text>}
      </div>

      <Divider my={12} />
      <Title order={6}>预览</Title>
        {result?.preview?.type === 'image' && result.preview.src && (
          <img src={result.preview.src} alt={String((selected.data as any)?.label || '')} style={{ width: '100%', borderRadius: 8, border: '1px solid rgba(127,127,127,.25)' }} />
        )}
        {result?.preview?.type === 'audio' && (
          <Text size="xs" c="dimmed">（音频占位，暂未生成音频数据）</Text>
        )}
        {!result?.preview && (
          <Text size="xs" c="dimmed">暂无预览</Text>
        )}
      
    </div>
  )
}
