import type { WorkflowInputBindingProvenanceV1 } from "@tapcanvas/workflow-kernel-protocol";
import { sha256Hex } from "../asset/book-content-hash";

export const WORKFLOW_ARTIFACT_CONTRACT_PROTOCOL_VERSION = "workflow.artifact-contract/v1" as const;
export const WORKFLOW_INPUT_CONTRACT_REJECTION_PROTOCOL_VERSION = "workflow.input-contract-rejection/v1" as const;

export type WorkflowArtifactContractV1 = Readonly<{
	protocolVersion: typeof WORKFLOW_ARTIFACT_CONTRACT_PROTOCOL_VERSION;
	artifactType: string;
	schemaVersion: string;
	constraints: Readonly<Record<string, unknown>>;
	fingerprint: string;
}>;

export type WorkflowRejectedInputBindingV1 = Readonly<{
	targetPortId: string;
	sourceNodeId: string;
	sourceNodeRunId: string;
	sourcePortId: string;
	artifacts: WorkflowInputBindingProvenanceV1["artifacts"];
	expectedContract: WorkflowArtifactContractV1;
}>;

export type WorkflowInputContractRejectionV1 = Readonly<{
	protocolVersion: typeof WORKFLOW_INPUT_CONTRACT_REJECTION_PROTOCOL_VERSION;
	consumerNodeId: string;
	rejectedBindings: readonly WorkflowRejectedInputBindingV1[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireText(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Workflow input contract ${field} must be a non-empty string`);
	}
	return value.trim();
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === "string" || typeof value === "boolean") {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Workflow artifact contract cannot contain a non-finite number");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (!isRecord(value)) throw new Error("Workflow artifact contract must contain only JSON-compatible facts");
	return `{${Object.keys(value)
		.filter((key) => value[key] !== undefined)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
		.join(",")}}`;
}

export function createWorkflowArtifactContract(input: Readonly<{
	artifactType: string;
	schemaVersion: string;
	constraints: Readonly<Record<string, unknown>>;
}>): WorkflowArtifactContractV1 {
	const facts = {
		protocolVersion: WORKFLOW_ARTIFACT_CONTRACT_PROTOCOL_VERSION,
		artifactType: requireText(input.artifactType, "artifactType"),
		schemaVersion: requireText(input.schemaVersion, "schemaVersion"),
		constraints: input.constraints,
	};
	return {
		...facts,
		fingerprint: sha256Hex(canonicalJson(facts)),
	};
}

export class WorkflowInputContractError extends Error {
	readonly targetPortId: string;
	readonly expectedContract: WorkflowArtifactContractV1;

	constructor(input: Readonly<{
		targetPortId: string;
		expectedContract: WorkflowArtifactContractV1;
		cause: unknown;
	}>) {
		const causeMessage = input.cause instanceof Error ? input.cause.message : String(input.cause);
		super(causeMessage, input.cause instanceof Error ? { cause: input.cause } : undefined);
		this.name = "WorkflowInputContractError";
		this.targetPortId = requireText(input.targetPortId, "targetPortId");
		this.expectedContract = input.expectedContract;
	}
}

export function createWorkflowInputContractRejection(input: Readonly<{
	consumerNodeId: string;
	inputBindings: readonly WorkflowInputBindingProvenanceV1[];
	error: WorkflowInputContractError;
}>): WorkflowInputContractRejectionV1 {
	const rejectedBindings = input.inputBindings
		.filter((binding) => binding.targetPortId === input.error.targetPortId)
		.map((binding) => ({
			targetPortId: binding.targetPortId,
			sourceNodeId: binding.sourceNodeId,
			sourceNodeRunId: binding.sourceNodeRunId,
			sourcePortId: binding.sourcePortId,
			artifacts: binding.artifacts,
			expectedContract: input.error.expectedContract,
		}));
	if (rejectedBindings.length === 0) {
		throw new Error(
			`Workflow input contract rejection for ${input.error.targetPortId} has no recorded input provenance`,
		);
	}
	return {
		protocolVersion: WORKFLOW_INPUT_CONTRACT_REJECTION_PROTOCOL_VERSION,
		consumerNodeId: requireText(input.consumerNodeId, "consumerNodeId"),
		rejectedBindings,
	};
}

function parseArtifactContract(value: unknown): WorkflowArtifactContractV1 {
	if (!isRecord(value) || value.protocolVersion !== WORKFLOW_ARTIFACT_CONTRACT_PROTOCOL_VERSION) {
		throw new Error(`Workflow artifact contract protocolVersion must be ${WORKFLOW_ARTIFACT_CONTRACT_PROTOCOL_VERSION}`);
	}
	if (!isRecord(value.constraints)) throw new Error("Workflow artifact contract constraints must be an object");
	const parsed = createWorkflowArtifactContract({
		artifactType: requireText(value.artifactType, "artifactType"),
		schemaVersion: requireText(value.schemaVersion, "schemaVersion"),
		constraints: value.constraints,
	});
	if (requireText(value.fingerprint, "fingerprint") !== parsed.fingerprint) {
		throw new Error("Workflow artifact contract fingerprint does not match its canonical facts");
	}
	return parsed;
}

export function parseWorkflowInputContractRejectionV1(value: unknown): WorkflowInputContractRejectionV1 | null {
	if (!isRecord(value) || value.protocolVersion !== WORKFLOW_INPUT_CONTRACT_REJECTION_PROTOCOL_VERSION) return null;
	if (!Array.isArray(value.rejectedBindings) || value.rejectedBindings.length === 0) {
		throw new Error("Workflow input contract rejection must contain rejectedBindings");
	}
	return {
		protocolVersion: WORKFLOW_INPUT_CONTRACT_REJECTION_PROTOCOL_VERSION,
		consumerNodeId: requireText(value.consumerNodeId, "consumerNodeId"),
		rejectedBindings: value.rejectedBindings.map((binding, index) => {
			if (!isRecord(binding) || !Array.isArray(binding.artifacts)) {
				throw new Error(`Workflow input contract rejectedBindings[${index}] is invalid`);
			}
			return {
				targetPortId: requireText(binding.targetPortId, `rejectedBindings[${index}].targetPortId`),
				sourceNodeId: requireText(binding.sourceNodeId, `rejectedBindings[${index}].sourceNodeId`),
				sourceNodeRunId: requireText(binding.sourceNodeRunId, `rejectedBindings[${index}].sourceNodeRunId`),
				sourcePortId: requireText(binding.sourcePortId, `rejectedBindings[${index}].sourcePortId`),
				artifacts: binding.artifacts.map((artifact, artifactIndex) => {
					if (!isRecord(artifact)) {
						throw new Error(`Workflow input contract rejectedBindings[${index}].artifacts[${artifactIndex}] is invalid`);
					}
					const identity = artifact.identity;
					if (identity !== null && (typeof identity !== "string" || !identity.trim())) {
						throw new Error(`Workflow input contract rejectedBindings[${index}].artifacts[${artifactIndex}].identity is invalid`);
					}
					return {
						type: requireText(artifact.type, `rejectedBindings[${index}].artifacts[${artifactIndex}].type`),
						identity: identity === null ? null : identity.trim(),
					};
				}),
				expectedContract: parseArtifactContract(binding.expectedContract),
			};
		}),
	};
}
