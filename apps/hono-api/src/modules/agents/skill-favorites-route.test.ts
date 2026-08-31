import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext, AppEnv } from "../../types";

const { favoriteSkill, listSkillFavoriteKeys, unfavoriteSkill } = vi.hoisted(() => ({
	favoriteSkill: vi.fn(),
	listSkillFavoriteKeys: vi.fn(),
	unfavoriteSkill: vi.fn(),
}));

vi.mock("./skill-favorites.service", () => ({
	favoriteSkill,
	listSkillFavoriteKeys,
	unfavoriteSkill,
}));

import { skillFavoritesRouter } from "./skill-favorites.routes";

function createApp(userId: string | null = "favorite-route-user"): Hono<AppEnv> {
	const app = new Hono<AppEnv>();
	if (userId) {
		app.use("/agents/*", async (c: AppContext, next: () => Promise<void>) => {
			c.set("userId", userId);
			await next();
		});
	}
	app.route("/agents", skillFavoritesRouter);
	return app;
}

describe("Skill favorite routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("lists only the authenticated user's favorite keys", async () => {
		listSkillFavoriteKeys.mockResolvedValue(["oiioii-public-camera"]);
		const response = await createApp("user-a").request("/agents/skills/favorites");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ skillKeys: ["oiioii-public-camera"] });
		expect(listSkillFavoriteKeys).toHaveBeenCalledWith("user-a");
	});

	it("creates a favorite through the authenticated account", async () => {
		favoriteSkill.mockResolvedValue("oiioii-public-camera");
		const response = await createApp("user-a").request(
			"/agents/skills/oiioii-public-camera/favorite",
			{ method: "POST" },
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ skillKey: "oiioii-public-camera", favorited: true });
		expect(favoriteSkill).toHaveBeenCalledWith("user-a", "oiioii-public-camera");
	});

	it("deletes a favorite idempotently through the authenticated account", async () => {
		unfavoriteSkill.mockResolvedValue("oiioii-public-camera");
		const response = await createApp("user-b").request(
			"/agents/skills/oiioii-public-camera/favorite",
			{ method: "DELETE" },
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ skillKey: "oiioii-public-camera", favorited: false });
		expect(unfavoriteSkill).toHaveBeenCalledWith("user-b", "oiioii-public-camera");
	});

	it("rejects every favorite operation without an authenticated user", async () => {
		const app = createApp(null);
		const responses = await Promise.all([
			app.request("/agents/skills/favorites"),
			app.request("/agents/skills/key/favorite", { method: "POST" }),
			app.request("/agents/skills/key/favorite", { method: "DELETE" }),
		]);
		expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
		expect(listSkillFavoriteKeys).not.toHaveBeenCalled();
		expect(favoriteSkill).not.toHaveBeenCalled();
		expect(unfavoriteSkill).not.toHaveBeenCalled();
	});
});
