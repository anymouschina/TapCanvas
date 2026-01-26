import type { D1Database } from "../../types";
import { execute, queryAll, queryOne } from "../../db/db";

export type TeamRow = {
	id: string;
	name: string;
	credits: number;
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
};

export type TeamInviteStatus = "pending" | "accepted" | "revoked" | "expired";

export type TeamInviteRow = {
	id: string;
	team_id: string;
	code: string;
	email: string | null;
	login: string | null;
	status: string;
	expires_at: string | null;
	inviter_user_id: string;
	accepted_user_id: string | null;
	accepted_at: string | null;
	created_at: string;
	updated_at: string;
};

export type TeamCreditLedgerEntryType = "topup" | "deduct";

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

let schemaEnsured = false;

export async function ensureTeamSchema(db: D1Database): Promise<void> {
	if (schemaEnsured) return;

	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      credits INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
	);

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
      entry_type TEXT NOT NULL, -- topup | deduct
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
	db: D1Database,
	input: { id: string; name: string; nowIso: string },
): Promise<TeamRow> {
	await ensureTeamSchema(db);
	const name = normalizeTeamName(input.name);
	await execute(
		db,
		`INSERT INTO teams (id, name, credits, created_at, updated_at)
     VALUES (?, ?, 0, ?, ?)`,
		[input.id, name, input.nowIso, input.nowIso],
	);
	const row = await queryOne<TeamRow>(
		db,
		`SELECT id, name, credits, created_at, updated_at FROM teams WHERE id = ? LIMIT 1`,
		[input.id],
	);
	if (!row) {
		throw new Error("create team failed");
	}
	return row;
}

export async function addTeamMember(
	db: D1Database,
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
	db: D1Database,
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
	db: D1Database,
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
	db: D1Database,
	teamId: string,
): Promise<TeamRow | null> {
	await ensureTeamSchema(db);
	return queryOne<TeamRow>(
		db,
		`SELECT id, name, credits, created_at, updated_at
     FROM teams
     WHERE id = ?
     LIMIT 1`,
		[teamId],
	);
}

export async function listTeamsWithCounts(db: D1Database): Promise<TeamListRow[]> {
	await ensureTeamSchema(db);
	return queryAll<TeamListRow>(
		db,
		`
    SELECT t.id, t.name, t.credits, t.created_at, t.updated_at,
           COUNT(m.user_id) AS member_count
    FROM teams t
    LEFT JOIN team_memberships m ON m.team_id = t.id
    GROUP BY t.id
    ORDER BY t.created_at DESC
  `,
	);
}

export async function listTeamMembers(
	db: D1Database,
	teamId: string,
): Promise<TeamMemberRow[]> {
	await ensureTeamSchema(db);
	return queryAll<TeamMemberRow>(
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
}

export async function createTeamInvite(
	db: D1Database,
	input: {
		id: string;
		teamId: string;
		code: string;
		email?: string | null;
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
       (id, team_id, code, email, login, status, expires_at, inviter_user_id, accepted_user_id, accepted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, ?, ?)`,
		[
			input.id,
			input.teamId,
			input.code,
			input.email ?? null,
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
	db: D1Database,
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
	db: D1Database,
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
	db: D1Database,
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
	db: D1Database,
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
	return v === "deduct" ? "deduct" : "topup";
}

function normalizePositiveInt(value: number): number {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.floor(n));
}

export async function topUpTeamCredits(
	db: D1Database,
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

export async function listTeamCreditLedger(
	db: D1Database,
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

export async function tryChargeTeamCreditsOnce(
	db: D1Database,
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

	const insertRes = await db
		.prepare(
			`INSERT INTO team_credit_ledger
       (id, team_id, entry_type, amount, task_id, task_kind, actor_user_id, note, created_at)
       VALUES (?, ?, 'deduct', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(team_id, entry_type, task_id) DO NOTHING`,
		)
		.bind(
			crypto.randomUUID(),
			input.teamId,
			amount,
			taskId,
			input.taskKind ?? null,
			input.actorUserId,
			input.note ?? null,
			input.nowIso,
		)
		.run();

	const inserted = Number((insertRes as any)?.meta?.changes ?? 0) > 0;
	if (!inserted) return { charged: false };

	const updateRes = await db
		.prepare(`UPDATE teams SET credits = credits - ?, updated_at = ? WHERE id = ?`)
		.bind(amount, input.nowIso, input.teamId)
		.run();
	const updated = Number((updateRes as any)?.meta?.changes ?? 0) > 0;
	if (!updated) {
		// Best-effort rollback: keep balance consistent if team was deleted.
		try {
			await db
				.prepare(
					`DELETE FROM team_credit_ledger
           WHERE team_id = ? AND entry_type = 'deduct' AND task_id = ?`,
				)
				.bind(input.teamId, taskId)
				.run();
		} catch {
			// ignore
		}
		return { charged: false };
	}

	return { charged: true };
}

export async function getTeamCredits(
	db: D1Database,
	teamId: string,
): Promise<number | null> {
	await ensureTeamSchema(db);
	const row = await queryOne<{ credits: number }>(
		db,
		`SELECT credits FROM teams WHERE id = ? LIMIT 1`,
		[teamId],
	);
	if (!row) return null;
	return typeof row.credits === "number" && Number.isFinite(row.credits)
		? Math.trunc(row.credits)
		: 0;
}

export async function findUserIdByLogin(
	db: D1Database,
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

