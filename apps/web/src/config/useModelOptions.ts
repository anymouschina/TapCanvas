import { useEffect, useMemo, useState } from 'react'
import { listModelProviders, listModelTokens, type ModelTokenDto } from '../api/server'
import type { ModelOption, NodeKind } from './models'
import { getAllowedModelsByKind } from './models'
import { markAnthropicModels } from './modelSource'

const ANTHROPIC_VENDOR = 'anthropic'
const ANTHROPIC_VERSION = '2023-06-01'

let cachedAnthropicModels: ModelOption[] | null = null
let anthropicPromise: Promise<ModelOption[]> | null = null

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

function buildAnthropicModelsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  // If user already points directly to a models endpoint, keep it.
  if (/\/v\d+\/models$/i.test(base) || /\/models$/i.test(base)) return base
  // If base already contains a version path (e.g. /api/anthropic/v1), append /models.
  if (/\/v\d+$/i.test(base)) return `${base}/models`
  return `${base}/v1/models`
}

async function fetchAnthropicModels(baseUrl: string, token: string): Promise<ModelOption[]> {
  const url = buildAnthropicModelsUrl(baseUrl)
  const resp = await fetch(url, {
    headers: {
      'x-api-key': token,
      'Authorization': `Bearer ${token}`,
      'anthropic-version': ANTHROPIC_VERSION,
    },
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`fetch models failed: ${resp.status} ${text || resp.statusText}`)
  }
  const body = await resp.json().catch(() => null)
  if (!body || !Array.isArray(body.data)) return []
  return body.data
    .map((item: any) => {
      if (!item || typeof item.id !== 'string') return null
      const label = typeof item.display_name === 'string' && item.display_name.trim()
        ? item.display_name.trim()
        : item.id
      return { value: item.id, label }
    })
    .filter(Boolean) as ModelOption[]
}

async function getAnthropicModelOptions(): Promise<ModelOption[]> {
  if (cachedAnthropicModels) return cachedAnthropicModels
  if (anthropicPromise) return anthropicPromise

  anthropicPromise = (async () => {
    try {
      const providers = await listModelProviders()
      let provider = providers.find((p) => p.vendor === ANTHROPIC_VENDOR)
      if (!provider) {
        provider = providers.find((p) => (p.baseUrl || '').toLowerCase().includes('anthropic'))
      }
      if (!provider) return []

      const tokens = await listModelTokens(provider.id)
      const usable = tokens.find((t: ModelTokenDto) => t.enabled && Boolean(t.secretToken))
      if (!usable || !usable.secretToken) return []

      const baseUrl = provider.baseUrl?.trim() || 'https://api.anthropic.com'
      const models = await fetchAnthropicModels(baseUrl, usable.secretToken)
      if (models.length) {
        cachedAnthropicModels = models
        markAnthropicModels(models.map((m) => m.value))
      }
      return models
    } finally {
      anthropicPromise = null
    }
  })()

  return anthropicPromise
}

export function useModelOptions(kind?: NodeKind): ModelOption[] {
  const baseOptions = useMemo(() => getAllowedModelsByKind(kind), [kind])
  const [options, setOptions] = useState<ModelOption[]>(baseOptions)

  useEffect(() => {
    setOptions(baseOptions)
  }, [baseOptions])

  useEffect(() => {
    if (kind && kind !== 'text') return
    let canceled = false
    getAnthropicModelOptions()
      .then((remote) => {
        if (canceled || !remote.length) return
        setOptions((prev) => mergeOptions(prev, remote))
      })
      .catch(() => {
        // ignore errors; fallback to static list
      })
    return () => {
      canceled = true
    }
  }, [kind])

  return options
}
