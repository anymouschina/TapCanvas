/**
 * 简化的AI助手 - 使用基础的fetch API
 */

import React, { useState, useEffect } from 'react'
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
  Button,
  Tooltip,
  Avatar,
  Select,
  Alert
} from '@mantine/core'
import {
  IconSend,
  IconRobot,
  IconTrash,
  IconMessageCircle,
  IconSettings,
  IconLoader2,
  IconAlertTriangle
} from '@tabler/icons-react'
import { useRFStore } from '../store'
import { useI18n } from '../i18n'
import { getFirstAvailableApiKey, getAnyAvailableApiKey, type AIProvider } from './useApiKey'
import { TEXT_MODELS, getModelProvider } from '../../config/models'

interface SimpleAIAssistantProps {
  opened: boolean
  onClose: () => void
  position?: 'right' | 'left'
  width?: number
}

export function SimpleAIAssistant({
  opened,
  onClose,
  position = 'right',
  width = 400
}: SimpleAIAssistantProps) {
  const [showSettings, setShowSettings] = useState(false)
  const [model, setModel] = useState('gemini-2.5-flash') // 与TaskNode的默认模型一致
  const [apiKey, setApiKey] = useState('')
  const [isCheckingApiKey, setIsCheckingApiKey] = useState(false)
  const [configuredProvider, setConfiguredProvider] = useState<AIProvider | null>(null)
  const [messages, setMessages] = useState<Array<{role: string; content: string; timestamp: Date}>>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { currentLanguage } = useI18n()
  const store = useRFStore()

  // 组件加载时自动获取API key
  useEffect(() => {
    if (opened) {
      loadApiKey()
    }
  }, [opened, model])

  const loadApiKey = async () => {
    setIsCheckingApiKey(true)
    try {
      const provider = getModelProvider(model)
      console.log(`为模型 ${model} 查找${provider} API key...`)
      const key = await getFirstAvailableApiKey(provider)

      if (key) {
        console.log(`成功获取到${provider} API key`)
        setApiKey(key)
        setConfiguredProvider(provider)
      } else {
        console.log(`当前模型 ${model} 没有API key，尝试其他模型...`)
        // 如果当前模型没有API key，尝试获取任意可用的
        const anyKey = await getAnyAvailableApiKey()
        if (anyKey) {
          setApiKey(anyKey.key)
          setConfiguredProvider(anyKey.provider)
          // 自动切换到有API key的模型
          setModel(TEXT_MODELS[0].value) // 切换到第一个可用的text模型
        } else {
          setApiKey('')
          setConfiguredProvider(null)
        }
      }
    } catch (error) {
      console.error('加载API key失败:', error)
      setApiKey('')
      setConfiguredProvider(null)
    } finally {
      setIsCheckingApiKey(false)
    }
  }

  const systemPrompt = `你是一个专业的TapCanvas画布操作AI助手。

当前画布状态：
- 节点数量: ${store.nodes.length}
- 边数量: ${store.edges.length}
- 节点类型: ${[...new Set(store.nodes.map(n => n.type))].join(', ')}

你可以帮助用户：
1. 添加节点 (taskNode, groupNode, ioNode)
2. 编辑节点 (修改标签、状态等)
3. 删除节点
4. 查看画布信息

请用中文回复用户。`

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
  }

  const handleFormSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (inputValue.trim() && !isLoading && apiKey) {
      setIsLoading(true)
      setError(null)

      try {
        // 添加用户消息
        const userMessage = {
          role: 'user',
          content: inputValue,
          timestamp: new Date()
        }
        setMessages(prev => [...prev, userMessage])

        // 清空输入
        const userPrompt = inputValue
        setInputValue('')

        // 准备发送到API的消息
        const apiMessages = [
          { role: 'system', content: systemPrompt },
          ...messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role,
            content: m.content
          })),
          { role: 'user', content: userPrompt }
        ]

        // 发送到AI API
        const response = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: apiMessages,
            model,
            apiKey
          })
        })

        if (!response.ok) {
          throw new Error(`API请求失败: ${response.status}`)
        }

        // 处理流式响应
        const reader = response.body?.getReader()
        if (!reader) {
          throw new Error('无法读取响应流')
        }

        let assistantMessage = ''
        const assistantMessageObj = {
          role: 'assistant',
          content: '',
          timestamp: new Date()
        }
        setMessages(prev => [...prev, assistantMessageObj])

        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') {
                break
              }
              try {
                const parsed = JSON.parse(data)
                if (parsed.content) {
                  assistantMessage += parsed.content
                  assistantMessageObj.content = assistantMessage
                  setMessages(prev => [...prev.slice(0, -1), assistantMessageObj])
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
        }

      } catch (err) {
        console.error('AI请求失败:', err)
        setError(err instanceof Error ? err.message : '未知错误')
      } finally {
        setIsLoading(false)
      }
    }
  }

  const clearHistory = () => {
    setMessages([])
    setError(null)
  }

  // 格式化时间
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString(currentLanguage === 'zh' ? 'zh-CN' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit'
    })
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
        <Box p="md" bg="green.1" style={{ borderBottom: '1px solid var(--mantine-color-green-3)' }}>
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <IconRobot size={20} color="green" />
              <Text fw={600} size="lg" c="dark">AI助手</Text>
              {isLoading && (
                <Group gap="xs">
                  <IconLoader2 size={14} className="animate-spin" color="green" />
                  <Text size="sm" c="green" italic>思考中...</Text>
                </Group>
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
                  onClick={clearHistory}
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
          <Box p="md" bg="gray.0" style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
            <Stack gap="md">
              <Select
                label="AI模型（与Text节点一致）"
                value={model}
                onChange={(value) => setModel(value || TEXT_MODELS[0].value)}
                data={TEXT_MODELS}
                disabled={isCheckingApiKey}
              />

              {isCheckingApiKey && (
                <Group gap="xs">
                  <IconLoader2 size={14} className="animate-spin" />
                  <Text size="sm">正在检查API Key配置...</Text>
                </Group>
              )}

              {!isCheckingApiKey && configuredProvider && (
                <Alert color="green" icon={<IconRobot size={14} />}>
                  <Text size="sm">
                    已自动使用配置的 {configuredProvider.toUpperCase()} API Key
                  </Text>
                </Alert>
              )}

              {!isCheckingApiKey && !configuredProvider && (
                <Alert color="orange" icon={<IconAlertTriangle size={14} />}>
                  <Text size="sm">
                    未找到可用的API Key配置。请在模型面板中配置OpenAI、Anthropic或Google的API Key。
                  </Text>
                </Alert>
              )}

              <Group gap="xs">
                <Button size="xs" variant="light" onClick={() => setShowSettings(false)}>
                  关闭设置
                </Button>
                <Button size="xs" variant="outline" onClick={loadApiKey} disabled={isCheckingApiKey}>
                  重新加载API Key
                </Button>
              </Group>
            </Stack>
          </Box>
        )}

        {/* 消息区域 */}
        <Box
          style={{
            height: `calc(100% - 140px${showSettings ? ' - 120px' : ''})`
          }}
        >
          <ScrollArea h="100%">
            <Box p="md">
              {messages.length === 0 ? (
                <Box ta="center" py="xl">
                  <IconRobot size={48} c="gray.6" opacity={0.5} />
                  <Text c="gray.5" mt="md">
                    你好！我是AI助手，可以帮助你管理画布节点。
                  </Text>
                  {configuredProvider ? (
                    <Text c="green.4" size="sm" mt="xs">
                      已连接到 {configuredProvider.toUpperCase()} 模型
                    </Text>
                  ) : (
                    <Text c="orange.4" size="sm" mt="xs">
                      请先在模型面板中配置API Key
                    </Text>
                  )}
                  <Text c="gray.5" size="sm" mt="xs">
                    试试说："添加一个文本节点"或"显示当前画布信息"
                  </Text>
                </Box>
              ) : (
                messages.map((message, index) => (
                  <Box key={message.id} mb="sm">
                    <Group gap="xs" mb="xs">
                      <Avatar
                        size="sm"
                        color={message.role === 'user' ? 'blue' : 'green'}
                        variant="filled"
                      >
                        {message.role === 'user' ? <IconMessageCircle size={14} /> : <IconRobot size={14} />}
                      </Avatar>
                      <Text size="sm" fw={500} c={message.role === 'user' ? 'blue.4' : 'green.4'}>
                        {message.role === 'user' ? '我' : 'AI助手'}
                      </Text>
                      <Text size="xs" c="gray.5">
                        {formatTime(new Date())}
                      </Text>
                    </Group>

                    <Paper
                      p="sm"
                      radius="md"
                      bg={message.role === 'user' ? 'dark.8' : 'dark.6'}
                      ml={message.role === 'user' ? 'auto' : 0}
                      mr={message.role === 'user' ? 0 : 'auto'}
                      maw="90%"
                      style={{
                        border: `1px solid ${message.role === 'user' ? 'var(--mantine-color-blue-9)' : 'var(--mantine-color-gray-7)'}`
                      }}
                    >
                      <Text size="sm" style={{ whiteSpace: 'pre-wrap', color: 'var(--mantine-color-white)' }}>
                        {typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}
                      </Text>
                    </Paper>
                  </Box>
                ))
              )}
              {isLoading && (
                <Box ta="center" py="sm">
                  <Group gap="xs" justify="center">
                    <IconLoader2 size={16} className="animate-spin" />
                    <Text c="blue" size="sm" italic>
                      AI助手正在思考...
                    </Text>
                    <Button size="xs" variant="subtle" onClick={stop}>
                      停止
                    </Button>
                  </Group>
                </Box>
              )}
            </Box>
          </ScrollArea>
        </Box>

        {/* 输入区域 */}
        <Box p="md">
          <form onSubmit={handleFormSubmit}>
            <Group gap="xs">
              <TextInput
                style={{ flex: 1 }}
                placeholder="告诉AI助手你想要做什么..."
                value={inputValue}
                onChange={handleInputChange}
                disabled={isLoading || !apiKey || isCheckingApiKey}
              />
              <ActionIcon
                color="green"
                variant="filled"
                type="submit"
                disabled={isLoading || !inputValue.trim() || !apiKey || isCheckingApiKey}
                loading={isLoading}
              >
                <IconSend size={16} />
              </ActionIcon>
            </Group>
          </form>
          {isCheckingApiKey && (
            <Text size="xs" c="blue" mt="xs">
              正在检查API Key配置...
            </Text>
          )}
          {!isCheckingApiKey && !apiKey && (
            <Text size="xs" c="orange" mt="xs">
              请先在模型面板中配置API Key才能使用AI助手
            </Text>
          )}
          {!isCheckingApiKey && apiKey && (
            <Text size="xs" c="green" mt="xs">
              已连接到 {configuredProvider?.toUpperCase()} 模型
            </Text>
          )}
        </Box>
      </Paper>
    </Box>
  )
}

export default SimpleAIAssistant