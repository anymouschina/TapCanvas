import React from 'react'
import type { NodeProps } from 'reactflow'
import { Handle, Position, NodeToolbar } from 'reactflow'
import { useRFStore } from '../store'
import { useUIStore } from '../../ui/uiStore'
import { ActionIcon, Group, Paper, Textarea, Select, NumberInput, Button, Text } from '@mantine/core'
import { IconMaximize, IconDownload, IconArrowsDiagonal2, IconBrush, IconPhotoUp, IconDots, IconAdjustments, IconUpload, IconPlayerPlay, IconTexture, IconVideo, IconArrowRight, IconScissors, IconPhotoEdit } from '@tabler/icons-react'

type Data = {
  label: string
  kind?: string
  status?: 'idle' | 'queued' | 'running' | 'success' | 'error' | 'canceled'
  progress?: number
}

export default function TaskNode({ id, data, selected }: NodeProps<Data>): JSX.Element {
  const status = data?.status ?? 'idle'
  const color =
    status === 'success' ? '#16a34a' :
    status === 'error' ? '#ef4444' :
    status === 'canceled' ? '#475569' :
    status === 'running' ? '#8b5cf6' :
    status === 'queued' ? '#f59e0b' : 'rgba(127,127,127,.6)'

  const kind = data?.kind
  const targets: { id: string; type: string; pos: Position }[] = []
  const sources: { id: string; type: string; pos: Position }[] = []

  if (kind === 'composeVideo') {
    targets.push({ id: 'in-image', type: 'image', pos: Position.Left })
    targets.push({ id: 'in-audio', type: 'audio', pos: Position.Left })
    targets.push({ id: 'in-subtitle', type: 'subtitle', pos: Position.Left })
    sources.push({ id: 'out-video', type: 'video', pos: Position.Right })
  } else if (kind === 'image') {
    targets.push({ id: 'in-image', type: 'image', pos: Position.Left })
    sources.push({ id: 'out-image', type: 'image', pos: Position.Right })
  } else if (kind === 'video') {
    targets.push({ id: 'in-image', type: 'image', pos: Position.Left })
    sources.push({ id: 'out-video', type: 'video', pos: Position.Right })
  } else if (kind === 'subflow') {
    const io = (data as any)?.io as { inputs?: { id: string; type: string; label?: string }[]; outputs?: { id: string; type: string; label?: string }[] } | undefined
    if (io?.inputs?.length) io.inputs.forEach((p, idx) => targets.push({ id: `in-${p.type}`, type: p.type, pos: Position.Left }))
    if (io?.outputs?.length) io.outputs.forEach((p, idx) => sources.push({ id: `out-${p.type}`, type: p.type, pos: Position.Right }))
  } else if (kind === 'textToImage') {
    sources.push({ id: 'out-image', type: 'image', pos: Position.Right })
  } else if (kind === 'tts') {
    sources.push({ id: 'out-audio', type: 'audio', pos: Position.Right })
  } else if (kind === 'subtitleAlign') {
    sources.push({ id: 'out-subtitle', type: 'subtitle', pos: Position.Right })
  } else {
    // generic fallback
    targets.push({ id: 'in-any', type: 'any', pos: Position.Left })
    sources.push({ id: 'out-any', type: 'any', pos: Position.Right })
  }

  const [editing, setEditing] = React.useState(false)
  const updateNodeLabel = useRFStore(s => s.updateNodeLabel)
  const openSubflow = useUIStore(s => s.openSubflow)
  const openParamFor = useUIStore(s => s.openParamFor)
  const runSelected = useRFStore(s => s.runSelected)
  const updateNodeData = useRFStore(s => s.updateNodeData)
  const addNode = useRFStore(s => s.addNode)
  const addEdge = useRFStore(s => s.onConnect)
  const [prompt, setPrompt] = React.useState<string>((data as any)?.prompt || '')
  const [aspect, setAspect] = React.useState<string>((data as any)?.aspect || '16:9')
  const [scale, setScale] = React.useState<number>((data as any)?.scale || 1)
  const selectedCount = useRFStore(s => s.nodes.reduce((acc, n) => acc + (n.selected ? 1 : 0), 0))
  const fileRef = React.useRef<HTMLInputElement|null>(null)
  const imageUrl = (data as any)?.imageUrl as string | undefined
  const [hovered, setHovered] = React.useState<number|null>(null)
  const [showMore, setShowMore] = React.useState(false)
  const moreRef = React.useRef<HTMLDivElement|null>(null)

  React.useEffect(() => {
    if (!selected || selectedCount !== 1) setShowMore(false)
  }, [selected, selectedCount])

  React.useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      if (!showMore) return
      const root = (moreRef.current || document.querySelector('[data-more-root]')) as HTMLElement | null
      if (root && ev.target instanceof HTMLElement && root.contains(ev.target)) return
      setShowMore(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [showMore])

  // Define node-specific tools and overflow calculation
  const uniqueDefs = React.useMemo(() => {
    if (kind === 'image') {
      return [
        { key: 'extend', label: '扩图', icon: <IconArrowsDiagonal2 size={16} />, onClick: () => {} },
        { key: 'cutout', label: '抠图', icon: <IconScissors size={16} />, onClick: () => {} },
        { key: 'upscale', label: 'HD 增强', icon: <IconPhotoUp size={16} />, onClick: () => {} },
        { key: 'inpaint', label: '局部重绘', icon: <IconBrush size={16} />, onClick: () => {} },
        { key: 'editor', label: '图片编辑器', icon: <IconPhotoEdit size={16} />, onClick: () => {} },
      ] as { key: string; label: string; icon: JSX.Element; onClick: () => void }[]
    }
    // default tools for other node kinds (kept minimal)
    return [
      { key: 'extend', label: '扩展', icon: <IconArrowsDiagonal2 size={16} />, onClick: () => {} },
      { key: 'params', label: '参数', icon: <IconAdjustments size={16} />, onClick: () => openParamFor(id) },
    ] as { key: string; label: string; icon: JSX.Element; onClick: () => void }[]
  }, [id, kind, openParamFor])

  const maxTools = 5
  const commonLen = 2
  const reserveForMore = uniqueDefs.length > (maxTools - commonLen) ? 1 : 0
  const maxUniqueVisible = Math.max(0, maxTools - commonLen - reserveForMore)
  const visibleDefs = uniqueDefs.slice(0, maxUniqueVisible)
  const extraDefs = uniqueDefs.slice(maxUniqueVisible)

  const hasContent = React.useMemo(() => {
    if (kind === 'image') return Boolean(imageUrl)
    if (kind === 'video' || kind === 'composeVideo') return Boolean((data as any)?.videoUrl)
    if (kind === 'textToImage') return Boolean((data as any)?.imageUrl)
    if (kind === 'tts') return Boolean((data as any)?.audioUrl)
    return false
  }, [kind, imageUrl, data])

  const connectToRight = (targetKind: string, targetLabel: string) => {
    // create a node to the right and connect
    const all = useRFStore.getState().nodes
    const self = all.find(n => n.id === id)
    if (!self) return
    const pos = { x: self.position.x + 260, y: self.position.y }
    const before = useRFStore.getState().nextId
    addNode('taskNode', targetLabel, { kind: targetKind })
    const after = useRFStore.getState().nextId
    const newId = `n${after-1}`
    useRFStore.setState(s => ({ nodes: s.nodes.map(n => n.id === newId ? { ...n, position: pos } : n) }))
    // best-effort connection
    addEdge({ source: id, target: newId, sourceHandle: 'out-image', targetHandle: targetKind==='video' ? 'in-image' : 'in-image' } as any)
  }

  const fixedWidth = kind === 'image' ? 320 : undefined
  return (
    <div style={{
      border: '1px solid rgba(127,127,127,.35)',
      borderRadius: 12,
      padding: '10px 12px',
      background: 'rgba(127,127,127,.08)',
      width: fixedWidth
    }}>
      {/* Title */}
      <div style={{ fontSize: 12, fontWeight: 600, color: '#e5e7eb', marginBottom: 6 }}>{data?.label ?? (kind==='image' ? 'Image' : 'Task')}</div>
      {/* Top floating toolbar anchored to node */}
      <NodeToolbar isVisible={!!selected && selectedCount === 1 && hasContent} position={Position.Top} align="center">
        <div ref={moreRef} style={{ position: 'relative', display: 'inline-block' }} data-more-root>
          <Paper withBorder shadow="sm" radius="xl" className="glass" p={4}>
            <Group gap={6}>
            <ActionIcon key="preview" variant="subtle" title="放大预览" onClick={()=>{
              const url = (kind==='image'||kind==='textToImage') ? (imageUrl || (data as any)?.imageUrl) : (kind==='video'||kind==='composeVideo') ? (data as any)?.videoUrl : (kind==='tts' ? (data as any)?.audioUrl : undefined)
              const k: any = (kind==='tts') ? 'audio' : (kind==='video'||kind==='composeVideo') ? 'video' : 'image'
              if (url) useUIStore.getState().openPreview({ url, kind: k, name: data?.label })
            }}><IconMaximize size={16} /></ActionIcon>
            <ActionIcon key="download" variant="subtle" title="下载" onClick={()=>{
              const url = (kind==='image'||kind==='textToImage') ? (imageUrl || (data as any)?.imageUrl) : (kind==='video'||kind==='composeVideo') ? (data as any)?.videoUrl : (kind==='tts' ? (data as any)?.audioUrl : undefined)
              if (!url) return
              const a = document.createElement('a')
              a.href = url
              a.download = `${(data?.label || kind)}-${Date.now()}`
              document.body.appendChild(a)
              a.click()
              a.remove()
            }}><IconDownload size={16} /></ActionIcon>
            {visibleDefs.length > 0 && <span style={{ color: 'rgba(229,231,235,.65)', padding: '0 6px', userSelect: 'none' }}>|</span>}
            {visibleDefs.map(d => (
              <Button key={d.key} size="xs" variant="subtle" leftSection={d.icon} onClick={d.onClick}>{d.label}</Button>
            ))}
            {extraDefs.length > 0 && (
              <ActionIcon variant="subtle" title="更多" onClick={(e)=>{ e.stopPropagation(); setShowMore(v=>!v) }}><IconDots size={16} /></ActionIcon>
            )}
          </Group>
        </Paper>
          {showMore && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 2 }}>
              <Paper withBorder shadow="md" radius="md" className="glass" p="xs" style={{ width: 260 }}>
                <Text size="xs" c="dimmed" mb={6}>更多</Text>
                <Group wrap="wrap" gap={6}>
                  {extraDefs.map(d => (
                    <Button key={d.key} size="xs" variant="subtle" leftSection={<>{d.icon}</>} onClick={()=>{ setShowMore(false); d.onClick() }}>{d.label}</Button>
                  ))}
                </Group>
              </Paper>
            </div>
          )}
        </div>
      </NodeToolbar>
      {targets.map(h => (
        <Handle
          key={h.id}
          id={h.id}
          type="target"
          position={h.pos}
          style={{ left: h.pos===Position.Left? -6: undefined, right: h.pos===Position.Right? -6: undefined }}
          data-handle-type={h.type}
          title={`输入: ${h.type}`}
        />
      ))}
      {/* Content Area for Image/Video kinds */}
      {kind === 'image' && (
        <div style={{ position: 'relative', marginTop: 6 }}>
          {!imageUrl ? (
            <>
              {/* 占位图区域，引导上传 */}
              <div
                style={{
                  width: 296,
                  height: 180,
                  borderRadius: 10,
                  border: '1px dashed rgba(148,163,184,0.6)',
                  background: 'rgba(15,23,42,0.85)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  cursor: 'pointer',
                }}
                onClick={() => fileRef.current?.click()}
              >
                <div style={{ width: 40, height: 40, borderRadius: 999, background: 'rgba(15,23,42,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(148,163,184,0.65)' }}>
                  <IconPhotoEdit size={20} color="#e5e7eb" />
                </div>
                <div style={{ color: '#e5e7eb', fontSize: 13 }}>点击上传图片</div>
                <div style={{ color: '#9ca3af', fontSize: 11 }}>支持 PNG / JPG，最大 30MB</div>
              </div>
              {/* 快捷操作列表，增强引导 */}
              <div style={{ width: 296, display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 2px' }} onMouseLeave={()=>setHovered(null)}>
                {[
                  { label: '上传图片并编辑', icon: <IconUpload size={16} />, onClick: () => fileRef.current?.click(), hint: '图片大小不能超过30MB' },
                  { label: '图片换背景', icon: <IconTexture size={16} />, onClick: () => connectToRight('image','Image') },
                  { label: '首帧图生视频', icon: <IconVideo size={16} />, onClick: () => connectToRight('video','Video') },
                ].map((row, idx) => {
                  const active = hovered === idx
                  const dimOthers = hovered !== null && hovered !== idx
                  return (
                    <div key={row.label}
                      onMouseEnter={()=>setHovered(idx)}
                      onClick={row.onClick}
                      style={{
                        cursor: 'pointer',
                        padding: '8px 10px', borderRadius: 6,
                        background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                        transition: 'background .12s ease, opacity .12s ease',
                        opacity: dimOthers ? 0.8 : 1,
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ color: active ? '#ffffff' : '#cbd5e1' }}>{row.icon}</div>
                        <div style={{ flex: 1, color: '#e5e7eb', fontSize: 13 }}>{row.label}</div>
                        <div style={{ color: active ? '#ffffff' : 'transparent', transition: 'color .12s ease', width: 16, display: 'flex', justifyContent: 'center' }}>
                          <IconArrowRight size={14} />
                        </div>
                      </div>
                      {active && idx === 0 && (
                        <div style={{ marginLeft: 36, marginTop: 4, color: '#9ca3af', fontSize: 11 }}>
                          图片大小不能超过30MB
                        </div>
                      )}
                    </div>
                  )
                })}
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e)=>{
                  const f = e.currentTarget.files?.[0]
                  if (!f) return
                  const url = URL.createObjectURL(f)
                  updateNodeData(id, { imageUrl: url })
                }} />
              </div>
            </>
          ) : (
            <div style={{ position: 'relative' }}>
              <img src={imageUrl} alt="uploaded" style={{ width: 296, maxWidth: '100%', height: 'auto', borderRadius: 10, display: 'block', border: '1px solid rgba(127,127,127,.35)' }} />
              <ActionIcon size={28} variant="light" style={{ position: 'absolute', right: 8, top: 8 }} title="替换图片" onClick={()=>fileRef.current?.click()}>
                <IconUpload size={14} />
              </ActionIcon>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e)=>{
                const f = e.currentTarget.files?.[0]
                if (!f) return
                const url = URL.createObjectURL(f)
                updateNodeData(id, { imageUrl: url })
              }} />
            </div>
          )}
        </div>
      )}
      {/* remove bottom kind text for all nodes */}
      {/* Removed bottom tag list; top-left label identifies node type */}
      {status === 'running' && (
        <div style={{ marginTop: 6, height: 6, background: 'rgba(127,127,127,.25)', borderRadius: 4 }}>
          <div style={{ width: `${Math.min(100, Math.max(0, data?.progress ?? 0))}%`, height: '100%', background: color, borderRadius: 4 }} />
        </div>
      )}
      {sources.map(h => (
        <Handle
          key={h.id}
          id={h.id}
          type="source"
          position={h.pos}
          style={{ right: h.pos===Position.Right? -6: undefined, left: h.pos===Position.Left? -6: undefined }}
          data-handle-type={h.type}
          title={`输出: ${h.type}`}
        />
      ))}

      {/* Bottom detail panel near node */}
      <NodeToolbar isVisible={!!selected && selectedCount === 1} position={Position.Bottom} align="center">
        <Paper withBorder shadow="md" radius="md" className="glass" p="sm" style={{ width: 420, transformOrigin: 'top center' }}>
          <Text size="xs" c="dimmed" mb={6}>详情</Text>
          <Textarea autosize minRows={2} placeholder="在这里输入提示词..." value={prompt} onChange={(e)=>setPrompt(e.currentTarget.value)} />
          <Group grow mt={6}>
            <Select label="比例" data={[{value:'16:9',label:'16:9'},{value:'1:1',label:'1:1'},{value:'9:16',label:'9:16'}]} value={aspect} onChange={(v)=>setAspect(v||'16:9')} />
            <NumberInput label="倍率" min={0.5} max={4} step={0.5} value={scale} onChange={(v)=>setScale(Number(v)||1)} />
          </Group>
          <Group justify="flex-end" mt={8}>
            <Button size="xs" onClick={()=>{ updateNodeData(id, { prompt, aspect, scale }); runSelected() }}>一键执行</Button>
          </Group>
        </Paper>
      </NodeToolbar>

      {/* More panel rendered directly under the top toolbar with 4px gap */}
    </div>
  )
}
