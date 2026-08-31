import type { PrismaClient } from "../../types";
import { execute, executeWithChanges, queryAll, queryOne } from "../../db/db";
import {
	chargeTeamCreditBatches,
	deductReservedTeamCreditBatches,
	expireTeamCreditBatches,
	grantTeamCredits,
	increaseReservedTeamCreditBatches,
	releaseReservedTeamCreditBatches,
	reserveTeamCreditBatches,
	reserveTeamCreditBatchesUpToAvailable,
	type CreditReservationAttempt,
} from "./team-credit-batch.service";

export type TeamRow = {
	id: string;
	name: string;
	credits: number;
	credits_frozen: number;
	max_members?: number | null;
	created_at: string;
	updated_at: string;
};

export type TeamListRow = TeamRow & {
	member_count: number;
};

export type TeamProjectShareRow = {
	project_id: string;
	team_id: string;
	access: string;
	shared_by_user_id: string;
	created_at: string;
	updated_at: string;
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
	| "checkin"
	| "reserve"
	| "deduct"
	| "release"
	| "expire"
	| "migration"
	| "membership_expire"
	| "referral_bonus"
	| "referral_welcome";

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
let schemaEnsurePromise: Promise<void> | null = null;

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

async function hasTeamCreditLedgerColumn(
	db: PrismaClient,
	column: string,
): Promise<boolean> {
	const rows = await queryAll<{ name: string }>(db, `PRAGMA table_info(team_credit_ledger)`);
	return rows.some((row) => row.name === column);
}

async function hasTable(db: PrismaClient, tableName: string): Promise<boolean> {
	const rows = await queryAll<{ name: string }>(
		db,
		`SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
		[tableName],
	);
	return rows.length > 0;
}

async function ensureTeamSchemaInternal(db: PrismaClient): Promise<void> {
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

	const hasMaxMembers = await hasTeamsColumn(db, "max_members");
	if (!hasMaxMembers) {
		await execute(
			db,
			`ALTER TABLE teams ADD COLUMN max_members INTEGER NOT NULL DEFAULT 1`,
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

	// Multi-team mode: allow users to join multiple teams.
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_team_memberships_user_id
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
      api_key_id TEXT,
      UNIQUE (team_id, entry_type, task_id),
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (actor_user_id) REFERENCES users(id)
    )`,
	);

	// Backward compatible: DBs created before per-API-key billing attribution lack `api_key_id`.
	// The reserve/settle INSERTs write it, so add it at runtime — otherwise every credit reserve fails
	// with Postgres 42703 (column "api_key_id" does not exist) and users can't generate anything.
	const hasLedgerApiKeyId = await hasTeamCreditLedgerColumn(db, "api_key_id");
	if (!hasLedgerApiKeyId) {
		await execute(db, `ALTER TABLE team_credit_ledger ADD COLUMN api_key_id TEXT`);
	}

	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_team_credit_ledger_team_created_at
     ON team_credit_ledger(team_id, created_at)`,
	);

	// Mirrors the Prisma schema index (idx_team_credit_ledger_api_key_created); used by per-API-key
	// usage aggregation. IF NOT EXISTS keeps it idempotent across restarts.
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_team_credit_ledger_api_key_created
     ON team_credit_ledger(api_key_id, created_at)`,
	);

	// Credit-batch tables and their legacy cutover are migration-owned. Runtime
	// requests only verify invariants; they never create schema or replay history.
	const balanceMismatch = await queryOne<{
		team_id: string;
		credits: number;
		credits_frozen: number;
		batch_remaining: number;
		batch_reserved: number;
	}>(
		db,
		`SELECT t.id AS team_id, t.credits, t.credits_frozen,
            COALESCE(SUM(b.remaining_amount), 0) AS batch_remaining,
            COALESCE(SUM(b.reserved_amount), 0) AS batch_reserved
     FROM teams t
     LEFT JOIN team_credit_batches b ON b.team_id = t.id
     GROUP BY t.id, t.credits, t.credits_frozen
     HAVING t.credits <> COALESCE(SUM(b.remaining_amount), 0)
         OR t.credits_frozen <> COALESCE(SUM(b.reserved_amount), 0)
     LIMIT 1`,
	);
	if (balanceMismatch) {
		console.error("[team-schema] credit batch invariant mismatch", {
			teamId: balanceMismatch.team_id,
			teamCredits: balanceMismatch.credits,
			teamCreditsFrozen: balanceMismatch.credits_frozen,
			batchRemaining: balanceMismatch.batch_remaining,
			batchReserved: balanceMismatch.batch_reserved,
			impact: "read_only_access_allowed; credit_transactions_remain_batch_locked",
		});
	}
	const reservationMismatch = await queryOne<{
		team_id: string;
		batch_reserved: number;
		allocated_reserved: number;
	}>(
		db,
		`SELECT reservation_totals.team_id,
		        reservation_totals.batch_reserved,
		        reservation_totals.allocated_reserved
		 FROM (
		   SELECT b.id AS batch_id, b.team_id, b.reserved_amount AS batch_reserved,
		    COALESCE(SUM(
		      CASE
		        WHEN ledger.entry_type = 'reserve' THEN allocation.amount
		        WHEN ledger.entry_type IN ('deduct', 'release')
		         AND EXISTS (
		           SELECT 1
		           FROM team_credit_ledger reserve_ledger
		           JOIN team_credit_allocations reserve_allocation
		             ON reserve_allocation.ledger_entry_id = reserve_ledger.id
		            AND reserve_allocation.batch_id = allocation.batch_id
		           WHERE reserve_ledger.team_id = ledger.team_id
		             AND reserve_ledger.entry_type = 'reserve'
		             AND reserve_ledger.task_id = ledger.task_id
		         ) THEN -allocation.amount
		        ELSE 0
		      END
		    ), 0) AS allocated_reserved
		   FROM team_credit_batches b
		   LEFT JOIN team_credit_allocations allocation
		     ON allocation.batch_id = b.id
		   LEFT JOIN team_credit_ledger ledger
		     ON ledger.id = allocation.ledger_entry_id
		   GROUP BY b.id, b.team_id, b.reserved_amount
		 ) reservation_totals
		 WHERE reservation_totals.batch_reserved <> reservation_totals.allocated_reserved
     LIMIT 1`,
	);
	if (reservationMismatch) {
		console.error("[team-schema] credit reservation invariant mismatch", {
			teamId: reservationMismatch.team_id,
			batchReserved: reservationMismatch.batch_reserved,
			allocatedReserved: reservationMismatch.allocated_reserved,
			impact: "read_only_access_allowed; credit_transactions_remain_batch_locked",
		});
	}

	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS team_project_shares (
      project_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      access TEXT NOT NULL DEFAULT 'edit',
      shared_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, team_id),
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (shared_by_user_id) REFERENCES users(id)
    )`,
	);

	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_team_project_shares_team
     ON team_project_shares(team_id, updated_at)`,
	);
}

/**
 * Ensure the team tables exist once per API process.
 *
 * Historical credit invariant checks are diagnostics, not schema prerequisites:
 * a stale reservation must not make unrelated project/chapter reads return 500.
 * Credit mutations still validate the locked batch totals and database trigger
 * constraints in the credit-batch service.
 */
export async function ensureTeamSchema(db: PrismaClient): Promise<void> {
	if (schemaEnsured) return;
	if (!schemaEnsurePromise) {
		schemaEnsurePromise = ensureTeamSchemaInternal(db).then(
			() => {
				schemaEnsured = true;
			},
			(error: unknown) => {
				schemaEnsurePromise = null;
				throw error;
			},
		);
	}
	await schemaEnsurePromise;
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
	input: { id: string; name: string; nowIso: string; maxMembers?: number },
): Promise<TeamRow> {
	await ensureTeamSchema(db);
	const name = normalizeTeamName(input.name);
	const maxMembers = Math.max(1, Math.floor(Number(input.maxMembers ?? 1) || 1));
	await execute(
		db,
		`INSERT INTO teams (id, name, credits, credits_frozen, max_members, created_at, updated_at)
     VALUES (?, ?, 0, 0, ?, ?, ?)`,
		[input.id, name, maxMembers, input.nowIso, input.nowIso],
	);
	const row = await queryOne<TeamRow>(
		db,
		`SELECT id, name, credits, credits_frozen, max_members, created_at, updated_at FROM teams WHERE id = ? LIMIT 1`,
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

export async function listTeamMembershipsByUserId(
	db: PrismaClient,
	userId: string,
): Promise<TeamMembershipRow[]> {
	await ensureTeamSchema(db);
	return queryAll<TeamMembershipRow>(
		db,
		`SELECT team_id, user_id, role, created_at, updated_at
     FROM team_memberships
     WHERE user_id = ?
     ORDER BY created_at ASC`,
		[userId],
	);
}

export async function getTeamMembershipForUserInTeam(
	db: PrismaClient,
	userId: string,
	teamId: string,
): Promise<TeamMembershipRow | null> {
	await ensureTeamSchema(db);
	return queryOne<TeamMembershipRow>(
		db,
		`SELECT team_id, user_id, role, created_at, updated_at
     FROM team_memberships
     WHERE user_id = ? AND team_id = ?
     LIMIT 1`,
		[userId, teamId],
	);
}

export async function getTeamById(
	db: PrismaClient,
	teamId: string,
): Promise<TeamRow | null> {
	await ensureTeamSchema(db);
	return queryOne<TeamRow>(
		db,
		`SELECT id, name, credits, credits_frozen, max_members, created_at, updated_at
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
    SELECT t.id, t.name, t.credits, t.credits_frozen, t.max_members, t.created_at, t.updated_at,
           COUNT(m.user_id) AS member_count
    FROM teams t
    LEFT JOIN team_memberships m ON m.team_id = t.id
    GROUP BY t.id
    ORDER BY t.created_at DESC
  `,
	);
}

export async function countTeamMembers(
	db: PrismaClient,
	teamId: string,
): Promise<number> {
	await ensureTeamSchema(db);
	const row = await queryOne<{ count: number }>(
		db,
		`SELECT COUNT(*) AS count FROM team_memberships WHERE team_id = ?`,
		[teamId],
	);
	return Number(row?.count ?? 0) || 0;
}

export async function sumTeamTopupCredits(
	db: PrismaClient,
	teamId: string,
): Promise<number> {
	await ensureTeamSchema(db);
	const row = await queryOne<{ total: number | null }>(
		db,
		`SELECT COALESCE(SUM(amount), 0) AS total
     FROM team_credit_ledger
     WHERE team_id = ? AND entry_type IN ('topup', 'referral_bonus', 'referral_welcome')`,
		[teamId],
	);
	return Number(row?.total ?? 0) || 0;
}

export async function updateTeamMaxMembers(
	db: PrismaClient,
	input: { teamId: string; maxMembers: number; nowIso: string },
): Promise<TeamRow | null> {
	await ensureTeamSchema(db);
	const maxMembers = Math.max(1, Math.floor(Number(input.maxMembers) || 1));
	await execute(
		db,
		`UPDATE teams SET max_members = ?, updated_at = ?
     WHERE id = ? AND max_members < ?`,
		[maxMembers, input.nowIso, input.teamId, maxMembers],
	);
	return getTeamById(db, input.teamId);
}

export async function upsertTeamProjectShare(
	db: PrismaClient,
	input: {
		projectId: string;
		teamId: string;
		access: "edit";
		sharedByUserId: string;
		nowIso: string;
	},
): Promise<TeamProjectShareRow> {
	await ensureTeamSchema(db);
	await execute(
		db,
		`INSERT INTO team_project_shares
       (project_id, team_id, access, shared_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id, team_id) DO UPDATE SET
         access = EXCLUDED.access,
         shared_by_user_id = EXCLUDED.shared_by_user_id,
         updated_at = EXCLUDED.updated_at`,
		[
			input.projectId,
			input.teamId,
			input.access,
			input.sharedByUserId,
			input.nowIso,
			input.nowIso,
		],
	);
	const row = await queryOne<TeamProjectShareRow>(
		db,
		`SELECT project_id, team_id, access, shared_by_user_id, created_at, updated_at
     FROM team_project_shares
     WHERE project_id = ? AND team_id = ?
     LIMIT 1`,
		[input.projectId, input.teamId],
	);
	if (!row) throw new Error("share project failed");
	return row;
}

export async function deleteTeamProjectShare(
	db: PrismaClient,
	input: { projectId: string; teamId: string },
): Promise<void> {
	await ensureTeamSchema(db);
	await execute(
		db,
		`DELETE FROM team_project_shares WHERE project_id = ? AND team_id = ?`,
		[input.projectId, input.teamId],
	);
}

export async function getTeamProjectShareForUser(
	db: PrismaClient,
	input: { projectId: string; userId: string },
): Promise<TeamProjectShareRow | null> {
	await ensureTeamSchema(db);
	if (!(await hasTable(db, "team_project_shares"))) return null;
	return queryOne<TeamProjectShareRow>(
		db,
		`SELECT s.project_id, s.team_id, s.access, s.shared_by_user_id, s.created_at, s.updated_at
     FROM team_project_shares s
     JOIN team_memberships m ON m.team_id = s.team_id
     WHERE s.project_id = ? AND m.user_id = ?
     LIMIT 1`,
		[input.projectId, input.userId],
	);
}

export async function listTeamProjectSharesForUser(
	db: PrismaClient,
	userId: string,
): Promise<TeamProjectShareRow[]> {
	await ensureTeamSchema(db);
	if (!(await hasTable(db, "team_project_shares"))) return [];
	return queryAll<TeamProjectShareRow>(
		db,
		`SELECT s.project_id, s.team_id, s.access, s.shared_by_user_id, s.created_at, s.updated_at
     FROM team_project_shares s
     JOIN team_memberships m ON m.team_id = s.team_id
     WHERE m.user_id = ?
     ORDER BY s.updated_at DESC`,
		[userId],
	);
}

export async function listTeamProjectSharesByTeam(
	db: PrismaClient,
	userId: string,
	teamId: string,
): Promise<TeamProjectShareRow[]> {
	await ensureTeamSchema(db);
	if (!(await hasTable(db, "team_project_shares"))) return [];
	return queryAll<TeamProjectShareRow>(
		db,
		`SELECT s.project_id, s.team_id, s.access, s.shared_by_user_id, s.created_at, s.updated_at
     FROM team_project_shares s
     JOIN team_memberships m ON m.team_id = s.team_id AND m.user_id = ?
     WHERE s.team_id = ?
     ORDER BY s.updated_at DESC`,
		[userId, teamId],
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
	if (v === "membership_expire") return "membership_expire";
	if (v === "referral_bonus") return "referral_bonus";
	if (v === "referral_welcome") return "referral_welcome";
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
		entryType?: TeamCreditLedgerEntryType;
		taskId?: string | null;
		taskKind?: string | null;
		sourceType?: string;
		sourceKey?: string;
		expiresAt?: string | null;
	},
): Promise<{ team: TeamRow; ledgerEntryId: string | null }> {
	await ensureTeamSchema(db);
	const amount = normalizePositiveInt(input.amount);
	if (amount <= 0) {
		const row = await getTeamById(db, input.teamId);
		if (!row) throw new Error("team not found");
		return { team: row, ledgerEntryId: null };
	}

	const result = await grantTeamCredits(db, {
		teamId: input.teamId,
		entryType: input.entryType ?? "topup",
		amount,
		taskId: input.taskId,
		taskKind: input.taskKind,
		actorUserId: input.actorUserId,
		note: input.note,
		nowIso: input.nowIso,
		sourceType: input.sourceType ?? "permanent_adjustment",
		sourceKey: input.sourceKey,
		expiresAt: input.expiresAt,
	});

	const row = await getTeamById(db, input.teamId);
	if (!row) throw new Error("team not found");
	return { team: row, ledgerEntryId: result.ledgerEntryId };
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

	const result = await chargeTeamCreditBatches(db, {
		teamId: input.teamId,
		entryType: "deduct",
		amount,
		actorUserId: input.actorUserId,
		note: input.note,
		nowIso: input.nowIso,
	});
	return { deducted: result.charged };
}

export async function listTeamCreditLedger(
	db: PrismaClient,
	teamId: string,
	opts?: {
		limit?: number;
		before?: string | null;
		beforeId?: string | null;
	},
): Promise<TeamCreditLedgerRow[]> {
	await ensureTeamSchema(db);
	const limit = Math.max(1, Math.min(51, Math.floor(opts?.limit ?? 20)));
	const before =
		typeof opts?.before === "string" && opts.before.trim()
			? opts.before.trim()
			: null;
	const beforeId =
		typeof opts?.beforeId === "string" && opts.beforeId.trim()
			? opts.beforeId.trim()
			: null;
	const params: Array<string | number> = [teamId];
	const whereClauses = [`team_id = ?`];
	if (before && beforeId) {
		whereClauses.push(`(created_at < ? OR (created_at = ? AND id < ?))`);
		params.push(before, before, beforeId);
	} else if (before) {
		whereClauses.push(`created_at < ?`);
		params.push(before);
	}
	return queryAll<TeamCreditLedgerRow>(
		db,
		`SELECT id, team_id, entry_type, amount, task_id, task_kind, actor_user_id, note, created_at
     FROM team_credit_ledger
     WHERE ${whereClauses.join(" AND ")}
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
		[...params, limit],
	);
}

export async function listTeamCreditLedgerByActorUserId(
	db: PrismaClient,
	teamId: string,
	actorUserId: string,
	opts?: {
		limit?: number;
		before?: string | null;
		beforeId?: string | null;
	},
): Promise<TeamCreditLedgerRow[]> {
	await ensureTeamSchema(db);
	const limit = Math.max(1, Math.min(51, Math.floor(opts?.limit ?? 20)));
	const before =
		typeof opts?.before === "string" && opts.before.trim()
			? opts.before.trim()
			: null;
	const beforeId =
		typeof opts?.beforeId === "string" && opts.beforeId.trim()
			? opts.beforeId.trim()
			: null;
	const params: Array<string | number> = [teamId, actorUserId];
	const whereClauses = [`team_id = ?`, `actor_user_id = ?`];
	if (before && beforeId) {
		whereClauses.push(`(created_at < ? OR (created_at = ? AND id < ?))`);
		params.push(before, before, beforeId);
	} else if (before) {
		whereClauses.push(`created_at < ?`);
		params.push(before);
	}
	return queryAll<TeamCreditLedgerRow>(
		db,
		`SELECT id, team_id, entry_type, amount, task_id, task_kind, actor_user_id, note, created_at
     FROM team_credit_ledger
     WHERE ${whereClauses.join(" AND ")}
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
		[...params, limit],
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
	await expireTeamCreditBatches(db, { teamId, nowIso: new Date().toISOString() });
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
		apiKeyId?: string | null;
	},
): Promise<{ charged: boolean }> {
	await ensureTeamSchema(db);
	const amount = normalizePositiveInt(input.amount);
	const taskId = (input.taskId || "").trim();
	if (amount <= 0 || !taskId) return { charged: false };

	const result = await chargeTeamCreditBatches(db, {
		teamId: input.teamId,
		entryType: "deduct",
		amount,
		taskId,
		taskKind: input.taskKind,
		actorUserId: input.actorUserId,
		note: input.note,
		nowIso: input.nowIso,
		apiKeyId: input.apiKeyId,
	});
	return { charged: result.charged };
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
		apiKeyId?: string | null;
	},
): Promise<{ reserved: boolean }> {
	await ensureTeamSchema(db);
	const amount = normalizePositiveInt(input.amount);
	const taskId = (input.taskId || "").trim();
	if (amount <= 0 || !taskId) return { reserved: false };

	// 在 reserve 行落 caller api_key_id：异步结算(finalizer)读回它做精确归因，
	// 避免视频等异步消耗全被记到 internal-finalizer sentinel。
	const reserved = await reserveTeamCreditBatches(db, {
		teamId: input.teamId,
		amount,
		taskId,
		taskKind: input.taskKind,
		actorUserId: input.actorUserId,
		note: input.note,
		nowIso: input.nowIso,
		apiKeyId: input.apiKeyId,
	});
	return { reserved };
}

export async function tryReserveTeamCreditsUpToAvailableOnce(
	db: PrismaClient,
	input: {
		teamId: string;
		targetAmount: number;
		minimumAmount: number;
		taskId: string;
		taskKind?: string | null;
		actorUserId: string;
		note?: string | null;
		nowIso: string;
		apiKeyId?: string | null;
		allowExistingReservation?: boolean;
	},
): Promise<CreditReservationAttempt> {
	await ensureTeamSchema(db);
	const targetAmount = normalizePositiveInt(input.targetAmount);
	const minimumAmount = normalizePositiveInt(input.minimumAmount);
	const taskId = (input.taskId || "").trim();
	if (targetAmount <= 0 || minimumAmount <= 0 || !taskId) {
		throw new Error("credit reservation requires positive amounts and a taskId");
	}
	return reserveTeamCreditBatchesUpToAvailable(db, {
		teamId: input.teamId,
		amount: targetAmount,
		minimumAmount,
		taskId,
		taskKind: input.taskKind,
		actorUserId: input.actorUserId,
		note: input.note,
		nowIso: input.nowIso,
		apiKeyId: input.apiKeyId,
		allowExistingReservation: input.allowExistingReservation,
	});
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
		apiKeyId?: string | null;
	},
): Promise<{ deducted: boolean }> {
	await ensureTeamSchema(db);
	const amount = normalizePositiveInt(input.amount);
	const taskId = (input.taskId || "").trim();
	if (amount <= 0 || !taskId) return { deducted: false };

	const deducted = await deductReservedTeamCreditBatches(db, {
		teamId: input.teamId,
		amount,
		taskId,
		taskKind: input.taskKind,
		actorUserId: input.actorUserId,
		note: input.note,
		nowIso: input.nowIso,
		apiKeyId: input.apiKeyId,
	});
	return { deducted };
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

	const released = await releaseReservedTeamCreditBatches(db, {
		teamId: input.teamId,
		amount,
		taskId,
		taskKind: input.taskKind,
		actorUserId: input.actorUserId,
		note: input.note,
		nowIso: input.nowIso,
	});
	return { released };
}

export async function findDanglingChatReservations(
	db: PrismaClient,
	input: { olderThanIso: string; limit: number },
): Promise<Array<{
	teamId: string;
	taskId: string;
	taskKind: string;
	amount: number;
	actorUserId: string | null;
}>> {
	await ensureTeamSchema(db);
	const limit = Math.max(1, Math.floor(input.limit));
	const rows = await queryAll<{
		team_id: string;
		task_id: string;
		task_kind: string;
		amount: number;
		actor_user_id: string | null;
	}>(
		db,
		`SELECT dangling.team_id, dangling.task_id, dangling.task_kind,
       dangling.actor_user_id, dangling.pending_amount AS amount
     FROM (
       SELECT r.team_id, r.task_id, r.task_kind, r.actor_user_id,
              COALESCE((
                SELECT SUM(reserve_allocation.amount)
                FROM team_credit_allocations reserve_allocation
                WHERE reserve_allocation.ledger_entry_id = r.id
              ), 0) - COALESCE((
                SELECT SUM(settlement_allocation.amount)
                FROM team_credit_allocations settlement_allocation
                JOIN team_credit_ledger settlement_ledger
                  ON settlement_ledger.id = settlement_allocation.ledger_entry_id
                WHERE settlement_ledger.team_id = r.team_id
                  AND settlement_ledger.task_id = r.task_id
                  AND settlement_ledger.entry_type IN ('deduct', 'release')
                  AND EXISTS (
                    SELECT 1
                    FROM team_credit_allocations reserve_batch
                    WHERE reserve_batch.ledger_entry_id = r.id
                      AND reserve_batch.batch_id = settlement_allocation.batch_id
                  )
              ), 0) AS pending_amount,
              r.created_at
       FROM team_credit_ledger r
       WHERE r.entry_type = 'reserve'
         AND r.task_kind IN ('agents_chat', 'chat')
         AND r.created_at < ?
     ) dangling
     WHERE dangling.pending_amount > 0
     ORDER BY dangling.created_at ASC
     LIMIT ?`,
		[input.olderThanIso, limit],
	);
	return rows.map((row) => ({
		teamId: String(row.team_id),
		taskId: String(row.task_id),
		taskKind: String(row.task_kind || "agents_chat"),
		amount: Number(row.amount) || 0,
		actorUserId: row.actor_user_id ?? null,
	}));
}

/**
 * Atomically moves the complete reservation lifecycle onto the provider task
 * identity. A release/deduct can race the provider-id binding; moving only the
 * reserve row would split one accounting lifecycle across two task ids and
 * make the batch reservation projection inconsistent.
 */
export async function rebindTeamCreditReservationTaskId(
	db: PrismaClient,
	input: {
		teamId: string;
		fromTaskId: string;
		toTaskId: string;
	},
): Promise<{ ok: boolean }> {
	await ensureTeamSchema(db);
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
		 WHERE team_id = ?
		   AND task_id = ?
		   AND entry_type IN ('reserve', 'deduct', 'release')`,
				[toTaskId, input.teamId, fromTaskId],
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

	const increased = await increaseReservedTeamCreditBatches(db, {
		teamId: input.teamId,
		taskId,
		expectedReserved,
		delta,
		nowIso: input.nowIso,
	});
	return { increased };
}

export async function updateTeamName(
	db: PrismaClient,
	input: { teamId: string; name: string; nowIso: string },
): Promise<void> {
	await ensureTeamSchema(db);
	const name = normalizeTeamName(input.name);
	await execute(
		db,
		`UPDATE teams SET name = ?, updated_at = ? WHERE id = ?`,
		[name, input.nowIso, input.teamId],
	);
}

export async function removeTeamMember(
	db: PrismaClient,
	input: { teamId: string; userId: string },
): Promise<void> {
	await ensureTeamSchema(db);
	await execute(
		db,
		`DELETE FROM team_memberships WHERE team_id = ? AND user_id = ?`,
		[input.teamId, input.userId],
	);
}

export async function deleteTeamById(
	db: PrismaClient,
	teamId: string,
): Promise<void> {
	await ensureTeamSchema(db);
	// Remove related data in dependency order
	await execute(db, `DELETE FROM team_plan_subscriptions WHERE team_id = ?`, [teamId]);
	await execute(db, `DELETE FROM team_project_shares WHERE team_id = ?`, [teamId]);
	await execute(db, `DELETE FROM team_credit_ledger WHERE team_id = ?`, [teamId]);
	await execute(db, `DELETE FROM team_invites WHERE team_id = ?`, [teamId]);
	await execute(db, `DELETE FROM team_memberships WHERE team_id = ?`, [teamId]);
	await execute(db, `DELETE FROM teams WHERE id = ?`, [teamId]);
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
