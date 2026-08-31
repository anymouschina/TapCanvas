import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getExecutionTraceLifecycleSnapshot = vi.hoisted(() => vi.fn());

vi.mock("../memory/execution-trace-events.repo", () => ({ getExecutionTraceLifecycleSnapshot }));

import {
	inspectPublicChatVideoProductionStart,
} from "./public-chat-video-production-deadline";

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!value || typeof value !== "object") return value;
	const record = value as Record<string, unknown>;
	return Object.fromEntries(
		Object.keys(record)
			.filter((key) => key !== "contractHash" && !(key === "promptMediaType" && record[key] === null))
			.sort()
			.map((key) => [key, canonicalize(record[key])]),
	);
}

function intentContract(mediaType: "video" | "image" = "video"): Record<string, unknown> {
	const contract = {
		version: 2,
		referenceResolution: { mode: "new_task" },
		must: [{ id: "m1", statement: "交付真实媒体", source: "user", evidence: ["本轮请求"] }],
		forbid: [],
		prefer: [],
		confirmedFacts: [],
		unresolved: [],
		precedence: ["provider_protocol_limits", "user_must"],
		delivery: { mode: "async_artifact", mediaType, kind: "final_media", output: "真实媒体" },
	};
	return {
		...contract,
		contractHash: createHash("sha256").update(JSON.stringify(canonicalize(contract))).digest("hex"),
	};
}

function runtime(input: Readonly<{
	invocations?: Array<Record<string, unknown>>;
	nodeRuns?: Array<Record<string, unknown>>;
	taskRows?: Array<Record<string, unknown>>;
}> = {}) {
	return {
		agent_capability_invocations: { findMany: vi.fn(async () => input.invocations ?? []) },
		workflow_node_runs: { findMany: vi.fn(async () => input.nodeRuns ?? []) },
		task_results: { findMany: vi.fn(async () => input.taskRows ?? []) },
	};
}

const acceptedAt = "2026-08-28T00:00:00.000Z";

describe("inspectPublicChatVideoProductionStart", () => {
	beforeEach(() => {
		getExecutionTraceLifecycleSnapshot.mockReset();
		getExecutionTraceLifecycleSnapshot.mockResolvedValue({
			traceId: "turn-1",
			status: "waiting_async",
			logicalTaskId: "turn-1",
			rootTraceId: "turn-1",
			startedAt: acceptedAt,
			updatedAt: acceptedAt,
			finishedAt: null,
		});
	});

	it("re-anchors the five-minute window to durable workflow execution creation", async () => {
		const db = runtime({
			invocations: [{
				input_json: JSON.stringify({ publicTurnId: "turn-1" }),
				created_at: "2026-08-28T00:01:00.000Z",
				workflow_executions: {
					execution_family_id: "family-1",
					created_at: "2026-08-28T00:01:00.000Z",
				},
			}],
		});
		const status = await inspectPublicChatVideoProductionStart({
			db: db as never,
			userId: "user-1",
			sessionKey: "session-1",
			publicTurnId: "turn-1",
			rootTraceId: "turn-1",
			userIntentContract: intentContract(),
			now: new Date("2026-08-28T00:05:00.000Z"),
		});

		expect(status).toMatchObject({
			version: 6,
			status: "waiting",
			anchor: "workflow_execution_created",
			acceptedAt: "2026-08-28T00:01:00.000Z",
			deadlineAt: "2026-08-28T00:06:00.000Z",
			lastSuccessfulAction: "workflow_accepted",
			providerAcceptedAt: null,
			evidence: null,
			diagnostic: null,
		});
	});

	it("accepts only a durable video provider task created before the deadline", async () => {
		const db = runtime({
			taskRows: [{ task_id: "provider-1", created_at: "2026-08-28T00:04:59.000Z" }],
		});
		const status = await inspectPublicChatVideoProductionStart({
			db: db as never,
			userId: "user-1",
			sessionKey: "session-1",
			publicTurnId: "turn-1",
			rootTraceId: "turn-1",
			userIntentContract: intentContract(),
			durableTaskReferences: [{
				version: 1,
				toolName: "tapcanvas_video_generate_to_canvas",
				mode: null,
				runId: null,
				taskId: "provider-1",
				draftRevision: null,
				beatRevision: null,
				preflightRevision: null,
				preflightFingerprint: null,
				clipIndex: null,
				acceptedAsync: true,
			}],
			now: new Date("2026-08-28T00:06:00.000Z"),
		});

		expect(status).toMatchObject({
			status: "started",
			providerAcceptedAt: "2026-08-28T00:04:59.000Z",
			lastSuccessfulAction: "provider_task_accepted",
			evidence: { method: "direct_video_task", taskId: "provider-1" },
			diagnostic: null,
		});
	});

	it("retains provider evidence that arrived after the execution-anchored deadline", async () => {
		const output = {
			protocolVersion: "1",
			executorRef: "tapcanvas.video.generate/v1",
			nodeId: "video-1",
			executionMode: "once",
			ports: {},
			artifacts: [],
			evidence: { taskId: "provider-late" },
			itemRuns: [],
		};
		const db = runtime({
			invocations: [{
				input_json: JSON.stringify({ publicTurnId: "turn-1" }),
				created_at: "2026-08-28T00:01:00.000Z",
				workflow_executions: {
					execution_family_id: "family-1",
					created_at: "2026-08-28T00:01:00.000Z",
				},
			}],
			nodeRuns: [{ execution_id: "execution-1", node_id: "video-1", output_refs: JSON.stringify(output) }],
			taskRows: [{ task_id: "provider-late", created_at: "2026-08-28T00:06:01.000Z" }],
		});
		const status = await inspectPublicChatVideoProductionStart({
			db: db as never,
			userId: "user-1",
			sessionKey: "session-1",
			publicTurnId: "turn-1",
			rootTraceId: "turn-1",
			userIntentContract: intentContract(),
			now: new Date("2026-08-28T00:06:02.000Z"),
		});

		expect(status).toMatchObject({
			status: "failed",
			anchor: "workflow_execution_created",
			providerAcceptedAt: "2026-08-28T00:06:01.000Z",
			lastSuccessfulAction: "provider_task_accepted",
			evidence: { method: "workflow_video_node", taskId: "provider-late" },
			diagnostic: { blocking: true },
		});
	});

	it("does not apply the video production SLA to a typed image delivery", async () => {
		const db = runtime();
		await expect(inspectPublicChatVideoProductionStart({
			db: db as never,
			userId: "user-1",
			sessionKey: "session-1",
			publicTurnId: "turn-1",
			rootTraceId: "turn-1",
			userIntentContract: intentContract("image"),
			now: new Date("2026-08-28T00:10:00.000Z"),
		})).resolves.toBeNull();
		expect(getExecutionTraceLifecycleSnapshot).not.toHaveBeenCalled();
	});
});
