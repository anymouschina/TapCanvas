import { describe, expect, it } from "vitest";

import {
	assertOriginAllowedForApiKey,
	buildApiKeyUserAuthPayload,
} from "./apiKey.middleware";

const LIST = JSON.stringify(["https://app.example.com", "http://localhost:5173"]);

describe("assertOriginAllowedForApiKey", () => {
	it("无 Origin 头（server-to-server）放行", () => {
		expect(() => assertOriginAllowedForApiKey(undefined, LIST)).not.toThrow();
		expect(() => assertOriginAllowedForApiKey("  ", LIST)).not.toThrow();
	});

	it("Origin 在白名单内放行（含端口归一化）", () => {
		expect(() =>
			assertOriginAllowedForApiKey("https://app.example.com", LIST),
		).not.toThrow();
		expect(() =>
			assertOriginAllowedForApiKey("http://localhost:5173", LIST),
		).not.toThrow();
	});

	it("Origin 不在白名单抛 403 api_key_origin_forbidden", () => {
		expect(() => assertOriginAllowedForApiKey("https://evil.com", LIST)).toThrowError(
			/Origin not allowed/,
		);
		try {
			assertOriginAllowedForApiKey("https://evil.com", LIST);
		} catch (err) {
			expect((err as { code?: string }).code).toBe("api_key_origin_forbidden");
			expect((err as { status?: number }).status).toBe(403);
		}
	});

	it("通配 * / 空列表 / 历史坏数据放行", () => {
		expect(() =>
			assertOriginAllowedForApiKey("https://evil.com", JSON.stringify(["*"])),
		).not.toThrow();
		expect(() =>
			assertOriginAllowedForApiKey("https://evil.com", JSON.stringify([])),
		).not.toThrow();
		expect(() => assertOriginAllowedForApiKey("https://evil.com", "not json")).not.toThrow();
	});

	it('Origin 为 "null"（sandboxed iframe）按不匹配拒绝', () => {
		expect(() => assertOriginAllowedForApiKey("null", LIST)).toThrowError(
			/Origin not allowed/,
		);
	});
});

describe("buildApiKeyUserAuthPayload", () => {
	it("projects the API-key owner as the same user role seen by browser auth", () => {
		expect(buildApiKeyUserAuthPayload({
			userId: "user-1",
			role: "admin",
			hasPassword: true,
		})).toEqual({
			sub: "user-1",
			login: "user-1",
			role: "admin",
			hasPassword: true,
		});
	});
});
