import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { UIMessage, useChat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import { nanoid } from 'nanoid'
import { ActionIcon, Badge, Box, Button, CopyButton, Divider, Group, Loader, Modal, Paper, ScrollArea, Select, Stack, Text, Textarea, Tooltip, useMantineColorScheme, useMantineTheme } from '@mantine/core'
import { IconX, IconSparkles, IconSend, IconPhoto, IconBulb, IconEye } from '@tabler/icons-react'
import { getDefaultModel, getModelProvider, type ModelOption } from '../../config/models'
import { useModelOptions } from '../../config/useModelOptions'
import { useRFStore } from '../store'
import { getAuthToken } from '../../auth/store'
import { functionHandlers } from '../../ai/canvasService'
import { subscribeToolEvents, type ToolEventMessage, extractThinkingEvent, extractPlanUpdate } from '../../api/toolEvents'
import { runTaskByVendor, type TaskResultDto } from '../../api/server'
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
}

const OPENAI_DEFAULT_MODEL = 'gpt-5.1-codex'
const ASSISTANT_MODEL_PRESETS: ModelOption[] = [
  { value: 'gpt-5.1', label: 'GPT-5.1' },
  { value: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' }
]
const ASSISTANT_MODEL_SET = new Set(ASSISTANT_MODEL_PRESETS.map(option => option.value))
const MAX_IMAGE_PROMPT_ATTACHMENTS = 2

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
export function UseChatAssistant({ opened, onClose, position = 'right', width = 420 }: UseChatAssistantProps) {
  const nodes = useRFStore(state => state.nodes)
  const edges = useRFStore(state => state.edges)
  const [model, setModel] = useState(() => OPENAI_DEFAULT_MODEL || getDefaultModel('text'))
  const textModelOptions = useModelOptions('text')
  const assistantModelOptions = useMemo(() => {
    const overrides = new Map<string, ModelOption>()
    textModelOptions.forEach(option => {
      if (ASSISTANT_MODEL_SET.has(option.value)) {
        overrides.set(option.value, option)
      }
    })
    return ASSISTANT_MODEL_PRESETS.map(option => overrides.get(option.value) || option)
  }, [textModelOptions])
  const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3000'
  const apiRoot = useMemo(() => apiBase.replace(/\/$/, ''), [apiBase])
  const { colorScheme } = useMantineColorScheme()
  const theme = useMantineTheme()
  const isDarkUi = colorScheme === 'dark'
  const panelBackground = isDarkUi
    ? 'linear-gradient(145deg, rgba(5,7,16,0.95), rgba(12,17,32,0.9), rgba(8,14,28,0.95))'
    : 'linear-gradient(145deg, rgba(248,250,252,0.98), rgba(237,242,255,0.95))'
  const panelBorder = isDarkUi ? '1px solid rgba(82, 152, 255, 0.25)' : '1px solid rgba(148, 163, 184, 0.4)'
  const panelShadow = isDarkUi ? '0 0 45px rgba(46,133,255,0.25)' : '0 18px 32px rgba(15,23,42,0.12)'
  const headerBackground = isDarkUi
    ? 'linear-gradient(120deg, rgba(15,23,42,0.9), rgba(10,12,24,0.6))'
    : 'linear-gradient(120deg, rgba(226,232,240,0.92), rgba(248,250,252,0.85))'
  const headerBorder = isDarkUi ? '1px solid rgba(82,152,255,0.25)' : '1px solid rgba(148,163,184,0.4)'
  const headerTextColor = isDarkUi ? '#eff6ff' : '#0f172a'
  const sparklesColor = isDarkUi ? '#a5b4fc' : '#6366f1'
  const logBackground = isDarkUi ? 'rgba(15,23,42,0.8)' : 'rgba(248,250,252,0.9)'
  const logBorder = isDarkUi ? '1px solid rgba(59,130,246,0.25)' : '1px solid rgba(148,163,184,0.35)'
  const messageBackground = isDarkUi ? 'rgba(255,255,255,0.02)' : 'rgba(15,23,42,0.04)'
  const messageBorder = isDarkUi ? '1px solid rgba(59,130,246,0.12)' : '1px solid rgba(148,163,184,0.25)'
  const messageTextColor = isDarkUi ? '#f8fafc' : '#0f172a'
  const footerBackground = isDarkUi ? 'rgba(8,10,20,0.85)' : 'rgba(248,250,252,0.96)'
  const footerBorder = isDarkUi ? '1px solid rgba(15,118,110,0.2)' : '1px solid rgba(148,163,184,0.35)'
  const inputBackground = isDarkUi ? 'rgba(15,23,42,0.7)' : '#ffffff'
  const inputBorder = isDarkUi ? 'rgba(99,102,241,0.4)' : 'rgba(148,163,184,0.5)'
  const inputColor = isDarkUi ? '#f8fafc' : '#0f172a'
  const closeIconColor = isDarkUi ? '#d1d5db' : '#0f172a'
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

  useEffect(() => {
    if (assistantModelOptions.length && !assistantModelOptions.find(option => option.value === model)) {
      const preferred = assistantModelOptions.find(option => option.value === OPENAI_DEFAULT_MODEL)
      setModel(preferred ? preferred.value : assistantModelOptions[0].value)
    }
  }, [assistantModelOptions, model])

  const canvasContext = useMemo(() => buildCanvasContext(nodes, edges), [nodes, edges])

  const provider = useMemo(() => getModelProvider(model), [model])
  const isGptModel = provider === 'openai'

  const body = useMemo(() => ({
    model,
    temperature: 0.2,
    context: canvasContext,
    provider,
    clientToolExecution: true,
    maxToolRoundtrips: 4,
  }), [model, canvasContext, provider])

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
  }), [apiRoot, body, model])

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
    console.debug('[UseChatAssistant] executing tool', { toolName, toolCallId: call.toolCallId, input: call.input })
    try {
      const result = await handler(call.input || {})
      console.debug('[UseChatAssistant] tool completed', { toolName, toolCallId: call.toolCallId, result })
      return { output: result }
    } catch (err) {
      console.error('[UseChatAssistant] tool failed', toolName, err)
      return { errorText: err instanceof Error ? err.message : '工具执行失败' }
    }
  }, [])

  const stringifyMessage = (msg: UIMessage) => {
    const describeToolState = (part: any) => {
      const toolName = resolveToolName(part) || '未知工具'
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
        pushOrUpdateLine(key, summary)
      }
    })

    return lines.filter(Boolean).join('\n')
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
  }

  useEffect(() => {
    const toolCalls = messages.flatMap(msg =>
      msg.parts
        .filter((part: any) => isToolCallPart(part))
        .map((part: any) => {
          const parsedInput = parseJsonIfNeeded(part.input ?? part.arguments ?? {})
          const hasPayload = parsedInput && typeof parsedInput === 'object' && Object.keys(parsedInput).length > 0
          const ready = part.state === 'input-available' || part.type === 'tool-input-available' || hasPayload
          if (!ready) return null
          return {
            toolCallId: part.toolCallId || part.id,
            toolName: resolveToolName(part),
            input: parsedInput
          }
        })
        .filter(Boolean)
    )
    if (toolCalls.length) {
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
          const normalizedInput = parseJsonIfNeeded(event.input)
          const { output, errorText } = await runToolHandler({ ...event, input: normalizedInput })
          await reportToolResult({ toolCallId: event.toolCallId, toolName: event.toolName, output, errorText })
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
            if (done) {
              setIsThinking(false)
            }
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
              <Badge color={colorScheme === 'dark' ? 'teal' : 'blue'} variant="light" size="xs" radius="sm">流式</Badge>
              <IconSparkles size={14} color={sparklesColor} />
              <Text fw={600} fz="sm" c={headerTextColor}>暗夜AI助手</Text>
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
          py="md"
          style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
        >
          <Box
            style={{
              height: '100%',
              overflow: 'auto',
              padding: 12,
              background: logBackground,
              borderRadius: 8,
              border: logBorder
            }}
          >
            <Stack gap="sm">
              {(thinkingEvents.length > 0 || isThinking) && (
                <ThinkingProcess events={thinkingEvents} isProcessing={isThinking} maxHeight={180} />
              )}

              {planUpdate && planUpdate.steps.length > 0 && (
                <ExecutionPlanDisplay plan={planUpdate} />
              )}

              {messages.map(msg => (
                <Box key={msg.id} style={{ background: messageBackground, borderRadius: 8, padding: 10, border: messageBorder }}>
                  <Text c="dimmed" size="xs">{msg.role}</Text>
                  <Text size="sm" c={messageTextColor} style={{ whiteSpace: 'pre-wrap' }}>{stringifyMessage(msg)}</Text>
                </Box>
              ))}
              {messages.length === 0 && (
                <Text size="sm" c="dimmed">输入你的需求，助手将流式回复并生成动作。</Text>
              )}
            </Stack>
          </Box>
        </Box>

        <Box
          px="lg"
          py="md"
          style={{ background: footerBackground, borderTop: footerBorder, flexShrink: 0 }}
        >
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
                styles={{ input: { background: inputBackground, borderColor: inputBorder, color: inputColor } }}
              />
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
              <Group justify="flex-end" align="flex-end" gap="xs">
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
            </Stack>
          </form>
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
