import { Injectable, Logger } from '@nestjs/common'
import { ToolEventsService, ToolEvent } from '../tool-events.service'
import {
  CanvasOperation,
  ExecutionResult,
  ExecutionContext,
  CanvasActionDomain
} from '../core/types/canvas-intelligence.types'
import { generateXiaohongshuPrompt } from '../capabilities/xiaohongshu-cover.capability'

@Injectable()
export class WebExecutionEngine {
  private readonly logger = new Logger(WebExecutionEngine.name)

  constructor(private readonly toolEvents: ToolEventsService) {}

  /**
   * 执行画布操作 - 将AI指令转换为前端可执行的操作
   */
  async executeOperation(
    operation: CanvasOperation,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now()

    try {
      this.logger.debug('Executing canvas operation', {
        operation: operation.capability.name,
        domain: operation.capability.domain,
        userId: context.userId
      })

      // 1. 验证操作
      await this.validateOperation(operation, context)

      // 2. 根据域分发执行
      let result: ExecutionResult

      switch (operation.capability.domain) {
        case CanvasActionDomain.NODE_MANIPULATION:
          result = await this.executeNodeManipulation(operation, context)
          break

        case CanvasActionDomain.LAYOUT_ARRANGEMENT:
          result = await this.executeLayoutArrangement(operation, context)
          break

        case CanvasActionDomain.EXECUTION_DEBUG:
          result = await this.executeExecutionDebug(operation, context)
          break

        case CanvasActionDomain.VIEW_NAVIGATION:
          result = await this.executeViewNavigation(operation, context)
          break

        case CanvasActionDomain.PROJECT_MANAGEMENT:
          result = await this.executeProjectManagement(operation, context)
          break

        default:
          throw new Error(`Unsupported operation domain: ${operation.capability.domain}`)
      }

      // 3. 计算执行时间
      result.duration = Date.now() - startTime

      this.logger.debug('Operation executed successfully', {
        operation: operation.capability.name,
        duration: result.duration,
        success: result.success
      })

      return result

    } catch (error) {
      const errorResult: ExecutionResult = {
        success: false,
        operation,
        error: (error as Error).message,
        duration: Date.now() - startTime
      }

      this.logger.error('Operation execution failed', {
        operation: operation.capability.name,
        error: (error as Error).message,
        duration: errorResult.duration
      })

      return errorResult
    }
  }

  /**
   * 执行节点操作
   */
  private async executeNodeManipulation(
    operation: CanvasOperation,
    context: ExecutionContext
  ): Promise<ExecutionResult> {

    const { parameters } = operation

    // 特殊处理小红书封面生成
    if (operation.capability.name === '小红书封面生成') {
      return this.executeXiaohongshuCover(operation, context)
    }

    // 发送节点操作事件到前端
    const toolCallId = `node_manipulation_${Date.now()}`
    const eventPayload: ToolEvent = {
      type: 'tool-call',
      toolCallId,
      toolName: 'canvas.node.operation',
      input: {
        action: parameters.action,
        nodeType: parameters.nodeType,
        position: parameters.position,
        config: parameters.config,
        nodeIds: parameters.nodeIds,
        operations: parameters.operations
      }
    }

    // 通过现有的事件系统发送到前端
    this.toolEvents.emit(context.userId, eventPayload)

    return {
      success: true,
      operation,
      result: {
        message: `节点操作"${parameters.action}"已发送到前端执行`,
        affectedElements: parameters.nodeIds || [`${parameters.action}_${Date.now()}`]
      },
      duration: 0,
      affectedElements: parameters.nodeIds || []
    }
  }

  /**
   * 执行小红书封面生成
   */
  private async executeXiaohongshuCover(
    operation: CanvasOperation,
    context: ExecutionContext
  ): Promise<ExecutionResult> {

    const { parameters } = operation

    // 智能生成小红书风格提示词
    const prompt = generateXiaohongshuPrompt(
      operation.capability.name,
      parameters
    )

    const toolCallId = `xiaohongshu_cover_${Date.now()}`
    const eventPayload: ToolEvent = {
      type: 'tool-call',
      toolCallId,
      toolName: 'canvas.node.create',
      input: {
        action: 'create',
        nodeType: 'image',
        position: parameters.position || { x: 100, y: 100 },
        config: {
          kind: 'image',
          prompt: prompt,
          style: parameters.style || 'ins风',
          size: parameters.size || '1024x1365',
          quality: 'high'
        }
      }
    }

    this.toolEvents.emit(context.userId, eventPayload)

    return {
      success: true,
      operation,
      result: {
        message: `小红书封面节点已创建，提示词: ${prompt.substring(0, 100)}...`,
        prompt: prompt,
        affectedElements: [`xiaohongshu_cover_${Date.now()}`]
      },
      duration: 0,
      affectedElements: [`xiaohongshu_cover_${Date.now()}`]
    }
  }

  /**
   * 执行布局排列
   */
  private async executeLayoutArrangement(
    operation: CanvasOperation,
    context: ExecutionContext
  ): Promise<ExecutionResult> {

    const { parameters } = operation

    // 发送布局操作事件到前端
    const toolCallId = `layout_arrangement_${Date.now()}`
    const eventPayload: ToolEvent = {
      type: 'tool-call',
      toolCallId,
      toolName: 'canvas.layout.apply',
      input: {
        algorithm: parameters.layoutType || 'grid',
        options: {
          alignment: parameters.alignment || 'center',
          spacing: parameters.spacing || 100,
          animationDuration: parameters.animationDuration || 800,
          nodeIds: parameters.nodeIds,
          arrangement: parameters.arrangement
        }
      }
    }

    this.toolEvents.emit(context.userId, eventPayload)

    return {
      success: true,
      operation,
      result: {
        message: `布局"${parameters.layoutType}"已应用到画布`,
        affectedElements: parameters.nodeIds || ['all_nodes']
      },
      duration: 0,
      affectedElements: parameters.nodeIds || []
    }
  }

  /**
   * 执行调试优化
   */
  private async executeExecutionDebug(
    operation: CanvasOperation,
    context: ExecutionContext
  ): Promise<ExecutionResult> {

    const { parameters } = operation

    // 发送分析请求到前端
    const toolCallId = `execution_debug_${Date.now()}`
    const eventPayload: ToolEvent = {
      type: 'tool-call',
      toolCallId,
      toolName: 'canvas.optimization.analyze',
      input: {
        analysisType: parameters.analysisType || 'performance',
        scope: parameters.scope || 'entire_workflow',
        optimizationGoal: parameters.optimizationGoal,
        aggressiveness: parameters.aggressiveness,
        autoApply: parameters.autoApply || false
      }
    }

    this.toolEvents.emit(context.userId, eventPayload)

    return {
      success: true,
      operation,
      result: {
        message: `工作流${parameters.analysisType || '性能'}分析已启动`,
        affectedElements: ['workflow_analysis']
      },
      duration: 0,
      affectedElements: ['workflow_analysis']
    }
  }

  /**
   * 执行视图导航
   */
  private async executeViewNavigation(
    operation: CanvasOperation,
    context: ExecutionContext
  ): Promise<ExecutionResult> {

    const { parameters } = operation

    const toolCallId = `view_navigation_${Date.now()}`
    const eventPayload: ToolEvent = {
      type: 'tool-call',
      toolCallId,
      toolName: 'canvas.view.navigate',
      input: {
        action: parameters.action,
        targets: parameters.targets,
        zoom: parameters.zoom,
        duration: parameters.duration || 600
      }
    }

    this.toolEvents.emit(context.userId, eventPayload)

    return {
      success: true,
      operation,
      result: {
        message: `视图导航操作已执行`,
        affectedElements: parameters.targets || ['canvas_view']
      },
      duration: 0,
      affectedElements: parameters.targets || []
    }
  }

  /**
   * 执行项目管理
   */
  private async executeProjectManagement(
    operation: CanvasOperation,
    context: ExecutionContext
  ): Promise<ExecutionResult> {

    const { parameters } = operation

    const toolCallId = `project_management_${Date.now()}`
    const eventPayload: ToolEvent = {
      type: 'tool-call',
      toolCallId,
      toolName: 'project.operation',
      input: {
        action: parameters.action,
        projectName: parameters.projectName,
        description: parameters.description,
        templateId: parameters.templateId
      }
    }

    this.toolEvents.emit(context.userId, eventPayload)

    return {
      success: true,
      operation,
      result: {
        message: `项目操作"${parameters.action}"已执行`,
        affectedElements: ['project']
      },
      duration: 0,
      affectedElements: ['project']
    }
  }

  /**
   * 验证操作的有效性
   */
  private async validateOperation(
    operation: CanvasOperation,
    context: ExecutionContext
  ): Promise<void> {

    if (!operation.capability) {
      throw new Error('Operation capability is required')
    }

    if (!context.userId) {
      throw new Error('User context is required')
    }

    // 根据不同的域进行特定的验证
    switch (operation.capability.domain) {
      case CanvasActionDomain.NODE_MANIPULATION:
        await this.validateNodeManipulation(operation)
        break

      case CanvasActionDomain.LAYOUT_ARRANGEMENT:
        await this.validateLayoutArrangement(operation)
        break

      case CanvasActionDomain.EXECUTION_DEBUG:
        await this.validateExecutionDebug(operation)
        break
    }
  }

  private async validateNodeManipulation(operation: CanvasOperation): Promise<void> {
    const { parameters } = operation

    if (!parameters.action) {
      throw new Error('Node manipulation action is required')
    }

    if (parameters.action === 'create' && !parameters.nodeType) {
      throw new Error('Node type is required for create action')
    }

    if ((parameters.action === 'update' || parameters.action === 'delete') && !parameters.nodeIds) {
      throw new Error('Node IDs are required for update/delete actions')
    }
  }

  private async validateLayoutArrangement(operation: CanvasOperation): Promise<void> {
    const { parameters } = operation

    const validLayoutTypes = ['grid', 'hierarchical', 'circular', 'force-directed']
    if (parameters.layoutType && !validLayoutTypes.includes(parameters.layoutType)) {
      throw new Error(`Invalid layout type. Must be one of: ${validLayoutTypes.join(', ')}`)
    }

    const validAlignments = ['left', 'center', 'right', 'top', 'middle', 'bottom']
    if (parameters.alignment && !validAlignments.includes(parameters.alignment)) {
      throw new Error(`Invalid alignment. Must be one of: ${validAlignments.join(', ')}`)
    }
  }

  private async validateExecutionDebug(operation: CanvasOperation): Promise<void> {
    const { parameters } = operation

    const validAnalysisTypes = ['performance', 'cost', 'quality', 'bottleneck', 'dependency']
    if (parameters.analysisType && !validAnalysisTypes.includes(parameters.analysisType)) {
      throw new Error(`Invalid analysis type. Must be one of: ${validAnalysisTypes.join(', ')}`)
    }

    const validScopes = ['entire_workflow', 'selected_nodes', 'specific_path']
    if (parameters.scope && !validScopes.includes(parameters.scope)) {
      throw new Error(`Invalid scope. Must be one of: ${validScopes.join(', ')}`)
    }
  }

  /**
   * 获取执行统计信息
   */
  getExecutionStatistics() {
    return {
      supportedDomains: Object.values(CanvasActionDomain),
      eventChannels: [
        'canvas.node.operation',
        'canvas.layout.apply',
        'canvas.optimization.analyze',
        'canvas.view.navigate',
        'project.operation'
      ]
    }
  }
}