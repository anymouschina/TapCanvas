import { describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";
import {
	createMcpToolCaller,
	handleMcpMessage,
	MCP_TOOLS,
	type McpChatTaskRunner,
	type McpToolCaller,
} from "./public-mcp";

const noopCaller: McpToolCaller = async () => ({ text: "ok" });

function requireRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("expected record");
	}
	return value as Record<string, unknown>;
}

function requireRpcResponse(
	value: Awaited<ReturnType<typeof handleMcpMessage>>,
): Record<string, unknown> {
	if (value === null) throw new Error("expected MCP response");
	return value;
}

function requireRpcResult(
	value: Awaited<ReturnType<typeof handleMcpMessage>>,
): Record<string, unknown> {
	return requireRecord(requireRpcResponse(value).result);
}

describe("handleMcpMessage — MCP 协议", () => {
	it("initialize 只声明服务端真实支持的版本与 tools capability", async () => {
		const response = await handleMcpMessage(
			{
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: { protocolVersion: "2025-06-18" },
			},
			noopCaller,
		);
		const result = requireRpcResult(response);
		expect(result.protocolVersion).toBe("2025-06-18");
		expect(requireRecord(result.capabilities).tools).toBeTruthy();
		expect(requireRecord(result.serverInfo).name).toBe("TapCanvas");
	});

	it("initialize 不回显尚未实现的 MCP 2026 客户端版本", async () => {
		const response = await handleMcpMessage(
			{
				id: 1,
				method: "initialize",
				params: { protocolVersion: "2026-07-28" },
			},
			noopCaller,
		);
		expect(requireRpcResult(response).protocolVersion).toBe("2025-06-18");
	});

	it("initialize 客户端没给版本时返回服务端版本", async () => {
		const response = await handleMcpMessage(
			{ id: 1, method: "initialize" },
			noopCaller,
		);
		expect(requireRpcResult(response).protocolVersion).toBe("2025-06-18");
	});

	it("notifications/initialized 不产生响应（返回 null → HTTP 202）", async () => {
		const response = await handleMcpMessage(
			{ method: "notifications/initialized" },
			noopCaller,
		);
		expect(response).toBeNull();
	});

	it("tools/list 暴露 ask_tapcanvas", async () => {
		const response = await handleMcpMessage(
			{ id: 2, method: "tools/list" },
			noopCaller,
		);
		const tools = requireRpcResult(response).tools;
		expect(tools).toEqual(MCP_TOOLS);
		expect(
			Array.isArray(tools)
				? tools.map((tool) => requireRecord(tool).name)
				: [],
		).toContain("ask_tapcanvas");
	});

	it("ping 返回空 result", async () => {
		const response = await handleMcpMessage(
			{ id: 3, method: "ping" },
			noopCaller,
		);
		expect(requireRpcResult(response)).toEqual({});
	});

	it("tools/call 已知工具会调用执行器并投影成 content", async () => {
		const caller = vi.fn(async () => ({ text: "你好，我是小T" }));
		const response = await handleMcpMessage(
			{
				id: 4,
				method: "tools/call",
				params: {
					name: "ask_tapcanvas",
					arguments: { message: "hi" },
				},
			},
			caller,
		);
		expect(caller).toHaveBeenCalledWith("ask_tapcanvas", {
			message: "hi",
		});
		const result = requireRpcResult(response);
		expect(result.isError).toBeUndefined();
		const content = result.content;
		expect(Array.isArray(content)).toBe(true);
		expect(requireRecord((content as unknown[])[0]).text).toBe(
			"你好，我是小T",
		);
	});

	it("tools/call 非对象 arguments 不会被强制断言成对象", async () => {
		const caller = vi.fn(async () => ({ text: "ok" }));
		await handleMcpMessage(
			{
				id: 41,
				method: "tools/call",
				params: { name: "ask_tapcanvas", arguments: ["bad"] },
			},
			caller,
		);
		expect(caller).toHaveBeenCalledWith("ask_tapcanvas", {});
	});

	it("tools/call 未知工具返回 JSON-RPC error -32602", async () => {
		const response = await handleMcpMessage(
			{
				id: 5,
				method: "tools/call",
				params: { name: "nope", arguments: {} },
			},
			noopCaller,
		);
		const error = requireRecord(requireRpcResponse(response).error);
		expect(error.code).toBe(-32602);
	});

	it("tools/call 执行抛错返回 result.isError", async () => {
		const caller: McpToolCaller = async () => {
			throw new Error("bridge down");
		};
		const response = await handleMcpMessage(
			{
				id: 6,
				method: "tools/call",
				params: {
					name: "ask_tapcanvas",
					arguments: { message: "x" },
				},
			},
			caller,
		);
		const result = requireRpcResult(response);
		expect(result.isError).toBe(true);
		const content = result.content;
		expect(Array.isArray(content)).toBe(true);
		expect(String(requireRecord((content as unknown[])[0]).text)).toContain(
			"bridge down",
		);
	});

	it("未知方法返回 -32601", async () => {
		const response = await handleMcpMessage(
			{ id: 7, method: "foo/bar" },
			noopCaller,
		);
		const error = requireRecord(requireRpcResponse(response).error);
		expect(error.code).toBe(-32601);
	});
});

describe("createMcpToolCaller — canonical agents bridge adapter", () => {
	it("直接调用 chat task runner，不构造 A2A message/send", async () => {
		const context = {} as unknown as AppContext;
		const runner = vi.fn(async () => ({
			id: "task-1",
			kind: "chat" as const,
			status: "succeeded" as const,
			assets: [],
			raw: { text: "canonical /chat response" },
		}));
		const typedRunner: McpChatTaskRunner = runner;
		const caller = createMcpToolCaller(context, "user-1", typedRunner);

		const result = await caller("ask_tapcanvas", {
			message: "继续创作",
			canvasProjectId: "project-1",
		});

		expect(result).toEqual({ text: "canonical /chat response" });
		expect(runner).toHaveBeenCalledTimes(1);
		expect(runner).toHaveBeenCalledWith(context, "user-1", {
			kind: "chat",
			prompt: "继续创作",
			extras: {
				diagnosticsLabel: "public_mcp.ask_tapcanvas",
				canvasProjectId: "project-1",
				sessionKey: "project:project-1:flow:default",
			},
		});
	});
});
