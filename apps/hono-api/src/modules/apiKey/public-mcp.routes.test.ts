import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext, AppEnv, WorkerEnv } from "../../types";
import type { ApiKeyRow } from "./apiKey.repo";
import type { getApiKeyByHash, touchApiKeyLastUsedAt } from "./apiKey.repo";
import type { tryGetUserDbAuthState } from "../../middleware/auth";
import type { runAgentsBridgeChatTask } from "../task/task.agents-bridge";

// Keep the actual public router, MCP handler, bearer parsing, key hashing,
// authorization and scope middleware. Only external identity/storage and the
// agent executor are isolated: these tests cannot mint keys or generate assets.
const mocks = vi.hoisted(() => ({
	getApiKeyByHash: vi.fn<Parameters<typeof getApiKeyByHash>, ReturnType<typeof getApiKeyByHash>>(),
	touchApiKeyLastUsedAt: vi.fn<Parameters<typeof touchApiKeyLastUsedAt>, ReturnType<typeof touchApiKeyLastUsedAt>>(),
	tryGetUserDbAuthState: vi.fn<Parameters<typeof tryGetUserDbAuthState>, ReturnType<typeof tryGetUserDbAuthState>>(),
	runAgentsBridgeChatTask: vi.fn<Parameters<typeof runAgentsBridgeChatTask>, ReturnType<typeof runAgentsBridgeChatTask>>(),
}));

vi.mock("./apiKey.repo", async (importOriginal) => ({
	...await importOriginal<typeof import("./apiKey.repo")>(),
	getApiKeyByHash: mocks.getApiKeyByHash,
	touchApiKeyLastUsedAt: mocks.touchApiKeyLastUsedAt,
}));
vi.mock("../../middleware/auth", async (importOriginal) => ({
	...await importOriginal<typeof import("../../middleware/auth")>(),
	resolveAuth: vi.fn(async () => null),
	tryGetUserDbAuthState: mocks.tryGetUserDbAuthState,
}));
vi.mock("../auth/agents-cli-auth.routes", async (importOriginal) => ({
	...await importOriginal<typeof import("../auth/agents-cli-auth.routes")>(),
	resolveAgentsCliGrant: vi.fn(async () => null),
}));
vi.mock("../task/task.agents-bridge", async (importOriginal) => ({
	...await importOriginal<typeof import("../task/task.agents-bridge")>(),
	runAgentsBridgeChatTask: mocks.runAgentsBridgeChatTask,
}));

import { honoErrorHandler } from "../../middleware/error";
import { publicApiRouter } from "./apiKey.routes";
import { hashApiKeySecret } from "./apiKey.service";

const testSecret = "tc_sk_mcp_isolated_test_only";
const env = {} as WorkerEnv;
let key: ApiKeyRow;

function createApp() {
	const app = new Hono<AppEnv>();
	app.onError(honoErrorHandler);
	app.route("/public", publicApiRouter);
	return app;
}

function rpc(body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${testSecret}` }) {
	return createApp().request("http://local/public/mcp", {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
		body: JSON.stringify(body),
	}, env);
}

beforeEach(async () => {
	vi.clearAllMocks();
	const hash = await hashApiKeySecret(testSecret);
	key = {
		id: "mcp-test-key", owner_id: "mcp-test-user", label: "isolated MCP test",
		key_prefix: "tc_sk_mcp", key_hash: hash, allowed_origins: '["*"]',
		enabled: 1, kind: "user", billing_team_id: "personal_mcp-test-user",
		scopes: '["public:read","public:write","agent:execute"]',
		expires_at: null, revoked_at: null, rotated_from_id: null, last_used_at: null,
		created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
	};
	mocks.getApiKeyByHash.mockImplementation(async (_db, providedHash) => providedHash === hash ? key : null);
	mocks.touchApiKeyLastUsedAt.mockResolvedValue(undefined);
	mocks.tryGetUserDbAuthState.mockResolvedValue({ role: "user", disabled: false, deletedAt: null, hasPassword: false });
	mocks.runAgentsBridgeChatTask.mockResolvedValue({
		id: "isolated-mcp-task", kind: "chat", status: "succeeded", assets: [], raw: { text: "隔离测试：小T连接正常" },
	});
});

describe("/public/mcp real router with isolated storage and agent", () => {
	it("initializes, accepts initialized notification, discovers tools and calls ask_tapcanvas", async () => {
		const initialized = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
			protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "isolated-client", version: "1" },
		} });
		expect(initialized.status).toBe(200);
		expect(initialized.headers.get("content-type")).toContain("application/json");
		expect(await initialized.json()).toMatchObject({ jsonrpc: "2.0", id: 1, result: {
			protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "TapCanvas" },
		} });
		const notification = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
		expect(notification.status).toBe(202);
		expect(await notification.text()).toBe("");
		const tools = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
		expect(tools.status).toBe(200);
		expect(await tools.json()).toMatchObject({ id: 2, result: { tools: [{ name: "ask_tapcanvas", inputSchema: { required: ["message"] } }] } });
		expect(mocks.runAgentsBridgeChatTask).not.toHaveBeenCalled();
		const called = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: {
			name: "ask_tapcanvas", arguments: { message: "你好，请确认连接" },
		} });
		expect(called.status).toBe(200);
		expect(await called.json()).toEqual({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: "隔离测试：小T连接正常" }] } });
		expect(mocks.runAgentsBridgeChatTask).toHaveBeenCalledOnce();
		expect(mocks.runAgentsBridgeChatTask).toHaveBeenCalledWith(expect.anything(), "mcp-test-user", {
			kind: "chat", prompt: "你好，请确认连接", extras: { diagnosticsLabel: "public_mcp.ask_tapcanvas" },
		});
		const context: AppContext = mocks.runAgentsBridgeChatTask.mock.calls[0][0];
		expect(context.get("apiKeyId")).toBe("mcp-test-key");
		expect(context.get("apiKeyBillingTeamId")).toBe("personal_mcp-test-user");
		expect(context.get("publicApi")).toBe(true);
	});

	it.each([
		["missing", {}],
		["invalid", { Authorization: "Bearer tc_sk_unknown" }],
	] as const)("rejects %s credentials before invoking an agent", async (_name, headers) => {
		const response = await rpc({ id: 1, method: "tools/list" }, headers);
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ code: "Authorization" in headers ? "api_key_invalid" : "auth_missing" });
		expect(mocks.runAgentsBridgeChatTask).not.toHaveBeenCalled();
	});

	it.each(["disabled", "revoked", "expired"])("rejects a %s key", async (state) => {
		if (state === "disabled") key.enabled = 0;
		if (state === "revoked") key.revoked_at = "2020-01-01T00:00:00Z";
		if (state === "expired") key.expires_at = "2020-01-01T00:00:00Z";
		const response = await rpc({ id: 1, method: "tools/list" });
		expect(response.status).toBe(401);
		expect(mocks.runAgentsBridgeChatTask).not.toHaveBeenCalled();
	});

	it.each(["initialize", "tools/list", "tools/call"])("requires agent:execute for %s", async (method) => {
		key.scopes = '["public:read","public:write"]';
		const response = await rpc({ id: 1, method, params: { name: "ask_tapcanvas", arguments: { message: "hello" } } });
		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ code: "api_key_scope_forbidden", details: { required: "agent:execute" } });
		expect(mocks.runAgentsBridgeChatTask).not.toHaveBeenCalled();
	});

	it("allows MCP with only agent:execute scope", async () => {
		key.scopes = '["agent:execute"]';
		const response = await rpc({ id: 1, method: "tools/list" });
		expect(response.status).toBe(200);
	});

	it("enforces an origin allowlist on the actual route", async () => {
		key.allowed_origins = '["https://trusted.example"]';
		const response = await rpc({ id: 1, method: "tools/list" }, { Authorization: `Bearer ${testSecret}`, Origin: "https://untrusted.example" });
		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ code: "api_key_origin_forbidden" });
		expect(mocks.runAgentsBridgeChatTask).not.toHaveBeenCalled();
	});

	it("returns MCP tool errors without claiming success when the agent fails", async () => {
		mocks.runAgentsBridgeChatTask.mockRejectedValueOnce(new Error("isolated bridge unavailable"));
		const response = await rpc({ id: 1, method: "tools/call", params: { name: "ask_tapcanvas", arguments: { message: "hello" } } });
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ id: 1, result: { isError: true, content: [{ type: "text", text: "工具执行失败：isolated bridge unavailable" }] } });
	});

	it("rejects malformed JSON before invoking an agent", async () => {
		const response = await createApp().request("http://local/public/mcp", { method: "POST", headers: { Authorization: `Bearer ${testSecret}`, "Content-Type": "application/json" }, body: "{" }, env);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code: -32700 } });
		expect(mocks.runAgentsBridgeChatTask).not.toHaveBeenCalled();
	});

	it("returns 405 for unsupported server-to-client SSE GET", async () => {
		const response = await createApp().request("http://local/public/mcp", { headers: { Authorization: `Bearer ${testSecret}` } }, env);
		expect(response.status).toBe(405);
		expect(mocks.runAgentsBridgeChatTask).not.toHaveBeenCalled();
	});
});
