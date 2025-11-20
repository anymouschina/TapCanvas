/**
 * AI助手面板组件
 * 提供用户与AI助手交互的界面
 */

import React, { useState, useRef, useEffect } from 'react'
import {
  Box,
  Paper,
  TextInput,
  ActionIcon,
  ScrollArea,
  Text,
  Stack,
  Group,
  Badge,
  Divider,
  Button,
  Tooltip,
  Avatar
} from '@mantine/core'
import {
  IconSend,
  IconRobot,
  IconTrash,
  IconTool,
  IconMessageCircle,
  IconSettings
} from '@tabler/icons-react'
import { aiAssistant, type AIMessage } from './aiAssistant'
import { useRFStore } from '../store'
import { useI18n } from '../i18n'

interface AIAssistantPanelProps {
  opened: boolean
  onClose: () => void
  position?: 'right' | 'left'
  width?: number
}

export function AIAssistantPanel({
  opened,
  onClose,
  position = 'right',
  width = 400
}: AIAssistantPanelProps) {
  const [messages, setMessages] = useState<AIMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const { currentLanguage } = useI18n()
  const store = useRFStore()

  // 初始化时加载历史消息
  useEffect(() => {
    setMessages(aiAssistant.getMessages())
  }, [])

  // 自动滚动到底部
  useEffect(() => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector('[data-scrollbar-view]') as HTMLElement
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight
      }
    }
  }, [messages])

  // 发送消息
  const handleSendMessage = async () => {
    if (!inputValue.trim()) return

    const userMessage = inputValue.trim()
    setInputValue('')
    setIsTyping(true)

    try {
      // 更新用户消息到UI
      setMessages(prev => [...prev, {
        role: 'user',
        content: userMessage,
        timestamp: new Date()
      }])

      // 获取AI响应
      const assistantMessage = await aiAssistant.chat(userMessage)

      // 更新AI响应到UI
      setMessages(prev => [...prev, assistantMessage])

      // 刷新store状态以反映工具调用的结果
      if (assistantMessage.toolCalls) {
        setMessages(aiAssistant.getMessages())
      }
    } catch (error) {
      console.error('AI助手响应错误:', error)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `抱歉，发生了错误：${error instanceof Error ? error.message : '未知错误'}`,
        timestamp: new Date()
      }])
    } finally {
      setIsTyping(false)
    }
  }

  // 清空聊天记录
  const handleClearHistory = () => {
    aiAssistant.clearHistory()
    setMessages(aiAssistant.getMessages())
  }

  // 格式化时间
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString(currentLanguage === 'zh' ? 'zh-CN' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // 渲染消息
  const renderMessage = (message: AIMessage, index: number) => {
    const isUser = message.role === 'user'
    const isSystem = message.role === 'system'

    if (isSystem) return null // 不显示系统消息

    return (
      <Box key={index} mb="sm">
        <Group gap="xs" mb="xs">
          <Avatar
            size="sm"
            color={isUser ? 'blue' : 'green'}
            variant="filled"
          >
            {isUser ? <IconMessageCircle size={14} /> : <IconRobot size={14} />}
          </Avatar>
          <Text size="sm" fw={500} c={isUser ? 'blue' : 'green'}>
            {isUser ? '我' : 'AI助手'}
          </Text>
          <Text size="xs" c="dimmed">
            {formatTime(message.timestamp)}
          </Text>
        </Group>

        <Paper
          p="sm"
          radius="md"
          bg={isUser ? 'blue.0' : 'gray.0'}
          ml={isUser ? 'auto' : 0}
          mr={isUser ? 0 : 'auto'}
          maw="90%"
          style={{
            marginLeft: isUser ? 'auto' : '0',
            marginRight: isUser ? '0' : 'auto'
          }}
        >
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {message.content}
          </Text>

          {message.toolCalls && (
            <Box mt="xs">
              <Divider my="xs" />
              <Group gap="xs" mb="xs">
                <IconTool size={12} />
                <Text size="xs" fw={500}>工具调用</Text>
              </Group>
              {message.toolCalls.map((toolCall, toolIndex) => (
                <Box
                  key={toolIndex}
                  p="xs"
                  bg={toolCall.result?.success ? 'green.0' : 'red.0'}
                  radius="sm"
                  mb="xs"
                >
                  <Group gap="xs" mb="xs">
                    <Badge size="xs" variant="filled" color="blue">
                      {toolCall.name}
                    </Badge>
                    {toolCall.result?.success ? (
                      <Badge size="xs" variant="filled" color="green">
                        成功
                      </Badge>
                    ) : (
                      <Badge size="xs" variant="filled" color="red">
                        失败
                      </Badge>
                    )}
                  </Group>
                  {toolCall.result?.error && (
                    <Text size="xs" c="red">
                      错误：{toolCall.result.error}
                    </Text>
                  )}
                </Box>
              ))}
            </Box>
          )}
        </Paper>
      </Box>
    )
  }

  if (!opened) return null

  return (
    <Box
      style={{
        position: 'fixed',
        top: 60,
        [position]: 0,
        width,
        height: 'calc(100vh - 60px)',
        zIndex: 1000,
        transition: 'all 0.3s ease'
      }}
    >
      <Paper h="100%" radius={0} shadow="lg" withBorder>
        {/* 头部 */}
        <Box p="md" bg="gray.1" style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <IconRobot size={20} color="green" />
              <Text fw={600} size="lg">AI助手</Text>
              {isTyping && (
                <Text size="sm" c="blue" italic>正在思考...</Text>
              )}
            </Group>
            <Group gap="xs">
              <Tooltip label="设置">
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  onClick={() => setShowSettings(!showSettings)}
                >
                  <IconSettings size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="清空历史">
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  onClick={handleClearHistory}
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="关闭">
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  onClick={onClose}
                >
                  ×
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
        </Box>

        {/* 设置面板 */}
        {showSettings && (
          <Box p="md" bg="blue.0" style={{ borderBottom: '1px solid var(--mantine-color-blue-1)' }}>
            <Stack gap="xs">
              <Text size="sm" fw={500}>可用工具</Text>
              <Group gap="xs">
                {aiAssistant.getAvailableTools().map((tool, index) => (
                  <Badge key={index} size="xs" variant="outline">
                    {tool.description}
                  </Badge>
                ))}
              </Group>
              <Button
                size="xs"
                variant="light"
                onClick={() => setShowSettings(false)}
              >
                关闭设置
              </Button>
            </Stack>
          </Box>
        )}

        {/* 消息区域 */}
        <Box
          style={{
            height: `calc(100% - 140px${showSettings ? ' - 80px' : ''})`,
            borderBottom: '1px solid var(--mantine-color-gray-3)'
          }}
        >
          <ScrollArea h="100%" ref={scrollAreaRef}>
            <Box p="md">
              {messages.length === 0 ? (
                <Box ta="center" py="xl">
                  <IconRobot size={48} color="gray" opacity={0.5} />
                  <Text c="dimmed" mt="md">
                    你好！我是AI助手，可以帮助你管理画布节点。
                  </Text>
                  <Text c="dimmed" size="sm" mt="xs">
                    试试说："添加一个文本节点"或"显示当前画布信息"
                  </Text>
                </Box>
              ) : (
                messages.map(renderMessage)
              )}
              {isTyping && (
                <Box ta="center" py="sm">
                  <Text c="blue" size="sm" italic>
                    AI助手正在思考...
                  </Text>
                </Box>
              )}
            </Box>
          </ScrollArea>
        </Box>

        {/* 输入区域 */}
        <Box p="md">
          <Group gap="xs">
            <TextInput
              style={{ flex: 1 }}
              placeholder="告诉AI助手你想要做什么..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSendMessage()
                }
              }}
              disabled={isTyping}
            />
            <ActionIcon
              color="blue"
              variant="filled"
              onClick={handleSendMessage}
              disabled={isTyping || !inputValue.trim()}
              loading={isTyping}
            >
              <IconSend size={16} />
            </ActionIcon>
          </Group>
        </Box>
      </Paper>
    </Box>
  )
}

export default AIAssistantPanel