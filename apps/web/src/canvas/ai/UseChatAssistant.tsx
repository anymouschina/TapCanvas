import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { UIMessage, useChat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import { nanoid } from 'nanoid'
import { ActionIcon, Badge, Box, Button, CopyButton, Divider, Group, Loader, Modal, Paper, Popover, ScrollArea, Select, Stack, Text, Textarea, Tooltip } from '@mantine/core'
import { IconX, IconSparkles, IconSend, IconPhoto, IconBulb, IconEye, IconMicrophone, IconMoodSmile, IconPlus, IconHistory, IconWorld, IconWorldOff } from '@tabler/icons-react'
import { getDefaultModel, getModelProvider, type ModelOption } from '../../config/models'
import { useModelOptions } from '../../config/useModelOptions'
import { useRFStore } from '../store'
import { getAuthToken } from '../../auth/store'
import { functionHandlers } from '../../ai/canvasService'
import { subscribeToolEvents, type ToolEventMessage, extractThinkingEvent, extractPlanUpdate } from '../../api/toolEvents'
import {
  runTaskByVendor,
  type TaskResultDto,
  listAvailableModels,
  listChatSessions as listServerChatSessions,
  getChatHistory as getServerChatHistory,
  renameChatSession as renameServerChatSession,
  deleteChatSession as deleteServerChatSession,
  type ChatHistoryMessageDto,
} from '../../api/server'
import { toast } from '../../ui/toast'
import { DEFAULT_REVERSE_PROMPT_INSTRUCTION } from '../constants'
import type { ThinkingEvent, PlanUpdatePayload } from '../../types/canvas-intelligence'
import { buildCanvasContext } from '../utils/buildCanvasContext'

interface UseChatAssistantProps {
  opened?: boolean
  onClose?: () => void
  intelligentMode?: boolean
}

const OPENAI_DEFAULT_MODEL = 'gpt-5.2'
const ASSISTANT_MODEL_PRESETS: ModelOption[] = [
  { value: 'gpt-5.2', label: 'GPT-5.2' },
  { value: 'gpt-5.1', label: 'GPT-5.1' },
  { value: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
]
const ASSISTANT_MODEL_SET = new Set(ASSISTANT_MODEL_PRESETS.map(option => option.value))
const MAX_IMAGE_PROMPT_ATTACHMENTS = 2
const AI_DEBUG_LOGS_ENABLED = (import.meta as any).env?.VITE_DEBUG_AI_LOGS === 'true'

interface AssistantSession {
  id: string
  title: string
  messages: UIMessage[]
}

const createEmptyAssistantSession = (label: string): AssistantSession => ({
  id: nanoid(),
  title: label,
  messages: [],
})

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
    const remote = await listAvailableModels('openai').catch(() => [])
    if (!Array.isArray(remote) || !remote.length) return []
    return remote
      .map((item: any) => {
        const value = typeof item?.value === 'string' ? item.value : typeof item?.id === 'string' ? item.id : null
        if (!value) return null
        if (!value.toLowerCase().includes('gpt')) return null
        const label = typeof item?.label === 'string' && item.label.trim() ? item.label.trim() : value
        const vendor = typeof item?.vendor === 'string' ? item.vendor : 'openai'
        return { value, label, vendor }
      })
      .filter(Boolean) as ModelOption[]
  } catch (error) {
    console.warn('[UseChatAssistant] failed to load available GPT models', error)
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
export function UseChatAssistant({ intelligentMode = true }: UseChatAssistantProps) {
  const nodes = useRFStore(state => state.nodes)
  const edges = useRFStore(state => state.edges)
  const [model, setModel] = useState(() => OPENAI_DEFAULT_MODEL || getDefaultModel('text'))
  const userSelectedModelRef = useRef(false)
  const handleModelChange = (value: string | null) => {
    if (!value) return
    userSelectedModelRef.current = true
    setModel(value)
  }
  const textModelOptions = useModelOptions('text')
  const [codexModels, setCodexModels] = useState<ModelOption[]>([])
  const fallbackAssistantOptions = useMemo(() => buildAssistantBaseOptions(textModelOptions), [textModelOptions])
  const gptTextOptions = useMemo(() => filterGptOptions(textModelOptions), [textModelOptions])
  const assistantModelOptions = useMemo(() => {
    const primary = gptTextOptions.length ? gptTextOptions : fallbackAssistantOptions
    return mergeModelOptionLists(primary, codexModels)
  }, [gptTextOptions, fallbackAssistantOptions, codexModels])
  const apiBase =
    (import.meta as any).env?.VITE_API_STREAM_BASE ||
    (import.meta as any).env?.VITE_API_BASE ||
    'http://localhost:3000'
  const apiRoot = useMemo(() => apiBase.replace(/\/$/, ''), [apiBase])
  const panelBackground = 'radial-gradient(135% 160% at 50% 0%, rgba(36,52,104,0.45), rgba(5,7,15,0.98))'
  const panelBorder = 'none'
  const panelShadow = '0 45px 120px rgba(3,5,15,0.85)'
  const sparklesColor = '#a5b4fc'
  const logBackground = 'radial-gradient(80% 60% at 50% 0%, rgba(79,126,255,0.22), transparent), rgba(4,7,16,0.9)'
  const logBorder = 'none'
  const messageTextColor = '#f4f7ff'
  const inputBackground = 'rgba(8,12,24,0.9)'
  const inputBorder = 'none'
  const inputColor = '#f8fbff'
  const closeIconColor = '#d1d9ff'
  const userBubbleBackground = 'linear-gradient(135deg, rgba(61,123,255,0.95), rgba(101,232,255,0.95))'
  const userBubbleBorder = '1px solid rgba(255,255,255,0.18)'
  const assistantBubbleBackground = 'rgba(255,255,255,0.05)'
  const assistantBubbleBorder = '1px solid rgba(255,255,255,0.05)'
  const bubbleShadow = '0 24px 60px rgba(3,5,15,0.65)'
  const toolbarIconBackground = 'rgba(255,255,255,0.05)'
  const toolbarIconBorder = '1px solid rgba(255,255,255,0.08)'
  const glowingSendBackground = 'linear-gradient(135deg, #3d7eff, #6ae0ff)'
  const imagePromptInputRef = useRef<HTMLInputElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const [sessions, setSessions] = useState<AssistantSession[]>(() => [createEmptyAssistantSession('会话 1')])
  const [activeSessionId, setActiveSessionId] = useState<string>(() => (sessions[0]?.id ?? ''))
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
  const [enableWebSearch, setEnableWebSearch] = useState(true)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handlePointerDown = (event: MouseEvent) => {
      const container = rootRef.current
      if (!container) return
      const target = event.target as Node | null
      if (target && container.contains(target)) return
      setIsExpanded(false)
    }
    window.addEventListener('mousedown', handlePointerDown, true)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true)
    }
  }, [])

  useEffect(() => {
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
  }, [])

  useEffect(() => {
    if (!assistantModelOptions.length) return

    const hasDefault = assistantModelOptions.some(option => option.value === OPENAI_DEFAULT_MODEL)

    if (!userSelectedModelRef.current && hasDefault && model !== OPENAI_DEFAULT_MODEL) {
      setModel(OPENAI_DEFAULT_MODEL)
      return
    }

    if (!assistantModelOptions.find(option => option.value === model)) {
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
    enableWebSearch,
    sessionId: activeSessionId || undefined,
  }), [model, canvasContext, provider, intelligentMode, enableWebSearch, activeSessionId])

  const bodyRef = useRef(body)
  bodyRef.current = body

  const chatId = useMemo(() => 'canvas-assistant', [])

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
      const currentBody = bodyRef.current
      return {
        headers: {
          'Content-Type': 'application/json',
          ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {})
        },
        body: {
          ...currentBody,
          messages: serializedMessages,
        }
      }
    }
  }), [apiRoot])

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
  const handledToolCalls = useRef(new Set<string>())
  const resolveToolName = (part: any) => {
    if (part?.toolName) return part.toolName
    if (typeof part?.type === 'string' && part.type.startsWith('tool-')) {
      return part.type.slice('tool-'.length)
    }
    return undefined
  }

  const toUiMessageFromHistory = (msg: ChatHistoryMessageDto): UIMessage => {
    const baseParts = Array.isArray(msg.parts) && msg.parts.length
      ? msg.parts
      : msg.content
        ? [{ type: 'text', text: msg.content }]
        : []
    return {
      id: msg.id || nanoid(),
      role: (msg.role as any) || 'user',
      parts: baseParts,
      metadata: msg.metadata || {},
    } as UIMessage
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

  // 从服务端加载历史会话列表与首个会话的消息
  useEffect(() => {
    let canceled = false
    const loadSessions = async () => {
      try {
        const serverSessions = await listServerChatSessions().catch(() => [])
        if (canceled || !serverSessions.length) return
        const mapped: AssistantSession[] = serverSessions.map((item, index) => ({
          id: item.id,
          title: item.title || `会话 ${index + 1}`,
          messages: [],
        }))
        setSessions(mapped)
        const first = mapped[0]
        if (!first) return
        setActiveSessionId(first.id)
        const history = await getServerChatHistory(first.id).catch(() => null)
        if (canceled || !history) return
        const uiMessages = history.messages.map((m) => toUiMessageFromHistory(m))
        setSessions(prev =>
          prev.map(session =>
            session.id === first.id ? { ...session, messages: uiMessages } : session
          )
        )
        setMessages(uiMessages)
      } catch {
        // ignore loading errors for assistant history
      }
    }
    void loadSessions()
    return () => {
      canceled = true
    }
  }, [apiRoot, setMessages])

  // 每当当前会话的消息变化时，写回 sessions 中当前会话的快照
  useEffect(() => {
    if (!activeSessionId) return
    setSessions(prev =>
      prev.map(session =>
        session.id === activeSessionId
          ? { ...session, messages }
          : session
      )
    )
  }, [messages, activeSessionId])

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
    if (key === 'imageUrl' || key === 'imageUrls' || key === 'imageResults' || key === 'videoUrl' || key === 'videoUrls' || key === 'videoResults') {
      return ''
    }
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
    canvas_node_operation: '节点操作',
    canvas_connection_operation: '连接操作',
    canvas_layout_apply: '布局调整',
    canvas_optimization_analyze: '画布优化',
    canvas_view_navigate: '视图定位',
    project_operation: '项目操作',
    // legacy dotted tool names
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
    if (toolName === 'canvas_node_operation' || toolName === 'canvas.node.operation') {
      const action = typeof payload.action === 'string' ? payload.action : ''
      return NODE_OPERATION_ACTION_LABELS[action] || TOOL_LABELS[toolName] || '画布操作'
    }
    if (toolName === 'canvas_connection_operation' || toolName === 'canvas.connection.operation') {
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
    if (normalizedTool === 'createNode' || normalizedTool === 'updateNode' || normalizedTool === 'deleteNode' || normalizedTool === 'runNode' || normalizedTool === 'canvas_node_operation' || normalizedTool === 'canvas.node.operation') {
      detail = describeNodeSelection(payload)
    } else if (normalizedTool === 'connectNodes' || normalizedTool === 'disconnectNodes' || normalizedTool === 'canvas_connection_operation' || normalizedTool === 'canvas.connection.operation') {
      detail = describeConnection(payload)
    } else if (normalizedTool === 'autoLayout' || normalizedTool === 'canvas_layout_apply' || normalizedTool === 'canvas.layout.apply') {
      detail = describeLayout(payload)
      if (detail) {
        detail = `应用${detail}`
      }
    } else if (normalizedTool === 'runDag') {
      const concurrency = typeof payload.concurrency === 'number' ? payload.concurrency : null
      detail = concurrency ? `并发 ${concurrency}` : '全局执行'
    } else if (normalizedTool === 'formatAll') {
      detail = '整理当前画布'
    } else if (normalizedTool === 'project_operation' || normalizedTool === 'project.operation') {
      detail = typeof payload.action === 'string' ? payload.action : ''
    } else if (!normalizedTool && payload) {
      detail = describeNodeSelection(payload)
    }
    const text = detail
      ? `${baseLabel}：${detail}`
      : baseLabel
    return toSingleLine(text) || '画布操作'
  }, [])
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

    const textLines: string[] = []
    const toolLines: string[] = []
    const toolLineIndex = new Map<string, number>()
    const pushOrUpdateToolLine = (key: string | undefined, text: string) => {
      if (!text) return
      if (key && toolLineIndex.has(key)) {
        const index = toolLineIndex.get(key)
        if (typeof index === 'number') {
          toolLines[index] = text
          return
        }
      }
      const index = toolLines.length
      toolLines.push(text)
      if (key) {
        toolLineIndex.set(key, index)
      }
    }

    let hasUserText = false

    msg.parts.forEach((part: any) => {
      if (part.type === 'text') {
        if (part.text) {
          textLines.push(part.text)
          hasUserText = true
        }
        return
      }
      if (part.type === 'reasoning') {
        if (part.text) {
          textLines.push(part.text)
        }
        return
      }
      if (part.type === 'data') {
        if (part.data != null) {
          const text = typeof part.data === 'string' ? part.data : JSON.stringify(part.data)
          textLines.push(text)
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
        pushOrUpdateToolLine(key, text)
      }
    })

    if (hasUserText) {
      return textLines.filter(Boolean).join('\n')
    }

    return [...textLines, ...toolLines].filter(Boolean).join('\n')
  }

  const renderRoleLabel = (role?: string) => {
    if (role === 'user') return '你'
    if (role === 'assistant') return 'Aurora'
    if (role === 'system') return '系统'
    return role || '消息'
  }

  const extractMediaPreview = (msg: UIMessage): Array<{ type: 'image' | 'video'; url: string }> => {
    const previews: Array<{ type: 'image' | 'video'; url: string }> = []
    const seen = new Set<string>()
    const push = (type: 'image' | 'video', url: unknown) => {
      if (typeof url !== 'string') return
      const trimmed = url.trim()
      if (!trimmed) return
      const key = `${type}:${trimmed}`
      if (seen.has(key)) return
      seen.add(key)
      previews.push({ type, url: trimmed })
    }

    ;(msg.parts || []).forEach((part: any) => {
      if (!part || part.type !== 'tool-result') return
      const toolName = resolveToolName(part) || part.tool
      if (toolName !== 'runNode' && toolName !== 'canvas_node_operation' && toolName !== 'canvas.node.operation') return
      const output = part.output
      if (!output || typeof output !== 'object') return

      const base =
        typeof output.success === 'boolean' && output.data && typeof output.data === 'object'
          ? output.data
          : output

      if (!base || typeof base !== 'object') return

      // 图片结果：imageUrl + imageResults
      push('image', (base as any).imageUrl)
      const imageResults = Array.isArray((base as any).imageResults)
        ? (base as any).imageResults
        : []
      imageResults.forEach((img: any) => {
        if (!img) return
        push('image', img.url)
      })

      // 视频结果：videoUrl + videoResults（先仅用于占位，暂不内嵌播放）
      push('video', (base as any).videoUrl)
      const videoResults = Array.isArray((base as any).videoResults)
        ? (base as any).videoResults
        : []
      videoResults.forEach((v: any) => {
        if (!v) return
        push('video', v.url)
      })
    })

    return previews
  }

  const renderMessageBubble = (msg: UIMessage) => {
    const isUser = msg.role === 'user'
    const bubbleBackground = isUser ? userBubbleBackground : assistantBubbleBackground
    const bubbleBorder = isUser ? userBubbleBorder : assistantBubbleBorder
    const text = stringifyMessage(msg)
    const mediaPreviews = isUser ? [] : extractMediaPreview(msg)

    return (
      <Stack key={msg.id} align={isUser ? 'flex-end' : 'flex-start'} gap={4} style={{ width: '100%' }}>
        <Text size="xs" c="rgba(255,255,255,0.5)">
          {renderRoleLabel(msg.role)}
        </Text>
        <Box
          style={{
            background: bubbleBackground,
            border: bubbleBorder,
            color: messageTextColor,
            borderRadius: 12,
            padding: '12px 16px',
            maxWidth: '88%',
            alignSelf: isUser ? 'flex-end' : 'flex-start',
            boxShadow: bubbleShadow,
            backdropFilter: 'blur(18px)',
            position: 'relative'
          }}
        >
          {text && (
            <Text size="sm" style={{ whiteSpace: 'pre-wrap', color: 'inherit' }}>
              {text}
            </Text>
          )}

          {mediaPreviews.length > 0 && (
            <Stack gap={6} mt={text ? 8 : 0}>
              {mediaPreviews
                .filter((item) => item.type === 'image')
                .map((item, index) => (
                  <Box
                    key={`${item.url}-${index}`}
                    component="img"
                    src={item.url}
                    alt={`生成图片 ${index + 1}`}
                    style={{
                      display: 'block',
                      width: '100%',
                      maxHeight: 260,
                      objectFit: 'contain',
                      borderRadius: 10,
                    }}
                  />
                ))}
            </Stack>
          )}
        </Box>
      </Stack>
    )
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

  const handleToolbarAction = useCallback((feature: string) => {
    toast(`${feature} 即将上线`, 'info')
  }, [])
  const handleCreateSession = useCallback(() => {
    const index = sessions.length + 1
    const next = createEmptyAssistantSession(`会话 ${index}`)
    setSessions(prev => [...prev, next])
    setActiveSessionId(next.id)
    setMessages([])
    setInput('')
    setImagePromptAttachments([])
    setActivePromptAttachmentId(null)
    setThinkingEvents([])
    setPlanUpdate(null)
    setIsThinking(false)
  }, [sessions.length, setMessages])

  const handleRenameSession = useCallback(async (sessionId: string) => {
    const target = sessions.find(session => session.id === sessionId)
    const currentTitle = target?.title || ''
    const next = window.prompt('重命名会话', currentTitle)
    if (next == null) return
    const trimmed = next.trim()
    if (!trimmed) return
    try {
      const updated = await renameServerChatSession(sessionId, trimmed)
      setSessions(prev =>
        prev.map(session =>
          session.id === sessionId ? { ...session, title: updated.title || trimmed } : session
        )
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : '重命名失败'
      toast(message, 'error')
    }
  }, [sessions])

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    const target = sessions.find(session => session.id === sessionId)
    const label = target?.title || '当前会话'
    if (!window.confirm(`确定要删除「${label}」吗？此操作不可恢复。`)) return
    try {
      await deleteServerChatSession(sessionId)
      setSessions(prev => prev.filter(session => session.id !== sessionId))
      if (activeSessionId === sessionId) {
        const next = sessions.find(session => session.id !== sessionId)
        if (next) {
          setActiveSessionId(next.id)
          setMessages(next.messages)
        } else {
          const fresh = createEmptyAssistantSession('会话 1')
          setActiveSessionId(fresh.id)
          setSessions([fresh])
          setMessages([])
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除会话失败'
      toast(message, 'error')
    }
  }, [sessions, activeSessionId, setMessages])

  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId)
    const target = sessions.find(session => session.id === sessionId)
    if (target && target.messages.length) {
      setMessages(target.messages)
      setInput('')
      setImagePromptAttachments([])
      setActivePromptAttachmentId(null)
      setThinkingEvents([])
      setPlanUpdate(null)
      setIsThinking(false)
      return
    }
    // 若本地没有该会话的消息，则从服务端拉取历史记录
    void (async () => {
      try {
        const history = await getServerChatHistory(sessionId)
        const uiMessages = history.messages.map(m => toUiMessageFromHistory(m))
        setSessions(prev =>
          prev.map(session =>
            session.id === sessionId ? { ...session, messages: uiMessages } : session
          )
        )
        setMessages(uiMessages)
      } catch {
        setMessages([])
      } finally {
        setInput('')
        setImagePromptAttachments([])
        setActivePromptAttachmentId(null)
        setThinkingEvents([])
        setPlanUpdate(null)
        setIsThinking(false)
      }
    })()
  }, [sessions, setMessages])


  const handleTextareaPaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardData = event.clipboardData
    if (!clipboardData) return
    const files: File[] = []
    const items = clipboardData.items
    if (items && items.length) {
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i]
        if (item.kind === 'file' && item.type?.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
    }
    if (!files.length && clipboardData.files && clipboardData.files.length) {
      files.push(
        ...Array.from(clipboardData.files).filter(file => file.type?.startsWith('image/'))
      )
    }
    if (!files.length) return
    if (!isGptModel) {
      toast('仅 GPT 模型支持图片提示词', 'error')
      return
    }
    if (imagePromptAttachments.length >= MAX_IMAGE_PROMPT_ATTACHMENTS) {
      toast(`一次最多上传 ${MAX_IMAGE_PROMPT_ATTACHMENTS} 张图片`, 'error')
      return
    }
    event.preventDefault()
    void handleImagePromptUpload(files)
  }, [handleImagePromptUpload, imagePromptAttachments.length, isGptModel])

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
      const { output, errorText } = await runToolHandler(call)
      if (errorText) {
        await addToolResult({ state: 'output-error', tool: call.toolName as any, toolCallId: call.toolCallId, errorText })
      } else {
        await addToolResult({ state: 'output-available', tool: call.toolName as any, toolCallId: call.toolCallId, output: output as any })
      }
      await reportToolResult({ toolCallId: call.toolCallId, toolName: call.toolName, output, errorText })
    })
  }, [messages, addToolResult, runToolHandler, reportToolResult])

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
          const { output, errorText } = await runToolHandler({ ...event, toolName, input: normalizedInput })
          await reportToolResult({ toolCallId: event.toolCallId, toolName, output, errorText })
          return
        }

        if (event.type === 'tool-result') {
          const thinking = extractThinkingEvent(event)
          if (thinking) {
            setThinkingEvents(prev => [...prev, thinking])
            setIsThinking(true)
            return
          }

          const planPayload = extractPlanUpdate(event)
          if (planPayload) {
            setPlanUpdate(planPayload)
            const done = planPayload.steps.every(step => step.status === 'completed')
            // 计划只要未全部 completed，就保持思考/执行中的 loading 态
            setIsThinking(!done)
          }
        }
      }
    })
    return () => {
      unsubscribe()
    }
  }, [apiRoot, runToolHandler, reportToolResult])

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
      : '上传或粘贴图片生成提示词'

  // 保持会话视图默认滚动到底部（新消息与切换会话时）
  useEffect(() => {
    if (!isExpanded) return
    if (!messagesEndRef.current) return
    if (messages.length === 0 && !isThinking) return
    try {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    } catch {
      // ignore scroll errors
    }
  }, [messages, isExpanded, activeSessionId, isThinking])

  return (
    <Box
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 40,
        display: 'flex',
        justifyContent: 'center',
        zIndex: 200,
        // 允许画布和其他 UI 在助手面板之外继续可点击
        pointerEvents: 'none'
      }}
    >
      <Box
        style={{
          width: 'min(60vw, 960px)',
          pointerEvents: 'auto'
        }}
      >
        <Paper
          ref={rootRef}
          radius={12}
          shadow="xl"
          style={{
            background: panelBackground,
            border: panelBorder,
            boxShadow: panelShadow,
            overflow: 'hidden',
            backdropFilter: 'blur(18px)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: isExpanded ? 420 : 'auto',
            maxHeight: isExpanded ? 'min(720px, calc(100vh - 200px))' : 96,
            height: isExpanded ? 'min(720px, calc(100vh - 200px))' : 'auto',
            opacity: isExpanded ? 1 : (isHovered ? 0.4 : 0.1),
            transition: 'opacity 150ms ease-out'
          }}
          onMouseDown={() => setIsExpanded(true)}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
        <Box
          px="xl"
          pt="lg"
          pb="sm"
          style={{
            borderBottom: 'none',
            background: 'transparent',
            flexShrink: 0
          }}
        >
          <Group justify="space-between" align="center" wrap="nowrap">
            <Group
              gap={8}
              align="center"
              style={{ color: '#eef2ff', flex: 1, minWidth: 0 }}
            >
              <ActionIcon
                size="sm"
                variant="subtle"
                styles={{ root: { background: toolbarIconBackground, border: 'none', color: sparklesColor, boxShadow: '0 8px 18px rgba(3,5,12,0.4)' } }}
              >
                <IconSparkles size={14} />
              </ActionIcon>
              <Select
                size="xs"
                value={model}
                onChange={handleModelChange}
                data={assistantModelOptions.map(option => ({ value: option.value, label: option.label }))}
                aria-label="选择模型"
                w={170}
                styles={{
                  input: {
                    background: 'transparent',
                    border: 'none',
                    color: '#f3f5ff',
                    paddingLeft: 8,
                    paddingRight: 32,
                    height: 32,
                    boxShadow: 'none',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    overflow: 'hidden'
                  },
                  dropdown: {
                    background: 'rgba(5,8,16,0.95)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    backdropFilter: 'blur(14px)'
                  },
                  option: (_, params) => ({
                    borderRadius: 12,
                    color: '#eaf0ff',
                    backgroundColor: params.selected
                      ? 'rgba(79,126,255,0.4)'
                      : params.hovered
                        ? 'rgba(79,126,255,0.25)'
                        : undefined,
                  })
                }}
              />
            </Group>
            <Group gap={8} align="center" wrap="nowrap">
              <Popover
                width={220}
                position="bottom-end"
                shadow="xl"
                withinPortal
                offset={4}
                trapFocus={false}
              >
                <Popover.Target>
                  <Tooltip label="会话历史">
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      styles={{ root: { background: toolbarIconBackground, border: toolbarIconBorder, color: '#e3e7ff', boxShadow: '0 8px 18px rgba(3,5,12,0.4)' } }}
                    >
                      <IconHistory size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Popover.Target>
                <Popover.Dropdown
                  style={{
                    background: 'rgba(5,8,16,0.96)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 12,
                    padding: 8
                  }}
                >
                  <Stack gap={6}>
                    {sessions.map((session, index) => (
                      <Box
                        key={session.id}
                        onClick={() => handleSelectSession(session.id)}
                        style={{
                          padding: '6px 8px',
                          borderRadius: 8,
                          cursor: 'pointer',
                          background: session.id === activeSessionId ? 'rgba(88,112,255,0.22)' : 'transparent',
                          border: session.id === activeSessionId ? '1px solid rgba(129,140,248,0.7)' : '1px solid transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <Text
                          size="xs"
                          c="rgba(239,242,255,0.9)"
                          style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}
                        >
                          {session.title || `会话 ${index + 1}`}
                        </Text>
                        <Group gap={4}>
                          <ActionIcon
                            size="xs"
                            variant="subtle"
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleRenameSession(session.id)
                            }}
                            styles={{ root: { background: 'transparent', border: 'none', color: '#c7d2fe' } }}
                          >
                            <IconBulb size={12} />
                          </ActionIcon>
                          <ActionIcon
                            size="xs"
                            variant="subtle"
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleDeleteSession(session.id)
                            }}
                            styles={{ root: { background: 'transparent', border: 'none', color: '#fca5a5' } }}
                          >
                            <IconX size={12} />
                          </ActionIcon>
                        </Group>
                      </Box>
                    ))}
                  </Stack>
                </Popover.Dropdown>
              </Popover>
              <Tooltip label="新建会话">
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  onClick={handleCreateSession}
                  styles={{ root: { background: toolbarIconBackground, border: toolbarIconBorder, color: '#e3e7ff', boxShadow: '0 8px 18px rgba(3,5,12,0.4)' } }}
                >
                  <IconPlus size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
        </Box>

        {isExpanded && (
          <Box
            style={{ flex: 1, minHeight: 0, display: 'flex' }}
          >
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                background: logBackground,
                borderRadius: 12,
                border: logBorder,

              }}
              style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                position: 'relative',
                overflow: 'hidden',
                boxShadow: '0 28px 60px rgba(3,5,15,0.65)',
                backdropFilter: 'blur(22px)',
                flexDirection: 'column'
              }}
            >
              <Box style={{ flex: 1, minHeight: 0, position: 'relative', zIndex: 1 }}>
                <ScrollArea style={{ height: '100%' }} type="auto">
                  <Stack gap="md" style={{ padding: 24, paddingBottom: 16 }}>
                    {messages.length === 0 && (
                      <Text size="sm" c="rgba(255,255,255,0.55)" ta="center">
                        向 Aurora 打个「晚上好」的招呼，或描述你想生成的分镜与氛围。
                      </Text>
                    )}

                    {messages.map(renderMessageBubble)}

                    {isThinking && (
                      <Group gap={6} align="center">
                        <Loader size="xs" color="gray" />
                        <Text size="xs" c="rgba(255,255,255,0.6)">Aurora 正在思考…</Text>
                      </Group>
                    )}
                    <div ref={messagesEndRef} />
                  </Stack>
                </ScrollArea>
              </Box>

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
                style={{ position: 'relative', zIndex: 1, flexShrink: 0 }}
              >
                <Box
                  style={{
                    background: inputBackground,
                    borderRadius: 12,
                    boxShadow: '0 25px 60px rgba(2,6,20,0.65)',
                    padding: 12,
                    border: inputBorder
                  }}
                >
                  <Stack gap="xs">
                    <Box>
                      <Textarea
                        minRows={3}
                        placeholder="发出灵感或问候，支持粘贴/上传图片…"
                        value={input}
                        onChange={(e) => setInput(e.currentTarget.value)}
                        onPaste={handleTextareaPaste}
                        onFocus={() => setIsExpanded(true)}
                        disabled={isLoading}
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                            e.preventDefault()
                            onSubmit()
                          }
                        }}
                        styles={{
                          input: {
                            background: 'transparent',
                            borderColor: 'transparent',
                            color: inputColor,
                            paddingRight: 24,
                            paddingBottom: 16,
                            borderRadius: 8,
                            boxShadow: 'none'
                          }
                        }}
                      />
                    </Box>
                    <Group justify="space-between" align="center" mt="sm">
                      <Group gap="xs">
                        <Tooltip label={uploadTooltipLabel}>
                          <ActionIcon
                            variant="subtle"
                            onClick={handleImagePromptButtonClick}
                            disabled={imagePromptLoading || !isGptModel || imagePromptAttachments.length >= MAX_IMAGE_PROMPT_ATTACHMENTS}
                            styles={{ root: { background: toolbarIconBackground, border: toolbarIconBorder, color: '#e4edff', borderRadius: 999 } }}
                          >
                            {imagePromptLoading ? <Loader size="xs" /> : <IconPhoto size={16} />}
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="语音输入 · 即将开放">
                          <ActionIcon
                            variant="subtle"
                            onClick={() => handleToolbarAction('语音输入')}
                            styles={{ root: { background: toolbarIconBackground, border: toolbarIconBorder, color: '#e4edff', borderRadius: 999 } }}
                          >
                            <IconMicrophone size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="灵感表情 · 即将上线">
                          <ActionIcon
                            variant="subtle"
                            onClick={() => handleToolbarAction('灵感表情')}
                            styles={{ root: { background: toolbarIconBackground, border: toolbarIconBorder, color: '#e4edff', borderRadius: 999 } }}
                          >
                            <IconMoodSmile size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={enableWebSearch ? '已开启联网搜索' : '已关闭联网搜索'}>
                          <ActionIcon
                            variant="subtle"
                            onClick={() => setEnableWebSearch(prev => !prev)}
                            aria-pressed={enableWebSearch}
                            styles={{ root: { background: toolbarIconBackground, border: toolbarIconBorder, color: '#e4edff', borderRadius: 999 } }}
                          >
                            {enableWebSearch ? <IconWorld size={16} /> : <IconWorldOff size={16} />}
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                      <Button
                        type="submit"
                        loading={isLoading}
                        leftSection={<IconSend size={16} />}
                        radius="xl"
                        styles={{
                          root: {
                          background: glowingSendBackground,
                          boxShadow: '0 18px 40px rgba(63,129,255,0.55)',
                          border: 'none',
                          minWidth: 132
                        }
                      }}
                    >
                      发送
                    </Button>
                  </Group>
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
                              border: assistantBubbleBorder,
                              background: 'rgba(255,255,255,0.03)',
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
                              <Text size="xs" c="rgba(255,255,255,0.6)">
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
                              <Text size="xs" c="rgba(255,255,255,0.6)">发送时将附带</Text>
                            </Group>
                          </Stack>
                        </Group>
                      ))}
                    </Stack>
                  )}
                </Stack>
              </Box>
            </form>
          </Box>
        </Box>
        )}
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
  </Box>
  )
}

export default UseChatAssistant
