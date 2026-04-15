import type { Connection, Node } from '@xyflow/react'
import { useRFStore } from '../canvas/store'
import { buildTopLevelGroupReflowPositions } from '../canvas/utils/reflowLayout'
import { runNodeMock } from '../runner/mockRunner'
import { runNodeDagToTarget } from '../runner/dag'
import { FunctionResult } from './types'
import { normalizeOrientation } from '../utils/orientation'
import { generatePrompt, type PromptGeneratePayload } from '../api/server'
import { useUIStore } from '../ui/uiStore'
import { normalizeProductionNodeMetaRecord } from '../canvas/productionMeta'
import { getTaskNodeCoreType, normalizeTaskNodeKind } from '../canvas/nodes/taskNodeSchema'
import { normalizeStoryboardNodeData } from '../canvas/nodes/taskNode/storyboardEditor'
import { getDefaultModel } from '../config/models'

/**
 * Canvas操作服务层
 * 将AI Function Calling转换为实际的canvas操作
 */

const REMOTE_RUN_KINDS = new Set(['image', 'video', 'storyboard'])

const CREATIVE_PROMPT_KINDS = new Set(['image'])

function hasResolvedAssetUrl(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function hasResolvedAssetList(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => {
    if (!item || typeof item !== 'object') return false
    const record = item as Record<string, unknown>
    return typeof record.url === 'string' && record.url.trim().length > 0
  })
}

function isReferenceOnlyVisualConfig(config: Record<string, unknown>): boolean {
  const status = typeof config.status === 'string' ? config.status.trim().toLowerCase() : ''
  if (status === 'queued' || status === 'running') return false
  if (hasResolvedAssetUrl(config.imageUrl) || hasResolvedAssetUrl(config.videoUrl) || hasResolvedAssetUrl(config.audioUrl)) {
    return true
  }
  return (
    hasResolvedAssetList(config.imageResults) ||
    hasResolvedAssetList(config.videoResults) ||
    hasResolvedAssetList(config.audioResults) ||
    hasResolvedAssetList(config.results) ||
    hasResolvedAssetList(config.assets) ||
    hasResolvedAssetList(config.outputs)
  )
}

function readTrimmedRecordString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

export class CanvasService {
  private static cloneGraphSnapshot(nodes: Node[], edges: ReturnType<typeof useRFStore.getState>['edges']) {
    const snapshot = { nodes, edges }
    if (typeof structuredClone === 'function') {
      return structuredClone(snapshot) as { nodes: Node[]; edges: ReturnType<typeof useRFStore.getState>['edges'] }
    }
    return JSON.parse(JSON.stringify(snapshot)) as { nodes: Node[]; edges: ReturnType<typeof useRFStore.getState>['edges'] }
  }

  private static normalizeGroupId(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }

  private static applyTopLevelGroupReflow(groupIds?: string[]): number {
    let movedCount = 0
    useRFStore.setState((state) => {
      const nextPositionById = buildTopLevelGroupReflowPositions(state.nodes, groupIds)
      if (!nextPositionById.size) return {}

      const previousSnapshot = CanvasService.cloneGraphSnapshot(state.nodes, state.edges)

      const nextNodes = state.nodes.map((node) => {
          const next = nextPositionById.get(String(node.id))
          if (!next) return node

          const currentX = Number(node.position?.x ?? 0)
          const currentY = Number(node.position?.y ?? 0)
          if (Math.abs(currentX - next.x) <= 1 && Math.abs(currentY - next.y) <= 1) return node

          movedCount += 1
          const currentNode = node as typeof node & {
            positionAbsolute?: unknown
            dragging?: unknown
          }
          const { positionAbsolute: _positionAbsolute, dragging: _dragging, ...rest } = currentNode
          return {
            ...rest,
            position: next,
          }
        })

      if (movedCount === 0) return {}

      return {
        nodes: nextNodes,
        historyPast: [...state.historyPast, previousSnapshot].slice(-50),
        historyFuture: [],
      }
    })
    return movedCount
  }

  private static resolveNodeId(value: unknown, nodes: Node[]): string | null {
    if (typeof value !== 'string') return null
    const needle = value.trim()
    if (!needle) return null

    const byId = nodes.find((n) => n.id === needle)
    if (byId) return byId.id

    const byLabel = nodes.find((n) => (n.data as any)?.label === needle)
    if (byLabel) return byLabel.id

    const lower = needle.toLowerCase()
    const byLabelInsensitive = nodes.find((n) =>
      typeof (n.data as any)?.label === 'string' &&
      String((n.data as any).label).toLowerCase() === lower
    )
    return byLabelInsensitive?.id || null
  }

  /**
   * 创建新节点
   */
  static async createNode(params: {
    type: string
    label?: string
    config?: Record<string, any> | null
    remixFromNodeId?: string
    parentId?: string
    position?: { x: number; y: number }
  }): Promise<FunctionResult> {
    try {
      console.debug('[CanvasService] createNode input', params)
      const store = useRFStore.getState()
      const prevIds = new Set(store.nodes.map(node => node.id))
      const { addNode, onConnect } = store
      const normalizedLabel = (params.label || '').trim()
      const normalizedType = (params.type || '').trim().toLowerCase()
      const configRecord =
        params.config && typeof params.config === 'object' && !Array.isArray(params.config)
          ? params.config as Record<string, unknown>
          : {}
      const normalizedKind =
        normalizeTaskNodeKind((params.type || '').trim()) ||
        normalizeTaskNodeKind(typeof configRecord.kind === 'string' ? configRecord.kind : null)
      const sourceEntityKey = readTrimmedRecordString(configRecord, 'sourceEntityKey')
      const sourceProjectId = readTrimmedRecordString(configRecord, 'sourceProjectId')

      // 若已有同名同类节点，直接返回，避免重复创建
      if (normalizedLabel) {
        if (sourceEntityKey) {
          const existingByEntityKey = store.nodes.find((node) => {
            if (node.type !== 'taskNode') return false
            const record =
              node.data && typeof node.data === 'object' && !Array.isArray(node.data)
                ? node.data as Record<string, unknown>
                : {}
            if (normalizedKind) {
              const existingKind = normalizeTaskNodeKind(
                typeof record.kind === 'string' ? record.kind : null,
              )
              if (existingKind !== normalizedKind) return false
            }
            if (readTrimmedRecordString(record, 'sourceEntityKey') !== sourceEntityKey) return false
            if (sourceProjectId && readTrimmedRecordString(record, 'sourceProjectId') !== sourceProjectId) return false
            return true
          })
          if (existingByEntityKey) {
            return {
              success: true,
              data: { message: '已存在同实体节点，复用现有节点', nodeId: existingByEntityKey.id }
            }
          }
        } else {
          const existing = store.nodes.find(node => {
            const record =
              node.data && typeof node.data === 'object' && !Array.isArray(node.data)
                ? node.data as Record<string, unknown>
                : {}
            const labelMatches =
              readTrimmedRecordString(record, 'label') === normalizedLabel ||
              node.id === normalizedLabel
            if (!labelMatches) return false
            if (normalizedKind) {
              const existingKind = normalizeTaskNodeKind(
                typeof record.kind === 'string' ? record.kind : null,
              )
              return existingKind === normalizedKind
            }
            return String(node.type || '').trim().toLowerCase() === normalizedType
          })
          if (existing) {
            return {
              success: true,
              data: { message: '已存在同名节点，复用现有节点', nodeId: existing.id }
            }
          }
        }
      }

      // 生成默认位置（如果未提供）
      const position = params.position || CanvasService.generateDefaultPosition()

      const normalized = CanvasService.normalizeNodeParams(params)
      console.debug('[CanvasService] normalized node params', normalized)

      const nodeData = { ...normalized.data }

      if (normalized.remixFromNodeId) {
        const remixSource = store.nodes.find(node => node.id === normalized.remixFromNodeId)
        const remixKind = normalizeTaskNodeKind((remixSource?.data as any)?.kind)
        const remixStatus = (remixSource?.data as any)?.status
        if (!remixSource || remixKind !== 'video') {
          return {
            success: false,
            error: 'Remix 必须引用一个已有的视频节点。'
          }
        }
        if (remixStatus !== 'success') {
          return {
            success: false,
            error: 'Remix 只能基于已成功完成的视频节点，请等待前序节点完成。'
          }
        }

        if (!nodeData.prompt) {
          const sourcePrompt = (remixSource.data as any)?.prompt
          if (typeof sourcePrompt === 'string' && sourcePrompt.trim()) {
            nodeData.prompt = sourcePrompt.trim()
          }
        }
        nodeData.remixSourceId = remixSource.id
        nodeData.remixSourceLabel = (remixSource.data as any)?.label || remixSource.id
      }

      // 调用store方法创建节点
      addNode(normalized.nodeType, normalized.label, {
        ...nodeData,
        ...(typeof params.parentId === 'string' && params.parentId.trim() ? { parentId: params.parentId.trim() } : null),
        position,
        autoLabel: !(params.label && params.label.trim()),
      })

      const updatedState = useRFStore.getState()
      const newNode = [...updatedState.nodes].reverse().find(node => !prevIds.has(node.id)) || updatedState.nodes[updatedState.nodes.length - 1]

      if (newNode && normalized.remixFromNodeId) {
        try {
          const sourceNode = updatedState.nodes.find(node => node.id === normalized.remixFromNodeId)
          if (sourceNode && typeof onConnect === 'function') {
            const sourceKind = getTaskNodeCoreType(
              typeof (sourceNode.data as Record<string, unknown> | undefined)?.kind === 'string'
                ? String((sourceNode.data as Record<string, unknown>).kind)
                : null,
            )
            const sourceHandle =
              sourceKind === 'video'
                ? 'out-video'
                : sourceKind === 'image'
                  ? 'out-image'
                  : sourceKind === 'text'
                    ? 'out-text'
                    : 'out-any'
            const connection: Connection = {
              source: sourceNode.id,
              sourceHandle,
              target: newNode.id,
              targetHandle: 'in-any',
            }
            onConnect(connection)
          }
        } catch (err) {
          console.warn('[CanvasService] remix connection failed', err)
        }
      }

      return {
        success: true,
        data: { message: `成功创建${params.label}节点`, nodeId: newNode?.id }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '创建节点失败'
      }
    }
  }

  static async generatePromptAndCreateNode(params: {
    workflow?: 'character_creation' | 'direct_image' | 'merchandise'
    subject?: string
    visualStyle?: string
    model?: string
    consistency?: string
    language?: 'zh' | 'en'
    label?: string
    type?: string
    kind?: string
    position?: { x: number; y: number }
  }): Promise<FunctionResult> {
    try {
      const fallbackSubject =
        (params.subject || params.label || '').trim() ||
        'Unnamed subject'
      const inferredWorkflow: 'character_creation' | 'direct_image' | 'merchandise' = (() => {
        const w = params.workflow
        if (w === 'character_creation' || w === 'direct_image' || w === 'merchandise') return w
        const subjectText = (params.subject || '').toLowerCase()
        if (subjectText.includes('角色') || subjectText.includes('character')) return 'character_creation'
        if (subjectText.includes('周边') || subjectText.includes('merch')) return 'merchandise'
        return 'direct_image'
      })()

      const payload: PromptGeneratePayload = {
        workflow: inferredWorkflow,
        subject: fallbackSubject,
        visual_style: params.visualStyle,
        model: params.model,
        consistency: params.consistency,
        language: params.language || 'en',
      }
      const result = await generatePrompt(payload)
      const nodeType = params.type || 'image'
      const nodeKind = params.kind || 'image'

      const createRes = await CanvasService.createNode({
        type: nodeType,
        label: params.label || fallbackSubject,
        position: params.position,
        config: {
          kind: nodeKind,
          prompt: result.prompt,
          negativePrompt: result.negative_prompt,
          suggestedAspects: result.suggested_aspects,
          notes: result.notes,
        },
      })
      if (!createRes.success) return createRes
      return {
        success: true,
        data: {
          ...(createRes.data || {}),
          prompt: result.prompt,
          negativePrompt: result.negative_prompt,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '生成提示词并创建节点失败',
      }
    }
  }

  private static normalizeNodeParams(params: {
    type: string
    label?: string
    config?: Record<string, any> | null
    remixFromNodeId?: string
  }): { nodeType: string; label: string; data: Record<string, any>; remixFromNodeId?: string } {
    const rawType = (params.type || 'taskNode').trim()
    const safeConfig = params.config && typeof params.config === 'object' ? params.config : {}
    const configRecord = safeConfig as Record<string, unknown>
    const configKind = typeof configRecord.kind === 'string'
      ? configRecord.kind
      : undefined
    const normalizedKind = normalizeTaskNodeKind(rawType) || normalizeTaskNodeKind(configKind)
    if (!normalizedKind) {
      throw new Error('当前 taskNode 只保留 text / image / imageEdit / storyboard / video 五类节点')
    }

    const label = params.label?.trim() || CanvasService.defaultLabelForType(normalizedKind)
    const nodeType = 'taskNode'
    const baseData: Record<string, any> = { kind: normalizedKind }

    const { remixFromNodeId: configRemixFromNodeId, ...restConfig } = safeConfig as Record<string, any>
    const mergedConfig: Record<string, any> = normalizedKind === 'storyboard'
      ? normalizeStoryboardNodeData({
          ...baseData,
          ...restConfig,
          kind: normalizedKind,
        })
      : { ...baseData, ...restConfig, kind: normalizedKind }
    if (normalizedKind === 'video') {
      mergedConfig.orientation = normalizeOrientation((mergedConfig as any).orientation)
    }

    if (
      !mergedConfig.prompt &&
      typeof label === 'string' &&
      label.trim().length > 0 &&
      !isReferenceOnlyVisualConfig(mergedConfig as Record<string, unknown>) &&
      (normalizedKind === 'image' || normalizedKind === 'imageEdit')
    ) {
      mergedConfig.prompt = label.trim()
    }
    const dataWithPrompt = CanvasService.ensurePromptFields(mergedConfig, normalizedKind)
    const data = normalizeProductionNodeMetaRecord(
      CanvasService.sanitizeModels(normalizedKind, dataWithPrompt),
      { kind: normalizedKind },
    )

    const topLevelRemixId = typeof params.remixFromNodeId === 'string' && params.remixFromNodeId.trim()
      ? params.remixFromNodeId.trim()
      : undefined
    const configRemixId = typeof configRemixFromNodeId === 'string' && configRemixFromNodeId.trim()
      ? configRemixFromNodeId.trim()
      : undefined
    const remixSource = topLevelRemixId || configRemixId

    return { nodeType, label, data, remixFromNodeId: remixSource }
  }

  private static defaultLabelForType(type: string) {
    const normalizedKind = normalizeTaskNodeKind(type)
    if (normalizedKind === 'text') return '文本'
    if (normalizedKind === 'image') return '图片'
    if (normalizedKind === 'imageEdit') return '图片编辑'
    if (normalizedKind === 'storyboard') return '分镜编辑'
    if (normalizedKind === 'video') return '视频'
    return type
  }

  /**
   * 更新节点
   */
  static async updateNode(params: {
    nodeId: string
    label?: string
    config?: Record<string, any>
  }): Promise<FunctionResult> {
    try {
      const { updateNodeLabel, updateNodeData, appendLog, nodes } = useRFStore.getState()
      const resolvedNodeId = CanvasService.resolveNodeId(params.nodeId, nodes)
      if (!resolvedNodeId) {
        return { success: false, error: '节点不存在，无法更新' }
      }
      const nowLabel = () => new Date().toLocaleTimeString()
      const targetLabel =
        nodes.find((n) => n.id === resolvedNodeId)?.data?.label || params.nodeId

      if (params.label) {
        updateNodeLabel(resolvedNodeId, params.label)
        appendLog?.(resolvedNodeId, `[${nowLabel()}] 重命名为「${params.label}」`)
      }

      const normalizedConfig = params.config
        ? normalizeProductionNodeMetaRecord(CanvasService.ensurePromptFields({ ...params.config }), {
            kind: params.config.kind,
          })
        : null

      if (normalizedConfig) {
        updateNodeData(resolvedNodeId, normalizedConfig)
        const logs: string[] = []
        if (typeof normalizedConfig.prompt === 'string') {
          logs.push(`prompt 写入（${normalizedConfig.prompt.length} 字符）`)
          const p = normalizedConfig.prompt
          const hasDialogue = /["“”'’‘:：]/.test(p)
          const hasSound = /\b(sfx|sound|whisper|wind|rain|footstep|thud|voice|dialog|dialogue)\b/i.test(p)
          if (!hasDialogue && !hasSound) {
            logs.push('⚠ 未检测到对白/音效描述')
          }
        }
        if (typeof normalizedConfig.negativePrompt === 'string') {
          logs.push(`negativePrompt 写入（${normalizedConfig.negativePrompt.length} 字符）`)
        }
        if (normalizedConfig.keywords) {
          const kw =
            Array.isArray(normalizedConfig.keywords)
              ? normalizedConfig.keywords
              : typeof normalizedConfig.keywords === 'string'
                ? normalizedConfig.keywords.split(',').map((s) => s.trim()).filter(Boolean)
                : []
          if (kw.length) {
            logs.push(`keywords 写入（${kw.length} 项）`)
          }
        }
        if (logs.length) {
          appendLog?.(resolvedNodeId, `[${nowLabel()}] ${logs.join('，')} → ${targetLabel}`)
        }
      }

      return {
        success: true,
        data: { message: '节点更新成功' }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '更新节点失败'
      }
    }
  }

  /**
   * 删除节点
   */
  static async deleteNode(params: { nodeId: string }): Promise<FunctionResult> {
    try {
      const { deleteNode } = useRFStore.getState()
      deleteNode(params.nodeId)

      return {
        success: true,
        data: { message: '节点删除成功' }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '删除节点失败'
      }
    }
  }

  /**
   * 连接节点
   */
  static async connectNodes(params: {
    sourceNodeId?: string
    targetNodeId?: string
    sourceId?: string
    targetId?: string
    sourceHandle?: string
    targetHandle?: string
  }): Promise<FunctionResult> {
    try {
      const { nodes, edges, onConnect } = useRFStore.getState()
      const sourceRef = params.sourceNodeId ?? params.sourceId
      const targetRef = params.targetNodeId ?? params.targetId
      const resolvedSourceId = CanvasService.resolveNodeId(sourceRef, nodes)
      const resolvedTargetId = CanvasService.resolveNodeId(targetRef, nodes)

      // 验证节点存在
      const sourceNode = resolvedSourceId ? nodes.find(n => n.id === resolvedSourceId) : undefined
      const targetNode = resolvedTargetId ? nodes.find(n => n.id === resolvedTargetId) : undefined

      if (!sourceNode || !targetNode) {
        return {
          success: false,
          error: '源节点或目标节点不存在'
        }
      }

      // 检查是否已存在连接
      const existingEdge = edges.find(e =>
        e.source === sourceNode.id && e.target === targetNode.id
      )

      if (existingEdge) {
        return {
          success: false,
          error: '节点之间已存在连接'
        }
      }

      // 创建连接（复用 React Flow 的 onConnect 逻辑，含去重和动画）
      onConnect({
        source: sourceNode.id,
        target: targetNode.id,
        sourceHandle: params.sourceHandle ?? null,
        targetHandle: params.targetHandle ?? null
      })

      return {
        success: true,
        data: { message: '节点连接成功' }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '连接节点失败'
      }
    }
  }

  /**
   * 断开节点连接
   */
  static async disconnectNodes(params: { edgeId: string }): Promise<FunctionResult> {
    try {
      const { deleteEdge } = useRFStore.getState()
      deleteEdge(params.edgeId)

      return {
        success: true,
        data: { message: '连接断开成功' }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '断开连接失败'
      }
    }
  }

  /**
   * 统一处理节点操作（来自智能助手）
   */
  static async nodeOperation(params: {
    action: 'create' | 'update' | 'delete' | 'duplicate'
    nodeType?: string
    position?: { x: number; y: number }
    config?: Record<string, any>
    nodeIds?: string[]
    operations?: any[]
  }): Promise<FunctionResult> {
    const action = params.action
    if (action === 'create') {
      return this.createNode({
        type: params.nodeType || (params.config as any)?.kind || 'text',
        label: params.config?.label || params.nodeType || '节点',
        config: params.config || {},
        position: params.position,
      })
    }

    if (action === 'update') {
      const targets = params.nodeIds && params.nodeIds.length ? params.nodeIds : []
      if (!targets.length) {
        return { success: false, error: '缺少要更新的节点 ID' }
      }
      for (const nodeId of targets) {
        await this.updateNode({ nodeId, config: params.config || {} })
      }
      return { success: true, data: { message: `已更新 ${targets.length} 个节点` } }
    }

    if (action === 'delete') {
      const targets = params.nodeIds && params.nodeIds.length ? params.nodeIds : []
      if (!targets.length) {
        return { success: false, error: '缺少要删除的节点 ID' }
      }
      for (const nodeId of targets) {
        await this.deleteNode({ nodeId })
      }
      return { success: true, data: { message: `已删除 ${targets.length} 个节点` } }
    }

    if (action === 'duplicate') {
      const targets = params.nodeIds && params.nodeIds.length ? params.nodeIds : []
      if (!targets.length) {
        return { success: false, error: '缺少要复制的节点 ID' }
      }
      const state = useRFStore.getState()
      const nodesToCopy = state.nodes.filter((n) => targets.includes(n.id))
      const offset = 60
      useRFStore.setState((s: any) => {
        const now = Date.now()
        const clones = nodesToCopy.map((node, idx) => ({
          ...node,
          id: `${node.id}_copy_${now}_${idx}`,
          position: {
            x: (node.position?.x || 0) + offset * (idx + 1),
            y: (node.position?.y || 0) + offset * (idx + 1),
          },
          selected: false,
        }))
        return { nodes: [...s.nodes, ...clones] }
      })
      return { success: true, data: { message: `已复制 ${targets.length} 个节点` } }
    }

    return { success: false, error: `不支持的操作：${action}` }
  }

  /**
   * 处理连线操作（来自智能助手）
   */
  static async connectionOperation(params: {
    action?: 'connect' | 'disconnect' | 'reconnect'
    sourceNodeId?: string
    targetNodeId?: string
    edgeId?: string
    connections?: Array<{ sourceNodeId: string; targetNodeId: string }>
  }): Promise<FunctionResult> {
    const action = params.action || 'connect'
    if (Array.isArray(params.connections) && params.connections.length) {
      for (const conn of params.connections) {
        if (conn.sourceNodeId && conn.targetNodeId) {
          await this.connectNodes({ sourceNodeId: conn.sourceNodeId, targetNodeId: conn.targetNodeId })
        }
      }
      return { success: true, data: { message: `已处理 ${params.connections.length} 条连接` } }
    }

    if (action === 'disconnect') {
      if (params.edgeId) {
        return this.disconnectNodes({ edgeId: params.edgeId })
      }
      const state = useRFStore.getState()
      const edge = state.edges.find(
        (e) => e.source === params.sourceNodeId && e.target === params.targetNodeId,
      )
      if (edge?.id) {
        return this.disconnectNodes({ edgeId: edge.id })
      }
      return { success: false, error: '未找到可断开的连接' }
    }

    if (params.sourceNodeId && params.targetNodeId) {
      return this.connectNodes({
        sourceNodeId: params.sourceNodeId,
        targetNodeId: params.targetNodeId,
      })
    }

    return { success: false, error: '缺少连接参数' }
  }

  /**
   * 执行 DAG
   */
  static async runDag(params: { concurrency?: number } = {}): Promise<FunctionResult> {
    try {
      if (useUIStore.getState().viewOnly) {
        return { success: false, error: '只读分享页禁止执行工作流' }
      }
      const { runDag } = useRFStore.getState()
      await runDag(params.concurrency ?? 1)
      return { success: true, data: { message: '已触发工作流执行（顺序执行）' } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '运行工作流失败'
      }
    }
  }

  /**
   * 执行单个节点
   */
  static async runNode(params: { nodeId: string }): Promise<FunctionResult> {
    try {
      if (useUIStore.getState().viewOnly) {
        return { success: false, error: '只读分享页禁止执行节点' }
      }
      const { nodeId } = params
      if (!nodeId) {
        return { success: false, error: '缺少节点 ID' }
      }

      const store = useRFStore.getState()
      const resolvedNodeId = CanvasService.resolveNodeId(nodeId, store.nodes)
      const node = resolvedNodeId ? store.nodes.find(n => n.id === resolvedNodeId) : undefined
      if (!node) {
        return { success: false, error: '节点不存在，无法执行' }
      }
      const initialLabel = (node.data as any)?.label || resolvedNodeId || nodeId

      const get = () => useRFStore.getState()
      const set = (fn: (s: any) => any) => useRFStore.setState(fn)
      const kind = (node.data as any)?.kind as string | undefined
      const shouldRunRemote = kind ? REMOTE_RUN_KINDS.has(kind) : false

      if (shouldRunRemote) {
        await runNodeDagToTarget(node.id, get, set, { concurrency: 1 })
      } else {
        await runNodeMock(node.id, get, set)
      }

      // 执行完后，从最新节点状态中提取图片/视频结果，方便 AI 对话里回显
      let mediaPatch: Record<string, any> = {}
      try {
        const latest = useRFStore.getState().nodes.find(n => n.id === node.id)
        if (latest) {
          const data: any = latest.data || {}
          const latestKind: string | undefined = data.kind
          const promptValue =
            typeof data.prompt === 'string' && data.prompt.trim().length
              ? data.prompt.trim()
              : undefined

          const primaryImageUrl =
            typeof data.imageUrl === 'string' && data.imageUrl.trim().length
              ? data.imageUrl.trim()
              : undefined
          const imageResults = Array.isArray(data.imageResults)
            ? (data.imageResults as { url?: string }[]).filter(
                (img) => img && typeof img.url === 'string' && img.url.trim().length,
              )
            : []

          const primaryVideoUrl =
            typeof data.videoUrl === 'string' && data.videoUrl.trim().length
              ? data.videoUrl.trim()
              : undefined
          const videoResults = Array.isArray(data.videoResults)
            ? (data.videoResults as { url?: string }[]).filter(
                (v) => v && typeof v.url === 'string' && v.url.trim().length,
              )
            : []

          mediaPatch = {
            nodeId: node.id,
            kind: latestKind,
          }

          if (promptValue) {
            mediaPatch.prompt = promptValue
          }

          if (primaryImageUrl || imageResults.length) {
            mediaPatch.imageUrl = primaryImageUrl || imageResults[0]?.url
            mediaPatch.imageResults = imageResults
          }

          if (primaryVideoUrl || videoResults.length) {
            mediaPatch.videoUrl = primaryVideoUrl || videoResults[0]?.url
            mediaPatch.videoResults = videoResults
          }
        }
      } catch {
        // 回显信息获取失败时不影响主流程
        mediaPatch = { nodeId: node.id }
      }

      return {
        success: true,
        data: {
          message: `已执行节点 ${initialLabel}`,
          ...mediaPatch,
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '执行节点失败'
      }
    }
  }

  /**
   * 全选并自动格式化（全局 DAG 布局）
   */
  static async formatAll(): Promise<FunctionResult> {
    try {
      const { selectAll, autoLayoutAllDagVertical } = useRFStore.getState()
      selectAll()
      autoLayoutAllDagVertical()
      return { success: true, data: { message: '已格式化画布' } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '自动格式化失败'
      }
    }
  }

  /**
   * 智能整理画布：全选 + 自动布局，并可选聚焦到指定节点
   */
  static async smartLayout(params: { focusNodeId?: string } = {}): Promise<FunctionResult> {
    try {
      const { selectAll, autoLayoutAllDagVertical } = useRFStore.getState()
      selectAll()
      autoLayoutAllDagVertical()

      const focusId = params.focusNodeId
      if (focusId) {
        // 仅更新选中状态，具体视图居中交给 Canvas 组件的现有逻辑处理
        useRFStore.setState((state) => ({
          nodes: state.nodes.map((node) => ({
            ...node,
            selected: node.id === focusId,
          })),
        }))
      }

      return {
        success: true,
        data: {
          message: focusId
            ? `已整理画布并选中节点 ${focusId}`
            : '已整理画布布局',
          focusNodeId: focusId,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '智能整理画布失败',
      }
    }
  }

  static async reflowLayout(params: {
    scope?: 'canvas' | 'topLevelGroups' | 'group'
    targetGroupId?: string
    focusNodeId?: string
  } = {}): Promise<FunctionResult> {
    try {
      const scope = params.scope === 'group' || params.scope === 'topLevelGroups' ? params.scope : 'canvas'
      const store = useRFStore.getState()

      if (scope === 'group') {
        const targetGroupId = CanvasService.normalizeGroupId(params.targetGroupId)
        if (!targetGroupId) {
          return {
            success: false,
            error: '重排 group 布局时必须提供 targetGroupId',
          }
        }
        const groupNode = store.nodes.find((node) => node.id === targetGroupId && node.type === 'groupNode')
        if (!groupNode) {
          return {
            success: false,
            error: `未找到目标组：${targetGroupId}`,
          }
        }
        store.arrangeGroupChildren(targetGroupId, 'grid')
        store.fitGroupToChildren(targetGroupId)
        return {
          success: true,
          data: {
            message: `已重排组 ${targetGroupId} 的内部布局`,
            scope,
            targetGroupId,
          },
        }
      }

      if (scope === 'topLevelGroups') {
        const movedCount = CanvasService.applyTopLevelGroupReflow()
        return {
          success: true,
          data: {
            message: movedCount > 0 ? `已重排 ${movedCount} 个顶层组的位置` : '顶层组布局已是最新，无需移动',
            scope,
            movedCount,
          },
        }
      }

      const { selectAll, autoLayoutAllDagVertical } = store
      selectAll()
      autoLayoutAllDagVertical()
      const movedCount = CanvasService.applyTopLevelGroupReflow()

      const focusId = typeof params.focusNodeId === 'string' && params.focusNodeId.trim() ? params.focusNodeId.trim() : null
      if (focusId) {
        useRFStore.setState((state) => ({
          nodes: state.nodes.map((node) => ({
            ...node,
            selected: node.id === focusId,
          })),
        }))
      }

      return {
        success: true,
        data: {
          message: focusId
            ? `已重排画布并聚焦节点 ${focusId}`
            : '已重排画布布局',
          scope,
          focusNodeId: focusId,
          movedTopLevelGroupCount: movedCount,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '布局重排失败',
      }
    }
  }

  /**
   * 获取所有节点
   */
  static async getNodes(): Promise<FunctionResult> {
    try {
      const { nodes } = useRFStore.getState()

      const nodeInfo = nodes.map(node => ({
        id: node.id,
        type: node.type,
        label: node.data.label,
        kind: node.data.kind,
        position: node.position,
        config: node.data.config
      }))

      return {
        success: true,
        data: { nodes: nodeInfo, count: nodeInfo.length }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取节点失败'
      }
    }
  }

  /**
   * 查找节点
   */
  static async findNodes(params: {
    label?: string
    type?: string
  }): Promise<FunctionResult> {
    try {
      const { nodes } = useRFStore.getState()

      let filteredNodes = nodes

      // 按标签过滤
      if (params.label) {
        const labelNeedle = params.label.toLowerCase()
        filteredNodes = filteredNodes.filter((node) => {
          const data = node.data as Record<string, unknown>
          const labelValue = typeof data.label === 'string' ? data.label : ''
          return labelValue.toLowerCase().includes(labelNeedle)
        })
      }

      // 按类型过滤
      if (params.type) {
        filteredNodes = filteredNodes.filter(node =>
          node.data.kind === params.type
        )
      }

      const nodeInfo = filteredNodes.map(node => ({
        id: node.id,
        type: node.type,
        label: node.data.label,
        kind: node.data.kind,
        position: node.position,
        config: node.data.config
      }))

      return {
        success: true,
        data: { nodes: nodeInfo, count: nodeInfo.length }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '查找节点失败'
      }
    }
  }

  /**
   * 自动布局
   */
  static async autoLayout(params: { layoutType: string }): Promise<FunctionResult> {
    try {
      const { autoLayoutAllDagVertical } = useRFStore.getState()
      // 统一为树形格式化（自上而下，32px 间距）
      autoLayoutAllDagVertical()

      return {
        success: true,
        data: { message: '已格式化画布' }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '自动布局失败'
      }
    }
  }


  /**
   * 生成默认节点位置
   */
  private static generateDefaultPosition(): { x: number; y: number } {
    const { nodes } = useRFStore.getState()

    // 简单的网格布局
    const cols = 4
    const spacing = 250
    const index = nodes.length

    return {
      x: (index % cols) * spacing + 100,
      y: Math.floor(index / cols) * spacing + 100
    }
  }

  private static ensurePromptFields<T extends Record<string, unknown>>(data: T, kind?: string): T {
    if (!data || typeof data !== 'object') return data
    if ((kind === 'video' || kind === 'composeVideo') && 'videoPrompt' in data) {
      delete data.videoPrompt
    }

    return data
  }

  private static sanitizeModels(kind: string | undefined, data: Record<string, any>): Record<string, any> {
    const next = { ...data }
    if (kind === 'image' || kind === 'imageEdit') {
      const fallbackModel = getDefaultModel(kind === 'imageEdit' ? 'imageEdit' : 'image')
      const model =
        typeof next.imageModel === 'string' && next.imageModel.trim()
          ? next.imageModel.trim()
          : fallbackModel
      next.imageModel = model
      delete next.imageModelVendor
    }
    if (kind === 'video' || kind === 'composeVideo') {
      // 视频模型与厂商来自动态模型目录；此处不再做前端白名单覆盖，
      // 避免把已展示且已适配的动态模型重写成硬编码默认值。
    }
    return next
  }
}

// 工具函数映射
export const functionHandlers = {
  createNode: CanvasService.createNode,
  generatePromptAndCreateNode: CanvasService.generatePromptAndCreateNode,
  updateNode: CanvasService.updateNode,
  deleteNode: CanvasService.deleteNode,
  connectNodes: CanvasService.connectNodes,
  disconnectNodes: CanvasService.disconnectNodes,
  canvas_node_operation: CanvasService.nodeOperation,
  canvas_connection_operation: CanvasService.connectionOperation,
  getNodes: CanvasService.getNodes,
  findNodes: CanvasService.findNodes,
  autoLayout: CanvasService.autoLayout,
  reflowLayout: CanvasService.reflowLayout,
  canvas_reflow_layout: CanvasService.reflowLayout,
  runNode: CanvasService.runNode,
  runDag: CanvasService.runDag,
  formatAll: CanvasService.formatAll,
  canvas_smartLayout: CanvasService.smartLayout,
} as const
