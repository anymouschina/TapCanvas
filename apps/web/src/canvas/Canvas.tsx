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
import IONode from './nodes/IONode'
import { useRFStore } from './store'
import { toast } from '../ui/toast'
import { applyTemplateAt } from '../templates'
import { Paper, Stack, Button, Divider, Group, Text, ActionIcon, Tooltip, useMantineColorScheme, useMantineTheme } from '@mantine/core'
import { IconBrandGithub, IconRobot } from '@tabler/icons-react'
import { getCurrentLanguage, setLanguage, $ } from './i18n'
import TypedEdge from './edges/TypedEdge'
import OrthTypedEdge from './edges/OrthTypedEdge'
import { useUIStore } from '../ui/uiStore'
import { runFlowDag } from '../runner/dag'
import { useInsertMenuStore } from './insertMenuStore'
import { uuid } from 'zod/v4'
import { UseChatAssistant } from './ai/UseChatAssistant'

const nodeTypes: NodeTypes = {
  taskNode: TaskNode,
  groupNode: GroupNode,
  ioNode: IONode,
}

const edgeTypes: EdgeTypes = {
  typed: TypedEdge,
  orth: OrthTypedEdge,
}

function CanvasInner(): JSX.Element {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, load } = useRFStore()
  const focusStack = useUIStore(s => s.focusStack)
  const focusGroupId = focusStack.length ? focusStack[focusStack.length - 1] : null
  const edgeRoute = useUIStore(s => s.edgeRoute)
  const enterGroupFocus = useUIStore(s => s.enterGroupFocus)
  const exitGroupFocus = useUIStore(s => s.exitGroupFocus)
  const exitAllFocus = useUIStore(s => s.exitAllFocus)
  const deleteNode = useRFStore(s => s.deleteNode)
  const deleteEdge = useRFStore(s => s.deleteEdge)
  const duplicateNode = useRFStore(s => s.duplicateNode)
  const pasteFromClipboardAt = useRFStore(s => s.pasteFromClipboardAt)
  const importWorkflow = useRFStore(s => s.importWorkflow)
  const autoLayoutAllDag = useRFStore(s => s.autoLayoutAllDag)
  const autoLayoutSelectedDag = useRFStore(s => s.autoLayoutSelectedDag)
  const runSelected = useRFStore(s => s.runSelected)
  const cancelNode = useRFStore(s => s.cancelNode)
  const rf = useReactFlow()
  const theme = useMantineTheme()
  const { colorScheme } = useMantineColorScheme()
  const isDarkCanvas = colorScheme === 'dark'
  const rgba = (color: string, alpha: number) => typeof theme.fn?.rgba === 'function' ? theme.fn.rgba(color, alpha) : color
  const backgroundGridColor = isDarkCanvas ? theme.colors.dark[5] : theme.colors.gray[2]
  const connectionStrokeColor = isDarkCanvas ? theme.colors.violet[4] : theme.colors.violet[6]
  const edgeMarkerColor = isDarkCanvas ? theme.colors.gray[6] : theme.colors.gray[5]
  const emptyGuideBackground = isDarkCanvas ? rgba(theme.colors.dark[7], 0.9) : rgba(theme.white, 0.95)
  const emptyGuideTextColor = isDarkCanvas ? theme.white : theme.colors.dark[6]
  const selectionBorderColor = rgba(isDarkCanvas ? theme.white : theme.colors.gray[6], isDarkCanvas ? 0.35 : 0.5)
  const [connectingType, setConnectingType] = useState<string | null>(null)
  const [mouse, setMouse] = useState<{x:number;y:number}>({x:0,y:0})
  const [menu, setMenu] = useState<{ show: boolean; x: number; y: number; type: 'node'|'edge'|'canvas'; id?: string } | null>(null)
  const [guides, setGuides] = useState<{ vx?: number; hy?: number } | null>(null)
  const [longSelect, setLongSelect] = useState(false)
  const downPos = useRef<{x:number;y:number}|null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const [dragging, setDragging] = useState(false)
  const [currentLang, setCurrentLangState] = useState(getCurrentLanguage())
  const [aiAssistantOpened, setAiAssistantOpened] = useState(false)
  const insertMenu = useInsertMenuStore(s => ({ open: s.open, x: s.x, y: s.y, edgeId: s.edgeId, fromNodeId: s.fromNodeId, fromHandle: s.fromHandle }))
  const closeInsertMenu = useInsertMenuStore(s => s.closeMenu)

  useEffect(() => {
    // initial: no local restore, rely on explicit load from server via UI
    setTimeout(() => rf.fitView?.({ padding: 0.2 }), 50)
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
        const id = `${uuid()}${s.nextId}`
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
    const isStoryboardTarget = targetKind === 'storyboard'
    if (targetKind === 'composeVideo' || isStoryboardTarget) return ['textToImage','tts','subtitleAlign','composeVideo','storyboard','image','video','character'].includes(sourceKind)
    if (targetKind === 'image') return ['image','textToImage'].includes(sourceKind)
    if (targetKind === 'video') return ['image','composeVideo','storyboard','video','character'].includes(sourceKind)
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
    didConnectRef.current = false
    const h = params.handleId || ''
    // if source handle like out-image -> type=image
    if (params.handleType === 'source' && h.startsWith('out-')) {
      setConnectingType(h.slice(4))
    } else if (params.handleType === 'target' && h.startsWith('in-')) {
      setConnectingType(h.slice(3))
    } else {
      setConnectingType(null)
    }

    // 记录从哪个节点的哪个端口开始连接，用于松手后弹出插入菜单
    if (params.handleType === 'source' && params.nodeId) {
      const n = nodes.find((nn) => nn.id === params.nodeId)
      const k = (n?.data as any)?.kind
      // 支持从文本节点和图片节点右侧拖出时唤起辅助连接浮层
      if (k === 'textToImage' || k === 'image') {
        connectFromRef.current = { nodeId: params.nodeId, handleId: params.handleId || null }
      } else {
        connectFromRef.current = null
      }
    } else {
      connectFromRef.current = null
    }
  }, [nodes])

  const onConnectEnd = useCallback((_evt: any) => {
    const from = connectFromRef.current
    if (connectingType && !didConnectRef.current && !lastReason.current && from) {
      // 从 text 节点拖出并松手在空白处：打开插入菜单
      useInsertMenuStore.getState().openMenu({
        x: mouse.x,
        y: mouse.y,
        fromNodeId: from.nodeId,
        fromHandle: from.handleId || 'out-any',
      })
    } else if (connectingType && lastReason.current) {
      const msg = lastReason.current || $('连接无效：类型不兼容、重复或形成环')
      toast(msg, 'error')
    }
    setConnectingType(null)
    lastReason.current = null
    connectFromRef.current = null
    didConnectRef.current = false
  }, [connectingType, mouse.x, mouse.y])

  // removed pane mouse handlers (not supported by current reactflow typings). Root listeners are used instead.

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

    // If dragging IO summary nodes in focus mode, persist relative position into group node data
    if (node?.type === 'ioNode' && (node as any)?.parentNode) {
      const groupId = (node as any).parentNode as string
      const isIn = (node?.data as any)?.kind === 'io-in'
      const ioSize = { w: 96, h: 28 }
      const grp = useRFStore.getState().nodes.find(n => n.id === groupId)
      if (grp) {
        const gW = (grp as any).width || (grp.style as any)?.width || 240
        const gH = (grp as any).height || (grp.style as any)?.height || 160
        const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
        const rel = { x: clamp(node.position.x, 0, Math.max(0, gW - ioSize.w)), y: clamp(node.position.y, 0, Math.max(0, gH - ioSize.h)) }
        useRFStore.setState(s => ({
          nodes: s.nodes.map(n => n.id === groupId ? { ...n, data: { ...(n.data||{}), [isIn ? 'ioInPos' : 'ioOutPos']: rel } } : n)
        }))
      }
    }
  }, [nodes])

  const onNodeDragStop = useCallback(() => {
    setGuides(null)
    setDragging(false)
  }, [])

  // Note: auto-fit group size is disabled to avoid update loops in React Flow store; rely on NodeResizer + manual layout

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
  const connectFromRef = useRef<{ nodeId: string; handleId: string | null } | null>(null)
  const didConnectRef = useRef(false)

  const handleConnect = useCallback((c: any) => {
    lastReason.current = null
    didConnectRef.current = true
    onConnect(c)
  }, [onConnect])
  // MiniMap drag-to-pan and smart click
  const minimapDragRef = useRef<{ el: HTMLElement; rect: DOMRect; startPos: { x: number; y: number } }|null>(null)
  const minimapClickRef = useRef<{ downTime: number; startPos: { x: number; y: number } }|null>(null)

  // Group overlay computation
  const selectedNodes = nodes.filter(n=>n.selected)
  const hasGroupNodeSelected = selectedNodes.some(n => (n as any).type === 'groupNode')
  const parentIds = new Set(selectedNodes.map(n => (n.parentNode as string) || ''))
  const allInsideSameGroup = selectedNodes.length > 1 && !parentIds.has('') && parentIds.size === 1
  // Only show pre-group overlay for root-level multi-selection (not when a group is already formed or group node selected)
  const showPreGroupOverlay = selectedNodes.length > 1 && !hasGroupNodeSelected && !allInsideSameGroup
  // legacy group match no longer used (compound nodes now)
  const groups = useRFStore(s => s.groups)
  const defaultW = 180, defaultH = 96
  // selection rect in FLOW coordinates
  let groupRectFlow: { x: number; y: number; w: number; h: number } | null = null
  if (showPreGroupOverlay) {
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
    const parents = new Set(selectedNodes.map(n => n.parentNode || ''))
    // Do not treat selection within same group as valid for grouping
    if (!parents.has('') && parents.size === 1) return true
    // Disallow grouping across different parents
    return parents.size > 1
  }, [selectedNodes])

  // Apply focus filtering (group focus mode)
  const focusFiltered = useMemo(() => {
    if (!focusGroupId) return { nodes, edges }
    const group = nodes.find(n => n.id === focusGroupId)
    if (!group) return { nodes, edges }
    const internalIds = new Set<string>([group.id, ...nodes.filter(n => n.parentNode === group.id).map(n => n.id)])
    const internalNodes = nodes.filter(n => internalIds.has(n.id))
    const internalEdges = edges.filter(e => internalIds.has(e.source) && internalIds.has(e.target))
    // Build IO summary nodes and remapped edges for cross-boundary connections
    const inCross = edges.filter(e => !internalIds.has(e.source) && internalIds.has(e.target))
    const outCross = edges.filter(e => internalIds.has(e.source) && !internalIds.has(e.target))
    const inferType = (e: any) => {
      const sh = e.sourceHandle?.toString() || ''
      const th = e.targetHandle?.toString() || ''
      if (sh.startsWith('out-')) return sh.slice(4)
      if (th.startsWith('in-')) return th.slice(3)
      return 'any'
    }
    const typesIn = Array.from(new Set(inCross.map(inferType)))
    const typesOut = Array.from(new Set(outCross.map(inferType)))
    const gWidth = (group as any).width || (group.style as any)?.width || 240
    const gHeight = (group as any).height || (group.style as any)?.height || 160
    const inNodeId = `io-in-${group.id}`
    const outNodeId = `io-out-${group.id}`
    const ioNodes = [] as any[]
    const inPos = ((group.data as any)?.ioInPos) as { x:number;y:number } | undefined
    const outPos = ((group.data as any)?.ioOutPos) as { x:number;y:number } | undefined
    if (inCross.length) {
      ioNodes.push({ id: inNodeId, type: 'ioNode' as const, parentNode: group.id, draggable: true, position: inPos || { x: 8, y: 8 }, data: { kind: 'io-in', label: $('入口'), types: typesIn } })
    }
    if (outCross.length) {
      const def = { x: Math.max(8, gWidth - 104), y: Math.max(8, gHeight - 36) }
      ioNodes.push({ id: outNodeId, type: 'ioNode' as const, parentNode: group.id, draggable: true, position: outPos || def, data: { kind: 'io-out', label: $('出口'), types: typesOut } })
    }
    const remapEdgesIn = inCross.map((e, idx) => ({ id: `ioe-in-${idx}-${e.target}`, source: inNodeId, sourceHandle: `out-${inferType(e)}`, target: e.target, targetHandle: e.targetHandle, type: 'typed' as const, animated: true }))
    const remapEdgesOut = outCross.map((e, idx) => ({ id: `ioe-out-${e.source}-${idx}`, source: e.source, sourceHandle: e.sourceHandle, target: outNodeId, targetHandle: `in-${inferType(e)}`, type: 'typed' as const, animated: true }))
    return {
      nodes: [...internalNodes, ...ioNodes],
      edges: [...internalEdges, ...remapEdgesIn, ...remapEdgesOut],
    }
  }, [focusGroupId, nodes, edges])

  // Edge highlight when connected to a selected node
  const selectedIds = new Set(selectedNodes.map(n=>n.id))
  const viewEdges = useMemo(() => {
    const base = focusFiltered.edges
    if (selectedIds.size === 0) return base
    return base.map(e => {
      const active = selectedIds.has(e.source) || selectedIds.has(e.target)
      return active ? { ...e, style: { ...(e.style||{}), stroke: '#e5e7eb', opacity: 1 } } : { ...e, style: { ...(e.style||{}), opacity: 0.5 } }
    })
  }, [focusFiltered.edges, selectedIds])

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

  const handleInsertNodeAt = (
    kind: 'text' | 'image' | 'video',
    menuState: { x: number; y: number; fromNodeId?: string; fromHandle?: string | null },
  ) => {
    const posFlow = screenToFlow({ x: menuState.x, y: menuState.y })
    const upstreamNode = menuState.fromNodeId
      ? useRFStore.getState().nodes.find(n => n.id === menuState.fromNodeId)
      : undefined
    const upstreamPrompt = upstreamNode ? ((upstreamNode.data as any)?.prompt as string | undefined) : undefined

    useRFStore.setState(s => {
      const before = s.nextId
      const id = `${uuid()}${before}`
      let label = 'Text'
      let nodeKind: string = 'textToImage'
      if (kind === 'image') {
        label = 'Image'
        nodeKind = 'image'
      } else if (kind === 'video') {
        label = 'Video'
        nodeKind = 'composeVideo'
      }
      const data: any = { label, kind: nodeKind }
      if (upstreamPrompt) data.prompt = upstreamPrompt

      const node = { id, type: 'taskNode' as const, position: posFlow, data }

      let edgesNext = s.edges
      if (menuState.fromNodeId) {
        const edgeId = `e-${menuState.fromNodeId}-${id}-${Date.now().toString(36)}`
        const targetHandle = kind === 'image' || kind === 'video' ? 'in-image' : 'in-any'
        const edge: any = {
          id: edgeId,
          source: menuState.fromNodeId,
          target: id,
          sourceHandle: menuState.fromHandle || 'out-any',
          targetHandle,
          type: (edgeRoute === 'orth' ? 'orth' : 'typed') as any,
          animated: true,
        }
        edgesNext = [...edgesNext, edge]
      }

      return { nodes: [...s.nodes, node], edges: edgesNext, nextId: before + 1 }
    })

    closeInsertMenu()
  }

  // Find the nearest node to a click position in minimap
  const findNearestNode = useCallback((clickX: number, clickY: number, minimapRect: DOMRect) => {
    const defaultW = 180, defaultH = 96
    if (nodes.length === 0) return null

    // Convert click position to world coordinates
    const rx = Math.max(0, Math.min(1, clickX / minimapRect.width))
    const ry = Math.max(0, Math.min(1, clickY / minimapRect.height))

    const minX = Math.min(...nodes.map(n => n.position.x))
    const minY = Math.min(...nodes.map(n => n.position.y))
    const maxX = Math.max(...nodes.map(n => n.position.x + (((n as any).width) || defaultW)))
    const maxY = Math.max(...nodes.map(n => n.position.y + (((n as any).height) || defaultH)))
    const worldX = minX + rx * (maxX - minX)
    const worldY = minY + ry * (maxY - minY)

    // Find nearest node
    let nearestNode = null
    let minDistance = Infinity

    for (const node of nodes) {
      const nodeW = ((node as any).width) || defaultW
      const nodeH = ((node as any).height) || defaultH
      const nodeCenterX = node.position.x + nodeW / 2
      const nodeCenterY = node.position.y + nodeH / 2

      const distance = Math.sqrt(Math.pow(worldX - nodeCenterX, 2) + Math.pow(worldY - nodeCenterY, 2))

      if (distance < minDistance) {
        minDistance = distance
        nearestNode = node
      }
    }

    // Only return node if click is reasonably close (within 30% of minimap dimensions)
    const threshold = Math.min(minimapRect.width, minimapRect.height) * 0.3
    const clickThreshold = (threshold / minimapRect.width) * (maxX - minX)

    return minDistance <= clickThreshold ? nearestNode : null
  }, [nodes])

  const handleRootClick = useCallback((e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('.react-flow__minimap') as HTMLElement | null
    if (!el) return

    const rect = el.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top

    // Check if this was a quick click (not a drag)
    if (minimapClickRef.current) {
      const clickDuration = Date.now() - minimapClickRef.current.downTime
      const dragDistance = Math.sqrt(
        Math.pow(clickX - minimapClickRef.current.startPos.x, 2) +
        Math.pow(clickY - minimapClickRef.current.startPos.y, 2)
      )

      // If click was quick and minimal movement, treat as smart click
      if (clickDuration < 200 && dragDistance < 5) {
        const nearestNode = findNearestNode(clickX, clickY, rect)

        if (nearestNode) {
          // Select the node and center view on it
          useRFStore.setState(s => ({
            nodes: s.nodes.map(n => ({
              ...n,
              selected: n.id === nearestNode.id
            }))
          }))

          const nodeW = ((nearestNode as any).width) || 180
          const nodeH = ((nearestNode as any).height) || 96
          const nodeCenterX = nearestNode.position.x + nodeW / 2
          const nodeCenterY = nearestNode.position.y + nodeH / 2

          rf.setCenter?.(nodeCenterX, nodeCenterY, { zoom: viewport.zoom || 1, duration: 300 })
        } else {
          // No node near click, treat as normal view centering
          const rx = Math.max(0, Math.min(1, clickX / rect.width))
          const ry = Math.max(0, Math.min(1, clickY / rect.height))
          const defaultW = 180, defaultH = 96
          const minX = Math.min(...nodes.map(n => n.position.x))
          const minY = Math.min(...nodes.map(n => n.position.y))
          const maxX = Math.max(...nodes.map(n => n.position.x + (((n as any).width) || defaultW)))
          const maxY = Math.max(...nodes.map(n => n.position.y + (((n as any).height) || defaultH)))
          const worldX = minX + rx * (maxX - minX)
          const worldY = minY + ry * (maxY - minY)
          const z = viewport.zoom || 1
          rf.setCenter?.(worldX, worldY, { zoom: z, duration: 200 })
        }
      }
    }

    minimapClickRef.current = null
    e.stopPropagation()
    e.preventDefault()
  }, [nodes, rf, viewport.zoom, findNearestNode])

  const handleRootMouseDown = useCallback((e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('.react-flow__minimap') as HTMLElement | null
    if (!el) return

    const rect = el.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top

    // Record click info for distinguishing click vs drag
    minimapClickRef.current = {
      downTime: Date.now(),
      startPos: { x: clickX, y: clickY }
    }

    // Setup drag reference for pan functionality
    minimapDragRef.current = { el, rect, startPos: { x: clickX, y: clickY } }
  }, [])

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
      onDoubleClick={(e) => {
        // double-click blank to go up one level in focus mode
        const target = e.target as HTMLElement
        if (!target.closest('.react-flow__node') && focusGroupId) {
          exitGroupFocus()
          setTimeout(() => rf.fitView?.({ padding: 0.2 }), 50)
        }
      }}
      onKeyDown={(e) => {
        // 处理键盘删除事件 - 检查是否在输入框中
        function isTextInputElement(target: EventTarget | null) {
          if (!(target instanceof HTMLElement)) return false
          const tagName = target.tagName
          if (tagName === 'INPUT' || tagName === 'TEXTAREA') return true
          if (target.getAttribute('contenteditable') === 'true') return true
          if (target.closest('input') || target.closest('textarea')) return true
          if (target.closest('[contenteditable="true"]')) return true
          return false
        }

        const focusTarget = document.activeElement as HTMLElement | null
        const isTextInput = isTextInputElement(e.target) || isTextInputElement(focusTarget)

        if ((e.key === 'Delete' || e.key === 'Backspace') && !isTextInput) {
          e.preventDefault()
          useRFStore.getState().removeSelected()
        }
      }}
      tabIndex={0} // 使div可以接收键盘事件
    >
      <ReactFlow
        nodes={focusFiltered.nodes}
        edges={viewEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeDragStart={onNodeDragStart}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={(_evt, node) => {
          if (node?.type === 'groupNode') {
            useUIStore.getState().enterGroupFocus(node.id)
            setTimeout(() => rf.fitView?.({ padding: 0.2 }), 50)
          }
        }}

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
          if (createsCycle({ source: c.source, target: c.target })) { lastReason.current = $('连接会导致环'); return false }
          const dup = edges.some(e => e.source === c.source && e.target === c.target)
          if (dup) { lastReason.current = $('重复连接'); return false }
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
            if (sType && tType && sType !== 'any' && tType !== 'any' && sType !== tType) {
              let crossAllowed = sType === 'video' && tType === 'subtitle'
              const sourceIsVideoKind = ['video', 'composeVideo', 'storyboard'].includes(sKind || '')
              const targetIsVideoKind = ['video', 'composeVideo', 'storyboard'].includes(tKind || '')
              if (!crossAllowed && sType === 'video' && sourceIsVideoKind && targetIsVideoKind) {
                crossAllowed = true
              }
              if (!crossAllowed) {
                lastReason.current = $('类型不兼容：{{from}} → {{to}}', { from: sType, to: tType })
                return false
              }
            }
          }
          const ok = isValidEdgeByType(sKind, tKind)
          if (!ok) lastReason.current = $('不允许的连接方向')
          return ok
        }}
        snapToGrid
        snapGrid={[16, 16]}
        defaultEdgeOptions={{ animated: true, type: (edgeRoute === 'orth' ? 'orth' : 'typed') as any, style: { strokeWidth: 3 }, interactionWidth: 24, markerEnd: { type: MarkerType.ArrowClosed, color: edgeMarkerColor, width: 16, height: 16 } }}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: connectionStrokeColor, strokeWidth: 3 }}
      >
        <MiniMap style={{ width: 160, height: 110 }} />
        <Controls position="bottom-left" />
        <Background gap={16} size={1} color={backgroundGridColor} />
      </ReactFlow>

      {/* AI助手按钮 */}
      <ActionIcon
        size="lg"
        radius="xl"
        color="green"
        variant="filled"
        style={{
          position: 'absolute',
          right: 20,
          top: 20,
          zIndex: 1000
        }}
        onClick={() => setAiAssistantOpened(true)}
      >
        <Tooltip label="AI助手">
          <IconRobot size={20} />
        </Tooltip>
      </ActionIcon>

      {/* AI助手面板 */}
      <UseChatAssistant
        opened={aiAssistantOpened}
        onClose={() => setAiAssistantOpened(false)}
        position="right"
        width={400}
      />
      {/* Focus mode breadcrumb with hierarchy */}
      {focusGroupId && (
        <Paper withBorder shadow="sm" radius="xl" p={6} style={{ position: 'absolute', left: 12, top: 12 }}>
          <Group gap={8} style={{ flexWrap: 'nowrap' }}>
            {focusStack.map((gid, idx) => {
              const n = nodes.find(nn => nn.id === gid)
              const label = (n?.data as any)?.label || $('组')
              const isLast = idx === focusStack.length - 1
              return (
                <Group key={gid} gap={6} style={{ flexWrap: 'nowrap' }}>
                  <Button size="xs" variant={isLast ? 'filled' : 'subtle'} onClick={() => {
                    useUIStore.setState(s => ({ focusStack: s.focusStack.slice(0, idx + 1) }))
                    setTimeout(()=> rf.fitView?.({ padding: 0.2 }), 50)
                  }}>{label}</Button>
                  {!isLast && <Text size="sm" c="dimmed">/</Text>}
                </Group>
              )
            })}
            <Divider orientation="vertical" style={{ height: 16 }} />
            <Button size="xs" variant="subtle" onClick={()=>{ exitGroupFocus(); setTimeout(()=> rf.fitView?.({ padding: 0.2 }), 50) }}>上一级</Button>
            <Button size="xs" variant="subtle" onClick={()=>{ exitAllFocus(); setTimeout(()=> rf.fitView?.({ padding: 0.2 }), 50) }}>退出聚焦</Button>
          </Group>
        </Paper>
      )}
      {/* Empty canvas guide */}
      {nodes.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <Paper withBorder shadow="md" p="md" style={{ pointerEvents: 'auto', background: emptyGuideBackground, color: emptyGuideTextColor }}>
            <Stack gap={8} style={{ color: emptyGuideTextColor }}>
              <Text c="dimmed" style={{ color: emptyGuideTextColor, opacity: 0.7 }}>{$('快速开始')}</Text>
              <Group gap={8} style={{ flexWrap: 'nowrap' }}>
                <Button size="sm" onClick={() => { useRFStore.getState().addNode('taskNode', 'text', { kind: 'textToImage' }) }}>{$('新建 text')}</Button>
                <Button size="sm" variant="light" onClick={() => {
                  // create a small sample flow in center
                  const center = rf.project?.({ x: window.innerWidth/2, y: window.innerHeight/2 }) || { x: 200, y: 200 }
                  useRFStore.setState((s) => {
                    const n1 = { id: `n${s.nextId}`, type: 'taskNode' as const, position: { x: center.x - 240, y: center.y - 60 }, data: { label: 'text', kind: 'textToImage' } }
                    const n2 = { id: `n${s.nextId+1}`, type: 'taskNode' as const, position: { x: center.x, y: center.y - 60 }, data: { label: $('图像'), kind: 'image' } }
                    const n3 = { id: `n${s.nextId+2}`, type: 'taskNode' as const, position: { x: center.x + 260, y: center.y - 60 }, data: { label: 'video', kind: 'composeVideo' } }
                    const e1 = { id: `e-${n1.id}-${n2.id}`, source: n1.id, target: n2.id, type: 'typed' as const, animated: true } as any
                    const e2 = { id: `e-${n2.id}-${n3.id}`, source: n2.id, target: n3.id, type: 'typed' as const, animated: true } as any
                    return { nodes: [n1, n2, n3], edges: [e1, e2], nextId: s.nextId + 3 }
                  })
                }}>{$('创建示例工作流')}</Button>
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => window.open('https://jpcpk71wr7.feishu.cn/wiki/WPDAw408jiQlOxki5seccaLdn9b', '_blank', 'noopener')}
                >
                  {$('了解更多')}
                </Button>
              </Group>
              <Text size="xs" c="dimmed" style={{ color: emptyGuideTextColor, opacity: 0.8 }}>提示：框选多个节点后按 ⌘/Ctrl+G 打组，⌘/Ctrl+Enter 一键运行。</Text>
            </Stack>
          </Paper>
        </div>
      )}
      {/* Group visuals moved to a real group node (compound). Legacy overlays removed. */}
      {groupRectFlow && (
        <>
          {/* Selection outline in screen space to avoid transform artifacts */}
          <div
            style={{
              position: 'absolute',
              left: flowToScreen({ x: groupRectFlow.x, y: groupRectFlow.y }).x,
              top: flowToScreen({ x: groupRectFlow.x, y: groupRectFlow.y }).y,
              width: groupRectFlow.w * (viewport.zoom || 1),
              height: groupRectFlow.h * (viewport.zoom || 1),
              borderRadius: 12,
              border: `1px dashed ${selectionBorderColor}`,
              background: 'transparent',
              pointerEvents: 'none'
            }}
          />
          <Paper withBorder shadow="sm" radius="xl" className="glass" p={4} style={{ position: 'absolute', left: flowToScreen({ x: groupRectFlow.x, y: groupRectFlow.y }).x, top: flowToScreen({ x: groupRectFlow.x, y: groupRectFlow.y }).y - 36, pointerEvents: 'auto', whiteSpace: 'nowrap', overflowX: 'auto' }}>
            <Group gap={6} style={{ flexWrap: 'nowrap' }}>
              <Text size="xs" c="dimmed">新建组</Text>
              <Divider orientation="vertical" style={{ height: 16 }} />
              <Button size="xs" variant="subtle" onClick={() => autoLayoutSelectedDag()}>自动布局</Button>
              {/* pre-group state: no run button */}
              <Button size="xs" variant="subtle" onClick={layoutGrid}>宫格布局</Button>
              <Button size="xs" variant="subtle" onClick={layoutHorizontal}>水平布局</Button>
              <Button size="xs" variant="subtle" onClick={async ()=>{
                const name = prompt('保存为资产名称：')?.trim(); if (!name) return;
                const sel = nodes.filter(n=>n.selected)
                const setIds = new Set(sel.map(n=>n.id))
                const es = edges.filter(e=> setIds.has(e.source) && setIds.has(e.target))
                const data = { nodes: sel, edges: es }
                // 资产现在是用户级别的，不需要项目ID
                const { createServerAsset } = await import('../api/server')
                await createServerAsset({ name, data })
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
                <Button variant="subtle" onClick={() => {
                  const input = document.createElement('input')
                  input.type = 'file'
                  input.accept = '.json'
                  input.onchange = async (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0]
                    if (!file) return
                    try {
                      const text = await file.text()
                      const data = JSON.parse(text)
                      if (data.nodes && Array.isArray(data.nodes) && data.edges && Array.isArray(data.edges)) {
                        const pos = rf.screenToFlowPosition({ x: menu.x, y: menu.y })
                        importWorkflow(data, pos)
                        setMenu(null)
                      } else {
                        alert('无效的工作流格式')
                      }
                    } catch (err) {
                      alert('解析 JSON 失败: ' + (err as Error).message)
                    }
                  }
                  input.click()
                }}>导入工作流 JSON</Button>
                <Button variant="subtle" onClick={() => { autoLayoutAllDag(); setMenu(null) }}>自动布局（全图）</Button>
                <Button variant="subtle" onClick={() => { useUIStore.getState().toggleEdgeRoute(); setMenu(null) }}>切换边线（当前：{edgeRoute==='orth'?'正交':'平滑'}）</Button>
                {focusGroupId && <Button variant="subtle" onClick={() => { exitGroupFocus(); setMenu(null); setTimeout(()=> rf.fitView?.({ padding: 0.2 }), 50) }}>上一级</Button>}
                {focusGroupId && <Button variant="subtle" onClick={() => { useUIStore.getState().exitAllFocus(); setMenu(null); setTimeout(()=> rf.fitView?.({ padding: 0.2 }), 50) }}>退出聚焦</Button>}
                <Divider my={2} />
                <Button variant="subtle" onClick={() => { useRFStore.getState().addNode('taskNode', 'text', { kind: 'textToImage' }); setMenu(null) }}>新建 text</Button>
                <Button variant="subtle" onClick={() => { useRFStore.getState().addNode('taskNode', 'video', { kind: 'composeVideo' }); setMenu(null) }}>新建 video</Button>
                <Button variant="subtle" onClick={() => { useRFStore.getState().addNode('taskNode', '分镜', { kind: 'storyboard' }); setMenu(null) }}>新建 storyboard</Button>
              </>
            )}
            {menu.type === 'node' && menu.id && (() => {
              const target = nodes.find(n => n.id === menu.id)
              const isGroup = target?.type === 'groupNode'
              if (isGroup) {
                const childIds = new Set(nodes.filter(n => n.parentNode === target!.id).map(n=>n.id))
                return (
                  <>
                    <Button variant="subtle" onClick={async () => { await runFlowDag(2, useRFStore.getState, useRFStore.setState, { only: childIds }); setMenu(null) }}>运行该组</Button>
                    <Button variant="subtle" onClick={() => { useRFStore.getState().autoLayoutForParent(target!.id); setMenu(null) }}>自动布局</Button>
                    <Button variant="subtle" onClick={() => { useRFStore.getState().layoutGridSelected(); setMenu(null) }}>宫格布局</Button>
                    <Button variant="subtle" onClick={() => { useRFStore.getState().layoutHorizontalSelected(); setMenu(null) }}>水平布局</Button>
                    <Button variant="subtle" onClick={() => { enterGroupFocus(target!.id); setMenu(null); setTimeout(()=> rf.fitView?.({ padding: 0.2 }), 50) }}>进入组</Button>
                    <Button variant="subtle" onClick={() => { useRFStore.getState().renameSelectedGroup(); setMenu(null) }}>重命名</Button>
                    <Button variant="subtle" color="red" onClick={() => { useRFStore.getState().ungroupGroupNode(target!.id); setMenu(null) }}>解组</Button>
                  </>
                )
              }
              return (
                <>
                  <Button variant="subtle" onClick={() => { duplicateNode(menu.id!); setMenu(null) }}>复制一份</Button>
                  <Button variant="subtle" color="red" onClick={() => { deleteNode(menu.id!); setMenu(null) }}>删除</Button>
                  <Divider my={2} />
                  <Button variant="subtle" onClick={() => { runSelected(); setMenu(null) }}>运行该节点</Button>
                  <Button variant="subtle" onClick={() => { cancelNode(menu.id!); setMenu(null) }}>停止该节点</Button>
                </>
              )
            })()}
            {menu.type === 'edge' && menu.id && (
              <Button variant="subtle" color="red" onClick={() => { deleteEdge(menu.id!); setMenu(null) }}>删除连线</Button>
            )}
          </Stack>
        </Paper>
      )}
      {insertMenu.open && (() => {
        const fromNode = nodes.find(n => n.id === insertMenu.fromNodeId)
        const fromKind = fromNode?.data?.kind as string | undefined
        const isFromImage = fromKind === 'image'

        return (
          <Paper
            withBorder
            shadow="md"
            style={{
              position: 'fixed',
              left: insertMenu.x,
              top: insertMenu.y,
              zIndex: 70,
              minWidth: 180,
            }}
            onMouseLeave={closeInsertMenu}
          >
            <Stack gap={4} p="xs">
              <Text size="xs" c="dimmed">
                {isFromImage ? '从图片继续' : '从文本继续'}
              </Text>
              {isFromImage ? (
                <>
                  <Button
                    variant="subtle"
                    size="xs"
                    onClick={() => {
                      handleInsertNodeAt('video', {
                        x: insertMenu.x,
                        y: insertMenu.y,
                        fromNodeId: insertMenu.fromNodeId,
                        fromHandle: insertMenu.fromHandle,
                      })
                    }}
                  >
                    图生视频
                  </Button>
                  <Button
                    variant="subtle"
                    size="xs"
                    onClick={() => {
                      handleInsertNodeAt('text', {
                        x: insertMenu.x,
                        y: insertMenu.y,
                        fromNodeId: insertMenu.fromNodeId,
                        fromHandle: insertMenu.fromHandle,
                      })
                    }}
                  >
                    反推提示词
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="subtle"
                    size="xs"
                    onClick={() => {
                      handleInsertNodeAt('image', {
                        x: insertMenu.x,
                        y: insertMenu.y,
                        fromNodeId: insertMenu.fromNodeId,
                        fromHandle: insertMenu.fromHandle,
                      })
                    }}
                  >
                    文生图
                  </Button>
                  <Button
                    variant="subtle"
                    size="xs"
                    onClick={() => {
                      handleInsertNodeAt('video', {
                        x: insertMenu.x,
                        y: insertMenu.y,
                        fromNodeId: insertMenu.fromNodeId,
                        fromHandle: insertMenu.fromHandle,
                      })
                    }}
                  >
                    文生视频
                  </Button>
                </>
              )}
            </Stack>
          </Paper>
        )
      })()}
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
