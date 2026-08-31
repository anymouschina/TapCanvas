import { describe, it, expect, vi } from "vitest";

const { findAssetUri, authMiddleware } = vi.hoisted(() => ({
	findAssetUri: vi.fn(async (id: string) => {
		if (id === "task-1") {
			return {
				id: "task-1",
				type: "image",
				cdn_url: "https://cdn/img.webp",
				task_id: "task-1",
				node_id: null,
				user_id: "u1",
				created_at: "",
			};
		}
		return null;
	}),
	authMiddleware: vi.fn(async (_c: any, next: any) => {
		await next();
	}),
}));

vi.mock("../task/asset-uri.repo", () => ({ findAssetUri }));
vi.mock("../../middleware/auth", () => ({ authMiddleware }));

import { resolveRouter } from "./resolve.routes";
import { Hono } from "hono";

function makeApp() {
	const app = new Hono();
	app.route("/resolve", resolveRouter);
	return app;
}

describe("GET /resolve", () => {
	it("tapcanvas://image/task-1 → cdn_url", async () => {
		const res = await makeApp().request(
			"/resolve?uri=tapcanvas%3A%2F%2Fimage%2Ftask-1",
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.cdnUrl).toBe("https://cdn/img.webp");
		expect(body.type).toBe("image");
	});

	it("未知 URI 返回 404", async () => {
		const res = await makeApp().request(
			"/resolve?uri=tapcanvas%3A%2F%2Fimage%2Funknown",
		);
		expect(res.status).toBe(404);
	});

	it("非 tapcanvas:// URI 透传 cdnUrl", async () => {
		const res = await makeApp().request(
			"/resolve?uri=https%3A%2F%2Fcdn%2Flegacy.webp",
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.cdnUrl).toBe("https://cdn/legacy.webp");
		expect(body.passthrough).toBe(true);
	});
});
