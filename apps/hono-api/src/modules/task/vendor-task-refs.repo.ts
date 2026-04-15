import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";

export type VendorTaskRefKind = "video" | "character" | "image";

export type VendorTaskRefRow = {
	user_id: string;
	kind: VendorTaskRefKind;
	task_id: string;
	vendor: string;
	pid: string | null;
	created_at: string;
	updated_at: string;
};

let schemaEnsured = false;

export async function ensureVendorTaskRefsSchema(
	db: PrismaClient,
): Promise<void> {
	void db;
	if (schemaEnsured) return;
	// DDL is handled by startup schema bootstrap for Postgres.
	schemaEnsured = true;
}

function normalizeKind(kind: VendorTaskRefKind): VendorTaskRefKind {
	if (kind === "character") return "character";
	if (kind === "image") return "image";
	return "video";
}

function mapVendorTaskRefRow(row: {
	user_id: string;
	kind: string;
	task_id: string;
	vendor: string;
	pid: string | null;
	created_at: string;
	updated_at: string;
} | null): VendorTaskRefRow | null {
	if (!row) return null;
	return {
		...row,
		kind: normalizeKind(row.kind as VendorTaskRefKind),
	};
}

function normalizePid(pid?: string | null): string | null {
	if (typeof pid !== "string") return null;
	const trimmed = pid.trim();
	return trimmed ? trimmed : null;
}

export async function upsertVendorTaskRef(
	db: PrismaClient,
	userId: string,
	input: {
		kind: VendorTaskRefKind;
		taskId: string;
		vendor: string;
		pid?: string | null;
	},
	nowIso: string,
): Promise<void> {
	await ensureVendorTaskRefsSchema(db);
	const kind = normalizeKind(input.kind);
	const taskId = (input.taskId || "").trim();
	const vendor = (input.vendor || "").trim();
	const pid = normalizePid(input.pid);
	if (!taskId || !vendor) return;

	const prisma = getPrismaClient();
	const existing = await prisma.vendor_task_refs.findUnique({
		where: {
			user_id_kind_task_id: {
				user_id: userId,
				kind,
				task_id: taskId,
			},
		},
		select: { pid: true },
	});
	await prisma.vendor_task_refs.upsert({
		where: {
			user_id_kind_task_id: {
				user_id: userId,
				kind,
				task_id: taskId,
			},
		},
		create: {
			user_id: userId,
			kind,
			task_id: taskId,
			vendor,
			pid,
			created_at: nowIso,
			updated_at: nowIso,
		},
		update: {
			vendor,
			pid: pid ?? existing?.pid ?? null,
			updated_at: nowIso,
		},
	});
}

export async function getVendorTaskRefByTaskId(
	db: PrismaClient,
	userId: string,
	kind: VendorTaskRefKind,
	taskId: string,
): Promise<VendorTaskRefRow | null> {
	await ensureVendorTaskRefsSchema(db);
	const normalizedTaskId = (taskId || "").trim();
	if (!normalizedTaskId) return null;
	return mapVendorTaskRefRow(await getPrismaClient().vendor_task_refs.findUnique({
		where: {
			user_id_kind_task_id: {
				user_id: userId,
				kind: normalizeKind(kind),
				task_id: normalizedTaskId,
			},
		},
	}));
}

export async function getVendorTaskRefByPid(
	db: PrismaClient,
	userId: string,
	kind: VendorTaskRefKind,
	pid: string,
): Promise<VendorTaskRefRow | null> {
	await ensureVendorTaskRefsSchema(db);
	const normalizedPid = (pid || "").trim();
	if (!normalizedPid) return null;
	return mapVendorTaskRefRow(await getPrismaClient().vendor_task_refs.findFirst({
		where: {
			user_id: userId,
			kind: normalizeKind(kind),
			pid: normalizedPid,
		},
		orderBy: { updated_at: "desc" },
	}));
}
