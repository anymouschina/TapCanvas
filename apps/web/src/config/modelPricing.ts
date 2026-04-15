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

function defaultCostForNodeKind(kind: NodeKind | null | undefined): number {
  if (kind === 'image' || kind === 'imageEdit') return 1
  if (kind === 'video') return 10
  return 0
}

function resolveUnitCostFromPricing(
  pricing: ModelOptionPricing | null | undefined,
  specKey: string,
): number | null {
  if (!pricing) return null
  if (specKey) {
    for (const spec of pricing.specCosts) {
      if (normalizeSpecKey(spec.specKey) !== specKey) continue
      if (!spec.enabled) break
      return normalizeNonNegativeInteger(spec.cost)
    }
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
  const unitCost =
    resolveUnitCostFromPricing(input.modelOption?.pricing, normalizeSpecKey(input.specKey)) ??
    defaultCostForNodeKind(input.kind)
  return unitCost * normalizeQuantity(input.quantity)
}
