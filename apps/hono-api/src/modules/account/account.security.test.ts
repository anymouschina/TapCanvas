import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { AppContext } from "../../types";
import { AdminNotificationCreateSchema } from "./account.schemas";

const { prisma, getMyTeam, listLikedProjectRows, listOwnedPublishedWorkRows, readAccountSettings } = vi.hoisted(() => ({
	prisma: {
		user_notifications: {
			updateMany: vi.fn(),
			findFirst: vi.fn(),
		},
		auth_sessions: {
			updateMany: vi.fn(),
			findFirst: vi.fn(),
			findUnique: vi.fn(),
		},
		team_credit_ledger: {
			findFirst: vi.fn(),
			count: vi.fn(),
		},
		$transaction: vi.fn(),
	},
	getMyTeam: vi.fn(),
	listLikedProjectRows: vi.fn(),
	listOwnedPublishedWorkRows: vi.fn(),
	readAccountSettings: vi.fn(),
}));

vi.mock("../../platform/node/prisma", () => ({ getPrismaClient: () => prisma }));
vi.mock("../team/team.service", () => ({ getMyTeam }));
vi.mock("../product/product.service", () => ({ listProductsForCatalog: vi.fn() }));
vi.mock("./account.settings", () => ({
	readAccountSettings,
	resolveConfiguredPlatformOwnerId: vi.fn(() => "platform-owner"),
}));
vi.mock("./account.repo", async (importOriginal) => {
	const original = await importOriginal<typeof import("./account.repo")>();
	return { ...original, listLikedProjectRows, listOwnedPublishedWorkRows };
});

import {
	listLikes,
	listWorks,
	markNotificationRead,
	performCheckIn,
	revokeAdminSession,
	revokeUserSession,
} from "./account.service";

function createContext(): AppContext {
	return {
		env: { DB: {} } as AppContext["env"],
		get: () => undefined,
	} as unknown as AppContext;
}

describe("account security contracts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each(["javascript:alert(1)", "data:text/html,boom", "http://example.com", "//example.com/path"])(
		"rejects unsafe notification action URL %s",
		(actionUrl) => {
			const parsed = AdminNotificationCreateSchema.safeParse({
				audience: "all",
				type: "system",
				title: "标题",
				body: "内容",
				actionUrl,
			});
			expect(parsed.success).toBe(false);
		},
	);

	it.each(["https://example.com/path", "/account/messages?id=1"])(
		"accepts safe notification action URL %s",
		(actionUrl) => {
			expect(AdminNotificationCreateSchema.safeParse({
				audience: "all",
				type: "system",
				title: "标题",
				body: "内容",
				actionUrl,
			}).success).toBe(true);
		},
	);

	it("returns a tombstone for a liked project that is no longer public", async () => {
		listLikedProjectRows.mockResolvedValue([{
			like: { id: "like-1", project_id: "project-1", user_id: "user-1", created_at: "2026-07-22T00:00:00.000Z" },
			project: {
				id: "project-1",
				name: "private title",
				description: "private description",
				cover_url: "https://example.com/private.png",
				is_public: 0,
				published_at: "2026-07-21T00:00:00.000Z",
				like_count: 1,
				view_count: 2,
				updated_at: "2026-07-22T00:00:00.000Z",
				users: { login: "owner", name: "Owner", avatar_url: null },
			},
		}]);

		const result = await listLikes("user-1", undefined, 20);

		expect(result.items).toEqual([expect.objectContaining({ available: false, project: null })]);
	});

	it("returns only persisted publish snapshots from the account works query", async () => {
		listOwnedPublishedWorkRows.mockResolvedValue([{
			id: "work-1",
			name: "legacy asset name",
			data: JSON.stringify({
				kind: "publishRecord",
				title: "已发布短片",
				description: "作品说明",
				videoUrl: "https://assets.example.com/work.mp4",
				coverImageUrl: "https://assets.example.com/work.jpg",
				publishedAt: "2026-07-22T08:00:00.000Z",
				sourceProjectId: "project-1",
				sourceProjectName: "原始画布",
				ownerType: "chapter",
				ownerId: "chapter-1",
				sourceChapterTitle: "第一章",
			}),
		}]);

		await expect(listWorks("user-1", undefined, 20)).resolves.toEqual({
			items: [{
				id: "work-1",
				title: "已发布短片",
				description: "作品说明",
				videoUrl: "https://assets.example.com/work.mp4",
				coverImageUrl: "https://assets.example.com/work.jpg",
				publishedAt: "2026-07-22T08:00:00.000Z",
				published: true,
				sourceProjectId: "project-1",
				sourceProjectName: "原始画布",
				sourceOwnerType: "chapter",
				sourceOwnerId: "chapter-1",
				sourceChapterTitle: "第一章",
			}],
			nextCursor: null,
		});
		expect(listOwnedPublishedWorkRows).toHaveBeenCalledWith("user-1", undefined, 20);
	});

	it("fails explicitly when a publish snapshot is incomplete", async () => {
		listOwnedPublishedWorkRows.mockResolvedValue([{
			id: "work-broken",
			name: "broken",
			data: JSON.stringify({ kind: "publishRecord", title: "缺少视频" }),
		}]);

		await expect(listWorks("user-1", undefined, 20)).rejects.toMatchObject({
			code: "published_work_incomplete",
		});
	});

	it("returns the persisted read timestamp when the notification was already read", async () => {
		prisma.user_notifications.updateMany.mockResolvedValue({ count: 0 });
		prisma.user_notifications.findFirst.mockResolvedValue({
			id: "notification-1",
			read_at: "2026-07-20T01:02:03.000Z",
		});

		await expect(markNotificationRead("user-1", "notification-1")).resolves.toEqual({
			id: "notification-1",
			readAt: "2026-07-20T01:02:03.000Z",
			updated: false,
		});
		expect(prisma.user_notifications.updateMany).toHaveBeenCalledWith(expect.objectContaining({
			where: { id: "notification-1", user_id: "user-1", read_at: null },
		}));
	});

	it("preserves the first user revocation audit timestamp", async () => {
		prisma.auth_sessions.updateMany.mockResolvedValue({ count: 0 });
		prisma.auth_sessions.findFirst.mockResolvedValue({
			id: "session-1",
			user_id: "user-1",
			revoked_at: "2026-07-20T00:00:00.000Z",
			revoked_reason: "admin_revoked",
		});

		await expect(revokeUserSession("user-1", "session-1", "session-current")).resolves.toEqual({
			id: "session-1",
			revokedAt: "2026-07-20T00:00:00.000Z",
			current: false,
		});
		expect(prisma.auth_sessions.updateMany).toHaveBeenCalledWith(expect.objectContaining({
			where: { id: "session-1", user_id: "user-1", revoked_at: null },
		}));
	});

	it("preserves the first admin revocation audit timestamp", async () => {
		prisma.auth_sessions.updateMany.mockResolvedValue({ count: 0 });
		prisma.auth_sessions.findUnique.mockResolvedValue({
			id: "session-1",
			revoked_at: "2026-07-19T00:00:00.000Z",
			revoked_reason: "user_revoked",
		});

		await expect(revokeAdminSession("session-1")).resolves.toEqual({
			id: "session-1",
			revokedAt: "2026-07-19T00:00:00.000Z",
		});
	});

	it("rethrows an unrelated P2002 instead of reporting an idempotent check-in", async () => {
		readAccountSettings.mockResolvedValue({
			configured: true,
			settings: {
				checkInEnabled: true,
				checkInRewardCredits: 10,
				membershipEnabled: true,
				sessionTtlDays: 7,
				maxActiveSessions: 10,
			},
		});
		getMyTeam.mockResolvedValue({ team: { id: "personal_user-1", credits: 5 }, role: "owner", memberCount: 1 });
		prisma.team_credit_ledger.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
		prisma.team_credit_ledger.count.mockResolvedValue(0);
		const duplicate = new Prisma.PrismaClientKnownRequestError("duplicate", {
			code: "P2002",
			clientVersion: "test",
		});
		prisma.$transaction.mockRejectedValue(duplicate);

		await expect(performCheckIn(createContext(), "user-1", { guest: false })).rejects.toBe(duplicate);
	});

	it("treats P2002 as idempotent only when the exact daily ledger exists", async () => {
		readAccountSettings.mockResolvedValue({
			configured: true,
			settings: {
				checkInEnabled: true,
				checkInRewardCredits: 10,
				membershipEnabled: true,
				sessionTtlDays: 7,
				maxActiveSessions: 10,
			},
		});
		getMyTeam
			.mockResolvedValueOnce({ team: { id: "personal_user-1", credits: 5 }, role: "owner", memberCount: 1 })
			.mockResolvedValueOnce({ team: { id: "personal_user-1", credits: 15 }, role: "owner", memberCount: 1 });
		const ledger = { id: "ledger-1", created_at: "2026-07-22T00:00:00.000Z" };
		prisma.team_credit_ledger.findFirst
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ id: ledger.id })
			.mockResolvedValueOnce(ledger)
			.mockResolvedValueOnce(ledger);
		prisma.team_credit_ledger.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
		const duplicate = new Prisma.PrismaClientKnownRequestError("duplicate", {
			code: "P2002",
			clientVersion: "test",
		});
		prisma.$transaction.mockRejectedValue(duplicate);

		await expect(performCheckIn(createContext(), "user-1", { guest: false })).resolves.toMatchObject({
			awarded: false,
			checkedInToday: true,
			balance: 15,
		});
	});
});
