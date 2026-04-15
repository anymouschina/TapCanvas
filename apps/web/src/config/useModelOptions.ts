import { useEffect, useState } from 'react'
import { listModelCatalogModels, listModelCatalogVendors, type BillingModelKind, type ModelCatalogModelDto } from '../api/server'
import { getDefaultModel } from './models'
import type { ModelOption, ModelOptionPricing, NodeKind } from './models'

export const MODEL_REFRESH_EVENT = 'tapcanvas-models-refresh'

type RefreshDetail = 'openai' | 'anthropic' | 'all' | undefined

const catalogOptionsCache = new Map<string, ModelOption[]>()
const catalogPromiseCache = new Map<string, Promise<ModelOption[]>>()
let enabledVendorKeysCache: Set<string> | null = null
let enabledVendorKeysPromise: Promise<Set<string>> | null = null

const HIDDEN_IMAGE_MODEL_ID_RE = /^(gemini-.*-image(?:-(?:landscape|portrait))?|imagen-.*-(?:landscape|portrait))$/i

function normalizeModelId(value: string): string {
  if (!value) return ''
  return value.startsWith('models/') ? value.slice(7) : value
}

export function filterHiddenOptionsByKind(options: ModelOption[], kind?: NodeKind): ModelOption[] {
  if (kind !== 'image' && kind !== 'imageEdit') return options
  return options.filter((opt) => {
    const normalizedValue = normalizeModelId(opt.value)
    if (!HIDDEN_IMAGE_MODEL_ID_RE.test(normalizedValue)) return true
    const normalizedAlias = normalizeModelId(trimModelIdentifier(opt.modelAlias))
    return Boolean(normalizedAlias && normalizedAlias !== normalizedValue)
  })
}

function invalidateAvailableCache() {
  catalogOptionsCache.clear()
  catalogPromiseCache.clear()
  enabledVendorKeysCache = null
  enabledVendorKeysPromise = null
}

export function notifyModelOptionsRefresh(detail?: RefreshDetail) {
  invalidateAvailableCache()
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent<RefreshDetail>(MODEL_REFRESH_EVENT, { detail }))
  }
}

async function getEnabledVendorKeys(): Promise<Set<string>> {
  if (enabledVendorKeysCache) return enabledVendorKeysCache
  if (!enabledVendorKeysPromise) {
    enabledVendorKeysPromise = (async () => {
      try {
        const vendors = await listModelCatalogVendors()
        const enabled = new Set(
          (Array.isArray(vendors) ? vendors : [])
            .filter((v) => Boolean(v?.enabled))
            .map((v) => String(v?.key || '').trim().toLowerCase())
            .filter(Boolean),
        )
        enabledVendorKeysCache = enabled
        return enabled
      } finally {
        enabledVendorKeysPromise = null
      }
    })()
  }
  return enabledVendorKeysPromise
}

function resolveCatalogKind(kind?: NodeKind): BillingModelKind {
  if (kind === 'image' || kind === 'imageEdit') {
    return 'image'
  }
  if (kind === 'video') {
    return 'video'
  }
  return 'text'
}

function trimModelIdentifier(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function trimVendorIdentifier(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function inferImageModelVendor(value: string | null | undefined): string | null {
  const normalized = trimModelIdentifier(value).toLowerCase()
  if (!normalized) return null
  if (
    normalized.includes('gpt') ||
    normalized.includes('openai') ||
    normalized.includes('dall') ||
    normalized.includes('o3-')
  ) {
    return 'openai'
  }
  if (normalized.includes('qwen')) {
    return 'qwen'
  }
  if (
    normalized.includes('gemini') ||
    normalized.includes('banana') ||
    normalized.includes('imagen')
  ) {
    return 'gemini'
  }
  return null
}

export function findModelOptionByIdentifier(
  options: readonly ModelOption[],
  value: string | null | undefined,
): ModelOption | null {
  const identifier = trimModelIdentifier(value)
  const normalizedIdentifier = normalizeModelId(identifier)
  if (!identifier) return null
  return (
    options.find((option) => {
      const rawValue = trimModelIdentifier(option.value)
      const rawModelKey = trimModelIdentifier(option.modelKey)
      const rawModelAlias = trimModelIdentifier(option.modelAlias)
      const normalizedValue = normalizeModelId(rawValue)
      const normalizedModelKey = normalizeModelId(rawModelKey)
      const normalizedModelAlias = normalizeModelId(rawModelAlias)
      return (
        identifier === rawValue ||
        identifier === rawModelKey ||
        identifier === rawModelAlias ||
        normalizedIdentifier === normalizedValue ||
        normalizedIdentifier === normalizedModelKey ||
        normalizedIdentifier === normalizedModelAlias
      )
    }) || null
  )
}

export function getModelOptionRequestAlias(
  options: readonly ModelOption[],
  value: string | null | undefined,
): string {
  const identifier = trimModelIdentifier(value)
  const matched = findModelOptionByIdentifier(options, identifier)
  const alias = trimModelIdentifier(matched?.modelAlias)
  if (alias) return alias
  const modelKey = trimModelIdentifier(matched?.modelKey)
  if (modelKey) return modelKey
  const fallbackValue = trimModelIdentifier(matched?.value)
  if (fallbackValue) return fallbackValue
  return identifier
}

function toCatalogModelPricing(pricing: ModelCatalogModelDto['pricing']): ModelOptionPricing | undefined {
  if (!pricing) return undefined
  const cost = typeof pricing.cost === 'number' && Number.isFinite(pricing.cost)
    ? Math.max(0, Math.floor(pricing.cost))
    : 0
  const specCosts = Array.isArray(pricing.specCosts)
    ? pricing.specCosts
        .map((spec) => {
          const specKey = typeof spec?.specKey === 'string' ? spec.specKey.trim() : ''
          if (!specKey) return null
          const specCost = typeof spec.cost === 'number' && Number.isFinite(spec.cost)
            ? Math.max(0, Math.floor(spec.cost))
            : 0
          return {
            specKey,
            cost: specCost,
            enabled: typeof spec.enabled === 'boolean' ? spec.enabled : true,
          }
        })
        .filter((spec): spec is ModelOptionPricing['specCosts'][number] => spec !== null)
    : []
  return {
    cost,
    enabled: typeof pricing.enabled === 'boolean' ? pricing.enabled : true,
    specCosts,
  }
}

export function toCatalogModelOptions(items: ModelCatalogModelDto[]): ModelOption[] {
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  const out: ModelOption[] = []
  for (const item of items) {
    const alias = typeof item?.modelAlias === 'string' ? item.modelAlias.trim() : ''
    const modelKey = typeof item?.modelKey === 'string' ? item.modelKey.trim() : ''
    const value = modelKey || alias
    if (!value || seen.has(value)) continue
    seen.add(value)
    const labelZh = typeof item?.labelZh === 'string' ? item.labelZh.trim() : ''
    const label = alias || labelZh || value
    const vendor = typeof item?.vendorKey === 'string' ? item.vendorKey : undefined
    out.push({
      value,
      label,
      vendor,
      modelKey: modelKey || value,
      modelAlias: alias || null,
      meta: item?.meta,
      pricing: toCatalogModelPricing(item?.pricing),
    })
  }
  return out
}

export type ResolvedExecutableImageModel = {
  value: string
  vendor: string | null
  didFallback: boolean
  shouldWriteBack: boolean
  reason: 'missing' | 'unavailable' | 'canonicalized' | null
  source: 'requested' | 'default' | 'firstAvailable'
}

function resolveModelOptionVendor(
  option: ModelOption | null,
  explicitVendor: string | null,
  resolvedValue: string,
): string | null {
  const optionVendor = trimVendorIdentifier(option?.vendor)
  if (optionVendor) return optionVendor
  if (explicitVendor) return explicitVendor
  return inferImageModelVendor(resolvedValue)
}

export function resolveExecutableImageModelFromOptions(
  options: readonly ModelOption[],
  params: {
    kind: 'image' | 'imageEdit'
    value: string | null | undefined
    vendor?: string | null | undefined
  },
): ResolvedExecutableImageModel {
  const requestedValue = trimModelIdentifier(params.value)
  const requestedVendor = trimVendorIdentifier(params.vendor)
  const requestedOption = findModelOptionByIdentifier(options, requestedValue)

  if (requestedOption) {
    const resolvedValue = trimModelIdentifier(requestedOption.value)
    const resolvedVendor = resolveModelOptionVendor(requestedOption, requestedVendor || null, resolvedValue)
    const reason =
      requestedValue && requestedValue !== resolvedValue
        ? 'canonicalized'
        : null
    return {
      value: resolvedValue,
      vendor: resolvedVendor,
      didFallback: false,
      shouldWriteBack: reason !== null || requestedVendor !== trimVendorIdentifier(resolvedVendor),
      reason,
      source: 'requested',
    }
  }

  if (options.length === 0) {
    throw new Error('未找到可用图片模型：请先在系统模型管理中启用 image 模型。')
  }

  const defaultOption = findModelOptionByIdentifier(options, getDefaultModel(params.kind))
  const fallbackOption = defaultOption || options[0] || null
  const source = defaultOption ? 'default' : 'firstAvailable'
  if (!fallbackOption) {
    throw new Error('未找到可用图片模型：请先在系统模型管理中启用 image 模型。')
  }

  const resolvedValue = trimModelIdentifier(fallbackOption.value)
  const resolvedVendor = resolveModelOptionVendor(fallbackOption, null, resolvedValue)
  const reason = requestedValue ? 'unavailable' : 'missing'

  return {
    value: resolvedValue,
    vendor: resolvedVendor,
    didFallback: true,
    shouldWriteBack: true,
    reason,
    source,
  }
}

async function getCatalogModelOptions(kind?: NodeKind): Promise<ModelOption[]> {
  const catalogKind = resolveCatalogKind(kind)
  const cacheKey = catalogKind
  const cached = catalogOptionsCache.get(cacheKey)
  if (cached) return cached
  const inflight = catalogPromiseCache.get(cacheKey)
  if (inflight) return inflight
  const promise = (async () => {
    try {
      const rows = await listModelCatalogModels({ kind: catalogKind, enabled: true })
      const enabledVendorKeys = await getEnabledVendorKeys()
      const filteredRows = (Array.isArray(rows) ? rows : []).filter((row) => {
        const vendorKey = String(row?.vendorKey || '').trim().toLowerCase()
        if (!vendorKey) return false
        if (!enabledVendorKeys.size) return true
        return enabledVendorKeys.has(vendorKey)
      })
      const normalized = toCatalogModelOptions(filteredRows)
      catalogOptionsCache.set(cacheKey, normalized)
      return normalized
    } finally {
      catalogPromiseCache.delete(cacheKey)
    }
  })()
  catalogPromiseCache.set(cacheKey, promise)
  return promise
}

export async function preloadModelOptions(kind?: NodeKind): Promise<ModelOption[]> {
  const catalogOptions = await getCatalogModelOptions(kind)
  return filterHiddenOptionsByKind(catalogOptions, kind)
}

export async function resolveExecutableImageModel(params: {
  kind: 'image' | 'imageEdit'
  value: string | null | undefined
  vendor?: string | null | undefined
}): Promise<ResolvedExecutableImageModel> {
  const options = await preloadModelOptions(params.kind)
  return resolveExecutableImageModelFromOptions(options, params)
}

export function useModelOptions(kind?: NodeKind): ModelOption[] {
  const [options, setOptions] = useState<ModelOption[]>([])
  const [refreshSeq, setRefreshSeq] = useState(0)

  useEffect(() => {
    setOptions([])
  }, [kind])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => setRefreshSeq((prev) => prev + 1)
    window.addEventListener(MODEL_REFRESH_EVENT, handler)
    return () => window.removeEventListener(MODEL_REFRESH_EVENT, handler)
  }, [])

  useEffect(() => {
    let canceled = false
    ;(async () => {
      try {
        const catalogOptions = await preloadModelOptions(kind)
        if (!canceled) setOptions(catalogOptions)
      } catch {
        if (!canceled) setOptions([])
      }
    })()

    return () => {
      canceled = true
    }
  }, [kind, refreshSeq])

  return options
}
