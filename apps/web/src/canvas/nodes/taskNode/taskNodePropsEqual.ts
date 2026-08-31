import type { NodeProps } from '@xyflow/react'
import type { TaskNodeType } from './taskNodeTypes'

export function areTaskNodePropsEqual(
  previous: NodeProps<TaskNodeType>,
  next: NodeProps<TaskNodeType>,
): boolean {
  return previous.id === next.id
    && previous.selected === next.selected
    && previous.dragging === next.dragging
    && previous.data === next.data
    && previous.width === next.width
    && previous.height === next.height
    && previous.isConnectable === next.isConnectable
    && previous.parentId === next.parentId
}
