import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import {
	maybeStartAgentsBridgeOnDemand,
	readAgentsBridgeBaseUrl,
	readAgentsBridgeToken,
	resolveEffectiveUserId,
	type DurableProgressClaimV1,
	type DurableTaskReferenceV1,
} from "./task.agents-bridge";
import { parseDurableProgressCursor } from "./durable-progress-cursor";
import { buildAgentsBridgeSessionAffinityHeader } from "./agents-bridge-session-affinity";
import {
	parseAgentExecutionProvenance,
	type AgentExecutionProvenance,
} from "./agent-execution-provenance";
import type {
	AgentAttentionProjectionV1,
	AgentLogicalTaskStateV1,
} from "@tapcanvas/agent-observability";
import type { PublicChatVideoProductionStartStatus } from "./public-chat-video-production-deadline";

export type AgentsChatTurnPublicState =
	| "running"
	| "needs_input"
	| "suspended"
	| "succeeded"
	| "cancelled"
	| "failed"
	| "unknown";

export type AgentsChatTurnPhase =
	| "accepted"
	| "agent_running"
	| "completion_verifying"
	| "waiting_for_input"
	| "suspended"
	| "succeeded"
	| "failed";

export type AgentsChatTurnStatusEvent = {
	type: string;
	at: string;
	toolName: string | null;
	toolStatus: string | null;
};

export type AgentsChatAttentionProjection = AgentAttentionProjectionV1;

export type AgentsChatPhysicalBudgetSuspension = {
	reasonCode: "root_physical_execution_budget_exhausted";
	physicalRunId: string;
	progressRevision: number;
	progressSinceRunStart: number;
	budgetKind: "turns" | "tool_calls" | "tokens" | "wall_time";
	observed: number;
	limit: number;
};

export type AgentsChatTurnRecoveryCheckpoint = {
	reasonCode: string;
	physicalRunId: string;
	progressRevision: number;
	durableTaskReferences: DurableTaskReferenceV1[];
	durableProgressClaims: DurableProgressClaimV1[];
	userIntentContract: Record<string, unknown> | null;
};

export type AgentsChatPendingUserInput = {
	status: "needs_input";
	requestId: string;
	questions: Array<{
		id: string;
		header: string;
		question: string;
		options: Array<{ label: string; description?: string; imageUrl?: string; thumbnailUrl?: string }>;
	}>;
};

export type AgentsChatDurableTerminalDelivery = {
	version: 1;
	requestTerminal: {
		version: 1;
		terminal: true;
		status: "succeeded";
		reason: string;
	};
	expectedDelivery: Record<string, unknown> & {
		version: 2;
		contractHash: string;
	};
	deliveryEvidence: Array<Record<string, unknown> & {
		evidenceId: string;
		kind: "final_response" | "tool_call" | "artifact" | "persisted_state" | "source";
		sourceRef: string;
	}>;
	deliveryVerification: Record<string, unknown> & {
		version: 2;
		contractHash: string;
		status: "satisfied";
		verifiedAt: string;
	};
};

export type AgentsChatTurnStatusSnapshot = {
	sessionId: string;
	durable: true;
	activeTurn: boolean;
	turn: {
		turnId: string;
		internalTurnId: string;
		state: AgentsChatTurnPublicState;
		logicalTaskState: AgentLogicalTaskStateV1;
		phase: AgentsChatTurnPhase;
		startedAt: string;
		updatedAt: string;
		lastConfirmedAt: string;
		requestText: string;
		terminalAuthority: "user_delivery" | "workflow_action";
		reasonCode: string | null;
		userIntentContract: Record<string, unknown> | null;
		suspension: AgentsChatPhysicalBudgetSuspension | null;
		recoveryCheckpoint: AgentsChatTurnRecoveryCheckpoint | null;
		lastConfirmedSummary: string;
		finalResponse: string | null;
		terminalDelivery: AgentsChatDurableTerminalDelivery | null;
		executionProvenanceHistory?: AgentExecutionProvenance[];
		attentionProjection?: AgentsChatAttentionProjection | null;
		pendingUserInput?: AgentsChatPendingUserInput | null;
		pendingQueueCount: number;
		recentEvents: AgentsChatTurnStatusEvent[];
		videoProductionStart?: PublicChatVideoProductionStartStatus | null;
	} | null;
};

export type AgentsChatTurnInterruptReceipt = {
	ok: true;
	interrupted: boolean;
	sessionId: string;
	turnId: string | null;
	status: AgentsChatTurnStatusSnapshot | null;
};

export type AgentsChatRuntimeRequestOptions = Readonly<{
	/**
	 * Caller-owned wall-clock budget for the runtime fetch and response body
	 * decoding. There is deliberately no implicit default.
	 */
	timeoutMs: number;
	signal?: AbortSignal;
}>;

const RUNTIME_OUTCOME_UNKNOWN_CODES = new Set([
	"agents_chat_runtime_timeout",
	"agents_chat_runtime_request_aborted",
	"agents_chat_runtime_transport_unknown",
]);

export function isAgentsChatRuntimeOutcomeUnknown(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const code = "code" in error ? error.code : null;
	return typeof code === "string" && RUNTIME_OUTCOME_UNKNOWN_CODES.has(code);
}

const PUBLIC_STATES = new Set<AgentsChatTurnPublicState>([
	"running",
	"needs_input",
	"suspended",
	"succeeded",
	"cancelled",
	"failed",
	"unknown",
]);

const TURN_PHASES = new Set<AgentsChatTurnPhase>([
	"accepted",
	"agent_running",
	"completion_verifying",
	"waiting_for_input",
	"suspended",
	"succeeded",
	"failed",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function requiredString(record: Record<string, unknown>, key: string): string {
	const value = typeof record[key] === "string" ? record[key].trim() : "";
	if (!value) throw new Error(`missing ${key}`);
	return value;
}

function nullableString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

const DELIVERY_EVIDENCE_KINDS = new Set<AgentsChatDurableTerminalDelivery["deliveryEvidence"][number]["kind"]>([
	"final_response",
	"tool_call",
	"artifact",
	"persisted_state",
	"source",
]);

function parseDurableTerminalDelivery(value: unknown): AgentsChatDurableTerminalDelivery | null {
	const source = asRecord(value);
	const requestTerminal = asRecord(source?.requestTerminal);
	const expectedDelivery = asRecord(source?.expectedDelivery);
	const deliveryVerification = asRecord(source?.deliveryVerification);
	if (
		!source || source.version !== 1 ||
		!requestTerminal || requestTerminal.version !== 1 || requestTerminal.terminal !== true ||
		requestTerminal.status !== "succeeded" ||
		!expectedDelivery || expectedDelivery.version !== 2 ||
		!deliveryVerification || deliveryVerification.version !== 2 ||
		deliveryVerification.status !== "satisfied" ||
		!Array.isArray(source.deliveryEvidence) || source.deliveryEvidence.length === 0
	) return null;
	const contractHash = nullableString(expectedDelivery.contractHash);
	const verifiedContractHash = nullableString(deliveryVerification.contractHash);
	const reason = nullableString(requestTerminal.reason);
	const verifiedAt = nullableString(deliveryVerification.verifiedAt);
	if (!contractHash || contractHash !== verifiedContractHash || !reason || !verifiedAt) return null;
	const deliveryEvidence = source.deliveryEvidence.flatMap((item) => {
		const evidence = asRecord(item);
		const kind = nullableString(evidence?.kind) as AgentsChatDurableTerminalDelivery["deliveryEvidence"][number]["kind"] | null;
		if (!evidence || !kind || !DELIVERY_EVIDENCE_KINDS.has(kind)) return [];
		const evidenceId = nullableString(evidence.evidenceId);
		const sourceRef = nullableString(evidence.sourceRef);
		if (!evidenceId || !sourceRef) return [];
		return [{ ...evidence, evidenceId, kind, sourceRef }];
	});
	if (deliveryEvidence.length !== source.deliveryEvidence.length) return null;
	return {
		version: 1,
		requestTerminal: { version: 1, terminal: true, status: "succeeded", reason },
		expectedDelivery: { ...expectedDelivery, version: 2, contractHash },
		deliveryEvidence,
		deliveryVerification: {
			...deliveryVerification,
			version: 2,
			contractHash: verifiedContractHash,
			status: "satisfied",
			verifiedAt,
		},
	};
}

const PHYSICAL_BUDGET_KINDS = new Set<AgentsChatPhysicalBudgetSuspension["budgetKind"]>([
	"turns",
	"tool_calls",
	"tokens",
	"wall_time",
]);

function nonNegativeInteger(record: Record<string, unknown>, key: string): number {
	const value = record[key];
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throw new Error(`invalid ${key}`);
	}
	return value;
}

const LOGICAL_TASK_STATUSES = new Set<AgentLogicalTaskStateV1["status"]>([
	"active",
	"waiting_input",
	"waiting_external",
	"succeeded",
	"failed",
	"cancelled",
]);

const PHYSICAL_RUN_STATUSES = new Set<AgentLogicalTaskStateV1["physicalRunStatus"]>([
	"running",
	"completed",
	"handed_off",
	"interrupted",
]);

const DELIVERY_STATUSES = new Set<AgentLogicalTaskStateV1["deliveryStatus"]>([
	"pending",
	"satisfied",
	"unsatisfied",
]);

function projectPublicTurnState(
	status: AgentLogicalTaskStateV1["status"],
): AgentsChatTurnPublicState {
	if (status === "active") return "running";
	if (status === "waiting_input") return "needs_input";
	if (status === "waiting_external") return "suspended";
	return status;
}

function parseLogicalTaskState(value: unknown): AgentLogicalTaskStateV1 {
	const source = asRecord(value);
	if (!source || source.version !== 1) throw new Error("logicalTaskState is invalid");
	const status = requiredString(source, "status") as AgentLogicalTaskStateV1["status"];
	const physicalRunStatus = requiredString(
		source,
		"physicalRunStatus",
	) as AgentLogicalTaskStateV1["physicalRunStatus"];
	const deliveryStatus = requiredString(source, "deliveryStatus") as AgentLogicalTaskStateV1["deliveryStatus"];
	if (!LOGICAL_TASK_STATUSES.has(status)) throw new Error("logicalTaskState status is invalid");
	if (!PHYSICAL_RUN_STATUSES.has(physicalRunStatus)) throw new Error("logicalTaskState physicalRunStatus is invalid");
	if (!DELIVERY_STATUSES.has(deliveryStatus)) throw new Error("logicalTaskState deliveryStatus is invalid");
	if (source.continuationTicket !== null) {
		throw new Error("status logicalTaskState cannot expose an unparsed continuation ticket");
	}
	return {
		version: 1,
		logicalTaskId: requiredString(source, "logicalTaskId"),
		status,
		reasonCode: requiredString(source, "reasonCode"),
		physicalRunStatus,
		deliveryStatus,
		taskNodeId: requiredString(source, "taskNodeId"),
		taskRevision: nonNegativeInteger(source, "taskRevision"),
		updatedAt: requiredString(source, "updatedAt"),
		continuationTicket: null,
	};
}

function parsePhysicalBudgetSuspension(value: unknown): AgentsChatPhysicalBudgetSuspension | null {
	if (value === null || typeof value === "undefined") return null;
	const source = asRecord(value);
	if (!source || source.reasonCode !== "root_physical_execution_budget_exhausted") {
		throw new Error("invalid physical budget suspension");
	}
	const budgetKind = requiredString(source, "budgetKind") as AgentsChatPhysicalBudgetSuspension["budgetKind"];
	if (!PHYSICAL_BUDGET_KINDS.has(budgetKind)) throw new Error("invalid budgetKind");
	return {
		reasonCode: "root_physical_execution_budget_exhausted",
		physicalRunId: requiredString(source, "physicalRunId"),
		progressRevision: nonNegativeInteger(source, "progressRevision"),
		progressSinceRunStart: nonNegativeInteger(source, "progressSinceRunStart"),
		budgetKind,
		observed: nonNegativeInteger(source, "observed"),
		limit: nonNegativeInteger(source, "limit"),
	};
}

function parsePendingUserInput(value: unknown): AgentsChatPendingUserInput | null {
	if (value === null || typeof value === "undefined") return null;
	const source = asRecord(value);
	if (!source || source.status !== "needs_input") throw new Error("invalid pendingUserInput");
	const requestId = requiredString(source, "requestId");
	if (!Array.isArray(source.questions)) throw new Error("invalid pendingUserInput questions");
	const questions = source.questions.map((item) => {
		const question = asRecord(item);
		if (!question) throw new Error("invalid pendingUserInput question");
		if (!Array.isArray(question.options)) throw new Error("invalid pendingUserInput options");
		return {
			id: requiredString(question, "id"),
			header: requiredString(question, "header"),
			question: requiredString(question, "question"),
			options: question.options.map((item) => {
				const option = asRecord(item);
				if (!option) throw new Error("invalid pendingUserInput option");
				return {
					label: requiredString(option, "label"),
					...(nullableString(option.description) ? { description: nullableString(option.description)! } : {}),
					...(nullableString(option.imageUrl) ? { imageUrl: nullableString(option.imageUrl)! } : {}),
					...(nullableString(option.thumbnailUrl) ? { thumbnailUrl: nullableString(option.thumbnailUrl)! } : {}),
				};
			}),
		};
	});
	return { status: "needs_input", requestId, questions };
}

function parseRecentEvents(value: unknown): AgentsChatTurnStatusEvent[] {
	if (!Array.isArray(value)) throw new Error("recentEvents must be an array");
	return value.map((item) => {
		const event = asRecord(item);
		if (!event) throw new Error("recentEvents item must be an object");
		return {
			type: requiredString(event, "type"),
			at: requiredString(event, "at"),
			toolName: nullableString(event.toolName),
			toolStatus: nullableString(event.toolStatus),
		};
	});
}

function parseExecutionProvenanceHistory(value: unknown): AgentExecutionProvenance[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error("executionProvenanceHistory must be an array");
	return value.map((item) => {
		const provenance = parseAgentExecutionProvenance(item);
		if (!provenance) throw new Error("executionProvenanceHistory item is invalid");
		return provenance;
	});
}

function parseAttentionProjection(value: unknown): AgentsChatAttentionProjection | null {
	if (value === null || value === undefined) return null;
	const source = asRecord(value);
	if (!source || source.version !== 1) throw new Error("attentionProjection is invalid");
	const status = source.status;
	if (status !== "run_now" && status !== "wait" && status !== "user_action_required" && status !== "repair" && status !== "replan" && status !== "terminal") {
		throw new Error("attentionProjection status is invalid");
	}
	const sourceHeads = asRecord(source.sourceHeads);
	if (!sourceHeads) throw new Error("attentionProjection sourceHeads is invalid");
	const readRevision = (candidate: unknown): number | null => {
		if (candidate === null) return null;
		if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate < 0) {
			throw new Error("attentionProjection revision is invalid");
		}
		return candidate;
	};
	return {
		version: 1,
		logicalTaskId: requiredString(source, "logicalTaskId"),
		status,
		waitingOn: nullableString(source.waitingOn),
		obligation: requiredString(source, "obligation"),
		sourceHeads: {
			graphRevision: readRevision(sourceHeads.graphRevision),
			evidenceRevision: readRevision(sourceHeads.evidenceRevision),
			physicalRunId: nullableString(sourceHeads.physicalRunId),
		},
	};
}

function parseRecoveryCheckpoint(value: unknown): AgentsChatTurnRecoveryCheckpoint | null {
	if (value === null || value === undefined) return null;
	const checkpoint = asRecord(value);
	if (!checkpoint || !Array.isArray(checkpoint.durableTaskReferences)) {
		throw new Error("recoveryCheckpoint is invalid");
	}
	const reasonCode = requiredString(checkpoint, "reasonCode");
	const physicalRunId = requiredString(checkpoint, "physicalRunId");
	const progressRevision = nonNegativeInteger(checkpoint, "progressRevision");
	const durableTaskReferences = checkpoint.durableTaskReferences.map((item) => {
		const reference = asRecord(item);
		if (!reference || reference.version !== 1) throw new Error("durableTaskReference is invalid");
		const toolName = requiredString(reference, "toolName");
		const clipIndex = reference.clipIndex === null
			? null
			: typeof reference.clipIndex === "number"
				&& Number.isInteger(reference.clipIndex)
				&& reference.clipIndex >= 0
				? reference.clipIndex
				: null;
		if (reference.clipIndex !== null && clipIndex === null) {
			throw new Error("durableTaskReference clipIndex is invalid");
		}
		const progressCursor = parseDurableProgressCursor(reference.progressCursor);
		if (reference.progressCursor !== undefined && !progressCursor) {
			throw new Error("durableTaskReference progressCursor is invalid");
		}
		return {
			version: 1 as const,
			toolName,
			mode: nullableString(reference.mode),
			runId: nullableString(reference.runId),
			taskId: nullableString(reference.taskId),
			draftRevision: nullableString(reference.draftRevision),
			beatRevision: nullableString(reference.beatRevision),
			preflightRevision: nullableString(reference.preflightRevision),
			preflightFingerprint: nullableString(reference.preflightFingerprint),
			clipIndex,
			...(progressCursor ? { progressCursor } : {}),
			acceptedAsync: reference.acceptedAsync === true,
		};
	}).slice(-32);
	if (!Array.isArray(checkpoint.durableProgressClaims)) {
		throw new Error("recoveryCheckpoint durableProgressClaims is invalid");
	}
	const durableProgressClaims = checkpoint.durableProgressClaims.map((item) => {
		const claim = asRecord(item);
		if (!claim) throw new Error("durableProgressClaim is invalid");
		const kind: DurableProgressClaimV1["kind"] | null =
			claim.kind === "durable_action" || claim.kind === "delivery" || claim.kind === "task_state"
			? claim.kind
			: null;
		const revision = nonNegativeInteger(claim, "revision");
		if (!kind || revision === 0) throw new Error("durableProgressClaim kind/revision is invalid");
		return {
			key: requiredString(claim, "key"),
			fingerprint: requiredString(claim, "fingerprint"),
			kind,
			toolName: requiredString(claim, "toolName"),
			toolCallId: requiredString(claim, "toolCallId"),
			observedAt: requiredString(claim, "observedAt"),
			revision,
		};
	}).slice(-12);
	const userIntentContract = checkpoint.userIntentContract === null
		? null
		: asRecord(checkpoint.userIntentContract);
	if (checkpoint.userIntentContract !== null && !userIntentContract) {
		throw new Error("recoveryCheckpoint userIntentContract is invalid");
	}
	return {
		reasonCode,
		physicalRunId,
		progressRevision,
		durableTaskReferences,
		durableProgressClaims,
		userIntentContract,
	};
}

export function parseAgentsChatTurnStatusSnapshot(
	payload: unknown,
	expectedSessionId: string,
): AgentsChatTurnStatusSnapshot {
	try {
		const root = asRecord(payload);
		if (!root || root.durable !== true || typeof root.activeTurn !== "boolean") {
			throw new Error("missing durable status fields");
		}
		const sessionId = requiredString(root, "sessionId");
		if (sessionId !== expectedSessionId) throw new Error("sessionId mismatch");
		if (root.turn === null) {
			if (root.activeTurn) throw new Error("activeTurn cannot be true without turn");
			return { sessionId, durable: true, activeTurn: false, turn: null };
		}
		const turn = asRecord(root.turn);
		if (!turn) throw new Error("turn must be an object or null");
		const receivedState = requiredString(turn, "state") as AgentsChatTurnPublicState;
		const logicalTaskState = parseLogicalTaskState(turn.logicalTaskState);
		const receivedPhase = requiredString(turn, "phase") as AgentsChatTurnPhase;
		if (!PUBLIC_STATES.has(receivedState)) throw new Error("invalid turn state");
		if (!TURN_PHASES.has(receivedPhase)) throw new Error("invalid turn phase");
		const terminalAuthority = turn.terminalAuthority === undefined || turn.terminalAuthority === null
			? "user_delivery"
			: turn.terminalAuthority === "user_delivery" || turn.terminalAuthority === "workflow_action"
				? turn.terminalAuthority
				: null;
		if (!terminalAuthority) throw new Error("invalid terminal authority");
		const terminalDelivery = parseDurableTerminalDelivery(turn.terminalDelivery);
		const state = projectPublicTurnState(logicalTaskState.status);
		const phase = receivedPhase;
		const pendingQueueCount = turn.pendingQueueCount;
		if (
			typeof pendingQueueCount !== "number"
			|| !Number.isInteger(pendingQueueCount)
			|| pendingQueueCount < 0
		) {
			throw new Error("invalid pendingQueueCount");
		}
		if (logicalTaskState.logicalTaskId !== requiredString(turn, "turnId")) {
			throw new Error("logicalTaskState logicalTaskId mismatch");
		}
		if (root.activeTurn !== (logicalTaskState.physicalRunStatus === "running")) {
			throw new Error("activeTurn and logicalTaskState physicalRunStatus mismatch");
		}
		const reasonCode = logicalTaskState.reasonCode;
		const suspension = parsePhysicalBudgetSuspension(turn.suspension);
		const parsedRecoveryCheckpoint = parseRecoveryCheckpoint(turn.recoveryCheckpoint);
		// Recovery checkpoints are actionable only after the physical runtime is
		// inactive. A resumed live run may briefly retain its previous checkpoint
		// as historical evidence during rolling recovery; normalize it away here.
		const recoveryCheckpoint = root.activeTurn && state === "running"
			? null
			: parsedRecoveryCheckpoint;
		const executionProvenanceHistory = parseExecutionProvenanceHistory(
			turn.executionProvenanceHistory,
		);
		const userIntentContract = turn.userIntentContract === null || turn.userIntentContract === undefined
			? null
			: asRecord(turn.userIntentContract);
		if (turn.userIntentContract !== null && turn.userIntentContract !== undefined && !userIntentContract) {
			throw new Error("userIntentContract must be an object or null");
		}
		const attentionProjection = parseAttentionProjection(turn.attentionProjection);
		if (reasonCode === "root_physical_execution_budget_exhausted" && !suspension) {
			throw new Error("physical budget reason requires suspension evidence");
		}
		if (
			!root.activeTurn
			&& reasonCode === "root_physical_execution_budget_exhausted"
			&& !recoveryCheckpoint
		) {
			throw new Error("physical budget reason requires recovery checkpoint");
		}
		if (reasonCode !== "root_physical_execution_budget_exhausted" && suspension) {
			throw new Error("physical budget suspension requires matching reason");
		}
		if (
			logicalTaskState.status !== "active" &&
			logicalTaskState.status !== "waiting_external" &&
			logicalTaskState.status !== "failed" &&
			logicalTaskState.status !== "cancelled" &&
			recoveryCheckpoint
		) {
			throw new Error("recovery checkpoint requires an inactive recoverable or terminal physical run");
		}
		if (recoveryCheckpoint && recoveryCheckpoint.reasonCode !== reasonCode) {
			throw new Error("recovery checkpoint reason must match turn reason");
		}
		return {
			sessionId,
			durable: true,
			activeTurn: root.activeTurn,
			turn: {
				turnId: requiredString(turn, "turnId"),
				internalTurnId: requiredString(turn, "internalTurnId"),
				state,
				logicalTaskState,
				phase,
				startedAt: requiredString(turn, "startedAt"),
				updatedAt: requiredString(turn, "updatedAt"),
				lastConfirmedAt: requiredString(turn, "lastConfirmedAt"),
				requestText: typeof turn.requestText === "string" ? turn.requestText : "",
				terminalAuthority,
				reasonCode,
				userIntentContract,
				suspension,
				recoveryCheckpoint,
				lastConfirmedSummary: requiredString(turn, "lastConfirmedSummary"),
				finalResponse: nullableString(turn.finalResponse),
				terminalDelivery,
				...(executionProvenanceHistory.length > 0 ? { executionProvenanceHistory } : {}),
				attentionProjection,
				pendingUserInput: parsePendingUserInput(turn.pendingUserInput),
				pendingQueueCount,
				recentEvents: parseRecentEvents(turn.recentEvents),
			},
		};
	} catch (error) {
		throw new AppError(
			`Agents chat status response is invalid: ${error instanceof Error ? error.message : String(error)}`,
			{ status: 502, code: "agents_chat_status_invalid_response" },
		);
	}
}

async function resolveRuntimeEndpoint(c: AppContext, userId: string): Promise<{
	baseUrl: string;
	token: string | null;
	effectiveUserId: string;
}> {
	const effectiveUserId = resolveEffectiveUserId(c, userId);
	if (!effectiveUserId) {
		throw new AppError("Unauthorized: missing userId for agents bridge", {
			status: 401,
			code: "unauthorized",
		});
	}
	let baseUrl = readAgentsBridgeBaseUrl(c);
	if (!baseUrl) baseUrl = await maybeStartAgentsBridgeOnDemand(c);
	if (!baseUrl) {
		throw new AppError("Agents bridge 未配置（缺少 AGENTS_BRIDGE_BASE_URL）", {
			status: 400,
			code: "agents_bridge_not_configured",
		});
	}
	return { baseUrl, token: readAgentsBridgeToken(c), effectiveUserId };
}

function readUpstreamError(payload: unknown, status: number): AppError {
	const record = asRecord(payload);
	const nestedError = asRecord(record?.error);
	const message = nullableString(record?.message)
		?? nullableString(record?.error)
		?? nullableString(nestedError?.message)
		?? `Agents chat runtime request failed: ${status}`;
	return new AppError(message, {
		status,
		code: nullableString(record?.code) ?? "agents_chat_runtime_request_failed",
		details: record?.details ?? payload,
	});
}

async function postRuntimeJson(
	c: AppContext,
	userId: string,
	path: "/chat/status" | "/chat/interrupt",
	body: Record<string, unknown>,
	options: AgentsChatRuntimeRequestOptions,
): Promise<unknown> {
	if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
		throw new AppError("Agents chat runtime deadline must be a positive finite number", {
			status: 500,
			code: "agents_chat_runtime_deadline_invalid",
			details: { timeoutMs: options.timeoutMs },
		});
	}
	const runtime = await resolveRuntimeEndpoint(c, userId);
	const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
	const operation = path === "/chat/status" ? "status" : "interrupt";
	const controller = new AbortController();
	let timedOut = false;
	const abortFromCaller = () => controller.abort(options.signal?.reason);
	if (options.signal?.aborted) abortFromCaller();
	else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
	const timeoutHandle = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, options.timeoutMs);

	try {
		const response = await fetch(`${runtime.baseUrl}${path}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...buildAgentsBridgeSessionAffinityHeader({
					userId: runtime.effectiveUserId,
					sessionId,
				}),
				...(runtime.token ? { Authorization: `Bearer ${runtime.token}` } : {}),
			},
			body: JSON.stringify({ userId: runtime.effectiveUserId, ...body }),
			signal: controller.signal,
		});
		const payload: unknown = await response.json().catch(() => null);
		if (!response.ok) throw readUpstreamError(payload, response.status);
		return payload;
	} catch (error: unknown) {
		if (error instanceof AppError) throw error;
		if (timedOut) {
			throw new AppError(`Agents chat runtime ${operation} request timed out`, {
				status: 504,
				code: "agents_chat_runtime_timeout",
				details: {
					operation,
					operationOutcome: "unknown",
					reason: "deadline_exceeded",
					timeoutMs: options.timeoutMs,
				},
			});
		}
		if (options.signal?.aborted) {
			throw new AppError(`Agents chat runtime ${operation} request was aborted by its caller`, {
				status: 499,
				code: "agents_chat_runtime_request_aborted",
				details: {
					operation,
					operationOutcome: "unknown",
					reason: "caller_aborted",
				},
			});
		}
		throw new AppError(`Agents chat runtime ${operation} transport outcome is unknown`, {
			status: 502,
			code: "agents_chat_runtime_transport_unknown",
			details: {
				operation,
				operationOutcome: "unknown",
				reason: "transport_failure",
				errorName: error instanceof Error ? error.name : "UnknownError",
			},
		});
	} finally {
		clearTimeout(timeoutHandle);
		options.signal?.removeEventListener("abort", abortFromCaller);
	}
}

export async function getAgentsChatTurnStatus(
	c: AppContext,
	userId: string,
	sessionId: string,
	options: AgentsChatRuntimeRequestOptions,
): Promise<AgentsChatTurnStatusSnapshot> {
	const payload = await postRuntimeJson(c, userId, "/chat/status", { sessionId }, options);
	return parseAgentsChatTurnStatusSnapshot(payload, sessionId);
}

export async function interruptAgentsChatTurn(
	c: AppContext,
	userId: string,
	input: {
		sessionId: string;
		turnId: string;
		reasonCode?: "chat_turn_user_interrupt" | "provider_stream_interrupted" | "async_dependency_terminal" | "async_lifecycle_monitor_unavailable" | "video_production_start_deadline_exceeded";
	},
	options: AgentsChatRuntimeRequestOptions,
): Promise<AgentsChatTurnInterruptReceipt> {
	const payload = await postRuntimeJson(c, userId, "/chat/interrupt", {
		sessionId: input.sessionId,
		turnId: input.turnId,
		...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
	}, options);
	const root = asRecord(payload);
	if (!root || root.ok !== true || typeof root.interrupted !== "boolean") {
		throw new AppError("Agents chat interrupt response is invalid", {
			status: 502,
			code: "agents_chat_interrupt_invalid_response",
		});
	}
	const status = root.status === null || typeof root.status === "undefined"
		? null
		: parseAgentsChatTurnStatusSnapshot(root.status, input.sessionId);
	return {
		ok: true,
		interrupted: root.interrupted,
		sessionId: input.sessionId,
		turnId: nullableString(root.turnId),
		status,
	};
}
