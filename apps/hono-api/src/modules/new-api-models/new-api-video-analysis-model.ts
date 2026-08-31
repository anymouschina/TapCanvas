import { AppError } from '../../middleware/error'
import type { AppContext } from '../../types'
import {
	isSelectableNewApiModel,
	listNewApiModels,
	type NewApiModelDto,
} from './new-api-models.service'
import { VIDEO_ANALYSIS_CAPABILITY_TAG } from '../billing/video-analysis-upfront-pricing'

export { VIDEO_ANALYSIS_CAPABILITY_TAG } from '../billing/video-analysis-upfront-pricing'

const normalizeIdentifier = (value: unknown): string =>
	typeof value === 'string' ? value.trim().toLowerCase() : ''

export const supportsVideoAnalysis = (model: Pick<NewApiModelDto, 'tags'>): boolean =>
	model.tags.some((rawTag) => rawTag.trim().toLowerCase() === VIDEO_ANALYSIS_CAPABILITY_TAG)

const findRequestedModel = (
	models: readonly NewApiModelDto[],
	requestedModel: string,
): NewApiModelDto | null => {
	const requested = normalizeIdentifier(requestedModel)
	if (!requested) return null
	return models.find((model) => {
		const identifiers = new Set([
			model.modelName,
			model.requestModelKey,
			...model.routingAliases,
		].map(normalizeIdentifier).filter(Boolean))
		return identifiers.has(requested)
	}) ?? null
}

const listSelectableVideoAnalysisModels = async (
	c: AppContext,
	fresh: boolean,
): Promise<NewApiModelDto[]> => {
	const models = await listNewApiModels(c.env, {
		enabled: true,
		kind: 'text',
		...(fresh ? { fresh: true } : {}),
	})
	return models.filter((model) =>
		isSelectableNewApiModel(model)
		&& supportsVideoAnalysis(model)
		&& model.videoAnalysisPricing?.enabled === true
		&& model.videoAnalysisPricing?.mode === "duration_metered"
		&& Number.isFinite(model.videoAnalysisPricing?.priceCnyPerSecond)
		&& (model.videoAnalysisPricing?.priceCnyPerSecond ?? 0) > 0)
}

/**
 * Resolve only the exact model selected from the live system catalog. A fresh
 * read invalidates stale catalog state; it never substitutes a different model.
 */
export const requireSelectableVideoAnalysisModel = async (
	c: AppContext,
	requestedModelValue: unknown,
): Promise<NewApiModelDto> => {
	const requestedModel = typeof requestedModelValue === 'string'
		? requestedModelValue.trim()
		: ''
	if (!requestedModel) {
		throw new AppError('视频分析必须指定系统模型目录返回的精确模型', {
			status: 400,
			code: 'video_analysis_model_required',
		})
	}

	let models = await listSelectableVideoAnalysisModels(c, false)
	let matched = findRequestedModel(models, requestedModel)
	if (!matched) {
		models = await listSelectableVideoAnalysisModels(c, true)
		matched = findRequestedModel(models, requestedModel)
	}
	if (!matched) {
			throw new AppError('视频分析模型已停用、无可执行协议、未声明视频分析能力或未配置按时长价格', {
			status: 400,
			code: 'video_analysis_model_unavailable',
			details: { requestedModel },
		})
	}
	return matched
}
