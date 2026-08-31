import { useEffect, useState } from 'react'
import { listNewApiModels, type BillingModelKind, type NewApiModelDto } from '../api/server'
import { NEW_API_AUTO_VENDOR } from './modelRouting'
import type { ModelOption, ModelOptionPricing, NodeKind } from './models'

export const MODEL_REFRESH_EVENT = 'tapcanvas-models-refresh'

type RefreshDetail = 'openai' | 'anthropic' | 'all' | undefined

type CatalogOptionsCacheEntry = {
  expiresAt: number
  options: ModelOption[]
}

type ModelCatalogRequestError = Error & {
  status?: number
}

export type ModelOptionsState = {
  options: ModelOption[]
  loading: boolean
  error: Error | null
  retry: () => void
}

const catalogOptionsCache = new Map<string, CatalogOptionsCacheEntry>()
const catalogPromiseCache = new Map<string, Promise<ModelOption[]>>()
const CATALOG_OPTIONS_CACHE_TTL_MS = 5 * 60_000
const MODEL_CATALOG_RETRY_DELAYS_MS = [250, 750] as const

function normalizeModelId(value: string): string {
  if (!value) return ''
  return value.startsWith('models/') ? value.slice(7) : value
}

function normalizeComparableModelIdentifier(value: string | null | undefined): string {
  return normalizeModelId(trimModelIdentifier(value)).toLowerCase()
}

export function filterHiddenOptionsByKind(options: ModelOption[], kind?: NodeKind): ModelOption[] {
  void kind
  return options
}

function invalidateAvailableCache() {
  catalogOptionsCache.clear()
  catalogPromiseCache.clear()
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function readErrorStatus(error: unknown): number | undefined {
  if (!(error instanceof Error) || !('status' in error)) return undefined
  const status = (error as ModelCatalogRequestError).status
  return typeof status === 'number' && Number.isFinite(status) ? status : undefined
}

export function isRetryableModelCatalogError(error: unknown): boolean {
  const status = readErrorStatus(error)
  return status === undefined || status === 408 || status === 429 || status >= 500
}

function waitForModelCatalogRetry(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve()
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs))
}

export async function requestModelCatalogWithRetry<T>(
  request: () => Promise<T>,
  retryDelaysMs: readonly number[] = MODEL_CATALOG_RETRY_DELAYS_MS,
): Promise<T> {
  const boundedRetryDelaysMs = retryDelaysMs.slice(0, MODEL_CATALOG_RETRY_DELAYS_MS.length)
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= boundedRetryDelaysMs.length; attempt += 1) {
    try {
      return await request()
    } catch (error) {
      lastError = toError(error)
      if (!isRetryableModelCatalogError(error) || attempt === boundedRetryDelaysMs.length) {
        throw lastError
      }
      await waitForModelCatalogRetry(boundedRetryDelaysMs[attempt] ?? 0)
    }
  }
  throw lastError ?? new Error('模型目录请求失败')
}

export function notifyModelOptionsRefresh(detail?: RefreshDetail) {
  invalidateAvailableCache()
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent<RefreshDetail>(MODEL_REFRESH_EVENT, { detail }))
  }
}

function resolveCatalogKind(kind?: NodeKind): BillingModelKind {
  if (kind === 'image' || kind === 'imageEdit') {
    return 'image'
  }
  if (kind === 'video') {
    return 'video'
  }
  if (kind === 'audio') {
    return 'audio'
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
  const normalizedIdentifier = normalizeComparableModelIdentifier(identifier)
  if (!identifier) return null
  const readOptionIdentifiers = (option: ModelOption) => {
    const rawValue = trimModelIdentifier(option.value)
    const rawModelKey = trimModelIdentifier(option.modelKey)
    const rawModelAlias = trimModelIdentifier(option.modelAlias)
    const rawLabel = typeof option.label === 'string' ? option.label.trim() : ''
    const routingAliases = Array.isArray(option.routingAliases)
      ? option.routingAliases
          .map((alias) => normalizeComparableModelIdentifier(alias))
          .filter(Boolean)
      : []
    return {
      rawValue,
      rawModelKey,
      rawModelAlias,
      rawLabel,
      routingAliases,
      normalizedValue: normalizeComparableModelIdentifier(rawValue),
      normalizedModelKey: normalizeComparableModelIdentifier(rawModelKey),
      normalizedModelAlias: normalizeComparableModelIdentifier(rawModelAlias),
    }
  }

  const displayMatch = options.find((option) => {
    const ids = readOptionIdentifiers(option)
    return (
      identifier === ids.rawValue ||
      identifier === ids.rawModelAlias ||
      identifier === ids.rawLabel ||
      normalizedIdentifier === ids.normalizedValue ||
      normalizedIdentifier === ids.normalizedModelAlias
    )
  })
  if (displayMatch) return displayMatch

  const routingAliasMatch = options.find((option) => {
    const ids = readOptionIdentifiers(option)
    return ids.routingAliases.includes(normalizedIdentifier)
  })
  if (routingAliasMatch) return routingAliasMatch

  return (
    options.find((option) => {
      const ids = readOptionIdentifiers(option)
      return (
        identifier === ids.rawModelKey ||
        normalizedIdentifier === ids.normalizedModelKey
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
  const modelKey = trimModelIdentifier(matched?.modelKey)
  if (modelKey) return modelKey
  const alias = trimModelIdentifier(matched?.modelAlias)
  if (alias) return alias
  const fallbackValue = trimModelIdentifier(matched?.value)
  if (fallbackValue) return fallbackValue
  return identifier
}

function toNewApiModelPricing(item: NewApiModelDto): ModelOptionPricing | undefined {
  const pricing = item?.pricing
  if (!pricing) return undefined
  return {
    cost: typeof pricing.cost === 'number' && Number.isFinite(pricing.cost) ? Math.max(0, Math.floor(pricing.cost)) : 0,
    enabled: pricing.enabled !== false,
    specCosts: Array.isArray(pricing.specCosts)
      ? pricing.specCosts
          .map((spec) => {
            const specKey = typeof spec?.specKey === 'string' ? spec.specKey.trim() : ''
            if (!specKey) return null
            return {
              specKey,
              cost: typeof spec.cost === 'number' && Number.isFinite(spec.cost) ? Math.max(0, Math.floor(spec.cost)) : 0,
              enabled: spec.enabled !== false,
            }
          })
          .filter((spec): spec is ModelOptionPricing['specCosts'][number] => spec !== null)
      : [],
  }
}

function mergeCatalogMeta(item: NewApiModelDto): Record<string, unknown> {
  const baseMeta =
    item?.meta && typeof item.meta === 'object' && !Array.isArray(item.meta)
      ? item.meta
      : {}
  return {
    ...baseMeta,
    description: item?.description || null,
    tags: Array.isArray(item?.tags) ? item.tags : [],
    endpoints: Array.isArray(item?.endpoints) ? item.endpoints : [],
    runtimeEndpoints: Array.isArray(item?.runtimeEndpoints) ? item.runtimeEndpoints : [],
    kind: item?.kind,
  }
}

export function toCatalogModelOptions(items: NewApiModelDto[]): ModelOption[] {
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  const out: ModelOption[] = []
  for (const item of items) {
    const modelKey = typeof item?.requestModelKey === 'string' ? item.requestModelKey.trim() : ''
    const alias = typeof item?.modelName === 'string' ? item.modelName.trim() : ''
    const value = alias || modelKey
    if (!value || seen.has(value)) continue
    seen.add(value)
    const label = typeof item?.displayLabel === 'string' && item.displayLabel.trim()
      ? item.displayLabel.trim()
      : alias || value
    const routingAliases = Array.isArray(item?.routingAliases)
      ? Array.from(new Set(item.routingAliases.map((candidate) => trimModelIdentifier(candidate)).filter(Boolean)))
      : []
    out.push({
      value,
      label,
      vendor: NEW_API_AUTO_VENDOR,
      modelKey: modelKey || value,
      modelAlias: alias || null,
      routingAliases,
      meta: mergeCatalogMeta(item),
      pricing: toNewApiModelPricing(item),
      videoAnalysisPricing: item.videoAnalysisPricing,
    })
  }
  return out
}

export type ResolvedExecutableImageModel = {
  /** Catalog selection value. */
  value: string
  /** Exact request model key supplied by the server catalog. */
  requestModelKey: string
  vendor: string | null
  shouldWriteBack: boolean
  reason: 'canonicalized' | null
  source: 'requested'
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
  if (!requestedValue) {
    throw new Error('图片节点未配置模型：请先从系统模型目录中选择一个可用图片模型。')
  }
  const requestedOption = findModelOptionByIdentifier(options, requestedValue)

  if (requestedOption) {
    const resolvedValue = trimModelIdentifier(requestedOption.value)
    const requestModelKey = getModelOptionRequestAlias(options, requestedValue)
    if (!requestModelKey) {
      throw new Error(`图片模型 ${requestedValue} 缺少请求模型键，请在系统模型管理中修复后重试。`)
    }
    const resolvedVendor = resolveModelOptionVendor(requestedOption, requestedVendor || null, resolvedValue)
    const reason =
      requestedValue && requestedValue !== resolvedValue
        ? 'canonicalized'
        : null
    return {
      value: resolvedValue,
      requestModelKey,
      vendor: resolvedVendor,
      shouldWriteBack: reason !== null || requestedVendor !== trimVendorIdentifier(resolvedVendor),
      reason,
      source: 'requested',
    }
  }

  if (options.length === 0) {
    throw new Error('未找到可用图片模型：请先在系统模型管理中启用 image 模型。')
  }
  throw new Error(`图片模型 ${requestedValue} 当前不可用：请在系统模型管理中修复渠道、协议和价格，或重新选择模型。`)
}

export type ModelOptionsRequest = {
  enabled?: boolean
  includeActionModels?: boolean
}

async function getCatalogModelOptions(kind?: NodeKind, request?: ModelOptionsRequest): Promise<ModelOption[]> {
  const catalogKind = resolveCatalogKind(kind)
  const includeActionModels = request?.includeActionModels === true
  const cacheKey = `${catalogKind}:${includeActionModels ? 'actions' : 'generation'}`
  const cached = catalogOptionsCache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt) return cached.options
  if (cached) catalogOptionsCache.delete(cacheKey)
  const inflight = catalogPromiseCache.get(cacheKey)
  if (inflight) return inflight
  const promise = (async () => {
    try {
      const rows = await requestModelCatalogWithRetry(() =>
        listNewApiModels({
          kind: catalogKind,
          enabled: true,
          selectable: true,
          includeActionModels,
        }),
      )
      const normalized = toCatalogModelOptions(rows)
      catalogOptionsCache.set(cacheKey, {
        expiresAt: Date.now() + CATALOG_OPTIONS_CACHE_TTL_MS,
        options: normalized,
      })
      return normalized
    } catch (error) {
      const resolvedError = toError(error)
      console.error('[model-catalog] load failed', {
        kind: catalogKind,
        status: readErrorStatus(resolvedError),
        message: resolvedError.message,
      })
      throw resolvedError
    }
  })()
  catalogPromiseCache.set(cacheKey, promise)
  const clearSettledPromise = (): void => {
    if (catalogPromiseCache.get(cacheKey) === promise) {
      catalogPromiseCache.delete(cacheKey)
    }
  }
  void promise.then(clearSettledPromise, clearSettledPromise)
  return promise
}

export async function preloadModelOptions(kind?: NodeKind, request?: ModelOptionsRequest): Promise<ModelOption[]> {
  const catalogOptions = await getCatalogModelOptions(kind, request)
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

export function useModelOptionsState(kind?: NodeKind, opts?: ModelOptionsRequest): ModelOptionsState {
  const enabled = opts?.enabled !== false
  const [options, setOptions] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<Error | null>(null)
  const [refreshSeq, setRefreshSeq] = useState(0)

  const retry = () => {
    invalidateAvailableCache()
    setRefreshSeq((prev) => prev + 1)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => setRefreshSeq((prev) => prev + 1)
    window.addEventListener(MODEL_REFRESH_EVENT, handler)
    return () => window.removeEventListener(MODEL_REFRESH_EVENT, handler)
  }, [])

  useEffect(() => {
    // 只读画布（分享页等）不拉模型目录：未登录会 401，登录了也用不上
    if (!enabled) {
      setOptions([])
      setLoading(false)
      setError(null)
      return
    }
    let canceled = false
    setOptions([])
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const catalogOptions = await preloadModelOptions(kind, {
          includeActionModels: opts?.includeActionModels,
        })
        if (!canceled) {
          setOptions(catalogOptions)
          setLoading(false)
        }
      } catch (loadError) {
        if (!canceled) {
          setOptions([])
          setError(toError(loadError))
          setLoading(false)
        }
      }
    })()

    return () => {
      canceled = true
    }
  }, [kind, refreshSeq, enabled, opts?.includeActionModels])

  return { options, loading, error, retry }
}

export function useModelOptions(kind?: NodeKind, opts?: ModelOptionsRequest): ModelOption[] {
  return useModelOptionsState(kind, opts).options
}
