import { setTimeout as delay } from "node:timers/promises";
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import {
	getAgentsChatTurnStatus,
	type AgentsChatTurnStatusSnapshot,
} from "./task.agents-chat-runtime";

export const OPENAI_LOGICAL_TURN_WAIT_TIMEOUT_MS = 15 * 60_000;
export const OPENAI_LOGICAL_TURN_POLL_INTERVAL_MS = 1_000;
const OPENAI_LOGICAL_TURN_STATUS_TIMEOUT_MS = 10_000;

export type OpenAiLogicalTurnTerminal = Readonly<{
	status: "succeeded" | "needs_input";
	text: string;
	snapshot: AgentsChatTurnStatusSnapshot;
}>;

type ReadStatus = () => Promise<AgentsChatTurnStatusSnapshot>;

function terminalFailure(snapshot: AgentsChatTurnStatusSnapshot): AppError {
	const turn = snapshot.turn;
	const code = turn?.reasonCode?.trim() || "xiaot_logical_turn_failed";
	return new AppError(turn?.lastConfirmedSummary?.trim() || "小T逻辑任务执行失败", {
		status: 502,
		code,
		details: {
			turnId: turn?.turnId ?? null,
			state: turn?.state ?? "unknown",
			phase: turn?.phase ?? null,
		},
	});
}

export async function waitForOpenAiLogicalTurnTerminal(input: Readonly<{
	rootRequestId: string;
	readStatus: ReadStatus;
	abortSignal?: AbortSignal;
	timeoutMs?: number;
	pollIntervalMs?: number;
	now?: () => number;
	delay?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}>): Promise<OpenAiLogicalTurnTerminal> {
	const rootRequestId = input.rootRequestId.trim();
	if (!rootRequestId) {
		throw new AppError("OpenAI 兼容调用缺少稳定逻辑回合身份", {
			status: 500,
			code: "xiaot_logical_turn_identity_missing",
		});
	}
	const timeoutMs = input.timeoutMs ?? OPENAI_LOGICAL_TURN_WAIT_TIMEOUT_MS;
	const pollIntervalMs = input.pollIntervalMs ?? OPENAI_LOGICAL_TURN_POLL_INTERVAL_MS;
	const now = input.now ?? Date.now;
	const wait = input.delay ?? (async (milliseconds, signal) => {
		await delay(milliseconds, undefined, signal ? { signal } : undefined);
	});
	const startedAt = now();

	while (now() - startedAt < timeoutMs) {
		if (input.abortSignal?.aborted) {
			throw new AppError("OpenAI 兼容调用等待逻辑终态时已被中断", {
				status: 499,
				code: "xiaot_logical_turn_wait_aborted",
			});
		}
		const snapshot = await input.readStatus();
		const turn = snapshot.turn;
		if (turn && turn.turnId !== rootRequestId) {
			throw new AppError("小T会话当前回合与外部请求身份不一致", {
				status: 409,
				code: "xiaot_logical_turn_identity_changed",
				details: { expectedTurnId: rootRequestId, actualTurnId: turn.turnId },
			});
		}
		if (turn?.state === "succeeded") {
			const hasFinalResponseEvidence = turn.terminalDelivery?.deliveryEvidence.some(
				(evidence) => evidence.kind === "final_response",
			) === true;
			if (!turn.terminalDelivery || !hasFinalResponseEvidence || !turn.finalResponse?.trim()) {
				throw new AppError("小T逻辑任务已标记成功，但缺少完整终态交付链", {
					status: 502,
					code: "terminal_delivery_chain_invalid",
					details: { turnId: rootRequestId },
				});
			}
			return { status: "succeeded", text: turn.finalResponse.trim(), snapshot };
		}
		if (turn?.state === "needs_input") {
			const text = turn.finalResponse?.trim() || turn.lastConfirmedSummary.trim();
			if (!text) {
				throw new AppError("小T需要用户输入，但缺少可交付的问题正文", {
					status: 502,
					code: "xiaot_needs_input_payload_missing",
					details: { turnId: rootRequestId },
				});
			}
			return { status: "needs_input", text, snapshot };
		}
		if (turn?.state === "failed" || turn?.state === "cancelled") {
			throw terminalFailure(snapshot);
		}
		await wait(pollIntervalMs, input.abortSignal);
	}

	throw new AppError("小T逻辑任务在外部同步调用时限内未到达终态", {
		status: 504,
		code: "xiaot_logical_turn_timeout",
		details: { turnId: rootRequestId, timeoutMs },
	});
}

export function waitForPersistedOpenAiLogicalTurn(input: Readonly<{
	c: AppContext;
	userId: string;
	sessionKey: string;
	rootRequestId: string;
	abortSignal?: AbortSignal;
}>): Promise<OpenAiLogicalTurnTerminal> {
	return waitForOpenAiLogicalTurnTerminal({
		rootRequestId: input.rootRequestId,
		readStatus: () => getAgentsChatTurnStatus(input.c, input.userId, input.sessionKey, {
			timeoutMs: OPENAI_LOGICAL_TURN_STATUS_TIMEOUT_MS,
			...(input.abortSignal ? { signal: input.abortSignal } : {}),
		}),
		...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
	});
}
