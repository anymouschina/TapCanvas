import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

const {
	grantSignupBonusToPersonalTeam,
	signJwtHS256,
	resolveLocalDevRole,
	getConfig,
	fetchWithHttpDebugLog,
	prisma,
} = vi.hoisted(() => ({
	grantSignupBonusToPersonalTeam: vi.fn(async () => undefined),
	signJwtHS256: vi.fn(async () => "mock-token"),
	resolveLocalDevRole: vi.fn((_c: AppContext, role: string | null) => role),
	getConfig: vi.fn(() => ({
		jwtSecret: "test-secret",
		githubClientId: "gh-client",
		githubClientSecret: "gh-secret",
	})),
	fetchWithHttpDebugLog: vi.fn(),
	prisma: {
		email_login_codes: {
			findFirst: vi.fn(),
			update: vi.fn(),
		},
		phone_login_codes: {
			findFirst: vi.fn(),
			updateMany: vi.fn(),
		},
		users: {
			findFirst: vi.fn(),
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
	grantSignupBonusToPersonalTeam,
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
import {
	exchangeGithubCode,
	loginWithPhonePassword,
	setPasswordForAuthenticatedUser,
	verifyEmailLoginCode,
	verifyPhoneLoginCode,
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
		grantSignupBonusToPersonalTeam.mockResolvedValue(undefined);
		prisma.email_login_codes.findFirst.mockResolvedValue({
			id: "otp_email_1",
			code_salt: "salt-1",
			code_hash: VALID_CODE_HASH,
			expires_at: "2099-01-01T00:00:00.000Z",
		});
		prisma.email_login_codes.update.mockResolvedValue(undefined);
		prisma.phone_login_codes.findFirst.mockResolvedValue({
			id: "otp_phone_1",
			code_salt: "salt-1",
			code_hash: VALID_CODE_HASH,
			created_at: "2099-01-01T00:00:00.000Z",
		});
		prisma.phone_login_codes.updateMany.mockResolvedValue({ count: 1 });
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
		expect(grantSignupBonusToPersonalTeam).toHaveBeenCalledTimes(1);
		expect(grantSignupBonusToPersonalTeam).toHaveBeenCalledWith(
			expect.anything(),
			expect.stringMatching(/^email_/),
		);
		expect(result).toMatchObject({ token: "mock-token" });
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
		expect(grantSignupBonusToPersonalTeam).toHaveBeenCalledTimes(1);
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
		expect(grantSignupBonusToPersonalTeam).toHaveBeenCalledWith(
			expect.anything(),
			"12345",
		);
		expect(result).toMatchObject({
			token: "mock-token",
			user: expect.objectContaining({ login: "octocat" }),
		});
	});

	it("grants signup bonus immediately when phone login creates a user", async () => {
		prisma.users.findUnique
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ role: null, password_hash: null });

		const result = await verifyPhoneLoginCode(
			createContext(),
			"13800138000",
			"123456",
		);

		expect(prisma.phone_login_codes.updateMany).toHaveBeenCalledTimes(1);
		expect(prisma.users.create).toHaveBeenCalledTimes(1);
		expect(grantSignupBonusToPersonalTeam).toHaveBeenCalledTimes(1);
		expect(grantSignupBonusToPersonalTeam).toHaveBeenCalledWith(
			expect.anything(),
			expect.stringMatching(/^phone_/),
		);
		expect(result).toMatchObject({
			token: "mock-token",
			user: expect.objectContaining({ login: "phone_8000", phone: "+8613800138000", hasPassword: false }),
		});
	});

	it("supports phone password login when password is configured", async () => {
		const passwordRecord = await createPasswordRecord("12345678");
		prisma.users.findFirst.mockResolvedValue({
			id: "phone_user_1",
			login: "phone_8000",
			name: "phone_8000",
			avatar_url: null,
			email: null,
			phone: "+8613800138000",
			guest: 0,
			disabled: 0,
			password_hash: passwordRecord.hash,
			password_salt: passwordRecord.salt,
		});
		prisma.users.findUnique.mockResolvedValue({ role: null, password_hash: passwordRecord.hash });

		const result = await loginWithPhonePassword(
			createContext(),
			"13800138000",
			"12345678",
		);

		expect(prisma.users.update).toHaveBeenCalled();
		expect(result).toMatchObject({
			token: "mock-token",
			user: expect.objectContaining({ login: "phone_8000", hasPassword: true }),
		});
	});

	it("sets password for authenticated phone user and returns refreshed auth payload", async () => {
		const context = {
			...createContext(),
			get: (key: string) => {
				if (key === "auth") {
					return {
						sub: "phone_user_1",
						login: "phone_8000",
						phone: "+8613800138000",
					};
				}
				return undefined;
			},
		} as AppContext;

		prisma.users.findUnique
			.mockResolvedValueOnce({
				id: "phone_user_1",
				login: "phone_8000",
				name: "phone_8000",
				avatar_url: null,
				email: null,
				phone: "+8613800138000",
				guest: 0,
				disabled: 0,
				deleted_at: null,
			})
			.mockResolvedValueOnce({ role: null, password_hash: "new-password-hash" });

		const result = await setPasswordForAuthenticatedUser(context, "12345678");

		expect(prisma.users.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "phone_user_1" },
				data: expect.objectContaining({
					password_hash: expect.any(String),
					password_salt: expect.any(String),
				}),
			}),
		);
		expect(result).toMatchObject({
			token: "mock-token",
			user: expect.objectContaining({ hasPassword: true, phone: "+8613800138000" }),
		});
	});
});
