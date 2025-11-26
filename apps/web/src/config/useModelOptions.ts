import { useEffect, useMemo, useState } from 'react'
import { listAvailableModels, type AvailableModelDto } from '../api/server'
import type { ModelOption, NodeKind } from './models'
import { getAllowedModelsByKind } from './models'

const MODEL_REFRESH_EVENT = 'tapcanvas-models-refresh'

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

function normalizeAvailableModels(items: AvailableModelDto[]): ModelOption[] {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => {
      const value = item?.value || (item as any)?.id
      if (!value || typeof value !== 'string') return null
      const label = typeof item?.label === 'string' && item.label.trim() ? item.label.trim() : value
      return { value, label }
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
  const [options, setOptions] = useState<ModelOption[]>(baseOptions)
  const [refreshSeq, setRefreshSeq] = useState(0)

  useEffect(() => {
    setOptions(baseOptions)
  }, [baseOptions])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => setRefreshSeq((prev) => prev + 1)
    window.addEventListener(MODEL_REFRESH_EVENT, handler)
    return () => window.removeEventListener(MODEL_REFRESH_EVENT, handler)
  }, [])

  useEffect(() => {
    if (kind && kind !== 'text') return
    let canceled = false
    getAvailableModelOptions()
      .then((remote) => {
        if (canceled || !remote.length) return
        setOptions((prev) => mergeOptions(prev, remote))
      })
      .catch(() => {
        // ignore; fallback to static list
      })
    return () => {
      canceled = true
    }
  }, [kind, refreshSeq])

  return options
}
