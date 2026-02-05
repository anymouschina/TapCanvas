import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  useStore,
  NodeTypes,
  ConnectionLineType,
  ReactFlowProvider,
  EdgeTypes,
  getBezierPath,
  type ConnectionLineComponentProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import TaskNode from './nodes/TaskNode'
import GroupNode from './nodes/GroupNode'
import IONode from './nodes/IONode'
import { useRFStore } from './store'
import { toast } from '../ui/toast'
import { applyTemplateAt } from '../templates'
import { Paper, Stack, Button, Divider, Group, Text, useMantineColorScheme, useMantineTheme } from '@mantine/core'
import { getCurrentLanguage, setLanguage, $, $t } from './i18n'
import TypedEdge from './edges/TypedEdge'
import OrthTypedEdge from './edges/OrthTypedEdge'
import { useUIStore } from '../ui/uiStore'
import { runFlowDag } from '../runner/dag'
import { syncGrsaiImageNodeOnce, syncMiniMaxVideoNodeOnce, syncSora2ApiVideoNodeOnce } from '../runner/remoteRunner'
import { useInsertMenuStore } from './insertMenuStore'
import { uuid } from 'zod/v4'
import { getQuickStartSampleFlow } from './quickStartSample'
import { getHandleTypeLabel } from './utils/handleLabels'
import { isImageEditModel } from '../config/models'
import { subscribeTaskProgress, type TaskProgressEventMessage } from '../api/taskProgress'
import { useAuth } from '../auth/store'
import { uploadServerAssetFile, uploadSoraImage } from '../api/server'
import { blobToDataUrl, genTaskNodeId } from './nodes/taskNodeHelpers'
import { CANVAS_CONFIG } from './utils/constants'
import { buildEdgeValidator, isImageKind } from './utils/edgeRules'
import { buildCanvasThemeColors } from './utils/canvasTheme'
import { getTaskNodeSchema, listTaskNodeSchemas } from './nodes/taskNodeSchema'
import { usePreventBrowserSwipeNavigation } from '../utils/usePreventBrowserSwipeNavigation'

// 限制不同节点类型之间的连接关系；未匹配的类型默认放行，避免阻塞用户操作
const isValidEdgeByType = buildEdgeValidator()

const nodeTypes: NodeTypes = {
  taskNode: TaskNode,
  groupNode: GroupNode,
  ioNode: IONode,
}

const edgeTypes: EdgeTypes = {
  typed: TypedEdge,
  orth: OrthTypedEdge,
}

const joinClassNames = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(' ')

type CanvasInnerProps = {
  className?: string
}

function CanvasInner({ className }: CanvasInnerProps): JSX.Element {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, load } = useRFStore()
  const focusStack = useUIStore(s => s.focusStack)
  const focusGroupId = focusStack.length ? focusStack[focusStack.length - 1] : null
  const viewOnly = useUIStore(s => s.viewOnly)
  const edgeRoute = useUIStore(s => s.edgeRoute)
  const enterGroupFocus = useUIStore(s => s.enterGroupFocus)
  const exitGroupFocus = useUIStore(s => s.exitGroupFocus)
  const exitAllFocus = useUIStore(s => s.exitAllFocus)
  const setCanvasViewport = useUIStore(s => s.setCanvasViewport)
  const restoreViewport = useUIStore(s => s.restoreViewport)
  const setRestoreViewport = useUIStore(s => s.setRestoreViewport)
  const deleteNode = useRFStore(s => s.deleteNode)
  const deleteEdge = useRFStore(s => s.deleteEdge)
  const duplicateNode = useRFStore(s => s.duplicateNode)
  const pasteFromClipboardAt = useRFStore(s => s.pasteFromClipboardAt)
  const importWorkflow = useRFStore(s => s.importWorkflow)
  const formatTree = useRFStore(s => s.formatTree)
  const cancelNode = useRFStore(s => s.cancelNode)
  const rf = useReactFlow()
  const theme = useMantineTheme()
  const { colorScheme } = useMantineColorScheme()
  const isDarkCanvas = colorScheme === 'dark'
  const {
    backgroundGridColor,
    emptyGuideBackground,
    emptyGuideTextColor,
    selectionBorderColor,
  } = buildCanvasThemeColors(theme, colorScheme)
  const connectionLineStyle = useMemo(() => ({
    stroke: isDarkCanvas ? 'rgba(255,255,255,0.32)' : 'rgba(15,23,42,0.22)',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
  }), [isDarkCanvas])
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectingType, setConnectingType] = useState<string | null>(null)
  const lastReason = useRef<string | null>(null)
  const connectFromRef = useRef<{ nodeId: string; handleId: string | null } | null>(null)
  const didConnectRef = useRef(false)
  const [tapConnectSource, setTapConnectSource] = useState<{ nodeId: string } | null>(null)
  const [mouse, setMouse] = useState<{x:number;y:number}>({x:0,y:0})
  const [menu, setMenu] = useState<{ show: boolean; x: number; y: number; type: 'node'|'edge'|'canvas'; id?: string } | null>(null)
  const [guides, setGuides] = useState<{ vx?: number; hy?: number } | null>(null)
  const lastGuidesRef = useRef<{ vx?: number; hy?: number } | null>(null)
  const [longSelect, setLongSelect] = useState(false)
  const downPos = useRef<{x:number;y:number}|null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const [dragging, setDragging] = useState(false)
  const [currentLang, setCurrentLangState] = useState(getCurrentLanguage())
  const insertMenu = useInsertMenuStore(s => ({ open: s.open, x: s.x, y: s.y, edgeId: s.edgeId, fromNodeId: s.fromNodeId, fromHandle: s.fromHandle }))
  const closeInsertMenu = useInsertMenuStore(s => s.closeMenu)
  const authToken = useAuth(s => s.token)
  const langGraphChatOpen = useUIStore(s => s.langGraphChatOpen)
  const viewOnlyFormattedOnceRef = useRef(false)
  const soraSyncingRef = useRef<Set<string>>(new Set())
  const minimaxSyncingRef = useRef<Set<string>>(new Set())
  const grsaiImageSyncingRef = useRef<Set<string>>(new Set())
  const rootRef = useRef<HTMLDivElement | null>(null)
  const initialFitAppliedRef = useRef(false)
  const restoreAppliedRef = useRef(false)
  const lastPointerScreenRef = useRef<{ x: number; y: number } | null>(null)
  const imageUploadInputRef = useRef<HTMLInputElement | null>(null)
  const pendingImageUploadScreenRef = useRef<{ x: number; y: number } | null>(null)

  usePreventBrowserSwipeNavigation({ rootRef, withinSelector: '.tc-canvas__flow' })

  const isImageFile = (file: File) => Boolean(file?.type?.startsWith('image/'))

  const deriveLabelFromFileName = (name: string): string => {
    const trimmed = (name || '').trim()
    if (!trimmed) return 'Image'
    const base = trimmed.replace(/\.[a-z0-9]+$/i, '').trim()
    return base || 'Image'
  }

  const getFallbackScreenPoint = useCallback((): { x: number; y: number } => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  }, [])

  const importImagesFromFiles = useCallback(async (files: File[], basePosFlow?: { x: number; y: number }) => {
    if (viewOnly) return
    if (langGraphChatOpen) return
    const images = (files || []).filter(isImageFile)
    if (!images.length) return

    const MAX_BYTES = 30 * 1024 * 1024
    const tooLarge = images.filter(f => (typeof f.size === 'number' ? f.size : 0) > MAX_BYTES)
    if (tooLarge.length) {
      toast(`有 ${tooLarge.length} 张图片超过 30MB，已跳过`, 'error')
    }
    const valid = images.filter(f => (typeof f.size === 'number' ? f.size : 0) <= MAX_BYTES)
    if (!valid.length) return

    const base = basePosFlow ?? rf.screenToFlowPosition(lastPointerScreenRef.current ?? getFallbackScreenPoint())
    const cols = 3
    const spacingX = CANVAS_CONFIG.NODE_SPACING_X + 60
    const spacingY = CANVAS_CONFIG.NODE_SPACING_Y + 40
    const snapshotGraph = (nodes: any[], edges: any[]) => JSON.parse(JSON.stringify({ nodes, edges })) as { nodes: any[]; edges: any[] }

    const prepared = valid.map((file, idx) => {
      const id = genTaskNodeId()
      const label = deriveLabelFromFileName(file.name)
      const localUrl = URL.createObjectURL(file)
      const position = {
        x: base.x + (idx % cols) * spacingX,
        y: base.y + Math.floor(idx / cols) * spacingY,
      }
      return { id, file, label, localUrl, position }
    })

    useRFStore.setState((s) => {
      const newNodes = prepared.map(({ id, label, localUrl, position }) => ({
        id,
        type: 'taskNode' as const,
        position,
        data: {
          label,
          kind: 'image',
          imageUrl: localUrl,
          nodeWidth: 120,
          nodeHeight: 210,
        },
        selected: false,
      }))
      return { nodes: [...s.nodes, ...newNodes], nextId: s.nextId + newNodes.length }
    })

    const { updateNodeData } = useRFStore.getState()
    let successCount = 0
    for (const { id, file, localUrl, label } of prepared) {
      let localDataUrl: string | undefined
      try {
        localDataUrl = await blobToDataUrl(file)
      } catch {
        localDataUrl = undefined
      }
      if (localDataUrl) {
        updateNodeData(id, { reverseImageData: localDataUrl })
      }

      try {
        let hostedUrl: string | null = null
        let hostedAssetId: string | null = null
        try {
          const hosted = await uploadServerAssetFile(file, label)
          const url = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
          if (url) {
            hostedUrl = url
            hostedAssetId = hosted.id
            successCount += 1
          }
        } catch (error) {
          console.error('Failed to upload image to OSS:', error)
        }

        let soraResult: any = null
        try {
          soraResult = await uploadSoraImage(undefined, file)
          if (soraResult?.file_id) {
            successCount += 1
          }
        } catch (error) {
          console.error('Failed to upload image to Sora:', error)
        }

        const soraUrlCandidate =
          typeof soraResult?.url === 'string'
            ? soraResult.url
            : typeof soraResult?.asset_pointer === 'string'
              ? soraResult.asset_pointer
              : typeof soraResult?.azure_asset_pointer === 'string'
                ? soraResult.azure_asset_pointer
                : ''
        const bestUrl = hostedUrl || soraUrlCandidate || localUrl

        updateNodeData(id, {
          imageUrl: bestUrl,
          serverAssetId: hostedAssetId,
          soraFileId: soraResult?.file_id,
          assetPointer: soraResult?.asset_pointer,
          reverseImageData: localDataUrl,
        })
        if (bestUrl !== localUrl) {
          URL.revokeObjectURL(localUrl)
        }
      } catch (error) {
        console.error('Failed to process pasted image:', error)
        toast('处理粘贴图片失败，请稍后再试', 'error')
      }
    }

    if (successCount > 0 && prepared.length > 1) {
      useRFStore.setState((s) => {
        const ids = new Set(prepared.map((p) => p.id))
        const ordered = prepared.map((p, idx) => ({
          id: p.id,
          position: {
            x: base.x + (idx % cols) * spacingX,
            y: base.y + Math.floor(idx / cols) * spacingY,
          },
        }))
        const posById = new Map(ordered.map((o) => [o.id, o.position] as const))
        const past = [...s.historyPast, snapshotGraph(s.nodes, s.edges)].slice(-50)
        return {
          nodes: s.nodes.map((n) => (ids.has(n.id) ? { ...n, position: posById.get(n.id)! } : n)),
          historyPast: past,
          historyFuture: [],
        }
      })
    }
  }, [getFallbackScreenPoint, langGraphChatOpen, rf, viewOnly])

  const importImageNodeFromDraggedFrame = useCallback(async (
    payload: { url?: string; remoteUrl?: string | null; time?: number },
    posFlow: { x: number; y: number },
  ) => {
    if (viewOnly) return
    if (langGraphChatOpen) return
    const remoteUrl = typeof payload?.remoteUrl === 'string' ? payload.remoteUrl.trim() : ''
    const srcUrl = typeof payload?.url === 'string' ? payload.url.trim() : ''
    const preferred = remoteUrl || srcUrl
    if (!preferred) return

    if (!preferred.startsWith('blob:')) {
      const nodeId = genTaskNodeId()
      useRFStore.setState((s) => {
        const time = typeof payload?.time === 'number' && Number.isFinite(payload.time) ? payload.time : null
        const label = time !== null ? `Frame ${time.toFixed(2)}s` : 'Frame'
        const node = {
          id: nodeId,
          type: 'taskNode' as const,
          position: posFlow,
          data: {
            label,
            kind: 'image',
            imageUrl: preferred,
            imageResults: [{ url: preferred }],
            imagePrimaryIndex: 0,
            nodeWidth: 120,
            nodeHeight: 210,
          },
          selected: false,
        }
        return { nodes: [...s.nodes, node], nextId: s.nextId + 1 }
      })
      if ((window as any).silentSaveProject) {
        (window as any).silentSaveProject()
      }
      return
    }

    let blob: Blob
    try {
      const res = await fetch(preferred)
      if (!res.ok) {
        toast('读取帧图片失败，请稍后重试', 'error')
        return
      }
      blob = await res.blob()
    } catch (error) {
      console.error('Failed to fetch dragged frame:', error)
      toast('读取帧图片失败，请稍后重试', 'error')
      return
    }

    const MAX_BYTES = 30 * 1024 * 1024
    const size = typeof (blob as any)?.size === 'number' ? (blob as any).size : 0
    if (size > MAX_BYTES) {
      toast('该帧图片超过 30MB，已取消导入', 'error')
      return
    }

    const time = typeof payload?.time === 'number' && Number.isFinite(payload.time) ? payload.time : null
    const ms = Math.max(0, Math.round((time ?? 0) * 1000))
    const mime = blob.type || 'image/png'
    const ext = mime.includes('jpeg') || mime.includes('jpg')
      ? 'jpg'
      : mime.includes('webp')
        ? 'webp'
        : 'png'
    const fileName = `frame-${ms || Date.now()}.${ext}`
    const label = time !== null ? `Frame ${time.toFixed(2)}s` : 'Frame'
    const file = new File([blob], fileName, { type: mime })

    const nodeId = genTaskNodeId()
    const localUrl = URL.createObjectURL(file)

    useRFStore.setState((s) => {
      const node = {
        id: nodeId,
        type: 'taskNode' as const,
        position: posFlow,
        data: {
          label,
          kind: 'image',
          imageUrl: localUrl,
          nodeWidth: 120,
          nodeHeight: 210,
        },
        selected: false,
      }
      return { nodes: [...s.nodes, node], nextId: s.nextId + 1 }
    })

    const { updateNodeData } = useRFStore.getState()
    let localDataUrl: string | undefined
    try {
      localDataUrl = await blobToDataUrl(file)
    } catch {
      localDataUrl = undefined
    }
    if (localDataUrl) {
      updateNodeData(nodeId, { reverseImageData: localDataUrl })
    }

    try {
      let hostedUrl: string | null = null
      let hostedAssetId: string | null = null
      try {
        const hosted = await uploadServerAssetFile(file, deriveLabelFromFileName(fileName))
        const url = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
        if (url) {
          hostedUrl = url
          hostedAssetId = hosted.id
        }
      } catch (error) {
        console.error('Failed to upload frame to OSS:', error)
      }

      let soraResult: any = null
      try {
        soraResult = await uploadSoraImage(undefined, file)
      } catch (error) {
        console.error('Failed to upload frame to Sora:', error)
        soraResult = null
      }

      const soraUrlCandidate =
        typeof soraResult?.url === 'string'
          ? soraResult.url
          : typeof soraResult?.asset_pointer === 'string'
            ? soraResult.asset_pointer
            : typeof soraResult?.azure_asset_pointer === 'string'
              ? soraResult.azure_asset_pointer
              : ''
      const bestUrl = hostedUrl || soraUrlCandidate || localUrl

      updateNodeData(nodeId, {
        imageUrl: bestUrl,
        serverAssetId: hostedAssetId,
        soraFileId: soraResult?.file_id,
        assetPointer: soraResult?.asset_pointer,
        reverseImageData: localDataUrl,
      })

      if (bestUrl !== localUrl) {
        URL.revokeObjectURL(localUrl)
      }
      if ((window as any).silentSaveProject) {
        (window as any).silentSaveProject()
      }
    } catch (error) {
      console.error('Failed to process dragged frame:', error)
      toast('处理帧图片失败，请稍后再试', 'error')
    }
  }, [deriveLabelFromFileName, langGraphChatOpen, viewOnly])

  const handleTaskProgress = useCallback((event: TaskProgressEventMessage) => {
    if (!event || !event.nodeId) return
    const { setNodeStatus, appendLog } = useRFStore.getState()
    const rawProgress = typeof event.progress === 'number' && Number.isFinite(event.progress)
      ? Math.max(0, Math.min(100, Math.round(event.progress)))
      : undefined
    if (event.message) {
      const label = new Date(event.timestamp ?? Date.now()).toLocaleTimeString()
      appendLog(event.nodeId, `[${label}] ${event.message}`)
    }
    const progressPatch = rawProgress !== undefined ? { progress: rawProgress } : {}
    switch (event.status) {
      case 'queued':
        setNodeStatus(event.nodeId, 'queued', progressPatch)
        break
      case 'running':
        setNodeStatus(event.nodeId, 'running', progressPatch)
        break
      case 'succeeded':
        setNodeStatus(event.nodeId, 'success', rawProgress !== undefined ? progressPatch : { progress: 100 })
        break
      case 'failed':
        setNodeStatus(event.nodeId, 'error', {
          ...progressPatch,
          lastError: event.message || '任务执行失败',
        })
        break
      default:
        break
    }
  }, [])

  useEffect(() => {
    if (!authToken) return
    const unsubscribe = subscribeTaskProgress({
      token: authToken,
      onEvent: handleTaskProgress,
      onError: (err) => console.error('task progress stream error', err),
    })
    return () => {
      unsubscribe()
    }
  }, [authToken, handleTaskProgress])

  useEffect(() => {
    if (!authToken) return
    if (viewOnly) return

    const tick = () => {
      const state = useRFStore.getState()
      const list = (state.nodes || []) as any[]
      for (const n of list) {
        const data: any = n?.data || {}
        const kind = String(data.kind || '')
        const status = String(data.status || '')
        if (status !== 'running' && status !== 'queued') continue

        const nodeId = String(n.id || '')
        if (!nodeId) continue

        if (kind === 'composeVideo' || kind === 'video' || kind === 'storyboard') {
          const vendorRaw = String(data.videoModelVendor || data.videoVendor || '')
          const vendor = vendorRaw.toLowerCase() === 'sora' ? 'sora2api' : vendorRaw.toLowerCase()
          const taskId = typeof data.videoTaskId === 'string' ? data.videoTaskId.trim() : ''
          if (!taskId) continue

          if (vendor === 'sora2api') {
            if (!taskId.startsWith('task_')) continue
            if (soraSyncingRef.current.has(nodeId)) continue
            soraSyncingRef.current.add(nodeId)
            void syncSora2ApiVideoNodeOnce(nodeId, useRFStore.getState).finally(() => {
              soraSyncingRef.current.delete(nodeId)
            })
            continue
          }

          if (vendor === 'minimax') {
            if (minimaxSyncingRef.current.has(nodeId)) continue
            minimaxSyncingRef.current.add(nodeId)
            void syncMiniMaxVideoNodeOnce(nodeId, useRFStore.getState).finally(() => {
              minimaxSyncingRef.current.delete(nodeId)
            })
          }
          continue
        }

        const imageTaskId = typeof data.imageTaskId === 'string' ? data.imageTaskId.trim() : ''
        if (imageTaskId) {
          if (grsaiImageSyncingRef.current.has(nodeId)) continue
          grsaiImageSyncingRef.current.add(nodeId)
          void syncGrsaiImageNodeOnce(nodeId, useRFStore.getState).finally(() => {
            grsaiImageSyncingRef.current.delete(nodeId)
          })
        }
      }
    }

    tick()
    const t = window.setInterval(tick, 4000)
    return () => window.clearInterval(t)
  }, [authToken, viewOnly])

  useEffect(() => {
    // initial: no local restore, rely on explicit load from server via UI
    setTimeout(() => rf.fitView?.({ padding: 0.2 }), 50)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    ;(window as any).__tcFocusNode = (nodeId: string) => {
      try {
        if (!nodeId) return
        // ensure node is visible
        useUIStore.getState().exitAllFocus()

        useRFStore.setState((s) => ({
          nodes: (s.nodes || []).map((n) => ({ ...n, selected: n.id === nodeId })),
        }))

        const node = useRFStore.getState().nodes.find((n) => n.id === nodeId)
        if (!node) return
        const x = (node.position?.x ?? 0) + 120
        const y = (node.position?.y ?? 0) + 70
        rf.setCenter?.(x, y, { zoom: Math.max((rf.getViewport?.().zoom ?? 1), 0.8), duration: 250 })
      } catch {
        // ignore
      }
    }
    return () => {
      try {
        if ((window as any).__tcFocusNode) delete (window as any).__tcFocusNode
      } catch {
        // ignore
      }
    }
  }, [rf])

  const applyDefaultZoom = useCallback(() => {
    const afterFit = rf.getViewport?.().zoom ?? 1
    const targetZoom = Math.max(Math.min(afterFit * DEFAULT_ZOOM_MULTIPLIER, MAX_ZOOM), MIN_ZOOM)
    rf.zoomTo?.(targetZoom, { duration: 0 })
    requestAnimationFrame(() => {
      const vp = rf.getViewport?.()
      if (vp) setCanvasViewport(vp)
    })
  }, [rf, setCanvasViewport])

  const onInit = useCallback(() => {
    if (!nodes.length) {
      requestAnimationFrame(() => {
        applyDefaultZoom()
      })
      return
    }
    rf.fitView?.({ padding: 0.2 })
    requestAnimationFrame(() => {
      applyDefaultZoom()
      initialFitAppliedRef.current = true
    })
  }, [applyDefaultZoom, nodes.length, rf])

  useEffect(() => {
    if (!restoreViewport) return
    rf.setViewport?.(restoreViewport, { duration: 0 })
    setCanvasViewport(restoreViewport)
    setRestoreViewport(null)
    restoreAppliedRef.current = true
    initialFitAppliedRef.current = true
  }, [restoreViewport, rf, setCanvasViewport, setRestoreViewport])

  // Backward-compat: some persisted canvases may include `dragHandle` on nodes, which restricts
  // dragging to a selector and can make nodes appear "undraggable". Strip it on mount.
  useEffect(() => {
    useRFStore.setState((s) => {
      const hasDragHandle = (s.nodes || []).some((n: any) => typeof n?.dragHandle !== 'undefined')
      if (!hasDragHandle) return {}
      const nodes = (s.nodes || []).map((n: any) => {
        if (!n || typeof n !== 'object') return n
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { dragHandle: _dragHandle, ...rest } = n
        return rest
      })
      return { nodes }
    })
  }, [])

  const onDragOver = useCallback((evt: React.DragEvent) => {
    evt.preventDefault()
    const types = Array.from(evt.dataTransfer.types || [])
    const hasFiles = types.includes('Files')
    const hasTapImage = types.includes('application/tap-image-url') || types.includes('application/tap-frame-sample')
    evt.dataTransfer.dropEffect = (hasFiles || hasTapImage) ? 'copy' : 'move'
  }, [])

  const onDrop = useCallback((evt: React.DragEvent) => {
    evt.preventDefault()
    // Dropping external files can end with a mouseup event inside the canvas.
    // If a stale "connecting" state exists (e.g. an interrupted connect gesture),
    // it may accidentally auto-snap to another node. Always cancel connecting on drop.
    setIsConnecting(false)
    setConnectingType(null)
    setTapConnectSource(null)
    connectFromRef.current = null
    didConnectRef.current = false
    lastReason.current = null
    const tplName = evt.dataTransfer.getData('application/tap-template')
    const rfdata = evt.dataTransfer.getData('application/reactflow')
    const flowRef = evt.dataTransfer.getData('application/tapflow')
    const tapImageUrl = evt.dataTransfer.getData('application/tap-image-url')
    const tapFrameSample = evt.dataTransfer.getData('application/tap-frame-sample')
    const pos = rf.screenToFlowPosition({ x: evt.clientX, y: evt.clientY })
    const imageFiles = Array.from(evt.dataTransfer.files || []).filter(isImageFile)
    if (imageFiles.length) {
      void importImagesFromFiles(imageFiles, pos)
      return
    }
    if (tapFrameSample) {
      try {
        const payload = JSON.parse(tapFrameSample) as { url?: string; remoteUrl?: string | null; time?: number }
        void importImageNodeFromDraggedFrame(payload, pos)
        return
      } catch {
        // fallthrough
      }
    }
    if (tapImageUrl) {
      let url = ''
      try {
        const parsed = JSON.parse(tapImageUrl) as any
        url = typeof parsed === 'string' ? parsed : (parsed?.url as string) || ''
      } catch {
        url = tapImageUrl
      }
      const trimmed = typeof url === 'string' ? url.trim() : ''
      if (trimmed) {
        if (trimmed.startsWith('blob:')) {
          void importImageNodeFromDraggedFrame({ url: trimmed, remoteUrl: null }, pos)
          return
        }
        useRFStore.setState((s) => {
          const id = `${uuid()}${s.nextId}`
          const node = {
            id,
            type: 'taskNode' as const,
            position: pos,
            data: {
              label: 'Image',
              kind: 'image',
              imageUrl: trimmed,
              imageResults: [{ url: trimmed }],
              imagePrimaryIndex: 0,
              nodeWidth: 120,
              nodeHeight: 210,
            },
          }
          return { nodes: [...s.nodes, node], nextId: s.nextId + 1 }
        })
        return
      }
    }
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
  }, [importImageNodeFromDraggedFrame, importImagesFromFiles, isImageFile, rf])

  const createsCycle = useCallback((proposed: { source?: string|null; target?: string|null }) => {
    const sId = proposed.source
    const tId = proposed.target
    if (!sId || !tId) return false
    // Align with runner: ignore dangling edges that reference non-existent nodes
    const nodeIds = new Set(nodes.map(n => n.id))
    if (!nodeIds.has(sId) || !nodeIds.has(tId)) return false

    // Build adjacency including proposed edge
    const adj = new Map<string, string[]>()
    nodes.forEach(n => adj.set(n.id, []))
    edges.forEach(e => {
      if (!e.source || !e.target) return
      if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) return
      adj.get(e.source)!.push(e.target)
    })
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

  type SnapTarget = {
    el: HTMLElement
    targetNodeId: string
    targetHandleId: string
    screen: { x: number; y: number }
    flow: { x: number; y: number }
    score: number
  }

  const suppressContextMenuRef = useRef(false)
  const rightDragRef = useRef<{ startX: number; startY: number } | null>(null)
  const snapTargetRef = useRef<SnapTarget | null>(null)
  const snapHandleElRef = useRef<HTMLElement | null>(null)
  const [snapTarget, setSnapTarget] = useState<SnapTarget | null>(null)

  const clearSnapTarget = useCallback(() => {
    const prev = snapHandleElRef.current
    if (prev) prev.classList.remove('tc-handle--snap')
    snapHandleElRef.current = null
    snapTargetRef.current = null
    setSnapTarget(null)
  }, [])

  const getHandleMeta = useCallback((handleEl: HTMLElement | null) => {
    if (!handleEl) return null
    const targetHandleId = handleEl.getAttribute('data-handleid') || handleEl.getAttribute('id') || undefined
    const targetNodeId =
      (handleEl.getAttribute('data-nodeid') || undefined) ||
      (handleEl.closest('.react-flow__node') as HTMLElement | null)?.getAttribute('data-id') ||
      undefined
    if (!targetHandleId || !targetNodeId) return null
    return { targetNodeId, targetHandleId }
  }, [])

  const isCompatibleTargetHandle = useCallback((meta: { targetNodeId: string; targetHandleId: string }, opts?: { silent?: boolean }) => {
    const from = connectFromRef.current
    if (!from) return false

    const sourceNodeId = from.nodeId
    if (sourceNodeId === meta.targetNodeId) return false
    if (edges.some(e => e.source === sourceNodeId && e.target === meta.targetNodeId)) return false
    if (createsCycle({ source: sourceNodeId, target: meta.targetNodeId })) return false

    const sNode = nodes.find(n => n.id === sourceNodeId)
    const tNode = nodes.find(n => n.id === meta.targetNodeId)
    if (!sNode || !tNode) return false

    const sKind = (sNode.data as any)?.kind
    const tKind = (tNode.data as any)?.kind
    if (!isValidEdgeByType(sKind, tKind)) return false
    if (isImageKind(sKind) && isImageKind(tKind)) {
      const targetModel = (tNode.data as any)?.imageModel as string | undefined
      if (!isImageEditModel(targetModel)) {
        if (!opts?.silent) {
          const reason = targetModel
            ? '该节点当前模型不支持图片编辑，请切换至支持图片编辑的模型（如 Nano Banana 系列）'
            : '请先为目标节点选择支持图片编辑的模型'
          lastReason.current = reason
          toast(reason, 'warning')
        }
        return false
      }
    }
    return true
  }, [createsCycle, edges, nodes])

  const handleConnect = useCallback((c: any) => {
    lastReason.current = null
    didConnectRef.current = true
    onConnect({ ...c, type: edgeRoute === 'orth' ? 'orth' : 'typed' })
  }, [edgeRoute, onConnect])

  const onConnectStart = useCallback((_evt: any, params: { nodeId?: string|null; handleId?: string|null; handleType?: 'source'|'target' }) => {
    didConnectRef.current = false
    if (tapConnectSource) {
      setTapConnectSource(null)
    }
    setIsConnecting(true)
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
      connectFromRef.current = { nodeId: params.nodeId, handleId: params.handleId || null }
    } else {
      connectFromRef.current = null
    }
  }, [tapConnectSource])

  const SNAP_DISTANCE = 96
  const NODE_SNAP_DISTANCE = 200
  const MIN_ZOOM = 0.02 // 允许比默认多缩小约 6 倍（默认 0.1）
  const MAX_ZOOM = 2 // 恢复更保守的放大上限
  const DEFAULT_ZOOM_MULTIPLIER = 0.5 // 默认视图相对 fitView 再缩小 4 倍

  const onConnectEnd = useCallback((evt: any) => {
    const from = connectFromRef.current
    const release =
      (evt && typeof evt.clientX === 'number' && typeof evt.clientY === 'number'
        ? { x: evt.clientX as number, y: evt.clientY as number }
        : null) ??
      lastPointerScreenRef.current ??
      { x: mouse.x, y: mouse.y }

    // Auto-snap to nearest compatible target handle / node
    const autoSnap = () => {
      if (!from) return false

      const tryConnectWithHandle = (handleEl: HTMLElement | null, opts?: { silent?: boolean }) => {
        if (!handleEl) return false
        // Wide handles are kept only for legacy edge anchoring; never use them for new connections.
        if (handleEl.classList.contains('tc-handle--wide')) return false
        const meta = getHandleMeta(handleEl)
        if (!meta) return false
        const sourceNodeId = from.nodeId
        const sourceHandleId = from.handleId || 'out-any'
        if (!isCompatibleTargetHandle(meta, opts)) return false

        handleConnect({
          source: sourceNodeId,
          sourceHandle: sourceHandleId,
          target: meta.targetNodeId,
          targetHandle: meta.targetHandleId,
        })
        return true
      }

      const pickHandleForNode = (nodeEl: HTMLElement | null) => {
        if (!nodeEl) return null
        const handlesInNode = Array.from(
          nodeEl.querySelectorAll('.tc-handle.react-flow__handle-target, .react-flow__handle-target'),
        ).filter((el) => !el.classList.contains('tc-handle--wide')) as HTMLElement[]
        if (!handlesInNode.length) return null
        if (!connectingType) return handlesInNode[0]
        const exact = handlesInNode.find(el => (el.getAttribute('data-handle-type') || '') === connectingType)
        if (exact) return exact
        const anyHandle = handlesInNode.find(el => {
          const type = el.getAttribute('data-handle-type')
          return !type || type === 'any'
        })
        return anyHandle || handlesInNode[0]
      }

      const tryConnectViaNode = (nodeEl: HTMLElement | null) => {
        if (!nodeEl) return false
        const handleEl = pickHandleForNode(nodeEl)
        if (!handleEl) return false
        return tryConnectWithHandle(handleEl)
      }

      const hoveredElement = document.elementFromPoint(release.x, release.y) as HTMLElement | null
      if (hoveredElement) {
        const hoveredHandle = hoveredElement.closest('.react-flow__handle-target') as HTMLElement | null
        if (tryConnectWithHandle(hoveredHandle)) return true
        const hoveredNode = hoveredElement.closest('.react-flow__node') as HTMLElement | null
        if (tryConnectViaNode(hoveredNode)) return true
      }

      // Prefer the live snap preview if we have one.
      if (snapTargetRef.current) {
        if (tryConnectWithHandle(snapTargetRef.current.el)) return true
      }

      const handles = Array.from(document.querySelectorAll('.react-flow__handle-target'))
        .filter((el) => !(el as HTMLElement).classList.contains('tc-handle--wide')) as HTMLElement[]
      if (!handles.length) return false

      const scored: { el: HTMLElement; dist: number }[] = []
      for (const el of handles) {
        const rect = el.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) continue
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        const dist = Math.hypot(cx - release.x, cy - release.y)
        scored.push({ el, dist })
      }
      scored.sort((a, b) => a.dist - b.dist)

      // Try near handles first; fall back to farther ones if needed (but stay compatible).
      for (const { el, dist } of scored) {
        if (dist > SNAP_DISTANCE) break
        if (tryConnectWithHandle(el, { silent: true })) return true
      }

      // If still not found, try snapping to the nearest node body
      {
        const nodeEls = Array.from(document.querySelectorAll('.react-flow__node')) as HTMLElement[]
        let bestNode: { el: HTMLElement; dist: number } | null = null
        for (const el of nodeEls) {
          const nodeId = el.getAttribute('data-id')
          if (!nodeId || nodeId === from.nodeId) continue
          const rect = el.getBoundingClientRect()
          const dx = Math.max(rect.left - release.x, 0, release.x - rect.right)
          const dy = Math.max(rect.top - release.y, 0, release.y - rect.bottom)
          const dist = Math.hypot(dx, dy)
          if (dist > NODE_SNAP_DISTANCE && !(release.x >= rect.left && release.x <= rect.right && release.y >= rect.top && release.y <= rect.bottom)) continue
          if (!bestNode || dist < bestNode.dist) bestNode = { el, dist }
        }
        if (bestNode) {
          if (tryConnectViaNode(bestNode.el)) {
            return true
          }
        }
      }
      return false
    }

    if (!didConnectRef.current && from) {
      const snapped = autoSnap()
      if (!snapped) {
        // 从 text 节点拖出并松手在空白处：打开插入菜单
        useInsertMenuStore.getState().openMenu({
          x: release.x,
          y: release.y,
          fromNodeId: from.nodeId,
          fromHandle: from.handleId || 'out-any',
        })
      }
    }
    setConnectingType(null)
    setIsConnecting(false)
    lastReason.current = null
    connectFromRef.current = null
    didConnectRef.current = false
    clearSnapTarget()
  }, [clearSnapTarget, connectingType, getHandleMeta, handleConnect, isCompatibleTargetHandle, mouse.x, mouse.y])

  // removed pane mouse handlers (not supported by current reactflow typings). Root listeners are used instead.

  const onPaneContextMenu = useCallback((evt: React.MouseEvent) => {
    evt.preventDefault()
    if (suppressContextMenuRef.current) {
      suppressContextMenuRef.current = false
      return
    }
    setMenu({ show: true, x: evt.clientX, y: evt.clientY, type: 'canvas' })
  }, [])

  const onPaneClick = useCallback(() => {
    setTapConnectSource(null)
    setConnectingType(null)
  }, [])

  const onNodeContextMenu = useCallback((evt: React.MouseEvent, node: any) => {
    evt.preventDefault()
    if (suppressContextMenuRef.current) {
      suppressContextMenuRef.current = false
      return
    }
    setMenu({ show: true, x: evt.clientX, y: evt.clientY, type: 'node', id: node.id })
  }, [])

  const onEdgeContextMenu = useCallback((evt: React.MouseEvent, edge: any) => {
    evt.preventDefault()
    if (suppressContextMenuRef.current) {
      suppressContextMenuRef.current = false
      return
    }
    setMenu({ show: true, x: evt.clientX, y: evt.clientY, type: 'edge', id: edge.id })
  }, [])

  const screenToFlow = useCallback((p: { x: number; y: number }) => rf.screenToFlowPosition ? rf.screenToFlowPosition(p) : p, [rf])

  const insertMenuRef = useRef<HTMLDivElement | null>(null)

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
    const prev = lastGuidesRef.current
    if (prev?.vx !== vx || prev?.hy !== hy) {
      const next = { vx, hy }
      lastGuidesRef.current = next
      setGuides(next)
    }

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
    lastGuidesRef.current = null
    setGuides(null)
    setDragging(false)
  }, [])

  // Note: group size auto-fits on node changes in the store to keep bounds synced with children.

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

  const computeBestSnapTarget = useCallback((client: { x: number; y: number }): SnapTarget | null => {
    const from = connectFromRef.current
    if (!from) return null

    const targetHandles = Array.from(document.querySelectorAll('.react-flow__handle-target'))
      .filter((el) => !(el as HTMLElement).classList.contains('tc-handle--wide')) as HTMLElement[]
    if (!targetHandles.length) return null

    const candidates: SnapTarget[] = []
    for (const el of targetHandles) {
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      const meta = getHandleMeta(el)
      if (!meta) continue
      if (meta.targetNodeId === from.nodeId) continue
      if (!isCompatibleTargetHandle(meta, { silent: true })) continue

      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const dist = Math.hypot(cx - client.x, cy - client.y)

      const handleType = (el.getAttribute('data-handle-type') || '').toLowerCase()
      const want = (connectingType || '').toLowerCase()
      const typePenalty = !want || handleType === want || handleType === 'any' || handleType === '' ? 0 : 120

      candidates.push({
        el,
        targetNodeId: meta.targetNodeId,
        targetHandleId: meta.targetHandleId,
        screen: { x: cx, y: cy },
        flow: screenToFlow({ x: cx, y: cy }),
        score: dist + typePenalty,
      })
    }

    if (!candidates.length) return null
    candidates.sort((a, b) => a.score - b.score)
    return candidates[0]
  }, [connectingType, getHandleMeta, isCompatibleTargetHandle, screenToFlow])

  useEffect(() => {
    const hasNode = (id?: string | null) => !!id && nodes.some(n => n.id === id)
    if (tapConnectSource && !hasNode(tapConnectSource.nodeId)) {
      setTapConnectSource(null)
      setConnectingType(null)
    }
    if (connectFromRef.current && !hasNode(connectFromRef.current.nodeId)) {
      connectFromRef.current = null
      setConnectingType(null)
      setIsConnecting(false)
      clearSnapTarget()
    }
  }, [clearSnapTarget, nodes, tapConnectSource])

  // While connecting, preview magnetic snap to the nearest compatible target handle.
  useEffect(() => {
    if (!isConnecting) {
      clearSnapTarget()
      return
    }
    if (!connectFromRef.current) return

    let raf = 0
    raf = window.requestAnimationFrame(() => {
      const best = computeBestSnapTarget({ x: mouse.x, y: mouse.y })
      if (!best) {
        clearSnapTarget()
        return
      }

      // Only snap when close enough; otherwise keep visuals clean.
      const SNAP_PREVIEW_RADIUS = 96
      const dist = Math.hypot(best.screen.x - mouse.x, best.screen.y - mouse.y)
      if (dist > SNAP_PREVIEW_RADIUS) {
        clearSnapTarget()
        return
      }

      snapTargetRef.current = best
      setSnapTarget(best)

      const prev = snapHandleElRef.current
      if (prev && prev !== best.el) prev.classList.remove('tc-handle--snap')
      best.el.classList.add('tc-handle--snap')
      snapHandleElRef.current = best.el
    })

    return () => {
      window.cancelAnimationFrame(raf)
    }
  }, [clearSnapTarget, computeBestSnapTarget, isConnecting, mouse.x, mouse.y])

  const MagneticConnectionLine = useCallback((props: ConnectionLineComponentProps) => {
    const tx = snapTarget?.flow?.x ?? props.toX
    const ty = snapTarget?.flow?.y ?? props.toY
    const [path] = getBezierPath({
      sourceX: props.fromX,
      sourceY: props.fromY,
      sourcePosition: props.fromPosition,
      targetX: tx,
      targetY: ty,
      targetPosition: props.toPosition,
      curvature: 0.35,
    })
    return (
      <g className="tc-connection-line">
        <path className="tc-connection-line__path" d={path} style={props.connectionLineStyle} fill="none" />
        {snapTarget && (
          <circle
            className="tc-connection-line__snap-dot"
            cx={tx}
            cy={ty}
            r={4}
            fill={String((props.connectionLineStyle as any)?.stroke || '#93c5fd')}
            opacity={0.9}
          />
        )}
      </g>
    )
  }, [snapTarget])

  const pickDefaultSourceHandle = useCallback((kind?: string | null) => {
    if (!kind) return 'out-any'
    const k = kind.toLowerCase()
    if (k === 'image' || k === 'texttoimage' || k === 'storyboardimage' || k === 'imagefission' || k === 'mosaic') return 'out-image'
    if (k === 'composevideo' || k === 'video' || k === 'storyboard') return 'out-video'
    if (k === 'tts' || k === 'audio') return 'out-audio'
    if (k === 'subtitlealign' || k === 'subtitle') return 'out-subtitle'
    if (k === 'character') return 'out-character'
    return 'out-any'
  }, [])

  const pickDefaultTargetHandle = useCallback((targetKind?: string | null, sourceKind?: string | null) => {
    const tk = (targetKind || '').toLowerCase()
    const sk = (sourceKind || '').toLowerCase()
    if (tk === 'composevideo' || tk === 'video' || tk === 'storyboard') {
      if (sk === 'image' || sk === 'texttoimage') return 'in-image'
      if (sk === 'character') return 'in-character'
      if (sk === 'tts' || sk === 'audio') return 'in-audio'
      if (sk === 'subtitlealign' || sk === 'subtitle') return 'in-subtitle'
      return 'in-video'
    }
    if (tk === 'image' || tk === 'texttoimage' || tk === 'storyboardimage' || tk === 'imagefission' || tk === 'mosaic') return 'in-image'
    if (tk === 'tts' || tk === 'audio') return 'in-audio'
    if (tk === 'subtitlealign' || tk === 'subtitle') return 'in-subtitle'
    if (tk === 'character') return 'in-character'
    return 'in-any'
  }, [])

  const quickConnectNodes = useCallback((sourceId: string, targetId: string, opts?: { showInvalidToast?: boolean }) => {
    const showInvalidToast = opts?.showInvalidToast !== false
    if (sourceId === targetId) {
      if (showInvalidToast) toast('不能连接到自身', 'warning')
      return false
    }
    const sourceNode = nodes.find(n => n.id === sourceId)
    const targetNode = nodes.find(n => n.id === targetId)
    if (!sourceNode || !targetNode) {
      setTapConnectSource(null)
      setConnectingType(null)
      return false
    }
    if (edges.some(e => e.source === sourceId && e.target === targetId)) {
      if (showInvalidToast) toast('节点之间已存在连接', 'info')
      return false
    }
    if (createsCycle({ source: sourceId, target: targetId })) {
      return false
    }
    const sKind = (sourceNode.data as any)?.kind
    const tKind = (targetNode.data as any)?.kind
    if (!isValidEdgeByType(sKind, tKind)) {
      if (showInvalidToast) toast('当前两种节点类型不支持直连', 'warning')
      return false
    }
    if (isImageKind(sKind) && isImageKind(tKind)) {
      const targetModel = (targetNode.data as any)?.imageModel as string | undefined
      if (!isImageEditModel(targetModel)) {
        const reason = targetModel
          ? '目标节点的模型不支持图片编辑，请切换至支持的模型后再连线'
          : '请先为目标节点选择支持图片编辑的模型'
        if (showInvalidToast) toast(reason, 'warning')
        return false
      }
    }

    handleConnect({
      source: sourceId,
      sourceHandle: pickDefaultSourceHandle(sKind),
      target: targetId,
      targetHandle: pickDefaultTargetHandle(tKind, sKind),
    })
    return true
  }, [createsCycle, edges, handleConnect, nodes, pickDefaultSourceHandle, pickDefaultTargetHandle])

  const onNodeClick = useCallback((evt: React.MouseEvent, node: any) => {
    if (!node?.id) return
    // “点击节点两步连线”容易误触（尤其在刚创建新节点后点击查看参数时）。
    // 仅在按住 Alt/Option 时启用该模式；普通点击将视为取消待连线状态。
    if (!evt.altKey) {
      if (tapConnectSource) {
        setTapConnectSource(null)
        setConnectingType(null)
      }
      return
    }
    const pending = tapConnectSource
    if (pending?.nodeId === node.id) {
      setTapConnectSource(null)
      setConnectingType(null)
      return
    }
    if (pending && pending.nodeId !== node.id) {
      quickConnectNodes(pending.nodeId, node.id, { showInvalidToast: false })
      setTapConnectSource(null)
      setConnectingType(null)
      return
    }
    const kind = String(node?.data?.kind || '').toLowerCase()
    const derivedType =
      kind === 'image' || kind === 'texttoimage' ? 'image'
      : kind === 'composevideo' || kind === 'video' || kind === 'storyboard' ? 'video'
      : kind === 'tts' || kind === 'audio' ? 'audio'
      : kind === 'subtitlealign' || kind === 'subtitle' ? 'subtitle'
      : kind === 'character' ? 'character'
      : null
    setTapConnectSource({ nodeId: node.id })
    setConnectingType(derivedType)
  }, [quickConnectNodes, tapConnectSource])
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
  const normalizeKindForRect = (kind: unknown) => String(kind || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const parseNumericStyle = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string') {
      const n = Number.parseFloat(v)
      if (Number.isFinite(n)) return n
    }
    return undefined
  }
  const getNodeRectSize = (n: any) => {
    const kind = normalizeKindForRect(n?.data?.kind)
    const measuredW =
      (typeof n?.measured?.width === 'number' && Number.isFinite(n.measured.width) && n.measured.width > 0 ? n.measured.width : undefined) ??
      (typeof n?.width === 'number' && Number.isFinite(n.width) && n.width > 0 ? n.width : undefined)
    const measuredH =
      (typeof n?.measured?.height === 'number' && Number.isFinite(n.measured.height) && n.measured.height > 0 ? n.measured.height : undefined) ??
      (typeof n?.height === 'number' && Number.isFinite(n.height) && n.height > 0 ? n.height : undefined)
    const w =
      measuredW ??
      parseNumericStyle(n?.style?.width) ??
      parseNumericStyle(n?.data?.nodeWidth) ??
      defaultW
    const h =
      measuredH ??
      parseNumericStyle(n?.style?.height) ??
      parseNumericStyle(n?.data?.nodeHeight) ??
      defaultH
    return { w, h }
  }
  const nodeByIdForRect = useMemo(() => new Map(nodes.map(n => [n.id, n] as const)), [nodes])
  const getNodeAbsPos = useCallback((n: any): { x: number; y: number } => {
    const visiting = new Set<string>()
    const resolve = (node: any): { x: number; y: number } => {
      const id = String(node?.id || '')
      if (id) {
        if (visiting.has(id)) return { x: node?.position?.x || 0, y: node?.position?.y || 0 }
        visiting.add(id)
      }
      const base = { x: node?.position?.x || 0, y: node?.position?.y || 0 }
      const parentId = node?.parentNode as string | undefined
      if (!parentId) return base
      const parent = nodeByIdForRect.get(parentId)
      if (!parent) return base
      const p = resolve(parent as any)
      return { x: p.x + base.x, y: p.y + base.y }
    }
    return resolve(n)
  }, [nodeByIdForRect])
  // selection rect in FLOW coordinates
  let groupRectFlow: { x: number; y: number; w: number; h: number } | null = null
  if (showPreGroupOverlay) {
    const abs = selectedNodes.map(n => {
      const p = getNodeAbsPos(n as any)
      const s = getNodeRectSize(n as any)
      return { x: p.x, y: p.y, w: s.w, h: s.h }
    })
    const minX = Math.min(...abs.map(n => n.x))
    const minY = Math.min(...abs.map(n => n.y))
    const maxX = Math.max(...abs.map(n => n.x + n.w))
    const maxY = Math.max(...abs.map(n => n.y + n.h))
    const padding = 8
    groupRectFlow = { x: minX - padding, y: minY - padding, w: (maxX - minX) + padding*2, h: (maxY - minY) + padding*2 }
  }

  // remove legacy persistent outlines: group is now a node (compound parent)
  const groupOutlines: any[] = []

  // selection partially overlaps existing groups?
  const selectionPartialOverlaps = useMemo(() => {
    // 允许跨组打组：选中的节点会从原组中移出并进入新组
    return false
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
    const routed = base.map((e: any) => {
      const t = e.type
      if (t === 'typed' || t === 'orth') return e
      return { ...e, type: edgeRoute === 'orth' ? 'orth' : 'typed' }
    })
    const withHitbox = (e: any) => ({ ...e, interactionWidth: e.interactionWidth ?? 40 })
    if (selectedIds.size === 0) return routed.map(withHitbox)
    return routed.map((e: any) => {
      const active = selectedIds.has(e.source) || selectedIds.has(e.target)
      const styled = active
        ? { ...e, style: { ...(e.style || {}), stroke: '#e5e7eb', opacity: 1 } }
        : { ...e, style: { ...(e.style || {}), opacity: 0.5 } }
      return withHitbox(styled)
    })
  }, [edgeRoute, focusFiltered.edges, selectedIds])

  // 使用多选拖拽（内置），不自定义组拖拽，避免与画布交互冲突

  // 旧的宫格/水平布局已合并为“格式化”（树形，自上而下，32px 间距）

  const parseHandleTypeFromId = (handleId?: string | null): string => {
    const raw = String(handleId || '')
    if (raw.startsWith('out-')) return raw.slice(4).split('-')[0] || 'any'
    if (raw.startsWith('in-')) return raw.slice(3).split('-')[0] || 'any'
    return 'any'
  }

  const handleInsertNodeAt = (
    targetKind: string,
    menuState: { x: number; y: number; fromNodeId?: string; fromHandle?: string | null },
  ) => {
    const posFlow = screenToFlow({ x: menuState.x, y: menuState.y })
    const upstreamNode = menuState.fromNodeId
      ? useRFStore.getState().nodes.find(n => n.id === menuState.fromNodeId)
      : undefined
    const upstreamPrompt = upstreamNode ? ((upstreamNode.data as any)?.prompt as string | undefined) : undefined
    const sourceKind = upstreamNode ? ((upstreamNode.data as any)?.kind as string | undefined) : undefined

    useRFStore.setState(s => {
      const before = s.nextId
      const id = `${uuid()}${before}`
      const schema = getTaskNodeSchema(targetKind)
      const label = schema.label || schema.kind || 'Node'
      const data: any = { label, kind: schema.kind }
      if (upstreamPrompt && schema.features?.includes('prompt')) data.prompt = upstreamPrompt

      const node = { id, type: 'taskNode' as const, position: posFlow, data }

      let edgesNext = s.edges
      if (menuState.fromNodeId) {
        const fromHandle = menuState.fromHandle || pickDefaultSourceHandle(sourceKind)
        const edgeId = `e-${menuState.fromNodeId}-${id}-${Date.now().toString(36)}`
        const edge: any = {
          id: edgeId,
          source: menuState.fromNodeId,
          target: id,
          sourceHandle: fromHandle,
          targetHandle: pickDefaultTargetHandle(schema.kind, sourceKind),
          type: (edgeRoute === 'orth' ? 'orth' : 'typed') as any,
          animated: false,
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

          const currentZoom = rf.getViewport?.().zoom ?? 1
          rf.setCenter?.(nodeCenterX, nodeCenterY, { zoom: currentZoom, duration: 300 })
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
          const z = rf.getViewport?.().zoom ?? 1
          rf.setCenter?.(worldX, worldY, { zoom: z, duration: 200 })
        }
      }
    }

    minimapClickRef.current = null
    e.stopPropagation()
    e.preventDefault()
  }, [nodes, rf, findNearestNode])

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

  // Right-button drag: use as pan gesture and suppress context menu when dragging.
  useEffect(() => {
    const threshold = 6
    const onMove = (ev: MouseEvent) => {
      if (!rightDragRef.current) return
      const dx = ev.clientX - rightDragRef.current.startX
      const dy = ev.clientY - rightDragRef.current.startY
      if (Math.hypot(dx, dy) >= threshold) {
        suppressContextMenuRef.current = true
      }
    }
    const onUp = () => {
      rightDragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
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
      const z = rf.getViewport?.().zoom ?? 1
      rf.setCenter?.(worldX, worldY, { zoom: z, duration: 0 })
    }
    const onUp = () => { minimapDragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [nodes, rf])

  // Share/view-only: format the whole graph once after initial load, and avoid selection side effects.
  useEffect(() => {
    if (!viewOnly) {
      viewOnlyFormattedOnceRef.current = false
      return
    }
    if (viewOnlyFormattedOnceRef.current) return
    if (restoreAppliedRef.current) return
    if (!nodes.length) return
    viewOnlyFormattedOnceRef.current = true
    useRFStore.getState().autoLayoutAllDagVertical()
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        rf.fitView?.({ padding: 0.2, duration: 250 })
      })
    })
  }, [nodes.length, rf, viewOnly])

  useEffect(() => {
    if (!viewOnly) return
    const anySelected = nodes.some((n: any) => !!n?.selected) || edges.some((e: any) => !!e?.selected)
    if (!anySelected) return
    useRFStore.setState((s) => ({
      nodes: s.nodes.map((n: any) => (n?.selected ? { ...n, selected: false } : n)),
      edges: s.edges.map((e: any) => (e?.selected ? { ...e, selected: false } : e)),
    }))
  }, [edges, nodes, viewOnly])

  // 当研究助手打开时，对当前画布做一次垂直树形布局并聚焦最新节点
  useEffect(() => {
    if (viewOnly) return
    if (!langGraphChatOpen) return
    const { autoLayoutAllDagVertical } = useRFStore.getState()
    autoLayoutAllDagVertical()
    requestAnimationFrame(() => {
      const { nodes: updatedNodes } = useRFStore.getState()
      const latest = [...updatedNodes].slice(-1)[0]
      if (!latest) return
      const nodeW = ((latest as any).width) || ((latest as any).style?.width) || 220
      const nodeH = ((latest as any).height) || ((latest as any).style?.height) || 120
      const centerX = latest.position.x + nodeW / 2
      const centerY = latest.position.y + nodeH / 2
      useRFStore.setState(s => ({
        nodes: s.nodes.map(n => ({ ...n, selected: n.id === latest.id })),
      }))
      const z = rf.getViewport?.().zoom || 1
      rf.setCenter?.(centerX, centerY, { zoom: z, duration: 300 })
    })
  }, [langGraphChatOpen, rf, viewOnly])

  useEffect(() => {
    if (viewOnly) return
    if (initialFitAppliedRef.current) return
    if (!nodes.length) return
    rf.fitView?.({ padding: 0.2 })
    requestAnimationFrame(() => {
      applyDefaultZoom()
      initialFitAppliedRef.current = true
    })
  }, [applyDefaultZoom, nodes.length, rf, viewOnly])

  useEffect(() => {
    if (!insertMenu.open) return
    const onDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null
      if (!target) return
      if (insertMenuRef.current && insertMenuRef.current.contains(target)) return
      closeInsertMenu()
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [closeInsertMenu, insertMenu.open])


  return (
    <div className={joinClassNames('tc-canvas', className)}
      style={{ height: '100%', width: '100%', position: 'relative' }}
      data-connecting={connectingType || ''}
      data-connecting-active={(isConnecting || !!tapConnectSource) ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-tour="canvas"
      ref={rootRef}
      onMouseMove={(e) => {
        lastPointerScreenRef.current = { x: e.clientX, y: e.clientY }
        if (isConnecting) setMouse({ x: e.clientX, y: e.clientY })
      }}
      onDrop={viewOnly ? undefined : onDrop}
      onDragOver={viewOnly ? undefined : onDragOver}
      onClick={viewOnly ? undefined : handleRootClick}
      onMouseDown={viewOnly ? undefined : (e) => {
        if (e.button === 2) {
          rightDragRef.current = { startX: e.clientX, startY: e.clientY }
        }
        handleRootMouseDown(e)
      }}
      onDoubleClick={(e) => {
        if (viewOnly) return
        // double-click blank to go up one level in focus mode
        const target = e.target as HTMLElement
        if (!target.closest('.react-flow__node') && focusGroupId) {
          exitGroupFocus()
          setTimeout(() => rf.fitView?.({ padding: 0.2 }), 50)
        }
      }}
      onKeyDown={(e) => {
        if (viewOnly) return
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
      onPaste={(e) => {
        if (viewOnly || langGraphChatOpen) return
        const isTextInputElement = (target: EventTarget | null) => {
          if (!(target instanceof HTMLElement)) return false
          const tagName = target.tagName
          if (tagName === 'INPUT' || tagName === 'TEXTAREA') return true
          if (target.getAttribute('contenteditable') === 'true') return true
          if (target.closest('input') || target.closest('textarea')) return true
          if (target.closest('[contenteditable="true"]')) return true
          return false
        }
        if (isTextInputElement(e.target) || isTextInputElement(document.activeElement)) return
        const filesFromClipboard: File[] = []
        const items = Array.from(e.clipboardData?.items || [])
        for (const item of items) {
          if (item.kind !== 'file') continue
          const f = item.getAsFile()
          if (f && isImageFile(f)) filesFromClipboard.push(f)
        }
        const pos = rf.screenToFlowPosition(lastPointerScreenRef.current ?? getFallbackScreenPoint())
        let handled = false
        if (filesFromClipboard.length) {
          e.preventDefault()
          e.stopPropagation()
          ;(window as any).__tcLastImagePasteAt = Date.now()
          void importImagesFromFiles(filesFromClipboard, pos)
          toast(`已导入 ${filesFromClipboard.length} 张图片`, 'success')
          handled = true
        }
        const text = e.clipboardData?.getData('text/plain')?.trim()
        if (text) {
          try {
            const data = JSON.parse(text)
            if (data?.nodes && Array.isArray(data.nodes) && data?.edges && Array.isArray(data.edges)) {
              e.preventDefault()
              e.stopPropagation()
              ;(window as any).__tcLastWorkflowPasteAt = Date.now()
              importWorkflow(data, pos)
              toast('已导入工作流', 'success')
              handled = true
            }
          } catch {
            if (!handled && (text.startsWith('{') || text.startsWith('['))) {
              toast('剪贴板不是有效的工作流 JSON', 'error')
            }
          }
        }
        if (!handled) return
      }}
    >
      <input className="tc-canvas__image-input"
        ref={imageUploadInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const picked = Array.from(e.currentTarget.files || [])
          e.currentTarget.value = ''
          if (!picked.length) return
          const screen = pendingImageUploadScreenRef.current
          pendingImageUploadScreenRef.current = null
          const pos = screen ? screenToFlow({ x: screen.x, y: screen.y }) : undefined
          void importImagesFromFiles(picked, pos)
        }}
      />
      <ReactFlow className="tc-canvas__flow"
        nodes={focusFiltered.nodes}
        edges={viewEdges}
        onNodesChange={viewOnly ? undefined : handleNodesChange}
        onEdgesChange={viewOnly ? undefined : onEdgesChange}
        onConnect={viewOnly ? undefined : handleConnect}
        onEdgeMouseEnter={viewOnly ? undefined : (_evt, edge) => useUIStore.getState().hoverEdge(edge.id)}
        onEdgeMouseLeave={viewOnly ? undefined : () => useUIStore.getState().unhoverEdgeSoon()}
        onConnectStart={viewOnly ? undefined : onConnectStart}
        onConnectEnd={viewOnly ? undefined : onConnectEnd}
        onNodeDragStart={viewOnly ? undefined : onNodeDragStart}
        onPaneContextMenu={viewOnly ? undefined : onPaneContextMenu}
        onPaneClick={viewOnly ? undefined : onPaneClick}
        onNodeContextMenu={viewOnly ? undefined : onNodeContextMenu}
        onEdgeContextMenu={viewOnly ? undefined : onEdgeContextMenu}
        onNodeDrag={viewOnly ? undefined : onNodeDrag}
        onNodeDragStop={viewOnly ? undefined : onNodeDragStop}
        onNodeClick={viewOnly ? undefined : onNodeClick}
        onNodeDoubleClick={(_evt, node) => {
          if (viewOnly) return
          if (node?.type === 'groupNode') {
            useUIStore.getState().enterGroupFocus(node.id)
            setTimeout(() => rf.fitView?.({ padding: 0.2 }), 50)
          }
        }}
        onMoveEnd={(_evt, vp) => {
          setCanvasViewport(vp)
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={onInit}
        selectionOnDrag={!viewOnly}
        // Edit mode: middle-button and right-button drag pan the canvas; left drag keeps selection box.
        panOnDrag={viewOnly ? true : ([1, 2] as any)}
        panOnScroll
        zoomOnPinch
        zoomOnScroll
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        nodesDraggable={!viewOnly}
        nodesConnectable={!viewOnly}
        elementsSelectable={!viewOnly}
        proOptions={{ hideAttribution: true }}
        isValidConnection={(c) => {
          if (viewOnly) return false
          if (!c.source || !c.target) return false
          if (c.source === c.target) return false
          if (createsCycle({ source: c.source, target: c.target })) { lastReason.current = $('连接会导致环'); return false }
          const dup = edges.some(e => e.source === c.source && e.target === c.target)
          if (dup) { lastReason.current = $('重复连接'); return false }
          // 不做 feature/类型校验，仅阻止自连、重复和环路
          lastReason.current = null
          return true
        }}
        snapToGrid
        snapGrid={[16, 16]}
        connectionRadius={28}
        defaultEdgeOptions={{
          animated: false,
          type: (edgeRoute === 'orth' ? 'orth' : 'typed') as any,
          style: { strokeWidth: 2, strokeLinecap: 'round' },
          interactionWidth: 1,
        }}
        connectionLineComponent={MagneticConnectionLine}
        connectionLineType={ConnectionLineType.SimpleBezier}
        connectionLineStyle={connectionLineStyle}
      >
        <MiniMap className="tc-canvas__minimap" style={{ width: 160, height: 110 }} />
        <Controls className="tc-canvas__controls" position="bottom-left" />
        <Background className="tc-canvas__background" gap={16} size={1} color={backgroundGridColor} />
      </ReactFlow>
      {/* Focus mode breadcrumb with hierarchy */}
      {!viewOnly && focusGroupId && (
        <Paper className="tc-canvas__breadcrumb" withBorder shadow="sm" radius="xl" p={6} style={{ position: 'absolute', left: 12, top: 12 }}>
          <Group className="tc-canvas__breadcrumb-group" gap={8} style={{ flexWrap: 'nowrap' }}>
            {focusStack.map((gid, idx) => {
              const n = nodes.find(nn => nn.id === gid)
              const label = (n?.data as any)?.label || $('组')
              const isLast = idx === focusStack.length - 1
              return (
                <Group className="tc-canvas__breadcrumb-item" key={gid} gap={6} style={{ flexWrap: 'nowrap' }}>
                  <Button className="tc-canvas__breadcrumb-button" size="xs" variant={isLast ? 'filled' : 'subtle'} onClick={() => {
                    useUIStore.setState(s => ({ focusStack: s.focusStack.slice(0, idx + 1) }))
                    setTimeout(()=> rf.fitView?.({ padding: 0.2 }), 50)
                  }}>{label}</Button>
                  {!isLast && <Text className="tc-canvas__breadcrumb-sep" size="sm" c="dimmed">/</Text>}
                </Group>
              )
            })}
            <Divider className="tc-canvas__breadcrumb-divider" orientation="vertical" style={{ height: 16 }} />
            <Button className="tc-canvas__breadcrumb-action" size="xs" variant="subtle" onClick={()=>{ exitGroupFocus(); setTimeout(()=> rf.fitView?.({ padding: 0.2 }), 50) }}>上一级</Button>
            <Button className="tc-canvas__breadcrumb-action" size="xs" variant="subtle" onClick={()=>{ exitAllFocus(); setTimeout(()=> rf.fitView?.({ padding: 0.2 }), 50) }}>退出聚焦</Button>
          </Group>
        </Paper>
      )}
      {/* Empty canvas guide */}
      {!viewOnly && nodes.length === 0 && (
        <div className="tc-canvas__empty-guide" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <Paper className="tc-canvas__empty-guide-card" withBorder shadow="md" p="md" style={{ pointerEvents: 'auto', background: emptyGuideBackground, color: emptyGuideTextColor }}>
            <Stack className="tc-canvas__empty-guide-stack" gap={8} style={{ color: emptyGuideTextColor }}>
              <Text className="tc-canvas__empty-guide-title" c="dimmed" style={{ color: emptyGuideTextColor, opacity: 0.7 }}>{$('快速开始')}</Text>
              <Group className="tc-canvas__empty-guide-actions" gap={8} style={{ flexWrap: 'nowrap' }}>
                <Button
                  className="tc-canvas__empty-guide-button"
                  size="sm"
                  variant="light"
                  onClick={() => {
                    const sample = getQuickStartSampleFlow()
                    load(sample)
                    setTimeout(() => rf.fitView?.({ padding: 0.2 }), 50)
                  }}
                >
                  {$('创建示例工作流')}
                </Button>
                <Button
                  className="tc-canvas__empty-guide-button"
                  size="sm"
                  variant="subtle"
                  onClick={() => window.open('https://jpcpk71wr7.feishu.cn/wiki/WPDAw408jiQlOxki5seccaLdn9b', '_blank', 'noopener')}
                >
                  {$('了解更多')}
                </Button>
              </Group>
              <Text className="tc-canvas__empty-guide-tip" size="xs" c="dimmed" style={{ color: emptyGuideTextColor, opacity: 0.8 }}>提示：框选多个节点后按 ⌘/Ctrl+G 打组，⌘/Ctrl+Enter 一键运行。</Text>
            </Stack>
          </Paper>
        </div>
      )}
      {((!viewOnly && !!groupRectFlow) || guides?.vx !== undefined || guides?.hy !== undefined) && (
        <CanvasViewportOverlays
          viewOnly={viewOnly}
          groupRectFlow={groupRectFlow}
          selectionBorderColor={selectionBorderColor}
          guides={guides}
          selectionPartialOverlaps={selectionPartialOverlaps}
          nodes={nodes}
          edges={edges}
          onFormatTree={formatTree}
        />
      )}
      {menu?.show && (
        <Paper className="tc-canvas__context-menu" withBorder shadow="md" onMouseLeave={() => setMenu(null)} style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 60, minWidth: 200 }}>
          <Stack className="tc-canvas__context-menu-stack" gap={4} p="xs">
            {menu.type === 'canvas' && (
              <>
                <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { pasteFromClipboardAt(screenToFlow({ x: menu.x, y: menu.y })); setMenu(null) }}>在此粘贴</Button>
                <Button
                  className="tc-canvas__context-menu-action"
                  variant="subtle"
                  onClick={() => {
                    pendingImageUploadScreenRef.current = { x: menu.x, y: menu.y }
                    imageUploadInputRef.current?.click()
                    setMenu(null)
                  }}
                >
                  上传图片（可多选）
                </Button>
                <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => {
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
                        const pos = screenToFlow({ x: menu.x, y: menu.y })
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
                <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { formatTree(); setMenu(null) }}>{$('格式化')}</Button>
                <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { useUIStore.getState().toggleEdgeRoute(); setMenu(null) }}>切换边线（当前：{edgeRoute==='orth'?'正交':'平滑'}）</Button>
                {focusGroupId && <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { exitGroupFocus(); setMenu(null); setTimeout(()=> rf.fitView?.({ padding: 0.2 }), 50) }}>上一级</Button>}
                {focusGroupId && <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { useUIStore.getState().exitAllFocus(); setMenu(null); setTimeout(()=> rf.fitView?.({ padding: 0.2 }), 50) }}>退出聚焦</Button>}
                <Divider className="tc-canvas__context-menu-divider" my={2} />
                <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { useRFStore.getState().addNode('taskNode', undefined, { kind: 'image', position: screenToFlow({ x: menu.x, y: menu.y }) }); setMenu(null) }}>新建图像</Button>
                <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { useRFStore.getState().addNode('taskNode', undefined, { kind: 'imageFission', position: screenToFlow({ x: menu.x, y: menu.y }) }); setMenu(null) }}>新建图像裂变</Button>
                <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { useRFStore.getState().addNode('taskNode', undefined, { kind: 'storyboardImage', position: screenToFlow({ x: menu.x, y: menu.y }) }); setMenu(null) }}>新建分镜图</Button>
                <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { useRFStore.getState().addNode('taskNode', undefined, { kind: 'mosaic', position: screenToFlow({ x: menu.x, y: menu.y }) }); setMenu(null) }}>新建拼图</Button>
                <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { useRFStore.getState().addNode('taskNode', undefined, { kind: 'composeVideo', position: screenToFlow({ x: menu.x, y: menu.y }) }); setMenu(null) }}>新建视频</Button>
                <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { useRFStore.getState().addNode('taskNode', undefined, { kind: 'character', position: screenToFlow({ x: menu.x, y: menu.y }) }); setMenu(null) }}>新建角色</Button>
              </>
            )}
            {menu.type === 'node' && menu.id && (() => {
              const target = nodes.find(n => n.id === menu.id)
              const isGroup = target?.type === 'groupNode'
              if (isGroup) {
                const childIds = new Set(nodes.filter(n => n.parentNode === target!.id).map(n=>n.id))
                return (
                  <>
                    <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={async () => { await runFlowDag(2, useRFStore.getState, useRFStore.setState, { only: childIds }); setMenu(null) }}>运行该组</Button>
                    <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { useRFStore.getState().autoLayoutForParent(target!.id); setMenu(null) }}>{$('格式化')}</Button>
                    <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { enterGroupFocus(target!.id); setMenu(null); setTimeout(()=> rf.fitView?.({ padding: 0.2 }), 50) }}>进入组</Button>
                    <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { useRFStore.getState().renameSelectedGroup(); setMenu(null) }}>重命名</Button>
                    <Button className="tc-canvas__context-menu-action" variant="subtle" color="red" onClick={() => { useRFStore.getState().ungroupGroupNode(target!.id); setMenu(null) }}>解组</Button>
                  </>
                )
              }
              return (
                <>
                  <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { duplicateNode(menu.id!); setMenu(null) }}>复制一份</Button>
                  <Button className="tc-canvas__context-menu-action" variant="subtle" color="red" onClick={() => { deleteNode(menu.id!); setMenu(null) }}>删除</Button>
                  <Divider className="tc-canvas__context-menu-divider" my={2} />
                  <Button
                    className="tc-canvas__context-menu-action"
                    variant="subtle"
                    onClick={async () => {
                      await runFlowDag(2, useRFStore.getState, useRFStore.setState, { only: new Set([menu.id!]) })
                      setMenu(null)
                    }}
                  >
                    运行该节点
                  </Button>
                  <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { cancelNode(menu.id!); setMenu(null) }}>停止该节点</Button>
                </>
              )
            })()}
            {menu.type === 'edge' && menu.id && (
              <Button className="tc-canvas__context-menu-action" variant="subtle" color="red" onClick={() => { deleteEdge(menu.id!); setMenu(null) }}>删除连线</Button>
            )}
          </Stack>
        </Paper>
      )}
      {insertMenu.open && (() => {
        const fromNode = nodes.find(n => n.id === insertMenu.fromNodeId)
        const fromKind = (fromNode?.data as any)?.kind as string | undefined
        const fromLabel = (fromNode?.data as any)?.label as string | undefined
        const sourceType = parseHandleTypeFromId(insertMenu.fromHandle)

        const schemaTargets = listTaskNodeSchemas()
        const candidates = schemaTargets
          .filter((schema) => {
            const handles = schema.handles as any
            const targetDefs = handles?.dynamic ? [{ type: 'any' }] : (handles?.targets || [])
            if (!Array.isArray(targetDefs) || targetDefs.length === 0) return false
            const acceptsType = targetDefs.some((h: any) => {
              const t = String(h?.type || 'any').toLowerCase()
              return t === 'any' || t === sourceType
            })
            if (!acceptsType) return false
            if (!fromKind) return true
            return isValidEdgeByType(fromKind, schema.kind)
          })
          .sort((a, b) => {
            const order: Record<string, number> = { image: 10, video: 20, composer: 30, storyboard: 40, subflow: 90, generic: 100 }
            const ai = order[a.category] ?? 999
            const bi = order[b.category] ?? 999
            if (ai !== bi) return ai - bi
            return String(a.label || a.kind).localeCompare(String(b.label || b.kind))
          })

        const title = fromLabel
          ? `从「${fromLabel}」继续（${getHandleTypeLabel(sourceType)}）`
          : `继续（${getHandleTypeLabel(sourceType)}）`

        return (
          <Paper
            className="tc-canvas__insert-menu"
            withBorder
            shadow="md"
            style={{
              position: 'fixed',
              left: insertMenu.x,
              top: insertMenu.y,
              zIndex: 70,
              minWidth: 220,
              transform: 'translate(10px, 10px)',
            }}
            ref={insertMenuRef}
          >
            <Stack className="tc-canvas__insert-menu-stack" gap={6} p="xs">
              <Group className="tc-canvas__insert-menu-header" justify="space-between" gap={8} wrap="nowrap">
                <Text className="tc-canvas__insert-menu-title" size="xs" c="dimmed" lineClamp={1} title={title}>
                  {title}
                </Text>
                <Button className="tc-canvas__insert-menu-close" variant="subtle" size="xs" onClick={closeInsertMenu}>
                  关闭
                </Button>
              </Group>
              {candidates.length === 0 ? (
                <Text className="tc-canvas__insert-menu-empty" size="xs" c="dimmed">
                  暂无可用选项
                </Text>
              ) : (
                candidates.map((schema) => (
                  <Button
                    key={schema.kind}
                    className="tc-canvas__insert-menu-action"
                    variant="subtle"
                    size="xs"
                    onClick={() => {
                      handleInsertNodeAt(schema.kind, {
                        x: insertMenu.x,
                        y: insertMenu.y,
                        fromNodeId: insertMenu.fromNodeId,
                        fromHandle: insertMenu.fromHandle,
                      })
                    }}
                  >
                    {schema.label || schema.kind}
                  </Button>
                ))
              )}
            </Stack>
          </Paper>
        )
      })()}
      {connectingType && (
        <div className="tc-canvas__connecting-tooltip" style={{ position: 'fixed', left: mouse.x + 12, top: mouse.y + 12, pointerEvents: 'none', fontSize: 12, background: 'rgba(17,24,39,.85)', color: '#e5e7eb', padding: '4px 8px', borderRadius: 6 }}>
          {$t('连接类型: {type}，拖到兼容端口', { type: getHandleTypeLabel(connectingType) })}
        </div>
      )}
    </div>
  )
}

type FlowRect = { x: number; y: number; w: number; h: number }

function CanvasViewportOverlays({
  viewOnly,
  groupRectFlow,
  selectionBorderColor,
  guides,
  selectionPartialOverlaps,
  nodes,
  edges,
  onFormatTree,
}: {
  viewOnly: boolean
  groupRectFlow: FlowRect | null
  selectionBorderColor: string
  guides: { vx?: number; hy?: number } | null
  selectionPartialOverlaps: boolean
  nodes: any[]
  edges: any[]
  onFormatTree: () => void
}): JSX.Element | null {
  const [tx, ty, zoom] = useStore((s) => s.transform)
  const flowToScreen = useCallback((p: { x: number; y: number }) => ({ x: p.x * zoom + tx, y: p.y * zoom + ty }), [tx, ty, zoom])

  return (
    <>
      {/* Group visuals moved to a real group node (compound). Legacy overlays removed. */}
      {!viewOnly && groupRectFlow && (
        <>
          {/* Selection outline in screen space to avoid transform artifacts */}
          <div
            className="tc-canvas__group-selection"
            style={{
              position: 'absolute',
              left: flowToScreen({ x: groupRectFlow.x, y: groupRectFlow.y }).x,
              top: flowToScreen({ x: groupRectFlow.x, y: groupRectFlow.y }).y,
              width: groupRectFlow.w * (zoom || 1),
              height: groupRectFlow.h * (zoom || 1),
              borderRadius: 12,
              border: `1px dashed ${selectionBorderColor}`,
              background: 'transparent',
              pointerEvents: 'none'
            }}
          />
          <Paper
            className="tc-canvas__group-toolbar glass"
            withBorder
            shadow="sm"
            radius="xl"
            p={4}
            style={{
              position: 'absolute',
              left: flowToScreen({ x: groupRectFlow.x, y: groupRectFlow.y }).x,
              top: flowToScreen({ x: groupRectFlow.x, y: groupRectFlow.y }).y - 36,
              pointerEvents: 'auto',
              whiteSpace: 'nowrap',
              overflowX: 'auto'
            }}
          >
            <Group className="tc-canvas__group-toolbar-group" gap={6} style={{ flexWrap: 'nowrap' }}>
              <Text className="tc-canvas__group-toolbar-title" size="xs" c="dimmed">新建组</Text>
              <Divider className="tc-canvas__group-toolbar-divider" orientation="vertical" style={{ height: 16 }} />
              <Button className="tc-canvas__group-toolbar-action" size="xs" variant="subtle" onClick={() => onFormatTree()}>{$('格式化')}</Button>
              <Button className="tc-canvas__group-toolbar-action" size="xs" variant="subtle" onClick={async () => {
                const name = prompt('保存为资产名称：')?.trim(); if (!name) return;
                const sel = nodes.filter(n => n.selected)
                const setIds = new Set(sel.map(n => n.id))
                const es = edges.filter(e => setIds.has(e.source) && setIds.has(e.target))
                const data = { nodes: sel, edges: es }
                // 资产现在是用户级别的，不需要项目ID
                const { createServerAsset } = await import('../api/server')
                const { notifyAssetRefresh } = await import('../ui/assetEvents')
                await createServerAsset({ name, data })
                notifyAssetRefresh()
              }}>生成工作流</Button>
              {!selectionPartialOverlaps && (
                <Button className="tc-canvas__group-toolbar-action" size="xs" variant="subtle" onClick={() => {
                  // 直接打组为父节点
                  useRFStore.getState().addGroupForSelection(undefined)
                }}>打组</Button>
              )}
            </Group>
          </Paper>
        </>
      )}
      {guides?.vx !== undefined && (
        <div className="tc-canvas__guide-vertical" style={{ position: 'absolute', left: flowToScreen({ x: guides.vx!, y: 0 }).x, top: 0, width: 1, height: '100%', background: 'rgba(59,130,246,.5)' }} />
      )}
      {guides?.hy !== undefined && (
        <div className="tc-canvas__guide-horizontal" style={{ position: 'absolute', left: 0, top: flowToScreen({ x: 0, y: guides.hy! }).y, width: '100%', height: 1, background: 'rgba(16,185,129,.5)' }} />
      )}
    </>
  )
}

const ReactFlowProviderWithClass =
  ReactFlowProvider as unknown as React.FC<React.PropsWithChildren<{ className?: string }>>

export default function Canvas({ className }: { className?: string }): JSX.Element {
  const innerClassName = ['tc-canvas-inner', className].filter(Boolean).join(' ')
  return (
    <ReactFlowProviderWithClass className="tc-canvas-provider">
      <CanvasInner className={innerClassName} />
    </ReactFlowProviderWithClass>
  )
}
