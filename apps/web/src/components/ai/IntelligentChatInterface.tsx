import React, { useState, useCallback, useRef, useEffect } from 'react'
import {
  Stack,
  TextInput,
  Button,
  Group,
  Text,
  Paper,
  ActionIcon,
  Tooltip,
  Switch,
  Badge,
  ScrollArea,
  Box,
  Collapse
} from '@mantine/core'
import {
  IconSend,
  IconBrain,
  IconBulb,
  IconSettings,
  IconHistory,
  IconLoader
} from '@tabler/icons-react'
import { IntelligentAssistant } from './IntelligentAssistant'
import { useWebSocket } from '../../hooks/useWebSocket'
import type { ThinkingEvent } from '../../../types/canvas-intelligence'

interface IntelligentChatInterfaceProps {
  userId: string
  height?: string
  onOperationExecuted?: (operation: any) => void
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  thinkingEvents?: any[]
  plan?: any[]
  intent?: any
}

export const IntelligentChatInterface: React.FC<IntelligentChatInterfaceProps> = ({
  userId,
  height = '500px',
  onOperationExecuted
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [thinkingEvents, setThinkingEvents] = useState<ThinkingEvent[]>([])
  const [input, setInput] = useState('')
  const [isIntelligentMode, setIsIntelligentMode] = useState(true)
  const [showThinking, setShowThinking] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // WebSocket连接
  const { isConnected, sendMessage: sendWebSocketMessage } = useWebSocket('/api/ai/tool-events', {
    userId,
    onMessage: (event) => {
      if (event.type === 'tool-result' && event.toolName === 'ai.thinking.process') {
        setThinkingEvents(prev => [...prev, event.output as ThinkingEvent])
      }
    },
    onOpen: () => {
      console.log('WebSocket connected for intelligent chat')
    },
    onError: (error) => {
      console.error('WebSocket error:', error)
    }
  })

  // 处理发送消息
  const handleSendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)
    setThinkingEvents([]) // 清空之前的思考事件

    try {
      const response = await fetch('/api/ai/chat/intelligent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: content.trim() }],
          context: {}, // 这里应该传入当前画布上下文
          intelligentMode: isIntelligentMode,
          enableThinking: showThinking
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const result = await response.json()

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result.reply,
        timestamp: new Date(),
        thinkingEvents: result.thinkingEvents || [],
        plan: result.plan,
        intent: result.intent,
        actions: result.actions
      }

      setMessages(prev => [...prev, assistantMessage])
      setThinkingEvents(result.thinkingEvents || [])

      // 执行返回的actions
      if (result.actions && onOperationExecuted) {
        result.actions.forEach((action: any) => {
          onOperationExecuted(action)
        })
      }

    } catch (error) {
      console.error('Intelligent chat failed:', error)

      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '抱歉，处理您的请求时遇到了问题。请稍后再试。',
        timestamp: new Date()
      }

      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }, [isIntelligentMode, showThinking, onOperationExecuted])

  // 清理会话
  const handleClear = useCallback(() => {
    setMessages([])
    setThinkingEvents([])
    setIsLoading(false)
  }, [])

  // 处理表单提交
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    handleSendMessage(input)
  }, [input, handleSendMessage])

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }, [handleSubmit])

  
  return (
    <Stack h={height}>
      {/* 头部控制 */}
      <Paper p="sm" withBorder>
        <Group position="apart">
          <Group spacing="xs">
            <IconBrain size={18} />
            <Text weight={500}>智能 AI 助手</Text>
            {isIntelligentMode && (
              <Badge color="green" variant="light" size="sm">
                智能模式
              </Badge>
            )}
          </Group>

          <Group spacing="md">
            {/* 显示思考过程开关 */}
            <Tooltip label="显示AI思考过程">
              <Switch
                size="sm"
                checked={showThinking}
                onChange={(e) => setShowThinking(e.currentTarget.checked)}
                label="思考过程"
              />
            </Tooltip>

            {/* 智能模式开关 */}
            <Tooltip label="启用深度智能理解">
              <Switch
                size="sm"
                checked={isIntelligentMode}
                onChange={(e) => setIsIntelligentMode(e.currentTarget.checked)}
                label="智能模式"
                color="green"
              />
            </Tooltip>
          </Group>
        </Group>
      </Paper>

      {/* 聊天消息区域 */}
      <ScrollArea.Autosize mah="calc(100% - 180px)" offsetScrollbars>
        <Stack spacing="md" p="md">
          {messages.map((message) => (
            <Box
              key={message.id}
              sx={(theme) => ({
                backgroundColor: message.role === 'user'
                  ? theme.colors.blue[0]
                  : theme.colors.gray[0],
                padding: theme.spacing.md,
                borderRadius: theme.radius.md,
                border: `1px solid ${theme.colors.gray[2]}`
              })}
            >
              <Group position="apart" mb="xs">
                <Text size="sm" weight={500}>
                  {message.role === 'user' ? '您' : 'AI 助手'}
                </Text>
                <Text size="xs" color="dimmed">
                  {message.timestamp.toLocaleTimeString()}
                </Text>
              </Group>

              <Text size="sm">{message.content}</Text>

              {/* 显示执行计划 */}
              {message.plan && message.plan.length > 0 && (
                <Collapse in label="查看执行计划" mt="sm">
                  <Stack spacing="xs">
                    {message.plan.map((step, index) => (
                      <Text key={index} size="xs" color="dimmed">
                        {index + 1}. {step}
                      </Text>
                    ))}
                  </Stack>
                </Collapse>
              )}

              {/* 显示意图信息 */}
              {message.intent && (
                <Group mt="xs" spacing="xs">
                  <Badge size="xs" color="blue">
                    意图: {message.intent.type}
                  </Badge>
                  <Badge size="xs" color={message.intent.confidence > 0.8 ? 'green' : 'yellow'}>
                    置信度: {(message.intent.confidence * 100).toFixed(0)}%
                  </Badge>
                </Group>
              )}
            </Box>
          ))}

          {/* 思考过程展示 */}
          {isIntelligentMode && thinkingEvents.length > 0 && (
            <Paper p="md" withBorder style={{ background: 'linear-gradient(45deg, #f0f9ff 0%, #e0f2fe 100%)' }}>
              <Group mb="sm">
                <IconBrain size={16} color="blue" />
                <Text size="sm" weight={500} color="blue">AI 思考过程</Text>
                <Badge size="xs" color="blue" variant="light">
                  {thinkingEvents.length} 个步骤
                </Badge>
              </Group>

              <Stack spacing="xs">
                {thinkingEvents.slice(-3).map((event, index) => (
                  <Group key={event.id} spacing="xs">
                    <Text size="xs" color="blue">
                      {event.type === 'intent_analysis' && '🧠 分析'}
                      {event.type === 'planning' && '📋 规划'}
                      {event.type === 'reasoning' && '💭 思考'}
                      {event.type === 'decision' && '⚡ 决策'}
                      {event.type === 'execution' && '🚀 执行'}
                    </Text>
                    <Text size="xs" color="dimmed">
                      {event.content}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </Paper>
          )}

          {isLoading && (
            <Paper p="md" withBorder>
              <Group>
                <IconLoader size={16} className="loading-spin" />
                <Text size="sm" color="dimmed">
                  {isIntelligentMode ? 'AI 正在深度思考并制定执行计划...' : 'AI 正在处理...'}
                </Text>
                {isConnected ? (
                  <Badge size="xs" color="green" variant="light">已连接</Badge>
                ) : (
                  <Badge size="xs" color="red" variant="light">连接中...</Badge>
                )}
              </Group>
            </Paper>
          )}
        </Stack>
      </ScrollArea.Autosize>

      {/* 快速命令 */}
      <Paper p="sm" withBorder>
        <Group mb="xs">
          <Text size="sm" weight={500}>🎯 快速命令:</Text>
          <Button size="xs" variant="subtle" onClick={handleClear}>
            清空对话
          </Button>
        </Group>
        <Group spacing="xs">
          <Button
            size="xs"
            variant="outline"
            onClick={() => handleSendMessage('帮我生成一个小红书封面，要吸引人的视觉效果')}
            disabled={isLoading}
          >
            📱 小红书封面
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => handleSendMessage('整理一下布局，让所有节点整齐排列')}
            disabled={isLoading}
          >
            🎨 整理布局
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => handleSendMessage('创建一个文生图节点，配置为高质量输出')}
            disabled={isLoading}
          >
            🖼️ 创建文生图
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => handleSendMessage('优化这个工作流的性能，给出具体建议')}
            disabled={isLoading}
          >
            ⚡ 性能优化
          </Button>
        </Group>
      </Paper>

      {/* 输入区域 */}
      <Paper p="sm" withBorder>
        <form onSubmit={handleSubmit}>
          <Group>
            <TextInput
              ref={inputRef}
              style={{ flex: 1 }}
              placeholder={
                isIntelligentMode
                  ? "描述您想要的操作，例如：'整理一下布局'或'创建文生图节点'"
                  : "输入您的问题..."
              }
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
            <Tooltip label="发送消息 (Enter)">
              <ActionIcon
                type="submit"
                size="lg"
                color={isIntelligentMode ? 'green' : 'blue'}
                disabled={isLoading || !input.trim()}
              >
                <IconSend size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </form>
      </Paper>
    </Stack>
  )
}