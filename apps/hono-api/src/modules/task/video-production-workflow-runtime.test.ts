import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";

import { VIDEO_PRODUCTION_WORKFLOW_NODE_IDS } from "@tapcanvas/video-orchestrator-protocol";
import { buildVideoProductionWorkflowSnapshot } from "./video-production-workflow-projection";
import {
	compileVideoProductionWorkflow,
	synchronizeVideoProductionWorkflowCheckpoint,
} from "./video-production-workflow-runtime";

const NOW = "2026-08-10T12:00:00.000Z";
const LATER = "2026-08-10T12:01:00.000Z";

function buildSnapshot(
	generatedAt: string,
	artifactUpdatedAt = NOW,
	artifactStatus: "pending" | "failed" = "pending",
) {
	return buildVideoProductionWorkflowSnapshot({
		run: {
			id: "run-langgraph-100",
			state: "video_running",
			authoring_state: "authoring_done",
			beat_sheet: JSON.stringify({ beats: Array.from({ length: 100 }, (_, clipIndex) => ({ clipIndex })) }),
			total_clips: 100,
			clips_done: 35,
			error_message: null,
			created_at: NOW,
			updated_at: NOW,
			completed_at: null,
		},
		artifacts: [{
			artifact_key: "graph:manifest",
			status: artifactStatus,
			payload: null,
			error: artifactStatus === "failed" ? "manifest failed" : null,
			created_at: NOW,
			updated_at: artifactUpdatedAt,
		}],
		generatedAt,
	});
}

describe("bounded LangGraph production runtime", () => {
	it("checkpoints exactly seven stable nodes even when a run contains one hundred clips", async () => {
		const snapshot = buildSnapshot(NOW);
		const state = await synchronizeVideoProductionWorkflowCheckpoint(snapshot, new MemorySaver());
		expect(state.visitedNodeIds).toEqual(VIDEO_PRODUCTION_WORKFLOW_NODE_IDS);
		expect(state.snapshot.nodes).toHaveLength(7);
	});

	it("does not append checkpoints when only observation timestamps changed", async () => {
		const checkpointer = new MemorySaver();
		const initial = await synchronizeVideoProductionWorkflowCheckpoint(buildSnapshot(NOW), checkpointer);
		const repeated = await synchronizeVideoProductionWorkflowCheckpoint(
			buildSnapshot(LATER, LATER),
			checkpointer,
		);

		expect(initial.snapshot.generatedAt).toBe(NOW);
		expect(repeated.snapshot.generatedAt).toBe(NOW);
		expect(repeated.visitedNodeIds).toEqual(VIDEO_PRODUCTION_WORKFLOW_NODE_IDS);
	});

	it("persists only the latest bounded traversal after a meaningful state change", async () => {
		const checkpointer = new MemorySaver();
		await synchronizeVideoProductionWorkflowCheckpoint(buildSnapshot(NOW), checkpointer);
		const changed = await synchronizeVideoProductionWorkflowCheckpoint(
			buildSnapshot(LATER, LATER, "failed"),
			checkpointer,
		);
		const persisted = await compileVideoProductionWorkflow(checkpointer).getState({
			configurable: { thread_id: "production:run-langgraph-100" },
		});

		expect(changed.snapshot.generatedAt).toBe(LATER);
		expect(changed.visitedNodeIds).toEqual(VIDEO_PRODUCTION_WORKFLOW_NODE_IDS);
		expect(persisted.values.visitedNodeIds).toEqual(VIDEO_PRODUCTION_WORKFLOW_NODE_IDS);
	});
});
