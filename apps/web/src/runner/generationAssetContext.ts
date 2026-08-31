import type { TaskRequestDto } from '../api/server'

type CanvasGenerationSnapshot = {
  currentProject: { id?: string | null } | null
  currentChapter: { projectId: string; chapterId: string } | null
  currentFlow: {
    id?: string | null
    source: 'local' | 'server'
    ownerType?: 'project' | 'chapter' | 'shot' | null
    ownerId?: string | null
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function withCanvasGenerationContext(
  request: TaskRequestDto,
  snapshot: CanvasGenerationSnapshot,
  nodeIdOverride?: string | null,
): TaskRequestDto {
  const projectId = readString(snapshot.currentChapter?.projectId)
    || (snapshot.currentFlow.source === 'server' && snapshot.currentFlow.ownerType === 'project'
      ? readString(snapshot.currentFlow.ownerId)
      : '')
    || readString(snapshot.currentProject?.id)
  if (!projectId) return request

  const extras = readRecord(request.extras)
  const chapterId = readString(snapshot.currentChapter?.chapterId)
  const flowId = !chapterId
    && snapshot.currentFlow.source === 'server'
    && snapshot.currentFlow.ownerType !== 'chapter'
    ? readString(snapshot.currentFlow.id)
    : ''
  const nodeId = readString(nodeIdOverride) || readString(extras.nodeId)
  const workflowExecutionId = readString(extras.workflowExecutionId)

  return {
    ...request,
    extras: {
      ...extras,
      generationContext: {
        projectId,
        ...(flowId ? { flowId } : {}),
        ...(nodeId ? { nodeId } : {}),
        ...(chapterId ? { chapterId } : {}),
        ...(workflowExecutionId ? { workflowExecutionId } : {}),
      },
    },
  }
}
