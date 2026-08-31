import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../../types'
import type { NewApiModelDto } from './new-api-models.service'

const { listNewApiModels } = vi.hoisted(() => ({ listNewApiModels: vi.fn() }))

vi.mock('./new-api-models.service', () => ({
	listNewApiModels,
	isSelectableNewApiModel: (model: NewApiModelDto) =>
		model.enabled &&
		model.runtimeEndpoints.length > 0 &&
		Boolean(model.pricing?.enabled) &&
		Number(model.pricing?.cost) > 0,
}))

import { requireSelectableVideoAnalysisModel } from './new-api-video-analysis-model'

const context = { env: {} } as unknown as AppContext

const model = (input: {
	capability: boolean
	requestModelKey?: string
	upfrontPricing?: boolean
}): NewApiModelDto => ({
	id: 1,
	modelName: 'video-analysis-alias',
	requestModelKey: input.requestModelKey ?? 'video-analysis-upstream',
	routingAliases: [],
	displayLabel: 'Video analysis',
	description: null,
	icon: null,
	tags: input.capability ? ['tapcanvas:capability=video-analysis'] : [],
	vendorId: null,
	endpoints: ['responses'],
	runtimeEndpoints: ['responses'],
	kind: 'text',
	enabled: true,
	syncOfficial: false,
	nameRule: 0,
	createdTime: 1,
	updatedTime: 1,
	meta: null,
	pricing: { cost: 20, enabled: true, specCosts: [] },
	...(input.upfrontPricing === false ? {} : {
		videoAnalysisPricing: {
			mode: 'duration_metered',
			pricingVersion: 'video-analysis-duration-v1',
			unit: 'second',
			priceCnyPerSecond: 0.125,
			creditsPerCny: 100,
			minimumCredits: 1,
			specKey: 'video-understand:60s:5fps:16k-output:v1',
			cost: 31,
			enabled: true,
			officialCostCny: 0.2015361,
			priceCny: 0.30230415,
			salePriceMultiplier: 1.5,
			limits: {
				maxDurationSeconds: 60,
				maxVideoBytes: 50 * 1024 * 1024,
				minFps: 0.2,
				maxFps: 5,
				maxSampledFrames: 300,
				maxPromptBytes: 2_048,
				maxRequestBodyBytes: 16_384,
				maxOutputTokens: 16_384,
			},
			tokenBudget: {
				maxVideoInputTokens: 81_920,
				maxNonAudioInputTokens: 120_000,
				maxAudioInputTokens: 375,
				maxTotalInputTokens: 120_375,
				maxOutputTokens: 16_384,
			},
		},
	}),
})

describe('requireSelectableVideoAnalysisModel', () => {
	beforeEach(() => vi.clearAllMocks())

	it('requires an explicit model', async () => {
		await expect(requireSelectableVideoAnalysisModel(context, ''))
			.rejects.toMatchObject({ code: 'video_analysis_model_required' })
		expect(listNewApiModels).not.toHaveBeenCalled()
	})

	it('returns the exact catalog model', async () => {
		listNewApiModels.mockResolvedValueOnce([model({ capability: true })])
		await expect(requireSelectableVideoAnalysisModel(context, 'video-analysis-alias'))
			.resolves.toMatchObject({ requestModelKey: 'video-analysis-upstream' })
	})

	it('does not accept a selectable text model without the capability tag', async () => {
		listNewApiModels.mockResolvedValueOnce([model({ capability: false })]).mockResolvedValueOnce([model({ capability: false })])
		await expect(requireSelectableVideoAnalysisModel(context, 'video-analysis-alias'))
			.rejects.toMatchObject({ code: 'video_analysis_model_unavailable' })
	})

	it('does not accept a capability model without the fixed upfront price', async () => {
		const unpriced = model({ capability: true, upfrontPricing: false })
		listNewApiModels.mockResolvedValueOnce([unpriced]).mockResolvedValueOnce([unpriced])
		await expect(requireSelectableVideoAnalysisModel(context, 'video-analysis-alias'))
			.rejects.toMatchObject({ code: 'video_analysis_model_unavailable' })
	})
})
