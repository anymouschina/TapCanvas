import React from 'react'
import { Text } from '@mantine/core'

type CharacterGraphNode3D = {
  id: string
  name: string
  importance?: 'main' | 'supporting' | 'minor'
  unlockChapter?: number
  chapterSpan?: number[]
}

type CharacterGraphEdge3D = {
  sourceId: string
  targetId: string
  relation: string
  weight: number
  chapterHints: number[]
}

type Vec3 = { x: number; y: number; z: number }

function hash01(input: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

function buildLayout(nodes: CharacterGraphNode3D[], edges: CharacterGraphEdge3D[]): Map<string, Vec3> {
  const pos = new Map<string, Vec3>()
  const vel = new Map<string, Vec3>()
  const ids = nodes.map((n) => String(n.id || '').trim()).filter(Boolean)
  if (!ids.length) return pos

  for (const id of ids) {
    const a = hash01(`${id}:a`) * Math.PI * 2
    const b = hash01(`${id}:b`) * Math.PI
    const r = 220 + hash01(`${id}:r`) * 120
    pos.set(id, {
      x: Math.sin(b) * Math.cos(a) * r,
      y: Math.cos(b) * r * 0.8,
      z: Math.sin(b) * Math.sin(a) * r,
    })
    vel.set(id, { x: 0, y: 0, z: 0 })
  }

  const edgeList = edges
    .map((e) => ({
      sourceId: String(e.sourceId || '').trim(),
      targetId: String(e.targetId || '').trim(),
      weight: Math.max(1, Math.min(99, Number(e.weight || 1))),
    }))
    .filter((e) => e.sourceId && e.targetId && pos.has(e.sourceId) && pos.has(e.targetId) && e.sourceId !== e.targetId)

  const repulsionBase = 18000
  const desiredLength = 180
  const attractionBase = 0.003
  const damping = 0.88

  for (let iter = 0; iter < 90; iter++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const id1 = ids[i]!
        const id2 = ids[j]!
        const p1 = pos.get(id1)!
        const p2 = pos.get(id2)!
        const dx = p2.x - p1.x
        const dy = p2.y - p1.y
        const dz = p2.z - p1.z
        const dist2 = Math.max(64, dx * dx + dy * dy + dz * dz)
        const dist = Math.sqrt(dist2)
        const f = repulsionBase / dist2
        const ux = dx / dist
        const uy = dy / dist
        const uz = dz / dist
        const v1 = vel.get(id1)!
        const v2 = vel.get(id2)!
        v1.x -= ux * f
        v1.y -= uy * f
        v1.z -= uz * f
        v2.x += ux * f
        v2.y += uy * f
        v2.z += uz * f
      }
    }
    for (const edge of edgeList) {
      const p1 = pos.get(edge.sourceId)!
      const p2 = pos.get(edge.targetId)!
      const dx = p2.x - p1.x
      const dy = p2.y - p1.y
      const dz = p2.z - p1.z
      const dist = Math.max(8, Math.sqrt(dx * dx + dy * dy + dz * dz))
      const ux = dx / dist
      const uy = dy / dist
      const uz = dz / dist
      const f = (dist - desiredLength) * attractionBase * (1 + edge.weight * 0.05)
      const v1 = vel.get(edge.sourceId)!
      const v2 = vel.get(edge.targetId)!
      v1.x += ux * f
      v1.y += uy * f
      v1.z += uz * f
      v2.x -= ux * f
      v2.y -= uy * f
      v2.z -= uz * f
    }
    for (const id of ids) {
      const p = pos.get(id)!
      const v = vel.get(id)!
      v.x *= damping
      v.y *= damping
      v.z *= damping
      p.x += v.x
      p.y += v.y
      p.z += v.z
      const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z)
      if (r > 420) {
        const s = 420 / r
        p.x *= s
        p.y *= s
        p.z *= s
      }
    }
  }

  return pos
}

function rotate(v: Vec3, rx: number, ry: number): Vec3 {
  const cosY = Math.cos(ry)
  const sinY = Math.sin(ry)
  const x1 = v.x * cosY + v.z * sinY
  const z1 = -v.x * sinY + v.z * cosY
  const cosX = Math.cos(rx)
  const sinX = Math.sin(rx)
  const y2 = v.y * cosX - z1 * sinX
  const z2 = v.y * sinX + z1 * cosX
  return { x: x1, y: y2, z: z2 }
}

function relationLabel(relation: string): string {
  switch (relation) {
    case 'family': return '亲属'
    case 'parent_child': return '父子/母子'
    case 'siblings': return '兄弟姐妹'
    case 'mentor_disciple': return '师徒/同门'
    case 'alliance': return '盟友'
    case 'friend': return '朋友'
    case 'lover': return '恋人'
    case 'rival': return '竞争'
    case 'enemy': return '仇敌'
    case 'colleague': return '同事/战友'
    case 'master_servant': return '主仆'
    case 'betrayal': return '背叛'
    case 'conflict': return '冲突'
    default: return '共现'
  }
}

function relationTone(relation: string): 'warm' | 'cold' | 'danger' | 'neutral' {
  if (relation === 'enemy' || relation === 'betrayal' || relation === 'conflict' || relation === 'rival') return 'danger'
  if (relation === 'lover' || relation === 'family' || relation === 'parent_child' || relation === 'siblings') return 'warm'
  if (relation === 'mentor_disciple' || relation === 'alliance' || relation === 'friend' || relation === 'colleague' || relation === 'master_servant') return 'cold'
  return 'neutral'
}

export function CharacterGraph3D(props: {
  nodes: CharacterGraphNode3D[]
  edges: CharacterGraphEdge3D[]
  isDark: boolean
  currentChapter?: number | null
}): JSX.Element {
  const { nodes, edges, isDark, currentChapter } = props
  if (!nodes.length) {
    return (
      <div className="character-graph-3d-empty" style={{ minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Text className="character-graph-3d-empty-text" size="sm" c="dimmed">
          暂无角色节点，请先执行 AI 全书深度重建
        </Text>
      </div>
    )
  }
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const pointsRef = React.useRef<Array<{ node: CharacterGraphNode3D; x: number; y: number; r: number }>>([])
  const dragRef = React.useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 })
  const rotationRef = React.useRef<{ x: number; y: number }>({ x: -0.22, y: 0.35 })
  const zoomRef = React.useRef(1)
  const [zoomLevel, setZoomLevel] = React.useState(1)
  const [hover, setHover] = React.useState<{ node: CharacterGraphNode3D; x: number; y: number } | null>(null)
  const [stageFocus, setStageFocus] = React.useState<'all' | 'past' | 'new' | 'future' | 'current'>('all')
  const [focusMode, setFocusMode] = React.useState<'dim' | 'hide'>('dim')

  const layout = React.useMemo(() => buildLayout(nodes, edges), [nodes, edges])
  const nodeById = React.useMemo(() => {
    const m = new Map<string, CharacterGraphNode3D>()
    for (const n of nodes) m.set(String(n.id || '').trim(), n)
    return m
  }, [nodes])
  const validEdges = React.useMemo(
    () =>
      edges.filter((e) => {
        const s = String(e.sourceId || '').trim()
        const t = String(e.targetId || '').trim()
        return s && t && nodeById.has(s) && nodeById.has(t)
      }),
    [edges, nodeById],
  )

  const chapterNo = typeof currentChapter === 'number' && Number.isFinite(currentChapter) && currentChapter > 0
    ? Math.trunc(currentChapter)
    : null

  const resolveNodeStage = React.useCallback((node: CharacterGraphNode3D): 'past' | 'new' | 'future' | 'current' | 'unknown' => {
    if (!chapterNo) return 'unknown'
    const unlock = Number(node.unlockChapter)
    const hasUnlock = Number.isFinite(unlock) && unlock > 0
    const normalizedUnlock = hasUnlock ? Math.trunc(unlock) : 1
    const span = Array.isArray(node.chapterSpan) ? node.chapterSpan : []
    const appearsNow = span.includes(chapterNo)
    if (appearsNow) {
      if (normalizedUnlock === chapterNo) return 'new'
      return 'current'
    }
    if (normalizedUnlock > chapterNo) return 'future'
    return 'past'
  }, [chapterNo])

  const stageLabel = React.useCallback((stage: 'past' | 'new' | 'future' | 'current' | 'unknown'): string => {
    if (stage === 'past') return '已出场'
    if (stage === 'new') return '新出场'
    if (stage === 'future') return '未出场'
    if (stage === 'current') return '当前章节出场'
    return '未指定'
  }, [])

  const isNodeMatched = React.useCallback((node: CharacterGraphNode3D): boolean => {
    if (stageFocus === 'all') return true
    return resolveNodeStage(node) === stageFocus
  }, [resolveNodeStage, stageFocus])

  React.useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    let mounted = true

    const draw = () => {
      if (!mounted) return
      const rect = root.getBoundingClientRect()
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const w = Math.max(320, Math.floor(rect.width))
      const h = Math.max(280, Math.floor(rect.height))
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr)
        canvas.height = Math.floor(h * dpr)
      }
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = isDark ? 'rgba(2,6,23,0.92)' : 'rgba(248,250,252,0.96)'
      ctx.fillRect(0, 0, w, h)

      const centerX = w / 2
      const centerY = h / 2
      const cameraZ = 860
      const scaleBase = 1.05 * zoomRef.current
      const rot = rotationRef.current
      if (!dragRef.current.active) {
        rot.y += 0.0025
      }

      const projected = new Map<string, { x: number; y: number; z: number; scale: number; node: CharacterGraphNode3D }>()
      for (const node of nodes) {
        if (focusMode === 'hide' && !isNodeMatched(node)) continue
        const id = String(node.id || '').trim()
        const p = layout.get(id)
        if (!p) continue
        const r = rotate(p, rot.x, rot.y)
        const perspective = cameraZ / (cameraZ + r.z + 420)
        const scale = Math.max(0.2, Math.min(18, perspective * scaleBase * 2.2))
        projected.set(id, {
          x: centerX + r.x * scale,
          y: centerY + r.y * scale,
          z: r.z,
          scale,
          node,
        })
      }

      const edgeLabels: Array<{ x: number; y: number; text: string; tone: 'warm' | 'cold' | 'danger' | 'neutral'; z: number }> = []
      for (const edge of validEdges) {
        const s = projected.get(String(edge.sourceId || '').trim())
        const t = projected.get(String(edge.targetId || '').trim())
        if (!s || !t) continue
        const sMatched = isNodeMatched(s.node)
        const tMatched = isNodeMatched(t.node)
        const shouldDim = stageFocus !== 'all' && focusMode === 'dim' && (!sMatched || !tMatched)
        ctx.beginPath()
        ctx.moveTo(s.x, s.y)
        ctx.lineTo(t.x, t.y)
        const alphaBoostRaw = Math.max(0.12, Math.min(0.6, ((s.scale + t.scale) * 0.5) / 2))
        const alphaBoost = shouldDim ? Math.max(0.04, alphaBoostRaw * 0.25) : alphaBoostRaw
        const width = Math.max(0.8, Math.min(4.2, Number(edge.weight || 1) * 0.26))
        ctx.lineWidth = width
        const tone = relationTone(edge.relation)
        const stroke = tone === 'danger'
          ? (isDark ? 'rgba(248,113,113,0.42)' : 'rgba(220,38,38,0.36)')
          : tone === 'warm'
            ? (isDark ? 'rgba(251,191,36,0.34)' : 'rgba(180,83,9,0.32)')
            : tone === 'cold'
              ? (isDark ? 'rgba(56,189,248,0.32)' : 'rgba(3,105,161,0.30)')
              : (isDark ? 'rgba(148,163,184,0.28)' : 'rgba(71,85,105,0.26)')
        ctx.strokeStyle = stroke.replace(/0\.\d+\)/, `${alphaBoost.toFixed(2)})`)
        ctx.stroke()
        const mx = (s.x + t.x) / 2
        const my = (s.y + t.y) / 2
        if (!shouldDim) {
          edgeLabels.push({
            x: mx,
            y: my,
            z: (s.z + t.z) / 2,
            tone,
            text: `${relationLabel(edge.relation)}(${Math.max(1, Math.min(99, Number(edge.weight || 1)))})`,
          })
        }
      }

      const nodesDepth = Array.from(projected.values()).sort((a, b) => a.z - b.z)
      pointsRef.current = []
      const nodeLabels: Array<{ x: number; y: number; text: string; z: number }> = []
      for (const p of nodesDepth) {
        const stage = resolveNodeStage(p.node)
        const matched = isNodeMatched(p.node)
        const shouldDim = stageFocus !== 'all' && focusMode === 'dim' && !matched
        const importance = p.node.importance || 'minor'
        const base = importance === 'main' ? 6.6 : importance === 'supporting' ? 5.3 : 4.4
        const r = Math.max(2.6, Math.min(11, base * p.scale))
        const color =
          stage === 'past'
            ? (isDark ? '#60a5fa' : '#2563eb')
            : stage === 'new'
              ? (isDark ? '#f59e0b' : '#d97706')
              : stage === 'future'
                ? (isDark ? '#64748b' : '#94a3b8')
                : stage === 'current'
                  ? (isDark ? '#22c55e' : '#16a34a')
                  : (isDark ? '#e2e8f0' : '#0f172a')
        const prevAlpha = ctx.globalAlpha
        ctx.globalAlpha = shouldDim ? 0.2 : 1
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        ctx.lineWidth = 1
        ctx.strokeStyle = isDark ? 'rgba(226,232,240,0.6)' : 'rgba(15,23,42,0.35)'
        ctx.stroke()
        ctx.globalAlpha = prevAlpha
        pointsRef.current.push({ node: p.node, x: p.x, y: p.y, r })
        if (!shouldDim) {
          nodeLabels.push({
            x: p.x + r + 4,
            y: p.y - r - 2,
            text: String(p.node.name || p.node.id || '').trim(),
            z: p.z,
          })
        }
      }

      // Draw labels after geometry, near->far order to reduce overlap flicker.
      edgeLabels.sort((a, b) => a.z - b.z)
      for (const label of edgeLabels) {
        if (!label.text) continue
        ctx.font = '11px system-ui, -apple-system, Segoe UI, sans-serif'
        ctx.textBaseline = 'middle'
        ctx.fillStyle =
          label.tone === 'danger'
            ? (isDark ? 'rgba(254,202,202,0.9)' : 'rgba(127,29,29,0.92)')
            : label.tone === 'warm'
              ? (isDark ? 'rgba(254,243,199,0.92)' : 'rgba(120,53,15,0.94)')
              : label.tone === 'cold'
                ? (isDark ? 'rgba(186,230,253,0.9)' : 'rgba(8,47,73,0.9)')
                : (isDark ? 'rgba(226,232,240,0.88)' : 'rgba(30,41,59,0.85)')
        ctx.fillText(label.text, label.x + 4, label.y - 2)
      }

      nodeLabels.sort((a, b) => a.z - b.z)
      for (const label of nodeLabels) {
        if (!label.text) continue
        ctx.font = '12px system-ui, -apple-system, Segoe UI, sans-serif'
        ctx.textBaseline = 'middle'
        const padX = 5
        const padY = 2
        const tw = ctx.measureText(label.text).width
        const bw = tw + padX * 2
        const bh = 16
        const bx = label.x
        const by = label.y - bh * 0.5
        ctx.fillStyle = isDark ? 'rgba(15,23,42,0.72)' : 'rgba(255,255,255,0.8)'
        ctx.fillRect(bx, by, bw, bh)
        ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.35)' : 'rgba(148,163,184,0.55)'
        ctx.lineWidth = 1
        ctx.strokeRect(bx, by, bw, bh)
        ctx.fillStyle = isDark ? 'rgba(241,245,249,0.96)' : 'rgba(15,23,42,0.9)'
        ctx.fillText(label.text, bx + padX, by + bh * 0.5 + padY * 0.25)
      }

      raf = window.requestAnimationFrame(draw)
    }

    raf = window.requestAnimationFrame(draw)
    return () => {
      mounted = false
      window.cancelAnimationFrame(raf)
    }
  }, [focusMode, isDark, isNodeMatched, layout, nodes, resolveNodeStage, stageFocus, validEdges])

  const onPointerDown: React.PointerEventHandler<HTMLCanvasElement> = (e) => {
    dragRef.current = { active: true, x: e.clientX, y: e.clientY }
  }
  const onPointerUp: React.PointerEventHandler<HTMLCanvasElement> = () => {
    dragRef.current.active = false
  }
  const onPointerLeave: React.PointerEventHandler<HTMLCanvasElement> = () => {
    dragRef.current.active = false
    setHover(null)
  }
  const onPointerMove: React.PointerEventHandler<HTMLCanvasElement> = (e) => {
    const drag = dragRef.current
    if (drag.active) {
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      drag.x = e.clientX
      drag.y = e.clientY
      // Invert horizontal drag direction: dragging left rotates view left.
      rotationRef.current.y -= dx * 0.006
      rotationRef.current.x += dy * 0.005
      rotationRef.current.x = Math.max(-1.25, Math.min(1.25, rotationRef.current.x))
      return
    }
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    let hit: { node: CharacterGraphNode3D; x: number; y: number } | null = null
    for (const pt of pointsRef.current) {
      const dx = px - pt.x
      const dy = py - pt.y
      if (dx * dx + dy * dy <= (pt.r + 4) * (pt.r + 4)) {
        hit = { node: pt.node, x: pt.x, y: pt.y }
      }
    }
    setHover(hit)
  }
  const onWheel: React.WheelEventHandler<HTMLCanvasElement> = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const next = zoomRef.current * (e.deltaY > 0 ? 0.92 : 1.11)
    zoomRef.current = Math.max(0.35, Math.min(12, next))
    setZoomLevel(zoomRef.current)
  }
  const zoomIn = React.useCallback(() => {
    zoomRef.current = Math.max(0.35, Math.min(12, zoomRef.current * 1.18))
    setZoomLevel(zoomRef.current)
  }, [])
  const zoomOut = React.useCallback(() => {
    zoomRef.current = Math.max(0.35, Math.min(12, zoomRef.current * 0.82))
    setZoomLevel(zoomRef.current)
  }, [])
  const zoomReset = React.useCallback(() => {
    zoomRef.current = 1
    setZoomLevel(1)
  }, [])

  return (
    <div className="character-graph-3d-root" ref={rootRef} style={{ position: 'relative', width: '100%', height: '70vh', minHeight: 420 }}>
      <canvas
        className="character-graph-3d-canvas"
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onWheel={onWheel}
        style={{ width: '100%', height: '100%', borderRadius: 12, cursor: 'grab', border: isDark ? '1px solid rgba(148,163,184,0.2)' : '1px solid rgba(148,163,184,0.3)' }}
      />
      <Text className="character-graph-3d-help" size="xs" c="dimmed" style={{ position: 'absolute', left: 10, bottom: 8 }}>
        拖拽旋转 · 滚轮缩放 · 悬浮查看角色
      </Text>
      <div
        className="character-graph-3d-zoom-controls"
        style={{
          position: 'absolute',
          left: 10,
          top: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 8px',
          borderRadius: 8,
          background: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.9)',
          border: isDark ? '1px solid rgba(148,163,184,0.25)' : '1px solid rgba(148,163,184,0.35)',
          backdropFilter: 'blur(4px)',
        }}
      >
        <button type="button" onClick={zoomOut} style={{ borderRadius: 6, border: '1px solid rgba(148,163,184,.45)', background: 'transparent', color: 'inherit', width: 24, height: 22, cursor: 'pointer' }}>-</button>
        <Text size="xs" c="dimmed" style={{ minWidth: 42, textAlign: 'center' }}>{`${zoomLevel.toFixed(2)}x`}</Text>
        <button type="button" onClick={zoomIn} style={{ borderRadius: 6, border: '1px solid rgba(148,163,184,.45)', background: 'transparent', color: 'inherit', width: 24, height: 22, cursor: 'pointer' }}>+</button>
        <button type="button" onClick={zoomReset} style={{ borderRadius: 6, border: '1px solid rgba(148,163,184,.45)', background: 'transparent', color: 'inherit', padding: '0 6px', height: 22, cursor: 'pointer', fontSize: 11 }}>重置</button>
      </div>
      <div
        className="character-graph-3d-legend"
        style={{
          position: 'absolute',
          right: 10,
          bottom: 8,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, auto)',
          gap: 6,
          padding: '8px 10px',
          borderRadius: 8,
          background: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.9)',
          border: isDark ? '1px solid rgba(148,163,184,0.25)' : '1px solid rgba(148,163,184,0.35)',
          backdropFilter: 'blur(4px)',
          fontSize: 11,
        }}
      >
        <div
          className="character-graph-3d-focus-mode"
          style={{ gridColumn: '1 / -1', display: 'flex', gap: 6, marginBottom: 2 }}
        >
          <button
            className="character-graph-3d-focus-mode-dim"
            type="button"
            onClick={() => setFocusMode('dim')}
            style={{
              fontSize: 11,
              borderRadius: 999,
              border: focusMode === 'dim' ? `1px solid ${isDark ? '#cbd5e1' : '#334155'}` : `1px solid ${isDark ? 'rgba(148,163,184,0.35)' : 'rgba(148,163,184,0.5)'}`,
              background: focusMode === 'dim' ? (isDark ? 'rgba(30,41,59,0.9)' : 'rgba(241,245,249,0.92)') : 'transparent',
              color: isDark ? '#e2e8f0' : '#0f172a',
              padding: '2px 8px',
              cursor: 'pointer',
            }}
          >
            置灰模式
          </button>
          <button
            className="character-graph-3d-focus-mode-hide"
            type="button"
            onClick={() => setFocusMode('hide')}
            style={{
              fontSize: 11,
              borderRadius: 999,
              border: focusMode === 'hide' ? `1px solid ${isDark ? '#cbd5e1' : '#334155'}` : `1px solid ${isDark ? 'rgba(148,163,184,0.35)' : 'rgba(148,163,184,0.5)'}`,
              background: focusMode === 'hide' ? (isDark ? 'rgba(30,41,59,0.9)' : 'rgba(241,245,249,0.92)') : 'transparent',
              color: isDark ? '#e2e8f0' : '#0f172a',
              padding: '2px 8px',
              cursor: 'pointer',
            }}
          >
            隐藏模式
          </button>
        </div>
        {[
          { label: '已出场', color: isDark ? '#60a5fa' : '#2563eb' },
          { label: '新出场', color: isDark ? '#f59e0b' : '#d97706' },
          { label: '未出场', color: isDark ? '#64748b' : '#94a3b8' },
          { label: '当前章节出场', color: isDark ? '#22c55e' : '#16a34a' },
        ].map((item, idx) => {
          const stageKey = (['past', 'new', 'future', 'current'] as const)[idx]
          const active = stageFocus === stageKey
          return (
          <button
            key={item.label}
            className="character-graph-3d-legend-item"
            type="button"
            onClick={() => setStageFocus((prev) => (prev === stageKey ? 'all' : stageKey))}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: isDark ? '#e2e8f0' : '#0f172a',
              borderRadius: 999,
              padding: '2px 6px',
              border: active ? `1px solid ${item.color}` : '1px solid transparent',
              background: active ? (isDark ? 'rgba(30,41,59,0.9)' : 'rgba(241,245,249,0.92)') : 'transparent',
              cursor: 'pointer',
            }}
          >
            <span
              className="character-graph-3d-legend-dot"
              style={{ width: 8, height: 8, borderRadius: 999, background: item.color, flex: '0 0 auto' }}
            />
            <span>{item.label}</span>
          </button>
        )})}
        <button
          className="character-graph-3d-legend-reset"
          type="button"
          onClick={() => setStageFocus('all')}
          style={{
            gridColumn: '1 / -1',
            marginTop: 2,
            fontSize: 11,
            borderRadius: 999,
            border: `1px solid ${isDark ? 'rgba(148,163,184,0.35)' : 'rgba(148,163,184,0.5)'}`,
            background: 'transparent',
            color: isDark ? '#cbd5e1' : '#334155',
            padding: '2px 8px',
            cursor: 'pointer',
          }}
        >
          查看全部
        </button>
      </div>
      {!!hover && (
        <div
          className="character-graph-3d-tooltip"
          style={{
            position: 'absolute',
            left: Math.max(8, hover.x + 14),
            top: Math.max(8, hover.y - 10),
            pointerEvents: 'none',
            background: isDark ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.92)',
            border: isDark ? '1px solid rgba(148,163,184,0.35)' : '1px solid rgba(148,163,184,0.45)',
            color: 'inherit',
            borderRadius: 8,
            padding: '8px 10px',
            maxWidth: 260,
            backdropFilter: 'blur(6px)',
          }}
        >
          <Text size="xs" fw={700} lineClamp={1}>{hover.node.name}</Text>
          <Text size="xs" c="dimmed">id: {hover.node.id}</Text>
          <Text size="xs" c="dimmed">状态: {stageLabel(resolveNodeStage(hover.node))}</Text>
          {!!hover.node.importance && <Text size="xs" c="dimmed">级别: {hover.node.importance}</Text>}
          {typeof hover.node.unlockChapter === 'number' && <Text size="xs" c="dimmed">解锁: 第{hover.node.unlockChapter}章</Text>}
        </div>
      )}
    </div>
  )
}
