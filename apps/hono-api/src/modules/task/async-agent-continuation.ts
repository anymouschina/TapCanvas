import { createHash, randomUUID } from "node:crypto";
import type { AppContext } from "../../types";
import { getFlowByIdUnsafe, mapFlowRowToDto } from "../flow/flow.repo";
import { loadChapterCanvasAsFlowRow } from "./agents-tool-bridge.chapter-canvas-write";
import {
	createTaskStatusIfAbsent,
	failWaitingTaskStatus,
	getTaskStatusByIdentity,
	listWaitingTaskStatusesForFairSweep,
	listTaskStatusesByProvider,
	requeueStaleClaimedTaskStatuses,
	tryClaimFailedTaskStatusForExplicitResume,
	tryReclaimClaimedTaskStatusForExplicitResume,
	tryClaimTaskStatus,
	tryCancelActiveTaskStatus,
	transitionClaimedTaskStatus,
	touchWaitingTaskStatus,
	touchWaitingTaskStatuses,
	upsertTaskStatus,
} from "./task-status.repo";
import { ContinuationSettlementRecoveryError } from "./continuation-settlement-recovery-error";
import {
	isAsyncAgentContinuationAttemptDue,
	ASYNC_AGENT_CONTINUATION_MAX_ATTEMPTS,
	planAsyncAgentContinuationRetry,
	type AsyncAgentContinuationFailureEvidence,
	type AsyncAgentContinuationRetryPlan,
} from "./async-agent-continuation-retry";
import { getVideoRun } from "./video-run.repo";
import { getWorkflowExecutionFamilyPageForOwner } from "../execution/execution.family-store";
import { listNodeRunsForExecutionOwner } from "../execution/execution.repo";
import { getTaskResultByTaskId } from "./task-result.repo";
import { TaskResultSchema } from "./task.schemas";
import {
	createAssetRepairContinuationWithOwnership,
	settleClaimedAssetRepairContinuation,
} from "./video-orchestrator.authoring.repo";
import {
	readBeatSheetExecutionScope,
	type BeatSheet,
} from "./video-orchestrator.beat-sheet";
import type {
	DurableActionRecoveryFactV1,
	DurableProgressClaimV1,
	DurableTaskReferenceV1,
} from "./task.agents-bridge";
import { parseDurableProgressCursor } from "./durable-progress-cursor";
import { collectWorkflowExecutionMaterializedArtifacts } from "./async-agent-continuation.workflow-artifact";
import {
	normalizeRetrievalContextV1,
	type RetrievalContextV1,
} from "../execution/execution.retrieval-context";
import { interruptAgentsChatTurn } from "./task.agents-chat-runtime";

export const ASYNC_AGENT_CONTINUATION_PROVIDER = "agents_async_continuation";
// The executor refreshes a live claim every 30 seconds. Three missed beats are
// sufficient to prove that no healthy owner remains, while avoiding the old
// five-minute user-visible dead zone after a process restart.
const ASYNC_AGENT_CONTINUATION_CLAIM_LEASE_MS = 90_000;
const ASYNC_AGENT_TERMINAL_PROJECTION_TIMEOUT_MS = 10_000;
const ASYNC_AGENT_TERMINAL_PROJECTION_RETRY_MS = 5_000;

/**
 * A continuation can replay its immutable goal through the bridge more than
 * once (execution prompt, display projection and retrieval identity). Keep a
 * deterministic margin below the 8 MB bridge request limit while allowing
 * chapter-sized and multi-chapter typed Workflow Agent inputs.
 */
export const ASYNC_AGENT_CONTINUATION_TASK_GOAL_MAX_UTF8_BYTES = 2_000_000;

export function assertAsyncAgentContinuationTaskGoalSize(goal: string): void {
	const actualBytes = new TextEncoder().encode(goal).byteLength;
	if (actualBytes <= ASYNC_AGENT_CONTINUATION_TASK_GOAL_MAX_UTF8_BYTES) return;
	const error = new Error(
		`async_continuation_task_goal_too_large:actualBytes=${actualBytes}:limitBytes=${ASYNC_AGENT_CONTINUATION_TASK_GOAL_MAX_UTF8_BYTES}`,
	) as Error & {
		code: "async_continuation_task_goal_too_large";
		actualBytes: number;
		limitBytes: number;
	};
	error.code = "async_continuation_task_goal_too_large";
	error.actualBytes = actualBytes;
	error.limitBytes = ASYNC_AGENT_CONTINUATION_TASK_GOAL_MAX_UTF8_BYTES;
	throw error;
}

function readVideoRunExecutionScope(
	beatSheetJson: string | null,
): "prompt_only" | "media_delivery" | null {
	if (!beatSheetJson) return null;
	try {
		const parsed: unknown = JSON.parse(beatSheetJson);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		const meta = (parsed as Record<string, unknown>).meta;
		if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
		return readBeatSheetExecutionScope({ meta } as Pick<BeatSheet, "meta">);
	} catch {
		return null;
	}
}

export type AsyncAgentContinuationExecutionContractV1 = {
	version: 1;
	directForcedAgentExecution: true;
	maxOutputTokens?: number;
	reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	outputContract?: unknown;
	responseFormat?: unknown;
	retrievalUserRequest?: string;
	retrievalContext?: RetrievalContextV1;
};

export type AsyncAgentContinuationTaskCapsuleV1 = {
	version: 1;
	/** Immutable user-authored goal from the first physical run. */
	goal: string;
	/** Validated non-transport request facts needed to rebuild the same execution envelope. */
	requestFacts: Record<string, unknown>;
	/** Server-owned execution semantics that public callers cannot inject. */
	executionContract?: AsyncAgentContinuationExecutionContractV1;
};

export type AsyncAgentContinuationArtifactDependencyV2 = {
	version: 2;
	/** Stable delivery-evidence identity; never derived again from array position. */
	artifactId: string;
	nodeId: string | null;
	taskId: string | null;
	runId: string | null;
	runProtocol?: "video_run" | "workflow_execution_family" | null;
};

export type AsyncAgentContinuationMaterializedArtifactV1 = {
	version: 1;
	artifactId: string;
	mediaType: "image" | "video" | "audio";
	nodeId: string | null;
	taskId: string | null;
	runId: string | null;
	sourceExecutionId?: string | null;
	assetId: string | null;
	assetUrl: string;
	observedAt: string;
	source: "task_result" | "workflow_execution";
};

export type AsyncAgentContinuationOwnedRepairRunV1 = {
	version: 1;
	runId: string;
	/** Opaque server-authored asset-repair progress generation. */
	repairGeneration: string;
};

export type AsyncAgentContinuation = {
	id: string;
	/** Root public execution trace; new continuations always persist this identity. */
	rootRequestId?: string;
	stage: number;
	/** Persisted origin of this continuation; never infer it from dependency IDs. */
	resumeTrigger: "physical_budget" | "replan" | "dependency";
	parentContinuationId: string | null;
	userId: string;
	/** Stable host application user identity used to keep agent memory/session storage on the same tenant. */
	hostUserId?: string;
	/** Server-authorized Tanva packaged-desktop workspace authority, preserved across physical windows. */
	trustedDesktopWorkspaceAccess?: true;
	projectId: string;
	flowId: string;
	chapterId: string | null;
	bookId: string | null;
	canvasNodeId: string | null;
	executionToolPolicy: {
		mode: "restricted";
		allowedTools: string[];
	} | null;
	sessionKey: string;
	modelKey: string | null;
	modelAlias: string | null;
	requiredSkills: string[];
	/** Unique physical claim identity; minted only by the durable claimant. */
	claimToken?: string;
	/**
	 * Exact per-artifact dependency tuples. New dependency continuations must carry
	 * this v2 contract; the parallel id arrays remain identity indexes only and
	 * are never used to infer node↔task↔run association.
	 */
	artifactDependencies?: AsyncAgentContinuationArtifactDependencyV2[];
	/** Server-resolved terminal assets. The URL is forwarded only on the trusted runtime channel. */
	materializedArtifacts?: AsyncAgentContinuationMaterializedArtifactV1[];
	/** Runs this continuation may terminalize; never inferred from image artifacts. */
	ownedRepairRuns?: AsyncAgentContinuationOwnedRepairRunV1[];
	dependencyNodeIds: string[];
	dependencyTaskIds: string[];
	dependencyRunIds: string[];
	handledArtifactIds: string[];
	progressFingerprint: string;
	expectedDelivery: Record<string, unknown>;
	/** Exact agents-cli contract snapshot for the same logical task. */
	userIntentContract?: Record<string, unknown>;
	durableTaskReferences?: DurableTaskReferenceV1[];
	durableProgressClaims?: DurableProgressClaimV1[];
	actionRecoveryFacts?: DurableActionRecoveryFactV1[];
	/** Opaque, hash-verified by agents-cli; carried only across the same logical task. */
	retrievalCandidateSets?: Record<string, unknown>[];
	taskCapsule?: AsyncAgentContinuationTaskCapsuleV1;
	createdAt: string;
	attempt: number;
	nextAttemptAt: string | null;
	lastFailure: AsyncAgentContinuationFailureEvidence | null;
};

function parseRetrievalCandidateSetReceipts(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) return [];
	const receipts: Record<string, unknown>[] = [];
	for (const item of value.slice(-8)) {
		if (!isRecord(item)) continue;
		const candidateSetId = typeof item.candidateSetId === "string" ? item.candidateSetId.trim() : "";
		const logicalTaskId = typeof item.logicalTaskId === "string" ? item.logicalTaskId.trim() : "";
		const rawUserRequestHash = typeof item.rawUserRequestHash === "string" ? item.rawUserRequestHash.trim() : "";
		if (!candidateSetId || !logicalTaskId || !rawUserRequestHash || !Array.isArray(item.entries)) continue;
		if (JSON.stringify(item).length > 128_000) continue;
		receipts.push(item);
	}
	return receipts;
}

export function collectAcceptedAsyncDurableRunIds(
	references: readonly DurableTaskReferenceV1[],
): string[] {
	const runIds = new Set<string>();
	for (const reference of references) {
		const runId = typeof reference.runId === "string" ? reference.runId.trim() : "";
		if (reference.acceptedAsync === true && runId) runIds.add(runId);
	}
	return [...runIds];
}

/**
 * Extracts repair ownership only from the server-authored progress cursor
 * emitted by the video authoring protocol. Image artifact receipts remain
 * node/task-only and can never acquire run-settlement authority.
 */
export function collectOwnedAsyncRepairRuns(
	references: readonly DurableTaskReferenceV1[],
): AsyncAgentContinuationOwnedRepairRunV1[] {
	const owned = new Map<string, AsyncAgentContinuationOwnedRepairRunV1>();
	for (const reference of references) {
		const cursor = reference.progressCursor;
		const runId = reference.runId?.trim() ?? "";
		if (
			!cursor || !runId ||
			cursor.graph !== "video_authoring" ||
			cursor.phase !== "asset_repair" ||
			cursor.scopeId !== `${runId}:asset_repair` ||
			!cursor.executionGeneration
		) continue;
		owned.set(runId, {
			version: 1,
			runId,
			repairGeneration: cursor.executionGeneration,
		});
	}
	return [...owned.values()];
}

const ROOT_PHYSICAL_RUN_ARTIFACT_PREFIX = "root_physical_run:";

export function isRootPhysicalBudgetContinuation(
	continuation: AsyncAgentContinuation,
): boolean {
	return continuation.resumeTrigger === "physical_budget" || continuation.resumeTrigger === "replan";
}

type AsyncAgentContinuationNodeState = "ready" | "failed" | "pending" | "missing";

function combineAlternativeDependencyStates(
	left: AsyncAgentContinuationNodeState | null,
	right: AsyncAgentContinuationNodeState | null,
): AsyncAgentContinuationNodeState | null {
	if (left === null) return right;
	if (right === null) return left === "missing" ? "failed" : left;
	if (left === "ready") return "ready";
	if (left === "missing") {
		// A live accepted task may still materialize its exact target node. Once
		// that task is terminal, however, a deleted target is not silently
		// recreated: the old continuation is closed and a new explicit plan may
		// decide what to do with the user's canvas mutation.
		return right === "pending" ? "pending" : "failed";
	}
	if (left === "pending") {
		if (right === "ready") return "ready";
		if (right === "failed" || right === "missing") return "failed";
		return "pending";
	}
	// The target node exists but is terminally failed. A succeeded task receipt
	// still permits one reconciliation pass; an active task remains waitable.
	if (right === "ready") return "ready";
	if (right === "pending") return "pending";
	return "failed";
}

function readTaskResultDependencyState(
	status: string | null | undefined,
): AsyncAgentContinuationNodeState {
	const normalized = String(status ?? "").trim().toLowerCase();
	if (normalized === "succeeded") return "ready";
	if (normalized === "failed" || normalized === "cancelled") return "failed";
	if (normalized === "queued" || normalized === "waiting" || normalized === "claimed" || normalized === "running") {
		return "pending";
	}
	// A continuation is registered only after its accepted task receipt is
	// persisted. An absent or unknown task row therefore cannot become ready by
	// waiting longer; keeping it pending would create an immortal sweep entry.
	return "failed";
}

function isActiveAcceptedTaskStatus(status: string | null | undefined): boolean {
	const normalized = String(status ?? "").trim().toLowerCase();
	return normalized === "queued" || normalized === "waiting" || normalized === "claimed" || normalized === "running";
}

function compactFailureIdentity(value: string): string {
	return [...value.trim()]
		.filter((character) => /[a-z0-9:_-]/iu.test(character))
		.join("")
		.slice(0, 160) || "unknown_failure";
}

function releaseContinuationClaim(
	continuation: AsyncAgentContinuation,
): AsyncAgentContinuation {
	const { claimToken: _releasedClaimToken, ...waitingContinuation } = continuation;
	return waitingContinuation;
}

async function readActiveAssetRepairTaskIds(input: {
	c: AppContext;
	continuation: AsyncAgentContinuation;
}): Promise<string[]> {
	// Only the artifact tasks frozen into this continuation generation can own
	// its repair frontier. Historical durableTaskReferences may belong to prior
	// stages and must not keep an unrelated run parked forever.
	const acceptedTaskIds = new Set(
		(input.continuation.artifactDependencies ?? [])
			.map((dependency) => dependency.taskId)
			.filter((taskId): taskId is string => Boolean(taskId)),
	);
	// Explicit retirement path for pre-v2 waiting rows. Runtime dependency
	// resolution never infers tuple association from these parallel indexes.
	if (!input.continuation.artifactDependencies) {
		for (const taskId of input.continuation.dependencyTaskIds) acceptedTaskIds.add(taskId);
	}
	const acceptedTasks = await Promise.all([...acceptedTaskIds].map(async (taskId) => ({
		taskId,
		row: await getTaskResultByTaskId(input.c.env.DB, input.continuation.userId, taskId),
	})));
	return acceptedTasks
		.filter(({ row }) => row && isActiveAcceptedTaskStatus(row.status))
		.map(({ taskId }) => taskId);
}

function terminalizeClaimedContinuation(input: {
	continuation: AsyncAgentContinuation;
	failure: AsyncAgentContinuationFailureEvidence;
}): Promise<{ terminalized: boolean; settledRunIds: string[]; status: "completed" | "failed" }> {
	if (!input.continuation.claimToken) {
		return Promise.resolve({ terminalized: false, settledRunIds: [], status: "failed" });
	}
	const nextContinuation: AsyncAgentContinuation = {
		...input.continuation,
		lastFailure: input.failure,
		nextAttemptAt: null,
	};
	return settleClaimedAssetRepairContinuation({
		continuationId: input.continuation.id,
		continuationProvider: ASYNC_AGENT_CONTINUATION_PROVIDER,
		continuationUserId: input.continuation.userId,
		continuationClaimToken: input.continuation.claimToken,
		continuationData: nextContinuation,
		requestedStatus: "failed",
		runs: (input.continuation.ownedRepairRuns ?? []).map((run) => ({
			runId: run.runId,
			repairGeneration: run.repairGeneration,
			ownerId: input.continuation.userId,
			projectId: input.continuation.projectId,
			flowId: input.continuation.flowId,
			chapterId: input.continuation.chapterId,
		})),
		errorMessage: [
			"asset_repair_executor_terminal",
			`continuation=${compactFailureIdentity(input.continuation.id)}`,
			`failure=${compactFailureIdentity(input.failure.code)}`,
		].join(":"),
		nowIso: input.failure.occurredAt,
	});
}

/**
 * A dependency continuation is only an implementation child of the public
 * chat turn. Its terminal failure must settle the root turn as well; otherwise
 * the continuation row becomes failed while the user-visible turn remains
 * suspended forever. The exact public turn id is the optimistic concurrency
 * token, so a newer turn is never interrupted by a late child failure.
 */
async function projectAsyncContinuationFailureToRootTurn(input: {
	c: AppContext;
	continuation: AsyncAgentContinuation;
}): Promise<void> {
	const rootRequestId = input.continuation.rootRequestId?.trim() ?? "";
	if (!rootRequestId.startsWith("public-chat-turn:")) return;
	try {
		const receipt = await interruptAgentsChatTurn(input.c, input.continuation.userId, {
			sessionId: input.continuation.sessionKey,
			turnId: rootRequestId,
			reasonCode: "async_dependency_terminal",
		}, {
			timeoutMs: ASYNC_AGENT_TERMINAL_PROJECTION_TIMEOUT_MS,
		});
		const projectedState = receipt.status?.turn?.turnId === rootRequestId
			? receipt.status.turn.state
			: null;
		if (
			!receipt.interrupted &&
			projectedState !== "failed" &&
			projectedState !== "cancelled" &&
			projectedState !== "succeeded"
		) {
			throw new Error(`async_dependency_root_terminal_not_confirmed:${rootRequestId}`);
		}
	} catch (error: unknown) {
		const code = error && typeof error === "object" && "code" in error
			? String(error.code || "").trim()
			: "";
		// A later accepted turn owns the session now. The failed continuation
		// remains durable evidence for its original root, but it must not affect
		// the newer turn.
		if (code === "chat_turn_mismatch") return;
		throw error;
	}
}

async function terminalizeClaimedContinuationAndRoot(input: {
	c: AppContext;
	continuation: AsyncAgentContinuation;
	failure: AsyncAgentContinuationFailureEvidence;
}): Promise<{ terminalized: boolean; settledRunIds: string[]; status: "completed" | "failed" }> {
	try {
		await projectAsyncContinuationFailureToRootTurn({
			c: input.c,
			continuation: input.continuation,
		});
	} catch (error: unknown) {
		const claimToken = input.continuation.claimToken?.trim() ?? "";
		if (claimToken) {
			const occurredAt = new Date().toISOString();
			const projectionFailure = {
				occurredAt,
				code: "root_terminal_projection_deferred",
				status: null,
				upstreamStatus: null,
				message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
				retryable: true,
			} satisfies AsyncAgentContinuationFailureEvidence;
			await transitionClaimedTaskStatus(input.c.env.DB, {
				taskId: input.continuation.id,
				provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
				userId: input.continuation.userId,
				status: "waiting",
				data: releaseContinuationClaim({
					...input.continuation,
					nextAttemptAt: new Date(
						Date.parse(occurredAt) + ASYNC_AGENT_TERMINAL_PROJECTION_RETRY_MS,
					).toISOString(),
					lastFailure: projectionFailure,
				}),
				claimToken,
				completedAt: null,
				nowIso: occurredAt,
			});
		}
		throw error;
	}
	return terminalizeClaimedContinuation({
		continuation: input.continuation,
		failure: input.failure,
	});
}

export type AsyncAgentContinuationSweepResult = {
	scanned: number;
	recoveredClaims: number;
	ready: number;
	claimed: number;
	failed: number;
	continuations: AsyncAgentContinuation[];
	errors: Array<{ continuationId: string; message: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	for (const item of value) {
		if (typeof item !== "string") continue;
		const text = item.trim();
		if (text) seen.add(text);
	}
	return [...seen];
}

function parseArtifactDependencies(
	value: unknown,
): AsyncAgentContinuationArtifactDependencyV2[] | null {
	if (typeof value === "undefined") return null;
	if (!Array.isArray(value) || value.length > 64) return null;
	const dependencies: AsyncAgentContinuationArtifactDependencyV2[] = [];
	const artifactIds = new Set<string>();
	for (const item of value) {
		if (!isRecord(item) || item.version !== 2) return null;
		const artifactId = typeof item.artifactId === "string" ? item.artifactId.trim() : "";
		const readOptionalId = (candidate: unknown): string | null =>
			typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
		const nodeId = readOptionalId(item.nodeId);
		const taskId = readOptionalId(item.taskId);
		const runId = readOptionalId(item.runId);
		const runProtocol = item.runProtocol === "video_run" || item.runProtocol === "workflow_execution_family"
			? item.runProtocol
			: null;
		if (!artifactId || artifactIds.has(artifactId) || (!nodeId && !taskId && !runId)) return null;
		artifactIds.add(artifactId);
		dependencies.push({
			version: 2,
			artifactId,
			nodeId,
			taskId,
			runId,
			...(runProtocol ? { runProtocol } : {}),
		});
	}
	return dependencies;
}

function isHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

function parseMaterializedArtifacts(
	value: unknown,
): AsyncAgentContinuationMaterializedArtifactV1[] | null {
	if (typeof value === "undefined") return null;
	if (!Array.isArray(value)) return null;
	const artifacts: AsyncAgentContinuationMaterializedArtifactV1[] = [];
	const identities = new Set<string>();
	for (const item of value) {
		if (
			!isRecord(item) ||
			item.version !== 1 ||
			(item.source !== "task_result" && item.source !== "workflow_execution")
		) return null;
		const artifactId = typeof item.artifactId === "string" ? item.artifactId.trim() : "";
		const optionalId = (candidate: unknown): string | null =>
			typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
		const taskId = optionalId(item.taskId);
		const runId = optionalId(item.runId);
		const sourceExecutionId = optionalId(item.sourceExecutionId);
		const assetUrl = typeof item.assetUrl === "string" ? item.assetUrl.trim() : "";
		const mediaType = item.mediaType === "image" || item.mediaType === "video" || item.mediaType === "audio"
			? item.mediaType
			: null;
		const observedAt = typeof item.observedAt === "string" && Number.isFinite(Date.parse(item.observedAt))
			? item.observedAt
			: "";
		const sourceIdentityValid = item.source === "task_result"
			? taskId !== null
			: runId !== null && sourceExecutionId !== null;
		const identity = `${artifactId}\u0000${taskId ?? ""}\u0000${runId ?? ""}\u0000${assetUrl}`;
		if (!artifactId || !sourceIdentityValid || !mediaType || assetUrl.length > 8_000 || !isHttpUrl(assetUrl) || !observedAt || identities.has(identity)) {
			return null;
		}
		identities.add(identity);
		artifacts.push({
			version: 1,
			artifactId,
			mediaType,
			nodeId: optionalId(item.nodeId),
			taskId,
			runId,
			...(sourceExecutionId ? { sourceExecutionId } : {}),
			assetId: optionalId(item.assetId),
			assetUrl,
			observedAt,
			source: item.source,
		});
	}
	return artifacts;
}

function expectedArtifactMediaType(artifactId: string): "image" | "video" | "audio" | null {
	const prefix = artifactId.slice(0, artifactId.indexOf(":"));
	return prefix === "image" || prefix === "video" || prefix === "audio" ? prefix : null;
}

export function collectTaskResultMaterializedArtifacts(input: Readonly<{
	dependency: AsyncAgentContinuationArtifactDependencyV2;
	taskResultJson: string;
	taskResultNodeId: string | null;
	observedAt: string;
}>): AsyncAgentContinuationMaterializedArtifactV1[] {
	const taskId = input.dependency.taskId;
	if (!taskId) return [];
	if (
		input.dependency.nodeId &&
		input.taskResultNodeId &&
		input.dependency.nodeId !== input.taskResultNodeId
	) return [];
	let rawResult: unknown;
	try {
		rawResult = JSON.parse(input.taskResultJson);
	} catch {
		return [];
	}
	const parsed = TaskResultSchema.safeParse(rawResult);
	if (!parsed.success || parsed.data.status !== "succeeded" || parsed.data.id !== taskId) return [];
	const expectedMediaType = expectedArtifactMediaType(input.dependency.artifactId);
	return parsed.data.assets.flatMap((asset) => {
		if (asset.type === "file" || (expectedMediaType && asset.type !== expectedMediaType)) return [];
		const assetUrl = asset.url.trim();
		if (!isHttpUrl(assetUrl)) return [];
		return [{
			version: 1 as const,
			artifactId: input.dependency.artifactId,
			mediaType: asset.type,
			nodeId: input.dependency.nodeId ?? input.taskResultNodeId,
			taskId,
			runId: input.dependency.runId,
			assetId: asset.assetId?.trim() || null,
			assetUrl,
			observedAt: input.observedAt,
			source: "task_result" as const,
		}];
	});
}

function parseOwnedRepairRuns(
	value: unknown,
): AsyncAgentContinuationOwnedRepairRunV1[] | null {
	if (typeof value === "undefined") return null;
	if (!Array.isArray(value)) return null;
	const runs: AsyncAgentContinuationOwnedRepairRunV1[] = [];
	const runIds = new Set<string>();
	for (const item of value) {
		if (!isRecord(item) || item.version !== 1) return null;
		const runId = typeof item.runId === "string" ? item.runId.trim() : "";
		const repairGeneration = typeof item.repairGeneration === "string"
			? item.repairGeneration.trim()
			: "";
		if (!runId || !repairGeneration || runIds.has(runId)) return null;
		runIds.add(runId);
		runs.push({ version: 1, runId, repairGeneration });
	}
	return runs;
}

function parseDurableTaskReferences(value: unknown): DurableTaskReferenceV1[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!isRecord(item) || item.version !== 1) return [];
		const toolName = typeof item.toolName === "string" ? item.toolName.trim() : "";
		if (!toolName) return [];
		const readOptionalString = (field: unknown): string | null =>
			typeof field === "string" && field.trim() ? field.trim() : null;
		const rawClipIndex = item.clipIndex;
		const clipIndex = typeof rawClipIndex === "number" && Number.isInteger(rawClipIndex) && rawClipIndex >= 0
			? rawClipIndex
			: null;
		const progressCursor = parseDurableProgressCursor(item.progressCursor);
		return [{
			version: 1 as const,
			toolName,
			mode: readOptionalString(item.mode),
			runId: readOptionalString(item.runId),
			taskId: readOptionalString(item.taskId),
			draftRevision: readOptionalString(item.draftRevision),
			beatRevision: readOptionalString(item.beatRevision),
			preflightRevision: readOptionalString(item.preflightRevision),
			preflightFingerprint: readOptionalString(item.preflightFingerprint),
			clipIndex,
			...(progressCursor ? { progressCursor } : {}),
			acceptedAsync: item.acceptedAsync === true,
		}];
	}).slice(-32);
}

function parseActionRecoveryFacts(value: unknown): DurableActionRecoveryFactV1[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!isRecord(item) || item.version !== 1) return [];
		const toolName = typeof item.toolName === "string" ? item.toolName.trim() : "";
		const message = typeof item.message === "string" ? item.message.trim().slice(0, 2_000) : "";
		const status: DurableActionRecoveryFactV1["status"] | null =
			item.status === "failed"
				? "failed"
				: item.status === "blocked"
					? "blocked"
					: item.status === "denied"
						? "denied"
						: item.status === "warning"
							? "warning"
							: null;
		if (!toolName || !message || !status) return [];
		const optionalString = (value: unknown): string | null =>
			typeof value === "string" && value.trim() ? value.trim() : null;
		const serializedRetryInput = isRecord(item.retryInput)
			? JSON.stringify(item.retryInput)
			: "";
		const retryInput = serializedRetryInput.length > 0 && serializedRetryInput.length <= 512_000
			? JSON.parse(serializedRetryInput) as Record<string, unknown>
			: null;
		return [{
			version: 1 as const,
			toolName,
			mode: optionalString(item.mode),
			status,
			code: optionalString(item.code),
			message,
			runId: optionalString(item.runId),
			draftRevision: optionalString(item.draftRevision),
			...(retryInput ? { retryInput } : {}),
		}];
	}).slice(-16);
}

function parseDurableProgressClaims(value: unknown): DurableProgressClaimV1[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!isRecord(item)) return [];
		const kind: DurableProgressClaimV1["kind"] | null = item.kind === "durable_action" || item.kind === "delivery" || item.kind === "task_state"
			? item.kind
			: null;
		const revision = typeof item.revision === "number" && Number.isInteger(item.revision) && item.revision > 0
			? item.revision
			: null;
		const readRequired = (field: unknown): string =>
			typeof field === "string" ? field.trim() : "";
		const key = readRequired(item.key);
		const fingerprint = readRequired(item.fingerprint);
		const toolName = readRequired(item.toolName);
		const toolCallId = readRequired(item.toolCallId);
		const observedAt = readRequired(item.observedAt);
		if (!kind || revision === null || !key || !fingerprint || !toolName || !toolCallId || !observedAt) return [];
		return [{ key, fingerprint, kind, toolName, toolCallId, observedAt, revision }];
	}).slice(-12);
}

function parseTaskCapsule(value: unknown): AsyncAgentContinuationTaskCapsuleV1 | null {
	if (!isRecord(value) || value.version !== 1) return null;
	const goal = typeof value.goal === "string" ? value.goal.trim() : "";
	const requestFacts = isRecord(value.requestFacts) ? value.requestFacts : null;
	if (!goal || !requestFacts) return null;
	assertAsyncAgentContinuationTaskGoalSize(goal);
	const rawExecutionContract = isRecord(value.executionContract)
		? value.executionContract
		: null;
	const retrievalContext = normalizeRetrievalContextV1(rawExecutionContract?.retrievalContext);
	const executionContract: AsyncAgentContinuationExecutionContractV1 | null =
		rawExecutionContract?.version === 1 &&
		rawExecutionContract.directForcedAgentExecution === true
			? {
				version: 1,
				directForcedAgentExecution: true,
				...(typeof rawExecutionContract.outputContract !== "undefined"
					? { outputContract: structuredClone(rawExecutionContract.outputContract) }
					: {}),
				...(typeof rawExecutionContract.responseFormat !== "undefined"
					? { responseFormat: structuredClone(rawExecutionContract.responseFormat) }
					: {}),
				...(typeof rawExecutionContract.maxOutputTokens === "number"
					? { maxOutputTokens: rawExecutionContract.maxOutputTokens }
					: {}),
				...(typeof rawExecutionContract.retrievalUserRequest === "string"
					&& rawExecutionContract.retrievalUserRequest.trim()
					? { retrievalUserRequest: rawExecutionContract.retrievalUserRequest.trim() }
					: {}),
				...(retrievalContext ? { retrievalContext } : {}),
			}
			: null;
	return {
		version: 1,
		goal,
		requestFacts,
		...(executionContract ? { executionContract } : {}),
	};
}

function readNonNegativeInteger(value: unknown): number {
	const numeric = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numeric)) return 0;
	return Math.max(0, Math.trunc(numeric));
}

function parseFailureEvidence(value: unknown): AsyncAgentContinuationFailureEvidence | null {
	if (!isRecord(value)) return null;
	const occurredAt = typeof value.occurredAt === "string" ? value.occurredAt.trim() : "";
	const code = typeof value.code === "string" ? value.code.trim() : "";
	const message = typeof value.message === "string" ? value.message.trim() : "";
	if (!occurredAt || !code || !message || typeof value.retryable !== "boolean") return null;
	const readStatus = (status: unknown): number | null => {
		if (status === null) return null;
		const numeric = typeof status === "number" ? status : Number(status);
		if (!Number.isFinite(numeric)) return null;
		const normalized = Math.trunc(numeric);
		return normalized >= 400 && normalized <= 599 ? normalized : null;
	};
	return {
		occurredAt,
		code,
		status: readStatus(value.status),
		upstreamStatus: readStatus(value.upstreamStatus),
		message: message.slice(0, 500),
		retryable: value.retryable,
	};
}

export function buildAsyncAgentContinuationId(input: {
	requestId?: string | null;
	parentContinuationId?: string | null;
	dependencyNodeIds: string[];
	dependencyTaskIds: string[];
	dependencyRunIds?: string[];
	ownedRepairRuns?: AsyncAgentContinuationOwnedRepairRunV1[];
	progressFingerprint: string;
}): string | null {
	const parentContinuationId = String(input.parentContinuationId ?? "").trim();
	const requestId = String(input.requestId ?? "").trim();
	const progressFingerprint = String(input.progressFingerprint || "").trim();
	const stageParent = parentContinuationId || requestId;
	if (!stageParent || !progressFingerprint) return null;
	const canonical = JSON.stringify({
		stageParent,
		progressFingerprint,
		dependencyNodeIds: [
			...new Set(input.dependencyNodeIds.map((id) => id.trim()).filter(Boolean)),
		].sort(),
		dependencyTaskIds: [
			...new Set(input.dependencyTaskIds.map((id) => id.trim()).filter(Boolean)),
		].sort(),
		dependencyRunIds: [
			...new Set((input.dependencyRunIds ?? []).map((id) => id.trim()).filter(Boolean)),
		].sort(),
		ownedRepairRuns: [...(input.ownedRepairRuns ?? [])]
			.map((run) => ({ runId: run.runId.trim(), repairGeneration: run.repairGeneration.trim() }))
			.filter((run) => run.runId && run.repairGeneration)
			.sort((left, right) => left.runId.localeCompare(right.runId)),
	});
	const digest = createHash("sha256").update(canonical).digest("hex").slice(0, 40);
	return `async-continuation:${digest}`;
}

/**
 * A continuation id is the stable logical/durable task identity. Every claim
 * attempt is a distinct physical execution and therefore needs its own trace
 * identity; reusing the logical id would overwrite the prior attempt's
 * lifecycle and conflict with its immutable root/logical correlation.
 */
export function buildAsyncAgentContinuationExecutionTraceId(input: {
	continuationId: string;
	attempt: number;
}): string {
	const continuationId = input.continuationId.trim();
	if (!continuationId) throw new Error("async_continuation_trace_id_required");
	if (!Number.isInteger(input.attempt) || input.attempt < 0) {
		throw new Error("async_continuation_trace_attempt_invalid");
	}
	return `${continuationId}:attempt:${input.attempt}`;
}

export function buildAsyncAgentContinuationNodeStates(
	nodes: unknown,
): Map<string, AsyncAgentContinuationNodeState> {
	const states = new Map<string, AsyncAgentContinuationNodeState>();
	if (!Array.isArray(nodes)) return states;
	for (const node of nodes) {
		if (!isRecord(node)) continue;
		const nodeId = typeof node.id === "string" ? node.id.trim() : "";
		const data = isRecord(node.data) ? node.data : null;
		if (!nodeId || !data) continue;
		const status = typeof data.status === "string" ? data.status.trim().toLowerCase() : "";
		states.set(
			nodeId,
			hasMaterializedAssetUrl(data)
				? "ready"
				: status === "error" || status === "failed" || status === "cancelled"
					? "failed"
					: "pending",
		);
	}
	return states;
}

function hasNonEmptyUrl(value: unknown): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

function hasUrlInRecords(value: unknown): boolean {
	if (!Array.isArray(value)) return false;
	return value.some((item) => {
		if (!isRecord(item)) return false;
		return [item.url, item.imageUrl, item.videoUrl, item.audioUrl].some(hasNonEmptyUrl);
	});
}

function hasMaterializedAssetUrl(data: Record<string, unknown>): boolean {
	if (
		[
			data.imageUrl,
			data.videoUrl,
			data.audioUrl,
			data.concatVideoUrl,
			data.firstFrameUrl,
			data.lastFrameUrl,
		].some(hasNonEmptyUrl)
	) {
		return true;
	}
	return [
		data.imageResults,
		data.videoResults,
		data.audioResults,
		data.storyboardEditorCells,
	].some(hasUrlInRecords);
}

function parseContinuation(value: string | null): AsyncAgentContinuation | null {
	if (!value) return null;
	try {
		const parsed: unknown = JSON.parse(value);
		if (!isRecord(parsed)) return null;
		const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
		const userId = typeof parsed.userId === "string" ? parsed.userId.trim() : "";
		const hostUserId =
			typeof parsed.hostUserId === "string" && parsed.hostUserId.trim()
				? parsed.hostUserId.trim().slice(0, 512)
				: "";
		const trustedDesktopWorkspaceAccess = parsed.trustedDesktopWorkspaceAccess === true;
		const projectId = typeof parsed.projectId === "string" ? parsed.projectId.trim() : "";
		const flowId = typeof parsed.flowId === "string" ? parsed.flowId.trim() : "";
		const chapterId = typeof parsed.chapterId === "string" && parsed.chapterId.trim()
			? parsed.chapterId.trim()
			: null;
		const bookId = typeof parsed.bookId === "string" && parsed.bookId.trim()
			? parsed.bookId.trim()
			: null;
		const canvasNodeId = typeof parsed.canvasNodeId === "string" && parsed.canvasNodeId.trim()
			? parsed.canvasNodeId.trim()
			: null;
		const executionToolPolicyRecord = isRecord(parsed.executionToolPolicy)
			? parsed.executionToolPolicy
			: null;
		const executionToolPolicy = executionToolPolicyRecord?.mode === "restricted"
			? {
				mode: "restricted" as const,
				allowedTools: uniqueStrings(executionToolPolicyRecord.allowedTools),
			}
			: null;
		const sessionKey = typeof parsed.sessionKey === "string" ? parsed.sessionKey.trim() : "";
		const expectedDelivery = isRecord(parsed.expectedDelivery) ? parsed.expectedDelivery : null;
		const userIntentContract = isRecord(parsed.userIntentContract) ? parsed.userIntentContract : null;
		const durableTaskReferences = parseDurableTaskReferences(parsed.durableTaskReferences);
		const durableProgressClaims = parseDurableProgressClaims(parsed.durableProgressClaims);
		const actionRecoveryFacts = parseActionRecoveryFacts(parsed.actionRecoveryFacts);
		const retrievalCandidateSets = parseRetrievalCandidateSetReceipts(parsed.retrievalCandidateSets);
		const taskCapsule = parseTaskCapsule(parsed.taskCapsule);
		if (
			typeof parsed.taskCapsule !== "undefined"
			&& parsed.taskCapsule !== null
			&& !taskCapsule
		) return null;
		const stage = readNonNegativeInteger(parsed.stage);
		const resumeTrigger =
			parsed.resumeTrigger === "physical_budget" || parsed.resumeTrigger === "replan" || parsed.resumeTrigger === "dependency"
				? parsed.resumeTrigger
				: null;
		const handledArtifactIds = uniqueStrings(parsed.handledArtifactIds);
		const artifactDependencies = parseArtifactDependencies(parsed.artifactDependencies);
		if (typeof parsed.artifactDependencies !== "undefined" && artifactDependencies === null) return null;
		const materializedArtifacts = parseMaterializedArtifacts(parsed.materializedArtifacts);
		if (typeof parsed.materializedArtifacts !== "undefined" && materializedArtifacts === null) return null;
		if (materializedArtifacts?.some((artifact) => !artifactDependencies?.some((dependency) =>
			dependency.artifactId === artifact.artifactId &&
			(!dependency.taskId || dependency.taskId === artifact.taskId) &&
			(!dependency.nodeId || dependency.nodeId === artifact.nodeId) &&
			(!dependency.runId || dependency.runId === artifact.runId)
		))) return null;
		const ownedRepairRuns = parseOwnedRepairRuns(parsed.ownedRepairRuns);
		if (typeof parsed.ownedRepairRuns !== "undefined" && ownedRepairRuns === null) return null;
		const progressFingerprint =
			typeof parsed.progressFingerprint === "string" ? parsed.progressFingerprint.trim() : "";
		const rawNextAttemptAt =
			typeof parsed.nextAttemptAt === "string" ? parsed.nextAttemptAt.trim() : "";
		const nextAttemptAt =
			rawNextAttemptAt && Number.isFinite(Date.parse(rawNextAttemptAt))
				? rawNextAttemptAt
				: null;
		if (
			!id ||
			!userId ||
			!sessionKey ||
			!expectedDelivery ||
			!resumeTrigger ||
			stage < 1 ||
			handledArtifactIds.length === 0 ||
			!progressFingerprint
		) return null;
		const dependencyNodeIds = uniqueStrings(parsed.dependencyNodeIds);
		const dependencyRunIds = uniqueStrings(parsed.dependencyRunIds);
		const isPhysicalBudgetContinuation = resumeTrigger === "physical_budget" || resumeTrigger === "replan";
		if (!isPhysicalBudgetContinuation && (!projectId || (!flowId && !chapterId))) return null;
		return {
			id,
			...(typeof parsed.rootRequestId === "string" && parsed.rootRequestId.trim()
				? { rootRequestId: parsed.rootRequestId.trim() }
				: {}),
			stage,
			resumeTrigger,
			parentContinuationId:
				typeof parsed.parentContinuationId === "string" && parsed.parentContinuationId.trim()
					? parsed.parentContinuationId.trim()
					: null,
			userId,
			...(hostUserId ? { hostUserId } : {}),
			...(trustedDesktopWorkspaceAccess ? { trustedDesktopWorkspaceAccess: true as const } : {}),
			projectId,
			flowId,
			chapterId,
			bookId,
			canvasNodeId,
			executionToolPolicy,
			sessionKey,
			modelKey: typeof parsed.modelKey === "string" && parsed.modelKey.trim() ? parsed.modelKey.trim() : null,
			modelAlias: typeof parsed.modelAlias === "string" && parsed.modelAlias.trim() ? parsed.modelAlias.trim() : null,
			requiredSkills: uniqueStrings(parsed.requiredSkills),
			...(typeof parsed.claimToken === "string" && parsed.claimToken.trim()
				? { claimToken: parsed.claimToken.trim() }
				: {}),
			...(artifactDependencies ? { artifactDependencies } : {}),
			...(materializedArtifacts ? { materializedArtifacts } : {}),
			...(ownedRepairRuns ? { ownedRepairRuns } : {}),
			dependencyNodeIds,
			dependencyTaskIds: uniqueStrings(parsed.dependencyTaskIds),
			dependencyRunIds,
			handledArtifactIds,
			progressFingerprint,
			expectedDelivery,
			...(userIntentContract ? { userIntentContract } : {}),
			...(durableTaskReferences.length > 0 ? { durableTaskReferences } : {}),
			...(durableProgressClaims.length > 0 ? { durableProgressClaims } : {}),
			...(actionRecoveryFacts.length > 0 ? { actionRecoveryFacts } : {}),
			...(retrievalCandidateSets.length > 0 ? { retrievalCandidateSets } : {}),
			...(taskCapsule ? { taskCapsule } : {}),
			createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
			attempt: readNonNegativeInteger(parsed.attempt),
			nextAttemptAt,
			lastFailure: parseFailureEvidence(parsed.lastFailure),
		};
	} catch {
		return null;
	}
}

/** Shared structural parser for recovery capsules and durable task rows. */
export function parseAsyncAgentContinuation(value: unknown): AsyncAgentContinuation | null {
	if (!isRecord(value)) return null;
	return parseContinuation(JSON.stringify(value));
}

export async function registerAsyncAgentContinuation(
	c: AppContext,
	continuation: AsyncAgentContinuation,
): Promise<boolean> {
	if (
		(continuation.artifactDependencies?.length ?? 0) === 0 &&
		!isRootPhysicalBudgetContinuation(continuation)
	) return false;
	if (continuation.claimToken) {
		throw new Error("new async continuation cannot reuse a physical claim token");
	}
	if ((continuation.ownedRepairRuns?.length ?? 0) > 0) {
		if (!continuation.projectId || (!continuation.flowId && !continuation.chapterId)) {
			throw new Error("owned repair continuation scope is incomplete");
		}
		return createAssetRepairContinuationWithOwnership({
			db: c.env.DB,
			continuationId: continuation.id,
			continuationProvider: ASYNC_AGENT_CONTINUATION_PROVIDER,
			continuationUserId: continuation.userId,
			continuationData: continuation,
			parentContinuationId: continuation.parentContinuationId,
			createdAt: continuation.createdAt,
			runs: continuation.ownedRepairRuns!.map((run) => ({
				runId: run.runId,
				repairGeneration: run.repairGeneration,
				ownerId: continuation.userId,
				projectId: continuation.projectId,
				flowId: continuation.flowId || null,
				chapterId: continuation.chapterId,
			})),
		});
	}
	return createTaskStatusIfAbsent(c.env.DB, {
		taskId: continuation.id,
		provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
		userId: continuation.userId,
		status: "waiting",
		data: continuation,
		nowIso: continuation.createdAt,
	});
}

export type AsyncAgentContinuationRegistrationRecovery = Readonly<{
	status: "created" | "existing";
	queueRequired: boolean;
	existingStatus: string | null;
}>;

/**
 * Idempotently restores the durable continuation row after registration
 * settlement failed. `createTaskStatusIfAbsent=false` is ambiguous: it can
 * mean either a legitimate prior write or a structurally rejected contract.
 * Recovery resolves that ambiguity from the authoritative row before it
 * queues work or marks the settlement effect complete.
 */
export async function ensureAsyncAgentContinuationRegistered(
	c: AppContext,
	continuation: AsyncAgentContinuation,
): Promise<AsyncAgentContinuationRegistrationRecovery> {
	const expected = parseAsyncAgentContinuation(continuation);
	if (!expected) {
		throw new ContinuationSettlementRecoveryError({
			code: "continuation_settlement_contract_invalid",
			retryable: false,
		});
	}
	if (expected.claimToken) {
		throw new ContinuationSettlementRecoveryError({
			code: "continuation_settlement_contract_reuses_claim_token",
			retryable: false,
		});
	}
	const created = await registerAsyncAgentContinuation(c, expected);
	if (created) {
		return { status: "created", queueRequired: true, existingStatus: null };
	}
	const row = await getTaskStatusByIdentity(c.env.DB, {
		taskId: expected.id,
		provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
	});
	const existing = row ? parseContinuation(row.data) : null;
	if (!row || !existing) {
		throw new ContinuationSettlementRecoveryError({
			code: "continuation_settlement_registration_rejected",
			retryable: false,
		});
	}
	if (
		row.user_id !== expected.userId ||
		existing.id !== expected.id ||
		existing.userId !== expected.userId ||
		existing.rootRequestId !== expected.rootRequestId ||
		existing.sessionKey !== expected.sessionKey ||
		existing.stage !== expected.stage ||
		existing.parentContinuationId !== expected.parentContinuationId ||
		existing.progressFingerprint !== expected.progressFingerprint
	) {
		throw new ContinuationSettlementRecoveryError({
			code: "continuation_settlement_registration_identity_drift",
			retryable: false,
		});
	}
	return {
		status: "existing",
		queueRequired: row.status === "waiting",
		existingStatus: row.status,
	};
}

export async function claimAsyncAgentContinuation(
	c: AppContext,
	continuation: AsyncAgentContinuation,
): Promise<AsyncAgentContinuation | null> {
	const claimedContinuation: AsyncAgentContinuation = {
		...continuation,
		claimToken: randomUUID(),
	};
	const claimed = await tryClaimTaskStatus(c.env.DB, {
		taskId: continuation.id,
		provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
		claimedData: claimedContinuation,
		nowIso: new Date().toISOString(),
	});
	return claimed ? claimedContinuation : null;
}

export async function findAsyncAgentContinuationForPublicTurn(input: Readonly<{
	c: AppContext;
	userId: string;
	sessionKey: string;
	rootRequestId: string;
}>): Promise<AsyncAgentContinuation | null> {
	const rows = (await Promise.all(["claimed", "waiting", "failed"].map((status) =>
		listTaskStatusesByProvider(input.c.env.DB, {
			provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
			status,
			userId: input.userId,
			order: "desc",
			limit: 100,
		}))))
		.flat()
		.sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
	for (const row of rows) {
		const continuation = parseContinuation(row.data);
		if (
			continuation?.userId === input.userId &&
			continuation.sessionKey === input.sessionKey &&
			continuation.rootRequestId === input.rootRequestId
		) return continuation;
	}
	return null;
}

export type SessionPhysicalContinuationClaim =
	| {
		status: "claimed";
		continuation: AsyncAgentContinuation;
		waitingCount: number;
		invalidCount: number;
	}
	| {
		status: "not_ready";
		waitingCount: number;
		invalidCount: number;
	};

const SESSION_CONTINUATION_SCAN_PAGE_SIZE = 100;
const SESSION_CONTINUATION_SCAN_MAX_PAGES = 100;

async function listTaskStatusesForExactSessionScan(input: {
	c: AppContext;
	userId: string;
	status: string;
}): Promise<Awaited<ReturnType<typeof listTaskStatusesByProvider>>> {
	const rows: Awaited<ReturnType<typeof listTaskStatusesByProvider>> = [];
	let before: { createdAt: string; id: string } | undefined;
	for (let page = 0; page < SESSION_CONTINUATION_SCAN_MAX_PAGES; page += 1) {
		const next = await listTaskStatusesByProvider(input.c.env.DB, {
			provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
			status: input.status,
			userId: input.userId,
			order: "desc",
			limit: SESSION_CONTINUATION_SCAN_PAGE_SIZE,
			...(before ? { before } : {}),
		});
		rows.push(...next);
		if (next.length < SESSION_CONTINUATION_SCAN_PAGE_SIZE) return rows;
		const last = next.at(-1);
		if (!last) return rows;
		before = { createdAt: last.created_at, id: last.id };
	}
	throw new Error(`session_continuation_scan_truncated:${input.userId}:${input.status}`);
}

/**
 * Reclaims the newest failed physical continuation only after the public chat
 * status handshake has proved that the exact durable session has an inactive,
 * incomplete checkpoint. Failed rows are never included in background sweeps.
 */
export async function claimSessionOrphanedPhysicalBudgetContinuation(input: {
	c: AppContext;
	userId: string;
	sessionKey: string;
	rootRequestId?: string;
}): Promise<SessionPhysicalContinuationClaim> {
	const [failedRows, claimedRows] = await Promise.all([
		listTaskStatusesForExactSessionScan({ c: input.c, userId: input.userId, status: "failed" }),
		listTaskStatusesForExactSessionScan({ c: input.c, userId: input.userId, status: "claimed" }),
	]);
	const rows = [
		...failedRows.map((row) => ({ row, lifecycle: "failed" as const })),
		...claimedRows.map((row) => ({ row, lifecycle: "claimed" as const })),
	];
	const claimedStaleBeforeMs = Date.now() - ASYNC_AGENT_CONTINUATION_CLAIM_LEASE_MS;
	let invalidCount = 0;
	const candidates = rows.flatMap(({ row, lifecycle }) => {
		const continuation = parseContinuation(row.data);
		if (!continuation) {
			invalidCount += 1;
			return [];
		}
		if (
			continuation.userId !== input.userId ||
			continuation.sessionKey !== input.sessionKey ||
			(input.rootRequestId !== undefined && continuation.rootRequestId !== input.rootRequestId) ||
			!isRootPhysicalBudgetContinuation(continuation) ||
			(lifecycle === "failed" && continuation.lastFailure === null) ||
			continuation.attempt >= ASYNC_AGENT_CONTINUATION_MAX_ATTEMPTS ||
			(lifecycle === "claimed" && Date.parse(row.updated_at) > claimedStaleBeforeMs)
		) return [];
		return [{ continuation, lifecycle, claimedUpdatedAt: row.updated_at }];
	}).sort((left, right) => {
		// A recovery checkpoint may intentionally restart its physical stage while
		// preserving the same root logical task. The newest durable continuation is
		// therefore authoritative even when an older abandoned branch has a larger
		// stage number. Ranking by stage first can resurrect that stale branch and
		// race the newer recovery for the same session. Stage is only a deterministic
		// tie-breaker for continuations created at the same instant.
		const createdAtDelta = Date.parse(right.continuation.createdAt)
			- Date.parse(left.continuation.createdAt);
		if (createdAtDelta !== 0) return createdAtDelta;
		return right.continuation.stage - left.continuation.stage;
	});
	for (const candidate of candidates) {
		const nowIso = new Date().toISOString();
		const claimedContinuation: AsyncAgentContinuation = {
			...candidate.continuation,
			claimToken: randomUUID(),
		};
		const claimed = candidate.lifecycle === "failed"
			? await tryClaimFailedTaskStatusForExplicitResume(input.c.env.DB, {
				taskId: candidate.continuation.id,
				provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
				claimedData: claimedContinuation,
				nowIso,
			})
			: await tryReclaimClaimedTaskStatusForExplicitResume(input.c.env.DB, {
				taskId: candidate.continuation.id,
				provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
				expectedUpdatedAtIso: candidate.claimedUpdatedAt,
				claimedData: claimedContinuation,
				nowIso,
			});
		if (claimed) {
			return {
				status: "claimed",
				continuation: claimedContinuation,
				waitingCount: rows.length,
				invalidCount,
			};
		}
	}
	return {
		status: "not_ready",
		waitingCount: rows.length,
		invalidCount,
	};
}

/**
 * Claims one server-authored physical-budget continuation for an exact user
 * and durable session. A normal chat message must never impersonate resume:
 * without this persisted contract it would be a new semantic turn and could
 * create another business run. Invalid/legacy rows are counted and ignored;
 * they are never guessed into a current contract.
 */
export async function claimSessionPhysicalBudgetContinuation(input: {
	c: AppContext;
	userId: string;
	sessionKey: string;
	rootRequestId?: string;
}): Promise<SessionPhysicalContinuationClaim> {
	const rows = await listTaskStatusesForExactSessionScan({
		c: input.c,
		userId: input.userId,
		status: "waiting",
	});
	let invalidCount = 0;
	const candidates = rows.flatMap((row) => {
		const continuation = parseContinuation(row.data);
		if (!continuation) {
			invalidCount += 1;
			return [];
		}
		if (
			continuation.userId !== input.userId ||
			continuation.sessionKey !== input.sessionKey ||
			(input.rootRequestId !== undefined && continuation.rootRequestId !== input.rootRequestId) ||
			!isRootPhysicalBudgetContinuation(continuation) ||
			!isAsyncAgentContinuationAttemptDue(continuation.nextAttemptAt)
		) return [];
		return [continuation];
	}).sort((left, right) => {
		if (left.stage !== right.stage) return right.stage - left.stage;
		return Date.parse(right.createdAt) - Date.parse(left.createdAt);
	});
	for (const continuation of candidates) {
		const claimedContinuation = await claimAsyncAgentContinuation(input.c, continuation);
		const claimed = Boolean(claimedContinuation);
		if (claimed) {
			return {
				status: "claimed",
				continuation: claimedContinuation!,
				waitingCount: rows.length,
				invalidCount,
			};
		}
	}
	return {
		status: "not_ready",
		waitingCount: rows.length,
		invalidCount,
	};
}

export async function cancelActiveSessionAgentContinuations(input: {
	c: AppContext;
	userId: string;
	sessionKey: string;
	rootRequestId: string;
	/**
	 * Chat interruption owns only active model work. Dependency continuations
	 * own already-accepted asynchronous effects and must remain available to
	 * reconcile their terminal evidence. Workflow cancellation is the only
	 * caller allowed to terminate both ownership classes.
	 */
	scope: "physical_only" | "all";
}): Promise<number> {
	const [waitingRows, claimedRows] = await Promise.all(["waiting", "claimed"].map((status) =>
		listTaskStatusesForExactSessionScan({ c: input.c, userId: input.userId, status })),
	);
	const candidates = [
		...waitingRows.map((row) => ({ row, status: "waiting" as const })),
		...claimedRows.map((row) => ({ row, status: "claimed" as const })),
	].flatMap(({ row, status }) => {
		const continuation = parseContinuation(row.data);
		return continuation &&
			continuation.userId === input.userId &&
			continuation.sessionKey === input.sessionKey &&
			continuation.rootRequestId === input.rootRequestId &&
			(input.scope === "all" || isRootPhysicalBudgetContinuation(continuation))
			? [{ continuation, status }]
			: [];
	});
	let cancelled = 0;
	for (const candidate of candidates) {
		const continuation = candidate.status === "waiting"
			? await claimAsyncAgentContinuation(input.c, candidate.continuation)
			: candidate.continuation;
		let changed = false;
		if (continuation?.claimToken) {
			changed = (await completeAsyncAgentContinuation({
				c: input.c,
				continuation,
				status: "failed",
			})).terminalized;
		} else {
			// Legacy claimed rows had no physical token. They cannot own a v1 repair
			// lease, so only their task row is eligible for the old cancellation CAS.
			changed = await tryCancelActiveTaskStatus(input.c.env.DB, {
				taskId: candidate.continuation.id,
				provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
				nowIso: new Date().toISOString(),
			});
		}
		if (changed) cancelled += 1;
	}
	return cancelled;
}

export async function claimReadyAsyncAgentContinuations(input: {
	c: AppContext;
	flowId: string;
	projectId: string;
	nodeStates: Map<string, AsyncAgentContinuationNodeState>;
	claimReady?: boolean;
}): Promise<AsyncAgentContinuation[]> {
	const ready: AsyncAgentContinuation[] = [];
	// This event-local accelerator is opportunistic; the global durable sweep is
	// still authoritative. Rotate one full foreign/poison page and inspect the
	// following page so 100 unrelated rows cannot hide the just-materialized flow.
	for (let page = 0; page < 2; page += 1) {
		const rows = await listWaitingTaskStatusesForFairSweep(input.c.env.DB, {
			provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
			limit: 100,
		});
		if (rows.length === 0) break;
		const rotateTaskIds: string[] = [];
		for (const row of rows) {
			const contract = parseContinuation(row.data);
			if (!contract) {
				try {
					await failWaitingTaskStatus(input.c.env.DB, {
						taskId: row.task_id,
						provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
						nowIso: new Date().toISOString(),
					});
				} catch {
					rotateTaskIds.push(row.task_id);
				}
				continue;
			}
			if (
				contract.chapterId ||
				contract.flowId !== input.flowId ||
				contract.projectId !== input.projectId
			) {
				rotateTaskIds.push(row.task_id);
				continue;
			}
			try {
				const outcome = await tryResolveAsyncAgentContinuation(
					input.c,
					contract,
					input.nodeStates,
					{ claimReady: input.claimReady },
				);
				if (outcome === "claimed" || outcome === "ready") ready.push(contract);
				if (outcome === "pending" || outcome === "ready") rotateTaskIds.push(contract.id);
			} catch (error) {
				rotateTaskIds.push(contract.id);
				console.error("[async-agent-continuation] flow-local resolution failed", {
					continuationId: contract.id,
					flowId: contract.flowId,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		await touchWaitingTaskStatuses(input.c.env.DB, {
			taskIds: rotateTaskIds,
			provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
			nowIso: new Date().toISOString(),
		});
		if (rows.length < 100) break;
	}
	return ready;
}

async function resolveWorkflowExecutionFamilyDependency(input: Readonly<{
	c: AppContext;
	contract: AsyncAgentContinuation;
	dependency: AsyncAgentContinuationArtifactDependencyV2;
}>): Promise<Readonly<{
	state: AsyncAgentContinuationNodeState;
	materializedArtifacts: AsyncAgentContinuationMaterializedArtifactV1[];
}>> {
	const runId = input.dependency.runId;
	if (!runId || input.dependency.runProtocol !== "workflow_execution_family") {
		return { state: "failed", materializedArtifacts: [] };
	}
	const family = await getWorkflowExecutionFamilyPageForOwner(input.c.env.DB, {
		ownerId: input.contract.userId,
		executionId: runId,
		limit: 200,
	});
	const expectedCanvasId = input.contract.chapterId
		? `chapter:${input.contract.chapterId}`
		: input.contract.flowId;
	const matchingExecutions = family && expectedCanvasId
		? family.executions.filter((execution) =>
			execution.projectId === input.contract.projectId &&
			(execution.canvasId ?? "") === expectedCanvasId
		)
		: [];
	if (!family || matchingExecutions.length === 0) {
		return { state: "failed", materializedArtifacts: [] };
	}
	if (family.activeExecutionCount > 0) {
		return { state: "pending", materializedArtifacts: [] };
	}
	// The newest physical member is the durable authority for the execution
	// family. A terminal failed/canceled family is not a request for another
	// model window: it is deterministic dependency failure evidence for the
	// already-suspended public task. Treating every inactive family as `ready`
	// previously launched a correction continuation and left the root turn
	// waiting even though the workflow had already failed.
	if (family.latestExecutionStatus !== "success") {
		return { state: "failed", materializedArtifacts: [] };
	}
	const successfulNodeRuns = await listNodeRunsForExecutionOwner(input.c.env.DB, {
		ownerId: input.contract.userId,
		executionId: family.latestExecutionId,
	});
	const materializedArtifacts = collectWorkflowExecutionMaterializedArtifacts({
		dependency: input.dependency,
		nodeRuns: successfulNodeRuns,
	});
	if (
		expectedArtifactMediaType(input.dependency.artifactId) !== null &&
		materializedArtifacts.length === 0
	) {
		return { state: "failed", materializedArtifacts: [] };
	}
	return {
		state: "ready",
		materializedArtifacts,
	};
}

/**
 * Rehydrates terminal workflow delivery evidence when a later physical model
 * window inherits the same dependency frontier. This prevents a successful
 * workflow from degrading back to an acceptance-only receipt between windows.
 */
export async function collectSettledWorkflowExecutionArtifacts(input: Readonly<{
	c: AppContext;
	continuation: AsyncAgentContinuation;
}>): Promise<AsyncAgentContinuationMaterializedArtifactV1[]> {
	const dependencies = (input.continuation.artifactDependencies ?? []).filter(
		(dependency) => dependency.runProtocol === "workflow_execution_family",
	);
	const resolutions = await Promise.all(dependencies.map((dependency) =>
		resolveWorkflowExecutionFamilyDependency({
			c: input.c,
			contract: input.continuation,
			dependency,
		}),
	));
	return resolutions.flatMap((resolution) =>
		resolution.state === "ready" ? resolution.materializedArtifacts : []
	);
}

async function tryResolveAsyncAgentContinuation(
	c: AppContext,
	contract: AsyncAgentContinuation,
	nodeStates: Map<string, AsyncAgentContinuationNodeState>,
	options: { claimReady?: boolean } = {},
): Promise<"ready" | "claimed" | "failed" | "pending"> {
	if (!isAsyncAgentContinuationAttemptDue(contract.nextAttemptAt)) return "pending";
	if (isRootPhysicalBudgetContinuation(contract)) {
		const activeTaskIds = await readActiveAssetRepairTaskIds({ c, continuation: contract });
		if (activeTaskIds.length > 0) return "pending";
		if (options.claimReady === false) return "ready";
		const claimed = await claimAsyncAgentContinuation(c, contract);
		if (claimed) Object.assign(contract, claimed);
		return claimed ? "claimed" : "pending";
	}
	const nowIso = new Date().toISOString();
	const artifactDependencies = contract.artifactDependencies;
	if (!artifactDependencies || artifactDependencies.length === 0) {
		const failure = {
			occurredAt: nowIso,
			code: "dependency_contract_v2_required",
			status: null,
			upstreamStatus: null,
			message: "dependency continuation is missing exact artifact tuples",
			retryable: false,
		} satisfies AsyncAgentContinuationFailureEvidence;
		const claimedContinuation = await claimAsyncAgentContinuation(c, contract);
		if (claimedContinuation) Object.assign(contract, claimedContinuation);
		const claimed = Boolean(claimedContinuation);
		if (!claimed) return "pending";
		const activeTaskIds = await readActiveAssetRepairTaskIds({ c, continuation: contract });
		if (activeTaskIds.length > 0) {
			await transitionClaimedTaskStatus(c.env.DB, {
				taskId: contract.id,
				provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
				userId: contract.userId,
				status: "waiting",
				data: releaseContinuationClaim({ ...contract, lastFailure: failure }),
				claimToken: contract.claimToken,
				completedAt: null,
				nowIso,
			});
			return "pending";
		}
		const terminalized = await terminalizeClaimedContinuationAndRoot({ c, continuation: contract, failure });
		return terminalized.terminalized ? "failed" : "pending";
	}
	const dependencyResolutions = await Promise.all(artifactDependencies.map(async (dependency) => {
		let state: AsyncAgentContinuationNodeState | null = dependency.nodeId
			? nodeStates.get(dependency.nodeId) ?? "missing"
			: null;
		let materializedArtifacts: AsyncAgentContinuationMaterializedArtifactV1[] = [];
		if (dependency.taskId) {
			const task = await getTaskResultByTaskId(c.env.DB, contract.userId, dependency.taskId);
			if (task?.status === "succeeded") {
				materializedArtifacts = collectTaskResultMaterializedArtifacts({
					dependency,
					taskResultJson: task.result,
					taskResultNodeId: task.node_id,
					observedAt: task.completed_at ?? task.updated_at,
				});
			}
			const taskState = readTaskResultDependencyState(task?.status);
			const terminalMediaEvidenceMissing =
				taskState === "ready" &&
				expectedArtifactMediaType(dependency.artifactId) !== null &&
				materializedArtifacts.length === 0;
			state = terminalMediaEvidenceMissing
				? "failed"
				: combineAlternativeDependencyStates(state, taskState);
		}
		if (dependency.runId) {
			let runState: AsyncAgentContinuationNodeState;
			if (dependency.runProtocol === "workflow_execution_family") {
				const resolution = await resolveWorkflowExecutionFamilyDependency({
					c,
					contract,
					dependency,
				});
				runState = resolution.state;
				materializedArtifacts.push(...resolution.materializedArtifacts);
			} else {
				const run = await getVideoRun(dependency.runId);
				if (
					!run ||
					run.owner_id !== contract.userId ||
					run.project_id !== contract.projectId ||
					(run.flow_id ?? "") !== contract.flowId ||
					(run.chapter_id ?? null) !== contract.chapterId
				) {
					runState = "failed";
				} else {
					const agentActionRequired =
						run.authoring_state === "asset_repair_required" ||
						run.authoring_state === "authoring_failed" ||
						run.state === "failed" ||
						run.state === "cancelled";
					const promptOnlyDeliveryReady =
						readVideoRunExecutionScope(run.beat_sheet) === "prompt_only" &&
						run.authoring_state === "authoring_done";
					runState = run.state === "concatenated" || promptOnlyDeliveryReady || agentActionRequired
						? "ready"
						: "pending";
				}
			}
			state = combineAlternativeDependencyStates(state, runState);
		}
		return {
			state: state === "missing" ? "failed" as const : state ?? "failed" as const,
			materializedArtifacts,
		};
	}));
	const dependencyStates = dependencyResolutions.map((resolution) => resolution.state);
	if (dependencyStates.some((state) => state === "failed")) {
		const failedArtifactIds = artifactDependencies
			.filter((_dependency, index) => dependencyStates[index] === "failed")
			.map((dependency) => dependency.artifactId);
		const failure = {
			occurredAt: nowIso,
			code: "dependency_terminal",
			status: null,
			upstreamStatus: null,
			message: `terminal artifact dependencies: ${failedArtifactIds.join(",")}`.slice(0, 500),
			retryable: false,
		} satisfies AsyncAgentContinuationFailureEvidence;
		const claimedContinuation = await claimAsyncAgentContinuation(c, contract);
		if (claimedContinuation) Object.assign(contract, claimedContinuation);
		const claimed = Boolean(claimedContinuation);
		if (!claimed) return "pending";
		const activeTaskIds = await readActiveAssetRepairTaskIds({ c, continuation: contract });
		if (activeTaskIds.length > 0) {
			await transitionClaimedTaskStatus(c.env.DB, {
				taskId: contract.id,
				provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
				userId: contract.userId,
				status: "waiting",
				data: releaseContinuationClaim({ ...contract, lastFailure: failure }),
				claimToken: contract.claimToken,
				completedAt: null,
				nowIso,
			});
			return "pending";
		}
		const terminalized = await terminalizeClaimedContinuationAndRoot({ c, continuation: contract, failure });
		return terminalized.terminalized ? "failed" : "pending";
	}
	if (dependencyStates.some((state) => state !== "ready")) return "pending";
	const materializedArtifacts = dependencyResolutions.flatMap((resolution) => resolution.materializedArtifacts);
	if (materializedArtifacts.length > 0) {
		contract.materializedArtifacts = materializedArtifacts;
	}
	if (options.claimReady === false) return "ready";
	const claimed = await claimAsyncAgentContinuation(c, contract);
	if (claimed) Object.assign(contract, claimed);
	return claimed ? "claimed" : "pending";
}

/**
 * Queue consumers never trust the serialized job as execution authority. An
 * ordinary discovery job must still find the row waiting and revalidate the
 * current canvas before minting a claim. An explicitly resumed claimed job is
 * accepted only when the authoritative row carries the exact same token.
 */
export async function claimQueuedAsyncAgentContinuation(input: {
	c: AppContext;
	expected: AsyncAgentContinuation;
}): Promise<AsyncAgentContinuation | null> {
	const row = await getTaskStatusByIdentity(input.c.env.DB, {
		taskId: input.expected.id,
		provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
	});
	if (!row) return null;
	const contract = parseContinuation(row.data);
	if (
		!contract ||
		contract.id !== input.expected.id ||
		contract.progressFingerprint !== input.expected.progressFingerprint
	) return null;
	if (input.expected.claimToken) {
		return row.status === "claimed" && contract.claimToken === input.expected.claimToken
			? contract
			: null;
	}
	if (row.status !== "waiting") return null;

	let nodeStates = new Map<string, AsyncAgentContinuationNodeState>();
	if (!isRootPhysicalBudgetContinuation(contract)) {
		let graph: unknown;
		if (contract.chapterId) {
			const chapterScope = await input.c.env.DB.chapters.findFirst({
				where: { id: contract.chapterId, project_id: contract.projectId },
				select: { id: true },
			});
			if (!chapterScope) {
				await failAsyncAgentContinuation(input.c, contract);
				return null;
			}
			const chapterFlow = await loadChapterCanvasAsFlowRow(
				input.c,
				contract.userId,
				contract.chapterId,
				contract.projectId,
			);
			graph = mapFlowRowToDto(chapterFlow).data;
		} else {
			const flow = await getFlowByIdUnsafe(input.c.env.DB, contract.flowId);
			if (!flow || flow.project_id !== contract.projectId) {
				await failAsyncAgentContinuation(input.c, contract);
				return null;
			}
			graph = mapFlowRowToDto(flow).data;
		}
		const nodes = isRecord(graph) ? graph.nodes : null;
		nodeStates = buildAsyncAgentContinuationNodeStates(nodes);
	}
	const outcome = await tryResolveAsyncAgentContinuation(input.c, contract, nodeStates);
	return outcome === "claimed" ? contract : null;
}

/**
 * Periodic durable recovery for continuations whose dependencies were written
 * by a browser patch, another worker, or a prior process before it restarted.
 * It starts from waiting contracts rather than from an in-memory callback.
 */
export async function claimReadyAsyncAgentContinuationsAcrossFlows(input: {
	c: AppContext;
	limit?: number;
	claimReady?: boolean;
}): Promise<AsyncAgentContinuationSweepResult> {
	const nowMs = Date.now();
	const recoveredClaims = await requeueStaleClaimedTaskStatuses(input.c.env.DB, {
		provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
		staleBeforeIso: new Date(
			nowMs - ASYNC_AGENT_CONTINUATION_CLAIM_LEASE_MS,
		).toISOString(),
		nowIso: new Date(nowMs).toISOString(),
	});
	const rows = await listWaitingTaskStatusesForFairSweep(input.c.env.DB, {
		provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
		limit: input.limit ?? 100,
	});
	const continuations: AsyncAgentContinuation[] = [];
	const flowCache = new Map<string, Awaited<ReturnType<typeof getFlowByIdUnsafe>>>();
	const chapterCache = new Map<string, Awaited<ReturnType<typeof loadChapterCanvasAsFlowRow>>>();
	const claimed: AsyncAgentContinuation[] = [];
	const ready: AsyncAgentContinuation[] = [];
	const errors: AsyncAgentContinuationSweepResult["errors"] = [];
	let failed = 0;
	for (const row of rows) {
		const continuation = parseContinuation(row.data);
		if (continuation) {
			continuations.push(continuation);
			continue;
		}
		const message = "persisted async continuation contract is malformed";
		try {
			const terminalized = await failWaitingTaskStatus(input.c.env.DB, {
				taskId: row.task_id,
				provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
				nowIso: new Date(nowMs).toISOString(),
			});
			if (terminalized) failed += 1;
			errors.push({ continuationId: row.task_id, message });
			console.error("[async-agent-continuation] malformed durable contract", {
				continuationId: row.task_id,
				terminalized,
			});
		} catch (error) {
			const terminalizeError = error instanceof Error ? error.message : String(error);
			try {
				await touchWaitingTaskStatus(input.c.env.DB, {
					taskId: row.task_id,
					provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
					nowIso: new Date().toISOString(),
				});
			} catch {
				// Preserve both failures below; a later sweep can retry the bounded row.
			}
			errors.push({ continuationId: row.task_id, message: terminalizeError });
			console.error("[async-agent-continuation] malformed contract terminalization failed", {
				continuationId: row.task_id,
				error: terminalizeError,
			});
		}
	}
	for (const contract of continuations) {
		try {
			if (isRootPhysicalBudgetContinuation(contract)) {
				const outcome = await tryResolveAsyncAgentContinuation(
					input.c,
					contract,
					new Map<string, AsyncAgentContinuationNodeState>(),
					{ claimReady: input.claimReady },
				);
				if (outcome === "claimed") claimed.push(contract);
				if (outcome === "ready") ready.push(contract);
				if (outcome === "failed") failed += 1;
				if (outcome === "pending" || outcome === "ready") {
					await touchWaitingTaskStatus(input.c.env.DB, {
						taskId: contract.id,
						provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
						nowIso: new Date().toISOString(),
					});
				}
				continue;
			}
			let graph: unknown;
			if (contract.chapterId) {
				const chapterScope = await input.c.env.DB.chapters.findFirst({
					where: { id: contract.chapterId, project_id: contract.projectId },
					select: { id: true },
				});
				if (!chapterScope) {
					await failAsyncAgentContinuation(input.c, contract);
					failed += 1;
					continue;
				}
				const cacheKey = `${contract.userId}:${contract.chapterId}`;
				let chapterFlow = chapterCache.get(cacheKey);
				if (!chapterFlow) {
					chapterFlow = await loadChapterCanvasAsFlowRow(
						input.c,
						contract.userId,
						contract.chapterId,
						contract.projectId,
					);
					chapterCache.set(cacheKey, chapterFlow);
				}
				graph = mapFlowRowToDto(chapterFlow).data;
			} else {
				let flow = flowCache.get(contract.flowId);
				if (typeof flow === "undefined") {
					flow = await getFlowByIdUnsafe(input.c.env.DB, contract.flowId);
					flowCache.set(contract.flowId, flow);
				}
				if (!flow || flow.project_id !== contract.projectId) {
					await failAsyncAgentContinuation(input.c, contract);
					failed += 1;
					continue;
				}
				graph = mapFlowRowToDto(flow).data;
			}
			const nodes = isRecord(graph) ? graph.nodes : null;
			const outcome = await tryResolveAsyncAgentContinuation(
				input.c,
				contract,
				buildAsyncAgentContinuationNodeStates(nodes),
				{ claimReady: input.claimReady },
			);
			if (outcome === "claimed") claimed.push(contract);
			if (outcome === "ready") ready.push(contract);
			if (outcome === "failed") failed += 1;
			if (outcome === "pending" || outcome === "ready") {
				await touchWaitingTaskStatus(input.c.env.DB, {
					taskId: contract.id,
					provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
					nowIso: new Date().toISOString(),
				});
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			try {
				await touchWaitingTaskStatus(input.c.env.DB, {
					taskId: contract.id,
					provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
					nowIso: new Date().toISOString(),
				});
			} catch (touchError) {
				errors.push({
					continuationId: contract.id,
					message: `fair_sweep_touch_failed:${touchError instanceof Error ? touchError.message : String(touchError)}`,
				});
			}
			errors.push({ continuationId: contract.id, message });
			console.error("[async-agent-continuation] durable sweep failed", {
				continuationId: contract.id,
				projectId: contract.projectId,
				flowId: contract.flowId,
				chapterId: contract.chapterId,
				error: message,
			});
		}
	}
	return {
		scanned: rows.length,
		recoveredClaims,
		ready: ready.length,
		claimed: claimed.length,
		failed,
		continuations: [...claimed, ...ready],
		errors,
	};
}

async function failAsyncAgentContinuation(
	c: AppContext,
	continuation: AsyncAgentContinuation,
): Promise<boolean> {
	const nowIso = new Date().toISOString();
	const claimed = await claimAsyncAgentContinuation(c, continuation);
	if (!claimed) return false;
	const failure = {
		occurredAt: nowIso,
		code: "continuation_scope_missing",
		status: null,
		upstreamStatus: null,
		message: "persisted continuation project, flow, or chapter scope no longer exists",
		retryable: false,
	} satisfies AsyncAgentContinuationFailureEvidence;
	const activeTaskIds = await readActiveAssetRepairTaskIds({ c, continuation: claimed });
	if (activeTaskIds.length > 0) {
		return transitionClaimedTaskStatus(c.env.DB, {
			taskId: claimed.id,
			provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
			userId: claimed.userId,
			status: "waiting",
			data: releaseContinuationClaim({ ...claimed, lastFailure: failure }),
			claimToken: claimed.claimToken,
			completedAt: null,
			nowIso,
		});
	}
	const terminalized = await terminalizeClaimedContinuationAndRoot({
		c,
		continuation: claimed,
		failure,
	});
	return terminalized.terminalized;
}

export async function completeAsyncAgentContinuation(input: {
	c: AppContext;
	continuation: AsyncAgentContinuation;
	status: "completed" | "failed";
}): Promise<{ terminalized: boolean; deferred: boolean; status: "completed" | "failed" }> {
	const nowIso = new Date().toISOString();
	const claimToken = input.continuation.claimToken?.trim() ?? "";
	if (!claimToken) return { terminalized: false, deferred: false, status: input.status };
	const activeTaskIds = await readActiveAssetRepairTaskIds({
		c: input.c,
		continuation: input.continuation,
	});
	if (activeTaskIds.length > 0) {
		const waitingContinuation = releaseContinuationClaim({
			...input.continuation,
			nextAttemptAt: new Date(Date.parse(nowIso) + 60_000).toISOString(),
			lastFailure: {
				occurredAt: nowIso,
				code: "accepted_task_still_active",
				status: null,
				upstreamStatus: null,
				message: `accepted tasks still active: ${activeTaskIds.join(",")}`.slice(0, 500),
				retryable: true,
			},
		});
		const deferred = await transitionClaimedTaskStatus(input.c.env.DB, {
			taskId: input.continuation.id,
			provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
			userId: input.continuation.userId,
			status: "waiting",
			data: waitingContinuation,
			claimToken,
			completedAt: null,
			nowIso,
		});
		return { terminalized: false, deferred, status: input.status };
	}
	if (input.status === "failed") {
		await projectAsyncContinuationFailureToRootTurn({
			c: input.c,
			continuation: input.continuation,
		});
	}
	const settlement = await settleClaimedAssetRepairContinuation({
		continuationId: input.continuation.id,
		continuationProvider: ASYNC_AGENT_CONTINUATION_PROVIDER,
		continuationUserId: input.continuation.userId,
		continuationClaimToken: claimToken,
		continuationData: input.continuation,
		requestedStatus: input.status,
		runs: (input.continuation.ownedRepairRuns ?? []).map((run) => ({
			runId: run.runId,
			repairGeneration: run.repairGeneration,
			ownerId: input.continuation.userId,
			projectId: input.continuation.projectId,
			flowId: input.continuation.flowId,
			chapterId: input.continuation.chapterId,
		})),
		errorMessage: [
			"asset_repair_executor_terminal",
			`continuation=${compactFailureIdentity(input.continuation.id)}`,
			`failure=${input.status === "failed" ? "bridge_terminal_failed" : "delivery_unsatisfied"}`,
		].join(":"),
		nowIso,
	});
	return { terminalized: settlement.terminalized, deferred: false, status: settlement.status };
}

export async function deferOrFailAsyncAgentContinuation(input: {
	c: AppContext;
	continuation: AsyncAgentContinuation;
	error: unknown;
}): Promise<AsyncAgentContinuationRetryPlan> {
	const plan = planAsyncAgentContinuationRetry({
		error: input.error,
		currentAttempt: input.continuation.attempt,
	});
	const nextContinuation: AsyncAgentContinuation = {
		...input.continuation,
		attempt: plan.attempt,
		nextAttemptAt: plan.nextAttemptAt,
		lastFailure: plan.failure,
	};
	const waitingContinuation = releaseContinuationClaim(nextContinuation);
	const nowIso = plan.failure.occurredAt;
	if (!plan.shouldRetry) {
		const activeTaskIds = await readActiveAssetRepairTaskIds({
			c: input.c,
			continuation: nextContinuation,
		});
		if (activeTaskIds.length > 0) {
			const acceptedTaskProbeAt = new Date(Date.parse(nowIso) + 60_000).toISOString();
			const deferred = await transitionClaimedTaskStatus(input.c.env.DB, {
				taskId: input.continuation.id,
				provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
				userId: input.continuation.userId,
				status: "waiting",
				data: { ...waitingContinuation, nextAttemptAt: acceptedTaskProbeAt },
				claimToken: input.continuation.claimToken,
				completedAt: null,
				nowIso,
			});
			return {
				...plan,
				shouldRetry: deferred,
				nextAttemptAt: acceptedTaskProbeAt,
			};
		}
		// Continuation failure and run settlement commit in one DB transaction.
		// A cancellation/competing owner that already changed the claimed row wins
		// the fence before any WAITING_EXTERNAL run can be modified.
		const settlement = await terminalizeClaimedContinuationAndRoot({
			c: input.c,
			continuation: nextContinuation,
			failure: plan.failure,
		});
		if (settlement.settledRunIds.length > 0) {
			console.warn("[async-agent-continuation] terminal asset repair executor settled", {
				continuationId: input.continuation.id,
				failureCode: plan.failure.code,
				runIds: settlement.settledRunIds,
			});
		}
		return settlement.terminalized
			? plan
			: { ...plan, shouldRetry: false, nextAttemptAt: null };
	}
	const transitioned = await transitionClaimedTaskStatus(input.c.env.DB, {
		taskId: input.continuation.id,
		provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
		userId: input.continuation.userId,
		status: "waiting",
		data: waitingContinuation,
		claimToken: input.continuation.claimToken,
		completedAt: null,
		nowIso,
	});
	return transitioned ? plan : { ...plan, shouldRetry: false, nextAttemptAt: null };
}
