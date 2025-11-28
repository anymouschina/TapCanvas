import { Injectable, Logger } from '@nestjs/common'
import { AiService } from './ai.service'
import type { ScenePromptResult } from './ai.service'
import { CanvasIntentRecognizer } from './intelligence/intent-recognizer'
import { ThinkingStream } from './intelligence/thinking-stream'
import { WebExecutionEngine } from './execution/web-execution-engine'
import { ToolEventsService, ToolEvent } from './tool-events.service'
import {
  ThinkingEvent,
  ExecutionPlan,
  CanvasOperation,
  ParsedCanvasIntent,
  ExecutionContext,
  ExecutionResult,
  CanvasActionDomain
} from './core/types/canvas-intelligence.types'
import type { ChatRequestDto, CanvasContextDto } from './dto/chat.dto'
import { PlanManager } from './intelligence/plan-manager'
import { canvasCapabilityRegistry } from './core/canvas-registry'
import { splitNarrativeSections } from './utils/narrative'

type NarrativeScene = { index: number; summary: string; raw: string; hints: string[] }

const DEFAULT_INTELLIGENT_MODEL = 'gemini-2.5-flash'

export interface IntelligentChatResponseDto {
  reply: string
  plan: string[]
  actions: any[]
  thinkingEvents: ThinkingEvent[]
  intent: {
    type: string
    confidence: number
    reasoning: string
    planSteps: string[]
  }
  optimizations?: any[]
}

@Injectable()
export class IntelligentAiService {
  private readonly logger = new Logger(IntelligentAiService.name)

  constructor(
    private readonly aiService: AiService,
    private readonly intentRecognizer: CanvasIntentRecognizer,
    private readonly thinkingStream: ThinkingStream,
    private readonly executionEngine: WebExecutionEngine,
    private readonly toolEvents: ToolEventsService,
    private readonly planManager: PlanManager
  ) {}

  /**
   * 智能聊天 - 核心入口
   */
  async chatIntelligent(
    userId: string,
    payload: ChatRequestDto
  ): Promise<IntelligentChatResponseDto> {

    let activePlanId: string | undefined

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
      const narrativeScenes = this.splitNarrativeIntoScenes(originalInput)
      if (narrativeScenes.length > 0) {
        return await this.handleNarrativeScenes(
          narrativeScenes,
          userId,
          payload,
          executionContext,
          originalInput
        )
      }

      const { plan, operations } = await this.thinkingStream.processWithThinking(
        intent,
        payload.context,
        executionContext,
        (event) => this.emitThinkingEvent(userId, event)
      )

      this.planManager.startPlan(
        userId,
        executionContext.sessionId,
        plan,
        intent.reasoning
      )
      activePlanId = plan.id

      // 5. 执行具体操作（或发送到前端执行）
      const results = await this.executeOperations(
        operations,
        executionContext,
        plan,
        userId
      )

      // 6. 调用大模型获取可执行动作
      const llmResult = await this.invokeAssistantModel(userId, payload)

      // 7. 生成最终回复
      const reply = llmResult?.reply ?? this.generateFinalReply(intent, plan, results)
      const responseActions = llmResult?.actions && llmResult.actions.length > 0
        ? llmResult.actions
        : this.convertOperationsToActions(operations)

      this.logger.debug('Intelligent chat completed', {
        intent: intent.type,
        confidence: intent.confidence,
        operationsCount: operations.length,
        successCount: results.filter(r => r.success).length
      })

      return {
        reply,
        plan: plan.steps.map(step => step.description),
        actions: responseActions,
        thinkingEvents: this.thinkingStream.getCurrentEvents(),
        intent: {
          type: intent.type,
          confidence: intent.confidence,
          reasoning: intent.reasoning,
          planSteps: intent.planSteps
        }
      }

    } catch (error) {
      if (activePlanId) {
        this.planManager.abortPlan(userId, activePlanId, '智能处理失败，计划已终止')
      }

      this.logger.error('Intelligent chat failed', error as any)

      return {
        reply: '抱歉，处理您的请求时遇到了问题。让我尝试用传统方式来帮助您。',
        plan: [],
        actions: this.generateFallbackActions(payload),
        thinkingEvents: [],
        intent: {
          type: 'error',
          confidence: 0,
          reasoning: '智能处理失败，回退到传统处理',
          planSteps: []
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
    // 已由 /ai/chat/stream 统一接管 UI 流，保留此方法用于旧路径兼容（通过 controller 转发）
    return this.runSidecarStreaming(userId, payload, res)
  }

  /**
   * 智能流程的“旁路”执行：复用普通流式 UI 通道，思考/计划/操作通过 tool-events 推送
   */
  async runSidecarStreaming(
    userId: string,
    payload: ChatRequestDto,
    res?: any
  ): Promise<void> {
    // SSE headers
    if (res) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.flushHeaders?.()
      res.write(':\n\n') // kickstart stream for some proxies
    }

    const executionContext: ExecutionContext = {
      userId,
      sessionId: this.generateSessionId(),
      currentCanvas: payload.context,
      timestamp: new Date()
    }

    const userMessage = this.getLastUserMessage(payload)
    const originalInput = userMessage?.content || ''
    let activePlanId: string | undefined

    try {
      // 实时思考过程推送（经由工具事件复用前端订阅链路）
      const onThinkingEvent = (event: ThinkingEvent) => {
        this.emitThinkingEvent(userId, event)
        if (res) {
          res.write(`data: ${JSON.stringify({
            type: 'thinking',
            payload: event
          })}\n\n`)
        }
      }

      // 意图识别
      const intent = await this.intentRecognizer.parseIntent(
        originalInput,
        payload.context,
        executionContext
      )

      // 推送识别结果
      if (res) {
        res.write(`data: ${JSON.stringify({
          type: 'intent',
          payload: {
            type: intent.type,
            confidence: intent.confidence,
            reasoning: intent.reasoning,
            planSteps: intent.planSteps
          }
        })}\n\n`)
      } else {
        this.toolEvents.emit(userId, {
          type: 'tool-result',
          toolCallId: `intent_${executionContext.sessionId}`,
          toolName: 'ai.intent.detected',
          output: {
            type: intent.type,
            confidence: intent.confidence,
            reasoning: intent.reasoning,
            planSteps: intent.planSteps
          }
        })
      }

      // 执行规划并实时推送
      const { plan, operations } = await this.thinkingStream.processWithThinking(
        intent,
        payload.context,
        executionContext,
        onThinkingEvent
      )

      this.planManager.startPlan(
        userId,
        executionContext.sessionId,
        plan,
        intent.reasoning
      )
      activePlanId = plan.id

      // 推送执行计划
      if (res) {
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
      }

      const operationResults = await this.executeOperations(
        operations,
        executionContext,
        plan,
        userId,
        (operation, result) => {
          if (res) {
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
          this.toolEvents.emit(userId, {
            type: 'tool-result',
            toolCallId: `operation_${operation.id}`,
            toolName: 'ai.operation.result',
            output: {
              operationId: operation.id,
              success: result.success,
              result: result.result,
              duration: result.duration,
              error: result.error
            }
          })
        }
      )

      // 完成信号
      const summaryPayload = {
        reply: this.generateFinalReply(intent, plan, operationResults),
        intent: {
          type: intent.type,
          confidence: intent.confidence,
          reasoning: intent.reasoning,
          planSteps: intent.planSteps
        },
        summary: {
          operationsCount: operationResults.length,
          thinkingSteps: this.thinkingStream.getCurrentEvents().length
        }
      }

      if (res) {
        res.write(`data: ${JSON.stringify({
          type: 'complete',
          payload: summaryPayload
        })}\n\n`)

        res.end()
      } else {
        this.toolEvents.emit(userId, {
          type: 'tool-result',
          toolCallId: `intelligent_complete_${plan.id || executionContext.sessionId}`,
          toolName: 'ai.intelligent.summary',
          output: summaryPayload
        })
      }

    } catch (error) {
      if (activePlanId) {
        this.planManager.abortPlan(userId, activePlanId, '智能流式处理失败')
      }

      this.logger.error('Stream intelligent chat failed', error as any)

      if (res) {
        res.write(`data: ${JSON.stringify({
          type: 'error',
          payload: {
            message: '智能处理失败',
            error: (error as Error).message
          }
        })}\n\n`)

        res.end()
      } else {
        this.toolEvents.emit(userId, {
          type: 'tool-result',
          toolCallId: `intelligent_error_${Date.now()}`,
          toolName: 'ai.intelligent.error',
          output: {
            message: '智能处理失败',
            error: (error as Error).message
          }
        })
      }
    }
  }

  /**
   * 执行操作集合
   */
  private async executeOperations(
    operations: CanvasOperation[],
    context: ExecutionContext,
    plan?: ExecutionPlan,
    userId?: string,
    onResult?: (operation: CanvasOperation, result: ExecutionResult) => void
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = []
    let abortedEarly = false

    try {
      for (const operation of operations) {
        if (plan && userId && operation.planStepId) {
          this.planManager.markStepInProgress(
            userId,
            plan.id,
            operation.planStepId,
            `执行${operation.capability.name}`
          )
        }

        const result = await this.executionEngine.executeOperation(operation, context)
        results.push(result)
        onResult?.(operation, result)

        if (plan && userId && operation.planStepId) {
          if (result.success) {
            this.planManager.markStepCompleted(
              userId,
              plan.id,
              operation.planStepId,
              `${operation.capability.name}完成`
            )
          } else {
            this.planManager.markStepFailed(
              userId,
              plan.id,
              operation.planStepId,
              result.error || '执行失败'
            )
          }
        }

        // 如果关键操作失败，可以决定是否继续
        if (!result.success && operation.priority > 5) {
          this.logger.warn('Critical operation failed, stopping execution', {
            operation: operation.capability.name,
            error: result.error
          })
          abortedEarly = true
          break
        }
      }

      if (plan && userId) {
        const hasFailures = results.some(r => !r.success)
        const explanation = abortedEarly
          ? '计划因关键步骤失败提前终止'
          : hasFailures
            ? '部分步骤失败，计划需要人工处理'
            : '计划执行完成'
        this.planManager.completePlan(userId, plan.id, explanation)
      }

      return results
    } catch (error) {
      if (plan && userId) {
        this.planManager.abortPlan(userId, plan.id, '执行操作时出现异常')
      }
      throw error
    }
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
   * 调用传统 AI 助手以生成具体动作
   */
  private async invokeAssistantModel(
    userId: string,
    payload: ChatRequestDto
  ) {
    try {
      const chatPayload: ChatRequestDto = {
        ...payload,
        model: payload.model || DEFAULT_INTELLIGENT_MODEL,
        clientToolExecution: payload.clientToolExecution ?? true
      }
      return await this.aiService.chat(userId, chatPayload)
    } catch (error) {
      this.logger.warn('invokeAssistantModel failed, fallback to rule-based actions', error as any)
      return null
    }
  }

  /**
   * 获取智能服务统计信息
   */
  getStatistics() {
    return {
      intentRecognizer: this.intentRecognizer.getIntentStatistics(),
      executionEngine: this.executionEngine.getExecutionStatistics(),
      currentThinkingEvents: this.thinkingStream.getCurrentEvents().length,
      currentPlan: !!this.thinkingStream.getCurrentPlan(),
      activePlans: this.planManager.getActivePlanCount()
    }
  }

  /**
   * 清理资源
   */
  clearSession() {
    this.thinkingStream.clear()
    this.thinkingStream.clear()
    this.planManager.clear()
  }

  private splitNarrativeIntoScenes(source: string) {
    const sections = splitNarrativeSections(source, {
      maxScenes: 12,
      minLength: 60,
      targetLength: 260,
      maxChunkLength: 360
    })

    return sections.map((text, index) => ({
      index: index + 1,
      summary: this.buildSceneSummary(text),
      raw: text,
      hints: this.buildVideoHints(text)
    }))
  }

  private async handleNarrativeScenes(
    scenes: NarrativeScene[],
    userId: string,
    payload: ChatRequestDto,
    executionContext: ExecutionContext,
    originalInput: string
  ): Promise<IntelligentChatResponseDto> {
    if (!scenes.length) {
      return {
        reply: '未能解析出有效镜头，请重新描述需要生成的视频剧情。',
        plan: [],
        actions: [],
        thinkingEvents: [],
        intent: {
          type: CanvasActionDomain.NODE_MANIPULATION,
          confidence: 0.4,
          reasoning: '无有效剧情片段可执行',
          planSteps: []
        }
      }
    }

    const plan = this.buildNarrativeExecutionPlan(scenes)
    this.planManager.startPlan(
      userId,
      executionContext.sessionId,
      plan,
      '检测到长篇剧情，启动智能分镜并自动创建 composeVideo 节点'
    )

    const nodeCapability = canvasCapabilityRegistry.getCapabilityByName(
      CanvasActionDomain.NODE_MANIPULATION,
      '智能节点操作'
    )
    if (!nodeCapability) {
      throw new Error('未注册智能节点操作能力，无法自动创建 composeVideo 节点')
    }

    const model = payload.model || DEFAULT_INTELLIGENT_MODEL
    const continuity = this.summarizeCanvasContinuity(payload.context)
    const created: Array<{ label: string; rules: string[]; outline: string[] }> = []

    try {
      for (const scene of scenes) {
        const planStepId = this.resolvePlanStepId(plan, scene.index)
        if (planStepId) {
          this.planManager.markStepInProgress(userId, plan.id, planStepId, `第 ${scene.index} 镜提示词编写中`)
        }

        const scenePrompt = await this.aiService.generateScenePrompt(userId, {
          model,
          sceneIndex: scene.index,
          sceneCount: scenes.length,
          sceneSummary: scene.summary,
          sceneText: scene.raw,
          hints: scene.hints,
          contextSummary: continuity.description,
          characterNotes: continuity.characterNotes,
          styleNotes: continuity.styleNotes,
          videoNotes: continuity.videoNotes,
          userIntent: originalInput
        })

        const label = this.buildSceneLabel(scene, scenePrompt.title)
        const config = this.composeSceneNodeConfig(
          label,
          scene,
          scenePrompt,
          scenes.length,
          continuity
        )
        const operation: CanvasOperation = {
          id: `scene_${scene.index}_${Date.now()}`,
          capability: nodeCapability,
          parameters: {
            action: 'create',
            nodeType: 'video',
            position: this.computeScenePosition(scene.index),
            config
          },
          context: executionContext,
          priority: 5
        }

        await this.executionEngine.executeOperation(operation, executionContext)
        created.push({ label, rules: scenePrompt.realismRules, outline: scenePrompt.beatOutline })

        if (planStepId) {
          this.planManager.markStepCompleted(
            userId,
            plan.id,
            planStepId,
            `已创建 ${label} 并写入 prompt`
          )
        }
      }

      this.planManager.completePlan(userId, plan.id, '所有镜头已创建，等待视频生成完成')

      const replyLines = [
        '已进入智能分镜模式，为该段剧情创建以下 composeVideo 节点：',
        ...created.map((scene, idx) => {
          const realism = scene.rules.length ? `｜Realism：${scene.rules.join(', ')}` : ''
          const outline = scene.outline.length ? `｜Beats：${scene.outline.join(' / ')}` : ''
          return `${idx + 1}. ${scene.label} ${realism}${outline}`
        }),
        '',
        '提示词和负面词已自动写入节点并触发执行，可在画布检查日志/结果，若需调整可直接编辑节点重新运行。'
      ]

      return {
        reply: replyLines.join('\n'),
        plan: plan.steps.map(step => step.description),
        actions: [],
        thinkingEvents: [],
        intent: {
          type: CanvasActionDomain.NODE_MANIPULATION,
          confidence: 0.92,
          reasoning: '长篇剧情已拆解并写入 composeVideo，等待生成结果。',
          planSteps: plan.steps.map(step => step.description)
        }
      }
    } catch (error) {
      this.planManager.abortPlan(userId, plan.id, '镜头生成失败，已终止智能分镜流程')
      this.logger.error('Narrative scene execution failed', error as any)
      return {
        reply: `拆镜过程中出现异常：${(error as Error).message}。请检查网络或稍后重试。`,
        plan: plan.steps.map(step => `${step.name}（失败）`),
        actions: [],
        thinkingEvents: [],
        intent: {
          type: CanvasActionDomain.NODE_MANIPULATION,
          confidence: 0.35,
          reasoning: '智能分镜执行失败，需人工干预',
          planSteps: plan.steps.map(step => `${step.description}（失败）`)
        }
      }
    }
  }

  private buildNarrativeExecutionPlan(scenes: NarrativeScene[]): ExecutionPlan {
    const planId = `narrative_${Date.now()}`
    const steps = scenes.map(scene => ({
      id: `scene-${scene.index}`,
      name: `Scene ${scene.index}`,
      description: `Scene ${scene.index}：${scene.summary}`,
      status: 'pending' as const,
      reasoning: '自动创建 composeVideo 节点并写入提示词',
      estimatedTime: 2,
      dependencies: [],
      acceptanceCriteria: [`已创建 Scene ${scene.index} 的 composeVideo 节点并填入 prompt`]
    }))

    const dependencyEdges = steps.slice(1).map((step, idx) => ({
      source: steps[idx].id,
      target: step.id
    }))

    return {
      id: planId,
      strategy: {
        name: 'Narrative Scene Builder',
        description: '拆解长篇剧情并按镜头生成 composeVideo 节点',
        efficiency: 'medium',
        risk: 'medium',
        reasoning: '自动分镜 + 提示词生成'
      },
      steps,
      dependencies: {
        nodes: steps.map(step => step.id),
        edges: dependencyEdges
      },
      parallelGroups: [],
      risks: [],
      estimatedTime: steps.length * 2,
      estimatedCost: steps.length,
      rollbackPlan: { possible: false, steps: [] }
    }
  }

  private resolvePlanStepId(plan: ExecutionPlan, sceneIndex: number) {
    const step = plan.steps.find(entry => entry.id === `scene-${sceneIndex}`)
    return step?.id
  }

  private composeSceneNodeConfig(
    label: string,
    scene: NarrativeScene,
    prompt: ScenePromptResult,
    totalScenes: number,
    continuity: ReturnType<typeof this.summarizeCanvasContinuity>
  ) {
    return {
      kind: 'composeVideo',
      label,
      prompt: prompt.prompt,
      videoPrompt: prompt.prompt,
      negativePrompt: prompt.negativePrompt,
      keywords: prompt.keywords,
      videoDurationSeconds: prompt.durationSeconds,
      duration: prompt.durationSeconds,
      orientation: prompt.orientation,
      videoOrientation: prompt.orientation,
      videoModel: prompt.modelSuggestion || 'sy_8',
      sceneIndex: scene.index,
      sceneCount: totalScenes,
      sceneSummary: scene.summary,
      sceneHints: scene.hints,
      sceneOutline: prompt.beatOutline,
      cameraPlan: prompt.cameraPlan,
      environmentNotes: prompt.environmentNotes,
      microNarrative: prompt.microNarrative,
      realismRuleIds: prompt.realismRules,
      continuitySnapshot: continuity.description,
      continuityCharacters: continuity.characterNotes,
      continuityStyleRefs: continuity.styleNotes,
      continuityVideoRefs: continuity.videoNotes,
      autoRun: true
    }
  }

  private computeScenePosition(index: number) {
    const columnSize = 3
    const spacingX = 420
    const spacingY = 340
    const col = (index - 1) % columnSize
    const row = Math.floor((index - 1) / columnSize)
    return {
      x: 120 + col * spacingX,
      y: 80 + row * spacingY
    }
  }

  private buildSceneLabel(scene: NarrativeScene, aiTitle?: string) {
    const safeTitle = (aiTitle || scene.summary || `Scene ${scene.index}`).replace(/\s+/g, ' ').trim()
    const short = safeTitle.length > 42 ? `${safeTitle.slice(0, 42)}…` : safeTitle
    const indexText = String(scene.index).padStart(2, '0')
    return `Scene ${indexText} · ${short || 'Untitled'}`
  }

  private summarizeCanvasContinuity(context?: CanvasContextDto | null) {
    if (!context) {
      return {
        description: 'No existing canvas continuity. Treat this as a fresh establishing shot.',
        characterNotes: [] as string[],
        styleNotes: [] as string[],
        videoNotes: [] as string[]
      }
    }

    const characterNotes = (context.characters || [])
      .slice(0, 6)
      .map(character => {
        const username = character.username ? `@${character.username}` : character.label || character.nodeId
        const desc = character.description ? ` - ${character.description}` : ''
        return `${username}${desc}`
      })

    const styleNotes = (context.nodes || [])
      .filter(node => ['image', 'textToImage'].includes(String((node as any).kind || '')))
      .slice(0, 4)
      .map(node => `${node.label || node.id} (${(node as any).kind || 'image'})`)

    const videoNotes = (context.videoBindings || [])
      .slice(0, 5)
      .map(binding => {
        const chars = binding.characters?.map(char => char.label || char.username || char.nodeId).join(', ')
        const prompt = binding.promptPreview ? ` prompt: ${binding.promptPreview}` : ''
        return `${binding.label || binding.nodeId}${chars ? ` — ${chars}` : ''}${prompt}`
      })

    const timelineEntries = Array.isArray((context as any)?.timeline)
      ? ((context as any).timeline as Array<any>).slice(0, 4).map((entry: any) => {
          const chars = Array.isArray(entry.characters)
            ? entry.characters.map((c: any) => c.label || c.username).join(', ')
            : ''
          return `${entry.label || entry.nodeId} (${entry.status || 'unknown'})${chars ? ` ｜ ${chars}` : ''}`
        })
      : []

    const lines = [
      characterNotes.length ? `Characters: ${characterNotes.join('; ')}` : '',
      styleNotes.length ? `Image style refs: ${styleNotes.join('; ')}` : '',
      videoNotes.length ? `Existing video beats: ${videoNotes.join(' | ')}` : '',
      timelineEntries.length ? `Timeline: ${timelineEntries.join(' -> ')}` : ''
    ].filter(Boolean)

    return {
      description: lines.length
        ? lines.join('\n')
        : 'No notable characters or prior shots, you can establish tone freely.',
      characterNotes,
      styleNotes,
      videoNotes
    }
  }

  private buildSceneSummary(text: string) {
    const trimmed = text.trim()
    if (trimmed.length <= 64) return trimmed
    return `${trimmed.slice(0, 64)}…`
  }

  private buildVideoHints(text: string) {
    const hints: string[] = []
    const normalized = text
    if (/僧|和尚|佛/.test(normalized)) hints.push('monks inside lotus altars')
    if (/血|首|尸/.test(normalized)) hints.push('blood-soaked horror beats')
    if (/雨|风|伞/.test(normalized)) hints.push('cold mountain rain and gusts')
    if (/李长安/.test(normalized)) hints.push('protagonist Li Changan must appear')
    if (/余云寺|寺|佛/.test(normalized)) hints.push('ruined temples and lotus pedestals')
    if (/魂|鬼|空衍/.test(normalized)) hints.push('spectral monks or ghostly presences')
    return hints
  }
}
