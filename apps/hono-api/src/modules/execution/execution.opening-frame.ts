import { IMAGE_REFERENCE_ROLES } from "../../../../../packages/schemas/workflow-asset-registry/index.mjs";
import { frozenReadyProjectImages } from "./execution.project-image-references";
import type { WorkflowProjectContext } from "./execution.project-context";
import type { WorkflowAgentJsonObjectContract } from "./execution.agent-output-contract";

export const OPENING_FRAME_PLAN_ARTIFACT_TYPE = "tapcanvas.opening-frame-plan/v1" as const;
export const OPENING_FRAME_PLAN_CONTRACT_NAME = "tapcanvas.opening-frame-plan" as const;
export const OPENING_FRAME_PLAN_CONTRACT_VERSION = "1" as const;
export const OPENING_FRAME_PROMPT_PACKAGE_ARTIFACT_TYPE = "tapcanvas.opening-frame-prompt-package/v1" as const;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
	return value.trim();
}

function parsePlan(value: unknown): JsonRecord {
	const candidate = isRecord(value) && typeof value.text === "string" ? value.text : value;
	const parsed: unknown = typeof candidate === "string" ? JSON.parse(candidate) : candidate;
	if (!isRecord(parsed)) throw new Error("opening-frame-plan must be one JSON object");
	return parsed;
}

/**
 * The frame author chooses semantic references. The host only constrains the
 * IDs to the frozen ready-image scope and checks the declared image contract.
 */
export function bindOpeningFramePlanAuthoringContract(
	contract: WorkflowAgentJsonObjectContract,
): WorkflowAgentJsonObjectContract {
	const bindingSchema = {
		type: "object",
		properties: {
			assetId: { type: "string", minLength: 1, "x-referenceSource": "project_image" },
			role: { type: "string", enum: [...IMAGE_REFERENCE_ROLES] },
			strength: { type: "number", minimum: 0, maximum: 1 },
		},
		required: ["assetId", "role"],
		additionalProperties: false,
	};
	return {
		...contract,
		contractName: OPENING_FRAME_PLAN_CONTRACT_NAME,
		contractVersion: OPENING_FRAME_PLAN_CONTRACT_VERSION,
		requiredStringFields: ["protocolVersion", "prompt", "negativePrompt"],
		requiredArrayFields: ["referenceAssetBindings"],
		arrayItemAllowedFields: {
			...contract.arrayItemAllowedFields,
			referenceAssetBindings: ["assetId", "role", "strength"],
		},
		exactStringFields: {
			...contract.exactStringFields,
			protocolVersion: OPENING_FRAME_PLAN_ARTIFACT_TYPE,
		},
		allowedFields: ["protocolVersion", "prompt", "negativePrompt", "referenceAssetBindings"],
		jsonSchema: {
			type: "object",
			properties: {
				protocolVersion: { type: "string", const: OPENING_FRAME_PLAN_ARTIFACT_TYPE },
				prompt: { type: "string", minLength: 1 },
				negativePrompt: { type: "string", minLength: 1 },
				referenceAssetBindings: { type: "array", items: bindingSchema },
			},
			required: ["protocolVersion", "prompt", "negativePrompt", "referenceAssetBindings"],
			additionalProperties: false,
		},
	};
}

/** Normalize the authored frame plan after checking exact frozen asset handles. */
export function projectOpeningFramePlan(input: Readonly<{
	framePlan: unknown;
	projectContext: WorkflowProjectContext | null;
}>): Readonly<{
	protocolVersion: typeof OPENING_FRAME_PLAN_ARTIFACT_TYPE;
	prompt: string;
	negativePrompt: string;
	referenceAssetBindings: readonly Readonly<{ assetId: string; role: typeof IMAGE_REFERENCE_ROLES[number]; strength?: number }>[];
}> {
	const parsed = parsePlan(input.framePlan);
	const allowedFields = new Set(["protocolVersion", "prompt", "negativePrompt", "referenceAssetBindings"]);
	const unsupported = Object.keys(parsed).find((field) => !allowedFields.has(field));
	if (unsupported) throw new Error(`opening-frame-plan.${unsupported} is not an accepted author field`);
	if (parsed.protocolVersion !== OPENING_FRAME_PLAN_ARTIFACT_TYPE) {
		throw new Error(`opening-frame-plan.protocolVersion must equal ${OPENING_FRAME_PLAN_ARTIFACT_TYPE}`);
	}
	if (!Array.isArray(parsed.referenceAssetBindings)) {
		throw new Error("opening-frame-plan.referenceAssetBindings must be an explicit array");
	}
	const readyAssetIds = new Set(input.projectContext
		? frozenReadyProjectImages(input.projectContext).map((asset) => asset.assetId)
		: []);
	const seenAssetIds = new Set<string>();
	const referenceAssetBindings = parsed.referenceAssetBindings.map((value, index) => {
		if (!isRecord(value)) throw new Error(`opening-frame-plan.referenceAssetBindings[${index}] must be an object`);
		const assetId = readText(value.assetId, `opening-frame-plan.referenceAssetBindings[${index}].assetId`);
		const role = readText(value.role, `opening-frame-plan.referenceAssetBindings[${index}].role`);
		if (!IMAGE_REFERENCE_ROLES.includes(role as typeof IMAGE_REFERENCE_ROLES[number])) {
			throw new Error(`opening-frame-plan.referenceAssetBindings[${index}].role is invalid`);
		}
		if (!readyAssetIds.has(assetId)) throw new Error(`opening-frame-plan asset ${assetId} is outside the frozen ready image scope`);
		if (seenAssetIds.has(assetId)) throw new Error(`opening-frame-plan asset ${assetId} is duplicated`);
		seenAssetIds.add(assetId);
		const strength = value.strength;
		if (strength !== undefined && (typeof strength !== "number" || !Number.isFinite(strength) || strength < 0 || strength > 1)) {
			throw new Error(`opening-frame-plan.referenceAssetBindings[${index}].strength must be between 0 and 1`);
		}
		const unexpected = Object.keys(value).find((field) => !["assetId", "role", "strength"].includes(field));
		if (unexpected) throw new Error(`opening-frame-plan.referenceAssetBindings[${index}].${unexpected} is not accepted`);
		return { assetId, role: role as typeof IMAGE_REFERENCE_ROLES[number], ...(typeof strength === "number" ? { strength } : {}) };
	});
	return {
		protocolVersion: OPENING_FRAME_PLAN_ARTIFACT_TYPE,
		prompt: readText(parsed.prompt, "opening-frame-plan.prompt"),
		negativePrompt: readText(parsed.negativePrompt, "opening-frame-plan.negativePrompt"),
		referenceAssetBindings,
	};
}

/** Convert a validated authoring plan into the distinct image-node input protocol. */
export function projectOpeningFramePromptPackage(input: Readonly<{
	framePlan: unknown;
	projectContext: WorkflowProjectContext | null;
}>): Readonly<{
	protocolVersion: typeof OPENING_FRAME_PROMPT_PACKAGE_ARTIFACT_TYPE;
	prompt: string;
	negativePrompt: string;
	referenceAssetBindings: readonly Readonly<{ assetId: string; role: typeof IMAGE_REFERENCE_ROLES[number]; strength?: number }>[];
}> {
	const plan = projectOpeningFramePlan(input);
	return {
		...plan,
		protocolVersion: OPENING_FRAME_PROMPT_PACKAGE_ARTIFACT_TYPE,
	};
}

/** A provider-generated image output must carry a real persistent HTTP(S) URL. */
export function openingFrameUrlFromImageOutput(value: unknown): string {
	if (!isRecord(value)) throw new Error("Opening video requires one materialized first-frame image output");
	const candidate = typeof value.imageUrl === "string" ? value.imageUrl.trim() : "";
	if (!candidate) throw new Error("Opening first-frame image output is missing imageUrl");
	let parsed: URL;
	try {
		parsed = new URL(candidate);
	} catch {
		throw new Error("Opening first-frame imageUrl must be an absolute HTTP(S) URL");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("Opening first-frame imageUrl must be an absolute HTTP(S) URL");
	}
	return parsed.toString();
}
