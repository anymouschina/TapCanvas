import type {
	WorkflowPluginCapabilityExecutionV1,
	WorkflowPluginExecutionMode,
	WorkflowPluginResultLookupMode,
	WorkflowPluginRetrySafety,
	WorkflowPluginSideEffect,
} from "./plugin-types";

export const WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION = "workflow.execution-semantics/v2" as const;

export const WORKFLOW_RECOVERY_MODES = ["replay", "reconcile", "manual"] as const;
export type WorkflowRecoveryMode = (typeof WORKFLOW_RECOVERY_MODES)[number];

export const WORKFLOW_RETRY_BACKOFF_CLASSES = ["none", "bounded_exponential"] as const;
export type WorkflowRetryBackoffClass = (typeof WORKFLOW_RETRY_BACKOFF_CLASSES)[number];

export const WORKFLOW_FAILURE_STAGES = [
	"trigger",
	"input",
	"script_execution",
	"asset_access",
	"agent_authoring",
	"media_generation",
	"assembly",
	"tool_execution",
	"human_interaction",
	"control",
	"artifact_persistence",
	"delivery_verification",
	"export",
	"subworkflow",
	"plugin_execution",
] as const;
export type WorkflowFailureStage = (typeof WORKFLOW_FAILURE_STAGES)[number];

export type WorkflowExecutionIdempotencyV2 = Readonly<
	| { source: "runtime_node"; inputField: null }
	| { source: "input"; inputField: string }
>;

export type WorkflowExecutionResultLookupV2 = Readonly<{
	mode: WorkflowPluginResultLookupMode;
	outputField: string | null;
}>;

/**
 * Canonical runtime semantics used by both built-in and plugin workflow executors.
 * A workflow execution freezes one instance per node into its immutable flow version.
 */
export type WorkflowExecutionSemanticsV2 = Readonly<{
	protocolVersion: typeof WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION;
	sideEffect: WorkflowPluginSideEffect;
	retrySafety: WorkflowPluginRetrySafety;
	executionMode: WorkflowPluginExecutionMode;
	idempotency: WorkflowExecutionIdempotencyV2 | null;
	resultLookup: WorkflowExecutionResultLookupV2;
	recoveryMode: WorkflowRecoveryMode;
	maxAutomaticAttempts: number;
	backoffClass: WorkflowRetryBackoffClass;
	failureStage: WorkflowFailureStage;
}>;

export type WorkflowNodeExecutionSemanticsSnapshotV2 = Readonly<{
	executorRef: string;
	semantics: WorkflowExecutionSemanticsV2;
}>;

export type WorkflowExecutionSemanticsSnapshotV2 = Readonly<{
	protocolVersion: typeof WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION;
	nodes: Readonly<Record<string, WorkflowNodeExecutionSemanticsSnapshotV2>>;
}>;

function requireIdentity(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
	return value.trim();
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
	return value as Record<string, unknown>;
}

function requireMember<T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
	if (typeof value !== "string" || !values.includes(value)) throw new Error(`${field} is invalid`);
	return value as T[number];
}

export function parseWorkflowExecutionSemanticsV2(value: unknown): WorkflowExecutionSemanticsV2 {
	const record = requireRecord(value, "Workflow execution semantics");
	if (record.protocolVersion !== WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION) {
		throw new Error(`Workflow execution semantics protocolVersion must be ${WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION}`);
	}
	const idempotency = record.idempotency === null
		? null
		: (() => {
			const parsed = requireRecord(record.idempotency, "Workflow execution semantics idempotency");
			if (parsed.source === "runtime_node" && parsed.inputField === null) {
				return { source: "runtime_node", inputField: null } as const;
			}
			if (parsed.source === "input") {
				return { source: "input", inputField: requireIdentity(parsed.inputField, "Workflow execution semantics idempotency.inputField") } as const;
			}
			throw new Error("Workflow execution semantics idempotency source is invalid");
		})();
	const resultLookupRecord = requireRecord(record.resultLookup, "Workflow execution semantics resultLookup");
	const resultLookupMode = requireMember(
		resultLookupRecord.mode,
		["none", "idempotency_key", "provider_receipt"] as const,
		"Workflow execution semantics resultLookup.mode",
	);
	const resultLookupOutputField = resultLookupRecord.outputField === null
		? null
		: requireIdentity(resultLookupRecord.outputField, "Workflow execution semantics resultLookup.outputField");
	if ((resultLookupMode === "provider_receipt") !== (resultLookupOutputField !== null)) {
		throw new Error("Provider receipt result lookup requires exactly one output field");
	}
	if (resultLookupMode === "idempotency_key" && idempotency === null) {
		throw new Error("Idempotency-key result lookup requires an idempotency identity");
	}
	const maxAutomaticAttempts = record.maxAutomaticAttempts;
	if (!Number.isInteger(maxAutomaticAttempts) || Number(maxAutomaticAttempts) < 1 || Number(maxAutomaticAttempts) > 8) {
		throw new Error("Workflow execution semantics maxAutomaticAttempts must be an integer between 1 and 8");
	}
	const recoveryMode = requireMember(record.recoveryMode, WORKFLOW_RECOVERY_MODES, "Workflow execution semantics recoveryMode");
	if (recoveryMode !== "replay" && Number(maxAutomaticAttempts) !== 1) {
		throw new Error("Only replay recovery may declare more than one automatic attempt");
	}
	if (record.retrySafety === "idempotency_key_required" && idempotency === null) {
		throw new Error("Idempotency-key retry safety requires an idempotency identity");
	}
	if (record.sideEffect === "paid_generation" && (recoveryMode !== "reconcile" || resultLookupMode !== "provider_receipt")) {
		throw new Error("Paid generation must reconcile through a provider receipt");
	}
	return Object.freeze({
		protocolVersion: WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION,
		sideEffect: requireMember(record.sideEffect, ["none", "local_mutation", "external_mutation", "paid_generation"] as const, "Workflow execution semantics sideEffect"),
		retrySafety: requireMember(record.retrySafety, ["safe", "idempotency_key_required", "unsafe"] as const, "Workflow execution semantics retrySafety"),
		executionMode: requireMember(record.executionMode, ["parallel_safe", "sequential", "exclusive"] as const, "Workflow execution semantics executionMode"),
		idempotency,
		resultLookup: Object.freeze({ mode: resultLookupMode, outputField: resultLookupOutputField }),
		recoveryMode,
		maxAutomaticAttempts: Number(maxAutomaticAttempts),
		backoffClass: requireMember(record.backoffClass, WORKFLOW_RETRY_BACKOFF_CLASSES, "Workflow execution semantics backoffClass"),
		failureStage: requireMember(record.failureStage, WORKFLOW_FAILURE_STAGES, "Workflow execution semantics failureStage"),
	});
}

export function parseWorkflowExecutionSemanticsSnapshotV2(value: unknown): WorkflowExecutionSemanticsSnapshotV2 {
	const record = requireRecord(value, "Workflow execution semantics snapshot");
	if (record.protocolVersion !== WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION) {
		throw new Error(`Workflow execution semantics snapshot protocolVersion must be ${WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION}`);
	}
	const rawNodes = requireRecord(record.nodes, "Workflow execution semantics snapshot nodes");
	const nodes: Record<string, WorkflowNodeExecutionSemanticsSnapshotV2> = {};
	for (const [nodeId, rawNode] of Object.entries(rawNodes)) {
		const parsedNode = requireRecord(rawNode, `Workflow execution semantics snapshot node ${nodeId}`);
		nodes[requireIdentity(nodeId, "Workflow execution semantics snapshot node id")] = Object.freeze({
			executorRef: requireIdentity(parsedNode.executorRef, `Workflow execution semantics snapshot node ${nodeId}.executorRef`),
			semantics: parseWorkflowExecutionSemanticsV2(parsedNode.semantics),
		});
	}
	return Object.freeze({
		protocolVersion: WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION,
		nodes: Object.freeze(nodes),
	});
}

/** Plugin declarations are deterministically projected into the canonical runtime contract. */
export function deriveWorkflowExecutionSemanticsV2(
	execution: WorkflowPluginCapabilityExecutionV1,
	failureStage: WorkflowFailureStage = "plugin_execution",
): WorkflowExecutionSemanticsV2 {
	const idempotency: WorkflowExecutionIdempotencyV2 | null = execution.idempotencyKeyInput
		? Object.freeze({ source: "input", inputField: execution.idempotencyKeyInput })
		: null;
	const recoveryMode: WorkflowRecoveryMode = execution.sideEffect === "none" && execution.retrySafety === "safe"
		? "replay"
		: execution.resultLookup !== "none"
			? "reconcile"
			: "manual";
	return parseWorkflowExecutionSemanticsV2({
		protocolVersion: WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION,
		sideEffect: execution.sideEffect,
		retrySafety: execution.retrySafety,
		executionMode: execution.executionMode,
		idempotency,
		resultLookup: { mode: execution.resultLookup, outputField: execution.resultLookupKeyOutput },
		recoveryMode,
		// A safe replay remains available for an explicit restart, but an
		// unchanged deterministic input is never rerun automatically. Retrying
		// transport/provider effects belongs to their durable receipt owner.
		maxAutomaticAttempts: 1,
		backoffClass: "none",
		failureStage,
	});
}
