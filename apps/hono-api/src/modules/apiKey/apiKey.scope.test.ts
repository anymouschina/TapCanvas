import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv, WorkerEnv } from "../../types";
import { apiKeyScopeMiddleware } from "./apiKey.middleware";
import { honoErrorHandler } from "../../middleware/error";

function scopedApp(scopes: string[]) {
	const app = new Hono<AppEnv>();
	app.onError(honoErrorHandler);
	app.use("*", async (c, next) => {
		c.set("apiKeyId", "key-1");
		c.set("apiKeyScopes", scopes);
		return next();
	});
	app.use("*", apiKeyScopeMiddleware);
	app.get("/models", (c) => c.text("read"));
	app.post("/tasks", (c) => c.text("write"));
	app.post("/agent-api/video-jobs", (c) => c.text("agent"));
	return app;
}

const env = {} as WorkerEnv;

describe("apiKeyScopeMiddleware", () => {
	it("preserves full CLI and Agent API capabilities for fully scoped keys", async () => {
		const app = scopedApp(["public:read", "public:write", "agent:execute"]);
		expect((await app.request("http://local/models", {}, env)).status).toBe(200);
		expect((await app.request("http://local/tasks", { method: "POST" }, env)).status).toBe(200);
		expect((await app.request("http://local/agent-api/video-jobs", { method: "POST" }, env)).status).toBe(200);
	});

	it("blocks Agent API execution when agent:execute is absent", async () => {
		const response = await scopedApp(["public:read", "public:write"])
			.request("http://local/agent-api/video-jobs", { method: "POST" }, env);
		expect(response.status).toBe(403);
	});
});
