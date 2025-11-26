import React from 'react'
import { Modal, Group, Button, Title, Text, Stack } from '@mantine/core'
import { IconBrain } from '@tabler/icons-react'
import { IntelligentChatInterface } from './IntelligentChatInterface'
import { useIntelligentChat } from '../../hooks/useIntelligentChat'
import { useReactFlow } from '@xyflow/react'

interface IntelligentCanvasAssistantProps {
  userId: string
  opened: boolean
  onClose: () => void
}

/**
 * 画布智能助手 - 集成到主界面的完整智能助手
 */
export const IntelligentCanvasAssistant: React.FC<IntelligentCanvasAssistantProps> = ({
  userId,
  opened,
  onClose
}) => {
  const { getNodes, getEdges, setNodes, setEdges } = useReactFlow()

  // 处理画布操作执行
  const handleOperationExecuted = (operation: any) => {
    console.log('Executing canvas operation:', operation)

    // 根据操作类型执行不同的画布操作
    switch (operation.type) {
      case 'canvas_node.operation':
        handleNodeOperation(operation.payload)
        break

      case 'canvas_layout.apply':
        handleLayoutOperation(operation.payload)
        break

      case 'canvas_optimization.analyze':
        handleOptimizationOperation(operation.payload)
        break

      default:
        console.log('Unknown operation type:', operation.type)
    }
  }

  // 处理节点操作
  const handleNodeOperation = (payload: any) => {
    const { action, nodeType, position, config, nodeIds, operations } = payload

    switch (action) {
      case 'create':
        const newNode = {
          id: `node_${Date.now()}`,
          type: 'taskNode', // 统一使用 taskNode 类型
          position: position || { x: 100, y: 100 },
          data: {
            label: nodeType === 'image' ? '小红书封面' : `${nodeType} 节点`,
            kind: config?.kind || nodeType,
            ...config
          }
        }
        setNodes(prev => [...prev, newNode])
        break

      case 'update':
        setNodes(prev => prev.map(node =>
          nodeIds?.includes(node.id)
            ? { ...node, data: { ...node.data, ...config } }
            : node
        ))
        break

      case 'delete':
        setNodes(prev => prev.filter(node => !nodeIds?.includes(node.id)))
        setEdges(prev => prev.filter(edge =>
          !nodeIds?.includes(edge.source) && !nodeIds?.includes(edge.target)
        ))
        break

      case 'duplicate':
        const nodesToDuplicate = getNodes().filter(node => nodeIds?.includes(node.id))
        const duplicatedNodes = nodesToDuplicate.map((node, index) => ({
          ...node,
          id: `${node.id}_copy_${Date.now()}`,
          position: {
            x: node.position.x + 50 * (index + 1),
            y: node.position.y + 50 * (index + 1)
          }
        }))
        setNodes(prev => [...prev, ...duplicatedNodes])
        break

      default:
        console.log('Unknown node action:', action)
    }
  }

  // 处理布局操作
  const handleLayoutOperation = (payload: any) => {
    const { algorithm, options } = payload

    // 这里应该调用实际的布局算法
    // 简化示例：简单的网格布局
    const nodes = getNodes()
    const spacing = options?.spacing || 150
    const cols = Math.ceil(Math.sqrt(nodes.length))

    const layoutedNodes = nodes.map((node, index) => ({
      ...node,
      position: {
        x: (index % cols) * spacing + 100,
        y: Math.floor(index / cols) * spacing + 100
      }
    }))

    setNodes(layoutedNodes)
  }

  // 处理优化操作
  const handleOptimizationOperation = (payload: any) => {
    const { analysisType } = payload

    // 这里应该执行实际的分析和优化
    // 简化示例：输出分析结果到控制台
    console.log(`Performing ${analysisType} analysis on workflow...`)

    const nodes = getNodes()
    const edges = getEdges()

    console.log('Current workflow analysis:', {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodeTypes: [...new Set(nodes.map(n => n.type))],
      connectionDensity: edges.length / (nodes.length * (nodes.length - 1))
    })
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="xl"
      title={
        <Group spacing="xs">
          <IconBrain size={20} color="blue" />
          <Title order={4}>AI 智能助手</Title>
        </Group>
      }
    >
      <Stack>
        <Text size="sm" color="dimmed">
          基于 CODEX 级别的智能理解能力，帮您操作画布的任意功能。
          您可以用自然语言描述需求，AI 会自动识别意图并执行操作。
        </Text>

        <IntelligentChatInterface
          userId={userId}
          height="500px"
          onOperationExecuted={handleOperationExecuted}
        />

        <Group position="right">
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

/**
 * 智能助手触发按钮 - 可以放在画布界面的任何位置
 */
export const IntelligentAssistantTrigger: React.FC<{
  userId: string
  onOpen: () => void
}> = ({ userId, onOpen }) => {
  const {
    messages,
    thinkingEvents,
    isLoading,
    clearSession
  } = useIntelligentChat({
    userId
  })

  const hasActiveSession = messages.length > 0 || thinkingEvents.length > 0

  return (
    <Group spacing="xs">
      {hasActiveSession && (
        <Button
          size="xs"
          variant="subtle"
          color="orange"
          onClick={() => {
            clearSession()
            onOpen()
          }}
        >
          继续会话
        </Button>
      )}

      <Button
        leftIcon={<IconBrain size={16} />}
        color="blue"
        variant={isLoading ? "outline" : "filled"}
        onClick={onOpen}
        disabled={isLoading}
      >
        {isLoading ? 'AI 思考中...' : 'AI 助手'}
      </Button>
    </Group>
  )
}