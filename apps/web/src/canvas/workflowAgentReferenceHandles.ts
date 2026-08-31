import { Position } from '@xyflow/react'
import { isWorkflowAgentNode } from './workflowAgentContext'
import {
  workflowAgentReferenceSourceHandleId,
  workflowAgentReferenceTargetHandleId,
} from './workflowAgentReferencePorts'

export type WorkflowAgentReferenceHandle = Readonly<{
  id: string
  type: 'workflow-reference'
  pos: Position
  label: string
}>

export type WorkflowAgentReferenceHandles = Readonly<{
  targets: readonly WorkflowAgentReferenceHandle[]
  sources: readonly WorkflowAgentReferenceHandle[]
}>

const EMPTY_REFERENCE_HANDLES: WorkflowAgentReferenceHandles = Object.freeze({
  targets: Object.freeze([]),
  sources: Object.freeze([]),
})

export function buildWorkflowAgentReferenceHandles(
  data: Readonly<Record<string, unknown>>,
): WorkflowAgentReferenceHandles {
  const referenceKind = data.workflowRuntimeReferenceKind === 'skill'
    ? 'skill'
    : data.workflowRuntimeReferenceKind === 'knowledge'
      ? 'knowledge'
      : null

  if (data.workflowRuntimeReference === true && referenceKind) {
    return {
      targets: [],
      sources: [{
        id: workflowAgentReferenceSourceHandleId(referenceKind),
        type: 'workflow-reference',
        pos: Position.Top,
        label: referenceKind === 'skill' ? 'Skills 挂载' : '知识库挂载',
      }],
    }
  }

  if (!isWorkflowAgentNode(data)) return EMPTY_REFERENCE_HANDLES

  return {
    targets: [
      {
        id: workflowAgentReferenceTargetHandleId('skill'),
        type: 'workflow-reference',
        pos: Position.Bottom,
        label: 'Skills 挂载',
      },
      {
        id: workflowAgentReferenceTargetHandleId('knowledge'),
        type: 'workflow-reference',
        pos: Position.Bottom,
        label: '知识库挂载',
      },
    ],
    sources: [],
  }
}
