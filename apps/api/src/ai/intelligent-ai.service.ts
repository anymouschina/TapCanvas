import { Injectable, Logger } from '@nestjs/common'
import { CanvasIntentRecognizer } from './intelligence/intent-recognizer'
import { ThinkingStream } from './intelligence/thinking-stream'
import { WebExecutionEngine } from './execution/web-execution-engine'
import { ToolEventsService, ToolEvent } from './tool-events.service'
import {
  ThinkingEvent,
  ExecutionPlan,
  CanvasOperation,
  ParsedCanvasIntent,
  ExecutionContext
} from './core/types/canvas-intelligence.types'
import type { ChatRequestDto, CanvasContextDto } from './dto/chat.dto'

export interface IntelligentChatResponseDto {
  reply: string
  plan: string[]
  actions: any[]
  thinkingEvents: ThinkingEvent[]
  intent: {
    type: string
    confidence: number
    reasoning: string
  }
  optimizations?: any[]
}

@Injectable()
export class IntelligentAiService {
  private readonly logger = new Logger(IntelligentAiService.name)

  constructor(
    private readonly intentRecognizer: CanvasIntentRecognizer,
    private readonly thinkingStream: ThinkingStream,
    private readonly executionEngine: WebExecutionEngine,
    private readonly toolEvents: ToolEventsService
  ) {}

  /**
   * 智能聊天 - 核心入口
   */
  async chatIntelligent(
    userId: string,
    payload: ChatRequestDto
  ): Promise<IntelligentChatResponseDto> {

    try {
      this.logger.debug('Starting intelligent chat', {
        userId,
        messageCount: payload.messages?.length,
        hasContext: !!payload.context
      })

      // 1. 准备执行上下文
      const executionContext: ExecutionContext = {
        userId,
        sessionId: this.generateSessionId(),
        currentCanvas: payload.context,
        timestamp: new Date()
      }

      // 2. 获取用户输入
      const userMessage = this.getLastUserMessage(payload)
      const originalInput = userMessage?.content || ''

      // 3. 智能意图识别
      const intent = await this.intentRecognizer.parseIntent(
        originalInput,
        payload.context,
        executionContext
      )

      // 4. 带思考过程的执行规划
      const { plan, operations } = await this.thinkingStream.processWithThinking(
        intent,
        payload.context,
        executionContext,
        (event) => this.emitThinkingEvent(userId, event)
      )

      // 5. 执行具体操作（或发送到前端执行）
      const results = await this.executeOperations(operations, executionContext)

      // 6. 生成最终回复
      const reply = this.generateFinalReply(intent, plan, results)

      this.logger.debug('Intelligent chat completed', {
        intent: intent.type,
        confidence: intent.confidence,
        operationsCount: operations.length,
        successCount: results.filter(r => r.success).length
      })

      return {
        reply,
        plan: plan.steps.map(step => step.description),
        actions: this.convertOperationsToActions(operations),
        thinkingEvents: this.thinkingStream.getCurrentEvents(),
        intent: {
          type: intent.type,
          confidence: intent.confidence,
          reasoning: intent.reasoning
        }
      }

    } catch (error) {
      this.logger.error('Intelligent chat failed', error as any)

      return {
        reply: '抱歉，处理您的请求时遇到了问题。让我尝试用传统方式来帮助您。',
        plan: [],
        actions: this.generateFallbackActions(payload),
        thinkingEvents: [],
        intent: {
          type: 'error',
          confidence: 0,
          reasoning: '智能处理失败，回退到传统处理'
        }
      }
    }
  }

  /**
   * 流式智能聊天
   */
  async chatStreamIntelligent(
    userId: string,
    payload: ChatRequestDto,
    res: any
  ): Promise<void> {

    const executionContext: ExecutionContext = {
      userId,
      sessionId: this.generateSessionId(),
      currentCanvas: payload.context,
      timestamp: new Date()
    }

    const userMessage = this.getLastUserMessage(payload)
    const originalInput = userMessage?.content || ''

    try {
      // 实时思考过程推送
      const onThinkingEvent = (event: ThinkingEvent) => {
        res.write(`data: ${JSON.stringify({
          type: 'thinking',
          payload: event
        })}\n\n`)
      }

      // 意图识别
      const intent = await this.intentRecognizer.parseIntent(
        originalInput,
        payload.context,
        executionContext
      )

      // 推送识别结果
      res.write(`data: ${JSON.stringify({
        type: 'intent',
        payload: {
          type: intent.type,
          confidence: intent.confidence,
          reasoning: intent.reasoning
        }
      })}\n\n`)

      // 执行规划并实时推送
      const { plan, operations } = await this.thinkingStream.processWithThinking(
        intent,
        payload.context,
        executionContext,
        onThinkingEvent
      )

      // 推送执行计划
      res.write(`data: ${JSON.stringify({
        type: 'plan',
        payload: {
          strategy: plan.strategy.name,
          steps: plan.steps.map(step => ({
            id: step.id,
            name: step.name,
            description: step.description,
            status: step.status
          })),
          estimatedTime: plan.estimatedTime
        }
      })}\n\n`)

      // 逐个执行操作并推送结果
      for (const operation of operations) {
        const result = await this.executionEngine.executeOperation(operation, executionContext)

        res.write(`data: ${JSON.stringify({
          type: 'operation_result',
          payload: {
            operationId: operation.id,
            success: result.success,
            result: result.result,
            duration: result.duration
          }
        })}\n\n`)
      }

      // 完成信号
      res.write(`data: ${JSON.stringify({
        type: 'complete',
        payload: {
          reply: this.generateFinalReply(intent, plan, []),
          summary: {
            operationsCount: operations.length,
            thinkingSteps: this.thinkingStream.getCurrentEvents().length
          }
        }
      })}\n\n`)

      res.end()

    } catch (error) {
      this.logger.error('Stream intelligent chat failed', error as any)

      res.write(`data: ${JSON.stringify({
        type: 'error',
        payload: {
          message: '智能处理失败',
          error: (error as Error).message
        }
      })}\n\n`)

      res.end()
    }
  }

  /**
   * 执行操作集合
   */
  private async executeOperations(
    operations: CanvasOperation[],
    context: ExecutionContext
  ) {
    const results = []

    for (const operation of operations) {
      const result = await this.executionEngine.executeOperation(operation, context)
      results.push(result)

      // 如果关键操作失败，可以决定是否继续
      if (!result.success && operation.priority > 5) {
        this.logger.warn('Critical operation failed, stopping execution', {
          operation: operation.capability.name,
          error: result.error
        })
        break
      }
    }

    return results
  }

  /**
   * 发送思考事件到前端
   */
  private emitThinkingEvent(userId: string, event: ThinkingEvent) {
    const toolEvent: ToolEvent = {
      type: 'tool-result',
      toolCallId: `thinking_${event.id}`,
      toolName: 'ai.thinking.process',
      output: event
    }
    this.toolEvents.emit(userId, toolEvent)
  }

  /**
   * 转换操作为前端可执行的action格式
   */
  private convertOperationsToActions(operations: CanvasOperation[]): any[] {
    return operations.map(op => ({
      type: 'canvas_operation',
      params: {
        domain: op.capability.domain,
        capability: op.capability.name,
        parameters: op.parameters,
        webActions: op.capability.webActions
      },
      reasoning: `执行${op.capability.name}操作`
    }))
  }

  /**
   * 生成最终回复
   */
  private generateFinalReply(
    intent: ParsedCanvasIntent,
    plan: ExecutionPlan,
    results: any[]
  ): string {
    const baseReplies = {
      node_manipulation: '已完成节点操作，为您创建了相应的功能模块',
      layout_arrangement: '已应用智能布局，画布现在更加整洁有序',
      execution_debug: '已启动工作流分析，将为您提供优化建议',
      view_navigation: '已调整视图定位，让您更好地关注重点内容',
      project_management: '项目操作已完成，您的工作已妥善保存'
    }

    const baseReply = baseReplies[intent.type as keyof typeof baseReplies] ||
                     '已为您完成相关操作'

    const successCount = results.filter(r => r.success).length
    const totalCount = results.length

    if (successCount === totalCount && totalCount > 0) {
      return `${baseReply}。共执行了${totalCount}个操作，全部成功完成。`
    } else if (successCount > 0) {
      return `${baseReply}。执行了${totalCount}个操作，其中${successCount}个成功完成。`
    } else {
      return `${baseReply}。操作正在执行中，请稍候查看结果。`
    }
  }

  /**
   * 生成回退操作
   */
  private generateFallbackActions(payload: ChatRequestDto): any[] {
    const lastMessage = this.getLastUserMessage(payload)
    const content = (lastMessage?.content || '').toLowerCase()

    // 简单的关键词匹配回退方案
    if (content.includes('布局') || content.includes('整理')) {
      return [{
        type: 'formatAll',
        reasoning: '检测到布局相关需求，执行全选并自动布局',
        params: {}
      }]
    }

    if (content.includes('图片') || content.includes('生成')) {
      return [{
        type: 'createNode',
        reasoning: '检测到生成需求，创建图像生成节点',
        params: {
          type: 'image',
          label: '图像生成',
          config: { kind: 'image' }
        }
      }]
    }

    return [{
      type: 'getNodes',
      reasoning: '无法确定具体意图，查询画布状态',
      params: {}
    }]
  }

  /**
   * 获取最后一条用户消息
   */
  private getLastUserMessage(payload: ChatRequestDto) {
    if (!payload.messages || payload.messages.length === 0) {
      return { content: '' }
    }

    // 找到最后一条用户消息
    const userMessages = payload.messages.filter(msg => msg.role === 'user')
    return userMessages[userMessages.length - 1] || payload.messages[payload.messages.length - 1]
  }

  /**
   * 生成会话ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 获取智能服务统计信息
   */
  getStatistics() {
    return {
      intentRecognizer: this.intentRecognizer.getIntentStatistics(),
      executionEngine: this.executionEngine.getExecutionStatistics(),
      currentThinkingEvents: this.thinkingStream.getCurrentEvents().length,
      currentPlan: !!this.thinkingStream.getCurrentPlan()
    }
  }

  /**
   * 清理资源
   */
  clearSession() {
    this.thinkingStream.clear()
  }
}