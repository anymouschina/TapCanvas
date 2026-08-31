import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";
import type { NewApiModelDto } from "./new-api-models.service";

const { listNewApiModels } = vi.hoisted(() => ({
	listNewApiModels: vi.fn(),
}));

vi.mock("./new-api-models.service", () => ({
	listNewApiModels,
	isSelectableNewApiModel: (model: NewApiModelDto) =>
		model.enabled &&
		model.runtimeEndpoints.length > 0 &&
		Boolean(model.pricing?.enabled) &&
		Number(model.pricing?.cost) > 0,
}));

import { requireSelectableAudioModel } from "./new-api-audio-model";

const context = { env: {} } as unknown as AppContext;

function audioModel(input: {
	modelName: string;
	requestModelKey?: string;
	audioType: "speech" | "music";
}): NewApiModelDto {
	return {
		id: 1,
		modelName: input.modelName,
		requestModelKey: input.requestModelKey ?? input.modelName,
		routingAliases: [],
		displayLabel: input.modelName,
		description: null,
		icon: null,
		tags: [`tapcanvas:kind=audio`, `tapcanvas:audio-type=${input.audioType}`],
		vendorId: null,
		endpoints: ["openai"],
		runtimeEndpoints: ["openai"],
		kind: "audio",
		enabled: true,
		syncOfficial: false,
		nameRule: 0,
		createdTime: 1,
		updatedTime: 1,
		meta: null,
		pricing: { cost: 30, enabled: true, specCosts: [] },
	};
}

describe("requireSelectableAudioModel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects a missing model without selecting a local default", async () => {
		await expect(requireSelectableAudioModel(context, "", "speech"))
			.rejects.toMatchObject({ code: "audio_model_required", status: 400 });
		expect(listNewApiModels).not.toHaveBeenCalled();
	});

	it("resolves the exact catalog alias to its request model key", async () => {
		listNewApiModels.mockResolvedValueOnce([
			audioModel({
				modelName: "speech-display-alias",
				requestModelKey: "speech-upstream-key",
				audioType: "speech",
			}),
		]);

		await expect(requireSelectableAudioModel(context, "speech-display-alias", "speech"))
			.resolves.toMatchObject({ requestModelKey: "speech-upstream-key" });
	});

	it("rejects a music model for a speech task", async () => {
		listNewApiModels.mockResolvedValueOnce([
			audioModel({ modelName: "music-2.5+", audioType: "music" }),
		]);

		await expect(requireSelectableAudioModel(context, "music-2.5+", "speech"))
			.rejects.toMatchObject({ code: "audio_model_type_mismatch", status: 400 });
	});

	it("refreshes once then rejects an unavailable model without substitution", async () => {
		listNewApiModels.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

		await expect(requireSelectableAudioModel(context, "disabled-speech", "speech"))
			.rejects.toMatchObject({ code: "audio_model_unavailable", status: 400 });
		expect(listNewApiModels).toHaveBeenNthCalledWith(2, context.env, {
			enabled: true,
			kind: "audio",
			fresh: true,
		});
	});
});
