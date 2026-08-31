import { Prisma } from "@prisma/client";
import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { getPrismaClient } from "../../platform/node/prisma";
import { getMyTeam } from "../team/team.service";
import { listProductsForCatalog } from "../product/product.service";
import type { AccountSettings } from "./account.schemas";
import { readAccountSettings, resolveConfiguredPlatformOwnerId } from "./account.settings";
import {
	getAccountProfileRow,
	findOwnedPublishedWorkRow,
	listCreditRows,
	listLikedProjectRows,
	listNotificationRows,
	listOwnedPublishedWorkRows,
	updateOwnedPublishedWorkData,
	deleteOwnedPublishedWorkRow,
} from "./account.repo";
import { grantTeamCreditsInTransaction } from "../team/team-credit-batch.service";

function requireMember(auth: unknown): void {
	if (auth && typeof auth === "object" && "guest" in auth && auth.guest === true) {
		throw new AppError("游客账号不能使用账户中心会员能力", { status: 403, code: "guest_account_restricted" });
	}
}

function pageResult<T>(rows: T[], limit: number, cursorOf: (row: T) => string) {
	const hasMore = rows.length > limit;
	const items = hasMore ? rows.slice(0, limit) : rows;
	return { items, nextCursor: hasMore && items.length > 0 ? cursorOf(items[items.length - 1]) : null };
}

function shanghaiDate(date: Date): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
	if (!raw) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error: unknown) {
		throw new AppError("站内消息元数据损坏", {
			status: 500,
			code: "notification_metadata_invalid_json",
			details: error instanceof Error ? error.message : String(error),
		});
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new AppError("站内消息元数据必须是对象", {
			status: 500,
			code: "notification_metadata_invalid",
		});
	}
	return parsed as Record<string, unknown>;
}

async function personalTeam(c: AppContext, userId: string) {
	const result = await getMyTeam(c, userId, "personal");
	if (!result) {
		throw new AppError("个人计费账户不存在", { status: 409, code: "personal_billing_team_missing" });
	}
	return result.team;
}

async function resolveMembershipPlanName(planCode: string): Promise<string> {
	const [namespace, productId, skuId, ...extra] = planCode.split(":");
	if (namespace !== "membership" || !productId || !skuId || extra.length > 0) {
		throw new AppError("会员订阅套餐标识无效", {
			status: 500,
			code: "membership_plan_code_invalid",
			details: { planCode },
		});
	}
	const product = await getPrismaClient().products.findUnique({
		where: { id: productId },
		select: { title: true },
	});
	const title = product?.title.trim();
	if (!title) {
		throw new AppError("会员订阅对应的套餐商品不存在", {
			status: 500,
			code: "membership_plan_product_missing",
			details: { planCode, productId },
		});
	}
	return title;
}

export async function getProfile(userId: string) {
	const row = await getAccountProfileRow(userId);
	if (!row) throw new AppError("用户不存在", { status: 404, code: "user_not_found" });
	return {
		id: row.id,
		login: row.login,
		name: row.name || row.login,
		avatarUrl: row.avatar_url,
		bio: row.user_profiles?.bio ?? null,
		email: row.email,
		phone: row.phone,
		guest: row.guest !== 0,
		createdAt: row.created_at,
	};
}

export async function updateProfile(
	userId: string,
	input: { name?: string; bio?: string | null; avatarUrl?: string | null },
) {
	const nowIso = new Date().toISOString();
	await getPrismaClient().$transaction(async (tx) => {
		if (input.name !== undefined || input.avatarUrl !== undefined) {
			await tx.users.update({
				where: { id: userId },
				data: {
					...(input.name !== undefined ? { name: input.name } : {}),
					...(input.avatarUrl !== undefined ? { avatar_url: input.avatarUrl } : {}),
					updated_at: nowIso,
				},
			});
		}
		if (input.bio !== undefined) {
			await tx.user_profiles.upsert({
				where: { user_id: userId },
				create: {
					user_id: userId,
					bio: input.bio,
					created_at: nowIso,
					updated_at: nowIso,
				},
				update: { bio: input.bio, updated_at: nowIso },
			});
		}
	});
	return getProfile(userId);
}

function mapProject(project: {
	id: string;
	name: string;
	description: string | null;
	cover_url: string | null;
	is_public: number;
	published_at: string | null;
	like_count: number;
	view_count: number;
	updated_at: string;
}) {
	return {
		id: project.id,
		name: project.name,
		description: project.description,
		coverUrl: project.cover_url,
		isPublic: project.is_public !== 0,
		publishedAt: project.published_at,
		likeCount: project.like_count,
		viewCount: project.view_count,
		updatedAt: project.updated_at,
	};
}

export async function listWorks(userId: string, cursor: string | undefined, limit: number) {
	const rows = await listOwnedPublishedWorkRows(userId, cursor, limit);
	const page = pageResult(rows, limit, (row) => row.id);
	return {
		...page,
		items: page.items.map((row) => {
			let parsed: unknown;
			try {
				parsed = row.data ? JSON.parse(row.data) : null;
			} catch (error: unknown) {
				throw new AppError("已发布作品数据损坏", {
					status: 500,
					code: "published_work_invalid_json",
					details: { workId: row.id, reason: error instanceof Error ? error.message : String(error) },
				});
			}
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new AppError("已发布作品数据格式无效", {
					status: 500,
					code: "published_work_invalid",
					details: { workId: row.id },
				});
			}
			const data = parsed as Record<string, unknown>;
			const kind = typeof data.kind === "string" ? data.kind.trim() : "";
			const title = typeof data.title === "string" ? data.title.trim() : "";
			const videoUrl = typeof data.videoUrl === "string" ? data.videoUrl.trim() : "";
			const publishedAt = typeof data.publishedAt === "string" ? data.publishedAt.trim() : "";
			if (kind !== "publishRecord" || !title || !videoUrl || !publishedAt) {
				throw new AppError("已发布作品缺少必要字段", {
					status: 500,
					code: "published_work_incomplete",
					details: { workId: row.id },
				});
			}
			return {
				id: row.id,
				title,
				description: typeof data.description === "string" ? data.description.trim() || null : null,
				videoUrl,
				coverImageUrl: typeof data.coverImageUrl === "string" ? data.coverImageUrl.trim() || null : null,
				publishedAt,
				published: data.publicationStatus !== "unpublished",
				sourceProjectId: typeof data.sourceProjectId === "string" ? data.sourceProjectId.trim() || null : null,
				sourceProjectName: typeof data.sourceProjectName === "string" ? data.sourceProjectName.trim() || null : null,
				sourceOwnerType:
					data.ownerType === "project" || data.ownerType === "chapter" || data.ownerType === "shortFilm"
						? data.ownerType
						: null,
				sourceOwnerId: typeof data.ownerId === "string" ? data.ownerId.trim() || null : null,
				sourceChapterTitle: typeof data.sourceChapterTitle === "string" ? data.sourceChapterTitle.trim() || null : null,
			};
		}),
	};
}

function parseOwnedPublishRecord(dataRaw: string | null, workId: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = dataRaw ? JSON.parse(dataRaw) : null;
	} catch (error: unknown) {
		throw new AppError("已发布作品数据损坏", { status: 500, code: "published_work_invalid_json", details: { workId, reason: error instanceof Error ? error.message : String(error) } });
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || (parsed as Record<string, unknown>).kind !== "publishRecord") {
		throw new AppError("作品不存在或无权管理", { status: 404, code: "published_work_not_found", details: { workId } });
	}
	return parsed as Record<string, unknown>;
}

export async function updateWorkPublication(userId: string, workId: string, published: boolean) {
	const row = await findOwnedPublishedWorkRow(userId, workId);
	if (!row) throw new AppError("作品不存在或无权管理", { status: 404, code: "published_work_not_found", details: { workId } });
	const data = parseOwnedPublishRecord(row.data, workId);
	data.publicationStatus = published ? "published" : "unpublished";
	data.publicationUpdatedAt = new Date().toISOString();
	if (!await updateOwnedPublishedWorkData(userId, workId, JSON.stringify(data))) {
		throw new AppError("作品状态更新冲突，请刷新后重试", { status: 409, code: "published_work_update_conflict", details: { workId } });
	}
	return { id: workId, published };
}

export async function deleteWork(userId: string, workId: string) {
	const row = await findOwnedPublishedWorkRow(userId, workId);
	if (!row) throw new AppError("作品不存在或无权管理", { status: 404, code: "published_work_not_found", details: { workId } });
	parseOwnedPublishRecord(row.data, workId);
	if (!await deleteOwnedPublishedWorkRow(userId, workId)) {
		throw new AppError("作品删除冲突，请刷新后重试", { status: 409, code: "published_work_delete_conflict", details: { workId } });
	}
	return { id: workId, deleted: true };
}

export async function listLikes(userId: string, cursor: string | undefined, limit: number) {
	const rows = await listLikedProjectRows(userId, cursor, limit);
	const page = pageResult(rows, limit, (row) => row.like.id);
	return {
		...page,
		items: page.items.map(({ like, project }) => {
			const available = Boolean(project && project.is_public !== 0 && project.published_at);
			return {
				likeId: like.id,
				likedAt: like.created_at,
				available,
				project: available && project
					? {
						...mapProject(project),
						owner: project.users
							? { login: project.users.login, name: project.users.name, avatarUrl: project.users.avatar_url }
							: null,
					}
					: null,
			};
		}),
	};
}

async function checkInState(c: AppContext, userId: string) {
	const config = await readAccountSettings(c);
	const today = shanghaiDate(new Date());
	const team = await personalTeam(c, userId);
	const taskId = `account-check-in:${userId}:${today}`;
	const [todayEntry, firstEntry, count] = await Promise.all([
		getPrismaClient().team_credit_ledger.findFirst({
			where: { team_id: team.id, entry_type: "checkin", task_id: taskId },
		}),
		getPrismaClient().team_credit_ledger.findFirst({
			where: { team_id: team.id, entry_type: "checkin" },
			orderBy: { created_at: "asc" },
		}),
		getPrismaClient().team_credit_ledger.count({ where: { team_id: team.id, entry_type: "checkin" } }),
	]);
	const firstDay = firstEntry ? shanghaiDate(new Date(firstEntry.created_at)) : null;
	const elapsedDays = firstDay
		? Math.max(1, Math.floor((Date.parse(`${today}T00:00:00+08:00`) - Date.parse(`${firstDay}T00:00:00+08:00`)) / 86_400_000) + 1)
		: 0;
	return {
		configured: config.configured,
		enabled: config.settings?.checkInEnabled === true,
		rewardCredits: config.settings?.checkInRewardCredits ?? null,
		today,
		checkedInToday: Boolean(todayEntry),
		cumulativeDays: count,
		missedDays: Math.max(0, elapsedDays - count),
		balance: team.credits,
		teamId: team.id,
		taskId,
	};
}

export async function getCheckIn(c: AppContext, userId: string, auth: unknown) {
	requireMember(auth);
	const state = await checkInState(c, userId);
	const { teamId: _teamId, taskId: _taskId, ...response } = state;
	return response;
}

export async function performCheckIn(c: AppContext, userId: string, auth: unknown) {
	requireMember(auth);
	const state = await checkInState(c, userId);
	if (!state.configured) {
		throw new AppError("后台尚未配置签到规则", { status: 409, code: "check_in_not_configured" });
	}
	if (!state.enabled || !state.rewardCredits) {
		throw new AppError("签到功能当前未开放", { status: 409, code: "check_in_disabled" });
	}
	const rewardCredits = state.rewardCredits;
	if (state.checkedInToday) return { ...await getCheckIn(c, userId, auth), awarded: false };
	const nowIso = new Date().toISOString();
	try {
		await getPrismaClient().$transaction(async (tx) => {
			await grantTeamCreditsInTransaction(tx, {
				teamId: state.teamId,
				entryType: "checkin",
				amount: rewardCredits,
				taskId: state.taskId,
				taskKind: "account_checkin",
				actorUserId: userId,
				note: `每日签到 ${state.today}`,
				nowIso,
				sourceType: "checkin",
				sourceKey: state.taskId,
			});
		});
	} catch (error: unknown) {
		if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
		const existing = await getPrismaClient().team_credit_ledger.findFirst({
			where: { team_id: state.teamId, entry_type: "checkin", task_id: state.taskId },
			select: { id: true },
		});
		if (!existing) throw error;
		return { ...await getCheckIn(c, userId, auth), awarded: false };
	}
	return { ...await getCheckIn(c, userId, auth), awarded: true };
}

export async function listCredits(c: AppContext, userId: string, cursor: string | undefined, limit: number) {
	const team = await personalTeam(c, userId);
	const rows = await listCreditRows(team.id, cursor, limit);
	const page = pageResult(rows, limit, (row) => row.id);
	return {
		creditsTotal: team.credits,
		creditsFrozen: team.credits_frozen,
		creditsAvailable: team.credits - team.credits_frozen,
		...page,
		items: page.items.map((row) => ({
			id: row.id,
			type: row.entry_type,
			amount: row.amount,
			taskId: row.task_id,
			taskKind: row.task_kind,
			note: row.note,
			createdAt: row.created_at,
			creditsTotalAfter: row.credits_after,
			creditsFrozenAfter: row.credits_frozen_after,
			creditsAvailableAfter: row.credits_available_after,
			settlesReservation: row.settles_reservation,
		})),
	};
}

export async function listNotifications(
	userId: string,
	filter: "all" | "unread" | "read",
	cursor: string | undefined,
	limit: number,
) {
	const rows = await listNotificationRows(userId, filter, cursor, limit);
	const page = pageResult(rows, limit, (row) => row.id);
	const unreadCount = await getPrismaClient().user_notifications.count({ where: { user_id: userId, read_at: null } });
	return {
		unreadCount,
		...page,
		items: page.items.map((row) => ({
			id: row.id,
			type: row.type,
			title: row.title,
			body: row.body,
			actionUrl: row.action_url,
			metadata: parseMetadata(row.metadata_json),
			readAt: row.read_at,
			createdAt: row.created_at,
		})),
	};
}

export async function markNotificationRead(userId: string, notificationId: string) {
	const nowIso = new Date().toISOString();
	const result = await getPrismaClient().user_notifications.updateMany({
		where: { id: notificationId, user_id: userId, read_at: null },
		data: { read_at: nowIso },
	});
	if (result.count > 0) return { id: notificationId, readAt: nowIso, updated: true };
	const exists = await getPrismaClient().user_notifications.findFirst({ where: { id: notificationId, user_id: userId } });
	if (!exists) throw new AppError("消息不存在", { status: 404, code: "notification_not_found" });
	if (!exists.read_at) {
		throw new AppError("消息已读状态发生并发冲突", { status: 409, code: "notification_read_conflict" });
	}
	return { id: notificationId, readAt: exists.read_at, updated: false };
}

export async function markAllNotificationsRead(userId: string) {
	const readAt = new Date().toISOString();
	const result = await getPrismaClient().user_notifications.updateMany({
		where: { user_id: userId, read_at: null },
		data: { read_at: readAt },
	});
	return { updatedCount: result.count, readAt };
}

export async function getOverview(c: AppContext, userId: string, auth: unknown) {
	const [profile, team, unreadCount, subscription, settings] = await Promise.all([
		getProfile(userId),
		personalTeam(c, userId),
		getPrismaClient().user_notifications.count({ where: { user_id: userId, read_at: null } }),
		getPrismaClient().subscriptions.findFirst({
			where: { owner_id: userId, status: "active", monthly_credits: { gt: 0 }, start_at: { lte: new Date().toISOString() }, end_at: { gt: new Date().toISOString() } },
			orderBy: { end_at: "desc" },
		}),
		readAccountSettings(c),
	]);
	const platformOwnerId = resolveConfiguredPlatformOwnerId(c);
	const products = settings.settings?.membershipEnabled === true && platformOwnerId
		? await listProductsForCatalog(c, {
			ownerId: platformOwnerId,
			status: "active",
			entitlementType: "membership",
			page: 1,
			size: 50,
		})
		: { items: [] };
	const membershipPlanName = subscription
		? await resolveMembershipPlanName(subscription.plan_code)
		: null;
	return {
		profile,
		credits: { balance: team.credits, frozen: team.credits_frozen },
		unreadCount,
		membership: {
			enabled: settings.settings?.membershipEnabled === true,
			configured: settings.configured,
			current: subscription
				? {
					planCode: subscription.plan_code,
					planName: membershipPlanName,
					startAt: subscription.start_at,
					endAt: subscription.end_at,
					billingCycle: subscription.billing_cycle,
					monthlyCredits: subscription.monthly_credits,
					dailyGiftCredits: subscription.daily_gift_credits,
					concurrencyLimit: subscription.concurrency_limit,
					capacityLabel: subscription.capacity_label,
				}
				: null,
			plans: settings.settings?.membershipEnabled === true ? products.items : [],
		},
		guestRestricted: profile.guest,
		checkIn: profile.guest ? null : await getCheckIn(c, userId, auth),
	};
}

export async function createAdminNotifications(
	c: AppContext,
	input: {
		audience: "all" | "users";
		userIds?: string[];
		type: string;
		title: string;
		body: string;
		actionUrl?: string | null;
		metadata?: Record<string, unknown> | null;
	},
) {
	void c;
	const users = input.audience === "all"
		? await getPrismaClient().users.findMany({ where: { disabled: 0, deleted_at: null, guest: 0 }, select: { id: true }, take: 10_001 })
		: await getPrismaClient().users.findMany({ where: { id: { in: input.userIds ?? [] }, disabled: 0, deleted_at: null }, select: { id: true } });
	if (users.length > 10_000) {
		throw new AppError("单次全站消息超过 10000 人，请分批发送", { status: 413, code: "notification_audience_too_large" });
	}
	if (input.audience === "users" && users.length !== new Set(input.userIds ?? []).size) {
		throw new AppError("部分接收用户不存在或不可用", { status: 409, code: "notification_recipient_invalid" });
	}
	const createdAt = new Date().toISOString();
	await getPrismaClient().user_notifications.createMany({
		data: users.map((user) => ({
			id: crypto.randomUUID(),
			user_id: user.id,
			type: input.type,
			title: input.title,
			body: input.body,
			action_url: input.actionUrl ?? null,
			metadata_json: input.metadata ? JSON.stringify(input.metadata) : null,
			created_at: createdAt,
		})),
	});
	return { createdCount: users.length, createdAt };
}

export async function listUserSessions(userId: string, currentSessionId: string) {
	const nowIso = new Date().toISOString();
	const rows = await getPrismaClient().auth_sessions.findMany({
		where: { user_id: userId },
		orderBy: [{ last_seen_at: "desc" }, { id: "desc" }],
		take: 50,
	});
	return rows.map((row) => ({
		id: row.id,
		deviceLabel: row.device_label,
		createdAt: row.created_at,
		lastSeenAt: row.last_seen_at,
		expiresAt: row.expires_at,
		revokedAt: row.revoked_at,
		revokedReason: row.revoked_reason,
		active: !row.revoked_at && row.expires_at > nowIso,
		current: row.id === currentSessionId,
	}));
}

export async function revokeUserSession(userId: string, sessionId: string, currentSessionId: string) {
	const revokedAt = new Date().toISOString();
	const result = await getPrismaClient().auth_sessions.updateMany({
		where: { id: sessionId, user_id: userId, revoked_at: null },
		data: { revoked_at: revokedAt, revoked_reason: "user_revoked" },
	});
	if (result.count > 0) return { id: sessionId, revokedAt, current: sessionId === currentSessionId };
	const row = await getPrismaClient().auth_sessions.findFirst({ where: { id: sessionId, user_id: userId } });
	if (!row) throw new AppError("登录设备不存在", { status: 404, code: "session_not_found" });
	if (!row.revoked_at) {
		throw new AppError("登录设备撤销状态发生并发冲突", { status: 409, code: "session_revocation_conflict" });
	}
	return { id: row.id, revokedAt: row.revoked_at, current: row.id === currentSessionId };
}

export async function logoutCurrentSession(userId: string, currentSessionId: string) {
	const result = await getPrismaClient().auth_sessions.updateMany({
		where: { id: currentSessionId, user_id: userId, revoked_at: null },
		data: { revoked_at: new Date().toISOString(), revoked_reason: "logout" },
	});
	return { revoked: result.count > 0 };
}

export async function listAdminSessions(input: {
	cursor?: string;
	limit: number;
	userId?: string;
	activeOnly: boolean;
}) {
	const rows = await getPrismaClient().auth_sessions.findMany({
		where: {
			...(input.userId ? { user_id: input.userId } : {}),
			...(input.activeOnly ? { revoked_at: null, expires_at: { gt: new Date().toISOString() } } : {}),
		},
		orderBy: [{ last_seen_at: "desc" }, { id: "desc" }],
		take: input.limit + 1,
		...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
		include: { users: { select: { login: true, name: true } } },
	});
	const page = pageResult(rows, input.limit, (row) => row.id);
	return {
		...page,
		items: page.items.map((row) => ({
			id: row.id,
			userId: row.user_id,
			userName: row.users.name || row.users.login,
			deviceLabel: row.device_label,
			createdAt: row.created_at,
			lastSeenAt: row.last_seen_at,
			expiresAt: row.expires_at,
			revokedAt: row.revoked_at,
			revokedReason: row.revoked_reason,
		})),
	};
}

export async function revokeAdminSession(sessionId: string) {
	const revokedAt = new Date().toISOString();
	const result = await getPrismaClient().auth_sessions.updateMany({
		where: { id: sessionId, revoked_at: null },
		data: { revoked_at: revokedAt, revoked_reason: "admin_revoked" },
	});
	if (result.count > 0) return { id: sessionId, revokedAt };
	const row = await getPrismaClient().auth_sessions.findUnique({ where: { id: sessionId } });
	if (!row) throw new AppError("登录设备不存在", { status: 404, code: "session_not_found" });
	if (!row.revoked_at) {
		throw new AppError("登录设备撤销状态发生并发冲突", { status: 409, code: "session_revocation_conflict" });
	}
	return { id: row.id, revokedAt: row.revoked_at };
}

export async function listAdminNotifications(cursor: string | undefined, limit: number) {
	const rows = await getPrismaClient().user_notifications.findMany({
		orderBy: [{ created_at: "desc" }, { id: "desc" }],
		take: limit + 1,
		...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
		include: { users: { select: { login: true, name: true } } },
	});
	const page = pageResult(rows, limit, (row) => row.id);
	return {
		...page,
		items: page.items.map((row) => ({
			id: row.id,
			userId: row.user_id,
			userName: row.users.name || row.users.login,
			type: row.type,
			title: row.title,
			body: row.body,
			readAt: row.read_at,
			createdAt: row.created_at,
		})),
	};
}

export type { AccountSettings };
