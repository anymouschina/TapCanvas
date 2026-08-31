const VIDEO_RENDER_NODE_KINDS = new Set(['video', 'composeVideo'])

type PromptBucketLike = {
  text: string
  fromImage: boolean
}

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
    // A video node may use an upstream text node as its prompt source. Keep
    // the node's own prompt first (when present), then append the connected
    // text content in edge order so the compiled request contains both
    // explicit video instructions and the linked prompt document.
    return [ownPrompt, ...upstreamPrompts].filter(Boolean)
  }

  return [...upstreamPrompts, ownPrompt, ...cameraRefPrompts].filter(Boolean)
}

export function selectExecutionUpstreamPrompts(input: {
  kind: string
  upstreamPromptItems: PromptBucketLike[]
  inboundHasImage: boolean
}): string[] {
  const { kind, upstreamPromptItems, inboundHasImage } = input

  // Video nodes accept linked text instructions, but image-node prompts are
  // not prose inputs for the video provider and must remain reference data.
  if (VIDEO_RENDER_NODE_KINDS.has(kind)) {
    return upstreamPromptItems.filter((item) => !item.fromImage).map((item) => item.text)
  }

  if (!inboundHasImage) {
    return upstreamPromptItems.map((item) => item.text)
  }

  return upstreamPromptItems.filter((item) => !item.fromImage).map((item) => item.text)
}
