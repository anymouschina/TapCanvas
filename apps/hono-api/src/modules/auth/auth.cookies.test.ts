import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppEnv, WorkerEnv } from "../../types";
import {
	attachAuthCookies,
	clearAuthCookies,
	resolveCookieOptions,
} from "./auth.cookies";

describe("browser auth cookies", () => {
	it("keeps the production session host-only, secure, HttpOnly, and SameSite=Lax", () => {
		expect(resolveCookieOptions("api.tapcanvas.com")).toEqual({
			path: "/",
			sameSite: "Lax",
			secure: true,
			httpOnly: true,
			maxAge: 604800,
		});
		expect(resolveCookieOptions("localhost.attacker.example").secure).toBe(true);
	});

	it("only exposes a non-secret presence marker to browser JavaScript", async () => {
		const app = new Hono<AppEnv>();
		app.get("/", (c) => {
			attachAuthCookies(c, {
				accessToken: "secret-access-jwt",
				refreshToken: "secret-refresh-jwt",
				accessTokenExpiresInSeconds: 1800,
				refreshTokenExpiresInSeconds: 604800,
			});
			return c.text("ok");
		});
		const response = await app.request("https://api.tapcanvas.com/", {}, {} as WorkerEnv);
		const cookies = response.headers.getSetCookie();
		expect(cookies.some((value) => value.includes("tap_token=secret-access-jwt") && value.includes("HttpOnly") && value.includes("Max-Age=1800"))).toBe(true);
		expect(cookies.some((value) => value.includes("tap_refresh_token=secret-refresh-jwt") && value.includes("HttpOnly") && value.includes("Max-Age=604800"))).toBe(true);
		expect(cookies.some((value) => value.includes("tap_session_present=1") && !value.includes("HttpOnly"))).toBe(true);
	});

	it("clears access, refresh, and readable marker cookies together", async () => {
		const app = new Hono<AppEnv>();
		app.get("/", (c) => {
			clearAuthCookies(c);
			return c.text("ok");
		});
		const response = await app.request("https://api.tapcanvas.com/", {}, {} as WorkerEnv);
		const cookies = response.headers.getSetCookie();
		for (const name of ["tap_token", "tap_refresh_token", "tap_session_present"]) {
			expect(
				cookies.some(
					(value) => value.includes(`${name}=`) && value.includes("Max-Age=0"),
				),
			).toBe(true);
		}
	});
});
