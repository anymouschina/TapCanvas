import { Injectable, Logger } from '@nestjs/common'
import {
  ThinkingEvent,
  ExecutionPlan,
  ExecutionStep,
  ExecutionStrategy,
  CanvasOperation,
  ParsedCanvasIntent,
  ExecutionContext,
  CanvasActionDomain,
  CanvasCapability
} from '../core/types/canvas-intelligence.types'
import { canvasCapabilityRegistry } from '../core/canvas-registry'

@Injectable()
export class ThinkingStream {
  private readonly logger = new Logger(ThinkingStream.name)
  private currentEvents: ThinkingEvent[] = []
  private currentPlan: ExecutionPlan | null = null

  /**
   * 带思考过程地处理意图并生成执行计划
   */
  async processWithThinking(
    intent: ParsedCanvasIntent,
    canvasContext: any,
    executionContext: ExecutionContext,
    onThinkingEvent?: (event: ThinkingEvent) => void
  ): Promise<{ plan: ExecutionPlan, operations: CanvasOperation[] }> {

    this.currentEvents = []
    this.currentPlan = null

    try {
      // 1. 意图分析阶段
      await this.emitIntentAnalysis(intent, onThinkingEvent)

      // 2. 策略选择阶段
      const strategy = await this.selectExecutionStrategy(intent, canvasContext)
      await this.emitStrategySelection(strategy, onThinkingEvent)

      // 3. 执行计划制定阶段
      const plan = await this.generateExecutionPlan(intent, strategy, canvasContext)
      this.currentPlan = plan
      await this.emitPlanningPhase(plan, onThinkingEvent)

      // 4. 风险评估阶段
      const riskAssessment = await this.assessRisks(plan, canvasContext)
      await this.emitRiskAssessment(riskAssessment, onThinkingEvent)

      // 5. 生成具体操作
      const operations = this.generateOperations(plan, intent, executionContext)
      await this.emitOperationGeneration(operations, onThinkingEvent)

      this.logger.debug('Thinking process completed', {
        intent: intent.type,
        steps: plan.steps.length,
        operations: operations.length,
        confidence: intent.confidence
      })

      return { plan, operations }

    } catch (error) {
      this.logger.error('Thinking process failed', error as any)
      await this.emitErrorEvent(error, onThinkingEvent)
      throw error
    }
  }

  /**
   * 意图分析思考
   */
  private async emitIntentAnalysis(
    intent: ParsedCanvasIntent,
    onEvent?: (event: ThinkingEvent) => void
  ): Promise<void> {

    const event: ThinkingEvent = {
      id: this.generateEventId('analysis'),
      type: 'intent_analysis',
      timestamp: new Date(),
      content: `正在分析用户意图: "${intent.rawText}"`,
      metadata: {
        confidence: intent.confidence,
        context: {
          detectedType: intent.type,
          capabilityName: intent.capabilityName,
          extractedParamsCount: Object.keys(intent.extractedParams).length
        }
      }
    }

    await this.emitEvent(event, onEvent)

    // 延迟模拟思考过程
    await this.sleep(300)

    // 深度分析
    const deepAnalysisEvent: ThinkingEvent = {
      id: this.generateEventId('deep_analysis'),
      type: 'reasoning',
      timestamp: new Date(),
      content: this.generateDeepAnalysisReasoning(intent),
      metadata: {
        confidence: intent.confidence,
        context: {
          reasoningType: 'deep_analysis',
          complexity: this.assessIntentComplexity(intent)
        }
      }
    }

    await this.emitEvent(deepAnalysisEvent, onEvent)
    await this.sleep(200)

    if (intent.planSteps && intent.planSteps.length > 0) {
      const summarized = intent.planSteps
        .map((step, idx) => `${idx + 1}. ${step}`)
        .join(' | ')

      const previewEvent: ThinkingEvent = {
        id: this.generateEventId('intent_plan_preview'),
        type: 'planning',
        timestamp: new Date(),
        content: `初步计划: ${summarized}`,
        metadata: {
          context: {
            planSteps: intent.planSteps,
            preview: true
          }
        }
      }

      await this.emitEvent(previewEvent, onEvent)
      await this.sleep(150)
    }
  }

  /**
   * 策略选择思考
   */
  private async emitStrategySelection(
    strategy: ExecutionStrategy,
    onEvent?: (event: ThinkingEvent) => void
  ): Promise<void> {

    const event: ThinkingEvent = {
      id: this.generateEventId('strategy'),
      type: 'decision',
      timestamp: new Date(),
      content: `选择执行策略: ${strategy.name} - ${strategy.description}`,
      metadata: {
        context: {
          strategy: strategy.name,
          efficiency: strategy.efficiency,
          risk: strategy.risk,
          reasoning: strategy.reasoning
        }
      }
    }

    await this.emitEvent(event, onEvent)
    await this.sleep(400)
  }

  /**
   * 执行计划制定思考
   */
  private async emitPlanningPhase(
    plan: ExecutionPlan,
    onEvent?: (event: ThinkingEvent) => void
  ): Promise<void> {

    const event: ThinkingEvent = {
      id: this.generateEventId('planning'),
      type: 'planning',
      timestamp: new Date(),
      content: `制定执行计划，共${plan.steps.length}个步骤，预计耗时${plan.estimatedTime}秒`,
      metadata: {
        context: {
          stepCount: plan.steps.length,
          estimatedTime: plan.estimatedTime,
          estimatedCost: plan.estimatedCost,
          parallelGroups: plan.parallelGroups.length,
          strategy: plan.strategy.name
        }
      }
    }

    await this.emitEvent(event, onEvent)

    // 逐步展示每个步骤
    for (let i = 0; i < Math.min(plan.steps.length, 5); i++) {
      const step = plan.steps[i]
      const stepEvent: ThinkingEvent = {
        id: this.generateEventId(`step_${i}`),
        type: 'reasoning',
        timestamp: new Date(),
        content: `步骤${i + 1}: ${step.description}`,
        metadata: {
          context: {
            stepId: step.id,
            stepName: step.name,
            estimatedTime: step.estimatedTime,
            dependencies: step.dependencies?.length || 0,
            reasoning: step.reasoning
          }
        }
      }

      await this.emitEvent(stepEvent, onEvent)
      await this.sleep(150)
    }
  }

  /**
   * 风险评估思考
   */
  private async emitRiskAssessment(
    riskAssessment: any,
    onEvent?: (event: ThinkingEvent) => void
  ): Promise<void> {

    const event: ThinkingEvent = {
      id: this.generateEventId('risk'),
      type: 'reasoning',
      timestamp: new Date(),
      content: `风险评估: 识别到${riskAssessment.highRisks}个高风险项，${riskAssessment.mediumRisks}个中风险项`,
      metadata: {
        context: {
          highRisks: riskAssessment.highRisks,
          mediumRisks: riskAssessment.mediumRisks,
          lowRisks: riskAssessment.lowRisks,
          overallRiskLevel: riskAssessment.overallRiskLevel
        }
      }
    }

    await this.emitEvent(event, onEvent)
    await this.sleep(200)
  }

  /**
   * 操作生成思考
   */
  private async emitOperationGeneration(
    operations: CanvasOperation[],
    onEvent?: (event: ThinkingEvent) => void
  ): Promise<void> {

    const event: ThinkingEvent = {
      id: this.generateEventId('operations'),
      type: 'execution',
      timestamp: new Date(),
      content: `生成${operations.length}个具体操作，准备执行`,
      metadata: {
        context: {
          operationCount: operations.length,
          operationTypes: [...new Set(operations.map(op => op.capability.domain))],
          hasParallelOperations: operations.some(op => op.priority > 1)
        }
      }
    }

    await this.emitEvent(event, onEvent)
  }

  /**
   * 选择执行策略
   */
  private async selectExecutionStrategy(
    intent: ParsedCanvasIntent,
    canvasContext: any
  ): Promise<ExecutionStrategy> {

    const strategies = [
      {
        name: 'direct_execution',
        description: '直接执行，最快速度',
        efficiency: 'very_high' as const,
        risk: 'medium' as const,
        reasoning: '识别到明确的操作意图，采用直接执行策略'
      },
      {
        name: 'conservative_execution',
        description: '保守执行，逐步验证',
        efficiency: 'medium' as const,
        risk: 'low' as const,
        reasoning: '为安全起见，采用逐步验证的保守策略'
      },
      {
        name: 'optimization_focused',
        description: '优化优先，寻找最佳方案',
        efficiency: 'high' as const,
        risk: 'medium' as const,
        reasoning: '重点考虑性能和效果优化'
      }
    ]

    // 基于意图置信度和复杂度选择策略
    if (intent.confidence > 0.8) {
      return strategies[0] // 直接执行
    } else if (intent.confidence < 0.5) {
      return strategies[1] // 保守执行
    } else {
      return strategies[2] // 优化优先
    }
  }

  /**
   * 生成执行计划
   */
  private async generateExecutionPlan(
    intent: ParsedCanvasIntent,
    strategy: ExecutionStrategy,
    canvasContext: any
  ): Promise<ExecutionPlan> {

    const steps = this.generateStepsForIntent(intent, canvasContext)

    return {
      id: this.generateEventId('plan'),
      strategy,
      steps,
      dependencies: {
        nodes: steps.map(s => s.id),
        edges: [] // 简化，实际需要分析依赖关系
      },
      parallelGroups: [], // 简化，实际需要识别并行机会
      risks: [], // 简化，实际需要风险评估
      estimatedTime: steps.reduce((sum, step) => sum + (step.estimatedTime || 1), 0),
      estimatedCost: steps.length * 1, // 简化的成本计算
      rollbackPlan: {
        possible: true,
        steps: []
      }
    }
  }

  /**
   * 根据意图生成执行步骤
   */
  private generateStepsForIntent(intent: ParsedCanvasIntent, canvasContext: any): ExecutionStep[] {
    const baseSteps: ExecutionStep[] = []

    // 根据不同的意图类型生成步骤
    switch (intent.type) {
      case 'node_manipulation':
        baseSteps.push({
          id: this.generateEventId('step'),
          name: '创建或修改节点',
          description: '根据用户意图创建或修改相应的节点',
          status: 'pending',
          reasoning: `用户需要${intent.capabilityName || '节点操作'}，准备执行`,
          estimatedTime: 1,
          acceptanceCriteria: this.buildAcceptanceCriteria(intent.type)
        })
        break

      case 'layout_arrangement':
        baseSteps.push({
          id: this.generateEventId('step'),
          name: '布局优化',
          description: '重新排列和整理画布布局',
          status: 'pending',
          reasoning: '检测到布局整理需求，将应用智能布局算法',
          estimatedTime: 2,
          acceptanceCriteria: this.buildAcceptanceCriteria(intent.type)
        })
        break

      case 'execution_debug':
        baseSteps.push({
          id: this.generateEventId('step'),
          name: '性能分析',
          description: '分析当前工作流的性能瓶颈',
          status: 'pending',
          reasoning: '准备进行深度性能分析和优化建议',
          estimatedTime: 3,
          acceptanceCriteria: this.buildAcceptanceCriteria(intent.type)
        })
        break

      default:
        baseSteps.push({
          id: this.generateEventId('step'),
          name: '通用操作',
          description: '执行用户请求的操作',
          status: 'pending',
          reasoning: '识别到通用操作需求，将执行相应功能',
          estimatedTime: 1,
          acceptanceCriteria: this.buildAcceptanceCriteria(intent.type)
        })
    }

    return baseSteps
  }

  /**
   * 评估风险
   */
  private async assessRisks(plan: ExecutionPlan, canvasContext: any): Promise<any> {
    return {
      highRisks: 0,
      mediumRisks: 1, // 假设有一个中风险
      lowRisks: 2,
      overallRiskLevel: 'medium'
    }
  }

  /**
   * 生成具体操作
   */
  private generateOperations(
    plan: ExecutionPlan,
    intent: ParsedCanvasIntent,
    context: ExecutionContext
  ): CanvasOperation[] {
    const parameters = this.buildOperationParameters(intent)

    return plan.steps.map(step => ({
      id: this.generateEventId('operation'),
      planStepId: step.id,
      capability: this.resolveCapabilityForStep(step, intent),
      parameters,
      context,
      priority: step.name.includes('关键') ? 6 : 1
    }))
  }

  private resolveCapabilityForStep(step: ExecutionStep, intent: ParsedCanvasIntent): CanvasCapability {
    const fromIntent = (intent.entities?.capability || null) as CanvasCapability | null
    if (fromIntent && this.isCanvasCapability(fromIntent)) {
      return fromIntent
    }

    if (intent.capabilityName) {
      const matched = canvasCapabilityRegistry.getCapabilityByName(intent.type, intent.capabilityName)
      if (matched) return matched
    }

    const [fallback] = canvasCapabilityRegistry.getCapabilitiesByDomain(intent.type)
    if (fallback) return fallback

    return {
      domain: intent.type,
      name: step.name,
      description: step.description,
      operationModes: [],
      intentPatterns: [],
      webActions: {}
    }
  }

  private buildOperationParameters(intent: ParsedCanvasIntent) {
    if (intent.extractedParams && Object.keys(intent.extractedParams).length > 0) {
      return intent.extractedParams
    }
    return this.buildFallbackParameters(intent)
  }

  private buildFallbackParameters(intent: ParsedCanvasIntent) {
    switch (intent.type) {
      case CanvasActionDomain.LAYOUT_ARRANGEMENT:
        return { action: 'format', layoutType: 'grid', spacing: 120 }
      case CanvasActionDomain.EXECUTION_DEBUG:
        return { analysisType: 'performance', scope: 'entire_workflow' }
      default:
        return { action: 'create', nodeType: 'text', config: { kind: 'text' } }
    }
  }

  private isCanvasCapability(value: any): value is CanvasCapability {
    return Boolean(value && value.domain && value.name)
  }

  /**
   * 错误事件处理
   */
  private async emitErrorEvent(
    error: any,
    onEvent?: (event: ThinkingEvent) => void
  ): Promise<void> {

    const event: ThinkingEvent = {
      id: this.generateEventId('error'),
      type: 'result',
      timestamp: new Date(),
      content: `执行过程中发生错误: ${error.message}`,
      metadata: {
        context: {
          errorType: error.constructor.name,
          errorMessage: error.message,
          recoveryPossible: true
        }
      }
    }

    await this.emitEvent(event, onEvent)
  }

  /**
   * 生成深度分析推理
   */
  private generateDeepAnalysisReasoning(intent: ParsedCanvasIntent): string {
    const reasonings = [
      `通过语义分析识别到${intent.type}类型的操作需求`,
      `置信度${(intent.confidence * 100).toFixed(0)}%，表明意图识别较为可靠`,
      `提取到${Object.keys(intent.extractedParams).length}个关键参数`,
      `该意图需要${intent.capabilityName || '相应的'}功能来处理`
    ]

    return reasonings.join('；') + '。'
  }

  /**
   * 评估意图复杂度
   */
  private assessIntentComplexity(intent: ParsedCanvasIntent): 'low' | 'medium' | 'high' {
    const paramCount = Object.keys(intent.extractedParams).length
    const confidence = intent.confidence

    if (confidence > 0.8 && paramCount <= 2) return 'low'
    if (confidence > 0.5 && paramCount <= 4) return 'medium'
    return 'high'
  }

  /**
   * 发送事件
   */
  private async emitEvent(
    event: ThinkingEvent,
    onEvent?: (event: ThinkingEvent) => void
  ): Promise<void> {
    this.currentEvents.push(event)

    if (onEvent) {
      await onEvent(event)
    }
  }

  /**
   * 生成事件ID
   */
  private generateEventId(type: string): string {
    return `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 休眠函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private buildAcceptanceCriteria(domain: CanvasActionDomain | string): string[] {
    switch (domain) {
      case CanvasActionDomain.NODE_MANIPULATION:
        return [
          '节点已在画布上创建/更新并与描述一致',
          '提示词或参数覆盖角色、光影与剧情要求',
          '节点连接/运行状态无报错'
        ]
      case CanvasActionDomain.LAYOUT_ARRANGEMENT:
        return [
          '节点布局整洁且无明显重叠',
          '关键连线保持正确顺序',
          '用户确认新的结构便于继续创作'
        ]
      case CanvasActionDomain.EXECUTION_DEBUG:
        return [
          '列出失败节点或性能瓶颈',
          '给出复现步骤与优化建议'
        ]
      default:
        return [
          '操作结果记录并同步给用户',
          '必要的参数或提示词已更新'
        ]
    }
  }

  /**
   * 获取当前思考事件
   */
  getCurrentEvents(): ThinkingEvent[] {
    return [...this.currentEvents]
  }

  /**
   * 获取当前计划
   */
  getCurrentPlan(): ExecutionPlan | null {
    return this.currentPlan
  }

  /**
   * 清空当前状态
   */
  clear(): void {
    this.currentEvents = []
    this.currentPlan = null
  }
}
