import type { AppContext } from "../../types";
import {
	VIDEO_ATOMIC_WORKFLOW_NODE_IDS,
	type VideoAtomicWorkflowNodeId,
	type VideoAtomicWorkflowSnapshot,
} from "@tapcanvas/video-orchestrator-protocol";
import type { WorkflowNodeRunHistoryDto } from "../execution/execution.schemas";
import { buildVideoAtomicWorkflowSnapshot } from "../task/video-atomic-workflow-projection";

function projectAtomicNodeRunStatus(
	status: VideoAtomicWorkflowSnapshot["nodes"][number]["status"],
): WorkflowNodeRunHistoryDto["status"] {
	if (status === "succeeded") return "success";
	if (status === "cancelled") return "canceled";
	if (status === "partial") return "failed";
	return status;
}

function projectAtomicExecutionStatus(run: {
	state: string;
	authoring_state: string | null;
}): WorkflowNodeRunHistoryDto["executionStatus"] {
	if (run.state === "failed" || run.authoring_state === "authoring_failed") return "failed";
	if (run.state === "cancelled") return "canceled";
	if (run.state === "concatenated" || run.authoring_state === "authoring_done") return "success";
	return "running";
}

/**
 * Read-only history projection for already persisted atomic video runs.
 * New production starts through Workflow IR; this endpoint does not discover,
 * resume, or dispatch the retired complete-film orchestration tool.
 */
export async function getVideoAtomicNodeRunHistory(
	c: AppContext,
	userId: string,
	runIdValue: string,
	atomicNodeIdValue: string,
): Promise<WorkflowNodeRunHistoryDto[]> {
	const runId = runIdValue.trim();
	const atomicNodeId = VIDEO_ATOMIC_WORKFLOW_NODE_IDS.find((candidate) => candidate === atomicNodeIdValue);
	if (!runId) throw new Error("video_atomic_history_run_id_required");
	if (!atomicNodeId) throw new Error("video_atomic_history_node_id_invalid");
	const run = await c.env.DB.video_runs.findFirst({
		where: { id: runId, owner_id: userId },
		select: {
			id: true,
			state: true,
			authoring_state: true,
			beat_sheet: true,
			total_clips: true,
			clips_done: true,
			error_message: true,
			created_at: true,
			updated_at: true,
			completed_at: true,
		},
	});
	if (!run) return [];
	const [artifacts, effects, eventAggregate] = await Promise.all([
		c.env.DB.authoring_artifacts.findMany({
			where: { run_id: runId },
			orderBy: { artifact_key: "asc" },
		}),
		c.env.DB.production_effects.findMany({
			where: { run_id: runId },
			orderBy: [{ effect_key: "asc" }, { revision: "asc" }],
		}),
		c.env.DB.production_workflow_events.aggregate({
			where: { run_id: runId },
			_max: { seq: true },
		}),
	]);
	const snapshot = buildVideoAtomicWorkflowSnapshot({
		run,
		artifacts,
		effects,
		latestEventSeq: eventAggregate._max.seq ?? 0,
		generatedAt: new Date().toISOString(),
	});
	const node = snapshot.nodes.find((candidate) => candidate.atomicNodeId === atomicNodeId as VideoAtomicWorkflowNodeId);
	if (!node) throw new Error("video_atomic_history_projection_missing");
	return [{
		id: `video:${run.id}:${atomicNodeId}`,
		executionId: run.id,
		nodeId: atomicNodeId,
		status: projectAtomicNodeRunStatus(node.status),
		attempt: 1,
		errorMessage: node.errorMessages.join("\n") || null,
		outputRefs: {
			...node.outputRefs,
			evidence: {
				...node.outputRefs.evidence,
				atomicStatus: node.status,
				completedItems: node.completedUnits,
				totalItems: node.totalUnits,
				inputArtifactIds: node.inputArtifactIds,
				outputArtifactIds: node.outputArtifactIds,
				effectIds: node.effectIds,
			},
		},
		createdAt: node.timing.startedAt ?? run.created_at,
		startedAt: node.timing.startedAt,
		finishedAt: node.timing.finishedAt,
		executionStatus: projectAtomicExecutionStatus(run),
		executionCreatedAt: run.created_at,
		executionFinishedAt: run.completed_at,
	}];
}
