import type { ModelOption } from '../../../config/models'

export type DefaultCatalogModelInput = {
  currentValue: string
  options: readonly ModelOption[]
  loading: boolean
  error: Error | null
}

/**
 * Resolves the catalog-driven default without replacing an explicit node value.
 * Catalog order is authoritative, so a new node selects the first returned row.
 */
export function resolveDefaultCatalogModelOption(
  input: DefaultCatalogModelInput,
): ModelOption | null {
  if (input.loading || input.error || input.currentValue.trim()) return null
  const firstOption = input.options[0]
  return firstOption && firstOption.value.trim() ? firstOption : null
}
