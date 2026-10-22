import type { WorkbenchItem } from './workbenchModel'

/** One clip's shot design: its shot breakdown, with the staging diagrams that place its cast. */
export type ShotDesign = Readonly<{
  clipId: string
  staging: readonly WorkbenchItem[]
  /** The workflow video node whose prompt is this design. */
  videoId: string
}>

export type ShotDesignItem = WorkbenchItem & Readonly<{ shotDesign: ShotDesign }>

export function isShotDesign(item: WorkbenchItem): item is ShotDesignItem {
  return 'shotDesign' in item
}

/**
 * The storyboard step shows what each clip will shoot. Workflow video nodes carry that script,
 * so each one yields a shot-design entry; staging diagrams attach to the clips they cover
 * instead of standing alone. A diagram belongs to a clip through its persisted staging edge
 * (which survives a manual retry) or a shared clip id. Storyboard items that match no clip stay as they are.
 */
export function withShotDesigns(items: readonly WorkbenchItem[]): WorkbenchItem[] {
  const videos = items.filter((item) => item.category === 'video' && item.shotScript)
  if (!videos.length) return [...items]
  const attached = new Set<string>()
  const designs = videos.flatMap((video): ShotDesignItem[] => {
    const upstream = new Set(video.upstreamIds)
    const staging = items.filter((item) => item.category === 'storyboard'
      && (upstream.has(item.id) || video.clipIds.some((clipId) => item.clipIds.includes(clipId))))
    // A manually retried video loses its workflow clip id; a single-clip diagram still names it.
    const soleClip = staging.find((item) => item.clipIds.length === 1)
    const clipId = video.clipIds[0] ?? soleClip?.clipIds[0]
    if (!clipId) return []
    for (const item of staging) attached.add(item.id)
    const clipIndex = video.clipIndex ?? soleClip?.clipIndex ?? null
    return [{
      ...video,
      id: `shot-design:${video.id}`,
      label: clipIndex === null ? `${video.label} · 镜头设计` : `Clip ${clipIndex + 1}`,
      category: 'storyboard',
      kind: 'shotDesign',
      status: 'success',
      busy: false,
      imageUrl: staging.find((item) => item.imageUrl)?.imageUrl ?? null,
      videoUrl: null,
      audioUrl: null,
      text: video.shotScript,
      error: null,
      hasResult: true,
      canGenerate: false,
      upstreamIds: [],
      clipIds: [clipId],
      clipIndex,
      shotDesign: { clipId, staging, videoId: video.id },
    }]
  }).sort((left, right) => (left.clipIndex ?? Infinity) - (right.clipIndex ?? Infinity))
  return [...designs, ...items.filter((item) => !attached.has(item.id))]
}
