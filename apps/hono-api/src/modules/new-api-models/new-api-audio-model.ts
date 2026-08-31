import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import {
	isSelectableNewApiModel,
	listNewApiModels,
	type NewApiModelDto,
} from "./new-api-models.service";

export type AudioCatalogType = "speech" | "music";

function normalizeIdentifier(value: unknown): string {
	return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function catalogAudioType(model: Pick<NewApiModelDto, "tags">): AudioCatalogType | null {
	for (const rawTag of model.tags) {
		const tag = rawTag.trim().toLowerCase();
		if (tag === "tapcanvas:audio-type=speech") return "speech";
		if (tag === "tapcanvas:audio-type=music") return "music";
	}
	return null;
}

function findCatalogAudioModel(
	models: NewApiModelDto[],
	requestedModel: string,
): NewApiModelDto | null {
	const requested = normalizeIdentifier(requestedModel);
	if (!requested) return null;
	return models.find((model) =>
		[model.modelName, model.requestModelKey]
			.map(normalizeIdentifier)
			.includes(requested),
	) ?? null;
}

async function listSelectableAudioModels(
	c: AppContext,
	fresh: boolean,
): Promise<NewApiModelDto[]> {
	const models = await listNewApiModels(c.env, {
		enabled: true,
		kind: "audio",
		...(fresh ? { fresh: true } : {}),
	});
	return models.filter(isSelectableNewApiModel);
}

/**
 * Resolve an exact, currently executable audio model from the system catalog.
 * A second fresh read only invalidates the catalog cache after an administrative
 * update; it never substitutes another model or audio type.
 */
export async function requireSelectableAudioModel(
	c: AppContext,
	requestedModelValue: unknown,
	expectedType: AudioCatalogType,
): Promise<NewApiModelDto> {
	const requestedModel = typeof requestedModelValue === "string"
		? requestedModelValue.trim()
		: "";
	if (!requestedModel) {
		throw new AppError("音频生成必须指定系统模型目录返回的精确 audioModel", {
			status: 400,
			code: "audio_model_required",
			details: { expectedType },
		});
	}

	let models = await listSelectableAudioModels(c, false);
	let matched = findCatalogAudioModel(models, requestedModel);
	if (!matched) {
		models = await listSelectableAudioModels(c, true);
		matched = findCatalogAudioModel(models, requestedModel);
	}
	if (!matched) {
		throw new AppError("音频模型已停用、未定价或没有有效渠道协议", {
			status: 400,
			code: "audio_model_unavailable",
			details: { requestedModel, expectedType },
		});
	}

	const actualType = catalogAudioType(matched);
	if (actualType !== expectedType) {
		throw new AppError("音频模型类型与当前生成任务不匹配", {
			status: 400,
			code: "audio_model_type_mismatch",
			details: {
				requestedModel,
				expectedType,
				actualType,
			},
		});
	}
	return matched;
}
