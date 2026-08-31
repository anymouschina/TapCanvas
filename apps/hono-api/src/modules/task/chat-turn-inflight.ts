// 在飞聊天回合登记表（进程级单例）。
//
// 背景（2026-07-07 jiaolong-v1 实测）：/public/agents/chat 流式路径是 S2 有意解耦——客户端断连
// (idle 超时/切标签页)不掐服务端 run，代价是用户点「中断」也停不掉在飞回合；用户中断后重发，
// 新旧两个回合在不同 bridge 副本上并发改编同一段文本、互相 reset 同一 runId 的镜头表。
//
// 这张表补上两条通道（都以显式信号区别于「断连」）：
//  1. 显式中断：POST /public/agents/chat/interrupt 按 (userId, sessionKey) 精确 abort 在飞回合；
//  2. 同会话互斥：同 (userId, sessionKey) 已有回合时拒绝普通新回合；调整进行中的任务必须显式
//     使用 durable queue，停止任务必须显式调用 interrupt，禁止一条迟到消息隐式顶掉原回合。
//
// abort 的传导链：hono 侧 fetch abort → nginx LB 关上游连接（proxy_ignore_client_abort 默认 off）
// → bridge http-server onClose → responseAbort → agent run abortSignal。对 bridge 零改动。
//
// 注意：hono-api 目前单副本，进程级 Map 即全局真相；若未来多副本，需要挪到 Redis。

export const CHAT_TURN_USER_INTERRUPT_REASON = "chat_turn_user_interrupt";
export const CHAT_TURN_SYSTEM_RECOVERY_INTERRUPT_REASON = "provider_stream_interrupted";
export type ChatTurnInterruptReasonCode =
	| typeof CHAT_TURN_USER_INTERRUPT_REASON
	| typeof CHAT_TURN_SYSTEM_RECOVERY_INTERRUPT_REASON;

/** 当前会话已有回合在飞时，新普通回合被拒绝注册的错误码。 */
export const CHAT_TURN_BUSY_CODE = "chat_turn_inflight";

export type InflightChatTurnHandle = {
	signal: AbortSignal;
	release: () => void;
};

export type InflightChatTurnSnapshot = {
	turnId: string;
	startedAt: string;
	active: true;
};

/**
 * 受保护回合正在跑：新回合不得顶替（见 registerInflightChatTurn）。
 *
 * 背景（2026-07-29 ch1243 实测）：「本章做成视频」回合已跑 53s、完成 5 个工具（读原文/画布/
 * 画风锚/资产候选）正在推进，同会话来了一句普通提问 → 旧回合被 supersede abort →
 * new-api 记 client_gone/received=0、白扣 111103 prompt tokens（completion_tokens=0），
 * 画布零产出。用户视角就是「一键成片没反应」。
 *
 * 「后到者胜」对两个等价短回合是对的，但用一句提问掀掉一个已授权的长生产回合不是。
 */
export class ChatTurnInflightError extends Error {
	readonly code = CHAT_TURN_BUSY_CODE;
	readonly details: { priorRequestId: string; priorAgeMs: number };

	constructor(priorRequestId: string, priorAgeMs: number) {
		super(
			"当前会话仍有任务在执行，本条消息未发送。你可以把它作为调整要求加入当前任务，或先中断当前任务。",
		);
		this.name = "ChatTurnInflightError";
		this.details = { priorRequestId, priorAgeMs };
	}
}

type InflightChatTurnEntry = {
	key: string;
	requestId: string;
	startedAt: number;
	controller: AbortController;
};

const inflightTurns = new Map<string, InflightChatTurnEntry>();

export function buildInflightChatTurnKey(
	userId: string | null | undefined,
	sessionKey: string | null | undefined,
): string | null {
	const user = String(userId ?? "").trim();
	const session = String(sessionKey ?? "").trim();
	if (!user || !session) return null;
	return `${user}::${session}`;
}

/**
 * 注册一个新的在飞回合。同一会话 lane 任一时刻只允许一个主回合；若已有回合则拒绝新普通回合，
 * 原回合保持运行。进行中调整走 durable queue，停止走显式 interrupt。
 * 返回的 release 只清除自己这条登记（幂等，且不会误删后来者）。
 */
export function registerInflightChatTurn(
	key: string | null,
	requestId: string,
): InflightChatTurnHandle | null {
	if (!key) return null;
	const prior = inflightTurns.get(key);
	if (prior) {
		const priorAgeMs = Date.now() - prior.startedAt;
		console.warn(
			`[agents-chat] inflight turn busy — new turn rejected key=${key} priorRequestId=${prior.requestId} priorAgeMs=${priorAgeMs} newRequestId=${requestId}`,
		);
		throw new ChatTurnInflightError(prior.requestId, priorAgeMs);
	}
	const entry: InflightChatTurnEntry = {
		key,
		requestId,
		startedAt: Date.now(),
		controller: new AbortController(),
	};
	inflightTurns.set(key, entry);
	return {
		signal: entry.controller.signal,
		release: () => {
			if (inflightTurns.get(key) === entry) inflightTurns.delete(key);
		},
	};
}

export function getInflightChatTurnSnapshot(key: string | null): InflightChatTurnSnapshot | null {
	if (!key) return null;
	const entry = inflightTurns.get(key);
	if (!entry) return null;
	return {
		turnId: entry.requestId,
		startedAt: new Date(entry.startedAt).toISOString(),
		active: true,
	};
}

/** 用户显式中断：仅当 turnId 仍匹配时 abort，避免迟到的中断误杀后来回合。 */
export function interruptInflightChatTurn(
	key: string | null,
	expectedTurnId: string,
	reasonCode: ChatTurnInterruptReasonCode = CHAT_TURN_USER_INTERRUPT_REASON,
): boolean {
	if (!key) return false;
	const entry = inflightTurns.get(key);
	if (!entry) return false;
	const normalizedExpectedTurnId = String(expectedTurnId || "").trim();
	if (!normalizedExpectedTurnId || normalizedExpectedTurnId !== entry.requestId) return false;
	inflightTurns.delete(key);
	entry.controller.abort(new Error(reasonCode));
	console.warn(
		`[agents-chat] inflight turn interrupted key=${key} requestId=${entry.requestId} ageMs=${Date.now() - entry.startedAt}`,
	);
	return true;
}

/** 合并多个 abort 信号：任一触发即触发（AbortSignal.any 的降级兼容封装）。 */
export function anyAbortSignal(signals: Array<AbortSignal | null | undefined>): AbortSignal | undefined {
	const list = signals.filter((item): item is AbortSignal => Boolean(item));
	if (list.length === 0) return undefined;
	if (list.length === 1) return list[0];
	const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
	if (typeof anyFn === "function") return anyFn.call(AbortSignal, list);
	const controller = new AbortController();
	for (const signal of list) {
		if (signal.aborted) {
			controller.abort(signal.reason);
			break;
		}
		signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
	}
	return controller.signal;
}

/** 仅测试用：清空登记表。 */
export function __resetInflightChatTurnsForTest(): void {
	inflightTurns.clear();
}
