import { beforeEach, describe, expect, it, vi } from "vitest";
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppContext } from "../../types";

const {
	buildUserMemoryContext,
	listAssetsForUser,
	getFlowForOwner,
	getLarkAppCredentials,
	listFlowsByOwner,
	createFlow,
	createFlowVersion,
	findChapterScope,
	listUserContextAssets,
	loadPublicChatEnabledModelCatalogSummary,
	listEquippedWorkflowCapabilities,
	listDisabledSkillKeys,
	listReplacedSkillKeys,
	getBuiltInCapabilityAvailability,
} = vi.hoisted(() => ({
	buildUserMemoryContext: vi.fn(),
	listAssetsForUser: vi.fn(),
	getFlowForOwner: vi.fn(),
	getLarkAppCredentials: vi.fn(),
	listFlowsByOwner: vi.fn(),
	createFlow: vi.fn(),
	createFlowVersion: vi.fn(),
	findChapterScope: vi.fn(),
	listUserContextAssets: vi.fn(),
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
	createFlow,
	createFlowVersion,
}));

vi.mock("../agents/user-context-assets.service", () => ({
	listUserContextAssets,
}));

vi.mock("../lark/lark.service", () => ({
	getLarkAppCredentials,
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

import { runAgentsBridgeChatTask } from "./task.agents-bridge";
import {
	buildCanonicalAgentsBridgeFailure,
	stringifyCanonicalAgentsBridgeSuccess,
} from "./task.agents-bridge.test-fixtures";

type VideoPromptBeat = {
	summary: string;
	actor?: string;
	action?: string;
	target?: string;
	reaction?: string;
	visibleOutcome?: string;
	cameraChange?: string;
};

function buildImagePromptSpecV2Payload(): Record<string, unknown> {
	return {
		version: "v2",
		shotIntent: "山巅对峙关键帧，先锁住方源与围攻者的压迫关系",
		spatialLayout: [
			"前景保留碎石与被风卷起的灰尘",
			"中景是方源站在山巅边缘，群雄半包围但留出主视线通道",
			"背景是黄昏天空与下方山谷，空间纵深清楚",
		],
		referenceBindings: [
			"方源角色卡绑定图作为人物身份锚点",
			"沿用上一镜头尾帧作为场景连续性锚点",
		],
		identityConstraints: [
			"方源保持同一脸型、发型、血袍轮廓和配色",
			"禁止把方源替换成默认人物或陌生角色",
		],
		environmentObjects: [
			"青茅山山巅碎石与黄昏天空保持连续",
			"围攻者队形维持上章尾帧的半包围空间关系",
		],
		cameraPlan: [
			"中景偏低机位，镜头略微前压",
			"主角位于画面偏右，围攻者形成左后方弧线",
		],
		lightingPlan: [
			"黄昏侧逆光压出人物轮廓",
			"地面和衣袍材质保持冷暖交错但不过曝",
		],
		continuityConstraints: [
			"方源年龄锚点保持十五岁上下，不得跨章突变成成年体态",
			"方源保持重伤/濒死延续状态，除非明确给出恢复原因与时间跨度",
			"维持同一黄昏山巅空间锚点",
		],
		negativeConstraints: ["不要切成其他场景", "不要新增无关角色特写"],
	};
}

function buildChapterGroundedProductionMetadata(
	status: "planned" | "confirmed",
): Record<string, unknown> {
	return {
		chapterGrounded: true,
		lockedAnchors: {
			character: ["方源角色卡已锁定"],
			scene: ["青茅山山巅作为当前场景锚点"],
			shot: ["16:9 中景关键帧"],
			continuity: ["承接当前章节黄昏围杀氛围"],
			missing: status === "planned" ? ["待确认权威基底帧"] : [],
		},
		authorityBaseFrame: {
			status,
			source: status === "planned" ? "generate_first" : "existing_flow_anchor",
			reason:
				status === "planned"
					? "当前先建立单张权威基底帧，再继续扩镜。"
					: "当前 flow 已有确认过的权威基底帧。",
		},
	};
}

function buildGovernedVideoPromptPayload(input?: {
	storyBeatPlan?: VideoPromptBeat[];
	videoPrompt?: string;
	requiresPreproduction?: boolean;
	missingAssets?: string[];
}): Record<string, unknown> {
	const storyBeatPlan = input?.storyBeatPlan ?? [
		{
			summary: "开场对峙",
			actor: "方源",
			action: "抬眼看向围攻者",
			visibleOutcome: "压迫关系成立",
			cameraChange: "中景慢推近",
		},
	];
	const videoPrompt = input?.videoPrompt ?? "单场景慢推近，避免硬切换。";
	const requiresPreproduction = input?.requiresPreproduction ?? false;
	const missingAssets = input?.missingAssets ?? [];
	return {
		storyBeatPlan,
		prompt: videoPrompt,
		videoPromptContract: {
			sceneAnchor: "单一山巅对峙场景",
			roleAnchors: ["方源绑定图"],
			beats: storyBeatPlan,
			physicsConstraints: ["人物不可瞬移换位", "镜头推进保持匀速"],
			forbiddenDrift: ["禁止切到其他场景", "禁止新增无关人物"],
		},
		explicitActionChecklist: ["方源先抬眼，再维持对峙", "镜头只做受控慢推近"],
		physicsConstraints: ["人物重心稳定", "风向与衣袍摆动保持一致"],
		cinematicPrecedentReview: {
			shouldUsePrecedent: true,
			precedentArchetype: "压迫性对峙慢推镜头",
			borrowableElements: ["单场景慢推近", "空间压缩", "动作克制但关系升级"],
			forbiddenCarryover: ["禁止直接照搬具体影视角色", "禁止复刻原作造型"],
			fitScore: 82,
		},
		preproductionDecision: {
			requiresPreproduction,
			reason: requiresPreproduction
				? "当前镜头仍依赖预生产资产补足多人关系或复杂机械位置"
				: "当前角色锚点和场景锚点足够支撑单条短视频",
			missingAssets,
		},
	};
}

function buildGovernedVideoNodeConfig(input?: {
	storyBeatPlan?: VideoPromptBeat[];
	videoPrompt?: string;
	status?: string;
	logs?: string[];
	requiresPreproduction?: boolean;
	missingAssets?: string[];
}): Record<string, unknown> {
	return {
		...buildGovernedVideoPromptPayload(input),
		...(input?.status ? { status: input.status } : {}),
		...(input?.logs ? { logs: input.logs } : {}),
	};
}

function createContext(): AppContext {
	const store = new Map<string, unknown>([
		["publicApi", true],
		["auth", { sub: "user-1" }],
		["requestId", "req-prompt-specialists"],
	]);

	return {
		env: {
			DB: {
				chapters: { findFirst: findChapterScope },
			},
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

function createFileNotFoundError(targetPath: string): NodeJS.ErrnoException {
	const error = new Error(`file not found: ${targetPath}`) as NodeJS.ErrnoException;
	error.code = "ENOENT";
	error.path = targetPath;
	return error;
}

	describe("runAgentsBridgeChatTask prompt specialists", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
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
		getLarkAppCredentials.mockResolvedValue(null);
		findChapterScope.mockResolvedValue({ source_book_id: null });
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

	it("keeps equipped workflows direct and forwards their semantic facts on an empty public chat", async () => {
		listEquippedWorkflowCapabilities.mockResolvedValue([{
			id: "system-greeting-attachment",
			descriptor: {
				name: "简短问候固定回复",
				summary: "仅处理用户不带其他任务的简短打招呼；执行后原样回复固定文本。",
				invocation: { sourceMode: "none", requiredTriggerPayloadFields: [] },
			},
			primaryForCapabilities: [],
		}]);
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
			const logicalTaskId = String(requestBody.logicalTaskId ?? requestBody.publicTurnId ?? "");
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-equipped-workflow-facts",
					text: "工作流能力已进入本轮合同。",
					trace: {
						toolCalls: [],
						summary: { totalToolCalls: 0 },
						output: {},
						turns: [],
						runtime: {
							terminalAuthority: "user_delivery",
							physicalRunExit: {
								version: 1,
								kind: "logical_terminal",
								logicalTaskId,
								taskNodeId: "root",
								taskRevision: 0,
								taskStatus: "satisfied",
								reasonCode: "response_delivered",
								exitedAt: "2026-08-31T08:00:00.000Z",
								continuationTicket: null,
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(runAgentsBridgeChatTask(createContext(), "new-user", {
			kind: "chat",
			prompt: "一条无额外上下文的用户消息",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		})).rejects.toMatchObject({ code: "agents_bridge_logical_task_state_invalid" });

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		const directNames = (requestBody.remoteTools as Array<Record<string, unknown>>)
			.map((tool) => tool.name);
		const catalogNames = (requestBody.remoteToolCatalog as Array<Record<string, unknown>>)
			.map((tool) => tool.name);
		expect(directNames).toContain("tapcanvas_equipped_workflow_run");
		expect(directNames).toContain("tapcanvas_workflow_execution_inspect");
		expect(catalogNames).not.toContain("tapcanvas_equipped_workflow_run");
		expect(catalogNames).not.toContain("tapcanvas_workflow_execution_inspect");
		expect(requestBody.equippedWorkflowCapabilities).toEqual([{
			attachmentId: "system-greeting-attachment",
			name: "简短问候固定回复",
			summary: "仅处理用户不带其他任务的简短打招呼；执行后原样回复固定文本。",
			invocation: { sourceMode: "none", requiredTriggerPayloadFields: [] },
			primaryForCapabilities: [],
		}]);
	});

	it("sends only prompt-specialist subagents and preserves their outputs in execution trace", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-1",
					text: "以下为规划，尚未执行。提示词由专门子代理生成，视频节奏已审查。",
					trace: {
						toolCalls: [
							{ name: "tapcanvas_canvas_workflow_analyze", status: "succeeded" },
							{ name: "tapcanvas_storyboard_continuity_get", status: "succeeded" },
							{
								name: "Task",
								status: "succeeded",
								outputPreview: JSON.stringify({
									agentType: "image_prompt_specialist",
									imagePrompt: "山巅围杀静压起始帧，先锁定方源身份与山巅对峙关系。",
									continuityConstraints: ["保持主角脸型一致", "保持黄昏山巅空间关系稳定"],
									negativeConstraints: ["不要直接自爆", "不要多人抢主角"],
									rationale: "先锁关键帧，再进视频。",
								}),
							},
							{
								name: "Task",
								status: "succeeded",
								outputPreview: JSON.stringify({
									agentType: "video_prompt_specialist",
									storyBeatPlan: [
										{
											summary: "风吹血袍，群雄围而不攻",
											actor: "方源",
											action: "立于山巅，衣袍被风掀动",
											visibleOutcome: "群雄保持包围但不进攻",
										},
										{
											summary: "镜头极慢推近，方源抬眼",
											actor: "方源",
											action: "缓慢抬眼扫向前方",
											cameraChange: "中景极慢前推至中近景",
											visibleOutcome: "压迫感进一步收紧",
										},
										{
											summary: "停在临爆前死寂",
											actor: "群雄",
											reaction: "无一人先动，气氛凝固",
											visibleOutcome: "停在临爆前一秒",
										},
									],
									prompt:
										"保持单一山巅场景，3 个强拍点以内，镜头极慢推进，不做硬切换。",
									videoPromptContract: {
										sceneAnchor: "单一黄昏山巅对峙场景",
										roleAnchors: ["方源绑定图"],
										beats: [
											{
												actor: "方源",
												action: "抬眼扫视前方",
												target: "围攻者",
												visibleOutcome: "压迫感收紧",
												cameraChange: "极慢前推",
											},
										],
										physicsConstraints: ["人物不可瞬移换位", "风向与衣袍摆动保持一致"],
										forbiddenDrift: ["禁止新增无关人物", "禁止切到其他场景"],
									},
									explicitActionChecklist: ["方源先抬眼，再维持对峙", "群雄只围不攻，不发生硬切换"],
									physicsConstraints: ["人物重心稳定", "镜头推进速度保持匀速"],
									cinematicPrecedentReview: {
										shouldUsePrecedent: true,
										precedentArchetype: "压迫性对峙慢推镜头",
										borrowableElements: ["单场景慢推近", "空间压缩", "动作克制但关系升级"],
										forbiddenCarryover: ["禁止直接照搬具体角色造型", "禁止模仿原作美术"],
										fitScore: 84,
									},
									preproductionDecision: {
										requiresPreproduction: false,
										reason: "当前角色锚点和山巅场景锚点已足够支撑单条短视频",
										missingAssets: [],
									},
									continuityConstraints: ["保持同一人物和山巅环境", "保持同一时段和光线"],
									negativeConstraints: ["不要硬切时空", "不要过密动作"],
									rationale: "5 秒内只保留可感知的递进。",
								}),
							},
							{
								name: "Task",
								status: "succeeded",
								outputPreview: JSON.stringify({
									agentType: "pacing_reviewer",
									beatCount: 3,
									sceneChangeCount: 1,
									emotionArc: "压迫递增",
									compressionRisk: "low",
									splitRecommendation: "keep_single_clip",
									rationale: "单场景、低切换、强拍点数量可感知。",
								}),
							},
						],
						summary: {
							totalToolCalls: 5,
							succeededToolCalls: 5,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 812,
						},
						output: {
							head: "提示词由图像/视频专才和节奏审查员协作完成。",
							tail: "节奏审查通过，可保留为单条短视频。",
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
			prompt: "给我设计第二章第一个图和 5 秒图生视频，注意节奏不要太碎。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeLabel: "山巅围杀起始帧",
					selectedNodeKind: "storyboardShot",
					creationMode: "scene",
				},
				referenceImages: ["https://example.com/fangyuan.png"],
				assetInputs: [
					{
						role: "character",
						url: "https://example.com/fangyuan.png",
						name: "方源绑定图",
					},
				],
				planOnly: false,
			},
		});

			expect(fetchMock).toHaveBeenCalledTimes(1);
			const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
			const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
			expect(requestBody.allowedSubagentTypes).toBeUndefined();
			expect(String(requestBody.systemPrompt || "")).not.toContain("Prompt Specialist 结果约束");
			expect(String(requestBody.systemPrompt || "")).not.toContain("Task(agent_type=image_prompt_specialist)");
			expect(String(requestBody.prompt || "")).toContain("【引用事实边界】");
			expect(String(requestBody.prompt || "")).toContain("role=character");
			expect(String(requestBody.prompt || "")).not.toContain("【角色参考一致性约束】");
			expect(requestBody.diagnosticContext).not.toHaveProperty("promptPipeline");

		expect(result.status).toBe("succeeded");
		expect(result.raw).toMatchObject({
			provider: "agents_bridge",
			vendor: "agents",
			userId: "user-1",
		});
		const rawMeta = (result.raw as { meta: Record<string, unknown> }).meta;
		expect(rawMeta.outputMode).toBe("text_only");
		expect(rawMeta.toolStatusSummary).toMatchObject({
			totalToolCalls: 5,
			succeededToolCalls: 5,
			failedToolCalls: 0,
		});
		expect(rawMeta.toolEvidence).toMatchObject({
			readProjectState: true,
			readStoryboardContinuity: true,
			generatedAssets: false,
		});
		expect(rawMeta).not.toHaveProperty("promptPipeline");
		expect(rawMeta.diagnosticFlags).toEqual([]);
		expect(rawMeta.turnVerdict).toEqual({
			status: "satisfied",
			reasons: ["validated_result"],
		});
	});

	it("does not resolve prompt asset mentions in Hono", async () => {
		getFlowForOwner.mockResolvedValue({
			id: "flow-1",
			project_id: "project-1",
			data: JSON.stringify({
				nodes: [
					{
						id: "img-node-1",
						type: "taskNode",
						data: {
							kind: "image",
							label: "方源主参考",
							imageResults: [
								{
									url: "https://example.com/fangyuan-main.png",
									assetId: "asset-img-1",
									assetRefId: "fangyuan_main",
									assetName: "方源主参考",
								},
							],
						},
					},
				],
				edges: [],
			}),
		});
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-asset-mention",
					text: "已根据绑定资产组织请求。",
					trace: {
						toolCalls: [],
						summary: {
							totalToolCalls: 0,
							succeededToolCalls: 0,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 12,
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
			prompt: "请基于 @fangyuan_main 再生成一张新的角色定妆图。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeKind: "image",
					creationMode: "scene",
				},
			},
		});

		expect(result.status).toBe("succeeded");
		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.assetInputs).toBeUndefined();
		expect(requestBody.referenceImages).toBeUndefined();
		expect(String(requestBody.prompt || "")).toContain("@fangyuan_main");
		expect(listAssetsForUser).not.toHaveBeenCalled();
	});

	it("does not resolve role-state prompt mentions in Hono", async () => {
		listAssetsForUser.mockImplementation(
			async (_db: unknown, _userId: string, input?: { kind?: string }) => {
				if (input?.kind === "generation") return [];
				if (input?.kind === "projectRoleCard") {
					return [
						{
							id: "asset-fangyuan-young",
							createdAt: "2026-04-01T09:00:00.000Z",
							updatedAt: "2026-04-01T10:00:00.000Z",
							data: JSON.stringify({
								kind: "projectRoleCard",
								cardId: "card-fangyuan-young",
								roleId: "role-fangyuan",
								roleName: "方源",
								imageUrl: "https://example.com/fangyuan-young.png",
								stateKey: "少年",
								stateDescription: "十五岁少年体态，刚从床上醒来",
								stateLabel: "少年期",
								ageDescription: "十五岁上下",
							}),
						},
						{
							id: "asset-fangyuan-adult",
							createdAt: "2026-04-01T08:00:00.000Z",
							updatedAt: "2026-04-01T11:00:00.000Z",
							data: JSON.stringify({
								kind: "projectRoleCard",
								cardId: "card-fangyuan-adult",
								roleId: "role-fangyuan",
								roleName: "方源",
								imageUrl: "https://example.com/fangyuan-adult.png",
								stateKey: "成年",
								stateDescription: "成年后的方源，神态更老成",
								stateLabel: "成年期",
								ageDescription: "成年",
							}),
						},
					];
				}
				return [];
			},
		);
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-role-state-mention",
					text: "已根据角色卡状态锚点组织请求。",
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
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "请按 @方源-少年 从床上醒来的状态继续生成关键帧。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeKind: "image",
					creationMode: "scene",
				},
			},
		});

		expect(result.status).toBe("succeeded");
		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.assetInputs).toBeUndefined();
		expect(requestBody.referenceImages).toBeUndefined();
		expect(String(requestBody.prompt || "")).toContain("@方源-少年");
		expect(listAssetsForUser).not.toHaveBeenCalled();
	});

	it("does not fuzzy-match @角色名-状态 by substring when no exact normalized state key exists", async () => {
		listAssetsForUser.mockImplementation(
			async (_db: unknown, _userId: string, input?: { kind?: string }) => {
				if (input?.kind === "generation") return [];
				if (input?.kind === "projectRoleCard") {
					return [
						{
							id: "asset-fangyuan-young",
							createdAt: "2026-04-01T09:00:00.000Z",
							updatedAt: "2026-04-01T10:00:00.000Z",
							data: JSON.stringify({
								kind: "projectRoleCard",
								cardId: "card-fangyuan-young",
								roleId: "role-fangyuan",
								roleName: "方源",
								imageUrl: "https://example.com/fangyuan-young.png",
								stateKey: "少年",
								stateDescription: "十五岁少年体态，刚从床上醒来",
								stateLabel: "少年期",
								ageDescription: "十五岁上下",
							}),
						},
					];
				}
				return [];
			},
		);
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-role-state-no-fuzzy-match",
					text: "已按显式状态键组织请求。",
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
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "请按 @方源-十五岁 的状态继续生成关键帧。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeKind: "image",
				},
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(Array.isArray(requestBody.assetInputs) ? requestBody.assetInputs : []).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					url: "https://example.com/fangyuan-young.png",
				}),
			]),
		);
		expect(listAssetsForUser).not.toHaveBeenCalled();
	});

	it("ignores specialist-only video prompt drafts when no final executable payload was returned", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-video-governance-missing",
					text: "以下为规划，尚未执行。视频提示词已整理。",
					trace: {
						toolCalls: [
							{
								name: "Task",
								status: "succeeded",
								outputPreview: JSON.stringify({
									agentType: "video_prompt_specialist",
									storyBeatPlan: [{ summary: "开场对峙" }],
									prompt: "单场景慢推近，避免硬切换。",
								}),
							},
						],
						summary: {
							totalToolCalls: 1,
							succeededToolCalls: 1,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 120,
						},
						output: {
							head: "以下为规划，尚未执行。",
							tail: "prompt: 单场景慢推近，避免硬切换。",
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
			prompt: "给我当前关键帧的视频提示词。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeLabel: "已确认关键帧",
					selectedNodeKind: "image",
					creationMode: "single_video",
				},
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as {
			meta: { diagnosticFlags: unknown[]; turnVerdict: { status: string; reasons: string[] } };
		}).meta;
		expect(rawMeta.diagnosticFlags).toEqual([]);
		expect(rawMeta.turnVerdict).toEqual({
			status: "satisfied",
			reasons: ["validated_result"],
		});
	});

	it("accepts final text video prompt payloads when prompt exists", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-video-governance-missing-text",
					text: JSON.stringify({
						storyBeatPlan: [{ summary: "开场对峙" }],
						prompt: "单场景慢推近，避免硬切换。",
					}),
					trace: {
						toolCalls: [],
						summary: {
							totalToolCalls: 0,
							succeededToolCalls: 0,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 40,
						},
						output: {
							head: "storyBeatPlan",
							tail: "prompt: 单场景慢推近，避免硬切换。",
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
			prompt: "直接给我当前关键帧的视频提示词。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeLabel: "已确认关键帧",
					selectedNodeKind: "image",
					creationMode: "single_video",
				},
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as {
			meta: { diagnosticFlags: unknown[]; turnVerdict: { status: string; reasons: string[] } };
		}).meta;
		expect(rawMeta.diagnosticFlags).toEqual([]);
		expect(rawMeta.turnVerdict).toEqual({
			status: "satisfied",
			reasons: ["validated_result"],
		});
	});

	it("allows final prompt payloads even when prompt-specialist Task calls are bypassed", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-2",
					text: JSON.stringify({
						imagePrompt: "山巅对峙关键帧，保持角色一致。",
						...buildGovernedVideoPromptPayload({
							storyBeatPlan: [
								{ summary: "开场对峙" },
								{ summary: "慢推近" },
								{ summary: "停在死寂" },
							],
							videoPrompt: "单场景慢推近，避免硬切换。",
						}),
					}),
					trace: {
						toolCalls: [
							{ name: "read_file", status: "succeeded", outputPreview: "{}" },
						],
						summary: {
							totalToolCalls: 1,
							succeededToolCalls: 1,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 120,
						},
						output: {
							head: "imagePrompt: 山巅对峙关键帧",
							tail: "prompt: 单场景慢推近，避免硬切换。",
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
			prompt: "直接给我第二章第一个图和视频提示词。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeLabel: "山巅围杀起始帧",
					selectedNodeKind: "storyboardShot",
					creationMode: "scene",
				},
				referenceImages: ["https://example.com/fangyuan.png"],
				assetInputs: [
					{
						role: "character",
						url: "https://example.com/fangyuan.png",
						name: "方源绑定图",
					},
				],
			},
		});
		expect(result.status).toBe("succeeded");
		expect((result.raw as { meta: { diagnosticFlags: unknown[] } }).meta.diagnosticFlags).toEqual([]);
	});

	it("marks the turn as failed when canvas plan payload is structurally invalid", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-invalid-plan",
					text: [
						"以下为规划，尚未执行。",
						'<tapcanvas_canvas_plan>{"action":"create_canvas_workflow","summary":"broken","reason":"broken","nodes":[],"edges":[]}</tapcanvas_canvas_plan>',
					].join("\n\n"),
					trace: {
						...buildCanonicalAgentsBridgeFailure("invalid_canvas_plan"),
						toolCalls: [],
						summary: {
							totalToolCalls: 0,
							succeededToolCalls: 0,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 30,
						},
						output: {
							head: "以下为规划，尚未执行。",
							tail: "broken",
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
			prompt: "给我一个可直接落地到画布的视频节点方案。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
				},
				planOnly: true,
			},
		});

		expect(result.status).toBe("failed");
		expect((result.raw as { meta: { turnVerdict: { status: string; reasons: string[] } } }).meta.turnVerdict).toEqual({
			status: "failed",
			reasons: ["invalid_canvas_plan"],
		});
	});

	it("keeps failed tool execution evidence when agents-cli returns a canonical failure", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-partial",
					text: "下面是基于已读取信息整理的镜头建议。",
					trace: {
						...buildCanonicalAgentsBridgeFailure("tool_execution_issues"),
						toolCalls: [
							{ name: "tapcanvas_project_flows_list", status: "succeeded" },
							{ name: "tapcanvas_book_chapter_get", status: "failed", outputPreview: "chapter read failed" },
						],
						summary: {
							totalToolCalls: 2,
							succeededToolCalls: 1,
							failedToolCalls: 1,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 55,
						},
						output: {
							head: "下面是基于已读取信息整理的镜头建议。",
							tail: "chapter read failed",
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
			prompt: "总结一下当前证据能支持的镜头方向。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
				},
			},
		});

		expect(result.status).toBe("failed");
		expect((result.raw as { meta: { turnVerdict: { status: string; reasons: string[] } } }).meta.turnVerdict).toEqual({
			status: "failed",
			reasons: ["tool_execution_issues"],
		});
	});

	it("does not downgrade coordination-only blocked tool calls to execution issues", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-coordination-blocked-only",
					text: "已完成第一章关键帧并写入当前 flow。",
					trace: {
						toolCalls: [
							{ name: "spawn_agent", status: "succeeded" },
							{ name: "wait", status: "succeeded" },
							{
								name: "spawn_agent",
								status: "blocked",
								outputPreview:
									"未执行：已有 team 子代理尚未结束，runtime 必须先等待子代理终态后才能继续。若这些调用仍然需要，请在下一轮重新发起。",
							},
							{ name: "tapcanvas_image_generate_to_canvas", status: "succeeded" },
						],
						summary: {
							totalToolCalls: 4,
							succeededToolCalls: 3,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 1,
							runMs: 66,
						},
						output: {
							head: "已完成第一章关键帧并写入当前 flow。",
							tail: "已完成第一章关键帧并写入当前 flow。",
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
			prompt: "完成第一章关键帧",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as {
			meta: {
				diagnosticFlags: Array<{ code: string }>;
				turnVerdict: { status: string; reasons: string[] };
			};
		}).meta;
		expect(rawMeta.diagnosticFlags).toEqual([]);
		expect(rawMeta.turnVerdict).toEqual({
			status: "satisfied",
			reasons: ["validated_result"],
		});
	});

	it("keeps non-coordination blocked tool calls as execution issues", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-real-blocked",
					text: "图片生成被阻塞，我先返回已确认的分析结果。",
					trace: {
						...buildCanonicalAgentsBridgeFailure("tool_execution_issues"),
						toolCalls: [
							{ name: "tapcanvas_project_context_get", status: "succeeded" },
							{
								name: "tapcanvas_image_generate_to_canvas",
								status: "blocked",
								outputPreview: "provider rate limit",
							},
						],
						summary: {
							totalToolCalls: 2,
							succeededToolCalls: 1,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 1,
							runMs: 44,
						},
						output: {
							head: "图片生成被阻塞，我先返回已确认的分析结果。",
							tail: "provider rate limit",
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
			prompt: "先帮我分析，再尝试生成图片",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		});

		expect(result.status).toBe("failed");
		expect((result.raw as { meta: { turnVerdict: { status: string; reasons: string[] } } }).meta.turnVerdict).toEqual({
			status: "failed",
			reasons: ["tool_execution_issues"],
		});
	});

	it("prefers runtime completion explicit failure over text-only satisfied heuristics", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-runtime-explicit-failure",
					text: "子代理超时未终态，本轮显式失败。",
					trace: {
						...buildCanonicalAgentsBridgeFailure("runtime_completion_explicit_failure"),
						toolCalls: [
							{ name: "spawn_agent", status: "succeeded" },
							{ name: "agents_team_runtime_wait", status: "failed" },
						],
						summary: {
							totalToolCalls: 2,
							succeededToolCalls: 1,
							failedToolCalls: 1,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 44,
						},
						output: {
							head: "子代理超时未终态，本轮显式失败。",
							tail: "子代理超时未终态，本轮显式失败。",
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
			prompt: "如果子代理卡死就显式失败",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		});

		expect(result.status).toBe("failed");
		const turnVerdict = (result.raw as { meta: { turnVerdict: { status: string; reasons: string[] } } }).meta.turnVerdict;
		expect(turnVerdict.status).toBe("failed");
		expect(turnVerdict.reasons).toEqual(expect.arrayContaining(["runtime_completion_explicit_failure"]));
	});

	it("propagates structured todoList trace into bridge meta", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-todo-trace",
					text: "我会按清单继续推进。",
					trace: {
						toolCalls: [{ name: "TodoWrite", status: "succeeded" }],
						summary: {
							totalToolCalls: 1,
							succeededToolCalls: 1,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 15,
						},
						output: {
							head: "我会按清单继续推进。",
							tail: "我会按清单继续推进。",
						},
						turns: [],
						todoList: {
							sourceToolCallId: "tool_todo_1",
							items: [
								{ text: "补齐角色卡绑定", completed: true, status: "completed" },
								{ text: "补齐分镜图 URL", completed: false, status: "in_progress" },
							],
							totalCount: 2,
							completedCount: 1,
							inProgressCount: 1,
						},
						todoEvents: [
							{
								sourceToolCallId: "tool_todo_1",
								items: [
									{ text: "补齐角色卡绑定", completed: true, status: "completed" },
									{ text: "补齐分镜图 URL", completed: false, status: "in_progress" },
								],
								totalCount: 2,
								completedCount: 1,
								inProgressCount: 1,
								pendingCount: 0,
								atMs: 12,
								startedAt: "2026-03-31T10:00:00.000Z",
								finishedAt: "2026-03-31T10:00:00.012Z",
								durationMs: 12,
							},
						],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "继续执行第三章",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as { meta: Record<string, unknown> }).meta;
		expect(rawMeta.todoList).toEqual({
			sourceToolCallId: "tool_todo_1",
			items: [
				{ text: "补齐角色卡绑定", completed: true, status: "completed" },
				{ text: "补齐分镜图 URL", completed: false, status: "in_progress" },
			],
			totalCount: 2,
			completedCount: 1,
			inProgressCount: 1,
			pendingCount: 0,
		});
		expect(rawMeta.todoEvents).toEqual([
			{
				sourceToolCallId: "tool_todo_1",
				items: [
					{ text: "补齐角色卡绑定", completed: true, status: "completed" },
					{ text: "补齐分镜图 URL", completed: false, status: "in_progress" },
				],
				totalCount: 2,
				completedCount: 1,
				inProgressCount: 1,
				pendingCount: 0,
				atMs: 12,
				startedAt: "2026-03-31T10:00:00.000Z",
				finishedAt: "2026-03-31T10:00:00.012Z",
				durationMs: 12,
			},
		]);
	});

	it("preserves an explicit agents-cli failure when its todo checklist is incomplete", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-todo-incomplete",
					text: "已完成本轮结构搭建。",
					trace: {
						...buildCanonicalAgentsBridgeFailure("todo_checklist_incomplete"),
						toolCalls: [
							{
								name: "task_interrogation",
								status: "succeeded",
								outputJson: {
									taskGoal: "完成第三章漫剧交付",
									requestedOutput: "可执行视觉交付",
									taskKind: "chapter_storyboard",
									recommendedNextStage: "execute_storyboard_delivery",
									mustStop: false,
									requiresExecutionDelivery: true,
									blockingGaps: [],
									successCriteria: ["分镜图与资产绑定完成"],
								},
							},
							{
								name: "tapcanvas_flow_patch",
								status: "succeeded",
							},
						],
						summary: {
							totalToolCalls: 2,
							succeededToolCalls: 2,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 20,
						},
						output: {
							head: "已完成本轮结构搭建。",
							tail: "已完成本轮结构搭建。",
						},
						turns: [],
						todoList: {
							sourceToolCallId: "tool_todo_2",
							items: [
								{ text: "补齐分镜图 URL", completed: false, status: "in_progress" },
								{ text: "确认角色卡一致性", completed: false, status: "pending" },
							],
							totalCount: 2,
							completedCount: 0,
							inProgressCount: 1,
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "重新完成第三章节漫剧创作",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		});

		expect(result.status).toBe("failed");
		const rawMeta = (result.raw as {
			meta: {
				diagnosticFlags: Array<{ code: string }>;
				turnVerdict: { status: string; reasons: string[] };
			};
		}).meta;
		expect(rawMeta.diagnosticFlags).toEqual([]);
		expect(rawMeta.turnVerdict).toEqual({
			status: "failed",
			reasons: ["todo_checklist_incomplete"],
		});
	});

	it("allows outputs when Task calls use writer instead of the specialist agent_type", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-3",
					text: [
						"imagePrompt:",
						"山巅对峙关键帧，保持角色一致。",
						"",
						"storyBeatPlan:",
						'[{"summary":"开场对峙"},{"summary":"慢推近"},{"summary":"停在死寂"}]',
						"",
						"prompt:",
						"单场景慢推近，避免硬切换。",
					].join("\n"),
					trace: {
						toolCalls: [
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "writer" },
								outputPreview: JSON.stringify({
									imagePrompt: "山巅对峙关键帧，保持角色一致。",
								}),
							},
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "writer" },
								outputPreview: JSON.stringify({
									...buildGovernedVideoPromptPayload({
										storyBeatPlan: [{ summary: "开场对峙" }],
										videoPrompt: "单场景慢推近，避免硬切换。",
									}),
								}),
							},
						],
						summary: {
							totalToolCalls: 2,
							succeededToolCalls: 2,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 120,
						},
						output: {
							head: "imagePrompt: 山巅对峙关键帧",
							tail: "prompt: 单场景慢推近，避免硬切换。",
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
			prompt: "直接给我第二章第一个图和视频提示词。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeLabel: "山巅围杀起始帧",
					selectedNodeKind: "storyboardShot",
					creationMode: "scene",
				},
				referenceImages: ["https://example.com/fangyuan.png"],
				assetInputs: [
					{
						role: "character",
						url: "https://example.com/fangyuan.png",
						name: "方源绑定图",
					},
				],
			},
		});
		expect(result.status).toBe("succeeded");
		expect((result.raw as { meta: { diagnosticFlags: unknown[] } }).meta.diagnosticFlags).toEqual([]);
	});

	it("allows final prompt payloads when specialist Task calls returned validation errors", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-4",
					text: JSON.stringify({
						imagePrompt: "山巅对峙关键帧，保持角色一致。",
						...buildGovernedVideoPromptPayload({
							storyBeatPlan: [{ summary: "开场对峙" }],
							videoPrompt: "单场景慢推近，避免硬切换。",
						}),
						negativeConstraints: ["不要硬切"],
					}),
					trace: {
						toolCalls: [
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "image_prompt_specialist" },
								outputPreview:
									"Error: image_prompt_specialist result missing required field: imagePrompt.",
							},
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "video_prompt_specialist" },
								outputPreview:
									"Error: video_prompt_specialist result missing required fields: storyBeatPlan[], prompt.",
							},
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "pacing_reviewer" },
								outputPreview:
									"Error: pacing_reviewer result missing required fields: compressionRisk, splitRecommendation.",
							},
						],
						summary: {
							totalToolCalls: 3,
							succeededToolCalls: 3,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 120,
						},
						output: {
							head: "imagePrompt: 山巅对峙关键帧",
							tail: "prompt: 单场景慢推近，避免硬切换。",
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
			prompt: "直接给我第二章第一个图和视频提示词。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeLabel: "山巅围杀起始帧",
					selectedNodeKind: "storyboardShot",
					creationMode: "scene",
				},
				referenceImages: ["https://example.com/fangyuan.png"],
				assetInputs: [
					{
						role: "character",
						url: "https://example.com/fangyuan.png",
						name: "方源绑定图",
					},
				],
			},
		});
		expect(result.status).toBe("succeeded");
		expect((result.raw as { meta: { diagnosticFlags: unknown[] } }).meta.diagnosticFlags).toEqual([]);
	});

	it("allows canvas plans when video specialists returned validation errors", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-5",
					text: [
						"以下为规划，尚未执行。",
						`<tapcanvas_canvas_plan>${JSON.stringify({
							action: "create_canvas_workflow",
							summary: "test",
							reason: "test",
							nodes: [
								{
									clientId: "n1",
									kind: "composeVideo",
									label: "视频",
									position: { x: 0, y: 0 },
									config: buildGovernedVideoNodeConfig({
										storyBeatPlan: [
											{ summary: "开场静止" },
											{ summary: "轻微推近" },
										],
										videoPrompt: "基于关键帧生成受限运动短视频。",
									}),
								},
							],
							edges: [],
						})}</tapcanvas_canvas_plan>`,
					].join("\n\n"),
					trace: {
						toolCalls: [
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "video_prompt_specialist" },
								outputPreview:
									"Error: video_prompt_specialist result missing required fields: storyBeatPlan[], prompt.",
							},
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "pacing_reviewer" },
								outputPreview:
									"Error: pacing_reviewer result missing required fields: compressionRisk, splitRecommendation.",
							},
						],
						summary: {
							totalToolCalls: 2,
							succeededToolCalls: 2,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 120,
						},
						output: {
							head: "以下为规划，尚未执行。",
							tail: "prompt: 基于关键帧生成受限运动短视频。",
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
			prompt: "请基于当前关键帧直接生成一条单视频方案。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeLabel: "已确认关键帧",
					selectedNodeKind: "image",
					creationMode: "single_video",
				},
			},
		});
		expect(result.status).toBe("succeeded");
		expect((result.raw as { meta: { diagnosticFlags: unknown[] } }).meta.diagnosticFlags).toEqual([]);
	});

	it("resolves a project book title to the real bookId before dispatching to agents bridge", async () => {
		vi.spyOn(fs, "access").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/__________sosdbot-1773463170328/index.json")) return undefined;
			throw new Error("not found");
		});
		const readdirSpy = vi.spyOn(fs, "readdir").mockResolvedValue([
			{
				name: "__________sosdbot-1773463170328",
				isDirectory: () => true,
			},
		] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
		const readFileSpy = vi.spyOn(fs, "readFile").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/__________sosdbot-1773463170328/index.json")) {
				return JSON.stringify({
					projectId: "project-1",
					bookId: "__________sosdbot-1773463170328",
					title: "蛊真人",
					chapters: [{ chapter: 2 }],
				});
			}
			throw createFileNotFoundError(pathText);
		});
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-book-resolve",
					text: "以下为规划，尚未执行。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "分析第二章开场。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chapterId: "2",
				chatContext: {
					selectedReference: {
						bookId: "蛊真人",
					},
				},
			},
		});

		expect(readdirSpy).toHaveBeenCalled();
		expect(readFileSpy).toHaveBeenCalled();
		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.diagnosticContext).toMatchObject({
			bookId: "__________sosdbot-1773463170328",
			chapterId: "2",
		});
		expect(String(requestBody.systemPrompt || "")).toContain("<tapcanvas_context>");
	});

	it("auto-detects the sole project book for single_video novel mode when the user did not specify book progress", async () => {
		const accessSpy = vi.spyOn(fs, "access").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/__________sosdbot-1773463170328/index.json")) return undefined;
			throw new Error("not found");
		});
		const readdirSpy = vi.spyOn(fs, "readdir").mockResolvedValue([
			{
				name: "__________sosdbot-1773463170328",
				isDirectory: () => true,
			},
		] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
		const readFileSpy = vi.spyOn(fs, "readFile").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/__________sosdbot-1773463170328/index.json")) {
				return JSON.stringify({
					title: "蛊真人",
					chapters: [{ chapter: 2 }],
				});
			}
			throw new Error(`unexpected path: ${pathText}`);
		});
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-single-video-auto-book",
					text: "以下为规划，尚未执行。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "请进入单个视频高效快捷创作模式。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					creationMode: "single_video",
				},
			},
		});

		expect(accessSpy).not.toHaveBeenCalled();
		expect(readdirSpy).not.toHaveBeenCalled();
		expect(
			readFileSpy.mock.calls.some((call) => String(call[0] || "").includes("/books/")),
		).toBe(false);
		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.diagnosticContext).toMatchObject({
			projectId: "project-1",
			flowId: "flow-1",
		});
		expect((requestBody.diagnosticContext as Record<string, unknown>).bookId).toBeUndefined();
		expect(String(requestBody.systemPrompt || "")).not.toContain("小说项目单视频取证优先策略");
	});

	it("treats selected reference image as a valid visual anchor for generation gate", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-selected-anchor",
					text: "以下为规划，尚未执行。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "基于当前已选关键帧直接生成单视频。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeLabel: "已确认关键帧",
					selectedNodeKind: "image",
					creationMode: "single_video",
					selectedReference: {
						nodeId: "node-1",
						label: "已确认关键帧",
						kind: "image",
						imageUrl: "https://example.com/keyframe.png",
						productionLayer: "expansion",
						creationStage: "single_variable_expansion",
					},
				},
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.allowedTools).toBeUndefined();
		expect(requestBody.privilegedLocalAccess).toBeUndefined();
	});

	it("keeps generation tools available even when visual anchors are not present yet", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-no-visual-anchor-yet",
					text: "以下为规划，尚未执行。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "根据小说文本继续推进到单视频，必要时先补关键帧。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					creationMode: "single_video",
				},
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.allowedTools).toBeUndefined();
		expect(requestBody.privilegedLocalAccess).toBeUndefined();
	});

	it("keeps canvas write and generation tools available for planOnly bridge chats", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-plan-only-tools",
					text: "以下为规划，尚未执行。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "添加一个文本节点到画布",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				planOnly: true,
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.allowedTools).toBeUndefined();
		expect(requestBody.privilegedLocalAccess).toBeUndefined();
		expect(String(requestBody.systemPrompt || "")).not.toContain("data.productionMetadata");
	});

	it("keeps tools available when agents chat forwards requiredSkills", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-required-skills-tools",
					text: "已收到 skill 要求。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "继续做章节分镜。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
					requiredSkills: ["tapcanvas-storyboard-expert"],
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.requiredSkills).toEqual(["tapcanvas-storyboard-expert"]);
		expect(requestBody.allowedTools).toBeUndefined();
		expect(requestBody.maxTurns).toBeUndefined();
	});

	it("keeps story-preview semantics in agents-cli while exposing the real image tools", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-implicit-story-preview",
					text: "预览图已受理。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "让我预览一下完整剧情",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "chapter-1",
				chapterId: "chapter-1",
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.requiredSkills).toBeUndefined();
		expect(String(requestBody.systemPrompt || "")).not.toContain("chapter_story_preview_delivery");
		const remoteToolCatalog = (requestBody.remoteToolCatalog || []) as Array<Record<string, unknown>>;
		const previewTool = remoteToolCatalog.find(
			(tool) => tool.name === "tapcanvas_story_preview_orchestrate",
		);
		expect(previewTool).toBeDefined();
		expect(remoteToolCatalog.map((tool) => tool.name)).toContain(
			"tapcanvas_image_generate_to_canvas",
		);
		expect(previewTool?.schemaDeferred).toBe(true);
	});

	it("allows an explicitly required replaced storyboard skill to run", async () => {
		listDisabledSkillKeys.mockResolvedValue(["tapcanvas-storyboard-expert", "explicitly-disabled-skill"]);
		listReplacedSkillKeys.mockResolvedValue(["tapcanvas-storyboard-expert"]);
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-replaced-story-preview",
					text: "预览图已受理。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "让我预览一下完整剧情",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "chapter-1",
				chapterId: "chapter-1",
				requiredSkills: ["tapcanvas-storyboard-expert"],
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.requiredSkills).toEqual(["tapcanvas-storyboard-expert"]);
		expect(requestBody.disabledSkills).toEqual(["explicitly-disabled-skill"]);
	});

	it("mounts a frozen Workflow dependency for direct execution without mutating other disabled skills", async () => {
		listDisabledSkillKeys.mockResolvedValue(["tapcanvas-dramatic-adapter", "explicitly-disabled-skill"]);
		listReplacedSkillKeys.mockResolvedValue([]);
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-direct-workflow-dependency",
					text: '{"beats":[]}',
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

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "执行冻结的章级改编节点。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "chapter-1",
				forcedAgentRole: "writer",
				requiredSkills: ["tapcanvas-dramatic-adapter"],
			},
		}, {
			directForcedAgentExecution: true,
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.requiredSkills).toEqual(["tapcanvas-dramatic-adapter"]);
		expect(requestBody.disabledSkills).toEqual(["explicitly-disabled-skill"]);
		expect(requestBody.executeForcedAgentDirectly).toBe(true);
	});

	it("keeps chapter-grounded scope facts without auto-injecting storyboard team constraints", async () => {
		const accessSpy = vi.spyOn(fs, "access").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/book-1/index.json")) return undefined;
			throw new Error("not found");
		});
		const readdirSpy = vi.spyOn(fs, "readdir").mockResolvedValue([
			{
				name: "book-1",
				isDirectory: () => true,
			},
		] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
		const readFileSpy = vi.spyOn(fs, "readFile").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/book-1/index.json")) {
				return JSON.stringify({
					projectId: "project-1",
					bookId: "book-1",
					title: "七十二变",
					chapters: [{ chapter: 3 }],
				});
			}
			if (pathText.includes("/skills/tapcanvas-demo-patterns/SKILL.md")) {
				return nodeFs.readFileSync(pathText, "utf8");
			}
			throw createFileNotFoundError(pathText);
		});
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-chapter-grounded-team",
					text: "已收到章节分镜团队约束。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "继续完成第三章的竖屏短剧相关内容",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "七十二变",
					selectedReference: {
						bookId: "七十二变",
						chapterId: "3",
					},
				},
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.requiredSkills).toBeUndefined();
		expect(requestBody.allowedSubagentTypes).toBeUndefined();
		expect(requestBody.requireAgentsTeamExecution).toBeUndefined();
		expect(requestBody.maxTurns).toBeUndefined();
		expect(String(requestBody.systemPrompt || "")).not.toContain("【章节分镜生产硬约束】");
		const diagnosticContext = requestBody.diagnosticContext as Record<string, unknown>;
		expect(diagnosticContext.chapterGroundedStoryboardScope).toBe(true);
		expect(diagnosticContext.promptPipeline).toBeUndefined();
	});

	it("keeps single_video text-evidence turns free of implicit storyboard team constraints", async () => {
		vi.spyOn(fs, "access").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/book-1/index.json")) return undefined;
			throw new Error("not found");
		});
		vi.spyOn(fs, "readdir").mockResolvedValue([
			{
				name: "book-1",
				isDirectory: () => true,
			},
		] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
		vi.spyOn(fs, "readFile").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/book-1/index.json")) {
				return JSON.stringify({
					projectId: "project-1",
					bookId: "book-1",
					title: "七十二变",
					chapters: [{ chapter: 3 }],
				});
			}
			if (pathText.includes("/skills/tapcanvas-demo-patterns/SKILL.md")) {
				return nodeFs.readFileSync(pathText, "utf8");
			}
			throw createFileNotFoundError(pathText);
		});
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-chapter-grounded-single-video-team",
					text: "已收到 single_video 的章节分镜团队约束。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "请根据上传文本快捷创作单个视频，并继续完成第三章。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "七十二变",
					creationMode: "single_video",
					requireProjectTextEvidence: true,
					selectedReference: {
						bookId: "七十二变",
						chapterId: "3",
					},
				},
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.requiredSkills).toBeUndefined();
		expect(requestBody.allowedSubagentTypes).toBeUndefined();
		expect(requestBody.requireAgentsTeamExecution).toBeUndefined();
		expect(String(requestBody.systemPrompt || "")).not.toContain("【章节分镜生产硬约束】");
	});

	it("does not infer chapter-grounded scope facts from prompt-only chapter wording", async () => {
		const accessSpy = vi.spyOn(fs, "access").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/book-1/index.json")) return undefined;
			throw new Error("not found");
		});
		const readdirSpy = vi.spyOn(fs, "readdir").mockResolvedValue([
			{
				name: "book-1",
				isDirectory: () => true,
			},
		] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
		const readFileSpy = vi.spyOn(fs, "readFile").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/book-1/index.json")) {
				return JSON.stringify({
					title: "七十二变",
					chapters: [{ chapter: 4 }],
				});
			}
			if (pathText.includes("/skills/tapcanvas-demo-patterns/SKILL.md")) {
				return nodeFs.readFileSync(pathText, "utf8");
			}
			throw new Error(`unexpected path: ${pathText}`);
		});
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-chapter-grounded-selected-node",
					text: "已收到章节分镜团队约束。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "完成第四章的竖屏短剧内容",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				canvasNodeId: "node-ref-1",
				referenceImages: ["https://example.com/reference.png"],
				assetInputs: [
					{
						url: "https://example.com/reference.png",
						role: "reference",
						note: "当前选中参考图",
					},
				],
				chatContext: {
					currentProjectName: "七十二变",
					selectedNodeKind: "image",
				},
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.requiredSkills).toBeUndefined();
		expect(requestBody.requireAgentsTeamExecution).toBeUndefined();
		expect(String(requestBody.systemPrompt || "")).not.toContain("【章节分镜生产硬约束】");
		expect(String(requestBody.systemPrompt || "")).not.toContain("【结果透明要求】");
		expect(String(requestBody.systemPrompt || "")).not.toContain("【画布计划协议】");
		expect(String(requestBody.prompt || "")).not.toContain("【参考图保真硬约束】");
		const diagnosticContext = requestBody.diagnosticContext as Record<string, unknown>;
		expect(diagnosticContext.chapterGroundedStoryboardScope).toBeUndefined();
		expect(diagnosticContext.chapterId).toBeUndefined();
	});

	it("forwards auto mode skill requirements without widening the public tool surface", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-auto-mode",
					text: "已收到 AUTO 模式约束。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "直接输出第一章三个关键帧图片",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				mode: "auto",
				forceAssetGeneration: true,
				requiredSkills: ["tapcanvas-storyboard-expert"],
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.requiredSkills).toEqual(["tapcanvas-storyboard-expert"]);
		expect(requestBody.requireAgentsTeamExecution).toBeUndefined();
		expect(requestBody.allowedTools).toBeUndefined();
		expect(requestBody.maxTurns).toBeUndefined();
		expect(String(requestBody.systemPrompt || "")).not.toContain("【结果透明要求】");
		expect(String(requestBody.systemPrompt || "")).not.toContain("本轮请求显式要求真实资产交付。");
		expect(String(requestBody.prompt || "")).not.toContain("【AUTO 模式成功标准】");
		const diagnosticContext = requestBody.diagnosticContext as Record<string, unknown>;
		expect(diagnosticContext.promptPipeline).toBeUndefined();
	});

	it("does not fail non-chapter-grounded auto mode solely because no real agents-team execution evidence was recorded", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-auto-without-team-evidence",
					text: "已完成第一章三个关键帧并落到画布。",
					trace: {
						toolCalls: [
							{ name: "tapcanvas_book_chapter_get", status: "succeeded" },
							{ name: "tapcanvas_image_generate_to_canvas", status: "succeeded" },
						],
						summary: {
							totalToolCalls: 2,
							succeededToolCalls: 2,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 85,
						},
						output: {
							head: "已完成第一章三个关键帧并落到画布。",
							tail: "tapcanvas_image_generate_to_canvas",
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
			prompt: "根据第一章内容，完成第一章的三个关键帧图片。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				mode: "auto",
				forceAssetGeneration: true,
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as { meta: { diagnosticFlags: Array<{ code: string }>; turnVerdict: { status: string; reasons: string[] } } }).meta;
		expect(rawMeta.diagnosticFlags).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "auto_mode_agents_team_execution_missing" }),
			]),
		);
		expect(rawMeta.turnVerdict).toEqual({
			status: "satisfied",
			reasons: ["validated_result"],
		});
	});

	it("does not add team-execution diagnostics for non-chapter-grounded auto mode under general profile", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-auto-general-profile",
					text: "我已完成。",
					trace: {
						toolCalls: [],
						summary: {
							totalToolCalls: 0,
							succeededToolCalls: 0,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 20,
						},
						output: {
							head: "我已完成。",
							tail: "我已完成。",
						},
						turns: [],
						runtime: {
							profile: "general",
							registeredToolNames: ["Skill"],
							registeredTeamToolNames: [],
							requiredSkills: ["agents-team"],
							allowedSubagentTypes: [],
							requireAgentsTeamExecution: false,
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "根据第一章内容，完成第一章的三个关键帧图片。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				mode: "auto",
				forceAssetGeneration: true,
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as { meta: Record<string, unknown> }).meta;
		expect(rawMeta.diagnosticFlags).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "auto_mode_agents_team_execution_missing" }),
				expect.objectContaining({ code: "agents_runtime_general_profile" }),
			]),
		);
		expect(rawMeta.runtime).toMatchObject({
			profile: "general",
			registeredTeamToolNames: [],
			requireAgentsTeamExecution: false,
		});
	});

	it("preserves runtime context truncation and policy facts without a Hono diagnostic pass", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-runtime-policy-context",
					text: "需要进一步授权后才能继续。",
					trace: {
						toolCalls: [
							{
								name: "exec_command",
								status: "blocked",
								outputPreview: "requires approval",
							},
						],
						summary: {
							totalToolCalls: 1,
							succeededToolCalls: 0,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 1,
							runMs: 40,
						},
						output: {
							head: "需要进一步授权后才能继续。",
							tail: "需要进一步授权后才能继续。",
						},
						turns: [],
						runtime: {
							profile: "code",
							registeredToolNames: ["exec_command", "TodoWrite"],
							registeredTeamToolNames: ["spawn_agent"],
							requiredSkills: [],
							loadedSkills: [],
							allowedSubagentTypes: ["worker"],
							requireAgentsTeamExecution: false,
							contextDiagnostics: {
								totalChars: 8000,
								totalBudgetChars: 12000,
								sources: [
									{
										id: "runtime_diagnostics",
										kind: "runtime_diagnostics",
										summary: "runtime diagnostic context",
										chars: 2000,
										budgetChars: 2000,
										truncated: true,
									},
								],
							},
							policySummary: {
								totalDecisions: 2,
								allowCount: 0,
								denyCount: 1,
								requiresApprovalCount: 1,
								uniqueDeniedSignatures: [
									"user:tool:needs approval",
									"runtime_grant:path:path denied",
								],
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "执行本地命令并修复当前文件。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				mode: "auto",
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as { meta: Record<string, unknown> }).meta;
		expect(rawMeta.diagnosticFlags).toEqual([]);
		expect(rawMeta.runtime).toMatchObject({
			contextDiagnostics: {
				totalChars: 8000,
				totalBudgetChars: 12000,
				sources: [expect.objectContaining({ id: "runtime_diagnostics", truncated: true })],
			},
			policySummary: {
				totalDecisions: 2,
				denyCount: 1,
				requiresApprovalCount: 1,
			},
		});
	});

	it("accepts auto mode when real agents-team execution evidence exists", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-auto-with-team-evidence",
					text: "已完成第一章三个关键帧并落到画布。",
					trace: {
						toolCalls: [
							{
								name: "spawn_agent",
								status: "succeeded",
								outputPreview: JSON.stringify({
									agent_id: "agent-1",
									submission_id: "submission-1",
								}),
							},
							{ name: "tapcanvas_image_generate_to_canvas", status: "succeeded" },
						],
						summary: {
							totalToolCalls: 2,
							succeededToolCalls: 2,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 93,
						},
						output: {
							head: "已完成第一章三个关键帧并落到画布。",
							tail: "tapcanvas_image_generate_to_canvas",
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
			prompt: "根据第一章内容，完成第一章的三个关键帧图片。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				mode: "auto",
				forceAssetGeneration: true,
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as { meta: { diagnosticFlags: Array<{ code: string }>; turnVerdict: { status: string; reasons: string[] } } }).meta;
		expect(rawMeta.diagnosticFlags).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "auto_mode_agents_team_execution_missing" }),
			]),
		);
		expect(rawMeta.turnVerdict).toEqual({
			status: "satisfied",
			reasons: ["validated_result"],
		});
	});

	it("does not treat preview-only Task json as agents-team execution evidence in auto mode", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-auto-preview-only-task-json",
					text: "我已完成。",
					trace: {
						toolCalls: [
							{
								name: "Task",
								status: "succeeded",
								outputPreview: JSON.stringify({
									agentType: "writer",
									result: "preview only",
								}),
							},
						],
						summary: {
							totalToolCalls: 1,
							succeededToolCalls: 1,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 18,
						},
						output: {
							head: "我已完成。",
							tail: "我已完成。",
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
			prompt: "根据第一章内容，完成第一章的三个关键帧图片。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				mode: "auto",
				forceAssetGeneration: true,
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as { meta: { diagnosticFlags: Array<{ code: string }>; turnVerdict: { status: string; reasons: string[] } } }).meta;
		expect(rawMeta.diagnosticFlags).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "auto_mode_agents_team_execution_missing" }),
			]),
		);
	});

	it("rejects forced local workspace access on the public agents surface", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-force-bash-guard",
					text: "已收到本地取证约束。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "读取这本书第一章正文并告诉我讲了什么。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				forceLocalResourceViaBash: true,
				localResourcePaths: ["/app/project-data/users/user-1/projects/project-1/books/book-1"],
			},
		})).rejects.toMatchObject({
			code: "public_agents_local_resource_access_forbidden",
			status: 403,
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("does not inspect or expose local project paths for ordinary project chat", async () => {
		const repoRoot = path.resolve(process.cwd(), "..", "..");
		const scopedBooksRoot = path.join(
			repoRoot,
			"project-data",
			"users",
			"user-1",
			"projects",
			"project-1",
			"books",
		);
		const scopedBookDir = path.join(scopedBooksRoot, "book-1");
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-auto-force-book-bash",
					text: "已收到单书本地取证约束。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(fs, "readdir").mockImplementation(async (targetPath) => {
			if (String(targetPath) === scopedBooksRoot) {
				return [{ name: "book-1", isDirectory: () => true }] as Awaited<ReturnType<typeof fs.readdir>>;
			}
			return [] as Awaited<ReturnType<typeof fs.readdir>>;
		});
		vi.spyOn(fs, "readFile").mockImplementation(async (targetPath) => {
			if (String(targetPath) === path.join(scopedBookDir, "index.json")) {
				return JSON.stringify({
					projectId: "project-1",
					bookId: "book-1",
					title: "地煞七十二变",
					chapterCount: 1,
					chapters: [],
				});
			}
			throw new Error(`unexpected readFile: ${String(targetPath)}`);
		});
		vi.spyOn(fs, "access").mockImplementation(async (targetPath) => {
			if (String(targetPath) === path.join(scopedBookDir, "index.json")) {
				return undefined;
			}
			throw new Error(`unexpected access: ${String(targetPath)}`);
		});

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "小说第一章内容讲了什么？",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.forceLocalResourceViaBash).toBeUndefined();
		expect(requestBody.localResourcePaths).toBeUndefined();
		expect(requestBody.privilegedLocalAccess).toBeUndefined();
		expect(fs.readdir).not.toHaveBeenCalled();
		expect(fs.readFile).not.toHaveBeenCalled();
		expect(fs.access).not.toHaveBeenCalled();
		expect(String(requestBody.systemPrompt || "")).not.toContain("硬性要求：必须先使用 bash 工具读取本地资源");
		expect(String(requestBody.systemPrompt || "")).not.toContain("先读取该目录下的 index.json");
	});

	it("does not inspect or expose local paths for ordinary visual-reference chat", async () => {
		const repoRoot = path.resolve(process.cwd(), "..", "..");
		const scopedBooksRoot = path.join(
			repoRoot,
			"project-data",
			"users",
			"user-1",
			"projects",
			"project-1",
			"books",
		);
		const scopedBookDir = path.join(scopedBooksRoot, "book-1");
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-auto-force-book-bash-scene-with-refs",
					text: "已收到场景创作取证约束。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(fs, "readdir").mockImplementation(async (targetPath) => {
			if (String(targetPath) === scopedBooksRoot) {
				return [{ name: "book-1", isDirectory: () => true }] as Awaited<ReturnType<typeof fs.readdir>>;
			}
			return [] as Awaited<ReturnType<typeof fs.readdir>>;
		});
		vi.spyOn(fs, "readFile").mockImplementation(async (targetPath) => {
			if (String(targetPath) === path.join(scopedBookDir, "index.json")) {
				return JSON.stringify({
					projectId: "project-1",
					bookId: "book-1",
					title: "地煞七十二变",
					chapterCount: 1,
					chapters: [],
				});
			}
			throw new Error(`unexpected readFile: ${String(targetPath)}`);
		});
		vi.spyOn(fs, "access").mockImplementation(async (targetPath) => {
			if (String(targetPath) === path.join(scopedBookDir, "index.json")) {
				return undefined;
			}
			throw new Error(`unexpected access: ${String(targetPath)}`);
		});

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "先生成关键帧，生成前看看是否需要生成角色卡，需要的话就生成。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				referenceImages: ["https://example.com/role-card.png"],
				assetInputs: [
					{
						url: "https://example.com/role-card.png",
						role: "reference",
					},
				],
				chatContext: {
					creationMode: "scene",
				},
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.forceLocalResourceViaBash).toBeUndefined();
		expect(requestBody.localResourcePaths).toBeUndefined();
		expect(requestBody.privilegedLocalAccess).toBeUndefined();
		expect(fs.readdir).not.toHaveBeenCalled();
		expect(fs.readFile).not.toHaveBeenCalled();
		expect(fs.access).not.toHaveBeenCalled();
		expect(String(requestBody.systemPrompt || "")).not.toContain("硬性要求：必须先使用 bash 工具读取本地资源");
		expect(String(requestBody.systemPrompt || "")).not.toContain("先读取该目录下的 index.json");
	});

	it("does not extract chapter number from prompt into bridge request metadata when chapterId was not provided", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-explicit-chapter-from-prompt",
					text: "已解析章节。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "小说第一章内容讲了什么？",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.diagnosticContext).toMatchObject({
			projectId: "project-1",
			flowId: "flow-1",
		});
		expect((requestBody.diagnosticContext as Record<string, unknown>).chapterId).toBeUndefined();

	});

	it("persists agents runtime execution provenance into diagnostics metadata", async () => {
		const executionProvenance = {
			version: 1,
			executionId: "execution-persisted-provenance",
			agentId: "root-agent",
			depth: 0,
			model: "gpt-5.6",
			apiStyle: "responses",
			requiredSkills: ["tapcanvas-dramatic-adapter"],
			loadedSkills: ["tapcanvas-dramatic-adapter"],
			startedAt: "2026-07-24T08:00:00.000Z",
		};
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-persisted-provenance",
					text: "已完成诊断。",
					trace: {
						toolCalls: [],
						summary: { totalToolCalls: 0 },
						output: { textChars: 7 },
						turns: [],
						runtime: {
							profile: "code",
							registeredToolNames: ["Skill"],
							registeredTeamToolNames: [],
							requiredSkills: ["tapcanvas-dramatic-adapter"],
							loadedSkills: ["tapcanvas-dramatic-adapter"],
							allowedSubagentTypes: [],
							requireAgentsTeamExecution: false,
							executionProvenance,
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "分析这一章的戏剧结构。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		});

		const responseMeta = (result.raw as { meta: Record<string, unknown> }).meta;
		expect(responseMeta.executionProvenance).toEqual(executionProvenance);
		expect(responseMeta.runtime).toMatchObject({ executionProvenance });
	});

	it("leaves chapter asset goal planning to agents-cli", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-goal",
					text: "已建立章节资产目标。",
					trace: {
						toolCalls: [],
						output: { textChars: 9 },
						summary: { totalToolCalls: 0 },
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "补齐章节资产",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chapterId: "chapter-2",
				chatContext: {
					workspaceAction: "chapter_asset_generation",
				},
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.allowedTools).toBeUndefined();
		expect(requestBody.diagnosticContext).not.toHaveProperty("goalSuggested");
		expect(requestBody.diagnosticContext).not.toHaveProperty("goalSuggestion");
	});

	it("does not forward the retired autoApprove gate for an explicitly requested chapter video", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-one-click-video",
					text: "BeatSheet 已提交。",
					trace: { toolCalls: [], output: { textChars: 12 }, summary: { totalToolCalls: 0 }, turns: [] },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "把这一章做成视频成片",
			extras: {
				canvasProjectId: "project-1",
				chapterId: "chapter-1",
				autoApprove: true,
				requiredSkills: ["tapcanvas-video-workflow"],
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.autoApprove).toBeUndefined();
		expect(requestBody.diagnosticContext).not.toHaveProperty("goalSuggested");
		expect(requestBody.diagnosticContext).not.toHaveProperty("goalSuggestion");
	});

	it("forwards project-scoped remote canvas tools to agents-cli", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-remote-tools",
					text: "已收到远程工具。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "添加空文本节点",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "测试项目",
					selectedNodeKind: "storyboard",
					selectedReference: {
						nodeId: "storyboard-node-1",
						kind: "storyboard",
						label: "分镜板",
						imageUrl: "https://example.com/storyboard.png",
					},
				},
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect((requestBody.diagnosticContext as Record<string, unknown> | undefined)?.selectedNodeKind).toBe(
			"image",
		);
		expect(String(requestBody.systemPrompt || "")).toContain("<tapcanvas_context>");
		expect(String(requestBody.systemPrompt || "")).not.toContain("docs/");
		expect(requestBody.remoteToolConfig).toMatchObject({
			endpoint: "https://api.tapcanvas.test/public/agents/tools/execute",
			projectId: "project-1",
			flowId: "flow-1",
		});
		expect(Array.isArray(requestBody.remoteTools)).toBe(true);
		const remoteTools = requestBody.remoteTools as Array<Record<string, unknown>>;
		const remoteToolCatalog = requestBody.remoteToolCatalog as Array<Record<string, unknown>>;
		expect(requestBody.canvasCapabilityManifest).toBeUndefined();
		expect(remoteTools).toEqual([]);
		expect(remoteToolCatalog.map((tool) => tool.name)).toEqual(expect.arrayContaining([
			"tapcanvas_project_context_get",
			"tapcanvas_project_chapters_list",
			"tapcanvas_project_chapter_get",
			"tapcanvas_books_list",
			"tapcanvas_material_assets_list",
			"tapcanvas_material_asset_versions_get",
			"tapcanvas_storyboard_anchor_candidates",
			"tapcanvas_pipeline_runs_list",
			"tapcanvas_pipeline_run_get",
			"tapcanvas_executions_list",
			"tapcanvas_execution_get",
			"tapcanvas_execution_node_runs_get",
			"tapcanvas_execution_events_list",
			"tapcanvas_workflow_execution_inspect",
			"tapcanvas_image_refs_get",
			"tapcanvas_flow_get",
			"tapcanvas_flow_search",
			"tapcanvas_flow_patch",
		]));
		expect(remoteToolCatalog.map((tool) => tool.name)).toContain("tapcanvas_image_generate_to_canvas");
		expect(remoteToolCatalog.map((tool) => tool.name)).not.toContain("tapcanvas_video_orchestrate");
		for (const unavailableName of [
			"tapcanvas_project_flows_list",
			"tapcanvas_story_facts_commit",
			"tapcanvas_book_storyboard_plan_upsert",
		]) {
			expect(remoteToolCatalog.map((tool) => tool.name)).not.toContain(unavailableName);
		}
		const flowPatchTool = remoteToolCatalog.find((tool) => tool.name === "tapcanvas_flow_patch");
		const flowPatchDescription = String(flowPatchTool?.description || "");
		expect(flowPatchDescription.length).toBeGreaterThan(0);
		expect(flowPatchTool).toMatchObject({
			schemaDeferred: true,
			descriptionDeferred: true,
			requiredScope: ["project", "canvas"],
			capability: "canvas_core",
		});
		expect(flowPatchTool?.parameters).toBeUndefined();
	});

	it("resolves the sole owner-visible project flow when flowId is omitted", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-project-tools-only",
					text: "已收到项目级工具。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "看看当前项目有哪些书和 flow",
			extras: {
				canvasProjectId: "project-1",
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		const remoteTools = (requestBody.remoteTools || []) as Array<Record<string, unknown>>;
		const remoteToolCatalog = (requestBody.remoteToolCatalog || []) as Array<Record<string, unknown>>;
		expect(requestBody.canvasCapabilityManifest).toBeUndefined();
		expect(remoteTools).toEqual([]);
		expect(remoteToolCatalog.map((tool) => tool.name)).toEqual(expect.arrayContaining([
			"tapcanvas_project_context_get",
			"tapcanvas_project_chapters_list",
			"tapcanvas_project_chapter_get",
			"tapcanvas_books_list",
			"tapcanvas_material_assets_list",
			"tapcanvas_material_asset_versions_get",
			"tapcanvas_storyboard_anchor_candidates",
			"tapcanvas_pipeline_runs_list",
			"tapcanvas_pipeline_run_get",
			"tapcanvas_executions_list",
			"tapcanvas_execution_get",
			"tapcanvas_execution_node_runs_get",
			"tapcanvas_execution_events_list",
			"tapcanvas_workflow_execution_inspect",
			"tapcanvas_image_refs_get",
			"tapcanvas_flow_get",
			"tapcanvas_flow_search",
			"tapcanvas_flow_patch",
		]));
		expect(remoteToolCatalog.map((tool) => tool.name)).not.toContain(
			"tapcanvas_book_storyboard_plan_upsert",
		);
		expect(remoteToolCatalog.map((tool) => tool.name)).toContain("tapcanvas_image_generate_to_canvas");
		expect(remoteToolCatalog.map((tool) => tool.name)).not.toContain("tapcanvas_video_orchestrate");
		expect(requestBody.remoteToolConfig).toMatchObject({
			endpoint: "https://api.tapcanvas.test/public/agents/tools/execute",
			projectId: "project-1",
			flowId: "flow-1",
		});
		expect(listFlowsByOwner).toHaveBeenCalledWith(expect.anything(), "user-1", "project-1");
		expect(createFlow).not.toHaveBeenCalled();
		expect(createFlowVersion).not.toHaveBeenCalled();
	});

	it("resolves but never creates the sole owner-visible writable flow", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-resolve-flow",
					text: "已解析当前画布。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "添加空文本节点",
			extras: {
				canvasProjectId: "project-1",
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody).not.toHaveProperty("tapcanvasProjectId");
		expect(requestBody).not.toHaveProperty("tapcanvasFlowId");
		expect(requestBody).not.toHaveProperty("tapcanvasNodeId");
		expect(requestBody).not.toHaveProperty("tapcanvasApiBaseUrl");
		expect(requestBody).not.toHaveProperty("tapcanvasAuthorization");
		expect(requestBody).not.toHaveProperty("tapcanvasApiKey");
		expect(requestBody).not.toHaveProperty("knowledgeContext");
		expect(requestBody.remoteToolConfig).toMatchObject({
			endpoint: "https://api.tapcanvas.test/public/agents/tools/execute",
			projectId: "project-1",
			flowId: "flow-1",
		});
		expect(listFlowsByOwner).toHaveBeenCalledWith(expect.anything(), "user-1", "project-1");
		expect(createFlow).not.toHaveBeenCalled();
		expect(createFlowVersion).not.toHaveBeenCalled();
		expect(requestBody.toolSurfaceConfig).toEqual({
			mode: "tapcanvas_public",
			hostUi: [],
			allowDelegation: false,
			allowsExternalMedia: true,
		});
		expect(requestBody.compactPrelude).toBe(true);
		expect(requestBody.sessionId).toEqual(expect.any(String));
	});

	it("starts ordinary project/book/chapter chat with the fresh executable model catalog", async () => {
		vi.spyOn(fs, "readFile").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/book-1/index.json")) {
				return JSON.stringify({
					projectId: "project-1",
					bookId: "book-1",
					title: "测试书籍",
					chapters: [{ chapter: 1 }],
				});
			}
			throw createFileNotFoundError(pathText);
		});
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-zero-eager-context",
					text: "已回答。",
					trace: {
						toolCalls: [],
						summary: { totalToolCalls: 0 },
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "这一章的主题是什么？",
			extras: {
				canvasProjectId: "project-1",
				bookId: "book-1",
				chapterId: "chapter-1",
			},
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.remoteToolConfig).toMatchObject({
			projectId: "project-1",
			bookId: "book-1",
			chapterId: "chapter-1",
		});
		expect(requestBody.remoteToolConfig).not.toHaveProperty("flowId");
		expect(requestBody.localResourcePaths).toBeUndefined();
		expect(requestBody.privilegedLocalAccess).toBeUndefined();
		expect(requestBody.larkCredentials).toBeUndefined();
		expect(listFlowsByOwner).not.toHaveBeenCalled();
		expect(createFlow).not.toHaveBeenCalled();
		expect(createFlowVersion).not.toHaveBeenCalled();
		expect(listAssetsForUser).not.toHaveBeenCalled();
		expect(listUserContextAssets).not.toHaveBeenCalled();
		expect(loadPublicChatEnabledModelCatalogSummary).toHaveBeenCalledWith(
			expect.anything(),
			"user-1",
		);
		expect(getLarkAppCredentials).not.toHaveBeenCalled();
	});

	it("sends an explicit empty public surface when no project scope is authorized", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-empty-tool-surface",
					text: "已回答。",
					trace: {
						toolCalls: [],
						summary: { totalToolCalls: 0 },
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "解释一下镜头景别。",
			extras: {},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.remoteTools).toEqual([]);
		expect(requestBody.remoteToolCatalog).toEqual([]);
		expect(requestBody.remoteToolConfig).toEqual({});
		expect(requestBody.toolSurfaceConfig).toEqual({
			mode: "tapcanvas_public",
			hostUi: [],
			allowDelegation: false,
			allowsExternalMedia: true,
		});
		expect(requestBody.compactPrelude).toBe(true);
	});

	it("removes provider submission capabilities from a trusted dependency continuation", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-dependency-settlement",
					text: "已使用现有异步资产完成验收。",
					trace: {
						toolCalls: [],
						summary: { totalToolCalls: 0 },
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "结算已经完成的异步资产。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		}, {
			trustedPublicContinuation: true,
			deniedRemoteTools: [
				"tapcanvas_image_generate_to_canvas",
				"tapcanvas_video_generate_to_canvas",
				"tapcanvas_workflow_run",
			],
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		const exposedNames = [
			...(requestBody.remoteTools as Array<Record<string, unknown>>),
			...(requestBody.remoteToolCatalog as Array<Record<string, unknown>>),
		].map((tool) => tool.name);
		expect(exposedNames).not.toContain("tapcanvas_image_generate_to_canvas");
		expect(exposedNames).not.toContain("tapcanvas_video_generate_to_canvas");
		expect(exposedNames).not.toContain("tapcanvas_workflow_run");
		expect(exposedNames).toContain("tapcanvas_image_reconcile");
		expect(exposedNames).toContain("tapcanvas_video_reconcile");
	});

	it("does not compact the public prelude when delegation is explicitly enabled", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-delegated-tool-surface",
					text: "已保留委派说明。",
					trace: {
						toolCalls: [],
						summary: { totalToolCalls: 0 },
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "请让 worker 并行整理当前任务。",
			extras: {
				allowedSubagentTypes: ["worker"],
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.toolSurfaceConfig).toEqual({
			mode: "tapcanvas_public",
			hostUi: [],
			allowDelegation: true,
			allowsExternalMedia: true,
		});
		expect(requestBody.compactPrelude).toBeUndefined();
	});

	it("does not preload or forward Lark credentials on the public bridge", async () => {
		getLarkAppCredentials.mockResolvedValue({
			appId: "lark-app-id",
			appSecret: "lark-app-secret",
			brand: "feishu",
		});
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-lark-facts-only",
					text: "已收到集成事实。",
					trace: {
						toolCalls: [],
						summary: { totalToolCalls: 0 },
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "总结我提供的资料。",
			extras: {},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.larkCredentials).toBeUndefined();
		expect(getLarkAppCredentials).not.toHaveBeenCalled();
		const systemPrompt = String(requestBody.systemPrompt || "");
		expect(systemPrompt).not.toContain("必须调用 lark_cli");
		expect(systemPrompt).not.toContain("lark_cli docs +fetch");
		expect(systemPrompt).not.toContain("用户已配置飞书/Lark 集成");
	});

	it.each([
		{
			label: "capability manifest",
			extras: { hostCapabilityManifest: { protocol_version: "2" } },
			code: "invalid_host_capability_manifest",
		},
		{
			label: "canvas context",
			extras: { hostCanvasContext: "invalid" },
			code: "invalid_host_canvas_context",
		},
	] as const)("rejects an invalid explicit host $label instead of falling back", async ({ extras, code }) => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			runAgentsBridgeChatTask(createContext(), "user-1", {
				kind: "chat",
				prompt: "测试宿主协议。",
				extras,
			}),
		).rejects.toMatchObject({ status: 400, code });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects a standalone host canvas context that no runtime branch can consume", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			runAgentsBridgeChatTask(createContext(), "user-1", {
				kind: "chat",
				prompt: "测试宿主画布快照。",
				extras: { hostCanvasContext: { nodes: [], edges: [] } },
			}),
		).rejects.toMatchObject({
			status: 400,
			code: "host_canvas_context_without_manifest",
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("keeps host mode to one direct flow_patch and an empty deferred catalog", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-host-surface",
					text: "已下发宿主补丁。",
					trace: {
						toolCalls: [],
						summary: { totalToolCalls: 0 },
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "在宿主画布添加图片节点。",
			extras: {
				hostCapabilityManifest: {
					protocol_version: "1",
					host: "test-host",
					patchOps: ["addNode", "runNode"],
					nodeSpecs: [{ type: "imageGenerator" }],
					ui: ["request_user_input", "media"],
				},
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(
			(requestBody.remoteTools as Array<Record<string, unknown>>).map((tool) => tool.name),
		).toEqual(["flow_patch"]);
		expect(requestBody.remoteToolCatalog).toEqual([]);
		expect(requestBody.toolSurfaceConfig).toEqual({
			mode: "host",
			hostUi: ["request_user_input", "media"],
			allowDelegation: false,
			allowsExternalMedia: true,
		});
		expect(requestBody.compactPrelude).toBe(true);
		expect(requestBody.includeFullToolInput).toBe(true);
		expect(requestBody.remoteToolConfig).toMatchObject({
			endpoint: "https://api.tapcanvas.test/public/agents/tools/host-execute",
		});
		expect(requestBody.remoteToolConfig).not.toHaveProperty("hostMode");
		expect(requestBody.remoteToolConfig).not.toHaveProperty("hostProtocolVersion");
	});

	it("preserves host surface mode when a restricted policy removes flow_patch", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-host-empty-surface",
					text: "宿主工具已受限。",
					trace: {
						toolCalls: [],
						summary: { totalToolCalls: 0 },
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "只回答，不改宿主画布。",
			extras: {
				hostCapabilityManifest: {
					protocol_version: "1",
					host: "restricted-host",
					patchOps: ["addNode"],
					nodeSpecs: [{ type: "text" }],
				},
				executionToolPolicy: { mode: "restricted", allowedTools: [] },
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.remoteTools).toEqual([]);
		expect(requestBody.remoteToolCatalog).toEqual([]);
		expect(requestBody.remoteToolConfig).toEqual({});
		expect(requestBody.toolSurfaceConfig).toEqual({
			mode: "host",
			hostUi: [],
			allowDelegation: false,
			allowsExternalMedia: true,
		});
		expect(requestBody.compactPrelude).toBe(true);
		expect(requestBody.includeFullToolInput).toBeUndefined();
	});

	it("keeps an allowed catalog tool dormant until an authorized DAG frontier activates it", async () => {
		vi.spyOn(fs, "readFile").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/book-1/index.json")) {
				return JSON.stringify({
					projectId: "project-1",
					bookId: "book-1",
					title: "测试书籍",
					chapters: [],
				});
			}
			throw createFileNotFoundError(pathText);
		});
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-restricted-catalog",
					text: "已收到受限能力面。",
					trace: {
						toolCalls: [],
						summary: { totalToolCalls: 0 },
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "提交已经准备好的事实变更。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				bookId: "book-1",
				executionToolPolicy: {
					mode: "restricted",
					allowedTools: ["tapcanvas_story_facts_commit"],
				},
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(
			(requestBody.remoteTools as Array<Record<string, unknown>>).map((tool) => tool.name),
		).toEqual([]);
		expect(
			(requestBody.remoteToolCatalog as Array<Record<string, unknown>>).map((tool) => tool.name),
		).toContain("tapcanvas_story_facts_commit");
		expect(requestBody.allowedTools).toEqual(["tapcanvas_story_facts_commit"]);
		expect(requestBody.toolSurfaceConfig).toMatchObject({ mode: "tapcanvas_public" });
	});

	it("forwards response_format preferences to agents-cli chat requests", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-response-format",
					text: "已收到结构化输出约束。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const responseFormat = {
			type: "json_schema",
			json_schema: {
				name: "canvas_write_result",
				schema: {
					type: "object",
					properties: {
						ok: { type: "boolean" },
					},
					required: ["ok"],
				},
			},
		};
		const outputContract = {
			kind: "json",
			requiredArrayField: "$",
		};
		const workflowPhysicalAttemptDeadlineAt = "2026-08-29T05:02:20.000Z";

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "添加空白文本节点",
			extras: {
					canvasProjectId: "project-1",
					canvasFlowId: "flow-1",
					responseFormat,
					outputContract,
					workflowPhysicalAttemptDeadlineAt,
					forcedAgentRole: "writer",
				},
			}, {
				directForcedAgentExecution: true,
			});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.responseFormat).toEqual(responseFormat);
		expect(requestBody.outputContract).toEqual(outputContract);
		expect(requestBody.workflowPhysicalAttemptDeadlineAt).toBe(workflowPhysicalAttemptDeadlineAt);
		expect(requestBody.canvasCapabilityManifest).toBeUndefined();
		const remoteTools = (requestBody.remoteTools || []) as Array<Record<string, unknown>>;
		const flowPatchTool = remoteTools.find((tool) => tool.name === "tapcanvas_flow_patch");
		expect(flowPatchTool?.parameters).toBeTruthy();
		expect(String(flowPatchTool?.description || "")).toContain("allowOverwrite=true");
		expect(String(flowPatchTool?.description || "")).not.toContain("A blank text node must be a taskNode");

		fetchMock.mockClear();
		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "继续同一结构化节点",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				responseFormat,
				outputContract,
				continuationExecutionContract: {
					workflowPhysicalAttemptDeadlineAt,
				},
				forcedAgentRole: "writer",
			},
		}, {
			directForcedAgentExecution: true,
		});
		const nestedRequestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const nestedRequestBody = JSON.parse(String(nestedRequestInit?.body || "{}")) as Record<string, unknown>;
		expect(nestedRequestBody.workflowPhysicalAttemptDeadlineAt).toBe(workflowPhysicalAttemptDeadlineAt);
	});

	it("marks successful tapcanvas_flow_patch calls as direct canvas writes", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-flow-patch-write",
					text: "已在画布添加文本节点。",
					trace: {
						toolCalls: [{ name: "tapcanvas_flow_patch", status: "succeeded" }],
						summary: {
							totalToolCalls: 1,
							succeededToolCalls: 1,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 25,
						},
						output: { head: "已在画布添加文本节点。", tail: "已在画布添加文本节点。" },
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "添加一个文本节点到画布",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				planOnly: true,
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as { meta: Record<string, unknown> }).meta;
		expect(rawMeta.agentDecision).toEqual(
			expect.objectContaining({
				executionKind: "execute",
				canvasAction: "write_canvas",
			}),
		);
		expect(rawMeta.toolEvidence).toEqual(
			expect.objectContaining({
				readProjectState: true,
				wroteCanvas: true,
			}),
		);
	});

	it("summarizes created and patched canvas node ids for frontend follow-up execution", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-flow-patch-summary",
					text: "已补全旧节点并新增脚本节点。",
					trace: {
						toolCalls: [
							{
								name: "tapcanvas_flow_patch",
								status: "succeeded",
								input: {
									createNodes: [
										{
											id: "new-script-1",
											type: "taskNode",
											position: { x: 0, y: 0 },
											data: { kind: "storyboardScript", content: "第四章补充脚本" },
										},
									],
									patchNodeData: [
										{
											id: "ch4-img-2",
											data: {
												kind: "image",
												status: "queued",
												prompt: "重做第四章关键帧2",
											},
										},
									],
								},
							},
						],
						summary: {
							totalToolCalls: 1,
							succeededToolCalls: 1,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 25,
						},
						output: { head: "已补全旧节点并新增脚本节点。", tail: "已补全旧节点并新增脚本节点。" },
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "补全第四章缺失画面",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as { meta: Record<string, unknown> }).meta;
		expect(rawMeta.canvasMutation).toEqual({
			deletedNodeIds: [],
			deletedEdgeIds: [],
			createdNodeIds: ["new-script-1"],
			patchedNodeIds: ["ch4-img-2"],
			executableNodeIds: ["ch4-img-2"],
		});
	});

	it("does not count failed tapcanvas_flow_patch calls as canvas-write evidence", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-flow-patch-failed",
					text: "flow patch 失败，未写入画布。",
					trace: {
						...buildCanonicalAgentsBridgeFailure("tool_execution_issues"),
						toolCalls: [
							{
								name: "tapcanvas_flow_patch",
								status: "failed",
								outputPreview: "createEdges targetHandle 非法: in-any",
							},
						],
						summary: {
							totalToolCalls: 1,
							succeededToolCalls: 0,
							failedToolCalls: 1,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 25,
						},
						output: { head: "flow patch 失败，未写入画布。", tail: "flow patch 失败，未写入画布。" },
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "把节点写进画布",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		});

		expect(result.status).toBe("failed");
		const rawMeta = (result.raw as {
			meta: {
				agentDecision: Record<string, unknown>;
				toolEvidence: Record<string, unknown>;
				turnVerdict: { status: string; reasons: string[] };
			};
		}).meta;
		expect(rawMeta.agentDecision).toEqual(
			expect.objectContaining({
				executionKind: "answer",
				canvasAction: "none",
			}),
		);
		expect(rawMeta.toolEvidence).toEqual(
			expect.objectContaining({
				readProjectState: false,
				wroteCanvas: false,
			}),
		);
		expect(rawMeta.turnVerdict).toEqual({
			status: "failed",
			reasons: ["tool_execution_issues"],
		});
	});

	it("marks successful tapcanvas_video_generate_to_canvas calls as generated assets and direct canvas writes", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-video-generate-write",
					text: "已生成视频并写入画布。",
					trace: {
						toolCalls: [{ name: "tapcanvas_video_generate_to_canvas", status: "succeeded" }],
						summary: {
							totalToolCalls: 1,
							succeededToolCalls: 1,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 30,
						},
						output: { head: "已生成视频并写入画布。", tail: "已生成视频并写入画布。" },
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "直接生成一个视频并放进画布",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as { meta: Record<string, unknown> }).meta;
		expect(rawMeta.agentDecision).toEqual(
			expect.objectContaining({
				executionKind: "execute",
				canvasAction: "write_canvas",
			}),
		);
		expect(rawMeta.toolEvidence).toEqual(
			expect.objectContaining({
				generatedAssets: true,
				wroteCanvas: true,
			}),
		);
	});

	it("does not count failed tapcanvas_image_generate_to_canvas calls as generated-asset evidence", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-image-generate-failed",
					text: "图片生成失败。",
					trace: {
						...buildCanonicalAgentsBridgeFailure("tool_execution_issues"),
						toolCalls: [
							{
								name: "tapcanvas_image_generate_to_canvas",
								status: "failed",
								outputPreview: "model_alias_not_found",
							},
						],
						summary: {
							totalToolCalls: 1,
							succeededToolCalls: 0,
							failedToolCalls: 1,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 30,
						},
						output: { head: "图片生成失败。", tail: "图片生成失败。" },
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "直接生成一张图并放进画布",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		});

		expect(result.status).toBe("failed");
		const rawMeta = (result.raw as {
			meta: {
				agentDecision: Record<string, unknown>;
				toolEvidence: Record<string, unknown>;
				turnVerdict: { status: string; reasons: string[] };
			};
		}).meta;
		expect(rawMeta.agentDecision).toEqual(
			expect.objectContaining({
				executionKind: "answer",
				canvasAction: "none",
			}),
		);
		expect(rawMeta.toolEvidence).toEqual(
			expect.objectContaining({
				generatedAssets: false,
				wroteCanvas: false,
			}),
		);
		expect(rawMeta.turnVerdict).toEqual({
			status: "failed",
			reasons: ["tool_execution_issues"],
		});
	});

	it("allows single_video text-grounded plans that use a non-anchor selected image as direct video start frame", async () => {
		vi.spyOn(fs, "access").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/__________sosdbot-1773463170328/index.json")) return undefined;
			throw new Error("not found");
		});
		vi.spyOn(fs, "readdir").mockResolvedValue([
			{
				name: "__________sosdbot-1773463170328",
				isDirectory: () => true,
			},
		] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
		vi.spyOn(fs, "readFile").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/__________sosdbot-1773463170328/index.json")) {
				return JSON.stringify({
					title: "蛊真人",
					chapters: [{ chapter: 2 }],
				});
			}
			throw new Error(`unexpected path: ${pathText}`);
		});
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-non-anchor-direct-video",
					text: "以下为规划，尚未执行。\nprompt: use selected image as direct video start.\nstoryBeatPlan: [{\"summary\":\"beat1\"}]",
					trace: {
						toolCalls: [
							{ name: "tapcanvas_book_chapter_get", status: "succeeded" },
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "video_prompt_specialist" },
								outputJson: {
									storyBeatPlan: [{ summary: "beat1" }],
									prompt: "use selected image as direct video start",
								},
							},
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "pacing_reviewer" },
								outputJson: {
									compressionRisk: "low",
									splitRecommendation: "keep_single_clip",
								},
							},
						],
						summary: {
							totalToolCalls: 3,
							succeededToolCalls: 3,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 120,
						},
						output: { head: "以下为规划，尚未执行。", tail: "prompt: use selected image as direct video start." },
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "请根据上传文本快捷创作单个视频。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					creationMode: "single_video",
					requireProjectTextEvidence: true,
					selectedReference: {
						nodeId: "node-1",
						label: "人物三视图",
						kind: "image",
						imageUrl: "https://example.com/ref-sheet.png",
						chapterId: "2",
						productionLayer: "expansion",
						creationStage: "single_variable_expansion",
						approvalStatus: "needs_confirmation",
						hasUpstreamTextEvidence: false,
						hasDownstreamComposeVideo: false,
					},
				},
			},
		});
		expect(result.status).toBe("succeeded");
	});

	it("allows single_video text-grounded plans to go direct-to-video when selected node is a real scene anchor", async () => {
		vi.spyOn(fs, "access").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/__________sosdbot-1773463170328/index.json")) return undefined;
			throw new Error("not found");
		});
		vi.spyOn(fs, "readdir").mockResolvedValue([
			{
				name: "__________sosdbot-1773463170328",
				isDirectory: () => true,
			},
		] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
		vi.spyOn(fs, "readFile").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/__________sosdbot-1773463170328/index.json")) {
				return JSON.stringify({
					title: "蛊真人",
					chapters: [{ chapter: 2 }],
				});
			}
			throw new Error(`unexpected path: ${pathText}`);
		});
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-anchor-direct-video",
					text: "以下为规划，尚未执行。\nprompt: use locked scene keyframe motion.\nstoryBeatPlan: [{\"summary\":\"beat1\"}]",
					trace: {
						toolCalls: [
							{ name: "tapcanvas_book_chapter_get", status: "succeeded" },
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "video_prompt_specialist" },
								outputJson: {
									storyBeatPlan: [{ summary: "beat1" }],
									prompt: "use locked scene keyframe motion",
								},
							},
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "pacing_reviewer" },
								outputJson: {
									compressionRisk: "low",
									splitRecommendation: "keep_single_clip",
								},
							},
						],
						summary: {
							totalToolCalls: 3,
							succeededToolCalls: 3,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 120,
						},
						output: { head: "以下为规划，尚未执行。", tail: "prompt: use locked scene keyframe motion." },
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "请根据上传文本快捷创作单个视频。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					creationMode: "single_video",
					requireProjectTextEvidence: true,
					selectedReference: {
						nodeId: "node-2",
						label: "已锁关键帧",
						kind: "storyboardShot",
						imageUrl: "https://example.com/locked-shot.png",
						chapterId: "2",
						productionLayer: "anchors",
						creationStage: "shot_anchor_lock",
						approvalStatus: "approved",
					},
				},
			},
		});

		const rawMeta = (result.raw as { meta: Record<string, unknown> }).meta;
		expect(rawMeta.diagnosticFlags).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "novel_single_video_reference_not_scene_anchor" }),
			]),
		);
	});

	it("allows single_video text-grounded plans to go direct-to-video when selected image is structurally proven as a scene keyframe", async () => {
		vi.spyOn(fs, "access").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/__________sosdbot-1773463170328/index.json")) return undefined;
			throw new Error("not found");
		});
		vi.spyOn(fs, "readdir").mockResolvedValue([
			{
				name: "__________sosdbot-1773463170328",
				isDirectory: () => true,
			},
		] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
		vi.spyOn(fs, "readFile").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/__________sosdbot-1773463170328/index.json")) {
				return JSON.stringify({
					title: "蛊真人",
					chapters: [{ chapter: 2 }],
				});
			}
			throw new Error(`unexpected path: ${pathText}`);
		});
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-structural-anchor-direct-video",
					text: "以下为规划，尚未执行。\nprompt: use selected still as scene keyframe motion.\nstoryBeatPlan: [{\"summary\":\"beat1\"}]",
					trace: {
						toolCalls: [
							{ name: "tapcanvas_book_chapter_get", status: "succeeded" },
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "video_prompt_specialist" },
								outputJson: {
									storyBeatPlan: [{ summary: "beat1" }],
									prompt: "use selected still as scene keyframe motion",
								},
							},
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "pacing_reviewer" },
								outputJson: {
									compressionRisk: "low",
									splitRecommendation: "keep_single_clip",
								},
							},
						],
						summary: {
							totalToolCalls: 3,
							succeededToolCalls: 3,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 120,
						},
						output: {
							head: "以下为规划，尚未执行。",
							tail: "prompt: use selected still as scene keyframe motion.",
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
			prompt: "请根据上传文本快捷创作单个视频。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					creationMode: "single_video",
					requireProjectTextEvidence: true,
					selectedReference: {
						nodeId: "node-3",
						label: "山巅围杀中的方源",
						kind: "image",
						imageUrl: "https://example.com/scene-still.png",
						chapterId: "2",
						productionLayer: "expansion",
						creationStage: "single_variable_expansion",
						approvalStatus: "needs_confirmation",
						hasUpstreamTextEvidence: true,
						hasDownstreamComposeVideo: true,
					},
				},
			},
		});

		const rawMeta = (result.raw as { meta: Record<string, unknown> }).meta;
		expect(rawMeta.diagnosticFlags).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "novel_single_video_reference_not_scene_anchor" }),
			]),
		);
	});

	it("keeps single_video novel plans diagnosable when chapter正文 was not read", async () => {
		vi.spyOn(fs, "access").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/__________sosdbot-1773463170328/index.json")) return undefined;
			throw new Error("not found");
		});
		vi.spyOn(fs, "readdir").mockResolvedValue([
			{
				name: "__________sosdbot-1773463170328",
				isDirectory: () => true,
			},
		] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
		vi.spyOn(fs, "readFile").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/__________sosdbot-1773463170328/index.json")) {
				return JSON.stringify({
					title: "蛊真人",
					chapters: [{ chapter: 2 }],
				});
			}
			throw new Error(`unexpected path: ${pathText}`);
		});
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-no-chapter-read",
					text: "以下为规划，尚未执行。\nprompt: use locked keyframe motion.\nstoryBeatPlan: [{\"summary\":\"beat1\"}]",
					trace: {
						toolCalls: [
							{ name: "tapcanvas_canvas_workflow_analyze", status: "succeeded" },
							{ name: "tapcanvas_storyboard_continuity_get", status: "succeeded" },
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "video_prompt_specialist" },
								outputJson: buildGovernedVideoPromptPayload({
									storyBeatPlan: [{ summary: "beat1" }],
									videoPrompt: "use locked keyframe motion",
								}),
							},
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "pacing_reviewer" },
								outputJson: {
									compressionRisk: "low",
									splitRecommendation: "keep_single_clip",
								},
							},
						],
						summary: {
							totalToolCalls: 4,
							succeededToolCalls: 4,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 120,
						},
						output: { head: "以下为规划，尚未执行。", tail: "prompt: use locked keyframe motion." },
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
				kind: "chat",
				prompt: "请进入单个视频高效快捷创作模式。",
				extras: {
					canvasProjectId: "project-1",
					canvasFlowId: "flow-1",
					chatContext: {
						currentProjectName: "蛊真人",
						creationMode: "single_video",
					},
				},
		});
		const rawMeta = (result.raw as { meta: Record<string, unknown> }).meta;
		expect(rawMeta.diagnosticFlags).toEqual([]);
	});

	it("keeps text-grounded single_video quick action diagnosable when uploaded novel text was not read", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-require-project-text",
					text: "以下为规划，尚未执行。\nprompt: use locked keyframe motion.\nstoryBeatPlan: [{\"summary\":\"beat1\"}]",
					trace: {
						toolCalls: [
							{ name: "tapcanvas_canvas_workflow_analyze", status: "succeeded" },
							{ name: "tapcanvas_books_list", status: "succeeded" },
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "video_prompt_specialist" },
								outputJson: buildGovernedVideoPromptPayload({
									storyBeatPlan: [{ summary: "beat1" }],
									videoPrompt: "use locked keyframe motion",
								}),
							},
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "pacing_reviewer" },
								outputJson: {
									compressionRisk: "low",
									splitRecommendation: "keep_single_clip",
								},
							},
						],
						summary: {
							totalToolCalls: 4,
							succeededToolCalls: 4,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 120,
						},
						output: { head: "以下为规划，尚未执行。", tail: "prompt: use locked keyframe motion." },
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
				kind: "chat",
				prompt: "请根据上传文本快捷创作单个视频。",
				extras: {
					canvasProjectId: "project-1",
					canvasFlowId: "flow-1",
					chatContext: {
						currentProjectName: "蛊真人",
						creationMode: "single_video",
						requireProjectTextEvidence: true,
					},
				},
		});
		const rawMeta = (result.raw as { meta: Record<string, unknown> }).meta;
		expect(rawMeta.diagnosticFlags).toEqual([]);
	});

	it("keeps source bundle only single_video responses diagnosable when chapter正文 is still missing", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-source-bundle-only",
					text: [
						"以下为规划，尚未执行：",
						'<tapcanvas_canvas_plan>{"action":"create_canvas_workflow","summary":"test","reason":"test","nodes":[{"clientId":"n1","kind":"composeVideo","label":"待确认的单视频节点","position":{"x":0,"y":0},"config":{"storyBeatPlan":["待确认章节正文后再填写真实剧情拍点。"],"videoPrompt":"待确认章节进度与正文后再生成。","status":"error","logs":["缺少与当前进度绑定的有效正文片段。"]}}],"edges":[]}</tapcanvas_canvas_plan>',
					].join("\n"),
					trace: {
						toolCalls: [
							{ name: "tapcanvas_canvas_workflow_analyze", status: "succeeded" },
							{ name: "tapcanvas_books_list", status: "succeeded" },
							{ name: "tapcanvas_storyboard_source_bundle_get", status: "succeeded" },
							{ name: "tapcanvas_storyboard_continuity_get", status: "succeeded" },
							{ name: "tapcanvas_book_index_get", status: "succeeded" },
						],
						summary: {
							totalToolCalls: 5,
							succeededToolCalls: 5,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 120,
						},
						output: { head: "以下为规划，尚未执行。", tail: "待确认章节进度与正文后再生成。" },
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
				kind: "chat",
				prompt: "请根据上传文本快捷创作单个视频。",
				extras: {
					canvasProjectId: "project-1",
					canvasFlowId: "flow-1",
					chatContext: {
						currentProjectName: "蛊真人",
						creationMode: "single_video",
						requireProjectTextEvidence: true,
					},
				},
		});
		const rawMeta = (result.raw as { meta: Record<string, unknown> }).meta;
		expect(rawMeta.diagnosticFlags).toEqual([]);
	});

	it("does not inject project text local-access guards for generic canvas mutations", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
		const requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
			expect(requestBody.localResourcePaths).toBeUndefined();
			expect(requestBody.allowedTools).toBeUndefined();
			expect(requestBody.privilegedLocalAccess).toBeUndefined();
			expect(requestBody.forceLocalResourceViaBash).toBeUndefined();
			expect(String(requestBody.prompt || "")).not.toContain("自动项目文本访问");
			expect(String(requestBody.prompt || "")).not.toContain("强制读取顺序：先用 tapcanvas_books_list");
			expect(String(requestBody.systemPrompt || "")).not.toContain("自动项目文本访问");
			expect(String(requestBody.systemPrompt || "")).not.toContain("强制读取顺序：先用 tapcanvas_books_list");
			expect(String(requestBody.systemPrompt || "")).not.toContain("【结果透明要求】");
			expect(String(requestBody.systemPrompt || "")).not.toContain("只陈述已被本轮工具或结构化结果直接证实的事实");
			expect(String(requestBody.systemPrompt || "")).not.toContain("若未读取当前项目状态，不得把项目进度、画布状态或界面可见性写成已确认事实");
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-generic-canvas-mutation",
					text: "已执行。",
					trace: {
						toolCalls: [{ name: "tapcanvas_flow_patch", status: "succeeded" }],
						summary: {
							totalToolCalls: 1,
							succeededToolCalls: 1,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 50,
						},
						output: { head: "已执行。", tail: "已执行。" },
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "添加一个空白文本节点到当前画布。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					creationMode: "scene",
				},
			},
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("does not flag missing video specialists for placeholder error composeVideo nodes", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-placeholder-video-node",
					text: [
						"以下为规划，尚未执行：",
						'<tapcanvas_canvas_plan>{"action":"create_canvas_workflow","summary":"test","reason":"test","nodes":[{"clientId":"n1","kind":"composeVideo","label":"待确认的单视频节点","position":{"x":0,"y":0},"config":{"storyBeatPlan":["待确认章节正文后再填写真实剧情拍点。"],"videoPrompt":"待确认章节进度与正文后再生成。","status":"error","logs":["禁止执行"]}}],"edges":[]}</tapcanvas_canvas_plan>',
					].join("\n"),
					trace: {
						toolCalls: [
							{ name: "tapcanvas_canvas_workflow_analyze", status: "succeeded" },
						],
						summary: {
							totalToolCalls: 1,
							succeededToolCalls: 1,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 120,
						},
						output: { head: "以下为规划，尚未执行。", tail: "待确认章节进度与正文后再生成。" },
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "请先铺一个待确认单视频流程。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
			},
		});

		const rawMeta = (result.raw as { meta: Record<string, unknown> }).meta;
		expect(rawMeta.diagnosticFlags).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "video_prompt_missing_specialist_task" }),
				expect.objectContaining({ code: "video_prompt_missing_pacing_review" }),
			]),
		);
	});

	it("does not require video specialists for plan_only canvas plans that already contain videoPrompt", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-plan-only-video-prompts",
					text: [
						"以下为规划，尚未执行：",
						'<tapcanvas_canvas_plan>{"action":"create_canvas_workflow","summary":"plan only","reason":"test","nodes":[{"clientId":"n1","kind":"composeVideo","label":"视频节点","position":{"x":0,"y":0},"config":{"prompt":"概述","storyBeatPlan":["beat 1","beat 2"]}}],"edges":[]}</tapcanvas_canvas_plan>',
					].join("\n"),
					trace: {
						toolCalls: [
							{ name: "tapcanvas_canvas_workflow_analyze", status: "succeeded" },
							{ name: "tapcanvas_book_chapter_get", status: "succeeded" },
						],
						summary: {
							totalToolCalls: 2,
							succeededToolCalls: 2,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 120,
						},
						output: { head: "以下为规划，尚未执行。", tail: "locked scene motion" },
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "给我一版高质量的提示词",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				planOnly: true,
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as { meta: Record<string, unknown> }).meta;
		expect(rawMeta.outputMode).toBe("plan_only");
		expect(rawMeta.diagnosticFlags).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "video_prompt_missing_specialist_task" }),
				expect.objectContaining({ code: "video_prompt_missing_pacing_review" }),
			]),
		);
	});

	it("rejects single_video novel plans when current progress was not identified before reading正文", async () => {
		vi.spyOn(fs, "access").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/__________sosdbot-1773463170328/index.json")) return undefined;
			throw new Error("not found");
		});
		vi.spyOn(fs, "readdir").mockResolvedValue([
			{
				name: "__________sosdbot-1773463170328",
				isDirectory: () => true,
			},
		] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
		vi.spyOn(fs, "readFile").mockImplementation(async (inputPath) => {
			const pathText = String(inputPath || "");
			if (pathText.includes("/books/__________sosdbot-1773463170328/index.json")) {
				return JSON.stringify({
					title: "蛊真人",
					chapters: [{ chapter: 2 }],
				});
			}
			throw new Error(`unexpected path: ${pathText}`);
		});
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-no-progress-detect",
					text: "以下为规划，尚未执行。\nprompt: use locked keyframe motion.\nstoryBeatPlan: [{\"summary\":\"beat1\"}]",
					trace: {
						toolCalls: [
							{ name: "tapcanvas_canvas_workflow_analyze", status: "succeeded" },
							{ name: "tapcanvas_book_chapter_get", status: "succeeded" },
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "video_prompt_specialist" },
								outputJson: buildGovernedVideoPromptPayload({
									storyBeatPlan: [{ summary: "beat1" }],
									videoPrompt: "use locked keyframe motion",
								}),
							},
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "pacing_reviewer" },
								outputJson: {
									compressionRisk: "low",
									splitRecommendation: "keep_single_clip",
								},
							},
						],
						summary: {
							totalToolCalls: 4,
							succeededToolCalls: 4,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 120,
						},
						output: { head: "以下为规划，尚未执行。", tail: "prompt: use locked keyframe motion." },
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
				kind: "chat",
				prompt: "请进入单个视频高效快捷创作模式。",
				extras: {
					canvasProjectId: "project-1",
					canvasFlowId: "flow-1",
					chatContext: {
						currentProjectName: "蛊真人",
						creationMode: "single_video",
					},
				},
		});
		const rawMeta = (result.raw as { meta: Record<string, unknown> }).meta;
		expect(rawMeta.diagnosticFlags).toEqual([]);
	});

	it("fails early when the supplied canvasFlowId does not belong to the current user project", async () => {
		getFlowForOwner.mockResolvedValue(null);
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			runAgentsBridgeChatTask(createContext(), "user-1", {
				kind: "chat",
				prompt: "分析第二章开场。",
				extras: {
					canvasProjectId: "project-1",
					canvasFlowId: "missing-flow",
				},
			}),
		).rejects.toMatchObject({
			status: 404,
			code: "flow_not_found",
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("accepts specialist success from structured outputJson even when outputPreview is truncated", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-output-json",
					text: "以下为规划，尚未执行。\nprompt: use locked keyframe motion.\nstoryBeatPlan: [...]",
					trace: {
						toolCalls: [
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "video_prompt_specialist" },
								outputPreview: '{"storyBeatPlan":[{"summary":"beat1"}],"prompt":"very long…(truncated)',
								outputJson: {
									storyBeatPlan: [{ summary: "beat1" }, { summary: "beat2" }],
									prompt: "use locked keyframe motion",
								},
							},
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "pacing_reviewer" },
								outputPreview: '{"compressionRisk":"low","splitRecommendation":"no split needed"}',
								outputJson: {
									compressionRisk: "low",
									splitRecommendation: "no split needed",
								},
							},
						],
						summary: {
							totalToolCalls: 2,
							succeededToolCalls: 2,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 120,
						},
						output: {
							head: "以下为规划，尚未执行。",
							tail: "prompt: use locked keyframe motion.",
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
			prompt: "请基于当前关键帧直接生成一条单视频方案。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				planOnly: true,
			},
		});

		expect(result.status).toBe("succeeded");
	});

	it("allows prompt specialist situational claims when no chapter or continuity evidence was read", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-situational-claim-without-evidence",
					text: JSON.stringify({
						imagePrompt: "@方源 stands alone on the summit, enemies hesitate to attack.",
					}),
					trace: {
						toolCalls: [
							{ name: "tapcanvas_canvas_workflow_analyze", status: "succeeded" },
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "image_prompt_specialist" },
								outputJson: {
									imagePrompt:
										"@方源 stands alone on the summit, enemies hesitate to attack from the outer ring.",
									dramaticFunction: "standoff before the final break",
									situationFrame: "群雄围而不攻，主角压住全场",
								},
							},
						],
						summary: {
							totalToolCalls: 2,
							succeededToolCalls: 2,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 120,
						},
						output: {
							head: "imagePrompt: @方源 stands alone on the summit.",
							tail: "dramaticFunction: standoff before the final break.",
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
			prompt: "直接给我第二章山巅围杀图提示词。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeLabel: "山巅围杀起始帧",
					selectedNodeKind: "storyboardShot",
					creationMode: "scene",
				},
			},
		});
		expect(result.status).toBe("succeeded");
	});

	it("allows situational specialist output when continuity evidence was read", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-situational-claim-with-evidence",
					text: JSON.stringify({
						imagePrompt: "@方源 stands alone on the summit, enemies hesitate to attack.",
					}),
					trace: {
						toolCalls: [
							{ name: "tapcanvas_storyboard_continuity_get", status: "succeeded" },
							{
								name: "Task",
								status: "succeeded",
								input: { agent_type: "image_prompt_specialist" },
								outputJson: {
									imagePrompt:
										"@方源 stands alone on the summit, enemies hesitate to attack from the outer ring.",
									dramaticFunction: "standoff before the final break",
									situationFrame: "群雄围而不攻，主角压住全场",
								},
							},
						],
						summary: {
							totalToolCalls: 2,
							succeededToolCalls: 2,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 120,
						},
						output: {
							head: "imagePrompt: @方源 stands alone on the summit.",
							tail: "dramaticFunction: standoff before the final break.",
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
			prompt: "直接给我第二章山巅围杀图提示词。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeLabel: "山巅围杀起始帧",
					selectedNodeKind: "storyboardShot",
					creationMode: "scene",
				},
			},
		});

		expect(result.status).toBe("succeeded");
		const meta = (result.raw as { meta: Record<string, unknown> }).meta;
		expect(meta.diagnosticFlags).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "prompt_specialist_situational_claim_without_evidence" }),
			]),
		);
	});

	it("forwards numbered reference image slots and records them in trace context", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-reference-slots",
					text: "已收到图位协议。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "把这些参考图按图1图2写进最终 prompt",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				referenceImages: [
					"https://example.com/character.png",
					"https://example.com/scene.png",
				],
				assetInputs: [
					{
						nodeId: "node-character",
						assetId: "asset-character",
						url: "https://example.com/character.png",
						role: "character",
						name: "李长安",
						note: "主角外观锚点",
					},
					{
						nodeId: "node-scene",
						url: "https://example.com/scene.png",
						role: "context",
						note: "老屋空间关系",
					},
				],
				chatContext: {
					selectedReference: {
						imageUrl: "https://example.com/scene.png",
						label: "老屋建立镜头",
					},
				},
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.referenceImageSlots).toEqual([
			{
				slot: "图1",
				url: "https://example.com/character.png",
				referenceId: "node:node-character",
				nodeId: "node-character",
				assetId: "asset-character",
				assetRefId: null,
				role: "character",
				label: "李长安",
				note: "主角外观锚点",
			},
			{
				slot: "图2",
				url: "https://example.com/scene.png",
				referenceId: "node:node-scene",
				nodeId: "node-scene",
				assetId: null,
				assetRefId: null,
				role: "context",
				label: "老屋建立镜头",
				note: "老屋空间关系",
			},
		]);

	});

	it("injects runtime reference context even when the prompt already mentions natural-language reference headings", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-reference-runtime-context",
					text: "已收到参考图上下文。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "请参考 https://example.com/character.png，把【参考图】和【资产输入】都体现在最终执行 prompt 里。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				referenceImages: ["https://example.com/character.png"],
				assetInputs: [
					{
						nodeId: "node-character",
						url: "https://example.com/character.png",
						role: "character",
						name: "李长安",
						note: "主角外观锚点",
					},
				],
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		const forwardedPrompt = String(requestBody.prompt || "");
		expect(forwardedPrompt).toContain("<tapcanvas_runtime_reference_context>");
		expect(forwardedPrompt).toContain("【资产输入】");
		expect(forwardedPrompt).toContain("role=character | nodeId=node-character");
		expect(forwardedPrompt).toContain("【参考图位】");
		expect(forwardedPrompt).toContain("图1 | referenceId=node:node-character | nodeId=node-character");
		expect(forwardedPrompt).toContain(
			"[媒体引用#1 | mediaType=image | name=李长安 | nodeId=node-character]",
		);
		expect(forwardedPrompt).not.toContain("https://example.com/character.png");
	});

	it("does not inject product integrity constraints for chapter-grounded storyboard requests with target/reference assets", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-chapter-grounded-no-product-integrity",
					text: "已收到章节分镜请求。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "基于角色图完成第一章全分镜和视频节点。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				assetInputs: [
					{
						role: "target",
						url: "https://example.com/role-card.png",
						note: "保持构图与版式，替换主体",
					},
					{
						role: "reference",
						url: "https://example.com/role-card.png",
					},
				],
				chatContext: {
					currentProjectName: "地煞七十二变",
					creationMode: "scene",
					requireProjectTextEvidence: true,
					selectedNodeKind: "storyboardShot",
				},
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(String(requestBody.prompt || "")).not.toContain("【参考图保真硬约束】");
		expect(String(requestBody.prompt || "")).toContain("【引用事实边界】");
		expect(String(requestBody.prompt || "")).not.toContain("【参考主体保真硬约束】");
	});

	it("does not activate retired shot-preview lightweight handling when the old skill key is supplied", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-retired-shot-preview-skill",
					text: "已按统一 agents 通道处理。",
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
						output: {},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "帮我设计第3镜的构图和提示词。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				requiredSkills: ["tapcanvas-shot-preview-expert"],
				referenceImages: ["https://example.com/anchor.png"],
				assetInputs: [
					{
						role: "character",
						url: "https://example.com/role-card.png",
						assetRefId: "方源",
					},
				],
				chatContext: {
					currentProjectName: "地煞七十二变",
					creationMode: "scene",
				},
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;

		expect(requestBody.referenceImages).toEqual(
			expect.arrayContaining(["https://example.com/anchor.png", "https://example.com/role-card.png"]),
		);
		expect(requestBody.canvasCapabilityManifest).toBeUndefined();
		expect(String(requestBody.prompt || "")).not.toContain("【镜头设计板最小上下文约束】");
	});

	it("queues same-user bridge requests at the configured concurrency limit", async () => {
		const previousPerUser = process.env.AGENTS_BRIDGE_MAX_PER_USER;
		const previousQueueDepth = process.env.AGENTS_BRIDGE_MAX_QUEUE_DEPTH;
		process.env.AGENTS_BRIDGE_MAX_PER_USER = "1";
		process.env.AGENTS_BRIDGE_MAX_QUEUE_DEPTH = "2";
			let releaseFirst: () => void = () => undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const successResponse = () =>
			new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-concurrency",
					text: "完成",
					trace: { toolCalls: [], summary: { totalToolCalls: 0 }, output: {}, turns: [] },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		const fetchMock = vi.fn(async () => {
			if (fetchMock.mock.calls.length === 1) await firstGate;
			return successResponse();
		});
		vi.stubGlobal("fetch", fetchMock);

		try {
			const first = runAgentsBridgeChatTask(createContext(), "user-1", {
				kind: "chat",
				prompt: "first",
				extras: {},
			});
			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
			const second = runAgentsBridgeChatTask(createContext(), "user-1", {
					kind: "chat",
					prompt: "second",
					extras: {},
				});
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(fetchMock).toHaveBeenCalledTimes(1);
			releaseFirst();
			await Promise.all([first, second]);
			expect(fetchMock).toHaveBeenCalledTimes(2);
		} finally {
				releaseFirst();
			if (typeof previousPerUser === "string") {
				process.env.AGENTS_BRIDGE_MAX_PER_USER = previousPerUser;
			} else {
				delete process.env.AGENTS_BRIDGE_MAX_PER_USER;
			}
			if (typeof previousQueueDepth === "string") {
				process.env.AGENTS_BRIDGE_MAX_QUEUE_DEPTH = previousQueueDepth;
			} else {
				delete process.env.AGENTS_BRIDGE_MAX_QUEUE_DEPTH;
			}
		}
	});

	it("aborts a request while it is waiting for a global bridge slot", async () => {
		const previousConcurrency = process.env.AGENTS_BRIDGE_MAX_CONCURRENCY;
		const previousQueueDepth = process.env.AGENTS_BRIDGE_MAX_QUEUE_DEPTH;
		process.env.AGENTS_BRIDGE_MAX_CONCURRENCY = "1";
		process.env.AGENTS_BRIDGE_MAX_QUEUE_DEPTH = "2";
			let releaseFirst: () => void = () => undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const successResponse = () =>
			new Response(
				stringifyCanonicalAgentsBridgeSuccess({
					id: "bridge-task-queued-abort",
					text: "完成",
					trace: { toolCalls: [], summary: { totalToolCalls: 0 }, output: {}, turns: [] },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		const fetchMock = vi.fn(async () => {
			if (fetchMock.mock.calls.length === 1) await firstGate;
			return successResponse();
		});
		vi.stubGlobal("fetch", fetchMock);

		try {
			const first = runAgentsBridgeChatTask(createContext(), "user-1", {
				kind: "chat",
				prompt: "first",
				extras: {},
			});
			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
			const abortController = new AbortController();
			const queued = runAgentsBridgeChatTask(
				createContext(),
				"user-2",
				{ kind: "chat", prompt: "queued", extras: {} },
				{ abortSignal: abortController.signal },
			);
			await new Promise((resolve) => setTimeout(resolve, 0));
			abortController.abort(new Error("queued-request-aborted"));
			await expect(queued).rejects.toThrow("queued-request-aborted");
			expect(fetchMock).toHaveBeenCalledTimes(1);
				releaseFirst();
			await first;
		} finally {
				releaseFirst();
			if (typeof previousConcurrency === "string") {
				process.env.AGENTS_BRIDGE_MAX_CONCURRENCY = previousConcurrency;
			} else {
				delete process.env.AGENTS_BRIDGE_MAX_CONCURRENCY;
			}
			if (typeof previousQueueDepth === "string") {
				process.env.AGENTS_BRIDGE_MAX_QUEUE_DEPTH = previousQueueDepth;
			} else {
				delete process.env.AGENTS_BRIDGE_MAX_QUEUE_DEPTH;
			}
		}
	});

});
