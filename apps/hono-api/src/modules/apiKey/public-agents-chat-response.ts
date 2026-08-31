import { randomUUID } from "node:crypto";
import type { AppContext } from "../../types";
import { persistUserConversationTurn } from "../memory/memory.service";
import type { TaskAssetDto, TaskResultDto } from "../task/task.schemas";
import {
	AgentsChatResponseSchema,
	PublicChatContinuationRegistrationSchema,
	PublicChatLogicalTaskStateSchema,
	type AgentsChatRequestDto,
	type AgentsChatResponseDto,
} from "./apiKey.schemas";
import {
	appendPublicChatTurnRun,
	buildPublicChatTurnEntityId,
	resolveOrCreatePublicChatSession,
	type PublicChatRunOutcome,
} from "./public-chat-session.repo";

type PublicChatTraceDto = NonNullable<AgentsChatResponseDto["trace"]>;
type PublicChatAgentDecisionDto = NonNullable<AgentsChatResponseDto["agentDecision"]>;

type StructuredAgentsMetadata = {
	agentDecision?: PublicChatAgentDecisionDto;
	trace?: PublicChatTraceDto;
};

type PublicChatLedgerScope = {
	projectId: string | null;
	bookId: string | null;
	chapterId: string | null;
	label: string | null;
};

export type AgentsChatConversationPublicationMode =
	| "turn"
	| "assistant_only"
	| "silent";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalTrimmedString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function normalizePublicChatOutputMode(value: unknown): PublicChatTraceDto["outputMode"] {
	return value === "plan_with_assets" ||
		value === "plan_only" ||
		value === "direct_assets" ||
		value === "text_only"
		? value
		: undefined;
}

function stringifyOptionalJson(value: unknown): string | null {
	if (typeof value === "undefined") return null;
	try {
		return JSON.stringify(value);
	} catch {
		return null;
	}
}

function normalizeResponseAssets(assets: TaskAssetDto[]): AgentsChatResponseDto["assets"] {
	if (!Array.isArray(assets) || assets.length === 0) return undefined;
	const out: NonNullable<AgentsChatResponseDto["assets"]> = [];
	for (const asset of assets) {
		const url = typeof asset.url === "string" ? asset.url.trim() : "";
		if (!url) continue;
		const thumbnailUrl =
			typeof asset.thumbnailUrl === "string" && asset.thumbnailUrl.trim()
				? asset.thumbnailUrl.trim()
				: undefined;
		const assetName =
			typeof asset.assetName === "string" && asset.assetName.trim()
				? asset.assetName.trim()
				: undefined;
		const assetRefId =
			typeof asset.assetRefId === "string" && asset.assetRefId.trim()
				? asset.assetRefId.trim()
				: undefined;
		const assetId =
			typeof asset.assetId === "string" && asset.assetId.trim()
				? asset.assetId.trim()
				: undefined;
		const fileName =
			typeof asset.fileName === "string" && asset.fileName.trim()
				? asset.fileName.trim()
				: undefined;
		const mimeType =
			typeof asset.mimeType === "string" && asset.mimeType.trim()
				? asset.mimeType.trim()
				: undefined;
		out.push({
			type: asset.type,
			url,
			...(thumbnailUrl ? { thumbnailUrl } : {}),
			...(assetName ? { title: assetName } : {}),
			...(assetId ? { assetId } : {}),
			...(assetRefId ? { assetRefId } : {}),
			...(fileName ? { fileName } : {}),
			...(mimeType ? { mimeType } : {}),
		});
		if (out.length >= 24) break;
	}
	return out.length > 0 ? out : undefined;
}

function extractTaskTextFromResult(result: TaskResultDto): string {
	const raw = isPlainRecord(result.raw) ? result.raw : null;
	const directResultText =
		raw && typeof raw.text === "string" && raw.text.trim() ? raw.text.trim() : "";
	if (directResultText) return directResultText;
	const nestedResponse =
		raw && isPlainRecord(raw.response) ? raw.response : null;
	const nestedResponseText =
		nestedResponse && typeof nestedResponse.text === "string" && nestedResponse.text.trim()
			? nestedResponse.text.trim()
			: "";
	if (nestedResponseText) return nestedResponseText;
	const nestedOutputText =
		nestedResponse && typeof nestedResponse.output_text === "string"
			? nestedResponse.output_text.trim()
			: raw && typeof raw.output_text === "string"
				? raw.output_text.trim()
				: "";
	if (nestedOutputText) return nestedOutputText;
	if (nestedResponse && Array.isArray(nestedResponse.output_text)) {
		const merged = nestedResponse.output_text
			.filter((item): item is string => typeof item === "string")
			.join("")
			.trim();
		if (merged) return merged;
	}
	const choiceContent =
		nestedResponse &&
		Array.isArray(nestedResponse.choices) &&
		isPlainRecord(nestedResponse.choices[0]) &&
		isPlainRecord(nestedResponse.choices[0].message) &&
		typeof nestedResponse.choices[0].message.content === "string"
			? nestedResponse.choices[0].message.content.trim()
			: "";
	return choiceContent;
}

function normalizeLogicalTaskState(meta: Record<string, unknown> | null): PublicChatTraceDto["logicalTaskState"] {
	const parsed = PublicChatLogicalTaskStateSchema.safeParse(meta?.logicalTaskState);
	if (parsed.success) return parsed.data;
	const logicalTaskId = normalizeOptionalTrimmedString(meta?.requestId) ?? "logical_task_unknown";
	return {
		version: 1,
		logicalTaskId,
		status: "failed",
		reasonCode: "logical_task_state_invalid",
		physicalRunStatus: "interrupted",
		deliveryStatus: "unsatisfied",
		taskNodeId: logicalTaskId,
		taskRevision: 0,
		updatedAt: new Date().toISOString(),
		continuationTicket: null,
	};
}

function extractStructuredAgentsMetadata(result: TaskResultDto): StructuredAgentsMetadata {
	const raw = isPlainRecord(result.raw) ? result.raw : null;
	const meta = raw && isPlainRecord(raw.meta) ? raw.meta : null;
	const logicalTaskState = normalizeLogicalTaskState(meta);
	if (!meta) {
		return {
			trace: {
				logicalTaskState,
				traceProjection: {
					status: "failed",
					code: "agents_trace_meta_missing",
					issues: [{ path: "raw.meta", message: "Agents 结果缺少结构化 meta。" }],
				},
			},
		};
	}
	const outputMode = normalizePublicChatOutputMode(meta.outputMode);
	const parsedContinuationRegistration = PublicChatContinuationRegistrationSchema.safeParse(
		meta.continuationRegistration,
	);
	const continuationRegistration = parsedContinuationRegistration.success
		? parsedContinuationRegistration.data
		: undefined;
	const parsedAgentDecision = AgentsChatResponseSchema.pick({
		agentDecision: true,
	}).safeParse({
		agentDecision: meta.agentDecision,
	});
	const parsedTrace = AgentsChatResponseSchema.pick({
		trace: true,
	}).safeParse({
		trace: {
			requestId:
				typeof meta.requestId === "string" && meta.requestId.trim()
					? meta.requestId.trim()
					: undefined,
			sessionId:
				typeof meta.sessionId === "string" && meta.sessionId.trim()
					? meta.sessionId.trim()
					: undefined,
			outputMode,
			traceProjection: { status: "complete", code: null, issues: [] },
			toolEvidence: meta.toolEvidence,
			toolStatusSummary: meta.toolStatusSummary,
			canvasMutation: meta.canvasMutation,
			diagnosticFlags: meta.diagnosticFlags,
			canvasPlan: meta.canvasPlan,
			todoList: meta.todoList,
			todoEvents: meta.todoEvents,
			runtime: meta.runtime,
			executionProvenance: meta.executionProvenance,
			turnVerdict: meta.turnVerdict,
			logicalTaskState,
			continuationRegistration,
			expectedDelivery: meta.expectedDelivery,
			deliveryEvidence: meta.deliveryEvidence,
			deliveryVerification: meta.deliveryVerification,
		},
	});
	const projectionIssues = parsedTrace.success
		? []
		: parsedTrace.error.issues.slice(0, 8).map((issue) => ({
				path: issue.path.join("."),
				message: issue.message,
			}));
	const failedProjection = {
		status: "failed" as const,
		code: "agents_trace_projection_invalid",
		issues: projectionIssues,
	};
	const parsedTerminalTrace = AgentsChatResponseSchema.pick({
		trace: true,
	}).safeParse({
		trace: {
			requestId:
				typeof meta.requestId === "string" && meta.requestId.trim()
					? meta.requestId.trim()
					: undefined,
			sessionId:
				typeof meta.sessionId === "string" && meta.sessionId.trim()
					? meta.sessionId.trim()
					: undefined,
				outputMode,
				traceProjection: failedProjection,
			runtime: meta.runtime,
			turnVerdict: meta.turnVerdict,
			logicalTaskState,
			continuationRegistration,
		},
	});
	const parsedMinimalTerminalTrace = AgentsChatResponseSchema.pick({
		trace: true,
	}).parse({
		trace: {
			requestId:
				typeof meta.requestId === "string" && meta.requestId.trim()
					? meta.requestId.trim()
					: undefined,
			sessionId:
				typeof meta.sessionId === "string" && meta.sessionId.trim()
					? meta.sessionId.trim()
					: undefined,
				outputMode,
			traceProjection: failedProjection,
			logicalTaskState,
			continuationRegistration,
		},
	});
	if (!parsedTrace.success) {
		console.warn("[public-agents-chat-response] rich trace projection degraded", {
			requestId: normalizeOptionalTrimmedString(meta.requestId),
			issues: projectionIssues,
		});
	}
	const trace = parsedTrace.success && parsedTrace.data.trace
		? parsedTrace.data.trace
		: parsedTerminalTrace.success
			? parsedTerminalTrace.data.trace
			: parsedMinimalTerminalTrace.trace;
	return {
		...(parsedAgentDecision.success && parsedAgentDecision.data.agentDecision
			? { agentDecision: parsedAgentDecision.data.agentDecision }
			: {}),
		...(trace ? { trace } : {}),
	};
}

export function extractAgentsRawMeta(result: TaskResultDto): Record<string, unknown> | null {
	if (!isPlainRecord(result.raw)) return null;
	const raw = result.raw;
	return isPlainRecord(raw.meta) ? raw.meta : null;
}

// 任务确实缺少不可推导用户事实时，bridge 在结果顶层带 pendingUserInput，必须透传给前端，
// 否则必要输入卡无法渲染，用户也无法补齐该事实。
function extractPendingUserInput(result: TaskResultDto): Record<string, unknown> | null {
	if (!isPlainRecord(result.raw)) return null;
	const pending = result.raw.pendingUserInput;
	return isPlainRecord(pending) ? pending : null;
}

function extractAgentsChatModelMetadata(result: TaskResultDto): {
	modelKey?: string;
	modelAlias?: string;
} {
	const rawMeta = extractAgentsRawMeta(result);
	if (!rawMeta) return {};
	const modelKey = normalizeOptionalTrimmedString(rawMeta.modelKey);
	const modelAlias = normalizeOptionalTrimmedString(rawMeta.modelAlias);
	return {
		...(modelKey ? { modelKey } : {}),
		...(modelAlias ? { modelAlias } : {}),
	};
}

export function buildAgentsChatResponseFromTaskResult(
	result: TaskResultDto,
	options?: Readonly<{ publicTurnId?: string | null }>,
): AgentsChatResponseDto {
	const structuredMetadata = extractStructuredAgentsMetadata(result);
	const pendingUserInput = extractPendingUserInput(result);
	const modelMetadata = extractAgentsChatModelMetadata(result);
	const publicTurnId = normalizeOptionalTrimmedString(options?.publicTurnId);
	const responseTrace = structuredMetadata.trace && publicTurnId
		? { ...structuredMetadata.trace, requestId: publicTurnId }
		: structuredMetadata.trace;
	// A suspended request only closes one physical execution window. Its raw
	// result text is operational evidence for diagnostics and continuation, not
	// an assistant reply in the user's logical conversation.
	const publicText = responseTrace?.logicalTaskState?.status === "active" ||
		responseTrace?.logicalTaskState?.status === "waiting_external"
		? ""
		: extractTaskTextFromResult(result);
	const response = {
		id: result.id,
		vendor: "agents",
		...modelMetadata,
		text: publicText,
		...(result.assets.length ? { assets: normalizeResponseAssets(result.assets) } : {}),
		...(structuredMetadata.agentDecision ? { agentDecision: structuredMetadata.agentDecision } : {}),
		...(responseTrace ? { trace: responseTrace } : {}),
		...(pendingUserInput ? { pendingUserInput } : {}),
	};
	return AgentsChatResponseSchema.parse(response);
}

function derivePublicChatWorkflowKey(input: {
	mode?: AgentsChatRequestDto["mode"];
	planOnly?: boolean;
	forceAssetGeneration?: boolean;
}): string {
	if (input.forceAssetGeneration === true) return "public_chat.asset_forced";
	if (input.planOnly === true) return "public_chat.plan_only";
	if (input.mode === "auto") return "public_chat.auto";
	return "public_chat.chat";
}

function derivePublicChatRunOutcome(input: {
	turnVerdict: NonNullable<PublicChatTraceDto["turnVerdict"]>["status"];
	assetCount: number;
	canvasWrite: boolean;
}): PublicChatRunOutcome {
	if (input.turnVerdict === "failed") return "discard";
	if (input.turnVerdict === "partial") return "hold";
	return input.canvasWrite || input.assetCount > 0 ? "promote" : "hold";
}

function derivePublicChatLedgerScope(input: {
	requestInput: AgentsChatRequestDto;
	rawMeta: Record<string, unknown> | null;
}): PublicChatLedgerScope {
	const selectedReference = input.requestInput.chatContext?.selectedReference;
	return {
		projectId:
			normalizeOptionalTrimmedString(input.rawMeta?.projectId) ??
			normalizeOptionalTrimmedString(input.requestInput.canvasProjectId),
		bookId:
			normalizeOptionalTrimmedString(input.rawMeta?.bookId) ??
			normalizeOptionalTrimmedString(input.requestInput.bookId) ??
			normalizeOptionalTrimmedString(selectedReference?.bookId),
		chapterId:
			normalizeOptionalTrimmedString(input.rawMeta?.chapterId) ??
			normalizeOptionalTrimmedString(input.requestInput.chapterId) ??
			normalizeOptionalTrimmedString(selectedReference?.chapterId),
		label: normalizeOptionalTrimmedString(input.rawMeta?.label),
	};
}

export async function persistAgentsChatConversationTurn(input: {
	c: AppContext;
	userId: string;
	requestInput: AgentsChatRequestDto;
	response: AgentsChatResponseDto;
	result: TaskResultDto;
	publicationId?: string;
	publicationMode?: AgentsChatConversationPublicationMode;
}): Promise<void> {
	const sessionKey =
		typeof input.requestInput.sessionKey === "string" ? input.requestInput.sessionKey.trim() : "";
	if (!sessionKey) return;

	const publicationMode = input.publicationMode ?? "turn";
	const trace = input.response.trace;
	const publicTurnId = trace?.requestId?.trim();
	if (!publicTurnId) throw new Error("public chat publication requires a stable trace.requestId");
	const publicationId = input.publicationId?.trim() || publicTurnId;
	const userText = publicationMode === "turn"
		? (
			typeof input.requestInput.displayPrompt === "string" && input.requestInput.displayPrompt.trim()
				? input.requestInput.displayPrompt.trim()
				: typeof input.requestInput.prompt === "string" && input.requestInput.prompt.trim()
					? input.requestInput.prompt.trim()
					: ""
		)
		: "";
	const assistantText = publicationMode === "silent" ? "" : input.response.text;
	const persisted = publicationMode === "silent"
		? await resolveOrCreatePublicChatSession(input.c.env.DB, {
			id: randomUUID(),
			userId: input.userId,
			sessionKey,
			nowIso: new Date().toISOString(),
		}).then((session) => session
			? {
				sessionId: session.id,
				userMessageId: null,
				assistantMessageId: null,
			}
			: null)
		: await persistUserConversationTurn(input.c, {
			userId: input.userId,
			sessionKey,
			turnId: publicationId,
			userText,
			assistantText,
			assistantAssets: input.response.assets ?? [],
			assistantExecutionProvenance: input.response.trace?.executionProvenance,
		});
	if (!persisted || !trace?.turnVerdict) return;
	if (typeof trace.outputMode !== "string" || !trace.outputMode.trim()) {
		throw new Error("public chat trace is missing the required outputMode");
	}

	const rawMeta = extractAgentsRawMeta(input.result);
	const assetCount = Array.isArray(input.response.assets) ? input.response.assets.length : 0;
	const canvasWrite = trace.toolEvidence?.wroteCanvas === true;
	const ledgerScope = derivePublicChatLedgerScope({
		requestInput: input.requestInput,
		rawMeta,
	});
	await appendPublicChatTurnRun(input.c.env.DB, {
		id: buildPublicChatTurnEntityId({
			kind: "turn_run",
			userId: input.userId,
			sessionKey,
			turnId: publicationId,
		}),
		userId: input.userId,
		sessionId: persisted.sessionId,
		requestId: trace.requestId ?? null,
		sessionKey,
		projectId: ledgerScope.projectId,
		bookId: ledgerScope.bookId,
		chapterId: ledgerScope.chapterId,
		label: ledgerScope.label,
		workflowKey: derivePublicChatWorkflowKey({
			mode: input.requestInput.mode,
			planOnly: input.requestInput.planOnly === true,
			forceAssetGeneration: input.requestInput.forceAssetGeneration === true,
		}),
		requestKind: "chat",
		userMessageId: persisted.userMessageId,
		assistantMessageId: persisted.assistantMessageId,
		outputMode: trace.outputMode,
		turnVerdict: trace.turnVerdict.status,
		turnVerdictReasonsJson: JSON.stringify(trace.turnVerdict.reasons),
		runOutcome: derivePublicChatRunOutcome({
			turnVerdict: trace.turnVerdict.status,
			assetCount,
			canvasWrite,
		}),
		agentDecisionJson: stringifyOptionalJson(input.response.agentDecision),
		toolStatusSummaryJson: stringifyOptionalJson(trace.toolStatusSummary),
		diagnosticFlagsJson: stringifyOptionalJson(trace.diagnosticFlags),
		canvasPlanJson: stringifyOptionalJson(trace.canvasPlan),
		assetCount,
		canvasWrite,
		runMs: trace.toolStatusSummary?.runMs ?? null,
		nowIso: new Date().toISOString(),
	});
}

export async function persistInterruptedAgentsChatRun(input: {
	c: AppContext;
	userId: string;
	requestInput: AgentsChatRequestDto;
	publicTurnId: string;
	reasonCode: string;
	runMs: number;
}): Promise<void> {
	const sessionKey = typeof input.requestInput.sessionKey === "string"
		? input.requestInput.sessionKey.trim()
		: "";
	if (!sessionKey) return;
	const nowIso = new Date().toISOString();
	const session = await resolveOrCreatePublicChatSession(input.c.env.DB, {
		id: randomUUID(),
		userId: input.userId,
		sessionKey,
		nowIso,
	});
	if (!session) {
		throw new Error("interrupted public chat run could not resolve its durable session");
	}
	const reasonCode = input.reasonCode.trim() || "turn_interrupted";
	const scope = derivePublicChatLedgerScope({
		requestInput: input.requestInput,
		rawMeta: null,
	});
	await appendPublicChatTurnRun(input.c.env.DB, {
		id: randomUUID(),
		userId: input.userId,
		sessionId: session.id,
		requestId: input.publicTurnId.trim() || null,
		sessionKey,
		projectId: scope.projectId,
		bookId: scope.bookId,
		chapterId: scope.chapterId,
		label: scope.label,
		workflowKey: derivePublicChatWorkflowKey({
			mode: input.requestInput.mode,
			planOnly: input.requestInput.planOnly === true,
			forceAssetGeneration: input.requestInput.forceAssetGeneration === true,
		}),
		requestKind: "chat",
		userMessageId: null,
		assistantMessageId: input.requestInput.clientPendingId?.trim() || null,
		outputMode: "interrupted",
		turnVerdict: "failed",
		turnVerdictReasonsJson: JSON.stringify([reasonCode]),
		runOutcome: "discard",
		diagnosticFlagsJson: JSON.stringify([{
			code: reasonCode,
			severity: "high",
			title: "Agent turn interrupted",
			detail: "The public turn ended before a normal agents bridge result was produced.",
		}]),
		assetCount: 0,
		canvasWrite: false,
		runMs: Math.max(0, Math.trunc(input.runMs)),
		nowIso,
	});
}
