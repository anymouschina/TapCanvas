/**
 * AI助手工具定义
 * 为AI助手提供画布节点操作的工具接口
 */

import { useRFStore } from '../store'
import { NODE_KINDS, NODE_TYPES } from '../utils/constants'
import type { Node } from 'reactflow'

// 工具参数接口定义
export interface AddNodeToolParams {
  type: string
  label?: string
  position?: { x: number; y: number }
  config?: Record<string, any>
}

export interface EditNodeToolParams {
  nodeId: string
  label?: string
  config?: Record<string, any>
  status?: 'idle' | 'queued' | 'running' | 'success' | 'error'
}

export interface DeleteNodeToolParams {
  nodeId: string
}

export interface ConnectNodesToolParams {
  sourceId: string
  targetId: string
  sourceHandle?: string
  targetHandle?: string
}

export interface FindNodesToolParams {
  type?: string
  kind?: string
  label?: string
  status?: string
}

export interface GetCanvasInfoToolParams {
  includeData?: boolean
}

// 工具执行结果接口定义
export interface ToolResult {
  success: boolean
  message?: string
  data?: any
  error?: string
}

// AI工具定义类
export class AICanvasTools {
  private getStore() {
    return useRFStore.getState()
  }

  /**
   * 添加节点工具
   */
  async addNode(params: AddNodeToolParams): Promise<ToolResult> {
    try {
      const { type, label, position, config } = params
      const store = this.getStore()

      const kindAliases: Record<string, string> = {
        text: NODE_KINDS.TEXT,
        image: NODE_KINDS.IMAGE,
        video: 'composeVideo',
        composeVideo: 'composeVideo',
        audio: NODE_KINDS.AUDIO,
        subtitle: NODE_KINDS.SUBTITLE,
        character: 'character',
      }

      const resolvedType = Object.values(NODE_TYPES).includes(type as any) ? type : NODE_TYPES.TASK
      const aliasKind = !Object.values(NODE_TYPES).includes(type as any) ? kindAliases[type] : undefined

      // 验证节点类型
      if (!Object.values(NODE_TYPES).includes(resolvedType as any)) {
        return {
          success: false,
          error: `无效的节点类型: ${type}。支持的类型: ${Object.values(NODE_TYPES).join(', ')} 或别名 ${Object.keys(kindAliases).join(', ')}`
        }
      }

      const normalizedKind = (() => {
        const rawKind = config?.kind ?? aliasKind
        if (rawKind === 'video') return NODE_KINDS.VIDEO?.replace('video', 'composeVideo') || 'composeVideo'
        if (rawKind === undefined) return NODE_KINDS.TEXT
        return rawKind
      })()

      const fallbackLabel = label || `新建${aliasKind || resolvedType}`

      // 添加节点到画布
      store.addNode(resolvedType, fallbackLabel, {
        kind: normalizedKind,
        ...config
      })

      // 如果指定了位置，更新位置
      if (position) {
        const nodes = store.nodes
        const newNode = nodes[nodes.length - 1]
        if (newNode) {
          store.updateNodeData(newNode.id, {
            ...newNode.data,
            position
          })
          // 更新节点位置
          useRFStore.setState(state => ({
            nodes: state.nodes.map(n =>
              n.id === newNode.id
                ? { ...n, position }
                : n
            )
          }))
        }
      }

      return {
        success: true,
        message: `成功添加节点: ${label || type}`,
        data: { nodeId: store.nodes[store.nodes.length - 1]?.id }
      }
    } catch (error) {
      return {
        success: false,
        error: `添加节点失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 编辑节点工具
   */
  async editNode(params: EditNodeToolParams): Promise<ToolResult> {
    try {
      const { nodeId, label, config, status } = params
      const store = this.getStore()
      const node = store.nodes.find(n => n.id === nodeId)

      if (!node) {
        return {
          success: false,
          error: `未找到节点: ${nodeId}`
        }
      }

      // 更新节点标签
      if (label !== undefined) {
        store.updateNodeLabel(nodeId, label)
      }

      // 更新节点配置
      if (config) {
        store.updateNodeData(nodeId, {
          ...node.data,
          ...config
        })
      }

      // 更新节点状态
      if (status) {
        store.setNodeStatus(nodeId, status)
      }

      return {
        success: true,
        message: `成功更新节点: ${nodeId}`
      }
    } catch (error) {
      return {
        success: false,
        error: `更新节点失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 删除节点工具
   */
  async deleteNode(params: DeleteNodeToolParams): Promise<ToolResult> {
    try {
      const { nodeId } = params
      const store = this.getStore()
      const node = store.nodes.find(n => n.id === nodeId)

      if (!node) {
        return {
          success: false,
          error: `未找到节点: ${nodeId}`
        }
      }

      store.deleteNode(nodeId)

      return {
        success: true,
        message: `成功删除节点: ${nodeId}`
      }
    } catch (error) {
      return {
        success: false,
        error: `删除节点失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 连接节点工具
   */
  async connectNodes(params: ConnectNodesToolParams): Promise<ToolResult> {
    try {
      const { sourceId, targetId, sourceHandle, targetHandle } = params
      const store = this.getStore()

      const sourceNode = store.nodes.find(n => n.id === sourceId)
      const targetNode = store.nodes.find(n => n.id === targetId)

      if (!sourceNode) {
        return {
          success: false,
          error: `未找到源节点: ${sourceId}`
        }
      }

      if (!targetNode) {
        return {
          success: false,
          error: `未找到目标节点: ${targetId}`
        }
      }

      // 创建连接
      store.onConnect({
        source: sourceId,
        target: targetId,
        sourceHandle: sourceHandle || 'output',
        targetHandle: targetHandle || 'input'
      })

      return {
        success: true,
        message: `成功连接节点: ${sourceId} -> ${targetId}`
      }
    } catch (error) {
      return {
        success: false,
        error: `连接节点失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 查找节点工具
   */
  async findNodes(params: FindNodesToolParams): Promise<ToolResult> {
    try {
      const { type, kind, label, status } = params
      const store = this.getStore()

      let filteredNodes = store.nodes

      if (type) {
        filteredNodes = filteredNodes.filter(n => n.type === type)
      }

      if (kind) {
        filteredNodes = filteredNodes.filter(n => (n.data as any)?.kind === kind)
      }

      if (label) {
        filteredNodes = filteredNodes.filter(n =>
          (n.data as any)?.label?.toLowerCase().includes(label.toLowerCase())
        )
      }

      if (status) {
        filteredNodes = filteredNodes.filter(n => (n.data as any)?.status === status)
      }

      const nodeInfo = filteredNodes.map(n => ({
        id: n.id,
        type: n.type,
        label: (n.data as any)?.label,
        kind: (n.data as any)?.kind,
        status: (n.data as any)?.status,
        position: n.position
      }))

      return {
        success: true,
        message: `找到 ${nodeInfo.length} 个节点`,
        data: nodeInfo
      }
    } catch (error) {
      return {
        success: false,
        error: `查找节点失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 获取画布信息工具
   */
  async getCanvasInfo(params: GetCanvasInfoToolParams): Promise<ToolResult> {
    try {
      const { includeData = false } = params
      const store = this.getStore()

      const nodes = store.nodes
      const edges = store.edges

      const info = {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        nodeTypes: [...new Set(nodes.map(n => n.type))],
        nodeKinds: [...new Set(nodes.map(n => (n.data as any)?.kind).filter(Boolean))],
        positions: nodes.map(n => ({ id: n.id, position: n.position }))
      }

      if (includeData) {
        (info as any).nodes = nodes.map(n => ({
          id: n.id,
          type: n.type,
          label: (n.data as any)?.label,
          kind: (n.data as any)?.kind,
          status: (n.data as any)?.status,
          config: (n.data as any)?.config,
          position: n.position
        }))
        (info as any).edges = edges.map(e => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle
        }))
      }

      return {
        success: true,
        message: '获取画布信息成功',
        data: info
      }
    } catch (error) {
      return {
        success: false,
        error: `获取画布信息失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 获取所有可用工具列表
   */
  getAvailableTools() {
    return [
      {
        name: 'add_node',
        description: '添加新节点到画布',
        parameters: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: `节点类型，可选值: ${Object.values(NODE_TYPES).join(', ')}`
            },
            label: {
              type: 'string',
              description: '节点标签（可选）'
            },
            position: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' }
              },
              description: '节点位置（可选）'
            },
            config: {
              type: 'object',
              description: '节点配置（可选）'
            }
          },
          required: ['type']
        }
      },
      {
        name: 'edit_node',
        description: '编辑现有节点',
        parameters: {
          type: 'object',
          properties: {
            nodeId: { type: 'string', description: '节点ID' },
            label: { type: 'string', description: '节点标签（可选）' },
            config: { type: 'object', description: '节点配置（可选）' },
            status: {
              type: 'string',
              description: '节点状态（可选），可选值: idle, queued, running, success, error'
            }
          },
          required: ['nodeId']
        }
      },
      {
        name: 'delete_node',
        description: '删除指定节点',
        parameters: {
          type: 'object',
          properties: {
            nodeId: { type: 'string', description: '要删除的节点ID' }
          },
          required: ['nodeId']
        }
      },
      {
        name: 'connect_nodes',
        description: '连接两个节点',
        parameters: {
          type: 'object',
          properties: {
            sourceId: { type: 'string', description: '源节点ID' },
            targetId: { type: 'string', description: '目标节点ID' },
            sourceHandle: { type: 'string', description: '源节点手柄（可选）' },
            targetHandle: { type: 'string', description: '目标节点手柄（可选）' }
          },
          required: ['sourceId', 'targetId']
        }
      },
      {
        name: 'find_nodes',
        description: '查找符合条件的节点',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', description: '节点类型（可选）' },
            kind: { type: 'string', description: '节点种类（可选）' },
            label: { type: 'string', description: '节点标签搜索（可选）' },
            status: { type: 'string', description: '节点状态（可选）' }
          },
          required: []
        }
      },
      {
        name: 'get_canvas_info',
        description: '获取画布信息',
        parameters: {
          type: 'object',
          properties: {
            includeData: {
              type: 'boolean',
              description: '是否包含详细节点和边数据（可选）'
            }
          },
          required: []
        }
      }
    ]
  }
}

// 导出单例实例
export const aiCanvasTools = new AICanvasTools()
