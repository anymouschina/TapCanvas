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
  IconAlertTriangle
} from '@tabler/icons-react'
import { useWebSocket } from '../hooks/useWebSocket'
import type { ThinkingEvent, ExecutionStep } from '../../../types/canvas-intelligence'

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
      decision: 'violet',
      execution: 'yellow',
      result: 'teal'
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
  plan?: {
    strategy?: string
    steps?: string[]
    estimatedTime?: number
  }
  onStepClick?: (stepIndex: number) => void
}

export const ExecutionPlanDisplay: React.FC<ExecutionPlanDisplayProps> = ({
  plan,
  onStepClick
}) => {

  if (!plan || !plan.steps || plan.steps.length === 0) {
    return null
  }

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
        {plan.estimatedTime && (
          <Text size="xs" color="dimmed">
            预计 {plan.estimatedTime}s
          </Text>
        )}
      </Group>

      {plan.strategy && (
        <Group mb="md">
          <Text size="sm" weight={500}>策略:</Text>
          <Badge color="blue" variant="light">
            {plan.strategy}
          </Badge>
        </Group>
      )}

      <Stack spacing="sm">
        {plan.steps.map((step, index) => (
          <Paper
            key={index}
            p="sm"
            withBorder
            style={{
              cursor: onStepClick ? 'pointer' : 'default'
            }}
            onClick={() => onStepClick?.(index)}
          >
            <Group position="apart" align="start">
              <Group spacing="xs" align="start">
                <Text size="sm" weight={500}>
                  {index + 1}.
                </Text>
                <Text size="sm">
                  {step}
                </Text>
              </Group>
              {onStepClick && (
                <ActionIcon size="sm" variant="subtle">
                  <IconAdjustments size={14} />
                </ActionIcon>
              )}
            </Group>
          </Paper>
        ))}
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
  const [currentPlan, setCurrentPlan] = useState<any>(null)
  const [isThinking, setIsThinking] = useState(false)
  const [isEnabled, setIsEnabled] = useState(true)

  // 监听智能事件
  const { lastMessage, sendMessage } = useWebSocket(`/ai/tool-events?userId=${userId}`)

  useEffect(() => {
    if (lastMessage) {
      try {
        const data = JSON.parse(lastMessage.data)

        if (data.type === 'thinking-event') {
          setThinkingEvents(prev => [...prev, data.payload])
          setIsThinking(true)
        } else if (data.type === 'plan_update') {
          setCurrentPlan(data.payload)
          setIsThinking(false)
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error)
      }
    }
  }, [lastMessage])

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