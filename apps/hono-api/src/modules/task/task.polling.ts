import type { AppContext } from "../../types";
import { TaskResultSchema, type TaskKind, type TaskResultDto } from "./task.schemas";
import { getTaskResultByTaskId, upsertTaskResult } from "./task-result.repo";
import { getVendorTaskRefByTaskId } from "./vendor-task-refs.repo";
import {
	fetchNewApiTaskResult,
	hostTaskAssetsSynchronously,
} from "./task.service";
import {
	acquireTaskAssetHostingLease,
	acquireTaskPollLease,
	releaseTaskAssetHostingLease,
	releaseTaskPollLease,
} from "./task-poll-lease";
import { recordVendorCallLogFromTaskResult } from "./task.vendor-call-utils";
import { readGenerationAssetContextFromRaw } from "./generation-asset-context";

export type TaskPollingMode = "public" | "internal";

export type TaskPollingOutcome =
	| { ok: true; vendor: string; result: TaskResultDto; storedStale?: true }
	| { ok: false; status: number; body: unknown };

/**
 * 存储行 succeeded+assets空 的「托管吞资产」自愈绕过只在此恢复窗口内有效。
 * 超窗后上游任务必已过期（seedance 侧保留期短），再打上游只会恒 400——
 * 2026-07-17 复盘实证：07-08 的两个此类任务被 orphan-recovery 每分钟轮询了 9 天。
 */
export const STORED_TERMINAL_ASSET_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * 上游任务查询错误是否为永久性（重试不会变好）。
 * 单一真相源：credit-finalizer 与画布 orphan-reconcile 必须用同一判据（禁各自内联一套）。
 * 4xx 客户端错（参数错/权限/任务不存在或过期）与内容审核硬拒=永久；429/5xx/网络错=暂时。
 */
export function isPermanentUpstreamTaskError(errStatus: number, errMessage: string): boolean {
	const text = (errMessage || "").toLowerCase();
	const isContentModeration =
		text.includes("inputtextsensitive") ||
		text.includes("sensitive") ||
		text.includes("content moderation") ||
		text.includes("审核");
	return (
		errStatus === 400 ||
		errStatus === 403 ||
		errStatus === 404 ||
		errStatus === 422 ||
		isContentModeration
	);
}

export type StoredTerminalAction =
	| "return_stored"
	| "bypass_poll_upstream"
	| "return_stored_stale";

/**
 * 决定存储终态行的处置：正常返回 / 窗口内绕过重查上游（吞资产自愈）/ 超窗按 stale 返回。
 * completedAt 缺失时年龄未知，保持绕过（由 reconcile 的永久错终态兜底刹车）。
 */
export function resolveStoredTerminalAction(input: {
	status: TaskResultDto["status"];
	kind: TaskKind;
	assetsCount: number;
	storedVendor: string;
	storedCompletedAt: string | null;
	nowMs: number;
}): StoredTerminalAction {
	const isVideoTask = input.kind === "text_to_video" || input.kind === "image_to_video" || input.kind === "video_edit";
	const vendor = input.storedVendor.trim().toLowerCase();
	const isNewApi = vendor === "newapi" || vendor.startsWith("newapi:");
	const isAssetlessSuccess =
		isVideoTask && isNewApi && input.status === "succeeded" && input.assetsCount === 0;
	if (!isAssetlessSuccess) return "return_stored";
	const completedMs = input.storedCompletedAt ? Date.parse(input.storedCompletedAt) : NaN;
	if (Number.isNaN(completedMs)) return "bypass_poll_upstream";
	return input.nowMs - completedMs >= STORED_TERMINAL_ASSET_RECOVERY_WINDOW_MS
		? "return_stored_stale"
		: "bypass_poll_upstream";
}

function resolveRefKind(taskKind: TaskKind | null): "video" | "image" | null {
	if (taskKind === "text_to_video" || taskKind === "image_to_video" || taskKind === "video_edit") return "video";
	if (taskKind === "text_to_image" || taskKind === "image_edit") return "image";
	return null;
}

export async function fetchTaskResultForPolling(
	c: AppContext,
	userId: string,
	input: {
		taskId: string;
		vendor?: string | null;
		taskKind?: TaskKind | null;
		prompt?: string | null;
		mode: TaskPollingMode;
		/** 单次上游 fetch 超时 ms（不传=无限等待，慎用于后台 tick）。 */
		timeoutMs?: number;
	},
): Promise<TaskPollingOutcome> {
	const taskId = (input.taskId || "").trim();
	const taskKind = input.taskKind ?? null;
	const prompt = typeof input.prompt === "string" ? input.prompt : null;

	// 1) Stored result fast-path: only terminal results should short-circuit polling.
	let storedRow: any | null = null;
	let storedVendor = "";
	try {
		storedRow = await getTaskResultByTaskId(c.env.DB, userId, taskId);
		storedVendor =
			typeof storedRow?.vendor === "string" && storedRow.vendor.trim()
				? String(storedRow.vendor).trim()
				: "";
		if (storedRow?.result) {
			const payload = JSON.parse(storedRow.result);
			const parsed = TaskResultSchema.safeParse(payload);
			if (parsed.success) {
				const storedCompletedAt =
					typeof storedRow?.completed_at === "string" && storedRow.completed_at.trim()
						? String(storedRow.completed_at).trim()
						: null;
				const terminalAction =
					parsed.data.status === "succeeded" || parsed.data.status === "failed"
						? resolveStoredTerminalAction({
								status: parsed.data.status,
								kind: (taskKind ?? parsed.data.kind) as TaskKind,
								assetsCount: Array.isArray(parsed.data.assets)
									? parsed.data.assets.length
									: 0,
								storedVendor,
								storedCompletedAt,
								nowMs: Date.now(),
							})
						: null;
				if (terminalAction === "bypass_poll_upstream") {
					storedRow = null;
				} else
				if (terminalAction === "return_stored" || terminalAction === "return_stored_stale") {
					return {
						ok: true,
						vendor:
							typeof storedRow.vendor === "string" && storedRow.vendor.trim()
								? String(storedRow.vendor).trim()
								: "",
						result: parsed.data,
						...(terminalAction === "return_stored_stale" ? { storedStale: true as const } : {}),
					};
				} else if (
					// task_store 管理的任务（后台异步生成）：running 状态直接返回，无需再走 vendor 轮询
					(parsed.data.status === "running" || parsed.data.status === "queued") &&
					typeof (parsed.data as any)?.raw === "object" &&
					(parsed.data as any).raw !== null &&
					(parsed.data as any).raw.provider === "task_store"
				) {
					return {
						ok: true,
						vendor:
							typeof storedRow.vendor === "string" && storedRow.vendor.trim()
								? String(storedRow.vendor).trim()
								: "",
						result: parsed.data,
					};
				}
			}
		}
	} catch {
		// ignore and fall back to vendor polling
	}

	const resolved: { vendor: string; kind: "video" | "image" | null } = {
		vendor: "newapi",
		kind: resolveRefKind(taskKind),
	};

	let inferredFromVendorRef = false;
	if (!resolved.kind) {
		for (const k of ["video", "image"] as const) {
			const ref = await getVendorTaskRefByTaskId(c.env.DB, userId, k, taskId);
			if (ref?.vendor) {
				resolved.kind = k;
				inferredFromVendorRef = true;
				break;
			}
		}
	}

	// Hint proxy selector: prefer higher-success channels for this task kind.
	if (taskKind) c.set("routingTaskKind", taskKind);

	let result: any;

	if (resolved.kind === "image") {
		return {
			ok: false,
			status: 400,
			body: {
				error: "new-api 图像任务通常为同步返回；请直接使用创建接口返回结果",
				code: "invalid_task_kind",
			},
		};
	}
	const pollLeaseToken = await acquireTaskPollLease({ userId, taskId });
	if (!pollLeaseToken) {
		console.log("[task-poll-lease] contention", JSON.stringify({ taskId }));
		return {
			ok: false,
			status: 409,
			body: {
				error: "task polling is already in progress",
				code: "task_poll_in_progress",
			},
		};
	}
	let pollLeaseReleased = false;
	try {
		result = await fetchNewApiTaskResult(c, userId, taskId, {
			taskKind: taskKind ?? null,
			vendor: "newapi",
			promptFromClient: prompt,
			skipAssetHosting: true,
			// Every polling path has a finite upstream bound; slow provider/network work
			// must be retried by the next tick rather than holding a request indefinitely.
			timeoutMs: input.timeoutMs ?? 20_000,
		});

		let parsedResult = TaskResultSchema.parse(result);
		let persistResult = true;
		if (parsedResult.status === "succeeded" && parsedResult.assets.length > 0) {
			// 查询供应商状态已经完成；先释放状态租约，再进入可能耗时数分钟的下载/OSS 托管。
			await releaseTaskPollLease({ userId, taskId, token: pollLeaseToken });
			pollLeaseReleased = true;

			const hostingLeaseToken = await acquireTaskAssetHostingLease({ userId, taskId });
			if (!hostingLeaseToken) {
				const rawRecord =
					typeof parsedResult.raw === "object" &&
					parsedResult.raw !== null &&
					!Array.isArray(parsedResult.raw)
						? (parsedResult.raw as Record<string, unknown>)
						: {};
				parsedResult = TaskResultSchema.parse({
					...parsedResult,
					status: "running",
					assets: [],
					raw: {
						...rawRecord,
						hosting: {
							status: "pending",
							mode: "async",
							assetCount: result.assets.length,
						},
					},
				});
				persistResult = false;
			} else {
				try {
					parsedResult = await hostTaskAssetsSynchronously({
						c,
						userId,
						result: parsedResult,
						meta: {
							taskKind: parsedResult.kind,
							prompt,
							vendor: resolved.vendor,
							taskId,
							generationContext: readGenerationAssetContextFromRaw(
								parsedResult.raw,
							),
						},
						traceTaskKind: parsedResult.kind,
						traceVendor: resolved.vendor,
					});
				} catch (error: unknown) {
					const message = error instanceof Error ? error.message : String(error);
					console.warn(
						"[task-poll] asset hosting failed after provider success; keeping task recoverable",
						JSON.stringify({ taskId, message }),
					);
					return {
						ok: false,
						status: 502,
						body: {
							error: "video asset hosting failed; task remains recoverable",
							code: "asset_hosting_pending",
							taskId,
							message,
						},
					};
				} finally {
					await releaseTaskAssetHostingLease({
						userId,
						taskId,
						token: hostingLeaseToken,
					});
				}
			}
		}
		if (persistResult && (storedRow || inferredFromVendorRef)) {
			const nowIso = new Date().toISOString();
			const completedAt =
				parsedResult.status === "succeeded" || parsedResult.status === "failed"
					? nowIso
					: null;
			try {
				await upsertTaskResult(c.env.DB, {
					userId,
					taskId,
					vendor: resolved.vendor,
					kind: String(parsedResult.kind),
					status: parsedResult.status,
					result: parsedResult,
					completedAt,
					nowIso,
				});
			} catch {
				// 轮询结果仍返回给当前调用方；credit finalizer 会用同一结果再做权威终态持久化。
			}
		}
		if (parsedResult.status === "succeeded" || parsedResult.status === "failed") {
			await recordVendorCallLogFromTaskResult(c, {
				userId,
				vendor: resolved.vendor,
				taskKind: parsedResult.kind,
				result: parsedResult,
			});
		}

		return { ok: true, vendor: resolved.vendor, result: parsedResult };
	} finally {
		if (!pollLeaseReleased) {
			await releaseTaskPollLease({ userId, taskId, token: pollLeaseToken });
		}
	}
}
