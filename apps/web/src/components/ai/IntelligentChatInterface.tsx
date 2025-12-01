import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
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
  Collapse,
  SimpleGrid,
  RingProgress,
  Divider,
  useMantineTheme
} from '@mantine/core'
import type { MantineTheme } from '@mantine/core'
import { useReducedMotion } from '@mantine/hooks'
import {
  IconSend,
  IconBrain,
  IconLoader,
  IconSparkles,
  IconChartDonut,
  IconBolt,
  IconMessages,
  IconPlus
} from '@tabler/icons-react'
import type { ThinkingEvent, PlanUpdatePayload } from '../../../types/canvas-intelligence'
import { subscribeToolEvents, extractThinkingEvent, mapToolEventToCanvasOperation, extractPlanUpdate } from '../../api/toolEvents'
import { getAuthToken } from '../../auth/store'
import { ThinkingProcess, ExecutionPlanDisplay } from './IntelligentAssistant'
import { API_BASE } from '../../api/server'

interface IntelligentChatInterfaceProps {
  userId: string
  height?: string
  onOperationExecuted?: (operation: any) => void
  context?: any
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  thinkingEvents?: any[]
  plan?: any[]
  intent?: any
  actions?: any[]
}

type StatusPhase = 'idle' | 'thinking' | 'success' | 'error'

interface ChatSession {
  id: string
  sessionId: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  thinkingEvents: ThinkingEvent[]
  planUpdate: PlanUpdatePayload | null
  statusMessage: string
  lastIntentLabel: string | null
  isThinking: boolean
  isLoading: boolean
}

const auroraTokens = {
  base: '#03060d',
  panel: 'rgba(7, 12, 22, 0.9)',
  border: 'rgba(255, 255, 255, 0.08)',
  auroraPurple: '#8F7BFF',
  auroraCyan: '#4DD6FF',
  auroraCoral: '#FF7A6A',
  textHigh: '#F0F4FF',
  textDim: '#9AA6C9'
}

const INTENT_LABELS: Record<string, string> = {
  layout_arrangement: '布局整理',
  assistance_request: '智能协作',
  create_request: '节点创建',
  optimize_request: '性能优化',
  cover_generation: '封面设计',
  storyboard_panel: '分镜规划',
  asset_curation: '资产陈列'
}

const STATUS_LIBRARY: Record<StatusPhase, string[]> = {
  idle: [
    '✨ 准备聆听你的灵感，随时布置极光舞台。',
    '🌌 面板静候唤醒，我已准备好雕刻呼吸感。'
  ],
  thinking: [
    '🧠 思考中：正在对齐 Bento 容器与巨量留白。',
    '🎬 正在规划 {intent}，同步调整光线与材质。',
    '🎯 配置悬浮礼物锚点，让主视觉稳稳落位。'
  ],
  success: [
    '✅ {intent} 执行完毕，画布已注入新的节奏。',
    '🌈 Aurora 指令完成，欢迎继续雕刻细节。'
  ],
  error: [
    '⚠️ 信号有些噪点，稍后再试或检查网络。',
    '🛠️ 请求暂时受阻，我会继续守候。'
  ]
}

const QUICK_ACTIONS = [
  {
    id: 'cover',
    icon: '🌌',
    title: 'Aurora Cover',
    description: '中心 3D 玻璃锚点 + 粗体标题',
    prompt: '生成一个极光风格的 16:9 演示封面，中心放置复杂的玻璃莫比乌斯环，背景是流动的霓虹波浪，并加上粗体标题与副标题，整体高端且留白充足。'
  },
  {
    id: 'bento',
    icon: '🍱',
    title: 'Bento Layout',
    description: '多卡片内容，巨量留白',
    prompt: '创建一个 Bento 便当盒布局的内容页，为每个卡片加入磨砂玻璃材质，左侧卡片承载文本，右侧卡片展示 3D 图标，整体遵循现代 SaaS + 玻璃拟态风格。'
  },
  {
    id: 'data',
    icon: '📊',
    title: 'Data Split',
    description: '左文右 3D 数据可视化',
    prompt: '生成一个 16:9 数据页，左侧排版文字，右侧是悬浮的 3D 发光甜甜圈图与胶囊进度条，使用霓虹紫与电光蓝作为高光。'
  },
  {
    id: 'cleanup',
    icon: '🧼',
    title: 'Canvas Reset',
    description: '整理节点与极光背景',
    prompt: '请整理当前画布布局，保持节点对齐并为 AI 画布应用极光渐变背景，语言简练。'
  }
]

const auroraCardStyles = (theme: MantineTheme) => ({
  background: 'rgba(6, 10, 20, 0.85)',
  borderRadius: theme.radius.xl,
  border: `1px solid ${auroraTokens.border}`,
  boxShadow: '0 30px 80px rgba(3, 6, 13, 0.6)',
  backdropFilter: 'blur(28px)',
  position: 'relative',
  overflow: 'hidden'
})

const describeIntent = (intentType?: string): string => {
  if (!intentType) return '创作计划'
  return INTENT_LABELS[intentType] || intentType.replace(/_/g, ' ')
}

const pickStatusMessage = (phase: StatusPhase, intentType?: string) => {
  const deck = STATUS_LIBRARY[phase] || STATUS_LIBRARY.idle
  const text = deck[Math.floor(Math.random() * deck.length)]
  return text.replace('{intent}', describeIntent(intentType))
}

const SESSION_STORAGE_KEY = 'tapcanvas:intelligent-chat-sessions'

const generateLocalId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

const generateServerSessionId = () => `ai_session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

const createEmptySession = (label: string): ChatSession => ({
  id: generateLocalId(),
  sessionId: generateServerSessionId(),
  title: label,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  messages: [],
  thinkingEvents: [],
  planUpdate: null,
  statusMessage: pickStatusMessage('idle'),
  lastIntentLabel: null,
  isThinking: false,
  isLoading: false
})

const hydrateSessionsFromStorage = (): ChatSession[] => {
  if (typeof window === 'undefined') {
    return [createEmptySession('会话 1')]
  }

  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return [createEmptySession('会话 1')]
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [createEmptySession('会话 1')]
    }

    return parsed.map((session: any, index: number) => ({
      id: session.id || generateLocalId(),
      sessionId: session.sessionId || generateServerSessionId(),
      title: session.title || `会话 ${index + 1}`,
      createdAt: typeof session.createdAt === 'number' ? session.createdAt : Date.now(),
      updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : Date.now(),
      messages: Array.isArray(session.messages)
        ? session.messages.map((message: any) => ({
            ...message,
            timestamp: message.timestamp ? new Date(message.timestamp) : new Date()
          }))
        : [],
      thinkingEvents: Array.isArray(session.thinkingEvents)
        ? session.thinkingEvents.map((event: any) => ({
            ...event,
            timestamp: event.timestamp ? new Date(event.timestamp) : new Date()
          }))
        : [],
      planUpdate: session.planUpdate || null,
      statusMessage: session.statusMessage || pickStatusMessage('idle'),
      lastIntentLabel: session.lastIntentLabel || null,
      isThinking: false,
      isLoading: false
    }))
  } catch (error) {
    console.warn('[IntelligentChat] Failed to restore sessions', error)
    return [createEmptySession('会话 1')]
  }
}

const serializeSessions = (sessions: ChatSession[]) => {
  return JSON.stringify(sessions.map(session => ({
    ...session,
    messages: session.messages.map(message => ({
      ...message,
      timestamp: message.timestamp instanceof Date ? message.timestamp.toISOString() : new Date(message.timestamp).toISOString()
    })),
    thinkingEvents: session.thinkingEvents.map(event => ({
      ...event,
      timestamp: event.timestamp instanceof Date ? event.timestamp.toISOString() : new Date(event.timestamp).toISOString()
    })),
    isLoading: false,
    isThinking: false
  })))
}

const summarizePrompt = (prompt: string) => {
  const trimmed = prompt.trim()
  if (!trimmed) return ''
  return trimmed.length > 14 ? `${trimmed.slice(0, 14)}...` : trimmed
}

export const IntelligentChatInterface: React.FC<IntelligentChatInterfaceProps> = ({
  userId,
  height = '500px',
  onOperationExecuted,
  context
}) => {
  const [sessions, setSessions] = useState<ChatSession[]>(() => hydrateSessionsFromStorage())
  const [activeSessionId, setActiveSessionId] = useState(() => (sessions[0]?.id ?? ''))
  const [input, setInput] = useState('')
  const [isIntelligentMode, setIsIntelligentMode] = useState(true)
  const [showThinking, setShowThinking] = useState(true)
  const [isEventStreamConnected, setIsEventStreamConnected] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const sessionCounterRef = useRef(Math.max(1, sessions.length))
  const theme = useMantineTheme()
  const prefersReducedMotion = useReducedMotion()
  const [motionEnabled, setMotionEnabled] = useState(!prefersReducedMotion)

  useEffect(() => {
    if (prefersReducedMotion) {
      setMotionEnabled(false)
    }
  }, [prefersReducedMotion])

  useEffect(() => {
    sessionCounterRef.current = Math.max(sessionCounterRef.current, sessions.length || 1)
  }, [sessions.length])

  useEffect(() => {
    if (!activeSessionId && sessions[0]) {
      setActiveSessionId(sessions[0].id)
    }
  }, [activeSessionId, sessions])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(SESSION_STORAGE_KEY, serializeSessions(sessions))
    } catch (error) {
      console.warn('[IntelligentChat] Failed to persist sessions', error)
    }
  }, [sessions])

  const activeSession = useMemo(() => {
    if (!sessions.length) return undefined
    return sessions.find(session => session.id === activeSessionId) || sessions[0]
  }, [sessions, activeSessionId])

  const orderedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  }, [sessions])

  const activeMessages = activeSession?.messages ?? []
  const activeThinkingEvents = activeSession?.thinkingEvents ?? []
  const activePlan = activeSession?.planUpdate ?? null
  const statusMessage = activeSession?.statusMessage ?? pickStatusMessage('idle')
  const lastIntentLabel = activeSession?.lastIntentLabel ?? null
  const isThinking = Boolean(activeSession?.isThinking)
  const isLoading = Boolean(activeSession?.isLoading)
  // 任务只要还在执行（有计划未完成或会话标记为思考中），都视为「忙碌」
  const sessionBusy = !activeSession || isLoading || isThinking

  const patchSessionById = useCallback((sessionId: string, updater: (session: ChatSession) => ChatSession) => {
    setSessions(prev => prev.map(session => {
      if (session.id !== sessionId) return session
      const next = updater(session)
      return { ...next, updatedAt: Date.now() }
    }))
  }, [])

  const patchSessionByServerId = useCallback((serverSessionId: string, updater: (session: ChatSession) => ChatSession) => {
    setSessions(prev => prev.map(session => {
      if (session.sessionId !== serverSessionId) return session
      const next = updater(session)
      return { ...next, updatedAt: Date.now() }
    }))
  }, [])

  useEffect(() => {
    if (!userId) return
    const token = getAuthToken()
    if (!token) return

    const unsubscribe = subscribeToolEvents({
      url: `${API_BASE.replace(/\/$/, '')}/ai/tool-events`,
      token,
      onOpen: () => setIsEventStreamConnected(true),
      onError: () => setIsEventStreamConnected(false),
      onEvent: (event) => {
        const thinking = extractThinkingEvent(event)
        if (thinking) {
          const targetSessionId = thinking.sessionId || activeSession?.sessionId
          if (targetSessionId) {
            const normalizedThinking: ThinkingEvent = {
              ...thinking,
              timestamp: new Date(thinking.timestamp)
            }
            patchSessionByServerId(targetSessionId, session => ({
              ...session,
              thinkingEvents: [...session.thinkingEvents, normalizedThinking],
              isThinking: true,
              statusMessage: pickStatusMessage('thinking')
            }))
          }
          return
        }

        const planPayload = extractPlanUpdate(event)
        if (planPayload) {
          patchSessionByServerId(planPayload.sessionId, session => {
            const done = planPayload.steps.every(step => step.status === 'completed')
            return {
              ...session,
              planUpdate: planPayload,
              // 计划只要未全部 completed，就保持思考 / 执行中的态
              isThinking: !done,
              statusMessage: done
                ? pickStatusMessage('success', session.lastIntentLabel || undefined)
                : pickStatusMessage('thinking', session.lastIntentLabel || undefined)
            }
          })
          return
        }

        if (onOperationExecuted) {
          const normalizedOperation = mapToolEventToCanvasOperation(event)
          if (normalizedOperation) {
            onOperationExecuted(normalizedOperation)
          }
        }
      }
    })

    return () => {
      setIsEventStreamConnected(false)
      unsubscribe()
    }
  }, [userId, onOperationExecuted, patchSessionByServerId, activeSession?.sessionId])

  const handleSendMessage = useCallback(async (content: string) => {
    if (!content.trim() || !activeSession) return

    const trimmed = content.trim()
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmed,
      timestamp: new Date()
    }

    patchSessionById(activeSession.id, (session) => {
      const autoTitle = session.messages.length === 0 ? summarizePrompt(trimmed) : ''
      return {
        ...session,
        title: autoTitle ? autoTitle : session.title,
        messages: [...session.messages, userMessage],
        thinkingEvents: [],
        planUpdate: null,
        isLoading: true,
        isThinking: true,
        statusMessage: pickStatusMessage('thinking')
      }
    })

    setInput('')

    try {
      const token = getAuthToken()
      const response = await fetch(`${API_BASE.replace(/\/$/, '')}/ai/chat/intelligent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: trimmed }],
          context: context || {},
          intelligentMode: isIntelligentMode,
          enableThinking: showThinking,
          sessionId: activeSession.sessionId
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

      const normalizedThinkingEvents = Array.isArray(result.thinkingEvents)
        ? (result.thinkingEvents as ThinkingEvent[]).map(event => ({
            ...event,
            sessionId: activeSession.sessionId,
            timestamp: new Date(event.timestamp)
          }))
        : []

      patchSessionById(activeSession.id, (session) => ({
        ...session,
        messages: [...session.messages, assistantMessage],
        thinkingEvents: normalizedThinkingEvents.length ? normalizedThinkingEvents : session.thinkingEvents,
        statusMessage: pickStatusMessage('success', result.intent?.type),
        lastIntentLabel: result.intent?.type ? describeIntent(result.intent.type) : session.lastIntentLabel,
        isLoading: false,
        isThinking: false
      }))
    } catch (error) {
      console.error('Intelligent chat failed:', error)

      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '抱歉，处理您的请求时遇到了问题。请稍后再试。',
        timestamp: new Date()
      }

      patchSessionById(activeSession.id, (session) => ({
        ...session,
        messages: [...session.messages, errorMessage],
        statusMessage: pickStatusMessage('error'),
        isLoading: false,
        isThinking: false
      }))
    }
  }, [activeSession, isIntelligentMode, showThinking, context, patchSessionById])

  const handleClear = useCallback(() => {
    if (!activeSession) return
    patchSessionById(activeSession.id, (session) => ({
      ...session,
      messages: [],
      thinkingEvents: [],
      planUpdate: null,
      isThinking: false,
      isLoading: false,
      statusMessage: pickStatusMessage('idle'),
      lastIntentLabel: null,
      sessionId: generateServerSessionId()
    }))
  }, [activeSession, patchSessionById])

  const handleCreateSession = useCallback(() => {
    sessionCounterRef.current += 1
    const newSession = createEmptySession(`会话 ${sessionCounterRef.current}`)
    setSessions(prev => [...prev, newSession])
    setActiveSessionId(newSession.id)
    setInput('')
  }, [])

  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId)
    setInput('')
  }, [])

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    handleSendMessage(input)
  }, [input, handleSendMessage])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }, [handleSubmit])

  const planCompletion = useMemo(() => {
    if (!activePlan || !activePlan.steps || activePlan.steps.length === 0) return 0
    const completed = activePlan.steps.filter(step => step.status === 'completed').length
    return Math.round((completed / activePlan.steps.length) * 100)
  }, [activePlan])

  const renderPlaceholderCard = (title: string, description: string) => (
    <Paper p="lg" radius="xl" sx={auroraCardStyles(theme)}>
      <Group spacing="xs" mb="xs">
        <IconSparkles size={16} color={auroraTokens.auroraCyan} />
        <Text size="sm" color="dimmed">{title}</Text>
      </Group>
      <Text size="lg" weight={500} color={auroraTokens.textHigh}>
        {description}
      </Text>
    </Paper>
  )

  const shouldRenderThinkingCard = showThinking && (activeThinkingEvents.length > 0 || isThinking)
  const shouldRenderPlanCard = Boolean(activePlan && activePlan.steps.length > 0)

  const motionStyles = motionEnabled
    ? { transition: 'transform 420ms cubic-bezier(0.16, 1, 0.3, 1)' }
    : { transition: 'none' }

  return (
    <Stack
      h={height}
      spacing="md"
      sx={{
        background: `radial-gradient(circle at top, rgba(143,123,255,0.22), transparent 45%),
          radial-gradient(circle at bottom right, rgba(77,214,255,0.12), transparent 45%),
          ${auroraTokens.base}`,
        borderRadius: '32px',
        border: `1px solid ${auroraTokens.border}`,
        padding: 'var(--mantine-spacing-md)',
        boxShadow: '0 50px 120px rgba(0,0,0,0.65)'
      }}
    >
      <Paper p="xl" radius="xl" sx={auroraCardStyles(theme)}>
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.08), transparent 45%)',
            opacity: 0.7,
            pointerEvents: 'none'
          }}
        />
        <Group align="flex-start" position="apart" spacing="xl">
          <Stack spacing={6} sx={{ position: 'relative', zIndex: 1 }}>
            <Group spacing="xs">
              <IconBrain size={20} color={auroraTokens.auroraCyan} />
              <Text size="lg" weight={600} color={auroraTokens.textHigh}>
                智能 AI 助手
              </Text>
            </Group>
            <Text size="xl" weight={600} color={auroraTokens.textHigh} style={{ letterSpacing: -0.5 }}>
              "我能帮你把极光与结构同时安放。"
            </Text>
            <Text size="sm" color={auroraTokens.textDim}>
              {statusMessage}
            </Text>
            <Group spacing="xs" mt="sm" wrap="wrap">
              <Badge color={isEventStreamConnected ? 'teal' : 'yellow'} variant="dot">
                {isEventStreamConnected ? '实时语义在线' : '连接中'}
              </Badge>
              <Badge color={isIntelligentMode ? 'violet' : 'gray'} variant="light">
                {isIntelligentMode ? '深度智能模式' : '轻盈模式'}
              </Badge>
              <Badge color={showThinking ? 'cyan' : 'gray'} variant="light">
                {showThinking ? '展示思考轨迹' : '思考轨迹隐藏'}
              </Badge>
              {lastIntentLabel && (
                <Badge color="grape" variant="outline">
                  最近任务：{lastIntentLabel}
                </Badge>
              )}
            </Group>
          </Stack>
          <Stack spacing={6} align="center" sx={{ position: 'relative', zIndex: 1 }}>
            <Box
              sx={{
                width: 160,
                height: 120,
                borderRadius: 32,
                background: `linear-gradient(145deg, rgba(143,123,255,0.45), rgba(77,214,255,0.25))`,
                border: '1px solid rgba(255,255,255,0.4)',
                boxShadow: 'inset 0 0 30px rgba(255,255,255,0.2), 0 30px 60px rgba(0,0,0,0.45)',
                backdropFilter: 'blur(25px)',
                position: 'relative',
                ...motionStyles,
                ...(motionEnabled ? { transform: 'translateY(0)', '&:hover': { transform: 'translateY(-6px)' } } : {})
              }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  inset: 12,
                  borderRadius: 28,
                  background: `radial-gradient(circle at 30% 30%, ${auroraTokens.auroraCyan}, transparent),
                    radial-gradient(circle at 70% 60%, ${auroraTokens.auroraPurple}, transparent)`,
                  opacity: 0.9
                }}
              />
            </Box>
            <Text size="xs" color={auroraTokens.textDim}>
              礼物质感锚点 · Vibe 01
            </Text>
          </Stack>
        </Group>
        <Divider my="md" color="rgba(255,255,255,0.08)" />
        <Group spacing="md" wrap="wrap" sx={{ position: 'relative', zIndex: 1 }}>
          <Tooltip label="显示 AI 的推理过程">
            <Switch
              size="sm"
              checked={showThinking}
              onChange={(e) => setShowThinking(e.currentTarget.checked)}
              label="思考轨迹"
              color="cyan"
            />
          </Tooltip>
          <Tooltip label="启用深度语义理解与自动执行">
            <Switch
              size="sm"
              checked={isIntelligentMode}
              onChange={(e) => setIsIntelligentMode(e.currentTarget.checked)}
              label="智能模式"
              color="violet"
            />
          </Tooltip>
          <Tooltip label="关闭可减少动画，适合易晕动用户">
            <Switch
              size="sm"
              checked={motionEnabled}
              onChange={(e) => setMotionEnabled(e.currentTarget.checked)}
              label="轻盈动效"
              color="teal"
            />
          </Tooltip>
        </Group>
      </Paper>

      <Paper p="md" radius="xl" sx={auroraCardStyles(theme)}>
        <Group position="apart" mb="sm" align="center">
          <Group spacing="xs">
            <IconMessages size={16} color={auroraTokens.auroraCyan} />
            <Text size="sm" color={auroraTokens.textDim}>会话历史</Text>
          </Group>
          <Button size="xs" variant="light" leftIcon={<IconPlus size={14} />} onClick={handleCreateSession}>
            新建会话
          </Button>
        </Group>
        <ScrollArea type="auto" style={{ width: '100%' }} offsetScrollbars>
          <Group spacing="xs" noWrap>
            {orderedSessions.map(session => {
              const isActive = session.id === (activeSession?.id || activeSessionId)
              return (
                <Paper
                  key={session.id}
                  component="button"
                  type="button"
                  onClick={() => handleSelectSession(session.id)}
                  sx={{
                    ...auroraCardStyles(theme),
                    padding: '8px 14px',
                    minWidth: 140,
                    cursor: 'pointer',
                    borderColor: isActive ? auroraTokens.auroraPurple : 'rgba(255,255,255,0.12)',
                    background: isActive ? 'rgba(143,123,255,0.15)' : 'rgba(10,16,30,0.65)'
                  }}
                >
                  <Group spacing="xs" noWrap>
                    <Text size="sm" weight={500} color={auroraTokens.textHigh}>{session.title}</Text>
                    <Badge size="xs" color={isActive ? 'violet' : 'gray'} variant="light">
                      {session.messages.length}
                    </Badge>
                  </Group>
                </Paper>
              )
            })}
          </Group>
        </ScrollArea>
      </Paper>

      <SimpleGrid
        cols={3}
        spacing="md"
        breakpoints={[
          { maxWidth: 'lg', cols: 2 },
          { maxWidth: 'sm', cols: 1 }
        ]}
      >
        <Paper p="lg" radius="xl" sx={auroraCardStyles(theme)}>
          <Group position="apart" align="flex-start" mb="sm">
            <Stack spacing={2}>
              <Text size="sm" color={auroraTokens.textDim}>
                实时情绪
              </Text>
              <Text size="lg" weight={600} color={auroraTokens.textHigh}>
                {lastIntentLabel || '等待你的想象'}
              </Text>
            </Stack>
            <RingProgress
              size={120}
              thickness={12}
              sections={[{ value: planCompletion, color: auroraTokens.auroraCyan }]}
              label={
                <Stack spacing={0} align="center">
                  <Text size="xs" color={auroraTokens.textDim}>PLAN</Text>
                  <Text size="lg" weight={700} color={auroraTokens.textHigh}>{planCompletion}%</Text>
                </Stack>
              }
            />
          </Group>
          <Group spacing="xs" mt="sm">
            <IconChartDonut size={16} color={auroraTokens.auroraPurple} />
            <Text size="xs" color={auroraTokens.textDim}>
              计划进度会随着步骤完成而发光
            </Text>
          </Group>
        </Paper>

        {shouldRenderThinkingCard ? (
          <ThinkingProcess events={activeThinkingEvents} isProcessing={isThinking} maxHeight={260} />
        ) : (
          renderPlaceholderCard('思考轨迹', showThinking ? '暂无思考记录，开始下一个指令吧。' : '已隐藏 AI 内部思考，可随时重新打开。')
        )}

        {shouldRenderPlanCard ? (
          <ExecutionPlanDisplay plan={activePlan} />
        ) : (
          renderPlaceholderCard('执行计划', '等待新的 Aurora 计划，一旦触发会在这里展开。')
        )}
      </SimpleGrid>

      <Paper p="lg" radius="xl" sx={auroraCardStyles(theme)}>
        <Group position="apart" mb="md" align="flex-start">
          <Stack spacing={2}>
            <Text size="sm" color="dimmed">🎯 霓虹预设</Text>
            <Text size="lg" weight={600} color={auroraTokens.textHigh}>
              直接点亮一个场景，或先清空会话。
            </Text>
          </Stack>
          <Button variant="subtle" size="xs" onClick={handleClear} leftIcon={<IconBolt size={14} />}>
            重置当前会话
          </Button>
        </Group>
        <SimpleGrid cols={4} spacing="sm" breakpoints={[
          { maxWidth: 'lg', cols: 2 },
          { maxWidth: 'sm', cols: 1 }
        ]}>
          {QUICK_ACTIONS.map((action) => (
            <Paper
              key={action.id}
              component="button"
              type="button"
              onClick={() => handleSendMessage(action.prompt)}
              aria-label={action.title}
              sx={{
                ...auroraCardStyles(theme),
                cursor: sessionBusy ? 'not-allowed' : 'pointer',
                pointerEvents: sessionBusy ? 'none' : 'auto',
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: 'rgba(255,255,255,0.12)',
                padding: '16px',
                textAlign: 'left',
                background: 'rgba(10, 16, 30, 0.75)',
                ...motionStyles,
                ...(motionEnabled
                  ? {
                      '&:hover': { transform: 'translateY(-6px)', borderColor: auroraTokens.auroraPurple }
                    }
                  : {})
              }}
            >
              <Stack spacing={6}>
                <Group spacing="xs">
                  <Text size="lg">{action.icon}</Text>
                  <Text weight={600} color={auroraTokens.textHigh}>{action.title}</Text>
                </Group>
                <Text size="sm" color={auroraTokens.textDim}>{action.description}</Text>
              </Stack>
            </Paper>
          ))}
        </SimpleGrid>
      </Paper>

      <Paper
        p="lg"
        radius="xl"
        sx={{
          ...auroraCardStyles(theme),
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0
        }}
      >
        <Group position="apart" mb="sm">
          <Text size="sm" color="dimmed">🗂️ 会话日志</Text>
          <Badge color="blue" variant="light">
            {activeMessages.length} 条记录
          </Badge>
        </Group>
        <ScrollArea style={{ flex: 1 }} offsetScrollbars>
          <Stack spacing="md">
            {activeMessages.length === 0 && (
              <Paper p="lg" radius="lg" sx={auroraCardStyles(theme)}>
                <Text size="sm" color={auroraTokens.textDim}>
                  "告诉我你想让画面呼吸的方式，比如'一个光影极简的封面'。"
                </Text>
              </Paper>
            )}

            {activeMessages.map((message) => (
              <Box
                key={message.id}
                sx={{
                  borderRadius: 24,
                  padding: '16px',
                  border: `1px solid rgba(255,255,255,0.08)`,
                  background: message.role === 'user'
                    ? 'linear-gradient(135deg, rgba(143,123,255,0.28), rgba(77,214,255,0.15))'
                    : 'rgba(255,255,255,0.04)',
                  boxShadow: '0 15px 40px rgba(0,0,0,0.45)',
                  backdropFilter: 'blur(18px)',
                  ...motionStyles,
                  ...(motionEnabled
                    ? {
                        '&:hover': {
                          transform: 'translateY(-4px)'
                        }
                      }
                    : {})
                }}
              >
                <Group position="apart" mb="xs">
                  <Text size="sm" weight={500} color={auroraTokens.textHigh}>
                    {message.role === 'user' ? '你' : 'Nano Banana Pro'}
                  </Text>
                  <Text size="xs" color={auroraTokens.textDim}>
                    {message.timestamp.toLocaleTimeString()}
                  </Text>
                </Group>

                <Text size="sm" color={auroraTokens.textHigh}>{message.content}</Text>

                {message.plan && message.plan.length > 0 && (
                  <Collapse in label="查看执行计划" mt="sm">
                    <Stack spacing="xs">
                      {message.plan.map((step, index) => (
                        <Text key={index} size="xs" color={auroraTokens.textDim}>
                          {index + 1}. {step}
                        </Text>
                      ))}
                    </Stack>
                  </Collapse>
                )}

                {message.intent && (
                  <Group mt="xs" spacing="xs">
                    <Badge size="xs" color="blue">
                      意图: {describeIntent(message.intent.type)}
                    </Badge>
                    <Badge size="xs" color={message.intent.confidence > 0.8 ? 'green' : 'yellow'}>
                      置信度: {(message.intent.confidence * 100).toFixed(0)}%
                    </Badge>
                  </Group>
                )}
              </Box>
            ))}

            {(isLoading || isThinking) && (
              <Group spacing="xs">
                <IconLoader size={16} className="loading-spin" />
                <Text size="sm" color={auroraTokens.textDim}>
                  {isIntelligentMode ? 'AI 正在编排 Aurora 计划...' : 'AI 正在处理你的请求...'}
                </Text>
                <Badge size="xs" color={isEventStreamConnected ? 'teal' : 'red'} variant="light">
                  {isEventStreamConnected ? '实时同步' : '等待连接'}
                </Badge>
              </Group>
            )}
          </Stack>
        </ScrollArea>
      </Paper>

      <Paper p="md" radius="xl" sx={auroraCardStyles(theme)}>
        <form onSubmit={handleSubmit}>
          <Group>
            <TextInput
              ref={inputRef}
              style={{ flex: 1 }}
              placeholder={
                isIntelligentMode
                  ? '描述你想营造的氛围，例如"生成沉浸式封面"'
                  : '输入你的想法...'
              }
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              disabled={sessionBusy}
            />
            <Tooltip label="发送消息 (Enter)">
              <ActionIcon
                type="submit"
                size="lg"
                color={isIntelligentMode ? 'violet' : 'blue'}
                disabled={sessionBusy || !input.trim()}
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
