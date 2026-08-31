import type { AppContext } from "../../types";
import {
	createTaskStatusIfAbsent,
	listTaskStatusesByProvider,
	requeueStaleClaimedTaskStatuses,
	tryClaimTaskStatus,
	upsertTaskStatus,
} from "./task-status.repo";
import {
	AgentsChatRequestSchema,
	AgentsChatResponseSchema,
	type AgentsChatRequestDto,
	type AgentsChatResponseDto,
} from "../apiKey/apiKey.schemas";
import {
	persistAgentsChatConversationTurn,
	type AgentsChatConversationPublicationMode,
} from "../apiKey/public-agents-chat-response";
import { TaskResultSchema, type TaskResultDto } from "./task.schemas";

export const AGENTS_CHAT_PUBLICATION_PROVIDER = "agents_chat_publication";
const PUBLICATION_CLAIM_LEASE_MS = 5 * 60_000;
const PUBLICATION_MAX_ATTEMPTS = 10;

export type AgentsChatPublicationContractV1 = Readonly<{
	version: 1;
	id: string;
	userId: string;
	publicationId: string;
	publicTurnId: string;
	publicationMode: AgentsChatConversationPublicationMode;
	request: AgentsChatRequestDto;
	response: AgentsChatResponseDto;
	result: TaskResultDto;
	createdAt: string;
	attempt: number;
	lastError: string | null;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAgentsChatPublicationContractV1(value: unknown): AgentsChatPublicationContractV1 | null {
	let parsed: unknown = value;
	if (typeof value === "string") {
		try {
			parsed = JSON.parse(value) as unknown;
		} catch {
			return null;
		}
	}
	if (!isRecord(parsed) || parsed.version !== 1) return null;
	const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
	const userId = typeof parsed.userId === "string" ? parsed.userId.trim() : "";
	const publicationId = typeof parsed.publicationId === "string" ? parsed.publicationId.trim() : "";
	const publicTurnId = typeof parsed.publicTurnId === "string" ? parsed.publicTurnId.trim() : "";
	const publicationMode = parsed.publicationMode === "turn" ||
		parsed.publicationMode === "assistant_only" ||
		parsed.publicationMode === "silent"
		? parsed.publicationMode
		: null;
	const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt.trim() : "";
	const attempt = typeof parsed.attempt === "number" && Number.isInteger(parsed.attempt) && parsed.attempt >= 0
		? parsed.attempt
		: null;
	const lastError = parsed.lastError === null
		? null
		: typeof parsed.lastError === "string" && parsed.lastError.trim()
			? parsed.lastError.trim().slice(0, 1_000)
			: null;
	const request = AgentsChatRequestSchema.safeParse(parsed.request);
	const response = AgentsChatResponseSchema.safeParse(parsed.response);
	const result = TaskResultSchema.safeParse(parsed.result);
	if (
		!id || !userId || !publicationId || !publicTurnId || !publicationMode ||
		!createdAt || attempt === null ||
		!request.success || !response.success || !result.success ||
		response.data.trace?.requestId !== publicTurnId
	) return null;
	return {
		version: 1,
		id,
		userId,
		publicationId,
		publicTurnId,
		publicationMode,
		request: request.data,
		response: response.data,
		result: result.data,
		createdAt,
		attempt,
		lastError,
	};
}

export async function registerAgentsChatPublication(input: {
	c: AppContext;
	userId: string;
	publicationId: string;
	publicTurnId: string;
	publicationMode: AgentsChatConversationPublicationMode;
	request: AgentsChatRequestDto;
	response: AgentsChatResponseDto;
	result: TaskResultDto;
}): Promise<AgentsChatPublicationContractV1> {
	const createdAt = new Date().toISOString();
	const contract: AgentsChatPublicationContractV1 = {
		version: 1,
		id: `agents-chat-publication:${input.publicationId}`,
		userId: input.userId,
		publicationId: input.publicationId,
		publicTurnId: input.publicTurnId,
		publicationMode: input.publicationMode,
		request: input.request,
		response: input.response,
		result: input.result,
		createdAt,
		attempt: 0,
		lastError: null,
	};
	const normalized = parseAgentsChatPublicationContractV1(contract);
	if (!normalized) throw new Error("agents_chat_publication_contract_invalid");
	await createTaskStatusIfAbsent(input.c.env.DB, {
		taskId: contract.id,
		provider: AGENTS_CHAT_PUBLICATION_PROVIDER,
		userId: input.userId,
		status: "claimed",
		data: contract,
		nowIso: createdAt,
	});
	return contract;
}

export async function completeAgentsChatPublication(input: {
	c: AppContext;
	contract: AgentsChatPublicationContractV1;
}): Promise<void> {
	const nowIso = new Date().toISOString();
	await upsertTaskStatus(input.c.env.DB, {
		taskId: input.contract.id,
		provider: AGENTS_CHAT_PUBLICATION_PROVIDER,
		userId: input.contract.userId,
		status: "completed",
		data: input.contract,
		completedAt: nowIso,
		nowIso,
	});
}

async function retryOrFailPublication(
	c: AppContext,
	contract: AgentsChatPublicationContractV1,
	error: unknown,
): Promise<"waiting" | "failed"> {
	const attempt = contract.attempt + 1;
	const nowIso = new Date().toISOString();
	const next: AgentsChatPublicationContractV1 = {
		...contract,
		attempt,
		lastError: (error instanceof Error ? error.message : String(error)).slice(0, 1_000),
	};
	const failed = attempt >= PUBLICATION_MAX_ATTEMPTS;
	await upsertTaskStatus(c.env.DB, {
		taskId: contract.id,
		provider: AGENTS_CHAT_PUBLICATION_PROVIDER,
		userId: contract.userId,
		status: failed ? "failed" : "waiting",
		data: next,
		...(failed ? { completedAt: nowIso } : {}),
		nowIso,
	});
	return failed ? "failed" : "waiting";
}

/** Releases the direct publisher lease immediately after a failed projection. */
export async function deferAgentsChatPublication(input: {
	c: AppContext;
	contract: AgentsChatPublicationContractV1;
	error: unknown;
}): Promise<"waiting" | "failed"> {
	return retryOrFailPublication(input.c, input.contract, input.error);
}

export async function sweepAgentsChatPublications(input: {
	c: AppContext;
	limit?: number;
}): Promise<{ scanned: number; published: number; failed: number; invalid: number; recoveredClaims: number }> {
	const nowMs = Date.now();
	const recoveredClaims = await requeueStaleClaimedTaskStatuses(input.c.env.DB, {
		provider: AGENTS_CHAT_PUBLICATION_PROVIDER,
		staleBeforeIso: new Date(nowMs - PUBLICATION_CLAIM_LEASE_MS).toISOString(),
		nowIso: new Date(nowMs).toISOString(),
	});
	const rows = await listTaskStatusesByProvider(input.c.env.DB, {
		provider: AGENTS_CHAT_PUBLICATION_PROVIDER,
		status: "waiting",
		limit: input.limit ?? 100,
	});
	let published = 0;
	let failed = 0;
	let invalid = 0;
	for (const row of rows) {
		const contract = parseAgentsChatPublicationContractV1(row.data);
		if (!contract) {
			invalid += 1;
			const nowIso = new Date().toISOString();
			await upsertTaskStatus(input.c.env.DB, {
				taskId: row.task_id,
				provider: AGENTS_CHAT_PUBLICATION_PROVIDER,
				userId: row.user_id,
				status: "failed",
				data: {
					version: 1,
					invalid: true,
					reason: "agents_chat_publication_contract_invalid",
				},
				completedAt: nowIso,
				nowIso,
			});
			continue;
		}
		const claimed = await tryClaimTaskStatus(input.c.env.DB, {
			taskId: contract.id,
			provider: AGENTS_CHAT_PUBLICATION_PROVIDER,
			nowIso: new Date().toISOString(),
		});
		if (!claimed) continue;
		try {
			await persistAgentsChatConversationTurn({
				c: input.c,
				userId: contract.userId,
				requestInput: contract.request,
				response: contract.response,
				result: contract.result,
				publicationId: contract.publicationId,
				publicationMode: contract.publicationMode,
			});
			await completeAgentsChatPublication({ c: input.c, contract });
			published += 1;
		} catch (error: unknown) {
			if (await retryOrFailPublication(input.c, contract, error) === "failed") failed += 1;
		}
	}
	return { scanned: rows.length, published, failed, invalid, recoveredClaims };
}
