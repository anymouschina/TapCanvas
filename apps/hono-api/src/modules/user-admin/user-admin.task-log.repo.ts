import { getPrismaClient } from "../../platform/node/prisma";
import { listVendorCallLogs } from "../task/vendor-call-logs.repo";
import type { TaskLogBundleDto } from "./user-admin.schemas";

const VENDOR_CALL_FETCH_LIMIT = 11;

function safeParseJson(value: string | null | undefined): unknown {
	if (typeof value !== "string" || !value.trim()) return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

export async function fetchTaskLogBundle(
	userId: string,
	taskId: string,
): Promise<TaskLogBundleDto> {
	const uid = (userId || "").trim();
	const tid = (taskId || "").trim();

	if (!uid || !tid) {
		return {
			taskId: tid,
			userId: uid,
			result: null,
			credits: { reserved: 0, deducted: 0, released: 0, pending: 0 },
			statuses: [],
			vendorCalls: [],
		};
	}

	const prisma = getPrismaClient();

	const [resultRow, ledgerRows, statusRows, vendorCallRows] = await Promise.all([
		prisma.task_results.findUnique({
			where: { user_id_task_id: { user_id: uid, task_id: tid } },
		}),
		prisma.team_credit_ledger.findMany({
			where: { actor_user_id: uid, task_id: tid },
		}),
		prisma.task_statuses.findMany({
			where: { task_id: tid, user_id: uid },
			orderBy: { created_at: "asc" },
		}),
		listVendorCallLogs(prisma as any, {
			userId: uid,
			taskId: tid,
			limit: VENDOR_CALL_FETCH_LIMIT,
		}),
	]);

	let reserved = 0;
	let deducted = 0;
	let released = 0;
	for (const r of ledgerRows as Array<{ entry_type: string; amount: number | null }>) {
		const amt = Number(r.amount ?? 0) || 0;
		if (r.entry_type === "reserve") reserved += amt;
		else if (r.entry_type === "deduct") deducted += amt;
		else if (r.entry_type === "release") released += amt;
	}
	const pending = Math.max(0, reserved - deducted - released);

	return {
		taskId: tid,
		userId: uid,
		result: resultRow
			? {
					vendor: resultRow.vendor ?? null,
					kind: resultRow.kind ?? null,
					status: resultRow.status ?? null,
					completedAt: resultRow.completed_at ?? null,
					updatedAt: resultRow.updated_at ?? null,
					raw: safeParseJson(resultRow.result),
				}
			: null,
		credits: { reserved, deducted, released, pending },
		statuses: (
			statusRows as Array<{
				id: string;
				provider: string;
				status: string;
				data: string | null;
				created_at: string;
				completed_at: string | null;
			}>
		).map((s) => ({
			id: String(s.id),
			provider: String(s.provider),
			status: String(s.status),
			data: safeParseJson(s.data),
			createdAt: String(s.created_at),
			completedAt: s.completed_at ?? null,
		})),
		vendorCalls: vendorCallRows.map((v) => ({
			rowId: typeof v.row_id === "number" ? v.row_id : null,
			vendor: String(v.vendor),
			status: String(v.status),
			startedAt: v.started_at ?? null,
			finishedAt: v.finished_at ?? null,
			durationMs: typeof v.duration_ms === "number" ? v.duration_ms : null,
			errorMessage: v.error_message ?? null,
			requestJson: safeParseJson(v.request_json),
			responseJson: safeParseJson(v.response_json),
		})),
	};
}
