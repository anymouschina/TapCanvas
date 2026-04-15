import { beforeAll, describe, expect, it } from "vitest";
import {
	hasRealAuthTestEnv,
	loginAndGetRealToken,
	requestWithRealEnv,
} from "../../test-utils/real-auth";

describe.skipIf(!hasRealAuthTestEnv())("real auth token integration", () => {
	let result: Awaited<ReturnType<typeof loginAndGetRealToken>>;

	beforeAll(async () => {
		result = await loginAndGetRealToken();
	});

	it("logs in with a real local account and returns a jwt token", () => {
		expect(result.token.length).toBeGreaterThan(20);
		expect(result.token.split(".")).toHaveLength(3);
	});

	it("returns the same real account identity in auth payload", async () => {
		const response = await requestWithRealEnv("http://localhost/auth/session", {
			method: "GET",
			headers: {
				authorization: `Bearer ${result.token}`,
			},
		});
		const payload = (await response.json()) as {
			authenticated?: boolean;
			user?: {
				sub?: string;
				login?: string;
				phone?: string | null;
			};
		};

		expect(response.status).toBe(200);
		expect(payload.authenticated).toBe(true);
		expect(payload.user?.sub).toBe(result.account.id);
		expect(payload.user?.login).toBe(result.account.login);
		expect(payload.user?.phone).toBe(result.account.phone);
	});

	it("uses the real token to access protected project api", async () => {
		const response = await requestWithRealEnv("http://localhost/projects", {
			method: "GET",
			headers: {
				authorization: `Bearer ${result.token}`,
			},
		});
		const payload = (await response.json()) as Array<{
			id?: string;
			name?: string;
		}>;

		expect(response.status).toBe(200);
		expect(Array.isArray(payload)).toBe(true);
	});
});
