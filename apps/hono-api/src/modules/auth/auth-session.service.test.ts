import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

type SessionRow = {
	id: string;
	user_id: string;
	revoked_at: string | null;
	expires_at: string;
	last_seen_at: string;
};

const {
	getConfig,
	readAccountSettings,
	authSessions,
	queryRaw,
	prisma,
} = vi.hoisted(() => {
	const authSessionsMock = {
		findUnique: vi.fn(async (_args: unknown): Promise<SessionRow | null> => null),
		updateMany: vi.fn(async (_args: unknown) => ({ count: 0 })),
		create: vi.fn(async (_args: unknown) => undefined),
		findMany: vi.fn(async (_args: unknown): Promise<Array<{ id: string }>> => []),
	};
	const queryRawMock = vi.fn(
		async (_query: TemplateStringsArray, ..._values: unknown[]) => [
			{ id: "user-1" },
		],
	);
	const prismaMock = {
		auth_sessions: authSessionsMock,
		$queryRaw: queryRawMock,
		$transaction: vi.fn(
			async (
				run: (tx: {
					auth_sessions: typeof authSessionsMock;
					$queryRaw: typeof queryRawMock;
				}) => Promise<void>,
			) => run({ auth_sessions: authSessionsMock, $queryRaw: queryRawMock }),
		),
	};
	return {
		getConfig: vi.fn(() => ({ jwtSecret: "session-test-secret" })),
		readAccountSettings: vi.fn(async () => ({
			configured: false,
			settings: null,
			effectiveSessionTtlDays: 7,
			effectiveMaxActiveSessions: 10,
		})),
		authSessions: authSessionsMock,
		queryRaw: queryRawMock,
		prisma: prismaMock,
	};
});

vi.mock("../../config", () => ({ getConfig }));
vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => prisma,
}));
vi.mock("../account/account.settings", () => ({
	DEFAULT_SESSION_TTL_DAYS: 7,
	DEFAULT_MAX_ACTIVE_SESSIONS: 10,
	readAccountSettings,
}));

import {
	createAuthSession,
	renewAuthSession,
	validateAuthSession,
} from "./auth-session.service";

const NOW_ISO = "2026-07-22T08:00:00.000Z";
const SESSION_ID = "session-1";
const USER_ID = "user-1";

function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
	return {
		id: SESSION_ID,
		user_id: USER_ID,
		revoked_at: null,
		expires_at: "2026-07-23T08:00:00.000Z",
		last_seen_at: NOW_ISO,
		...overrides,
	};
}

function createContext(headers: Record<string, string> = {}): AppContext {
	const normalized = new Map(
		Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
	);
	return {
		env: {} as AppContext["env"],
		req: {
			header: (name: string) => normalized.get(name.toLowerCase()),
		} as unknown as AppContext["req"],
		get: () => undefined,
		set: () => undefined,
	} as unknown as AppContext;
}

describe("auth-session service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date(NOW_ISO));
		authSessions.findUnique.mockResolvedValue(null);
		authSessions.updateMany.mockResolvedValue({ count: 0 });
		authSessions.create.mockResolvedValue(undefined);
		authSessions.findMany.mockResolvedValue([]);
		readAccountSettings.mockResolvedValue({
			configured: false,
			settings: null,
			effectiveSessionTtlDays: 7,
			effectiveMaxActiveSessions: 10,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("rejects a missing session id without querying storage", async () => {
		await expect(validateAuthSession(USER_ID, undefined)).resolves.toEqual({
			valid: false,
			code: "session_missing",
		});
		expect(authSessions.findUnique).not.toHaveBeenCalled();
	});

	it("rejects a session id that does not exist", async () => {
		await expect(validateAuthSession(USER_ID, SESSION_ID)).resolves.toEqual({
			valid: false,
			code: "session_missing",
		});
		expect(authSessions.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: SESSION_ID } }),
		);
	});

	it("rejects a session owned by another user", async () => {
		authSessions.findUnique.mockResolvedValue(
			sessionRow({ user_id: "different-user" }),
		);

		await expect(validateAuthSession(USER_ID, SESSION_ID)).resolves.toEqual({
			valid: false,
			code: "session_owner_mismatch",
		});
		expect(authSessions.updateMany).not.toHaveBeenCalled();
	});

	it("rejects a revoked session", async () => {
		authSessions.findUnique.mockResolvedValue(
			sessionRow({ revoked_at: "2026-07-22T07:00:00.000Z" }),
		);

		await expect(validateAuthSession(USER_ID, SESSION_ID)).resolves.toEqual({
			valid: false,
			code: "session_revoked",
		});
		expect(authSessions.updateMany).not.toHaveBeenCalled();
	});

	it("rejects a session whose expiry is equal to the current time", async () => {
		authSessions.findUnique.mockResolvedValue(
			sessionRow({ expires_at: NOW_ISO }),
		);

		await expect(validateAuthSession(USER_ID, SESSION_ID)).resolves.toEqual({
			valid: false,
			code: "session_expired",
		});
		expect(authSessions.updateMany).not.toHaveBeenCalled();
	});

	it("accepts a valid recently seen session", async () => {
		authSessions.findUnique.mockResolvedValue(sessionRow());

		await expect(validateAuthSession(USER_ID, SESSION_ID)).resolves.toEqual({
			valid: true,
			id: SESSION_ID,
		});
	});

	it("touches last_seen_at when the five-minute interval is reached", async () => {
		authSessions.findUnique.mockResolvedValue(
			sessionRow({ last_seen_at: "2026-07-22T07:55:00.000Z" }),
		);

		await expect(validateAuthSession(USER_ID, SESSION_ID)).resolves.toEqual({
			valid: true,
			id: SESSION_ID,
		});
		expect(authSessions.updateMany).toHaveBeenCalledWith({
			where: { id: SESSION_ID, revoked_at: null },
			data: { last_seen_at: NOW_ISO },
		});
	});

	it("does not touch last_seen_at before the five-minute interval", async () => {
		authSessions.findUnique.mockResolvedValue(
			sessionRow({ last_seen_at: "2026-07-22T07:55:00.001Z" }),
		);

		await expect(validateAuthSession(USER_ID, SESSION_ID)).resolves.toEqual({
			valid: true,
			id: SESSION_ID,
		});
		expect(authSessions.updateMany).not.toHaveBeenCalled();
	});

	it("renews an active session with the current platform TTL", async () => {
		readAccountSettings.mockResolvedValue({
			configured: true,
			settings: null,
			effectiveSessionTtlDays: 30,
			effectiveMaxActiveSessions: 10,
		});
		authSessions.updateMany.mockResolvedValue({ count: 1 });

		await expect(
			renewAuthSession(createContext(), USER_ID, SESSION_ID),
		).resolves.toEqual({
			valid: true,
			id: SESSION_ID,
			ttlSeconds: 30 * 24 * 60 * 60,
		});
		expect(authSessions.updateMany).toHaveBeenCalledWith({
			where: {
				id: SESSION_ID,
				user_id: USER_ID,
				revoked_at: null,
				expires_at: { gt: NOW_ISO },
			},
			data: {
				last_seen_at: NOW_ISO,
				expires_at: "2026-08-21T08:00:00.000Z",
			},
		});
	});

	it("does not revive an expired session during renewal", async () => {
		authSessions.updateMany.mockResolvedValue({ count: 0 });
		authSessions.findUnique.mockResolvedValue(
			sessionRow({ expires_at: NOW_ISO }),
		);

		await expect(
			renewAuthSession(createContext(), USER_ID, SESSION_ID),
		).resolves.toEqual({ valid: false, code: "session_expired" });
	});

	it("serializes creation and converges reduced limits without revoking the new session", async () => {
		vi.spyOn(crypto, "randomUUID").mockReturnValue(
			"11111111-1111-4111-8111-111111111111",
		);
		readAccountSettings.mockResolvedValue({
			configured: true,
			settings: null,
			effectiveSessionTtlDays: 30,
			effectiveMaxActiveSessions: 2,
		});
		authSessions.findMany.mockResolvedValue([
			{ id: "session-current-2" },
			{ id: "session-overflow-1" },
			{ id: "session-overflow-2" },
			{ id: "session-overflow-3" },
		]);

		const result = await createAuthSession(
			createContext({
				"user-agent": "Mozilla/5.0 (Mac OS X) Chrome/126.0 Safari/537.36",
				"cf-connecting-ip": "203.0.113.10",
			}),
			USER_ID,
		);

		expect(result).toEqual({
			id: "11111111-1111-4111-8111-111111111111",
			ttlSeconds: 30 * 24 * 60 * 60,
		});
		expect(prisma.$transaction).toHaveBeenCalledTimes(1);
		expect(queryRaw).toHaveBeenCalledTimes(1);
		const [lockSql, lockUserId] = queryRaw.mock.calls[0];
		expect(Array.from(lockSql).join("?")).toContain(
			'SELECT "id"\n\t\t\tFROM "users"\n\t\t\tWHERE "id" = ?\n\t\t\tFOR UPDATE',
		);
		expect(lockUserId).toBe(USER_ID);
		expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
			authSessions.create.mock.invocationCallOrder[0],
		);
		expect(authSessions.create).toHaveBeenCalledWith({
			data: {
				id: "11111111-1111-4111-8111-111111111111",
				user_id: USER_ID,
				device_label: "Chrome · macOS",
				user_agent: "Mozilla/5.0 (Mac OS X) Chrome/126.0 Safari/537.36",
				network_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
				created_at: NOW_ISO,
				last_seen_at: NOW_ISO,
				expires_at: "2026-08-21T08:00:00.000Z",
			},
		});
		expect(authSessions.findMany).toHaveBeenCalledWith({
			where: {
				user_id: USER_ID,
				id: { not: "11111111-1111-4111-8111-111111111111" },
				revoked_at: null,
				expires_at: { gt: NOW_ISO },
			},
			orderBy: [
				{ last_seen_at: "desc" },
				{ created_at: "desc" },
				{ id: "desc" },
			],
			select: { id: true },
		});
		expect(authSessions.updateMany).toHaveBeenCalledWith({
			where: {
				id: {
					in: [
						"session-overflow-1",
						"session-overflow-2",
						"session-overflow-3",
					],
				},
				revoked_at: null,
			},
			data: { revoked_at: NOW_ISO, revoked_reason: "session_limit" },
		});
	});
});
