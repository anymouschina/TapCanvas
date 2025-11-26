import { CanvasCapability, CanvasActionDomain } from '../core/types/canvas-intelligence.types'
import { canvasCapabilityRegistry } from '../core/canvas-registry'

/**
 * 小红书封面生成能力 - 使用现有的图像节点 + 智能提示词
 */
export const XiaohongshuCoverCapability: CanvasCapability = {
  domain: CanvasActionDomain.NODE_MANIPULATION,
  name: '小红书封面生成',
  description: '智能生成小红书风格封面，创建图像节点并配置专业提示词',

  operationModes: [
    {
      type: 'direct',
      description: '创建图像节点并生成小红书封面',
      parameters: [
        {
          name: 'title',
          type: 'string',
          description: '封面主题',
          required: false
        },
        {
          name: 'style',
          type: 'enum',
          description: '封面风格',
          options: ['ins风', '科技感', '简约风', '插画风', 'ins'],
          default: 'ins风'
        },
        {
          name: 'size',
          type: 'enum',
          description: '图片尺寸',
          options: ['3:4', '1024x1365', '1:1', '1080x1080', '9:16', '1080x1920'],
          default: '3:4'
        }
      ]
    }
  ],

  intentPatterns: [
    {
      patterns: [
        '小红书封面', 'xiaohongshu封面', 'ins封面', '社交媒体封面',
        '小红书风格', 'ins风封面', '网红封面', '封面生成', '生成封面'
      ],
      confidence: 0.98, // 提高置信度
      examples: [
        '生成一个小红书封面',
        '我要做ins风的封面图',
        '帮我设计一个社交媒体封面',
        '小红书风格的封面设计',
        '生成一个封面',
        '做个封面'
      ]
    },
    {
      patterns: [
        '吸引人', '抓眼球', '高点击率', '爆款封面', '引流封面',
        '吸引注意力', '提高点击率', '吸引人的视觉效果'
      ],
      confidence: 0.95, // 提高置信度
      examples: [
        '做个吸引人的封面',
        '我想要一个高点击率的封面',
        '设计一个爆款封面',
        '帮我做个引流封面',
        '吸引人的视觉效果'
      ]
    }
  ],

  webActions: {
    frontendFunction: 'canvas.node.create',
    eventType: 'canvas.node.operation',
    socketMessage: {
      channel: 'canvas.nodes',
      payload: {
        action: 'create',
        nodeType: 'image',
        config: {
          kind: 'image',
          prompt: '{{xiaohongshu_prompt}}',
          style: '{{style}}',
          size: '{{size}}'
        },
        timestamp: '{{current_time}}'
      }
    }
  },

  prerequisites: ['TapCanvas 已支持图像生成'],
  sideEffects: ['创建新的图像节点']
}

export const registerXiaohongshuCoverCapability = () => {
  canvasCapabilityRegistry.register(XiaohongshuCoverCapability)
}

/**
 * 生成小红书风格提示词的辅助函数
 */
export function generateXiaohongshuPrompt(userInput: string, params: Record<string, any>): string {
  const baseElements = [
    '小红书ins风格封面设计',
    '高质量社交媒体图片',
    '吸引眼球的视觉元素',
    '专业摄影质感'
  ]

  const styleKeywords = {
    'ins风': ['ins风格', '滤镜质感', '生活化场景', '自然光效果'],
    '科技感': ['科技蓝', '未来感', '数字化元素', '科技背景'],
    '简约风': ['极简设计', '留白构图', '色彩纯净', '现代美学'],
    '插画风': ['插画风格', '手绘质感', '可爱元素', '艺术创作']
  }

  const sizeKeywords = {
    '3:4': ['竖版3:4构图', '手机屏幕比例', '移动端优化'],
    '1:1': ['正方形构图', 'Instagram风格', '平衡设计'],
    '9:16': ['竖版9:16', '抖音风格', '长屏构图']
  }

  // 组合提示词
  let prompt = baseElements.join(', ')

  // 添加风格关键词
  const style = params.style || 'ins风'
  if (styleKeywords[style as keyof typeof styleKeywords]) {
    prompt += ', ' + styleKeywords[style as keyof typeof styleKeywords].join(', ')
  }

  // 添加尺寸相关关键词
  const size = params.size || '3:4'
  if (sizeKeywords[size as keyof typeof sizeKeywords]) {
    prompt += ', ' + sizeKeywords[size as keyof typeof sizeKeywords].join(', ')
  }

  // 添加用户自定义主题
  if (params.title || userInput) {
    prompt += ', 主题: ' + (params.title || userInput)
  }

  // 添加质量关键词
  prompt += ', 高清细节, 专业品质, 8k分辨率, 精美构图'

  return prompt
}