import { createHash } from "node:crypto";
import type { AppContext, WorkerEnv, PrismaClient } from "../../types";
import { AppError } from "../../middleware/error";
import {
	requireSufficientTeamCredits,
	settleTeamCreditsOnSuccess,
	releaseTeamCreditsOnFailure,
} from "../team/team.service";
import { tryReleaseTeamCreditsOnce, findDanglingChatReservations } from "../team/team.repo";
import { getNewApiPricingSnapshot } from "./new-api-pricing";

// new-api 额度锚点：500000 quota = $1（apps/new-api/common/constants.go `QuotaPerUnit`）。
// 可用 env NEW_API_QUOTA_PER_UNIT 覆盖以防上游改动。
const DEFAULT_QUOTA_PER_UNIT = 500_000;

const CHAT_BILLING_TASK_KIND = "agents_chat";

function readEnvString(env: WorkerEnv, key: string): string {
	const processEnv = globalThis.process?.env;
	const v = (env as Record<string, unknown>)?.[key];
	const pv = processEnv?.[key];
	const raw = typeof v === "string" ? v : typeof pv === "string" ? pv : "";
	return raw.trim();
}

function readEnvNumber(env: WorkerEnv, key: string, fallback: number): number {
	const raw = readEnvString(env, key);
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** kill-switch：默认开启；TAP_CHAT_BILLING_ENABLED=false 时关闭(对话不计费，逐字回到旧行为)。 */
export function isChatBillingEnabled(env: WorkerEnv): boolean {
	return readEnvString(env, "TAP_CHAT_BILLING_ENABLED").toLowerCase() !== "false";
}

/** AI 对话的优先冻结额度；余额不足目标值时会原子冻结全部可用余额。 */
export function chatReservationTargetCredits(env: WorkerEnv): number {
	return Math.max(
		1,
		Math.floor(readEnvNumber(env, "TAP_CHAT_RESERVATION_CREDITS", 500)),
	);
}

/** new-api 额度锚点（env NEW_API_QUOTA_PER_UNIT 可覆盖）。导出给 OpenAI facade 算 usage，默认值只留这一处。 */
export function quotaPerUnit(env: WorkerEnv): number {
	return readEnvNumber(env, "NEW_API_QUOTA_PER_UNIT", DEFAULT_QUOTA_PER_UNIT);
}

/**
 * hono 自有、稳定的对话 conversation id：透传给 agents-cli → new-api(x-tapcanvas-conversation-id)，
 * 结算时再用它回查 new-api logs 的真实 quota。基于 (userId, sessionKey) 派生 → 同一会话稳定(利于
 * 上游 prompt 缓存)、不同会话隔离；hono 自己掌控、不依赖复刻 agents-cli 内部哈希(防其改动致漏扣)。
 */
export function deriveChatConversationId(userId: string, sessionKey: string): string {
	const basis = `${String(userId || "").trim()}::${String(sessionKey || "").trim()}`;
	return `tc-${createHash("sha256").update(basis).digest("hex").slice(0, 48)}`;
}

/** Deterministic conversation scope for API turns that do not expose a session key. */
export function deriveChatEffectConversationId(userId: string, effectId: string): string {
	return deriveChatConversationId(userId, `effect:${effectId.trim()}`);
}

/** quota(new-api 内部单位) → TapCanvas 积分，向上取整(不足 1 按 1 收)。 */
export function quotaToCredits(
	quota: number,
	opts: { quotaPerUnit: number; usdExchangeRate: number; creditsPerCny: number },
): number {
	if (!Number.isFinite(quota) || quota <= 0) return 0;
	const perUnit = opts.quotaPerUnit > 0 ? opts.quotaPerUnit : DEFAULT_QUOTA_PER_UNIT;
	const usd = quota / perUnit;
	const cny = usd * (opts.usdExchangeRate > 0 ? opts.usdExchangeRate : 7.3);
	const credits = cny * (opts.creditsPerCny > 0 ? opts.creditsPerCny : 100);
	return Math.max(1, Math.ceil(credits));
}

export type ChatBillingHandle = {
	/** Same logical effect identity used by continuation settlement markers. */
	effectId: string;
	reservationTaskId: string;
	/** 实际冻结的积分额。读不到真实消耗时按此精确结算（绝不用 MAX 之类的哨兵——会溢出 INTEGER 列）。 */
	reservedCredits: number;
	conversationId: string;
	sinceMs: number;
	modelKey: string | null;
};

/**
 * 读这一轮对话在 new-api 的真实消耗 quota（按 conversation_id + turn 起始时间过滤）。
 * 消费日志在响应/流结束后写入，存在短暂竞态 → 重试几次；最终仍为 0 视为本轮无计费消耗(免费模型)。
 * 网络/服务错误向上抛(由 settle 兜底按冻结额结算)。
 */
export async function fetchConversationQuota(
	env: WorkerEnv,
	input: { conversationId: string; sinceMs: number },
): Promise<number> {
	const conversationId = String(input.conversationId || "").trim();
	if (!conversationId) return 0;
	const baseUrl = readEnvString(env, "NEW_API_INTERNAL_BASE_URL").replace(/\/+$/, "");
	const token = readEnvString(env, "NEW_API_INTERNAL_TOKEN");
	if (!baseUrl || !token) {
		throw new AppError("NEW_API_INTERNAL_BASE_URL / NEW_API_INTERNAL_TOKEN 未配置", {
			status: 500,
			code: "new_api_not_configured",
		});
	}
	const url = `${baseUrl}/api/internal/usage?conversation_id=${encodeURIComponent(conversationId)}&since=${Math.max(0, Math.floor(input.sinceMs))}`;
	const attempts = 3;
	for (let i = 0; i < attempts; i++) {
		const res = await fetch(url, {
			method: "GET",
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(8_000),
		});
		if (!res.ok) {
			throw new AppError(`new-api usage lookup failed: ${res.status}`, {
				status: 502,
				code: "new_api_usage_lookup_failed",
			});
		}
		const json = (await res.json().catch(() => null)) as { data?: { quota?: unknown } } | null;
		const quota = Number(json?.data?.quota ?? 0);
		if (Number.isFinite(quota) && quota > 0) return quota;
		// 还没写进 logs（竞态）→ 短等再试；最后一次仍为 0 则当作本轮无计费消耗。
		if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400));
	}
	return 0;
}

export async function beginChatBilling(
	c: AppContext,
	userId: string,
	input: {
		conversationId: string;
		sinceMs: number;
		modelKey: string | null;
		effectId: string;
		/** Only claim-fenced durable recovery may adopt a still-pending freeze. */
		allowExistingReservation?: boolean;
	},
): Promise<ChatBillingHandle | null> {
	if (!isChatBillingEnabled(c.env)) return null;
	const effectId = input.effectId.trim();
	if (!effectId) {
		throw new AppError("对话计费缺少 effectId", {
			status: 500,
			code: "chat_billing_effect_id_required",
		});
	}
	const conversationId = input.conversationId.trim();
	if (!conversationId) {
		throw new AppError("对话计费缺少 conversationId", {
			status: 500,
			code: "chat_billing_conversation_id_required",
		});
	}
	const reservation = await requireSufficientTeamCredits(c, userId, {
		required: chatReservationTargetCredits(c.env),
		minimumRequired: 1,
		reservationTaskId: effectId,
		taskKind: CHAT_BILLING_TASK_KIND,
		vendor: "new_api",
		modelKey: input.modelKey,
		allowExistingReservation: input.allowExistingReservation,
	});
	if (!reservation) return null;
	return {
		effectId,
		reservationTaskId: reservation.reservationTaskId,
		reservedCredits: reservation.amount,
		conversationId,
		sinceMs: Math.max(0, Math.floor(input.sinceMs)),
		modelKey: input.modelKey,
	};
}

/** 对话成功结束：按真实 quota 折算积分结算（封顶在冻结额、释放多冻部分）。读数失败按冻结额结算(不资损)。 */
export async function settleChatBilling(
	c: AppContext,
	userId: string,
	handle: ChatBillingHandle | null,
): Promise<void> {
	if (!handle) return;
	let amount: number;
	try {
		const quota = await fetchConversationQuota(c.env, {
			conversationId: handle.conversationId,
			sinceMs: handle.sinceMs,
		});
		const snap = await getNewApiPricingSnapshot(c.env);
		amount = quotaToCredits(quota, {
			quotaPerUnit: quotaPerUnit(c.env),
			usdExchangeRate: snap.usdExchangeRate,
			creditsPerCny: snap.creditsPerCny,
		});
	} catch (err) {
		// 读不到真实消耗（new-api 内部接口未部署/网络错）→ 按已冻结的精确额结算（宁可多收不少收，不资损）。
		// 关键：用 handle.reservedCredits 而非 MAX_SAFE_INTEGER——后者会溢出 PG INTEGER 列(credits_frozen/amount)
		// 导致 settle 抛错、冻结额永远卡住不释放。
		console.warn("[chat-billing] quota lookup failed; settling reserved estimate", err);
		amount = handle.reservedCredits;
	}
	try {
		await settleTeamCreditsOnSuccess(c, userId, {
			taskId: handle.reservationTaskId,
			taskKind: CHAT_BILLING_TASK_KIND,
			amount,
			vendor: "new_api",
			modelKey: handle.modelKey,
		});
	} catch (err) {
		// 结算本身异常：绝不能把用户积分永久冻死 → 兜底全额解冻（一次对话的损失上限可控，远好于卡死）。
		console.error("[chat-billing] settle failed; releasing freeze to avoid locking credits", err);
		await releaseChatBilling(c, userId, handle);
	}
}

/** 对话失败/中断：全额解冻。 */
export async function releaseChatBilling(
	c: AppContext,
	userId: string,
	handle: ChatBillingHandle | null,
): Promise<void> {
	if (!handle) return;
	try {
		await releaseTeamCreditsOnFailure(c, userId, {
			taskId: handle.reservationTaskId,
			taskKind: CHAT_BILLING_TASK_KIND,
			vendor: "new_api",
			modelKey: handle.modelKey,
		});
	} catch (err) {
		console.error("[chat-billing] release failed", err);
	}
}

/**
 * 清理悬挂冻结：AI 对话计费的 reserve 若因异常未结算也未解冻，会把积分卡在冻结。扫出超过
 * minAgeMs(默认 30min，远超 agents-bridge 10min 回合上限)仍有未结算 allocation 的聊天 reserve，
 * 按剩余 allocation 逐条解冻。幂等(tryReleaseTeamCreditsOnce 按唯一任务键复用并追加)。由 main.ts 每小时调度。
 */
export async function sweepDanglingChatReservations(
	db: PrismaClient,
	opts?: { minAgeMs?: number; limit?: number; nowMs?: number },
): Promise<{ scanned: number; released: number }> {
	const minAgeMs = opts?.minAgeMs ?? 30 * 60_000;
	const limit = opts?.limit ?? 500;
	const nowMs = opts?.nowMs ?? Date.now();
	const olderThanIso = new Date(nowMs - minAgeMs).toISOString();
	const nowIso = new Date(nowMs).toISOString();
	const dangling = await findDanglingChatReservations(db, { olderThanIso, limit });
	let released = 0;
	for (const d of dangling) {
		if (d.amount <= 0 || !d.actorUserId) continue;
		try {
			const res = await tryReleaseTeamCreditsOnce(db, {
				teamId: d.teamId,
				amount: d.amount,
				taskId: d.taskId,
				taskKind: d.taskKind,
				actorUserId: d.actorUserId,
				note: "sweeper:dangling-chat-reserve",
				nowIso,
			});
			if (res.released) released++;
		} catch (err) {
			console.error("[chat-billing] release dangling reservation failed", { taskId: d.taskId }, err);
		}
	}
	return { scanned: dangling.length, released };
}
