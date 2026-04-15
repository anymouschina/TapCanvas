import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";

export type VendorCallLogStatus = "running" | "succeeded" | "failed";

const SENSITIVE_JSON_KEYS = new Set([
	"apikey",
	"api_key",
	"key",
	"token",
	"access_token",
	"refresh_token",
	"secret",
	"password",
	"client_secret",
	"authorization",
	"cookie",
	"set-cookie",
	"x-api-key",
	"secretToken",
]);

const LOG_MAX_DEPTH = 7;
const LOG_MAX_KEYS = 60;
const LOG_MAX_ARRAY = 40;
const LOG_MAX_STRING = 1800;
const LOG_MAX_JSON_CHARS = 1_000_000;

export type VendorCallLogUpsertInput = {
	userId: string;
	vendor: string;
	taskId: string;
	taskKind?: string | null;
	status: VendorCallLogStatus;
	errorMessage?: string | null;
	durationMs?: number | null;
	nowIso: string;
};

export type VendorCallLogRow = {
	row_id: number | null;
	user_id: string;
	user_login: string | null;
	user_name: string | null;
	vendor: string;
	task_id: string;
	task_kind: string | null;
	status: string;
	started_at: string | null;
	finished_at: string | null;
	duration_ms: number | null;
	error_message: string | null;
	request_json: string | null;
	response_json: string | null;
	created_at: string;
	updated_at: string;
};

let schemaEnsured = false;

function normalizeVendorKey(vendor: string): string {
	return (vendor || "").trim().toLowerCase();
}

function normalizeTaskKind(kind?: string | null): string | null {
	if (typeof kind !== "string") return null;
	const trimmed = kind.trim();
	return trimmed ? trimmed : null;
}

function normalizeTaskId(taskId: string): string {
	return (taskId || "").trim();
}

function normalizeErrorMessage(message?: string | null): string | null {
	if (typeof message !== "string") return null;
	const trimmed = message.trim();
	return trimmed ? trimmed : null;
}

function looksLikeImageDataUrl(value: string): boolean {
	return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value.trim());
}

function looksLikeBinaryDataUrl(value: string): boolean {
	return /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,/i.test(value.trim());
}

function looksLikeBareBase64(value: string): boolean {
	const compact = value.replace(/\s+/g, "");
	if (!compact || compact.length < 256) return false;
	if (compact.length % 4 !== 0) return false;
	return /^[a-z0-9+/=]+$/i.test(compact);
}

function sanitizeValueForLog(value: unknown): unknown {
	const seen = new WeakSet<object>();

	const sanitizeString = (str: string): string => {
		const raw = str || "";
		const trimmed = raw.trim();
		if (looksLikeBinaryDataUrl(trimmed)) {
			const mimeTypeMatch = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,/i.exec(trimmed);
			const mimeType = mimeTypeMatch?.[1]?.trim() || "application/octet-stream";
			return `[inline-binary-data-url mime=${mimeType} len=${trimmed.length}]`;
		}
		if (looksLikeBareBase64(trimmed)) {
			return `[inline-base64 len=${trimmed.replace(/\s+/g, "").length}]`;
		}
		if (trimmed.length > LOG_MAX_STRING) {
			return `${trimmed.slice(0, LOG_MAX_STRING)}…(truncated, len=${trimmed.length})`;
		}
		return trimmed;
	};

	const walk = (v: unknown, depth: number): unknown => {
		if (v === null || v === undefined) return v;
		const t = typeof v;
		if (t === "string") return sanitizeString(v as string);
		if (t === "number" || t === "boolean") return v;
		if (t === "bigint") return String(v);
		if (t === "function") return `[Function]`;
		if (t !== "object") return String(v);

		if (seen.has(v as object)) return "[Circular]";
		seen.add(v as object);

		if (depth >= LOG_MAX_DEPTH) return `[MaxDepth:${LOG_MAX_DEPTH}]`;

		if (Array.isArray(v)) {
			const out = v.slice(0, LOG_MAX_ARRAY).map((item) => walk(item, depth + 1));
			if (v.length > LOG_MAX_ARRAY) {
				out.push(`[...omitted ${v.length - LOG_MAX_ARRAY} items]`);
			}
			return out;
		}

		const entries = Object.entries(v as Record<string, unknown>);
		const mimeTypeValue = (v as Record<string, unknown>).mimeType ?? (v as Record<string, unknown>).mime_type;
		const dataValue = (v as Record<string, unknown>).data;
		if (
			typeof mimeTypeValue === "string" &&
			/^image\//i.test(mimeTypeValue.trim()) &&
			typeof dataValue === "string" &&
			dataValue.trim()
		) {
			const compact = dataValue.trim();
			if (looksLikeImageDataUrl(compact)) {
				return {
					...(v as Record<string, unknown>),
					data: `[inline-image-data-url len=${compact.length}]`,
				};
			}
			if (looksLikeBareBase64(compact)) {
				return {
					...(v as Record<string, unknown>),
					data: `[inline-image-base64 len=${compact.replace(/\s+/g, "").length}]`,
				};
			}
		}
		const out: Record<string, unknown> = {};
		let kept = 0;
		for (const [key, val] of entries) {
			if (kept >= LOG_MAX_KEYS) break;
			const lower = key.toLowerCase();
			if (SENSITIVE_JSON_KEYS.has(lower)) {
				out[key] = "***";
				kept += 1;
				continue;
			}
			out[key] = walk(val, depth + 1);
			kept += 1;
		}
		if (entries.length > kept) {
			out.__omittedKeys = entries.length - kept;
		}
		return out;
	};

	return walk(value, 0);
}

function stringifyLogJson(value: unknown): string | null {
	if (value === undefined) return null;
	const sanitized = sanitizeValueForLog(value);
	let json = "";
	try {
		json = JSON.stringify(sanitized);
	} catch {
		try {
			json = JSON.stringify(String(sanitized));
		} catch {
			json = "";
		}
	}
	if (!json) return null;
	if (json.length <= LOG_MAX_JSON_CHARS) return json;
	const preview = json.slice(0, LOG_MAX_JSON_CHARS);
	return JSON.stringify({
		truncated: true,
		originalLength: json.length,
		preview,
	});
}

function toRow(v: {
	user_id: string;
	users?: {
		login: string;
		name: string | null;
	} | null;
	vendor: string;
	task_id: string;
	task_kind: string | null;
	status: string;
	started_at: string | null;
	finished_at: string | null;
	duration_ms: number | null;
	error_message: string | null;
	request_json: string | null;
	response_json: string | null;
	created_at: string;
	updated_at: string;
}): VendorCallLogRow {
	return {
		row_id: 0,
		user_id: v.user_id,
		user_login: typeof v.users?.login === "string" ? v.users.login : null,
		user_name: typeof v.users?.name === "string" ? v.users.name : null,
		vendor: v.vendor,
		task_id: v.task_id,
		task_kind: v.task_kind,
		status: v.status,
		started_at: v.started_at,
		finished_at: v.finished_at,
		duration_ms: v.duration_ms,
		error_message: v.error_message,
		request_json: v.request_json,
		response_json: v.response_json,
		created_at: v.created_at,
		updated_at: v.updated_at,
	};
}

export async function ensureVendorCallLogsSchema(_db: PrismaClient): Promise<void> {
	if (schemaEnsured) return;
	// DDL is handled by startup schema bootstrap.
	schemaEnsured = true;
}

export async function upsertVendorCallLogStarted(
	db: PrismaClient,
	input: Omit<VendorCallLogUpsertInput, "status">,
): Promise<void> {
	await ensureVendorCallLogsSchema(db);
	const vendor = normalizeVendorKey(input.vendor);
	const taskId = normalizeTaskId(input.taskId);
	if (!input.userId || !vendor || !taskId) return;
	const nowIso = input.nowIso;
	const taskKind = normalizeTaskKind(input.taskKind);
	const prisma = getPrismaClient();

	const existing = await prisma.vendor_api_call_logs.findUnique({
		where: {
			user_id_vendor_task_id: {
				user_id: input.userId,
				vendor,
				task_id: taskId,
			},
		},
	});

	await prisma.vendor_api_call_logs.upsert({
		where: {
			user_id_vendor_task_id: {
				user_id: input.userId,
				vendor,
				task_id: taskId,
			},
		},
		create: {
			user_id: input.userId,
			vendor,
			task_id: taskId,
			task_kind: taskKind,
			status: "running",
			started_at: nowIso,
			finished_at: null,
			duration_ms: null,
			error_message: null,
			request_json: null,
			response_json: null,
			created_at: nowIso,
			updated_at: nowIso,
		},
		update: {
			task_kind: taskKind,
			status:
				existing?.status === "succeeded" || existing?.status === "failed"
					? existing.status
					: "running",
			started_at: existing?.started_at ?? nowIso,
			updated_at: nowIso,
		},
	});
}

export async function upsertVendorCallLogFinal(
	db: PrismaClient,
	input: VendorCallLogUpsertInput,
): Promise<void> {
	await ensureVendorCallLogsSchema(db);
	const vendor = normalizeVendorKey(input.vendor);
	const taskId = normalizeTaskId(input.taskId);
	if (!input.userId || !vendor || !taskId) return;
	const nowIso = input.nowIso;
	const taskKind = normalizeTaskKind(input.taskKind);
	const status: VendorCallLogStatus =
		input.status === "succeeded"
			? "succeeded"
			: input.status === "failed"
				? "failed"
				: "running";
	const finishedAt = status === "running" ? null : nowIso;
	const errorMessage = normalizeErrorMessage(input.errorMessage);
	const durationMs =
		status === "running"
			? null
			: typeof input.durationMs === "number" &&
					Number.isFinite(input.durationMs) &&
					input.durationMs >= 0
				? Math.round(input.durationMs)
				: 0;
	const prisma = getPrismaClient();
	const existing = await prisma.vendor_api_call_logs.findUnique({
		where: {
			user_id_vendor_task_id: {
				user_id: input.userId,
				vendor,
				task_id: taskId,
			},
		},
	});

	await prisma.vendor_api_call_logs.upsert({
		where: {
			user_id_vendor_task_id: {
				user_id: input.userId,
				vendor,
				task_id: taskId,
			},
		},
		create: {
			user_id: input.userId,
			vendor,
			task_id: taskId,
			task_kind: taskKind,
			status,
			started_at: nowIso,
			finished_at: finishedAt,
			duration_ms: durationMs,
			error_message: errorMessage,
			request_json: null,
			response_json: null,
			created_at: nowIso,
			updated_at: nowIso,
		},
		update: {
			task_kind: taskKind,
			status,
			started_at: existing?.started_at ?? nowIso,
			finished_at: finishedAt,
			duration_ms: durationMs,
			error_message: errorMessage,
			updated_at: nowIso,
		},
	});
}

export async function upsertVendorCallLogPayloads(
	db: PrismaClient,
	input: {
		userId: string;
		vendor: string;
		taskId: string;
		taskKind?: string | null;
		request?: unknown;
		upstreamResponse?: unknown;
		nowIso: string;
	},
): Promise<void> {
	await ensureVendorCallLogsSchema(db);
	const vendor = normalizeVendorKey(input.vendor);
	const taskId = normalizeTaskId(input.taskId);
	if (!input.userId || !vendor || !taskId) return;
	const nowIso = input.nowIso;
	const taskKind = normalizeTaskKind(input.taskKind);
	const requestJson = stringifyLogJson(input.request);
	const responseJson = stringifyLogJson(input.upstreamResponse);
	if (!requestJson && !responseJson) return;

	const prisma = getPrismaClient();
	const existing = await prisma.vendor_api_call_logs.findUnique({
		where: {
			user_id_vendor_task_id: {
				user_id: input.userId,
				vendor,
				task_id: taskId,
			},
		},
	});

	await prisma.vendor_api_call_logs.upsert({
		where: {
			user_id_vendor_task_id: {
				user_id: input.userId,
				vendor,
				task_id: taskId,
			},
		},
		create: {
			user_id: input.userId,
			vendor,
			task_id: taskId,
			task_kind: taskKind,
			status: "running",
			started_at: nowIso,
			finished_at: null,
			duration_ms: null,
			error_message: null,
			request_json: requestJson,
			response_json: responseJson,
			created_at: nowIso,
			updated_at: nowIso,
		},
		update: {
			task_kind: taskKind ?? existing?.task_kind ?? null,
			request_json: existing?.request_json ?? requestJson,
			response_json: existing?.response_json ?? responseJson,
			updated_at: nowIso,
		},
	});
}

export async function listVendorCallLogsForUser(
	db: PrismaClient,
	userId: string,
	opts?: {
		limit?: number;
		before?: string | null;
		vendor?: string | null;
		status?: VendorCallLogStatus | null;
		taskKind?: string | null;
	},
): Promise<VendorCallLogRow[]> {
	return listVendorCallLogs(db, {
		...opts,
		userId,
	});
}

export async function listVendorCallLogs(
	db: PrismaClient,
	opts?: {
		userId?: string | null;
		limit?: number;
		before?: string | null;
		vendor?: string | null;
		status?: VendorCallLogStatus | null;
		taskKind?: string | null;
	},
): Promise<VendorCallLogRow[]> {
	await ensureVendorCallLogsSchema(db);
	const limit = Math.max(1, Math.min(201, Math.floor(opts?.limit ?? 50)));
	const userId =
		typeof opts?.userId === "string" && opts.userId.trim()
			? opts.userId.trim()
			: null;
	const before =
		typeof opts?.before === "string" && opts.before.trim()
			? opts.before.trim()
			: null;
	const vendor =
		typeof opts?.vendor === "string" && opts.vendor.trim()
			? normalizeVendorKey(opts.vendor)
			: null;
	const status =
		opts?.status === "running" ||
		opts?.status === "succeeded" ||
		opts?.status === "failed"
			? opts.status
			: null;
	const taskKind = normalizeTaskKind(opts?.taskKind ?? null);

	const rows = await getPrismaClient().vendor_api_call_logs.findMany({
		where: {
			...(userId ? { user_id: userId } : {}),
			...(vendor ? { vendor } : {}),
			...(status ? { status } : {}),
			...(taskKind ? { task_kind: taskKind } : {}),
			...(before ? { created_at: { lt: before } } : {}),
		},
		include: {
			users: {
				select: {
					login: true,
					name: true,
				},
			},
		},
		orderBy: { created_at: "desc" },
		take: limit,
	});
	return rows.map(toRow);
}
