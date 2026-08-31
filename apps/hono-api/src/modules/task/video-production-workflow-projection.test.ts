import { describe, expect, it } from "vitest";
import {
	VIDEO_PRODUCTION_WORKFLOW_NODE_IDS,
	parseVideoProductionWorkflowSnapshot,
} from "@tapcanvas/video-orchestrator-protocol";
import { buildVideoProductionWorkflowSnapshot } from "./video-production-workflow-projection";

const NOW = "2026-08-10T12:00:00.000Z";

function artifact(artifactKey: string, status = "ready") {
	return {
		artifact_key: artifactKey,
		status,
		payload: null,
		error: status === "failed" ? `${artifactKey}_failed` : null,
		created_at: NOW,
		updated_at: NOW,
	};
}

describe("video production workflow projection", () => {
	it("keeps timing empty for workflow stages without execution evidence", () => {
		const snapshot = buildVideoProductionWorkflowSnapshot({
			run: {
				id: "run-queued",
				state: "draft",
				authoring_state: null,
				beat_sheet: null,
				total_clips: 0,
				clips_done: 0,
				error_message: null,
				created_at: NOW,
				updated_at: NOW,
				completed_at: null,
			},
			artifacts: [artifact("graph:manifest", "pending")],
			generatedAt: NOW,
		});

		for (const workflowNodeId of ["story-adaptation", "clip-contracts", "asset-preparation"] as const) {
			expect(snapshot.nodes.find((node) => node.workflowNodeId === workflowNodeId)?.timing).toEqual({
				startedAt: null,
				updatedAt: null,
				finishedAt: null,
				durationMs: null,
			});
		}
	});

	it("keeps the top-level topology fixed at seven nodes for one hundred clips", () => {
		const clips = Array.from({ length: 100 }, (_, clipIndex) => artifact(`clip:${clipIndex}`));
		const submissions = Array.from({ length: 100 }, (_, clipIndex) => artifact(`video-submission:${clipIndex}`));
		const results = Array.from({ length: 100 }, (_, clipIndex) => artifact(`video-result:${clipIndex}`));
		const snapshot = buildVideoProductionWorkflowSnapshot({
			run: {
				id: "run-100",
				state: "concatenated",
				authoring_state: "authoring_done",
				beat_sheet: JSON.stringify({ beats: Array.from({ length: 100 }, (_, clipIndex) => ({ clipIndex })) }),
				total_clips: 100,
				clips_done: 100,
				error_message: null,
				created_at: NOW,
				updated_at: NOW,
				completed_at: NOW,
			},
			artifacts: [
				artifact("graph:manifest"),
				artifact("beat_sheet"),
				...clips,
				artifact("asset:coverage"),
				...submissions,
				...results,
				artifact("concat:auto"),
				artifact("delivery:verify"),
			],
			latestEventSeq: 10_000,
			generatedAt: NOW,
		});

		expect(snapshot.nodes.map((node) => node.workflowNodeId)).toEqual(VIDEO_PRODUCTION_WORKFLOW_NODE_IDS);
		expect(snapshot.nodes).toHaveLength(7);
		expect(snapshot.nodes.find((node) => node.workflowNodeId === "clip-contracts")).toMatchObject({
			status: "succeeded",
			completedUnits: 100,
			totalUnits: 100,
		});
		expect(snapshot.nodes.find((node) => node.workflowNodeId === "media-production")).toMatchObject({
			status: "succeeded",
			completedUnits: 100,
			totalUnits: 100,
			latestEventSeq: 10_000,
			timing: {
				startedAt: NOW,
				updatedAt: NOW,
				finishedAt: NOW,
				durationMs: 0,
			},
		});
		expect(parseVideoProductionWorkflowSnapshot(snapshot).success).toBe(true);
	});

	it("preserves partial success when one media effect fails", () => {
		const snapshot = buildVideoProductionWorkflowSnapshot({
			run: {
				id: "run-partial",
				state: "video_running",
				authoring_state: "authoring_done",
				beat_sheet: JSON.stringify({ beats: [{ clipIndex: 0 }, { clipIndex: 1 }] }),
				total_clips: 2,
				clips_done: 1,
				error_message: null,
				created_at: NOW,
				updated_at: NOW,
				completed_at: null,
			},
			artifacts: [
				artifact("graph:manifest"),
				artifact("beat_sheet"),
				artifact("clip:0"),
				artifact("clip:1"),
				artifact("asset:coverage"),
				artifact("video-submission:0"),
				artifact("video-submission:1", "failed"),
				artifact("video-result:0"),
			],
			effects: [{
				id: "effect-failed",
				workflow_node_id: "media-production",
				status: "failed",
				error_message: "provider_failed",
				created_at: NOW,
				updated_at: NOW,
			}],
			generatedAt: NOW,
		});

		expect(snapshot.nodes.find((node) => node.workflowNodeId === "media-production")).toMatchObject({
			status: "partial",
			completedUnits: 1,
			totalUnits: 2,
			errorCount: 1,
		});
	});
});
