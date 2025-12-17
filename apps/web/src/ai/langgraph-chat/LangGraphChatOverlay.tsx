import { useStream } from '@langchain/langgraph-sdk/react'
import type { Message } from '@langchain/langgraph-sdk'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Collapse,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  Timeline,
  Title,
  Tooltip,
  useMantineColorScheme,
} from '@mantine/core'
import {
  IconAlertCircle,
  IconBolt,
  IconBrain,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCircleCheck,
  IconCircleDashedCheck,
  IconCopy,
  IconDiamond,
  IconDots,
  IconGift,
  IconMoodSmile,
  IconPlayerStop,
  IconPhoto,
  IconRefresh,
  IconRocket,
  IconSend,
  IconSparkles,
  IconTrash,
  IconUser,
  IconX,
} from '@tabler/icons-react'
import ReactMarkdown from 'react-markdown'
import { useUIStore } from '../../ui/uiStore'
import { functionHandlers } from '../canvasService'
import { useRFStore } from '../../canvas/store'
import { buildCanvasContext } from '../../canvas/utils/buildCanvasContext'
import {
  clearLangGraphProjectThread,
  clearLangGraphProjectSnapshot,
  getLangGraphProjectSnapshot,
  getLangGraphProjectThread,
  getPublicLangGraphProjectThread,
  setLangGraphProjectSnapshot,
  setLangGraphProjectThread,
} from '../../api/server'

type ProcessedEvent = {
  title: string
  data: any
}

type ToolCallPayload = {
  id?: string
  name?: string
  arguments?: any
}

type QuickReply = {
  label: string
  input: string
}

type TapcanvasActionsPayload = {
  title?: string
  actions?: Array<{ label?: string; input?: string }>
}

type RoleMeta = {
  roleId?: string
  roleName?: string
  roleReason?: string
}

const LAST_SUBMIT_STORAGE_PREFIX = 'tapcanvas:langgraph:lastSubmit:'

function getLastSubmitStorageKey(projectId: string) {
  return `${LAST_SUBMIT_STORAGE_PREFIX}${projectId}`
}

function persistLastSubmit(projectId: string, values: any) {
  try {
    window.localStorage.setItem(
      getLastSubmitStorageKey(projectId),
      JSON.stringify({ savedAt: Date.now(), values }),
    )
  } catch {
    // ignore (best-effort)
  }
}

function loadLastSubmit(projectId: string): any | null {
  try {
    const raw = window.localStorage.getItem(getLastSubmitStorageKey(projectId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.values ?? null
  } catch {
    return null
  }
}

function clearLastSubmit(projectId: string) {
  try {
    window.localStorage.removeItem(getLastSubmitStorageKey(projectId))
  } catch {
    // ignore
  }
}

function isLikelyTransientLangGraphError(err: any, message: string) {
  const status = err?.status ?? err?.response?.status
  if (status === 404) return false
  if (typeof status === 'number' && [408, 425, 429, 500, 502, 503, 504].includes(status)) return true

  const msg = String(message || err?.message || '').toLowerCase()
  if (!msg) return false
  return (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('econnreset') ||
    msg.includes('aborted') ||
    msg.includes('not ready') ||
    msg.includes('cold start') ||
    msg.includes('gateway') ||
    msg.includes('temporarily unavailable')
  )
}

const parseRoleMetaFromMessage = (message: Message): RoleMeta => {
  const anyMsg = message as any
  const carrier =
    anyMsg?.additional_kwargs ??
    anyMsg?.kwargs ??
    anyMsg?.metadata ??
    anyMsg
  const roleId =
    typeof carrier?.active_role === 'string' ? carrier.active_role : undefined
  const roleName =
    typeof carrier?.active_role_name === 'string'
      ? carrier.active_role_name
      : typeof carrier?.role_name === 'string'
        ? carrier.role_name
        : undefined
  const roleReason =
    typeof carrier?.active_role_reason === 'string'
      ? carrier.active_role_reason
      : typeof carrier?.role_reason === 'string'
        ? carrier.role_reason
        : undefined
  return { roleId, roleName, roleReason }
}

const parseToolCallsFromMessage = (message: Message): ToolCallPayload[] => {
  const anyMsg = message as any
  const raw =
    anyMsg?.additional_kwargs?.tool_calls ??
    anyMsg?.tool_calls ??
    anyMsg?.kwargs?.tool_calls ??
    anyMsg?.metadata?.tool_calls
  if (!raw) return []
  if (Array.isArray(raw)) return raw as ToolCallPayload[]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as ToolCallPayload[]) : []
    } catch {
      return []
    }
  }
  return []
}

const parseJsonIfNeeded = (value: any) => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return value ?? {}
}

const WORKFLOW_QUICK_REPLIES: QuickReply[] = [
  {
    label: '角色创建主流程',
    input:
      '我想做一个原创IP主角。请先帮我在画布里创建「角色设定主视觉」image 节点并生成：\n' +
      '- 角色：可爱但有辨识度（请给出可复现的外观要点）\n' +
      '- 风格：日系动画/治愈暖色/干净线稿+赛璐璐\n' +
      '生成完成后，再基于该角色做一张九宫格分镜图（image 节点），最后生成 15s 视频（composeVideo，参考九宫格）。',
  },
  {
    label: '直接生图主流程',
    input:
      '帮我直接生成一张图片：\n' +
      '- 主题：冬日咖啡馆的温暖治愈插画海报\n' +
      '- 风格：日系动画、干净线稿、柔和赛璐璐、暖色光影\n' +
      '- 画面：人物/构图你来把控，但要有主视觉冲击力\n' +
      '请在画布创建 image 节点并运行。',
  },
  {
    label: '衍生品创建主流程',
    input:
      '基于我画布里现有的角色/图片，帮我做 3 种衍生品方向，并分别生成预览图：\n' +
      '1) 贴纸套装（3张）\n' +
      '2) 钥匙扣/挂件（2张）\n' +
      '3) 海报/封面（1张）\n' +
      '要求：保持角色一致性与同一风格。请创建对应 image 节点（需要参考就把上游图连进来）并运行。',
  },
]

const parseQuickRepliesFromMessage = (message: Message, fallbackText?: string): QuickReply[] => {
  const anyMsg = message as any
  const raw =
    anyMsg?.additional_kwargs?.quick_replies ??
    anyMsg?.quick_replies ??
    anyMsg?.kwargs?.quick_replies ??
    anyMsg?.metadata?.quick_replies

  const normalize = (items: any): QuickReply[] => {
    if (!Array.isArray(items)) return []
    const result: QuickReply[] = []
    items.forEach((item: any) => {
      const label = typeof item?.label === 'string' ? item.label.trim() : ''
      const input = typeof item?.input === 'string' ? item.input : ''
      if (!label || !input.trim()) return
      result.push({ label, input })
    })
    return result.slice(0, 6)
  }

  if (raw) {
    if (Array.isArray(raw)) return normalize(raw)
    if (typeof raw === 'string') {
      try {
        return normalize(JSON.parse(raw))
      } catch {
        return []
      }
    }
  }

  const text = (fallbackText || '').trim()
  if (!text) return []
  const hasWorkflowHints = ['角色创建主流程', '直接生图主流程', '衍生品创建主流程'].some((k) => text.includes(k))
  if (!hasWorkflowHints) return []
  return WORKFLOW_QUICK_REPLIES
}

const renderContentText = (content: Message['content']): string => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    content.forEach((part) => {
      if (!part) return
      if (typeof (part as any).text === 'string') {
        parts.push((part as any).text)
        return
      }
      if (typeof (part as any).content === 'string') {
        parts.push((part as any).content)
        return
      }
      try {
        parts.push(JSON.stringify(part))
      } catch {
        // ignore
      }
    })
    return parts.join('\n')
  }
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

const parseTapcanvasActionsFromText = (
  text: string,
): { cleanedText: string; payload: TapcanvasActionsPayload } | null => {
  const marker = '\ntapcanvas_actions'
  const idx = text.indexOf(marker)
  if (idx === -1) return null

  const tail = text.slice(idx + marker.length)
  const brace = tail.indexOf('{')
  if (brace === -1) return null
  const jsonText = tail.slice(brace).trim()

  try {
    const payload = JSON.parse(jsonText) as TapcanvasActionsPayload
    const cleanedText = text.slice(0, idx).trim()
    return { cleanedText, payload }
  } catch {
    return null
  }
}

function pickPrimaryMediaFromNode(node: any): {
  nodeId: string
  label: string | null
  kind: string | null
  imageUrl: string | null
  videoUrl: string | null
  videoThumbnailUrl: string | null
} {
  const nodeId = String(node?.id || '')
  const data: any = node?.data || {}
  const label = typeof data?.label === 'string' && data.label.trim() ? data.label.trim() : null
  const kind = typeof data?.kind === 'string' && data.kind.trim() ? data.kind.trim() : null

  const imageResults: any[] = Array.isArray(data?.imageResults) ? data.imageResults : []
  const imagePrimaryIndex =
    typeof data?.imagePrimaryIndex === 'number' && Number.isFinite(data.imagePrimaryIndex)
      ? data.imagePrimaryIndex
      : 0
  const imageFromField =
    typeof data?.imageUrl === 'string' && data.imageUrl.trim() ? data.imageUrl.trim() : null
  const imageFromResults =
    typeof imageResults?.[imagePrimaryIndex]?.url === 'string' && imageResults[imagePrimaryIndex].url.trim()
      ? imageResults[imagePrimaryIndex].url.trim()
      : typeof imageResults?.[0]?.url === 'string' && imageResults[0].url.trim()
        ? imageResults[0].url.trim()
        : null
  const imageUrl = imageFromField || imageFromResults

  const videoResults: any[] = Array.isArray(data?.videoResults) ? data.videoResults : []
  const videoPrimaryIndex =
    typeof data?.videoPrimaryIndex === 'number' && Number.isFinite(data.videoPrimaryIndex)
      ? data.videoPrimaryIndex
      : 0
  const videoFromField =
    typeof data?.videoUrl === 'string' && data.videoUrl.trim() ? data.videoUrl.trim() : null
  const videoFromResults =
    typeof videoResults?.[videoPrimaryIndex]?.url === 'string' && videoResults[videoPrimaryIndex].url.trim()
      ? videoResults[videoPrimaryIndex].url.trim()
      : typeof videoResults?.[0]?.url === 'string' && videoResults[0].url.trim()
        ? videoResults[0].url.trim()
        : null
  const videoUrl = videoFromField || videoFromResults

  const videoThumb =
    (typeof videoResults?.[videoPrimaryIndex]?.thumbnailUrl === 'string' && videoResults[videoPrimaryIndex].thumbnailUrl.trim()
      ? videoResults[videoPrimaryIndex].thumbnailUrl.trim()
      : null) ||
    (typeof videoResults?.[0]?.thumbnailUrl === 'string' && videoResults[0].thumbnailUrl.trim()
      ? videoResults[0].thumbnailUrl.trim()
      : null) ||
    (typeof data?.videoThumbnailUrl === 'string' && data.videoThumbnailUrl.trim()
      ? data.videoThumbnailUrl.trim()
      : null) ||
    (typeof data?.thumbnailUrl === 'string' && data.thumbnailUrl.trim() ? data.thumbnailUrl.trim() : null)

  return { nodeId, label, kind, imageUrl, videoUrl, videoThumbnailUrl: videoThumb }
}

function ActivityTimeline({
  events,
  isLoading,
}: {
  events: ProcessedEvent[]
  isLoading: boolean
}) {
  const { colorScheme } = useMantineColorScheme()
  const isLight = colorScheme === 'light'
  const items = events.length ? events : []
  return (
    <Timeline
      bulletSize={18}
      lineWidth={2}
      color="gray"
      styles={{
        itemTitle: { color: isLight ? 'var(--mantine-color-text)' : '#fff' },
        itemBody: { color: isLight ? 'var(--mantine-color-dimmed)' : 'rgba(255,255,255,0.75)', fontSize: 12 },
      }}
    >
      {items.map((item, index) => (
        <Timeline.Item
          key={`${item.title}-${index}`}
          title={item.title}
          bullet={<IconCircleCheck size={14} />}
        >
          <Text size="xs" c="dimmed">
            {typeof item.data === 'string'
              ? item.data
              : Array.isArray(item.data)
                ? item.data.join(', ')
                : JSON.stringify(item.data)}
          </Text>
        </Timeline.Item>
      ))}
      {isLoading && (
        <Timeline.Item
          title={items.length ? '继续分析' : '准备中'}
          bullet={<Loader size={12} type="dots" color="gray" />}
        >
          <Text size="xs" c="dimmed">
            研究进行中…
          </Text>
        </Timeline.Item>
      )}
    </Timeline>
  )
}

function MessageBubble({
  message,
  align,
  activity,
  isLive,
  isLoading,
  readOnly,
  nodesById,
  nodeIdByLabel,
  toolCallBindings,
  onCopy,
  copied,
  onPickQuickReply,
}: {
  message: Message
  align: 'left' | 'right'
  activity?: ProcessedEvent[]
  isLive: boolean
  isLoading: boolean
  readOnly: boolean
  nodesById: Map<string, any>
  nodeIdByLabel: Map<string, string>
  toolCallBindings: Record<string, string>
  onCopy: (text: string, id?: string) => void
  copied: boolean
  onPickQuickReply: (input: string) => void
}) {
  const text = renderContentText(message.content)
  const { colorScheme } = useMantineColorScheme()
  const isLight = colorScheme === 'light'
  const isHuman = message.type === 'human'
  const parsedTapActions = useMemo(() => parseTapcanvasActionsFromText(text), [text])
  const displayText = parsedTapActions?.cleanedText ?? text
  const bubbleBg = isHuman
    ? isLight
      ? 'rgba(15,23,42,0.04)'
      : 'rgba(255,255,255,0.06)'
    : isLight
      ? 'rgba(255,255,255,0.92)'
      : 'rgba(255,255,255,0.04)'
  const bubbleBorder = isHuman
    ? isLight
      ? '1px solid rgba(59,130,246,0.18)'
      : '1px solid rgba(255,255,255,0.10)'
    : isLight
      ? '1px solid rgba(15,23,42,0.08)'
      : '1px solid rgba(255,255,255,0.06)'
  const bubbleTextColor = isLight ? 'var(--mantine-color-text)' : '#f5f7ff'
  const subPanelBg = isLight ? 'rgba(15,23,42,0.03)' : 'rgba(255,255,255,0.04)'
  const subPanelBgTight = isLight ? 'rgba(15,23,42,0.028)' : 'rgba(255,255,255,0.035)'
  const subPanelBgThin = isLight ? 'rgba(15,23,42,0.022)' : 'rgba(255,255,255,0.03)'
  const subPanelBorder = isLight ? '1px solid rgba(15,23,42,0.08)' : '1px solid rgba(255,255,255,0.06)'
  const subPanelBorderThin = isLight ? '1px solid rgba(15,23,42,0.07)' : '1px solid rgba(255,255,255,0.05)'
  const roleMeta = useMemo(() => parseRoleMetaFromMessage(message), [message])
  const toolCalls = useMemo(() => parseToolCallsFromMessage(message), [message])
  const quickReplies = useMemo(() => parseQuickRepliesFromMessage(message, text), [message, text])
  const [activityOpen, setActivityOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const activityPreview = useMemo(() => {
    if (!activity || !activity.length) return ''
    const titles = activity
      .map((e) => (typeof e?.title === 'string' ? e.title.trim() : ''))
      .filter(Boolean)
      .slice(0, 4)
    const suffix = activity.length > titles.length ? ` +${activity.length - titles.length}` : ''
    return titles.length ? `${titles.join(' · ')}${suffix}` : `${activity.length} 项`
  }, [activity])
  const toolsPreview = useMemo(() => {
    if (!toolCalls.length) return ''
    const items = toolCalls.slice(0, 3).map((call) => {
      const args = parseJsonIfNeeded(call.arguments) || {}
      const name = call.name || 'tool'
      const label = typeof args?.label === 'string' ? args.label : undefined
      const nodeId = typeof args?.nodeId === 'string' ? args.nodeId : undefined
      const type = typeof args?.type === 'string' ? args.type : undefined
      const title = label || nodeId || type || ''
      return title ? `${name}:${title}` : name
    })
    const suffix = toolCalls.length > items.length ? ` +${toolCalls.length - items.length}` : ''
    return `${items.join(' · ')}${suffix}`
  }, [toolCalls])

  const toolPreviewMedia = useMemo(() => {
    if (isHuman) return []
    if (!toolCalls.length) return []
    const results: Array<{ url: string; openUrl: string }> = []
    for (const call of toolCalls) {
      if (results.length >= 2) break
      const args = parseJsonIfNeeded((call as any).arguments) || {}
      const label = typeof args?.label === 'string' ? args.label : undefined
      const nodeId = typeof args?.nodeId === 'string' ? args.nodeId : undefined
      const toolCallId = typeof (call as any).id === 'string' ? (call as any).id : ''
      const resolvedNodeId =
        nodeId ||
        (toolCallId && toolCallBindings[toolCallId]) ||
        (label && nodeIdByLabel.get(label)) ||
        ''
      if (!resolvedNodeId) continue
      const node = nodesById.get(String(resolvedNodeId))
      if (!node) continue
      const media = pickPrimaryMediaFromNode(node)
      const thumb = media.videoThumbnailUrl || media.imageUrl
      const openUrl = media.videoUrl || media.imageUrl
      if (!thumb || !openUrl) continue
      results.push({ url: thumb, openUrl })
    }
    return results
  }, [isHuman, nodeIdByLabel, nodesById, toolCallBindings, toolCalls])

  return (
    <Stack align={align === 'right' ? 'flex-end' : 'flex-start'} gap={6} w="100%">
      <Group gap="xs" justify={align === 'right' ? 'flex-end' : 'flex-start'}>
        <Text size="xs" c="dimmed">
          {isHuman ? '你' : '助手'}
        </Text>
        {!isHuman && roleMeta.roleName && (
          <Tooltip
            label={roleMeta.roleReason || roleMeta.roleId || ''}
            disabled={!roleMeta.roleReason && !roleMeta.roleId}
            withArrow
          >
            <Badge
              color="grape"
              variant="light"
              size="xs"
              style={{ cursor: roleMeta.roleReason || roleMeta.roleId ? 'help' : 'default' }}
            >
              {roleMeta.roleName}
            </Badge>
          </Tooltip>
        )}
      </Group>
      <Paper
        p="md"
        radius="lg"
        shadow="md"
        style={{
          maxWidth: '88%',
          minWidth: 0,
          alignSelf: align === 'right' ? 'flex-end' : 'flex-start',
          background: bubbleBg,
          border: bubbleBorder,
          color: bubbleTextColor,
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
        }}
      >
        {activity && activity.length > 0 && (
          <Paper
            p="sm"
            radius="md"
            mb="sm"
            style={{ background: subPanelBg, border: subPanelBorder }}
          >
            <Group gap="xs" justify="space-between">
              <Group gap={6}>
                <IconBrain size={14} />
                <Text size="xs" fw={600}>
                  研究进展
                </Text>
              </Group>
              <Group gap={6}>
                {isLive && isLoading && <Loader size="xs" color="gray" type="dots" />}
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="gray"
                  aria-label={activityOpen ? '收起执行过程' : '展开执行过程'}
                  onClick={() => setActivityOpen((v) => !v)}
                >
                  {activityOpen ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                </ActionIcon>
              </Group>
            </Group>
            {!activityOpen && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {activityPreview || '—'}
              </Text>
            )}
            <Collapse in={activityOpen} transitionDuration={150}>
              <ActivityTimeline events={activity} isLoading={isLive && isLoading} />
            </Collapse>
          </Paper>
        )}
        {!isHuman && toolCalls.length > 0 && (
          <Paper
            p="sm"
            radius="md"
            mb="sm"
            style={{ background: subPanelBgTight, border: subPanelBorder }}
          >
            <Group gap="xs" justify="space-between" mb={6}>
              <Group gap={6}>
                <IconBolt size={14} />
                <Text size="xs" fw={600}>
                  画布操作
                </Text>
              </Group>
              <Group gap={6}>
                <Badge size="xs" variant="light" color="blue">
                  {toolCalls.length}
                </Badge>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="gray"
                  aria-label={toolsOpen ? '收起执行过程' : '展开执行过程'}
                  onClick={() => setToolsOpen((v) => !v)}
                >
                  {toolsOpen ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                </ActionIcon>
              </Group>
            </Group>
            {!toolsOpen && (
              <>
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {toolsPreview || '—'}
                </Text>
                {toolPreviewMedia.length > 0 && (
                  <Group gap={8} mt={6} wrap="nowrap">
                    {toolPreviewMedia.map((m) => (
                      <img
                        key={m.url}
                        src={m.url}
                        alt=""
                        loading="lazy"
                        style={{
                          width: 88,
                          height: 50,
                          borderRadius: 10,
                          objectFit: 'cover',
                          cursor: 'pointer',
                          flex: '0 0 auto',
                        }}
                        onClick={() => {
                          try {
                            window.open(m.openUrl, '_blank', 'noopener,noreferrer')
                          } catch {
                            window.location.href = m.openUrl
                          }
                        }}
                      />
                    ))}
                  </Group>
                )}
              </>
            )}
            <Collapse in={toolsOpen} transitionDuration={150}>
              <Stack gap={8}>
                {toolCalls.map((call, idx) => {
                  const args = parseJsonIfNeeded(call.arguments) || {}
                  const name = call.name || 'tool'
                  const label = typeof args?.label === 'string' ? args.label : undefined
                  const nodeId = typeof args?.nodeId === 'string' ? args.nodeId : undefined
                  const type = typeof args?.type === 'string' ? args.type : undefined
                  const config = args?.config && typeof args.config === 'object' ? args.config : undefined
                  const prompt =
                    typeof config?.prompt === 'string' ? config.prompt : undefined
	                  const negativePrompt =
	                    typeof config?.negativePrompt === 'string' ? config.negativePrompt : undefined
	                  const displayTitle = label || nodeId || type || ''
	                  const hasPrompt = Boolean(prompt && prompt.trim())
	                  const hasNegative = Boolean(negativePrompt && negativePrompt.trim())
	                  const toolCallId = typeof call.id === 'string' ? call.id : ''
	                  const resolvedNodeId =
	                    nodeId ||
	                    (toolCallId && toolCallBindings[toolCallId]) ||
	                    (label && nodeIdByLabel.get(label)) ||
	                    ''
	                  const resolvedNode = resolvedNodeId ? nodesById.get(String(resolvedNodeId)) : null
	                  const media = resolvedNode ? pickPrimaryMediaFromNode(resolvedNode) : null
	                  const hasMedia = Boolean(media && (media.imageUrl || media.videoUrl))

                  return (
                    <Paper
                      key={`${call.id || name}-${idx}`}
                      p="xs"
                      radius="md"
                      style={{ background: subPanelBgThin, border: subPanelBorderThin }}
                    >
                      <Group gap="xs" justify="space-between">
                        <Group gap="xs">
                          <Badge size="xs" color="grape" variant="light">
                            {name}
                          </Badge>
                          {displayTitle && (
                            <Text size="xs" c="dimmed">
                              {displayTitle}
                            </Text>
                          )}
                        </Group>
                        {hasPrompt && (
                          <Tooltip label={copied ? '已复制' : '复制提示词'}>
                            <ActionIcon
                              variant="subtle"
                              color="gray"
                              onClick={() => onCopy(String(prompt), call.id)}
                            >
                              <IconCopy size={14} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </Group>
                      {hasPrompt && (
                        <Text size="xs" mt={6} style={{ whiteSpace: 'pre-wrap', opacity: 0.95 }}>
                          {String(prompt)}
                        </Text>
                      )}
	                      {hasNegative && (
	                        <Text size="xs" mt={6} c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
	                          负面：{String(negativePrompt)}
	                        </Text>
	                      )}
	                      {hasMedia && media && (
	                        <div style={{ marginTop: 8 }}>
	                          <img
	                            src={media.videoThumbnailUrl || media.imageUrl || ''}
	                            alt=""
	                            loading="lazy"
	                            style={{
	                              width: '100%',
	                              borderRadius: 10,
	                              display: 'block',
	                              objectFit: 'cover',
	                              aspectRatio: '16 / 9',
	                              cursor: 'pointer',
	                            }}
	                            onClick={() => {
	                              const url = media.videoUrl || media.imageUrl
	                              if (!url) return
	                              try {
	                                window.open(url, '_blank', 'noopener,noreferrer')
	                              } catch {
	                                window.location.href = url
	                              }
	                            }}
	                          />
	                          {media.videoUrl && (
	                            <Text size="xs" c="dimmed" mt={6} lineClamp={1}>
	                              视频已生成
	                            </Text>
	                          )}
	                        </div>
	                      )}
                    </Paper>
                  )
                })}
              </Stack>
            </Collapse>
          </Paper>
        )}
        <ReactMarkdown
          components={{
            h1: ({ children }) => <Title order={3}>{children}</Title>,
            h2: ({ children }) => <Title order={4}>{children}</Title>,
            p: ({ children }) => (
              <Text size="sm" fw={400} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                {children}
              </Text>
            ),
            ul: ({ children }) => <Stack gap={4} style={{ paddingLeft: 16, maxWidth: '100%' }}>{children}</Stack>,
            li: ({ children }) => (
              <Text size="sm" component="div" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                • {children}
              </Text>
            ),
            a: ({ children, href }) => (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                style={{
                  color: isLight ? 'var(--mantine-color-anchor)' : '#8ad1ff',
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word',
                }}
              >
                {children}
              </a>
            ),
            code: ({ children }) => (
              <code style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                {children}
              </code>
            ),
            pre: ({ children }) => (
              <pre
                style={{
                  maxWidth: '100%',
                  overflowX: 'auto',
                  margin: '8px 0',
                  padding: 12,
                  borderRadius: 10,
                  background: isLight ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.05)',
                  border: isLight ? '1px solid rgba(15,23,42,0.08)' : '1px solid rgba(255,255,255,0.08)',
                }}
              >
                {children}
              </pre>
            ),
          }}
        >
          {displayText || '…'}
        </ReactMarkdown>
        {!isHuman && parsedTapActions?.payload?.actions?.length ? (
          <Group gap="xs" mt="sm" wrap="wrap">
            {parsedTapActions.payload.actions
              .map((a) => ({
                label: typeof a?.label === 'string' ? a.label.trim() : '',
                input: typeof a?.input === 'string' ? a.input : '',
              }))
              .filter((a) => a.label && a.input.trim())
              .slice(0, 8)
              .map((a) => (
                <Button
                  key={a.label}
                  size="xs"
                  variant="light"
                  disabled={readOnly}
                  onClick={() => onPickQuickReply(a.input)}
                >
                  {a.label}
                </Button>
              ))}
          </Group>
        ) : null}
        {!isHuman && quickReplies.length > 0 && (
          <Group gap="xs" mt="sm" wrap="wrap">
            {quickReplies.map((qr) => (
              <Button
                key={qr.label}
                size="xs"
                variant="light"
                onClick={() => onPickQuickReply(qr.input)}
              >
                {qr.label}
              </Button>
            ))}
          </Group>
        )}
        <Group justify="flex-end" gap="xs" mt="xs">
          <Tooltip label={copied ? '已复制' : '复制'}>
            <ActionIcon
              variant="subtle"
              size="sm"
              aria-label="复制"
              onClick={() => onCopy(text, message.id)}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </Paper>
    </Stack>
  )
}

function ChatMessagesView({
  messages,
  isLoading,
  liveEvents,
  historicalEvents,
  readOnly,
  nodesById,
  nodeIdByLabel,
  toolCallBindings,
  onCopy,
  copiedId,
  onPickQuickReply,
}: {
  messages: Message[]
  isLoading: boolean
  liveEvents: ProcessedEvent[]
  historicalEvents: Record<string, ProcessedEvent[]>
  readOnly: boolean
  nodesById: Map<string, any>
  nodeIdByLabel: Map<string, string>
  toolCallBindings: Record<string, string>
  onCopy: (text: string, id?: string) => void
  copiedId: string | null
  onPickQuickReply: (input: string) => void
}) {
  const { colorScheme } = useMantineColorScheme()
  const isLight = colorScheme === 'light'
  const loadingBg = isLight ? 'rgba(15,23,42,0.03)' : 'rgba(255,255,255,0.04)'
  const loadingBorder = isLight ? '1px solid rgba(15,23,42,0.08)' : '1px solid rgba(255,255,255,0.06)'
  return (
    <Stack gap="lg">
      {messages.map((msg, index) => {
        const isLast = index === messages.length - 1
        const isAssistant = msg.type === 'ai'
        const activity = isAssistant
          ? isLast && isLoading
            ? liveEvents
            : historicalEvents[msg.id || '']
          : undefined
        return (
          <MessageBubble
            key={msg.id || `${msg.type}-${index}`}
            message={msg}
            align={msg.type === 'human' ? 'right' : 'left'}
            activity={activity}
            isLive={isAssistant && isLast}
            isLoading={isAssistant && isLoading}
            readOnly={readOnly}
            nodesById={nodesById}
            nodeIdByLabel={nodeIdByLabel}
            toolCallBindings={toolCallBindings}
            onCopy={onCopy}
            copied={copiedId === (msg.id || '')}
            onPickQuickReply={onPickQuickReply}
          />
        )
      })}
      {isLoading && (messages.length === 0 || messages[messages.length - 1]?.type === 'human') && (
        <Paper
          radius="lg"
          p="md"
          style={{
            background: loadingBg,
            border: loadingBorder,
          }}
        >
          {liveEvents.length ? (
            <ActivityTimeline events={liveEvents} isLoading />
          ) : (
            <Group gap="xs">
              <Loader size="sm" type="dots" color="gray" />
              <Text size="sm">处理中…</Text>
            </Group>
          )}
        </Paper>
      )}
    </Stack>
  )
}

function InputForm({
  onSubmit,
  onRetry,
  onCancel,
  isLoading,
  hasHistory,
  blocked,
  prefill,
  readOnly,
  retryDisabled,
}: {
  onSubmit: (input: string, effort: string) => void
  onRetry?: () => void
  onCancel: () => void
  isLoading: boolean
  hasHistory: boolean
  blocked?: boolean
  prefill?: string | null
  readOnly?: boolean
  retryDisabled?: boolean
}) {
  const [value, setValue] = useState('')
  const effort = 'medium'
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const appliedPrefillRef = useRef<string | null>(null)

  useEffect(() => {
    if (readOnly) return
    if (!prefill || !prefill.trim()) return
    if (appliedPrefillRef.current === prefill) return
    if (value.trim()) return
    appliedPrefillRef.current = prefill
    setValue(prefill)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [prefill, readOnly, value])

  const disabled = !!blocked || !!readOnly || !value.trim() || isLoading

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (disabled) return
    onSubmit(value, effort)
    setValue('')
  }

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="xs">
        <Group align="flex-start" gap="sm">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            placeholder={readOnly ? '只读分享页：不能发送消息' : '描述你想在画布里生成的图片/视频（一句话也可以）…'}
            autosize
            minRows={2}
            maxRows={6}
            style={{ flex: 1 }}
            disabled={!!blocked || !!readOnly}
          />
          {!readOnly &&
            (isLoading ? (
              <Button
                color="red"
                variant="light"
                leftSection={<IconPlayerStop size={16} />}
                onClick={onCancel}
              >
                停止
              </Button>
            ) : (
              <Group gap="xs" wrap="nowrap">
                <Tooltip label={retryDisabled ? '暂无可重试的请求' : '重试上一次请求'}>
                  <ActionIcon
                    variant="subtle"
                    size="lg"
                    aria-label="重试"
                    onClick={onRetry}
                    disabled={!!retryDisabled}
                  >
                    <IconRefresh size={18} />
                  </ActionIcon>
                </Tooltip>
                <Button
                  type="submit"
                  variant="gradient"
                  gradient={{ from: 'indigo', to: 'cyan' }}
                  leftSection={<IconSend size={16} />}
                  disabled={disabled}
                >
                  发送
                </Button>
              </Group>
            ))}
        </Group>
      </Stack>
    </form>
  )
}

function WelcomeCard({ onPickWorkflow }: { onPickWorkflow: (prompt: string) => void }) {
  const { colorScheme } = useMantineColorScheme()
  const isLight = colorScheme === 'light'
  return (
    <Paper
      radius="lg"
      p="xl"
      withBorder
      style={{
        background: isLight
          ? 'radial-gradient(circle at 20% 20%, rgba(92,122,255,0.18), transparent 45%), rgba(255,255,255,0.86)'
          : 'radial-gradient(circle at 20% 20%, rgba(92,122,255,0.15), transparent 40%), rgba(13,16,28,0.9)',
        borderColor: isLight ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.08)',
      }}
    >
      <Stack gap="xs">
        <Group gap="sm">
          <IconRocket size={18} />
          <Text fw={700}>小T</Text>
          <Badge color="violet" variant="light">Beta</Badge>
        </Group>
        <Text c="dimmed" size="sm">
          在画布里直接提需求：我会自动创建/连接节点并生成结果。需要细节时再展开“执行过程”查看步骤。
        </Text>
        <Divider my="sm" label="选择一个开始" labelPosition="left" />
        <Stack gap="sm">
          {[
            { label: '角色创建主流程', desc: '先定主角 IP 与风格，再做分镜与视频', icon: <IconUser size={16} /> },
            { label: '直接生图主流程', desc: '一句话立刻出图（可继续生成视频）', icon: <IconPhoto size={16} /> },
            { label: '衍生品创建主流程', desc: '基于现有图/视频做延展与变体', icon: <IconGift size={16} /> },
          ].map((wf) => {
            const prompt = WORKFLOW_QUICK_REPLIES.find((r) => r.label === wf.label)?.input || ''
            return (
            <Paper
              key={wf.label}
              p="sm"
              radius="md"
              withBorder
              style={{
                cursor: 'pointer',
                background: isLight ? 'rgba(15,23,42,0.03)' : 'rgba(255,255,255,0.03)',
                borderColor: isLight ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.08)',
              }}
              onClick={() => onPickWorkflow(prompt)}
            >
              <Group justify="space-between" gap="sm" wrap="nowrap">
                <Group gap="sm" wrap="nowrap">
                  <Badge color="grape" variant="light" leftSection={wf.icon}>
                    {wf.label}
                  </Badge>
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {wf.desc}
                  </Text>
                </Group>
                <IconChevronDown size={16} style={{ opacity: 0.6 }} />
              </Group>
            </Paper>
          )})}
        </Stack>
        <Divider my="sm" />
        <Group gap="xs">
          <Badge color="blue" leftSection={<IconSparkles size={12} />}>自动画布操作</Badge>
          <Badge color="grape" leftSection={<IconDiamond size={12} />}>步骤可追溯</Badge>
          <Badge color="teal" leftSection={<IconCircleDashedCheck size={12} />}>结果可复用</Badge>
        </Group>
      </Stack>
    </Paper>
  )
}

function CanvasNodesPreview() {
  return null
}

type LangGraphChatOverlayInnerProps = {
  open: boolean
  close: () => void
  apiUrl: string
  projectId: string | null
  viewOnly: boolean
  nodes: any[]
  edges: any[]
  onReset: () => void
}

function LangGraphChatOverlayInner({
  open,
  close,
  apiUrl,
  projectId,
  viewOnly,
  nodes,
  edges,
  onReset,
}: LangGraphChatOverlayInnerProps) {
  const { colorScheme } = useMantineColorScheme()
  const isLight = colorScheme === 'light'
  const [processedEventsTimeline, setProcessedEventsTimeline] = useState<ProcessedEvent[]>([])
  const [historicalActivities, setHistoricalActivities] = useState<Record<string, ProcessedEvent[]>>({})
  const [error, setError] = useState<string | null>(null)
  const hasFinalizeEventOccurredRef = useRef(false)
  const scrollViewportRef = useRef<HTMLDivElement | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const handledToolCallsRef = useRef(new Set<string>())
  const persistedThreadIdRef = useRef<string | null>(null)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [threadIdLoaded, setThreadIdLoaded] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [prefill, setPrefill] = useState<string | null>(null)
  const [quickStartOpen, setQuickStartOpen] = useState(false)
  const lastSubmitValuesRef = useRef<any | null>(null)
  const recoveringThreadRef = useRef(false)
  const lastStreamErrorRef = useRef<any>(null)
  const autoRetryRef = useRef<{ key: string | null; attempts: number; timer: number | null }>({
    key: null,
    attempts: 0,
    timer: null,
  })
	  const toolExecutionArmedRef = useRef(false)
	  const lastSubmittedHumanIdRef = useRef<string | null>(null)
	  const [frozenMessages, setFrozenMessages] = useState<Message[]>([])
	  const [toolCallBindings, setToolCallBindings] = useState<Record<string, string>>({})
	  const langGraphReadyRef = useRef<{ apiUrl: string; readyAt: number } | null>(null)
	  const langGraphReadyPromiseRef = useRef<Promise<boolean> | null>(null)

	  const ensureLangGraphReady = useCallback(async () => {
	    const cached = langGraphReadyRef.current
	    const now = Date.now()
	    if (cached && cached.apiUrl === apiUrl && now - cached.readyAt < 60_000) return true
	    if (langGraphReadyPromiseRef.current) return langGraphReadyPromiseRef.current

	    const baseUrl = String(apiUrl || '').replace(/\/+$/, '')
	    const attempt = async (): Promise<boolean> => {
	      const endpoints = [`${baseUrl}/ok`, `${baseUrl}/health`, `${baseUrl}/`]
	      for (let i = 0; i < 3; i++) {
	        for (const url of endpoints) {
	          try {
	            const controller = new AbortController()
	            const timeout = setTimeout(() => controller.abort(), 1500)
	            const res = await fetch(url, {
	              method: 'GET',
	              credentials: 'include',
	              signal: controller.signal,
	            }).finally(() => clearTimeout(timeout))

	            // Any non-5xx response proves the service is up (and warms cold starts).
	            if (res.status < 500) {
	              langGraphReadyRef.current = { apiUrl, readyAt: Date.now() }
	              return true
	            }
	          } catch {
	            // try next endpoint / retry
	          }
	        }
	        await new Promise((r) => setTimeout(r, 250 + i * 350))
	      }
	      return false
	    }

	    const promise = attempt().finally(() => {
	      langGraphReadyPromiseRef.current = null
	    })
	    langGraphReadyPromiseRef.current = promise
	    return promise
	  }, [apiUrl])

	  useEffect(() => {
	    if (open) return
	    langGraphReadyRef.current = null
	    langGraphReadyPromiseRef.current = null
	  }, [open])

  useEffect(() => {
    if (!open) return
    if (!projectId) {
      setThreadId(null)
      persistedThreadIdRef.current = null
      setThreadIdLoaded(true)
      setFrozenMessages([])
      return
    }

    let cancelled = false
    const controller = new AbortController()
    setThreadIdLoaded(false)
    void (async () => {
      try {
        const res = viewOnly
          ? await getPublicLangGraphProjectThread(projectId)
          : await getLangGraphProjectThread(projectId)
        if (cancelled) return
        const loadedThreadId = res.threadId
        if (loadedThreadId) {
          try {
            const ready = await ensureLangGraphReady()
            if (!ready) throw new Error('LangGraph not ready')
            const check = await fetch(`${apiUrl}/threads/${loadedThreadId}`, {
              method: 'GET',
              credentials: 'include',
              signal: controller.signal,
            })
            if (check.status === 404) {
              if (!viewOnly) await clearLangGraphProjectThread(projectId)
              setThreadId(null)
              persistedThreadIdRef.current = null
              setThreadIdLoaded(true)
              return
            }
          } catch {
            // If the check fails (network/CORS), fall back to optimistic use of the stored thread.
          }
        }
        setThreadId(loadedThreadId)
        persistedThreadIdRef.current = loadedThreadId
        setThreadIdLoaded(true)
      } catch (err) {
        if (cancelled) return
        setThreadId(null)
        persistedThreadIdRef.current = null
        setThreadIdLoaded(true)
        setError(err instanceof Error ? err.message : 'load thread failed')
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [apiUrl, open, projectId, viewOnly])

  useEffect(() => {
    if (!open) return
    if (!projectId) return
    if (viewOnly) return
    let cancelled = false
    void (async () => {
      try {
        const res = await getLangGraphProjectSnapshot(projectId)
        if (cancelled) return
        const raw = res?.snapshot?.messagesJson
        if (!raw || typeof raw !== 'string') return
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length) {
          setFrozenMessages(parsed as Message[])
        }
      } catch {
        // ignore (snapshot is best-effort)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, projectId, viewOnly])

  useEffect(() => {
    if (!open) return
    if (!projectId) return
    if (viewOnly) return
    if (lastSubmitValuesRef.current) return
    const restored = loadLastSubmit(projectId)
    if (!restored) return
    if (!Array.isArray(restored?.messages) || restored.messages.length === 0) return
    lastSubmitValuesRef.current = restored
  }, [open, projectId, viewOnly])

  const thread = useStream<{
    messages: Message[]
    initial_search_query_count: number
    max_research_loops: number
    reasoning_model: string
    canvas_context?: any
  }>({
    apiUrl,
    assistantId: 'agent',
    messagesKey: 'messages',
    threadId,
    onThreadId: (tid) => {
      if (viewOnly) return
      setThreadId(tid)
      if (!projectId) return
      if (persistedThreadIdRef.current === tid) return
      void setLangGraphProjectThread(projectId, tid)
        .then(() => {
          persistedThreadIdRef.current = tid
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'persist thread failed')
        })
    },
    onUpdateEvent: (event: any) => {
      let processedEvent: ProcessedEvent | null = null
      if (event?.generate_query) {
        processedEvent = {
          title: '生成搜索 Query',
          data: event.generate_query?.search_query?.join(', ') || '',
        }
      } else if (event?.web_research) {
        const sources = event.web_research.sources_gathered || []
        const numSources = sources.length
        const uniqueLabels = [...new Set(sources.map((s: any) => s.label).filter(Boolean))]
        const exampleLabels = uniqueLabels.slice(0, 3).join(', ')
        processedEvent = {
          title: 'Web Research',
          data: `Gathered ${numSources} sources. Related to: ${exampleLabels || 'N/A'}.`,
        }
      } else if (event?.reflection) {
        processedEvent = { title: 'Reflection', data: 'Analysing research results' }
      } else if (event?.finalize_answer) {
        processedEvent = { title: 'Finalizing Answer', data: 'Composing the final reply' }
        hasFinalizeEventOccurredRef.current = true
      }
      if (processedEvent) {
        setProcessedEventsTimeline((prev) => [...prev, processedEvent!])
      }
    },
    onError: (err: any) => {
      lastStreamErrorRef.current = err
      const msg = err?.message || String(err || 'unknown error')
      setError(msg || 'unknown error')
    },
  })

  useEffect(() => {
    return () => {
      const t = autoRetryRef.current.timer
      if (t) window.clearTimeout(t)
      autoRetryRef.current.timer = null
    }
  }, [])

  useEffect(() => {
    if (viewOnly) return
    if (!projectId) return
    if (!error) return
    if (thread.isLoading) return
    if (blocked) return
    if (recoveringThreadRef.current) return
    const err = lastStreamErrorRef.current
    if (!isLikelyTransientLangGraphError(err, error)) return

    const values = lastSubmitValuesRef.current
    if (!values || !Array.isArray(values.messages) || values.messages.length === 0) return
    const lastMsg = values.messages[values.messages.length - 1]
    const key = `${projectId}:${String(lastMsg?.id ?? '')}:${String(err?.status ?? err?.response?.status ?? '')}:${String(error)}`

    if (autoRetryRef.current.key !== key) {
      const prevTimer = autoRetryRef.current.timer
      if (prevTimer) window.clearTimeout(prevTimer)
      autoRetryRef.current = { key, attempts: 0, timer: null }
    }
    if (autoRetryRef.current.attempts >= 2) return

    const submittedHumanId = lastSubmittedHumanIdRef.current
    if (submittedHumanId) {
      const live = (thread.messages || []) as any[]
      const idx = live.findIndex((m) => String(m?.id ?? '') === String(submittedHumanId))
      if (idx >= 0 && live.slice(idx + 1).some((m) => m?.type === 'ai')) return
    }

    autoRetryRef.current.attempts += 1
    const attempt = autoRetryRef.current.attempts
    const delayMs = 800 + (attempt - 1) * 1200
    setError(null)

    autoRetryRef.current.timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (thread.isLoading) return
          if (blocked) return
          if (viewOnly) return

          const latest = lastSubmitValuesRef.current
          if (!latest || !Array.isArray(latest.messages) || latest.messages.length === 0) return

          void thread.stop()

          const ready = await ensureLangGraphReady()
          if (!ready) {
            setError('LangGraph 服务未就绪（可能冷启动）。请稍后点“重试”。')
            return
          }

          const canvas_context = buildCanvasContext(nodes, edges)
          const retryValues = { ...latest, canvas_context }
          lastSubmitValuesRef.current = retryValues
          persistLastSubmit(projectId, retryValues)
          try {
            void setLangGraphProjectSnapshot(projectId, {
              threadId,
              messagesJson: JSON.stringify(latest.messages),
            }).catch(() => {})
          } catch {
            // ignore
          }
          thread.submit(retryValues)
        } catch (e: any) {
          setError(e?.message || 'auto retry failed')
        }
      })()
    }, delayMs)
  }, [blocked, edges, ensureLangGraphReady, error, nodes, projectId, recoveringThreadRef, thread, thread.isLoading, thread.messages, threadId, viewOnly])

  useEffect(() => {
    const live = (thread.messages || []) as Message[]
    if (live.length > 0) setFrozenMessages(live)
  }, [thread.messages])

  useEffect(() => {
    // Clear bindings when switching projects/threads.
    setToolCallBindings({})
  }, [projectId, threadId])

  useEffect(() => {
    if (viewOnly) return
    if (!projectId) return
    if (thread.isLoading) return
    const live = (thread.messages || []) as Message[]
    if (!live.length) return
    const last = live[live.length - 1]
    if (!last || last.type !== 'ai') return
    try {
      void setLangGraphProjectSnapshot(projectId, {
        threadId,
        messagesJson: JSON.stringify(live),
      }).catch(() => {})
    } catch {
      // ignore
    }
  }, [projectId, thread.isLoading, thread.messages, threadId, viewOnly])

  useEffect(() => {
    if (viewOnly) return
    const err = lastStreamErrorRef.current
    if (!err) return
    if (recoveringThreadRef.current) return

    const msg = err?.message || String(err || '')
    const looksLikeMissingThread =
      err?.status === 404 ||
      err?.response?.status === 404 ||
      /\b404\b/.test(msg) ||
      /thread.*not.*found/i.test(msg)
    if (!looksLikeMissingThread) return

    recoveringThreadRef.current = true
    // Silent recovery: do not show reconnect/retry content in the chat UI.
    setError(null)
    void (async () => {
      try {
        void thread.stop()
        if (projectId) await clearLangGraphProjectThread(projectId)
        persistedThreadIdRef.current = null
        setThreadId(null)
      } catch (e: any) {
        setError(e?.message || msg)
      } finally {
        lastStreamErrorRef.current = null
        recoveringThreadRef.current = false
      }
    })()
  }, [projectId, thread, viewOnly])

  const liveMessages = (thread.messages || []) as Message[]
  const messages = liveMessages.length > 0 ? liveMessages : frozenMessages
  const blocked = !!projectId && !threadIdLoaded

  const maybeAutoLayoutAfterTools = useCallback((focusNodeId?: string | null) => {
    try {
      if (viewOnly) return
      if (thread.isLoading) return
      const handler = (functionHandlers as any)?.smartLayout || (functionHandlers as any)?.formatAll
      if (typeof handler !== 'function') return
      void handler(focusNodeId ? { focusNodeId } : undefined).catch(() => {})
    } catch {
      // ignore
    }
  }, [thread.isLoading, viewOnly])

  useEffect(() => {
    if (viewOnly) return
    if (!messages.length) return
    if (!toolExecutionArmedRef.current) return
    const submittedHumanId = lastSubmittedHumanIdRef.current
    if (!submittedHumanId) return
    const submittedIndex = messages.findIndex((m) => m?.id === submittedHumanId)
    if (submittedIndex < 0) return
    const last = messages[messages.length - 1]
    if (!last || last.type !== 'ai') return
    if (messages.length - 1 <= submittedIndex) return
    const toolCalls = parseToolCallsFromMessage(last)
    if (!toolCalls.length) {
      // No tools to run; disarm so we don't keep scanning forever.
      toolExecutionArmedRef.current = false
      lastSubmittedHumanIdRef.current = null
      return
    }

    let cancelled = false
    const run = async () => {
      let lastCreatedNodeId: string | null = null
      let didConnect = false
      for (const call of toolCalls) {
        if (cancelled) return
        const toolCallId = typeof call.id === 'string' ? call.id : ''
        const toolName = typeof call.name === 'string' ? call.name : ''
        if (!toolName) continue
        if (toolCallId && handledToolCallsRef.current.has(toolCallId)) continue

        const handler = (functionHandlers as any)[toolName]
        if (typeof handler !== 'function') {
          console.warn('[LangGraphChatOverlay] handler not found', toolName, call)
          if (toolCallId) handledToolCallsRef.current.add(toolCallId)
          continue
        }

        try {
          const input = parseJsonIfNeeded(call.arguments)
          const res = await handler(input)
          if (toolName === 'createNode' && res?.data?.nodeId) {
            lastCreatedNodeId = String(res.data.nodeId)
          }
          if (toolName === 'connectNodes') {
            didConnect = true
          }

          // Bind this tool call to a nodeId so the chat UI can render node media directly.
          try {
            if (toolCallId) {
              const fromInput =
                typeof (input as any)?.nodeId === 'string' && (input as any).nodeId.trim()
                  ? String((input as any).nodeId).trim()
                  : ''
              const fromResult =
                res?.data?.nodeId != null && String(res.data.nodeId).trim()
                  ? String(res.data.nodeId).trim()
                  : ''
              const boundNodeId = fromInput || fromResult
              if (boundNodeId) {
                setToolCallBindings((prev) => (prev[toolCallId] === boundNodeId ? prev : { ...prev, [toolCallId]: boundNodeId }))
              }
            }
          } catch {
            // ignore
          }

          setProcessedEventsTimeline((prev) => [
            ...prev,
            { title: 'Canvas Tool', data: `${toolName}` },
          ])
        } catch (err) {
          console.warn('[LangGraphChatOverlay] tool execution failed', toolName, err)
          setProcessedEventsTimeline((prev) => [
            ...prev,
            {
              title: 'Canvas Tool Failed',
              data: `${toolName}: ${err instanceof Error ? err.message : 'unknown error'}`,
            },
          ])
        } finally {
          if (toolCallId) handledToolCallsRef.current.add(toolCallId)
        }
      }

      if (!cancelled && (lastCreatedNodeId || didConnect)) {
        setTimeout(() => maybeAutoLayoutAfterTools(lastCreatedNodeId), 50)
      }

      // Mark tool execution complete for this submit.
      toolExecutionArmedRef.current = false
      lastSubmittedHumanIdRef.current = null
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [messages, viewOnly, maybeAutoLayoutAfterTools])

  useEffect(() => {
    if (scrollViewportRef.current) {
      scrollViewportRef.current.scrollTop = scrollViewportRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    if (hasFinalizeEventOccurredRef.current && !thread.isLoading && messages.length > 0) {
      const last = messages[messages.length - 1]
      if (last && last.type === 'ai' && last.id) {
        setHistoricalActivities((prev) => ({
          ...prev,
          [last.id!]: [...processedEventsTimeline],
        }))
      }
      hasFinalizeEventOccurredRef.current = false
    }
  }, [messages, thread.isLoading, processedEventsTimeline])

  const handleSubmit = useCallback(
		    (input: string, effort: string) => {
		      if (blocked) return
		      if (viewOnly) return
		      if (!input.trim()) return
		      setQuickStartOpen(false)
		      setProcessedEventsTimeline([])
		      hasFinalizeEventOccurredRef.current = false
		      setError(null)
		      let initial_search_query_count = 0
		      let max_research_loops = 0
	      switch (effort) {
        case 'low':
          initial_search_query_count = 1
          max_research_loops = 1
          break
        case 'medium':
          initial_search_query_count = 3
          max_research_loops = 3
          break
        case 'high':
          initial_search_query_count = 5
          max_research_loops = 10
          break
        default:
          initial_search_query_count = 3
          max_research_loops = 3
      }

	      const newMessages: Message[] = [
	        ...liveMessages,
	        {
	          type: 'human',
	          content: input,
	          id: Date.now().toString(),
	        },
	      ]
	      void (async () => {
	        try {
	          setFrozenMessages(newMessages)
	          lastSubmittedHumanIdRef.current = newMessages[newMessages.length - 1]?.id || null
	          toolExecutionArmedRef.current = true
	          const canvas_context = buildCanvasContext(nodes, edges)
	          const values = {
	            messages: newMessages,
	            initial_search_query_count,
	            max_research_loops,
	            canvas_context,
	          }
	          lastSubmitValuesRef.current = values
            if (projectId) {
              persistLastSubmit(projectId, values)
              try {
                void setLangGraphProjectSnapshot(projectId, {
                  threadId,
                  messagesJson: JSON.stringify(newMessages),
                }).catch(() => {})
              } catch {
                // ignore
              }
            }

	          const ready = await ensureLangGraphReady()
	          if (!ready) {
	            setError('LangGraph 服务未就绪（可能冷启动）。请稍后点“重试”。')
	            toolExecutionArmedRef.current = false
	            lastSubmittedHumanIdRef.current = null
	            return
	          }

	          thread.submit(values)
	        } catch (err: any) {
	          setError(err?.message || 'submit failed')
	        }
	      })()
	    },
	    [blocked, edges, ensureLangGraphReady, liveMessages, nodes, projectId, thread, threadId, viewOnly],
	  )

  const handleCancel = useCallback(() => {
    void thread.stop()
  }, [thread])

  const handleClear = useCallback(async () => {
    if (thread.isLoading) return
    if (viewOnly) return
    setError(null)
    // Close the confirm modal immediately after user confirms.
    setClearConfirmOpen(false)
    try {
      void thread.stop()
      if (projectId) {
        await clearLangGraphProjectThread(projectId)
        await clearLangGraphProjectSnapshot(projectId)
        clearLastSubmit(projectId)
      }
      onReset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'clear failed')
    } finally {
      setClearConfirmOpen(false)
    }
  }, [projectId, onReset, thread, viewOnly])

  const handleCopy = useCallback((text: string, id?: string) => {
    try {
      void navigator.clipboard.writeText(text)
      setCopiedId(id || null)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      // ignore
    }
  }, [])

  const displayMessages = useMemo(() => {
    const list = (messages || []) as any[]
    return list.filter((m) => {
      const t = m?.type
      if (t !== 'human' && t !== 'ai') return false
      const c = m?.content
      return typeof c === 'string' || Array.isArray(c)
    }) as Message[]
  }, [messages])

  const lastHumanInput = useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const msg = displayMessages[i]
      if (msg?.type === 'human') {
        const text = renderContentText(msg.content)
        return typeof text === 'string' ? text : ''
      }
    }
    return ''
  }, [displayMessages])

  const handleRetry = useCallback(() => {
    if (thread.isLoading) return
    if (blocked) return
    if (viewOnly) return
    const prev = lastSubmitValuesRef.current
    if (prev && Array.isArray(prev.messages) && prev.messages.length) {
      setQuickStartOpen(false)
      setProcessedEventsTimeline([])
      hasFinalizeEventOccurredRef.current = false
      setError(null)
      void (async () => {
        try {
          const ready = await ensureLangGraphReady()
          if (!ready) {
            setError('LangGraph 服务未就绪（可能冷启动）。请稍后再试。')
            return
          }
          const canvas_context = buildCanvasContext(nodes, edges)
          const lastMsg = prev.messages[prev.messages.length - 1]
          lastSubmittedHumanIdRef.current = lastMsg?.type === 'human' ? (lastMsg?.id ? String(lastMsg.id) : null) : null
          toolExecutionArmedRef.current = true
          const values = { ...prev, canvas_context }
          lastSubmitValuesRef.current = values
          if (projectId) {
            persistLastSubmit(projectId, values)
            try {
              void setLangGraphProjectSnapshot(projectId, {
                threadId,
                messagesJson: JSON.stringify(prev.messages),
              }).catch(() => {})
            } catch {
              // ignore
            }
          }
          thread.submit(values)
        } catch (err: any) {
          setError(err?.message || 'retry failed')
        }
      })()
      return
    }
    if (!lastHumanInput.trim()) return
    handleSubmit(lastHumanInput, 'medium')
  }, [blocked, edges, ensureLangGraphReady, handleSubmit, lastHumanInput, nodes, projectId, thread, threadId, viewOnly])

  // Backward-compatible alias (older dev builds referenced this name).
  const showWelcome = !viewOnly && displayMessages.length === 0
  const showEmptyViewOnly = viewOnly && displayMessages.length === 0

  const nodesById = useMemo(() => {
    const map = new Map<string, any>()
    ;(nodes || []).forEach((n: any) => {
      if (!n) return
      map.set(String(n.id), n)
    })
    return map
  }, [nodes])

  const nodeIdByLabel = useMemo(() => {
    const map = new Map<string, string>()
    ;(nodes || []).forEach((n: any) => {
      const lbl = (n as any)?.data?.label
      if (typeof lbl !== 'string') return
      const key = lbl.trim()
      if (!key) return
      if (map.has(key)) return
      map.set(key, String((n as any).id))
    })
    return map
  }, [nodes])

  return (
    <>
      <Modal
        opened={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        centered
        title="清空对话记忆？"
        overlayProps={{ blur: 2, opacity: 0.35 }}
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            该项目仅允许一个会话；清空后将从零开始新的对话记忆。
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setClearConfirmOpen(false)}>
              取消
            </Button>
            <Button color="red" onClick={() => void handleClear()} disabled={viewOnly || blocked || thread.isLoading}>
              清空
            </Button>
          </Group>
        </Stack>
      </Modal>
    <Modal
      opened={open}
      onClose={close}
      radius="lg"
      padding={0}
      fullScreen
      withinPortal={false}
      zIndex={120}
      trapFocus={false}
      returnFocus={false}
      lockScroll={false}
      overlayProps={{
        opacity: 0,
        blur: 0,
        style: { pointerEvents: 'none' },
      }}
      styles={{
        header: { display: 'none' },
        inner: { padding: 0, alignItems: 'stretch', height: '100vh' },
        content: {
          margin: 0,
          width: '100%',
          maxWidth: '100%',
          height: '100%',
          background: 'transparent',
          boxShadow: 'none',
          pointerEvents: 'none',
        },
        body: { padding: 0, height: '100%' },
      }}
    >
      <div
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          bottom: 16,
          width: 'min(480px, calc(100vw - 32px))',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            pointerEvents: 'auto',
          }}
        >
          <Group justify="space-between" align="center">
            <Group gap="sm">
              <IconSparkles size={18} />
              <Text fw={700}>小T</Text>
              {blocked && (
                <Badge color="gray" variant="light" leftSection={<Loader size={12} type="dots" color="gray" />}>
                  加载项目会话…
                </Badge>
              )}
            </Group>
	            <Group gap="xs">
	              {error && (
	                <Group gap={6}>
	                  <IconAlertCircle size={16} color="red" />
	                  <Text size="sm" c="red">
	                    {error}
	                  </Text>
	                </Group>
	              )}
	              {!viewOnly && (
	                <Tooltip label="快速开始" position="bottom" withArrow>
	                  <ActionIcon
	                    variant="subtle"
	                    aria-label="快速开始"
	                    onClick={() => setQuickStartOpen((v) => !v)}
	                    disabled={blocked || thread.isLoading}
	                  >
	                    <IconRocket size={18} />
	                  </ActionIcon>
	                </Tooltip>
	              )}
	              <Tooltip label="清空对话记忆（项目级）" position="bottom" withArrow>
	                <ActionIcon
	                  variant="subtle"
	                  aria-label="清空对话"
	                  onClick={() => setClearConfirmOpen(true)}
                  disabled={viewOnly || blocked || thread.isLoading}
                >
                  <IconTrash size={18} />
                </ActionIcon>
              </Tooltip>
              <ActionIcon variant="subtle" aria-label="关闭" onClick={close}>
                <IconX size={18} />
              </ActionIcon>
            </Group>
          </Group>

          <Paper
            shadow="xl"
            radius="lg"
            p="lg"
            style={{
              background: isLight
                ? 'radial-gradient(circle at 15% 10%, rgba(59,130,246,0.12), transparent 55%), linear-gradient(135deg, rgba(255,255,255,0.92), rgba(241,246,255,0.92))'
                : 'linear-gradient(135deg, rgba(27,32,55,0.72), rgba(12,14,24,0.82))',
              border: isLight ? '1px solid rgba(15,23,42,0.12)' : '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(10px)',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              gap: 16,
              minHeight: 0,
            }}
          >
            <Stack gap="md" style={{ flex: 1, minHeight: 0 }}>
              {!viewOnly && (
                <Collapse in={quickStartOpen} transitionDuration={150}>
                  <WelcomeCard onPickWorkflow={(prompt) => setPrefill(prompt)} />
                </Collapse>
              )}
              {showEmptyViewOnly && (
                <Paper withBorder radius="md" p="md" style={{ borderStyle: 'dashed' }}>
                  <Stack gap={6}>
                    <Text fw={600}>暂无创作过程记录</Text>
                    <Text size="sm" c="dimmed">
                      如果你在本地开发（例如 `localhost:5173`），可能因为 LangGraph CORS 仅放行线上域名导致无法拉取历史。
                    </Text>
                  </Stack>
                </Paper>
              )}
              <ScrollArea
                type="never"
                offsetScrollbars={false}
                viewportRef={scrollViewportRef}
                styles={{ viewport: { overflowX: 'hidden' } }}
                style={{ flex: 1, minHeight: 0, maxHeight: '100%' }}
              >
                <div style={{ paddingRight: 8 }}>
	                  <ChatMessagesView
	                    messages={displayMessages}
	                    isLoading={thread.isLoading}
	                    liveEvents={processedEventsTimeline}
	                    historicalEvents={historicalActivities}
	                    readOnly={viewOnly}
	                    nodesById={nodesById}
	                    nodeIdByLabel={nodeIdByLabel}
	                    toolCallBindings={toolCallBindings}
	                    onCopy={handleCopy}
	                    copiedId={copiedId}
	                    onPickQuickReply={(input) => setPrefill(input)}
	                  />
                </div>
              </ScrollArea>
              <Divider />
              <InputForm
                onSubmit={handleSubmit}
                onRetry={handleRetry}
                onCancel={handleCancel}
                isLoading={thread.isLoading}
                hasHistory={displayMessages.length > 0}
                blocked={blocked}
                prefill={prefill}
                readOnly={viewOnly}
                retryDisabled={
                  !!blocked || !!viewOnly || thread.isLoading || !displayMessages.length || !lastHumanInput.trim()
                }
              />
            </Stack>
          </Paper>

        </div>
      </div>
    </Modal>
    </>
  )
}

export function LangGraphChatOverlay() {
  const open = useUIStore((s) => s.langGraphChatOpen)
  const close = useUIStore((s) => s.closeLangGraphChat)
  const projectId = useUIStore((s) => (s.currentProject?.id ? String(s.currentProject.id) : null))
  const viewOnly = useUIStore((s) => s.viewOnly)
  const nodes = useRFStore((s) => s.nodes)
  const edges = useRFStore((s) => s.edges)
  const [resetCounter, setResetCounter] = useState(0)

  const apiUrl = useMemo(() => {
    const env = (import.meta as any).env || {}
    const explicit = env?.VITE_LANGGRAPH_API_URL || env?.VITE_LANGGRAPH_API_BASE
    if (explicit) return String(explicit)
    return env?.DEV ? 'http://localhost:2024' : 'https://ai.beqlee.icu'
  }, [])

  return (
    <LangGraphChatOverlayInner
      key={`${projectId || 'no-project'}:${resetCounter}`}
      open={open}
      close={close}
      apiUrl={apiUrl}
      projectId={projectId}
      viewOnly={viewOnly}
      nodes={nodes as any[]}
      edges={edges as any[]}
      onReset={() => setResetCounter((v) => v + 1)}
    />
  )
}

export default LangGraphChatOverlay
