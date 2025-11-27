import type { Connection } from 'reactflow'
import { useRFStore } from '../canvas/store'
import { runNodeMock } from '../runner/mockRunner'
import { runNodeRemote } from '../runner/remoteRunner'
import { FunctionResult } from './types'
import { buildVideoRealismPrompt } from '../creative/videoRealism'

/**
 * Canvas操作服务层
 * 将AI Function Calling转换为实际的canvas操作
 */

const REMOTE_RUN_KINDS = new Set([
  'composeVideo',
  'storyboard',
  'video',
  'tts',
  'subtitleAlign',
  'image',
  'textToImage',
])

const CREATIVE_PROMPT_KINDS = new Set(['image', 'texttoimage', 'composevideo'])

export class CanvasService {

  /**
   * 创建新节点
   */
  static async createNode(params: {
    type: string
    label?: string
    config?: Record<string, any> | null
    remixFromNodeId?: string
    position?: { x: number; y: number }
  }): Promise<FunctionResult> {
    try {
      console.debug('[CanvasService] createNode input', params)
      const store = useRFStore.getState()
      const prevIds = new Set(store.nodes.map(node => node.id))
      const { addNode, onConnect } = store

      // 生成默认位置（如果未提供）
      const position = params.position || CanvasService.generateDefaultPosition()

      const normalized = CanvasService.normalizeNodeParams(params)
      console.debug('[CanvasService] normalized node params', normalized)

      if ((normalized.data as any)?.kind === 'storyboard' || normalized.nodeType === 'storyboard') {
        return {
          success: false,
          error: 'Storyboard 节点暂未开放，请改用 composeVideo 节点生成视频内容'
        }
      }

      const nodeData = { ...normalized.data }

      if (normalized.remixFromNodeId) {
        const remixSource = store.nodes.find(node => node.id === normalized.remixFromNodeId)
        const remixKind = (remixSource?.data as any)?.kind
        const remixStatus = (remixSource?.data as any)?.status
        const supportedKinds = new Set(['composeVideo', 'video', 'storyboard'])
        if (!remixSource || !supportedKinds.has(remixKind)) {
          return {
            success: false,
            error: 'Remix 必须引用一个已有的视频/分镜节点。'
          }
        }
        if (remixStatus !== 'success') {
          return {
            success: false,
            error: 'Remix 只能基于已成功完成的视频节点，请等待前序节点完成。'
          }
        }

        if (!nodeData.prompt) {
          const sourcePrompt = (remixSource.data as any)?.videoPrompt || (remixSource.data as any)?.prompt
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
        position,
        autoLabel: !(params.label && params.label.trim()),
      })

      const updatedState = useRFStore.getState()
      const newNode = [...updatedState.nodes].reverse().find(node => !prevIds.has(node.id)) || updatedState.nodes[updatedState.nodes.length - 1]

      if (newNode && normalized.remixFromNodeId) {
        try {
          const sourceNode = updatedState.nodes.find(node => node.id === normalized.remixFromNodeId)
          if (sourceNode && typeof onConnect === 'function') {
            const connection: Connection = {
              source: sourceNode.id,
              target: newNode.id,
              targetHandle: 'in-video',
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

  private static normalizeNodeParams(params: {
    type: string
    label?: string
    config?: Record<string, any> | null
    remixFromNodeId?: string
  }): { nodeType: string; label: string; data: Record<string, any>; remixFromNodeId?: string } {
    const rawType = (params.type || 'taskNode').trim()
    const label = params.label?.trim() || CanvasService.defaultLabelForType(rawType)

    let nodeType = rawType
    const baseData: Record<string, any> = {}

    const logicalKinds: Record<string, string> = {
      text: 'textToImage',
      image: 'image',
      video: 'composeVideo',
      composeVideo: 'composeVideo',
      storyboard: 'storyboard',
      audio: 'tts',
      subtitle: 'subtitleAlign',
      character: 'character',
    }

    if (logicalKinds[rawType]) {
      nodeType = 'taskNode'
      baseData.kind = logicalKinds[rawType]
    }

    const safeConfig = params.config && typeof params.config === 'object' ? params.config : {}
    const { remixFromNodeId: configRemixFromNodeId, ...restConfig } = safeConfig as Record<string, any>
    const data: Record<string, any> = { ...baseData, ...restConfig }
    if (!data.prompt && label) {
      data.prompt = label
    }

    const enhancedPrompt = CanvasService.enhanceCreativePrompt(baseData.kind || logicalKinds[rawType] || rawType, data.prompt)
    if (enhancedPrompt) {
      data.prompt = enhancedPrompt.prompt
      if (!data.negativePrompt) {
        data.negativePrompt = enhancedPrompt.negativePrompt
      }
      if (!data.keywords && enhancedPrompt.keywords.length) {
        data.keywords = enhancedPrompt.keywords
      }
    }

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
    switch (type) {
      case 'text':
        return '文本'
      case 'image':
        return '图像'
      case 'video':
      case 'composeVideo':
        return '文生视频'
      case 'storyboard':
        return '分镜'
      case 'audio':
        return '语音'
      case 'subtitle':
        return '字幕'
      case 'character':
        return '角色'
      default:
        return type
    }
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
      const { updateNodeLabel, updateNodeData } = useRFStore.getState()

      if (params.label) {
        updateNodeLabel(params.nodeId, params.label)
      }

      if (params.config) {
        updateNodeData(params.nodeId, params.config)
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
    sourceNodeId: string
    targetNodeId: string
    sourceHandle?: string
    targetHandle?: string
  }): Promise<FunctionResult> {
    try {
      const { nodes, edges, onConnect } = useRFStore.getState()

      // 验证节点存在
      const sourceNode = nodes.find(n => n.id === params.sourceNodeId)
      const targetNode = nodes.find(n => n.id === params.targetNodeId)

      if (!sourceNode || !targetNode) {
        return {
          success: false,
          error: '源节点或目标节点不存在'
        }
      }

      // 检查是否已存在连接
      const existingEdge = edges.find(e =>
        e.source === params.sourceNodeId && e.target === params.targetNodeId
      )

      if (existingEdge) {
        return {
          success: false,
          error: '节点之间已存在连接'
        }
      }

      // 创建连接（复用 React Flow 的 onConnect 逻辑，含去重和动画）
      onConnect({
        source: params.sourceNodeId,
        target: params.targetNodeId,
        sourceHandle: params.sourceHandle,
        targetHandle: params.targetHandle
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
   * 执行 DAG
   */
  static async runDag(params: { concurrency?: number } = {}): Promise<FunctionResult> {
    try {
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
      const { nodeId } = params
      if (!nodeId) {
        return { success: false, error: '缺少节点 ID' }
      }

      const store = useRFStore.getState()
      const node = store.nodes.find(n => n.id === nodeId)
      if (!node) {
        return { success: false, error: '节点不存在，无法执行' }
      }

      const get = () => useRFStore.getState()
      const set = (fn: (s: any) => any) => useRFStore.setState(fn)
      const kind = (node.data as any)?.kind as string | undefined
      const shouldRunRemote = kind ? REMOTE_RUN_KINDS.has(kind) : false

      if (shouldRunRemote) {
        await runNodeRemote(nodeId, get, set)
      } else {
        await runNodeMock(nodeId, get, set)
      }

      return {
        success: true,
        data: { message: `已执行节点 ${(node.data as any)?.label || nodeId}` }
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
      const { selectAll, autoLayoutAllDag } = useRFStore.getState()
      selectAll()
      autoLayoutAllDag()
      return { success: true, data: { message: '已全选并自动布局' } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '自动格式化失败'
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
        filteredNodes = filteredNodes.filter(node =>
          node.data.label.toLowerCase().includes(params.label!.toLowerCase())
        )
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
      const { autoLayoutAllDag, autoLayoutSelectedDag, layoutHorizontalSelected } = useRFStore.getState()

      switch (params.layoutType) {
        case 'grid':
          // 网格布局
          autoLayoutAllDag()
          break
        case 'horizontal':
          // 水平布局
          layoutHorizontalSelected()
          break
        case 'hierarchical':
          // 层次布局
          autoLayoutAllDag()
          break
        default:
          return {
            success: false,
            error: `不支持的布局类型: ${params.layoutType}`
          }
      }

      return {
        success: true,
        data: { message: `已应用${params.layoutType}布局` }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '自动布局失败'
      }
    }
  }

  /**
   * 创意提示词润色，补充镜头语言与细节
   */
  private static enhanceCreativePrompt(kind?: string, prompt?: string) {
    if (!kind) return null
    const normalizedKind = kind.toLowerCase()
    if (!CREATIVE_PROMPT_KINDS.has(normalizedKind)) return null

    const seed = CanvasService.normalizePromptSeed(prompt)
    if (seed.length > 180) return null
    const subject = seed || 'an imaginative concept'
    const negativePrompt = 'low quality, blurry, lowres, distorted faces, watermark, duplicate, text overlay, bad composition'

    if (normalizedKind === 'composevideo') {
      const base = [
        `Cinematic short film shot about ${subject}`,
        'Describe the scene arc, character intent, and environment layering',
        'Camera language: tracking shot, low-angle inserts, smooth gimbal motion, controlled handheld energy',
        'Lighting: volumetric shafts, practical neon accents, dramatic rim light',
        'Mood: rich film grain, Dolby Vision grading, dynamic depth of field'
      ].join('. ')
      const enriched = buildVideoRealismPrompt(base)
      return {
        prompt: enriched,
        negativePrompt,
        keywords: ['cinematic', 'dynamic lighting', 'story-driven', '4k film', 'volumetric glow']
      }
    }

    const enriched = [
      `Ultra detailed illustration of ${subject}`,
      'Layered foreground/midground/background storytelling with tactile materials',
      'Lighting: cinematic rim lights, volumetric glow, high-contrast mood',
      'Lens: 50mm prime, shallow depth of field, hyperreal focus',
      'Finish: 8K render, HDR toning, clean composition'
    ].join('. ')

    return {
      prompt: enriched,
      negativePrompt,
      keywords: ['ultra detailed', '8k render', 'dramatic lighting', 'volumetric glow', 'photoreal texture']
    }
  }

  private static normalizePromptSeed(value?: string) {
    if (!value) return ''
    return value.replace(/\s+/g, ' ').trim()
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
}

// 工具函数映射
export const functionHandlers = {
  createNode: CanvasService.createNode,
  updateNode: CanvasService.updateNode,
  deleteNode: CanvasService.deleteNode,
  connectNodes: CanvasService.connectNodes,
  disconnectNodes: CanvasService.disconnectNodes,
  getNodes: CanvasService.getNodes,
  findNodes: CanvasService.findNodes,
  autoLayout: CanvasService.autoLayout,
  runNode: CanvasService.runNode,
  runDag: CanvasService.runDag,
  formatAll: CanvasService.formatAll,
} as const
