import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

const {
	ensurePersonalBillingTeamOnLogin,
	signJwtHS256,
	resolveLocalDevRole,
	getConfig,
	fetchWithHttpDebugLog,
	createAuthSession,
	bindReferrerOnRegister,
	prisma,
} = vi.hoisted(() => ({
	ensurePersonalBillingTeamOnLogin: vi.fn(async () => undefined),
	signJwtHS256: vi.fn(async () => "mock-token"),
	resolveLocalDevRole: vi.fn((_c: AppContext, role: string | null) => role),
	getConfig: vi.fn(() => ({
		jwtSecret: "test-secret",
		githubClientId: "gh-client",
		githubClientSecret: "gh-secret",
	})),
	fetchWithHttpDebugLog: vi.fn(),
	createAuthSession: vi.fn(async () => ({
		id: "session-test-1",
		ttlSeconds: 7 * 24 * 60 * 60,
	})),
	bindReferrerOnRegister: vi.fn(async () => ({ bound: false, reason: "missing_ref_code" })),
	prisma: {
		email_login_codes: {
			findFirst: vi.fn(),
			update: vi.fn(),
		},
		users: {
			findFirst: vi.fn(),
			findMany: vi.fn(),
			findUnique: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
		},
	},
}));

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => prisma,
}));

vi.mock("../team/team.service", () => ({
	ensurePersonalBillingTeamOnLogin,
}));

vi.mock("../../jwt", () => ({
	signJwtHS256,
}));

vi.mock("./local-admin", () => ({
	resolveLocalDevRole,
}));

vi.mock("../../config", () => ({
	getConfig,
}));

vi.mock("../../httpDebugLog", () => ({
	fetchWithHttpDebugLog,
}));

vi.mock("./auth-session.service", () => ({
	createAuthSession,
}));

vi.mock("../referral/referral.service", () => ({
	bindReferrerOnRegister,
}));
import {
	exchangeGithubCode,
	loginWithCredentials,
	verifyEmailLoginCode,
} from "./auth.service";
import { createPasswordRecord } from "./password";

function createContext(): AppContext {
	return {
		env: { JWT_SECRET: "test-secret" } as AppContext["env"],
		req: {
			header: () => undefined,
			url: "https://example.com/auth/test",
		} as unknown as AppContext["req"],
		json: (body: unknown, status?: number) =>
			new Response(JSON.stringify(body), { status: status ?? 200 }),
		get: () => undefined,
		set: () => undefined,
	} as unknown as AppContext;
}

function createJsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

const VALID_CODE_HASH =
	"648dc2222b8515140569af73c3b6c8e7ac28a8db46a82cf9ea4173c469f89986";

describe("auth login bonus wiring", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getConfig.mockReturnValue({
			jwtSecret: "test-secret",
			githubClientId: "gh-client",
			githubClientSecret: "gh-secret",
		});
		resolveLocalDevRole.mockImplementation((_c: AppContext, role: string | null) => role);
		signJwtHS256.mockResolvedValue("mock-token");
		createAuthSession.mockResolvedValue({
			id: "session-test-1",
			ttlSeconds: 7 * 24 * 60 * 60,
		});
		bindReferrerOnRegister.mockResolvedValue({ bound: false, reason: "missing_ref_code" });
		ensurePersonalBillingTeamOnLogin.mockResolvedValue(undefined);
		prisma.email_login_codes.findFirst.mockResolvedValue({
			id: "otp_email_1",
			code_salt: "salt-1",
			code_hash: VALID_CODE_HASH,
			expires_at: "2099-01-01T00:00:00.000Z",
		});
		prisma.email_login_codes.update.mockResolvedValue(undefined);
		prisma.users.create.mockResolvedValue(undefined);
		prisma.users.update.mockResolvedValue(undefined);
		prisma.users.findFirst.mockResolvedValue(null);
	});

	it("grants signup bonus immediately when email login creates a user", async () => {
		prisma.users.findUnique
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ role: null });

		const result = await verifyEmailLoginCode(
			createContext(),
			"new-user@example.com",
			"123456",
		);

		expect(prisma.users.create).toHaveBeenCalledTimes(1);
		expect(ensurePersonalBillingTeamOnLogin).toHaveBeenCalledTimes(1);
		expect(ensurePersonalBillingTeamOnLogin).toHaveBeenCalledWith(
			expect.anything(),
			expect.stringMatching(/^email_/),
		);
		expect(result).toMatchObject({
			token: "mock-token",
			refreshToken: "mock-token",
			accessTokenExpiresInSeconds: 30 * 60,
			refreshTokenExpiresInSeconds: 7 * 24 * 60 * 60,
		});
		expect(createAuthSession).toHaveBeenCalledWith(
			expect.anything(),
			expect.stringMatching(/^email_/),
		);
		expect(signJwtHS256).toHaveBeenCalledWith(
			expect.objectContaining({ sid: "session-test-1", tokenUse: "access" }),
			"test-secret",
			30 * 60,
		);
		expect(signJwtHS256).toHaveBeenCalledWith(
			expect.objectContaining({ sid: "session-test-1", tokenUse: "refresh" }),
			"test-secret",
			7 * 24 * 60 * 60,
		);
	});

	it("still runs bonus reconciliation on repeat email login without recreating user", async () => {
		prisma.users.findUnique
			.mockResolvedValueOnce({ id: "email_existing" })
			.mockResolvedValueOnce({ role: null });

		await verifyEmailLoginCode(
			createContext(),
			"existing-user@example.com",
			"123456",
		);

		expect(prisma.users.create).not.toHaveBeenCalled();
		expect(prisma.users.update).toHaveBeenCalled();
		expect(ensurePersonalBillingTeamOnLogin).toHaveBeenCalledTimes(1);
	});

	it("does not clear existing role on repeat email login", async () => {
		prisma.users.findUnique
			.mockResolvedValueOnce({ id: "email_existing", role: "admin" })
			.mockResolvedValueOnce({ role: "admin", password_hash: null });

		await verifyEmailLoginCode(
			createContext(),
			"existing-user@example.com",
			"123456",
		);

		expect(prisma.users.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ role: "admin" }),
			}),
		);
	});

	it("grants signup bonus immediately when github login creates a user", async () => {
		fetchWithHttpDebugLog
			.mockResolvedValueOnce(createJsonResponse({ access_token: "gh-token" }))
			.mockResolvedValueOnce(
				createJsonResponse({
					id: 12345,
					login: "octocat",
					name: "The Octocat",
					avatar_url: "https://example.com/octocat.png",
				}),
			)
			.mockResolvedValueOnce(
				createJsonResponse([{ email: "octocat@github.test", primary: true }]),
			);
		prisma.users.findUnique
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ role: null });

		const result = await exchangeGithubCode(createContext(), "github-code");

		expect(fetchWithHttpDebugLog).toHaveBeenCalledTimes(3);
		expect(prisma.users.create).toHaveBeenCalledTimes(1);
		expect(ensurePersonalBillingTeamOnLogin).toHaveBeenCalledWith(
			expect.anything(),
			"12345",
		);
		expect(result).toMatchObject({
			token: "mock-token",
			user: expect.objectContaining({ login: "octocat" }),
		});
	});

	it("supports username password login when password is configured", async () => {
		const passwordRecord = await createPasswordRecord("123456");
		prisma.users.findMany.mockResolvedValue([{
			id: "tapcanvas_admin",
			login: "admin",
			name: "TapCanvas Admin",
			avatar_url: null,
			email: null,
			phone: "+8613800138000",
			guest: 0,
			disabled: 0,
			password_hash: passwordRecord.hash,
			password_salt: passwordRecord.salt,
		}]);
		prisma.users.findUnique.mockResolvedValue({ role: "admin", password_hash: passwordRecord.hash });

		const result = await loginWithCredentials(
			createContext(),
			"admin",
			"123456",
		);

		expect(prisma.users.update).toHaveBeenCalled();
		expect(result).toMatchObject({
			token: "mock-token",
			user: expect.objectContaining({ login: "admin", hasPassword: true, role: "admin" }),
		});
	});

});
