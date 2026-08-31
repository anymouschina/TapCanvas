import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../types";

const { execute, listPublicChatMessages, listPublicChatSessionsByPrefix } = vi.hoisted(() => ({
	execute: vi.fn(async () => undefined),
	listPublicChatMessages: vi.fn(async () => []),
	listPublicChatSessionsByPrefix: vi.fn(async () => []),
}));

vi.mock("../../db/db", () => ({
	execute,
	queryAll: vi.fn(async () => []),
	queryOne: vi.fn(async () => null),
}));

vi.mock("../apiKey/public-chat-session.repo", () => ({
	appendPublicChatMessage: vi.fn(),
	findPublicChatSessionByKey: vi.fn(),
	listPublicChatMessages,
	listPublicChatSessionsByPrefix,
	resolveOrCreatePublicChatSession: vi.fn(),
}));

import { listPublicProjectConversations } from "./memory.repo";

const db = {} as PrismaClient;

describe("listPublicProjectConversations", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("keeps project conversations isolated from chapter sessions", async () => {
		await listPublicProjectConversations(db, {
			userId: "user-1",
			projectId: "PROJECT-1",
		});

		expect(listPublicChatSessionsByPrefix).toHaveBeenCalledWith(db, {
			userId: "user-1",
			sessionKeyPrefix: "project:project-1",
			limit: 5,
			excludeSessionKeyContains: ":chapter:",
		});
	});

	it("queries one exact chapter namespace without the project-level exclusion", async () => {
		await listPublicProjectConversations(db, {
			userId: "user-1",
			projectId: "PROJECT-1",
			chapterId: "Chapter-30",
		});

		expect(listPublicChatSessionsByPrefix).toHaveBeenCalledWith(db, {
			userId: "user-1",
			sessionKeyPrefix: "project:project-1:chapter:Chapter-30:",
			limit: 5,
		});
	});

	it("includes project and chapter sessions for the complete public process", async () => {
		await listPublicProjectConversations(db, {
			userId: "user-1",
			projectId: "PROJECT-1",
			includeChapterSessions: true,
		});

		expect(listPublicChatSessionsByPrefix).toHaveBeenCalledWith(db, {
			userId: "user-1",
			sessionKeyPrefix: "project:project-1",
			limit: 5,
		});
	});
});
