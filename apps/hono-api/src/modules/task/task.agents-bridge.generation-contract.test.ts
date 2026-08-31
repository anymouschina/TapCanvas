import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

const {
	buildUserMemoryContext,
	listAssetsForUser,
	getFlowForOwner,
	listFlowsByOwner,
} = vi.hoisted(() => ({
	buildUserMemoryContext: vi.fn(),
	listAssetsForUser: vi.fn(),
	getFlowForOwner: vi.fn(),
	listFlowsByOwner: vi.fn(),
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

vi.mock("../agents/capability-bay.service", async () => {
	const actual = await vi.importActual<typeof import("../agents/capability-bay.service")>(
		"../agents/capability-bay.service",
	);
	return {
		...actual,
		listEquippedWorkflowCapabilities: async () => [],
		listDisabledSkillKeys: async () => [],
		listReplacedSkillKeys: async () => [],
		getBuiltInCapabilityAvailability: async () => ({
			systemDisabledKeys: [],
			userDisabledKeys: [],
			disabledKeys: [],
		}),
	};
});

import { runAgentsBridgeChatTask } from "./task.agents-bridge";

function createContext(): AppContext {
	const store = new Map<string, unknown>([
		["publicApi", true],
		["auth", { sub: "user-1" }],
		["requestId", "req-generation-contract"],
	]);

	return {
		env: {
			DB: {},
			AGENTS_BRIDGE_BASE_URL: "http://agents.test",
			AGENTS_BRIDGE_TIMEOUT_MS: "5000",
			TAPCANVAS_API_BASE_URL: "https://api.tapcanvas.test",
			INTERNAL_WORKER_TOKEN: "test-worker-secret",
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

describe("runAgentsBridgeChatTask generation contract forwarding", () => {
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
	});

	it("forwards normalized generationContract to agents-cli /chat body", async () => {
		let forwardedBody: Record<string, unknown> | null = null;
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			forwardedBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
			const logicalTaskId = String(
				forwardedBody.publicTurnId ?? forwardedBody.logicalTaskId ?? "",
			);
			return new Response(
				JSON.stringify({
					id: "bridge-1",
					text: "ok",
					trace: {
						toolCalls: [],
						runtime: {
							terminalAuthority: "workflow_action",
							physicalRunExit: {
								version: 1,
								kind: "logical_terminal",
								logicalTaskId,
								taskNodeId: "root",
								taskRevision: 0,
								taskStatus: "satisfied",
								reasonCode: "workflow_action_completed",
								exitedAt: "2026-08-31T04:00:00.000Z",
								continuationTicket: null,
							},
						},
						runOutcome: {
							version: 1,
							terminal: true,
							status: "succeeded",
							reason: "workflow_action_completed",
						},
						completion: {
							version: 1,
							source: "runtime",
							terminal: "success",
							allowFinish: true,
							failureReason: null,
							rationale: "request completed",
							successCriteria: [],
							missingCriteria: [],
							requiredActions: [],
						},
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
							preview: "ok",
							head: "ok",
							tail: "ok",
						},
					},
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(
			createContext(),
			"user-1",
			{
				kind: "chat",
				prompt: "继续生成",
				extras: {
					canvasProjectId: "project-1",
					canvasFlowId: "flow-1",
					forcedAgentRole: "research",
					generationContract: {
						version: "v1",
						lockedAnchors: ["角色外观", "镜头构图", "角色外观"],
						editableVariable: "环境光线",
						forbiddenChanges: ["禁止换脸", "禁止改机位"],
						approvedKeyframeId: "keyframe-9",
					},
				},
			},
			{ directForcedAgentExecution: true },
		);

		expect(result.status).toBe("succeeded");
		expect(forwardedBody?.generationContract).toEqual({
			version: "v1",
			lockedAnchors: ["角色外观", "镜头构图"],
			editableVariable: "环境光线",
			forbiddenChanges: ["禁止换脸", "禁止改机位"],
			approvedKeyframeId: "keyframe-9",
		});
		expect(forwardedBody?.overrideApiBaseUrl).toBe(
			"https://api.tapcanvas.test/agents/llm/v1",
		);
		expect(String(forwardedBody?.overrideApiKey)).toMatch(/^tc_internal:v2:/u);
		expect(forwardedBody?.overrideApiKey).not.toBe("test-worker-secret");
		expect(forwardedBody?.forcedAgentRole).toBe("research");
		expect(
			(forwardedBody as unknown as Record<string, unknown>).executeForcedAgentDirectly,
		).toBe(true);
	});

	it("rejects internal direct Agent mode when no selected role exists", async () => {
		await expect(
			runAgentsBridgeChatTask(
				createContext(),
				"user-1",
				{ kind: "chat", prompt: "执行原子节点", extras: {} },
				{ directForcedAgentExecution: true },
			),
		).rejects.toMatchObject({
			code: "workflow_direct_agent_role_required",
		});
	});

	it("fails explicitly when generationContract is malformed inside extras", async () => {
		await expect(
			runAgentsBridgeChatTask(createContext(), "user-1", {
				kind: "chat",
				prompt: "继续生成",
				extras: {
					generationContract: {
						version: "v1",
						lockedAnchors: ["角色外观"],
						editableVariable: null,
						forbiddenChanges: [],
						approvedKeyframeId: null,
						motionBudget: "fast",
					},
				},
			}),
		).rejects.toMatchObject({
			code: "invalid_generation_contract",
		});
	});

	it("does not inject execution planning requirements for visual agents chat runs", async () => {
		let forwardedBody: Record<string, unknown> | null = null;
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			forwardedBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
			const logicalTaskId = String(
				forwardedBody.publicTurnId ?? forwardedBody.logicalTaskId ?? "req-generation-contract",
			);
			return new Response(
				JSON.stringify({
					id: "bridge-planning-1",
					text: "ok",
					trace: {
						toolCalls: [],
						runtime: {
							terminalAuthority: "user_delivery",
							physicalRunExit: {
								version: 1,
								kind: "logical_terminal",
								logicalTaskId,
								taskNodeId: "root",
								taskRevision: 0,
								taskStatus: "failed",
								reasonCode: "delivery_verification_missing",
								exitedAt: "2026-08-31T04:00:00.000Z",
								continuationTicket: null,
							},
						},
						runOutcome: {
							version: 1,
							terminal: true,
							status: "failed",
							reason: "delivery_verification_missing",
						},
						completion: {
							version: 1,
							source: "runtime",
							terminal: "failure",
							allowFinish: false,
							failureReason: "delivery_verification_missing",
							rationale: "delivery verification is missing",
							successCriteria: [],
							missingCriteria: [],
							requiredActions: [],
						},
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
							preview: "ok",
							head: "ok",
							tail: "ok",
						},
					},
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "完成第三章漫剧创作",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				referenceImages: ["https://cdn.tapcanvas.test/ref-1.png"],
			},
		});

		const diagnosticContext = forwardedBody?.diagnosticContext as Record<string, unknown>;
		expect(diagnosticContext?.planningRequired).toBeUndefined();
		expect(diagnosticContext?.planningMinimumSteps).toBeUndefined();
		expect(diagnosticContext?.planningChecklistFirst).toBeUndefined();
	});

	it("fails bridge verdict when execution planning is missing", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const forwardedBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
			const logicalTaskId = String(
				forwardedBody.publicTurnId ?? forwardedBody.logicalTaskId ?? "req-generation-contract",
			);
			return new Response(
				JSON.stringify({
					id: "bridge-planning-2",
					text: "已完成第三章漫剧创作。",
					trace: {
						toolCalls: [],
						runtime: {
							terminalAuthority: "user_delivery",
							physicalRunExit: {
								version: 1,
								kind: "logical_terminal",
								logicalTaskId,
								taskNodeId: "root",
								taskRevision: 0,
								taskStatus: "failed",
								reasonCode: "planning_checklist_missing",
								exitedAt: "2026-08-31T04:00:00.000Z",
								continuationTicket: null,
							},
						},
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
							textChars: 10,
							preview: "已完成第三章漫剧创作。",
							head: "已完成第三章漫剧创作。",
							tail: "已完成第三章漫剧创作。",
						},
						planning: {
							source: "todo_list",
							planningRequired: true,
							minimumStepCount: 2,
							hasChecklist: false,
							latestStepCount: 0,
							maxObservedStepCount: 0,
							completedCount: 0,
							inProgressCount: 0,
							pendingCount: 0,
							meetsMinimumStepCount: false,
							checklistComplete: false,
						},
						completion: {
							version: 1,
							source: "deterministic",
							terminal: "failure",
							allowFinish: false,
							failureReason: "planning_checklist_missing",
							rationale: "缺少 checklist",
							successCriteria: ["存在 checklist"],
							missingCriteria: ["planning_checklist_present"],
							requiredActions: ["先规划"],
						},
						runOutcome: {
							version: 1,
							terminal: true,
							status: "failed",
							reason: "planning_checklist_missing",
						},
					},
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "完成第三章漫剧创作",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				referenceImages: ["https://cdn.tapcanvas.test/ref-1.png"],
			},
		});

		expect(result.status).toBe("failed");
		const rawMeta = (result.raw as { meta: Record<string, unknown> }).meta;
		expect(rawMeta.planningTrace).toMatchObject({
			planningRequired: true,
			hasChecklist: false,
		});
		expect(rawMeta.turnVerdict.status).toBe("failed");
		expect(rawMeta.turnVerdict.reasons).toEqual(["planning_checklist_missing"]);
	});
});
