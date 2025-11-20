/**
 * AI Function Calling 接口定义
 * 定义AI助手操作canvas所需的所有工具函数
 */

// 基础节点类型
export type NodeKind = 'text' | 'image' | 'video' | 'audio' | 'subtitle' | 'subflow' | 'run' | 'empty' | 'image-upscale'

// Function Calling 基础类型
export interface FunctionCall {
  name: string
  arguments: Record<string, any>
}

export interface FunctionResult {
  success: boolean
  data?: any
  error?: string
}

// Canvas操作函数定义
export interface CanvasFunctions {
  // === 节点操作 ===

  /**
   * 创建新节点
   * @param type 节点类型 ('text'|'image'|'video'|'audio'|'subtitle')
   * @param label 节点标签
   * @param config 节点配置
   * @param position 可选位置 {x, y}
   */
  createNode: {
    name: 'createNode'
    description: '创建一个新的AI工作流节点'
    parameters: {
      type: 'object'
      properties: {
        type: {
          type: 'string',
          enum: ['text', 'image', 'video', 'audio', 'subtitle'],
          description: '节点类型：text(文本生成), image(图像生成), video(视频生成), audio(音频生成), subtitle(字幕生成)'
        },
        label: {
          type: 'string',
          description: '节点标签名称'
        },
        config: {
          type: 'object',
          description: '节点配置参数，根据type不同而不同'
        },
        position: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' }
          },
          description: '节点位置坐标，可选'
        }
      },
      required: ['type', 'label']
    }
  }

  /**
   * 更新节点数据
   * @param nodeId 节点ID
   * @param label 新标签
   * @param config 新配置
   */
  updateNode: {
    name: 'updateNode'
    description: '更新现有节点的配置和属性'
    parameters: {
      type: 'object'
      properties: {
        nodeId: { type: 'string', description: '要更新的节点ID' },
        label: { type: 'string', description: '新的节点标签' },
        config: { type: 'object', description: '新的节点配置' }
      },
      required: ['nodeId']
    }
  }

  /**
   * 删除节点
   * @param nodeId 节点ID
   */
  deleteNode: {
    name: 'deleteNode'
    description: '删除指定的节点及其相关连接'
    parameters: {
      type: 'object'
      properties: {
        nodeId: { type: 'string', description: '要删除的节点ID' }
      },
      required: ['nodeId']
    }
  }

  /**
   * 连接两个节点
   * @param sourceNodeId 源节点ID
   * @param targetNodeId 目标节点ID
   * @param sourceHandle 源节点输出端口
   * @param targetHandle 目标节点输入端口
   */
  connectNodes: {
    name: 'connectNodes'
    description: '在两个节点之间创建连接'
    parameters: {
      type: 'object'
      properties: {
        sourceNodeId: { type: 'string', description: '源节点ID' },
        targetNodeId: { type: 'string', description: '目标节点ID' },
        sourceHandle: { type: 'string', description: '源节点输出端口名称' },
        targetHandle: { type: 'string', description: '目标节点输入端口名称' }
      },
      required: ['sourceNodeId', 'targetNodeId']
    }
  }

  /**
   * 断开节点连接
   * @param edgeId 边ID
   */
  disconnectNodes: {
    name: 'disconnectNodes'
    description: '删除两个节点之间的连接'
    parameters: {
      type: 'object'
      properties: {
        edgeId: { type: 'string', description: '要删除的连接边ID' }
      },
      required: ['edgeId']
    }
  }

  // === 查询操作 ===

  /**
   * 获取画布中的所有节点
   */
  getNodes: {
    name: 'getNodes'
    description: '获取当前画布中的所有节点信息'
    parameters: {
      type: 'object',
      properties: {}
    }
  }

  /**
   * 查找特定节点
   * @param label 节点标签
   * @param type 节点类型
   */
  findNodes: {
    name: 'findNodes'
    description: '根据标签或类型查找节点'
    parameters: {
      type: 'object'
      properties: {
        label: { type: 'string', description: '节点标签（支持模糊匹配）' },
        type: {
          type: 'string',
          enum: ['text', 'image', 'video', 'audio', 'subtitle'],
          description: '节点类型'
        }
      }
    }
  }

  // === 布局操作 ===

  /**
   * 自动布局选中节点
   * @param layoutType 布局类型
   */
  autoLayout: {
    name: 'autoLayout'
    description: '对节点进行自动布局排列'
    parameters: {
      type: 'object'
      properties: {
        layoutType: {
          type: 'string',
          enum: ['grid', 'horizontal', 'hierarchical'],
          description: '布局类型：grid(网格), horizontal(水平), hierarchical(层次)'
        }
      },
      required: ['layoutType']
    }
  }
}

// 系统提示词
export const SYSTEM_PROMPT = `你是TapCanvas AI助手，专门帮助用户创建和管理AI工作流。

## 你的能力
你可以帮助用户：
1. 创建各种AI节点（文本、图像、视频、音频、字幕生成）
2. 连接节点构建工作流
3. 修改节点配置
4. 删除不需要的节点
5. 自动布局节点
6. 查询当前画布状态

## 可用工具
- createNode: 创建新节点
- updateNode: 更新节点配置
- deleteNode: 删除节点
- connectNodes: 连接节点
- disconnectNodes: 断开连接
- getNodes: 查看所有节点
- findNodes: 查找特定节点
- autoLayout: 自动布局

## 节点类型说明
- text: 文本生成节点，使用Gemini模型
- image: 图像生成节点，使用Qwen Image模型
- video: 视频生成节点，使用Sora 2模型
- audio: 音频生成节点
- subtitle: 字幕生成节点

## 工作流程
1. 理解用户需求
2. 查询当前画布状态（如需要）
3. 规划操作步骤
4. 调用相应工具函数
5. 向用户报告操作结果

请用中文回复，并在执行操作前确认用户意图。`

// 函数映射类型
export type AvailableFunctions = {
  [K in keyof CanvasFunctions]: CanvasFunctions[K]['name']
}[keyof CanvasFunctions]