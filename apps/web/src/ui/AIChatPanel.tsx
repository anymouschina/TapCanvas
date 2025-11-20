import React, { useState, useRef, useEffect } from 'react'
import {
  Paper,
  Stack,
  TextInput,
  ActionIcon,
  ScrollArea,
  Text,
  Group,
  Select,
  Badge,
  Loader,
  Divider
} from '@mantine/core'
import {
  IconSend,
  IconTrash,
  IconRobot,
  IconUser,
  IconSettings,
  IconChevronRight
} from '@tabler/icons-react'
import { useUIStore } from '../ui/uiStore'
import { SYSTEM_PROMPT, functionHandlers } from '../ai/types'
import { functionHandlers as canvasHandlers } from '../ai/canvasService'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  isTyping?: boolean
}

export default function AIChatPanel(): JSX.Element {
  const {
    activePanel,
    aiChatMessages,
    addAiMessage,
    clearAiMessages,
    selectedAiModel,
    setSelectedAiModel,
    setActivePanel
  } = useUIStore()

  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // 滚动到底部
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTo({ top: scrollAreaRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [aiChatMessages])

  if (activePanel !== 'ai-chat') return null

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return

    const userMessage = inputValue.trim()
    setInputValue('')
    setIsLoading(true)

    // 添加用户消息
    addAiMessage({ role: 'user', content: userMessage })

    try {
      // 构建AI请求消息
      const messages = [
        { role: 'system' as const, content: SYSTEM_PROMPT },
        ...aiChatMessages.map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        })),
        { role: 'user' as const, content: userMessage }
      ]

      // 调用AI服务
      const response = await callAIService(messages, selectedAiModel)

      // 添加AI回复
      addAiMessage({ role: 'assistant', content: response })
    } catch (error) {
      console.error('AI服务调用失败:', error)
      addAiMessage({
        role: 'assistant',
        content: '抱歉，AI服务暂时不可用，请稍后再试。'
      })
    } finally {
      setIsLoading(false)
    }
  }

  const callAIService = async (messages: any[], model: string): Promise<string> => {
    // TODO: 实现实际的AI服务调用
    // 这里先模拟AI回复
    await new Promise(resolve => setTimeout(resolve, 1000))

    // 模拟Function Calling
    if (messages[messages.length - 1].content.includes('创建') && messages[messages.length - 1].content.includes('节点')) {
      return '我理解您想要创建节点。不过我需要更多信息：\n\n1. 您想创建什么类型的节点？（文本、图像、视频、音频、字幕）\n2. 节点应该如何命名？\n3. 需要什么特殊配置吗？\n\n请告诉我这些信息，我就可以帮您创建了。'
    }

    return '我是TapCanvas AI助手！我可以帮助您：\n\n🔧 **创建节点**：创建文本、图像、视频、音频等AI节点\n🔗 **连接工作流**：帮您连接节点构建完整的工作流\n⚙️ **修改配置**：调整节点参数和设置\n🗂️ **管理布局**：自动排列和对齐节点\n\n请告诉我您想要做什么？比如："创建一个文本生成节点"'
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const formatMessage = (content: string) => {
    // 简单的markdown格式化
    return content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>')
  }

  const availableModels = [
    { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-2.0-pro-exp', label: 'Gemini 2.0 Pro' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'claude-3-sonnet', label: 'Claude 3 Sonnet' }
  ]

  return (
    <Paper
      withBorder
      shadow="sm"
      radius="md"
      className="glass"
      style={{
        position: 'fixed',
        right: 20,
        top: 80,
        width: 380,
        height: 'calc(100vh - 120px)',
        zIndex: 300,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'visible'
      }}
      data-ux-panel
    >
      {/* 头部 */}
      <Group p="md" justify="space-between" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
        <Group gap="sm">
          <IconRobot size={20} color="#667eea" />
          <Text size="sm" fw={600}>AI 助手</Text>
          {isLoading && <Loader size="xs" />}
        </Group>

        <Group gap="xs">
          <Select
            size="xs"
            value={selectedAiModel}
            onChange={(value) => value && setSelectedAiModel(value)}
            data={availableModels}
            w={140}
            variant="subtle"
            withinPortal={true}
            dropdownProps={{
              zIndex: 6001,
              position: "bottom-end"
            }}
          />
          <ActionIcon
            size="sm"
            variant="subtle"
            onClick={clearAiMessages}
            title="清空对话"
          >
            <IconTrash size={14} />
          </ActionIcon>
          <ActionIcon
            size="sm"
            variant="subtle"
            onClick={() => setActivePanel(null)}
            title="关闭"
          >
            <IconChevronRight size={14} />
          </ActionIcon>
        </Group>
      </Group>

      {/* 消息区域 */}
      <ScrollArea ref={scrollAreaRef} style={{ flex: 1, padding: 'md' }}>
        <Stack gap="md">
          {aiChatMessages.length === 0 && (
            <Text c="dimmed" size="sm" ta="center">
              👋 我是你的AI工作流助手，告诉我你想要创建什么？
            </Text>
          )}

          {aiChatMessages.map((message, index) => (
            <Group
              key={index}
              gap="sm"
              justify={message.role === 'user' ? 'flex-end' : 'flex-start'}
            >
              {message.role === 'assistant' && (
                <IconRobot size={16} color="#667eea" style={{ flexShrink: 0 }} />
              )}

              <Paper
                p="sm"
                radius="md"
                withBorder
                style={{
                  maxWidth: '85%',
                  backgroundColor: message.role === 'user'
                    ? 'var(--mantine-color-blue-0)'
                    : 'var(--mantine-color-gray-0)'
                }}
              >
                <Text
                  size="sm"
                  dangerouslySetInnerHTML={{
                    __html: formatMessage(message.content)
                  }}
                />
              </Paper>

              {message.role === 'user' && (
                <IconUser size={16} color="#667eea" style={{ flexShrink: 0 }} />
              )}
            </Group>
          ))}

          {isLoading && (
            <Group gap="sm">
              <IconRobot size={16} color="#667eea" />
              <Paper p="sm" radius="md" withBorder>
                <Group gap="xs">
                  <Loader size="xs" />
                  <Text size="sm" c="dimmed">思考中...</Text>
                </Group>
              </Paper>
            </Group>
          )}
        </Stack>
      </ScrollArea>

      {/* 输入区域 */}
      <Divider />
      <Group p="md" gap="sm">
        <TextInput
          style={{ flex: 1 }}
          placeholder="告诉我你想要创建什么..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyPress}
          disabled={isLoading}
          size="sm"
        />
        <ActionIcon
          onClick={handleSendMessage}
          disabled={!inputValue.trim() || isLoading}
          size="lg"
          variant="filled"
          color="blue"
        >
          <IconSend size={16} />
        </ActionIcon>
      </Group>
    </Paper>
  )
}