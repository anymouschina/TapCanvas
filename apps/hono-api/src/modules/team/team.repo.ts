import type { PrismaClient } from "../../types";
import { execute, executeWithChanges, queryAll, queryOne } from "../../db/db";

export type TeamRow = {
	id: string;
	name: string;
	credits: number;
	credits_frozen: number;
	created_at: string;
	updated_at: string;
};

export type TeamListRow = TeamRow & {
	member_count: number;
};

export type TeamMembershipRow = {
	team_id: string;
	user_id: string;
	role: string;
	created_at: string;
	updated_at: string;
};

export type TeamMemberRow = {
	team_id: string;
	user_id: string;
	role: string;
	created_at: string;
	updated_at: string;
	login: string;
	name: string | null;
	avatar_url: string | null;
	email: string | null;
	phone: string | null;
};

export type TeamInviteStatus = "pending" | "accepted" | "revoked" | "expired";

export type TeamInviteRow = {
	id: string;
	team_id: string;
	code: string;
	email: string | null;
	phone: string | null;
	login: string | null;
	status: string;
	expires_at: string | null;
	inviter_user_id: string;
	accepted_user_id: string | null;
	accepted_at: string | null;
	created_at: string;
	updated_at: string;
};

export type TeamCreditLedgerEntryType =
	| "topup"
	| "reserve"
	| "deduct"
	| "release";

export type TeamCreditLedgerRow = {
	id: string;
	team_id: string;
	entry_type: string;
	amount: number;
	task_id: string | null;
	task_kind: string | null;
	actor_user_id: string | null;
	note: string | null;
	created_at: string;
};

export async function findReservedTeamCreditsForTask(
	db: PrismaClient,
	input: { taskId: string; actorUserId: string },
): Promise<{ teamId: string; reserved: number } | null> {
	await ensureTeamSchema(db);
	const taskId = (input.taskId || "").trim();
	const actorUserId = (input.actorUserId || "").trim();
	if (!taskId || !actorUserId) return null;
	const row = await queryOne<{ team_id: string; amount: number }>(
		db,
		`
      SELECT team_id, amount
      FROM team_credit_ledger
      WHERE entry_type = 'reserve' AND task_id = ? AND actor_user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
		[taskId, actorUserId],
	);
	if (!row) return null;
	return {
		teamId: String(row.team_id),
		reserved: Number(row.amount ?? 0) || 0,
	};
}

export async function hasTeamSignupBonusLedgerEntry(
	db: PrismaClient,
	input: { teamId: string; actorUserId: string },
): Promise<boolean> {
	await ensureTeamSchema(db);
	const teamId = (input.teamId || "").trim();
	const actorUserId = (input.actorUserId || "").trim();
	if (!teamId || !actorUserId) return false;
	const row = await queryOne<{ id: string }>(
		db,
		`SELECT id
       FROM team_credit_ledger
       WHERE team_id = ?
         AND entry_type = 'topup'
         AND actor_user_id = ?
         AND note = 'signup_bonus'
       LIMIT 1`,
		[teamId, actorUserId],
	);
	return Boolean(row?.id);
}

let schemaEnsured = false;

async function hasTeamsColumn(
	db: PrismaClient,
	column: string,
): Promise<boolean> {
	const rows = await queryAll<{ name: string }>(db, `PRAGMA table_info(teams)`);
	return rows.some((row) => row.name === column);
}

async function hasTeamInvitesColumn(
	db: PrismaClient,
	column: string,
): Promise<boolean> {
	const rows = await queryAll<{ name: string }>(db, `PRAGMA table_info(team_invites)`);
	return rows.some((row) => row.name === column);
}

export async function ensureTeamSchema(db: PrismaClient): Promise<void> {
	if (schemaEnsured) return;

	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      credits INTEGER NOT NULL DEFAULT 0,
      credits_frozen INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
	);

	// Backward compatible: existing DBs might not have `credits_frozen` yet.
	// Add the column at runtime so billing logic can rely on it.
	const hasFrozen = await hasTeamsColumn(db, "credits_frozen");
	if (!hasFrozen) {
		await execute(
			db,
			`ALTER TABLE teams ADD COLUMN credits_frozen INTEGER NOT NULL DEFAULT 0`,
		);
	}

	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS team_memberships (
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (team_id, user_id),
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
	);

	// Single-team mode: each user can join at most one team for now.
	await execute(
		db,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_team_memberships_user_id
     ON team_memberships(user_id)`,
	);

	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_team_memberships_team_id
     ON team_memberships(team_id)`,
	);

	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS team_invites (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      email TEXT,
      phone TEXT,
      login TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TEXT,
      inviter_user_id TEXT NOT NULL,
      accepted_user_id TEXT,
      accepted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (inviter_user_id) REFERENCES users(id),
      FOREIGN KEY (accepted_user_id) REFERENCES users(id)
    )`,
	);

	const hasPhone = await hasTeamInvitesColumn(db, "phone");
	if (!hasPhone) {
		await execute(db, `ALTER TABLE team_invites ADD COLUMN phone TEXT`);
	}

	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_team_invites_team_status
     ON team_invites(team_id, status)`,
	);

	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS team_credit_ledger (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      entry_type TEXT NOT NULL, -- topup | reserve | deduct | release
      amount INTEGER NOT NULL,
      task_id TEXT,
      task_kind TEXT,
      actor_user_id TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (team_id, entry_type, task_id),
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (actor_user_id) REFERENCES users(id)
    )`,
	);

	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_team_credit_ledger_team_created_at
     ON team_credit_ledger(team_id, created_at)`,
	);

	schemaEnsured = true;
}

function normalizeTeamName(name: string): string {
	return (name || "").trim().slice(0, 64);
}

function normalizeRole(role: string | null | undefined): string {
	const r = (role || "").trim().toLowerCase();
	if (r === "owner" || r === "admin" || r === "member") return r;
	return "member";
}

export async function createTeam(
	db: PrismaClient,
	input: { id: string; name: string; nowIso: string },
): Promise<TeamRow> {
	await ensureTeamSchema(db);
	const name = normalizeTeamName(input.name);
	await execute(
		db,
		`INSERT INTO teams (id, name, credits, credits_frozen, created_at, updated_at)
     VALUES (?, ?, 0, 0, ?, ?)`,
		[input.id, name, input.nowIso, input.nowIso],
	);
	const row = await queryOne<TeamRow>(
		db,
		`SELECT id, name, credits, credits_frozen, created_at, updated_at FROM teams WHERE id = ? LIMIT 1`,
		[input.id],
	);
	if (!row) {
		throw new Error("create team failed");
	}
	return row;
}

export async function addTeamMember(
	db: PrismaClient,
	input: { teamId: string; userId: string; role?: string; nowIso: string },
): Promise<void> {
	await ensureTeamSchema(db);
	const role = normalizeRole(input.role);
	await execute(
		db,
		`INSERT INTO team_memberships (team_id, user_id, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
		[input.teamId, input.userId, role, input.nowIso, input.nowIso],
	);
}

export async function updateTeamMemberRole(
	db: PrismaClient,
	input: { teamId: string; userId: string; role: string; nowIso: string },
): Promise<void> {
	await ensureTeamSchema(db);
	const role = normalizeRole(input.role);
	await execute(
		db,
		`UPDATE team_memberships SET role = ?, updated_at = ?
     WHERE team_id = ? AND user_id = ?`,
		[role, input.nowIso, input.teamId, input.userId],
	);
}

export async function getTeamMembershipByUserId(
	db: PrismaClient,
	userId: string,
): Promise<TeamMembershipRow | null> {
	await ensureTeamSchema(db);
	return queryOne<TeamMembershipRow>(
		db,
		`SELECT team_id, user_id, role, created_at, updated_at
     FROM team_memberships
     WHERE user_id = ?
     LIMIT 1`,
		[userId],
	);
}

export async function getTeamById(
	db: PrismaClient,
	teamId: string,
): Promise<TeamRow | null> {
	await ensureTeamSchema(db);
	return queryOne<TeamRow>(
		db,
		`SELECT id, name, credits, credits_frozen, created_at, updated_at
     FROM teams
     WHERE id = ?
     LIMIT 1`,
		[teamId],
	);
}

export async function listTeamsWithCounts(db: PrismaClient): Promise<TeamListRow[]> {
	await ensureTeamSchema(db);
	return queryAll<TeamListRow>(
		db,
		`
    SELECT t.id, t.name, t.credits, t.credits_frozen, t.created_at, t.updated_at,
           COUNT(m.user_id) AS member_count
    FROM teams t
    LEFT JOIN team_memberships m ON m.team_id = t.id
    GROUP BY t.id
    ORDER BY t.created_at DESC
  `,
	);
}

export async function listTeamMembers(
	db: PrismaClient,
	teamId: string,
): Promise<TeamMemberRow[]> {
	await ensureTeamSchema(db);
	try {
		const rows = await queryAll<TeamMemberRow>(
			db,
			`
      SELECT m.team_id, m.user_id, m.role, m.created_at, m.updated_at,
             u.login, u.name, u.avatar_url, u.email, u.phone
      FROM team_memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.team_id = ?
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
               m.created_at ASC
    `,
			[teamId],
		);
		return rows ?? [];
	} catch {
		// Backward-compatible: old schemas may not have users.phone column yet.
		const rows = await queryAll<any>(
			db,
			`
        SELECT m.team_id, m.user_id, m.role, m.created_at, m.updated_at,
               u.login, u.name, u.avatar_url, u.email
        FROM team_memberships m
        JOIN users u ON u.id = m.user_id
        WHERE m.team_id = ?
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                 m.created_at ASC
      `,
			[teamId],
		);
		return (rows || []).map((r: any) => ({ ...r, phone: null }));
	}
}

export async function createTeamInvite(
	db: PrismaClient,
	input: {
		id: string;
		teamId: string;
		code: string;
		email?: string | null;
		phone?: string | null;
		login?: string | null;
		expiresAt?: string | null;
		inviterUserId: string;
		nowIso: string;
	},
): Promise<TeamInviteRow> {
	await ensureTeamSchema(db);
	await execute(
		db,
		`INSERT INTO team_invites
       (id, team_id, code, email, phone, login, status, expires_at, inviter_user_id, accepted_user_id, accepted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, ?, ?)`,
		[
			input.id,
			input.teamId,
			input.code,
			input.email ?? null,
			input.phone ?? null,
			input.login ?? null,
			input.expiresAt ?? null,
			input.inviterUserId,
			input.nowIso,
			input.nowIso,
		],
	);
	const row = await queryOne<TeamInviteRow>(
		db,
		`SELECT * FROM team_invites WHERE id = ? LIMIT 1`,
		[input.id],
	);
	if (!row) throw new Error("create team invite failed");
	return row;
}

export async function getTeamInviteByCode(
	db: PrismaClient,
	code: string,
): Promise<TeamInviteRow | null> {
	await ensureTeamSchema(db);
	return queryOne<TeamInviteRow>(
		db,
		`SELECT * FROM team_invites WHERE code = ? LIMIT 1`,
		[code],
	);
}

export async function markInviteAccepted(
	db: PrismaClient,
	input: { inviteId: string; acceptedUserId: string; nowIso: string },
): Promise<void> {
	await ensureTeamSchema(db);
	await execute(
		db,
		`UPDATE team_invites
     SET status = 'accepted',
         accepted_user_id = ?,
         accepted_at = ?,
         updated_at = ?
     WHERE id = ?`,
		[input.acceptedUserId, input.nowIso, input.nowIso, input.inviteId],
	);
}

export async function revokeInvite(
	db: PrismaClient,
	input: { inviteId: string; nowIso: string },
): Promise<void> {
	await ensureTeamSchema(db);
	await execute(
		db,
		`UPDATE team_invites
     SET status = 'revoked',
         updated_at = ?
     WHERE id = ? AND status = 'pending'`,
		[input.nowIso, input.inviteId],
	);
}

export async function listTeamInvites(
	db: PrismaClient,
	teamId: string,
): Promise<TeamInviteRow[]> {
	await ensureTeamSchema(db);
	return queryAll<TeamInviteRow>(
		db,
		`SELECT * FROM team_invites
     WHERE team_id = ?
     ORDER BY created_at DESC
     LIMIT 100`,
		[teamId],
	);
}

function normalizeLedgerType(
	t: string | null | undefined,
): TeamCreditLedgerEntryType {
	const v = (t || "").trim().toLowerCase();
	if (v === "reserve") return "reserve";
	if (v === "deduct") return "deduct";
	if (v === "release") return "release";
	return "topup";
}

function normalizePositiveInt(value: number): number {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.floor(n));
}

export async function topUpTeamCredits(
	db: PrismaClient,
	input: {
		teamId: string;
		amount: number;
		actorUserId: string;
		note?: string | null;
		nowIso: string;
	},
): Promise<TeamRow> {
	await ensureTeamSchema(db);
	const amount = normalizePositiveInt(input.amount);
	if (amount <= 0) {
		const row = await getTeamById(db, input.teamId);
		if (!row) throw new Error("team not found");
		return row;
	}

	await execute(
		db,
		`UPDATE teams SET credits = credits + ?, updated_at = ? WHERE id = ?`,
		[amount, input.nowIso, input.teamId],
	);

	await execute(
		db,
		`INSERT INTO team_credit_ledger
       (id, team_id, entry_type, amount, task_id, task_kind, actor_user_id, note, created_at)
       VALUES (?, ?, 'topup', ?, NULL, NULL, ?, ?, ?)`,
		[
			crypto.randomUUID(),
			input.teamId,
			amount,
			input.actorUserId,
			input.note ?? null,
			input.nowIso,
		],
	);

	const row = await getTeamById(db, input.teamId);
	if (!row) throw new Error("team not found");
	return row;
}

export async function tryDeductTeamCreditsFromBalanceOnce(
	db: PrismaClient,
	input: {
		teamId: string;
		amount: number;
		actorUserId: string;
		note?: string | null;
		nowIso: string;
	},
): Promise<{ deducted: boolean }> {
	await ensureTeamSchema(db);
	const amount = normalizePositiveInt(input.amount);
	if (amount <= 0) return { deducted: false };

	const ledgerId = crypto.randomUUID();
	await execute(
		db,
		`INSERT INTO team_credit_ledger
       (id, team_id, entry_type, amount, task_id, task_kind, actor_user_id, note, created_at)
       VALUES (?, ?, 'deduct', ?, NULL, NULL, ?, ?, ?)`,
		[ledgerId, input.teamId, amount, input.actorUserId, input.note ?? null, input.nowIso],
	);

	const updated =
		(await executeWithChanges(
			db,
			`UPDATE teams
       SET credits = credits - ?, updated_at = ?
       WHERE id = ? AND credits >= ? AND (credits - ?) >= credits_frozen`,
			[amount, input.nowIso, input.teamId, amount, amount],
		)) > 0;

	if (!updated) {
		// Best-effort rollback: keep ledger consistent.
		try {
			await execute(db, `DELETE FROM team_credit_ledger WHERE id = ?`, [ledgerId]);
		} catch {
			// ignore
		}
		return { deducted: false };
	}

	return { deducted: true };
}

export async function listTeamCreditLedger(
	db: PrismaClient,
	teamId: string,
): Promise<TeamCreditLedgerRow[]> {
	await ensureTeamSchema(db);
	return queryAll<TeamCreditLedgerRow>(
		db,
		`SELECT id, team_id, entry_type, amount, task_id, task_kind, actor_user_id, note, created_at
     FROM team_credit_ledger
     WHERE team_id = ?
     ORDER BY created_at DESC
     LIMIT 200`,
		[teamId],
	);
}

export async function listTeamCreditLedgerByActorUserId(
	db: PrismaClient,
	teamId: string,
	actorUserId: string,
): Promise<TeamCreditLedgerRow[]> {
	await ensureTeamSchema(db);
	return queryAll<TeamCreditLedgerRow>(
		db,
		`SELECT id, team_id, entry_type, amount, task_id, task_kind, actor_user_id, note, created_at
     FROM team_credit_ledger
     WHERE team_id = ? AND actor_user_id = ?
     ORDER BY created_at DESC
     LIMIT 200`,
		[teamId, actorUserId],
	);
}

export async function getTeamCreditsOverview(
	db: PrismaClient,
	teamId: string,
): Promise<{
	credits: number;
	creditsFrozen: number;
	available: number;
} | null> {
	await ensureTeamSchema(db);
	try {
		const row = await queryOne<{ credits: number; credits_frozen: number }>(
			db,
			`SELECT credits, credits_frozen FROM teams WHERE id = ? LIMIT 1`,
			[teamId],
		);
		if (!row) return null;
		const credits =
			typeof row.credits === "number" && Number.isFinite(row.credits)
				? Math.trunc(row.credits)
				: 0;
		const frozen =
			typeof row.credits_frozen === "number" && Number.isFinite(row.credits_frozen)
				? Math.trunc(row.credits_frozen)
				: 0;
		const creditsFrozen = Math.max(0, frozen);
		const available = Math.max(0, credits - creditsFrozen);
		return { credits, creditsFrozen, available };
	} catch (err: any) {
		// Backward-compatible: in case credits_frozen is missing and ALTER TABLE isn't applied yet.
		const row = await queryOne<{ credits: number }>(
			db,
			`SELECT credits FROM teams WHERE id = ? LIMIT 1`,
			[teamId],
		);
		if (!row) return null;
		const credits =
			typeof row.credits === "number" && Number.isFinite(row.credits)
				? Math.trunc(row.credits)
				: 0;
		return { credits, creditsFrozen: 0, available: Math.max(0, credits) };
	}
}

export async function tryChargeTeamCreditsOnce(
	db: PrismaClient,
	input: {
		teamId: string;
		amount: number;
		taskId: string;
		taskKind?: string | null;
		actorUserId: string;
		note?: string | null;
		nowIso: string;
	},
): Promise<{ charged: boolean }> {
	await ensureTeamSchema(db);
	const amount = normalizePositiveInt(input.amount);
	const taskId = (input.taskId || "").trim();
	if (amount <= 0 || !taskId) return { charged: false };

	const inserted =
		(await executeWithChanges(
			db,
			`INSERT INTO team_credit_ledger
       (id, team_id, entry_type, amount, task_id, task_kind, actor_user_id, note, created_at)
       VALUES (?, ?, 'deduct', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(team_id, entry_type, task_id) DO NOTHING`,
			[
				crypto.randomUUID(),
				input.teamId,
				amount,
				taskId,
				input.taskKind ?? null,
				input.actorUserId,
				input.note ?? null,
				input.nowIso,
			],
		)) > 0;
	if (!inserted) return { charged: false };

	const updated =
		(await executeWithChanges(
			db,
			`UPDATE teams SET credits = credits - ?, updated_at = ? WHERE id = ?`,
			[amount, input.nowIso, input.teamId],
		)) > 0;
	if (!updated) {
		// Best-effort rollback: keep balance consistent if team was deleted.
		try {
			await execute(
				db,
				`DELETE FROM team_credit_ledger
           WHERE team_id = ? AND entry_type = 'deduct' AND task_id = ?`,
				[input.teamId, taskId],
			);
		} catch {
			// ignore
		}
		return { charged: false };
	}

	return { charged: true };
}

export async function getTeamCredits(
	db: PrismaClient,
	teamId: string,
): Promise<number | null> {
	await ensureTeamSchema(db);
	const row = await getTeamCreditsOverview(db, teamId);
	if (!row) return null;
	return row.available;
}

export async function getTeamReservedCreditsForTask(
	db: PrismaClient,
	input: { teamId: string; taskId: string },
): Promise<number | null> {
	await ensureTeamSchema(db);
	const taskId = (input.taskId || "").trim();
	if (!taskId) return null;
	const row = await queryOne<{ amount: number }>(
		db,
		`SELECT amount
     FROM team_credit_ledger
     WHERE team_id = ? AND entry_type = 'reserve' AND task_id = ?
     LIMIT 1`,
		[input.teamId, taskId],
	);
	if (!row) return null;
	const amount = typeof row.amount === "number" && Number.isFinite(row.amount) ? Math.trunc(row.amount) : 0;
	return Math.max(0, amount);
}

export async function getTeamDeductedCreditsForTask(
	db: PrismaClient,
	input: { teamId: string; taskId: string },
): Promise<number> {
	await ensureTeamSchema(db);
	const taskId = (input.taskId || "").trim();
	if (!taskId) return 0;
	const row = await queryOne<{ amount: number }>(
		db,
		`SELECT COALESCE(SUM(amount), 0) AS amount
     FROM team_credit_ledger
     WHERE team_id = ? AND entry_type = 'deduct' AND task_id = ?`,
		[input.teamId, taskId],
	);
	const amount = typeof row?.amount === "number" && Number.isFinite(row.amount) ? Math.trunc(row.amount) : 0;
	return Math.max(0, amount);
}

export async function tryReserveTeamCreditsOnce(
	db: PrismaClient,
	input: {
		teamId: string;
		amount: number;
		taskId: string;
		taskKind?: string | null;
		actorUserId: string;
		note?: string | null;
		nowIso: string;
	},
): Promise<{ reserved: boolean }> {
	await ensureTeamSchema(db);
	const amount = normalizePositiveInt(input.amount);
	const taskId = (input.taskId || "").trim();
	if (amount <= 0 || !taskId) return { reserved: false };

	const inserted =
		(await executeWithChanges(
			db,
			`INSERT INTO team_credit_ledger
       (id, team_id, entry_type, amount, task_id, task_kind, actor_user_id, note, created_at)
       VALUES (?, ?, 'reserve', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(team_id, entry_type, task_id) DO NOTHING`,
			[
				crypto.randomUUID(),
				input.teamId,
				amount,
				taskId,
				input.taskKind ?? null,
				input.actorUserId,
				input.note ?? null,
				input.nowIso,
			],
		)) > 0;
	if (!inserted) return { reserved: false };

	const updated =
		(await executeWithChanges(
			db,
			`UPDATE teams
       SET credits_frozen = credits_frozen + ?, updated_at = ?
       WHERE id = ? AND (credits - credits_frozen) >= ?`,
			[amount, input.nowIso, input.teamId, amount],
		)) > 0;
	if (!updated) {
		// Best-effort rollback: release the reserve row if we couldn't freeze.
		try {
			await execute(
				db,
				`DELETE FROM team_credit_ledger
           WHERE team_id = ? AND entry_type = 'reserve' AND task_id = ?`,
				[input.teamId, taskId],
			);
		} catch {
			// ignore
		}
		return { reserved: false };
	}

	return { reserved: true };
}

export async function tryDeductTeamCreditsOnce(
	db: PrismaClient,
	input: {
		teamId: string;
		amount: number;
		taskId: string;
		taskKind?: string | null;
		actorUserId: string;
		note?: string | null;
		nowIso: string;
	},
): Promise<{ deducted: boolean }> {
	await ensureTeamSchema(db);
	const amount = normalizePositiveInt(input.amount);
	const taskId = (input.taskId || "").trim();
	if (amount <= 0 || !taskId) return { deducted: false };

	const inserted =
		(await executeWithChanges(
			db,
			`INSERT INTO team_credit_ledger
       (id, team_id, entry_type, amount, task_id, task_kind, actor_user_id, note, created_at)
       VALUES (?, ?, 'deduct', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(team_id, entry_type, task_id) DO NOTHING`,
			[
				crypto.randomUUID(),
				input.teamId,
				amount,
				taskId,
				input.taskKind ?? null,
				input.actorUserId,
				input.note ?? null,
				input.nowIso,
			],
		)) > 0;
	if (!inserted) return { deducted: false };

	const updated =
		(await executeWithChanges(
			db,
			`UPDATE teams
       SET credits = credits - ?, credits_frozen = credits_frozen - ?, updated_at = ?
       WHERE id = ? AND credits >= ? AND credits_frozen >= ?`,
			[amount, amount, input.nowIso, input.teamId, amount, amount],
		)) > 0;
	if (!updated) {
		// Best-effort rollback: keep ledger consistent.
		try {
			await execute(
				db,
				`DELETE FROM team_credit_ledger
           WHERE team_id = ? AND entry_type = 'deduct' AND task_id = ?`,
				[input.teamId, taskId],
			);
		} catch {
			// ignore
		}
		return { deducted: false };
	}

	return { deducted: true };
}

export async function tryReleaseTeamCreditsOnce(
	db: PrismaClient,
	input: {
		teamId: string;
		amount: number;
		taskId: string;
		taskKind?: string | null;
		actorUserId: string;
		note?: string | null;
		nowIso: string;
	},
): Promise<{ released: boolean }> {
	await ensureTeamSchema(db);
	const amount = normalizePositiveInt(input.amount);
	const taskId = (input.taskId || "").trim();
	if (amount <= 0 || !taskId) return { released: false };

	const inserted =
		(await executeWithChanges(
			db,
			`INSERT INTO team_credit_ledger
       (id, team_id, entry_type, amount, task_id, task_kind, actor_user_id, note, created_at)
       VALUES (?, ?, 'release', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(team_id, entry_type, task_id) DO NOTHING`,
			[
				crypto.randomUUID(),
				input.teamId,
				amount,
				taskId,
				input.taskKind ?? null,
				input.actorUserId,
				input.note ?? null,
				input.nowIso,
			],
		)) > 0;
	if (!inserted) return { released: false };

	const updated =
		(await executeWithChanges(
			db,
			`UPDATE teams
       SET credits_frozen = credits_frozen - ?, updated_at = ?
       WHERE id = ? AND credits_frozen >= ?`,
			[amount, input.nowIso, input.teamId, amount],
		)) > 0;
	if (!updated) {
		// Best-effort rollback: keep ledger consistent.
		try {
			await execute(
				db,
				`DELETE FROM team_credit_ledger
           WHERE team_id = ? AND entry_type = 'release' AND task_id = ?`,
				[input.teamId, taskId],
			);
		} catch {
			// ignore
		}
		return { released: false };
	}

	return { released: true };
}

export async function rebindTeamCreditLedgerTaskId(
	db: PrismaClient,
	input: {
		teamId: string;
		entryType: TeamCreditLedgerEntryType;
		fromTaskId: string;
		toTaskId: string;
	},
): Promise<{ ok: boolean }> {
	await ensureTeamSchema(db);
	const entryType = normalizeLedgerType(input.entryType);
	const fromTaskId = (input.fromTaskId || "").trim();
	const toTaskId = (input.toTaskId || "").trim();
	if (!fromTaskId || !toTaskId) return { ok: false };
	if (fromTaskId === toTaskId) return { ok: true };

	try {
		const changed =
			(await executeWithChanges(
				db,
				`UPDATE team_credit_ledger
         SET task_id = ?
         WHERE team_id = ? AND entry_type = ? AND task_id = ?`,
				[toTaskId, input.teamId, entryType, fromTaskId],
			)) > 0;
		return { ok: changed };
	} catch {
		return { ok: false };
	}
}

export async function tryIncreaseReservedTeamCreditsForTask(
	db: PrismaClient,
	input: {
		teamId: string;
		taskId: string;
		expectedReserved: number;
		delta: number;
		nowIso: string;
	},
): Promise<{ increased: boolean }> {
	await ensureTeamSchema(db);
	const taskId = (input.taskId || "").trim();
	const expectedReserved = normalizePositiveInt(input.expectedReserved);
	const delta = normalizePositiveInt(input.delta);
	if (!taskId || delta <= 0) return { increased: false };

	// 1) CAS update the reserve ledger amount so only one racer can win.
	const ledgerUpdated =
		(await executeWithChanges(
			db,
			`UPDATE team_credit_ledger
       SET amount = amount + ?
       WHERE team_id = ? AND entry_type = 'reserve' AND task_id = ? AND amount = ?`,
			[delta, input.teamId, taskId, expectedReserved],
		)) > 0;
	if (!ledgerUpdated) return { increased: false };

	// 2) Freeze additional credits (must have enough available).
	const teamUpdated =
		(await executeWithChanges(
			db,
			`UPDATE teams
       SET credits_frozen = credits_frozen + ?, updated_at = ?
       WHERE id = ? AND (credits - credits_frozen) >= ?`,
			[delta, input.nowIso, input.teamId, delta],
		)) > 0;
	if (!teamUpdated) {
		// Best-effort rollback: revert the ledger increment.
		try {
			await execute(
				db,
				`UPDATE team_credit_ledger
           SET amount = amount - ?
           WHERE team_id = ? AND entry_type = 'reserve' AND task_id = ? AND amount = ?`,
				[delta, input.teamId, taskId, expectedReserved + delta],
			);
		} catch {
			// ignore
		}
		return { increased: false };
	}

	return { increased: true };
}

export async function findUserIdByLogin(
	db: PrismaClient,
	login: string,
): Promise<string | null> {
	const normalized = (login || "").trim().toLowerCase();
	if (!normalized) return null;
	const row = await queryOne<{ id: string }>(
		db,
		`SELECT id FROM users WHERE lower(login) = ? LIMIT 1`,
		[normalized],
	);
	return row?.id ?? null;
}
