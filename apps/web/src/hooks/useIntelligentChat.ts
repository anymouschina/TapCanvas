import { useState, useCallback, useEffect, useRef } from 'react'
import type {
  IntelligentChatResponse,
  ThinkingEvent,
  ExecutionPlan,
  UseIntelligentChatOptions,
  UseIntelligentChatReturn,
  IntelligentChatMessage,
  CanvasWebSocketEvent
} from '../types/canvas-intelligence'

export const useIntelligentChat = (options: UseIntelligentChatOptions): UseIntelligentChatReturn => {
  const {
    userId,
    intelligentMode: initialIntelligentMode = true,
    enableThinking: initialEnableThinking = true,
    context,
    onThinkingEvent,
    onOperationExecuted,
    onError
  } = options

  const [messages, setMessages] = useState<IntelligentChatMessage[]>([])
  const [thinkingEvents, setThinkingEvents] = useState<ThinkingEvent[]>([])
  const [currentPlan, setCurrentPlan] = useState<ExecutionPlan | undefined>()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | undefined>()
  const [intelligentMode, setIntelligentMode] = useState(initialIntelligentMode)
  const [enableThinking, setEnableThinking] = useState(initialEnableThinking)

  const wsRef = useRef<WebSocket | null>(null)
  const sessionIdRef = useRef<string>(generateSessionId())

  // 生成会话ID
  function generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  // 初始化WebSocket连接
  useEffect(() => {
    if (!userId) return

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/ai/tool-events?userId=${userId}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('Intelligent chat WebSocket connected')
    }

    ws.onmessage = (event) => {
      try {
        const data: CanvasWebSocketEvent = JSON.parse(event.data)

        switch (data.type) {
          case 'thinking-event':
            handleThinkingEvent(data.payload)
            break

          case 'canvas.operation':
            handleCanvasOperation(data)
            break

          case 'canvas.layout.apply':
            handleLayoutOperation(data)
            break

          case 'canvas.optimization.analyze':
            handleOptimizationOperation(data)
            break

          default:
            console.log('Unknown WebSocket event type:', data.type)
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error)
      }
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      setError(new Error('WebSocket连接失败'))
    }

    ws.onclose = () => {
      console.log('WebSocket connection closed')
    }

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
      }
    }
  }, [userId])

  // 处理思考事件
  const handleThinkingEvent = useCallback((event: ThinkingEvent) => {
    setThinkingEvents(prev => [...prev, event])

    if (onThinkingEvent) {
      onThinkingEvent(event)
    }
  }, [onThinkingEvent])

  // 处理画布操作
  const handleCanvasOperation = useCallback((data: any) => {
    if (onOperationExecuted) {
      onOperationExecuted(data.payload)
    }
  }, [onOperationExecuted])

  // 处理布局操作
  const handleLayoutOperation = useCallback((data: any) => {
    if (onOperationExecuted) {
      onOperationExecuted({
        type: 'layout',
        payload: data.payload
      })
    }
  }, [onOperationExecuted])

  // 处理优化操作
  const handleOptimizationOperation = useCallback((data: any) => {
    if (onOperationExecuted) {
      onOperationExecuted({
        type: 'optimization',
        payload: data.payload
      })
    }
  }, [onOperationExecuted])

  // 发送消息
  const sendMessage = useCallback(async (message: string, options?: any) => {
    if (!message.trim()) return

    setIsLoading(true)
    setError(undefined)

    // 添加用户消息
    const userMessage: IntelligentChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: message.trim(),
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])

    try {
      const requestOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: message.trim() }],
          context: context || {},
          intelligentMode: options?.intelligentMode ?? intelligentMode,
          enableThinking: options?.enableThinking ?? enableThinking,
          sessionId: sessionIdRef.current
        })
      }

      if (options?.stream) {
        // 流式请求处理
        const response = await fetch('/api/ai/chat/intelligent/stream', requestOptions)

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        const reader = response.body?.getReader()
        const decoder = new TextDecoder()

        if (reader) {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunk = decoder.decode(value)
            const lines = chunk.split('\n')

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6))
                  handleStreamEvent(data)
                } catch (e) {
                  console.error('Failed to parse stream data:', e)
                }
              }
            }
          }
        }
      } else {
        // 普通请求处理
        const response = await fetch('/api/ai/chat/intelligent', requestOptions)

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        const result: IntelligentChatResponse = await response.json()
        handleChatResponse(result)
      }

    } catch (error) {
      console.error('Failed to send message:', error)
      const err = error instanceof Error ? error : new Error('Unknown error')
      setError(err)

      if (onError) {
        onError(err)
      }

      // 添加错误消息
      const errorMessage: IntelligentChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '抱歉，处理您的请求时遇到了问题。请稍后再试。',
        timestamp: new Date()
      }

      setMessages(prev => [...prev, errorMessage])

    } finally {
      setIsLoading(false)
    }
  }, [intelligentMode, enableThinking, context, onError, onThinkingEvent, onOperationExecuted])

  // 处理流式事件
  const handleStreamEvent = useCallback((data: any) => {
    switch (data.type) {
      case 'thinking':
        handleThinkingEvent(data.payload)
        break

      case 'intent':
        // 可以在这里更新当前的意图信息
        console.log('Current intent:', data.payload)
        break

      case 'plan':
        setCurrentPlan(data.payload)
        break

      case 'operation_result':
        // 处理操作结果
        console.log('Operation result:', data.payload)
        break

      case 'complete':
        // 处理完成事件
        const assistantMessage: IntelligentChatMessage = {
          id: Date.now().toString(),
          role: 'assistant',
          content: data.payload.reply,
          timestamp: new Date(),
          thinkingEvents: [...thinkingEvents],
          plan: currentPlan ? currentPlan.steps.map(step => step.description) : [],
          intent: data.payload.intent
        }

        setMessages(prev => [...prev, assistantMessage])
        break

      case 'error':
        setError(new Error(data.payload.message))
        break
    }
  }, [thinkingEvents, currentPlan, handleThinkingEvent])

  // 处理聊天响应
  const handleChatResponse = useCallback((response: IntelligentChatResponse) => {
    const assistantMessage: IntelligentChatMessage = {
      id: Date.now().toString(),
      role: 'assistant',
      content: response.reply,
      timestamp: new Date(),
      thinkingEvents: response.thinkingEvents,
      plan: response.plan,
      intent: response.intent,
      actions: response.actions
    }

    setMessages(prev => [...prev, assistantMessage])
    setThinkingEvents(response.thinkingEvents)

    // 执行返回的actions
    if (response.actions && onOperationExecuted) {
      response.actions.forEach((action: any) => {
        onOperationExecuted(action)
      })
    }
  }, [onOperationExecuted])

  // 清理会话
  const clearSession = useCallback(() => {
    setMessages([])
    setThinkingEvents([])
    setCurrentPlan(undefined)
    setError(undefined)
    sessionIdRef.current = generateSessionId()
  }, [])

  // 切换智能模式
  const toggleIntelligentMode = useCallback(() => {
    setIntelligentMode(prev => !prev)
  }, [])

  return {
    messages,
    thinkingEvents,
    currentPlan,
    isLoading,
    error,
    sendMessage,
    clearSession,
    toggleIntelligentMode
  }
}