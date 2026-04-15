const VIDEO_RENDER_NODE_KINDS = new Set(['video', 'composeVideo'])

type MergeExecutionPromptSequenceInput = {
  kind: string
  ownPrompt: string
  upstreamPrompts: string[]
  cameraRefPrompts: string[]
}

export function mergeExecutionPromptSequence(input: MergeExecutionPromptSequenceInput): string[] {
  const ownPrompt = input.ownPrompt.trim()
  const upstreamPrompts = input.upstreamPrompts
  const cameraRefPrompts = input.cameraRefPrompts

  if (VIDEO_RENDER_NODE_KINDS.has(input.kind)) {
    return [ownPrompt, ...upstreamPrompts, ...cameraRefPrompts].filter(Boolean)
  }

  return [...upstreamPrompts, ownPrompt, ...cameraRefPrompts].filter(Boolean)
}
