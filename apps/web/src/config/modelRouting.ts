export const NEW_API_AUTO_VENDOR = 'auto'

function normalizeIdentifier(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase()
}

/**
 * Every option in the system model picker has already passed the live new-api
 * catalog contract. Route it back through new-api's automatic channel selector
 * instead of treating the model id as a local vendor id.
 */
export function resolveCatalogVideoVendor(input: {
  explicitVendor?: string | null
  modelKey?: string | null
}): string {
  const explicitVendor = normalizeIdentifier(input.explicitVendor)
  if (explicitVendor) return explicitVendor
  const modelKey = normalizeIdentifier(input.modelKey)
  if (!modelKey) {
    throw new Error(
      '视频模型未配置：请先在「系统管理 → 模型管理（Model Catalog）→ 模型（video）」启用至少 1 个视频模型，并在节点中选择。',
    )
  }
  return NEW_API_AUTO_VENDOR
}
