import { create } from 'zustand'

export type SystemPromptScope = 'image' | 'video' | 'both'

export type SystemPromptPreset = {
  id: string
  title: string
  description?: string
  content: string
  scope: SystemPromptScope
  builtIn?: boolean
  createdAt: number
  updatedAt: number
}

type SystemPromptPresetInput = {
  title: string
  description?: string
  content: string
  scope: SystemPromptScope
}

type SystemPromptStore = {
  presets: SystemPromptPreset[]
  addPreset: (input: SystemPromptPresetInput) => void
  updatePreset: (id: string, input: SystemPromptPresetInput) => void
  deletePreset: (id: string) => void
}

const STORAGE_KEY = 'tapcanvas-system-prompt-presets'

const isBrowser = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

const savePresets = (presets: SystemPromptPreset[]) => {
  if (!isBrowser) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
  } catch (err) {
    console.warn('[SystemPromptPresets] failed to persist presets', err)
  }
}

const createId = () => `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const DEFAULT_PRESETS: SystemPromptPreset[] = [
  {
    id: 'builtin-video-cinematic-director',
    title: '电影摄影导演',
    description: '用于剧情短片 / Sora，强调镜头语言和氛围',
    scope: 'video',
    content:
      'You are a cinematic director. Expand the idea into 2-3 English sentences that describe shot size, camera motion, subject performance, lighting mood, environment details, and pacing. Mention 2-3 concrete props or set elements. Avoid technical parameters beyond what is necessary for storytelling.',
    builtIn: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'builtin-video-aerial-doc',
    title: '航拍纪录片',
    description: '大场面景观 / 航拍视角',
    scope: 'video',
    content:
      'You are a documentary aerial cinematographer. Describe the terrain, weather, time-of-day, camera altitude and movement path, plus the relationship between subject and environment. Write in English, keep it within three sentences, and end with one sentence about pacing or transitions.',
    builtIn: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'builtin-image-fashion-studio',
    title: '时尚摄影棚',
    description: '商业人像 / 服装细节',
    scope: 'image',
    content:
      'You are a high-end fashion photographer. Rewrite the idea into a concise English prompt (20-40 words) specifying lighting setup (e.g. softbox, rim light), focal length, composition, background texture, fabric details, and facial expression. Finish the prompt with “Shot on 85mm, f/1.8”.',
    builtIn: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'builtin-image-concept-illustration',
    title: '概念插画',
    description: '氛围插画 / 场景设计',
    scope: 'image',
    content:
      'You are a concept illustrator. Convert the theme into three concise English sentences describing the subject pose, environment, mood, palette, materials, and storytelling details. Add one more sentence specifying the rendering style (e.g. watercolor, octane render, graphite sketch).',
    builtIn: true,
    createdAt: 0,
    updatedAt: 0,
  },
]

const isValidPreset = (value: any): value is SystemPromptPreset => {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.content === 'string' &&
    (value.scope === 'image' || value.scope === 'video' || value.scope === 'both')
  )
}

const mergeDefaults = (list: SystemPromptPreset[]): SystemPromptPreset[] => {
  const map = new Map(list.map((preset) => [preset.id, preset]))
  const merged = [...list]
  DEFAULT_PRESETS.forEach((preset) => {
    if (map.has(preset.id)) {
      const existing = map.get(preset.id)!
      if (!existing.builtIn) {
        existing.builtIn = true
      }
      return
    }
    merged.push({ ...preset })
  })
  return merged
}

const loadPresets = (): SystemPromptPreset[] => {
  if (!isBrowser) {
    return DEFAULT_PRESETS
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PRESETS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_PRESETS
    const normalized = parsed.filter(isValidPreset)
    if (!normalized.length) return DEFAULT_PRESETS
    return mergeDefaults(normalized)
  } catch (err) {
    console.warn('[SystemPromptPresets] failed to read presets', err)
    return DEFAULT_PRESETS
  }
}

export const useSystemPromptPresets = create<SystemPromptStore>((set, get) => ({
  presets: mergeDefaults(loadPresets()),
  addPreset: (input) => {
    const title = input.title.trim()
    const content = input.content.trim()
    if (!title || !content) return
    const now = Date.now()
    const preset: SystemPromptPreset = {
      id: createId(),
      title,
      description: input.description?.trim(),
      content,
      scope: input.scope,
      createdAt: now,
      updatedAt: now,
    }
    const next = [...get().presets, preset]
    set({ presets: next })
    savePresets(next)
  },
  updatePreset: (id, input) => {
    const list = get().presets
    const target = list.find((preset) => preset.id === id)
    if (!target || target.builtIn) return
    const title = input.title.trim()
    const content = input.content.trim()
    if (!title || !content) return
    const updated: SystemPromptPreset = {
      ...target,
      title,
      description: input.description?.trim(),
      content,
      scope: input.scope,
      updatedAt: Date.now(),
    }
    const next = list.map((preset) => (preset.id === id ? updated : preset))
    set({ presets: next })
    savePresets(next)
  },
  deletePreset: (id) => {
    const list = get().presets
    const target = list.find((preset) => preset.id === id)
    if (!target || target.builtIn) return
    const next = list.filter((preset) => preset.id !== id)
    set({ presets: next })
    savePresets(next)
  },
}))
