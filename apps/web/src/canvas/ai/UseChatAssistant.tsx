import React, { useMemo, useState, useEffect, useRef } from 'react'
import { UIMessage, useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { nanoid } from 'nanoid'
import { ActionIcon, Badge, Box, Button, Group, Paper, Select, Stack, Text, Textarea, Tooltip } from '@mantine/core'
import { IconX, IconSparkles, IconSend } from '@tabler/icons-react'
import { getDefaultModel, getModelProvider } from '../../config/models'
import { useModelOptions } from '../../config/useModelOptions'
import { useRFStore } from '../store'
import { getAuthToken } from '../../auth/store'
import { getFirstAvailableApiKey } from './useApiKey'
import { listModelProviders } from '../../api/server'
import { functionHandlers } from '../../ai/canvasService'
import type { Node, Edge } from 'reactflow'

type AssistantPosition = 'right' | 'left'

interface UseChatAssistantProps {
  opened: boolean
  onClose: () => void
  position?: AssistantPosition
  width?: number
}

/**
 * 暗夜AI助手（流式版），基于 ai/react 的 useChat。
 * 匹配原 SimpleAIAssistant 的弹窗行为，使用后端 /ai/chat SSE。
 */
export function UseChatAssistant({ opened, onClose, position = 'right', width = 420 }: UseChatAssistantProps) {
  const nodes = useRFStore(state => state.nodes)
  const edges = useRFStore(state => state.edges)
  const [model, setModel] = useState(() => getDefaultModel('text'))
  const [apiKey, setApiKey] = useState<string | undefined>()
  const [baseUrl, setBaseUrl] = useState<string | undefined>()
  const textModelOptions = useModelOptions('text')
  const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3000'

  useEffect(() => {
    if (textModelOptions.length && !textModelOptions.find(option => option.value === model)) {
      setModel(textModelOptions[0].value)
    }
  }, [textModelOptions, model])

  useEffect(() => {
    let cancelled = false
    const loadCredentials = async () => {
      const vendor = getModelProvider(model)
      try {
        const providers = await listModelProviders()
        const vendorKey = vendor === 'google' ? 'gemini' : vendor
        const matched = providers.find(p => p.vendor === vendorKey)
        if (!cancelled) setBaseUrl(matched?.baseUrl || undefined)
      } catch (err) {
        console.warn('[UseChatAssistant] load providers failed', err)
        if (!cancelled) setBaseUrl(undefined)
      }
      try {
        const key = await getFirstAvailableApiKey(vendor as any)
        if (!cancelled) setApiKey(key || undefined)
      } catch (err) {
        console.warn('[UseChatAssistant] load api key failed', err)
        if (!cancelled) setApiKey(undefined)
      }
    }
    loadCredentials()
    return () => { cancelled = true }
  }, [model])

  const canvasContext = useMemo(() => {
    if (!nodes.length) return undefined
    return {
      summary: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        kinds: Array.from(new Set(nodes.map(n => (n.data as any)?.kind).filter(Boolean))),
      },
      nodes: nodes.slice(0, 14).map((node: Node) => ({
        id: node.id,
        label: (node.data as any)?.label,
        kind: (node.data as any)?.kind,
        type: node.type,
      })),
      edges: edges.slice(0, 16).map((edge: Edge) => ({ source: edge.source, target: edge.target })),
    }
  }, [nodes, edges])

  const body = useMemo(() => ({
    model,
    temperature: 0.2,
    context: canvasContext,
    provider: getModelProvider(model),
    apiKey,
    baseUrl,
  }), [model, canvasContext, apiKey, baseUrl])

  const chatId = useMemo(() => nanoid(), [])

  const chatTransport = useMemo(() => new DefaultChatTransport({
    api: `${apiBase.replace(/\/$/, '')}/ai/chat/stream`,
    streamProtocol: 'sse',
    // 将 UI 消息转换为后端需要的 { role, content } 结构，附带当前模型/上下文
    prepareSendMessagesRequest: ({ messages }) => ({
      headers: {
        'Content-Type': 'application/json',
        ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {})
      },
      body: {
        ...body,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.parts
            .map(part => {
              if (part.type === 'text') return part.text
              if (part.type === 'reasoning') return part.text || ''
              if (part.type === 'data') return typeof part.data === 'string' ? part.data : JSON.stringify(part.data)
              if (part.type === 'tool-call') return `调用工具：${part.toolName}`
              if (part.type === 'tool-result') return `工具结果：${part.toolName}`
              return ''
            })
            .filter(Boolean)
            .join('\n')
        })),
      }
    })
  }), [apiBase, body])

  const { messages, sendMessage, status, setMessages, addToolResult } = useChat({
    id: chatId,
    transport: chatTransport,
  })
  const handledToolCalls = useRef(new Set<string>())

  const [input, setInput] = useState('')
  const isLoading = status === 'submitted' || status === 'streaming'

  const stringifyMessage = (msg: UIMessage) => msg.parts
    .map(part => {
      if (part.type === 'text') return part.text
      if (part.type === 'reasoning') return part.text || ''
      if (part.type === 'data') return typeof part.data === 'string' ? part.data : JSON.stringify(part.data)
      if (part.type === 'tool-call') return `🛠 调用 ${part.toolName}`
      if (part.type === 'tool-result') return `✅ 工具 ${part.toolName} 完成`
      return ''
    })
    .filter(Boolean)
    .join('\n')

  const onSubmit = (e?: any) => {
    if (e?.preventDefault) e.preventDefault()
    if (!input.trim()) return
    sendMessage({ text: input })
    setInput('')
  }

  useEffect(() => {
    const toolCalls = messages.flatMap(msg =>
      msg.parts
        .filter((part: any) => part.type === 'tool-call')
        .map((part: any) => ({ toolCallId: part.toolCallId || part.id, toolName: part.toolName, input: part.input || part.arguments || {} }))
    )

    toolCalls.forEach(async (call) => {
      if (!call.toolCallId || handledToolCalls.current.has(call.toolCallId)) return
      handledToolCalls.current.add(call.toolCallId)
      const handler = (functionHandlers as any)[call.toolName]
      try {
        if (!handler) {
          await addToolResult({ state: 'output-error', tool: call.toolName as any, toolCallId: call.toolCallId, errorText: `未找到工具：${call.toolName}` })
          return
        }
        const result = await handler(call.input || {})
        await addToolResult({ state: 'output-available', tool: call.toolName as any, toolCallId: call.toolCallId, output: result as any })
      } catch (err) {
        await addToolResult({ state: 'output-error', tool: call.toolName as any, toolCallId: call.toolCallId, errorText: err instanceof Error ? err.message : '工具执行失败' })
      }
    })
  }, [messages, addToolResult])

  const injectSystemPrompt = () => {
    setMessages(prev => [
      ...prev,
      {
        id: nanoid(),
        role: 'system',
        parts: [{ type: 'text', text: '你是TapCanvas的AI工作流助手' }]
      }
    ])
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
              <Badge color="violet" variant="light" size="sm" radius="sm">流式</Badge>
              <IconSparkles size={16} color="#a5b4fc" />
              <Text fw={600} fz="lg" c="#eff6ff">暗夜AI助手</Text>
            </Group>
            <Group gap="xs">
              <Select
                size="xs"
                value={model}
                onChange={(value) => value && setModel(value)}
                data={textModelOptions.map(option => ({ value: option.value, label: option.label }))}
                aria-label="选择模型"
                withinPortal
              />
              <Tooltip label="关闭">
                <ActionIcon variant="subtle" color="gray" onClick={onClose}>
                  <IconX size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
        </Box>

        <Box px="lg" py="md" style={{ height: 'calc(100% - 260px)', overflow: 'hidden' }}>
          <Box
            style={{
              height: '100%',
              overflow: 'auto',
              padding: 12,
              background: 'rgba(15,23,42,0.8)',
              borderRadius: 8,
              border: '1px solid rgba(59,130,246,0.25)'
            }}
          >
            <Stack gap="sm">
              {messages.map(msg => (
                <Box key={msg.id} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: 10, border: '1px solid rgba(59,130,246,0.12)' }}>
                  <Text c="dimmed" size="xs">{msg.role}</Text>
                  <Text size="sm" c="#f8fafc" style={{ whiteSpace: 'pre-wrap' }}>{stringifyMessage(msg)}</Text>
                </Box>
              ))}
              {messages.length === 0 && (
                <Text size="sm" c="dimmed">输入你的需求，助手将流式回复并生成动作。</Text>
              )}
            </Stack>
          </Box>
        </Box>

        <Box px="lg" py="md" style={{ background: 'rgba(8,10,20,0.85)', borderTop: '1px solid rgba(15,118,110,0.2)' }}>
          <form
            onSubmit={onSubmit}
          >
            <Stack gap="xs">
              <Textarea
                minRows={3}
                placeholder="用自然语言描述需求，支持流式输出与工具调用…"
                value={input}
                onChange={(e) => setInput(e.currentTarget.value)}
                disabled={isLoading}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    onSubmit()
                  }
                }}
                styles={{ input: { background: 'rgba(15,23,42,0.7)', borderColor: 'rgba(99,102,241,0.4)', color: '#f8fafc' } }}
              />
              <Group justify="space-between">
                <Button
                  variant="light"
                  size="xs"
                  onClick={injectSystemPrompt}
                >
                  注入系统提示
                </Button>
                <Group gap="xs">
                  <Tooltip label="Ctrl/⌘ + Enter 发送">
                    <ActionIcon type="submit" color="violet" variant="light" loading={isLoading}>
                      <IconSend size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Button type="submit" loading={isLoading}>
                    发送
                  </Button>
                </Group>
              </Group>
            </Stack>
          </form>
        </Box>
      </Paper>
    </Box>
  )
}

export default UseChatAssistant
