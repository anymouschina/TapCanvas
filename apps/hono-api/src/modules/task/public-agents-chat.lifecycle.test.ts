import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertSuspendedContinuationOwnership } from "./public-agents-chat";

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!value || typeof value !== "object") return value;
	const record = value as Record<string, unknown>;
	return Object.fromEntries(
		Object.keys(record)
			.filter((key) => key !== "contractHash")
			.sort()
			.map((key) => [key, canonicalize(record[key])]),
	);
}

function createVideoIntentContract(): Record<string, unknown> {
	const contract: Record<string, unknown> = {
		version: 2,
		referenceResolution: { mode: "new_task" },
		delivery: {
			mode: "async_artifact",
			mediaType: "video",
			kind: "video",
			output: "最终成片",
			durationSeconds: 40,
		},
		must: [{ id: "deliver-video", statement: "交付最终成片", source: "user", evidence: ["用户请求"] }],
		forbid: [],
		prefer: [],
		confirmedFacts: [],
		unresolved: [],
		precedence: [],
	};
	contract.contractHash = createHash("sha256")
		.update(JSON.stringify(canonicalize(contract)))
		.digest("hex");
	return contract;
}

function createSuspendedResult(contract: Record<string, unknown>) {
	return {
		id: "task-1",
		kind: "chat",
		status: "succeeded",
		assets: [],
			raw: {
			meta: {
				requestTerminal: { version: 1, terminal: true, status: "suspended", reason: "managed_async_submission" },
				logicalTaskState: {
					version: 1,
					logicalTaskId: "task-1",
					status: "waiting_external",
					reasonCode: "managed_async_submission",
					physicalRunStatus: "handed_off",
					deliveryStatus: "pending",
					taskNodeId: "root",
					taskRevision: 1,
					updatedAt: "2026-08-30T04:00:00.000Z",
					continuationTicket: null,
				},
				runtime: { userIntentContract: contract },
				durableTaskReferences: [],
			},
		},
	} as never;
}

describe("public chat async lifecycle ownership", () => {
	it("requires a durable continuation owner for a suspended video turn", () => {
		const result = createSuspendedResult(createVideoIntentContract());
		expect(() => assertSuspendedContinuationOwnership({
			result,
			registration: { status: "invalid", reason: "no durable owner" },
		})).toThrowError(/没有可验证的持久续跑执行者/);
	});

	it("accepts the durable continuation as the lifecycle owner without a wall-clock production gate", () => {
		const result = createSuspendedResult(createVideoIntentContract());
		expect(() => assertSuspendedContinuationOwnership({
			result,
			registration: {
				status: "reconcile_pending",
				reason: "workflow execution owns the suspended Agent node",
				effectOwner: "workflow_execution",
			},
		})).not.toThrow();
	});
});
