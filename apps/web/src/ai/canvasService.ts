import { useRFStore } from '../canvas/store'
import { FunctionResult } from './types'

/**
 * Canvas操作服务层
 * 将AI Function Calling转换为实际的canvas操作
 */

export class CanvasService {

  /**
   * 创建新节点
   */
  static async createNode(params: {
    type: string
    label?: string
    config?: Record<string, any> | null
    position?: { x: number; y: number }
  }): Promise<FunctionResult> {
    try {
      console.debug('[CanvasService] createNode input', params)
      const store = useRFStore.getState()
      const prevIds = new Set(store.nodes.map(node => node.id))
      const { addNode } = store

      // 生成默认位置（如果未提供）
      const position = params.position || CanvasService.generateDefaultPosition()

      const normalized = CanvasService.normalizeNodeParams(params)
      console.debug('[CanvasService] normalized node params', normalized)

      // 调用store方法创建节点
      addNode(normalized.nodeType, normalized.label, {
        ...normalized.data,
        position
      })

      const updatedState = useRFStore.getState()
      const newNode = [...updatedState.nodes].reverse().find(node => !prevIds.has(node.id)) || updatedState.nodes[updatedState.nodes.length - 1]

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
  }): { nodeType: string; label: string; data: Record<string, any> } {
    const rawType = (params.type || 'taskNode').trim()
    const label = params.label?.trim() || CanvasService.defaultLabelForType(rawType)

    const baseData: Record<string, any> = { label }
    let nodeType = rawType

    const logicalKinds: Record<string, string> = {
      text: 'text',
      image: 'image',
      video: 'composeVideo',
      composeVideo: 'composeVideo',
      storyboard: 'storyboard',
      audio: 'audio',
      subtitle: 'subtitle',
      character: 'character',
    }

    if (logicalKinds[rawType]) {
      nodeType = 'taskNode'
      baseData.kind = logicalKinds[rawType]
    }

    const safeConfig = params.config && typeof params.config === 'object' ? params.config : {}
    const data = { ...baseData, ...safeConfig }
    if (!data.prompt && label) {
      data.prompt = label
    }

    return { nodeType, label, data }
  }

  private static defaultLabelForType(type: string) {
    switch (type) {
      case 'text':
        return '文本提示'
      case 'image':
        return '图像生成'
      case 'video':
      case 'composeVideo':
      case 'storyboard':
        return '文生视频'
      case 'audio':
        return '音频节点'
      case 'subtitle':
        return '字幕节点'
      case 'character':
        return '角色节点'
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
  runDag: CanvasService.runDag,
  formatAll: CanvasService.formatAll,
} as const
