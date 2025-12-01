import React from 'react'
import { Modal, Group, Button, Title, Text, Stack, Paper, Badge } from '@mantine/core'
import { IconBrain } from '@tabler/icons-react'
import { IntelligentChatInterface } from './IntelligentChatInterface'
import { useIntelligentChat } from '../../hooks/useIntelligentChat'
import { useReactFlow } from '@xyflow/react'
import { useRFStore } from '../../canvas/store'
import { buildCanvasContext } from '../../canvas/utils/buildCanvasContext'
import { CanvasService } from '../../ai/canvasService'

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
  const nodes = useRFStore(state => state.nodes)
  const edges = useRFStore(state => state.edges)
  const canvasContext = React.useMemo(() => buildCanvasContext(nodes, edges), [nodes, edges])
  const [statusNote, setStatusNote] = React.useState('等待你的灵感提示，我会先记录现场。')

  // 处理画布操作执行
  const describeOperation = (operation: any): string => {
    switch (operation?.type) {
      case 'canvas_node.operation': {
        const actionMap: Record<string, string> = {
          create: '种下一枚新的节点胶囊',
          update: '微调节点参数',
          delete: '清理多余节点',
          duplicate: '复制节点以保持节奏'
        }
        return actionMap[operation.payload?.action] || '处理节点结构'
      }
      case 'canvas_layout.apply':
        return `整理布局 · ${operation.payload?.algorithm || '智能排列'}`
      case 'canvas_connection.operation':
        return '梳理连线，保持数据流畅'
      case 'canvas_optimization.analyze':
        return '进行画布性能诊断'
      case 'canvas_operation': {
        const domainMap: Record<string, string> = {
          node_manipulation: '整理节点簇',
          layout_arrangement: '对齐整体布局',
          execution_debug: '排查执行状态'
        }
        return domainMap[operation.params?.domain] || '执行语义操作'
      }
      default:
        return '处理中...'
    }
  }

  const handleOperationExecuted = (operation: any) => {
    console.log('Executing canvas operation:', operation)
    setStatusNote(describeOperation(operation))

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

      case 'canvas_connection.operation':
        handleConnectionOperation(operation.payload)
        break

      case 'canvas_operation': {
        const domain = operation.params?.domain
        const parameters = operation.params?.parameters || operation.payload || {}
        if (domain === 'node_manipulation') {
          handleNodeOperation(parameters)
        } else if (domain === 'layout_arrangement') {
          handleLayoutOperation(parameters)
        } else if (domain === 'execution_debug') {
          handleOptimizationOperation(parameters)
        }
        break
      }

      default:
        console.log('Unknown operation type:', operation.type)
    }
  }

  // 处理节点操作
  const handleNodeOperation = (payload: any) => {
    const { action, nodeType, position, config, nodeIds, operations } = payload

    switch (action) {
      case 'create':
        const rawConfig = config || {}
        const { autoRun, ...restConfig } = rawConfig
        const newNode = {
          id: `node_${Date.now()}`,
          type: 'taskNode', // 统一使用 taskNode 类型
          position: position || { x: 100, y: 100 },
          data: {
            label: nodeType === 'image' ? '小红书封面' : `${nodeType} 节点`,
            kind: rawConfig.kind || nodeType,
            ...restConfig
          }
        }
        setNodes(prev => [...prev, newNode])
        if (autoRun && newNode.id) {
          void CanvasService.runNode({ nodeId: newNode.id })
        }
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

  const handleConnectionOperation = (payload: any) => {
    const { action, sourceNodeId, targetNodeId, edgeId, connections } = payload || {}

    const connectPair = (source: string, target: string) => {
      void CanvasService.connectNodes({ sourceNodeId: source, targetNodeId: target })
    }

    if (Array.isArray(connections) && connections.length) {
      connections.forEach((pair: any) => {
        if (pair?.sourceNodeId && pair?.targetNodeId) {
          connectPair(pair.sourceNodeId, pair.targetNodeId)
        }
      })
      return
    }

    if (action === 'disconnect') {
      const existing = edges.find(e =>
        (edgeId && e.id === edgeId) ||
        (!edgeId && sourceNodeId && targetNodeId && e.source === sourceNodeId && e.target === targetNodeId)
      )
      if (existing?.id) {
        void CanvasService.disconnectNodes({ edgeId: existing.id })
      }
      return
    }

    if (sourceNodeId && targetNodeId) {
      connectPair(sourceNodeId, targetNodeId)
    }
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

        <Paper
          p="md"
          radius="xl"
          sx={{
            background: 'linear-gradient(125deg, rgba(143,123,255,0.15), rgba(77,214,255,0.12))',
            border: '1px solid rgba(255,255,255,0.08)',
            backdropFilter: 'blur(20px)'
          }}
        >
          <Group position="apart" align="flex-start">
            <div>
              <Text size="sm" color="#cbd5ff">
                场景状态
              </Text>
              <Text size="lg" weight={600}>
                {statusNote}
              </Text>
            </div>
            <Badge color="violet" variant="light">
              语义执行
            </Badge>
          </Group>
        </Paper>

        <IntelligentChatInterface
          userId={userId}
          height="500px"
          context={canvasContext}
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
  const nodes = useRFStore(state => state.nodes)
  const edges = useRFStore(state => state.edges)
  const canvasContext = React.useMemo(() => buildCanvasContext(nodes, edges), [nodes, edges])
  const {
    messages,
    thinkingEvents,
    isLoading,
    clearSession
  } = useIntelligentChat({
    userId,
    context: canvasContext
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
