import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppContext, AppEnv } from "../../types";

// Mocked auth middleware: sets apiKeyId from a test header so we can drive
// both the authed (valid key) and unauthed (missing key) branches.
const {
	apiKeyAuthMiddleware,
	listRequestLogsByApiKey,
	sumCreditsByApiKey,
	listCreditLedgerByApiKey,
	getApiKeyPrefixById,
} = vi.hoisted(() => ({
	apiKeyAuthMiddleware: vi.fn(async (c: AppContext, next: () => Promise<void>) => {
		const fakeKeyId = c.req.header("x-test-api-key-id");
		if (fakeKeyId) {
			c.set("apiKeyId", fakeKeyId);
			c.set("apiKeyOwnerId", "owner-1");
			c.set("userId", "owner-1");
		}
		await next();
	}),
	listRequestLogsByApiKey: vi.fn(),
	sumCreditsByApiKey: vi.fn(),
	listCreditLedgerByApiKey: vi.fn(),
	getApiKeyPrefixById: vi.fn(),
}));

vi.mock("./apiKey.middleware", () => ({
	apiKeyAuthMiddleware,
	apiKeyScopeMiddleware: vi.fn(async (_c: AppContext, next: () => Promise<void>) => {
		await next();
	}),
}));

vi.mock("./apiKey.usage.repo", () => ({
	listRequestLogsByApiKey,
	sumCreditsByApiKey,
	listCreditLedgerByApiKey,
	getApiKeyPrefixById,
}));

import { publicApiRouter } from "./apiKey.routes";

function createApp() {
	const app = new Hono<AppEnv>();
	app.route("/public", publicApiRouter);
	return app;
}

describe("GET /public/usage (apikey-scoped)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listRequestLogsByApiKey.mockResolvedValue([
			{
				id: "r1",
				path: "/public/draw",
				method: "POST",
				status: 200,
				duration_ms: 1234,
				started_at: "2026-06-18T00:00:00Z",
			},
		]);
		sumCreditsByApiKey.mockResolvedValue({ personalSpent: 30, teamSpent: 12 });
		listCreditLedgerByApiKey.mockResolvedValue([
			{
				source: "personal",
				amount: 12,
				note: "draw",
				createdAt: "2026-06-18T00:00:00Z",
				kind: "draw",
			},
		]);
		getApiKeyPrefixById.mockResolvedValue("tc_sk_abc");
	});

	it("returns 200 with summary + recentRequests + recentCredits scoped to the calling key", async () => {
		const app = createApp();
		const res = await app.request("/public/usage", {
			headers: { "x-test-api-key-id": "key-1" },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.keyPrefix).toBe("tc_sk_abc");
		expect(body.summary).toEqual({ personalSpent: 30, teamSpent: 12 });
		expect(body.recentRequests[0].path).toBe("/public/draw");
		expect(body.recentCredits[0].source).toBe("personal");

		// All three repo reads must be scoped to the calling key's apiKeyId.
		expect(sumCreditsByApiKey).toHaveBeenCalledWith("key-1");
		expect(listRequestLogsByApiKey).toHaveBeenCalledWith(
			"key-1",
			expect.objectContaining({ limit: 50 }),
		);
		expect(listCreditLedgerByApiKey).toHaveBeenCalledWith(
			"key-1",
			expect.objectContaining({ limit: 50 }),
		);
	});

	it("passes through limit (clamped 1..200) and before", async () => {
		const app = createApp();
		const res = await app.request(
			"/public/usage?limit=500&before=2026-06-17T00:00:00Z",
			{ headers: { "x-test-api-key-id": "key-1" } },
		);
		expect(res.status).toBe(200);
		expect(listRequestLogsByApiKey).toHaveBeenCalledWith(
			"key-1",
			expect.objectContaining({ limit: 200, before: "2026-06-17T00:00:00Z" }),
		);
		expect(listCreditLedgerByApiKey).toHaveBeenCalledWith(
			"key-1",
			expect.objectContaining({ limit: 200 }),
		);
	});

	it("returns 401 when no api key is present in context", async () => {
		const app = createApp();
		const res = await app.request("/public/usage");
		expect(res.status).toBe(401);
		expect(sumCreditsByApiKey).not.toHaveBeenCalled();
	});
});
