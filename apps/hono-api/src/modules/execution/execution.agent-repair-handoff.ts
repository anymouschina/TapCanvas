import { createHash } from "node:crypto";
import { workflowAgentSessionKey, workflowAgentTurnOrdinal } from "./execution.agent-identity";

export type WorkflowAgentRepairSource = Readonly<{ sessionKey: string; turnId: string }>;

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

type SourceMismatch = Readonly<{
	reason: "source_type_changed" | "source_value_changed" | "source_key_changed" | "source_array_length_changed"
		| "source_json_invalid" | "source_json_container_required" | "source_number_identity_unprovable";
	path: string; checkpointType: string; currentType: string;
}>;

export type WorkflowAgentRepairSourceDiagnostics = SourceMismatch & Readonly<{
	checkpointSourceHash: string | null; currentSourceHash: string;
}>;

/** Diagnostics retain identity evidence without exposing frozen source values. */
export class WorkflowAgentRepairSourceMismatchError extends Error {
	readonly diagnostics: WorkflowAgentRepairSourceDiagnostics;
	constructor(checkpointSource: unknown, currentSource: string, mismatch: SourceMismatch) {
		super("workflow_agent_repair_source_mismatch");
		this.name = "WorkflowAgentRepairSourceMismatchError";
		this.diagnostics = { ...mismatch,
			checkpointSourceHash: typeof checkpointSource === "string" ? sourceHash(checkpointSource) : null,
			currentSourceHash: sourceHash(currentSource) };
	}
}

function sourceHash(source: string): string {
	return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function sourceType(value: unknown): string {
	return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

function sourcePath(parent: string, key: string | number): string {
	return `${parent}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

/** Object insertion order is transport encoding; array position and all facts are identity. */
function compareSourceValues(checkpoint: unknown, current: unknown, path: string): SourceMismatch | null {
	const types = { checkpointType: sourceType(checkpoint), currentType: sourceType(current) };
	const mismatch = (reason: SourceMismatch["reason"]): SourceMismatch => ({ reason, path, ...types });
	if (types.checkpointType !== types.currentType) return mismatch("source_type_changed");
	// Workflow facts originate from JSON.stringify of JS values. Reject non-finite
	// parse results, which cannot originate from that frozen serialization.
	if (typeof checkpoint === "number" && typeof current === "number"
		&& (!Number.isFinite(checkpoint) || !Number.isFinite(current))) {
		return mismatch("source_number_identity_unprovable");
	}
	if (Array.isArray(checkpoint) && Array.isArray(current)) {
		if (checkpoint.length !== current.length) return mismatch("source_array_length_changed");
		for (let index = 0; index < checkpoint.length; index += 1) {
			const nested = compareSourceValues(checkpoint[index], current[index], sourcePath(path, index));
			if (nested) return nested;
		}
		return null;
	}
	const checkpointRecord = record(checkpoint);
	const currentRecord = record(current);
	if (checkpointRecord && currentRecord) {
		const checkpointKeys = Object.keys(checkpointRecord).sort();
		const currentKeys = Object.keys(currentRecord).sort();
		for (const key of [...new Set([...checkpointKeys, ...currentKeys])].sort()) {
			if (!Object.prototype.hasOwnProperty.call(checkpointRecord, key) || !Object.prototype.hasOwnProperty.call(currentRecord, key)) {
				return { reason: "source_key_changed", path: sourcePath(path, key),
					checkpointType: Object.prototype.hasOwnProperty.call(checkpointRecord, key) ? sourceType(checkpointRecord[key]) : "missing",
					currentType: Object.prototype.hasOwnProperty.call(currentRecord, key) ? sourceType(currentRecord[key]) : "missing" };
			}
			const nested = compareSourceValues(checkpointRecord[key], currentRecord[key], sourcePath(path, key));
			if (nested) return nested;
		}
		return null;
	}
	return Object.is(checkpoint, current) ? null : mismatch("source_value_changed");
}

function verifySourceIdentity(checkpointSource: unknown, currentSource: string): void {
	if (checkpointSource === currentSource) return;
	const types = { checkpointType: sourceType(checkpointSource), currentType: "string" };
	if (typeof checkpointSource !== "string") {
		throw new WorkflowAgentRepairSourceMismatchError(checkpointSource, currentSource, { reason: "source_type_changed", path: "", ...types });
	}
	let checkpoint: unknown;
	let current: unknown;
	try {
		checkpoint = JSON.parse(checkpointSource) as unknown;
		current = JSON.parse(currentSource) as unknown;
	} catch {
		throw new WorkflowAgentRepairSourceMismatchError(checkpointSource, currentSource, { reason: "source_json_invalid", path: "", ...types });
	}
	if ((!record(checkpoint) && !Array.isArray(checkpoint)) || (!record(current) && !Array.isArray(current))) {
		throw new WorkflowAgentRepairSourceMismatchError(checkpointSource, currentSource, { reason: "source_json_container_required", path: "",
			checkpointType: sourceType(checkpoint), currentType: sourceType(current) });
	}
	const mismatch = compareSourceValues(checkpoint, current, "");
	if (mismatch) throw new WorkflowAgentRepairSourceMismatchError(checkpointSource, currentSource, mismatch);
}

/** Only a frozen replay receipt may nominate an inactive predecessor session. */
export function workflowAgentRepairSource(input: {
	evidence: Record<string, unknown>; sourceExecutionId: string; nodeId: string;
}): WorkflowAgentRepairSource | null {
	const delivery = record(input.evidence.deliveryEvidence);
	const checkpoint = record(delivery?.recoveryCheckpoint);
	if (!delivery || !checkpoint) return null;
	const ordinal = delivery.physicalRetryOrdinal;
	if (ordinal !== undefined && ordinal !== null && (typeof ordinal !== "number" || !Number.isInteger(ordinal) || ordinal < 1)) {
		throw new Error("workflow_agent_repair_source_ordinal_invalid");
	}
	const identity = { executionId: input.sourceExecutionId, nodeId: input.nodeId,
		physicalRetryOrdinal: typeof ordinal === "number" ? ordinal : null };
	const sessionKey = workflowAgentSessionKey(identity);
	const turnId = delivery.logicalTaskId;
	const observedOrdinal = typeof turnId === "string" ? workflowAgentTurnOrdinal({
		executionId: input.sourceExecutionId, nodeId: input.nodeId, observedTurnId: turnId,
	}) : null;
	// physicalRetryOrdinal can nominate the next scheduled action while the
	// receipt still belongs to its predecessor. The receipt owns its turn ID.
	if (delivery.sessionKey !== sessionKey || typeof turnId !== "string" || observedOrdinal === null
		|| (typeof ordinal === "number" && observedOrdinal > ordinal)) {
		throw new Error("workflow_agent_repair_source_identity_mismatch");
	}
	return { sessionKey, turnId };
}

/** Preserve every repair field, but never move a draft across source/contract identity. */
export function verifyWorkflowAgentRepairHandoff(input: {
	checkpoint: Record<string, unknown>; sourceContext: string;
}): Record<string, unknown> {
	const checkpoint = input.checkpoint;
	if (checkpoint.version !== 1 || typeof checkpoint.candidate !== "string" || typeof checkpoint.correction !== "string" || !checkpoint.correction) {
		throw new Error("workflow_agent_repair_checkpoint_invalid");
	}
	if (typeof checkpoint.contractHash !== "string" || !checkpoint.contractHash) throw new Error("workflow_agent_repair_contract_missing");
	// agents-cli compares this hash against its normalized contract at admission.
	verifySourceIdentity(checkpoint.sourceContext, input.sourceContext);
	// Preserve the frozen bytes for agents-cli's own admission and recovery fences.
	return { ...checkpoint };
}
