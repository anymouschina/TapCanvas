import { Prisma } from "@prisma/client";
import { getPrismaClient } from "../../platform/node/prisma";

export type AccountCreditRow = {
	id: string;
	team_id: string;
	entry_type: string;
	amount: number;
	task_id: string | null;
	task_kind: string | null;
	actor_user_id: string | null;
	note: string | null;
	created_at: string;
	credits_after: number;
	credits_frozen_after: number;
	credits_available_after: number;
	settles_reservation: boolean;
};

export async function getAccountProfileRow(userId: string) {
	const [user, profile] = await Promise.all([
		getPrismaClient().users.findUnique({
			where: { id: userId },
			select: {
			id: true,
			login: true,
			name: true,
			avatar_url: true,
			email: true,
			phone: true,
			guest: true,
			created_at: true,
			},
		}),
		getPrismaClient().user_profiles.findUnique({ where: { user_id: userId } }),
	]);
	return user ? { ...user, user_profiles: profile } : null;
}

export async function listOwnedPublishedWorkRows(userId: string, cursor: string | undefined, limit: number) {
	return getPrismaClient().assets.findMany({
		where: {
			owner_id: userId,
			AND: [
				{ data: { contains: '"kind":"publishRecord"' } },
				{ data: { contains: '"videoUrl":"http' } },
			],
		},
		orderBy: [{ created_at: "desc" }, { id: "desc" }],
		take: limit + 1,
		...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
		select: {
			id: true,
			name: true,
			data: true,
		},
	});
}

export async function findOwnedPublishedWorkRow(userId: string, workId: string) {
	return getPrismaClient().assets.findFirst({
		where: {
			id: workId,
			owner_id: userId,
			data: { contains: '"kind":"publishRecord"' },
		},
		select: { id: true, name: true, data: true },
	});
}

export async function updateOwnedPublishedWorkData(userId: string, workId: string, data: string) {
	const result = await getPrismaClient().assets.updateMany({
		where: { id: workId, owner_id: userId, data: { contains: '"kind":"publishRecord"' } },
		data: { data, updated_at: new Date().toISOString() },
	});
	return result.count === 1;
}

export async function deleteOwnedPublishedWorkRow(userId: string, workId: string) {
	const result = await getPrismaClient().assets.deleteMany({
		where: { id: workId, owner_id: userId, data: { contains: '"kind":"publishRecord"' } },
	});
	return result.count === 1;
}

export async function listLikedProjectRows(userId: string, cursor: string | undefined, limit: number) {
	const likes = await getPrismaClient().project_likes.findMany({
		where: { user_id: userId },
		orderBy: [{ created_at: "desc" }, { id: "desc" }],
		take: limit + 1,
		...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
	});
	const projects = await getPrismaClient().projects.findMany({
		where: { id: { in: likes.map((item) => item.project_id) } },
		select: {
			id: true,
			name: true,
			description: true,
			cover_url: true,
			is_public: true,
			published_at: true,
			like_count: true,
			view_count: true,
			updated_at: true,
			users: { select: { login: true, name: true, avatar_url: true } },
		},
	});
	const byId = new Map(projects.map((project) => [project.id, project]));
	return likes.map((like) => ({ like, project: byId.get(like.project_id) ?? null }));
}

export async function listNotificationRows(
	userId: string,
	filter: "all" | "unread" | "read",
	cursor: string | undefined,
	limit: number,
) {
	return getPrismaClient().user_notifications.findMany({
		where: {
			user_id: userId,
			...(filter === "unread" ? { read_at: null } : {}),
			...(filter === "read" ? { read_at: { not: null } } : {}),
		},
		orderBy: [{ created_at: "desc" }, { id: "desc" }],
		take: limit + 1,
		...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
	});
}

export async function listCreditRows(teamId: string, cursor: string | undefined, limit: number) {
	const normalizedCursor = cursor?.trim() || null;
	const cursorFilter = normalizedCursor
		? Prisma.sql`
			WHERE (states.created_at, states.id) < (
				SELECT cursor_row.created_at, cursor_row.id
				FROM team_credit_ledger cursor_row
				WHERE cursor_row.team_id = ${teamId} AND cursor_row.id = ${normalizedCursor}
			)`
		: Prisma.empty;

	return getPrismaClient().$queryRaw<AccountCreditRow[]>(Prisma.sql`
		WITH allocation_totals AS (
			SELECT
				ledger.id AS ledger_id,
				COALESCE(SUM(allocation.expired_amount), 0)::integer AS expired_amount
			FROM team_credit_ledger ledger
			LEFT JOIN team_credit_allocations allocation
				ON allocation.ledger_entry_id = ledger.id
			WHERE ledger.team_id = ${teamId}
			GROUP BY ledger.id
		), ledger_facts AS (
			SELECT
				ledger.*,
				allocation_totals.expired_amount,
				ledger.entry_type IN ('deduct', 'release') AND EXISTS (
					SELECT 1
					FROM team_credit_ledger reserve_ledger
					JOIN team_credit_allocations reserve_allocation
						ON reserve_allocation.ledger_entry_id = reserve_ledger.id
					JOIN team_credit_allocations settlement_allocation
						ON settlement_allocation.ledger_entry_id = ledger.id
						AND settlement_allocation.batch_id = reserve_allocation.batch_id
					WHERE reserve_ledger.team_id = ledger.team_id
						AND reserve_ledger.entry_type = 'reserve'
						AND reserve_ledger.task_id = ledger.task_id
				) AS settles_reservation
			FROM team_credit_ledger ledger
			JOIN allocation_totals ON allocation_totals.ledger_id = ledger.id
			WHERE ledger.team_id = ${teamId}
		), ledger_events AS (
			SELECT
				ledger_facts.*,
				CASE
					WHEN ledger_facts.entry_type IN ('deduct', 'expire') THEN -ledger_facts.amount
					WHEN ledger_facts.entry_type = 'release' THEN -ledger_facts.expired_amount
					WHEN ledger_facts.entry_type = 'reserve' THEN 0
					ELSE ledger_facts.amount
				END AS credits_delta,
				CASE
					WHEN ledger_facts.entry_type = 'reserve' THEN ledger_facts.amount
					WHEN ledger_facts.entry_type IN ('deduct', 'release')
						AND ledger_facts.settles_reservation THEN -ledger_facts.amount
					ELSE 0
				END AS frozen_delta
			FROM ledger_facts
		), states AS (
			SELECT
				ledger_events.*,
				(
					team.credits - COALESCE(
						SUM(ledger_events.credits_delta) OVER (
							ORDER BY ledger_events.created_at DESC, ledger_events.id DESC
							ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
						),
						0
					)
				)::integer AS credits_after,
				(
					team.credits_frozen - COALESCE(
						SUM(ledger_events.frozen_delta) OVER (
							ORDER BY ledger_events.created_at DESC, ledger_events.id DESC
							ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
						),
						0
					)
				)::integer AS credits_frozen_after
			FROM ledger_events
			JOIN teams team ON team.id = ledger_events.team_id
		)
		SELECT
			states.id,
			states.team_id,
			states.entry_type,
			states.amount,
			states.task_id,
			states.task_kind,
			states.actor_user_id,
			states.note,
			states.created_at,
			states.credits_after,
			states.credits_frozen_after,
			(states.credits_after - states.credits_frozen_after)::integer AS credits_available_after,
			states.settles_reservation
		FROM states
		${cursorFilter}
		ORDER BY states.created_at DESC, states.id DESC
		LIMIT ${limit + 1}
	`);
}
