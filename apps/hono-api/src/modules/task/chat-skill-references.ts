import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { listPublicAgentSkills } from "../agents/agents.service";
import {
	listUserContextAssets,
} from "../agents/user-context-assets.service";
import type {
	AgentSkillMetadataDto,
	UserContextAssetDto,
} from "../agents/agents.schemas";

export type ChatSkillReferenceSource = "system" | "user" | "marketplace";

export type ChatSkillReferenceInput = {
	id: string;
	source: ChatSkillReferenceSource;
};

export type ChatSkillReference = {
	id: string;
	key: string;
	name: string;
	description: string | null;
	logoUrl: string | null;
	source: ChatSkillReferenceSource;
	version: string;
	contentHash: string | null;
	sizeBytes: number | null;
};

export type ChatSkillReferenceResolution = {
	selected: ChatSkillReference | null;
	availableExternalSkills: ChatSkillReference[];
};

function normalizeSelectedInput(
	input: ChatSkillReferenceInput | null | undefined,
): ChatSkillReferenceInput | null {
	if (!input) return null;
	const id = String(input.id || "").trim();
	if (!id) {
		throw new AppError("所选 Skill 引用缺少 id", {
			status: 400,
			code: "selected_skill_reference_invalid",
		});
	}
	return { id, source: input.source };
}

function toSystemReference(skill: AgentSkillMetadataDto): ChatSkillReference {
	return {
		id: skill.id,
		key: skill.key,
		name: skill.name || skill.key,
		description: skill.description ?? null,
		logoUrl: skill.logoUrl,
		source: "system",
		version: skill.updatedAt,
		contentHash: null,
		sizeBytes: null,
	};
}

export function toExternalSkillReference(
	asset: UserContextAssetDto,
): ChatSkillReference {
	return {
		id: asset.id,
		key: `user-skill:${asset.id}`,
		name: asset.name || asset.fileName,
		description: asset.description,
		logoUrl: asset.logoUrl,
		source: asset.sourceMarketplaceProductId ? "marketplace" : "user",
		version: asset.updatedAt,
		contentHash: asset.sha256,
		sizeBytes: asset.sizeBytes,
	};
}

function selectedSkillNotFound(input: ChatSkillReferenceInput): AppError {
	return new AppError("所选 Skill 不存在、不可见或不属于当前用户", {
		status: 404,
		code: "selected_skill_reference_not_found",
		details: { skillId: input.id, source: input.source },
	});
}

export async function resolveChatSkillReferences(
	c: AppContext,
	userId: string,
	selectedInput: ChatSkillReferenceInput | null | undefined,
): Promise<ChatSkillReferenceResolution> {
	const requested = normalizeSelectedInput(selectedInput);
	if (!requested) {
		return {
			selected: null,
			availableExternalSkills: [],
		};
	}

	if (requested.source === "system") {
		const systemSkills = await listPublicAgentSkills(c);
		const selectedSkill = systemSkills.find((skill) => skill.id === requested.id);
		if (!selectedSkill) throw selectedSkillNotFound(requested);
		const selected = toSystemReference(selectedSkill);
		return {
			selected,
			availableExternalSkills: [],
		};
	}

	const userAssets = await listUserContextAssets(userId);
	const availableExternalSkills = userAssets.map(toExternalSkillReference);
	const selected = availableExternalSkills.find((skill) => skill.id === requested.id);
	if (!selected || selected.source !== requested.source) {
		throw selectedSkillNotFound(requested);
	}
	return {
		selected,
		availableExternalSkills,
	};
}
