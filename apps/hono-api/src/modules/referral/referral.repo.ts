import type { PrismaClient } from "../../types";
import { execute, queryAll, queryOne } from "../../db/db";

export type ReferralConfigRow = {
	id: number;
	enabled: number;
	title: string;
	body: string;
	cta_text: string;
	image_url: string | null;
	anti_self_check: number;
	anti_self_window_days: number;
	invitee_welcome_credits: number;
	updated_at: string;
};

export type ReferralGrantKind = "welcome_bonus";

export type ReferralGrantLogRow = {
	id: string;
	source_topup_ledger_id: string;
	referrer_user_id: string;
	invitee_user_id: string;
	kind: ReferralGrantKind;
	granted_credits: number;
	ledger_entry_id: string;
	created_at: string;
};

async function ensureConfigRow(db: PrismaClient): Promise<void> {
	const nowIso = new Date().toISOString();
	// Portable upsert-if-missing across SQLite and Postgres
	await execute(
		db,
		`INSERT INTO referral_config (id, updated_at)
       SELECT 1, ?
       WHERE NOT EXISTS (SELECT 1 FROM referral_config WHERE id = 1)`,
		[nowIso],
	);
}

export async function getReferralConfig(
	db: PrismaClient,
): Promise<ReferralConfigRow | null> {
	await ensureConfigRow(db);
	return await queryOne<ReferralConfigRow>(
		db,
		`SELECT * FROM referral_config WHERE id = 1`,
	);
}

export async function updateReferralConfig(
	db: PrismaClient,
	patch: Partial<Omit<ReferralConfigRow, "id" | "updated_at">>,
	nowIso: string,
): Promise<void> {
	await ensureConfigRow(db);
	const fields: string[] = [];
	const values: unknown[] = [];
	for (const [k, v] of Object.entries(patch)) {
		if (v === undefined) continue;
		fields.push(`${k} = ?`);
		values.push(v);
	}
	if (fields.length === 0) {
		await execute(
			db,
			`UPDATE referral_config SET updated_at = ? WHERE id = 1`,
			[nowIso],
		);
		return;
	}
	fields.push(`updated_at = ?`);
	values.push(nowIso);
	await execute(
		db,
		`UPDATE referral_config SET ${fields.join(", ")} WHERE id = 1`,
		values,
	);
}

export async function findUserByInviteCode(
	db: PrismaClient,
	code: string,
): Promise<{ id: string; phone: string | null } | null> {
	return await queryOne<{ id: string; phone: string | null }>(
		db,
		`SELECT id, phone FROM users WHERE invite_code = ?`,
		[code],
	);
}

export async function getUserInviteCode(
	db: PrismaClient,
	userId: string,
): Promise<string | null> {
	const row = await queryOne<{ invite_code: string | null }>(
		db,
		`SELECT invite_code FROM users WHERE id = ?`,
		[userId],
	);
	return row?.invite_code ?? null;
}

export async function setUserInviteCode(
	db: PrismaClient,
	userId: string,
	code: string,
	nowIso: string,
): Promise<boolean> {
	try {
		await execute(
			db,
			`UPDATE users SET invite_code = ?, updated_at = ? WHERE id = ? AND invite_code IS NULL`,
			[code, nowIso, userId],
		);
		return true;
	} catch (_err) {
		return false;
	}
}

export async function setUserReferrer(
	db: PrismaClient,
	userId: string,
	referrerUserId: string,
	nowIso: string,
): Promise<void> {
	await execute(
		db,
		`UPDATE users SET referrer_user_id = ?, referrer_bound_at = ?, updated_at = ?
       WHERE id = ? AND referrer_user_id IS NULL`,
		[referrerUserId, nowIso, nowIso, userId],
	);
}

export async function getUserReferrerInfo(
	db: PrismaClient,
	userId: string,
): Promise<{
	id: string;
	referrer_user_id: string | null;
	phone: string | null;
} | null> {
	return await queryOne<{
		id: string;
		referrer_user_id: string | null;
		phone: string | null;
	}>(
		db,
		`SELECT id, referrer_user_id, phone FROM users WHERE id = ?`,
		[userId],
	);
}

export async function insertGrantLog(
	db: PrismaClient,
	row: ReferralGrantLogRow,
): Promise<void> {
	await execute(
		db,
		`INSERT INTO referral_grant_log
       (id, source_topup_ledger_id, referrer_user_id, invitee_user_id, kind, granted_credits, ledger_entry_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			row.id,
			row.source_topup_ledger_id,
			row.referrer_user_id,
			row.invitee_user_id,
			row.kind,
			row.granted_credits,
			row.ledger_entry_id,
			row.created_at,
		],
	);
}

export async function sumGrantedCreditsByReferrer(
	db: PrismaClient,
	referrerUserId: string,
): Promise<number> {
	const row = await queryOne<{ s: number | null }>(
		db,
		`SELECT COALESCE(SUM(granted_credits), 0) AS s
       FROM referral_grant_log
       WHERE referrer_user_id = ?`,
		[referrerUserId],
	);
	return Number(row?.s ?? 0) || 0;
}

export async function hasWelcomeBonusBeenGranted(
	db: PrismaClient,
	inviteeUserId: string,
): Promise<boolean> {
	const row = await queryOne<{ c: number }>(
		db,
		`SELECT COUNT(*) AS c FROM referral_grant_log WHERE invitee_user_id = ? AND kind = 'welcome_bonus'`,
		[inviteeUserId],
	);
	return (Number(row?.c ?? 0) || 0) > 0;
}

export async function countInviteesByReferrer(
	db: PrismaClient,
	referrerUserId: string,
): Promise<number> {
	const row = await queryOne<{ c: number }>(
		db,
		`SELECT COUNT(*) AS c FROM users WHERE referrer_user_id = ?`,
		[referrerUserId],
	);
	return Number(row?.c ?? 0) || 0;
}

// ── Admin overview ──────────────────────────────────────────────────────────

export type AdminReferralOverviewRow = {
	referrer_user_id: string;
	referrer_login: string | null;
	referrer_phone: string | null;
	referrer_invite_code: string | null;
	invitee_count: number;
	total_granted_credits: number;
	last_grant_at: string | null;
};

export async function listReferralOverview(
	db: PrismaClient,
	opts?: { limit?: number; search?: string | null },
): Promise<AdminReferralOverviewRow[]> {
	const limit = Math.max(1, Math.min(200, Math.floor(opts?.limit ?? 100)));
	const searchRaw = (opts?.search ?? "").trim();
	const where: string[] = ["u.referrer_user_id IS NOT NULL"];
	const params: unknown[] = [];
	if (searchRaw) {
		const like = `%${searchRaw}%`;
		where.push(
			"(referrer.login LIKE ? OR referrer.phone LIKE ? OR referrer.invite_code LIKE ?)",
		);
		params.push(like, like, like);
	}
	params.push(limit);
	const sql = `
       SELECT
         u.referrer_user_id AS referrer_user_id,
         referrer.login AS referrer_login,
         referrer.phone AS referrer_phone,
         referrer.invite_code AS referrer_invite_code,
         COUNT(u.id) AS invitee_count,
         COALESCE((
           SELECT SUM(granted_credits) FROM referral_grant_log
           WHERE referrer_user_id = u.referrer_user_id
         ), 0) AS total_granted_credits,
         (
           SELECT MAX(created_at) FROM referral_grant_log
           WHERE referrer_user_id = u.referrer_user_id
         ) AS last_grant_at
       FROM users u
       LEFT JOIN users referrer ON referrer.id = u.referrer_user_id
       WHERE ${where.join(" AND ")}
       GROUP BY u.referrer_user_id, referrer.login, referrer.phone, referrer.invite_code
       ORDER BY total_granted_credits DESC, invitee_count DESC
       LIMIT ?`;
	const rows = await queryAll<AdminReferralOverviewRow>(db, sql, params);
	return rows.map((r) => ({
		...r,
		invitee_count: Number(r.invitee_count) || 0,
		total_granted_credits: Number(r.total_granted_credits) || 0,
	}));
}

export type AdminReferralBindingRow = {
	invitee_user_id: string;
	invitee_login: string | null;
	invitee_phone: string | null;
	referrer_user_id: string;
	referrer_login: string | null;
	referrer_phone: string | null;
	referrer_bound_at: string | null;
	invitee_grant_total: number;
};

export async function listReferralBindings(
	db: PrismaClient,
	opts?: { referrerUserId?: string; limit?: number },
): Promise<AdminReferralBindingRow[]> {
	const limit = Math.max(1, Math.min(500, Math.floor(opts?.limit ?? 200)));
	const where: string[] = ["i.referrer_user_id IS NOT NULL"];
	const params: unknown[] = [];
	if (opts?.referrerUserId) {
		where.push("i.referrer_user_id = ?");
		params.push(opts.referrerUserId);
	}
	params.push(limit);
	const sql = `
       SELECT
         i.id AS invitee_user_id,
         i.login AS invitee_login,
         i.phone AS invitee_phone,
         i.referrer_user_id AS referrer_user_id,
         r.login AS referrer_login,
         r.phone AS referrer_phone,
         i.referrer_bound_at AS referrer_bound_at,
         COALESCE((
           SELECT SUM(granted_credits) FROM referral_grant_log
           WHERE invitee_user_id = i.id
         ), 0) AS invitee_grant_total
       FROM users i
       LEFT JOIN users r ON r.id = i.referrer_user_id
       WHERE ${where.join(" AND ")}
       ORDER BY i.referrer_bound_at DESC
       LIMIT ?`;
	const rows = await queryAll<AdminReferralBindingRow>(db, sql, params);
	return rows.map((r) => ({
		...r,
		invitee_grant_total: Number(r.invitee_grant_total) || 0,
	}));
}

export type AdminReferralGrantRow = ReferralGrantLogRow & {
	referrer_login: string | null;
	invitee_login: string | null;
};

export async function listReferralGrants(
	db: PrismaClient,
	opts?: { referrerUserId?: string; limit?: number },
): Promise<AdminReferralGrantRow[]> {
	const limit = Math.max(1, Math.min(500, Math.floor(opts?.limit ?? 200)));
	const where: string[] = [];
	const params: unknown[] = [];
	if (opts?.referrerUserId) {
		where.push("g.referrer_user_id = ?");
		params.push(opts.referrerUserId);
	}
	params.push(limit);
	const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
	const sql = `
       SELECT
         g.id, g.source_topup_ledger_id, g.referrer_user_id, g.invitee_user_id,
         g.kind, g.granted_credits, g.ledger_entry_id, g.created_at,
         r.login AS referrer_login,
         i.login AS invitee_login
       FROM referral_grant_log g
       LEFT JOIN users r ON r.id = g.referrer_user_id
       LEFT JOIN users i ON i.id = g.invitee_user_id
       ${whereSql}
       ORDER BY g.created_at DESC
       LIMIT ?`;
	return await queryAll<AdminReferralGrantRow>(db, sql, params);
}
