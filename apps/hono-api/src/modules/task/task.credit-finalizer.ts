import type { AppContext, WorkerEnv } from "../../types";
import { queryAll } from "../../db/db";
import { tryReleaseTeamCreditsOnce } from "../team/team.repo";
import { getVendorTaskRefByTaskId } from "./vendor-task-refs.repo";
import {
	fetchGrsaiDrawTaskResult,
	fetchApimartTaskResult,
	fetchAsyncDataTaskResult,
	fetchTuziTaskResult,
	fetchMiniMaxTaskResult,
	fetchSora2ApiTaskResult,
	fetchVeoTaskResult,
} from "./task.service";
import { upsertTaskStatus } from "./task-status.repo";

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
};

const FINALIZER_PROVIDER = "credit_finalizer";

function parseEpoch(iso: string): number {
	const t = Date.parse(iso);
	return Number.isFinite(t) ? t : 0;
}

function normalizeDispatchVendor(vendor: string): string {
	const raw = (vendor || "").trim().toLowerCase();
	if (!raw) return "";
	const parts = raw.split(":").map((p) => p.trim()).filter(Boolean);
	const last = parts.length ? parts[parts.length - 1]! : raw;
	if (last === "hailuo") return "minimax";
	if (last === "google") return "gemini";
	return last;
}

function normalizeVendorHint(vendor: string): string | null {
	const raw = (vendor || "").trim().toLowerCase();
	if (!raw) return null;
	const head = raw.split(":")[0]?.trim() || raw;
	if (head === "comfly" || raw.startsWith("comfly-")) return "comfly";
	if (head === "grsai" || raw.startsWith("grsai-")) return "grsai";
	if (head === "apimart" || raw.startsWith("apimart-")) return "apimart";
	if (head === "yunwu" || raw.startsWith("yunwu-")) return "yunwu";
	return null;
}

function shouldUseGrsaiDrawPollingForImageTask(vendor: string): boolean {
	const raw = (vendor || "").trim().toLowerCase();
	if (!raw) return false;
	if (raw === "gemini" || raw === "google") return true;
	if (raw === "grsai" || raw.startsWith("grsai-") || raw.startsWith("grsai:")) return true;
	if (raw === "comfly" || raw.startsWith("comfly-") || raw.startsWith("comfly:")) return true;
	if (raw.startsWith("apimart-") || raw.startsWith("apimart:")) return true;
	return false;
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
	if (k === "text_to_video" || k === "image_to_video") return "video";
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
        r.team_id AS teamId,
        r.task_id AS taskId,
        r.task_kind AS taskKind,
        r.actor_user_id AS userId,
        r.amount AS reserved,
        COALESCE(d.deducted, 0) AS deducted,
        COALESCE(l.released, 0) AS released,
        r.created_at AS createdAt,
        r.note AS note
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
        AND (COALESCE(d.deducted, 0) + COALESCE(l.released, 0)) < r.amount
      ORDER BY r.created_at ASC
      LIMIT ?
    `,
		[Math.max(1, Math.min(100, Math.floor(limit)))],
	);

	return (rows || []).map((r) => ({
		teamId: String(r.teamId),
		taskId: String(r.taskId),
		taskKind: typeof r.taskKind === "string" ? r.taskKind : null,
		userId: typeof r.userId === "string" ? r.userId : null,
		reserved: Number(r.reserved ?? 0) || 0,
		deducted: Number(r.deducted ?? 0) || 0,
		released: Number(r.released ?? 0) || 0,
		createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
		note: typeof r.note === "string" ? r.note : null,
	}));
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
		const isOrphan = !vendorRef;
		if (isOrphan && ageMs >= orphanReleaseMs) {
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
			} catch (err: any) {
				errors += 1;
				await upsertTaskStatus(env.DB, {
					taskId,
					provider: FINALIZER_PROVIDER,
					userId,
					status: "running",
					data: {
						reason: "orphan_release_failed",
						error:
							typeof err?.message === "string" ? err.message : String(err),
						taskKind,
						teamId: row.teamId,
						credits: { reserved: row.reserved, pending: pendingAmount },
					},
					nowIso,
				});
			}
			continue;
		}

		if (!vendorRef) {
			await upsertTaskStatus(env.DB, {
				taskId,
				provider: FINALIZER_PROVIDER,
				userId,
				status: "running",
				data: {
					reason: "vendor_unknown",
					taskKind,
					teamId: row.teamId,
					credits: { reserved: row.reserved, pending: pendingAmount },
				},
				nowIso,
			});
			continue;
		}

		const vendorHead = vendorRef.trim().toLowerCase().split(":")[0]?.trim() || "";
		const dispatch = normalizeDispatchVendor(vendorRef);
		const proxyHint = normalizeVendorHint(vendorRef);
		const useGrsaiDrawImagePolling =
			refKind === "image" && shouldUseGrsaiDrawPollingForImageTask(vendorRef);

		const c = createInternalAppContext(env, {
			apiKeyId: "internal-finalizer",
			routingTaskKind: taskKind || undefined,
			...(vendorHead === "direct" ? { proxyDisabled: true } : {}),
			...(proxyHint ? { proxyVendorHint: proxyHint } : {}),
		});

		try {
			let result: any;
			if (dispatch === "apimart") {
				result = await fetchApimartTaskResult(c, userId, taskId, null, {
					taskKind: (taskKind as any) ?? null,
				});
			} else if (useGrsaiDrawImagePolling) {
				result = await fetchGrsaiDrawTaskResult(c, userId, taskId, {
					taskKind: (taskKind as any) ?? null,
					promptFromClient: null,
				});
			} else if (refKind === "image") {
				await upsertTaskStatus(env.DB, {
					taskId,
					provider: FINALIZER_PROVIDER,
					userId,
					status: "running",
					data: {
						reason: "polling_not_supported",
						vendor: vendorRef,
						dispatch,
						pid,
						taskKind,
						teamId: row.teamId,
						credits: { reserved: row.reserved, pending: pendingAmount },
					},
					nowIso,
				});
				continue;
			} else if (dispatch === "asyncdata") {
				result = await fetchAsyncDataTaskResult(c, userId, taskId, {
					taskKind: (taskKind as any) ?? null,
					promptFromClient: null,
				});
			} else if (dispatch === "tuzi") {
				result = await fetchTuziTaskResult(c, userId, taskId, {
					taskKind: (taskKind as any) ?? null,
					promptFromClient: null,
				});
			} else if (vendorHead === "sora2api") {
				result = await fetchSora2ApiTaskResult(c, userId, taskId, null);
			} else if (dispatch === "veo") {
				result = await fetchVeoTaskResult(c, userId, taskId);
			} else if (dispatch === "minimax") {
				result = await fetchMiniMaxTaskResult(c, userId, taskId);
			} else {
				result = await fetchSora2ApiTaskResult(c, userId, taskId, null);
			}

			polled += 1;

			const raw: any = result?.raw as any;
			const hosting: any = raw?.hosting ?? null;

			await upsertTaskStatus(env.DB, {
				taskId,
				provider: FINALIZER_PROVIDER,
				userId,
				status: typeof result?.status === "string" ? result.status : "running",
				data: {
					vendor: vendorRef,
					dispatch,
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
			await upsertTaskStatus(env.DB, {
				taskId,
				provider: FINALIZER_PROVIDER,
				userId,
				status: "running",
				data: {
					reason: "poll_failed",
					vendor: vendorRef,
					dispatch,
					pid,
					taskKind,
					teamId: row.teamId,
					credits: { reserved: row.reserved, pending: pendingAmount },
					error: typeof err?.message === "string" ? err.message : String(err),
				},
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
