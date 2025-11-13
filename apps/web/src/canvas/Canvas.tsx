import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  NodeTypes,
  ConnectionLineType,
  ReactFlowProvider,
  EdgeTypes,
  MarkerType,
} from 'reactflow'
import 'reactflow/dist/style.css'

import TaskNode from './nodes/TaskNode'
import GroupNode from './nodes/GroupNode'
import { persistToLocalStorage, restoreFromLocalStorage, useRFStore } from './store'
import { toast } from '../ui/toast'
import { applyTemplateAt } from '../templates'
import { Paper, Stack, Button, Divider, Group, Text } from '@mantine/core'
import TypedEdge from './edges/TypedEdge'
import { runFlowDag } from '../runner/dag'

const nodeTypes: NodeTypes = {
  taskNode: TaskNode,
  groupNode: GroupNode,
}

const edgeTypes: EdgeTypes = {
  typed: TypedEdge,
}

function CanvasInner(): JSX.Element {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, load } = useRFStore()
  const deleteNode = useRFStore(s => s.deleteNode)
  const deleteEdge = useRFStore(s => s.deleteEdge)
  const duplicateNode = useRFStore(s => s.duplicateNode)
  const pasteFromClipboardAt = useRFStore(s => s.pasteFromClipboardAt)
  const runSelected = useRFStore(s => s.runSelected)
  const cancelNode = useRFStore(s => s.cancelNode)
  const rf = useReactFlow()
  const [connectingType, setConnectingType] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ show: boolean; x: number; y: number; type: 'node'|'edge'|'canvas'; id?: string } | null>(null)
  const [guides, setGuides] = useState<{ vx?: number; hy?: number } | null>(null)
  const [longSelect, setLongSelect] = useState(false)
  const downPos = useRef<{x:number;y:number}|null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    // initial load
    const restored = restoreFromLocalStorage()
    if (restored && restored.nodes.length) {
      load(restored)
      setTimeout(() => rf.fitView?.({ padding: 0.2 }), 50)
    }
    // autosave
    const h = setInterval(() => persistToLocalStorage(), 1500)
    return () => clearInterval(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onInit = useCallback(() => rf.fitView?.({ padding: 0.2 }), [rf])

  const onDragOver = useCallback((evt: React.DragEvent) => {
    evt.preventDefault()
    evt.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback((evt: React.DragEvent) => {
    evt.preventDefault()
    const tplName = evt.dataTransfer.getData('application/tap-template')
    const rfdata = evt.dataTransfer.getData('application/reactflow')
    const flowRef = evt.dataTransfer.getData('application/tapflow')
    const pos = rf.screenToFlowPosition({ x: evt.clientX, y: evt.clientY })
    if (tplName) {
      applyTemplateAt(tplName, pos)
      return
    }
    if (flowRef) {
      try {
        const ref = JSON.parse(flowRef) as { id: string; name: string }
        useRFStore.setState((s) => {
          const id = `n${s.nextId}`
          const node = { id, type: 'taskNode' as const, position: pos, data: { label: ref.name, kind: 'subflow', subflowRef: ref.id } }
          return { nodes: [...s.nodes, node], nextId: s.nextId + 1 }
        })
      } catch {}
      return
    }
    if (rfdata) {
      const data = JSON.parse(rfdata) as { type: string; label?: string; kind?: string }
      // create node via store but place at computed position
      useRFStore.setState((s) => {
        const id = `n${s.nextId}`
        const node = {
          id,
          type: data.type as any,
          position: pos,
          data: { label: data.label ?? data.type, kind: data.kind },
        }
        return { nodes: [...s.nodes, node], nextId: s.nextId + 1 }
      })
    }
  }, [rf])

  const isValidEdgeByType = useCallback((sourceKind?: string, targetKind?: string) => {
    if (!sourceKind || !targetKind) return true
    if (targetKind === 'composeVideo') return ['textToImage','tts','subtitleAlign','composeVideo','image'].includes(sourceKind)
    if (targetKind === 'image') return ['image','textToImage'].includes(sourceKind)
    if (targetKind === 'video') return ['image','composeVideo'].includes(sourceKind)
    return true
  }, [])

  const createsCycle = useCallback((proposed: { source?: string|null; target?: string|null }) => {
    const sId = proposed.source
    const tId = proposed.target
    if (!sId || !tId) return false
    // Build adjacency including proposed edge
    const adj = new Map<string, string[]>()
    nodes.forEach(n => adj.set(n.id, []))
    edges.forEach(e => {
      if (e.source && e.target) {
        if (!adj.has(e.source)) adj.set(e.source, [])
        adj.get(e.source)!.push(e.target)
      }
    })
    if (!adj.has(sId)) adj.set(sId, [])
    adj.get(sId)!.push(tId)
    // DFS from target to see if we can reach source
    const seen = new Set<string>()
    const stack = [tId]
    while (stack.length) {
      const u = stack.pop()!
      if (u === sId) return true
      if (seen.has(u)) continue
      seen.add(u)
      for (const v of adj.get(u) || []) stack.push(v)
    }
    return false
  }, [nodes, edges])

  const onConnectStart = useCallback((_evt: any, params: { nodeId?: string|null; handleId?: string|null; handleType?: 'source'|'target' }) => {
    const h = params.handleId || ''
    // if source handle like out-image -> type=image
    if (params.handleType === 'source' && h.startsWith('out-')) {
      setConnectingType(h.slice(4))
    } else if (params.handleType === 'target' && h.startsWith('in-')) {
      setConnectingType(h.slice(3))
    } else {
      setConnectingType(null)
    }
  }, [])

  const onConnectStop = useCallback((_evt: any) => {
    // user released on invalid target
    if (connectingType) {
      toast(lastReason.current || '连接无效：类型不兼容、重复或形成环', 'error')
    }
    setConnectingType(null)
    lastReason.current = null
  }, [connectingType])

  const onConnectEnd = useCallback((_evt: any) => {
    setConnectingType(null)
  }, [])

  const onPaneMouseDown = useCallback((evt: React.MouseEvent) => {
    if (evt.button !== 0) return
    downPos.current = { x: evt.clientX, y: evt.clientY }
    timerRef.current = window.setTimeout(() => {
      setLongSelect(true)
    }, 250)
  }, [])

  const onPaneMouseMove = useCallback((evt: React.MouseEvent) => {
    if (!downPos.current || !timerRef.current) return
    const dx = Math.abs(evt.clientX - downPos.current.x)
    const dy = Math.abs(evt.clientY - downPos.current.y)
    if (dx > 4 || dy > 4) {
      window.clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
  }, [])

  const onPaneMouseUp = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    setLongSelect(false)
    downPos.current = null
  }, [])

  const onPaneContextMenu = useCallback((evt: React.MouseEvent) => {
    evt.preventDefault()
    setMenu({ show: true, x: evt.clientX, y: evt.clientY, type: 'canvas' })
  }, [])

  const onNodeContextMenu = useCallback((evt: React.MouseEvent, node: any) => {
    evt.preventDefault()
    setMenu({ show: true, x: evt.clientX, y: evt.clientY, type: 'node', id: node.id })
  }, [])

  const onEdgeContextMenu = useCallback((evt: React.MouseEvent, edge: any) => {
    evt.preventDefault()
    setMenu({ show: true, x: evt.clientX, y: evt.clientY, type: 'edge', id: edge.id })
  }, [])

  const [viewport, setViewport] = useState<{ x: number; y: number; zoom: number }>(() => rf.getViewport?.() || { x: 0, y: 0, zoom: 1 })
  const flowToScreen = useCallback((p: { x: number; y: number }) => ({ x: p.x * viewport.zoom + viewport.x, y: p.y * viewport.zoom + viewport.y }), [viewport.x, viewport.y, viewport.zoom])
  const screenToFlow = useCallback((p: { x: number; y: number }) => rf.screenToFlowPosition ? rf.screenToFlowPosition(p) : p, [rf])

  const onNodeDragStart = useCallback(() => setDragging(true), [])
  const onNodeDrag = useCallback((_evt: any, node: any) => {
    // simple align guides to other nodes centers
    const threshold = 5
    let vx: number | undefined
    let hy: number | undefined
    for (const n of nodes) {
      if (n.id === node.id) continue
      if (Math.abs(n.position.x - node.position.x) <= threshold) vx = n.position.x
      if (Math.abs(n.position.y - node.position.y) <= threshold) hy = n.position.y
    }
    setGuides({ vx, hy })
  }, [nodes])

  const onNodeDragStop = useCallback(() => {
    setGuides(null)
    setDragging(false)
  }, [])

  // Auto-fit group node size to its children
  useEffect(() => {
    // collect group nodes
    const groupNodes = nodes.filter((n: any) => n.type === 'groupNode')
    if (!groupNodes.length) return
    const padding = 8
    const defaultW = 180, defaultH = 96
    const updates: Record<string, { width: number; height: number }> = {}
    for (const g of groupNodes) {
      const kids = nodes.filter(n => n.parentNode === g.id)
      if (!kids.length) continue
      const minX = Math.min(...kids.map(n => n.position.x))
      const minY = Math.min(...kids.map(n => n.position.y))
      const maxX = Math.max(...kids.map(n => n.position.x + ((n as any).width || defaultW)))
      const maxY = Math.max(...kids.map(n => n.position.y + ((n as any).height || defaultH)))
      const reqW = (maxX - minX) + padding * 2
      const reqH = (maxY - minY) + padding * 2
      const curW = (g as any).width || (g.style as any)?.width || 0
      const curH = (g as any).height || (g.style as any)?.height || 0
      if (Math.abs(reqW - curW) > 1 || Math.abs(reqH - curH) > 1) {
        updates[g.id] = { width: reqW, height: reqH }
      }
    }
    const ids = Object.keys(updates)
    if (!ids.length) return
    useRFStore.setState(s => ({
      nodes: s.nodes.map(n => {
        if (!updates[n.id]) return n
        const w = updates[n.id].width
        const h = updates[n.id].height
        return { ...n, style: { ...(n.style || {}), width: w, height: h } }
      })
    }))
  }, [nodes])

  const handleNodesChange = useCallback((changes: any[]) => {
    const threshold = 6
    const xs = nodes.map(n => n.position.x)
    const ys = nodes.map(n => n.position.y)
    const snapped = changes.map((ch) => {
      if (ch.type === 'position' && ch.position) {
        // try snap x
        let sx = ch.position.x
        let sy = ch.position.y
        let foundX = false
        let foundY = false
        for (const x of xs) { if (Math.abs(x - sx) <= threshold) { sx = x; foundX = true; break } }
        for (const y of ys) { if (Math.abs(y - sy) <= threshold) { sy = y; foundY = true; break } }
        return { ...ch, position: { x: sx, y: sy } }
      }
      return ch
    })
    onNodesChange(snapped)
  }, [nodes, onNodesChange])

  const lastReason = React.useRef<string | null>(null)

  const handleConnect = useCallback((c: any) => {
    lastReason.current = null
    onConnect(c)
  }, [onConnect])

  const [mouse, setMouse] = useState<{x:number;y:number}>({x:0,y:0})
  // MiniMap drag-to-pan
  const minimapDragRef = useRef<{ el: HTMLElement; rect: DOMRect }|null>(null)

  // Group overlay computation
  const selectedNodes = nodes.filter(n=>n.selected)
  // legacy group match no longer used (compound nodes now)
  const groups = useRFStore(s => s.groups)
  const defaultW = 180, defaultH = 96
  // selection rect in FLOW coordinates
  let groupRectFlow: { x: number; y: number; w: number; h: number } | null = null
  if (selectedNodes.length > 1) {
    const minX = Math.min(...selectedNodes.map(n => n.position.x))
    const minY = Math.min(...selectedNodes.map(n => n.position.y))
    const maxX = Math.max(...selectedNodes.map(n => n.position.x + (((n as any).width) || defaultW)))
    const maxY = Math.max(...selectedNodes.map(n => n.position.y + (((n as any).height) || defaultH)))
    const padding = 8
    groupRectFlow = { x: minX - padding, y: minY - padding, w: (maxX - minX) + padding*2, h: (maxY - minY) + padding*2 }
  }

  // remove legacy persistent outlines: group is now a node (compound parent)
  const groupOutlines: any[] = []

  // selection partially overlaps existing groups?
  const selectionPartialOverlaps = useMemo(() => {
    if (selectedNodes.length < 2) return false
    // disallow grouping across different parents
    const parents = new Set(selectedNodes.map(n => n.parentNode || ''))
    return parents.size > 1
  }, [selectedNodes])

  // Edge highlight when connected to a selected node
  const selectedIds = new Set(selectedNodes.map(n=>n.id))
  const viewEdges = useMemo(() => {
    if (selectedIds.size === 0) return edges
    return edges.map(e => {
      const active = selectedIds.has(e.source) || selectedIds.has(e.target)
      return active ? { ...e, style: { ...(e.style||{}), stroke: '#e5e7eb', opacity: 1 } } : { ...e, style: { ...(e.style||{}), opacity: 0.5 } }
    })
  }, [edges, selectedIds])

  // 使用多选拖拽（内置），不自定义组拖拽，避免与画布交互冲突

  const layoutGrid = () => {
    if (selectedNodes.length < 2) return
    const nodesSorted = [...selectedNodes].sort((a,b)=> (a.position.y-b.position.y) || (a.position.x-b.position.x))
    const cols = Math.ceil(Math.sqrt(nodesSorted.length))
    const gapX = 220, gapY = 140
    const minX = Math.min(...nodesSorted.map(n=>n.position.x))
    const minY = Math.min(...nodesSorted.map(n=>n.position.y))
    useRFStore.setState(s => ({
      nodes: s.nodes.map(n => {
        const idx = nodesSorted.findIndex(m => m.id === n.id)
        if (idx === -1) return n
        const r = Math.floor(idx / cols)
        const c = idx % cols
        return { ...n, position: { x: minX + c*gapX, y: minY + r*gapY } }
      })
    }))
  }

  const layoutHorizontal = () => {
    if (selectedNodes.length < 2) return
    const nodesSorted = [...selectedNodes].sort((a,b)=> a.position.x - b.position.x)
    const gapX = 220
    const minX = Math.min(...nodesSorted.map(n=>n.position.x))
    const minY = Math.min(...nodesSorted.map(n=>n.position.y))
    useRFStore.setState(s => ({
      nodes: s.nodes.map(n => {
        const idx = nodesSorted.findIndex(m => m.id === n.id)
        if (idx === -1) return n
        return { ...n, position: { x: minX + idx*gapX, y: minY } }
      })
    }))
  }

  const handleRootClick = useCallback((e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('.react-flow__minimap') as HTMLElement | null
    if (!el) return
    const rect = el.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const rx = Math.max(0, Math.min(1, cx / rect.width))
    const ry = Math.max(0, Math.min(1, cy / rect.height))
    // compute world bounds from nodes
    const defaultW = 180, defaultH = 96
    if (nodes.length === 0) return
    const minX = Math.min(...nodes.map(n => n.position.x))
    const minY = Math.min(...nodes.map(n => n.position.y))
    const maxX = Math.max(...nodes.map(n => n.position.x + (((n as any).width) || defaultW)))
    const maxY = Math.max(...nodes.map(n => n.position.y + (((n as any).height) || defaultH)))
    const worldX = minX + rx * (maxX - minX)
    const worldY = minY + ry * (maxY - minY)
    const z = viewport.zoom || 1
    rf.setCenter?.(worldX, worldY, { zoom: z, duration: 200 })
    e.stopPropagation()
    e.preventDefault()
  }, [nodes, rf, viewport.zoom])

  const handleRootMouseDown = useCallback((e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('.react-flow__minimap') as HTMLElement | null
    if (!el) return
    minimapDragRef.current = { el, rect: el.getBoundingClientRect() }
    handleRootClick(e) // center to initial point
  }, [handleRootClick])

  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      if (!minimapDragRef.current) return
      const rect = minimapDragRef.current.rect
      const cx = ev.clientX - rect.left
      const cy = ev.clientY - rect.top
      const rx = Math.max(0, Math.min(1, cx / rect.width))
      const ry = Math.max(0, Math.min(1, cy / rect.height))
      const defaultW = 180, defaultH = 96
      if (nodes.length === 0) return
      const minX = Math.min(...nodes.map(n => n.position.x))
      const minY = Math.min(...nodes.map(n => n.position.y))
      const maxX = Math.max(...nodes.map(n => n.position.x + (((n as any).width) || defaultW)))
      const maxY = Math.max(...nodes.map(n => n.position.y + (((n as any).height) || defaultH)))
      const worldX = minX + rx * (maxX - minX)
      const worldY = minY + ry * (maxY - minY)
      const z = viewport.zoom || 1
      rf.setCenter?.(worldX, worldY, { zoom: z, duration: 0 })
    }
    const onUp = () => { minimapDragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [nodes, rf, viewport.zoom])

  return (
    <div
      style={{ height: '100%', width: '100%', position: 'relative' }}
      data-connecting={connectingType || ''}
      data-connecting-active={connectingType ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      onMouseMove={(e) => { if (connectingType) setMouse({ x: e.clientX, y: e.clientY }) }}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onClick={handleRootClick}
      onMouseDown={handleRootMouseDown}
    >
      <ReactFlow
        nodes={nodes}
        edges={viewEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onConnectStart={onConnectStart}
        onConnectStop={onConnectStop}
        onConnectEnd={onConnectEnd}
        onNodeDragStart={onNodeDragStart}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onPaneMouseDown={onPaneMouseDown}
        onPaneMouseMove={onPaneMouseMove}
        onPaneMouseUp={onPaneMouseUp}
        onMove={(_evt, vp) => setViewport(vp)}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        onInit={onInit}
        selectionOnDrag
        panOnDrag={false}
        panOnScroll
        zoomOnPinch
        zoomOnScroll
        proOptions={{ hideAttribution: true }}
        isValidConnection={(c) => {
          if (!c.source || !c.target) return false
          if (c.source === c.target) return false
          if (createsCycle({ source: c.source, target: c.target })) { lastReason.current = '连接会导致环'; return false }
          const dup = edges.some(e => e.source === c.source && e.target === c.target)
          if (dup) { lastReason.current = '重复连接'; return false }
          const sNode = nodes.find(n => n.id === c.source)
          const tNode = nodes.find(n => n.id === c.target)
          const sKind = sNode?.data?.kind as string | undefined
          const tKind = tNode?.data?.kind as string | undefined
          // handle type matching
          const sHandle = c.sourceHandle || ''
          const tHandle = c.targetHandle || ''
          if (sHandle && tHandle) {
            const sType = sHandle.toString().startsWith('out-') ? sHandle.toString().slice(4).split('-')[0] : undefined
            const tType = tHandle.toString().startsWith('in-') ? tHandle.toString().slice(3).split('-')[0] : undefined
            if (sType && tType && sType !== 'any' && tType !== 'any' && sType !== tType) { lastReason.current = `类型不兼容：${sType} → ${tType}`; return false }
          }
          const ok = isValidEdgeByType(sKind, tKind)
          if (!ok) lastReason.current = '不允许的连接方向'
          return ok
        }}
        snapToGrid
        snapGrid={[16, 16]}
        defaultEdgeOptions={{ animated: true, type: 'typed', style: { strokeWidth: 3 }, interactionWidth: 24, markerEnd: { type: MarkerType.ArrowClosed, color: '#6b7280', width: 16, height: 16 } }}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: '#8b5cf6', strokeWidth: 3 }}
      >
        <MiniMap width={160} height={110} />
        <Controls position="bottom-left" />
        <Background gap={16} size={1} color="#2a2f3a" variant="dots" />
      </ReactFlow>
      {/* Group visuals moved to a real group node (compound). Legacy overlays removed. */}
      {groupRectFlow && (
        <>
          <div style={{ position: 'absolute', transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`, transformOrigin: '0 0', pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', left: groupRectFlow.x, top: groupRectFlow.y, width: groupRectFlow.w, height: groupRectFlow.h, borderRadius: 12, background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.35)' }} />
          </div>
          <Paper withBorder shadow="sm" radius="xl" className="glass" p={4} style={{ position: 'absolute', left: flowToScreen({ x: groupRectFlow.x, y: groupRectFlow.y }).x, top: flowToScreen({ x: groupRectFlow.x, y: groupRectFlow.y }).y - 36, pointerEvents: 'auto', whiteSpace: 'nowrap', overflowX: 'auto' }}>
            <Group gap={6} style={{ flexWrap: 'nowrap' }}>
              <Text size="xs" c="dimmed">新建组</Text>
              <Divider orientation="vertical" style={{ height: 16 }} />
              {/* pre-group state: no run button */}
              <Button size="xs" variant="subtle" onClick={layoutGrid}>宫格布局</Button>
              <Button size="xs" variant="subtle" onClick={layoutHorizontal}>水平布局</Button>
              <Button size="xs" variant="subtle" onClick={()=>{
                const name = prompt('保存为资产名称：')?.trim();
                if (!name) return;
                const sel = nodes.filter(n=>n.selected)
                const setIds = new Set(sel.map(n=>n.id))
                const es = edges.filter(e=> setIds.has(e.source) && setIds.has(e.target))
                const { saveAsset } = require('../assets/registry') as any
                saveAsset({ name, nodes: sel, edges: es })
              }}>创建资产</Button>
              {!selectionPartialOverlaps && (
                <Button size="xs" variant="subtle" onClick={()=>{
                  // 直接打组为父节点
                  useRFStore.getState().addGroupForSelection(undefined)
                }}>打组</Button>
              )}
            </Group>
          </Paper>
        </>
      )}
      {guides?.vx !== undefined && (
        <div style={{ position: 'absolute', left: flowToScreen({ x: guides.vx!, y: 0 }).x, top: 0, width: 1, height: '100%', background: 'rgba(59,130,246,.5)' }} />
      )}
      {guides?.hy !== undefined && (
        <div style={{ position: 'absolute', left: 0, top: flowToScreen({ x: 0, y: guides.hy! }).y, width: '100%', height: 1, background: 'rgba(16,185,129,.5)' }} />
      )}
      {menu?.show && (
        <Paper withBorder shadow="md" onMouseLeave={() => setMenu(null)} style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 60, minWidth: 200 }}>
          <Stack gap={4} p="xs">
            {menu.type === 'canvas' && (
              <>
                <Button variant="subtle" onClick={() => { pasteFromClipboardAt(rf.screenToFlowPosition({ x: menu.x, y: menu.y })); setMenu(null) }}>在此粘贴</Button>
                <Divider my={2} />
                <Button variant="subtle" onClick={() => { useRFStore.getState().addNode('taskNode', '文本转图像', { kind: 'textToImage' }); setMenu(null) }}>新建 文本转图像</Button>
                <Button variant="subtle" onClick={() => { useRFStore.getState().addNode('taskNode', '视频合成', { kind: 'composeVideo' }); setMenu(null) }}>新建 视频合成</Button>
              </>
            )}
            {menu.type === 'node' && menu.id && (
              <>
                <Button variant="subtle" onClick={() => { duplicateNode(menu.id!); setMenu(null) }}>复制一份</Button>
                <Button variant="subtle" color="red" onClick={() => { deleteNode(menu.id!); setMenu(null) }}>删除</Button>
                <Divider my={2} />
                <Button variant="subtle" onClick={() => { runSelected(); setMenu(null) }}>运行该节点</Button>
                <Button variant="subtle" onClick={() => { cancelNode(menu.id!); setMenu(null) }}>停止该节点</Button>
              </>
            )}
            {menu.type === 'edge' && menu.id && (
              <Button variant="subtle" color="red" onClick={() => { deleteEdge(menu.id!); setMenu(null) }}>删除连线</Button>
            )}
          </Stack>
        </Paper>
      )}
      {connectingType && (
        <div style={{ position: 'fixed', left: mouse.x + 12, top: mouse.y + 12, pointerEvents: 'none', fontSize: 12, background: 'rgba(17,24,39,.85)', color: '#e5e7eb', padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,.1)' }}>
          连接类型: {connectingType}，拖到兼容端口
        </div>
      )}
    </div>
  )
}

export default function Canvas(): JSX.Element {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
