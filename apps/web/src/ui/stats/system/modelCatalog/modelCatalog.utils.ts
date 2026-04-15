import type { ModelCatalogImportPackageDto, ModelCatalogMappingDto, ModelCatalogModelDto, ModelCatalogVendorDto } from './deps'

export type JsonParseResult = { ok: true; value: any } | { ok: false; error: string }

type RequestProfileV2Like = {
  version?: unknown
  create?: unknown
  query?: unknown
  result?: unknown
}

export function safeParseJson(input: string): JsonParseResult {
  const raw = String(input || '').trim()
  if (!raw) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'JSON 解析失败' }
  }
}

export function prettyJson(value: any): string {
  if (typeof value === 'undefined' || value === null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

export function buildSafeFileTimestamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-')
}

export function downloadTextAsFile(text: string, filename: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

export async function readFileAsText(file: File): Promise<string> {
  if (typeof (file as any)?.text === 'function') {
    return (file as any).text()
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsText(file)
  })
}

export function buildModelCatalogExportPackage(input: {
  vendors: ModelCatalogVendorDto[]
  models: ModelCatalogModelDto[]
  mappings: ModelCatalogMappingDto[]
  now: Date
}): ModelCatalogImportPackageDto {
  const { vendors, models, mappings, now } = input

  const modelsByVendor = (models || []).reduce<Record<string, ModelCatalogModelDto[]>>((acc, m) => {
    const key = String(m.vendorKey || '').trim()
    if (!key) return acc
    ;(acc[key] ||= []).push(m)
    return acc
  }, {})

  const mappingsByVendor = (mappings || []).reduce<Record<string, ModelCatalogMappingDto[]>>((acc, mp) => {
    const key = String(mp.vendorKey || '').trim()
    if (!key) return acc
    ;(acc[key] ||= []).push(mp)
    return acc
  }, {})

  return {
    version: 'v2',
    exportedAt: now.toISOString(),
    vendors: (vendors || []).map((v) => {
      const vendorKey = String(v.key || '').trim()
      const vendorPayload: ModelCatalogImportPackageDto['vendors'][number]['vendor'] = {
        key: vendorKey,
        name: String(v.name || '').trim(),
        enabled: !!v.enabled,
        baseUrlHint: v.baseUrlHint ?? null,
        authType: (v.authType as any) || 'bearer',
        authHeader: v.authHeader ?? null,
        authQueryParam: v.authQueryParam ?? null,
        ...(typeof v.meta === 'undefined' ? {} : { meta: v.meta }),
      }

      return {
        vendor: vendorPayload,
        models: (modelsByVendor[vendorKey] || []).map((m) => ({
          modelKey: String(m.modelKey || '').trim(),
          labelZh: String(m.labelZh || '').trim(),
          kind: m.kind,
          enabled: !!m.enabled,
          ...(typeof m.meta === 'undefined' ? {} : { meta: m.meta }),
          ...(m.pricing
            ? {
                pricing: {
                  cost: Math.max(0, Math.floor(Number(m.pricing.cost || 0))),
                  enabled: !!m.pricing.enabled,
                  specCosts: Array.isArray(m.pricing.specCosts)
                    ? m.pricing.specCosts
                        .map((spec) => {
                          const specKey = String(spec?.specKey || '').trim()
                          if (!specKey) return null
                          return {
                            specKey,
                            cost: Math.max(0, Math.floor(Number(spec.cost || 0))),
                            enabled: !!spec.enabled,
                          }
                        })
                        .filter((spec): spec is { specKey: string; cost: number; enabled: boolean } => spec !== null)
                    : [],
                },
              }
            : {}),
        })),
        mappings: (mappingsByVendor[vendorKey] || []).map((mp) => ({
          taskKind: mp.taskKind,
          name: String(mp.name || '').trim(),
          enabled: !!mp.enabled,
          ...(extractRequestProfileFromMapping(mp)
            ? { requestProfile: extractRequestProfileFromMapping(mp) }
            : {}),
          ...(extractRequestProfileFromMapping(mp)
            ? {}
            : (typeof mp.requestMapping === 'undefined' ? {} : { requestMapping: mp.requestMapping })),
          ...(extractRequestProfileFromMapping(mp)
            ? {}
            : (typeof mp.responseMapping === 'undefined' ? {} : { responseMapping: mp.responseMapping })),
        })),
      }
    }),
  }
}

export function isRequestProfileV2(value: unknown): value is RequestProfileV2Like {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as RequestProfileV2Like
  if (String(record.version || '').trim() !== 'v2') return false
  return typeof record.create === 'object' || typeof record.query === 'object' || typeof record.result === 'object'
}

export function extractRequestProfileFromMapping(mapping: Pick<ModelCatalogMappingDto, 'requestMapping' | 'responseMapping'>): unknown | null {
  if (isRequestProfileV2(mapping.requestMapping)) return mapping.requestMapping
  if (isRequestProfileV2(mapping.responseMapping)) return mapping.responseMapping
  return null
}

export function defaultModelPricingCost(kind: string | null | undefined): number {
  if (kind === 'image') return 1
  if (kind === 'video') return 10
  return 0
}

export function formatVendor(vendorKey: string | undefined | null): string {
  return String(vendorKey || '').trim() || '—'
}

export function formatKind(kind: string | undefined | null): string {
  const k = String(kind || '').trim()
  if (!k) return '—'
  if (k === 'text') return '文本'
  if (k === 'image') return '图片'
  if (k === 'video') return '视频'
  return k
}

export function formatTaskKind(kind: string | undefined | null): string {
  const k = String(kind || '').trim()
  if (!k) return '—'
  const map: Record<string, string> = {
    chat: 'chat（文本）',
    prompt_refine: 'prompt_refine（指令优化）',
    text_to_image: 'text_to_image（图片）',
    image_edit: 'image_edit（图像编辑）',
    image_to_prompt: 'image_to_prompt（图像理解）',
    text_to_video: 'text_to_video（视频）',
    image_to_video: 'image_to_video（图像转视频）',
  }
  return map[k] || k
}

export function normalizeSearchText(value: string | undefined | null): string {
  return String(value || '').trim().toLowerCase()
}

export function includesSearchText(parts: Array<string | undefined | null>, keyword: string): boolean {
  const normalizedKeyword = normalizeSearchText(keyword)
  if (!normalizedKeyword) return true
  return parts.some((part) => normalizeSearchText(part).includes(normalizedKeyword))
}

export function paginateItems<T>(items: T[], page: number, pageSize: number): T[] {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 10
  const start = (safePage - 1) * safePageSize
  return items.slice(start, start + safePageSize)
}

export function parsePageSize(value: string | null | undefined, fallback = 10): number {
  const parsed = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}
