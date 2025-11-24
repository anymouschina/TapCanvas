export type StoryboardScene = {
  id: string
  description: string
  duration: number
  framing?: 'close' | 'medium' | 'wide'
  movement?: 'static' | 'push' | 'pull' | 'pan' | 'tilt'
}

const SCENE_ID_PREFIX = 'scene'
export const STORYBOARD_DEFAULT_DURATION = 5
export const STORYBOARD_DURATION_STEP = 0.5
export const STORYBOARD_MIN_DURATION = 1
export const STORYBOARD_MAX_DURATION = 60
export const STORYBOARD_MAX_TOTAL_DURATION = 25

export const STORYBOARD_FRAMING_OPTIONS: { value: StoryboardScene['framing']; label: string }[] = [
  { value: 'close', label: '近景' },
  { value: 'medium', label: '中景' },
  { value: 'wide', label: '远景' },
]

export const STORYBOARD_MOVEMENT_OPTIONS: { value: StoryboardScene['movement']; label: string }[] = [
  { value: 'static', label: '静止' },
  { value: 'push', label: '推镜' },
  { value: 'pull', label: '拉镜' },
  { value: 'pan', label: '摇镜' },
  { value: 'tilt', label: '俯仰' },
]

const randomId = () => {
  if (typeof crypto !== 'undefined' && typeof (crypto as any)?.randomUUID === 'function') {
    return (crypto as any).randomUUID()
  }
  return `${SCENE_ID_PREFIX}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export const createScene = (partial?: Partial<StoryboardScene>): StoryboardScene => ({
  id: partial?.id || randomId(),
  description: (partial?.description ?? '').trim(),
  duration:
    typeof partial?.duration === 'number' && !Number.isNaN(partial.duration)
      ? Math.min(STORYBOARD_MAX_DURATION, Math.max(STORYBOARD_MIN_DURATION, partial.duration))
      : STORYBOARD_DEFAULT_DURATION,
  framing: partial?.framing,
  movement: partial?.movement,
})

export const enforceStoryboardTotalLimit = (scenes: StoryboardScene[]): StoryboardScene[] => {
  const next: StoryboardScene[] = []
  let used = 0
  for (const scene of scenes) {
    if (used >= STORYBOARD_MAX_TOTAL_DURATION) break
    const remaining = STORYBOARD_MAX_TOTAL_DURATION - used
    const duration = Math.max(0, Math.min(scene.duration, remaining))
    if (duration <= 0) break
    next.push({ ...scene, duration })
    used += duration
  }
  if (next.length === 0) {
    next.push(
      createScene({
        duration: Math.min(STORYBOARD_DEFAULT_DURATION, STORYBOARD_MAX_TOTAL_DURATION),
      }),
    )
  }
  return next
}

const parseShotBlocks = (text: string): StoryboardScene[] => {
  const blocks = text.split(/Shot\s+\d+:\s*/gi).filter(Boolean)
  if (!blocks.length) return []
  return blocks.map((block) => {
    const durationMatch = block.match(/duration:\s*([\d.]+)/i)
    const framingMatch = block.match(/framing:\s*([a-z]+)/i)
    const movementMatch = block.match(/movement:\s*([a-z]+)/i)
    let description = block
    const sceneMatch = block.match(/Scene:\s*([\s\S]+)/i)
    if (sceneMatch && sceneMatch[1]) {
      description = sceneMatch[1]
    }
    const cleaned = description.replace(/Global Notes:[\s\S]*$/i, '').trim()
    return createScene({
      description: cleaned,
      duration: durationMatch ? Number.parseFloat(durationMatch[1]) : undefined,
      framing: framingMatch ? (framingMatch[1].toLowerCase() as StoryboardScene['framing']) : undefined,
      movement: movementMatch ? (movementMatch[1].toLowerCase() as StoryboardScene['movement']) : undefined,
    })
  })
}

export const normalizeStoryboardScenes = (
  raw: unknown,
  fallbackText?: string | null,
): StoryboardScene[] => {
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((scene) => createScene(scene))
  }
  const source =
    typeof raw === 'string' && raw.trim().length > 0
      ? raw.trim()
      : typeof fallbackText === 'string'
        ? fallbackText.trim()
        : ''
  if (!source) {
    return [createScene()]
  }
  const parsed = parseShotBlocks(source)
  if (parsed.length > 0) return parsed
  return [createScene({ description: source })]
}

export const serializeStoryboardScenes = (
  scenes: StoryboardScene[],
  options?: { title?: string; notes?: string },
): string => {
  const safeScenes = scenes.length ? scenes : [createScene()]
  const lines: string[] = []
  const title = options?.title?.trim()
  if (title) {
    lines.push(`Title: ${title}`, '')
  }

  safeScenes.forEach((scene, index) => {
    const desc = scene.description.trim() || '待补充镜头描述'
    lines.push(`Shot ${index + 1}:`)
    lines.push(`duration: ${scene.duration.toFixed(1)}sec`)
    if (scene.framing) {
      lines.push(`framing: ${scene.framing}`)
    }
    if (scene.movement) {
      lines.push(`movement: ${scene.movement}`)
    }
    lines.push(`Scene: ${desc}`, '')
  })

  const notes = options?.notes?.trim()
  if (notes) {
    lines.push('Global Notes:')
    lines.push(notes)
  }

  return lines.join('\n').trim()
}

export const totalStoryboardDuration = (scenes: StoryboardScene[]): number =>
  scenes.reduce((sum, scene) => sum + (scene.duration || 0), 0)

export const scenesAreEqual = (a: StoryboardScene[], b: StoryboardScene[]): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const sa = a[i]
    const sb = b[i]
    if (
      sa.description !== sb.description ||
      sa.duration !== sb.duration ||
      sa.framing !== sb.framing ||
      sa.movement !== sb.movement
    ) {
      return false
    }
  }
  return true
}
