import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

const {
	buildUserMemoryContext,
	listAssetsForUser,
	getFlowForOwner,
	listFlowsByOwner,
	loadPublicChatEnabledModelCatalogSummary,
	listEquippedWorkflowCapabilities,
	listDisabledSkillKeys,
	listReplacedSkillKeys,
	getBuiltInCapabilityAvailability,
} = vi.hoisted(() => ({
	buildUserMemoryContext: vi.fn(),
	listAssetsForUser: vi.fn(),
	getFlowForOwner: vi.fn(),
	listFlowsByOwner: vi.fn(),
	loadPublicChatEnabledModelCatalogSummary: vi.fn(),
	listEquippedWorkflowCapabilities: vi.fn(),
	listDisabledSkillKeys: vi.fn(),
	listReplacedSkillKeys: vi.fn(),
	getBuiltInCapabilityAvailability: vi.fn(),
}));

vi.mock("../memory/memory.service", () => ({
	buildUserMemoryContext,
	formatMemoryContextForPrompt: () => "",
}));

vi.mock("../asset/asset.repo", () => ({
	listAssetsForUser,
}));

vi.mock("../flow/flow.repo", () => ({
	getFlowForOwner,
	listFlowsByOwner,
}));

vi.mock("../model-catalog/model-catalog.public-chat-summary", () => ({
	loadPublicChatEnabledModelCatalogSummary,
}));

vi.mock("../agents/capability-bay.service", () => ({
	listEquippedWorkflowCapabilities,
	listDisabledSkillKeys,
	listReplacedSkillKeys,
	getBuiltInCapabilityAvailability,
}));

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => ({
		users: {
			findUnique: vi.fn().mockResolvedValue(null),
		},
	}),
}));

import {
	enqueueAgentsBridgeMessage,
	parseAgentsBridgeSseResponse,
	runAgentsBridgeChatTask,
	buildMemoryCoreRequestIdentity,
} from "./task.agents-bridge";
import { stringifyCanonicalAgentsBridgeSuccess } from "./task.agents-bridge.test-fixtures";
import { parseInternalApiKey } from "../apiKey/internal-api-key";
import {
	AGENTS_BRIDGE_SESSION_AFFINITY_HEADER,
	buildAgentsBridgeSessionAffinity,
} from "./agents-bridge-session-affinity";

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

function createDeferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
} {
	let resolvePromise: ((value: T) => void) | null = null;
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve: (value) => {
			if (!resolvePromise) throw new Error("deferred resolver is unavailable");
			resolvePromise(value);
		},
	};
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
		loadPublicChatEnabledModelCatalogSummary.mockResolvedValue({
			summary: null,
			error: null,
		});
		listEquippedWorkflowCapabilities.mockResolvedValue([]);
		listDisabledSkillKeys.mockResolvedValue([]);
		listReplacedSkillKeys.mockResolvedValue([]);
		getBuiltInCapabilityAvailability.mockResolvedValue({
			systemDisabledKeys: [],
			userDisabledKeys: [],
			disabledKeys: [],
		});
	});

	it("binds MemoryCore to the authenticated user and request team", () => {
		expect(buildMemoryCoreRequestIdentity({
			activeTeamId: "team-request",
			configuredTeamId: "team-local-default",
			agentId: "agent-1",
			effectiveUserId: "user-request",
			sessionId: "session-1",
			taskId: "request-1",
		})).toEqual({
			teamId: "team-request",
			agentId: "agent-1",
			userId: "user-request",
			sessionId: "session-1",
			taskId: "request-1",
		});
		expect(buildMemoryCoreRequestIdentity({
			activeTeamId: "",
			configuredTeamId: "team-local-default",
			agentId: "agent-1",
			effectiveUserId: "user-request",
			sessionId: "session-1",
			taskId: "request-1",
		}).teamId).toBe("team-local-default");
	});

	it("routes queued follow-up messages through the owning session affinity", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			expect(new Headers(init?.headers).get(
				AGENTS_BRIDGE_SESSION_AFFINITY_HEADER,
			)).toBe(buildAgentsBridgeSessionAffinity({
				userId: "user-1",
				sessionId: "session-1",
			}));
			return new Response(JSON.stringify({
				accepted: true,
				queueId: "queue-1",
				activeTurn: true,
			}), {
				status: 202,
				headers: { "content-type": "application/json" },
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		const receipt = await enqueueAgentsBridgeMessage(createContext(), "user-1", {
			sessionId: "session-1",
			prompt: "继续完成当前任务",
			queueMode: "follow_up",
		});

		expect(receipt).toEqual({
			accepted: true,
			queueId: "queue-1",
			mode: "follow_up",
			sessionId: "session-1",
			activeTurn: true,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("loads independent bridge prelude facts concurrently before dispatch", async () => {
		const flowRead = createDeferred<{ id: string; project_id: string }>();
		const chapterRead = createDeferred<{ source_book_id: string }>();
		getFlowForOwner.mockReturnValueOnce(flowRead.promise);
		const chapterFindFirst = vi.fn(() => chapterRead.promise);
		const context = createContext();
		(context.env as unknown as { DB: unknown }).DB = {
			chapters: { findFirst: chapterFindFirst },
		};
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const controller = new AbortController();

		const task = runAgentsBridgeChatTask(context, "user-1", {
			kind: "chat",
			prompt: "读取当前章节",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chapterId: "chapter-1",
			},
		}, {
			abortSignal: controller.signal,
		});

		await vi.waitFor(() => {
			expect(getFlowForOwner).toHaveBeenCalledTimes(1);
			expect(chapterFindFirst).toHaveBeenCalledTimes(1);
		});
		expect(fetchMock).not.toHaveBeenCalled();

		controller.abort(new Error("concurrency assertion complete"));
		flowRead.resolve({ id: "flow-1", project_id: "project-1" });
		chapterRead.resolve({ source_book_id: "" });
		await expect(task).rejects.toThrow(/concurrency assertion complete/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("fresh-projects the enabled runtime model catalog into an ordinary canvas chat turn", async () => {
		loadPublicChatEnabledModelCatalogSummary.mockResolvedValueOnce({
			summary: {
				imageModels: [],
				audioModels: [],
				videoModels: [{
					vendorKey: "ark",
					modelKey: "video-runtime-model",
					modelAlias: "video-runtime-model",
					labelZh: "Runtime video model",
					availability: "system",
					pricingCost: 100,
					useCases: [],
					videoOptions: {
						defaultDurationSeconds: 20,
						defaultResolution: "720p",
						maxDurationSeconds: 20,
						maxReferenceImages: 9,
						maxReferenceAudios: null,
						maxReferenceAudioDurationSeconds: null,
						supportsReferenceImages: true,
						supportsReferenceAudios: null,
						supportsNativeAudio: true,
						durationOptions: [{ value: 20, label: "20s", priceLabel: null }],
						sizeOptions: [{
							value: "16:9",
							label: "16:9",
							orientation: "landscape",
							aspectRatio: "16:9",
							priceLabel: null,
						}],
						resolutionOptions: [{ value: "720p", label: "720p", priceLabel: null }],
						orientationOptions: [],
					},
				}],
				videoFinishingModels: [],
			},
			error: null,
		});
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
			expect(body.webSearch).toBeUndefined();
			expect(body.systemPrompt).toContain("enabledVideoModels.count: 1");
			expect(body.systemPrompt).toContain("modelKey=video-runtime-model");
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "agent-api-model-catalog",
					text: "accepted",
					trace: {
						toolCalls: [],
						summary: { totalToolCalls: 0 },
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		const context = createContext();

		await runAgentsBridgeChatTask(context, "user-1", {
			kind: "chat",
			prompt: "生成完整视频",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		});

		expect(loadPublicChatEnabledModelCatalogSummary).toHaveBeenCalledWith(
			expect.anything(),
			"user-1",
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("does not count SSE heartbeat comments as agent progress", async () => {
		const sseBody = [
			": hb 1",
			"",
			": hb 2",
			"",
			"event: result",
			'data: {"response":{"id":"agents_heartbeat","text":"完成","trace":{"toolCalls":[],"summary":{"totalToolCalls":0,"succeededToolCalls":0,"failedToolCalls":0,"deniedToolCalls":0,"blockedToolCalls":0,"runMs":10},"turns":[],"output":{"textChars":2,"preview":"完成","head":"完成","tail":"完成"}}}}',
			"",
			": hb 3",
			"",
			"event: done",
			'data: {"reason":"finished"}',
			"",
		].join("\n");
		let progressEvents = 0;
		const response = await parseAgentsBridgeSseResponse({
			response: new Response(sseBody, {
				status: 200,
				headers: { "content-type": "text/event-stream; charset=utf-8" },
			}),
			c: createContext(),
			onActivity: () => {
				progressEvents += 1;
			},
		});

		expect(response?.text).toBe("完成");
		expect(progressEvents).toBe(2);
	});

	it("reports a structured interruption when the SSE transport breaks before result", async () => {
		const encoder = new TextEncoder();
		let pullCount = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (pullCount === 0) {
					pullCount += 1;
					controller.enqueue(encoder.encode('event: status-update\ndata: {"phase":"accepted"}\n\n'));
					return;
				}
				controller.error(new TypeError("terminated"));
			},
		});

		await expect(parseAgentsBridgeSseResponse({
			response: new Response(stream, {
				status: 200,
				headers: { "content-type": "text/event-stream; charset=utf-8" },
			}),
			c: createContext(),
		})).rejects.toMatchObject({
			code: "agents_bridge_stream_interrupted",
			details: {
				resultReceived: false,
				cause: { name: "TypeError", message: "terminated" },
			},
		});
	});

	it("does not treat a clean SSE close without a result as completion", async () => {
		await expect(parseAgentsBridgeSseResponse({
			response: new Response('event: done\ndata: {"reason":"transport_closed"}\n\n', {
				status: 200,
				headers: { "content-type": "text/event-stream; charset=utf-8" },
			}),
			c: createContext(),
		})).rejects.toMatchObject({
			code: "agents_bridge_stream_interrupted",
			details: { resultReceived: false, transportEndedCleanly: true },
		});
	});

	it("keeps a received terminal result when only the trailing transport closes badly", async () => {
		const encoder = new TextEncoder();
		let pullCount = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (pullCount === 0) {
					pullCount += 1;
					controller.enqueue(encoder.encode([
						"event: result",
						'data: {"response":{"id":"terminal-task","text":"完整产物"}}',
						"",
						"",
					].join("\n")));
					return;
				}
				controller.error(new TypeError("terminated after result"));
			},
		});

		await expect(parseAgentsBridgeSseResponse({
			response: new Response(stream, {
				status: 200,
				headers: { "content-type": "text/event-stream; charset=utf-8" },
			}),
			c: createContext(),
		})).resolves.toMatchObject({ id: "terminal-task", text: "完整产物" });
	});

	it("forwards simple public canvas mutations without a local semantic tool allowlist", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
			expect(requestBody.prompt).toBe("添加一个文本节点");
			expect(requestBody.modelAlias).toBe("deepseek-v4-flash");
			expect(requestBody.allowedTools).toBeUndefined();
			expect(requestBody.privilegedLocalAccess).toBeUndefined();
			expect(requestBody.remoteToolConfig).toMatchObject({
				endpoint: "https://api.tapcanvas.test/public/agents/tools/execute",
				projectId: "project-1",
				flowId: "flow-1",
			});
			expect(requestBody.remoteTools).toEqual([]);
			expect((requestBody.remoteToolCatalog as Array<{ name: string }>).map((tool) => tool.name)).toContain(
				"tapcanvas_flow_patch",
			);
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-simple-text-node",
					text: "已添加文本节点。",
					trace: {
						toolCalls: [],
						summary: {
							totalToolCalls: 0,
							succeededToolCalls: 0,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 10,
						},
						output: {
							textChars: 7,
							preview: "已添加文本节点。",
							head: "已添加文本节点。",
							tail: "已添加文本节点。",
						},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "添加一个文本节点",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				modelAlias: "deepseek-v4-flash",
			},
		});

		expect(result.status).toBe("succeeded");
		expect(result.raw).toMatchObject({
			meta: {
				modelAlias: "deepseek-v4-flash",
			},
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("forwards the ingress-minted publicTurnId on the initial public bridge request", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
			expect(requestBody.publicTurnId).toBe("public-chat-turn:stable-logical-task");
			expect(requestBody.logicalTaskId).toBe("public-chat-turn:stable-logical-task");
			expect(requestBody.publicTurnId).not.toBe("req-stream-test");
			expect(requestBody.remoteToolConfig).toMatchObject({
				publicTurnId: "public-chat-turn:stable-logical-task",
				projectId: "project-1",
				flowId: "flow-1",
			});
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-stable-public-turn",
					text: "已受理。",
					trace: { toolCalls: [], turns: [] },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "继续完成当前逻辑任务",
			extras: {
				publicTurnId: "public-chat-turn:stable-logical-task",
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("projects the exact durable final-response closure for a simple text turn", async () => {
		const contract = {
			version: 2,
			contractHash: "sha256:simple-text-contract",
			referenceResolution: { mode: "new_task" },
			delivery: {
				mode: "response",
				mediaType: null,
				kind: "answer",
				output: "回答用户‘你是谁’",
			},
			must: [{
				id: "intent:must:identity:1",
				statement: "说明助手身份",
				source: "user",
				evidence: ["本轮用户请求"],
			}],
			forbid: [],
			prefer: [],
			confirmedFacts: [],
			unresolved: [],
			precedence: ["provider_protocol_limits", "user_must"],
		};
		const finalResponseEvidence = {
			evidenceId: "runtime-final-response",
			kind: "final_response",
			sourceRef: "final_response",
			requirementIds: ["intent:must:identity:1"],
			attributes: { sha256: "b".repeat(64) },
		};
		const verification = {
			version: 2,
			contractHash: contract.contractHash,
			status: "satisfied",
			criteria: [{
				requirementId: "intent:must:identity:1",
				status: "satisfied",
				evidenceIds: ["runtime-final-response"],
				reason: "runtime 已绑定本轮实际正文",
			}],
			verifiedAt: "2026-08-24T07:12:00.000Z",
		};
		vi.stubGlobal("fetch", vi.fn(async () => new Response(
			stringifyCanonicalAgentsBridgeSuccess({
				id: "bridge-simple-text",
				text: "我是小T，TapCanvas 的 AI 创作助手。",
				trace: {
					toolCalls: [],
					turns: [],
					runtime: {
						profile: "general",
						userIntentContract: contract,
						terminalDelivery: {
							version: 1,
							requestTerminal: {
								version: 1,
								terminal: true,
								status: "succeeded",
								reason: "delivery_verified",
							},
							expectedDelivery: contract,
							deliveryEvidence: [finalResponseEvidence],
							deliveryVerification: verification,
						},
					},
				},
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		)));

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "你是谁",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		});

		expect(result.raw).toMatchObject({
			meta: {
				requestTerminal: { status: "succeeded", reason: "delivery_verified" },
				expectedDelivery: {
					active: true,
					contractHash: contract.contractHash,
				},
				deliveryEvidence: {
					version: 2,
					items: [finalResponseEvidence],
				},
				deliveryVerification: verification,
			},
		});
	});

	it("preserves typed audio assets returned by agents-cli", async () => {
		const fetchMock = vi.fn(async () =>
			new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-audio",
					text: "音频已生成。",
					assets: [
						{
							type: "audio",
							url: "https://cdn.tapcanvas.test/voice.mp3",
						},
					],
					trace: {
						toolCalls: [],
						summary: {
							totalToolCalls: 0,
							succeededToolCalls: 0,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 10,
						},
						turns: [],
						output: {
							textChars: 6,
							preview: "音频已生成。",
							head: "音频已生成。",
							tail: "音频已生成。",
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "生成一段角色试听",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		});

		expect(result.assets).toEqual([
			{
				type: "audio",
				url: "https://cdn.tapcanvas.test/voice.mp3",
			},
		]);
	});

	it("fails explicitly when agents-cli returns an unknown asset type", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(
					stringifyCanonicalAgentsBridgeSuccess({
						id: "bridge-task-invalid-asset-type",
						text: "不应成功。",
						assets: [{ type: "document", url: "https://cdn.tapcanvas.test/file.bin" }],
						trace: { toolCalls: [], turns: [] },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			),
		);

		await expect(
			runAgentsBridgeChatTask(createContext(), "user-1", {
				kind: "chat",
				prompt: "返回未知类型资产",
			}),
		).rejects.toThrow("agents bridge 返回了不支持的资产类型：document");
	});

	it("fails explicitly when agents-cli returns a non-http asset URL", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(
					stringifyCanonicalAgentsBridgeSuccess({
						id: "bridge-task-invalid-asset-url",
						text: "不应成功。",
						assets: [{ type: "audio", url: "asset://temporary/voice" }],
						trace: { toolCalls: [], turns: [] },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			),
		);

		await expect(
			runAgentsBridgeChatTask(createContext(), "user-1", {
				kind: "chat",
				prompt: "返回临时资产 URL",
			}),
		).rejects.toThrow("agents bridge 返回了无效的资产 URL");
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
			"event: status-update",
			'data: {"phase":"agent_continuation","llmTurn":2,"timeoutMs":120000,"afterToolName":"TodoWrite"}',
			"",
			"event: artifact-update",
			'data: {"kind":"artifact-update","taskId":"task_1","contextId":"context_1","artifact":{"artifactId":"artifact_1","parts":[{"kind":"file","file":{"uri":"https://cdn.example/video.mp4","mimeType":"video/mp4"}}]}}',
			"",
			"event: tool",
			'data: {"toolCallId":"tool_1","toolName":"TodoWrite","phase":"completed","status":"succeeded","outputPreview":"Todo\\n[>] 收敛 SSE 协议","startedAt":"2026-03-19T10:00:00.000Z","finishedAt":"2026-03-19T10:00:01.000Z","durationMs":1000}',
			"",
			"event: todo_list",
			'data: {"threadId":"thread_1","turnId":"turn_1","sourceToolCallId":"tool_1","items":[{"text":"收敛 SSE 协议","completed":false,"status":"in_progress"}],"totalCount":1,"completedCount":0,"inProgressCount":1}',
			"",
			"event: result",
			`data: {"response":${stringifyCanonicalAgentsBridgeSuccess({
				id: "agents_1",
				text: "最终结果",
				trace: {
					toolCalls: [],
					summary: {
						totalToolCalls: 1,
						succeededToolCalls: 1,
						failedToolCalls: 0,
						deniedToolCalls: 0,
						blockedToolCalls: 0,
						runMs: 1000,
					},
					turns: [],
					output: {
						textChars: 4,
						preview: "最终结果",
						head: "最终结果",
						tail: "最终结果",
					},
				},
			})}}`,
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
			"status-update",
			"artifact-update",
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
			phase: "agent_continuation",
			llmTurn: 2,
			timeoutMs: 120000,
		});
		expect(observed[6]?.data).toMatchObject({
			kind: "artifact-update",
			taskId: "task_1",
		});
		const toolEvent = observed.find((item) => item.event === "tool");
		const todoEvent = observed.find((item) => item.event === "todo_list");
		expect(toolEvent?.data).toMatchObject({
			toolName: "TodoWrite",
			phase: "completed",
			status: "succeeded",
		});
		expect(todoEvent?.data).toMatchObject({
			sourceToolCallId: "tool_1",
			totalCount: 1,
			inProgressCount: 1,
		});
	});

	it("forwards content-block protocol events instead of rejecting them", async () => {
		const sseBody = [
			"event: thread.started",
			'data: {"threadId":"thread_1","sessionId":"sess_1","userId":"user-1"}',
			"",
			"event: block",
			'data: {"op":"start","block":{"id":"text-main","type":"text","text":"","state":"streaming"}}',
			"",
			"event: content",
			'data: {"delta":"你好"}',
			"",
			"event: block",
			'data: {"op":"delta","id":"text-main","textDelta":"你好"}',
			"",
			"event: block",
			'data: {"op":"end","id":"text-main","state":"complete"}',
			"",
			"event: result",
			`data: {"response":${stringifyCanonicalAgentsBridgeSuccess({
				id: "agents_1",
				text: "你好",
				trace: {
					toolCalls: [],
					summary: {
						totalToolCalls: 0,
						succeededToolCalls: 0,
						failedToolCalls: 0,
						deniedToolCalls: 0,
						blockedToolCalls: 0,
						runMs: 10,
					},
					turns: [],
					output: {
						textChars: 2,
						preview: "你好",
						head: "你好",
						tail: "你好",
					},
				},
			})}}`,
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
				prompt: "测试 content-block 协议",
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
			"block",
			"content",
			"block",
			"block",
			"result",
			"done",
		]);
		expect(observed[1]?.data).toMatchObject({
			op: "start",
			block: { id: "text-main", type: "text", state: "streaming" },
		});
		expect(observed[3]?.data).toMatchObject({ op: "delta", id: "text-main", textDelta: "你好" });
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

	it("gives trusted async workers a delegated remote-tool key with original key attribution", async () => {
		const context = createContext();
		(context.env as unknown as { INTERNAL_WORKER_TOKEN: string }).INTERNAL_WORKER_TOKEN = "worker-secret";
		context.set("apiKeyId", "key-1");
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
			const remoteToolConfig = body.remoteToolConfig as Record<string, unknown>;
			expect(remoteToolConfig).toMatchObject({
				endpoint: "https://api.tapcanvas.test/public/agents/tools/execute",
				projectId: "project-1",
				flowId: "flow-1",
			});
			expect(parseInternalApiKey(
				typeof remoteToolConfig.apiKey === "string" ? remoteToolConfig.apiKey : "",
				"worker-secret",
			)).toEqual({ userId: "user-1", apiKeyId: "key-1" });
			return new Response(stringifyCanonicalAgentsBridgeSuccess({
				id: "trusted-worker-task",
				text: "accepted",
				trace: {
					toolCalls: [],
					summary: {
						totalToolCalls: 0,
						succeededToolCalls: 0,
						failedToolCalls: 0,
						deniedToolCalls: 0,
						blockedToolCalls: 0,
						runMs: 1,
					},
					output: {
						textChars: 8,
						preview: "accepted",
						head: "accepted",
						tail: "accepted",
					},
					turns: [],
				},
			}), { status: 200, headers: { "content-type": "application/json" } });
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(context, "user-1", {
			kind: "chat",
			prompt: "执行已授权任务",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		}, { trustedInternalExecution: true });
	});

	it("keeps Tanva host workspace isolation out of trusted upload credentials", async () => {
		const context = createContext();
		(context.env as unknown as { INTERNAL_WORKER_TOKEN: string }).INTERNAL_WORKER_TOKEN = "worker-secret";
		context.set("apiKeyId", "key-1");
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
			const remoteToolConfig = body.remoteToolConfig as Record<string, unknown>;
			expect(body.userId).toBe("user-1:tanva-user-7");
			expect(parseInternalApiKey(
				typeof remoteToolConfig.apiKey === "string" ? remoteToolConfig.apiKey : "",
				"worker-secret",
			)).toEqual({ userId: "user-1", apiKeyId: "key-1" });
			return new Response(stringifyCanonicalAgentsBridgeSuccess({
				id: "trusted-host-worker-task",
				text: "accepted",
				trace: {
					toolCalls: [],
					summary: {
						totalToolCalls: 0,
						succeededToolCalls: 0,
						failedToolCalls: 0,
						deniedToolCalls: 0,
						blockedToolCalls: 0,
						runMs: 1,
					},
					output: {
						textChars: 8,
						preview: "accepted",
						head: "accepted",
						tail: "accepted",
					},
					turns: [],
				},
			}), { status: 200, headers: { "content-type": "application/json" } });
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(context, "user-1", {
			kind: "chat",
			prompt: "交付桌面文件",
			extras: {
				hostUserId: "tanva-user-7",
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		}, { trustedInternalExecution: true });
	});

	it("fails before bridge dispatch when trusted worker auth cannot be constructed", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "执行已授权任务",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		}, { trustedInternalExecution: true })).rejects.toMatchObject({
			code: "trusted_internal_execution_auth_unavailable",
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
