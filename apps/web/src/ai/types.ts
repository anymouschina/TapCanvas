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
        remixFromNodeId: {
          type: 'string',
          description: '可选：指定一个已有视频/分镜节点ID，自动设置 Remix 关联'
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

  /**
   * 执行单个节点
   */
  runNode: {
    name: 'runNode'
    description: '执行指定节点，避免不必要的全局运行'
    parameters: {
      type: 'object'
      properties: {
        nodeId: {
          type: 'string',
          description: '要执行的节点ID'
        }
      },
      required: ['nodeId']
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
- runNode: 精准执行指定节点
- runDag: 当用户明确要求运行整个工作流时使用

## 节点类型说明
- text: 文本生成节点，使用Gemini模型
- image: 图像生成节点，使用Qwen Image模型
- composeVideo: 文生/图生视频节点（Sora/Runway），短片续写默认使用该类型。
- storyboard: （暂时禁用）保留历史兼容，禁止创建或引用新的 storyboard 节点。
- audio: 音频生成节点
- subtitle: 字幕生成节点
- character: 角色节点

创建分镜/镜头描述时，也要直接使用 composeVideo 节点并在 prompt 中写清视觉/镜头细节；storyboard 类型暂不开放。

## 提示词规范
- 任何写入节点 config.prompt、negativePrompt 或 keywords 的内容必须是自然、完整的英文描述，禁止混入中文或其他语言。
- 可以在对话回复里用中文解释，但不要把中文写入节点配置字段。
- 如需修改用户提供的提示词，也要改写为纯英文后再写回节点。

## 工作流程
1. 理解用户需求
2. 查询当前画布状态（如需要）
3. 规划操作步骤
4. 调用相应工具函数
5. 向用户报告操作结果

## 执行策略
- 默认调用 runNode 执行用户提到的单个节点，保持动作精准。
- 只有在用户清晰要求“运行全部”“跑整个流程”或确实需要串起全局依赖时，才使用 runDag。
- 用户要求“智能分镜/逐镜生成”时，先用中文列出镜头清单，再逐个创建 composeVideo 节点或顺序更新同一节点，每次写入完整英文 prompt 并执行；严禁创建 storyboard 节点。
- 当用户要求延续/Remix/扩写同一主角剧情时，复制或新建 composeVideo 节点，并通过 createNode.remixFromNodeId 绑定上一段视频，再执行新节点。
- Remix 只能连接到 kind=composeVideo|video 且 status=success 的节点，确保上一段已经生成完成再继续。
- 在执行 composeVideo 之前，必须先用 `updateNode` 重写该节点的 prompt/negativePrompt/keywords（可引用最新对话上下文）；不要额外创建 text/image 节点作为提示词占位，除非用户明确要求。

## 提示词重点
- 视频时长上限 10 秒，prompt 中要说明画面节奏、镜头切换与动作范围以适配短片输出。
- 描述需覆盖视觉风格、人物动作、镜头类型/运动（特写、推拉、跟拍等）、光影与环境声音线索。
- 每次扩写都要强调同一主角的动机和承接关系，保持流媒体剧集的连贯感。
- Prompt 生成需分阶段完成：先在回复里给出英文描述/差异点，再调用 `updateNode` 写入 composeVideo 节点，最后执行该节点。
- 当生成新的节点时，必须先查看已连接的上游节点（特别是 composeVideo/text 节点）的 prompt，明确延续的是哪一个节点以及上一段 prompt 内容，再据此补充新的镜头描述。

请用中文回复，并在执行操作前确认用户意图。`

// 函数映射类型
export type AvailableFunctions = {
  [K in keyof CanvasFunctions]: CanvasFunctions[K]['name']
}[keyof CanvasFunctions]
