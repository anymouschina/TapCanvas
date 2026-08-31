import type { AppContext, WorkerEnv } from "../../types";
import { queryAll } from "../../db/db";
import { tryReleaseTeamCreditsOnce } from "../team/team.repo";
import { releaseTeamCreditsOnFailure, settleTeamCreditsOnSuccess } from "../team/team.service";
import { resolveTeamCreditsCostForTask } from "../billing/billing.service";
import { getVendorTaskRefByTaskId } from "./vendor-task-refs.repo";
import { TaskResultSchema, type TaskKind } from "./task.schemas";
import { upsertTaskResult } from "./task-result.repo";
import { upsertTaskStatus } from "./task-status.repo";
import { fetchTaskResultForPolling, isPermanentUpstreamTaskError } from "./task.polling";
import {
	extractBillingSpecKeyFromLedgerNote,
	extractBillingSpecKeyFromTaskRaw,
} from "./task.billing";

type PendingReservationRow = {
	teamId: string;
	taskId: string;
	taskKind: string | null;
	userId: string | null;
	reserved: number;
	deducted: number;
	released: number;
	createdAt: string;
	note: string | null;
	apiKeyId: string | null;
};

const FINALIZER_PROVIDER = "credit_finalizer";

function parseEpoch(iso: string): number {
	const t = Date.parse(iso);
	return Number.isFinite(t) ? t : 0;
}

function parseVendorFromNote(note: string | null): string | null {
	const raw = typeof note === "string" ? note : "";
	if (!raw) return null;
	const m = raw.match(/(?:^|\s)vendor:([a-z0-9:_-]+)/i);
	const found = m && m[1] ? m[1].trim() : "";
	return found ? found : null;
}

function mapTaskKindToRefKind(taskKind: string | null): "video" | "image" | null {
	const k = (taskKind || "").trim();
	if (k === "text_to_video" || k === "image_to_video" || k === "video_edit") return "video";
	if (k === "text_to_image" || k === "image_edit") return "image";
	return null;
}

function createInternalAppContext(
	env: WorkerEnv,
	variables: Record<string, unknown>,
): AppContext {
	const store = new Map<string, unknown>(Object.entries(variables));
	const c: any = {
		env,
		req: { url: "https://internal.task-finalizer.local/" },
		get: (key: string) => store.get(key),
		set: (key: string, value: unknown) => store.set(key, value),
	};
	return c as AppContext;
}

async function listPendingReservations(
	env: WorkerEnv,
	limit: number,
): Promise<PendingReservationRow[]> {
	const rows = await queryAll<any>(
		env.DB,
		`
      SELECT
        r.team_id AS "teamId",
        r.task_id AS "taskId",
        r.task_kind AS "taskKind",
        r.actor_user_id AS "userId",
        r.amount AS reserved,
        COALESCE(d.deducted, 0) AS deducted,
        COALESCE(l.released, 0) AS released,
        r.created_at AS "createdAt",
        r.note AS note,
        r.api_key_id AS "apiKeyId"
      FROM team_credit_ledger r
      LEFT JOIN (
        SELECT team_id, task_id, SUM(amount) AS deducted
        FROM team_credit_ledger
        WHERE entry_type = 'deduct'
        GROUP BY team_id, task_id
      ) d
        ON d.team_id = r.team_id AND d.task_id = r.task_id
      LEFT JOIN (
        SELECT team_id, task_id, SUM(amount) AS released
        FROM team_credit_ledger
        WHERE entry_type = 'release'
        GROUP BY team_id, task_id
      ) l
        ON l.team_id = r.team_id AND l.task_id = r.task_id
      WHERE r.entry_type = 'reserve'
        AND r.task_id IS NOT NULL AND r.task_id != ''
        -- Only allocation-backed reservations belong to the current batch
        -- authority.  Pre-cutover ledger rows have no batch allocation and
        -- must not occupy the bounded scan window forever.
        AND EXISTS (
          SELECT 1
          FROM team_credit_allocations reserve_allocation
          WHERE reserve_allocation.ledger_entry_id = r.id
        )
        AND (
          (r.actor_user_id IS NOT NULL AND r.actor_user_id != '')
          OR r.task_kind = 'legacy_frozen_balance'
        )
        AND (COALESCE(d.deducted, 0) + COALESCE(l.released, 0)) < r.amount
      ORDER BY r.created_at ASC
      LIMIT ?
    `,
		[Math.max(1, Math.min(100, Math.floor(limit)))],
	);

	return (rows || []).map((r) => {
		const taskKind = typeof r.taskKind === "string" ? r.taskKind : null;
		const rawTaskId = String(r.taskId ?? "");
		const legacyTeamId = rawTaskId.startsWith("legacy_frozen:personal_")
			? rawTaskId.slice("legacy_frozen:".length)
			: "";
		const legacyOwnerId = legacyTeamId.startsWith("personal_")
			? legacyTeamId.slice("personal_".length)
			: "";
		return {
			teamId: String(r.teamId),
			taskId: rawTaskId,
			taskKind,
			userId:
				typeof r.userId === "string" && r.userId.trim()
					? r.userId
					: taskKind === "legacy_frozen_balance" && legacyOwnerId
						? legacyOwnerId
						: null,
			reserved: Number(r.reserved ?? 0) || 0,
			deducted: Number(r.deducted ?? 0) || 0,
			released: Number(r.released ?? 0) || 0,
			createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
			note: typeof r.note === "string" ? r.note : null,
			apiKeyId: typeof r.apiKeyId === "string" && r.apiKeyId.trim() ? r.apiKeyId : null,
		};
	});
}

export async function runCreditTaskFinalizer(
	env: WorkerEnv,
	options?: {
		limit?: number;
		orphanReleaseMs?: number;
	},
): Promise<{
	scanned: number;
	polled: number;
	orphanReleased: number;
	errors: number;
}> {
	const nowIso = new Date().toISOString();
	const limit =
		typeof options?.limit === "number" && Number.isFinite(options.limit)
			? Math.max(1, Math.min(100, Math.floor(options.limit)))
			: 20;
	const orphanReleaseMs =
		typeof options?.orphanReleaseMs === "number" &&
		Number.isFinite(options.orphanReleaseMs)
			? Math.max(60_000, Math.floor(options.orphanReleaseMs))
			: 10 * 60_000;
	// 【预留硬年龄上限·防冻结泄漏】上游 poll 一直回 running（或上游早已忘掉该任务）的预留
	// 永不释放；而扫描按 created_at ASC LIMIT 20——最旧的一批僵尸行会永久霸占扫描窗口，
	// 后面的预留永远轮不到（实测积压 848 行 / 11.8 万积分冻结）。系统内任何生成任务都活
	// 不过 24h（run 30min 无进展即取消），超龄一律按失败释放。env CREDIT_RESERVATION_MAX_AGE_MS 可调。
	const maxReservationAgeMs = (() => {
		const raw = Number(
			(env as Record<string, unknown>)?.CREDIT_RESERVATION_MAX_AGE_MS ??
				globalThis.process?.env?.CREDIT_RESERVATION_MAX_AGE_MS,
		);
		return Number.isFinite(raw) && raw > 0 ? Math.max(orphanReleaseMs, raw) : 24 * 3_600_000;
	})();

	const pending = await listPendingReservations(env, limit);

	let polled = 0;
	let orphanReleased = 0;
	let errors = 0;

	for (const row of pending) {
		const taskId = (row.taskId || "").trim();
		const userId = (row.userId || "").trim();
		const taskKind = typeof row.taskKind === "string" ? row.taskKind : null;
		if (!taskId || !userId) continue;

		const pendingAmount = Math.max(
			0,
			Math.floor(row.reserved) -
				Math.floor(row.deducted) -
				Math.floor(row.released),
		);
		if (pendingAmount <= 0) continue;

		const refKind = mapTaskKindToRefKind(taskKind);
		let vendorRef: string | null = null;
		let pid: string | null = null;
		if (refKind) {
			try {
				const ref = await getVendorTaskRefByTaskId(
					env.DB,
					userId,
					refKind,
					taskId,
				);
				if (ref?.vendor) {
					vendorRef = ref.vendor;
					pid = typeof ref.pid === "string" ? ref.pid : null;
				}
			} catch {
				// ignore
			}
		}
		if (!vendorRef) {
			vendorRef = parseVendorFromNote(row.note);
		}

		const ageMs = row.createdAt ? Date.now() - parseEpoch(row.createdAt) : 0;
		// 超龄预留：不问上游死活，直接按失败释放（见 maxReservationAgeMs 注释）。
		if (ageMs >= maxReservationAgeMs) {
			try {
				const released = await tryReleaseTeamCreditsOnce(env.DB, {
					teamId: row.teamId,
					amount: pendingAmount,
					taskId,
					taskKind,
					actorUserId: userId,
					note: "finalizer:max_age_release",
					nowIso,
				});
				if (released.released) {
					orphanReleased += 1;
					await upsertTaskStatus(env.DB, {
						taskId,
						provider: FINALIZER_PROVIDER,
						userId,
						status: "failed",
						data: {
							reason: "max_age_release",
							taskKind,
							teamId: row.teamId,
							credits: { reserved: row.reserved, pending: pendingAmount },
							ageMs,
						},
						completedAt: nowIso,
						nowIso,
					});
				}
			} catch {
				errors += 1;
			}
			continue;
		}
		// pid 空 = 上游从未返回有效任务 id（提交即被内容审核拒/从未成功提交），没有可轮询对象——
		// 再 fetchNewApiTaskResult 只会按原 prompt「重新提交」，被 ARK 硬拒(InputTextSensitive 400)的会
		// 永久死循环、抢渠道。老化后视同孤儿释放终态（age guard 防误伤刚提交、pid 未及记录的在飞任务）。
		const hasUpstreamTask = typeof pid === "string" && pid.trim().length > 0;
		const isOrphan = !vendorRef || !hasUpstreamTask;
		if (isOrphan) {
			if (ageMs >= orphanReleaseMs) {
				try {
					const released = await tryReleaseTeamCreditsOnce(env.DB, {
						teamId: row.teamId,
						amount: pendingAmount,
						taskId,
						taskKind,
						actorUserId: userId,
						note: "finalizer:orphan_release",
						nowIso,
					});
					if (released.released) {
						orphanReleased += 1;
						await upsertTaskStatus(env.DB, {
							taskId,
							provider: FINALIZER_PROVIDER,
							userId,
							status: "failed",
							data: {
								reason: "orphan_release",
								taskKind,
								teamId: row.teamId,
								credits: { reserved: row.reserved, pending: pendingAmount },
							},
							completedAt: nowIso,
							nowIso,
						});
					}
				} catch (err: unknown) {
					errors += 1;
					await upsertTaskStatus(env.DB, {
						taskId,
						provider: FINALIZER_PROVIDER,
						userId,
						status: "running",
						data: {
							reason: "orphan_release_failed",
							error: err instanceof Error ? err.message : String(err),
							taskKind,
							teamId: row.teamId,
							credits: { reserved: row.reserved, pending: pendingAmount },
						},
						nowIso,
					});
				}
			} else {
				// A reserve row is created before the vendor task reference is bound.
				// Polling the temporary reservation id during this window returns
				// task_not_exist and can release the wrong identity after the reserve
				// has already been rebound. Wait for the durable provider reference;
				// the orphan age boundary remains the only release authority.
				await upsertTaskStatus(env.DB, {
					taskId,
					provider: FINALIZER_PROVIDER,
					userId,
					status: "running",
					data: {
						reason: "provider_task_binding_pending",
						vendor: vendorRef,
						taskKind,
						teamId: row.teamId,
						credits: { reserved: row.reserved, pending: pendingAmount },
					},
					nowIso,
				});
			}
			continue;
		}

		const c = createInternalAppContext(env, {
			// 用 reserve 行落下的真实 caller key 做归因；无 key（JWT 消耗）回落 sentinel，行为不变。
			apiKeyId: row.apiKeyId ?? "internal-finalizer",
			routingTaskKind: taskKind || undefined,
		});

		try {
			let result: any;
			if (refKind === "image") {
				// Image tasks complete synchronously — no async polling needed.
				// If a reservation is still pending after timeout, the sync settle failed
				// (e.g. duplicate task-id rebind conflict). Release as orphan.
				if (ageMs >= orphanReleaseMs) {
					try {
						const released = await tryReleaseTeamCreditsOnce(env.DB, {
							teamId: row.teamId,
							amount: pendingAmount,
							taskId,
							taskKind,
							actorUserId: userId,
							note: "finalizer:image_orphan_release",
							nowIso,
						});
						if (released.released) {
							orphanReleased += 1;
							await upsertTaskStatus(env.DB, {
								taskId,
								provider: FINALIZER_PROVIDER,
								userId,
								status: "failed",
								data: {
									reason: "image_orphan_release",
									vendor: vendorRef,
									taskKind,
									teamId: row.teamId,
									credits: { reserved: row.reserved, pending: pendingAmount },
								},
								completedAt: nowIso,
								nowIso,
							});
						}
					} catch (err: any) {
						errors += 1;
					}
				} else {
					await upsertTaskStatus(env.DB, {
						taskId,
						provider: FINALIZER_PROVIDER,
						userId,
						status: "running",
						data: {
							reason: "image_pending_sync_settle",
							vendor: vendorRef,
							pid,
							taskKind,
							teamId: row.teamId,
							credits: { reserved: row.reserved, pending: pendingAmount },
						},
						nowIso,
					});
				}
				continue;
			}
			// 单次 poll 最多 25s：new-api 慢响应不得把整个 finalizer tick 挂死。
			const polling = await fetchTaskResultForPolling(c, userId, {
				taskId,
				taskKind: (taskKind as TaskKind | null) ?? null,
				vendor: "newapi",
				prompt: null,
				mode: "internal",
				timeoutMs: 25_000,
			});
			if (!polling.ok) {
				if (polling.status === 409) continue;
				const pollingError = new Error(`task polling returned HTTP ${polling.status}`) as Error & {
					status: number;
				};
				pollingError.status = polling.status;
				throw pollingError;
			}
			result = polling.result;

			polled += 1;

			// Persist final task result so callers can fetch without re-polling upstream.
			try {
				const parsed = TaskResultSchema.safeParse(result);
				if (parsed.success) {
					const finalStatus = parsed.data.status;
					if (finalStatus === "succeeded" || finalStatus === "failed") {
						const kind =
							typeof taskKind === "string" && taskKind.trim()
								? taskKind.trim()
								: typeof parsed.data.kind === "string"
									? parsed.data.kind.trim()
									: "";
						const vendorForStore =
							typeof vendorRef === "string" && vendorRef.trim()
								? vendorRef.trim()
								: "";
						if (kind && vendorForStore) {
							await upsertTaskResult(env.DB, {
								userId,
								taskId,
								vendor: vendorForStore,
								kind,
								status: finalStatus,
								result: parsed.data,
								completedAt: nowIso,
								nowIso,
							});
						}
					}
				}
			} catch {
				// ignore
			}

			const finalStatus = typeof result?.status === "string" ? result.status : "running";
			if (finalStatus === "succeeded" || finalStatus === "failed") {
				const normalizedTaskKind = (taskKind || "").trim();
				if (normalizedTaskKind) {
					const rawResult: any = result?.raw as any;
					const resolvedModelKey = (() => {
						const candidates = [
							rawResult?.model,
							rawResult?.modelKey,
							rawResult?.model_key,
							rawResult?.response?.model,
							rawResult?.response?.modelKey,
							rawResult?.response?.model_key,
						];
						for (const v of candidates) {
							if (typeof v === "string" && v.trim()) return v.trim();
						}
						return null;
					})();
					const resolvedSpecKey =
						extractBillingSpecKeyFromTaskRaw(rawResult) ||
						extractBillingSpecKeyFromLedgerNote(row.note);
					if (finalStatus === "succeeded") {
						const amount = await resolveTeamCreditsCostForTask(c, {
							taskKind: normalizedTaskKind,
							modelKey: resolvedModelKey || undefined,
							specKey: resolvedSpecKey,
						});
						await settleTeamCreditsOnSuccess(c, userId, {
							taskId,
							taskKind: normalizedTaskKind,
							amount,
							vendor: vendorRef || undefined,
							modelKey: resolvedModelKey,
							specKey: resolvedSpecKey,
						});
					} else {
						await releaseTeamCreditsOnFailure(c, userId, {
							taskId,
							taskKind: normalizedTaskKind,
							vendor: vendorRef || undefined,
							modelKey: resolvedModelKey,
							specKey: resolvedSpecKey,
						});
					}
				}
			}

			const raw: any = result?.raw as any;
			const hosting: any = raw?.hosting ?? null;

			await upsertTaskStatus(env.DB, {
				taskId,
				provider: FINALIZER_PROVIDER,
				userId,
				status: typeof result?.status === "string" ? result.status : "running",
				data: {
					vendor: vendorRef,
					pid,
					taskKind,
					teamId: row.teamId,
					credits: { reserved: row.reserved, pending: pendingAmount },
					hosting:
						hosting && typeof hosting === "object"
							? {
									status:
										typeof hosting.status === "string"
											? hosting.status
											: null,
									message:
										typeof hosting.message === "string"
											? hosting.message
											: null,
								}
							: null,
				},
				completedAt:
					result?.status === "succeeded" || result?.status === "failed"
						? nowIso
						: null,
				nowIso,
			});
		} catch (err: any) {
			errors += 1;
			// 终态失败判定：上游 4xx 客户端错误（内容审核硬拒/参数错/权限）重试也不会变好——
			// 标 failed 让本次对账结算并停止重试；429 限流与 5xx 暂时性错误仍按 running 下次重试。
			// 根治死循环：ARK InputTextSensitiveContentDetected(400) 此前被一律标 running → 永久重试抢渠道。
			const errStatus =
				typeof err?.status === "number" ? err.status : 0;
			// 单一真相源：永久错判据与画布 orphan-reconcile 共用 isPermanentUpstreamTaskError，禁各自内联。
			const isTerminal = isPermanentUpstreamTaskError(
				errStatus,
				typeof err?.message === "string" ? err.message : String(err),
			);
			// 终态失败必须释放预留额度，否则 ledger 仍有未结算预留 → 下个 tick 仍被扫出 →
			// 仍重试（死循环不止）。释放后 (deducted+released)>=reserved，彻底退出扫描。
			if (isTerminal) {
				const normalizedTaskKind = (taskKind || "").trim();
				if (normalizedTaskKind) {
					try {
						await releaseTeamCreditsOnFailure(c, userId, {
							taskId,
							taskKind: normalizedTaskKind,
							vendor: vendorRef || undefined,
							modelKey: null,
							specKey: extractBillingSpecKeyFromLedgerNote(row.note),
						});
					} catch {
						// 释放失败不阻塞标记终态；下个 tick 仍会重试释放
					}
				}
			}
			await upsertTaskStatus(env.DB, {
				taskId,
				provider: FINALIZER_PROVIDER,
				userId,
				status: isTerminal ? "failed" : "running",
				data: {
					reason: isTerminal ? "poll_failed_terminal" : "poll_failed",
					terminalStatus: isTerminal ? errStatus || "moderation" : undefined,
					vendor: vendorRef,
					pid,
					taskKind,
					teamId: row.teamId,
					credits: { reserved: row.reserved, pending: pendingAmount },
					error: typeof err?.message === "string" ? err.message : String(err),
				},
				completedAt: isTerminal ? nowIso : null,
				nowIso,
			});
		}
	}

	return {
		scanned: pending.length,
		polled,
		orphanReleased,
		errors,
	};
}
