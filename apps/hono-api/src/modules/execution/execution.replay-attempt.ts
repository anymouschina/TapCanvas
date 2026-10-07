import { createHash } from "node:crypto";

export type WorkflowReplayAttemptV1 = Readonly<{
	version: 1;
	idempotencyKey: string;
	requestHash: string;
}>;

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value !== null && typeof value === "object") return Object.fromEntries(
		Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]),
	);
	return value;
}

/** Bind one explicit attempt to request and immutable source facts, before resolving mutable asset versions. */
export function workflowReplayAttempt(input: Readonly<{
	idempotencyKey: string; flowId: string; ownerId: string;
	sourceExecutionId: string; sourceFlowVersionId: string; sourceSnapshot: unknown; liveFlowData: unknown;
	triggerNodeId: string; startFromNodeId: string; stopAfterNodeId: string;
	refreshAssetIds?: readonly string[]; trigger: string; concurrency?: number;
}>): WorkflowReplayAttemptV1 {
	const key = input.idempotencyKey.trim();
	if (!key) throw new Error("workflow_replay_idempotency_key_missing");
	const live: unknown = typeof input.liveFlowData === "string" ? JSON.parse(input.liveFlowData) : input.liveFlowData;
	const { idempotencyKey: _key, liveFlowData: _live, refreshAssetIds: _ids, ...request } = input;
	const fingerprint = canonical({ ...request, liveFlowData: live, refreshAssetIds: [...new Set(input.refreshAssetIds ?? [])].sort() });
	return { version: 1, idempotencyKey: key, requestHash: `sha256:${createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex")}` };
}
