import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import {
	Annotation,
	type BaseCheckpointSaver,
	END,
	MemorySaver,
	START,
	StateGraph,
} from "@langchain/langgraph";

import {
	VIDEO_PRODUCTION_WORKFLOW_NODE_IDS,
	parseVideoProductionWorkflowSnapshot,
	type VideoProductionWorkflowNodeId,
	type VideoProductionWorkflowSnapshot,
} from "@tapcanvas/video-orchestrator-protocol";
import { getPrismaClient } from "../../platform/node/prisma";
import { buildVideoProductionWorkflowSnapshot } from "./video-production-workflow-projection";

const ProductionWorkflowState = Annotation.Root({
	workflowRunId: Annotation<string>(),
	snapshot: Annotation<VideoProductionWorkflowSnapshot>(),
	visitedNodeIds: Annotation<VideoProductionWorkflowNodeId[]>({
		// This field describes the latest canonical traversal, not an audit log.
		// Retaining older traversals makes every checkpoint blob grow forever.
		reducer: (current, update) =>
			[...current, ...update].slice(-VIDEO_PRODUCTION_WORKFLOW_NODE_IDS.length),
		default: () => [],
	}),
});

// LangGraph's PostgresSaver appends one checkpoint per executed node with no
// built-in retention, so an active run polled every few seconds grows
// checkpoint_blobs/checkpoints/checkpoint_writes without bound (observed
// ~300k checkpoints and ~20 GB per thread in production). Once a thread's
// checkpoint count exceeds CHECKPOINT_RETENTION_TRIGGER, prune the oldest
// checkpoints and keep only the newest CHECKPOINT_RETENTION_KEEP. Blob
// retention follows the kept checkpoints' channel_versions exactly, so the
// resume path stays consistent with the surviving checkpoint heads.
const CHECKPOINT_RETENTION_TRIGGER = 200;
const CHECKPOINT_RETENTION_KEEP = 50;

export type ProductionWorkflowRuntimeState = typeof ProductionWorkflowState.State;

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameWorkflowSnapshot(
	left: VideoProductionWorkflowSnapshot,
	right: VideoProductionWorkflowSnapshot,
): boolean {
	if (
		left.protocolVersion !== right.protocolVersion ||
		left.workflowKey !== right.workflowKey ||
		left.definitionVersion !== right.definitionVersion ||
		left.workflowRunId !== right.workflowRunId ||
		left.latestEventSeq !== right.latestEventSeq ||
		left.nodes.length !== right.nodes.length
	) return false;
	return left.nodes.every((leftNode, index) => {
		const rightNode = right.nodes[index];
		return Boolean(
			rightNode &&
			leftNode.workflowRunId === rightNode.workflowRunId &&
			leftNode.workflowNodeId === rightNode.workflowNodeId &&
			leftNode.status === rightNode.status &&
			leftNode.completedUnits === rightNode.completedUnits &&
			leftNode.totalUnits === rightNode.totalUnits &&
			leftNode.errorCount === rightNode.errorCount &&
			leftNode.latestEventSeq === rightNode.latestEventSeq &&
			leftNode.timing.startedAt === rightNode.timing.startedAt &&
			// updatedAt is an observation heartbeat. A polling writer can refresh it
			// while every projected business fact remains identical, which must not
			// create another complete seven-node LangGraph traversal.
			leftNode.timing.finishedAt === rightNode.timing.finishedAt &&
			leftNode.timing.durationMs === rightNode.timing.durationMs &&
			sameStringList(leftNode.inputArtifactIds, rightNode.inputArtifactIds) &&
			sameStringList(leftNode.outputArtifactIds, rightNode.outputArtifactIds) &&
			sameStringList(leftNode.effectIds, rightNode.effectIds)
		);
	});
}

function normalizeVisitedNodes(state: ProductionWorkflowRuntimeState): ProductionWorkflowRuntimeState {
	const visitedNodeIds = state.visitedNodeIds.slice(-VIDEO_PRODUCTION_WORKFLOW_NODE_IDS.length);
	if (visitedNodeIds.join(",") !== VIDEO_PRODUCTION_WORKFLOW_NODE_IDS.join(",")) {
		throw new Error("production workflow checkpoint traversal drifted from canonical topology");
	}
	return { ...state, visitedNodeIds };
}

function visitWorkflowNode(workflowNodeId: VideoProductionWorkflowNodeId) {
	return (state: ProductionWorkflowRuntimeState): Partial<ProductionWorkflowRuntimeState> => {
		if (state.workflowRunId !== state.snapshot.workflowRunId) {
			throw new Error("production workflow runtime run ID does not match snapshot");
		}
		const node = state.snapshot.nodes.find((candidate) => candidate.workflowNodeId === workflowNodeId);
		if (!node) throw new Error(`production workflow snapshot is missing node: ${workflowNodeId}`);
		return { visitedNodeIds: [workflowNodeId] };
	};
}

/**
 * Compile the canonical bounded production graph. Events, clips, writer turns,
 * provider tasks and artifacts remain data inside these seven nodes; they can
 * never expand the executable topology.
 */
export function compileVideoProductionWorkflow(checkpointer: BaseCheckpointSaver = new MemorySaver()) {
	return new StateGraph(ProductionWorkflowState)
		.addNode("production-contract", visitWorkflowNode("production-contract"))
		.addNode("story-adaptation", visitWorkflowNode("story-adaptation"))
		.addNode("clip-contracts", visitWorkflowNode("clip-contracts"))
		.addNode("asset-preparation", visitWorkflowNode("asset-preparation"))
		.addNode("media-production", visitWorkflowNode("media-production"))
		.addNode("composition", visitWorkflowNode("composition"))
		.addNode("delivery", visitWorkflowNode("delivery"))
		.addEdge(START, "production-contract")
		.addEdge("production-contract", "story-adaptation")
		.addEdge("story-adaptation", "clip-contracts")
		.addEdge("clip-contracts", "asset-preparation")
		.addEdge("asset-preparation", "media-production")
		.addEdge("media-production", "composition")
		.addEdge("composition", "delivery")
		.addEdge("delivery", END)
		.compile({ checkpointer });
}

let durableRuntimePromise: Promise<ReturnType<typeof compileVideoProductionWorkflow>> | null = null;

async function getDurableRuntime(): Promise<ReturnType<typeof compileVideoProductionWorkflow>> {
	if (durableRuntimePromise) return await durableRuntimePromise;
	durableRuntimePromise = (async () => {
		const databaseUrl = String(globalThis.process?.env?.DATABASE_URL ?? "").trim();
		if (!databaseUrl) throw new Error("DATABASE_URL is required for production workflow checkpoints");
		const checkpointer = PostgresSaver.fromConnString(databaseUrl, { schema: "public" });
		await checkpointer.setup();
		return compileVideoProductionWorkflow(checkpointer);
	})();
	try {
		return await durableRuntimePromise;
	} catch (error) {
		durableRuntimePromise = null;
		throw error;
	}
}

export async function synchronizeVideoProductionWorkflowCheckpoint(
	snapshot: VideoProductionWorkflowSnapshot,
	checkpointer?: BaseCheckpointSaver,
): Promise<ProductionWorkflowRuntimeState> {
	const parsed = parseVideoProductionWorkflowSnapshot(snapshot);
	if (!parsed.success) throw new Error(`invalid production workflow snapshot: ${parsed.error.message}`);
	const runtime = checkpointer
		? compileVideoProductionWorkflow(checkpointer)
		: await getDurableRuntime();
	const configurable = {
		thread_id: `production:${snapshot.workflowRunId}`,
	};
	const existingState = await runtime.getState({ configurable });
	const existingValues = existingState.values;
	if (
		existingValues.workflowRunId === snapshot.workflowRunId &&
		existingValues.snapshot &&
		sameWorkflowSnapshot(existingValues.snapshot, snapshot)
	) {
		return normalizeVisitedNodes(existingValues);
	}
	const result = await runtime.invoke(
		{
			workflowRunId: snapshot.workflowRunId,
			snapshot,
			visitedNodeIds: [],
		},
		{
			configurable,
		},
	);
	// Retention is a durable-storage concern: only prune when the runtime
	// actually persists to PostgreSQL (no explicit checkpointer was injected).
	if (!checkpointer) {
		await pruneVideoProductionWorkflowCheckpoints(snapshot.workflowRunId);
	}
	return normalizeVisitedNodes(result);
}

async function pruneVideoProductionWorkflowCheckpoints(workflowRunId: string): Promise<void> {
	const prisma = getPrismaClient();
	const threadId = `production:${workflowRunId}`;
	try {
		const [countRow] = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
			`SELECT count(*)::int AS count FROM checkpoints WHERE thread_id = $1`,
			threadId,
		);
		if ((countRow?.count ?? 0) <= CHECKPOINT_RETENTION_TRIGGER) return;
		await prisma.$transaction(async (tx) => {
			await tx.$executeRawUnsafe(
				`DELETE FROM checkpoint_writes AS w
         WHERE w.thread_id = $1
           AND w.checkpoint_id NOT IN (
             SELECT checkpoint_id FROM (
               SELECT checkpoint_id,
                      row_number() OVER (PARTITION BY checkpoint_ns ORDER BY checkpoint_id DESC) AS rn
               FROM checkpoints
               WHERE thread_id = $1
             ) ranked
             WHERE ranked.rn <= $2
           )`,
				threadId,
				CHECKPOINT_RETENTION_KEEP,
			);
			await tx.$executeRawUnsafe(
				`DELETE FROM checkpoint_blobs AS b
         WHERE b.thread_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM (
               SELECT keep_refs.channel AS channel, keep_refs.version AS version
               FROM (
                 SELECT checkpoint,
                        row_number() OVER (PARTITION BY checkpoint_ns ORDER BY checkpoint_id DESC) AS rn
                 FROM checkpoints
                 WHERE thread_id = $1
               ) ranked
               CROSS JOIN LATERAL jsonb_each_text(ranked.checkpoint -> 'channel_versions') AS keep_refs(channel, version)
               WHERE ranked.rn <= $2
             ) kept
             WHERE kept.channel = b.channel AND kept.version = b.version
           )`,
				threadId,
				CHECKPOINT_RETENTION_KEEP,
			);
			await tx.$executeRawUnsafe(
				`DELETE FROM checkpoints AS c
         WHERE c.thread_id = $1
           AND c.checkpoint_id NOT IN (
             SELECT checkpoint_id FROM (
               SELECT checkpoint_id,
                      row_number() OVER (PARTITION BY checkpoint_ns ORDER BY checkpoint_id DESC) AS rn
               FROM checkpoints
               WHERE thread_id = $1
             ) ranked
             WHERE ranked.rn <= $2
           )`,
				threadId,
				CHECKPOINT_RETENTION_KEEP,
			);
		});
	} catch (error) {
		// Retention is post-write housekeeping, not part of the sync contract:
		// failing it must not turn an already-successful checkpoint write into a
		// run failure. The failure is reported loudly so unbounded growth stays
		// visible in logs instead of being silently swallowed.
		console.error(
			`[video-production-workflow] checkpoint retention prune failed for run ${workflowRunId}:`,
			error,
		);
	}
}

const workflowSynchronizationByRunId = new Map<string, Promise<ProductionWorkflowRuntimeState>>();

export async function synchronizeVideoProductionWorkflowRun(runIdValue: string): Promise<ProductionWorkflowRuntimeState> {
	const runId = runIdValue.trim();
	if (!runId) throw new Error("production workflow runId is required");
	const previous = workflowSynchronizationByRunId.get(runId);
	const synchronization = (async () => {
		if (previous) await previous.catch(() => undefined);
		return await synchronizeVideoProductionWorkflowRunNow(runId);
	})();
	workflowSynchronizationByRunId.set(runId, synchronization);
	try {
		return await synchronization;
	} finally {
		if (workflowSynchronizationByRunId.get(runId) === synchronization) {
			workflowSynchronizationByRunId.delete(runId);
		}
	}
}

async function synchronizeVideoProductionWorkflowRunNow(runId: string): Promise<ProductionWorkflowRuntimeState> {
	const prisma = getPrismaClient();
	const [run, artifacts, effects, eventAggregate] = await Promise.all([
		prisma.video_runs.findUnique({ where: { id: runId } }),
		prisma.authoring_artifacts.findMany({ where: { run_id: runId } }),
		prisma.production_effects.findMany({ where: { run_id: runId } }),
		prisma.production_workflow_events.aggregate({ where: { run_id: runId }, _max: { seq: true } }),
	]);
	if (!run) throw new Error(`production workflow run not found: ${runId}`);
	const snapshot = buildVideoProductionWorkflowSnapshot({
		run,
		artifacts,
		effects,
		latestEventSeq: eventAggregate._max.seq ?? 0,
		generatedAt: new Date().toISOString(),
	});
	return await synchronizeVideoProductionWorkflowCheckpoint(snapshot);
}
