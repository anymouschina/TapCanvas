import React, { useState, useEffect, useCallback } from 'react'
import {
  Stack,
  Paper,
  Text,
  Group,
  Badge,
  Button,
  Timeline,
  Progress,
  Divider,
  ScrollArea,
  ActionIcon,
  Tooltip,
  Collapse,
  Box,
  useMantineTheme
} from '@mantine/core'
import { useReducedMotion } from '@mantine/hooks'
import {
  IconBrain,
  IconBulb,
  IconAdjustments,
  IconRocket,
  IconCheck,
  IconX,
  IconClock,
  IconAlertTriangle,
  IconCircleCheck,
  IconCircle,
  IconChevronDown,
  IconChevronUp,
  IconSparkles
} from '@tabler/icons-react'
import type { ThinkingEvent, PlanUpdatePayload } from '../../types/canvas-intelligence'
import { subscribeToolEvents, extractThinkingEvent, extractPlanUpdate } from '../../api/toolEvents'
import { getAuthToken } from '../../auth/store'
import { API_BASE } from '../../api/server'

const auroraTokens = {
  base: '#03060d',
  card: 'rgba(10, 16, 30, 0.82)',
  border: 'rgba(255, 255, 255, 0.08)',
  textHigh: '#EEF3FF',
  textDim: '#9AA6C9',
  auroraPurple: '#8F7BFF',
  auroraCyan: '#4DD6FF',
  auroraCoral: '#FF7A6A',
  success: '#5CF2C2',
  warning: '#FFD166'
}

const auroraCardStyles = (theme: ReturnType<typeof useMantineTheme>) => ({
  background: auroraTokens.card,
  borderRadius: theme.radius.xl,
  border: `1px solid ${auroraTokens.border}`,
  boxShadow: '0 25px 65px rgba(0,0,0,0.45)',
  backdropFilter: 'blur(26px)',
  position: 'relative',
  overflow: 'hidden'
})

interface ThinkingProcessProps {
  events: ThinkingEvent[]
  isProcessing: boolean
  maxHeight?: number
}

export const ThinkingProcess: React.FC<ThinkingProcessProps> = ({
  events,
  isProcessing,
  maxHeight = 400
}) => {
  const [collapsed, setCollapsed] = React.useState(true)
  const theme = useMantineTheme()
  const prefersReducedMotion = useReducedMotion()
  const motionStyles = prefersReducedMotion ? { transition: 'none' } : { transition: 'transform 360ms cubic-bezier(0.16, 1, 0.3, 1)' }

  const getThinkingIcon = (type: ThinkingEvent['type']) => {
    const iconMap = {
      intent_analysis: IconBulb,
      planning: IconRocket,
      reasoning: IconBrain,
      decision: IconAdjustments,
      execution: IconClock,
      result: IconCheck
    }
    const Icon = iconMap[type] || IconBrain
    return <Icon size={16} />
  }

const getThinkingColor = (type: ThinkingEvent['type']) => {
  const colorMap = {
    intent_analysis: 'blue',
    planning: 'green',
    reasoning: 'orange',
    decision: 'teal',
    execution: 'yellow',
    result: 'cyan'
  }
  return colorMap[type] || 'gray'
}

  const getThinkingTitle = (type: ThinkingEvent['type']) => {
    const titleMap = {
      intent_analysis: '意图分析',
      planning: '规划制定',
      reasoning: '推理思考',
      decision: '决策制定',
      execution: '执行操作',
      result: '结果反馈'
    }
    return titleMap[type] || '思考过程'
  }

  return (
    <Paper p="lg" radius="xl" sx={auroraCardStyles(theme)}>
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at 10% 20%, rgba(255,255,255,0.08), transparent 45%)',
          pointerEvents: 'none'
        }}
      />
      <Group position="apart" mb="md" sx={{ position: 'relative', zIndex: 1 }}>
        <Stack spacing={2}>
          <Group spacing="xs">
            <IconBrain size={18} color={auroraTokens.auroraCyan} />
            <Text weight={600} color={auroraTokens.textHigh}>思考轨迹</Text>
          </Group>
          <Text size="sm" color={auroraTokens.textDim}>
            {events.length === 0 && !isProcessing
              ? '暂无记录，等待新的灵感。'
              : '记录每一步推理与决策，便于追溯。'}
          </Text>
        </Stack>
        <Group spacing="xs">
          <Badge color="violet" variant="light">
            {events.length} 步
          </Badge>
          {isProcessing && (
            <Badge color="teal" variant="dot">
              深度思考中
            </Badge>
          )}
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? '展开思考过程' : '收起思考过程'}
          >
            {collapsed ? <IconChevronDown size={14} /> : <IconChevronUp size={14} />}
          </ActionIcon>
        </Group>
      </Group>

      <Collapse in={!collapsed}>
        <ScrollArea.Autosize mah={maxHeight} offsetScrollbars>
          <Timeline bulletSize={20} lineWidth={2}>
            {(events.length === 0 && !isProcessing) && (
              <Timeline.Item bullet={<IconSparkles size={16} />} color="gray">
                <Text size="sm" color={auroraTokens.textDim}>
                  “告诉我想法，我会即刻开始推理。”
                </Text>
              </Timeline.Item>
            )}

            {events.map((event) => (
              <Timeline.Item
                key={event.id}
                bullet={getThinkingIcon(event.type)}
                color={getThinkingColor(event.type)}
              >
                <Paper
                  p="sm"
                  radius="lg"
                  sx={{
                    background: 'rgba(255,255,255,0.02)',
                    border: `1px solid ${auroraTokens.border}`,
                    ...motionStyles,
                    ...(prefersReducedMotion ? {} : { '&:hover': { transform: 'translateY(-4px)' } })
                  }}
                >
                  <Group spacing="xs" align="center" mb="xs">
                    <Text size="sm" weight={500} color={auroraTokens.textHigh}>
                      {getThinkingTitle(event.type)}
                    </Text>
                    {event.metadata?.confidence && (
                      <Badge
                        size="xs"
                        color={event.metadata.confidence > 0.8 ? 'teal' :
                               event.metadata.confidence > 0.6 ? 'yellow' : 'red'}
                      >
                        {(event.metadata.confidence * 100).toFixed(0)}%
                      </Badge>
                    )}
                  </Group>

                  <Text size="xs" color={auroraTokens.textDim}>
                    {event.content}
                  </Text>

                  {event.metadata?.confidence && (
                    <Progress
                      value={event.metadata.confidence * 100}
                      size="xs"
                      mt="xs"
                      color={event.metadata.confidence > 0.8 ? 'teal' :
                             event.metadata.confidence > 0.6 ? 'yellow' : 'red'}
                    />
                  )}

                  {event.metadata?.parameters &&
                   Object.keys(event.metadata.parameters).length > 0 && (
                    <Box mt="xs">
                      <Text size="xs" color={auroraTokens.textDim} mb={4}>
                        关键参数
                      </Text>
                      <Group spacing="xs">
                        {Object.entries(event.metadata.parameters).map(([key, value]) => (
                          <Badge key={key} size="xs" variant="outline" color="gray">
                            {key}: {String(value)}
                          </Badge>
                        ))}
                      </Group>
                    </Box>
                  )}
                </Paper>
              </Timeline.Item>
            ))}

            {isProcessing && (
              <Timeline.Item bullet={<IconClock size={16} />} color="gray">
                <Text size="sm" color={auroraTokens.textDim} italic>
                  正在感知上下文并规划下一步...
                </Text>
              </Timeline.Item>
            )}
          </Timeline>
        </ScrollArea.Autosize>
      </Collapse>
    </Paper>
  )
}

interface ExecutionPlanDisplayProps {
  plan?: PlanUpdatePayload | null
  onStepClick?: (stepId: string) => void
}

const STEP_STATUS_LABEL: Record<string, string> = {
  pending: '待执行',
  in_progress: '执行中',
  completed: '已完成',
  failed: '失败'
}

const STEP_STATUS_COLOR: Record<string, string> = {
  pending: 'gray',
  in_progress: 'yellow',
  completed: 'green',
  failed: 'red'
}

export const ExecutionPlanDisplay: React.FC<ExecutionPlanDisplayProps> = ({
  plan,
  onStepClick
}) => {
  const theme = useMantineTheme()
  const prefersReducedMotion = useReducedMotion()

  if (!plan || !plan.steps || plan.steps.length === 0) {
    return null
  }

  const summary = plan.summary || {}
  const [collapsed, setCollapsed] = useState(true)

  return (
    <Paper p="lg" radius="xl" sx={auroraCardStyles(theme)}>
      <Group position="apart" mb="md">
        <Stack spacing={2}>
          <Group spacing="xs">
            <IconRocket size={18} color={auroraTokens.auroraPurple} />
            <Text weight={600} color={auroraTokens.textHigh}>Aurora 执行计划</Text>
          </Group>
          <Text size="sm" color={auroraTokens.textDim}>
            {summary.explanation || '将语义意图拆解为可执行的多步骤行动。'}
          </Text>
        </Stack>
        <Group spacing="xs">
          <Badge color="cyan" variant="light">
            {plan.steps.length} 步骤
          </Badge>
          {summary.estimatedTime && (
            <Badge color="gray" variant="outline">
              预计 {summary.estimatedTime}s
            </Badge>
          )}
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? '展开执行计划' : '收起执行计划'}
          >
            {collapsed ? <IconChevronDown size={14} /> : <IconChevronUp size={14} />}
          </ActionIcon>
        </Group>
      </Group>

      <Collapse in={!collapsed}>
        {summary.strategy && (
          <Group mb="md" spacing="xs">
            <Text size="xs" color={auroraTokens.textDim}>策略</Text>
            <Badge color="violet" variant="outline">
              {summary.strategy}
            </Badge>
          </Group>
        )}

        <Stack spacing="sm">
          {plan.steps.map((step, index) => {
            const acceptance = (step as any).acceptance || (step as any).acceptanceCriteria
            return (
              <Paper
                key={step.id}
                p="sm"
                radius="lg"
                sx={{
                  border: `1px solid ${auroraTokens.border}`,
                  background: 'rgba(255,255,255,0.02)',
                  cursor: onStepClick ? 'pointer' : 'default',
                  ...(prefersReducedMotion ? {} : {
                    transition: 'transform 320ms cubic-bezier(0.16,1,0.3,1)',
                    '&:hover': { transform: 'translateY(-4px)' }
                  })
                }}
                onClick={() => onStepClick?.(step.id)}
              >
                <Group position="apart" align="flex-start">
                  <Group spacing="sm" align="flex-start">
                    <Badge size="sm" variant="filled" color="dark" radius="sm">
                      {String(index + 1).padStart(2, '0')}
                    </Badge>
                    <div>
                      <Text size="sm" weight={500} color={auroraTokens.textHigh}>
                        {step.name}
                      </Text>
                      <Text size="xs" color={auroraTokens.textDim}>
                        {step.description}
                      </Text>
                      {step.reasoning && (
                        <Text size="xs" color={auroraTokens.textDim}>
                          {step.reasoning}
                        </Text>
                      )}
                      {acceptance && acceptance.length > 0 && (
                        <Stack gap={4} mt={6}>
                          {acceptance.map((item: string) => (
                            <Group key={item} spacing={6} align="flex-start">
                              {step.status === 'completed' ? (
                                <IconCircleCheck size={14} color={auroraTokens.success} />
                              ) : (
                                <IconCircle size={14} color={auroraTokens.textDim} />
                              )}
                              <Text size="xs" color={auroraTokens.textDim}>
                                {item}
                              </Text>
                            </Group>
                          ))}
                        </Stack>
                      )}
                    </div>
                  </Group>
                  <Badge
                    color={STEP_STATUS_COLOR[step.status] || 'gray'}
                    variant="light"
                  >
                    {STEP_STATUS_LABEL[step.status] || step.status}
                  </Badge>
                </Group>
              </Paper>
            )
          })}
        </Stack>
      </Collapse>
    </Paper>
  )
}

interface IntelligentAssistantProps {
  userId: string
  onSendMessage?: (message: string, options?: any) => void
  height?: string
}

export const IntelligentAssistant: React.FC<IntelligentAssistantProps> = ({
  userId,
  onSendMessage,
  height = '600px'
}) => {
  const [thinkingEvents, setThinkingEvents] = useState<ThinkingEvent[]>([])
  const [currentPlan, setCurrentPlan] = useState<PlanUpdatePayload | null>(null)
  const [isThinking, setIsThinking] = useState(false)
  const [isEnabled, setIsEnabled] = useState(true)

  useEffect(() => {
    if (!userId) return
    const token = getAuthToken()
    if (!token) return

    const unsubscribe = subscribeToolEvents({
      url: `${API_BASE.replace(/\/$/, '')}/ai/tool-events`,
      token,
      onEvent: (event) => {
        const thinking = extractThinkingEvent(event)
        if (thinking) {
          setThinkingEvents(prev => [...prev, thinking])
          setIsThinking(true)
          return
        }

        const planUpdate = extractPlanUpdate(event)
        if (planUpdate) {
          setCurrentPlan(planUpdate)
          const planFinished = planUpdate.steps.every(step => step.status === 'completed')
          setIsThinking(!planFinished)
        }
      },
      onError: (err) => {
        console.error('tool-events stream error', err)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [userId])

  const handleClear = useCallback(() => {
    setThinkingEvents([])
    setCurrentPlan(null)
    setIsThinking(false)
  }, [])

  const handleToggleIntelligence = useCallback(() => {
    setIsEnabled(prev => !prev)
  }, [])

  const handleSendMessageWithIntelligence = useCallback((message: string) => {
    if (onSendMessage) {
      onSendMessage(message, {
        intelligentMode: isEnabled,
        enableThinking: true
      })
    }
  }, [onSendMessage, isEnabled])

  return (
    <Stack spacing="md" style={{ height }}>
      {/* 控制栏 */}
      <Paper p="sm" withBorder>
        <Group position="apart">
          <Group spacing="xs">
            <IconBrain size={18} />
            <Text weight={500}>智能助手</Text>
            <Badge
              color={isEnabled ? 'green' : 'gray'}
              variant="light"
            >
              {isEnabled ? '已启用' : '已禁用'}
            </Badge>
          </Group>
          <Group spacing="xs">
            <Tooltip label={isEnabled ? '禁用智能模式' : '启用智能模式'}>
              <ActionIcon
                size="sm"
                color={isEnabled ? 'green' : 'gray'}
                onClick={handleToggleIntelligence}
              >
                <IconBrain size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="清空思考过程">
              <ActionIcon size="sm" variant="subtle" onClick={handleClear}>
                <IconX size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Paper>

      {/* 思考过程展示 */}
      {isEnabled && (
        <ThinkingProcess
          events={thinkingEvents}
          isProcessing={isThinking}
          maxHeight={200}
        />
      )}

      {/* 执行计划展示 */}
      {isEnabled && currentPlan && (
        <ExecutionPlanDisplay plan={currentPlan} />
      )}

      {/* 状态指示器 */}
      {isThinking && (
        <Paper p="sm" withBorder style={{ background: 'linear-gradient(45deg, #f0f9ff 0%, #e0f2fe 100%)' }}>
          <Group spacing="xs">
            <IconAlertTriangle size={16} color="blue" />
            <Text size="sm" color="blue">
              AI 正在深度思考并制定执行计划...
            </Text>
          </Group>
        </Paper>
      )}

      {/* 使用说明 */}
      <Paper p="md" withBorder style={{ background: '#fafafa' }}>
        <Text size="sm" weight={500} mb="xs">🧠 智能功能说明:</Text>
        <Stack spacing="xs">
          <Text size="xs" color="dimmed">
            • 支持自然语言描述画布操作需求
          </Text>
          <Text size="xs" color="dimmed">
            • 自动识别意图并制定执行计划
          </Text>
          <Text size="xs" color="dimmed">
            • 实时展示 AI 的思考过程
          </Text>
          <Text size="xs" color="dimmed">
            • 支持复杂工作流的智能优化
          </Text>
        </Stack>
      </Paper>

      <Divider />

      {/* 示例命令 */}
      <Stack spacing="xs">
        <Text size="sm" weight={500}>💡 试试这些命令:</Text>
        <Group spacing="sm">
          <Button
            size="xs"
            variant="outline"
            onClick={() => handleSendMessageWithIntelligence('整理一下布局')}
          >
            整理布局
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => handleSendMessageWithIntelligence('创建一个文生图节点')}
          >
            创建文生图
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => handleSendMessageWithIntelligence('优化这个工作流的性能')}
          >
            优化性能
          </Button>
        </Group>
      </Stack>
    </Stack>
  )
}
