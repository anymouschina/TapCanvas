import { describe, expect, it } from "vitest";

import {
	collectVideoTargetDurationEvidence,
	normalizeAgentsSemanticTaskSummaryFromRuntimeIntentContract,
	normalizeAgentsSemanticTaskSummaryFromToolCalls,
	type BridgeToolCall,
} from "./task.agents-bridge";

function reportToolCall(
	toolCallId: string,
	seq: number,
	deliveryContract: Record<string, unknown>,
): BridgeToolCall {
	const report = {
		taskGoal: "完成用户请求",
		requestedOutput: "真实交付产物",
		taskKind: "generation",
		recommendedNextStage: "继续执行",
		mustStop: false,
		requiresExecutionDelivery: true,
		blockingGaps: [],
		successCriteria: ["最终产物满足合同"],
		deliveryContract,
	};
	return {
		toolCallId,
		seq,
		atMs: seq,
		name: "report_delivery",
		status: "succeeded",
		pathHint: "",
		errorMessage: "",
		outputPreview: JSON.stringify(report),
		outputChars: null,
		outputHead: "",
		outputTail: "",
		outputJson: report,
		inputJson: null,
		requestedAgentType: "",
		startedAt: "",
		finishedAt: "",
		durationMs: null,
	};
}

describe("agents bridge semantic delivery report selection", () => {
	it("projects the persisted root intent contract without re-reading user prose", () => {
		const summary = normalizeAgentsSemanticTaskSummaryFromRuntimeIntentContract({
			version: 2,
			contractHash: "intent-hash-1",
			delivery: {
				mode: "async_artifact",
				mediaType: "video",
				kind: "video",
				output: "当前章节完整成片",
				durationSeconds: 60,
				clipCount: 4,
			},
			must: [
				{ id: "m1", statement: "只交付当前章节", source: "user", evidence: [] },
				{ id: "m2", statement: "必须有最终真实视频 URL", source: "user", evidence: [] },
			],
			forbid: [],
			prefer: [],
			confirmedFacts: [],
			unresolved: [],
		});

		expect(summary).toMatchObject({
			taskGoal: "当前章节完整成片",
			requestedOutput: "当前章节完整成片",
			requiresExecutionDelivery: true,
			successCriteria: ["只交付当前章节", "必须有最终真实视频 URL"],
			deliveryContract: {
				mediaType: "video",
				kind: "video",
				output: "当前章节完整成片",
				durationSeconds: 60,
				clipCount: 4,
			},
		});
	});

	it("does not invent a continuation delivery lock from an incomplete intent contract", () => {
		expect(normalizeAgentsSemanticTaskSummaryFromRuntimeIntentContract({
			version: 2,
			contractHash: "intent-hash-2",
			delivery: { mode: "async_artifact", mediaType: "video", kind: "video", output: "当前章节完整成片" },
			must: [{ id: "m1", statement: "完成成片" }],
			unresolved: ["缺少用户授权"],
		})).toBeNull();
		expect(normalizeAgentsSemanticTaskSummaryFromRuntimeIntentContract({
			version: 2,
			contractHash: "intent-hash-untyped",
			delivery: { mode: "async_artifact", kind: "final_film", output: "当前章节完整成片" },
			must: [{ id: "m1", statement: "完成成片" }],
			unresolved: [],
		})).toBeNull();
	});

	it("uses the latest successful report and preserves its open contract verbatim", () => {
		const summary = normalizeAgentsSemanticTaskSummaryFromToolCalls([
			reportToolCall("report-initial", 1, {
				kind: "image",
				minStillCount: 3,
			}),
			reportToolCall("report-latest", 2, {
				kind: "video",
				targetClipIndexes: [3, 1, 3],
				maxClipCount: 2,
				targetDurationSeconds: 60,
			}),
		]);

		expect(summary?.deliveryContract).toEqual({
			kind: "video",
			targetClipIndexes: [3, 1, 3],
			maxClipCount: 2,
			targetDurationSeconds: 60,
		});
		expect(summary?.successCriteria).toEqual(["最终产物满足合同"]);
	});

	it("does not apply legacy video-specific validation to an open agents-cli contract", () => {
		const summary = normalizeAgentsSemanticTaskSummaryFromToolCalls([
			reportToolCall("report-valid-old", 1, {
				kind: "video",
				targetClipIndexes: [0],
			}),
			reportToolCall("report-invalid-latest", 2, {
				kind: "video",
				targetClipIndexes: [0, 1],
				maxClipCount: 1,
			}),
		]);

		expect(summary?.deliveryContract).toEqual({
			kind: "video",
			targetClipIndexes: [0, 1],
			maxClipCount: 1,
		});
	});

	it("derives duration evidence only from a real video delivery artifact", () => {
		const orchestrateCall: BridgeToolCall = {
			...reportToolCall("orchestrate-start", 3, { kind: "video" }),
			name: "tapcanvas_equipped_workflow_run",
			inputJson: {
				mode: "start",
				storyPlan: {
					targetDurationSeconds: 60,
				},
			},
			outputJson: {
				ok: true,
				status: "scheduled",
				runId: "film-run-1",
			},
		};
		const artifact = {
			toolCallId: "orchestrate-start",
			toolName: "tapcanvas_equipped_workflow_run",
			assetType: "video" as const,
			deliveryState: "accepted_async" as const,
			nodeId: null,
			taskId: null,
			runId: "film-run-1",
			clipIndex: null,
			assetUrl: null,
		};

		expect(collectVideoTargetDurationEvidence({
			toolCalls: [orchestrateCall],
			artifacts: [artifact],
		})).toEqual([60]);
		expect(collectVideoTargetDurationEvidence({
			toolCalls: [orchestrateCall],
			artifacts: [],
		})).toEqual([]);
	});
});
