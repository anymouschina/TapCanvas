import { CanvasCapability, CanvasActionDomain } from '../core/types/canvas-intelligence.types'
import { canvasCapabilityRegistry } from '../core/canvas-registry'

export const NodeManipulationCapability: CanvasCapability = {
  domain: CanvasActionDomain.NODE_MANIPULATION,
  name: '智能节点操作',
  description: '智能创建、修改、删除和组织节点，支持批量操作和智能配置',

  operationModes: [
    {
      type: 'direct',
      description: '单个节点操作',
      parameters: [
        {
          name: 'action',
          type: 'enum',
          description: '操作类型',
          options: ['create', 'update', 'delete', 'duplicate'],
          default: 'create'
        },
        {
          name: 'nodeType',
          type: 'enum',
          description: '节点类型',
          options: ['text', 'image', 'video', 'audio', 'storyboard'],
          required: false
        },
        {
          name: 'position',
          type: 'object',
          description: '节点位置 {x, y}',
          required: false
        },
        {
          name: 'config',
          type: 'object',
          description: '节点配置参数',
          required: false
        }
      ]
    },
    {
      type: 'batch',
      description: '批量节点操作',
      parameters: [
        {
          name: 'operations',
          type: 'array',
          description: '批量操作列表',
          required: true
        },
        {
          name: 'previewMode',
          type: 'boolean',
          description: '预览模式，不实际执行',
          default: false
        }
      ]
    },
    {
      type: 'conditional',
      description: '条件智能操作',
      parameters: [
        {
          name: 'condition',
          type: 'enum',
          description: '操作条件',
          options: ['by_type', 'by_connection_count', 'by_config', 'by_position'],
          default: 'by_type'
        },
        {
          name: 'autoConfigure',
          type: 'boolean',
          description: '是否自动配置节点参数',
          default: true
        }
      ]
    }
  ],

  intentPatterns: [
    {
      patterns: [
        '创建.*节点', '新建.*', '添加.*', '增加.*', '生成.*节点',
        '做一个.*', '我要.*', '建一个.*', '来个.*'
      ],
      confidence: 0.9,
      context: ['empty_canvas', 'workflow_building'],
      examples: [
        '创建一个文本节点',
        '添加图片生成节点',
        '我要做一个视频节点',
        '来个音频处理节点'
      ]
    },
    {
      patterns: [
        '删除.*节点', '移除.*', '去掉.*', '清除.*',
        '不要.*', '删掉.*', '移出.*'
      ],
      confidence: 0.85,
      examples: [
        '删除这个节点',
        '移除所有文本节点',
        '清除不需要的节点'
      ]
    },
    {
      patterns: [
        '修改.*节点', '更改.*', '调整.*', '设置.*', '配置.*',
        '改.*配置', '更新.*参数'
      ],
      confidence: 0.8,
      examples: [
        '修改这个节点的配置',
        '调整图像节点的参数',
        '设置视频节点的分辨率'
      ]
    },
    {
      patterns: [
        '文生图', 'text to image', '生成图片', '图片生成',
        'ai绘画', '图像生成', '创建图片'
      ],
      confidence: 0.95,
      context: ['creative_workflow'],
      examples: [
        '创建一个文生图节点',
        '我要生成图片',
        '添加text to image功能'
      ]
    },
    {
      patterns: [
        '文生视频', 'text to video', '生成视频', '视频生成',
        'ai视频', '创建视频'
      ],
      confidence: 0.95,
      examples: [
        '创建文生视频节点',
        '我要生成视频',
        '添加视频生成功能'
      ]
    },
    {
      patterns: [
        '批量.*', '全都.*', '所有.*', '每个.*',
        '一起.*', '统一.*'
      ],
      confidence: 0.8,
      examples: [
        '批量创建节点',
        '删除所有文本节点',
        '统一设置参数'
      ]
    }
  ],

  webActions: {
    frontendFunction: 'canvas.nodeManipulation',
    eventType: 'canvas.node.operation',
    apiCall: {
      method: 'POST',
      endpoint: '/api/canvas/nodes',
      payload: {
        operation: '{{action}}',
        parameters: '{{extracted_params}}'
      }
    },
    socketMessage: {
      channel: 'canvas.nodes',
      payload: {
        action: '{{action}}',
        data: '{{extracted_params}}',
        timestamp: '{{current_time}}'
      }
    }
  },

  prerequisites: ['根据操作类型而定'],
  sideEffects: [
    '创建节点会影响画布结构',
    '删除节点可能删除相关连接',
    '修改参数可能影响执行结果'
  ]
}

export const registerNodeManipulationCapability = () => {
  canvasCapabilityRegistry.register(NodeManipulationCapability)
}