import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { UIMessage, useChat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import { nanoid } from 'nanoid'
import { ActionIcon, Badge, Box, Button, CopyButton, Divider, Group, Loader, Modal, Paper, RingProgress, ScrollArea, Select, Stack, Text, Textarea, Tooltip, useMantineColorScheme, useMantineTheme } from '@mantine/core'
import { IconX, IconSparkles, IconSend, IconPhoto, IconBulb, IconEye, IconBrain } from '@tabler/icons-react'
import { getDefaultModel, getModelProvider, type ModelOption } from '../../config/models'
import { useModelOptions } from '../../config/useModelOptions'
import { useRFStore } from '../store'
import { getAuthToken } from '../../auth/store'
import { functionHandlers } from '../../ai/canvasService'
import { subscribeToolEvents, type ToolEventMessage, extractThinkingEvent, extractPlanUpdate } from '../../api/toolEvents'
import { runTaskByVendor, type TaskResultDto, listModelProviders, listModelTokens } from '../../api/server'
import { toast } from '../../ui/toast'
import { DEFAULT_REVERSE_PROMPT_INSTRUCTION } from '../constants'
import type { ThinkingEvent, PlanUpdatePayload } from '../../types/canvas-intelligence'
import { ThinkingProcess, ExecutionPlanDisplay } from '../../components/ai/IntelligentAssistant'
import { buildCanvasContext } from '../utils/buildCanvasContext'

type AssistantPosition = 'right' | 'left'

interface UseChatAssistantProps {
  opened: boolean
  onClose: () => void
  position?: AssistantPosition
  width?: number
  intelligentMode?: boolean
}

const OPENAI_DEFAULT_MODEL = 'gpt-5.1-codex'
const ASSISTANT_MODEL_PRESETS: ModelOption[] = [
  { value: 'gpt-5.1', label: 'GPT-5.1' },
  { value: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
]
const ASSISTANT_MODEL_SET = new Set(ASSISTANT_MODEL_PRESETS.map(option => option.value))
const MAX_IMAGE_PROMPT_ATTACHMENTS = 2
const AI_DEBUG_LOGS_ENABLED = (import.meta as any).env?.VITE_DEBUG_AI_LOGS === 'true'

const buildAssistantBaseOptions = (textOptions: ModelOption[]): ModelOption[] => {
  const overrides = new Map<string, ModelOption>()
  textOptions.forEach((option) => {
    if (ASSISTANT_MODEL_SET.has(option.value)) {
      overrides.set(option.value, option)
    }
  })
  return ASSISTANT_MODEL_PRESETS.map((option) => overrides.get(option.value) || option)
}

const filterGptOptions = (options: ModelOption[]): ModelOption[] =>
  options.filter((option) => option.value.toLowerCase().includes('gpt'))

const mergeModelOptionLists = (primary: ModelOption[], extra: ModelOption[]): ModelOption[] => {
  const seen = new Set<string>()
  const merged: ModelOption[] = []
  primary.forEach((opt) => {
    if (seen.has(opt.value)) return
    seen.add(opt.value)
    merged.push(opt)
  })
  extra.forEach((opt) => {
    if (seen.has(opt.value)) return
    seen.add(opt.value)
    merged.push(opt)
  })
  return merged
}

async function fetchAssistantCodexModels(): Promise<ModelOption[]> {
  try {
    const providers = await listModelProviders().catch(() => [])
    const openaiProvider = providers.find((provider) => provider.vendor === 'openai')
    if (!openaiProvider) return []
    const baseUrl = (openaiProvider.baseUrl || '').trim()
    if (!baseUrl) return []
    const tokens = await listModelTokens(openaiProvider.id).catch(() => [])
    const token = tokens.find((t) => t.enabled && typeof t.secretToken === 'string' && t.secretToken.trim())
    if (!token?.secretToken) return []
    const normalizedBase = baseUrl.replace(/\/$/, '')
    const endpoint = `${normalizedBase}/v1/models`
    console.debug('[UseChatAssistant] 请求 GPT 模型列表', {
      baseUrl: normalizedBase,
      endpoint,
      tokenLabel: token.label || '未命名密钥',
    })
    const resp = await fetch(endpoint, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.secretToken}`,
      },
    })
    if (!resp.ok) {
      console.warn('[UseChatAssistant] Codex model fetch failed', resp.status)
      return []
    }
    let payload: any = null
    try {
      payload = await resp.json()
    } catch {
      payload = null
    }
    console.debug('[UseChatAssistant] GPT 模型响应', payload)
    const list = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : Array.isArray(payload)
          ? payload
          : []
    return list
      .map((item) => {
        const value = typeof item?.id === 'string' ? item.id : typeof item?.name === 'string' ? item.name : null
        if (!value) return null
        if (!value.toLowerCase().includes('gpt')) return null
        const label = typeof item?.displayName === 'string' && item.displayName.trim() ? item.displayName.trim() : value
        return { value, label, vendor: 'openai' as const }
      })
      .filter(Boolean) as ModelOption[]
  } catch (error) {
    console.warn('[UseChatAssistant] failed to load Codex models', error)
    return []
  }
}

const collectTextFromParts = (parts?: any): string => {
  if (!Array.isArray(parts)) return ''
  const buffer: string[] = []
  const pushPart = (part: any) => {
    if (!part) return
    if (typeof part === 'string' && part.trim()) {
      buffer.push(part.trim())
      return
    }
    const candidates: (string | undefined)[] = [
      typeof part.text === 'string' ? part.text : undefined,
      typeof part.content === 'string' ? part.content : undefined,
      typeof part.output_text === 'string' ? part.output_text : undefined,
      typeof part.value === 'string' ? part.value : undefined,
    ]
    candidates.forEach((text) => {
      if (text && text.trim()) {
        buffer.push(text.trim())
      }
    })
    if (Array.isArray(part.content)) {
      part.content.forEach(pushPart)
    }
  }
  parts.forEach(pushPart)
  return buffer.join('').trim()
}

const extractTextFromResponsePayload = (payload: any): string => {
  if (!payload || typeof payload !== 'object') return ''

  if (typeof payload.text === 'string' && payload.text.trim()) {
    return payload.text.trim()
  }

  if (Array.isArray(payload.output_text)) {
    const merged = payload.output_text
      .map((entry: any) => (typeof entry === 'string' ? entry : ''))
      .join('')
      .trim()
    if (merged) return merged
  }

  if (Array.isArray(payload.output)) {
    const merged = payload.output
      .map((entry: any) => collectTextFromParts(entry?.content))
      .filter(Boolean)
      .join('\n')
      .trim()
    if (merged) return merged
  }

  if (Array.isArray(payload.content)) {
    const merged = collectTextFromParts(payload.content)
    if (merged) return merged
  }

  const choices = payload.choices
  if (Array.isArray(choices) && choices.length > 0) {
    const message = choices[0]?.message
    const choiceText =
      (typeof message?.content === 'string' && message.content.trim()) ||
      collectTextFromParts(message?.content) ||
      (typeof choices[0]?.text === 'string' ? choices[0].text.trim() : '')
    if (choiceText) return choiceText
  }

  const candidates = payload.candidates
  if (Array.isArray(candidates) && candidates.length > 0) {
    const merged = collectTextFromParts(candidates[0]?.content?.parts || candidates[0]?.content)
    if (merged) return merged
  }

  if (payload.result) {
    const nested = extractTextFromResponsePayload(payload.result)
    if (nested) return nested
  }

  return ''
}

const toSingleLine = (text?: string) => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '')

const extractTextFromTaskResult = (task?: TaskResultDto | null): string => {
  if (!task) return ''
  const raw = task.raw as any
  if (raw && typeof raw.text === 'string' && raw.text.trim()) {
    return raw.text.trim()
  }
  const fromResponse = extractTextFromResponsePayload(raw?.response || raw)
  if (fromResponse) return fromResponse
  return ''
}

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result
      if (typeof result === 'string') resolve(result)
      else reject(new Error('failed to read file'))
    }
    reader.onerror = () => reject(new Error('failed to read file'))
    reader.readAsDataURL(file)
  })

interface ImagePromptAttachment {
  id: string
  preview: string
  prompt: string
  ready: boolean
}

const normalizeFileList = (files: FileList | File[]): File[] => {
  if (Array.isArray(files)) {
    return files.filter((file): file is File => !!file)
  }
  const out: File[] = []
  for (let i = 0; i < files.length; i += 1) {
    const item = files.item(i)
    if (item) out.push(item)
  }
  return out
}

/**
 * 暗夜AI助手（流式版），基于 @ai-sdk/react 的 useChat。
 * 匹配原 SimpleAIAssistant 的弹窗行为，使用后端 /ai/chat SSE。
 */
export function UseChatAssistant({ opened, onClose, position = 'right', width = 420, intelligentMode = true }: UseChatAssistantProps) {
  const nodes = useRFStore(state => state.nodes)
  const edges = useRFStore(state => state.edges)
  const [model, setModel] = useState(() => OPENAI_DEFAULT_MODEL || getDefaultModel('text'))
  const textModelOptions = useModelOptions('text')
  const [codexModels, setCodexModels] = useState<ModelOption[]>([])
  const fallbackAssistantOptions = useMemo(() => buildAssistantBaseOptions(textModelOptions), [textModelOptions])
  const gptTextOptions = useMemo(() => filterGptOptions(textModelOptions), [textModelOptions])
  const assistantModelOptions = useMemo(() => {
    const primary = gptTextOptions.length ? gptTextOptions : fallbackAssistantOptions
    return mergeModelOptionLists(primary, codexModels)
  }, [gptTextOptions, fallbackAssistantOptions, codexModels])
  const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3000'
  const apiRoot = useMemo(() => apiBase.replace(/\/$/, ''), [apiBase])
  const { colorScheme } = useMantineColorScheme()
  const theme = useMantineTheme()
  const isDarkUi = colorScheme === 'dark'
  const panelBackground = isDarkUi
    ? 'linear-gradient(145deg, rgba(5,7,16,0.95), rgba(12,17,32,0.9), rgba(8,14,28,0.95))'
    : 'linear-gradient(145deg, rgba(248,250,252,0.98), rgba(237,242,255,0.95))'
  const panelBorder = 'none'
  const panelShadow = isDarkUi ? '0 0 45px rgba(46,133,255,0.25)' : '0 18px 32px rgba(15,23,42,0.12)'
  const headerBackground = isDarkUi
    ? 'linear-gradient(120deg, rgba(15,23,42,0.9), rgba(10,12,24,0.6))'
    : 'linear-gradient(120deg, rgba(226,232,240,0.92), rgba(248,250,252,0.85))'
  const headerBorder = 'none'
  const headerTextColor = isDarkUi ? '#eff6ff' : '#0f172a'
  const sparklesColor = isDarkUi ? '#a5b4fc' : '#6366f1'
  const logBackground = isDarkUi ? 'rgba(15,23,42,0.8)' : 'rgba(248,250,252,0.9)'
  const logBorder = 'none'
  const messageBackground = isDarkUi ? 'rgba(255,255,255,0.02)' : 'rgba(15,23,42,0.04)'
  const messageBorder = 'none'
  const messageTextColor = isDarkUi ? '#f8fafc' : '#0f172a'
  const inputBackground = isDarkUi ? 'rgba(15,23,42,0.7)' : '#ffffff'
  const inputBorder = isDarkUi ? 'rgba(99,102,241,0.4)' : 'rgba(148,163,184,0.5)'
  const inputColor = isDarkUi ? '#f8fafc' : '#0f172a'
  const closeIconColor = isDarkUi ? '#d1d5db' : '#0f172a'
  const auroraAccent = '#8F7BFF'
  const auroraCyan = '#4DD6FF'
  const statusGradients: Record<'idle' | 'thinking' | 'success', string> = {
    idle: isDarkUi
      ? 'linear-gradient(135deg, rgba(15,23,42,0.85), rgba(8,12,24,0.8))'
      : 'linear-gradient(135deg, rgba(241,245,255,0.95), rgba(226,232,240,0.9))',
    thinking: 'linear-gradient(135deg, rgba(143,123,255,0.22), rgba(77,214,255,0.18))',
    success: 'linear-gradient(135deg, rgba(92,242,194,0.25), rgba(58,176,158,0.2))'
  }
  const statusBadgeText: Record<'idle' | 'thinking' | 'success', string> = {
    idle: '待命',
    thinking: '推演中',
    success: '已完成'
  }
  const statusBadgeColor: Record<'idle' | 'thinking' | 'success', string> = {
    idle: 'gray',
    thinking: 'violet',
    success: 'teal'
  }
  const conversationOverlayOffset = 240
  const imagePromptInputRef = useRef<HTMLInputElement | null>(null)
  const [imagePromptLoadingCount, setImagePromptLoadingCount] = useState(0)
  const imagePromptLoading = imagePromptLoadingCount > 0
  const [imagePromptAttachments, setImagePromptAttachments] = useState<ImagePromptAttachment[]>([])
  const [activePromptAttachmentId, setActivePromptAttachmentId] = useState<string | null>(null)
  const activePromptAttachment = useMemo(
    () => imagePromptAttachments.find(attachment => attachment.id === activePromptAttachmentId) || null,
    [imagePromptAttachments, activePromptAttachmentId]
  )
  const [thinkingEvents, setThinkingEvents] = useState<ThinkingEvent[]>([])
  const [planUpdate, setPlanUpdate] = useState<PlanUpdatePayload | null>(null)
  const [isThinking, setIsThinking] = useState(false)
  const [statusPhase, setStatusPhase] = useState<'idle' | 'thinking' | 'success'>('idle')
  const [statusNote, setStatusNote] = useState('等待你的灵感描述，我会点亮 Aurora 画布。')
  const planCompletion = useMemo(() => {
    if (!planUpdate || !planUpdate.steps || planUpdate.steps.length === 0) return 0
    const completed = planUpdate.steps.filter(step => step.status === 'completed').length
    return Math.round((completed / planUpdate.steps.length) * 100)
  }, [planUpdate])
  const setStatusLine = useCallback((text: string) => {
    const normalized = toSingleLine(text)
    setStatusNote(normalized || '')
  }, [setStatusNote])
  const updateActionStatus = useCallback((actionLabel: string, phase: 'running' | 'success' | 'error', extra?: string) => {
    if (!actionLabel) return
    const label = toSingleLine(actionLabel)
    if (!label) return
    if (phase === 'running') {
      setStatusLine(`${label}中…`)
      return
    }
    if (phase === 'success') {
      setStatusLine(`${label}完成`)
      return
    }
    const extraText = toSingleLine(extra)
    setStatusLine(extraText ? `${label}失败：${extraText}` : `${label}失败`)
  }, [setStatusLine])

  useEffect(() => {
    if (!opened) return
    let canceled = false
    fetchAssistantCodexModels()
      .then((models) => {
        if (canceled) return
        setCodexModels(models)
      })
      .catch(() => {})
    return () => {
      canceled = true
    }
  }, [opened])

  useEffect(() => {
    if (opened) {
      setStatusPhase('idle')
      setStatusLine('等待你的灵感描述，我会点亮 Aurora 画布。')
    }
  }, [opened, setStatusLine])

  useEffect(() => {
    if (assistantModelOptions.length && !assistantModelOptions.find(option => option.value === model)) {
      const preferred = assistantModelOptions.find(option => option.value === OPENAI_DEFAULT_MODEL)
      setModel(preferred ? preferred.value : assistantModelOptions[0].value)
    }
  }, [assistantModelOptions, model])

  const canvasContext = useMemo(() => buildCanvasContext(nodes, edges), [nodes, edges])

  const provider = useMemo(() => {
    const match = assistantModelOptions.find((opt) => opt.value === model)
    if (match?.vendor) {
      if (match.vendor === 'gemini') return 'google'
      if (['openai', 'anthropic', 'google'].includes(match.vendor)) {
        return match.vendor as ReturnType<typeof getModelProvider>
      }
    }
    return getModelProvider(model)
  }, [model, assistantModelOptions])
  const isGptModel = provider === 'openai'

  const body = useMemo(() => ({
    model,
    context: canvasContext,
    provider,
    clientToolExecution: true, // 始终让前端执行工具，智能模式仍由后端 sidecar 提供
    maxToolRoundtrips: 4,
    intelligentMode,
    enableThinking: true,
  }), [model, canvasContext, provider, intelligentMode])

  const chatId = useMemo(() => `${model}-${nanoid()}`, [model])

  const chatTransport = useMemo(() => new DefaultChatTransport({
    api: `${apiRoot}/ai/chat/stream`,
    streamProtocol: 'sse',
    prepareSendMessagesRequest: ({ messages }) => {
      const serializedMessages = messages.map(({ id: _id, ...rest }) => ({
        role: rest.role,
        metadata: rest.metadata,
        parts: (rest.parts || []).map(part => {
          if (part.type === 'data') {
            if (typeof part.data === 'string') return part
            try {
              return { ...part, data: JSON.stringify(part.data) }
            } catch {
              return { ...part, data: String(part.data) }
            }
          }
          return part
        })
      }))
      return {
        headers: {
          'Content-Type': 'application/json',
          ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {})
        },
        body: {
          ...body,
          messages: serializedMessages,
        }
      }
    }
  }), [apiRoot, body, model, intelligentMode])

  const parseJsonIfNeeded = (value: any) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    }
    if (value == null) return {}
    return value
  }

  const { messages, sendMessage, status, setMessages, addToolResult } = useChat({
    id: chatId,
    transport: chatTransport,
    sendAutomaticallyWhen: ({ messages }) => lastAssistantMessageIsCompleteWithToolCalls({ messages })
  })
  const streamingBadgeColor = status === 'streaming' ? 'teal' : status === 'submitted' ? 'yellow' : 'gray'
  const streamingBadgeLabel = status === 'streaming' ? '流式同步' : status === 'submitted' ? '派单中' : '静候'
  const handledToolCalls = useRef(new Set<string>())
  const actionStatusByCallId = useRef(new Map<string, string>())
  const resolveToolName = (part: any) => {
    if (part?.toolName) return part.toolName
    if (typeof part?.type === 'string' && part.type.startsWith('tool-')) {
      return part.type.slice('tool-'.length)
    }
    return undefined
  }

  const isToolCallPart = (part: any) => {
    if (!part) return false
    const { state } = part
    if (state === 'input-streaming') return false
    if (part.type === 'tool-input-available') return true
    if (part.type === 'tool-call' || part.type === 'dynamic-tool') return true
    if (typeof part.type === 'string') {
      const type = part.type
      if (type === 'tool-result') return false
      if (type.startsWith('tool-input')) return type.endsWith('available')
      if (type.startsWith('tool-')) return true
    }
    return Boolean(part.toolName && part.toolCallId)
  }

  const PROMPT_FIELD_KEYS = new Set(['prompt', 'videoPrompt', 'description', 'story', 'script', 'text'])
  const MAX_SUMMARY_DEPTH = 4
  const truncateText = (value: string, limit = 160) => {
    const normalized = value.replace(/\s+/g, ' ').trim()
    if (!normalized) return ''
    if (normalized.length <= limit) return normalized
    return `${normalized.slice(0, limit - 1)}…`
  }
  const summarizePromptText = (value: string) => {
    const normalized = value.replace(/\s+/g, ' ').trim()
    if (!normalized) return ''
    const limit = 80
    if (normalized.length <= limit) return normalized
    return `${normalized.slice(0, limit)}…（${normalized.length}字）`
  }
  const summarizeArrayPreview = (arr: any[], depth: number) => {
    if (!arr.length) return ''
    if (depth > 1) return `[${arr.length} 项]`
    const preview = arr
      .slice(0, 3)
      .map(item => summarizePayload(item, depth + 1))
      .filter(Boolean)
    const suffix = arr.length > 3 ? `…+${arr.length - 3}` : ''
    return `[${preview.join(', ')}${suffix}]`
  }
  const summarizeField = (key: string, value: any, depth: number): string => {
    if (value == null) return ''
    if (PROMPT_FIELD_KEYS.has(key) && typeof value === 'string') {
      const snippet = summarizePromptText(value)
      return snippet ? `${key}=${snippet}` : ''
    }
    if (key === 'nodeIds' && Array.isArray(value)) {
      if (!value.length) return ''
      const preview = value.slice(0, 3).join(', ')
      const suffix = value.length > 3 ? `…+${value.length - 3}` : ''
      return `${key}=${preview}${suffix}`
    }
    if (key === 'position' && typeof value === 'object') {
      const coords: string[] = []
      if (typeof value.x === 'number') coords.push(`x:${Math.round(value.x)}`)
      if (typeof value.y === 'number') coords.push(`y:${Math.round(value.y)}`)
      return coords.length ? `${key}=${coords.join(', ')}` : ''
    }
    const summarized = summarizePayload(value, depth)
    return summarized ? `${key}=${summarized}` : ''
  }
  const summarizeRecord = (record: Record<string, any>, depth: number): string => {
    if (!record || depth > MAX_SUMMARY_DEPTH) return ''
    if (typeof record.success === 'boolean') {
      const state = record.success ? '成功' : '失败'
      const details: string[] = []
      if (record.success && record.data) {
        const dataText = summarizePayload(record.data, depth + 1)
        if (dataText) details.push(dataText)
      }
      if (!record.success) {
        if (record.error) {
          const errorText = summarizePayload(record.error, depth + 1)
          if (errorText) details.push(errorText)
        }
        if (record.data) {
          const fallback = summarizePayload(record.data, depth + 1)
          if (fallback) details.push(fallback)
        }
      }
      return [state, ...details].filter(Boolean).join(' · ')
    }
    const message = typeof record.message === 'string' ? truncateText(record.message, 140) : ''
    const prioritizedKeys = ['action', 'type', 'label', 'nodeId', 'nodeIds', 'sourceNodeId', 'targetNodeId', 'sourceHandle', 'targetHandle', 'layoutType', 'status', 'count', 'remixFromNodeId', 'position']
    const used = new Set<string>()
    const fields: string[] = []
    prioritizedKeys.forEach(key => {
      if (!(key in record)) return
      const text = summarizeField(key, record[key], depth + 1)
      if (text) {
        used.add(key)
        fields.push(text)
      }
    })
    const extraEntries = Object.entries(record)
      .filter(([key]) => key !== 'message' && key !== 'success' && key !== 'data' && key !== 'error' && !used.has(key))
      .slice(0, 3)
      .map(([key, value]) => summarizeField(key, value, depth + 1))
      .filter(Boolean)
    const combined = [message, ...fields, ...extraEntries].filter(Boolean)
    return combined.join(' · ')
  }
  function summarizePayload(payload: any, depth = 0): string {
    if (payload == null || depth > MAX_SUMMARY_DEPTH) return ''
    if (typeof payload === 'string') return truncateText(payload)
    if (typeof payload === 'number' || typeof payload === 'boolean') return String(payload)
    if (Array.isArray(payload)) return summarizeArrayPreview(payload, depth)
    if (typeof payload === 'object') {
      return summarizeRecord(payload as Record<string, any>, depth + 1)
    }
    return ''
  }

  const NODE_KIND_LABELS: Record<string, string> = {
    text: '文本',
    image: '图像',
    video: '视频',
    composevideo: '视频',
    composeVideo: '视频',
    storyboard: '分镜',
    audio: '音频',
    subtitle: '字幕',
    character: '角色',
    texttoimage: '图像',
    imagetext: '图像',
  }
  const TOOL_LABELS: Record<string, string> = {
    createNode: '创建节点',
    updateNode: '更新节点',
    deleteNode: '删除节点',
    connectNodes: '连接节点',
    disconnectNodes: '断开连接',
    autoLayout: '应用布局',
    runNode: '运行节点',
    runDag: '运行工作流',
    formatAll: '整理画布',
    getNodes: '查看节点',
    findNodes: '查找节点',
    'canvas.node.operation': '节点操作',
    'canvas.connection.operation': '连接操作',
    'canvas.layout.apply': '布局调整',
    'canvas.optimization.analyze': '画布优化',
    'canvas.view.navigate': '视图定位',
    'project.operation': '项目操作',
    'ai.plan.update': '计划同步',
    'ai.thinking.process': '推理分析',
  }
  const NODE_OPERATION_ACTION_LABELS: Record<string, string> = {
    create: '创建节点',
    update: '更新节点',
    delete: '删除节点',
    duplicate: '复制节点',
  }
  const CONNECTION_ACTION_LABELS: Record<string, string> = {
    connect: '连接节点',
    disconnect: '断开连接',
    reconnect: '调整连接',
  }
  const LAYOUT_LABELS: Record<string, string> = {
    grid: '宫格布局',
    horizontal: '水平布局',
    hierarchical: '层级布局',
  }
  const describeNodeSelection = (payload: Record<string, any> = {}) => {
    if (Array.isArray(payload.nodeIds) && payload.nodeIds.length) {
      const preview = payload.nodeIds.slice(0, 2).join('、')
      const suffix = payload.nodeIds.length > 2 ? `…等${payload.nodeIds.length}个` : ''
      return `节点 ${preview}${suffix}`
    }
    const label =
      typeof payload.label === 'string' ? payload.label :
      typeof payload.config?.label === 'string' ? payload.config.label :
      typeof payload.config?.title === 'string' ? payload.config.title :
      ''
    const nodeId = typeof payload.nodeId === 'string' ? payload.nodeId : ''
    const kindValue = payload.config?.kind || payload.kind || payload.type
    const kindLabel = typeof kindValue === 'string' ? NODE_KIND_LABELS[kindValue.toLowerCase()] : ''
    const parts: string[] = []
    if (label) parts.push(`「${label}」`)
    if (!label && nodeId) parts.push(`节点 ${nodeId}`)
    if (kindLabel) parts.push(kindLabel)
    return parts.join(' · ')
  }
  const describeConnection = (payload: Record<string, any> = {}) => {
    if (Array.isArray(payload.connections) && payload.connections.length) {
      return `${payload.connections.length} 条连接`
    }
    const source =
      typeof payload.sourceNodeId === 'string' ? payload.sourceNodeId :
      typeof payload.source === 'string' ? payload.source :
      ''
    const target =
      typeof payload.targetNodeId === 'string' ? payload.targetNodeId :
      typeof payload.target === 'string' ? payload.target :
      ''
    if (source && target) return `${source} → ${target}`
    return source || target || ''
  }
  const describeLayout = (payload: Record<string, any> = {}) => {
    const layout = typeof payload.layoutType === 'string'
      ? payload.layoutType
      : typeof payload.layout === 'string'
        ? payload.layout
        : ''
    if (!layout) return ''
    const normalized = layout.toLowerCase()
    return LAYOUT_LABELS[normalized] || layout
  }
  const getBaseToolLabel = (toolName: string, payload: Record<string, any>) => {
    if (toolName === 'canvas.node.operation') {
      const action = typeof payload.action === 'string' ? payload.action : ''
      return NODE_OPERATION_ACTION_LABELS[action] || TOOL_LABELS[toolName] || '画布操作'
    }
    if (toolName === 'canvas.connection.operation') {
      const action = typeof payload.action === 'string' ? payload.action : ''
      return CONNECTION_ACTION_LABELS[action] || TOOL_LABELS[toolName] || '连接操作'
    }
    return TOOL_LABELS[toolName] || '画布操作'
  }
  const buildActionLabel = useCallback((toolName?: string, input?: any) => {
    const normalizedTool = typeof toolName === 'string' ? toolName : ''
    const payload = input && typeof input === 'object' ? input : {}
    const baseLabel = getBaseToolLabel(normalizedTool, payload)
    let detail = ''
    if (normalizedTool === 'createNode' || normalizedTool === 'updateNode' || normalizedTool === 'deleteNode' || normalizedTool === 'runNode' || normalizedTool === 'canvas.node.operation') {
      detail = describeNodeSelection(payload)
    } else if (normalizedTool === 'connectNodes' || normalizedTool === 'disconnectNodes' || normalizedTool === 'canvas.connection.operation') {
      detail = describeConnection(payload)
    } else if (normalizedTool === 'autoLayout' || normalizedTool === 'canvas.layout.apply') {
      detail = describeLayout(payload)
      if (detail) {
        detail = `应用${detail}`
      }
    } else if (normalizedTool === 'runDag') {
      const concurrency = typeof payload.concurrency === 'number' ? payload.concurrency : null
      detail = concurrency ? `并发 ${concurrency}` : '全局执行'
    } else if (normalizedTool === 'formatAll') {
      detail = '整理当前画布'
    } else if (normalizedTool === 'project.operation') {
      detail = typeof payload.action === 'string' ? payload.action : ''
    } else if (!normalizedTool && payload) {
      detail = describeNodeSelection(payload)
    }
    const text = detail
      ? `${baseLabel}：${detail}`
      : baseLabel
    return toSingleLine(text) || '画布操作'
  }, [])
  const ACTION_STATUS_IGNORED_TOOLS = new Set(['ai.plan.update', 'ai.thinking.process'])
  const [input, setInput] = useState('')
  const isLoading = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    if (!isLoading) {
      const allStepsCompleted = planUpdate?.steps?.length
        ? planUpdate.steps.every(step => step.status === 'completed')
        : false
      if (allStepsCompleted || !planUpdate) {
        setIsThinking(false)
      }
    }
  }, [isLoading, planUpdate])

  useEffect(() => {
    if (!isThinking && !isLoading && statusPhase !== 'success') {
      setStatusPhase('idle')
      setStatusLine('随时描述新的场景，我会继续协助。')
    }
  }, [isThinking, isLoading, statusPhase, setStatusLine])

  const reportToolResult = useCallback(async (payload: { toolCallId: string; toolName: string; output?: any; errorText?: string }) => {
    try {
      const token = getAuthToken()
      await fetch(`${apiRoot}/ai/tools/result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })
    } catch (err) {
      console.warn('[UseChatAssistant] report tool result failed', err)
    }
  }, [apiRoot])

  const runToolHandler = useCallback(async (call: { toolCallId?: string; toolName?: string; input?: any }) => {
    const toolName = call.toolName
    if (!toolName) {
      console.warn('[UseChatAssistant] tool call missing name', call)
      return { errorText: '未提供工具名称' }
    }
    const handler = (functionHandlers as any)[toolName]
    if (!handler) {
      console.warn('[UseChatAssistant] handler not found', toolName)
      return { errorText: `未找到工具：${toolName}` }
    }
    if (AI_DEBUG_LOGS_ENABLED) {
      console.debug('[UseChatAssistant] executing tool', { toolName, toolCallId: call.toolCallId, input: call.input })
    }
    try {
      const result = await handler(call.input || {})
      if (AI_DEBUG_LOGS_ENABLED) {
        console.debug('[UseChatAssistant] tool completed', { toolName, toolCallId: call.toolCallId, result })
      }
      return { output: result }
    } catch (err) {
      console.error('[UseChatAssistant] tool failed', toolName, err)
      return { errorText: err instanceof Error ? err.message : '工具执行失败' }
    }
  }, [])

  const stringifyMessage = (msg: UIMessage) => {
    const describeToolState = (part: any) => {
      const rawToolName = resolveToolName(part)
      const friendlyLabel = buildActionLabel(rawToolName, part.input ?? part.arguments ?? part.params ?? part.data)
      const toolName = friendlyLabel || '画布操作'
      if (part.state === 'output-error') {
        const errorText = typeof part.errorText === 'string' && part.errorText.trim()
          ? `：${part.errorText.trim()}`
          : ''
        return `⚠️ ${toolName} · 执行失败${errorText}`
      }

      if (part.type === 'tool-result' || (part.state === 'output-available' && !part.preliminary)) {
        return `✅ ${toolName} · 执行完成`
      }

      if (part.state === 'input-streaming' || part.type === 'tool-call') {
        return `🛠 ${toolName} · 正在整理参数`
      }

      if (part.state === 'input-available' || part.type === 'tool-input-available') {
        return `🛠 ${toolName} · 参数已就绪，准备执行`
      }

      if (part.state === 'output-available' && part.preliminary) {
        return `🛠 ${toolName} · 正在生成结果`
      }

      return `🛠 ${toolName} · 执行中…`
    }

    const lines: string[] = []
    const toolLineIndex = new Map<string, number>()
    const pushOrUpdateLine = (key: string | undefined, text: string) => {
      if (!text) return
      if (key && toolLineIndex.has(key)) {
        const index = toolLineIndex.get(key)
        if (typeof index === 'number') {
          lines[index] = text
          return
        }
      }
      const index = lines.length
      lines.push(text)
      if (key) {
        toolLineIndex.set(key, index)
      }
    }

    msg.parts.forEach((part: any) => {
      if (part.type === 'text') {
        if (part.text) {
          lines.push(part.text)
        }
        return
      }
      if (part.type === 'reasoning') {
        if (part.text) {
          lines.push(part.text)
        }
        return
      }
      if (part.type === 'data') {
        if (part.data != null) {
          const text = typeof part.data === 'string' ? part.data : JSON.stringify(part.data)
          lines.push(text)
        }
        return
      }
      const isToolPart = part.type === 'tool-result' || isToolCallPart(part)
      if (isToolPart) {
        const summary = describeToolState(part)
        const key = part.toolCallId || part.id || (resolveToolName(part) ? `tool-${resolveToolName(part)}` : undefined)
        const detailLines: string[] = []
        if (isToolCallPart(part)) {
          const args = part.input ?? part.arguments ?? part.params ?? part.data
          const argText = summarizePayload(args)
          if (argText) {
            detailLines.push(`参数：${argText}`)
          }
        }
        if ((part.type === 'tool-result' || part.state === 'output-available') && part.output) {
          const outputText = summarizePayload(part.output)
          if (outputText) {
            detailLines.push(`结果：${outputText}`)
          }
        }
        const text = detailLines.length ? `${summary}\n${detailLines.join('\n')}` : summary
        pushOrUpdateLine(key, text)
      }
    })

    return lines.filter(Boolean).join('\n')
  }

  const renderRoleLabel = (role?: string) => {
    if (role === 'user') return '你'
    if (role === 'assistant') return 'Nano Banana Pro'
    if (role === 'system') return '系统'
    return role || '消息'
  }
  const removeImagePromptAttachment = useCallback((attachmentId: string) => {
    setImagePromptAttachments(prev => prev.filter(att => att.id !== attachmentId))
    setActivePromptAttachmentId(prev => (prev === attachmentId ? null : prev))
  }, [])

  const handleImagePromptUpload = useCallback(async (files: FileList | File[]) => {
    if (!isGptModel) {
      toast('仅 GPT 模型支持图片提示词', 'error')
      return
    }
    if (imagePromptAttachments.length >= MAX_IMAGE_PROMPT_ATTACHMENTS) {
      toast(`一次最多上传 ${MAX_IMAGE_PROMPT_ATTACHMENTS} 张图片`, 'error')
      return
    }
    const availableSlots = MAX_IMAGE_PROMPT_ATTACHMENTS - imagePromptAttachments.length
    const normalizedFiles = normalizeFileList(files)
    const sanitizedFiles = normalizedFiles.slice(0, availableSlots)
    if (!sanitizedFiles.length) {
      toast(`一次最多上传 ${MAX_IMAGE_PROMPT_ATTACHMENTS} 张图片`, 'error')
      return
    }
    if (normalizedFiles.length > sanitizedFiles.length) {
      toast(`一次最多上传 ${MAX_IMAGE_PROMPT_ATTACHMENTS} 张图片，多余的图片已被忽略`, 'info')
    }
    const processFile = async (file: File) => {
      setImagePromptLoadingCount(count => count + 1)
      try {
        const dataUrl = await fileToDataUrl(file)
        const attachmentId = nanoid()
        setImagePromptAttachments(prev => [...prev, { id: attachmentId, preview: dataUrl, prompt: '', ready: false }])
        setActivePromptAttachmentId(null)
        try {
          const task = await runTaskByVendor('openai', {
            kind: 'image_to_prompt',
            prompt: DEFAULT_REVERSE_PROMPT_INSTRUCTION,
            extras: { imageData: dataUrl },
          })
          const nextPrompt = extractTextFromTaskResult(task)
          if (nextPrompt) {
            setImagePromptAttachments(prev => prev.map(att => att.id === attachmentId ? { ...att, prompt: nextPrompt, ready: true } : att))
            toast('已根据图片生成提示词，发送时将自动附带', 'success')
          } else {
            removeImagePromptAttachment(attachmentId)
            toast('模型未返回提示词，请稍后再试', 'error')
          }
        } catch (error) {
          removeImagePromptAttachment(attachmentId)
          const message = error instanceof Error ? error.message : '解析图片失败'
          toast(message, 'error')
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '解析图片失败'
        toast(message, 'error')
      } finally {
        setImagePromptLoadingCount(count => Math.max(0, count - 1))
      }
    }
    await Promise.all(sanitizedFiles.map(file => processFile(file)))
  }, [imagePromptAttachments.length, isGptModel, removeImagePromptAttachment])

  const handleImagePromptChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files
    if (!files || files.length === 0) return
    const clonedFiles = normalizeFileList(files)
    event.currentTarget.value = ''
    if (clonedFiles.length > 0) {
      void handleImagePromptUpload(clonedFiles)
    }
  }, [handleImagePromptUpload])

  const handleImagePromptButtonClick = useCallback(() => {
    if (!isGptModel) {
      toast('仅 GPT 模型支持图片提示词', 'error')
      return
    }
    if (imagePromptAttachments.length >= MAX_IMAGE_PROMPT_ATTACHMENTS) {
      toast(`一次最多上传 ${MAX_IMAGE_PROMPT_ATTACHMENTS} 张图片`, 'error')
      return
    }
    imagePromptInputRef.current?.click()
  }, [imagePromptAttachments.length, isGptModel])

  const onSubmit = (e?: any) => {
    if (e?.preventDefault) e.preventDefault()
    const trimmed = input.trim()
    const attachmentPrompts = imagePromptAttachments
      .map((attachment, index) => {
        const prompt = attachment.prompt?.trim()
        if (!prompt) return null
        const label = imagePromptAttachments.length > 1 ? `【图片提示${index + 1}】` : '【图片提示】'
        return `${label}${prompt}`
      })
      .filter(Boolean) as string[]
    if (!trimmed && attachmentPrompts.length === 0) return
    const pieces: string[] = []
    if (trimmed) pieces.push(trimmed)
    pieces.push(...attachmentPrompts)
    sendMessage({ text: pieces.join('\n\n') })
    setInput('')
    setImagePromptAttachments([])
    setActivePromptAttachmentId(null)
    setThinkingEvents([])
    setPlanUpdate(null)
    setIsThinking(true)
    setStatusPhase('thinking')
    setStatusLine('🧠 正在拆解你的请求并规划 Aurora 计划。')
  }

  useEffect(() => {
    const toolCalls = messages.flatMap(msg =>
      (msg.parts || [])
        .filter((part: any) => isToolCallPart(part))
        .map((part: any) => {
          const parsedInput = parseJsonIfNeeded(part.input ?? part.arguments ?? {})
          const hasPayload = parsedInput && typeof parsedInput === 'object' && Object.keys(parsedInput).length > 0
          const ready = part.state === 'input-available' || part.type === 'tool-input-available' || hasPayload
          const toolCallId = typeof part.toolCallId === 'string' && part.toolCallId.trim() ? part.toolCallId.trim() : undefined
          const toolName = resolveToolName(part)
          if (!ready || !toolCallId || !toolName) return null
          return {
            toolCallId,
            toolName,
            input: parsedInput
          }
        })
        .filter(Boolean)
    )
    if (AI_DEBUG_LOGS_ENABLED && toolCalls.length) {
      console.debug('[UseChatAssistant] detected tool calls', toolCalls)
    }
    toolCalls.forEach(async (call) => {
      if (!call.toolCallId || handledToolCalls.current.has(call.toolCallId)) return
      handledToolCalls.current.add(call.toolCallId)
      if (!ACTION_STATUS_IGNORED_TOOLS.has(call.toolName)) {
        const actionLabel = buildActionLabel(call.toolName, call.input)
        if (actionLabel) {
          actionStatusByCallId.current.set(call.toolCallId, actionLabel)
          updateActionStatus(actionLabel, 'running')
        }
      }
      const { output, errorText } = await runToolHandler(call)
      if (errorText) {
        await addToolResult({ state: 'output-error', tool: call.toolName as any, toolCallId: call.toolCallId, errorText })
      } else {
        await addToolResult({ state: 'output-available', tool: call.toolName as any, toolCallId: call.toolCallId, output: output as any })
      }
      if (!ACTION_STATUS_IGNORED_TOOLS.has(call.toolName)) {
        const actionLabel = actionStatusByCallId.current.get(call.toolCallId) || buildActionLabel(call.toolName, call.input)
        if (actionLabel) {
          updateActionStatus(actionLabel, errorText ? 'error' : 'success', errorText)
          actionStatusByCallId.current.delete(call.toolCallId)
        }
      }
      await reportToolResult({ toolCallId: call.toolCallId, toolName: call.toolName, output, errorText })
    })
  }, [messages, addToolResult, runToolHandler, reportToolResult, buildActionLabel, updateActionStatus])

  useEffect(() => {
    const token = getAuthToken()
    if (!token) return
    const unsubscribe = subscribeToolEvents({
      url: `${apiRoot}/ai/tool-events`,
      token,
      onEvent: async (event: ToolEventMessage) => {
        if (event.type === 'tool-call') {
          if (!event.toolCallId || handledToolCalls.current.has(event.toolCallId)) return
          handledToolCalls.current.add(event.toolCallId)
          const toolName = event.toolName
          if (!toolName) {
            console.warn('[UseChatAssistant] tool-call missing name from stream', event)
            await reportToolResult({ toolCallId: event.toolCallId, toolName: 'unknown', errorText: '未提供工具名称' })
            return
          }
          const normalizedInput = parseJsonIfNeeded(event.input)
          if (!ACTION_STATUS_IGNORED_TOOLS.has(toolName)) {
            const actionLabel = buildActionLabel(toolName, normalizedInput)
            if (actionLabel) {
              actionStatusByCallId.current.set(event.toolCallId, actionLabel)
              updateActionStatus(actionLabel, 'running')
            }
          }
          const { output, errorText } = await runToolHandler({ ...event, toolName, input: normalizedInput })
          if (!ACTION_STATUS_IGNORED_TOOLS.has(toolName)) {
            const actionLabel = actionStatusByCallId.current.get(event.toolCallId)
            if (actionLabel) {
              updateActionStatus(actionLabel, errorText ? 'error' : 'success', errorText)
              actionStatusByCallId.current.delete(event.toolCallId)
            }
          }
          await reportToolResult({ toolCallId: event.toolCallId, toolName, output, errorText })
          return
        }

        if (event.type === 'tool-result') {
          if (!ACTION_STATUS_IGNORED_TOOLS.has(event.toolName) && event.toolCallId) {
            const storedAction = actionStatusByCallId.current.get(event.toolCallId)
            if (storedAction) {
              updateActionStatus(storedAction, event.errorText ? 'error' : 'success', event.errorText)
              actionStatusByCallId.current.delete(event.toolCallId)
            }
          }
          const thinking = extractThinkingEvent(event)
          if (thinking) {
            setThinkingEvents(prev => [...prev, thinking])
            setIsThinking(true)
            setStatusPhase('thinking')
            setStatusLine(thinking.content || 'AI 正在推演下一步动作。')
            return
          }

          const planPayload = extractPlanUpdate(event)
          if (planPayload) {
            setPlanUpdate(planPayload)
            const done = planPayload.steps.every(step => step.status === 'completed')
            if (done) {
              setIsThinking(false)
              setStatusPhase('success')
              setStatusLine('✅ Aurora 计划执行完成，画布已更新。')
            } else {
              setStatusPhase('thinking')
              setStatusLine(planPayload.explanation || '正在展开 Aurora 计划...')
            }
          }
        }
      }
    })
    return () => {
      unsubscribe()
    }
  }, [apiRoot, runToolHandler, reportToolResult, buildActionLabel, updateActionStatus])

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

  const uploadTooltipLabel = !isGptModel
    ? '仅 GPT 模型支持图片提示词'
    : imagePromptAttachments.length >= MAX_IMAGE_PROMPT_ATTACHMENTS
      ? `一次最多上传 ${MAX_IMAGE_PROMPT_ATTACHMENTS} 张图片`
      : '上传图片生成提示词'

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
          background: panelBackground,
          border: panelBorder,
          boxShadow: panelShadow,
          overflow: 'hidden',
          backdropFilter: 'blur(18px)',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <Box
          px="lg"
          py="md"
          style={{ borderBottom: headerBorder, background: headerBackground, flexShrink: 0 }}
        >
          <Group justify="space-between" align="center">
            <Group gap="sm">
              <IconSparkles size={14} color={sparklesColor} />
            </Group>
            <Group gap="xs">
              <Select
                size="xs"
                value={model}
                onChange={(value) => value && setModel(value)}
                data={assistantModelOptions.map(option => ({ value: option.value, label: option.label }))}
                aria-label="选择模型"
                withinPortal
              />
              <Tooltip label="关闭">
                <ActionIcon
                  variant="subtle"
                  color={isDarkUi ? 'gray' : 'dark'}
                  onClick={onClose}
                  styles={{
                    root: {
                      color: closeIconColor
                    }
                  }}
                >
                  <IconX size={14} color={closeIconColor} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
        </Box>

        <Box
          px="lg"
          py="sm"
          style={{ flexShrink: 0 }}
        >
          <Paper
            p="md"
            radius="xl"
            style={{
              background: statusGradients[statusPhase],
              border: headerBorder,
              color: headerTextColor
            }}
          >
            <Group align="flex-start" justify="space-between" gap="lg">
              <Stack gap={4} style={{ flex: 1 }}>
                <Group gap="xs">
                  <IconBrain size={18} color={auroraAccent} />
                  <Text fw={600} fz="sm" c={headerTextColor}>场景状态</Text>
                  <Badge size="xs" variant="light" color={statusBadgeColor[statusPhase]}>
                    {statusBadgeText[statusPhase]}
                  </Badge>
                  {intelligentMode && (
                    <Badge size="xs" variant="outline" color="violet">
                      智能工具
                    </Badge>
                  )}
                </Group>
                <Text size="sm" c={headerTextColor} style={{ opacity: 0.85 }}>
                  {statusNote}
                </Text>
                <Group gap="xs">
                  <Badge size="xs" variant="light" color={streamingBadgeColor}>
                    {streamingBadgeLabel}
                  </Badge>
                  {planUpdate?.summary?.strategy && (
                    <Badge size="xs" variant="light" color="blue">
                      {planUpdate.summary.strategy}
                    </Badge>
                  )}
                </Group>
              </Stack>
              <RingProgress
                size={96}
                thickness={10}
                sections={[{ value: planCompletion, color: auroraCyan }]}
                label={
                  <Stack gap={0} align="center">
                    <Text size="xs" c={headerTextColor}>进度</Text>
                    <Text size="lg" fw={600} c={headerTextColor}>{planCompletion}%</Text>
                  </Stack>
                }
              />
            </Group>
          </Paper>
        </Box>

        <Box
          px="lg"
          py="md"
          style={{ flex: 1, minHeight: 0 }}
        >
          <Box
            style={{
              height: '100%',
              background: logBackground,
              borderRadius: 18,
              border: logBorder,
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            <ScrollArea style={{ height: '100%' }} type="auto">
              <Stack gap="sm" style={{ padding: 24, paddingBottom: 24 + conversationOverlayOffset }}>
                {(thinkingEvents.length > 0 || isThinking) && (
                  <ThinkingProcess events={thinkingEvents} isProcessing={isThinking} maxHeight={180} />
                )}

                {planUpdate && planUpdate.steps.length > 0 && (
                  <ExecutionPlanDisplay plan={planUpdate} />
                )}

                {messages.map(msg => (
                  <Box key={msg.id} style={{ background: messageBackground, borderRadius: 8, padding: 10, border: messageBorder }}>
                    <Text c="dimmed" size="xs">{renderRoleLabel(msg.role)}</Text>
                    <Text size="sm" c={messageTextColor} style={{ whiteSpace: 'pre-wrap' }}>{stringifyMessage(msg)}</Text>
                  </Box>
                ))}
                {messages.length === 0 && (
                  <Text size="sm" c="dimmed">描述你想要的氛围或分镜，我将流式规划 Aurora 计划并同步动作。</Text>
                )}
              </Stack>
            </ScrollArea>

            <input
              ref={imagePromptInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleImagePromptChange}
            />
            <form
              onSubmit={onSubmit}
              style={{ position: 'absolute', left: 24, right: 24, bottom: 24 }}
            >
              <Stack gap="xs">
                <Box style={{ position: 'relative' }}>
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
                    styles={{
                      input: {
                        background: inputBackground,
                        borderColor: inputBorder,
                        color: inputColor,
                        paddingRight: 180,
                        paddingBottom: 48
                      }
                    }}
                  />
                  <Group gap="xs" style={{ position: 'absolute', bottom: 12, right: 12 }}>
                    <Tooltip label={uploadTooltipLabel}>
                      <ActionIcon
                        variant="light"
                        color="teal"
                        onClick={handleImagePromptButtonClick}
                        disabled={imagePromptLoading || !isGptModel || imagePromptAttachments.length >= MAX_IMAGE_PROMPT_ATTACHMENTS}
                      >
                        {imagePromptLoading ? <Loader size="xs" /> : <IconPhoto size={16} />}
                      </ActionIcon>
                    </Tooltip>
                    <Button
                      type="submit"
                      loading={isLoading}
                      leftSection={<IconSend size={16} />}
                      style={{ minWidth: 120 }}
                    >
                      发送
                    </Button>
                  </Group>
                </Box>
                {imagePromptAttachments.length > 0 && (
                  <Stack gap="sm">
                    {imagePromptAttachments.map((attachment, index) => (
                      <Group key={attachment.id} gap="sm" align="center" wrap="nowrap">
                        <Box
                          style={{
                            position: 'relative',
                            width: 90,
                            height: 90,
                            borderRadius: 8,
                            overflow: 'hidden',
                            border: messageBorder,
                            flex: '0 0 auto',
                          }}
                        >
                          <Box
                            component="img"
                            src={attachment.preview}
                            alt={`prompt preview ${index + 1}`}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                          <ActionIcon
                            size="xs"
                            variant="filled"
                            color="dark"
                            radius="xl"
                            onClick={() => removeImagePromptAttachment(attachment.id)}
                            style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.55)' }}
                          >
                            <IconX size={12} />
                          </ActionIcon>
                        </Box>
                        <Stack gap={4} style={{ flex: 1 }}>
                          <Group gap={6}>
                            <Text size="xs" c="dimmed">
                              图片提示词{imagePromptAttachments.length > 1 ? ` #${index + 1}` : ''}
                            </Text>
                            <Badge size="xs" variant="light" color={attachment.ready ? 'green' : 'gray'}>
                              {attachment.ready ? '已生成' : '生成中'}
                            </Badge>
                          </Group>
                          <ScrollArea.Autosize mah={90} type="hover">
                            <Text size="sm" c={messageTextColor} style={{ whiteSpace: 'pre-wrap' }}>
                              {attachment.prompt || '正在生成提示词…'}
                            </Text>
                          </ScrollArea.Autosize>
                          <Group gap="xs">
                            <Tooltip label={attachment.ready ? '查看图片与提示词详情' : '提示词生成中'}>
                              <ActionIcon
                                variant="light"
                                color="violet"
                                size="sm"
                                disabled={!attachment.ready}
                                onClick={() => attachment.ready && setActivePromptAttachmentId(attachment.id)}
                              >
                                <IconEye size={14} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label="复制提示词">
                              <CopyButton value={attachment.prompt || ''}>
                                {({ copy }) => (
                                  <ActionIcon
                                    variant="light"
                                    color="gray"
                                    size="sm"
                                    disabled={!attachment.prompt}
                                    onClick={copy}
                                  >
                                    <IconBulb size={14} />
                                  </ActionIcon>
                                )}
                              </CopyButton>
                            </Tooltip>
                            <Text size="xs" c="dimmed">发送时将附带</Text>
                          </Group>
                        </Stack>
                      </Group>
                    ))}
                  </Stack>
                )}
              </Stack>
            </form>
          </Box>
        </Box>
        <Modal
          opened={!!activePromptAttachment}
          onClose={() => setActivePromptAttachmentId(null)}
          title="图片提示词详情"
          centered
          size="lg"
        >
          {activePromptAttachment && (
            <Stack>
              <Box
                component="img"
                src={activePromptAttachment.preview}
                alt="attachment preview"
                style={{ width: '100%', borderRadius: 12, objectFit: 'contain', maxHeight: 320 }}
              />
              <Divider my="xs" />
              <Group justify="space-between" align="center">
                <Text size="sm" fw={600}>生成的提示词</Text>
                <CopyButton value={activePromptAttachment.prompt || ''}>
                  {({ copy }) => (
                    <Button size="xs" variant="light" onClick={copy}>复制提示词</Button>
                  )}
                </CopyButton>
              </Group>
              <ScrollArea h={180}>
                <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{activePromptAttachment.prompt || '暂无内容'}</Text>
              </ScrollArea>
            </Stack>
          )}
        </Modal>
      </Paper>
    </Box>
  )
}

export default UseChatAssistant
