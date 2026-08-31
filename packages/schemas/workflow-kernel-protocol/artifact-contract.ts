export const WORKFLOW_MEDIA_ASSET_PROTOCOL_VERSION = "workflow.media-asset/v1" as const;
export const WORKFLOW_NODE_PROVENANCE_PROTOCOL_VERSION = "workflow.node-provenance/v1" as const;

export const WORKFLOW_MEDIA_KINDS = ["image", "video", "audio"] as const;
export type WorkflowMediaKind = (typeof WORKFLOW_MEDIA_KINDS)[number];

export type WorkflowMediaAssetV1 = Readonly<{
	protocolVersion: typeof WORKFLOW_MEDIA_ASSET_PROTOCOL_VERSION;
	kind: WorkflowMediaKind;
	url: string;
	mimeType: string | null;
	width?: number;
	height?: number;
	durationSeconds?: number;
}>;

export type WorkflowArtifactIdentityV1 = Readonly<{
	type: string;
	identity: string | null;
}>;

export type WorkflowInputBindingProvenanceV1 = Readonly<{
	sourceNodeId: string;
	sourceNodeRunId: string;
	sourcePortId: string;
	targetPortId: string;
	artifacts: readonly WorkflowArtifactIdentityV1[];
}>;

/**
 * Durable execution provenance. It is stamped by the workflow runtime immediately before a
 * node output or checkpoint is persisted, never authored by an individual executor.
 */
export type WorkflowNodeProvenanceV1 = Readonly<{
	protocolVersion: typeof WORKFLOW_NODE_PROVENANCE_PROTOCOL_VERSION;
	executionId: string;
	nodeRunId: string;
	attempt: number;
	flowId: string;
	flowVersionId: string;
	nodeId: string;
	executorRef: string;
	createdAt: string;
	inputBindings: readonly WorkflowInputBindingProvenanceV1[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireText(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Workflow ${field} must be a non-empty string`);
	}
	return value.trim();
}

function optionalPositiveNumber(value: unknown, field: string): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		throw new Error(`Workflow media asset ${field} must be a positive finite number`);
	}
	return value;
}

export function parseWorkflowMediaAssetV1(value: unknown): WorkflowMediaAssetV1 {
	if (!isRecord(value) || value.protocolVersion !== WORKFLOW_MEDIA_ASSET_PROTOCOL_VERSION) {
		throw new Error(`Workflow media asset protocolVersion must be ${WORKFLOW_MEDIA_ASSET_PROTOCOL_VERSION}`);
	}
	if (!WORKFLOW_MEDIA_KINDS.includes(value.kind as WorkflowMediaKind)) {
		throw new Error("Workflow media asset kind must be image, video, or audio");
	}
	const url = requireText(value.url, "media asset url");
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error("Workflow media asset url must be an absolute URL");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("Workflow media asset url must use HTTP(S)");
	}
	if (value.mimeType !== null && (typeof value.mimeType !== "string" || !value.mimeType.trim())) {
		throw new Error("Workflow media asset mimeType must be a non-empty string or null");
	}
	return {
		protocolVersion: WORKFLOW_MEDIA_ASSET_PROTOCOL_VERSION,
		kind: value.kind as WorkflowMediaKind,
		url,
		mimeType: value.mimeType === null ? null : value.mimeType.trim(),
		...(optionalPositiveNumber(value.width, "width") !== undefined ? { width: Number(value.width) } : {}),
		...(optionalPositiveNumber(value.height, "height") !== undefined ? { height: Number(value.height) } : {}),
		...(optionalPositiveNumber(value.durationSeconds, "durationSeconds") !== undefined
			? { durationSeconds: Number(value.durationSeconds) }
			: {}),
	};
}

function parseArtifactIdentity(value: unknown, field: string): WorkflowArtifactIdentityV1 {
	if (!isRecord(value)) throw new Error(`Workflow provenance ${field} must be an object`);
	const type = requireText(value.type, `${field}.type`);
	if (value.identity !== null && (typeof value.identity !== "string" || !value.identity.trim())) {
		throw new Error(`Workflow provenance ${field}.identity must be a non-empty string or null`);
	}
	return { type, identity: value.identity === null ? null : value.identity.trim() };
}

function parseInputBinding(value: unknown, index: number): WorkflowInputBindingProvenanceV1 {
	if (!isRecord(value) || !Array.isArray(value.artifacts)) {
		throw new Error(`Workflow provenance inputBindings[${index}] must contain an artifacts array`);
	}
	return {
		sourceNodeId: requireText(value.sourceNodeId, `inputBindings[${index}].sourceNodeId`),
		sourceNodeRunId: requireText(value.sourceNodeRunId, `inputBindings[${index}].sourceNodeRunId`),
		sourcePortId: requireText(value.sourcePortId, `inputBindings[${index}].sourcePortId`),
		targetPortId: requireText(value.targetPortId, `inputBindings[${index}].targetPortId`),
		artifacts: value.artifacts.map((artifact, artifactIndex) => (
			parseArtifactIdentity(artifact, `inputBindings[${index}].artifacts[${artifactIndex}]`)
		)),
	};
}

export function parseWorkflowNodeProvenanceV1(value: unknown): WorkflowNodeProvenanceV1 {
	if (!isRecord(value) || value.protocolVersion !== WORKFLOW_NODE_PROVENANCE_PROTOCOL_VERSION) {
		throw new Error(`Workflow provenance protocolVersion must be ${WORKFLOW_NODE_PROVENANCE_PROTOCOL_VERSION}`);
	}
	if (!Number.isInteger(value.attempt) || Number(value.attempt) < 1) {
		throw new Error("Workflow provenance attempt must be a positive integer");
	}
	if (!Array.isArray(value.inputBindings)) {
		throw new Error("Workflow provenance inputBindings must be an array");
	}
	const createdAt = requireText(value.createdAt, "provenance.createdAt");
	if (!Number.isFinite(Date.parse(createdAt))) {
		throw new Error("Workflow provenance createdAt must be a valid timestamp");
	}
	return {
		protocolVersion: WORKFLOW_NODE_PROVENANCE_PROTOCOL_VERSION,
		executionId: requireText(value.executionId, "provenance.executionId"),
		nodeRunId: requireText(value.nodeRunId, "provenance.nodeRunId"),
		attempt: Number(value.attempt),
		flowId: requireText(value.flowId, "provenance.flowId"),
		flowVersionId: requireText(value.flowVersionId, "provenance.flowVersionId"),
		nodeId: requireText(value.nodeId, "provenance.nodeId"),
		executorRef: requireText(value.executorRef, "provenance.executorRef"),
		createdAt,
		inputBindings: value.inputBindings.map(parseInputBinding),
	};
}
