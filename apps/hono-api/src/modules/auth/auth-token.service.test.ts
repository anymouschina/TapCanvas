import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

const {
	getCookie,
	getConfig,
	signJwtHS256,
	verifyJwtHS256,
	renewAuthSession,
	resolveLocalDevRole,
	prisma,
} = vi.hoisted(() => ({
	getCookie: vi.fn(() => "refresh-cookie"),
	getConfig: vi.fn(() => ({ jwtSecret: "token-test-secret" })),
	signJwtHS256: vi.fn(async (payload: Record<string, unknown>) =>
		payload.tokenUse === "access" ? "access-jwt" : "refresh-jwt",
	),
	verifyJwtHS256: vi.fn(),
	renewAuthSession: vi.fn(async (): Promise<
		| { valid: true; id: string; ttlSeconds: number }
		| { valid: false; code: "session_revoked" }
	> => ({
		valid: true,
		id: "session-1",
		ttlSeconds: 7 * 24 * 60 * 60,
	})),
	resolveLocalDevRole: vi.fn((_c: AppContext, role: string | null) => role),
	prisma: {
		users: { findUnique: vi.fn() },
	},
}));

vi.mock("hono/cookie", () => ({ getCookie }));
vi.mock("../../config", () => ({ getConfig }));
vi.mock("../../jwt", () => ({ signJwtHS256, verifyJwtHS256 }));
vi.mock("../../platform/node/prisma", () => ({ getPrismaClient: () => prisma }));
vi.mock("./auth-session.service", () => ({ renewAuthSession }));
vi.mock("./local-admin", () => ({ resolveLocalDevRole }));

import {
	ACCESS_TOKEN_TTL_SECONDS,
	issueBrowserAuthTokens,
	refreshBrowserAuthSession,
} from "./auth-token.service";

function createContext(): AppContext {
	return {
		env: {} as AppContext["env"],
		req: { header: () => undefined } as unknown as AppContext["req"],
		get: () => undefined,
		set: () => undefined,
	} as unknown as AppContext;
}

const user = {
	sub: "user-1",
	login: "user1",
	name: "User One",
	avatarUrl: null,
	email: "user1@example.com",
	phone: null,
	hasPassword: true,
	role: "member",
	guest: false,
};

describe("browser auth token service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getCookie.mockReturnValue("refresh-cookie");
		verifyJwtHS256.mockResolvedValue({
			sub: "user-1",
			sid: "session-1",
			tokenUse: "refresh",
		});
		prisma.users.findUnique.mockResolvedValue({
			id: "user-1",
			login: "user1",
			name: "User One",
			avatar_url: null,
			email: "user1@example.com",
			phone: null,
			password_hash: "scrypt$record",
			role: "member",
			guest: 0,
			disabled: 0,
			deleted_at: null,
		});
	});

	it("issues distinct access and refresh JWT contracts", async () => {
		await expect(
			issueBrowserAuthTokens(createContext(), user, "session-1", 604800),
		).resolves.toEqual({
			accessToken: "access-jwt",
			refreshToken: "refresh-jwt",
			accessTokenExpiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
			refreshTokenExpiresInSeconds: 604800,
		});
		expect(signJwtHS256).toHaveBeenCalledWith(
			expect.objectContaining({ sid: "session-1", tokenUse: "access" }),
			"token-test-secret",
			ACCESS_TOKEN_TTL_SECONDS,
		);
		expect(signJwtHS256).toHaveBeenCalledWith(
			{ sub: "user-1", sid: "session-1", tokenUse: "refresh" },
			"token-test-secret",
			604800,
		);
	});

	it("renews the current device session and reissues both cookies from current user facts", async () => {
		const refreshed = await refreshBrowserAuthSession(createContext());

		expect(getCookie).toHaveBeenCalledWith(expect.anything(), "tap_refresh_token");
		expect(renewAuthSession).toHaveBeenCalledWith(
			expect.anything(),
			"user-1",
			"session-1",
		);
		expect(refreshed).toMatchObject({
			user: { sub: "user-1", login: "user1", role: "member" },
			tokens: { accessToken: "access-jwt", refreshToken: "refresh-jwt" },
		});
	});

	it("rejects an access token presented as a refresh token", async () => {
		verifyJwtHS256.mockResolvedValue({
			sub: "user-1",
			sid: "session-1",
			tokenUse: "access",
		});

		await expect(refreshBrowserAuthSession(createContext())).rejects.toMatchObject({
			status: 401,
			code: "refresh_token_invalid",
		});
		expect(renewAuthSession).not.toHaveBeenCalled();
	});

	it("does not issue new tokens after the device session has been revoked", async () => {
		renewAuthSession.mockResolvedValueOnce({
			valid: false,
			code: "session_revoked",
		});

		await expect(refreshBrowserAuthSession(createContext())).rejects.toMatchObject({
			status: 401,
			code: "session_revoked",
		});
		expect(signJwtHS256).not.toHaveBeenCalled();
	});
});
