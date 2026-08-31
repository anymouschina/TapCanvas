import { Prisma } from "@prisma/client";
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

type CanonicalVendorCallLogCountRow = { total: bigint | number | string };

let schemaEnsured = false;

export function normalizeVendorCallLogKey(vendor: string): string {
	const normalized = (vendor || "").trim().toLowerCase();
	if (normalized === "newapi" || normalized.startsWith("newapi:")) {
		return "newapi";
	}
	return normalized;
}

function normalizeTaskKind(kind?: string | null): string | null {
	if (typeof kind !== "string") return null;
	const trimmed = kind.trim();
	return trimmed ? trimmed : null;
}

function normalizeTaskId(taskId: string): string {
	return (taskId || "").trim();
}

function normalizeFilterString(value?: string | null): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed || null;
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

function buildImagePreviewDataUrl(
	mimeType: string,
	rawData: string,
): string | null {
	const normalizedMimeType = mimeType.trim();
	if (!/^image\//i.test(normalizedMimeType)) return null;
	const compact = rawData.replace(/\s+/g, "");
	if (!compact) return null;
	if (looksLikeImageDataUrl(compact)) return compact;
	if (!looksLikeBareBase64(compact)) return null;
	return `data:${normalizedMimeType};base64,${compact}`;
}

function shouldPreserveDataUrlForLog(keyPath: string[]): boolean {
	if (!keyPath.length) return false;
	const lastKey = keyPath[keyPath.length - 1]?.trim().toLowerCase() || "";
	return lastKey === "previewdataurl";
}

function sanitizeStringForLog(str: string, keyPath: string[]): string {
	const raw = str || "";
	const trimmed = raw.trim();
	if (looksLikeBinaryDataUrl(trimmed)) {
		if (shouldPreserveDataUrlForLog(keyPath)) return trimmed;
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
}

export function serializeVendorLogText(value: string): string {
	return sanitizeStringForLog(value, []);
}

const TRUNCATED_LOG_SUFFIX = /^…\(truncated, len=(\d+)\)$/;

/**
 * Verifies the strongest exact source-prefix evidence retained by vendor logging.
 * Long strings are lossy by design, so comparison is limited to the exact 1800
 * preserved characters plus the serializer's declared original length.
 */
export function vendorLogTextMatchesExactSourcePrefix(
	loggedValue: unknown,
	sourceValue: string,
): boolean {
	if (typeof loggedValue !== "string") return false;
	const source = sourceValue.trim();
	if (!source) return false;
	if (source.length <= LOG_MAX_STRING) {
		return loggedValue === source || loggedValue.startsWith(`${source}\n\n`);
	}
	if (loggedValue.slice(0, LOG_MAX_STRING) !== source.slice(0, LOG_MAX_STRING)) {
		return false;
	}
	const suffixMatch = TRUNCATED_LOG_SUFFIX.exec(loggedValue.slice(LOG_MAX_STRING));
	if (!suffixMatch) return false;
	const loggedOriginalLength = Number(suffixMatch[1]);
	return Number.isInteger(loggedOriginalLength) && loggedOriginalLength >= source.length;
}

function sanitizeValueForLog(value: unknown): unknown {
	const seen = new WeakSet<object>();

	const walk = (v: unknown, depth: number, keyPath: string[]): unknown => {
		if (v === null || v === undefined) return v;
		const t = typeof v;
		if (t === "string") return sanitizeStringForLog(v as string, keyPath);
		if (t === "number" || t === "boolean") return v;
		if (t === "bigint") return String(v);
		if (t === "function") return `[Function]`;
		if (t !== "object") return String(v);

		if (seen.has(v as object)) return "[Circular]";
		seen.add(v as object);

		if (depth >= LOG_MAX_DEPTH) return `[MaxDepth:${LOG_MAX_DEPTH}]`;

		if (Array.isArray(v)) {
			const out = v
				.slice(0, LOG_MAX_ARRAY)
				.map((item, index) => walk(item, depth + 1, [...keyPath, String(index)]));
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
			const previewDataUrl = buildImagePreviewDataUrl(mimeTypeValue, compact);
			if (looksLikeImageDataUrl(compact)) {
				return {
					...(v as Record<string, unknown>),
					data: `[inline-image-data-url len=${compact.length}]`,
					...(previewDataUrl ? { previewDataUrl } : {}),
				};
			}
			if (looksLikeBareBase64(compact)) {
				return {
					...(v as Record<string, unknown>),
					data: `[inline-image-base64 len=${compact.replace(/\s+/g, "").length}]`,
					...(previewDataUrl ? { previewDataUrl } : {}),
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
			out[key] = walk(val, depth + 1, [...keyPath, key]);
			kept += 1;
		}
		if (entries.length > kept) {
			out.__omittedKeys = entries.length - kept;
		}
		return out;
	};

	return walk(value, 0, []);
}

export function stringifyLogJson(value: unknown): string | null {
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
	const vendor = normalizeVendorCallLogKey(input.vendor);
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
			task_kind: existing?.task_kind ?? taskKind,
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
	const vendor = normalizeVendorCallLogKey(input.vendor);
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
	const measuredDurationMs =
		status === "running"
			? null
			: typeof input.durationMs === "number" &&
					Number.isFinite(input.durationMs) &&
					input.durationMs >= 0
				? Math.round(input.durationMs)
				: null;
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
	const inferredDurationMs = (() => {
		if (status === "running") return null;
		if (measuredDurationMs !== null) return measuredDurationMs;
		const startedAtMs = existing?.started_at ? Date.parse(existing.started_at) : Number.NaN;
		const finishedAtMs = Date.parse(nowIso);
		if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) return null;
		return Math.max(0, Math.round(finishedAtMs - startedAtMs));
	})();

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
			duration_ms: inferredDurationMs,
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
			duration_ms: inferredDurationMs,
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
	const vendor = normalizeVendorCallLogKey(input.vendor);
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
			task_kind: existing?.task_kind ?? taskKind,
			request_json: existing?.request_json ?? requestJson,
			response_json: responseJson ?? existing?.response_json ?? null,
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
		taskId?: string | null;
		limit?: number;
		before?: string | null;
		vendor?: string | null;
		status?: VendorCallLogStatus | null;
		taskKind?: string | null;
	},
): Promise<VendorCallLogRow[]> {
	await ensureVendorCallLogsSchema(db);
	const limit = Math.max(1, Math.min(500, Math.floor(opts?.limit ?? 10)));
	const userId =
		typeof opts?.userId === "string" && opts.userId.trim()
			? opts.userId.trim()
			: null;
	const taskId =
		typeof opts?.taskId === "string" && opts.taskId.trim()
			? opts.taskId.trim()
			: null;
	const before =
		typeof opts?.before === "string" && opts.before.trim()
			? opts.before.trim()
			: null;
	const vendor =
		typeof opts?.vendor === "string" && opts.vendor.trim()
			? normalizeVendorCallLogKey(opts.vendor)
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
			...(taskId ? { task_id: taskId } : {}),
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

export async function listVendorCallLogsPage(
	db: PrismaClient,
	input: {
		page: number;
		pageSize: number;
		userId?: string | null;
		vendor?: string | null;
		status?: VendorCallLogStatus | null;
		taskKind?: string | null;
		taskId?: string | null;
		createdFrom?: string | null;
		createdTo?: string | null;
	},
): Promise<{ rows: VendorCallLogRow[]; total: number }> {
	await ensureVendorCallLogsSchema(db);
	const page = Math.max(1, Math.floor(input.page));
	const pageSize = Math.max(1, Math.min(100, Math.floor(input.pageSize)));
	const userId = normalizeFilterString(input.userId);
	const vendor = normalizeFilterString(input.vendor);
	const status =
		input.status === "running" || input.status === "succeeded" || input.status === "failed"
			? input.status
			: null;
	const taskKind = normalizeTaskKind(input.taskKind ?? null);
	const taskId = normalizeFilterString(input.taskId);
	const createdFrom = normalizeFilterString(input.createdFrom);
	const createdTo = normalizeFilterString(input.createdTo);
	const canonicalVendor = vendor ? normalizeVendorCallLogKey(vendor) : null;
	const sourceFilters: Prisma.Sql[] = [];
	if (userId) sourceFilters.push(Prisma.sql`logs.user_id = ${userId}`);
	if (taskId) sourceFilters.push(Prisma.sql`logs.task_id = ${taskId}`);
	if (createdFrom) sourceFilters.push(Prisma.sql`logs.created_at >= ${createdFrom}`);
	if (createdTo) sourceFilters.push(Prisma.sql`logs.created_at <= ${createdTo}`);
	const sourceWhere = sourceFilters.length > 0
		? Prisma.sql`WHERE ${Prisma.join(sourceFilters, " AND ")}`
		: Prisma.empty;
	const projectedFilters: Prisma.Sql[] = [];
	if (canonicalVendor) projectedFilters.push(Prisma.sql`projected.vendor = ${canonicalVendor}`);
	if (status) projectedFilters.push(Prisma.sql`projected.status = ${status}`);
	if (taskKind) projectedFilters.push(Prisma.sql`projected.task_kind = ${taskKind}`);
	const projectedWhere = projectedFilters.length > 0
		? Prisma.sql`WHERE ${Prisma.join(projectedFilters, " AND ")}`
		: Prisma.empty;
	const canonicalProjection = Prisma.sql`
		WITH ranked AS (
			SELECT
				logs.*,
				CASE
					WHEN logs.vendor = 'newapi' OR logs.vendor LIKE 'newapi:%' THEN 'newapi'
					ELSE logs.vendor
				END AS canonical_vendor,
				ROW_NUMBER() OVER (
					PARTITION BY
						logs.user_id,
						CASE
							WHEN logs.vendor = 'newapi' OR logs.vendor LIKE 'newapi:%' THEN 'newapi'
							ELSE logs.vendor
						END,
						logs.task_id
					ORDER BY
						CASE
							WHEN logs.vendor = 'newapi' THEN 0
							WHEN logs.vendor LIKE 'newapi:%' THEN 1
							ELSE 2
						END,
						CASE WHEN logs.status IN ('succeeded', 'failed') THEN 0 ELSE 1 END,
						logs.updated_at DESC
				) AS rank,
				MIN(logs.started_at) OVER (
					PARTITION BY
						logs.user_id,
						CASE
							WHEN logs.vendor = 'newapi' OR logs.vendor LIKE 'newapi:%' THEN 'newapi'
							ELSE logs.vendor
						END,
						logs.task_id
				) AS first_started_at,
				MIN(logs.created_at) OVER (
					PARTITION BY
						logs.user_id,
						CASE
							WHEN logs.vendor = 'newapi' OR logs.vendor LIKE 'newapi:%' THEN 'newapi'
							ELSE logs.vendor
						END,
						logs.task_id
				) AS first_created_at,
				MAX(logs.updated_at) OVER (
					PARTITION BY
						logs.user_id,
						CASE
							WHEN logs.vendor = 'newapi' OR logs.vendor LIKE 'newapi:%' THEN 'newapi'
							ELSE logs.vendor
						END,
						logs.task_id
				) AS last_updated_at
			FROM vendor_api_call_logs AS logs
			${sourceWhere}
		),
		projected AS (
			SELECT
				0::integer AS row_id,
				ranked.user_id,
				users.login AS user_login,
				users.name AS user_name,
				ranked.canonical_vendor AS vendor,
				ranked.task_id,
				COALESCE(NULLIF(task_results.kind, ''), ranked.task_kind) AS task_kind,
				CASE
					WHEN task_results.status IN ('succeeded', 'failed') THEN task_results.status
					ELSE ranked.status
				END AS status,
				ranked.first_started_at AS started_at,
				CASE
					WHEN task_results.status IN ('succeeded', 'failed') THEN COALESCE(task_results.completed_at, ranked.finished_at)
					WHEN ranked.status IN ('succeeded', 'failed') THEN ranked.finished_at
					ELSE NULL
				END AS finished_at,
				CASE
					WHEN ranked.duration_ms IS NOT NULL THEN ranked.duration_ms::double precision
					WHEN ranked.first_started_at IS NOT NULL
						AND COALESCE(task_results.completed_at, ranked.finished_at) IS NOT NULL
						THEN GREATEST(0::double precision, EXTRACT(EPOCH FROM (
							COALESCE(task_results.completed_at, ranked.finished_at)::timestamptz
							- ranked.first_started_at::timestamptz
						)) * 1000)
					ELSE NULL
				END AS duration_ms,
				ranked.error_message,
				ranked.request_json,
				ranked.response_json,
				ranked.first_created_at AS created_at,
				GREATEST(
					ranked.last_updated_at,
					COALESCE(task_results.updated_at, ranked.last_updated_at)
				) AS updated_at
			FROM ranked
			LEFT JOIN task_results
				ON task_results.user_id = ranked.user_id
				AND task_results.task_id = ranked.task_id
				AND (
					CASE
						WHEN task_results.vendor = 'newapi' OR task_results.vendor LIKE 'newapi:%' THEN 'newapi'
						ELSE task_results.vendor
					END
				) = ranked.canonical_vendor
			LEFT JOIN users ON users.id = ranked.user_id
			WHERE ranked.rank = 1
		)
	`;
	const prisma = getPrismaClient();
	const offset = (page - 1) * pageSize;
	const [countRows, rows] = await Promise.all([
		prisma.$queryRaw<CanonicalVendorCallLogCountRow[]>(Prisma.sql`
			${canonicalProjection}
			SELECT COUNT(*)::bigint AS total FROM projected ${projectedWhere}
		`),
		prisma.$queryRaw<VendorCallLogRow[]>(Prisma.sql`
			${canonicalProjection}
			SELECT * FROM projected
			${projectedWhere}
			ORDER BY created_at DESC, user_id DESC, task_id DESC
			OFFSET ${offset}
			LIMIT ${pageSize}
		`),
	]);
	const totalValue = countRows[0]?.total ?? 0;
	const total = Number(totalValue);
	return { rows, total: Number.isFinite(total) ? total : 0 };
}
