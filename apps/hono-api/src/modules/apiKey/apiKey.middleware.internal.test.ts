import { describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

const {
	tryGetUserDbAuthState,
	getApiKeyByIdForOwner,
	touchApiKeyLastUsedAt,
} = vi.hoisted(() => ({
	tryGetUserDbAuthState: vi.fn(),
	getApiKeyByIdForOwner: vi.fn(),
	touchApiKeyLastUsedAt: vi.fn(),
}));

vi.mock("../../middleware/auth", () => ({
	authMiddleware: vi.fn(async (_c, next: () => Promise<void>) => next()),
	resolveAuth: vi.fn(),
	tryGetUserDbAuthState,
}));

vi.mock("./apiKey.repo", () => ({
	getApiKeyByIdForOwner,
	touchApiKeyLastUsedAt,
}));

import { apiKeyAuthMiddleware } from "./apiKey.middleware";
import { buildInternalApiKey } from "./internal-api-key";

function delegatedKey(apiKeyId: string): string {
	const value = buildInternalApiKey({
		internalWorkerToken: "worker-secret",
		userId: "user-1",
		apiKeyId,
	});
	if (!value) throw new Error("test delegated key unavailable");
	return value;
}

function createContext(apiKey: string): AppContext {
	const store = new Map<string, unknown>();
	return {
		env: {
			DB: {},
			INTERNAL_WORKER_TOKEN: "worker-secret",
		} as unknown as AppContext["env"],
		req: {
			url: "https://api.tapcanvas.test/public/agents/tools/execute",
			header: (name: string) => name.toLowerCase() === "x-api-key" ? apiKey : undefined,
		} as unknown as AppContext["req"],
		get: (key: string) => store.get(key),
		set: (key: string, value: unknown) => {
			store.set(key, value);
		},
	} as unknown as AppContext;
}

describe("apiKeyAuthMiddleware internal delegation", () => {
	it("restores the owner, role, billing team, and original API key attribution", async () => {
		tryGetUserDbAuthState.mockResolvedValue({
			role: "admin",
			disabled: false,
			deletedAt: null,
			hasPassword: true,
		});
		getApiKeyByIdForOwner.mockResolvedValue({
			id: "key-1",
			owner_id: "user-1",
			enabled: 1,
			billing_team_id: "personal_user-1",
		});
		touchApiKeyLastUsedAt.mockResolvedValue(undefined);
		const context = createContext(delegatedKey("key-1"));
		const next = vi.fn(async () => undefined);

		await apiKeyAuthMiddleware(context, next);

		expect(next).toHaveBeenCalledOnce();
		expect(context.get("userId")).toBe("user-1");
		expect(context.get("apiKeyOwnerId")).toBe("user-1");
		expect(context.get("apiKeyId")).toBe("key-1");
		expect(context.get("apiKeyBillingTeamId")).toBe("personal_user-1");
		expect(context.get("auth")).toMatchObject({
			sub: "user-1",
			role: "admin",
			hasPassword: true,
		});
	});

	it("rejects a delegation whose original API key was disabled", async () => {
		tryGetUserDbAuthState.mockResolvedValue({
			role: null,
			disabled: false,
			deletedAt: null,
			hasPassword: false,
		});
		getApiKeyByIdForOwner.mockResolvedValue({
			id: "key-1",
			owner_id: "user-1",
			enabled: 0,
			billing_team_id: null,
		});
		const next = vi.fn(async () => undefined);

		await expect(apiKeyAuthMiddleware(
			createContext(delegatedKey("key-1")),
			next,
		)).rejects.toMatchObject({
			status: 401,
			code: "internal_delegated_api_key_invalid",
		});
		expect(next).not.toHaveBeenCalled();
	});
});
