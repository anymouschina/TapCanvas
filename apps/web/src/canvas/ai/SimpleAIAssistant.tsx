import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip
} from '@mantine/core'
import {
  IconSend,
  IconSettings,
  IconX,
  IconSparkles,
  IconLayoutGrid,
  IconBolt,
  IconMessageCircle,
  IconRobot,
  IconCheck,
  IconAlertTriangle
} from '@tabler/icons-react'
import { nanoid } from 'nanoid'
import { useRFStore } from '../store'
import { getDefaultModel } from '../../config/models'
import { useModelOptions } from '../../config/useModelOptions'
import { functionHandlers } from '../../ai/canvasService'
import type { FunctionResult } from '../../ai/canvasService'
import { getAuthToken } from '../../auth/store'

interface AssistantAction {
  type: keyof typeof functionHandlers | string
  params?: Record<string, any>
  reasoning?: string
  storeResultAs?: string
}

const FALLBACK_NODE_TYPES: Array<{ keyword: string; type: string; label: string }> = [
  { keyword: '文本', type: 'text', label: '文本节点' },
  { keyword: '文生图', type: 'image', label: '文生图节点' },
  { keyword: '图像', type: 'image', label: '图像节点' },
  { keyword: '视频', type: 'video', label: '视频节点' },
  { keyword: '音频', type: 'audio', label: '音频节点' },
  { keyword: '字幕', type: 'subtitle', label: '字幕节点' }
]

const REF_PLACEHOLDER = /^\{\{ref:([a-zA-Z0-9_-]+)\}\}$/

function resolvePlaceholders(value: any, refs: Record<string, string>): any {
  if (Array.isArray(value)) {
    return value.map(item => resolvePlaceholders(item, refs))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, resolvePlaceholders(val, refs)]))
  }
  if (typeof value === 'string') {
    const match = value.match(REF_PLACEHOLDER)
    if (match) {
      const refValue = refs[match[1]]
      return refValue ?? value
    }
  }
  return value
}

function extractStyleKeyword(text: string): string | undefined {
  const styleMatch = text.match(/([\u4e00-\u9fa5A-Za-z0-9\s]+)风格/)
  return styleMatch ? styleMatch[1].trim() : undefined
}

function extractDesiredCount(text: string): number {
  const explicitMatch = text.match(/(\d+)\s*(个|张|幅|场|镜|段)/)
  if (explicitMatch) {
    return Math.min(12, Math.max(1, parseInt(explicitMatch[1], 10)))
  }
  if (text.includes('多个') || text.includes('若干') || text.includes('一些')) {
    return 4
  }
  return 3
}

function buildWorkflowActions(text: string): AssistantAction[] {
  const wantsWorkflow = text.includes('工作流') || text.includes('流程')
  const mentionsImage = text.includes('文生图') || text.includes('图像') || text.includes('图片') || text.includes('海报')
  const mentionsVideo = text.includes('视频') || text.includes('文生视频') || text.includes('短片') || text.includes('影片')
  if (!mentionsImage && !mentionsVideo) return []
  if (!wantsWorkflow && !mentionsVideo && !text.includes('文生图')) return []

  const style = extractStyleKeyword(text)
  const actions: AssistantAction[] = []

  actions.push({
    type: 'createNode',
    storeResultAs: 'workflow_prompt',
    reasoning: '创建工作流提示词节点',
    params: {
      type: 'text',
      label: style ? `${style}提示词` : '提示词',
      config: {
        kind: 'text',
        prompt: text,
        style
      }
    }
  })

  if (mentionsImage) {
    actions.push({
      type: 'createNode',
      storeResultAs: 'workflow_image',
      reasoning: '创建文生图节点生成图像',
      params: {
        type: 'image',
        label: style ? `${style}文生图` : '文生图节点',
        config: {
          kind: 'image',
          prompt: `${style ? `${style} ` : ''}文生图：${text}`
        }
      }
    })
    actions.push({
      type: 'connectNodes',
      reasoning: '链接提示词节点到文生图节点',
      params: {
        sourceNodeId: '{{ref:workflow_prompt}}',
        targetNodeId: '{{ref:workflow_image}}'
      }
    })
  }

  if (mentionsVideo) {
    const sourceRef = mentionsImage ? 'workflow_image' : 'workflow_prompt'
    actions.push({
      type: 'createNode',
      storeResultAs: 'workflow_video',
      reasoning: '创建文生视频节点',
      params: {
        type: 'video',
        label: style ? `${style}视频` : '文生视频节点',
        config: {
          kind: 'composeVideo',
          prompt: `${style ? `${style} ` : ''}视频：${text}`
        }
      }
    })
    actions.push({
      type: 'connectNodes',
      reasoning: '将文生图或提示词节点连接到视频节点',
      params: {
        sourceNodeId: `{{ref:${sourceRef}}}`,
        targetNodeId: '{{ref:workflow_video}}'
      }
    })
  }

  return actions
}

function buildStoryboardActions(text: string): AssistantAction[] {
  const mentionsStoryboard = text.includes('分镜') || text.includes('镜头') || text.includes('片段') || text.includes('场景')
  const mentionsImage = text.includes('文生图') || text.includes('图像') || text.includes('图片')
  if (!mentionsStoryboard || !mentionsImage) {
    return []
  }

  const count = extractDesiredCount(text)
  const style = extractStyleKeyword(text)
  const actions: AssistantAction[] = []

  for (let i = 1; i <= count; i++) {
    const label = `${style ? `${style}` : '分镜'}-${i}`
    actions.push({
      type: 'createNode',
      storeResultAs: `storyboard_${i}`,
      reasoning: `创建第${i}个分镜图像节点`,
      params: {
        type: 'image',
        label,
        config: {
          kind: 'image',
          prompt: `${text} - 分镜${i}`,
          storyboardIndex: i
        }
      }
    })
  }

  return actions
}

function buildSingleNodeAction(text: string): AssistantAction[] {
  const mapping = FALLBACK_NODE_TYPES.find(item => text.includes(item.keyword)) || FALLBACK_NODE_TYPES[0]
  const labelMatch = text.match(/"([^"]+)"/) || text.match(/“([^”]+)”/)
  const label = labelMatch ? labelMatch[1] : text.replace(/.*(创建|添加|新建)/, '').replace('节点', '').trim() || mapping.label

  return [{
    type: 'createNode',
    storeResultAs: 'single_node',
    params: {
      type: mapping.type,
      label: label || mapping.label,
      config: mapping.type === 'image' ? { kind: 'image', prompt: text } : { prompt: text }
    },
    reasoning: '根据自然语言推断创建节点'
  }]
}

function inferActionsFromMessage(message: string): AssistantAction[] {
  const text = message.trim()
  if (!text) return []

  const workflowActions = buildWorkflowActions(text)
  if (workflowActions.length) return workflowActions

  const storyboardActions = buildStoryboardActions(text)
  if (storyboardActions.length) return storyboardActions

  const createKeywords = ['创建', '添加', '新建']
  const shouldCreateNode = createKeywords.some(keyword => text.includes(keyword))
  if (shouldCreateNode) {
    return buildSingleNodeAction(text)
  }

  return []
}

function normalizeActionParams(params?: Record<string, any>) {
  if (!params || typeof params !== 'object') return {}
  if ('payload' in params && params.payload && typeof params.payload === 'object') {
    const { payload, ...rest } = params
    return { ...payload, ...rest }
  }
  return params
}

interface ExecutedAction {
  id: string
  action: AssistantAction
  status: 'pending' | 'success' | 'error'
  result?: FunctionResult
}

interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  plan?: string[]
  actions?: ExecutedAction[]
}

const ENV_API_BASE = (import.meta as any).env?.VITE_API_BASE as string | undefined
const DEFAULT_DEV_API_BASE = (import.meta as any).env?.DEV ? 'http://localhost:3000' : ''
const API_BASE = ENV_API_BASE && ENV_API_BASE.length > 0 ? ENV_API_BASE : DEFAULT_DEV_API_BASE
const AI_ENDPOINT = API_BASE ? `${API_BASE.replace(/\/$/, '')}/ai/chat` : '/api/ai/chat'

interface SimpleAIAssistantProps {
  opened: boolean
  onClose: () => void
  position?: 'right' | 'left'
  width?: number
}

export function SimpleAIAssistant({ opened, onClose, position = 'right', width = 420 }: SimpleAIAssistantProps) {
  const nodes = useRFStore(state => state.nodes)
  const edges = useRFStore(state => state.edges)
  const textModelOptions = useModelOptions('text')
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [model, setModel] = useState(() => getDefaultModel('text'))
  const [error, setError] = useState<string | null>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector('[data-scrollbar-view]') as HTMLElement | null
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight
      }
    }
  }, [messages, isLoading])

  useEffect(() => {
    if (textModelOptions.length && !textModelOptions.find(option => option.value === model)) {
      setModel(textModelOptions[0].value)
    }
  }, [textModelOptions, model])
  const currentModelLabel = textModelOptions.find(option => option.value === model)?.label || model

  const canvasContext = useMemo(() => {
    if (!nodes.length) return undefined
    return {
      summary: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        kinds: Array.from(new Set(nodes.map(n => (n.data as any)?.kind).filter(Boolean))),
      },
      nodes: nodes.slice(0, 14).map(node => ({
        id: node.id,
        label: (node.data as any)?.label,
        kind: (node.data as any)?.kind,
        type: node.type,
      })),
      edges: edges.slice(0, 16).map(edge => ({ source: edge.source, target: edge.target })),
    }
  }, [nodes, edges])

  const handleSendMessage = async () => {
    const trimmed = inputValue.trim()
    if (!trimmed || isLoading) return

    const userMessage: AssistantMessage = {
      id: nanoid(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setIsLoading(true)
    setError(null)

    try {
      const payloadMessages = [
        ...messages
          .filter(msg => msg.role === 'user' || msg.role === 'assistant')
          .map(msg => ({ role: msg.role, content: msg.content })),
        { role: 'user', content: trimmed },
      ]

      const token = getAuthToken()
      const response = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: payloadMessages,
          context: canvasContext,
          temperature: 0.2,
        })
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || 'AI服务不可用')
      }

      const data = await response.json() as { reply: string; plan?: string[]; actions?: AssistantAction[] }
      if ((!data.actions || data.actions.length === 0) && userMessage) {
        const fallback = inferActionsFromMessage(userMessage)
        data.actions = fallback
        data.plan = ([] as string[]).concat(data.plan || [])
        data.plan.unshift('⚙️ 自动根据指令生成动作序列，模型未输出tool调用')
      }
      const messageId = nanoid()
      const assistantMessage: AssistantMessage = {
        id: messageId,
        role: 'assistant',
        content: data.reply,
        plan: data.plan || [],
        timestamp: new Date(),
        actions: data.actions?.length ? data.actions.map(action => ({
          id: nanoid(),
          action,
          status: 'pending' as const,
        })) : [],
      }

      setMessages(prev => [...prev, assistantMessage])

      if (data.actions?.length) {
        await executeActionsSequentially(messageId, data.actions)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI助手调用失败'
      setError(message)
      setMessages(prev => [...prev, {
        id: nanoid(),
        role: 'assistant',
        content: `⚠️ ${message}`,
        timestamp: new Date(),
      }])
    } finally {
      setIsLoading(false)
    }
  }

  const executeActionsSequentially = async (messageId: string, actions: AssistantAction[]) => {
    const refs: Record<string, string> = {}
    for (const [index, action] of actions.entries()) {
      const handler = (functionHandlers as any)[action.type]
      let result: FunctionResult
      if (!handler) {
        result = { success: false, error: `暂不支持的操作：${action.type}` }
      } else {
        try {
          const normalizedParams = normalizeActionParams(action.params)
          const resolvedParams = resolvePlaceholders(normalizedParams, refs)
          result = await handler(resolvedParams || {})
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : '执行失败' }
        }
      }
      setMessages(prev => prev.map(msg => {
        if (msg.id !== messageId || !msg.actions) return msg
        const updated = [...msg.actions]
        if (updated[index]) {
          updated[index] = { ...updated[index], status: result.success ? 'success' : 'error', result }
        }
        return { ...msg, actions: updated }
      }))

      if (result.success && action.storeResultAs) {
        const nodeId = (result.data && (result.data.nodeId || result.data.id)) as string | undefined
        if (nodeId) {
          refs[action.storeResultAs] = nodeId
        }
      }
    }
  }

  if (!opened) return null

  return (
    <Box
      style={{
        position: 'fixed',
        top: 56,
        [position]: 16,
        width,
        maxWidth: 'calc(100vw - 32px)',
        height: 'calc(100vh - 72px)',
        zIndex: 200,
        pointerEvents: 'auto',
        overflow: 'hidden'
      }}
    >
      <Paper
        radius="lg"
        h="100%"
        shadow="xl"
        style={{
          background: 'linear-gradient(145deg, rgba(5,7,16,0.95), rgba(12,17,32,0.9), rgba(8,14,28,0.95))',
          border: '1px solid rgba(82, 152, 255, 0.25)',
          boxShadow: '0 0 45px rgba(46,133,255,0.25)',
          overflow: 'hidden',
          backdropFilter: 'blur(18px)'
        }}
      >
        <Box px="lg" py="md" style={{ borderBottom: '1px solid rgba(82,152,255,0.25)', background: 'linear-gradient(120deg, rgba(15,23,42,0.9), rgba(10,12,24,0.6))' }}>
          <Group justify="space-between" align="center">
            <Group gap="sm">
              <ThemeIcon radius="xl" size="md" variant="gradient" gradient={{ from: 'cyan', to: 'violet', deg: 135 }}>
                <IconSparkles size={16} />
              </ThemeIcon>
              <Box>
                <Text fw={600} fz="lg" c="#eff6ff">暗夜AI助手</Text>
                <Text size="xs" c="dimmed">洞悉画布 · 智能生成节点</Text>
              </Box>
              <Badge color="violet" variant="light" size="sm" radius="sm">
                {currentModelLabel}
              </Badge>
              {isLoading && (
                <Badge color="pink" variant="light">思考中...</Badge>
              )}
            </Group>
            <Group gap="xs" align="center">
              <Select
                size="xs"
                value={model}
                onChange={(value) => value && setModel(value)}
                data={textModelOptions.map(option => ({ value: option.value, label: option.label }))}
                aria-label="选择推理模型"
                withinPortal
                variant="filled"
                styles={{
                  input: {
                    backgroundColor: 'rgba(15,23,42,0.6)',
                    borderColor: 'rgba(99,102,241,0.4)',
                    color: '#f8fafc',
                    minWidth: 180,
                    cursor: 'pointer'
                  },
                  dropdown: { backgroundColor: '#0f172a', borderColor: 'rgba(99,102,241,0.4)' },
                  option: { color: '#e2e8f0' }
                }}
              />
              <Tooltip label="模型与上下文">
                <ActionIcon variant="subtle" color="gray" onClick={() => setShowSettings(v => !v)}>
                  <IconSettings size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="关闭助手">
                <ActionIcon variant="subtle" color="gray" onClick={onClose}>
                  <IconX size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
          {showSettings && (
            <Stack gap="xs" mt="md">
              <Select
                size="xs"
                label="推理模型"
                value={model}
                onChange={value => value && setModel(value)}
                data={textModelOptions.map(m => ({ value: m.value, label: m.label }))}
                styles={{ label: { color: '#9ca3af' } }}
              />
              {canvasContext && (
                <Group gap="xs" wrap="wrap">
                  <Badge variant="light" color="indigo">{canvasContext.summary.nodeCount} 个节点</Badge>
                  <Badge variant="light" color="cyan">{canvasContext.summary.edgeCount} 条连线</Badge>
                  {canvasContext.summary.kinds?.map(kind => (
                    <Badge key={kind} color="grape" variant="outline">{kind}</Badge>
                  ))}
                </Group>
              )}
            </Stack>
          )}
        </Box>

        <Box style={{ height: `calc(100% - ${showSettings ? 220 : 180}px)` }}>
          <ScrollArea
            h="100%"
            px="lg"
            ref={scrollAreaRef}
            styles={{ viewport: { overflowX: 'hidden' }}}
          >
            <Stack gap="md" py="lg" >
              {messages.length === 0 && (
                <Paper p="lg" radius="md" style={{ background: 'rgba(8,12,24,0.8)', border: '1px dashed rgba(99,102,241,0.5)' }}>
                  <Stack gap="xs">
                    <Group gap="xs">
                      <IconRobot size={18} color="#60a5fa" />
                      <Text fw={500} c="#cbd5f5">欢迎来到TapCanvas AI工作台</Text>
                    </Group>
                    <Text size="sm" c="dimmed">试试输入：“为我构建一个文本到图像的工作流，并连接到视频合成节点”。</Text>
                    <Text size="sm" c="dimmed">助手会自动规划节点、连接工作流并执行布局。</Text>
                  </Stack>
                </Paper>
              )}

              {messages.map(message => (
                <Paper
                  key={message.id}
                  radius="md"
                  p="md"
                  style={{
                    background: message.role === 'user' ? 'rgba(30,41,59,0.75)' : 'rgba(5,9,20,0.9)',
                    border: '1px solid rgba(96,165,250,0.35)',
                    boxShadow: message.role === 'assistant' ? '0 0 25px rgba(59,130,246,0.15)' : 'none'
                  }}
                >
                  <Group justify="space-between" mb="xs">
                    <Group gap="xs">
                      <ThemeIcon size="sm" radius="xl" variant="light" color={message.role === 'user' ? 'cyan' : 'violet'}>
                        {message.role === 'user' ? <IconMessageCircle size={12} /> : <IconBolt size={12} />}
                      </ThemeIcon>
                      <Text fw={500} c="#e0e7ff">{message.role === 'user' ? '创作者' : '暗夜AI'}</Text>
                    </Group>
                    <Text size="xs" c="dimmed">{message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  </Group>
                  <Text size="sm" c="#f8fafc" style={{ whiteSpace: 'pre-wrap' }}>{message.content}</Text>

                  {message.plan && message.plan.length > 0 && (
                    <Box mt="sm">
                      <Group gap="xs">
                        <IconLayoutGrid size={14} color="#38bdf8" />
                        <Text size="xs" c="#93c5fd">执行计划</Text>
                      </Group>
                      <Stack gap={4} mt={4}>
                        {message.plan.map((item, index) => (
                          <Group key={`${message.id}-plan-${index}`} gap="xs">
                            <Badge size="xs" color="indigo" radius="sm" variant="filled">{index + 1}</Badge>
                            <Text size="xs" c="#cbd5f5">{item}</Text>
                          </Group>
                        ))}
                      </Stack>
                    </Box>
                  )}

                  {message.actions && message.actions.length > 0 && (
                    <Stack gap="xs" mt="sm">
                      {message.actions.map(action => (
                        <Paper key={action.id} radius="md" p="sm" style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(59,130,246,0.25)' }}>
                          <Group gap="xs" justify="space-between">
                            <Group gap="xs">
                              <Badge size="xs" color="blue" variant="light">{action.action.type}</Badge>
                              <Text size="xs" c="#94a3b8">{action.action.reasoning || '执行节点操作'}</Text>
                            </Group>
                            {action.status === 'pending' && <Badge size="xs" color="yellow" variant="dot">执行中</Badge>}
                            {action.status === 'success' && (
                              <Badge size="xs" color="green" rightSection={<IconCheck size={10} />}>完成</Badge>
                            )}
                            {action.status === 'error' && (
                              <Badge size="xs" color="red" rightSection={<IconAlertTriangle size={10} />}>异常</Badge>
                            )}
                          </Group>
                          {action.result?.message && (
                            <Text size="xs" c="#e2e8f0" mt={4}>{action.result.message}</Text>
                          )}
                          {action.result?.error && (
                            <Text size="xs" c="#fda4af" mt={4}>{action.result.error}</Text>
                          )}
                        </Paper>
                      ))}
                    </Stack>
                  )}
                </Paper>
              ))}

              {isLoading && (
                <Paper p="md" radius="md" style={{ border: '1px solid rgba(248,113,113,0.2)', background: 'rgba(24,24,37,0.8)' }}>
                  <Group gap="xs">
                    <IconBolt size={16} color="#f472b6" />
                    <Text size="sm" c="#f9a8d4">AI正在推演工作流，请稍候...</Text>
                  </Group>
                </Paper>
              )}

              {error && (
                <Text size="xs" c="red">{error}</Text>
              )}
            </Stack>
          </ScrollArea>
        </Box>

        <Divider opacity={0.15} />

        <Box px="lg" py="md" style={{ background: 'rgba(8,10,20,0.85)', borderTop: '1px solid rgba(15,118,110,0.2)' }}>
          <TextInput
            placeholder="用自然语言描述你想要的工作流..."
            value={inputValue}
            onChange={(event) => setInputValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                handleSendMessage()
              }
            }}
            rightSection={
              <ActionIcon color="violet" variant="gradient" gradient={{ from: 'violet', to: 'indigo' }} onClick={handleSendMessage} disabled={!inputValue.trim() || isLoading}>
                <IconSend size={16} />
              </ActionIcon>
            }
            styles={{ input: { background: 'rgba(15,23,42,0.7)', borderColor: 'rgba(99,102,241,0.4)', color: '#f8fafc' } }}
            disabled={isLoading}
          />
        </Box>
      </Paper>
    </Box>
  )
}

export default SimpleAIAssistant
