import type { ModelOption, ModelOptionPricing } from './models'
import type { NodeKind } from './models'

function normalizeNonNegativeInteger(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

function normalizeQuantity(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.max(1, Math.floor(value))
}

function normalizeSpecKey(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveUnitCostFromPricing(
  pricing: ModelOptionPricing | null | undefined,
  specKey: string,
): number | null {
  if (!pricing) return null
  if (specKey) {
    for (const spec of pricing.specCosts) {
      if (normalizeSpecKey(spec.specKey) !== specKey) continue
      if (!spec.enabled) return null
      return normalizeNonNegativeInteger(spec.cost)
    }
    // A caller that supplied a specification is asking for an exact settlement
    // row. Falling through to the base price makes 1K/2K/4K appear identical and
    // disagrees with the backend billing contract, which rejects a missing spec.
    return null
  }
  if (!pricing.enabled) return null
  return normalizeNonNegativeInteger(pricing.cost)
}

export function resolveModelGenerationCredits(input: {
  kind: NodeKind | null | undefined
  modelOption?: Pick<ModelOption, 'pricing'> | null
  specKey?: string | null
  quantity?: number | null
}): number {
  const unitCost = resolveUnitCostFromPricing(input.modelOption?.pricing, normalizeSpecKey(input.specKey))
  if (typeof unitCost !== 'number' || !Number.isFinite(unitCost) || unitCost <= 0) return 0
  return unitCost * normalizeQuantity(input.quantity)
}
