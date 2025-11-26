import { CanvasCapability, CanvasActionDomain } from '../core/types/canvas-intelligence.types'
import { canvasCapabilityRegistry } from '../core/canvas-registry'

export const LayoutArrangementCapability: CanvasCapability = {
  domain: CanvasActionDomain.LAYOUT_ARRANGEMENT,
  name: '智能布局排列',
  description: '自动整理和优化画布布局，支持多种布局算法和智能排列',

  operationModes: [
    {
      type: 'direct',
      description: '立即执行自动布局',
      parameters: [
        {
          name: 'layoutType',
          type: 'enum',
          description: '布局算法类型',
          options: ['grid', 'hierarchical', 'circular', 'force-directed'],
          default: 'grid'
        },
        {
          name: 'alignment',
          type: 'enum',
          description: '对齐方式',
          options: ['left', 'center', 'right', 'top', 'middle', 'bottom'],
          default: 'center'
        },
        {
          name: 'spacing',
          type: 'number',
          description: '节点间距',
          default: 100,
          required: false
        },
        {
          name: 'animationDuration',
          type: 'number',
          description: '动画时长（毫秒）',
          default: 800,
          required: false
        }
      ]
    },
    {
      type: 'batch',
      description: '批量操作指定节点',
      parameters: [
        {
          name: 'nodeIds',
          type: 'array',
          description: '要排列的节点ID列表',
          required: true
        },
        {
          name: 'arrangement',
          type: 'enum',
          description: '排列方式',
          options: ['horizontal', 'vertical', 'grid'],
          default: 'grid'
        }
      ]
    },
    {
      type: 'conditional',
      description: '基于条件智能排列',
      parameters: [
        {
          name: 'condition',
          type: 'enum',
          description: '排列条件',
          options: ['by_type', 'by_connection', 'by_size', 'by_name'],
          default: 'by_type'
        },
        {
          name: 'preserveGroups',
          type: 'boolean',
          description: '是否保留现有分组',
          default: true
        }
      ]
    }
  ],

  intentPatterns: [
    {
      patterns: [
        '整理一下', '自动布局', '排个版', '对齐', '整理布局', '重新排列',
        '布局优化', '自动排版', '整齐排列', '整理画布'
      ],
      confidence: 0.9,
      context: ['many_nodes', 'messy_canvas'],
      examples: [
        '帮我把这些节点整理整齐',
        '自动布局一下工作流',
        '把所有节点对齐到左边',
        '排成网格布局',
        '画布太乱了，整理一下'
      ]
    },
    {
      patterns: [
        '太乱了', '看不清', '重叠', '很乱', '找不到', '混乱'
      ],
      confidence: 0.8,
      context: ['overlapping_nodes', 'disorganized'],
      examples: [
        '画布太乱了，帮我整理一下',
        '这些节点都重叠了，重新排列',
        '工作流看不清楚，重新排一下版'
      ]
    },
    {
      patterns: [
        '网格布局', '层次布局', '环形布局', '力导布局',
        '横向排列', '纵向排列', '分组排列'
      ],
      confidence: 0.95,
      examples: [
        '排成网格布局',
        '使用层次布局算法',
        '横向排列所有节点',
        '按类型分组排列'
      ]
    }
  ],

  webActions: {
    frontendFunction: 'canvas.autoLayout',
    eventType: 'canvas.layout.apply',
    apiCall: {
      method: 'POST',
      endpoint: '/api/canvas/layout',
      payload: {
        type: 'auto',
        options: '{{extracted_params}}'
      }
    },
    socketMessage: {
      channel: 'canvas.layout',
      payload: {
        action: 'applyLayout',
        parameters: '{{extracted_params}}',
        timestamp: '{{current_time}}'
      }
    }
  },

  prerequisites: ['画布中存在节点'],
  sideEffects: ['可能会改变节点的现有位置', '动画效果可能影响用户操作']
}

export const registerLayoutArrangementCapability = () => {
  canvasCapabilityRegistry.register(LayoutArrangementCapability)
}