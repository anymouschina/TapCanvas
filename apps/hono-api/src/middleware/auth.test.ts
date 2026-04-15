import { describe, expect, it, vi } from "vitest";
import type { Next } from "hono";
import type { AppContext } from "../types";

const {
	getConfig,
	verifyJwtHS256,
	getCookie,
	resolveLocalDevRole,
	prisma,
} = vi.hoisted(() => ({
	getConfig: vi.fn(() => ({ jwtSecret: "test-secret" })),
	verifyJwtHS256: vi.fn(),
	getCookie: vi.fn(() => null),
	resolveLocalDevRole: vi.fn((_c: AppContext, role: string | null | undefined) =>
		typeof role === "string" ? role : null,
	),
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
	it("does not overwrite db role from token role", async () => {
		getConfig.mockReturnValue({ jwtSecret: "test-secret" });
		verifyJwtHS256.mockResolvedValue({
			sub: "u1",
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
		expect(prisma.users.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.not.objectContaining({ role: expect.anything() }),
			}),
		);

		const auth = c.get("auth") as unknown as { role?: string | null } | undefined;
		expect(auth?.role).toBe("admin");
	});
});
