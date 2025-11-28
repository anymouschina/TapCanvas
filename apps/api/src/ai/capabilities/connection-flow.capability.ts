import { CanvasCapability, CanvasActionDomain } from '../core/types/canvas-intelligence.types'
import { canvasCapabilityRegistry } from '../core/canvas-registry'

export const ConnectionFlowCapability: CanvasCapability = {
  domain: CanvasActionDomain.CONNECTION_FLOW,
  name: '节点连线调整',
  description: '智能连接、断开或重连工作流节点，保持数据流顺畅',

  operationModes: [
    {
      type: 'direct',
      description: '单次连接/断开操作',
      parameters: [
        {
          name: 'action',
          type: 'enum',
          description: '操作类型',
          options: ['connect', 'disconnect', 'reconnect'],
          default: 'connect'
        },
        {
          name: 'sourceNodeId',
          type: 'string',
          description: '源节点 ID',
          required: false
        },
        {
          name: 'targetNodeId',
          type: 'string',
          description: '目标节点 ID',
          required: false
        },
        {
          name: 'edgeId',
          type: 'string',
          description: '要断开的连线 ID（disconnect 时可选）',
          required: false
        }
      ]
    },
    {
      type: 'batch',
      description: '批量连线',
      parameters: [
        {
          name: 'connections',
          type: 'array',
          description: '待连接的 {sourceNodeId, targetNodeId} 列表',
          required: true
        }
      ]
    }
  ],

  intentPatterns: [
    {
      patterns: [
        '连接.*节点', '把.*连.*', '自动连线', '建立连接', '补全连线', '串起来'
      ],
      confidence: 0.9,
      examples: [
        '把图片节点连到视频节点',
        '自动连接所有相邻节点',
        '补上缺失的线'
      ]
    },
    {
      patterns: [
        '断开.*连接', '删除连线', '取消连接'
      ],
      confidence: 0.85,
      examples: [
        '断开这两个节点',
        '删除这条线'
      ]
    }
  ],

  webActions: {
    frontendFunction: 'canvas.connectionFlow',
    eventType: 'canvas.connection.operation',
    apiCall: {
      method: 'POST',
      endpoint: '/api/canvas/connections',
      payload: {
        action: '{{action}}',
        parameters: '{{extracted_params}}'
      }
    },
    socketMessage: {
      channel: 'canvas.connections',
      payload: {
        action: '{{action}}',
        data: '{{extracted_params}}',
        timestamp: '{{current_time}}'
      }
    }
  },

  prerequisites: ['需要可用的节点 ID'],
  sideEffects: [
    '连接变更会影响后续节点的输入输出顺序'
  ]
}

export const registerConnectionFlowCapability = () => {
  canvasCapabilityRegistry.register(ConnectionFlowCapability)
}
