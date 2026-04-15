import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

const {
	buildUserMemoryContext,
	writeUserExecutionTrace,
	listAssetsForUser,
	getFlowForOwner,
	listFlowsByOwner,
} = vi.hoisted(() => ({
	buildUserMemoryContext: vi.fn(),
	writeUserExecutionTrace: vi.fn(),
	listAssetsForUser: vi.fn(),
	getFlowForOwner: vi.fn(),
	listFlowsByOwner: vi.fn(),
}));

vi.mock("../memory/memory.service", () => ({
	buildUserMemoryContext,
	formatMemoryContextForPrompt: () => "",
	writeUserExecutionTrace,
}));

vi.mock("../asset/asset.repo", () => ({
	listAssetsForUser,
}));

vi.mock("../flow/flow.repo", () => ({
	getFlowForOwner,
	listFlowsByOwner,
}));

import { runAgentsBridgeChatTask } from "./task.agents-bridge";

function createContext(): AppContext {
	const store = new Map<string, unknown>([
		["publicApi", true],
		["auth", { sub: "user-1" }],
		["requestId", "req-stream-test"],
	]);

	return {
		env: {
			DB: {},
			AGENTS_BRIDGE_BASE_URL: "http://agents.test",
			AGENTS_BRIDGE_TIMEOUT_MS: "5000",
			TAPCANVAS_API_BASE_URL: "https://api.tapcanvas.test",
		} as unknown as AppContext["env"],
		req: {
			url: "https://api.tapcanvas.test/public/agents/chat",
			header: () => undefined,
		} as unknown as AppContext["req"],
		get: (key: string) => store.get(key),
		set: (key: string, value: unknown) => {
			store.set(key, value);
		},
	} as unknown as AppContext;
}

describe("runAgentsBridgeChatTask stream protocol", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		buildUserMemoryContext.mockResolvedValue({
			rollups: { session: [], chapter: [], book: [], project: [] },
			userPreferences: [],
			projectFacts: [],
			bookFacts: [],
			chapterFacts: [],
			artifactRefs: [],
			recentConversation: [],
		});
		writeUserExecutionTrace.mockResolvedValue(undefined);
		listAssetsForUser.mockResolvedValue([]);
		listFlowsByOwner.mockResolvedValue([
			{
				id: "flow-1",
				project_id: "project-1",
			},
		]);
		getFlowForOwner.mockResolvedValue({
			id: "flow-1",
			project_id: "project-1",
		});
	});

	it("parses named SSE events and forwards content/tool/result", async () => {
		const sseBody = [
			"event: thread.started",
			'data: {"threadId":"thread_1","sessionId":"sess_1","userId":"user-1"}',
			"",
			"event: turn.started",
			'data: {"threadId":"thread_1","turnId":"turn_1","userId":"user-1","promptPreview":"测试 SSE"}',
			"",
			"event: item.started",
			'data: {"threadId":"thread_1","turnId":"turn_1","itemId":"msg_1","itemType":"message","role":"assistant"}',
			"",
			"event: item.updated",
			'data: {"threadId":"thread_1","turnId":"turn_1","itemId":"msg_1","itemType":"message","delta":"你好"}',
			"",
			"event: content",
			'data: {"delta":"你好"}',
			"",
			"event: tool",
			'data: {"toolCallId":"tool_1","toolName":"TodoWrite","phase":"completed","status":"succeeded","outputPreview":"Todo\\n[>] 收敛 SSE 协议","startedAt":"2026-03-19T10:00:00.000Z","finishedAt":"2026-03-19T10:00:01.000Z","durationMs":1000}',
			"",
			"event: todo_list",
			'data: {"threadId":"thread_1","turnId":"turn_1","sourceToolCallId":"tool_1","items":[{"text":"收敛 SSE 协议","completed":false,"status":"in_progress"}],"totalCount":1,"completedCount":0,"inProgressCount":1}',
			"",
			"event: result",
			'data: {"response":{"id":"agents_1","text":"最终结果","trace":{"toolCalls":[],"summary":{"totalToolCalls":1,"succeededToolCalls":1,"failedToolCalls":0,"deniedToolCalls":0,"blockedToolCalls":0,"runMs":1000},"turns":[],"output":{"textChars":4,"preview":"最终结果","head":"最终结果","tail":"最终结果"}}}}',
			"",
			"event: done",
			'data: {"reason":"finished"}',
			"",
		].join("\n");
		const fetchMock = vi.fn(async () => {
			return new Response(sseBody, {
				status: 200,
				headers: { "content-type": "text/event-stream; charset=utf-8" },
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		const observed: Array<{ event: string; data: Record<string, unknown> }> = [];
		const result = await runAgentsBridgeChatTask(
			createContext(),
			"user-1",
			{
				kind: "chat",
				prompt: "测试流式协议",
				extras: {
					canvasProjectId: "project-1",
					canvasFlowId: "flow-1",
				},
			},
			{
				onStreamEvent: async (event) => {
					observed.push({
						event: event.event,
						data: event.data as Record<string, unknown>,
					});
				},
			},
		);

		expect(result.status).toBe("succeeded");
		expect(observed.map((item) => item.event)).toEqual([
			"thread.started",
			"turn.started",
			"item.started",
			"item.updated",
			"content",
			"tool",
			"todo_list",
			"result",
			"done",
		]);
		expect(observed[1]?.data).toMatchObject({
			threadId: "thread_1",
			turnId: "turn_1",
			userId: "user-1",
		});
		expect(observed[5]?.data).toMatchObject({
			toolName: "TodoWrite",
			phase: "completed",
			status: "succeeded",
		});
		expect(observed[6]?.data).toMatchObject({
			sourceToolCallId: "tool_1",
			totalCount: 1,
			inProgressCount: 1,
		});
	});

	it("fails explicitly on malformed named SSE payload", async () => {
		const sseBody = [
			"event: result",
			'data: {"response":',
			"",
		].join("\n");
		const fetchMock = vi.fn(async () => {
			return new Response(sseBody, {
				status: 200,
				headers: { "content-type": "text/event-stream; charset=utf-8" },
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			runAgentsBridgeChatTask(createContext(), "user-1", {
				kind: "chat",
				prompt: "测试非法流",
			}),
		).rejects.toMatchObject({
			code: "agents_bridge_stream_invalid_event",
		});
	});

	it("preserves upstream error event instead of relabeling it as parse failure", async () => {
		const sseBody = [
			"event: error",
			'data: {"message":"planner exploded","code":"planner_failed","details":{"reason":"completion_gate_failed"}}',
			"",
			"event: done",
			'data: {"reason":"error"}',
			"",
		].join("\n");
		const fetchMock = vi.fn(async () => {
			return new Response(sseBody, {
				status: 200,
				headers: { "content-type": "text/event-stream; charset=utf-8" },
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			runAgentsBridgeChatTask(createContext(), "user-1", {
				kind: "chat",
				prompt: "测试上游错误透传",
			}),
		).rejects.toMatchObject({
			message: "planner exploded",
			code: "planner_failed",
			details: {
				reason: "completion_gate_failed",
			},
		});
	});

	it("propagates caller abort to the upstream agents bridge request", async () => {
		let resolveUpstreamSignal: ((signal: AbortSignal) => void) | null = null;
		const upstreamSignalReady = new Promise<AbortSignal>((resolve) => {
			resolveUpstreamSignal = resolve;
		});
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const signal = init?.signal;
			if (!(signal instanceof AbortSignal)) {
				throw new Error("missing_abort_signal");
			}
			resolveUpstreamSignal?.(signal);
			return await new Promise<Response>((_resolve, reject) => {
				signal.addEventListener(
					"abort",
					() => {
						reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
					},
					{ once: true },
				);
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		const controller = new AbortController();
		const taskPromise = runAgentsBridgeChatTask(
			createContext(),
			"user-1",
			{
				kind: "chat",
				prompt: "测试取消透传",
				extras: {
					canvasProjectId: "project-1",
					canvasFlowId: "flow-1",
				},
			},
			{
				abortSignal: controller.signal,
			},
		);
		const upstreamSignal = await upstreamSignalReady;
		expect(upstreamSignal.aborted).toBe(false);

		controller.abort(new Error("client disconnected"));

		await expect(taskPromise).rejects.toThrow(/client disconnected/);
		expect(upstreamSignal.aborted).toBe(true);
	});
});
