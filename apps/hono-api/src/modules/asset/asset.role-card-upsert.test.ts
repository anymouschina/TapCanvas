import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import type { AppContext, AppEnv } from "../../types";

const { authMiddleware, getProjectForOwner, resolveProjectDataRepoRoot } = vi.hoisted(() => ({
	authMiddleware: vi.fn(async (c: AppContext, next: () => Promise<void>) => {
		c.set("userId", "user-test");
		await next();
	}),
	getProjectForOwner: vi.fn(async () => ({ id: "project-1", ownerId: "user-test" })),
	resolveProjectDataRepoRoot: vi.fn(() => ""),
}));

vi.mock("../../middleware/auth", () => ({
	authMiddleware,
	resolveAuth: vi.fn(),
	tryGetUserDbAuthState: vi.fn(),
}));

vi.mock("../project/project.repo", () => ({
	getProjectForOwner,
}));

vi.mock("./project-data-root", () => ({
	resolveProjectDataRepoRoot,
}));

import { assetRouter } from "./asset.routes";

function createApp() {
	const app = new Hono<AppEnv>();
	app.route("/assets", assetRouter);
	return app;
}

describe("assetRouter role-cards/upsert", () => {
	let repoRoot: string;

	beforeEach(async () => {
		repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tapcanvas-asset-router-"));
		resolveProjectDataRepoRoot.mockReturnValue(repoRoot);
		getProjectForOwner.mockResolvedValue({ id: "project-1", ownerId: "user-test" });

		const indexPath = path.join(
			repoRoot,
			"project-data",
			"users",
			"user-test",
			"projects",
			"project-1",
			"books",
			"book-1",
			"index.json",
		);
		await fs.mkdir(path.dirname(indexPath), { recursive: true });
		await fs.writeFile(
			indexPath,
			JSON.stringify(
				{
					bookId: "book-1",
					projectId: "project-1",
					title: "测试小说",
					chapterCount: 1,
					rawPath: "raw.md",
					chapters: [],
					assets: {
						roleCards: [],
						characterBibles: [],
					},
					updatedAt: "2026-04-18T00:00:00.000Z",
				},
				null,
				2,
			),
			"utf8",
		);
	});

	afterEach(async () => {
		await fs.rm(repoRoot, { recursive: true, force: true });
	});

	it("persists characterBibles alongside roleCards and returns them in payload", async () => {
		const response = await createApp().request(
			"/assets/books/book-1/role-cards/upsert?projectId=project-1",
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({
					roleName: "沈青璃",
					status: "generated",
					imageUrl: "https://example.com/shen-qingli.png",
					characterBible: {
						version: "v1",
						id: "bible-1",
						name: "沈青璃",
						projectId: "project-1",
						sourceCharacterId: "char-1",
						sourceGroupNumber: "1",
						identityHint: "冷面女医",
						era: "民国",
						culturalRegion: "江南",
						genre: "悬疑",
						timePeriod: "民国初年",
						appearanceBackground: "",
						scene: "旧药铺后院",
						gender: "女",
						ageGroup: "青年",
						species: "人类",
						physique: "清瘦",
						heightLevel: "高挑",
						skinColor: "",
						hairLength: "长发",
						hairColor: "黑发",
						temperament: "克制冷静",
						outfit: "墨绿窄袖长衫",
						distinctiveFeatures: "右眼下有泪痣",
						filterWorldview: "乱世求生",
						filterTheme: "医者仁心",
						filterScene: "",
						sourceImages: {
							fullBody: "https://example.com/full.png",
							threeView: "",
							expression: "",
							closeup: "",
						},
						importedImages: {
							fullBody: "https://example.com/full.png",
							threeView: "",
							expression: "",
							closeup: "",
						},
						importedAt: "2026-04-18T00:00:00.000Z",
						updatedAt: "2026-04-18T00:00:00.000Z",
					},
				}),
			},
			{
				DB: {} as never,
				JWT_SECRET: "test-secret",
			},
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			ok: boolean;
			cardId: string;
			roleCards: Array<{ cardId: string; roleName: string }>;
			characterBibles: Array<{ id: string; name: string; roleCardId?: string }>;
		};
		expect(payload.ok).toBe(true);
		expect(payload.roleCards).toHaveLength(1);
		expect(payload.characterBibles).toEqual([
			expect.objectContaining({
				id: "bible-1",
				name: "沈青璃",
				roleCardId: payload.cardId,
			}),
		]);

		const savedRaw = await fs.readFile(
			path.join(
				repoRoot,
				"project-data",
				"users",
				"user-test",
				"projects",
				"project-1",
				"books",
				"book-1",
				"index.json",
			),
			"utf8",
		);
		const saved = JSON.parse(savedRaw) as {
			assets?: {
				roleCards?: Array<{ cardId: string; roleName: string }>;
				characterBibles?: Array<{ id: string; name: string; roleCardId?: string }>;
			};
		};

		expect(saved.assets?.roleCards).toEqual([
			expect.objectContaining({
				cardId: payload.cardId,
				roleName: "沈青璃",
			}),
		]);
		expect(saved.assets?.characterBibles).toEqual([
			expect.objectContaining({
				id: "bible-1",
				name: "沈青璃",
				roleCardId: payload.cardId,
			}),
		]);
	});
});
