import { createHash, randomUUID } from "node:crypto";
import { streamSSE } from "hono/streaming";
import { AppError } from "../../middleware/error";
import { normalizeRetrievalContextV1 } from "../execution/execution.retrieval-context";
import type { AppContext } from "../../types";
import { cancelWorkflowExecutionsOwnedByChatTurn } from "../execution/execution.cancel-service";
import {
	buildAgentsChatResponseFromTaskResult,
	persistAgentsChatConversationTurn,
	persistInterruptedAgentsChatRun,
} from "../apiKey/public-agents-chat-response";
import {
	AgentsChatRequestSchema,
	type AgentsChatRequestDto,
	type AgentsChatResponseDto,
} from "../apiKey/apiKey.schemas";
import type { TaskRequestDto, TaskResultDto } from "./task.schemas";
import {
	enqueueAgentsBridgeMessage,
	runAgentsBridgeChatTask,
	type DurableTaskReferenceV1,
	type DurableProgressClaimV1,
	type AgentsBridgeStreamObserver,
} from "./task.agents-bridge";
import {
	broadcastPatch,
	markChatTurnActive,
	touchChatTurn,
	markChatTurnEnded,
} from "../chapter/canvas-sse.manager";
import {
	beginChatBilling,
	settleChatBilling,
	releaseChatBilling,
	deriveChatConversationId,
	deriveChatEffectConversationId,
	type ChatBillingHandle,
} from "../billing/chat-billing";
import { resetUserConversation } from "../memory/memory.service";
import {
	ChatTurnInflightError,
	anyAbortSignal,
	buildInflightChatTurnKey,
	getInflightChatTurnSnapshot,
	interruptInflightChatTurn,
	registerInflightChatTurn,
} from "./chat-turn-inflight";
import {
	getAgentsChatTurnStatus,
	interruptAgentsChatTurn,
	isAgentsChatRuntimeOutcomeUnknown,
	type AgentsChatPhysicalBudgetSuspension,
	type AgentsChatTurnInterruptReceipt,
	type AgentsChatTurnRecoveryCheckpoint,
	type AgentsChatTurnStatusSnapshot,
} from "./task.agents-chat-runtime";
import {
	ASYNC_AGENT_CONTINUATION_PROVIDER,
	assertAsyncAgentContinuationTaskGoalSize,
	buildAsyncAgentContinuationId,
	buildAsyncAgentContinuationExecutionTraceId,
	claimSessionOrphanedPhysicalBudgetContinuation,
	claimSessionPhysicalBudgetContinuation,
	claimReadyAsyncAgentContinuationsAcrossFlows,
	cancelActiveSessionAgentContinuations,
	collectAcceptedAsyncDurableRunIds,
	collectSettledWorkflowExecutionArtifacts,
	collectTaskResultMaterializedArtifacts,
	collectOwnedAsyncRepairRuns,
	completeAsyncAgentContinuation,
	deferOrFailAsyncAgentContinuation,
	findAsyncAgentContinuationForPublicTurn,
	isRootPhysicalBudgetContinuation,
	registerAsyncAgentContinuation,
	type AsyncAgentContinuation,
	type AsyncAgentContinuationArtifactDependencyV2,
	type AsyncAgentContinuationExecutionContractV1,
	type AsyncAgentContinuationMaterializedArtifactV1,
	type AsyncAgentContinuationTaskCapsuleV1,
} from "./async-agent-continuation";
import { getTaskResultByTaskId, type TaskResultRow } from "./task-result.repo";
import { resolvePhysicalContinuationNextAttemptAt } from "./public-chat-physical-continuation-backoff";
import {
	enqueueAsyncAgentContinuations,
	enqueueContinuationSettlementRecoveries,
} from "./async-agent-continuation.queue";
import { evaluateRootPhysicalNoProgressWindow } from "./root-physical-continuation-budget";
import {
	touchClaimedTaskStatus,
	transitionClaimedTaskStatus,
} from "./task-status.repo";
import {
	getExecutionTraceLifecycleSnapshot,
	type ExecutionTraceLifecycleSnapshot,
} from "../memory/execution-trace-events.repo";
import { normalizePublicChatSemanticDeliveryContract } from "./public-chat-delivery-verifier";
import { parseDurableProgressCursor } from "./durable-progress-cursor";
import { buildAsyncAgentContinuationPrompt } from "./async-agent-continuation-prompt";
import { resolveAsyncContinuationDeniedRemoteTools } from "./async-agent-continuation-effect-policy";
import {
	createContinuationSettlementRecord,
	buildContinuationSettlementEffectId,
	claimContinuationSettlementReconciliation,
	deferContinuationSettlementRecovery,
	executeContinuationSettlementRecoveryCapsule,
	findTerminalContinuationSettlementForPublicTurn,
	persistContinuationSettlementFailure,
	type ContinuationSettlementRecoveryCapsuleV1,
	type ContinuationSettlementRecordV1,
} from "./agents-continuation-settlement";
import { projectPublicAgentAttention } from "./agent-attention-projection";
import {
	startPublicChatExecutionRecorder,
	type PublicChatExecutionRecorder,
} from "./public-chat-execution-recorder";
import {
	writePublicAgentsChatSseWithinDeadline,
	type PublicAgentsChatStreamWriter,
} from "./public-agents-chat-stream";
import {
	completeAgentsChatPublication,
	deferAgentsChatPublication,
	registerAgentsChatPublication,
	sweepAgentsChatPublications,
	type AgentsChatPublicationContractV1,
} from "./agents-chat-publication-outbox";
import {
	finalizeExecutionTraceRun,
	getExecutionTraceAcceptedSnapshot,
	listExecutionTraceEvents,
	type ExecutionTraceEvent,
} from "../memory/execution-trace-events.repo";
import { verifyUserIntentContract } from "./video-orchestrator.user-intent-contract";
import {
	PUBLIC_CHAT_REPLAY_PAGE_SIZE,
	PUBLIC_CHAT_REPLAY_POLL_INTERVAL_MS,
	buildPublicChatEventId,
	buildPublicChatReplayResyncPayload,
	detectPublicChatReplayGap,
	markPublicChatStreamPayload,
	projectExecutionTraceEventToPublicChatFrame,
	resolvePublicChatReplayAfterEvent,
	traceStatusCanProduceMorePublicChatEvents,
	verifyPublicChatReplaySessionIdentity,
	type PublicChatReplayResyncReason,
	type PublicChatReplayableEventName,
} from "./public-agents-chat-event-replay";
import {
	readPublicChatHostExecutionHandoffOwnership,
	type PublicChatHostExecutionHandoffOwnershipV1,
} from "./public-chat-host-async-evidence";

type ResponsesInputPromptResolution = {
	prompt: string;
	referenceImages: string[];
};

type StreamErrorPayload = {
	message: string;
	code?: string;
	details?: unknown;
	terminal: boolean;
	scope: "transport" | "provider" | "tool" | "persistence" | "protocol";
	retryability: "retryable" | "not_retryable" | "unknown";
	acceptanceKnown: boolean;
	sideEffectOutcomeKnown: boolean;
	recovery?: {
		kind: "status_reconcile" | "durable_resume" | "retry_projection";
		referenceId: string;
	};
};

const FORWARDED_STREAM_EVENTS = new Set([
	"content",
	"block",
	"suggestions",
	"tool",
	"skill",
	"todo_list",
	"agent_role",
	"thread.started",
	"turn.started",
	"item.started",
	"item.updated",
	"item.completed",
	"status-update",
	"artifact-update",
]);

const PUBLIC_CHAT_RUNTIME_STATUS_DEADLINE_MS = 10_000;
const PUBLIC_CHAT_RUNTIME_INTERRUPT_DEADLINE_MS = 10_000;

/**
 * Upstream agents-cli terminal frames are intentionally not forwarded. Hono
 * must first commit the logical-task state, delivery verification,
 * persistence and continuation diagnostics. Forwarding the
 * upstream `result` lets the Web client settle on an incomplete response and
 * misclassify a valid needs-input handoff as request_terminal_missing.
 */
export function shouldForwardAgentsBridgeStreamEvent(eventName: string): boolean {
	return FORWARDED_STREAM_EVENTS.has(eventName);
}

function normalizeHttpUrl(raw: unknown): string {
	return typeof raw === "string" && /^https?:\/\//i.test(raw.trim()) ? raw.trim() : "";
}

function mergeUniqueUrls(primary: string[], secondary: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of [...primary, ...secondary]) {
		const url = normalizeHttpUrl(item);
		if (!url || seen.has(url)) continue;
		seen.add(url);
		out.push(url);
	}
	return out;
}

function normalizeResponsesInputToPromptAndImages(inputValue: unknown): ResponsesInputPromptResolution {
	if (typeof inputValue === "string") {
		return { prompt: inputValue.trim(), referenceImages: [] };
	}
	if (!Array.isArray(inputValue)) {
		return { prompt: "", referenceImages: [] };
	}

	const textChunks: string[] = [];
	const latestUserTexts: string[] = [];
	const imageCandidates: string[] = [];
	const toolOutputs: string[] = [];

	for (const item of inputValue) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const entry = item as Record<string, unknown>;
		const entryType =
			typeof entry.type === "string" ? entry.type.trim().toLowerCase() : "";
		if (entryType === "function_call_output" || entryType === "tool_result") {
			const output =
				typeof entry.output === "string"
					? entry.output.trim()
					: typeof entry.content === "string"
						? entry.content.trim()
						: "";
			if (output) toolOutputs.push(output);
			continue;
		}

		const role =
			typeof entry.role === "string" ? entry.role.trim().toLowerCase() : "";
		const content = entry.content;
		if (typeof content === "string") {
			const text = content.trim();
			if (!text) continue;
			textChunks.push(text);
			if (role === "user") latestUserTexts.push(text);
			continue;
		}
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			if (!part || typeof part !== "object" || Array.isArray(part)) continue;
			const piece = part as Record<string, unknown>;
			const pieceType =
				typeof piece.type === "string" ? piece.type.trim().toLowerCase() : "";
			if (pieceType === "input_text" || pieceType === "text") {
				const text = typeof piece.text === "string" ? piece.text.trim() : "";
				if (!text) continue;
				textChunks.push(text);
				if (role === "user") latestUserTexts.push(text);
				continue;
			}
			if (pieceType === "input_image" || pieceType === "image_url") {
				const imageUrl =
					typeof piece.image_url === "string"
						? piece.image_url.trim()
						: piece.image_url &&
							  typeof piece.image_url === "object" &&
							  !Array.isArray(piece.image_url) &&
							  typeof (piece.image_url as Record<string, unknown>).url === "string"
							? String((piece.image_url as Record<string, unknown>).url).trim()
							: "";
				const normalizedImageUrl = normalizeHttpUrl(imageUrl);
				if (normalizedImageUrl) imageCandidates.push(normalizedImageUrl);
			}
		}
	}

	const latestUserText = latestUserTexts.length
		? latestUserTexts[latestUserTexts.length - 1] || ""
		: "";
	const basePrompt =
		latestUserText || (textChunks.length ? textChunks[textChunks.length - 1] || "" : "");
	const toolContext =
		toolOutputs.length > 0
			? `\n\n[Tool Outputs]\n${toolOutputs.map((text, index) => `#${index + 1}\n${text}`).join("\n\n")}`
			: "";
	return {
		prompt: `${basePrompt}${toolContext}`.trim(),
		referenceImages: mergeUniqueUrls(imageCandidates, []),
	};
}

export function buildTaskRequest(input: AgentsChatRequestDto): TaskRequestDto {
	const modelKey = typeof input.modelKey === "string" ? input.modelKey.trim() : "";
	const modelAlias = typeof input.modelAlias === "string" ? input.modelAlias.trim() : "";
	const compatibleModelAlias = typeof input.model === "string" ? input.model.trim() : "";
	const modelSelectors = [modelKey, modelAlias, compatibleModelAlias].filter(Boolean);
	if (modelSelectors.length === 0) {
		throw new AppError("小T 主对话缺少当前选择的语言模型", {
			status: 400,
			code: "agents_chat_model_required",
		});
	}
	if (modelSelectors.length > 1) {
		throw new AppError("小T 主对话收到多个模型标识，无法确定唯一语言模型", {
			status: 400,
			code: "agents_chat_model_ambiguous",
		});
	}
	const resolvedFromInput = normalizeResponsesInputToPromptAndImages(input.input);
	const prompt =
		typeof input.prompt === "string" && input.prompt.trim()
			? input.prompt.trim()
			: resolvedFromInput.prompt;
	if (!prompt) {
		throw new AppError("prompt 不能为空", {
			status: 400,
			code: "invalid_request",
		});
	}

	const referenceImages = mergeUniqueUrls(
		Array.isArray(input.referenceImages) ? input.referenceImages : [],
		resolvedFromInput.referenceImages,
	);
	const assetInputs = Array.isArray(input.assetInputs)
		? input.assetInputs.map((item) => ({ ...item }))
		: [];
	const extras: Record<string, unknown> = {
		...(typeof input.clientPendingId === "string" && input.clientPendingId.trim()
			? { clientPendingId: input.clientPendingId.trim() }
			: {}),
		...(typeof input.displayPrompt === "string" && input.displayPrompt.trim()
			? { displayPrompt: input.displayPrompt.trim() }
			: {}),
		...(typeof input.systemPrompt === "string" && input.systemPrompt.trim()
			? { systemPrompt: input.systemPrompt.trim() }
			: typeof input.instructions === "string" && input.instructions.trim()
				? { systemPrompt: input.instructions.trim() }
				: {}),
		...(typeof input.temperature === "number" ? { temperature: input.temperature } : {}),
		...(modelKey ? { modelKey } : {}),
		...(modelAlias || compatibleModelAlias
			? { modelAlias: modelAlias || compatibleModelAlias }
			: {}),
		...(typeof input.response_format !== "undefined"
			? { response_format: input.response_format }
			: {}),
		...(typeof input.mode === "string" ? { mode: input.mode } : {}),
		...(typeof input.sessionKey === "string" && input.sessionKey.trim()
			? { sessionKey: input.sessionKey.trim() }
			: {}),
		...(input.resetSession === true ? { resetSession: true } : {}),
		...(typeof input.canvasProjectId === "string" && input.canvasProjectId.trim()
			? { canvasProjectId: input.canvasProjectId.trim() }
			: {}),
		...(typeof input.canvasFlowId === "string" && input.canvasFlowId.trim()
			? { canvasFlowId: input.canvasFlowId.trim() }
			: {}),
		...(typeof input.canvasNodeId === "string" && input.canvasNodeId.trim()
			? { canvasNodeId: input.canvasNodeId.trim() }
			: {}),
		...(input.chatContext ? { chatContext: input.chatContext } : {}),
		...(typeof input.bookId === "string" && input.bookId.trim()
			? { bookId: input.bookId.trim() }
			: {}),
		...(typeof input.chapterId === "string" && input.chapterId.trim()
			? { chapterId: input.chapterId.trim() }
			: {}),
		...(typeof input.planOnly === "boolean" ? { planOnly: input.planOnly } : {}),
		...(typeof input.forceAssetGeneration === "boolean"
			? { forceAssetGeneration: input.forceAssetGeneration }
			: {}),
		...(typeof input.forcedAgentRole === "string" && input.forcedAgentRole.trim()
			? { forcedAgentRole: input.forcedAgentRole.trim() }
			: {}),
		...(Array.isArray(input.allowedSubagentTypes) && input.allowedSubagentTypes.length > 0
			? { allowedSubagentTypes: input.allowedSubagentTypes }
			: {}),
		...(input.requireAgentsTeamExecution === true
			? { requireAgentsTeamExecution: true }
			: {}),
		...(input.intent ? { intent: input.intent } : {}),
		...(typeof input.chapterIntentSourceNodeId === "string" &&
		input.chapterIntentSourceNodeId.trim()
			? { chapterIntentSourceNodeId: input.chapterIntentSourceNodeId.trim() }
			: {}),
		...(input.chapterContext ? { chapterContext: input.chapterContext } : {}),
		...(input.chapterIntentGenerationConfig
			? { chapterIntentGenerationConfig: input.chapterIntentGenerationConfig }
			: {}),
		...(input.chapterIntentVariantParams
			? { chapterIntentVariantParams: input.chapterIntentVariantParams }
			: {}),
		...(input.chapterIntentStyleGuide
			? { chapterIntentStyleGuide: input.chapterIntentStyleGuide }
			: {}),
		...(Array.isArray(input.requiredSkills) && input.requiredSkills.length > 0
			? {
					requiredSkills: input.requiredSkills
						.map((item) => (typeof item === "string" ? item.trim() : ""))
						.filter(Boolean),
			  }
			: {}),
		...(input.promptExampleRetrievalScope
			? { promptExampleRetrievalScope: input.promptExampleRetrievalScope }
			: {}),
		...(input.executionToolPolicy
			? {
					executionToolPolicy: {
						mode: input.executionToolPolicy.mode,
						allowedTools: [...input.executionToolPolicy.allowedTools],
					},
			  }
			: {}),
		...(referenceImages.length ? { referenceImages } : {}),
		...(assetInputs.length ? { assetInputs } : {}),
		...(input.generationContract ? { generationContract: input.generationContract } : {}),
		...(input.requestUserInputResponse
			? { requestUserInputResponse: input.requestUserInputResponse }
			: {}),
		...(typeof input.debug === "boolean" ? { debug: input.debug } : {}),
		...(typeof input.aspectRatio === "string" && input.aspectRatio.trim()
			? { aspectRatio: input.aspectRatio.trim() }
			: {}),
		...(typeof input.videoResolution === "string" && input.videoResolution.trim()
			? { videoResolution: input.videoResolution.trim() }
			: {}),
		...(typeof input.targetDurationSeconds === "number"
			? { targetDurationSeconds: input.targetDurationSeconds }
			: {}),
		...(typeof input.maxVideoDurationSeconds === "number"
			? { maxVideoDurationSeconds: input.maxVideoDurationSeconds }
			: {}),
	};
	return {
		kind: "chat",
		prompt,
		extras,
	};
}

export function buildStablePublicChatTurnId(input: {
	userId: string;
	sessionKey?: string | null;
	clientPendingId: string;
}): string {
	const userId = input.userId.trim();
	const sessionKey = input.sessionKey?.trim() || "stateless";
	const clientPendingId = input.clientPendingId.trim();
	if (!userId || !clientPendingId) {
		throw new Error("stable public chat turn identity requires userId and clientPendingId");
	}
	const digest = createHash("sha256")
		.update(JSON.stringify({ userId, sessionKey, clientPendingId }))
		.digest("hex");
	return `public-chat-turn:${digest}`;
}

function isExecutionTraceIdentityAlreadyUsed(error: unknown): boolean {
	return error instanceof Error && error.message.startsWith("execution_trace_already_exists:");
}

function publicChatTurnAlreadyExistsError(publicTurnId: string): AppError {
	return new AppError("同一聊天回合已被受理，禁止重复执行；请对账原回合状态。", {
		status: 409,
		code: "agents_chat_turn_already_exists",
		details: {
			publicTurnId,
			acceptance: "accepted",
			recovery: { kind: "status_reconcile", referenceId: publicTurnId },
		},
	});
}

function toErrorMessage(error: unknown): string {
	if (error instanceof AppError) return error.message;
	if (error instanceof Error && error.message.trim()) return error.message;
	return "agents chat failed";
}

export function toStreamErrorPayload(error: unknown): StreamErrorPayload {
	if (error instanceof AppError) {
		const details = error.details && typeof error.details === "object" && !Array.isArray(error.details)
			? error.details as Record<string, unknown>
			: null;
		const acceptance = typeof details?.acceptance === "string" ? details.acceptance : "";
		const operationOutcome = typeof details?.operationOutcome === "string" ? details.operationOutcome : "";
		const recoveryRecord = details?.recovery && typeof details.recovery === "object" && !Array.isArray(details.recovery)
			? details.recovery as Record<string, unknown>
			: null;
		const recoveryKind = recoveryRecord?.kind;
		const recoveryReferenceId = typeof recoveryRecord?.referenceId === "string"
			? recoveryRecord.referenceId.trim()
			: "";
		return {
			message: error.message,
			code: error.code,
			...(typeof error.details !== "undefined" ? { details: error.details } : {}),
			terminal: error.terminal === true,
			scope: "protocol",
			retryability: error.terminal === true ? "not_retryable" : "unknown",
			acceptanceKnown: acceptance === "accepted" || acceptance === "rejected",
			sideEffectOutcomeKnown: operationOutcome.length > 0 && operationOutcome !== "unknown",
			...(recoveryReferenceId && (
				recoveryKind === "status_reconcile" ||
				recoveryKind === "durable_resume" ||
				recoveryKind === "retry_projection"
			)
				? { recovery: { kind: recoveryKind, referenceId: recoveryReferenceId } }
				: {}),
		};
	}
	if (error instanceof Error && error.message.trim()) {
		return {
			message: error.message.trim(),
			terminal: false,
			scope: "protocol",
			retryability: "unknown",
			acceptanceKnown: false,
			sideEffectOutcomeKnown: false,
		};
	}
	return {
		message: toErrorMessage(error),
		terminal: false,
		scope: "protocol",
		retryability: "unknown",
		acceptanceKnown: false,
		sideEffectOutcomeKnown: false,
	};
}

// 为无 sessionKey 的 API key 调用（辅助创作模式）生成稳定的会话 key。
// 关键：必须与前端 buildEffectiveChatSessionKey 对同一 (projectId, flowId) 的「默认会话」
// （persistedBaseKey 为空时）产出的 key 完全一致，否则前端刷新后按自己的 key 查询历史
// 会查不到本次存档的对话。前端默认 key 形如：
//   有 flow: project:<id>:flow:<flowId>:lane:general:skill:default
//   无 flow: project:<id>:lane:general:skill:default
function buildAutoSessionKey(projectId: string, flowId?: string, chapterId?: string): string {
	const normalizedChapterId = typeof chapterId === "string" ? chapterId.trim() : "";
	// 章节画布按 project+chapter 隔离会话（与前端 buildProjectScopedChatSessionBaseKey 对齐），
	// 不落 flow，避免跨项目/章节会话与记忆串台。
	if (normalizedChapterId) {
		return `project:${projectId}:chapter:${normalizedChapterId}:lane:general:skill:default`;
	}
	const normalizedFlowId = typeof flowId === "string" ? flowId.trim() : "";
	const base = normalizedFlowId
		? `project:${projectId}:flow:${normalizedFlowId}`
		: `project:${projectId}`;
	return `${base}:lane:general:skill:default`;
}

async function resetRequestedConversation(
	c: AppContext,
	userId: string,
	request: AgentsChatRequestDto,
): Promise<void> {
	if (request.resetSession !== true) return;
	const sessionKey = typeof request.sessionKey === "string" ? request.sessionKey.trim() : "";
	if (!sessionKey) {
		throw new AppError("覆盖式会话必须提供 sessionKey", {
			status: 400,
			code: "agents_chat_reset_session_key_required",
		});
	}
	await resetUserConversation(c, { userId, sessionKey });
}

export function resolveChatTurnLanguageModelFact(
	input: AgentsChatRequestDto,
	response: AgentsChatResponseDto,
): string {
	const candidates = [
		response.modelKey,
		input.modelKey,
		response.modelAlias,
		input.modelAlias,
		input.model,
	];
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
	}
	throw new AppError("聊天消息投影缺少本轮语言模型事实", {
		status: 500,
		code: "agents_chat_language_model_fact_missing",
	});
}

export type BroadcastChatMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	ts: string;
	turnId: string;
	source: "agents";
	languageModel?: string;
	pendingUserInput?: AgentsChatResponseDto["pendingUserInput"];
};

export function buildBroadcastChatMessages(
	input: AgentsChatRequestDto,
	response: AgentsChatResponseDto,
	publicTurnIdValue: string,
	now = new Date().toISOString(),
): BroadcastChatMessage[] {
	const publicTurnId = publicTurnIdValue.trim();
	if (!publicTurnId) {
		throw new Error("聊天消息广播缺少稳定 publicTurnId");
	}
	const userText = (typeof input.displayPrompt === "string" && input.displayPrompt.trim())
		? input.displayPrompt.trim()
		: (typeof input.prompt === "string" ? input.prompt.trim() : "");
	if (!userText && !response.text && !response.pendingUserInput) return [];
	const messages: BroadcastChatMessage[] = [];
	if (userText) {
		messages.push({
			id: `sse-user-${response.id}`,
			role: "user",
			content: userText,
			ts: now,
			turnId: publicTurnId,
			source: "agents",
			languageModel: resolveChatTurnLanguageModelFact(input, response),
		});
	}
	// pendingUserInput（任务确实缺少必要用户事实时的 request_user_input 卡）必须随广播一起带：API key/督工驱动的回合
	// 不经过面板本地流，面板只能靠这条 SSE 通道看到卡；漏了它用户就只有文字没有可点的选项。
	if (response.text || response.pendingUserInput) {
		messages.push({
			id: `sse-asst-${response.id}`,
			role: "assistant",
			content: response.text || "",
			ts: now,
			turnId: publicTurnId,
			source: "agents",
			...(response.pendingUserInput ? { pendingUserInput: response.pendingUserInput } : {}),
		});
	}
	return messages;
}

function broadcastChatMessages(
	input: AgentsChatRequestDto,
	response: AgentsChatResponseDto,
	publicTurnIdValue: string,
): void {
	const projectId = typeof input.canvasProjectId === "string" ? input.canvasProjectId.trim() : "";
	if (!projectId) return;
	const messages = buildBroadcastChatMessages(input, response, publicTurnIdValue);
	if (messages.length === 0) return;

	// 推送会话 key，让前端自动切换到正确的历史会话
	const flowId = typeof input.canvasFlowId === "string" ? input.canvasFlowId.trim() : "";
	const chapterId = typeof input.chapterId === "string" ? input.chapterId.trim() : "";
	const sessionKey = typeof input.sessionKey === "string" && input.sessionKey.trim()
		? input.sessionKey.trim()
		: buildAutoSessionKey(projectId, flowId, chapterId);
	// SSE 房间 key：章节画布按 chapterId 注册连接（subscribeToChapter(chapterId)），主画布按
	// projectId 注册。chat 广播此前写死推 projectId，导致章节画布辅助创作的对话/确认卡永远到不了
	// 章节面板（节点写入走 chapterId 房间所以能看到，唯独聊天文字看不到）。有 chapterId 时改推章节房间。
	const broadcastRoom = chapterId || projectId;
	broadcastPatch(broadcastRoom, { chatMessages: messages, chatSessionKey: sessionKey }, "");
}

export type AsyncContinuationConversationPublication = "assistant_only" | "silent";

export function resolveAsyncContinuationConversationPublication(
	logicalTaskStatus: string | null | undefined,
): AsyncContinuationConversationPublication {
	return logicalTaskStatus === "succeeded" ||
		logicalTaskStatus === "failed" ||
		logicalTaskStatus === "cancelled" ||
		logicalTaskStatus === "waiting_input"
		? "assistant_only"
		: "silent";
}

function buildAsyncContinuationPublicationInput(
	input: AgentsChatRequestDto,
): AgentsChatRequestDto {
	return {
		...input,
		prompt: undefined,
		displayPrompt: undefined,
	};
}

function readRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function readStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const values = new Set<string>();
	for (const item of value) {
		if (typeof item === "string" && item.trim()) values.add(item.trim());
	}
	return [...values];
}

export function readContinuationSelectedSkillIds(
	meta: Record<string, unknown>,
): string[] {
	const provenanceCandidates: unknown[] = [
		meta.executionProvenance,
		readRecord(meta.runtime)?.executionProvenance,
		...(Array.isArray(meta.executionProvenanceHistory)
			? meta.executionProvenanceHistory
			: []),
	];
	const selected = new Set<string>();
	for (const candidate of provenanceCandidates) {
		const provenance = readRecord(candidate);
		const trace = Array.isArray(provenance?.intentSelectionTrace)
			? provenance.intentSelectionTrace
			: [];
		for (const item of trace) {
			const entry = readRecord(item);
			const candidateId = typeof entry?.candidateId === "string"
				? entry.candidateId.trim()
				: "";
			if (
				entry?.selected === true &&
				entry.candidateKind === "skill" &&
				candidateId
			) {
				selected.add(candidateId);
				if (selected.size >= 8) return [...selected];
			}
		}
	}
	return [...selected];
}

function mergeContinuationRequiredSkills(input: {
	explicit: unknown;
	parent?: readonly string[];
	meta: Record<string, unknown>;
}): string[] {
	return [...new Set([
		...(input.parent ?? []),
		...readStringList(input.explicit),
		...readContinuationSelectedSkillIds(input.meta),
	])].slice(0, 8);
}

function readContinuationExecutionToolPolicy(value: unknown): AsyncAgentContinuation["executionToolPolicy"] {
	const record = readRecord(value);
	if (record?.mode !== "restricted") return null;
	const allowedTools = readStringList(record.allowedTools);
	return allowedTools.length > 0 ? { mode: "restricted", allowedTools } : null;
}

export function readContinuationDurableTaskReferences(
	value: unknown,
): NonNullable<AsyncAgentContinuation["durableTaskReferences"]> {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const record = readRecord(item);
		if (!record || record.version !== 1) return [];
		const toolName = typeof record.toolName === "string" ? record.toolName.trim() : "";
		if (!toolName) return [];
		const readOptionalString = (field: unknown): string | null =>
			typeof field === "string" && field.trim() ? field.trim() : null;
		const clipIndex = typeof record.clipIndex === "number" && Number.isInteger(record.clipIndex) && record.clipIndex >= 0
			? record.clipIndex
			: null;
		const progressCursor = parseDurableProgressCursor(record.progressCursor);
		const mode = readOptionalString(record.mode);
		const runId = readOptionalString(record.runId);
		const taskId = readOptionalString(record.taskId);
		const draftRevision = readOptionalString(record.draftRevision);
		const beatRevision = readOptionalString(record.beatRevision);
		const preflightRevision = readOptionalString(record.preflightRevision);
		const preflightFingerprint = readOptionalString(record.preflightFingerprint);
		const acceptedAsync = record.acceptedAsync === true;
		if (!runId && !taskId && !progressCursor) return [];
		if (
			!draftRevision && !beatRevision && !preflightRevision && !preflightFingerprint &&
			!acceptedAsync && !progressCursor
		) return [];
		return [{
			version: 1 as const,
			toolName,
			mode,
			runId,
			taskId,
			draftRevision,
			beatRevision,
			preflightRevision,
			preflightFingerprint,
			clipIndex,
			...(progressCursor ? { progressCursor } : {}),
			acceptedAsync,
		}];
	}).slice(-32);
}

function readContinuationDurableProgressClaims(
	value: unknown,
): NonNullable<AsyncAgentContinuation["durableProgressClaims"]> {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const record = readRecord(item);
		if (!record) return [];
		const kind: NonNullable<AsyncAgentContinuation["durableProgressClaims"]>[number]["kind"] | null = record.kind === "durable_action" || record.kind === "delivery" || record.kind === "task_state"
			? record.kind
			: null;
		const revision = typeof record.revision === "number" && Number.isInteger(record.revision) && record.revision > 0
			? record.revision
			: null;
		const requiredString = (field: unknown): string => typeof field === "string" ? field.trim() : "";
		const key = requiredString(record.key);
		const fingerprint = requiredString(record.fingerprint);
		const toolName = requiredString(record.toolName);
		const toolCallId = requiredString(record.toolCallId);
		const observedAt = requiredString(record.observedAt);
		if (!kind || revision === null || !key || !fingerprint || !toolName || !toolCallId || !observedAt) return [];
		return [{ key, fingerprint, kind, toolName, toolCallId, observedAt, revision }];
	}).slice(-12);
}

function readContinuationActionRecoveryFacts(
	value: unknown,
): NonNullable<AsyncAgentContinuation["actionRecoveryFacts"]> {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const record = readRecord(item);
		if (!record || record.version !== 1) return [];
		const toolName = typeof record.toolName === "string" ? record.toolName.trim() : "";
		const message = typeof record.message === "string" ? record.message.trim().slice(0, 2_000) : "";
		const status: NonNullable<AsyncAgentContinuation["actionRecoveryFacts"]>[number]["status"] | null =
			record.status === "failed"
				? "failed"
				: record.status === "blocked"
					? "blocked"
					: record.status === "denied"
						? "denied"
						: record.status === "warning"
							? "warning"
							: null;
		if (!toolName || !message || !status) return [];
		const optionalString = (field: unknown): string | null =>
			typeof field === "string" && field.trim() ? field.trim() : null;
		const retryInputRecord = readRecord(record.retryInput);
		const serializedRetryInput = retryInputRecord
			? JSON.stringify(retryInputRecord)
			: "";
		const retryInput = serializedRetryInput.length > 0 && serializedRetryInput.length <= 512_000
			? JSON.parse(serializedRetryInput) as Record<string, unknown>
			: null;
		return [{
			version: 1 as const,
			toolName,
			mode: optionalString(record.mode),
			status,
			code: optionalString(record.code),
			message,
			runId: optionalString(record.runId),
			draftRevision: optionalString(record.draftRevision),
			...(retryInput ? { retryInput } : {}),
		}];
	}).slice(-16);
}

const CONTINUATION_TRANSIENT_REQUEST_FIELDS = new Set<string>([
	"prompt",
	"displayPrompt",
	"input",
	"clientPendingId",
	"sessionKey",
	"queueMode",
	"canvasProjectId",
	"canvasFlowId",
	"canvasNodeId",
	"bookId",
	"chapterId",
	"modelKey",
	"modelAlias",
	"model",
	"vendor",
	"vendorCandidates",
	"stream",
]);

export function buildContinuationTaskCapsule(
	requestInput: AgentsChatRequestDto,
	parentContinuation?: AsyncAgentContinuation,
	taskRequest?: TaskRequestDto,
): AsyncAgentContinuationTaskCapsuleV1 | null {
	const taskExtras = readRecord(taskRequest?.extras);
	const currentExecutionContract = parseContinuationExecutionContract(
		taskExtras?.continuationExecutionContract,
	);
	if (parentContinuation?.taskCapsule) {
		assertAsyncAgentContinuationTaskGoalSize(parentContinuation.taskCapsule.goal);
		const parentExecutionContract = parentContinuation.taskCapsule.executionContract;
		const baseExecutionContract = currentExecutionContract
			? {
				...(parentExecutionContract ?? {}),
				...currentExecutionContract,
				version: 1 as const,
				directForcedAgentExecution: true as const,
			}
			: parentExecutionContract;
		return {
			...parentContinuation.taskCapsule,
			...(baseExecutionContract ? { executionContract: baseExecutionContract } : {}),
		};
	}
	const goal = typeof requestInput.prompt === "string"
		? requestInput.prompt.trim()
		: typeof requestInput.input === "string"
			? requestInput.input.trim()
			: "";
	if (!goal) return null;
	assertAsyncAgentContinuationTaskGoalSize(goal);
	const inputRecord = requestInput as unknown as Record<string, unknown>;
	const requestFacts: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(inputRecord)) {
		if (CONTINUATION_TRANSIENT_REQUEST_FIELDS.has(key) || typeof value === "undefined") continue;
		requestFacts[key] = structuredClone(value);
	}
	return {
		version: 1,
		goal,
		requestFacts,
		...(currentExecutionContract ? { executionContract: currentExecutionContract } : {}),
	};
}

export function resolveContinuationExecutionContract(
	continuation: AsyncAgentContinuation,
): AsyncAgentContinuationTaskCapsuleV1["executionContract"] | null {
	return continuation.taskCapsule?.executionContract ?? null;
}

function parseContinuationExecutionContract(
	value: unknown,
): AsyncAgentContinuationExecutionContractV1 | null {
	const record = readRecord(value);
	if (record?.version !== 1 || record.directForcedAgentExecution !== true) return null;
	const retrievalContext = normalizeRetrievalContextV1(record.retrievalContext);
	return {
		version: 1,
		directForcedAgentExecution: true,
		...(typeof record.outputContract !== "undefined"
			? { outputContract: structuredClone(record.outputContract) }
			: {}),
		...(typeof record.responseFormat !== "undefined"
			? { responseFormat: structuredClone(record.responseFormat) }
			: {}),
		...(typeof record.maxOutputTokens === "number"
			? { maxOutputTokens: record.maxOutputTokens }
			: {}),
		...(record.reasoningEffort === "none"
			|| record.reasoningEffort === "minimal"
			|| record.reasoningEffort === "low"
			|| record.reasoningEffort === "medium"
			|| record.reasoningEffort === "high"
			|| record.reasoningEffort === "xhigh"
			|| record.reasoningEffort === "max"
			? { reasoningEffort: record.reasoningEffort }
			: {}),
		...(typeof record.retrievalUserRequest === "string" && record.retrievalUserRequest.trim()
			? { retrievalUserRequest: record.retrievalUserRequest.trim() }
			: {}),
		...(retrievalContext ? { retrievalContext } : {}),
	};
}

function mergeDurableTaskReferences(
	parent: AsyncAgentContinuation["durableTaskReferences"],
	current: AsyncAgentContinuation["durableTaskReferences"],
): NonNullable<AsyncAgentContinuation["durableTaskReferences"]> {
	const merged = [...(parent ?? []), ...(current ?? [])];
	const seen = new Set<string>();
	return merged.filter((reference) => {
		const identity = JSON.stringify(reference);
		if (seen.has(identity)) return false;
		seen.add(identity);
		return true;
	}).slice(-32);
}

function mergeDurableProgressClaims(
	parent: AsyncAgentContinuation["durableProgressClaims"],
	current: AsyncAgentContinuation["durableProgressClaims"],
): NonNullable<AsyncAgentContinuation["durableProgressClaims"]> {
	const merged = new Map<string, NonNullable<AsyncAgentContinuation["durableProgressClaims"]>[number]>();
	for (const claim of [...(parent ?? []), ...(current ?? [])]) {
		merged.set(`${claim.key}\u0000${claim.fingerprint}`, claim);
	}
	return [...merged.values()].sort((left, right) => left.revision - right.revision).slice(-12);
}

function mergeActionRecoveryFacts(
	parent: AsyncAgentContinuation["actionRecoveryFacts"],
	current: AsyncAgentContinuation["actionRecoveryFacts"],
): NonNullable<AsyncAgentContinuation["actionRecoveryFacts"]> {
	const merged = new Map<string, NonNullable<AsyncAgentContinuation["actionRecoveryFacts"]>[number]>();
	for (const fact of [...(parent ?? []), ...(current ?? [])]) {
		merged.set(`${fact.toolName}\u0000${fact.mode ?? "default"}`, fact);
	}
	return [...merged.values()].slice(-16);
}

export function pruneResolvedIntentRecoveryFacts(
	facts: NonNullable<AsyncAgentContinuation["actionRecoveryFacts"]>,
	userIntentContract: Record<string, unknown> | null,
): NonNullable<AsyncAgentContinuation["actionRecoveryFacts"]> {
	if (!userIntentContract) return facts;
	// A persisted frozen contract is stronger, later evidence that
	// record_user_intent succeeded. Keeping an earlier rejected intent call in
	// the recovery frontier creates an impossible continuation: there is no
	// retryInput to repair, while the now-frozen contract forbids replacing it.
	return facts.filter((fact) => fact.toolName !== "record_user_intent");
}

function readRetrievalCandidateSetReceipts(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is Record<string, unknown> => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return false;
		const record = item as Record<string, unknown>;
		return typeof record.candidateSetId === "string"
			&& typeof record.logicalTaskId === "string"
			&& typeof record.rawUserRequestHash === "string"
			&& Array.isArray(record.entries)
			&& JSON.stringify(record).length <= 128_000;
	}).slice(-8);
}

function mergeRetrievalCandidateSetReceipts(
	parent: AsyncAgentContinuation["retrievalCandidateSets"],
	current: readonly Record<string, unknown>[],
): NonNullable<AsyncAgentContinuation["retrievalCandidateSets"]> {
	const merged = new Map<string, Record<string, unknown>>();
	for (const receipt of [...(parent ?? []), ...current]) {
		const candidateSetId = typeof receipt.candidateSetId === "string"
			? receipt.candidateSetId.trim()
			: "";
		if (candidateSetId) merged.set(candidateSetId, receipt);
	}
	return [...merged.values()].slice(-8);
}

export type AsyncContinuationDeliveryReportLock = {
	taskGoal: string;
	requestedOutput: string;
	successCriteria: string[];
	deliveryContract: NonNullable<ReturnType<typeof normalizePublicChatSemanticDeliveryContract>>;
};

export function buildAsyncContinuationDeliveryReportLock(
	expectedDelivery: Record<string, unknown>,
): AsyncContinuationDeliveryReportLock {
	const taskGoal = typeof expectedDelivery.taskGoal === "string"
		? expectedDelivery.taskGoal.trim()
		: "";
	const requestedOutput = typeof expectedDelivery.requestedOutput === "string"
		? expectedDelivery.requestedOutput.trim()
		: "";
	const successCriteria = readStringList(expectedDelivery.successCriteria);
	const deliveryContract = normalizePublicChatSemanticDeliveryContract(
		expectedDelivery.deliveryContract,
	);
	if (
		expectedDelivery.active !== true ||
		!taskGoal ||
		!requestedOutput ||
		successCriteria.length === 0 ||
		!deliveryContract
	) {
		throw new Error("async_continuation_expected_delivery_lock_invalid");
	}
	return {
		taskGoal,
		requestedOutput,
		successCriteria,
		deliveryContract,
	};
}

export function resolveAsyncContinuationDeliveryReportLock(input: {
	resumeTrigger: "physical_budget" | "replan" | "dependency";
	expectedDelivery: Record<string, unknown>;
}): AsyncContinuationDeliveryReportLock | null {
	// A physical window may end before the root has frozen a complete delivery
	// report. Resume that same durable session without manufacturing a lock; the
	// agents runtime must repair/freeze record_user_intent before another side
	// effect. Dependency callbacks happen after an accepted async side effect and
	// therefore may never continue without the immutable delivery lock.
	if (input.resumeTrigger === "physical_budget" || input.resumeTrigger === "replan") {
		try {
			return buildAsyncContinuationDeliveryReportLock(input.expectedDelivery);
		} catch (error) {
			if (
			error instanceof Error &&
			error.message === "async_continuation_expected_delivery_lock_invalid"
			) {
				return null;
			}
			throw error;
		}
	}
	return buildAsyncContinuationDeliveryReportLock(input.expectedDelivery);
}

export type PendingAsyncContinuationRegistration =
	| { status: "not_required" }
	| {
		status: "external_handoff";
		reason: string;
		effectOwner: "host_execution";
		ownership: PublicChatHostExecutionHandoffOwnershipV1;
	}
	| {
		status: "reconcile_pending";
		reason: string;
		effectOwner: "continuation_settlement" | "workflow_execution";
	}
	| { status: "invalid"; reason: string }
	| { status: "registered"; continuation: AsyncAgentContinuation; created: boolean };

/** Registration failure carrying the exact continuation that was about to be persisted. */
class ContinuationRegistrationPersistenceError extends Error {
	readonly continuation: AsyncAgentContinuation;

	constructor(cause: unknown, continuation: AsyncAgentContinuation) {
		super(cause instanceof Error ? cause.message : String(cause));
		this.name = "ContinuationRegistrationPersistenceError";
		this.continuation = structuredClone(continuation);
	}
}

export type AsyncContinuationRegistrationContext = {
	rootRequestId: string | null;
	sessionKey: string;
	projectId: string | null;
	parentContinuationId: string | null;
};

/**
 * The first continuation stage is anchored to the public turn identity owned
 * by Hono. An agents provider response is not an authority for transport
 * identity and is therefore never consulted here. Later stages are anchored
 * by their persisted parent continuation instead.
 */
export function resolveServerOwnedContinuationRequestId(
	rootRequestId: string | null,
): string | null {
	const normalized = rootRequestId?.trim() ?? "";
	return normalized || null;
}

/**
 * Every physical window belongs to the first public turn. The initial window
 * receives that identity from the route; later windows receive it from the
 * persisted parent continuation. Never mint a stage-local identity from an
 * empty transport value, otherwise a second rollover cannot be registered.
 */
export function resolveContinuationRootRequestId(input: {
	rootRequestId: string | null;
	parentRootRequestId?: string | null;
}): string | null {
	return resolveServerOwnedContinuationRequestId(input.rootRequestId)
		?? resolveServerOwnedContinuationRequestId(input.parentRootRequestId ?? null);
}

function buildAsyncContinuationRegistrationContext(input: {
	rootRequestId: string | null;
	requestInput: AgentsChatRequestDto;
	parentContinuationId?: string | null;
}): AsyncContinuationRegistrationContext {
	const sessionKey = typeof input.requestInput.sessionKey === "string"
		? input.requestInput.sessionKey.trim()
		: "";
	const projectId = typeof input.requestInput.canvasProjectId === "string"
		? input.requestInput.canvasProjectId.trim()
		: "";
	return {
		rootRequestId: resolveServerOwnedContinuationRequestId(input.rootRequestId),
		sessionKey,
		projectId: projectId || null,
		parentContinuationId: input.parentContinuationId?.trim() || null,
	};
}

function resolveContinuationRegistrationReason(
	registration: PendingAsyncContinuationRegistration,
): string {
	switch (registration.status) {
		case "registered":
			return "async_continuation_registered";
		case "external_handoff":
			return "async_external_host_execution_handoff";
		case "reconcile_pending":
			return "async_continuation_reconcile_pending";
		case "not_required":
			return "async_continuation_not_required";
		case "invalid":
			return "async_continuation_registration_invalid";
	}
}

export function recordAsyncContinuationRegistrationDiagnostic(
	result: TaskResultDto,
	registration: PendingAsyncContinuationRegistration,
	context?: AsyncContinuationRegistrationContext,
): void {
	const raw = readRecord(result.raw);
	const meta = readRecord(raw?.meta);
	if (!meta) {
		console.error("[async-agent-continuation] result meta missing; registration diagnostic not recorded", {
			registrationStatus: registration.status,
		});
		return;
	}
	meta.continuationRegistration = {
		status: registration.status,
		reason: resolveContinuationRegistrationReason(registration),
		...(registration.status === "reconcile_pending" || registration.status === "external_handoff"
			? { effectOwner: registration.effectOwner }
			: {}),
		...(registration.status === "external_handoff"
			? {
				ticketId: registration.ownership.ticketId,
				host: registration.ownership.host,
				commandCount: registration.ownership.commandCount,
				runNodeCount: registration.ownership.runNodeCount,
			}
			: {}),
		...(registration.status === "invalid"
			? { details: registration.reason }
			: {}),
	};
	const attentionStatus = registration.status === "registered"
		? registration.continuation.resumeTrigger === "replan" ? "replan" : "wait"
		: registration.status === "reconcile_pending" || registration.status === "external_handoff"
			? "wait"
			: registration.status === "invalid"
				? "repair"
				: "run_now";
	meta.attentionProjection = projectPublicAgentAttention({
		logicalTaskId: context?.rootRequestId ?? "continuation-registration",
		status: attentionStatus,
		reasonCode: resolveContinuationRegistrationReason(registration),
		obligation: null,
		physicalRunId: readRootPhysicalContinuationSuspension(meta)?.physicalRunId ?? null,
	});
	if (registration.status !== "not_required") {
		const suspension = readRootPhysicalContinuationSuspension(meta);
		const diagnostic = {
			status: registration.status,
			reason: resolveContinuationRegistrationReason(registration),
			rootRequestId: context?.rootRequestId ?? null,
			sessionKey: context?.sessionKey ?? null,
			projectId: context?.projectId ?? null,
			parentContinuationId: context?.parentContinuationId ?? null,
			physicalRunId: suspension?.physicalRunId ?? null,
			progressRevision: suspension?.progressRevision ?? null,
			...(registration.status === "registered"
				? {
					continuationId: registration.continuation.id,
					created: registration.created,
					resumeTrigger: registration.continuation.resumeTrigger,
				}
				: registration.status === "reconcile_pending"
					? { effectOwner: registration.effectOwner }
					: registration.status === "external_handoff"
						? {
							effectOwner: registration.effectOwner,
							ticketId: registration.ownership.ticketId,
							host: registration.ownership.host,
							commandCount: registration.ownership.commandCount,
							runNodeCount: registration.ownership.runNodeCount,
						}
					: {}),
			...(registration.status === "invalid"
				? { details: registration.reason }
				: {}),
		};
		if (registration.status === "registered" || registration.status === "external_handoff") {
			console.info("[async-agent-continuation] registration", diagnostic);
		} else {
			console.error("[async-agent-continuation] registration failed", diagnostic);
		}
	}
}

export function resolveAsyncContinuationPersistenceStatus(input: {
	registrationStatus: PendingAsyncContinuationRegistration["status"];
	logicalTaskStatus: string | null;
}): "completed" | "failed" {
	if (input.registrationStatus === "invalid") {
		return "failed";
	}
	return input.logicalTaskStatus === "failed" || input.logicalTaskStatus === "cancelled"
		? "failed"
		: "completed";
}

export function continuationRegistrationOwnsChatActivity(input: {
	registrationStatus: PendingAsyncContinuationRegistration["status"];
	logicalTaskStatus: string | null | undefined;
}): boolean {
	return (input.logicalTaskStatus === "active" || input.logicalTaskStatus === "waiting_external") &&
		input.registrationStatus !== "external_handoff";
}

export function resolvePublicChatDoneReason(
	status: "active" | "waiting_input" | "waiting_external" | "succeeded" | "failed" | "cancelled" | null | undefined,
): "logical_succeeded" | "logical_failed" | "physical_suspended" | "needs_input" {
	if (status === "succeeded") return "logical_succeeded";
	if (status === "failed" || status === "cancelled") return "logical_failed";
	if (status === "waiting_input") return "needs_input";
	return "physical_suspended";
}

/**
 * A suspended physical response may be published only after another durable
 * owner can prove it will continue the same logical task. Diagnostics are not
 * execution ownership: invalid/no-progress registration must not be exposed as
 * a normally finished chat stream.
 */
export function assertSuspendedContinuationOwnership(input: {
	result: TaskResultDto;
	registration: PendingAsyncContinuationRegistration;
}): void {
	const raw = readRecord(input.result.raw);
	const meta = readRecord(raw?.meta);
	const logicalTaskState = readRecord(meta?.logicalTaskState);
	const suspended = logicalTaskState?.status === "active" ||
		logicalTaskState?.status === "waiting_external";
	if (!suspended) return;
	if (
		input.registration.status === "registered" ||
		input.registration.status === "reconcile_pending" ||
		input.registration.status === "external_handoff"
	) return;
	throw new AppError("挂起的 AI 任务没有可验证的持久续跑执行者", {
		status: 503,
		code: "async_continuation_owner_missing",
		details: {
			registrationStatus: input.registration.status,
			reason: resolveContinuationRegistrationReason(input.registration),
		},
	});
}

function readArtifactIdentity(artifact: Record<string, unknown>): string | null {
	const assetType = typeof artifact.assetType === "string" ? artifact.assetType.trim() : "";
	const nodeId = typeof artifact.nodeId === "string" ? artifact.nodeId.trim() : "";
	const runId = typeof artifact.runId === "string" ? artifact.runId.trim() : "";
	const taskId = typeof artifact.taskId === "string" ? artifact.taskId.trim() : "";
	if (!assetType) return null;
	if (nodeId) return `${assetType}:node:${nodeId}`;
	if (runId) return `${assetType}:run:${runId}`;
	if (taskId) return `${assetType}:task:${taskId}`;
	return null;
}

function buildArtifactDependencyV2(
	artifact: Record<string, unknown>,
): AsyncAgentContinuationArtifactDependencyV2 | null {
	const artifactId = readArtifactIdentity(artifact);
	if (!artifactId) return null;
	const readOptionalId = (value: unknown): string | null =>
		typeof value === "string" && value.trim() ? value.trim() : null;
	const nodeId = readOptionalId(artifact.nodeId);
	const taskId = readOptionalId(artifact.taskId);
	const runId = readOptionalId(artifact.runId);
	const runProtocol = artifact.runProtocol === "video_run" || artifact.runProtocol === "workflow_execution_family"
		? artifact.runProtocol
		: runId
			? "video_run"
			: null;
	if (!nodeId && !taskId && !runId) return null;
	return { version: 2, artifactId, nodeId, taskId, runId, runProtocol };
}

export function selectNewContinuationDependencies(
	artifacts: Record<string, unknown>[],
	handledArtifactIds: string[],
): Record<string, unknown>[] {
	const handled = new Set(handledArtifactIds);
	return artifacts.filter((artifact) => {
		if (artifact.deliveryState !== "accepted_async" && artifact.deliveryState !== "materialized") {
			return false;
		}
		const identity = readArtifactIdentity(artifact);
		return Boolean(identity && !handled.has(identity));
	});
}

export function selectDurableContinuationDependencies(input: Readonly<{
	artifacts: Record<string, unknown>[];
	handledArtifactIds: string[];
	hasParentContinuation: boolean;
}>): Record<string, unknown>[] {
	const fresh = selectNewContinuationDependencies(
		input.artifacts,
		input.handledArtifactIds,
	);
	if (fresh.length > 0 || !input.hasParentContinuation) return fresh;
	return input.artifacts.filter(
		(artifact) => artifact.deliveryState === "accepted_async" && readArtifactIdentity(artifact) !== null,
	);
}

function buildContinuationProgressFingerprint(
	expected: Record<string, unknown>,
	artifacts: Record<string, unknown>[],
): string {
	const canonicalArtifacts = artifacts
		.flatMap((artifact) => {
			const identity = readArtifactIdentity(artifact);
			if (!identity) return [];
			return [{
				identity,
				deliveryState:
					typeof artifact.deliveryState === "string" ? artifact.deliveryState.trim() : "",
				taskId: typeof artifact.taskId === "string" ? artifact.taskId.trim() : "",
				runId: typeof artifact.runId === "string" ? artifact.runId.trim() : "",
				materialized:
					typeof artifact.assetUrl === "string" && artifact.assetUrl.trim().length > 0,
			}];
		})
		.sort((left, right) => left.identity.localeCompare(right.identity));
	return createHash("sha256")
		.update(JSON.stringify({
			expectedKind: typeof expected.kind === "string" ? expected.kind.trim() : "",
			artifacts: canonicalArtifacts,
		}))
		.digest("hex");
}

type RootPhysicalContinuationSuspension = {
	reasonCode: string;
	physicalRunId: string;
	progressRevision: number;
};

export function readRootPhysicalContinuationSuspension(
	meta: Record<string, unknown> | null,
): RootPhysicalContinuationSuspension | null {
	const runtime = readRecord(meta?.runtime);
	const physicalRunExit = readRecord(runtime?.physicalRunExit);
	const continuationTicket = readRecord(physicalRunExit?.continuationTicket);
	const ticketId = typeof continuationTicket?.ticketId === "string"
		? continuationTicket.ticketId.trim()
		: "";
	const ticketRevision =
		typeof continuationTicket?.taskRevision === "number" &&
		Number.isInteger(continuationTicket.taskRevision) &&
		continuationTicket.taskRevision >= 0
			? continuationTicket.taskRevision
			: null;
	const ticketReasonCode = typeof continuationTicket?.reasonCode === "string"
		? continuationTicket.reasonCode.trim()
		: "";
	if (
		physicalRunExit?.version === 1 &&
		(physicalRunExit.kind === "handoff" || physicalRunExit.kind === "replan") &&
		continuationTicket?.version === 1 &&
		continuationTicket.nextTrigger === "durable_resume" &&
		ticketId &&
		ticketRevision !== null &&
		ticketReasonCode
	) {
		return {
			reasonCode: ticketReasonCode,
			physicalRunId: ticketId,
			progressRevision: ticketRevision,
		};
	}
	const suspension = readRecord(runtime?.suspension);
	const physicalRunId = typeof suspension?.physicalRunId === "string"
		? suspension.physicalRunId.trim()
		: "";
	const progressRevision =
		typeof suspension?.progressRevision === "number" &&
		Number.isInteger(suspension.progressRevision) &&
		suspension.progressRevision >= 0
			? suspension.progressRevision
			: null;
	const reasonCode = typeof suspension?.reasonCode === "string"
		? suspension.reasonCode.trim()
		: "";
	if (
		!reasonCode ||
		!physicalRunId ||
		progressRevision === null
	) return null;
	return {
		reasonCode,
		physicalRunId,
		progressRevision,
	};
}

/**
 * A physical continuation is owned exclusively by the machine-authored run
 * terminal. Delivery kind is not a completion fact: a response-mode draft can
 * still be unsatisfied when the physical budget ends. Conversely, a succeeded
 * run never registers more work even when a stale continuation ticket remains.
 */
export function shouldRegisterPhysicalContinuation(input: {
	meta: Record<string, unknown> | null;
}): boolean {
	const meta = input.meta;
	if (!meta) return false;
	const logicalTaskState = readRecord(meta.logicalTaskState);
	const logicalTaskStatus = typeof logicalTaskState?.status === "string"
		? logicalTaskState.status.trim().toLowerCase()
		: "";
	return logicalTaskStatus === "active";
}

type PendingContinuationResumePlan =
	| {
		trigger: "dependency";
		dependencies: Record<string, unknown>[];
		artifacts: Record<string, unknown>[];
	}
	| { trigger: "physical_budget"; suspension: RootPhysicalContinuationSuspension }
	| { trigger: "invalid_dependency" }
	| { trigger: "not_required" };

/**
 * Chooses the most precise durable owner for an unfinished logical task.
 * Exact provider task tuples outrank a generic physical-window rollover.
 */
export function resolvePendingContinuationResumePlan(input: Readonly<{
	meta: Record<string, unknown> | null;
	parentContinuation?: AsyncAgentContinuation;
}>): PendingContinuationResumePlan {
	const expected = readRecord(input.meta?.expectedDelivery);
	const evidence = readRecord(input.meta?.deliveryEvidence);
	const logicalTaskState = readRecord(input.meta?.logicalTaskState);
	const logicalTaskStatus = typeof logicalTaskState?.status === "string"
		? logicalTaskState.status.trim().toLowerCase()
		: "";
	const artifacts = (Array.isArray(evidence?.artifacts) ? evidence.artifacts : [])
		.map(readRecord)
		.filter((artifact): artifact is Record<string, unknown> => artifact !== null);
	const hasSuspendedDeliveryEvidence =
		expected?.active === true &&
		(logicalTaskStatus === "active" || logicalTaskStatus === "waiting_external") &&
		evidence !== null;
	const dependencies = hasSuspendedDeliveryEvidence
		? selectDurableContinuationDependencies({
			artifacts,
			handledArtifactIds: input.parentContinuation?.handledArtifactIds ?? [],
			hasParentContinuation: Boolean(input.parentContinuation),
		})
		: [];
	if (dependencies.length > 0) return { trigger: "dependency", dependencies, artifacts };
	const suspension = readRootPhysicalContinuationSuspension(input.meta);
	if (suspension && shouldRegisterPhysicalContinuation({ meta: input.meta })) {
		return { trigger: "physical_budget", suspension };
	}
	if (hasSuspendedDeliveryEvidence) return { trigger: "invalid_dependency" };
	return { trigger: "not_required" };
}

export function collectInheritedPhysicalArtifactFrontier(
	parentContinuation: AsyncAgentContinuation | undefined,
): Readonly<{
	artifactDependencies: AsyncAgentContinuationArtifactDependencyV2[];
	materializedArtifacts: NonNullable<AsyncAgentContinuation["materializedArtifacts"]>;
	dependencyNodeIds: string[];
	dependencyTaskIds: string[];
	dependencyRunIds: string[];
}> {
	const artifactDependencies = parentContinuation?.artifactDependencies ?? [];
	return {
		artifactDependencies,
		materializedArtifacts: parentContinuation?.materializedArtifacts ?? [],
		dependencyNodeIds: readStringList([
			...(parentContinuation?.dependencyNodeIds ?? []),
			...artifactDependencies.map((dependency) => dependency.nodeId),
		]),
		dependencyTaskIds: readStringList([
			...(parentContinuation?.dependencyTaskIds ?? []),
			...artifactDependencies.map((dependency) => dependency.taskId),
		]),
		dependencyRunIds: readStringList([
			...(parentContinuation?.dependencyRunIds ?? []),
			...artifactDependencies.map((dependency) => dependency.runId),
		]),
	};
}

export function collectDurableClaimTaskArtifactFrontier(input: Readonly<{
	mediaType: "image" | "video" | "audio" | null;
	durableProgressClaims: readonly DurableProgressClaimV1[];
	taskResults: readonly TaskResultRow[];
}>): Readonly<{
	artifactDependencies: AsyncAgentContinuationArtifactDependencyV2[];
	materializedArtifacts: NonNullable<AsyncAgentContinuation["materializedArtifacts"]>;
}> {
	if (!input.mediaType) return { artifactDependencies: [], materializedArtifacts: [] };
	const taskIds = new Set(input.durableProgressClaims.flatMap((claim) => {
		const taskId = claim.key.startsWith("taskId:") ? claim.key.slice("taskId:".length).trim() : "";
		return taskId ? [taskId] : [];
	}));
	const artifactDependencies: AsyncAgentContinuationArtifactDependencyV2[] = [];
	const materializedArtifacts: NonNullable<AsyncAgentContinuation["materializedArtifacts"]> = [];
	for (const taskResult of input.taskResults) {
		if (!taskIds.has(taskResult.task_id)) continue;
		const artifactId = taskResult.node_id
			? `${input.mediaType}:node:${taskResult.node_id}`
			: `${input.mediaType}:task:${taskResult.task_id}`;
		const dependency: AsyncAgentContinuationArtifactDependencyV2 = {
			version: 2,
			artifactId,
			nodeId: taskResult.node_id,
			taskId: taskResult.task_id,
			runId: null,
		};
		const artifacts = collectTaskResultMaterializedArtifacts({
			dependency,
			taskResultJson: taskResult.result,
			taskResultNodeId: taskResult.node_id,
			observedAt: taskResult.completed_at ?? taskResult.updated_at,
		});
		if (artifacts.length === 0) continue;
		artifactDependencies.push(dependency);
		materializedArtifacts.push(...artifacts);
	}
	return { artifactDependencies, materializedArtifacts };
}

function mergeArtifactDependencies(
	...groups: readonly (readonly AsyncAgentContinuationArtifactDependencyV2[])[]
): AsyncAgentContinuationArtifactDependencyV2[] {
	const byId = new Map<string, AsyncAgentContinuationArtifactDependencyV2>();
	for (const dependency of groups.flat()) byId.set(dependency.artifactId, dependency);
	return [...byId.values()];
}

function mergeMaterializedArtifacts(
	...groups: readonly (readonly AsyncAgentContinuationMaterializedArtifactV1[])[]
): NonNullable<AsyncAgentContinuation["materializedArtifacts"]> {
	const byIdentity = new Map<string, AsyncAgentContinuationMaterializedArtifactV1>();
	for (const artifact of groups.flat()) {
		byIdentity.set(`${artifact.artifactId}\u0000${artifact.taskId}\u0000${artifact.assetUrl}`, artifact);
	}
	return [...byIdentity.values()];
}

function resolveExpectedArtifactMediaType(input: Readonly<{
	userIntentContract: Record<string, unknown> | null;
	expectedDelivery: Record<string, unknown>;
}>): "image" | "video" | "audio" | null {
	const expectedDeliveryContract = readRecord(input.expectedDelivery.deliveryContract);
	const intentDeliveryContract = readRecord(input.userIntentContract?.delivery);
	const rawMediaType = intentDeliveryContract?.mediaType ?? expectedDeliveryContract?.mediaType;
	return rawMediaType === "image" || rawMediaType === "video" || rawMediaType === "audio"
		? rawMediaType
		: null;
}

async function resolveDurableClaimTaskArtifactFrontier(input: Readonly<{
	c: AppContext;
	userId: string;
	mediaType: "image" | "video" | "audio" | null;
	durableProgressClaims: readonly DurableProgressClaimV1[];
}>): Promise<ReturnType<typeof collectDurableClaimTaskArtifactFrontier>> {
	const durableTaskIds = [...new Set(input.durableProgressClaims.flatMap((claim) => {
		const taskId = claim.key.startsWith("taskId:") ? claim.key.slice("taskId:".length).trim() : "";
		return taskId ? [taskId] : [];
	}))];
	const taskResults = await Promise.all(durableTaskIds.map((taskId) =>
		getTaskResultByTaskId(input.c.env.DB, input.userId, taskId)
	));
	return collectDurableClaimTaskArtifactFrontier({
		mediaType: input.mediaType,
		durableProgressClaims: input.durableProgressClaims,
		taskResults: taskResults.filter((row): row is TaskResultRow => row !== null),
	});
}

async function enrichContinuationWithSettledTaskArtifacts(
	c: AppContext,
	continuation: AsyncAgentContinuation,
): Promise<AsyncAgentContinuation> {
	const verifiedIntent = continuation.userIntentContract
		? verifyUserIntentContract(continuation.userIntentContract)
		: null;
	const userIntentContract = verifiedIntent?.ok ? verifiedIntent.value.contract : null;
	const mediaType = resolveExpectedArtifactMediaType({
		userIntentContract,
		expectedDelivery: continuation.expectedDelivery,
	});
	const recovered = await resolveDurableClaimTaskArtifactFrontier({
		c,
		userId: continuation.userId,
		mediaType,
		durableProgressClaims: continuation.durableProgressClaims ?? [],
	});
	const workflowArtifacts = await collectSettledWorkflowExecutionArtifacts({
		c,
		continuation,
	});
	const artifactDependencies = mergeArtifactDependencies(
		continuation.artifactDependencies ?? [],
		recovered.artifactDependencies,
	);
	const materializedArtifacts = mergeMaterializedArtifacts(
		continuation.materializedArtifacts ?? [],
		recovered.materializedArtifacts,
		workflowArtifacts,
	);
	if (artifactDependencies.length === 0 && materializedArtifacts.length === 0) return continuation;
	return {
		...continuation,
		artifactDependencies,
		materializedArtifacts,
		dependencyNodeIds: readStringList([
			...continuation.dependencyNodeIds,
			...artifactDependencies.map((dependency) => dependency.nodeId),
		]),
		dependencyTaskIds: readStringList([
			...continuation.dependencyTaskIds,
			...artifactDependencies.map((dependency) => dependency.taskId),
		]),
		dependencyRunIds: readStringList([
			...continuation.dependencyRunIds,
			...artifactDependencies.map((dependency) => dependency.runId),
		]),
	};
}

async function registerPhysicalContinuation(input: {
	c: AppContext;
	userId: string;
	rootRequestId: string | null;
	requestInput: AgentsChatRequestDto;
	taskRequest: TaskRequestDto;
	meta: Record<string, unknown>;
	suspension: RootPhysicalContinuationSuspension;
	parentContinuation?: AsyncAgentContinuation;
	trustedDesktopWorkspaceAccess?: true;
}): Promise<PendingAsyncContinuationRegistration> {
	const projectId = typeof input.requestInput.canvasProjectId === "string"
		? input.requestInput.canvasProjectId.trim()
		: "";
	const flowId = typeof input.requestInput.canvasFlowId === "string"
		? input.requestInput.canvasFlowId.trim()
		: "";
	const sessionKey = typeof input.requestInput.sessionKey === "string"
		? input.requestInput.sessionKey.trim()
		: "";
	const requestId = resolveContinuationRootRequestId({
		rootRequestId: input.rootRequestId,
		parentRootRequestId: input.parentContinuation?.rootRequestId,
	}) ?? "";
	const handledIdentity = [
		"root_physical_run",
		input.suspension.physicalRunId,
		String(input.suspension.progressRevision),
	].join(":");
	const noProgressWindow = evaluateRootPhysicalNoProgressWindow({
		handledArtifactIds: input.parentContinuation?.handledArtifactIds ?? [],
		progressRevision: input.suspension.progressRevision,
	});
	const progressFingerprint = createHash("sha256")
		.update(JSON.stringify({
			suspension: input.suspension,
			resumeTrigger: noProgressWindow.exhausted ? "replan" : "physical_budget",
		}))
		.digest("hex");
	const chapterId =
		typeof input.requestInput.chapterId === "string" && input.requestInput.chapterId.trim()
			? input.requestInput.chapterId.trim()
			: null;
	const extras = input.taskRequest.extras as Record<string, unknown>;
	const hostUserId =
		typeof extras.hostUserId === "string" && extras.hostUserId.trim()
			? extras.hostUserId.trim().slice(0, 512)
			: input.parentContinuation?.hostUserId;
	const bookId = typeof input.requestInput.bookId === "string" && input.requestInput.bookId.trim()
		? input.requestInput.bookId.trim()
		: null;
	const canvasNodeId = typeof input.requestInput.canvasNodeId === "string" && input.requestInput.canvasNodeId.trim()
		? input.requestInput.canvasNodeId.trim()
		: null;
	const expectedDelivery = readRecord(input.meta.expectedDelivery) ?? { active: false };
	const runtimeMeta = readRecord(input.meta.runtime);
	const userIntentContract =
		readRecord(runtimeMeta?.userIntentContract) ??
		input.parentContinuation?.userIntentContract ??
		null;
	const durableTaskReferences = mergeDurableTaskReferences(
		input.parentContinuation?.durableTaskReferences,
		readContinuationDurableTaskReferences(input.meta.durableTaskReferences),
	);
	const durableProgressClaims = mergeDurableProgressClaims(
		input.parentContinuation?.durableProgressClaims,
		readContinuationDurableProgressClaims(input.meta.durableProgressClaims),
	);
	const actionRecoveryFacts = pruneResolvedIntentRecoveryFacts(mergeActionRecoveryFacts(
		input.parentContinuation?.actionRecoveryFacts,
		readContinuationActionRecoveryFacts(input.meta.actionRecoveryFacts),
	), userIntentContract);
	const retrievalCandidateSets = mergeRetrievalCandidateSetReceipts(
		input.parentContinuation?.retrievalCandidateSets,
		readRetrievalCandidateSetReceipts(runtimeMeta?.retrievalCandidateSets),
	);
	const requiredSkills = mergeContinuationRequiredSkills({
		explicit: extras.requiredSkills,
		parent: input.parentContinuation?.requiredSkills,
		meta: input.meta,
	});
	const taskCapsule = buildContinuationTaskCapsule(
		input.requestInput,
		input.parentContinuation,
		input.taskRequest,
	);
	const inheritedArtifactFrontier = collectInheritedPhysicalArtifactFrontier(input.parentContinuation);
	const inheritedWorkflowArtifacts = input.parentContinuation
		? await collectSettledWorkflowExecutionArtifacts({
			c: input.c,
			continuation: input.parentContinuation,
		})
		: [];
	const recoveredArtifactFrontier = await resolveDurableClaimTaskArtifactFrontier({
		c: input.c,
		userId: input.userId,
		mediaType: resolveExpectedArtifactMediaType({ userIntentContract, expectedDelivery }),
		durableProgressClaims,
	});
	const inheritedArtifactDependencies = mergeArtifactDependencies(
		inheritedArtifactFrontier.artifactDependencies,
		recoveredArtifactFrontier.artifactDependencies,
	);
	const inheritedMaterializedArtifacts = mergeMaterializedArtifacts(
		inheritedArtifactFrontier.materializedArtifacts,
		recoveredArtifactFrontier.materializedArtifacts,
		inheritedWorkflowArtifacts,
	);
	const dependencyNodeIds = inheritedArtifactFrontier.dependencyNodeIds;
	const dependencyTaskIds = inheritedArtifactFrontier.dependencyTaskIds;
	const dependencyRunIds = readStringList([
		...collectAcceptedAsyncDurableRunIds(durableTaskReferences),
		...inheritedArtifactFrontier.dependencyRunIds,
	]);
	const ownedRepairRuns = collectOwnedAsyncRepairRuns(durableTaskReferences);
	const continuationId = buildAsyncAgentContinuationId({
		requestId,
		parentContinuationId: input.parentContinuation?.id,
		dependencyNodeIds,
		dependencyTaskIds,
		dependencyRunIds,
		ownedRepairRuns,
		progressFingerprint,
	});
	if (!sessionKey || !continuationId || (dependencyRunIds.length > 0 && (!projectId || (!flowId && !chapterId)))) {
		return {
			status: "invalid",
			reason: "physical budget continuation scope or identity is incomplete",
		};
	}
	const createdAt = new Date().toISOString();
	const continuationStage = (input.parentContinuation?.stage ?? 0) + 1;
	const continuation: AsyncAgentContinuation = {
		id: continuationId,
		rootRequestId: requestId,
		stage: continuationStage,
		resumeTrigger: noProgressWindow.exhausted ? "replan" : "physical_budget",
		parentContinuationId: input.parentContinuation?.id ?? null,
		userId: input.userId,
		...(hostUserId ? { hostUserId } : {}),
		...((input.trustedDesktopWorkspaceAccess === true || input.parentContinuation?.trustedDesktopWorkspaceAccess === true)
			? { trustedDesktopWorkspaceAccess: true as const }
			: {}),
		projectId,
		flowId,
		chapterId,
		bookId,
		canvasNodeId,
		executionToolPolicy: readContinuationExecutionToolPolicy(extras.executionToolPolicy),
		sessionKey,
		modelKey: typeof extras.modelKey === "string" && extras.modelKey.trim() ? extras.modelKey.trim() : null,
		modelAlias: typeof extras.modelAlias === "string" && extras.modelAlias.trim() ? extras.modelAlias.trim() : null,
		requiredSkills,
		...(ownedRepairRuns.length > 0 ? { ownedRepairRuns } : {}),
		...(inheritedArtifactDependencies.length > 0
			? { artifactDependencies: inheritedArtifactDependencies }
			: {}),
		...(inheritedMaterializedArtifacts.length > 0
			? { materializedArtifacts: inheritedMaterializedArtifacts }
			: {}),
		dependencyNodeIds,
		dependencyTaskIds,
		dependencyRunIds,
		handledArtifactIds: [...new Set([
			...(input.parentContinuation?.handledArtifactIds ?? []),
			handledIdentity,
		])].sort(),
		progressFingerprint,
		expectedDelivery,
		...(userIntentContract ? { userIntentContract } : {}),
		...(durableTaskReferences.length > 0 ? { durableTaskReferences } : {}),
		...(durableProgressClaims.length > 0 ? { durableProgressClaims } : {}),
		...(actionRecoveryFacts.length > 0 ? { actionRecoveryFacts } : {}),
		...(retrievalCandidateSets.length > 0 ? { retrievalCandidateSets } : {}),
		...(taskCapsule ? { taskCapsule } : {}),
		createdAt,
		attempt: 0,
		nextAttemptAt: resolvePhysicalContinuationNextAttemptAt({
			reasonCode: input.suspension.reasonCode,
			stage: continuationStage,
			nowMs: Date.parse(createdAt),
		}),
		lastFailure: null,
	};
	let registered: boolean;
	try {
		registered = await registerAsyncAgentContinuation(input.c, continuation);
	} catch (error: unknown) {
		throw new ContinuationRegistrationPersistenceError(error, continuation);
	}
	return { status: "registered", continuation, created: registered };
}

/**
 * Persists the next durable stage only when the generic delivery contract is
 * still incomplete and this turn introduced a previously unseen async asset
 * identity. Prompt text, node labels and skill names never participate.
 */
async function registerPendingAsyncContinuation(input: {
	c: AppContext;
	userId: string;
	rootRequestId: string | null;
	requestInput: AgentsChatRequestDto;
	taskRequest: TaskRequestDto;
	result: TaskResultDto;
	parentContinuation?: AsyncAgentContinuation;
	trustedDesktopWorkspaceAccess?: true;
}): Promise<PendingAsyncContinuationRegistration> {
	const raw = readRecord(input.result.raw);
	const meta = readRecord(raw?.meta);
	const expected = readRecord(meta?.expectedDelivery);
	const hostExecutionHandoff = readPublicChatHostExecutionHandoffOwnership(meta);
	if (
		!input.parentContinuation &&
		hostExecutionHandoff &&
		shouldRegisterPhysicalContinuation({ meta })
	) {
		return {
			status: "external_handoff",
			reason: "the declared external host owns the emitted canvas commands and evidence boundary",
			effectOwner: "host_execution",
			ownership: hostExecutionHandoff,
		};
	}
	const resumePlan = resolvePendingContinuationResumePlan({
		meta,
		...(input.parentContinuation ? { parentContinuation: input.parentContinuation } : {}),
	});
	// An accepted provider task is the most precise durable owner available. It
	// must win over a generic physical-window rollover so the host waits on the
	// exact task tuple instead of opening another model window that can repeat
	// presentation or lose the eventual materialized asset.
	if (resumePlan.trigger !== "dependency") {
		if (resumePlan.trigger === "physical_budget" && meta) {
			return registerPhysicalContinuation({
				c: input.c,
				userId: input.userId,
				rootRequestId: input.rootRequestId,
				requestInput: input.requestInput,
				taskRequest: input.taskRequest,
				meta,
				suspension: resumePlan.suspension,
				...(input.parentContinuation ? { parentContinuation: input.parentContinuation } : {}),
				...(input.trustedDesktopWorkspaceAccess ? { trustedDesktopWorkspaceAccess: true as const } : {}),
			});
		}
		if (resumePlan.trigger === "not_required") return { status: "not_required" };
		return {
			status: "invalid",
			reason: "suspended delivery has no addressable canvas dependency",
		};
	}
	const dependencies = resumePlan.dependencies;
	const artifacts = resumePlan.artifacts;
	// Waiting on an already accepted provider job is durable progress ownership,
	// not a failed/no-progress task. Re-register the exact same immutable
	// artifact tuple under a new parent stage so the sweep can probe it again;
	// no paid submission is replayed and the stable task/run identity remains
	// the only authority. The sweep cadence provides the waiting boundary.
	const dependencyNodeIds = readStringList(dependencies.map((artifact) => artifact.nodeId));
	const dependencyRunIds = readStringList(dependencies.map((artifact) => artifact.runId));
	if (dependencyNodeIds.length === 0 && dependencyRunIds.length === 0) {
		return {
			status: "invalid",
			reason: "async dependency is missing a stable canvas nodeId or durable runId",
		};
	}
	const projectId = typeof input.requestInput.canvasProjectId === "string"
		? input.requestInput.canvasProjectId.trim()
		: "";
	const flowId = typeof input.requestInput.canvasFlowId === "string"
		? input.requestInput.canvasFlowId.trim()
		: "";
	const chapterId =
		typeof input.requestInput.chapterId === "string" && input.requestInput.chapterId.trim()
			? input.requestInput.chapterId.trim()
			: null;
	const sessionKey = typeof input.requestInput.sessionKey === "string"
		? input.requestInput.sessionKey.trim()
		: "";
	const requestId = resolveContinuationRootRequestId({
		rootRequestId: input.rootRequestId,
		parentRootRequestId: input.parentContinuation?.rootRequestId,
	}) ?? "";
	const dependencyTaskIds = readStringList(dependencies.map((artifact) => artifact.taskId));
	const artifactDependencies = dependencies
		.map(buildArtifactDependencyV2)
		.filter((dependency): dependency is AsyncAgentContinuationArtifactDependencyV2 => dependency !== null);
	if (artifactDependencies.length !== dependencies.length) {
		return {
			status: "invalid",
			reason: "async dependency is missing an exact artifact tuple",
		};
	}
	const durableTaskReferences = mergeDurableTaskReferences(
		input.parentContinuation?.durableTaskReferences,
		readContinuationDurableTaskReferences(meta?.durableTaskReferences),
	);
	const ownedRepairRuns = collectOwnedAsyncRepairRuns(durableTaskReferences);
	const progressFingerprint = buildContinuationProgressFingerprint(expected, artifacts);
	const continuationId = buildAsyncAgentContinuationId({
		requestId,
		parentContinuationId: input.parentContinuation?.id,
		dependencyNodeIds,
		dependencyTaskIds,
		dependencyRunIds,
		ownedRepairRuns,
		progressFingerprint,
	});
	if (!projectId || (!flowId && !chapterId) || !sessionKey || !continuationId) {
		return {
			status: "invalid",
			reason: "async continuation scope or identity is incomplete",
		};
	}
	const extras = input.taskRequest.extras as Record<string, unknown>;
	const hostUserId =
		typeof extras.hostUserId === "string" && extras.hostUserId.trim()
			? extras.hostUserId.trim().slice(0, 512)
			: input.parentContinuation?.hostUserId;
	const bookId = typeof input.requestInput.bookId === "string" && input.requestInput.bookId.trim()
		? input.requestInput.bookId.trim()
		: null;
	const canvasNodeId = typeof input.requestInput.canvasNodeId === "string" && input.requestInput.canvasNodeId.trim()
		? input.requestInput.canvasNodeId.trim()
		: null;
	const newArtifactIds = dependencies
		.map(readArtifactIdentity)
		.filter((identity): identity is string => identity !== null);
	const durableProgressClaims = mergeDurableProgressClaims(
		input.parentContinuation?.durableProgressClaims,
		readContinuationDurableProgressClaims(meta?.durableProgressClaims),
	);
	const runtimeMeta = readRecord(meta?.runtime);
	const userIntentContract =
		readRecord(runtimeMeta?.userIntentContract) ??
		input.parentContinuation?.userIntentContract ??
		null;
	const actionRecoveryFacts = pruneResolvedIntentRecoveryFacts(mergeActionRecoveryFacts(
		input.parentContinuation?.actionRecoveryFacts,
		readContinuationActionRecoveryFacts(meta?.actionRecoveryFacts),
	), userIntentContract);
	const requiredSkills = mergeContinuationRequiredSkills({
		explicit: extras.requiredSkills,
		parent: input.parentContinuation?.requiredSkills,
		meta: meta ?? {},
	});
	const taskCapsule = buildContinuationTaskCapsule(
		input.requestInput,
		input.parentContinuation,
		input.taskRequest,
	);
	const continuation: AsyncAgentContinuation = {
		id: continuationId,
		rootRequestId: requestId,
		stage: (input.parentContinuation?.stage ?? 0) + 1,
		resumeTrigger: "dependency",
		parentContinuationId: input.parentContinuation?.id ?? null,
		userId: input.userId,
		...(hostUserId ? { hostUserId } : {}),
		...((input.trustedDesktopWorkspaceAccess === true || input.parentContinuation?.trustedDesktopWorkspaceAccess === true)
			? { trustedDesktopWorkspaceAccess: true as const }
			: {}),
		projectId,
		flowId,
		chapterId,
		bookId,
		canvasNodeId,
		executionToolPolicy: readContinuationExecutionToolPolicy(extras.executionToolPolicy),
		sessionKey,
		modelKey: typeof extras.modelKey === "string" && extras.modelKey.trim() ? extras.modelKey.trim() : null,
		modelAlias: typeof extras.modelAlias === "string" && extras.modelAlias.trim() ? extras.modelAlias.trim() : null,
		requiredSkills,
		...(ownedRepairRuns.length > 0 ? { ownedRepairRuns } : {}),
		artifactDependencies,
		dependencyNodeIds,
		dependencyTaskIds,
		dependencyRunIds,
		handledArtifactIds: [...new Set([
			...(input.parentContinuation?.handledArtifactIds ?? []),
			...newArtifactIds,
		])].sort(),
		progressFingerprint,
		expectedDelivery: expected,
		...(userIntentContract ? { userIntentContract } : {}),
		...(durableTaskReferences.length > 0 ? { durableTaskReferences } : {}),
		...(durableProgressClaims.length > 0 ? { durableProgressClaims } : {}),
		...(actionRecoveryFacts.length > 0 ? { actionRecoveryFacts } : {}),
		...(taskCapsule ? { taskCapsule } : {}),
		createdAt: new Date().toISOString(),
		attempt: 0,
		nextAttemptAt: null,
		lastFailure: null,
	};
	let registered: boolean;
	try {
		registered = await registerAsyncAgentContinuation(input.c, continuation);
	} catch (error: unknown) {
		throw new ContinuationRegistrationPersistenceError(error, continuation);
	}
	// 新依赖已在本回合真实物化时无需等下一次 reconcile；CAS 领取并续跑同一会话。
	const allMaterialized = dependencies.length > 0 && dependencies.every(
		(artifact) => artifact.deliveryState === "materialized",
	);
	if (!allMaterialized || !registered) {
		return { status: "registered", continuation, created: registered };
	}
	await scheduleAsyncAgentContinuations(input.c, [continuation]);
	return { status: "registered", continuation, created: registered };
}

export async function scheduleAsyncAgentContinuations(
	_c: AppContext,
	continuations: AsyncAgentContinuation[],
): Promise<number> {
	return enqueueAsyncAgentContinuations(continuations);
}

async function scheduleRegisteredPhysicalBudgetContinuation(
	c: AppContext,
	registration: PendingAsyncContinuationRegistration,
): Promise<boolean> {
	if (
		registration.status !== "registered" ||
		!registration.created ||
		!isRootPhysicalBudgetContinuation(registration.continuation)
	) return false;
	return (await scheduleAsyncAgentContinuations(c, [registration.continuation])) === 1;
}

export type PersistedAgentsChatTaskResult = Readonly<{
	result: TaskResultDto;
	response: AgentsChatResponseDto;
}>;

type PostResultProjectionStep =
	| "continuation_registration"
	| "publication_outbox"
	| "trace_finalization"
	| "conversation_publication"
	| "realtime_broadcast"
	| "continuation_scheduling";

function recordPostResultProjectionFailure(input: {
	result: TaskResultDto;
	step: PostResultProjectionStep;
	error: unknown;
}): void {
	const raw = readRecord(input.result.raw);
	const meta = readRecord(raw?.meta);
	const message = input.error instanceof Error ? input.error.message : String(input.error);
	if (meta) {
		const current = Array.isArray(meta.postResultProjectionFailures)
			? meta.postResultProjectionFailures.filter((item): item is Record<string, unknown> =>
				Boolean(item && typeof item === "object" && !Array.isArray(item)))
			: [];
		meta.postResultProjectionFailures = [
			...current,
			{ step: input.step, message: message.slice(0, 1_000), recordedAt: new Date().toISOString() },
		].slice(-16);
	}
	console.error("[public-agents-chat] post-result projection degraded", {
		step: input.step,
		error: message,
	});
}

async function persistContinuationRegistrationSettlementFailure(input: {
	c: AppContext;
	userId: string;
	rootRequestId: string;
	result: TaskResultDto;
	error: unknown;
	requestInput: AgentsChatRequestDto;
	taskRequest: TaskRequestDto;
	recoveryContinuation?: AsyncAgentContinuation;
}): Promise<void> {
	const raw = readRecord(input.result.raw);
	const meta = readRecord(raw?.meta);
	const suspension = meta ? readRootPhysicalContinuationSuspension(meta) : null;
	const runtime = meta ? readRecord(meta.runtime) : null;
	const intent = runtime ? readRecord(runtime.userIntentContract) : null;
	const physicalRunId = suspension?.physicalRunId ?? null;
	const logicalTaskId = typeof intent?.logicalTaskId === "string" && intent.logicalTaskId.trim()
		? intent.logicalTaskId.trim()
		: input.rootRequestId;
	const effectId = buildContinuationSettlementEffectId({
		rootRequestId: input.rootRequestId,
		settlementIdentity: input.recoveryContinuation?.id ?? physicalRunId ?? input.result.id,
	});
	const message = input.error instanceof Error ? input.error.message : String(input.error);
	const recoveryCapsule = input.recoveryContinuation
		? { version: 1 as const, continuation: structuredClone(input.recoveryContinuation) }
		: undefined;
	await persistContinuationSettlementFailure({
		c: input.c,
		userId: input.userId,
			record: createContinuationSettlementRecord({
				effectId,
				userId: input.userId,
			logicalTaskId,
			publicTurnId: input.rootRequestId,
			physicalRunId,
			nowIso: new Date().toISOString(),
			lastError: message,
			...(recoveryCapsule ? { recoveryCapsule } : {}),
		}),
	});
}

async function runPostResultProjection(input: {
	result: TaskResultDto;
	step: PostResultProjectionStep;
	operation: () => Promise<void>;
}): Promise<boolean> {
	try {
		await input.operation();
		return true;
	} catch (error: unknown) {
		recordPostResultProjectionFailure({ result: input.result, step: input.step, error });
		return false;
	}
}

/**
 * Starts one Agent physical run through the same durable trace, continuation
 * registration and terminal projection contract used by public chat.
 * Conversation publication remains the caller's responsibility.
 */
export async function runPersistedAgentsChatTask(input: Readonly<{
	c: AppContext;
	userId: string;
	rootRequestId: string;
	requestInput: AgentsChatRequestDto;
	taskRequest: TaskRequestDto;
	abortSignal?: AbortSignal;
	onStreamEvent?: AgentsBridgeStreamObserver;
	trustedPublicContinuation?: true;
	trustedInternalExecution?: true;
	/** Internal-only: allowlisted Tanva packaged desktop workspace execution. */
	trustedDesktopWorkspaceAccess?: true;
	directForcedAgentExecution?: true;
}>): Promise<PersistedAgentsChatTaskResult> {
	const taskExtras = readRecord(input.taskRequest.extras);
	const continuationExecutionContract = parseContinuationExecutionContract(
		taskExtras?.continuationExecutionContract,
	);
	let executionRecorder: PublicChatExecutionRecorder | null = null;
	const activityProjectId = input.requestInput.canvasProjectId ?? "";
	let durableContinuationOwnsActivity = false;
	try {
		markChatTurnActive(activityProjectId);
		executionRecorder = await startPublicChatExecutionRecorder({
			c: input.c,
			userId: input.userId,
			traceId: input.rootRequestId,
			request: input.requestInput,
			rootTraceId: input.rootRequestId,
			logicalTaskId: input.rootRequestId,
			...(continuationExecutionContract
				? {
					recoveryContext: {
						continuationExecutionContract,
					},
				}
				: {}),
		});
		await resetRequestedConversation(input.c, input.userId, input.requestInput);
		const result = await runAgentsBridgeChatTask(
			input.c,
			input.userId,
			input.taskRequest,
			{
				...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
				...(input.trustedPublicContinuation
					? { trustedPublicContinuation: true as const }
					: {}),
				...(input.trustedInternalExecution
					? { trustedInternalExecution: true as const }
					: {}),
				...(input.trustedDesktopWorkspaceAccess
					? { trustedDesktopWorkspaceAccess: true as const }
					: {}),
				...(input.directForcedAgentExecution
					? { directForcedAgentExecution: true as const }
					: {}),
				onStreamEvent: async (event) => {
					touchChatTurn(activityProjectId);
					await executionRecorder?.recordBridgeEvent(event);
					await input.onStreamEvent?.(event);
				},
			},
		);
		let registration: PendingAsyncContinuationRegistration;
		try {
			registration = await registerPendingAsyncContinuation({
				c: input.c,
				userId: input.userId,
				rootRequestId: input.rootRequestId,
				requestInput: input.requestInput,
				taskRequest: input.taskRequest,
				result,
				...(input.trustedDesktopWorkspaceAccess
					? { trustedDesktopWorkspaceAccess: true as const }
					: {}),
			});
		} catch (error: unknown) {
			recordPostResultProjectionFailure({
				result,
				step: "continuation_registration",
				error,
			});
			try {
				await persistContinuationRegistrationSettlementFailure({
					c: input.c,
					userId: input.userId,
					rootRequestId: input.rootRequestId,
					result,
					error,
					requestInput: input.requestInput,
					taskRequest: input.taskRequest,
					...(error instanceof ContinuationRegistrationPersistenceError
						? { recoveryContinuation: error.continuation }
						: {}),
				});
			} catch (settlementError: unknown) {
				recordPostResultProjectionFailure({ result, step: "continuation_registration", error: settlementError });
				throw settlementError;
			}
			registration = error instanceof ContinuationRegistrationPersistenceError
				? {
					status: "reconcile_pending",
					reason: "continuation registration is owned by durable settlement recovery",
					effectOwner: "continuation_settlement",
				}
				: {
					status: "invalid",
					reason: "continuation registration failed before a recoverable continuation existed",
				};
		}
		const resultMeta = readRecord(readRecord(result.raw)?.meta);
		if (
			input.trustedInternalExecution === true
			&& input.directForcedAgentExecution === true
			&& resultMeta
			&& shouldRegisterPhysicalContinuation({ meta: resultMeta })
			&& (registration.status === "invalid" || registration.status === "not_required")
		) {
			// Internal Workflow Agent nodes already have a durable owner: ExecutionDO
			// persists the suspended node result as waiting_external and re-enters the
			// exact Agent session from the immutable node attempt. Requiring a second
			// public-chat continuation record here creates two competing schedulers and
			// previously converted a recoverable provider interruption into whole-run
			// failure. This ownership projection is allowed only for the authenticated,
			// direct forced-Agent path; ordinary public chat still requires registration.
			registration = {
				status: "reconcile_pending",
				reason: "durable workflow execution owns the suspended Agent node",
				effectOwner: "workflow_execution",
			};
		}
		recordAsyncContinuationRegistrationDiagnostic(
			result,
			registration,
			buildAsyncContinuationRegistrationContext({
				rootRequestId: input.rootRequestId,
				requestInput: input.requestInput,
			}),
		);
		assertSuspendedContinuationOwnership({ result, registration });
		await runPostResultProjection({
			result,
			step: "continuation_scheduling",
			operation: async () => {
				await scheduleRegisteredPhysicalBudgetContinuation(input.c, registration);
			},
		});
		const response = buildAgentsChatResponseFromTaskResult(result, {
			publicTurnId: input.rootRequestId,
		});
		durableContinuationOwnsActivity = continuationRegistrationOwnsChatActivity({
			registrationStatus: registration.status,
			logicalTaskStatus: response.trace?.logicalTaskState?.status,
		});
		await runPostResultProjection({
			result,
			step: "trace_finalization",
			operation: async () => {
				await executionRecorder?.finishSucceeded(response, result);
			},
		});
		return { result, response };
	} catch (error: unknown) {
		await executionRecorder?.finishFailed(error, Boolean(input.abortSignal?.aborted));
		if (isExecutionTraceIdentityAlreadyUsed(error)) {
			throw publicChatTurnAlreadyExistsError(input.rootRequestId);
		}
		throw error;
	} finally {
		if (!durableContinuationOwnsActivity) markChatTurnEnded(activityProjectId);
	}
}

export async function sweepReadyAsyncAgentContinuations(
	c: AppContext,
	options?: {
		limit?: number;
		executeSettlementRecovery?: (capsule: ContinuationSettlementRecoveryCapsuleV1) => Promise<void>;
	},
): Promise<{
	scanned: number;
	recoveredClaims: number;
	claimed: number;
	failed: number;
	scheduled: number;
	settlementRecovered: number;
	settlementFailed: number;
	settlementScheduled: number;
	errors: Array<{ continuationId: string; message: string }>;
	publication: {
		scanned: number;
		published: number;
		failed: number;
		invalid: number;
		recoveredClaims: number;
	};
}> {
	const settlementRecords = await claimContinuationSettlementReconciliation(
		c,
		Math.min(options?.limit ?? 100, 4),
	);
	let settlementRecovered = 0;
	let settlementFailed = 0;
	let settlementScheduled = 0;
	if (settlementRecords.length > 0 && options?.executeSettlementRecovery) {
		for (const record of settlementRecords) {
			const outcome = await executeContinuationSettlementRecoveryCapsule({
				c,
				record,
				execute: options.executeSettlementRecovery,
			});
			if (outcome === "settled") settlementRecovered += 1;
			if (outcome === "failed") settlementFailed += 1;
		}
	} else if (settlementRecords.length > 0) {
		try {
			settlementScheduled = await enqueueContinuationSettlementRecoveries(settlementRecords);
		} catch (error: unknown) {
			await Promise.all(settlementRecords.map((record) =>
				deferContinuationSettlementRecovery({ c, record, error })));
			throw error;
		}
	}
	const [sweep, publication] = await Promise.all([
		claimReadyAsyncAgentContinuationsAcrossFlows({
			c,
			limit: options?.limit ?? 100,
			claimReady: false,
		}),
		sweepAgentsChatPublications({ c, limit: options?.limit ?? 100 }),
	]);
	const scheduled = await scheduleAsyncAgentContinuations(c, sweep.continuations);
	return {
		scanned: sweep.scanned,
		recoveredClaims: sweep.recoveredClaims,
		claimed: sweep.claimed,
		failed: sweep.failed,
		scheduled,
		settlementRecovered,
		settlementFailed,
		settlementScheduled,
		errors: sweep.errors,
		publication,
	};
}

/** Runs the same bridge, persistence and SSE publication path after async prerequisites materialize. */
export async function runAsyncAgentContinuation(
	c: AppContext,
	continuation: AsyncAgentContinuation,
): Promise<void> {
	const evidenceEnrichedContinuation = await enrichContinuationWithSettledTaskArtifacts(
		c,
		continuation,
	);
	if (evidenceEnrichedContinuation !== continuation) {
		const persisted = await transitionClaimedTaskStatus(c.env.DB, {
			taskId: evidenceEnrichedContinuation.id,
			provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
			userId: evidenceEnrichedContinuation.userId,
			status: "claimed",
			data: evidenceEnrichedContinuation,
			claimToken: evidenceEnrichedContinuation.claimToken,
			completedAt: null,
			nowIso: new Date().toISOString(),
		});
		if (!persisted) throw new Error("async_continuation_claim_lease_lost");
		Object.assign(continuation, evidenceEnrichedContinuation);
	}
	const executionTraceId = buildAsyncAgentContinuationExecutionTraceId({
		continuationId: continuation.id,
		attempt: continuation.attempt,
	});
	const continuationExecutionContract = resolveContinuationExecutionContract(continuation);
	const conversationId = deriveChatConversationId(continuation.userId, continuation.sessionKey);
	const modelKey = continuation.modelKey ?? continuation.modelAlias;
	let billing: ChatBillingHandle | null = null;
	let bridgeResultReceived = false;
	let continuationCompleted = false;
	let executionRecorder: PublicChatExecutionRecorder | null = null;
	const activityProjectId = continuation.projectId ?? "";
	let continuationKeepsActivity = false;
	const leaseAbort = new AbortController();
	let leaseLostError: Error | null = null;
	let heartbeatInFlight = false;
	const previousContinuationId = c.get("activeAsyncContinuationId");
	const previousContinuationClaimToken = c.get("activeAsyncContinuationClaimToken");
	c.set("activeAsyncContinuationId", continuation.id);
	c.set("activeAsyncContinuationClaimToken", continuation.claimToken);
	const leaseHeartbeat = setInterval(() => {
		if (heartbeatInFlight || leaseLostError) return;
		heartbeatInFlight = true;
		void touchClaimedTaskStatus(c.env.DB, {
			taskId: continuation.id,
			provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
			claimToken: continuation.claimToken,
			nowIso: new Date().toISOString(),
		}).then((touched) => {
			if (touched) return;
			leaseLostError = new Error("async_continuation_claim_lease_lost");
			leaseAbort.abort(leaseLostError);
		}).catch((error: unknown) => {
			leaseLostError = new Error(
				`async_continuation_claim_heartbeat_failed:${error instanceof Error ? error.message : String(error)}`,
			);
			leaseAbort.abort(leaseLostError);
			console.error("[async-agent-continuation] claim heartbeat failed", {
				continuationId: continuation.id,
				error: leaseLostError.message,
			});
		}).finally(() => {
			heartbeatInFlight = false;
		});
	}, 30_000);
	try {
		// All machine-owned continuation preparation must live inside the same
		// settlement boundary as billing and bridge execution. A malformed frozen
		// contract or request capsule is a deterministic pre-execution failure: it
		// must terminalize the claimed continuation instead of escaping while the
		// durable row remains claimed and the queue replays it forever.
		const prompt = buildAsyncAgentContinuationPrompt(
			continuation,
			isRootPhysicalBudgetContinuation(continuation) ? "physical_budget" : "dependency",
		);
		const requestCandidate = buildAsyncAgentContinuationRequestCandidate({
			continuation,
			prompt,
		});
		const trustedIntentContext = buildTrustedContinuationIntentContext(
			continuation.userIntentContract,
		);
		const parsedRequest = AgentsChatRequestSchema.safeParse(requestCandidate);
		if (!parsedRequest.success) {
			const issues = parsedRequest.error.issues.map((issue) => ({
				code: issue.code,
				path: issue.path.map(String).join(".") || "<root>",
				message: issue.message,
			}));
			const error = new Error(
				`async_continuation_request_facts_invalid:${JSON.stringify(issues)}`,
			) as Error & { code: string };
			error.code = "async_continuation_request_facts_invalid";
			throw error;
		}
		const requestInput: AgentsChatRequestDto = parsedRequest.data;
		const taskRequest = buildTaskRequest(requestInput);
		Object.assign(taskRequest.extras as Record<string, unknown>, trustedIntentContext);
		if (continuation.hostUserId) {
			(taskRequest.extras as Record<string, unknown>).hostUserId = continuation.hostUserId;
		}
		if (continuationExecutionContract) {
			Object.assign(taskRequest.extras as Record<string, unknown>, {
				continuationExecutionContract,
				...(typeof continuationExecutionContract.outputContract !== "undefined"
					? { outputContract: continuationExecutionContract.outputContract }
					: {}),
				...(typeof continuationExecutionContract.responseFormat !== "undefined"
					? { responseFormat: continuationExecutionContract.responseFormat }
					: {}),
				...(typeof continuationExecutionContract.maxOutputTokens === "number"
					? { maxOutputTokens: continuationExecutionContract.maxOutputTokens }
					: {}),
				...(continuationExecutionContract.reasoningEffort
					? { reasoningEffort: continuationExecutionContract.reasoningEffort }
					: {}),
				...(continuationExecutionContract.retrievalUserRequest
					? { retrievalUserRequest: continuationExecutionContract.retrievalUserRequest }
					: {}),
				...(continuationExecutionContract.retrievalContext
					? { retrievalContext: continuationExecutionContract.retrievalContext }
					: {}),
			});
		}
		// The continuation checkpoint is machine-owned execution state. It remains
		// available to the agent, but must never be projected as a new user message.
		(taskRequest.extras as Record<string, unknown>).suppressUserTurnProjection = true;
		// Physical continuations are multiple execution windows of one logical
		// public turn. Keep the root identity stable so status recovery updates one
		// progress card instead of appending a new card for every window.
		(taskRequest.extras as Record<string, unknown>).publicTurnId =
			continuation.rootRequestId ?? continuation.id;
		const immutableRetrievalRequest = continuation.taskCapsule?.goal.trim() ?? "";
		if (immutableRetrievalRequest) {
			(taskRequest.extras as Record<string, unknown>).retrievalUserRequest =
				immutableRetrievalRequest;
		}
		if (continuation.durableTaskReferences && continuation.durableTaskReferences.length > 0) {
			(taskRequest.extras as Record<string, unknown>).durableTaskReferences =
				continuation.durableTaskReferences;
		}
		if (continuation.requiredSkills.length > 0) {
			(taskRequest.extras as Record<string, unknown>).requiredSkills = continuation.requiredSkills;
		}
		if (continuation.retrievalCandidateSets && continuation.retrievalCandidateSets.length > 0) {
			(taskRequest.extras as Record<string, unknown>).retrievalCandidateSets =
				continuation.retrievalCandidateSets;
		}
		if (continuation.actionRecoveryFacts && continuation.actionRecoveryFacts.length > 0) {
			(taskRequest.extras as Record<string, unknown>).actionRecoveryFacts =
				continuation.actionRecoveryFacts;
		}
		if (continuation.materializedArtifacts && continuation.materializedArtifacts.length > 0) {
			(taskRequest.extras as Record<string, unknown>).trustedMaterializedArtifacts =
				continuation.materializedArtifacts;
		}
		(taskRequest.extras as Record<string, unknown>).billingConversationId = conversationId;
		markChatTurnActive(activityProjectId);
		billing = await beginChatBilling(c, continuation.userId, {
			conversationId,
			sinceMs: Date.now(),
			modelKey,
			// A durable continuation keeps the root/public turn identity, but every
			// physical claim is a separately billable model execution. Reusing the
			// root id here collides with the root turn's immutable reservation and
			// prevents the continuation from ever reaching agents-cli.
			effectId: executionTraceId,
			allowExistingReservation: true,
		});
		executionRecorder = await startPublicChatExecutionRecorder({
			c,
			userId: continuation.userId,
			traceId: executionTraceId,
			request: requestInput,
			executionKind: "continuation",
			parentTraceId: continuation.parentContinuationId ?? continuation.rootRequestId ?? null,
			rootTraceId: continuation.rootRequestId ?? continuation.parentContinuationId ?? continuation.id,
			logicalTaskId: continuation.rootRequestId ?? continuation.parentContinuationId ?? continuation.id,
			physicalRunId: executionTraceId,
			...(continuationExecutionContract
				? { recoveryContext: { continuationExecutionContract } }
				: {}),
		});
		const result = await runAgentsBridgeChatTask(c, continuation.userId, taskRequest, {
			trustedPublicContinuation: true,
			trustedInternalExecution: true,
			...(continuation.trustedDesktopWorkspaceAccess
				? { trustedDesktopWorkspaceAccess: true as const }
				: {}),
			deniedRemoteTools: resolveAsyncContinuationDeniedRemoteTools(continuation),
			...(continuationExecutionContract?.directForcedAgentExecution
				? { directForcedAgentExecution: true as const }
				: {}),
			abortSignal: leaseAbort.signal,
			onStreamEvent: (event) => {
				touchChatTurn(activityProjectId);
				return executionRecorder?.recordBridgeEvent(event);
			},
		});
		if (leaseLostError) throw leaseLostError;
		bridgeResultReceived = true;
		let registration: PendingAsyncContinuationRegistration;
		try {
			registration = await registerPendingAsyncContinuation({
				c,
				userId: continuation.userId,
				rootRequestId: null,
				requestInput,
				taskRequest,
				result,
				parentContinuation: continuation,
			});
		} catch (error: unknown) {
			recordPostResultProjectionFailure({
				result,
				step: "continuation_registration",
				error,
			});
			try {
				await persistContinuationRegistrationSettlementFailure({
					c,
					userId: continuation.userId,
					rootRequestId: continuation.rootRequestId ?? continuation.id,
					result,
					error,
					requestInput,
					taskRequest,
					...(error instanceof ContinuationRegistrationPersistenceError
						? { recoveryContinuation: error.continuation }
						: {}),
				});
			} catch (settlementError: unknown) {
				recordPostResultProjectionFailure({
					result,
					step: "continuation_registration",
					error: settlementError,
				});
				throw settlementError;
			}
			registration = error instanceof ContinuationRegistrationPersistenceError
				? {
					status: "reconcile_pending",
					reason: "continuation registration is owned by durable settlement recovery",
					effectOwner: "continuation_settlement",
				}
				: {
					status: "invalid",
					reason: "continuation registration failed before a recoverable continuation existed",
				};
		}
		recordAsyncContinuationRegistrationDiagnostic(
			result,
			registration,
			buildAsyncContinuationRegistrationContext({
				rootRequestId: registration.status === "registered"
					? registration.continuation.rootRequestId ?? continuation.rootRequestId ?? null
					: continuation.rootRequestId ?? null,
				requestInput,
				parentContinuationId: continuation.id,
			}),
		);
		assertSuspendedContinuationOwnership({ result, registration });
		await runPostResultProjection({
			result,
			step: "continuation_scheduling",
			operation: async () => {
				await scheduleRegisteredPhysicalBudgetContinuation(c, registration);
			},
		});
		const continuationPublicTurnId = continuation.rootRequestId ?? continuation.id;
		const response = buildAgentsChatResponseFromTaskResult(result, {
			publicTurnId: continuationPublicTurnId,
		});
		continuationKeepsActivity = response.trace?.logicalTaskState?.status === "active";
		const publicationMode = resolveAsyncContinuationConversationPublication(
			response.trace?.logicalTaskState?.status,
		);
		const publicationInput = buildAsyncContinuationPublicationInput(requestInput);
		const requestedContinuationStatus = resolveAsyncContinuationPersistenceStatus({
			registrationStatus: registration.status,
			logicalTaskStatus: response.trace?.logicalTaskState?.status ?? null,
		});
		const continuationSettlement = await completeAsyncAgentContinuation({
			c,
			continuation,
			status: requestedContinuationStatus,
		});
		if (!continuationSettlement.terminalized && !continuationSettlement.deferred) {
			throw new Error("async_continuation_claim_superseded_before_settlement");
		}
		continuationCompleted = true;
		if (
			continuationSettlement.terminalized &&
			requestedContinuationStatus === "completed" &&
			continuationSettlement.status === "failed"
		) {
			const error = new Error("async_continuation_delivery_unsatisfied_after_execution");
			await executionRecorder.finishFailed(error);
			throw error;
		}
		let publicationContract: AgentsChatPublicationContractV1 | null = null;
		try {
			publicationContract = await registerAgentsChatPublication({
				c,
				userId: continuation.userId,
				publicationId: executionTraceId,
				publicTurnId: continuationPublicTurnId,
				publicationMode,
				request: publicationInput,
				response,
				result,
			});
		} catch (error: unknown) {
			recordPostResultProjectionFailure({ result, step: "publication_outbox", error });
		}
		await runPostResultProjection({
			result,
			step: "trace_finalization",
			operation: () => executionRecorder!.finishSucceeded(response, result),
		});
		const conversationPublished = await runPostResultProjection({
			result,
			step: "conversation_publication",
			operation: () => persistAgentsChatConversationTurn({
				c,
				userId: continuation.userId,
				requestInput: publicationInput,
				response,
				result,
				publicationId: executionTraceId,
				publicationMode,
			}),
		});
		if (conversationPublished && publicationContract) {
			const contract = publicationContract;
			await runPostResultProjection({
				result,
				step: "publication_outbox",
				operation: () => completeAgentsChatPublication({ c, contract }),
			});
		} else if (publicationContract) {
			const contract = publicationContract;
			await runPostResultProjection({
				result,
				step: "publication_outbox",
				operation: async () => {
					await deferAgentsChatPublication({
						c,
						contract,
						error: new Error("conversation_publication_failed"),
					});
				},
			});
		}
		if (publicationMode === "assistant_only") {
			await runPostResultProjection({
				result,
				step: "realtime_broadcast",
				operation: async () => broadcastChatMessages(
					publicationInput,
					response,
					continuation.rootRequestId ?? continuation.id,
				),
			});
		}
		await settleChatBilling(c, continuation.userId, billing);
	} catch (error) {
		if (!bridgeResultReceived) await executionRecorder?.finishFailed(error);
		let retryScheduled = false;
		if (!continuationCompleted) {
			if (bridgeResultReceived) {
				await completeAsyncAgentContinuation({ c, continuation, status: "failed" });
			} else {
				const retryPlan = await deferOrFailAsyncAgentContinuation({
					c,
					continuation,
					error,
				});
				retryScheduled = retryPlan.shouldRetry;
				console.warn("[async-agent-continuation] pre-execution failure recorded", {
					continuationId: continuation.id,
					attempt: retryPlan.attempt,
					retryScheduled,
					nextAttemptAt: retryPlan.nextAttemptAt,
					code: retryPlan.failure.code,
					status: retryPlan.failure.status,
					upstreamStatus: retryPlan.failure.upstreamStatus,
				});
			}
		}
		await releaseChatBilling(c, continuation.userId, billing);
		if (retryScheduled) {
			continuationKeepsActivity = true;
			return;
		}
		throw error;
	} finally {
		clearInterval(leaseHeartbeat);
		if (!continuationKeepsActivity) markChatTurnEnded(activityProjectId);
		c.set("activeAsyncContinuationId", previousContinuationId);
		c.set("activeAsyncContinuationClaimToken", previousContinuationClaimToken);
	}
}

export function buildAsyncAgentContinuationRequestCandidate(input: Readonly<{
	continuation: AsyncAgentContinuation;
	prompt: string;
}>): Record<string, unknown> {
	const { continuation } = input;
	return {
		...(continuation.taskCapsule?.requestFacts ?? {}),
		prompt: input.prompt,
		...(continuation.projectId ? { canvasProjectId: continuation.projectId } : {}),
		...(continuation.flowId ? { canvasFlowId: continuation.flowId } : {}),
		...(continuation.chapterId ? { chapterId: continuation.chapterId } : {}),
		...(continuation.bookId ? { bookId: continuation.bookId } : {}),
		...(continuation.canvasNodeId ? { canvasNodeId: continuation.canvasNodeId } : {}),
		...(continuation.executionToolPolicy
			? {
				executionToolPolicy: {
					mode: continuation.executionToolPolicy.mode,
					allowedTools: [...continuation.executionToolPolicy.allowedTools],
				},
			}
			: {}),
		sessionKey: continuation.sessionKey,
		stream: false,
		...(continuation.modelKey ? { modelKey: continuation.modelKey } : {}),
		...(continuation.modelAlias ? { modelAlias: continuation.modelAlias } : {}),
	};
}

/**
 * Public request facts and machine-owned continuation state are separate trust
 * domains. Keep the immutable intent contract out of AgentsChatRequestSchema
 * (where callers are correctly forbidden from supplying it), verify its hash
 * here, then inject it only into the trusted bridge extras.
 */
export function buildTrustedContinuationIntentContext(
	value: unknown,
): Record<string, unknown> {
	if (value === undefined || value === null) return {};
	const verification = verifyUserIntentContract(value);
	if (!verification.ok) {
		const error = new Error(
			`async_continuation_user_intent_contract_invalid:${verification.code}:${verification.message}`,
		) as Error & { code: string };
		error.code = "async_continuation_user_intent_contract_invalid";
		throw error;
	}
	return {
		userIntentContract: verification.value.contract,
		userIntentContractLocked: true,
	};
}

/** chat SSE 心跳间隔（S2）：模型静默生成(长 prompt/reasoning)期间每 15s 写一个 SSE 注释帧顶开 idle 超时。 */
export const CHAT_HEARTBEAT_MS = 15_000;

/**
 * 是否应把本回合落库（S2 纯函数）。根因 A2：客户端断连时旧逻辑 `if(signal.aborted) return` 跳过
 * persist，导致服务端跑完的结果彻底丢、重连「继续」也拉不回。只要拿到非空 result 就落库（即便客户端
 * 已走，结果可复用），唯一排除 null（上游真失败，避免写空助手 turn）。
 */
export function shouldPersistTurn(result: TaskResultDto | null | undefined): boolean {
	return result != null;
}

export async function handlePublicAgentsChatRoute(c: AppContext): Promise<Response> {
	const userId = String(c.get("userId") || "").trim();
	if (!userId) {
		throw new AppError("Unauthorized", {
			status: 401,
			code: "unauthorized",
		});
	}

	const rawBody = await c.req.json().catch(() => ({}));
	const input = AgentsChatRequestSchema.parse(rawBody);
	if (input.queueMode) {
		const sessionId = typeof input.sessionKey === "string" ? input.sessionKey.trim() : "";
		const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
		if (!sessionId) {
			throw new AppError("queueMode requires sessionKey", {
				status: 400,
				code: "agents_queue_session_required",
			});
		}
		const receipt = await enqueueAgentsBridgeMessage(c, userId, {
			sessionId,
			prompt,
			queueMode: input.queueMode,
			...(typeof input.modelKey === "string" && input.modelKey.trim()
				? { modelKey: input.modelKey.trim() }
				: {}),
			...(typeof input.modelAlias === "string" && input.modelAlias.trim()
				? { modelAlias: input.modelAlias.trim() }
				: {}),
			...(input.chatContext?.generationProposal ? { generationProposal: input.chatContext.generationProposal } : {}),
		});
		return c.json(receipt, 202);
	}

	// 无 sessionKey 但有 canvasProjectId 时，注入稳定的 auto session key 以确保对话存档
	const projectId = typeof input.canvasProjectId === "string" ? input.canvasProjectId.trim() : "";
	if (!input.sessionKey && projectId) {
		const flowId = typeof input.canvasFlowId === "string" ? input.canvasFlowId.trim() : "";
		const chapterId = typeof input.chapterId === "string" ? input.chapterId.trim() : "";
		(input as Record<string, unknown>).sessionKey = buildAutoSessionKey(projectId, flowId, chapterId);
	}
	// sessionKey 必须先完成规范化再投影到 taskRequest；否则 observabilityContext 会看到
	// 空 threadId，而公开请求对象虽然随后有 sessionKey，两侧事实却已经分叉。
	const taskRequest = buildTaskRequest(input);
	const clientPendingId = input.clientPendingId?.trim();
	if (!clientPendingId) {
		throw new AppError("clientPendingId is required for an idempotent chat turn", {
			status: 400,
			code: "agents_chat_turn_id_required",
		});
	}
	const stablePublicTurnId = buildStablePublicChatTurnId({
		userId,
		sessionKey: input.sessionKey,
		clientPendingId,
	});
	(taskRequest.extras as Record<string, unknown>).publicTurnId = stablePublicTurnId;

	// 计费(AI 对话按真实消耗扣积分)：派生 hono 自有的 conversation id，透传给 agents-cli → new-api
	// (x-tapcanvas-conversation-id)，供结算时回查这一轮真实 quota。门槛校验 + 冻结在进入 SSE 流之前完成，
	// 余额不足直接抛 402(客户端拿到正常错误，而非流内错误)。结算/解冻在回合结束时执行。
	const billingSessionKey =
		typeof input.sessionKey === "string" ? input.sessionKey.trim() : "";
	const billingConversationId = billingSessionKey
		? deriveChatConversationId(userId, billingSessionKey)
		: deriveChatEffectConversationId(userId, stablePublicTurnId);
	(taskRequest.extras as Record<string, unknown>).billingConversationId = billingConversationId;
	const billingModelKey = (() => {
		const e = taskRequest.extras as Record<string, unknown>;
		const mk = typeof e.modelKey === "string" ? e.modelKey.trim() : "";
		const ma = typeof e.modelAlias === "string" ? e.modelAlias.trim() : "";
		return mk || ma || null;
	})();
	const billingTurnStartMs = Date.now();
	const billing: ChatBillingHandle | null = await beginChatBilling(c, userId, {
		conversationId: billingConversationId,
		sinceMs: billingTurnStartMs,
		modelKey: billingModelKey,
		effectId: stablePublicTurnId,
	});

	if (input.stream === true) {
		const requestId = stablePublicTurnId;
		const sessionId =
			typeof input.sessionKey === "string" && input.sessionKey.trim()
				? input.sessionKey.trim()
				: "";
		let inflight: ReturnType<typeof registerInflightChatTurn> = null;
		let executionRecorder: PublicChatExecutionRecorder | null = null;
		try {
			inflight = registerInflightChatTurn(
				buildInflightChatTurnKey(userId, sessionId),
				requestId,
			);
		} catch (error) {
			if (!(error instanceof ChatTurnInflightError)) throw error;
			await settleChatBilling(c, userId, billing);
			throw new AppError(error.message, {
				status: 409,
				code: error.code,
				terminal: true,
				details: {
					...error.details,
					acceptance: "rejected",
					operationOutcome: "not_started",
				},
			});
		}
		try {
			executionRecorder = await startPublicChatExecutionRecorder({
				c,
				userId,
				traceId: requestId,
				request: input,
				rootTraceId: requestId,
				logicalTaskId: requestId,
			});
		} catch (error: unknown) {
			inflight?.release();
			await settleChatBilling(c, userId, billing);
			if (isExecutionTraceIdentityAlreadyUsed(error)) {
				throw publicChatTurnAlreadyExistsError(requestId);
			}
			throw new AppError("AI 执行过程日志无法入库，本轮未启动。", {
				status: 503,
				code: "execution_trace_persistence_unavailable",
				details: error instanceof Error ? error.message : String(error),
			});
		}
		try {
			await resetRequestedConversation(c, userId, input);
		} catch (error: unknown) {
			await executionRecorder?.finishFailed(error, false);
			inflight?.release();
			await settleChatBilling(c, userId, billing);
			throw error;
		}
		// 流响应头必须携带 durable publicTurnId（public-chat-turn:<hash>）而非请求级
		// fe_ 追踪 id：前端 onOpen 用 X-Trace-ID 把本地临时气泡重绑成稳定 id，广播/状态/
		// 历史持久化都基于 publicTurnId —— 头不一致会导致同一回合出现两套 id、
		// 按 id 去重全部失效 → 会话内重复用户气泡（刷新后只剩历史一条）。
		try {
			c.header("X-Trace-ID", requestId);
			c.header("X-TapCanvas-Event-Protocol", "execution-trace-events-v1");
		} catch {
			// 流尚未开始、头仍可写；若已发出则忽略（前端以首个头为准）。
		}
		return streamSSE(c, async (stream) => {
			let heartbeat: ReturnType<typeof setInterval> | null = null;
			const clearHeartbeat = () => {
				if (heartbeat) {
					clearInterval(heartbeat);
					heartbeat = null;
				}
			};
			const activityProjectId =
				typeof input.canvasProjectId === "string" ? input.canvasProjectId.trim() : "";
			let activityMarked = false;
			let lifecycleOwnsCleanup = false;
			let durableContinuationOwnsActivity = false;
			// The durable agent turn must outlive an SSE consumer. Once a browser
			// closes its readable stream, forwarding later progress events is no
			// longer possible, but that transport fact must not abort the agent,
			// its persisted recovery checkpoint, or any accepted media work.
			let clientStreamWritable = true;
			let clientStreamFailureReported = false;
			let journalRecordTail: Promise<void> = Promise.resolve();
			const recordJournalEvent = async (
				event: string,
				data: unknown,
				publicProjection: PublicChatReplayableEventName | null,
			): Promise<number | null> => {
				let sequence: number | null = null;
				const operation = journalRecordTail.then(async () => {
					if (!executionRecorder) {
						throw new Error(`public_chat_execution_recorder_missing:${requestId}`);
					}
					if (publicProjection) {
						const persisted = await executionRecorder.recordDurableBridgeEvent({
							event,
							data: markPublicChatStreamPayload(publicProjection, data),
						});
						sequence = persisted.seq;
						return;
					}
					await executionRecorder.recordBridgeEvent({ event, data });
				});
				journalRecordTail = operation.catch(() => undefined);
				await operation;
				return sequence;
			};
			const writeClientEvent = async (
				event: string,
				data: unknown,
				eventId: string,
			): Promise<boolean> => {
				if (!clientStreamWritable) return false;
				try {
					await writePublicAgentsChatSseWithinDeadline(stream, {
						event,
						data: JSON.stringify(data),
						id: eventId,
						retry: 500,
					});
					return true;
				} catch (error) {
					clientStreamWritable = false;
					if (!clientStreamFailureReported) {
						clientStreamFailureReported = true;
						console.warn(
							`[public-agents-chat] SSE consumer unavailable; continuing durable agent turn requestId=${requestId} reason=${error instanceof Error ? error.message : String(error)}`,
						);
					}
					return false;
				}
			};
			const recordAndWriteClientEvent = async (
				event: PublicChatReplayableEventName,
				data: unknown,
			): Promise<{ eventId: string; sequence: number; written: boolean }> => {
				const sequence = await recordJournalEvent(event, data, event);
				if (sequence === null) {
					throw new Error(`public_chat_durable_event_sequence_missing:${requestId}:${event}`);
				}
				const eventId = buildPublicChatEventId(requestId, sequence);
				const written = !c.req.raw.signal.aborted
					? await writeClientEvent(event, data, eventId)
					: false;
				return { eventId, sequence, written };
			};
			const recordAndWriteClientError = async (
				payload: StreamErrorPayload,
				reason: "error" | "interrupted",
			): Promise<void> => {
				await recordAndWriteClientEvent("error", payload);
				await recordAndWriteClientEvent("done", { reason });
			};
			try {
			await recordAndWriteClientEvent("initial", {
					requestId,
					messageId: `msg_${randomUUID()}`,
			});
			if (sessionId) {
				await recordAndWriteClientEvent("session", { sessionId });
			}
			await recordAndWriteClientEvent("thinking", { text: "请求已发送，等待 agents 执行器受理" });
			// S2 心跳：模型静默生成期间连接会被 idle 超时断开("network error")。每 15s 写一个 SSE 注释帧
			// (以 ':' 开头、无 event 名 → 客户端按 SSE 规范忽略、绕开 FORWARDED_STREAM_EVENTS 白名单)顶开
			// idle 超时。写失败(流已关)吞掉。
			heartbeat = setInterval(() => {
				void stream.write(": ping\n\n").catch(() => {});
			}, CHAT_HEARTBEAT_MS);
			// running 状态栏数据源：标记本 project 房间有后台 agent 回合在跑（重连可见、断连后 60s
			// 无活动自动判定结束）。projectId 缺失（非画布场景）时下列调用空转、无副作用。
			markChatTurnActive(activityProjectId);
			activityMarked = true;
			lifecycleOwnsCleanup = true;
			try {
				const result = await runAgentsBridgeChatTask(c, userId, taskRequest, {
					// S2 解耦：不把 c.req.raw.signal 当上游 abort 源 —— 客户端断连(idle 超时/用户切走)不该
					// 掐死服务端 run，否则模型生成被中途杀掉、结果丢。上游自有 600s idle 续期超时
					// (createTimedAbortController 每字节 reset)兜底，去掉外部 signal 也不会空跑无界。
					// 这里传的是在飞登记表的信号：仅显式中断时触发；普通新消息不会隐式顶替。
					...(inflight ? { abortSignal: inflight.signal } : {}),
					onStreamEvent: async (event) => {
						const shouldProject = shouldForwardAgentsBridgeStreamEvent(event.event);
						const publicEvent = shouldProject
							? event.event as PublicChatReplayableEventName
							: null;
						const sequence = await recordJournalEvent(event.event, event.data, publicEvent);
						// 续期 running 状态栏；团队角色活动则把角色名带上作状态栏标签。
						if (event.event === "agent_role") {
							const rd = event.data as Record<string, unknown> | undefined;
							const roleName =
								rd && typeof rd === "object"
									? String(rd.roleName || rd.role || "").trim() || null
									: null;
							touchChatTurn(activityProjectId, roleName);
						} else {
							touchChatTurn(activityProjectId);
						}
						if (!publicEvent || !clientStreamWritable || c.req.raw.signal.aborted) return;
						if (sequence === null) {
							throw new Error(`public_chat_durable_event_sequence_missing:${requestId}:${publicEvent}`);
						}
						await writeClientEvent(
							publicEvent,
							event.data,
							buildPublicChatEventId(requestId, sequence),
						);
					},
				});
				clearHeartbeat();
				// S2 落库无条件化：只要拿到 result 就 persist + 广播，即便客户端已断连(结果可复用、
				// 重连「继续」能拉回)。最终帧只在连接还在时写(断了写不出去无所谓)。
				if (shouldPersistTurn(result)) {
					let registration: PendingAsyncContinuationRegistration;
					try {
						registration = await registerPendingAsyncContinuation({
							c,
							userId,
								rootRequestId: requestId,
								requestInput: input,
								taskRequest,
								result,
						});
					} catch (error: unknown) {
						recordPostResultProjectionFailure({
							result,
							step: "continuation_registration",
							error,
						});
						try {
						await persistContinuationRegistrationSettlementFailure({
							c,
							userId,
							rootRequestId: requestId,
										result,
										error,
										requestInput: input,
										taskRequest,
										...(error instanceof ContinuationRegistrationPersistenceError
											? { recoveryContinuation: error.continuation }
											: {}),
						});
						} catch (settlementError: unknown) {
							recordPostResultProjectionFailure({ result, step: "continuation_registration", error: settlementError });
							throw settlementError;
						}
						registration = error instanceof ContinuationRegistrationPersistenceError
							? {
								status: "reconcile_pending",
								reason: "continuation registration is owned by durable settlement recovery",
								effectOwner: "continuation_settlement",
							}
							: {
								status: "invalid",
								reason: "continuation registration failed before a recoverable continuation existed",
							};
					}
					recordAsyncContinuationRegistrationDiagnostic(
						result,
						registration,
						buildAsyncContinuationRegistrationContext({
							rootRequestId: requestId,
							requestInput: input,
						}),
					);
					assertSuspendedContinuationOwnership({ result, registration });
					await runPostResultProjection({
						result,
						step: "continuation_scheduling",
						operation: async () => {
							await scheduleRegisteredPhysicalBudgetContinuation(c, registration);
						},
					});
					const response = buildAgentsChatResponseFromTaskResult(result, {
						publicTurnId: requestId,
					});
					durableContinuationOwnsActivity = continuationRegistrationOwnsChatActivity({
						registrationStatus: registration.status,
						logicalTaskStatus: response.trace?.logicalTaskState?.status,
					});
					// The agent bridge has already produced and verified the terminal
					// response at this point.  Client-visible delivery must not wait for
					// conversation publication, trace finalization, Redis fan-out, or
					// continuation bookkeeping: any of those are post-result projections
					// and may be slow or unavailable in a local single-process runtime.
					// Mark the terminal frame before entering those projections so the
					// browser cannot remain in a perpetual "running" state after the
					// actual agent run has finished.
					// Persist the Hono-enriched terminal projection before attempting the
					// browser write. If transport disappears between these two operations,
					// Last-Event-ID replay returns this exact result instead of restarting work.
					await recordAndWriteClientEvent("result", { response });
					await recordAndWriteClientEvent("done", {
						reason: resolvePublicChatDoneReason(response.trace?.logicalTaskState?.status),
					});
					let publicationContract: AgentsChatPublicationContractV1 | null = null;
					try {
						publicationContract = await registerAgentsChatPublication({
							c,
							userId,
							publicationId: requestId,
							publicTurnId: requestId,
							publicationMode: "turn",
							request: input,
							response,
							result,
						});
					} catch (error: unknown) {
						recordPostResultProjectionFailure({ result, step: "publication_outbox", error });
					}
					await runPostResultProjection({
						result,
						step: "trace_finalization",
						operation: async () => {
							await executionRecorder?.finishSucceeded(response, result);
						},
					});
					const conversationPublished = await runPostResultProjection({
						result,
						step: "conversation_publication",
						operation: () => persistAgentsChatConversationTurn({
							c,
							userId,
							requestInput: input,
							response,
							result,
						}),
					});
					if (conversationPublished && publicationContract) {
						const contract = publicationContract;
						await runPostResultProjection({
							result,
							step: "publication_outbox",
							operation: () => completeAgentsChatPublication({ c, contract }),
						});
					} else if (publicationContract) {
						const contract = publicationContract;
						await runPostResultProjection({
							result,
							step: "publication_outbox",
							operation: async () => {
								await deferAgentsChatPublication({
									c,
									contract,
									error: new Error("conversation_publication_failed"),
								});
							},
						});
					}
					await runPostResultProjection({
						result,
						step: "realtime_broadcast",
						operation: async () => broadcastChatMessages(input, response, requestId),
					});
				}
			} catch (error) {
				const cancelled = Boolean(inflight?.signal.aborted);
				const persistTerminalProjection = async (
					payload: StreamErrorPayload,
					reason: "error" | "interrupted",
				): Promise<void> => {
					try {
						await recordAndWriteClientError(payload, reason);
					} catch (projectionError: unknown) {
						console.error("[public-agents-chat] terminal event projection failed", {
							requestId,
							error: projectionError instanceof Error
								? projectionError.message
								: String(projectionError),
						});
					}
				};
				// The public terminal is journaled before the recorder closes. A browser
				// that lost the live write can therefore replay the exact same terminal;
				// finishFailed then appends the internal trace terminal after it.
				if (cancelled) {
					try {
						await persistInterruptedAgentsChatRun({
							c,
							userId,
							requestInput: input,
							publicTurnId: requestId,
							reasonCode: "chat_turn_user_interrupt",
							runMs: Date.now() - billingTurnStartMs,
						});
					} catch (persistenceError) {
						console.error("[public-agents-chat] interrupted run persistence failed", {
							requestId,
							clientPendingId: input.clientPendingId ?? null,
							error: persistenceError instanceof Error
								? persistenceError.message
								: String(persistenceError),
						});
						await persistTerminalProjection({
							message: "本回合已中断，但中断运行记录持久化失败。",
							code: "turn_interrupt_persistence_failed",
							terminal: true,
							scope: "persistence",
							retryability: "retryable",
							acceptanceKnown: true,
							sideEffectOutcomeKnown: true,
						}, "error");
						await executionRecorder?.finishFailed(persistenceError, true);
						throw persistenceError;
					}
					await persistTerminalProjection({
						message: "本回合已被用户中断。",
						code: "turn_interrupted",
						terminal: true,
						scope: "transport",
						retryability: "not_retryable",
						acceptanceKnown: true,
						sideEffectOutcomeKnown: true,
					}, "interrupted");
					await executionRecorder?.finishFailed(error, true);
					return;
				}
				await persistTerminalProjection(toStreamErrorPayload(error), "error");
				await executionRecorder?.finishFailed(error, false);
			} finally {
				inflight?.release();
				clearHeartbeat();
				// 回合结束（正常/异常/断连）：状态栏转为"已结束"。注意 autonomous 子代理可能在本
				// 前台回合结束后继续跑——它们无独立心跳，故以前台回合生命周期为准；如需覆盖纯后台
				// 续跑，后续可加 agents-cli→hono 的 agent 生命周期心跳。
				// 计费结算（回合结束，正常/异常/断连统一处理）：按 new-api 真实 quota 折算扣实际、释放多冻；零消耗结算 0=全额解冻。
				await settleChatBilling(c, userId, billing);
				if (!durableContinuationOwnsActivity) markChatTurnEnded(activityProjectId);
			}
			} finally {
				// 刷新可能发生在 initial/session/thinking 首帧写入期间。此时 agents 尚未起跑，
				// 也必须释放在飞登记与计费冻结，不能留下永久 chat_turn_inflight 假锁。
				if (!lifecycleOwnsCleanup) {
					inflight?.release();
					clearHeartbeat();
					await settleChatBilling(c, userId, billing);
					if (activityMarked) markChatTurnEnded(activityProjectId);
				}
			}
		});
	}

	// 非流式路径同样登记在飞回合（互斥+可被显式中断），并保留原有的断连即 abort 语义。
	const rootRequestId = String(
		(taskRequest.extras as Record<string, unknown>).publicTurnId || "",
	).trim();
	if (!rootRequestId) throw new Error("public chat turn identity was not initialized");
	let inflight: ReturnType<typeof registerInflightChatTurn> = null;
	try {
		inflight = registerInflightChatTurn(
			buildInflightChatTurnKey(userId, typeof input.sessionKey === "string" ? input.sessionKey : ""),
			rootRequestId,
		);
	} catch (error) {
		if (!(error instanceof ChatTurnInflightError)) throw error;
		await settleChatBilling(c, userId, billing);
		throw new AppError(error.message, {
			status: 409,
			code: error.code,
			terminal: true,
			details: {
				...error.details,
				acceptance: "rejected",
				operationOutcome: "not_started",
			},
		});
	}
	try {
		const { result, response } = await runPersistedAgentsChatTask({
			c,
			userId,
			rootRequestId,
			requestInput: input,
			taskRequest,
			abortSignal: anyAbortSignal([c.req.raw.signal, inflight?.signal]),
		});
		let publicationContract: AgentsChatPublicationContractV1 | null = null;
		try {
			publicationContract = await registerAgentsChatPublication({
				c,
				userId,
				publicationId: rootRequestId,
				publicTurnId: rootRequestId,
				publicationMode: "turn",
				request: input,
				response,
				result,
			});
		} catch (error: unknown) {
			recordPostResultProjectionFailure({ result, step: "publication_outbox", error });
		}
		const conversationPublished = await runPostResultProjection({
			result,
			step: "conversation_publication",
			operation: () => persistAgentsChatConversationTurn({
				c,
				userId,
				requestInput: input,
				response,
				result,
			}),
		});
		if (conversationPublished && publicationContract) {
			const contract = publicationContract;
			await runPostResultProjection({
				result,
				step: "publication_outbox",
				operation: () => completeAgentsChatPublication({ c, contract }),
			});
		} else if (publicationContract) {
			const contract = publicationContract;
			await runPostResultProjection({
				result,
				step: "publication_outbox",
				operation: async () => {
					await deferAgentsChatPublication({
						c,
						contract,
						error: new Error("conversation_publication_failed"),
					});
				},
			});
		}
		await runPostResultProjection({
			result,
			step: "realtime_broadcast",
			operation: async () => broadcastChatMessages(input, response, rootRequestId),
		});
		return c.json(response);
	} finally {
		inflight?.release();
		// 计费结算（含异常路径）：按真实消耗扣实际、释放多冻；零消耗结算 0=全额解冻。
		await settleChatBilling(c, userId, billing);
	}
}

function resolveChatRuntimeSessionKey(body: Record<string, unknown>): string {
	let sessionKey = typeof body.sessionKey === "string" ? body.sessionKey.trim() : "";
	if (!sessionKey) {
		const projectId =
			typeof body.canvasProjectId === "string" ? body.canvasProjectId.trim() : "";
		if (projectId) {
			const flowId = typeof body.canvasFlowId === "string" ? body.canvasFlowId.trim() : "";
			const chapterId = typeof body.chapterId === "string" ? body.chapterId.trim() : "";
			sessionKey = buildAutoSessionKey(projectId, flowId, chapterId);
		}
	}
	if (!sessionKey) {
		throw new AppError("sessionKey 或 canvasProjectId 至少提供一个", {
			status: 400,
			code: "invalid_request",
		});
	}
	return sessionKey;
}

function requireChatRuntimeUserId(c: AppContext): string {
	const userId = String(c.get("userId") || "").trim();
	if (!userId) {
		throw new AppError("Unauthorized", {
			status: 401,
			code: "unauthorized",
		});
	}
	return userId;
}

type PublicChatReplayPage = Awaited<ReturnType<typeof listExecutionTraceEvents>>;

function toPublicChatReplayRequestError(error: unknown): AppError {
	const message = error instanceof Error ? error.message : String(error);
	if (message === "public_chat_replay_cursor_mismatch") {
		return new AppError("afterEventId 与 Last-Event-ID 不一致，拒绝猜测恢复位置。", {
			status: 400,
			code: "public_chat_replay_cursor_mismatch",
		});
	}
	return new AppError("事件恢复游标无效，必须绑定同一 publicTurnId 的单调事件序列。", {
		status: 400,
		code: "public_chat_replay_cursor_invalid",
	});
}

async function readPublicChatReplayPage(input: Readonly<{
	c: AppContext;
	userId: string;
	publicTurnId: string;
	afterSequence: number;
	limit?: number;
}>): Promise<PublicChatReplayPage> {
	try {
		return await listExecutionTraceEvents(input.c.env.DB, {
			traceId: input.publicTurnId,
			userId: input.userId,
			afterSeq: input.afterSequence,
			limit: input.limit ?? PUBLIC_CHAT_REPLAY_PAGE_SIZE,
		});
	} catch (error: unknown) {
		if (
			error instanceof Error &&
			error.message === `execution_trace_not_found:${input.publicTurnId}`
		) {
			throw new AppError("没有找到该 durable chat turn 的事件日志。", {
				status: 404,
				code: "public_chat_replay_turn_not_found",
				details: { publicTurnId: input.publicTurnId },
			});
		}
		throw error;
	}
}

function buildReplayResyncFrame(input: Readonly<{
	publicTurnId: string;
	reason: PublicChatReplayResyncReason;
	requestedAfterEventId: string | null;
	events: readonly ExecutionTraceEvent[];
	latestSequence: number;
}>): { event: "resync"; data: string; id?: string; retry: number } {
	const payload = buildPublicChatReplayResyncPayload({
		publicTurnId: input.publicTurnId,
		reason: input.reason,
		requestedAfterEventId: input.requestedAfterEventId,
		earliestAvailableSequence: input.events[0]?.seq ?? null,
		latestSequence: input.latestSequence,
	});
	return {
		event: "resync",
		data: JSON.stringify(payload),
		...(payload.latestEventId ? { id: payload.latestEventId } : {}),
		retry: 1_000,
	};
}

async function streamPublicChatJournalReplay(input: Readonly<{
	c: AppContext;
	stream: PublicAgentsChatStreamWriter & { write: (chunk: string) => Promise<unknown> };
	userId: string;
	publicTurnId: string;
	afterEventId: string | null;
	afterSequence: number;
	initialPage: PublicChatReplayPage;
}>): Promise<void> {
	let afterSequence = input.afterSequence;
	let page = input.initialPage;
	let lastHeartbeatAt = Date.now();
	while (!input.c.req.raw.signal.aborted) {
		const gap = detectPublicChatReplayGap({
			afterSequence,
			latestSequence: page.latestSeq,
			events: page.events,
		});
		if (gap) {
			await writePublicAgentsChatSseWithinDeadline(
				input.stream,
				buildReplayResyncFrame({
					publicTurnId: input.publicTurnId,
					reason: gap,
					requestedAfterEventId: input.afterEventId,
					events: page.events,
					latestSequence: page.latestSeq,
				}),
			);
			return;
		}

		for (const event of page.events) {
			afterSequence = event.seq;
			const frame = projectExecutionTraceEventToPublicChatFrame(event, input.publicTurnId);
			if (!frame) continue;
			if (event.payloadTruncated) {
				await writePublicAgentsChatSseWithinDeadline(
					input.stream,
					buildReplayResyncFrame({
						publicTurnId: input.publicTurnId,
						reason: "payload_truncated",
						requestedAfterEventId: input.afterEventId,
						events: [event],
						latestSequence: page.latestSeq,
					}),
				);
				return;
			}
			await writePublicAgentsChatSseWithinDeadline(input.stream, {
				event: frame.event,
				data: JSON.stringify(frame.data),
				id: frame.eventId,
				retry: 500,
			});
			if (frame.terminal) return;
		}

		if (page.hasMore) {
			page = await readPublicChatReplayPage({
				c: input.c,
				userId: input.userId,
				publicTurnId: input.publicTurnId,
				afterSequence,
			});
			continue;
		}
		if (!traceStatusCanProduceMorePublicChatEvents(page.traceStatus)) {
			await writePublicAgentsChatSseWithinDeadline(
				input.stream,
				buildReplayResyncFrame({
					publicTurnId: input.publicTurnId,
					reason: "terminal_projection_missing",
					requestedAfterEventId: input.afterEventId,
					events: page.events,
					latestSequence: page.latestSeq,
				}),
			);
			return;
		}
		if (Date.now() - lastHeartbeatAt >= CHAT_HEARTBEAT_MS) {
			await input.stream.write(": replay-ping\n\n");
			lastHeartbeatAt = Date.now();
		}
		await new Promise<void>((resolve) => setTimeout(resolve, PUBLIC_CHAT_REPLAY_POLL_INTERVAL_MS));
		page = await readPublicChatReplayPage({
			c: input.c,
			userId: input.userId,
			publicTurnId: input.publicTurnId,
			afterSequence,
		});
	}
}

async function handlePublicAgentsChatEventReplayRoute(input: Readonly<{
	c: AppContext;
	userId: string;
	sessionKey: string;
	body: Record<string, unknown>;
}>): Promise<Response> {
	const publicTurnId = typeof input.body.turnId === "string"
		? input.body.turnId.trim()
		: "";
	if (!publicTurnId) {
		throw new AppError("事件续订必须提供同一 durable turn 的 turnId。", {
			status: 400,
			code: "public_chat_replay_turn_id_required",
		});
	}
	let cursor: ReturnType<typeof resolvePublicChatReplayAfterEvent>;
	try {
		cursor = resolvePublicChatReplayAfterEvent({
			publicTurnId,
			afterEventId: input.body.afterEventId,
			lastEventIdHeader: input.c.req.header("Last-Event-ID"),
		});
	} catch (error: unknown) {
		throw toPublicChatReplayRequestError(error);
	}
	const identityPage = await readPublicChatReplayPage({
		c: input.c,
		userId: input.userId,
		publicTurnId,
		afterSequence: 0,
		limit: 1,
	});
	const sessionIdentity = verifyPublicChatReplaySessionIdentity({
		event: identityPage.events[0],
		expectedSessionKey: input.sessionKey,
	});
	if (sessionIdentity.status === "missing") {
		throw new AppError("事件日志缺少 seq=1 request.accepted 会话身份，无法安全续订。", {
			status: 409,
			code: "public_chat_replay_identity_missing",
			details: {
				publicTurnId,
				recovery: { kind: "status_reconcile", referenceId: publicTurnId },
			},
		});
	}
	if (sessionIdentity.status === "mismatch") {
		throw new AppError("事件日志与当前会话身份不一致，拒绝跨会话续订。", {
			status: 409,
			code: "public_chat_replay_session_mismatch",
			details: { publicTurnId },
		});
	}
	const initialPage = cursor.sequence === 0 && identityPage.events.length > 0
		? await readPublicChatReplayPage({
			c: input.c,
			userId: input.userId,
			publicTurnId,
			afterSequence: 0,
		})
		: await readPublicChatReplayPage({
			c: input.c,
			userId: input.userId,
			publicTurnId,
			afterSequence: cursor.sequence,
		});
	input.c.header("X-Trace-ID", publicTurnId);
	input.c.header("X-TapCanvas-Event-Replay", "execution-trace-events-v1");
	return streamSSE(input.c, async (stream) => {
		await streamPublicChatJournalReplay({
			c: input.c,
			stream,
			userId: input.userId,
			publicTurnId,
			afterEventId: cursor.eventId,
			afterSequence: cursor.sequence,
			initialPage,
		});
	});
}

/** 刷新恢复真源：读取 agents-cli 已持久化的当前/最近回合 checkpoint。 */
export function projectTerminalContinuationSettlementStatus(input: {
	status: AgentsChatTurnStatusSnapshot;
	settlement: ContinuationSettlementRecordV1;
}): AgentsChatTurnStatusSnapshot {
	const turn = input.status.turn;
	const boundary = input.settlement.terminalBoundary;
	if (
		!turn ||
		!boundary ||
		turn.turnId !== input.settlement.publicTurnId ||
		turn.state === "succeeded" ||
		turn.state === "cancelled"
	) return input.status;
	const summary = `Continuation 恢复合同已到达确定性边界：${boundary.code}`;
	return {
		...input.status,
		activeTurn: false,
		turn: {
			...turn,
			state: "failed",
			phase: "failed",
			updatedAt: boundary.failedAt,
			lastConfirmedAt: boundary.failedAt,
			reasonCode: boundary.code,
			suspension: null,
			recoveryCheckpoint: null,
			lastConfirmedSummary: summary,
			finalResponse: null,
			attentionProjection: {
				version: 1,
				logicalTaskId: input.settlement.logicalTaskId,
				status: "terminal",
				waitingOn: null,
				obligation: summary,
				sourceHeads: {
					graphRevision: null,
					evidenceRevision: null,
					physicalRunId: input.settlement.physicalRunId,
				},
			},
			pendingUserInput: null,
			recentEvents: [
				...turn.recentEvents,
				{
					type: "continuation.settlement.failed",
					at: boundary.failedAt,
					toolName: null,
					toolStatus: "failed",
				},
			].slice(-20),
		},
	};
}

export async function handlePublicAgentsChatStatusRoute(c: AppContext): Promise<Response> {
	const userId = requireChatRuntimeUserId(c);
	const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
	const sessionKey = resolveChatRuntimeSessionKey(body);
	if (body.streamEvents === true) {
		return handlePublicAgentsChatEventReplayRoute({ c, userId, sessionKey, body });
	}
	let status = await getAgentsChatTurnStatus(c, userId, sessionKey, {
		timeoutMs: PUBLIC_CHAT_RUNTIME_STATUS_DEADLINE_MS,
	});
	if (!status.turn) return c.json(status);
	const terminalSettlement = await findTerminalContinuationSettlementForPublicTurn({
		c,
		userId,
		publicTurnId: status.turn.turnId,
	});
	if (terminalSettlement) {
		status = projectTerminalContinuationSettlementStatus({
			status,
			settlement: terminalSettlement,
		});
	}
	const finalTurn = status.turn;
	if (!finalTurn) return c.json(status);
	const { recoveryCheckpoint, ...publicTurn } = finalTurn;
	void recoveryCheckpoint;
	return c.json({ ...status, turn: publicTurn });
}

export function parsePhysicalBudgetRecoveryRequest(input: {
	acceptedRequest: unknown;
	expectedSessionKey: string;
}): AgentsChatRequestDto {
	const parsed = AgentsChatRequestSchema.safeParse(input.acceptedRequest);
	if (!parsed.success) {
		throw new AppError("持久化的原始聊天请求不符合当前执行合同，无法安全续跑。", {
			status: 409,
			code: "chat_resume_accepted_request_invalid",
			details: parsed.error.flatten(),
		});
	}
	const acceptedSessionKey = typeof parsed.data.sessionKey === "string"
		? parsed.data.sessionKey.trim()
		: "";
	if (!acceptedSessionKey || acceptedSessionKey !== input.expectedSessionKey) {
		throw new AppError("持久化请求与当前会话身份不一致，未启动续跑。", {
			status: 409,
			code: "chat_resume_accepted_request_session_mismatch",
			details: {
				expectedSessionKey: input.expectedSessionKey,
				acceptedSessionKey: acceptedSessionKey || null,
			},
		});
	}
	return parsed.data;
}

async function recoverMissingPhysicalContinuation(input: {
	c: AppContext;
	userId: string;
	sessionKey: string;
	turnId: string;
	suspension: RootPhysicalContinuationSuspension;
	recoveryCheckpoint: AgentsChatTurnRecoveryCheckpoint;
}): Promise<PendingAsyncContinuationRegistration> {
	// A bounded provider response can overflow before a tool call is accepted.
	// In that case there is deliberately no durable business frontier to prove:
	// the immutable accepted-request snapshot is the safe restart point. Budget
	// continuations still require exact task/run or durable-action evidence so a
	// missing frontier can never create a second paid business run.
	if (
		input.suspension.reasonCode !== "llm_response_too_large" &&
		input.suspension.reasonCode !== "workflow_agent_role_timeout"
	) {
		assertPhysicalBudgetRecoveryFrontier({
			progressRevision: input.suspension.progressRevision,
			physicalRunId: input.suspension.physicalRunId,
			durableTaskReferences: input.recoveryCheckpoint.durableTaskReferences,
			durableProgressClaims: input.recoveryCheckpoint.durableProgressClaims,
		});
	}
	const acceptedSnapshot = await getExecutionTraceAcceptedSnapshot(input.c.env.DB, {
		traceId: input.turnId,
		userId: input.userId,
		// The exact session/turn recovery checkpoint was verified above. Keep the
		// immutable accepted request usable when host restart settlement races the
		// durable Agents suspension projection.
		allowTerminalRecoverySnapshot: true,
	});
	if (!acceptedSnapshot) {
		throw new AppError("没有找到仍在运行 trace 的原始请求快照，无法安全重建续跑。", {
			status: 409,
			code: "chat_resume_accepted_request_missing",
		});
	}
	const requestInput = parsePhysicalBudgetRecoveryRequest({
		acceptedRequest: acceptedSnapshot.request,
		expectedSessionKey: input.sessionKey,
	});
	const taskRequest = buildTaskRequest(requestInput);
	const executionContract = parseContinuationExecutionContract(
		readRecord(acceptedSnapshot.recoveryContext)?.continuationExecutionContract,
	);
	if (executionContract) {
		Object.assign(taskRequest.extras as Record<string, unknown>, {
			continuationExecutionContract: executionContract,
			...(typeof executionContract.outputContract !== "undefined"
				? { outputContract: executionContract.outputContract }
				: {}),
			...(typeof executionContract.responseFormat !== "undefined"
				? { responseFormat: executionContract.responseFormat }
				: {}),
		});
	}
	const registration = await registerPhysicalContinuation({
		c: input.c,
		userId: input.userId,
		rootRequestId: input.turnId,
		requestInput,
		taskRequest,
		meta: {
			durableTaskReferences: input.recoveryCheckpoint.durableTaskReferences,
			durableProgressClaims: input.recoveryCheckpoint.durableProgressClaims,
			runtime: {
				suspension: input.suspension,
				...(input.recoveryCheckpoint.userIntentContract
					? { userIntentContract: input.recoveryCheckpoint.userIntentContract }
					: {}),
			},
		},
		suspension: input.suspension,
	});
	if (registration.status === "registered") {
		await finalizeExecutionTraceRun(input.c.env.DB, {
			traceId: input.turnId,
			userId: input.userId,
			status: "waiting_async",
			// registerPhysicalContinuation has already atomically claimed the exact
			// immutable accepted request and verified the durable checkpoint. A host
			// failure projection may therefore be reopened as waiting_async without
			// weakening terminal monotonicity for unrelated failures.
			allowFailedToWaitingAsyncRecovery: true,
			resultSummary: "physical continuation recovered from accepted request snapshot",
			meta: {
				recoveryKind: input.suspension.reasonCode,
				continuationId: registration.continuation.id,
				physicalRunId: input.suspension.physicalRunId,
				progressRevision: input.suspension.progressRevision,
			},
		});
	}
	return registration;
}

export function assertPhysicalBudgetRecoveryFrontier(input: {
	progressRevision: number;
	physicalRunId: string;
	durableTaskReferences: readonly unknown[];
	durableProgressClaims: readonly unknown[];
}): void {
	if (
		input.progressRevision > 0 &&
		input.durableTaskReferences.length === 0 &&
		input.durableProgressClaims.length === 0
	) {
		throw new AppError("物理检查点存在持久进度，但缺少可验证的 task/run 或 durable-action frontier，未启动新的业务 run。", {
			status: 409,
			code: "chat_resume_durable_frontier_missing",
			details: {
				physicalRunId: input.physicalRunId,
				progressRevision: input.progressRevision,
			},
		});
	}
}

export function resolveRecoveryContinuationSuspension(input: Readonly<{
	recoveryKind: "physical_budget" | "orphaned_checkpoint";
	reasonCode: string | null;
	suspension: AgentsChatPhysicalBudgetSuspension | null;
	recoveryCheckpoint: AgentsChatTurnRecoveryCheckpoint | null;
}>): RootPhysicalContinuationSuspension | null {
	const checkpoint = input.recoveryCheckpoint;
	if (!checkpoint || checkpoint.reasonCode !== input.reasonCode) return null;
	if (input.recoveryKind === "physical_budget") {
		if (checkpoint.reasonCode === "root_physical_execution_budget_exhausted") {
			if (
				!input.suspension ||
				input.suspension.physicalRunId !== checkpoint.physicalRunId ||
				input.suspension.progressRevision !== checkpoint.progressRevision
			) return null;
		} else if (input.suspension) {
			return null;
		}
		return {
			reasonCode: checkpoint.reasonCode,
			physicalRunId: checkpoint.physicalRunId,
			progressRevision: checkpoint.progressRevision,
		};
	}
	if (
		checkpoint.reasonCode !== "provider_stream_interrupted" &&
		checkpoint.reasonCode !== "llm_response_too_large" &&
		checkpoint.reasonCode !== "workflow_agent_role_timeout"
	) return null;
	return {
		reasonCode: checkpoint.reasonCode,
		physicalRunId: checkpoint.physicalRunId,
		progressRevision: checkpoint.progressRevision,
	};
}

/**
 * Resumes one exact server-persisted physical continuation. This is not a chat
 * alias: callers cannot provide a prompt, run id, cursor or delivery contract.
 * Those facts come exclusively from the continuation row written when the
 * previous physical window suspended.
 */
export type PersistedAgentsChatResumeResult = Readonly<{
	ok: true;
	resumed: boolean;
	sessionKey: string;
	turnId: string;
	continuationId: string;
	stage: number;
	resumeTrigger: "physical_budget" | "replan" | "dependency";
	recoveryKind: "physical_budget" | "orphaned_checkpoint" | "orphaned_continuation";
}>;

/**
 * A process-local runtime checkpoint may disappear while the durable logical
 * task and its physical continuation remain valid. Only an exact root public
 * turn that is still waiting for asynchronous work may use that continuation
 * as the recovery authority.
 */
export function isPersistedContinuationRecoveryLifecycleEligible(input: Readonly<{
	turnId: string;
	lifecycle: ExecutionTraceLifecycleSnapshot | null;
}>): boolean {
	const turnId = input.turnId.trim();
	return Boolean(
		turnId &&
		input.lifecycle?.traceId === turnId &&
		input.lifecycle.logicalTaskId === turnId &&
		input.lifecycle.rootTraceId === turnId &&
		input.lifecycle.status === "waiting_async",
	);
}

export function mergeClaimedContinuationRecoveryCheckpoint(input: Readonly<{
	continuation: AsyncAgentContinuation;
	recoveryCheckpoint: AgentsChatTurnRecoveryCheckpoint | null;
}>): AsyncAgentContinuation {
	const checkpoint = input.recoveryCheckpoint;
	if (!checkpoint) return input.continuation;
	const continuationIntent = input.continuation.userIntentContract
		? verifyUserIntentContract(input.continuation.userIntentContract)
		: null;
	if (continuationIntent && !continuationIntent.ok) {
		throw new Error(
			`async_continuation_user_intent_contract_invalid:${continuationIntent.code}:${continuationIntent.message}`,
		);
	}
	const checkpointIntent = checkpoint.userIntentContract
		? verifyUserIntentContract(checkpoint.userIntentContract)
		: null;
	if (checkpointIntent && !checkpointIntent.ok) {
		throw new Error(
			`async_recovery_checkpoint_user_intent_contract_invalid:${checkpointIntent.code}:${checkpointIntent.message}`,
		);
	}
	if (
		continuationIntent?.ok &&
		checkpointIntent?.ok &&
		continuationIntent.value.contract.contractHash !== checkpointIntent.value.contract.contractHash
	) {
		throw new Error("async_recovery_checkpoint_user_intent_contract_mismatch");
	}
	const userIntentContract = continuationIntent?.ok
		? continuationIntent.value.contract
		: checkpointIntent?.ok
			? checkpointIntent.value.contract
			: null;
	const durableTaskReferences = mergeDurableTaskReferences(
		input.continuation.durableTaskReferences,
		checkpoint.durableTaskReferences,
	);
	const durableProgressClaims = mergeDurableProgressClaims(
		input.continuation.durableProgressClaims,
		checkpoint.durableProgressClaims,
	);
	return {
		...input.continuation,
		...(userIntentContract ? { userIntentContract } : {}),
		...(durableTaskReferences.length > 0 ? { durableTaskReferences } : {}),
		...(durableProgressClaims.length > 0 ? { durableProgressClaims } : {}),
	};
}

export async function resumePersistedAgentsChatTurn(input: Readonly<{
	c: AppContext;
	userId: string;
	sessionKey: string;
	turnId: string;
}>): Promise<PersistedAgentsChatResumeResult> {
	const userId = input.userId.trim();
	const sessionKey = input.sessionKey.trim();
	const turnId = input.turnId.trim();
	if (!userId || !sessionKey || !turnId) {
		throw new AppError("turnId 必填；续跑必须绑定当前已确认的挂起回合。", {
			status: 400,
			code: "chat_resume_turn_id_required",
		});
	}
	const snapshot = await getAgentsChatTurnStatus(input.c, userId, sessionKey, {
		timeoutMs: PUBLIC_CHAT_RUNTIME_STATUS_DEADLINE_MS,
	});
	if (snapshot.activeTurn) {
		throw new AppError("当前会话仍有物理回合在执行，禁止并发续跑。", {
			status: 409,
			code: "chat_resume_turn_active",
			details: { activeTurnId: snapshot.turn?.turnId ?? null },
		});
	}
	if (!snapshot.turn || snapshot.turn.turnId !== turnId) {
		throw new AppError("目标挂起回合已经变化，未启动续跑。", {
			status: 409,
			code: "chat_resume_turn_mismatch",
			details: {
				requestedTurnId: turnId,
				currentTurnId: snapshot.turn?.turnId ?? null,
			},
		});
	}
	let recoveryKind: PersistedAgentsChatResumeResult["recoveryKind"] =
		resolveInactiveChatTurnRecoveryKind(snapshot.turn) ?? "orphaned_continuation";
	let claim: Awaited<ReturnType<typeof claimSessionPhysicalBudgetContinuation>>;
	if (recoveryKind === "orphaned_continuation") {
		const lifecycle = await getExecutionTraceLifecycleSnapshot(input.c.env.DB, {
			traceId: turnId,
			userId,
		});
		if (!isPersistedContinuationRecoveryLifecycleEligible({ turnId, lifecycle })) {
			throw new AppError("当前回合不是可续跑的持久挂起、失联 checkpoint 或等待异步恢复的逻辑任务。", {
				status: 409,
				code: "chat_resume_state_invalid",
				details: {
					state: snapshot.turn.state,
					reasonCode: snapshot.turn.reasonCode,
					traceStatus: lifecycle?.status ?? null,
				},
			});
		}
		claim = await claimSessionOrphanedPhysicalBudgetContinuation({
			c: input.c,
			userId,
			sessionKey,
			rootRequestId: turnId,
		});
	} else {
		claim = recoveryKind === "physical_budget"
			? await claimSessionPhysicalBudgetContinuation({ c: input.c, userId, sessionKey, rootRequestId: turnId })
			: await claimSessionOrphanedPhysicalBudgetContinuation({
				c: input.c,
				userId,
				sessionKey,
				rootRequestId: turnId,
			});
	}
	if (recoveryKind === "physical_budget" && claim.status !== "claimed") {
		const failedClaim = await claimSessionOrphanedPhysicalBudgetContinuation({
			c: input.c,
			userId,
			sessionKey,
			rootRequestId: turnId,
		});
		if (failedClaim.status === "claimed") {
			claim = {
				...failedClaim,
				continuation: mergeClaimedContinuationRecoveryCheckpoint({
					continuation: failedClaim.continuation,
					recoveryCheckpoint: snapshot.turn.recoveryCheckpoint,
				}),
			};
		}
	}
	const recoverySuspension = recoveryKind === "orphaned_continuation"
		? null
		: resolveRecoveryContinuationSuspension({
			recoveryKind,
			reasonCode: snapshot.turn.reasonCode,
			suspension: snapshot.turn.suspension,
			recoveryCheckpoint: snapshot.turn.recoveryCheckpoint,
		});
	if (claim.status !== "claimed" && recoverySuspension && snapshot.turn.recoveryCheckpoint) {
		const registration = await recoverMissingPhysicalContinuation({
			c: input.c,
			userId,
			sessionKey,
			turnId,
			suspension: recoverySuspension,
			recoveryCheckpoint: snapshot.turn.recoveryCheckpoint,
		});
		if (registration.status === "registered" && registration.created) {
			const scheduled = await scheduleRegisteredPhysicalBudgetContinuation(input.c, registration);
			if (scheduled) {
				return {
					ok: true,
					resumed: true,
					sessionKey,
					turnId,
					continuationId: registration.continuation.id,
					stage: registration.continuation.stage,
					resumeTrigger: registration.continuation.resumeTrigger,
					recoveryKind,
				};
			}
		}
		claim = await claimSessionPhysicalBudgetContinuation({
			c: input.c,
			userId,
			sessionKey,
			rootRequestId: turnId,
		});
	}
	if (claim.status !== "claimed") {
		throw new AppError("当前回合没有可认领的持久续跑合同。", {
			status: 409,
			code: "chat_resume_continuation_not_ready",
			details: {
				waitingCount: claim.waitingCount,
				invalidCount: claim.invalidCount,
			},
		});
	}
	const checkpointEnrichedContinuation = mergeClaimedContinuationRecoveryCheckpoint({
		continuation: claim.continuation,
		recoveryCheckpoint: snapshot.turn.recoveryCheckpoint,
	});
	const enrichedContinuation = await enrichContinuationWithSettledTaskArtifacts(
		input.c,
		checkpointEnrichedContinuation,
	);
	const checkpointPersisted = await transitionClaimedTaskStatus(input.c.env.DB, {
		taskId: enrichedContinuation.id,
		provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
		userId: enrichedContinuation.userId,
		status: "claimed",
		data: enrichedContinuation,
		claimToken: enrichedContinuation.claimToken,
		completedAt: null,
		nowIso: new Date().toISOString(),
	});
	if (!checkpointPersisted) {
		throw new AppError("续跑领取已被更新或取消，未重复执行。", {
			status: 409,
			code: "chat_resume_claim_superseded",
		});
	}
	const scheduled = await scheduleAsyncAgentContinuations(input.c, [enrichedContinuation]);
	return {
		ok: true,
		resumed: scheduled === 1,
		sessionKey,
		turnId,
		continuationId: enrichedContinuation.id,
		stage: enrichedContinuation.stage,
		resumeTrigger: enrichedContinuation.resumeTrigger,
		recoveryKind,
	};
}

export async function handlePublicAgentsChatResumeRoute(c: AppContext): Promise<Response> {
	const userId = requireChatRuntimeUserId(c);
	const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
	const sessionKey = resolveChatRuntimeSessionKey(body);
	const turnId = typeof body.turnId === "string" ? body.turnId.trim() : "";
	return c.json(await resumePersistedAgentsChatTurn({ c, userId, sessionKey, turnId }));
}

type InactiveChatTurnRecoveryInput = {
	state: string;
	phase: string;
	reasonCode: string | null;
};

/**
 * Classifies only the inactive physical checkpoint shape. The subsequent CAS
 * claim still proves that an exact server-authored continuation exists for the
 * same user/session; this function never creates a task or reinterprets text.
 */
export function resolveInactiveChatTurnRecoveryKind(
	turn: InactiveChatTurnRecoveryInput,
): "physical_budget" | "orphaned_checkpoint" | null {
	if (turn.state === "suspended") return turn.reasonCode === "provider_stream_interrupted"
		? "orphaned_checkpoint"
		: "physical_budget";
	if (turn.state === "failed") return "orphaned_checkpoint";
	if (
		turn.state === "unknown" &&
		(
			turn.phase === "accepted" ||
			turn.phase === "agent_running" ||
			turn.phase === "completion_verifying"
		)
	) return "orphaned_checkpoint";
	return null;
}

/**
 * 显式中断在飞聊天回合（POST /public/agents/chat/interrupt）。
 * turnId 是乐观并发令牌：迟到按钮不得中断同一会话里后来启动的新回合。Hono 本地 transport
 * controller 与 agents-cli runtime 都执行同一 turnId 核对，刷新或 Hono 重启后仍可精确中断。
 */
type PublicChatInterruptError = Readonly<{
	code: string;
	message: string;
	details?: unknown;
}>;

export type PublicChatInterruptCompositeReceipt = Readonly<{
	ok: true;
	interrupted: boolean;
	fullyInterrupted: boolean;
	sessionKey: string;
	turnId: string;
	localTransport:
		| Readonly<{ status: "interrupted" | "not_running" }>
		| Readonly<{ status: "failed"; error: PublicChatInterruptError }>;
	runtime:
		| Readonly<{ status: "interrupted" | "already_inactive"; turnId: string | null }>
		| Readonly<{ status: "unknown" | "failed"; error: PublicChatInterruptError }>;
	continuations:
		| Readonly<{ status: "cancelled" | "none"; cancelledCount: number }>
		| Readonly<{ status: "failed"; cancelledCount: 0; error: PublicChatInterruptError }>;
	status: AgentsChatTurnStatusSnapshot | null;
}>;

export type PublicChatInterruptDependencies = Readonly<{
	interruptLocalTransport: () => boolean;
	interruptRuntime: () => Promise<AgentsChatTurnInterruptReceipt>;
	cancelContinuations: () => Promise<number>;
}>;

function toPublicChatInterruptError(error: unknown, fallbackCode: string): PublicChatInterruptError {
	if (error instanceof AppError) {
		return {
			code: error.code,
			message: error.message,
			...(typeof error.details === "undefined" ? {} : { details: error.details }),
		};
	}
	if (error && typeof error === "object") {
		const record = error as Record<string, unknown>;
		return {
			code: typeof record.code === "string" && record.code.trim() ? record.code.trim() : fallbackCode,
			message: typeof record.message === "string" && record.message.trim()
				? record.message.trim()
				: "Unknown interruption failure",
			...(typeof record.details === "undefined" ? {} : { details: record.details }),
		};
	}
	return {
		code: fallbackCode,
		message: error instanceof Error ? error.message : String(error),
	};
}

/**
 * Coordinates three independent cancellation planes. No branch is allowed to
 * suppress either of the other two, because each plane owns different durable
 * work and therefore has an orthogonal outcome.
 */
export async function coordinatePublicChatInterrupt(input: Readonly<{
	sessionKey: string;
	turnId: string;
	dependencies: PublicChatInterruptDependencies;
}>): Promise<PublicChatInterruptCompositeReceipt> {
	let localTransport: PublicChatInterruptCompositeReceipt["localTransport"];
	try {
		localTransport = input.dependencies.interruptLocalTransport()
			? { status: "interrupted" }
			: { status: "not_running" };
	} catch (error: unknown) {
		localTransport = {
			status: "failed",
			error: toPublicChatInterruptError(error, "chat_interrupt_local_transport_failed"),
		};
	}

	const runtimeAttempt = async (): Promise<Readonly<{
		receipt: PublicChatInterruptCompositeReceipt["runtime"];
		status: AgentsChatTurnStatusSnapshot | null;
		interrupted: boolean;
	}>> => {
		try {
			const receipt = await input.dependencies.interruptRuntime();
			return {
				receipt: {
					status: receipt.interrupted ? "interrupted" : "already_inactive",
					turnId: receipt.turnId,
				},
				status: receipt.status,
				interrupted: receipt.interrupted,
			};
		} catch (error: unknown) {
			return {
				receipt: {
					status: isAgentsChatRuntimeOutcomeUnknown(error) ? "unknown" : "failed",
					error: toPublicChatInterruptError(error, "chat_interrupt_runtime_failed"),
				},
				status: null,
				interrupted: false,
			};
		}
	};

	const continuationAttempt = async (): Promise<Readonly<{
		receipt: PublicChatInterruptCompositeReceipt["continuations"];
		interrupted: boolean;
	}>> => {
		try {
			const cancelledCount = await input.dependencies.cancelContinuations();
			return {
				receipt: {
					status: cancelledCount > 0 ? "cancelled" : "none",
					cancelledCount,
				},
				interrupted: cancelledCount > 0,
			};
		} catch (error: unknown) {
			return {
				receipt: {
					status: "failed",
					cancelledCount: 0,
					error: toPublicChatInterruptError(error, "chat_interrupt_continuation_cancel_failed"),
				},
				interrupted: false,
			};
		}
	};

	const [runtimeResult, continuationResult] = await Promise.all([
		runtimeAttempt(),
		continuationAttempt(),
	]);
	const interrupted = localTransport.status === "interrupted"
		|| runtimeResult.interrupted
		|| continuationResult.interrupted;
	const fullyInterrupted = localTransport.status !== "failed"
		&& runtimeResult.receipt.status !== "failed"
		&& runtimeResult.receipt.status !== "unknown"
		&& continuationResult.receipt.status !== "failed";

	return {
		ok: true,
		interrupted,
		fullyInterrupted,
		sessionKey: input.sessionKey,
		turnId: input.turnId,
		localTransport,
		runtime: runtimeResult.receipt,
		continuations: continuationResult.receipt,
		status: runtimeResult.status,
	};
}

export async function handlePublicAgentsChatInterruptRoute(c: AppContext): Promise<Response> {
	const userId = requireChatRuntimeUserId(c);
	const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
	const sessionKey = resolveChatRuntimeSessionKey(body);
	const turnId = typeof body.turnId === "string" ? body.turnId.trim() : "";
	if (!turnId) {
		throw new AppError("turnId 必填；中断操作必须绑定当前已确认的回合。", {
			status: 400,
			code: "chat_turn_id_required",
		});
	}
	const cancellationScope = body.cancellationScope === "logical_task"
		? "logical_task"
		: body.cancellationScope === undefined || body.cancellationScope === "physical_only"
			? "physical_only"
			: null;
	if (!cancellationScope) {
		throw new AppError("cancellationScope 仅支持 physical_only 或 logical_task。", {
			status: 400,
			code: "chat_interrupt_scope_invalid",
		});
	}
	const inflightKey = buildInflightChatTurnKey(userId, sessionKey);
	const localSnapshot = getInflightChatTurnSnapshot(inflightKey);
	if (localSnapshot && localSnapshot.turnId !== turnId) {
		throw new AppError("目标回合已经变化，未中断当前较新的回合。", {
			status: 409,
			code: "chat_turn_mismatch",
			details: { requestedTurnId: turnId, activeTurnId: localSnapshot.turnId },
		});
	}
	let statusBeforeInterrupt: AgentsChatTurnStatusSnapshot | null = null;
	let statusBeforeInterruptError: unknown = null;
	if (cancellationScope === "logical_task") {
		try {
			statusBeforeInterrupt = await getAgentsChatTurnStatus(c, userId, sessionKey, {
				timeoutMs: PUBLIC_CHAT_RUNTIME_INTERRUPT_DEADLINE_MS,
			});
		} catch (error: unknown) {
			statusBeforeInterruptError = error;
		}
	}
	if (statusBeforeInterrupt?.turn && statusBeforeInterrupt.turn.turnId !== turnId) {
		throw new AppError("目标回合已经变化，未中断当前较新的回合。", {
			status: 409,
			code: "chat_turn_mismatch",
			details: { requestedTurnId: turnId, activeTurnId: statusBeforeInterrupt.turn.turnId },
		});
	}
	const agentExecutionIds = statusBeforeInterrupt?.turn?.executionProvenanceHistory
		?.map((item) => item.executionId)
		.filter((id) => id.trim().length > 0) ?? [];
	const workflowAttempt = async () => {
		if (cancellationScope !== "logical_task") {
			return { status: "none" as const, matchedCount: 0, cancelledCount: 0, executionIds: [], fullyInterrupted: true };
		}
		try {
			const result = await cancelWorkflowExecutionsOwnedByChatTurn({
				context: c,
				userId,
				sessionKey,
				publicTurnId: turnId,
				agentExecutionIds,
			});
			if (statusBeforeInterruptError && result.matchedCount === 0) {
				return {
					status: "failed" as const,
					matchedCount: 0,
					cancelledCount: 0,
					executionIds: [],
					fullyInterrupted: false,
					error: toPublicChatInterruptError(
						statusBeforeInterruptError,
						"chat_interrupt_workflow_ownership_status_unknown",
					),
				};
			}
			return {
				status: result.cancelledCount > 0 ? "cancelled" as const : "none" as const,
				...result,
			};
		} catch (error: unknown) {
			return {
				status: "failed" as const,
				matchedCount: 0,
				cancelledCount: 0,
				executionIds: [],
				fullyInterrupted: false,
				error: toPublicChatInterruptError(error, "chat_interrupt_workflow_cancel_failed"),
			};
		}
	};
	const [receipt, workflowExecutions] = await Promise.all([coordinatePublicChatInterrupt({
		sessionKey,
		turnId,
		dependencies: {
			interruptLocalTransport: () => interruptInflightChatTurn(inflightKey, turnId),
			interruptRuntime: () => interruptAgentsChatTurn(c, userId, {
				sessionId: sessionKey,
				turnId,
			}, {
				timeoutMs: PUBLIC_CHAT_RUNTIME_INTERRUPT_DEADLINE_MS,
			}),
			cancelContinuations: () => cancelActiveSessionAgentContinuations({
				c,
				userId,
				sessionKey,
				rootRequestId: turnId,
				scope: "physical_only",
			}),
		},
	}), workflowAttempt()]);
	return c.json({
		...receipt,
		interrupted: receipt.interrupted || workflowExecutions.cancelledCount > 0,
		fullyInterrupted: receipt.fullyInterrupted && workflowExecutions.fullyInterrupted,
		cancellationScope,
		workflowExecutions,
	});
}
