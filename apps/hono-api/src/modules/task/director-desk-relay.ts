import type { PrismaClient } from "../../types";
import { getTaskResultByTaskId, tryClaimTaskResult, upsertTaskResult, type TaskResultRow } from "./task-result.repo";
import toolCatalog from "./director-desk-tool-catalog.generated.json";

/**
 * 浏览器执行型工具的通用中继。
 *
 * 导演台是独立应用，它的场景与工程数据只在用户浏览器里（iframe 内的 IndexedDB），
 * 服务端无法直接执行它的 director_* 工具。本模块把「模型要调用的工具」排队，
 * 由打开着导演台的浏览器认领、在导演台自己的 toolService 里执行，再把结果回报，
 * 服务端的工具调用在等待窗口内同步拿到真实结果。
 *
 * 队列复用 task_results（vendor 固定），无需新增表；认领用 queued→claimed 的原子更新，
 * 多标签页同时打开时只有一个能拿到同一次调用。
 */

export const DIRECTOR_DESK_RELAY_VENDOR = "browser-director-desk";
export const DIRECTOR_DESK_RELAY_KIND = "tool_call";
export const DIRECTOR_DESK_RELAY_TOOL_NAME = "tapcanvas_director_desk";

/** 工具调用等待浏览器回报的上限。超时即如实失败，不返回空结果。 */
const RELAY_WAIT_TIMEOUT_MS = 120_000;
const RELAY_POLL_INTERVAL_MS = 500;

type RelayResultPayload = {
	phase: "queued" | "claimed" | "succeeded" | "failed";
	tool: string;
	nodeId: string | null;
	leaseToken: string | null;
	arguments?: unknown;
	ok?: boolean;
	data?: unknown;
	error?: string;
};

function readPayload(row: TaskResultRow | null): RelayResultPayload | null {
	if (!row?.result) return null;
	try {
		const parsed = JSON.parse(row.result) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		const payload = parsed as RelayResultPayload;
		return typeof payload.tool === "string" ? payload : null;
	} catch {
		return null;
	}
}

const TOOL_NAMES = toolCatalog.tools.map((tool) => tool.name);

/**
 * 面向模型的导演台工具。
 *
 * 参数契约（每个子工具的字段）由导演台自己在执行时校验并返回结构化错误，
 * 这里只声明可调用的工具名与各自用途，避免在两端各维护一份会漂移的 schema。
 */
export function buildDirectorDeskRelayTool(): {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
} {
	const catalog = toolCatalog.tools.map((tool) => `- ${tool.name}：${tool.summary}`).join("\n");
	return {
		name: DIRECTOR_DESK_RELAY_TOOL_NAME,
		description:
			"操作用户当前打开的导演台（三维预演工作台）。它在用户浏览器里运行，本工具把调用中继给它执行并同步返回真实结果。\n" +
			"重要：导演台内置技能与文档里出现的 director_* 工具名（director_read、director_apply、director_scene…）不是可直接调用的工具，" +
			"一律通过本工具的 tool 参数传入；直接调用 director_* 会被判为工具不在能力面而失败。\n" +
			`tool 取下列之一，arguments 是该工具自己的参数对象（字段契约由导演台校验，错误会原样返回）。可用工具：\n${catalog}\n` +
			"首次操作某个领域前，可用 tool:\"director_skill\"（或 tool:\"director_help\" 指定 names）读取导演台的精确契约。写操作需要当前 revision 与唯一 requestId。用户没有打开导演台时调用会显式失败，不要凭想象改写场景。",
		parameters: {
			type: "object",
			additionalProperties: false,
			required: ["tool"],
			properties: {
				tool: { type: "string", enum: TOOL_NAMES, description: "要执行的导演台工具名。" },
				arguments: {
					type: "object",
					description: "该导演台工具的参数对象；缺省视为空参数。",
				},
			},
		},
	};
}

/** 该用户是否有导演台正在等待执行的调用（浏览器轮询入口）。 */
export async function listPendingDirectorDeskCalls(
	db: PrismaClient,
	userId: string,
): Promise<Array<{ callId: string; tool: string; nodeId: string | null; arguments: unknown }>> {
	const rows = await db.task_results.findMany({
		where: { user_id: userId, vendor: DIRECTOR_DESK_RELAY_VENDOR, kind: DIRECTOR_DESK_RELAY_KIND, status: "queued" },
		orderBy: { created_at: "asc" },
		take: 8,
	});
	return rows.flatMap((row) => {
		const payload = readPayload(row);
		return payload ? [{ callId: row.task_id, tool: payload.tool, nodeId: payload.nodeId, arguments: payload.arguments ?? {} }] : [];
	});
}

/** 认领一次调用；并发标签页只有一个能拿到。 */
export async function claimDirectorDeskCall(
	db: PrismaClient,
	input: { userId: string; callId: string; nowIso: string },
): Promise<{ ok: boolean; leaseToken?: string; tool?: string; arguments?: unknown }> {
	const row = await getTaskResultByTaskId(db, input.userId, input.callId);
	if (!row || row.vendor !== DIRECTOR_DESK_RELAY_VENDOR) return { ok: false };
	const payload = readPayload(row);
	if (!payload) return { ok: false };
	const leaseToken = crypto.randomUUID();
	const won = await tryClaimTaskResult(db, {
		userId: input.userId,
		taskId: input.callId,
		nowIso: input.nowIso,
		result: { ...payload, phase: "claimed", leaseToken },
	});
	if (!won) return { ok: false };
	return { ok: true, leaseToken, tool: payload.tool, arguments: payload.arguments ?? {} };
}

/** 回报执行结果；租约不符时拒绝，避免过期标签页覆盖真实结果。 */
export async function reportDirectorDeskCall(
	db: PrismaClient,
	input: { userId: string; callId: string; leaseToken: string; ok: boolean; data?: unknown; error?: string; nowIso: string },
): Promise<{ ok: boolean; code?: string }> {
	const row = await getTaskResultByTaskId(db, input.userId, input.callId);
	if (!row || row.vendor !== DIRECTOR_DESK_RELAY_VENDOR) return { ok: false, code: "not_found" };
	const payload = readPayload(row);
	if (!payload || row.status !== "claimed" || payload.leaseToken !== input.leaseToken) {
		return { ok: false, code: "lease_invalid" };
	}
	await upsertTaskResult(db, {
		userId: input.userId,
		taskId: input.callId,
		vendor: DIRECTOR_DESK_RELAY_VENDOR,
		kind: DIRECTOR_DESK_RELAY_KIND,
		status: input.ok ? "succeeded" : "failed",
		nowIso: input.nowIso,
		// 终态必须带 completedAt：task_results 的终态合同要求它，缺了会被拒绝。
		completedAt: input.nowIso,
		nodeId: payload.nodeId,
		result: {
			...payload,
			phase: input.ok ? "succeeded" : "failed",
			ok: input.ok,
			...(input.ok ? { data: input.data } : { error: input.error || "导演台执行失败" }),
		},
	});
	return { ok: true };
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 执行一次导演台工具调用：入队 → 等待浏览器认领并回报 → 返回真实结果。
 *
 * 浏览器没有打开导演台、或回报失败时显式返回失败原因，不返回空数据冒充成功。
 */
export async function relayDirectorDeskTool(input: {
	db: PrismaClient;
	userId: string;
	args: unknown;
	nodeId: string | null;
	nowIso: string;
}): Promise<{ ok: boolean; data?: unknown; error?: string }> {
	const args = (input.args ?? {}) as { tool?: unknown; arguments?: unknown };
	const tool = typeof args.tool === "string" ? args.tool.trim() : "";
	if (!tool) return { ok: false, error: "缺少 tool：请指定要执行的导演台工具名" };
	if (!TOOL_NAMES.includes(tool)) return { ok: false, error: `未知的导演台工具：${tool}` };

	const callId = `dd-${crypto.randomUUID()}`;
	await upsertTaskResult(input.db, {
		userId: input.userId,
		taskId: callId,
		vendor: DIRECTOR_DESK_RELAY_VENDOR,
		kind: DIRECTOR_DESK_RELAY_KIND,
		status: "queued",
		nowIso: input.nowIso,
		nodeId: input.nodeId,
		result: { phase: "queued", tool, nodeId: input.nodeId, leaseToken: null, arguments: args.arguments ?? {} },
	});

	const deadline = Date.now() + RELAY_WAIT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		await delay(RELAY_POLL_INTERVAL_MS);
		const row = await getTaskResultByTaskId(input.db, input.userId, callId);
		if (!row) continue;
		if (row.status !== "succeeded" && row.status !== "failed") continue;
		const payload = readPayload(row);
		if (!payload) return { ok: false, error: "导演台回报内容不可解析" };
		if (row.status === "succeeded") return { ok: true, data: payload.data ?? null };
		return { ok: false, error: payload.error || "导演台执行失败" };
	}

	const timeoutIso = new Date().toISOString();
	await upsertTaskResult(input.db, {
		userId: input.userId,
		taskId: callId,
		vendor: DIRECTOR_DESK_RELAY_VENDOR,
		kind: DIRECTOR_DESK_RELAY_KIND,
		status: "failed",
		nowIso: timeoutIso,
		completedAt: timeoutIso,
		nodeId: input.nodeId,
		result: { phase: "failed", tool, nodeId: input.nodeId, leaseToken: null, ok: false, error: "等待导演台执行超时" },
	});
	return { ok: false, error: "等待导演台执行超时：请确认导演台已在画布中打开" };
}
