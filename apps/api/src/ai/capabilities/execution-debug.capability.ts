import { CanvasCapability, CanvasActionDomain } from '../core/types/canvas-intelligence.types'
import { canvasCapabilityRegistry } from '../core/canvas-registry'

export const ExecutionDebugCapability: CanvasCapability = {
  domain: CanvasActionDomain.EXECUTION_DEBUG,
  name: '智能执行调试',
  description: '分析、优化和调试工作流执行，提供性能监控和改进建议',

  operationModes: [
    {
      type: 'direct',
      description: '立即执行调试分析',
      parameters: [
        {
          name: 'analysisType',
          type: 'enum',
          description: '分析类型',
          options: ['performance', 'cost', 'quality', 'bottleneck', 'dependency'],
          default: 'performance'
        },
        {
          name: 'scope',
          type: 'enum',
          description: '分析范围',
          options: ['entire_workflow', 'selected_nodes', 'specific_path'],
          default: 'entire_workflow'
        },
        {
          name: 'autoApply',
          type: 'boolean',
          description: '是否自动应用优化建议',
          default: false
        }
      ]
    },
    {
      type: 'conditional',
      description: '基于条件智能优化',
      parameters: [
        {
          name: 'optimizationGoal',
          type: 'enum',
          description: '优化目标',
          options: ['speed', 'cost_efficiency', 'quality', 'reliability'],
          default: 'speed'
        },
        {
          name: 'aggressiveness',
          type: 'enum',
          description: '优化激进程度',
          options: ['conservative', 'moderate', 'aggressive'],
          default: 'moderate'
        },
        {
          name: 'preserveFunctionality',
          type: 'boolean',
          description: '是否保持功能不变',
          default: true
        }
      ]
    }
  ],

  intentPatterns: [
    {
      patterns: [
        '优化', '改进', '提升', '改善', '增强',
        '性能优化', '效率提升', '流程优化', '工作流优化'
      ],
      confidence: 0.9,
      context: ['existing_workflow', 'performance_issues'],
      examples: [
        '优化这个工作流',
        '提升执行性能',
        '改进工作流效率',
        '增强处理能力'
      ]
    },
    {
      patterns: [
        '太慢了', '性能差', '效率低', '卡顿', '延迟高',
        '执行慢', '处理慢', '响应慢'
      ],
      confidence: 0.85,
      context: ['slow_execution', 'poor_performance'],
      examples: [
        '这个工作流太慢了',
        '性能太差了，优化一下',
        '执行效率很低',
        '响应延迟太高了'
      ]
    },
    {
      patterns: [
        '成本高', '太贵了', '费用高', '消耗大', '不经济',
        '省钱', '降低成本', '减少消耗'
      ],
      confidence: 0.8,
      examples: [
        'API调用成本太高了',
        '怎么降低执行成本',
        '这个方案太贵了',
        '减少不必要的消耗'
      ]
    },
    {
      patterns: [
        '效果不好', '质量差', '不满意', '需要改进',
        '质量优化', '提升质量', '改善效果'
      ],
      confidence: 0.8,
      examples: [
        '生成效果不好，优化一下',
        '输出质量太差了',
        '对结果不满意',
        '提升生成质量'
      ]
    },
    {
      patterns: [
        '分析', '诊断', '检查', '审查', '评估',
        '问题分析', '性能分析', '瓶颈分析'
      ],
      confidence: 0.85,
      examples: [
        '分析一下这个工作流的性能',
        '诊断执行问题',
        '检查哪里有瓶颈',
        '评估工作流效率'
      ]
    },
    {
      patterns: [
        '调试', '排错', '解决问题', '修复问题',
        '故障排除', '异常处理'
      ],
      confidence: 0.8,
      examples: [
        '调试这个工作流',
        '排除执行故障',
        '解决性能问题',
        '修复执行错误'
      ]
    }
  ],

  webActions: {
    frontendFunction: 'canvas.workflowOptimization',
    eventType: 'canvas.optimization.analyze',
    apiCall: {
      method: 'POST',
      endpoint: '/api/canvas/analyze',
      payload: {
        type: '{{analysisType}}',
        scope: '{{scope}}',
        options: '{{extracted_params}}'
      }
    },
    socketMessage: {
      channel: 'canvas.optimization',
      payload: {
        action: 'analyze_and_optimize',
        parameters: '{{extracted_params}}',
        timestamp: '{{current_time}}'
      }
    }
  },

  prerequisites: ['工作流中存在节点和连接'],
  sideEffects: [
    '优化可能改变工作流结构',
    '参数调整可能影响输出质量',
    '并行化可能增加资源消耗'
  ]
}

export const registerExecutionDebugCapability = () => {
  canvasCapabilityRegistry.register(ExecutionDebugCapability)
}