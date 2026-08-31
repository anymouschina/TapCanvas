/**
 * Shared model-catalog view types.
 *
 * Model candidates intentionally do not live in this module. Every selectable
 * model comes from the system model catalog through `useModelOptions`; keeping a
 * second client-side list would let disabled or unroutable models leak back into
 * the canvas.
 */

export interface ModelOptionPricingSpec {
  specKey: string
  cost: number
  enabled: boolean
}

export interface ModelOptionPricing {
  cost: number
  enabled: boolean
  specCosts: ReadonlyArray<ModelOptionPricingSpec>
}

export interface ModelOptionVideoAnalysisPricing {
	mode: 'duration_metered'
	pricingVersion: string
	unit: 'second'
	priceCnyPerSecond: number
	creditsPerCny: number
	minimumCredits: number
  specKey: string
  cost: number
  enabled: boolean
  officialCostCny: number
  priceCny: number
  salePriceMultiplier: number
  limits: {
    maxDurationSeconds: number
    maxVideoBytes: number
    minFps: number
    maxFps: number
    maxSampledFrames: number
    maxPromptBytes: number
    maxRequestBodyBytes: number
    maxOutputTokens: number
  }
  tokenBudget: {
    maxVideoInputTokens: number
    maxNonAudioInputTokens: number
    maxAudioInputTokens: number
    maxTotalInputTokens: number
    maxOutputTokens: number
  }
}

export interface ModelOption {
  /** Stable catalog selection value shown/stored by the UI. */
  value: string
  label: string
  vendor?: string
  /** Exact upstream request model resolved by the server catalog. */
  modelKey?: string
  modelAlias?: string | null
  /** Exact runtime identities published by the same live catalog row. */
  routingAliases?: ReadonlyArray<string>
  meta?: unknown
  pricing?: ModelOptionPricing
  videoAnalysisPricing?: ModelOptionVideoAnalysisPricing
}

export type NodeKind =
  | 'text'
  | 'image'
  | 'imageEdit'
  | 'video'
  | 'audio'
  | 'subtitle'
  | 'character'
