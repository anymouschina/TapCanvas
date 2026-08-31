import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv, WorkerEnv } from "../types";
import { browserOriginGuard } from "./http-security";

const env = { CORS_ALLOWED_ORIGINS: "https://studio.tapcanvas.com" } as unknown as WorkerEnv;

describe("browserOriginGuard", () => {
	function app() {
		const instance = new Hono<AppEnv>();
		instance.use("*", browserOriginGuard);
		instance.post("/write", (c) => c.json({ ok: true }));
		return instance;
	}

	it("allows configured browser origins", async () => {
		const response = await app().request("https://api.tapcanvas.com/write", {
			method: "POST",
			headers: { origin: "https://studio.tapcanvas.com", cookie: "tap_token=secret" },
		}, env);
		expect(response.status).toBe(200);
	});

	it("rejects untrusted origins and origin-less cookie mutations", async () => {
		const untrusted = await app().request("https://api.tapcanvas.com/write", {
			method: "POST",
			headers: { origin: "https://attacker.example", cookie: "tap_token=secret" },
		}, env);
		expect(untrusted.status).toBe(403);

		const missing = await app().request("https://api.tapcanvas.com/write", {
			method: "POST",
			headers: { cookie: "tap_token=secret" },
		}, env);
		expect(missing.status).toBe(403);

		const refreshOnly = await app().request("https://api.tapcanvas.com/write", {
			method: "POST",
			headers: { cookie: "tap_refresh_token=secret" },
		}, env);
		expect(refreshOnly.status).toBe(403);
	});

	it("allows the fixed Web development port only when the API request is local", async () => {
		const local = await app().request("http://127.0.0.1:8788/write", {
			method: "POST",
			headers: { origin: "http://127.0.0.1:5175", cookie: "tap_token=secret" },
		}, env);
		expect(local.status).toBe(200);

		const production = await app().request("https://api.tapcanvas.com/write", {
			method: "POST",
			headers: { origin: "http://127.0.0.1:5175", cookie: "tap_token=secret" },
		}, env);
		expect(production.status).toBe(403);
	});

	it("accepts HTTPS browser origins when TLS termination leaves the internal scheme as HTTP", async () => {
		const response = await app().request("http://api.tapcanvas.com/write", {
			method: "POST",
			headers: {
				origin: "https://api.tapcanvas.com",
				cookie: "tap_token=secret",
				"x-forwarded-host": "api.tapcanvas.com",
				"x-forwarded-proto": "http",
			},
		}, env);
		expect(response.status).toBe(200);
	});
});
