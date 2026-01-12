import { useEffect, useMemo, useState } from 'react'
import { listAvailableModels, listModelProfiles, type AvailableModelDto, type ModelProfileDto, type ProfileKind } from '../api/server'
import type { ModelOption, NodeKind } from './models'
import { getAllowedModelsByKind } from './models'

export const MODEL_REFRESH_EVENT = 'tapcanvas-models-refresh'

type RefreshDetail = 'openai' | 'anthropic' | 'all' | undefined

let cachedAvailableModels: ModelOption[] | null = null
let availablePromise: Promise<ModelOption[]> | null = null

function mergeOptions(base: ModelOption[], extra: ModelOption[]): ModelOption[] {
  const seen = new Set<string>()
  const merged: ModelOption[] = []
  for (const opt of [...extra, ...base]) {
    if (seen.has(opt.value)) continue
    seen.add(opt.value)
    merged.push(opt)
  }
  return merged
}

const HIDDEN_IMAGE_MODEL_ID_RE = /^(gemini-.*-image(?:-(?:landscape|portrait))?|imagen-.*-(?:landscape|portrait))$/i

function normalizeModelId(value: string): string {
  if (!value) return ''
  return value.startsWith('models/') ? value.slice(7) : value
}

function filterHiddenOptionsByKind(options: ModelOption[], kind?: NodeKind): ModelOption[] {
  if (kind !== 'image' && kind !== 'mosaic' && kind !== 'storyboardImage' && kind !== 'imageFission') return options
  return options.filter((opt) => !HIDDEN_IMAGE_MODEL_ID_RE.test(normalizeModelId(opt.value)))
}

function normalizeAvailableModels(items: AvailableModelDto[]): ModelOption[] {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => {
      const value = item?.value || (item as any)?.id
      if (!value || typeof value !== 'string') return null
      const label = typeof item?.label === 'string' && item.label.trim() ? item.label.trim() : value
      const vendor = typeof item?.vendor === 'string' ? item.vendor : undefined
      return { value, label, vendor }
    })
    .filter(Boolean) as ModelOption[]
}

function invalidateAvailableCache() {
  cachedAvailableModels = null
  availablePromise = null
}

export function notifyModelOptionsRefresh(detail?: RefreshDetail) {
  invalidateAvailableCache()
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent<RefreshDetail>(MODEL_REFRESH_EVENT, { detail }))
  }
}

async function getAvailableModelOptions(): Promise<ModelOption[]> {
  if (cachedAvailableModels) return cachedAvailableModels
  if (!availablePromise) {
    availablePromise = (async () => {
      try {
        const remote = await listAvailableModels()
        const normalized = normalizeAvailableModels(remote)
        cachedAvailableModels = normalized
        return normalized
      } finally {
        availablePromise = null
      }
    })()
  }
  return availablePromise
}

export function useModelOptions(kind?: NodeKind): ModelOption[] {
  const baseOptions = useMemo(() => getAllowedModelsByKind(kind), [kind])
  const [options, setOptions] = useState<ModelOption[]>(filterHiddenOptionsByKind(baseOptions, kind))
  const [refreshSeq, setRefreshSeq] = useState(0)

  useEffect(() => {
    setOptions(filterHiddenOptionsByKind(baseOptions, kind))
  }, [baseOptions, kind])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => setRefreshSeq((prev) => prev + 1)
    window.addEventListener(MODEL_REFRESH_EVENT, handler)
    return () => window.removeEventListener(MODEL_REFRESH_EVENT, handler)
  }, [])

  useEffect(() => {
    let canceled = false
    getAvailableModelOptions()
      .then((remote) => {
        if (canceled || !remote.length) return
        const filtered = filterRemoteOptionsByKind(remote, kind)
        if (!filtered.length) return
        setOptions((prev) => filterHiddenOptionsByKind(mergeOptions(prev, filtered), kind))
      })
      .catch(() => {
        // ignore; fallback to static list
      })
    return () => {
      canceled = true
    }
  }, [kind, refreshSeq])

  useEffect(() => {
    const profileKinds = getProfileKindsForNode(kind)
    if (!profileKinds.length) return
    let canceled = false
    listModelProfiles({ kinds: profileKinds })
      .then((profiles) => {
        if (canceled || !profiles.length) return
        const mapped = normalizeProfiles(profiles)
        setOptions((prev) => filterHiddenOptionsByKind(mergeOptions(prev, mapped), kind))
      })
      .catch(() => {})
    return () => {
      canceled = true
    }
  }, [kind, refreshSeq])

  return options
}

function normalizeProfiles(items: ModelProfileDto[]): ModelOption[] {
  return items
    .map((profile) => {
      if (!profile?.modelKey) return null
      const value = profile.modelKey
      const label = profile.name?.trim() || profile.modelKey
      const vendor = profile.provider?.vendor
      return { value, label, vendor }
    })
    .filter(Boolean) as ModelOption[]
}

function getProfileKindsForNode(kind?: NodeKind): ProfileKind[] {
  switch (kind) {
    case 'image':
    case 'storyboardImage':
    case 'imageFission':
      return ['text_to_image']
    case 'composeVideo':
    case 'storyboard':
    case 'video':
      return ['text_to_video']
    case 'text':
    case 'character':
    default:
      return ['chat', 'prompt_refine']
  }
}

const IMAGE_KEYWORDS = ['image', 'img', 'vision', 'dall', 'flux', 'sd', 'stable', 'art', 'picture', 'photo']
const VIDEO_KEYWORDS = ['video', 'sora', 'veo', 'luma', 'runway', 'pika', 'animate', 'movie', 'film']

function isImageModelValue(value: string): boolean {
  const lower = value.toLowerCase()
  return IMAGE_KEYWORDS.some((keyword) => lower.includes(keyword))
}

function isVideoModelValue(value: string): boolean {
  const lower = value.toLowerCase()
  return VIDEO_KEYWORDS.some((keyword) => lower.includes(keyword))
}

function isTextModelValue(value: string): boolean {
  return !isImageModelValue(value) && !isVideoModelValue(value)
}

function filterRemoteOptionsByKind(options: ModelOption[], kind?: NodeKind): ModelOption[] {
  if (!kind || kind === 'text' || kind === 'character' || kind === 'audio' || kind === 'subtitle') {
    return options.filter((opt) => isTextModelValue(opt.value))
  }
  if (kind === 'image' || kind === 'mosaic' || kind === 'storyboardImage' || kind === 'imageFission') {
    return options.filter((opt) => isImageModelValue(opt.value))
  }
  if (kind === 'composeVideo' || kind === 'storyboard' || kind === 'video') {
    return options.filter((opt) => isVideoModelValue(opt.value))
  }
  return options
}
