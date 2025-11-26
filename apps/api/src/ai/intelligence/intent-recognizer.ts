import { Injectable, Logger } from '@nestjs/common'
import { CanvasCapabilityRegistry } from '../core/canvas-registry'
import {
  ParsedCanvasIntent,
  CanvasActionDomain,
  CanvasCapability,
  ExecutionContext
} from '../core/types/canvas-intelligence.types'
import type { CanvasContextDto } from '../dto/chat.dto'

@Injectable()
export class CanvasIntentRecognizer {
  private readonly logger = new Logger(CanvasIntentRecognizer.name)

  constructor(private readonly capabilityRegistry: CanvasCapabilityRegistry) {}

  /**
   * 智能解析用户意图 - 核心意图识别方法
   */
  async parseIntent(
    userInput: string,
    canvasContext?: CanvasContextDto,
    executionContext?: ExecutionContext
  ): Promise<ParsedCanvasIntent> {

    // 1. 基础输入预处理
    const normalizedInput = this.preprocessInput(userInput)

    // 2. 快速模式匹配
    const quickMatch = this.performQuickMatch(normalizedInput, canvasContext)
    if (quickMatch.confidence > 0.8) {
      return quickMatch
    }

    // 3. 上下文增强分析
    const contextualMatch = this.performContextualAnalysis(
      normalizedInput,
      canvasContext,
      executionContext
    )
    if (contextualMatch.confidence > 0.6) {
      return contextualMatch
    }

    // 4. 深度语义分析
    const deepMatch = this.performSemanticAnalysis(normalizedInput, canvasContext)

    // 5. 综合评分和选择最佳匹配
    const finalIntent = this.selectBestIntent(quickMatch, contextualMatch, deepMatch)

    this.logger.debug('Intent parsed', {
      input: userInput,
      intent: finalIntent.type,
      confidence: finalIntent.confidence,
      capability: finalIntent.capabilityName
    })

    return finalIntent
  }

  /**
   * 输入预处理
   */
  private preprocessInput(input: string): string {
    return input
      .toLowerCase()
      .trim()
      .replace(/[！？。，、]/g, '') // 移除中文标点
      .replace(/[!?.,;]/g, '') // 移除英文标点
      .replace(/\s+/g, ' ') // 标准化空格
  }

  /**
   * 快速模式匹配 - 基于预定义规则的快速识别
   */
  private performQuickMatch(
    input: string,
    canvasContext?: CanvasContextDto
  ): ParsedCanvasIntent {

    const matches = this.capabilityRegistry.findMatchingCapabilities(input)

    if (matches.length === 0) {
      return this.createUnknownIntent(input)
    }

    const bestMatch = matches[0]
    const capability = bestMatch.capability

    // 提取参数
    const extractedParams = this.capabilityRegistry.extractParameters(capability, input)

    return {
      type: capability.domain,
      capabilityName: capability.name,
      confidence: Math.min(bestMatch.score * 0.9 + 0.1, 1.0), // 标准化到0-1
      entities: {
        capability,
        matchedPatterns: matches.map(m => m.capability.name)
      },
      rawText: input,
      extractedParams,
      reasoning: `通过模式匹配识别到${capability.name}，置信度${(bestMatch.score * 0.9 + 0.1).toFixed(2)}`
    }
  }

  /**
   * 上下文增强分析 - 结合画布当前状态
   */
  private performContextualAnalysis(
    input: string,
    canvasContext?: CanvasContextDto,
    executionContext?: ExecutionContext
  ): ParsedCanvasIntent {

    if (!canvasContext) {
      return this.createUnknownIntent(input)
    }

    const nodeCount = canvasContext.nodes?.length || 0
    const edgeCount = canvasContext.edges?.length || 0

    // 基于画布状态的智能推断
    if (nodeCount === 0) {
      // 空画布，可能是创建需求
      if (input.includes('创建') || input.includes('新建') || input.includes('开始')) {
        return {
          type: CanvasActionDomain.NODE_MANIPULATION,
          capabilityName: '智能创建工作流',
          confidence: 0.7,
          entities: { canvasState: 'empty', action: 'create' },
          rawText: input,
          extractedParams: {},
          reasoning: '检测到空画布，推断需要创建新的工作流'
        }
      }
    }

    if (nodeCount > 5 && (input.includes('乱') || input.includes('整理'))) {
      // 复杂画布 + 整理需求
      return {
        type: CanvasActionDomain.LAYOUT_ARRANGEMENT,
        capabilityName: '智能布局排列',
        confidence: 0.8,
        entities: { canvasState: 'complex', action: 'organize' },
        rawText: input,
        extractedParams: {
          nodeCount,
          layoutType: this.inferLayoutType(input)
        },
        reasoning: `检测到${nodeCount}个节点的复杂画布，需要布局优化`
      }
    }

    if (edgeCount > 0 && (input.includes('优化') || input.includes('改进'))) {
      // 有连接的画布 + 优化需求
      return {
        type: CanvasActionDomain.EXECUTION_DEBUG,
        capabilityName: '智能流程优化',
        confidence: 0.75,
        entities: { canvasState: 'connected', action: 'optimize' },
        rawText: input,
        extractedParams: { nodeCount, edgeCount },
        reasoning: `检测到${edgeCount}个连接的工作流，需要性能或结构优化`
      }
    }

    return this.createUnknownIntent(input)
  }

  /**
   * 深度语义分析 - 高级语义理解
   */
  private performSemanticAnalysis(
    input: string,
    canvasContext?: CanvasContextDto
  ): ParsedCanvasIntent {

    // 复杂意图识别
    const complexPatterns = [
      {
        patterns: ['帮我.*一下', '能不能.*', '可以.*吗'],
        domain: CanvasActionDomain.NODE_MANIPULATION,
        intent: 'assistance_request',
        confidence: 0.6
      },
      {
        patterns: ['.*怎么样', '.*如何', '怎么.*'],
        domain: CanvasActionDomain.EXECUTION_DEBUG,
        intent: 'how_to_question',
        confidence: 0.65
      },
      {
        patterns: ['.*太.*了', '.*很.*', '.*不够.*'],
        domain: CanvasActionDomain.EXECUTION_DEBUG,
        intent: 'problem_report',
        confidence: 0.7
      }
    ]

    for (const pattern of complexPatterns) {
      for (const regex of pattern.patterns) {
        if (new RegExp(regex).test(input)) {
          return {
            type: pattern.domain,
            capabilityName: this.mapIntentToCapability(pattern.intent),
            confidence: pattern.confidence,
            entities: { semanticIntent: pattern.intent },
            rawText: input,
            extractedParams: {},
            reasoning: `通过语义模式识别到${pattern.intent}意图`
          }
        }
      }
    }

    return this.createUnknownIntent(input)
  }

  /**
   * 选择最佳意图匹配
   */
  private selectBestIntent(
    quickMatch: ParsedCanvasIntent,
    contextualMatch: ParsedCanvasIntent,
    deepMatch: ParsedCanvasIntent
  ): ParsedCanvasIntent {

    const candidates = [quickMatch, contextualMatch, deepMatch]
      .filter(intent => intent.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence)

    return candidates[0] || this.createUnknownIntent(quickMatch.rawText)
  }

  /**
   * 创建未知意图
   */
  private createUnknownIntent(input: string): ParsedCanvasIntent {
    return {
      type: CanvasActionDomain.NODE_MANIPULATION, // 默认域
      confidence: 0.3,
      entities: { originalInput: input },
      rawText: input,
      extractedParams: {},
      reasoning: '未能明确识别用户意图，将交由AI模型进行深度理解'
    }
  }

  /**
   * 推断布局类型
   */
  private inferLayoutType(input: string): string {
    if (input.includes('网格') || input.includes('整齐')) return 'grid'
    if (input.includes('层次') || input.includes('分层')) return 'hierarchical'
    if (input.includes('圆形') || input.includes('环形')) return 'circular'
    if (input.includes('力导') || input.includes('自动')) return 'force-directed'
    return 'grid' // 默认
  }

  /**
   * 将语义意图映射到具体能力
   */
  private mapIntentToCapability(semanticIntent: string): string {
    const mapping: Record<string, string> = {
      'assistance_request': '智能助手操作',
      'how_to_question': '操作指导',
      'problem_report': '问题诊断',
      'create_request': '智能创建',
      'optimize_request': '智能优化'
    }

    return mapping[semanticIntent] || '通用操作'
  }

  /**
   * 获取意图识别统计信息
   */
  getIntentStatistics() {
    return {
      totalCapabilities: this.capabilityRegistry.getAllCapabilities().length,
      domainDistribution: this.capabilityRegistry.getStatistics(),
      patternCount: this.capabilityRegistry.getStatistics().totalIntentPatterns
    }
  }
}