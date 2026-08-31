export type PublicChatJsonValue =
	| string
	| number
	| boolean
	| null
	| PublicChatJsonValue[]
	| { [key: string]: PublicChatJsonValue };

export type PublicChatSemanticDeliveryContract = {
	kind: string;
} & Record<string, PublicChatJsonValue>;

export type PublicChatDeliveryEvidenceItem = {
	evidenceId: string;
	kind: "final_response" | "tool_call" | "artifact" | "persisted_state" | "source";
	sourceRef: string;
	requirementIds: string[];
	artifactClass?: string;
	/** Required (including explicit null) when kind=artifact; forbidden otherwise. */
	mediaType?: "image" | "video" | "audio" | null;
	attributes: Record<string, string | number | boolean | null>;
};

export type PublicChatDeliveryVerificationCriterion = {
	requirementId: string;
	status: "satisfied" | "avoided" | "applied" | "conflict" | "unresolved";
	evidenceIds: string[];
	reason: string;
};

export type PublicChatDeliveryVerificationSummary = {
	version: 2;
	contractHash: string;
	status: "satisfied" | "unsatisfied";
	criteria: PublicChatDeliveryVerificationCriterion[];
	verifiedAt: string;
};

export type PublicChatSemanticTaskSummary = {
	taskGoal: string;
	requestedOutput: string;
	taskKind: string;
	recommendedNextStage: string;
	mustStop: boolean;
	requiresExecutionDelivery: boolean;
	blockingGaps: string[];
	successCriteria: string[];
	deliveryContract?: PublicChatSemanticDeliveryContract | null;
	deliveryEvidence?: PublicChatDeliveryEvidenceItem[];
	deliveryVerification?: PublicChatDeliveryVerificationSummary;
};

export type PublicChatExpectedDeliverySummary = {
	active: boolean;
	kind: string;
	source: "none" | "agents_cli_tool_trace" | "agents_cli_user_intent_contract";
	reason: string;
	taskGoal?: string;
	requestedOutput?: string;
	successCriteria?: string[];
	deliveryContract?: PublicChatSemanticDeliveryContract;
	contractHash?: string;
};

export type PublicChatDeliveryEvidence = {
	version: 2;
	/** agents-cli runtime 已验证的唯一交付证据；Hono 只做结构校验和原样投影。 */
	items: PublicChatDeliveryEvidenceItem[];
	/** 确定性的宿主执行投影，供异步续跑和 UI 定位，不参与 Hono 语义裁决。 */
	artifacts: Array<{
		toolCallId: string;
		toolName: string;
		assetType: "image" | "video" | "audio" | "workflow";
		deliveryState: "materialized" | "accepted_async";
		nodeId: string | null;
		taskId: string | null;
		runId: string | null;
		runProtocol?: "video_run" | "workflow_execution_family";
		clipIndex: number | null;
		assetUrl: string | null;
		completionBoundary?: "submission";
	}>;
	assetCount: number;
	imageAssetCount: number;
	videoAssetCount: number;
	wroteCanvas: boolean;
	generatedAssets: boolean;
	imageLikeNodeCount: number;
	preproductionImageLikeNodeCount: number;
	reusablePreproductionImageLikeNodeCount: number;
	materializedStoryboardStillCount: number;
	hasVideoNodes: boolean;
	hasMaterializedVisualOutputs: boolean;
	hasPlannedAuthorityBaseFrame: boolean;
	hasConfirmedAuthorityBaseFrame: boolean;
	storyboardPlanPersistenceCount: number;
	videoTargetDurationSeconds?: number[];
};

export type PublicChatDurableTerminalDelivery = {
	version: 1;
	requestTerminal: {
		version: 1;
		terminal: true;
		status: "succeeded";
		reason: string;
	};
	expectedDelivery: Record<string, unknown> & {
		version: 2;
		contractHash: string;
	};
	deliveryEvidence: PublicChatDeliveryEvidenceItem[];
	deliveryVerification: PublicChatDeliveryVerificationSummary & {
		status: "satisfied";
	};
};

const MAX_CONTRACT_CHARS = 16_000;
const MAX_EVIDENCE_ITEMS = 128;
const MAX_REQUIREMENT_IDS = 64;
const MAX_ATTRIBUTE_KEYS = 32;
const MAX_CRITERIA = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, maxLength: number): string | null {
	const text = typeof value === "string" ? value.trim() : "";
	return text && text.length <= maxLength ? text : null;
}

function readStringList(value: unknown, maxItems: number, maxLength: number): string[] | null {
	if (!Array.isArray(value) || value.length > maxItems) return null;
	const result: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const text = readString(item, maxLength);
		if (!text) return null;
		if (seen.has(text)) continue;
		seen.add(text);
		result.push(text);
	}
	return result;
}

function cloneJsonRecord(value: Record<string, unknown>): Record<string, PublicChatJsonValue> | null {
	let serialized = "";
	try {
		serialized = JSON.stringify(value);
	} catch {
		return null;
	}
	if (!serialized || serialized.length > MAX_CONTRACT_CHARS) return null;
	try {
		const parsed = JSON.parse(serialized) as unknown;
		return isRecord(parsed) ? parsed as Record<string, PublicChatJsonValue> : null;
	} catch {
		return null;
	}
}

export function normalizePublicChatSemanticDeliveryContract(
	value: unknown,
): PublicChatSemanticDeliveryContract | null {
	if (!isRecord(value)) return null;
	const kind = readString(value.kind, 160);
	const cloned = cloneJsonRecord(value);
	if (!kind || !cloned) return null;
	return { ...cloned, kind };
}

function normalizeAttributes(
	value: unknown,
): Record<string, string | number | boolean | null> | null {
	if (!isRecord(value) || Object.keys(value).length > MAX_ATTRIBUTE_KEYS) return null;
	const result: Record<string, string | number | boolean | null> = {};
	for (const [key, item] of Object.entries(value)) {
		const normalizedKey = readString(key, 120);
		if (!normalizedKey) return null;
		if (item === null || typeof item === "boolean") {
			result[normalizedKey] = item;
			continue;
		}
		if (typeof item === "number") {
			if (!Number.isFinite(item)) return null;
			result[normalizedKey] = item;
			continue;
		}
		const normalizedValue = readString(item, 1_000);
		if (!normalizedValue) return null;
		result[normalizedKey] = normalizedValue;
	}
	return result;
}

export function normalizePublicChatDeliveryEvidence(
	value: unknown,
): PublicChatDeliveryEvidenceItem[] | null {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EVIDENCE_ITEMS) return null;
	const result: PublicChatDeliveryEvidenceItem[] = [];
	const seenIds = new Set<string>();
	for (const item of value) {
		if (!isRecord(item)) return null;
		const evidenceId = readString(item.evidenceId, 160);
		const kind = item.kind === "final_response" || item.kind === "tool_call" ||
			item.kind === "artifact" || item.kind === "persisted_state" || item.kind === "source"
			? item.kind
			: null;
		const sourceRef = readString(item.sourceRef, 500);
		const requirementIds = readStringList(item.requirementIds, MAX_REQUIREMENT_IDS, 240);
		const artifactClass = item.artifactClass === undefined
			? undefined
			: readString(item.artifactClass, 160) ?? null;
		const mediaType = item.mediaType === null || item.mediaType === "image" ||
				item.mediaType === "video" || item.mediaType === "audio"
			? item.mediaType
			: undefined;
		const attributes = normalizeAttributes(item.attributes);
		if (
			!evidenceId || !kind || !sourceRef || !requirementIds || artifactClass === null || !attributes ||
			(kind === "artifact" && mediaType === undefined) ||
			(kind !== "artifact" && Object.hasOwn(item, "mediaType"))
		) {
			return null;
		}
		if (seenIds.has(evidenceId)) return null;
		seenIds.add(evidenceId);
		result.push({
			evidenceId,
			kind,
			sourceRef,
			requirementIds,
			...(artifactClass ? { artifactClass } : {}),
			...(kind === "artifact" ? { mediaType: mediaType ?? null } : {}),
			attributes,
		});
	}
	return result;
}

export function normalizePublicChatDeliveryVerification(
	value: unknown,
): PublicChatDeliveryVerificationSummary | null {
	if (!isRecord(value) || value.version !== 2) return null;
	const contractHash = readString(value.contractHash, 128);
	const status = value.status === "satisfied" || value.status === "unsatisfied" ? value.status : null;
	const verifiedAt = readString(value.verifiedAt, 80);
	if (!contractHash || !status || !verifiedAt || !Array.isArray(value.criteria) || value.criteria.length > MAX_CRITERIA) {
		return null;
	}
	const criteria: PublicChatDeliveryVerificationCriterion[] = [];
	const seenRequirements = new Set<string>();
	for (const item of value.criteria) {
		if (!isRecord(item)) return null;
		const requirementId = readString(item.requirementId, 120);
		const criterionStatus = item.status === "satisfied" || item.status === "avoided" ||
			item.status === "applied" || item.status === "conflict" || item.status === "unresolved"
			? item.status
			: null;
		const evidenceIds = readStringList(item.evidenceIds, MAX_EVIDENCE_ITEMS, 160);
		const reason = readString(item.reason, 600);
		if (!requirementId || !criterionStatus || !evidenceIds || !reason || seenRequirements.has(requirementId)) {
			return null;
		}
		seenRequirements.add(requirementId);
		criteria.push({ requirementId, status: criterionStatus, evidenceIds, reason });
	}
	if (
		status === "satisfied" &&
		criteria.some((criterion) => criterion.status === "conflict" || criterion.status === "unresolved")
	) {
		return null;
	}
	return { version: 2, contractHash, status, criteria, verifiedAt };
}

export function isPublicChatDeliveryEnvelopeStructurallyConsistent(input: {
	evidence: readonly PublicChatDeliveryEvidenceItem[];
	verification: PublicChatDeliveryVerificationSummary;
	expectedContractHash?: string | null;
}): boolean {
	if (
		input.expectedContractHash &&
		input.verification.contractHash !== input.expectedContractHash
	) {
		return false;
	}
	const evidenceById = new Map(
		input.evidence.map((item) => [item.evidenceId, item] as const),
	);
	return input.verification.criteria.every((criterion) =>
		criterion.evidenceIds.every((evidenceId) =>
			evidenceById.get(evidenceId)?.requirementIds.includes(criterion.requirementId) === true,
		),
	);
}

/**
 * Validates the exact success closure emitted by agents-cli from its
 * authoritative Logical TaskStore. This is a structural transport boundary:
 * it does not infer delivery from response prose, asset counts, tool names, or
 * any Hono-owned semantic rule.
 */
export function normalizePublicChatDurableTerminalDelivery(
	value: unknown,
): PublicChatDurableTerminalDelivery | null {
	if (!isRecord(value) || value.version !== 1) return null;
	const requestTerminal = isRecord(value.requestTerminal) ? value.requestTerminal : null;
	const expectedDelivery = isRecord(value.expectedDelivery) ? value.expectedDelivery : null;
	const reason = readString(requestTerminal?.reason, 240);
	const contractHash = readString(expectedDelivery?.contractHash, 128);
	const deliveryEvidence = normalizePublicChatDeliveryEvidence(value.deliveryEvidence);
	const deliveryVerification = normalizePublicChatDeliveryVerification(value.deliveryVerification);
	if (
		requestTerminal?.version !== 1 ||
		requestTerminal.terminal !== true ||
		requestTerminal.status !== "succeeded" ||
		!reason ||
		expectedDelivery?.version !== 2 ||
		!contractHash ||
		!deliveryEvidence ||
		!deliveryVerification ||
		deliveryVerification.status !== "satisfied" ||
		!isPublicChatDeliveryEnvelopeStructurallyConsistent({
			evidence: deliveryEvidence,
			verification: deliveryVerification,
			expectedContractHash: contractHash,
		})
	) {
		return null;
	}
	return {
		version: 1,
		requestTerminal: {
			version: 1,
			terminal: true,
			status: "succeeded",
			reason,
		},
		expectedDelivery: { ...expectedDelivery, version: 2, contractHash },
		deliveryEvidence,
		deliveryVerification: { ...deliveryVerification, status: "satisfied" },
	};
}

export function buildPublicChatExpectedDeliverySummary(input: {
	taskSummary: PublicChatSemanticTaskSummary | null;
	source: PublicChatExpectedDeliverySummary["source"];
}): PublicChatExpectedDeliverySummary {
	if (!input.taskSummary) {
		return {
			active: false,
			kind: "none",
			source: "none",
			reason: "agents_cli_task_summary_missing",
		};
	}
	const deliveryContract = input.taskSummary.deliveryContract ?? undefined;
	return {
		active: true,
		kind: deliveryContract?.kind ?? input.taskSummary.taskKind,
		source: input.source,
		reason: input.taskSummary.recommendedNextStage,
		taskGoal: input.taskSummary.taskGoal,
		requestedOutput: input.taskSummary.requestedOutput,
		successCriteria: input.taskSummary.successCriteria,
		...(deliveryContract ? { deliveryContract } : {}),
		...(input.taskSummary.deliveryVerification?.contractHash
			? { contractHash: input.taskSummary.deliveryVerification.contractHash }
			: {}),
	};
}
