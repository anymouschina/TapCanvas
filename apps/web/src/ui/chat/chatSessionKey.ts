type BuildEffectiveChatSessionKeyInput = {
  persistedBaseKey: string | null | undefined
  projectId: string | null | undefined
  flowId: string | null | undefined
  skillId: string | null | undefined
  lane: ChatSessionLane
}

export type ChatSessionLane = 'general'

function normalizeSegment(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function buildProjectScopedChatSessionBaseKey(input: {
  projectId: string | null | undefined
  flowId: string | null | undefined
}): string {
  const projectId = normalizeSegment(input.projectId)
  if (!projectId) return ''
  const flowId = normalizeSegment(input.flowId)
  return flowId ? `project:${projectId}:flow:${flowId}` : `project:${projectId}`
}

export function buildEffectiveChatSessionKey(input: BuildEffectiveChatSessionKeyInput): string {
  const projectScopedBaseKey = buildProjectScopedChatSessionBaseKey({
    projectId: input.projectId,
    flowId: input.flowId,
  })
  const persistedBaseKey = normalizeSegment(input.persistedBaseKey)
  const baseKey = projectScopedBaseKey
    ? persistedBaseKey
      ? `${projectScopedBaseKey}:conversation:${persistedBaseKey}`
      : projectScopedBaseKey
    : persistedBaseKey
  if (!baseKey) return ''
  const skillId = normalizeSegment(input.skillId) || 'default'
  const lane = normalizeSegment(input.lane) || 'general'
  return `${baseKey}:lane:${lane}:skill:${skillId}`
}

export function resolveChatSessionLane(input: {
  hasReplicateTarget: boolean
}): ChatSessionLane {
  void input.hasReplicateTarget
  return 'general'
}
