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
  Box
} from '@mantine/core'
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
  IconCircle
} from '@tabler/icons-react'
import type { ThinkingEvent, PlanUpdatePayload } from '../../types/canvas-intelligence'
import { subscribeToolEvents, extractThinkingEvent, extractPlanUpdate } from '../../api/toolEvents'
import { getAuthToken } from '../../auth/store'
import { API_BASE } from '../../api/server'

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

  if (events.length === 0 && !isProcessing) {
    return null
  }

  return (
    <Paper p="md" withBorder shadow="sm">
      <Group position="apart" mb="md">
        <Group spacing="xs">
          <IconBrain size={18} />
          <Text weight={500}>AI 思考过程</Text>
          {isProcessing && (
            <Badge color="blue" variant="light" size="sm">
              思考中...
            </Badge>
          )}
        </Group>
        <Text size="xs" color="dimmed">
          {events.length} 个思考步骤
        </Text>
      </Group>

      <ScrollArea.Autosize mah={maxHeight}>
        <Timeline bulletSize={20} lineWidth={2}>
          {events.map((event, index) => (
            <Timeline.Item
              key={event.id}
              bullet={getThinkingIcon(event.type)}
              color={getThinkingColor(event.type)}
            >
              <Stack spacing="xs">
                <Group spacing="xs" align="center">
                  <Text size="sm" weight={500}>
                    {getThinkingTitle(event.type)}
                  </Text>
                  {event.metadata?.confidence && (
                    <Badge
                      size="xs"
                      color={event.metadata.confidence > 0.8 ? 'green' :
                             event.metadata.confidence > 0.6 ? 'yellow' : 'red'}
                    >
                      {(event.metadata.confidence * 100).toFixed(0)}%
                    </Badge>
                  )}
                </Group>

                <Text size="xs" color="dimmed">
                  {event.content}
                </Text>

                {/* 置信度进度条 */}
                {event.metadata?.confidence && (
                  <Progress
                    value={event.metadata.confidence * 100}
                    size="xs"
                    color={event.metadata.confidence > 0.8 ? 'green' :
                           event.metadata.confidence > 0.6 ? 'yellow' : 'red'}
                  />
                )}

                {/* 备选方案 */}
                {event.metadata?.alternatives &&
                 event.metadata.alternatives.length > 0 && (
                  <Collapse in label="查看备选方案">
                    <Stack spacing="xs" mt="xs">
                      {event.metadata.alternatives.map((alt, i) => (
                        <Group key={i} spacing="xs">
                          <Text size="xs" color="blue">
                            {alt.option}
                          </Text>
                          <Text size="xs" color="dimmed">
                            ({alt.reason})
                          </Text>
                        </Group>
                      ))}
                    </Stack>
                  </Collapse>
                )}

                {/* 参数信息 */}
                {event.metadata?.parameters &&
                 Object.keys(event.metadata.parameters).length > 0 && (
                  <Box mt="xs">
                    <Text size="xs" color="dimmed" mb="xs">
                      提取参数:
                    </Text>
                    <Group spacing="xs">
                      {Object.entries(event.metadata.parameters).map(([key, value]) => (
                        <Badge key={key} size="xs" variant="outline">
                          {key}: {String(value)}
                        </Badge>
                      ))}
                    </Group>
                  </Box>
                )}
              </Stack>
            </Timeline.Item>
          ))}

          {isProcessing && (
            <Timeline.Item bullet={<IconClock size={16} />} color="gray">
              <Text size="sm" color="dimmed" italic>
                正在思考中...
              </Text>
            </Timeline.Item>
          )}
        </Timeline>
      </ScrollArea.Autosize>
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

  if (!plan || !plan.steps || plan.steps.length === 0) {
    return null
  }

  const summary = plan.summary || {}

  return (
    <Paper p="md" withBorder shadow="sm" mt="md">
      <Group position="apart" mb="md">
        <Group spacing="xs">
          <IconRocket size={18} />
          <Text weight={500}>执行计划</Text>
          <Badge color="green" variant="light">
            {plan.steps.length} 个步骤
          </Badge>
        </Group>
        {summary.estimatedTime && (
          <Text size="xs" color="dimmed">
            预计 {summary.estimatedTime}s
          </Text>
        )}
      </Group>

      {plan.explanation && (
        <Text size="xs" color="dimmed" mb="sm">
          {plan.explanation}
        </Text>
      )}

      {summary.strategy && (
        <Group mb="md">
          <Text size="sm" weight={500}>策略:</Text>
          <Badge color="blue" variant="light">
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
            withBorder
            style={{
              cursor: onStepClick ? 'pointer' : 'default'
            }}
            onClick={() => onStepClick?.(step.id)}
          >
            <Group position="apart" align="flex-start">
              <Group spacing="xs" align="flex-start">
                <Text size="sm" weight={500}>
                  {index + 1}.
                </Text>
                <div>
                  <Text size="sm" weight={500}>
                    {step.name}
                  </Text>
                  <Text size="xs" color="dimmed">
                    {step.description}
                  </Text>
                  {step.reasoning && (
                    <Text size="xs" color="dimmed">
                      {step.reasoning}
                    </Text>
                  )}
                  {acceptance && acceptance.length > 0 && (
                    <Stack gap={4} mt={6}>
                      {acceptance.map((item: string) => (
                        <Group key={item} spacing={6} align="flex-start">
                          {step.status === 'completed' ? (
                            <IconCircleCheck size={14} color="#16a34a" />
                          ) : (
                            <IconCircle size={14} color="#94a3b8" />
                          )}
                          <Text size="xs" color="dimmed">
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
        )})}
      </Stack>
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
