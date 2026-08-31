import type {
	PublicChatEnabledModelCatalogSummary,
} from "../model-catalog/model-catalog.public-chat-summary";
import { stableContentHash } from "./video-orchestrator.authoring.repo";

export type AgentImageExecutionCatalog = {
	kind: "image";
	fetchedAt: string;
	revision: string;
	selectionContract: string;
	models: Array<{
		modelKey: string;
		label: string;
		pricingCost: number | null;
		imageOptions: PublicChatEnabledModelCatalogSummary["imageModels"][number]["imageOptions"];
	}>;
};

export function buildAgentImageExecutionCatalog(
	summary: PublicChatEnabledModelCatalogSummary,
	fetchedAt: string,
): AgentImageExecutionCatalog {
	const models = summary.imageModels.map((model) => ({
		modelKey: model.modelKey,
		label: model.labelZh,
		pricingCost: model.pricingCost,
		imageOptions: model.imageOptions,
	}));
	return {
		kind: "image",
		fetchedAt,
		revision: stableContentHash(models),
		selectionContract:
			"Set node.data.imageModel to one exact modelKey from this list. When the selected model declares imageOptions, set node.data.aspect and node.data.imageSize to exact supported values. Never invent, translate, shorten, substitute, or silently default a model identity or media specification.",
		models,
	};
}
