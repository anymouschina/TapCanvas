import React from 'react'
import type { NodeProps } from 'reactflow'
import { Handle, Position, NodeToolbar } from 'reactflow'
import { useRFStore } from '../store'
import { useUIStore } from '../../ui/uiStore'
import { ActionIcon, Group, Paper, Textarea, Select, NumberInput, Button, Text, Modal, Stack } from '@mantine/core'
import { IconMaximize, IconDownload, IconArrowsDiagonal2, IconBrush, IconPhotoUp, IconDots, IconAdjustments, IconUpload, IconPlayerPlay, IconTexture, IconVideo, IconArrowRight, IconScissors, IconPhotoEdit, IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import { markDraftPromptUsed, suggestDraftPrompts } from '../../api/server'

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
  const [sampleCount, setSampleCount] = React.useState<number>((data as any)?.sampleCount || 1)
  const selectedCount = useRFStore(s => s.nodes.reduce((acc, n) => acc + (n.selected ? 1 : 0), 0))
  const fileRef = React.useRef<HTMLInputElement|null>(null)
  const imageUrl = (data as any)?.imageUrl as string | undefined
  const imageResults = React.useMemo(() => {
    const raw = (data as any)?.imageResults as { url: string }[] | undefined
    if (raw && Array.isArray(raw) && raw.length > 0) return raw
    const single = imageUrl || null
    return single ? [{ url: single }] : []
  }, [data, imageUrl])
  const [imageExpanded, setImageExpanded] = React.useState(false)
  const [imagePrimaryIndex, setImagePrimaryIndex] = React.useState(0)
  const [imageSelectedIndex, setImageSelectedIndex] = React.useState(0)
  const [hovered, setHovered] = React.useState<number|null>(null)
  const [showMore, setShowMore] = React.useState(false)
  const moreRef = React.useRef<HTMLDivElement|null>(null)

  const [promptSuggestions, setPromptSuggestions] = React.useState<string[]>([])
  const [activeSuggestion, setActiveSuggestion] = React.useState(0)
  const suggestTimeout = React.useRef<number | null>(null)
  const promptSuggestMode = useUIStore(s => s.promptSuggestMode)
  const lastResult = (data as any)?.lastResult as { preview?: { type?: string; value?: string } } | undefined
  const lastText =
    lastResult && lastResult.preview && lastResult.preview.type === 'text'
      ? String(lastResult.preview.value || '')
      : ''
  const rawTextResults =
    ((data as any)?.textResults as { text: string }[] | undefined) || []
  const textResults =
    rawTextResults.length > 0
      ? rawTextResults
      : lastText
        ? [{ text: lastText }]
        : []
  const [compareOpen, setCompareOpen] = React.useState(false)
  const [modelKey, setModelKey] = React.useState<string>((data as any)?.geminiModel || 'gemini-2.5-flash')
  const [imageModel, setImageModel] = React.useState<string>((data as any)?.imageModel || 'qwen-image-plus')
  const { upstreamText, upstreamImageUrl } = useRFStore((s) => {
    const edgesToThis = s.edges.filter((e) => e.target === id)
    if (!edgesToThis.length) return { upstreamText: null as string | null, upstreamImageUrl: null as string | null }
    const last = edgesToThis[edgesToThis.length - 1]
    const src = s.nodes.find((n) => n.id === last.source)
    if (!src) return { upstreamText: null, upstreamImageUrl: null }
    const sd: any = src.data || {}
    const skind: string | undefined = sd.kind
    const uText =
      skind === 'textToImage' || skind === 'image'
        ? (sd.prompt as string | undefined) || (sd.label as string | undefined) || null
        : null
    const uImg =
      skind === 'image' || skind === 'textToImage'
        ? ((sd.imageUrl as string | undefined) || null)
        : null
    return { upstreamText: uText, upstreamImageUrl: uImg }
  })

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

  React.useEffect(() => {
    if (suggestTimeout.current) {
      window.clearTimeout(suggestTimeout.current)
      suggestTimeout.current = null
    }
    const value = prompt.trim()
    if (!value || value.length < 6) {
      setPromptSuggestions([])
      setActiveSuggestion(0)
      return
    }
    suggestTimeout.current = window.setTimeout(async () => {
      try {
        const mode = promptSuggestMode === 'semantic' ? 'semantic' : 'history'
        const res = await suggestDraftPrompts(value, 'sora', mode)
        setPromptSuggestions(res.prompts || [])
        setActiveSuggestion(0)
      } catch {
        setPromptSuggestions([])
        setActiveSuggestion(0)
      }
    }, 260)
    return () => {
      if (suggestTimeout.current) {
        window.clearTimeout(suggestTimeout.current)
        suggestTimeout.current = null
      }
    }
  }, [prompt])

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

  const fixedWidth = (kind === 'image' || kind === 'textToImage') ? 320 : undefined
  const hasPrompt = ((prompt || (data as any)?.prompt || upstreamText || '')).trim().length > 0
  const hasAiText = lastText.trim().length > 0

  const edgeRoute = useUIStore(s => s.edgeRoute)

  const connectImageToText = () => {
    const all = useRFStore.getState().nodes
    const self = all.find((n: any) => n.id === id)
    if (!self) return
    const pos = { x: self.position.x + 260, y: self.position.y }
    const basePrompt = ((self.data as any)?.prompt as string | undefined) || lastText || ''
    useRFStore.setState((s: any) => {
      const newId = `n${s.nextId}`
      const nodeData: any = { label: '继续', kind: 'textToImage' }
      if (basePrompt && basePrompt.trim()) nodeData.prompt = basePrompt.trim()
      const node = { id: newId, type: 'taskNode', position: pos, data: nodeData }
      const edgeId = `e-${id}-${newId}-${Date.now().toString(36)}`
      const edge: any = {
        id: edgeId,
        source: id,
        target: newId,
        sourceHandle: 'out-image',
        targetHandle: 'in-any',
        type: (edgeRoute === 'orth' ? 'orth' : 'typed') as any,
        animated: true,
      }
      return { nodes: [...s.nodes, node], edges: [...s.edges, edge], nextId: s.nextId + 1 }
    })
  }
  const connectFromText = (targetKind: 'image' | 'video') => {
    const all = useRFStore.getState().nodes
    const self = all.find((n: any) => n.id === id)
    if (!self) return
    const pos = { x: self.position.x + 260, y: self.position.y }
    const before = useRFStore.getState().nextId
    useRFStore.setState((s: any) => {
      const newId = `n${s.nextId}`
      const label = targetKind === 'image' ? 'Image' : 'Video'
      const newKind = targetKind === 'image' ? 'image' : 'composeVideo'
      const basePrompt = (self.data as any)?.prompt as string | undefined
      const nodeData: any = {
        label,
        kind: newKind,
        // 继承文本节点的生成次数配置，用于多次生成图像/视频
        sampleCount: (self.data as any)?.sampleCount,
      }
      if (basePrompt && basePrompt.trim()) nodeData.prompt = basePrompt
      const node = { id: newId, type: 'taskNode', position: pos, data: nodeData }
      const edgeId = `e-${id}-${newId}-${Date.now().toString(36)}`
      const targetHandle = 'in-image'
      const edge: any = {
        id: edgeId,
        source: id,
        target: newId,
        sourceHandle: 'out-any',
        targetHandle,
        type: (edgeRoute === 'orth' ? 'orth' : 'typed') as any,
        animated: true,
      }
      return { nodes: [...s.nodes, node], edges: [...s.edges, edge], nextId: s.nextId + 1 }
    })
  }
  return (
    <div style={{
      border: '1px solid rgba(127,127,127,.35)',
      borderRadius: 12,
      padding: '10px 12px',
      background: 'rgba(127,127,127,.08)',
      width: fixedWidth
    }}>
      {/* Title */}
      <div style={{ fontSize: 12, fontWeight: 600, color: '#e5e7eb', marginBottom: 6 }}>
        {data?.label ?? (kind === 'image' ? 'Image' : kind === 'textToImage' ? 'Text' : 'Task')}
      </div>
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
      {/* Content Area for Image/Video/Text kinds */}
      {kind === 'image' && (
        <div style={{ position: 'relative', marginTop: 6 }}>
          {imageResults.length === 0 ? (
            <>
              {/* 快捷操作列表，增强引导 */}
              <div style={{ width: 296, display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 2px' }} onMouseLeave={()=>setHovered(null)}>
                {[
                  { label: '上传图片并编辑', icon: <IconUpload size={16} />, onClick: () => fileRef.current?.click(), hint: '图片大小不能超过30MB' },
                  { label: '图片换背景', icon: <IconTexture size={16} />, onClick: () => connectToRight('image','Image') },
                  { label: '图生视频', icon: <IconVideo size={16} />, onClick: () => connectToRight('video','Video') },
                  { label: '反推提示词', icon: <IconAdjustments size={16} />, onClick: () => connectImageToText() },
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
              {/* 展开时的顶部悬浮工具条，针对当前选中图片生效 */}
              {imageExpanded && imageResults.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: -36,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 5,
                  }}
                >
                  <Paper
                    withBorder
                    shadow="sm"
                    radius="xl"
                    className="glass"
                    p={4}
                    style={{ backdropFilter: 'blur(12px)' }}
                  >
                    <Group gap={6}>
                      <Button
                        size="xs"
                        variant="subtle"
                        leftSection={<IconDownload size={14} />}
                        onClick={() => {
                          const img = imageResults[imageSelectedIndex] || imageResults[0]
                          if (!img?.url) return
                          const a = document.createElement('a')
                          a.href = img.url
                          a.download = `image-${Date.now()}`
                          document.body.appendChild(a)
                          a.click()
                          a.remove()
                        }}
                      >
                        下载
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        leftSection={<IconArrowsDiagonal2 size={14} />}
                        onClick={() => {
                          // TODO: 接入扩图能力
                          console.log('extend image at', imageSelectedIndex)
                        }}
                      >
                        扩图
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        leftSection={<IconBrush size={14} />}
                        onClick={() => {
                          // TODO: 接入描图/局部重绘
                          console.log('inpaint image at', imageSelectedIndex)
                        }}
                      >
                        描图
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        leftSection={<IconPhotoUp size={14} />}
                        onClick={() => {
                          // TODO: 接入高清增强
                          console.log('enhance image at', imageSelectedIndex)
                        }}
                      >
                        增强
                      </Button>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        title="更多操作"
                        onClick={() => {
                          // 预留更多操作入口
                          console.log('more actions for image at', imageSelectedIndex)
                        }}
                      >
                        <IconDots size={14} />
                      </ActionIcon>
                    </Group>
                  </Paper>
                </div>
              )}
              {/* 结果组：折叠 / 展开 */}
              {!imageExpanded || imageResults.length <= 1 ? (
                <div style={{ position: 'relative', width: 296 }}>
                  {/* 背后影子卡片，暗示多图 */}
                  {imageResults.length > 1 && (
                    <div
                      style={{
                        position: 'absolute',
                        left: 8,
                        top: 8,
                        width: '100%',
                        borderRadius: 10,
                        height: '100%',
                        background: 'rgba(15,23,42,0.9)',
                        border: '1px solid rgba(55,65,81,0.7)',
                        transform: 'translate(4px, 4px)',
                        zIndex: 0,
                      }}
                    />
                  )}
                  <div
                    style={{
                      position: 'relative',
                      borderRadius: 10,
                      overflow: 'hidden',
                      boxShadow: '0 10px 25px rgba(0,0,0,.55)',
                      border: '1px solid rgba(148,163,184,0.8)',
                      background: 'black',
                    }}
                  >
                    <img
                      src={imageResults[imagePrimaryIndex]?.url}
                      alt="主图"
                      style={{
                        width: '100%',
                        height: 'auto',
                        display: 'block',
                        objectFit: 'cover',
                      }}
                    />
                    {/* 主图替换按钮 */}
                    <ActionIcon
                      size={28}
                      variant="light"
                      style={{ position: 'absolute', right: 8, top: 8 }}
                      title="替换图片"
                      onClick={() => fileRef.current?.click()}
                    >
                      <IconUpload size={14} />
                    </ActionIcon>
                    {/* 数量 + 展开标签 */}
                    {imageResults.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setImageExpanded(true)}
                        style={{
                          position: 'absolute',
                          right: 8,
                          bottom: 8,
                          padding: '2px 8px',
                          borderRadius: 999,
                          border: 'none',
                          background: 'rgba(15,23,42,0.85)',
                          color: '#e5e7eb',
                          fontSize: 11,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          cursor: 'pointer',
                        }}
                      >
                        <span>{imageResults.length}</span>
                        <IconChevronDown size={12} />
                      </button>
                    )}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={async (e) => {
                      const f = e.currentTarget.files?.[0]
                      if (!f) return
                      const url = URL.createObjectURL(f)
                      updateNodeData(id, { imageUrl: url })
                    }}
                  />
                </div>
              ) : (
                <div style={{ width: 296, overflow: 'hidden' }}>
                  {/* 展开画廊 */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    {imageResults.map((img, idx) => {
                      const isPrimary = idx === imagePrimaryIndex
                      const isSelected = idx === imageSelectedIndex
                      return (
                        <div
                          key={`${idx}-${img.url}`}
                          style={{
                            position: 'relative',
                            flex: idx === 0 ? '0 0 60%' : '0 0 40%',
                            borderRadius: 10,
                            overflow: 'hidden',
                            border: isSelected
                              ? '2px solid rgba(96,165,250,0.9)'
                              : '1px solid rgba(55,65,81,0.7)',
                            boxShadow: isSelected
                              ? '0 10px 25px rgba(37,99,235,.55)'
                              : '0 6px 18px rgba(0,0,0,.45)',
                            cursor: 'pointer',
                            background: 'black',
                          }}
                          onClick={() => {
                            setImageSelectedIndex(idx)
                          }}
                        >
                          <img
                            src={img.url}
                            alt={`结果 ${idx + 1}`}
                            style={{
                              width: '100%',
                              height: 140,
                              objectFit: 'cover',
                              display: 'block',
                            }}
                          />
                          {/* 非主图 hover 操作 */}
                          {!isPrimary && (
                            <div
                              style={{
                                position: 'absolute',
                                inset: 0,
                                display: 'flex',
                                alignItems: 'flex-start',
                                justifyContent: 'flex-end',
                                padding: 6,
                                background:
                                  'linear-gradient(to bottom, rgba(15,23,42,0.85), transparent)',
                                opacity: 0,
                                transition: 'opacity .15s ease',
                              }}
                              className="image-card-hover"
                            >
                              <Button
                                size="xs"
                                variant="white"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setImagePrimaryIndex(idx)
                                  setImageSelectedIndex(idx)
                                }}
                              >
                                设为主图
                              </Button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {/* 折叠/展开标签 */}
                  <Group justify="space-between" mt={4}>
                    <Button
                      size="xs"
                      variant="subtle"
                      leftSection={<IconChevronUp size={12} />}
                      onClick={() => setImageExpanded(false)}
                    >
                      收起
                    </Button>
                    <Text size="xs" c="dimmed">
                      共 {imageResults.length} 张
                    </Text>
                  </Group>
                </div>
              )}
            </div>
          )}
          {!imageUrl && upstreamText && (
            <div
              style={{
                marginTop: 6,
                width: 296,
                maxHeight: 80,
                borderRadius: 8,
                border: '1px dashed rgba(148,163,184,0.6)',
                background: 'rgba(15,23,42,0.6)',
                padding: '6px 8px',
                color: '#e5e7eb',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                overflowY: 'auto',
              }}
            >
              {upstreamText}
            </div>
          )}
        </div>
      )}
      {kind === 'textToImage' && (
        <div style={{ marginTop: 6 }}>
          {!(hasPrompt || hasAiText) ? (
            <div
              style={{
                width: 296,
                borderRadius: 10,
                border: '1px solid rgba(148,163,184,0.6)',
                background: 'rgba(15,23,42,0.85)',
                padding: '8px 10px',
                color: '#e5e7eb',
                fontSize: 13,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <Button
                size="xs"
                variant="subtle"
                onClick={() => connectFromText('image')}
              >
                文生图
              </Button>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => connectFromText('video')}
              >
                文生视频
              </Button>
            </div>
          ) : (
            <div
              style={{
                width: 296,
                minHeight: 80,
                maxHeight: 140,
                borderRadius: 10,
                border: '1px solid rgba(148,163,184,0.6)',
                background: 'rgba(15,23,42,0.85)',
                padding: '8px 10px',
                color: '#e5e7eb',
                fontSize: 13,
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'flex-start',
                whiteSpace: 'pre-wrap',
                overflowY: 'auto',
                overflowX: 'hidden',
              }}
            >
              {(prompt || (data as any)?.prompt) || lastText}
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
        <Paper
          withBorder
          shadow="md"
          radius="md"
          className="glass"
          p="sm"
          style={{
            width: 420,
            maxHeight: 360,
            overflow: 'visible',
            transformOrigin: 'top center',
          }}
        >
          <Text size="xs" c="dimmed" mb={6}>{kind === 'textToImage' ? '文本提示词' : kind === 'composeVideo' ? '视频提示词与素材' : '详情'}</Text>
          {kind === 'composeVideo' && (upstreamImageUrl || upstreamText) && (
            <div style={{ marginBottom: 8 }}>
              {upstreamImageUrl && (
                <div
                  style={{
                    width: '100%',
                    maxHeight: 140,
                    borderRadius: 8,
                    overflow: 'hidden',
                    marginBottom: upstreamText ? 4 : 0,
                    border: '1px solid rgba(148,163,184,0.5)',
                    background: 'rgba(15,23,42,0.9)',
                  }}
                >
                  <img
                    src={upstreamImageUrl}
                    alt="上游图片素材"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </div>
              )}
              {upstreamText && (
                <Text
                  size="xs"
                  c="dimmed"
                  lineClamp={1}
                  title={upstreamText || undefined}
                >
                  {upstreamText}
                </Text>
              )}
            </div>
          )}
          <div style={{ position: 'relative' }}>
            <Textarea
              autosize
              minRows={2}
              maxRows={6}
              placeholder="在这里输入提示词..."
              value={prompt}
              onChange={(e)=>{
                const v = e.currentTarget.value
                setPrompt(v)
                updateNodeData(id, { prompt: v })
              }}
              onBlur={() => {
                setPromptSuggestions([])
              }}
              onKeyDown={(e) => {
                if (!promptSuggestions.length) return
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setActiveSuggestion((idx) => (idx + 1) % promptSuggestions.length)
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActiveSuggestion((idx) => (idx - 1 + promptSuggestions.length) % promptSuggestions.length)
                } else if (e.key === 'Tab') {
                  e.preventDefault()
                  const suggestion = promptSuggestions[activeSuggestion]
                  if (suggestion) {
                    setPrompt(suggestion)
                    setPromptSuggestions([])
                    markDraftPromptUsed(suggestion, 'sora').catch(() => {})
                  }
                } else if (e.key === 'Escape') {
                  setPromptSuggestions([])
                }
              }}
            />
            {promptSuggestions.length > 0 && (
              <Paper
                withBorder
                shadow="sm"
                radius="md"
                className="glass"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: '100%',
                  marginBottom: 4,
                  zIndex: 10,
                  maxHeight: 180,
                  overflowY: 'auto',
                }}
              >
                {promptSuggestions.map((s, idx) => (
                  <div
                    key={`${idx}-${s.slice(0,16)}`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setPrompt(s)
                      setPromptSuggestions([])
                      markDraftPromptUsed(s, 'sora').catch(() => {})
                    }}
                    onMouseEnter={() => setActiveSuggestion(idx)}
                    style={{
                      padding: '4px 8px',
                      fontSize: 12,
                      cursor: 'pointer',
                      background: idx === activeSuggestion ? 'rgba(148,163,184,0.28)' : 'transparent',
                      color: '#e5e7eb',
                    }}
                  >
                    {s}
                  </div>
                ))}
              </Paper>
            )}
          </div>
          {kind === 'textToImage' && textResults.length > 0 && (
            <Paper
              withBorder
              radius="md"
              p="xs"
              mt="xs"
              style={{
                maxHeight: 160,
                overflowY: 'auto',
                background: 'rgba(15,23,42,0.9)',
              }}
            >
              <Group justify="space-between" mb={4}>
                <Text size="xs" c="dimmed">
                  AI 输出（文生文）
                </Text>
                {textResults.length > 1 && (
                  <Button
                    size="xs"
                    variant="subtle"
                    onClick={() => setCompareOpen(true)}
                  >
                    对比
                  </Button>
                )}
              </Group>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {textResults.map((r, idx) => (
                  <div
                    key={`${idx}-${r.text.slice(0, 16)}`}
                    style={{
                      borderRadius: 6,
                      border: '1px solid rgba(148,163,184,0.5)',
                      padding: '4px 6px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 6,
                      background: 'rgba(15,23,42,0.9)',
                    }}
                  >
                    <Text
                      size="xs"
                      style={{
                        whiteSpace: 'pre-wrap',
                        flex: 1,
                      }}
                    >
                      {r.text}
                    </Text>
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => {
                        const t = r.text
                        setPrompt(t)
                        updateNodeData(id, { prompt: t })
                      }}
                    >
                      应用
                    </Button>
                  </div>
                ))}
              </div>
            </Paper>
          )}
          <Group grow mt={6}>
            {kind === 'textToImage' && (
              <>
                <Select
                  label="文案模型"
                  data={[
                    { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
                    { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
                  ]}
                  value={modelKey}
                  onChange={(v) => setModelKey(v || 'gemini-2.5-flash')}
                  comboboxProps={{
                    withinPortal: true,
                    styles: {
                      dropdown: {
                        minWidth: 260,
                        whiteSpace: 'nowrap',
                      },
                    },
                  }}
                />
                <NumberInput
                  label="生成次数"
                  min={1}
                  max={8}
                  step={1}
                  value={sampleCount}
                  onChange={(v) => setSampleCount(Number(v) || 1)}
                  onWheel={(e) => e.stopPropagation()}
                />
              </>
            )}
            {kind === 'image' && (
              <>
                <Select
                  label="生图模型"
                  data={[
                    { value: 'qwen-image-plus', label: 'qwen-image-plus' },
                  ]}
                  value={imageModel}
                  onChange={(v) => setImageModel(v || 'qwen-image-plus')}
                  comboboxProps={{
                    withinPortal: true,
                    styles: {
                      dropdown: {
                        minWidth: 260,
                        whiteSpace: 'nowrap',
                      },
                    },
                  }}
                />
                <Select
                  label="比例"
                  data={[
                    { value: '16:9', label: '16:9' },
                    { value: '1:1', label: '1:1' },
                    { value: '9:16', label: '9:16' },
                  ]}
                  value={aspect}
                  onChange={(v) => setAspect(v || '16:9')}
                />
                <NumberInput
                  label="生成次数"
                  min={1}
                  max={8}
                  step={1}
                  value={sampleCount}
                  onChange={(v) => setSampleCount(Number(v) || 1)}
                  onWheel={(e) => e.stopPropagation()}
                />
              </>
            )}
            {kind === 'composeVideo' && (
              <>
                <Select
                  label="画面比例"
                  data={[
                    { value: '16:9', label: '16:9' },
                    { value: '1:1', label: '1:1' },
                    { value: '9:16', label: '9:16' },
                  ]}
                  value={aspect}
                  onChange={(v) => setAspect(v || '16:9')}
                />
                <NumberInput
                  label="生成次数"
                  min={1}
                  max={8}
                  step={1}
                  value={sampleCount}
                  onChange={(v) => setSampleCount(Number(v) || 1)}
                  onWheel={(e) => e.stopPropagation()}
                />
              </>
            )}
          </Group>
          <Group justify="flex-end" mt={8}>
            <Button
              size="xs"
              loading={status === 'running' || status === 'queued'}
              onClick={() => {
                const nextPrompt = (prompt || (data as any)?.prompt || '').trim()

                const patch: any = { prompt: nextPrompt }
                if (kind === 'image' || kind === 'composeVideo') {
                  patch.aspect = aspect
                }
                if (kind === 'textToImage') {
                  patch.geminiModel = modelKey
                  patch.sampleCount = sampleCount
                }
                if (kind === 'image') {
                  patch.imageModel = imageModel
                  patch.sampleCount = sampleCount
                }
                if (kind === 'composeVideo') {
                  patch.sampleCount = sampleCount
                }

                // 同步本地状态，便于预览区展示最新提示词
                if (kind === 'image') {
                  setPrompt(nextPrompt)
                }

                updateNodeData(id, patch)
                runSelected()
              }}
            >
              {kind === 'textToImage' ? 'AI 优化文案' : '一键执行'}
            </Button>
          </Group>
        </Paper>
      </NodeToolbar>

      {/* 文案对比弹窗 */}
      {kind === 'textToImage' && (
        <Modal
          opened={compareOpen}
          onClose={() => setCompareOpen(false)}
          title="对比生成的提示词"
          centered
          size="lg"
          withinPortal
          zIndex={8000}
        >
          <Stack gap="sm">
            <Text size="xs" c="dimmed">
              点击「应用为当前提示词」可以将该版本填入上方输入框。
            </Text>
            <div
              style={{
                maxHeight: '50vh',
                overflowY: 'auto',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: 12,
                }}
              >
                {textResults.map((r, idx) => (
                  <Paper
                    key={`${idx}-${r.text.slice(0, 16)}`}
                    withBorder
                    radius="md"
                    p="xs"
                    style={{
                      background: 'rgba(15,23,42,0.95)',
                    }}
                  >
                    <Group justify="space-between" mb={4}>
                      <Text size="xs" c="dimmed">
                        版本 {idx + 1}
                      </Text>
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => {
                          const t = r.text
                          setPrompt(t)
                          updateNodeData(id, { prompt: t })
                          setCompareOpen(false)
                        }}
                      >
                        应用为当前提示词
                      </Button>
                    </Group>
                    <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                      {r.text}
                    </Text>
                  </Paper>
                ))}
              </div>
            </div>
          </Stack>
        </Modal>
      )}

      {/* More panel rendered directly under the top toolbar with 4px gap */}
    </div>
  )
}
