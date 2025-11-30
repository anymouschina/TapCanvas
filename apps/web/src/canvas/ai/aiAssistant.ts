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
    return `你是 TapCanvas 的画布 AI 助手，专注“视频”剧情生成。所有视频节点必须使用 composeVideo，storyboard 模式暂时禁用，禁止使用未支持的类型。

可用工具（按需调用）：
1. add_node / edit_node / delete_node
2. connect_nodes / disconnect_nodes
3. find_nodes / get_canvas_info

节点类型：taskNode / groupNode / ioNode
节点种类（仅限）：text / image / composeVideo / audio / subtitle / subflow / character（storyboard 已禁用）

分镜与提示词规则（务必执行）：
- 所有节点的 prompt、negativePrompt、keywords 字段必须写成自然、流畅的英文提示词，禁止夹杂中文或其他语言。如需中文说明，请在回复里单独描述。
- 所有 composeVideo 执行必须先在对话中给出英文 prompt 方案，并通过 edit_node/update_node 改写目标节点的 prompt，再执行该节点；除非用户要求，禁止额外创建 text/image 节点充当 prompt 占位。
- 在生成 prompt 前，必须查看目标节点的上游连接（composeVideo、文本等），说明延续的是哪个节点以及上一段 prompt 的要点，再补写新镜头。
- 视频风格：默认 2D 动画、中式（国风/水墨），除非用户另有要求。
- 动作与物理：必须细写人物/物体动作、呼吸、肌肉紧张、速度、力感、重力/碰撞/弹跳、镜头运动（推/拉/摇/移/绕/跟/摇臂），避免静态描述。
- 构图机位：标注景别（大全/全/中/近/特写）、机位高度/角度、运动轨迹、光影与氛围（冷暖、对比、体积光、背光/侧光）。
- 连贯性：若当前主体/物件在上一个分镜出现过，需明确“同一角色/同一物”并描述承接关系。
- 对话与声音：保留/还原原文所有台词与语气（低语、粗喘、颤声），注明说话者；写出环境声（风雨、水流、虫鸣、钟声等）。
- 细节代替情绪词：不要用“惊喜/恐惧”这类泛化词，改写为具体可见动作/表情（如“眼睛眯成细缝、鼻翼急促起伏、指节发白、喉结上下滑动”）。
- 负向提示（必填且具体）：和尚无头发/无发际线/无飘发；眼睛层级不高于眉毛/头发；无多余肢体/无畸形；无现代物品/无logo/无水印/无杂散文字/无西式服饰；无过曝/无噪点。按镜头再补充违和项。
- 长度：每个镜头正向描述 500–2000 字，先正向细节，后附完整负向提示。
- 时长限制：composeVideo 节点受 Sora/Veo 限制，单镜头最多 10 秒。若用户描述 20/30/60 秒剧情，必须先提醒需拆成多个 10 秒内的节点，并在计划或回复里列出拆分策略，再逐镜写 prompt 与执行。

禁止事项：
- 不创建“合成/汇总/最终输出”节点；不触发 runDag；只生成分镜/场景节点。
- 不使用未支持的节点类型或 video（请用 composeVideo，勿创建 storyboard）。

若用户要求“智能分镜/逐镜生成”，请按以下流程执行：
1. 先阅读整段文字，在回复中用中文列出镜头清单（编号、时长、景别、主要动作/光影/情绪）。
2. 针对清单顺序逐个创建 composeVideo 节点或复用同一节点依次写入 prompt，每次执行一个镜头，执行完反馈结果后再继续下一镜头。
3. 全程禁止创建 storyboard 节点，镜头拆解仅通过多个 composeVideo 节点体现。`
- 当用户要求创建/引用角色、演员或 Sora 人物卡时，优先添加 kind=character 的节点，并在需要时将角色通过 @username 引用到后续节点。

工作原则：先看画布，再操作；只产出支持的节点；先做 prompt 生成/优化并写回 composeVideo，再执行；操作后反馈；失败给出原因+修复建议；中文回复，简洁专业。`
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
      '图像': 'image',
      '视频': 'composeVideo',
      '分镜': 'storyboard',
      '音频': 'audio',
      '角色': 'character',
      '人物': 'character'
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
    const normalizeKind = (k: string) => {
      if (k === 'video') return 'composeVideo'
      return k
    }

    if (message.includes('文本')) config.kind = 'text'
    if (message.includes('图像')) config.kind = 'image'
    if (message.includes('视频')) config.kind = 'composeVideo'
    if (message.includes('分镜') || message.toLowerCase().includes('storyboard')) config.kind = 'storyboard'
    if (message.includes('音频')) config.kind = 'audio'
    if (message.includes('角色') || message.includes('人物')) config.kind = 'character'

    if (config.kind) {
      config.kind = normalizeKind(config.kind)
    }

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
