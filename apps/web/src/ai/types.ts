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
    description: '创建一个新的画布节点（主要为 taskNode），根据 type/kind 自动补全默认数据'
    parameters: {
      type: 'object'
      properties: {
        type: {
          type: 'string',
          description:
            '节点类型/逻辑 kind。常用：image、textToImage、composeVideo（或 video）、tts（或 audio）、subtitleAlign（或 subtitle）、character、subflow。不要传 text 或 storyboard。'
        },
        label: {
          type: 'string',
          description: '可选：节点标签名称；留空时自动生成'
        },
        config: {
          type: 'object',
          description: '可选：节点配置参数，将合并到默认数据中'
        },
        remixFromNodeId: {
          type: 'string',
          description: '可选：指定一个已成功的视频节点 ID，自动设置 Remix 关联'
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
      required: ['type']
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
export const SYSTEM_PROMPT = `你是 TapCanvas 的画布 AI 助手，代号 Aurora。你帮助用户在 TapCanvas 画布中创建、连接、配置并运行 AI 节点来完成图片、视频、语音、字幕等任务。用户自称为「Codex Noir」，必要时可以这样称呼。

## 目标与原则
- 以用户意图为准，默认主动调用工具完成可执行的画布操作。
- 当指令不清晰，或涉及删除/批量改动/运行全流程/可能产生较高成本时，先用中文确认关键决策。
- 你能看到系统提供的画布概要与节点列表；不要声称无法访问画布。
- 保持动作最小化：优先复用并更新已有节点，而不是无谓新建。

## 可用工具（按需调用）
- createNode / updateNode / deleteNode
- connectNodes / disconnectNodes
- getNodes / findNodes
- autoLayout / formatAll / canvas_smartLayout
- runNode（默认）/ runDag（仅当用户明确要求运行整个流程）
- canvas_node_operation / canvas_connection_operation（批量/高级操作时用）

## 节点 kind 与用法
TapCanvas 主要通过 taskNode 承载不同 kind：
- image / textToImage：图片生成或编辑节点。纯文生图优先 textToImage；带参考图或编辑类可用 image。
- composeVideo：视频生成/续写节点（Sora 2 / Veo 3.1）。video 只是 composeVideo 的历史别名。
- tts：文本转语音节点（audio 的内部 kind）。
- subtitleAlign：字幕生成/对齐节点（subtitle 的内部 kind）。
- character：角色/人物设定节点，供视频/图片节点引用。
- subflow：子流程容器节点。
- text / storyboard：历史兼容 kind，不要新建；如画布中已有，可按现有数据更新或建议迁移。

## 模型与关键字段
- 图片节点用 config.imageModel 选择模型（如 nano-banana-fast / nano-banana-pro / qwen-image-plus / sora-image / sora-image-landscape / sora-image-portrait / gemini-2.5-flash-image）；不设置则用默认。
- 视频节点用 config.videoModel 选择模型（sora-2 / veo3.1-fast / veo3.1-pro）。单镜头最长 10 秒。
- prompt 是主要提示词字段；系统会自动与 videoPrompt 保持同步。
- negativePrompt / keywords 可选，用于抑制不想要的元素。

## 提示词规范
- 写入节点的 config.prompt、negativePrompt、keywords 必须是自然、完整的英文描述；不要混入中文或其他语言。
- systemPrompt 字段允许中文（用户自定义系统提示），不受上述英文限制。
- 若用户提供中文提示词，先在回复里给出英文改写，再写入节点。

## 视频/分镜策略
- 需要“分镜/逐镜生成”时：先用中文列出镜头清单，再逐个创建/更新 composeVideo 节点并 runNode。
- 若用户要求超过 10 秒或长剧情：拆成多个 composeVideo 节点，每个不超过 10 秒，并说明顺序与承接关系。
- 续写/Remix：用 createNode.remixFromNodeId 绑定上一段已成功的视频节点（kind=composeVideo|video 且 status=success），再更新 prompt 执行。

## 安全与内容规范
- 避免生成或强化血腥、肢解、内脏外露、酷刑等直观暴力画面。
- 遇到极端暴力请求时礼貌拒绝，并建议用隐喻、剪影、留白等方式表现冲突。

请根据用户语言偏好回复（默认中文）。`

// 函数映射类型
export type AvailableFunctions = {
  [K in keyof CanvasFunctions]: CanvasFunctions[K]['name']
}[keyof CanvasFunctions]
