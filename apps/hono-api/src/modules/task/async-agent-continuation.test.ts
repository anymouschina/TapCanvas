import { describe, expect, it } from "vitest";

import {
	buildAsyncAgentContinuationId,
	buildAsyncAgentContinuationExecutionTraceId,
	buildAsyncAgentContinuationNodeStates,
	collectAcceptedAsyncDurableRunIds,
	collectTaskResultMaterializedArtifacts,
	parseAsyncAgentContinuation,
} from "./async-agent-continuation";

describe("collectAcceptedAsyncDurableRunIds", () => {
	it("turns only accepted async receipts into stable run dependencies", () => {
		expect(collectAcceptedAsyncDurableRunIds([
			{
				version: 1,
				toolName: "tapcanvas_video_orchestrate",
				mode: "preflight_commit",
				runId: "run-ignored",
				taskId: null,
				draftRevision: null,
				beatRevision: null,
				preflightRevision: "preflight-1",
				preflightFingerprint: "fingerprint-1",
				clipIndex: null,
				acceptedAsync: false,
			},
			{
				version: 1,
				toolName: "tapcanvas_video_orchestrate",
				mode: "loop",
				runId: "run-ready",
				taskId: null,
				draftRevision: null,
				beatRevision: null,
				preflightRevision: null,
				preflightFingerprint: null,
				clipIndex: null,
				acceptedAsync: true,
			},
			{
				version: 1,
				toolName: "tapcanvas_video_orchestrate",
				mode: "loop",
				runId: " run-ready ",
				taskId: null,
				draftRevision: null,
				beatRevision: null,
				preflightRevision: null,
				preflightFingerprint: null,
				clipIndex: null,
				acceptedAsync: true,
			},
		])).toEqual(["run-ready"]);
	});
});

describe("buildAsyncAgentContinuationId", () => {
	it("is deterministic and independent of dependency order", () => {
		const left = buildAsyncAgentContinuationId({
			requestId: "request-1",
			dependencyNodeIds: ["node-b", "node-a", "node-a"],
			dependencyTaskIds: ["task-b", "task-a"],
			dependencyRunIds: [],
			progressFingerprint: "progress-1",
		});
		const right = buildAsyncAgentContinuationId({
			requestId: "request-1",
			dependencyNodeIds: ["node-a", "node-b"],
			dependencyTaskIds: ["task-a", "task-b"],
			dependencyRunIds: [],
			progressFingerprint: "progress-1",
		});

		expect(left).toBe(right);
		expect(left).toMatch(/^async-continuation:[a-f0-9]{40}$/u);
	});

	it("gives every chained stage a distinct id while preserving retry idempotency", () => {
		const first = buildAsyncAgentContinuationId({
			requestId: "request-1",
			dependencyNodeIds: ["anchor-a"],
			dependencyTaskIds: ["task-anchor-a"],
			dependencyRunIds: [],
			progressFingerprint: "progress-1",
		});
		expect(first).not.toBeNull();

		const secondInput = {
			parentContinuationId: first,
			dependencyNodeIds: ["keyframe-a", "keyframe-b"],
			dependencyTaskIds: ["task-keyframe-a", "task-keyframe-b"],
			dependencyRunIds: [],
			progressFingerprint: "progress-2",
		};
		const second = buildAsyncAgentContinuationId(secondInput);

		expect(second).not.toBe(first);
		expect(buildAsyncAgentContinuationId(secondInput)).toBe(second);
	});

	it("requires a real request or parent continuation identity", () => {
		expect(
			buildAsyncAgentContinuationId({
				dependencyNodeIds: ["node-a"],
				dependencyTaskIds: ["task-a"],
				dependencyRunIds: [],
				progressFingerprint: "progress-1",
			}),
		).toBeNull();
	});
});

describe("buildAsyncAgentContinuationExecutionTraceId", () => {
	it("keeps the durable identity stable while giving every physical trace and billing effect a unique id", () => {
		const firstPhysicalEffectId = buildAsyncAgentContinuationExecutionTraceId({
			continuationId: "async-continuation:stable",
			attempt: 0,
		});
		const retriedPhysicalEffectId = buildAsyncAgentContinuationExecutionTraceId({
			continuationId: "async-continuation:stable",
			attempt: 2,
		});

		expect(firstPhysicalEffectId).toBe("async-continuation:stable:attempt:0");
		expect(retriedPhysicalEffectId).toBe("async-continuation:stable:attempt:2");
		expect(firstPhysicalEffectId).not.toBe("async-continuation:stable");
		expect(retriedPhysicalEffectId).not.toBe(firstPhysicalEffectId);
	});

	it("rejects missing identities and invalid attempts", () => {
		expect(() => buildAsyncAgentContinuationExecutionTraceId({
			continuationId: "",
			attempt: 0,
		})).toThrow("async_continuation_trace_id_required");
		expect(() => buildAsyncAgentContinuationExecutionTraceId({
			continuationId: "async-continuation:stable",
			attempt: -1,
		})).toThrow("async_continuation_trace_attempt_invalid");
	});
});

describe("buildAsyncAgentContinuationNodeStates", () => {
	it("uses real media URLs as readiness and preserves explicit failures", () => {
		const states = buildAsyncAgentContinuationNodeStates([
			{ id: "ready", data: { status: "running", imageUrl: "https://cdn.example/ready.png" } },
			{ id: "video-ready", data: { status: "running", videoUrl: "https://cdn.example/ready.mp4" } },
			{ id: "audio-ready", data: { status: "running", audioResults: [{ url: "https://cdn.example/ready.mp3" }] } },
			{ id: "failed", data: { status: "error" } },
			{ id: "cancelled", data: { status: "cancelled" } },
			{ id: "pending", data: { status: "success", imageUrl: "" } },
		]);

		expect([...states.entries()]).toEqual([
			["ready", "ready"],
			["video-ready", "ready"],
			["audio-ready", "ready"],
			["failed", "failed"],
			["cancelled", "failed"],
			["pending", "pending"],
		]);
	});
});

describe("collectTaskResultMaterializedArtifacts", () => {
	it("extracts only a real media URL from the exact accepted task and node", () => {
		const artifacts = collectTaskResultMaterializedArtifacts({
			dependency: {
				version: 2,
				artifactId: "image:node:node-cat",
				nodeId: "node-cat",
				taskId: "task-cat",
				runId: null,
			},
			taskResultJson: JSON.stringify({
				id: "task-cat",
				kind: "text_to_image",
				status: "succeeded",
				assets: [{ type: "image", url: "https://assets.example/cat.png", assetId: "asset-cat" }],
				raw: null,
			}),
			taskResultNodeId: "node-cat",
			observedAt: "2026-08-24T01:26:05.000Z",
		});

		expect(artifacts).toEqual([{
			version: 1,
			artifactId: "image:node:node-cat",
			mediaType: "image",
			nodeId: "node-cat",
			taskId: "task-cat",
			runId: null,
			assetId: "asset-cat",
			assetUrl: "https://assets.example/cat.png",
			observedAt: "2026-08-24T01:26:05.000Z",
			source: "task_result",
		}]);
	});

	it("rejects cross-task, cross-node, wrong-media, and non-http asset evidence", () => {
		const base = {
			dependency: {
				version: 2 as const,
				artifactId: "image:node:node-cat",
				nodeId: "node-cat",
				taskId: "task-cat",
				runId: null,
			},
			observedAt: "2026-08-24T01:26:05.000Z",
		};
		for (const input of [
			{ taskResultNodeId: "node-other", id: "task-cat", type: "image", url: "https://assets.example/cat.png" },
			{ taskResultNodeId: "node-cat", id: "task-other", type: "image", url: "https://assets.example/cat.png" },
			{ taskResultNodeId: "node-cat", id: "task-cat", type: "video", url: "https://assets.example/cat.mp4" },
			{ taskResultNodeId: "node-cat", id: "task-cat", type: "image", url: "data:image/png;base64,abc" },
		] as const) {
			expect(collectTaskResultMaterializedArtifacts({
				...base,
				taskResultNodeId: input.taskResultNodeId,
				taskResultJson: JSON.stringify({
					id: input.id,
					kind: "text_to_image",
					status: "succeeded",
					assets: [{ type: input.type, url: input.url }],
					raw: null,
				}),
			})).toEqual([]);
		}
	});

	it("round-trips server-owned materialized evidence through the durable continuation parser", () => {
		const continuation = parseAsyncAgentContinuation({
			id: "async-continuation:test",
			rootRequestId: "public-turn:test",
			stage: 2,
			resumeTrigger: "dependency",
			parentContinuationId: "public-turn:test",
			userId: "user-test",
			projectId: "project-test",
			flowId: "flow-test",
			chapterId: null,
			bookId: null,
			canvasNodeId: null,
			executionToolPolicy: null,
			sessionKey: "session-test",
			modelKey: "model-test",
			modelAlias: null,
			requiredSkills: [],
			artifactDependencies: [{
				version: 2,
				artifactId: "image:node:node-cat",
				nodeId: "node-cat",
				taskId: "task-cat",
				runId: null,
			}],
			materializedArtifacts: [{
				version: 1,
				artifactId: "image:node:node-cat",
				mediaType: "image",
				nodeId: "node-cat",
				taskId: "task-cat",
				runId: null,
				assetId: "asset-cat",
				assetUrl: "https://assets.example/cat.png",
				observedAt: "2026-08-24T01:26:05.000Z",
				source: "task_result",
			}],
			ownedRepairRuns: [],
			dependencyNodeIds: ["node-cat"],
			dependencyTaskIds: ["task-cat"],
			dependencyRunIds: [],
			handledArtifactIds: ["image:node:node-cat"],
			progressFingerprint: "progress-test",
			expectedDelivery: { mode: "async_artifact", mediaType: "image" },
			createdAt: "2026-08-24T01:24:55.000Z",
			attempt: 0,
			nextAttemptAt: null,
			lastFailure: null,
		});

		expect(continuation?.materializedArtifacts?.[0]?.assetUrl).toBe("https://assets.example/cat.png");
	});
});
