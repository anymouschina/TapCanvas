import { authorizeWorkflowMediaRetries, readWorkflowMediaRetries, type WorkflowMediaRetry } from "./execution.media-retry";
import { readWorkflowMediaAdoptions, validateWorkflowMediaAdoptionTargets, validateWorkflowMediaAdoptionDescendants, type WorkflowMediaAdoption } from "./execution.media-adoption";
import { projectAssetSnapshot, isWorkflowProjectImageReady } from "./execution.project-context";
import { enrichWorkflowMediaUnderstanding } from "./execution.media-understanding";
import { createWorkflowAssetResolver } from "./execution.asset-resolver";
import { prepareWorkflowPlanningRevision, reviseWorkflowAssetSnapshots, type WorkflowPlanningRevision } from "./execution.planning-revision";
import { loadVisibleWorkflowProjectAssets } from "./execution.project-context-runtime";
import type { AppContext, AppEnv } from "../../types";
import { getFlowForOwner } from "../flow/flow.repo";
import {
	cancelWorkflowAgentTurns,
	collectWorkflowAgentTurnIdentities,
	listActiveWorkflowAgentTurnIdentities,
	mergeWorkflowAgentTurnIdentities,
} from "./execution.agent-cancellation";
import {
	applyWorkflowAgentModelCutover,
	type WorkflowAgentModelCutover,
} from "./execution.agent-model-inheritance";
import {
	getLatestFailedWorkflowExecutionIdForOwner,
	getWorkflowExecutionFamilyPageForOwner,
	listWorkflowExecutionFamilyMemberIdsForOwner,
	listWorkflowNodeAttemptsPageForExecutionOwner,
} from "./execution.family-store";
import {
	parseWorkflowCallerCanvasSnapshot,
	parseWorkflowProjectContext,
} from "./execution.project-context";
import { scopeWorkflowFlowData } from "./execution.flow-scope";
import { repairMissingWorkflowSourceBinding, loadWorkflowSourceBindingCandidate } from "./execution.source-binding-repair";
import { cancelActiveWorkflowNodeJobs } from "./execution.queue";
import { resolveCoreWorkflowExecutorSemantics } from "./execution.core-semantics";
import { parseWorkflowNodeOutputV1 } from "./execution.node-runtime";
import { resolveWorkflowRecoveryFrontier } from "./execution.recovery-frontier";
import {
	getExecutionForOwner,
	getExecutionSnapshotForOwner,
	listNodeRunsForExecutionOwner,
	mapExecutionSnapshotRow,
	mapExecutionRow,
	requeueUnstartedExecution,
	type NodeRunRow,
} from "./execution.repo";
import {
	evaluateWorkflowRecoveryAgentFence,
	evaluateWorkflowResumeFamilyGuard,
} from "./execution.resume-guard";
import {
	applyWorkflowDefinitionCutover,
	prepareWorkflowExecutionSnapshotRerun,
} from "./execution.snapshot-runtime";
import {
	startWorkflowExecution,
	startDurableExecution,
	WorkflowStartError,
} from "./execution.start-service";

type WorkflowResumeStatus = 400 | 404 | 409 | 422 | 500 | 501 | 503;

type WorkflowResumeAgentModelCutover = Omit<WorkflowAgentModelCutover, "authorizedBy" | "requestedAt">;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isProviderBalanceSuspension(outputRefs: string | null): boolean {
	const output = parseWorkflowNodeOutputV1(outputRefs);
	if (!output) return false;
	const suspended = (evidence: Record<string, unknown>): boolean => {
		const terminal = isRecord(evidence.requestTerminal) ? evidence.requestTerminal : null;
		return terminal?.status === "suspended" && terminal.reason === "provider_balance_required";
	};
	return suspended(output.evidence) || output.itemRuns.some((item) => (
		item.status === "waiting_external" && suspended(item.evidence)
	));
}

function isResolvedOutputReuse(outputRefs: string | null): boolean {
	const output = parseWorkflowNodeOutputV1(outputRefs);
	if (!output) return false;
	const reuse = isRecord(output.evidence.outputReuse) ? output.evidence.outputReuse : null;
	return reuse?.kind === "pin" || reuse?.kind === "replay";
}

function hasSuccessfulNodeToolCall(toolCalls: string | null | undefined): boolean {
	if (!toolCalls) return false;
	let parsed: unknown;
	try {
		parsed = JSON.parse(toolCalls) as unknown;
	} catch {
		return true;
	}
	if (!Array.isArray(parsed)) return true;
	return parsed.some((toolCall) => !isRecord(toolCall) || toolCall.ok !== false);
}

function readNonNegativeCount(record: Record<string, unknown> | null, field: string): number {
	const value = record?.[field];
	return typeof value === "number" && Number.isInteger(value) && value >= 0
		? value
		: 0;
}

/**
 * The logical Agent executor is conservatively external-mutation capable, but
 * a failed/cancelled physical call with no successful tool receipt, durable
 * task/progress receipt, successful item, or satisfied delivery did not
 * materialize that capability. This is receipt-based and executor-wide; it
 * does not inspect prompt text, workflow names, or failure messages.
 */
function isUnmaterializedAgentAttempt(
	nodeRun: NodeRunRow,
	executorRef: string,
	output: ReturnType<typeof parseWorkflowNodeOutputV1>,
): boolean {
	if (executorRef !== "agents.logical-task/v2") return false;
	if (nodeRun.status !== "failed" && nodeRun.status !== "canceled") return false;
	if (hasSuccessfulNodeToolCall(nodeRun.tool_calls)) return false;
	if (output?.itemRuns.some((itemRun) => itemRun.status !== "failed")) return false;
	const deliveryEvidence = output && isRecord(output.evidence.deliveryEvidence)
		? output.evidence.deliveryEvidence
		: null;
	const checkpoint = deliveryEvidence && isRecord(deliveryEvidence.recoveryCheckpoint)
		? deliveryEvidence.recoveryCheckpoint
		: null;
	if (readNonNegativeCount(deliveryEvidence, "durableTaskReferenceCount") > 0
		|| readNonNegativeCount(deliveryEvidence, "durableProgressClaimCount") > 0
		|| readNonNegativeCount(checkpoint, "durableTaskReferenceCount") > 0
		|| readNonNegativeCount(checkpoint, "durableProgressClaimCount") > 0) {
		return false;
	}
	const verification = output && isRecord(output.evidence.deliveryVerification)
		? output.evidence.deliveryVerification
		: null;
	return verification?.satisfied !== true;
}

/**
 * Historical checkpoint selection is safe only when later physical recoveries
 * did not start any unresolved external side effect. Replayed or pinned outputs
 * are not new actions and remain safe. Unknown media artifacts without reuse
 * provenance are conservatively treated as external-side-effect risk.
 */
function attemptUsesOnlyKnownReceipts(
	output: ReturnType<typeof parseWorkflowNodeOutputV1>,
	knownProviderReceipts: ReadonlySet<string>,
): boolean {
	if (!output || output.itemRuns.length === 0) return false;
	return output.itemRuns.every((itemRun) => {
		const taskId = isRecord(itemRun.evidence) && typeof itemRun.evidence.taskId === "string"
			? itemRun.evidence.taskId.trim()
			: "";
		if (taskId) return knownProviderReceipts.has(taskId);
		return itemRun.evidence.reused === true
			&& (itemRun.status === "success" || itemRun.status === "failed");
	});
}

async function collectExecutionProviderReceipts(input: Readonly<{
	db: AppEnv["Bindings"]["DB"];
	ownerId: string;
	executionId: string;
}>): Promise<ReadonlySet<string>> {
	const receipts = new Set<string>();
	let cursor: string | undefined;
	do {
		const page = await listWorkflowNodeAttemptsPageForExecutionOwner(input.db, {
			ownerId: input.ownerId,
			executionId: input.executionId,
			limit: 200,
			...(cursor ? { cursor } : {}),
		});
		for (const attempt of page.items) {
			for (const receipt of attempt.providerReceipts ?? []) receipts.add(receipt);
		}
		cursor = page.nextCursor ?? undefined;
	} while (cursor);
	return receipts;
}

function hasHistoricalReplayRisk(
	nodeRuns: readonly NodeRunRow[],
	knownProviderReceipts: ReadonlySet<string>,
): boolean {
	for (const nodeRun of nodeRuns) {
		if (isResolvedOutputReuse(nodeRun.output_refs)) continue;
		const output = parseWorkflowNodeOutputV1(nodeRun.output_refs);
		const executorRef = (nodeRun.node_type || output?.executorRef || "").trim();
		const semantics = executorRef ? resolveCoreWorkflowExecutorSemantics(executorRef) : null;
		const physicalAttemptStarted = nodeRun.started_at !== null
			|| nodeRun.status === "running"
			|| nodeRun.status === "waiting_external"
			|| nodeRun.status === "success"
			|| nodeRun.status === "failed";
		if (!physicalAttemptStarted) continue;
		// A later physical node can contain successful Agent/media items without
		// having started a new external action: recovery checkpoints copy their
		// original durable task IDs. If every materialized item is addressable by
		// a provider receipt already present in the selected source execution, and
		// this later node recorded no new successful tool mutation, it is a pure
		// reconciliation projection and is safe to abandon.
		if (!hasSuccessfulNodeToolCall(nodeRun.tool_calls)
			&& attemptUsesOnlyKnownReceipts(output, knownProviderReceipts)) continue;
		if (output?.artifacts.some((artifact) => artifact.media?.kind === "image"
			|| artifact.media?.kind === "video"
			|| artifact.media?.kind === "audio")) return true;
		// A started executor without frozen core semantics cannot prove that it
		// avoided a supplier action or external mutation, so historical selection
		// stays closed.
		if (!semantics) return true;
		if (isUnmaterializedAgentAttempt(nodeRun, executorRef, output)) continue;
		if (semantics.sideEffect !== "none") return true;
	}
	return false;
}

export class WorkflowResumeError extends Error {
	readonly code: string;
	readonly status: WorkflowResumeStatus;
	readonly details?: Readonly<Record<string, unknown>>;

	constructor(
		message: string,
		input: Readonly<{
			code: string;
			status: WorkflowResumeStatus;
			details?: Readonly<Record<string, unknown>>;
		}>,
	) {
		super(message);
		this.name = "WorkflowResumeError";
		this.code = input.code;
		this.status = input.status;
		this.details = input.details;
	}
}

/**
 * Resume the latest failed physical execution inside its existing logical
 * execution family. Both HTTP routes and the Agent tool surface use this one
 * owner so fencing, snapshot reuse, project hydration and family lineage cannot
 * drift into separate recovery implementations.
 */
export async function resumeWorkflowExecution(input: Readonly<{
	context: AppContext;
	env: AppEnv["Bindings"];
	ownerId: string;
	sourceExecutionId: string;
	nodeId?: string;
	trigger: "manual" | "agent";
	providerBalanceRestored?: true;
	cancellationRevoked?: true;
	agentModelCutover?: WorkflowResumeAgentModelCutover;
	definitionCutover?: Readonly<{ mode: "current_flow" }>;
	planningRevision?: WorkflowPlanningRevision;
	mediaAdoptions?: readonly WorkflowMediaAdoption[];
	mediaRetries?: readonly WorkflowMediaRetry[];
}>): Promise<Awaited<ReturnType<typeof startWorkflowExecution>>["execution"]> {
	const sourceExecution = await getExecutionForOwner(
		input.env.DB,
		input.sourceExecutionId,
		input.ownerId,
	);
	if (!sourceExecution) {
		throw new WorkflowResumeError("Execution not found", {
			status: 404,
			code: "execution_not_found",
		});
	}
	const cutover = input.agentModelCutover;
	const providerBalanceRestored = input.providerBalanceRestored === true;
	const cancellationRevoked = input.cancellationRevoked === true;
	const definitionCutover = input.definitionCutover?.mode === "current_flow";
	const recoveryModeCount = [Boolean(input.nodeId), Boolean(cutover), providerBalanceRestored, cancellationRevoked, definitionCutover, Boolean(input.planningRevision), Boolean(input.mediaAdoptions), Boolean(input.mediaRetries)].filter(Boolean).length;
	if (recoveryModeCount > 1) {
		throw new WorkflowResumeError("Workflow recovery modes are mutually exclusive", {
			status: 400,
			code: "workflow_resume_recovery_mode_conflict",
		});
	}
	const providerBalanceRecovery = Boolean(cutover) || providerBalanceRestored;
	if (cancellationRevoked && sourceExecution.status !== "canceled") {
		throw new WorkflowResumeError("Cancellation revocation requires the latest canceled workflow execution", {
			status: 409,
			code: "workflow_cancellation_revocation_source_not_canceled",
		});
	}
	if (!providerBalanceRecovery && !cancellationRevoked && sourceExecution.status !== "failed") {
		throw new WorkflowResumeError("Only a failed workflow execution can be resumed", {
			status: 409,
			code: "workflow_resume_source_not_failed",
		});
	}
	if (providerBalanceRecovery && sourceExecution.status === "success") {
		throw new WorkflowResumeError(cutover
		? "A successful workflow execution cannot change its frozen Agent model"
		: "A successful workflow execution does not require provider-balance recovery", {
			status: 409,
			code: cutover
				? "workflow_agent_model_cutover_source_succeeded"
				: "workflow_provider_balance_resume_source_succeeded",
		});
	}

	const family = await getWorkflowExecutionFamilyPageForOwner(input.env.DB, {
		ownerId: input.ownerId,
		executionId: sourceExecution.id,
		limit: 1,
	});
	if (!family) {
		throw new WorkflowResumeError("Execution not found", {
			status: 404,
			code: "execution_not_found",
		});
	}
	const latestFailedExecutionId = await getLatestFailedWorkflowExecutionIdForOwner(input.env.DB, {
		ownerId: input.ownerId,
		executionFamilyId: family.executionFamilyId,
	});
	let familyExecutionIds: readonly string[] | null = null;
	let historicalSourceReplaySafe = false;
	const historicalCheckpointCandidate = family.activeExecutionCount === 0
		&& family.latestExecutionId !== sourceExecution.id
		&& (providerBalanceRecovery || input.trigger === "manual");
	if (historicalCheckpointCandidate) {
		const [executionIds, knownProviderReceipts] = await Promise.all([
			listWorkflowExecutionFamilyMemberIdsForOwner(input.env.DB, {
				ownerId: input.ownerId,
				executionFamilyId: family.executionFamilyId,
			}),
			collectExecutionProviderReceipts({
				db: input.env.DB,
				ownerId: input.ownerId,
				executionId: sourceExecution.id,
			}),
		]);
		familyExecutionIds = executionIds;
		const sourceIndex = familyExecutionIds.indexOf(sourceExecution.id);
		if (
			sourceIndex >= 0
			&& sourceIndex < familyExecutionIds.length - 1
			&& familyExecutionIds[familyExecutionIds.length - 1] === family.latestExecutionId
		) {
			const laterExecutionIds = familyExecutionIds.slice(sourceIndex + 1);
			const laterNodeRuns = await Promise.all(laterExecutionIds.map((executionId) =>
				listNodeRunsForExecutionOwner(input.env.DB, {
					ownerId: input.ownerId,
					executionId,
				}),
			));
			historicalSourceReplaySafe = laterNodeRuns.every((runs) => !hasHistoricalReplayRisk(runs, knownProviderReceipts));
		}
	}
	const familyGuard = evaluateWorkflowResumeFamilyGuard(sourceExecution.id, {
		latestExecutionId: family.latestExecutionId,
		latestExecutionStatus: family.latestExecutionStatus,
		latestFailedExecutionId,
		activeExecutionCount: family.activeExecutionCount,
		activeExecutionIds: family.activeExecutionIds,
		historicalSourceReplaySafe,
	});
	const providerRecoveryOwnsOnlyActiveExecution = providerBalanceRecovery
		&& family.latestExecutionId === sourceExecution.id
		&& family.activeExecutionCount === 1
		&& family.activeExecutionIds[0] === sourceExecution.id;
	const providerRecoveryCanRecoverTerminalSource = providerBalanceRecovery
		&& family.latestExecutionId === sourceExecution.id
		&& family.activeExecutionCount === 0;
	const providerRecoveryCanRecoverHistoricalSource = providerBalanceRecovery
		&& family.activeExecutionCount === 0
		&& historicalSourceReplaySafe;
	const cancellationRevocationCanRecoverLatestSource = cancellationRevoked
		&& family.latestExecutionId === sourceExecution.id
		&& family.activeExecutionCount === 0;
	const bypassStandardFamilyGuard = providerRecoveryOwnsOnlyActiveExecution
		|| providerRecoveryCanRecoverTerminalSource
		|| providerRecoveryCanRecoverHistoricalSource
		|| cancellationRevocationCanRecoverLatestSource;
	if (!bypassStandardFamilyGuard && !familyGuard.allowed && familyGuard.code === "workflow_resume_family_active") {
		throw new WorkflowResumeError("The workflow execution family already has an active recovery", {
			status: 409,
			code: familyGuard.code,
			details: { activeExecutionIds: familyGuard.activeExecutionIds },
		});
	}
	if (!bypassStandardFamilyGuard && !familyGuard.allowed) {
		throw new WorkflowResumeError("Only the latest failed execution in a workflow family can be resumed", {
			status: 409,
			code: familyGuard.code,
			details: { latestExecutionId: family.latestExecutionId },
		});
	}

	const [source, nodeRuns] = await Promise.all([
		getExecutionSnapshotForOwner(input.env.DB, {
			ownerId: input.ownerId,
			executionId: sourceExecution.id,
		}),
		listNodeRunsForExecutionOwner(input.env.DB, {
			ownerId: input.ownerId,
			executionId: sourceExecution.id,
		}),
	]);
	// Dispatch can fail before the DAG creates its first node. There is no
	// node frontier to replay: re-dispatch the exact frozen execution instead.
	if (source && sourceExecution.started_at === null && nodeRuns.length === 0
		&& !input.nodeId && !providerBalanceRecovery && !cancellationRevoked
		&& !definitionCutover && !cutover) {
		const requeued = await requeueUnstartedExecution(input.env.DB, {
			executionId: sourceExecution.id, ownerId: input.ownerId,
		});
		if (!requeued) {
			throw new WorkflowResumeError("Execution dispatch state changed or is not recoverable", {
				status: 409, code: "workflow_resume_dispatch_conflict",
			});
		}
		console.info("[workflow-dispatch] unstarted execution requeued", {
			executionId: sourceExecution.id, previousError: sourceExecution.error_message,
		});
		await startDurableExecution(input.env, sourceExecution.id);
		const refreshed = await getExecutionForOwner(input.env.DB, sourceExecution.id, input.ownerId);
		if (!refreshed) throw new WorkflowResumeError("Execution disappeared after dispatch", {
			status: 404, code: "workflow_resume_source_not_found",
		});
		return mapExecutionRow(refreshed);
	}
	const recoveryNode = providerBalanceRecovery
		? nodeRuns.find((node) => isProviderBalanceSuspension(node.output_refs))
		: cancellationRevoked
			? nodeRuns.find((node) => node.status === "canceled" && node.started_at !== null)
				?? nodeRuns.find((node) => node.status === "canceled")
			: nodeRuns.find((node) => node.status === "failed" && (input.nodeId === undefined || node.node_id === input.nodeId));
	if (!source || !recoveryNode) {
		throw new WorkflowResumeError(cancellationRevoked
			? "Canceled execution has no resumable node"
			: providerBalanceRecovery
			? cutover
				? "Workflow Agent model cutover requires a persisted provider-balance suspension"
				: "Provider balance recovery requires a persisted provider-balance suspension"
			: "Failed execution has no resumable node", {
			status: 409,
			code: cancellationRevoked
				? "workflow_cancellation_revocation_node_missing"
				: providerBalanceRecovery
				? cutover
					? "workflow_agent_model_cutover_source_not_provider_blocked"
					: "workflow_provider_balance_resume_source_not_provider_blocked"
				: "workflow_resume_node_missing",
		});
	}
	const frozen = mapExecutionSnapshotRow(source);
	const rerun = prepareWorkflowExecutionSnapshotRerun(frozen.data);
	// Recovery authority comes from family ownership, fenced Agent turns and
	// per-node replay evidence below; authored flags cannot force paid work to restart.
	let root = rerun.data;
	let currentFlowUpdatedAt: string | null = null;
	let recoveryFlowName = frozen.name;
	if (definitionCutover) {
		const currentFlow = await getFlowForOwner(input.env.DB, frozen.flowId, input.ownerId);
		if (!currentFlow) {
			throw new WorkflowResumeError("Current workflow definition not found", {
				status: 404,
				code: "workflow_definition_cutover_flow_not_found",
			});
		}
		try {
			const currentScopedDefinition = scopeWorkflowFlowData(
				currentFlow.data,
				rerun.triggerNodeId,
				rerun.stopAfterNodeId,
			);
			root = applyWorkflowDefinitionCutover({
				frozenSnapshot: rerun.data,
				currentScopedDefinition,
				audit: {
					fromFlowVersionId: frozen.flowVersionId,
					currentFlowUpdatedAt: currentFlow.updated_at,
					authorizedBy: input.ownerId,
					requestedAt: new Date().toISOString(),
				},
			});
			currentFlowUpdatedAt = currentFlow.updated_at;
			recoveryFlowName = currentFlow.name;
		} catch (error: unknown) {
			throw new WorkflowResumeError(
				error instanceof Error ? error.message : "Workflow definition cutover is invalid",
				{ status: 409, code: "workflow_definition_cutover_invalid" },
			);
		}
	}
	if (cutover) {
		try {
			root = applyWorkflowAgentModelCutover(rerun.data, {
				...cutover,
				authorizedBy: input.ownerId,
				requestedAt: new Date().toISOString(),
			});
		} catch (error: unknown) {
			throw new WorkflowResumeError(
				error instanceof Error ? error.message : "Workflow Agent model cutover is invalid",
				{ status: 409, code: "workflow_agent_model_cutover_invalid" },
			);
		}
	}
	let recoveryFrontier = resolveWorkflowRecoveryFrontier({
		failedNode: recoveryNode,
		nodeRuns,
		flowData: root,
	});
	// Successful media stays in the replay checkpoint with its original receipt.
	// Only explicit amendments become project-asset adoptions; generated outputs
	// need not exist in the project's frozen input asset catalog.
	const resumeRuns = nodeRuns.map((run) => ({ nodeId: run.node_id, status: run.status, outputRefs: run.output_refs }));
	if (input.mediaRetries) {
		const retries = authorizeWorkflowMediaRetries({ sourceExecutionId: sourceExecution.id, retries: input.mediaRetries, outputs: resumeRuns });
		validateWorkflowMediaAdoptionDescendants({ root, adoptions: retries, runs: resumeRuns });
		const merged = new Map(readWorkflowMediaRetries(root).map((item) => [JSON.stringify([item.nodeId, item.itemId]), item]));
		for (const retry of retries) merged.set(JSON.stringify([retry.nodeId, retry.itemId]), retry);
		root = { ...root, workflowMediaRetries: [...merged.values()], workflowMediaRetrySourceExecutionId: sourceExecution.id };
		recoveryFrontier = { ...recoveryFrontier, invalidatedNodeIds: [...new Set([
			...recoveryFrontier.invalidatedNodeIds, ...retries.map((item) => item.nodeId),
		])] };
	}
	const explicitAdoptions = input.mediaAdoptions ?? [];
	const mergedAdoptions = new Map(readWorkflowMediaAdoptions(root).map((item) => [JSON.stringify([item.nodeId, item.itemId]), item]));
	for (const item of explicitAdoptions) {
		mergedAdoptions.set(JSON.stringify([item.nodeId, item.itemId]), item);
	}
	if (mergedAdoptions.size > 0) {
		const adoptions = [...mergedAdoptions.values()];
		let applicable = true;
		try {
			validateWorkflowMediaAdoptionTargets({ adoptions, outputs: resumeRuns });
			validateWorkflowMediaAdoptionDescendants({ root, adoptions, runs: resumeRuns });
		} catch (error: unknown) {
			// A caller-requested amendment is a contract: it fails the resume instead of
			// silently re-generating what the caller asked to reuse.
			if (explicitAdoptions.length > 0) throw error;
			applicable = false;
			console.warn(JSON.stringify({
				message: "workflow_media_adoption_reuse_skipped",
				executionId: sourceExecution.id,
				retainedAdoptions: mergedAdoptions.size,
				reason: error instanceof Error ? error.message : String(error),
			}));
		}
		if (applicable) {
			root = { ...root, workflowMediaAdoptions: adoptions,
				workflowMediaAdoptionSourceExecutionId: sourceExecution.id };
			recoveryFrontier = { ...recoveryFrontier, invalidatedNodeIds: [...new Set([
				...recoveryFrontier.invalidatedNodeIds, ...adoptions.map((item) => item.nodeId),
			])] };
		}
	}

	if (input.planningRevision) {
		const revision = prepareWorkflowPlanningRevision({ root, revision: input.planningRevision, nodeRuns });
		root = { ...revision.root, workflowPlanningRevision: {
			...input.planningRevision, sourceExecutionId: sourceExecution.id,
			authorizedBy: input.ownerId, requestedAt: new Date().toISOString(),
		} };
		recoveryFrontier = { ...recoveryFrontier, invalidatedNodeIds: revision.invalidatedNodeIds };
	}
	root = {
		...root,
		workflowRecoveryFrontier: {
			protocolVersion: "workflow.recovery-frontier/v1",
			sourceExecutionId: sourceExecution.id,
			failedNodeId: recoveryNode.node_id,
			invalidatedNodeIds: recoveryFrontier.invalidatedNodeIds,
			mode: input.planningRevision ? "authorized_planning_revision" : recoveryFrontier.mode,
			rejectedBindingCount: recoveryFrontier.rejectedBindingCount,
			unresolvedBindingCount: recoveryFrontier.unresolvedBindingCount,
		},
	};

	let familyAgentTurnCancellations: Awaited<ReturnType<typeof cancelWorkflowAgentTurns>>;
	try {
		const allFamilyExecutionIds = familyExecutionIds ?? await listWorkflowExecutionFamilyMemberIdsForOwner(input.env.DB, {
			ownerId: input.ownerId,
			executionFamilyId: family.executionFamilyId,
		});
		const familyExecutionEvidence = await Promise.all(allFamilyExecutionIds.map(async (executionId) => {
			const [memberNodeRuns, traceTurnTargets] = await Promise.all([
				executionId === sourceExecution.id
					? Promise.resolve(nodeRuns)
					: listNodeRunsForExecutionOwner(input.env.DB, {
						ownerId: input.ownerId,
						executionId,
					}),
				listActiveWorkflowAgentTurnIdentities({
					db: input.env.DB,
					userId: input.ownerId,
					executionId,
				}),
			]);
			return mergeWorkflowAgentTurnIdentities(
				collectWorkflowAgentTurnIdentities(memberNodeRuns),
				traceTurnTargets,
			);
		}));
		familyAgentTurnCancellations = await cancelWorkflowAgentTurns({
			context: input.context,
			userId: input.ownerId,
			targets: mergeWorkflowAgentTurnIdentities(...familyExecutionEvidence),
			interruptReasonCode: "provider_stream_interrupted",
		});
	} catch (error: unknown) {
		throw new WorkflowResumeError("The source workflow Agent turns could not be fenced before recovery", {
			status: 503,
			code: "workflow_resume_agent_fence_failed",
			details: {
				failedTargetCount: 0,
				errorCodes: ["workflow_resume_agent_fence_lookup_failed"],
				cause: error instanceof Error ? error.message : String(error),
			},
		});
	}
	const agentFenceGuard = evaluateWorkflowRecoveryAgentFence(familyAgentTurnCancellations);
	if (!agentFenceGuard.allowed) {
		const failedTargets = familyAgentTurnCancellations
			.filter((result) => result.status === "failed")
			.map((result) => ({
				sessionId: result.target.sessionId,
				turnId: result.target.turnId,
				nodeId: result.target.nodeId,
				runtimeNodeId: result.target.runtimeNodeId,
				receipt: result.receipt,
				errorCode: result.errorCode,
				errorMessage: result.errorMessage,
			}));
		throw new WorkflowResumeError("The source workflow still has Agent turns that could not be safely interrupted", {
			status: 503,
			code: agentFenceGuard.code,
			details: {
				failedTargetCount: agentFenceGuard.failedTargetCount,
				errorCodes: agentFenceGuard.errorCodes,
				failedTargets,
			},
		});
	}

	if (providerRecoveryOwnsOnlyActiveExecution) {
		const namespace = input.env.EXECUTION_DO;
		if (!namespace) {
			throw new WorkflowResumeError("Workflow execution runtime bindings are unavailable", {
				status: 503,
				code: "workflow_runtime_unavailable",
			});
		}
		const stub = namespace.get(namespace.idFromName(sourceExecution.id));
		const response = await stub.fetch("https://do/cancel", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				reasonCode: cutover ? "agent_model_cutover" : "provider_balance_recovery",
				actorType: "workflow_recovery",
				actorId: input.ownerId,
			}),
		});
		if (!response.ok) {
			throw new WorkflowResumeError(cutover
				? "The provider-blocked execution could not be fenced for model cutover"
				: "The provider-blocked execution could not be fenced after balance restoration", {
				status: 500,
				code: cutover
					? "workflow_agent_model_cutover_cancel_failed"
					: "workflow_provider_balance_resume_cancel_failed",
				details: { httpStatus: response.status },
			});
		}
		cancelActiveWorkflowNodeJobs(sourceExecution.id);
	}

	try {
		// Recovery continues one logical execution family. The frozen project
		// context is authoritative even when its older asset records do not contain
		// fields introduced later. Re-reading the mutable canvas here would mix
		// outputs from the failed physical run back into its input, invalidate
		// checkpoints and potentially repeat already paid side effects.
		let projectContext = parseWorkflowProjectContext(root.workflowProjectContext);
		let callerCanvasSnapshot = parseWorkflowCallerCanvasSnapshot(root.workflowCallerCanvasSnapshot);
		if (input.mediaAdoptions) {
			if (!projectContext) throw new Error("media_adoption_project_context_missing");
			const currentAssets = await loadVisibleWorkflowProjectAssets(input.context, input.ownerId, projectContext.projectId);
			const ids = new Set(input.mediaAdoptions.map((item) => item.assetId));
			const adopted = currentAssets.filter((asset) => ids.has(asset.id) && asset.projectId === projectContext!.projectId).map(projectAssetSnapshot);
			if (adopted.length !== ids.size || adopted.some((asset) => !isWorkflowProjectImageReady(asset))) throw new Error("media_adoption_asset_not_ready");
			projectContext = { ...projectContext,
				projectAssetIds: [...new Set([...projectContext.projectAssetIds, ...ids])],
				assetSnapshot: [...projectContext.assetSnapshot.filter((asset) => !ids.has(asset.assetId)), ...adopted],
			};
			const resolver = createWorkflowAssetResolver({ context: projectContext, loadVisibleAssets: async () => currentAssets });
			for (const id of ids) await resolver.resolveAssetResource(id, "image");
			root = { ...root, workflowProjectContext: projectContext };
		}

		if (input.planningRevision && input.planningRevision.refreshAssetIds.length > 0) {
			if (!projectContext) throw new Error("planning_revision_project_context_missing");
			const currentAssets = await loadVisibleWorkflowProjectAssets(input.context, input.ownerId, projectContext.projectId);
			projectContext = { ...reviseWorkflowAssetSnapshots(projectContext, input.planningRevision.refreshAssetIds, currentAssets),
				capturedAt: new Date().toISOString() };
			projectContext = await enrichWorkflowMediaUnderstanding({ c: input.context, ownerId: input.ownerId,
				context: projectContext, resolver: createWorkflowAssetResolver({ context: projectContext,
					loadVisibleAssets: async () => currentAssets }) });
			root = { ...root, workflowProjectContext: projectContext };
		}

		if (projectContext && callerCanvasSnapshot) {
			const frozenContext = projectContext;
			const binding = await repairMissingWorkflowSourceBinding({ projectContext, callerCanvasSnapshot,
				loadSource: () => loadWorkflowSourceBindingCandidate(input.context, input.ownerId, frozenContext) });
			if (binding.repaired) {
				projectContext = binding.projectContext;
				callerCanvasSnapshot = binding.callerCanvasSnapshot;
				console.info("[workflow-source-binding] missing canonical input bound during recovery", {
					sourceExecutionId: sourceExecution.id, canvasId: projectContext.canvasId,
					sourceNodeId: projectContext.sourceNodeId,
				});
			}
		}
		const triggerNode = Array.isArray(root.nodes)
			? root.nodes.find((node) => node && typeof node === "object" && !Array.isArray(node)
				&& (node as Record<string, unknown>).id === rerun.triggerNodeId)
			: null;
		const triggerData = triggerNode && typeof triggerNode === "object" && !Array.isArray(triggerNode)
			? (triggerNode as Record<string, unknown>).data
			: null;
		const triggerPayload = triggerData && typeof triggerData === "object" && !Array.isArray(triggerData)
			? (triggerData as Record<string, unknown>).workflowTriggerPayload
			: undefined;
		const result = await startWorkflowExecution(input.env, {
			flow: {
				id: frozen.flowId,
				name: recoveryFlowName,
				data: JSON.stringify(root),
				owner_id: input.ownerId,
				project_id: sourceExecution.project_id ?? null,
				created_at: frozen.createdAt,
				updated_at: frozen.createdAt,
			},
			ownerId: input.ownerId,
			triggerNodeId: rerun.triggerNodeId,
			...(rerun.stopAfterNodeId ? { stopAfterNodeId: rerun.stopAfterNodeId } : {}),
				replay: {
					sourceExecutionId: sourceExecution.id,
					startFromNodeId: input.planningRevision?.nodeId ?? recoveryNode.node_id,
					invalidatedNodeIds: recoveryFrontier.invalidatedNodeIds,
					scope: "recovery_snapshot",
				},
			trigger: input.trigger,
			...(cutover ? {
				idempotencyKey: `workflow-agent-model-cutover:${sourceExecution.id}:${cutover.targetModelKey}:${cutover.apiStyle}`,
			} : providerBalanceRestored ? {
				idempotencyKey: `workflow-provider-balance-restored:${sourceExecution.id}`,
			} : cancellationRevoked ? {
				idempotencyKey: `workflow-cancellation-revoked:${sourceExecution.id}`,
			} : definitionCutover && currentFlowUpdatedAt ? {
				idempotencyKey: `workflow-definition-cutover:${sourceExecution.id}:${currentFlowUpdatedAt}`,
			} : {
				// Recovery admission can be requested concurrently by the queue and
				// reconciler. One source checkpoint owns exactly one standard recovery
				// identity, so start-service uniqueness converges every contender onto
				// the same physical execution instead of duplicating paid downstream work.
				idempotencyKey: `workflow-recovery:${sourceExecution.id}`,
			}),
			...(triggerPayload !== undefined ? { triggerPayload } : {}),
			...(projectContext ? { projectContext } : {}),
			...(callerCanvasSnapshot ? { callerCanvasSnapshot } : {}),
			recoveryOfExecutionId: sourceExecution.id,
			// Balance recovery (and model cutover) fenced its own source above, so the
			// source is `canceled` by the time this child is admitted. Declaring the
			// admission mode keeps that fence from being read back as "the source
			// changed under us" and rejecting the recovery that just performed it.
			recoveryAdmission: cancellationRevoked
				? "cancellation_revocation"
				: providerBalanceRecovery
					? "provider_balance_recovery"
					: "failed_source",
		});
		return result.execution;
	} catch (error: unknown) {
		if (error instanceof WorkflowStartError) {
			throw new WorkflowResumeError(error.message, {
				status: error.status,
				code: error.code,
				...(error.details ? { details: error.details } : {}),
			});
		}
		throw new WorkflowResumeError(
			error instanceof Error ? error.message : "Failed to resume workflow",
			{ status: 500, code: "workflow_resume_failed" },
		);
	}
}
