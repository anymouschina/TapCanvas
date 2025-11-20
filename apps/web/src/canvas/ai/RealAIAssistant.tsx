/**
 * 真正的AI助手组件 - 使用@ai-sdk/react的useChat hook
 */

import React, { useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
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
  Avatar,
  Select,
  Switch
} from '@mantine/core'
import {
  IconSend,
  IconRobot,
  IconTrash,
  IconTool,
  IconMessageCircle,
  IconSettings,
  IconLoader2
} from '@tabler/icons-react'
import { useRFStore } from '../store'
import { useI18n } from '../i18n'

interface RealAIAssistantProps {
  opened: boolean
  onClose: () => void
  position?: 'right' | 'left'
  width?: number
}

export function RealAIAssistant({
  opened,
  onClose,
  position = 'right',
  width = 400
}: RealAIAssistantProps) {
  const [showSettings, setShowSettings] = useState(false)
  const [model, setModel] = useState('gpt-4-turbo')
  const [apiKey, setApiKey] = useState('')
  const [useTools, setUseTools] = useState(true)
  const { currentLanguage } = useI18n()
  const store = useRFStore()

  // 定义工具函数
  const tools = [
    {
      description: '添加新节点到画布',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: '节点类型，可选值: taskNode, groupNode, ioNode',
            enum: ['taskNode', 'groupNode', 'ioNode']
          },
          label: {
            type: 'string',
            description: '节点标签（可选）'
          },
          kind: {
            type: 'string',
            description: '节点种类，可选值: text, image, video, audio, subtitle',
            enum: ['text', 'image', 'video', 'audio', 'subtitle', 'textToImage', 'image', 'composeVideo']
          }
        },
        required: ['type']
      },
      execute: async ({ type, label, kind }: { type: string; label?: string; kind?: string }) => {
        try {
          store.addNode(type, label || `新建${type}`, {
            kind: kind || 'text',
          })
          return { success: true, message: `成功添加节点: ${label || type}` }
        } catch (error) {
          return { success: false, error: `添加节点失败: ${error}` }
        }
      }
    },
    {
      description: '编辑现有节点',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: '节点ID' },
          label: { type: 'string', description: '节点标签（可选）' },
          kind: { type: 'string', description: '节点种类（可选）' },
          status: {
            type: 'string',
            description: '节点状态（可选）',
            enum: ['idle', 'queued', 'running', 'success', 'error']
          }
        },
        required: ['nodeId']
      },
      execute: async ({ nodeId, label, kind, status }: { nodeId: string; label?: string; kind?: string; status?: string }) => {
        try {
          const node = store.nodes.find(n => n.id === nodeId)
          if (!node) {
            return { success: false, error: `未找到节点: ${nodeId}` }
          }

          if (label !== undefined) {
            store.updateNodeLabel(nodeId, label)
          }

          if (kind || status) {
            store.updateNodeData(nodeId, {
              ...node.data,
              ...(kind && { kind }),
              ...(status && { status })
            })
          }

          if (status) {
            store.setNodeStatus(nodeId, status as any)
          }

          return { success: true, message: `成功更新节点: ${nodeId}` }
        } catch (error) {
          return { success: false, error: `更新节点失败: ${error}` }
        }
      }
    },
    {
      description: '删除节点',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: '要删除的节点ID' }
        },
        required: ['nodeId']
      },
      execute: async ({ nodeId }: { nodeId: string }) => {
        try {
          const node = store.nodes.find(n => n.id === nodeId)
          if (!node) {
            return { success: false, error: `未找到节点: ${nodeId}` }
          }

          store.deleteNode(nodeId)
          return { success: true, message: `成功删除节点: ${nodeId}` }
        } catch (error) {
          return { success: false, error: `删除节点失败: ${error}` }
        }
      }
    },
    {
      description: '获取画布信息',
      parameters: {
        type: 'object',
        properties: {
          includeData: { type: 'boolean', description: '是否包含详细节点和边数据（可选）' }
        },
        required: []
      },
      execute: async ({ includeData }: { includeData?: boolean }) => {
        try {
          const nodes = store.nodes
          const edges = store.edges

          const info = {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            nodeTypes: [...new Set(nodes.map(n => n.type))],
            nodeKinds: [...new Set(nodes.map(n => (n.data as any)?.kind).filter(Boolean))],
          }

          if (includeData) {
            (info as any).nodes = nodes.map(n => ({
              id: n.id,
              type: n.type,
              label: (n.data as any)?.label,
              kind: (n.data as any)?.kind,
              status: (n.data as any)?.status,
            }))
            (info as any).edges = edges.map(e => ({
              id: e.id,
              source: e.source,
              target: e.target,
            }))
          }

          return { success: true, data: info, message: '获取画布信息成功' }
        } catch (error) {
          return { success: false, error: `获取画布信息失败: ${error}` }
        }
      }
    }
  ]

  // 根据选择的模型配置API
  const getModelProvider = () => {
    if (!apiKey) {
      throw new Error('请先配置API Key')
    }

    switch (model) {
      case 'gpt-4-turbo':
      case 'gpt-3.5-turbo':
        return openai(model, { apiKey })
      case 'claude-3-sonnet':
      case 'claude-3-haiku':
        return anthropic(model, { apiKey })
      case 'gemini-pro':
        return google(model, { apiKey })
      default:
        return openai('gpt-3.5-turbo', { apiKey })
    }
  }

  const systemPrompt = `你是一个专业的TapCanvas画布操作AI助手，可以帮助用户管理画布节点。

你有以下工具可以使用：
1. addNode - 添加新节点
2. editNode - 编辑现有节点
3. deleteNode - 删除节点
4. getCanvasInfo - 获取画布信息

节点类型包括：
- taskNode - 任务节点
- groupNode - 分组节点
- ioNode - 输入输出节点

节点种类包括：
- text - 文本
- image - 图像
- video - 视频
- audio - 音频
- subtitle - 字幕
- textToImage - 文本转图像
- composeVideo - 视频合成

工作原则：
1. 每次操作前先了解当前画布状态
2. 根据用户需求选择合适的工具
3. 操作后确认结果是否符合预期
4. 如果操作失败，分析原因并提供解决方案
5. 使用中文回复用户

请用专业、友好的语调与用户交流。`

  const { messages, input, handleInputChange, handleSubmit, isLoading, error, reload, stop } = useChat({
    api: '/api/ai/chat',
    body: {
      model,
      apiKey,
      system: systemPrompt,
      tools: useTools ? tools : undefined
    },
    onError: (error) => {
      console.error('AI助手错误:', error)
    }
  })

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
              <Text fw={600} size="lg">AI助手</Text>
              {isLoading && (
                <Group gap="xs">
                  <IconLoader2 size={14} className="animate-spin" />
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
                  onClick={() => reload()}
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
                label="AI模型"
                value={model}
                onChange={(value) => setModel(value || 'gpt-4-turbo')}
                data={[
                  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
                  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
                  { value: 'claude-3-sonnet', label: 'Claude 3 Sonnet' },
                  { value: 'claude-3-haiku', label: 'Claude 3 Haiku' },
                  { value: 'gemini-pro', label: 'Gemini Pro' },
                ]}
              />
              <TextInput
                label="API Key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="输入你的API Key"
              />
              <Switch
                label="启用工具调用"
                checked={useTools}
                onChange={(e) => setUseTools(e.currentTarget.checked)}
              />
              <Group gap="xs">
                <Button size="xs" variant="light" onClick={() => setShowSettings(false)}>
                  关闭设置
                </Button>
                {error && (
                  <Text size="xs" c="red">配置错误: {error.message}</Text>
                )}
              </Group>
            </Stack>
          </Box>
        )}

        {/* 消息区域 */}
        <Box
          style={{
            height: `calc(100% - 180px${showSettings ? ' - 120px' : ''})`,
            borderBottom: '1px solid var(--mantine-color-gray-3)'
          }}
        >
          <ScrollArea h="100%">
            <Box p="md">
              {messages.length === 0 ? (
                <Box ta="center" py="xl">
                  <IconRobot size={48} color="gray" opacity={0.5} />
                  <Text c="dimmed" mt="md">
                    你好！我是AI助手，可以帮助你管理画布节点。
                  </Text>
                  <Text c="dimmed" size="sm" mt="xs">
                    请先在设置中配置API Key，然后开始对话。
                  </Text>
                  <Text c="dimmed" size="sm" mt="xs">
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
                      <Text size="sm" fw={500} c={message.role === 'user' ? 'blue' : 'green'}>
                        {message.role === 'user' ? '我' : 'AI助手'}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {formatTime(new Date(message.createdAt || Date.now()))}
                      </Text>
                    </Group>

                    <Paper
                      p="sm"
                      radius="md"
                      bg={message.role === 'user' ? 'blue.0' : 'gray.0'}
                      ml={message.role === 'user' ? 'auto' : 0}
                      mr={message.role === 'user' ? 0 : 'auto'}
                      maw="90%"
                    >
                      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                        {message.content}
                      </Text>

                      {message.toolInvocations && message.toolInvocations.length > 0 && (
                        <Box mt="xs">
                          <Divider my="xs" />
                          <Group gap="xs" mb="xs">
                            <IconTool size={12} />
                            <Text size="xs" fw={500}>工具调用</Text>
                          </Group>
                          {message.toolInvocations.map((toolInvocation, toolIndex) => (
                            <Box
                              key={toolIndex}
                              p="xs"
                              bg={toolInvocation.state === 'result' ? 'green.0' : 'orange.0'}
                              radius="sm"
                              mb="xs"
                            >
                              <Group gap="xs" mb="xs">
                                <Badge size="xs" variant="filled" color="blue">
                                  {toolInvocation.toolName}
                                </Badge>
                                <Badge size="xs" variant="filled" color={
                                  toolInvocation.state === 'result' ? 'green' : 'orange'
                                }>
                                  {toolInvocation.state}
                                </Badge>
                              </Group>
                              {toolInvocation.state === 'error' && (
                                <Text size="xs" c="red">
                                  错误：{JSON.stringify(toolInvocation.result)}
                                </Text>
                              )}
                            </Box>
                          ))}
                        </Box>
                      )}
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
          <form onSubmit={handleSubmit}>
            <Group gap="xs">
              <TextInput
                style={{ flex: 1 }}
                placeholder="告诉AI助手你想要做什么..."
                value={input}
                onChange={handleInputChange}
                disabled={isLoading || !apiKey}
              />
              <ActionIcon
                color="green"
                variant="filled"
                type="submit"
                disabled={isLoading || !input.trim() || !apiKey}
                loading={isLoading}
              >
                <IconSend size={16} />
              </ActionIcon>
            </Group>
          </form>
          {!apiKey && (
            <Text size="xs" c="orange" mt="xs">
              请先在设置中配置API Key才能使用AI助手
            </Text>
          )}
        </Box>
      </Paper>
    </Box>
  )
}

export default RealAIAssistant