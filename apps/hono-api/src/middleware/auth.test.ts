import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Next } from "hono";
import type { AppContext } from "../types";

const {
	getConfig,
	verifyJwtHS256,
	getCookie,
	resolveLocalDevRole,
	validateAuthSession,
	resolveApiKeyRowFromRequest,
	touchApiKeyLastUsedAt,
	prisma,
} = vi.hoisted(() => ({
	getConfig: vi.fn(() => ({ jwtSecret: "test-secret" })),
	verifyJwtHS256: vi.fn(),
	getCookie: vi.fn(() => null),
	resolveLocalDevRole: vi.fn((_c: AppContext, role: string | null | undefined) =>
		typeof role === "string" ? role : null,
	),
	validateAuthSession: vi.fn(
		async (_userId: string, sessionId: string | undefined) =>
			sessionId
				? { valid: true as const, id: sessionId }
				: { valid: false as const, code: "session_missing" as const },
	),
	resolveApiKeyRowFromRequest: vi.fn(),
	touchApiKeyLastUsedAt: vi.fn(async () => undefined),
	prisma: {
		users: {
			findUnique: vi.fn(),
			update: vi.fn(),
			create: vi.fn(),
		},
	},
}));

vi.mock("../config", () => ({ getConfig }));
vi.mock("../jwt", () => ({ verifyJwtHS256 }));
vi.mock("hono/cookie", () => ({ getCookie }));
vi.mock("../platform/node/prisma", () => ({ getPrismaClient: () => prisma }));
vi.mock("../modules/auth/local-admin", () => ({ resolveLocalDevRole }));
vi.mock("../modules/auth/auth-session.service", () => ({ validateAuthSession }));
vi.mock("../modules/apiKey/apiKey-auth-resolver", () => ({ resolveApiKeyRowFromRequest }));
vi.mock("../modules/apiKey/apiKey.repo", () => ({ touchApiKeyLastUsedAt }));
import { authMiddleware } from "./auth";

function makeCtx(input: {
	url?: string;
	headers?: Record<string, string>;
}): AppContext {
	const headers = new Map<string, string>();
	Object.entries(input.headers || {}).forEach(([k, v]) => headers.set(k.toLowerCase(), v));

	const store = new Map<string, unknown>();
	return {
		env: { DB: {} } as AppContext["env"],
		req: {
			url: input.url || "https://example.com/api/test",
			header: (name: string) => headers.get(name.toLowerCase()),
		} as AppContext["req"],
		json: (body: unknown, status?: number) =>
			new Response(JSON.stringify(body), { status: status ?? 200 }),
		get: (key: string) => store.get(key),
		set: (key: string, value: unknown) => {
			store.set(key, value);
		},
	} as unknown as AppContext;
}

describe("authMiddleware role persistence", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resolveApiKeyRowFromRequest.mockResolvedValue(null);
	});

	it("does not overwrite db role from token role", async () => {
		getConfig.mockReturnValue({ jwtSecret: "test-secret" });
		verifyJwtHS256.mockResolvedValue({
			sub: "u1",
			sid: "session-u1",
			tokenUse: "access",
			login: "user1",
			role: null,
			guest: false,
		});

		prisma.users.findUnique.mockResolvedValueOnce({ id: "u1" });
		prisma.users.update.mockResolvedValueOnce(undefined);
		prisma.users.findUnique.mockResolvedValueOnce({
			role: "admin",
			disabled: 0,
			deleted_at: null,
			password_hash: "",
		});

		const c = makeCtx({
			headers: { authorization: "Bearer t" },
		});

		const next: Next = async () => undefined;
		const res = await authMiddleware(c, next);

		expect(res).toBeUndefined();
		expect(validateAuthSession).toHaveBeenCalledWith("u1", "session-u1");
		expect(prisma.users.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.not.objectContaining({ role: expect.anything() }),
			}),
		);

		const auth = c.get("auth") as unknown as { role?: string | null } | undefined;
		expect(auth?.role).toBe("admin");
	});

	it("rejects a valid JWT that has no session id", async () => {
		verifyJwtHS256.mockResolvedValue({
			sub: "u1",
			tokenUse: "access",
			login: "user1",
			role: null,
			guest: false,
		});

		const c = makeCtx({
			headers: { authorization: "Bearer legacy-token" },
		});

		await expect(authMiddleware(c, async () => undefined)).rejects.toMatchObject({
			status: 401,
			code: "session_missing",
		});
		expect(validateAuthSession).toHaveBeenCalledWith("u1", undefined);
		expect(prisma.users.findUnique).not.toHaveBeenCalled();
	});

	it("accepts an enabled user API key as the same full user identity", async () => {
		verifyJwtHS256.mockResolvedValue(null);
		resolveApiKeyRowFromRequest.mockResolvedValue({
			id: "key-1",
			owner_id: "u-cli",
			label: "TapCanvas CLI",
			key_prefix: "tc_sk_test",
			key_hash: "hash",
			allowed_origins: "[\"*\"]",
			enabled: 1,
			kind: "user",
			billing_team_id: "personal_u-cli",
			last_used_at: null,
			created_at: "2026-08-11T00:00:00.000Z",
			updated_at: "2026-08-11T00:00:00.000Z",
		});
		prisma.users.findUnique.mockResolvedValueOnce({
			role: "admin",
			disabled: 0,
			deleted_at: null,
			password_hash: "hash",
		});
		const next = vi.fn(async () => undefined);
		const c = makeCtx({
			headers: {
				authorization: "Bearer tc_sk_test-only",
				"x-team-id": "personal_u-cli",
			},
		});

		await expect(authMiddleware(c, next)).resolves.toBeUndefined();

		expect(next).toHaveBeenCalledOnce();
		expect(c.get("userId")).toBe("u-cli");
		expect(c.get("apiKeyId")).toBe("key-1");
		expect(c.get("apiKeyOwnerId")).toBe("u-cli");
		expect(c.get("apiKeyBillingTeamId")).toBe("personal_u-cli");
		expect(c.get("activeTeamId")).toBe("personal_u-cli");
		expect(c.get("auth")).toMatchObject({
			sub: "u-cli",
			role: "admin",
			hasPassword: true,
		});
		expect(touchApiKeyLastUsedAt).toHaveBeenCalledWith(
			{},
			"key-1",
			expect.any(String),
		);
	});
});
