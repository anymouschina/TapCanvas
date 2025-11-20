/**
 * AI助手服务
 * 负责与AI模型交互，处理工具调用
 */

import { aiCanvasTools, type ToolResult } from './tools'

export interface AIMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  toolCalls?: ToolCall[]
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, any>
  result?: ToolResult
}

export interface ChatOptions {
  model?: 'openai' | 'anthropic' | 'google'
  apiKey?: string
  systemPrompt?: string
  maxTokens?: number
}

export class AIAssistant {
  private tools = aiCanvasTools
  private messages: AIMessage[] = []
  private apiKey: string = ''
  private model: 'openai' | 'anthropic' | 'google' = 'openai'

  constructor(options?: ChatOptions) {
    this.model = options?.model || 'openai'
    this.apiKey = options?.apiKey || ''
    this.addSystemMessage(options?.systemPrompt || this.getDefaultSystemPrompt())
  }

  private getDefaultSystemPrompt(): string {
    return `你是一个专业的画布操作AI助手，可以帮助用户管理TapCanvas工作流画布。

你有以下工具可以使用：
1. add_node - 添加新节点
2. edit_node - 编辑现有节点
3. delete_node - 删除节点
4. connect_nodes - 连接节点
5. find_nodes - 查找节点
6. get_canvas_info - 获取画布信息

节点类型包括：
- taskNode - 任务节点
- groupNode - 分组节点
- ioNode - 输入输出节点

节点种类包括：
- text - 文本节点
- image - 图像节点
- video - 视频节点
- audio - 音频节点
- subtitle - 字幕节点
- subflow - 子流程节点
- 等等...

工作原则：
1. 每次操作前先了解当前画布状态
2. 根据用户需求选择合适的工具
3. 操作后确认结果是否符合预期
4. 如果操作失败，分析原因并提供解决方案
5. 使用中文回复用户

请用专业、友好的语调与用户交流。`
  }

  private addSystemMessage(content: string) {
    this.messages.push({
      role: 'system',
      content,
      timestamp: new Date()
    })
  }

  /**
   * 处理用户消息
   */
  async chat(userMessage: string): Promise<AIMessage> {
    // 添加用户消息
    const userMsg: AIMessage = {
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    }
    this.messages.push(userMsg)

    try {
      // 获取AI回复
      const assistantResponse = await this.getAIResponse(userMessage)

      // 添加助手消息
      const assistantMsg: AIMessage = {
        role: 'assistant',
        content: assistantResponse.content,
        timestamp: new Date(),
        toolCalls: assistantResponse.toolCalls
      }
      this.messages.push(assistantMsg)

      return assistantMsg
    } catch (error) {
      const errorMsg: AIMessage = {
        role: 'assistant',
        content: `抱歉，处理您的请求时出现错误：${error instanceof Error ? error.message : '未知错误'}`,
        timestamp: new Date()
      }
      this.messages.push(errorMsg)
      return errorMsg
    }
  }

  /**
   * 获取AI响应
   */
  private async getAIResponse(userMessage: string): Promise<{
    content: string
    toolCalls?: ToolCall[]
  }> {
    // 这里简化处理，实际应该根据选择的模型调用对应的API
    // 先进行工具调用检测和执行

    const toolResults: ToolCall[] = []
    let response = ''

    // 简单的工具调用检测逻辑（实际应该使用AI模型的function calling能力）
    if (this.shouldUseTools(userMessage)) {
      const detectedTools = this.detectToolsFromMessage(userMessage)

      for (const tool of detectedTools) {
        const result = await this.executeTool(tool.name, tool.arguments)
        toolResults.push({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          name: tool.name,
          arguments: tool.arguments,
          result
        })
      }
    }

    // 生成响应
    response = await this.generateResponse(userMessage, toolResults)

    return {
      content: response,
      toolCalls: toolResults.length > 0 ? toolResults : undefined
    }
  }

  /**
   * 检测是否需要使用工具
   */
  private shouldUseTools(message: string): boolean {
    const toolKeywords = [
      '添加', '创建', '新增', '删除', '移除', '编辑', '修改', '更新',
      '连接', '链接', '查找', '搜索', '显示', '查看', '节点', '画布'
    ]
    return toolKeywords.some(keyword => message.includes(keyword))
  }

  /**
   * 从消息中检测需要的工具调用
   */
  private detectToolsFromMessage(message: string): Array<{
    name: string
    arguments: Record<string, any>
  }> {
    const tools: Array<{ name: string; arguments: Record<string, any> }> = []

    // 添加节点检测
    if (message.match(/添加.*节点|创建.*节点|新增.*节点/)) {
      const type = this.extractNodeType(message) || 'taskNode'
      tools.push({
        name: 'add_node',
        arguments: {
          type,
          label: this.extractNodeLabel(message),
          config: this.extractNodeConfig(message)
        }
      })
    }

    // 删除节点检测
    if (message.match(/删除.*节点|移除.*节点/)) {
      const nodeId = this.extractNodeId(message)
      if (nodeId) {
        tools.push({
          name: 'delete_node',
          arguments: { nodeId }
        })
      }
    }

    // 编辑节点检测
    if (message.match(/编辑.*节点|修改.*节点|更新.*节点/)) {
      const nodeId = this.extractNodeId(message)
      if (nodeId) {
        tools.push({
          name: 'edit_node',
          arguments: {
            nodeId,
            label: this.extractNodeLabel(message),
            config: this.extractNodeConfig(message)
          }
        })
      }
    }

    // 连接节点检测
    if (message.match(/连接.*节点|链接.*节点/)) {
      const nodeIds = this.extractNodeIdsForConnection(message)
      if (nodeIds.length >= 2) {
        tools.push({
          name: 'connect_nodes',
          arguments: {
            sourceId: nodeIds[0],
            targetId: nodeIds[1]
          }
        })
      }
    }

    // 查找节点检测
    if (message.match(/查找.*节点|搜索.*节点|显示.*节点/)) {
      tools.push({
        name: 'find_nodes',
        arguments: {
          type: this.extractNodeType(message),
          label: this.extractNodeLabel(message)
        }
      })
    }

    // 获取画布信息检测
    if (message.match(/画布.*信息|显示画布|查看画布/)) {
      tools.push({
        name: 'get_canvas_info',
        arguments: { includeData: message.includes('详细') || message.includes('数据') }
      })
    }

    return tools
  }

  /**
   * 执行工具调用
   */
  private async executeTool(toolName: string, args: Record<string, any>): Promise<ToolResult> {
    switch (toolName) {
      case 'add_node':
        return await this.tools.addNode(args)
      case 'edit_node':
        return await this.tools.editNode(args)
      case 'delete_node':
        return await this.tools.deleteNode(args)
      case 'connect_nodes':
        return await this.tools.connectNodes(args)
      case 'find_nodes':
        return await this.tools.findNodes(args)
      case 'get_canvas_info':
        return await this.tools.getCanvasInfo(args)
      default:
        return {
          success: false,
          error: `未知工具: ${toolName}`
        }
    }
  }

  /**
   * 生成响应
   */
  private async generateResponse(userMessage: string, toolResults: ToolCall[]): Promise<string> {
    if (toolResults.length === 0) {
      return '我理解您想要进行画布操作。请告诉我您具体想要做什么，比如"添加一个文本节点"或"显示当前画布信息"。'
    }

    let response = '我已为您执行了以下操作：\n\n'

    for (const toolCall of toolResults) {
      const result = toolCall.result!
      if (result.success) {
        response += `✅ ${this.formatToolCallDescription(toolCall)}\n`
        if (result.data && typeof result.data === 'object') {
          response += `   结果：${JSON.stringify(result.data, null, 2)}\n`
        }
      } else {
        response += `❌ ${this.formatToolCallDescription(toolCall)}\n`
        response += `   错误：${result.error}\n`
      }
      response += '\n'
    }

    response += '还需要我帮您做什么吗？'
    return response
  }

  /**
   * 格式化工具调用描述
   */
  private formatToolCallDescription(toolCall: ToolCall): string {
    const { name, arguments: args } = toolCall
    switch (name) {
      case 'add_node':
        return `添加节点 "${args.label || args.type}"`
      case 'edit_node':
        return `编辑节点 ${args.nodeId}`
      case 'delete_node':
        return `删除节点 ${args.nodeId}`
      case 'connect_nodes':
        return `连接节点 ${args.sourceId} -> ${args.targetId}`
      case 'find_nodes':
        return `查找节点 ${args.type || args.label || ''}`
      case 'get_canvas_info':
        return `获取画布信息`
      default:
        return `执行工具 ${name}`
    }
  }

  // 消息解析辅助方法
  private extractNodeType(message: string): string | null {
    const typePatterns = {
      '任务': 'taskNode',
      '分组': 'groupNode',
      '输入输出': 'ioNode',
      '文本': 'text',
      '图像': 'image',
      '视频': 'video',
      '音频': 'audio'
    }

    for (const [key, value] of Object.entries(typePatterns)) {
      if (message.includes(key)) return value
    }
    return null
  }

  private extractNodeLabel(message: string): string | undefined {
    const match = message.match(/"([^"]+)"/) || message.match(/'([^']+)'/)
    return match ? match[1] : undefined
  }

  private extractNodeConfig(message: string): Record<string, any> {
    const config: Record<string, any> = {}

    // 简单的配置提取逻辑
    if (message.includes('文本')) config.kind = 'text'
    if (message.includes('图像')) config.kind = 'image'
    if (message.includes('视频')) config.kind = 'video'
    if (message.includes('音频')) config.kind = 'audio'

    return config
  }

  private extractNodeId(message: string): string | undefined {
    const match = message.match(/节点[：:]\s*(\w+)/) || message.match(/ID[：:]\s*(\w+)/)
    return match ? match[1] : undefined
  }

  private extractNodeIdsForConnection(message: string): string[] {
    const matches = message.match(/\b(\w+)\b/g) || []
    return matches.filter(id => id.length > 3) // 过滤掉短词
  }

  /**
   * 获取聊天历史
   */
  getMessages(): AIMessage[] {
    return [...this.messages]
  }

  /**
   * 清空聊天历史
   */
  clearHistory() {
    this.messages = this.messages.filter(msg => msg.role === 'system')
  }

  /**
   * 获取可用工具列表
   */
  getAvailableTools() {
    return this.tools.getAvailableTools()
  }
}

// 导出默认实例
export const aiAssistant = new AIAssistant()