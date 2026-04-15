import { beforeEach, describe, expect, it, vi } from "vitest";
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
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

type ExecutionTraceInput = {
	scopeType: string;
	scopeId: string;
	taskId: string;
	requestKind: string;
	inputSummary: string;
	decisionLog: string[];
	toolCalls: Array<Record<string, unknown>>;
	meta: Record<string, unknown> | null;
	resultSummary: string | null;
};

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

describe("runAgentsBridgeChatTask prompt specialists", () => {
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

	it("sends only prompt-specialist subagents and preserves their outputs in execution trace", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			return new Response(
				JSON.stringify({
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
			expect(String(requestBody.prompt || "")).toContain("【角色参考一致性约束】");
			expect(requestBody.diagnosticContext).toMatchObject({
				promptPipeline: {
					target: "visual_generation",
					precheck: {
						status: "completed",
						reason: "bridge_context_collected",
					},
					promptGeneration: {
						status: "pending",
						reason: "awaiting_agents_execution",
					},
					precheckSnapshot: {
						autoReferenceImageCount: 1,
						directGenerationReady: true,
						generationGateReason: "visual_anchors_present",
					},
				},
			});

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
		expect(rawMeta.promptPipeline).toMatchObject({
			target: "visual_generation",
			precheck: {
				status: "completed",
				reason: "project_or_storyboard_evidence_read",
			},
			prerequisiteGeneration: {
				status: "not_needed",
				reason: "no_prerequisite_assets_required",
			},
			promptGeneration: {
				status: "completed",
				reason: "prompt_or_canvas_result_delivered",
			},
			precheckSnapshot: {
				autoReferenceImageCount: 1,
				directGenerationReady: true,
				generationGateReason: "visual_anchors_present",
			},
		});
		expect(rawMeta.diagnosticFlags).toEqual([]);
		expect(rawMeta.turnVerdict).toEqual({
			status: "satisfied",
			reasons: ["validated_result"],
		});

		expect(writeUserExecutionTrace).toHaveBeenCalledTimes(1);
		const traceInput = writeUserExecutionTrace.mock.calls[0]?.[2] as ExecutionTraceInput;
		expect(traceInput.requestKind).toBe("agents_bridge:chat");
		expect(traceInput.toolCalls).toHaveLength(5);
		expect(traceInput.decisionLog).toEqual(
			expect.arrayContaining([
				"promptPipelineTarget=visual_generation",
				"promptPipelinePrecheck=completed:project_or_storyboard_evidence_read",
				"promptPipelinePrerequisite=not_needed:no_prerequisite_assets_required",
				"promptPipelineGeneration=completed:prompt_or_canvas_result_delivered",
			]),
		);
		const specialistOutputs = traceInput.toolCalls
			.map((toolCall) => {
				const outputPreview = toolCall.outputPreview;
				if (typeof outputPreview !== "string") return null;
				try {
					return JSON.parse(outputPreview) as Record<string, unknown>;
				} catch {
					return null;
				}
			})
			.filter((item): item is Record<string, unknown> => item !== null && item.agentType !== undefined);

		expect(specialistOutputs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					agentType: "image_prompt_specialist",
					imagePrompt: expect.stringContaining("山巅围杀静压起始帧"),
				}),
				expect.objectContaining({
					agentType: "pacing_reviewer",
					compressionRisk: "low",
					splitRecommendation: "keep_single_clip",
				}),
			]),
		);
		expect(
			traceInput.toolCalls.some((toolCall) => {
				const preview = typeof toolCall.outputPreview === "string" ? toolCall.outputPreview : "";
				const head = typeof toolCall.outputHead === "string" ? toolCall.outputHead : "";
				return `${preview}\n${head}`.includes("video_prompt_specialist");
			}),
		).toBe(true);
	});

	it("resolves @assetRefId from current canvas flow assets before role-card fallback", async () => {
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
				JSON.stringify({
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
		expect(requestBody.assetInputs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					assetId: "asset-img-1",
					assetRefId: "fangyuan_main",
					role: "reference",
					url: "https://example.com/fangyuan-main.png",
					name: "方源主参考",
				}),
			]),
		);
		expect(requestBody.referenceImages).toEqual(
			expect.arrayContaining(["https://example.com/fangyuan-main.png"]),
		);
	});

	it("resolves @角色名-状态 to the matching role card asset", async () => {
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
				JSON.stringify({
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
		expect(requestBody.assetInputs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					assetId: "asset-fangyuan-young",
					assetRefId: "role-fangyuan_少年",
					role: "character",
					url: "https://example.com/fangyuan-young.png",
					name: "方源",
				}),
			]),
		);
		expect(requestBody.referenceImages).toEqual(
			expect.arrayContaining(["https://example.com/fangyuan-young.png"]),
		);
		expect(requestBody.assetInputs).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					url: "https://example.com/fangyuan-adult.png",
				}),
			]),
		);
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
				JSON.stringify({
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
	});

	it("ignores specialist-only video prompt drafts when no final executable payload was returned", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
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
				JSON.stringify({
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
				JSON.stringify({
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

	it("fails chapter-grounded image prompt turns when imagePromptSpecV2 is missing", async () => {
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
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-image-spec-missing",
					text: JSON.stringify({
						imagePrompt: "山巅对峙关键帧，黄昏压迫感，中景低机位。",
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
							head: "imagePrompt",
							tail: "山巅对峙关键帧，黄昏压迫感，中景低机位。",
						},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(fs, "readdir").mockImplementation(async (targetPath) => {
			if (String(targetPath) === scopedBooksRoot) {
				return [{ name: "book-1", isDirectory: () => true }] as unknown as Awaited<
					ReturnType<typeof fs.readdir>
				>;
			}
			return [] as Awaited<ReturnType<typeof fs.readdir>>;
		});
		vi.spyOn(fs, "readFile").mockImplementation(async (targetPath) => {
			if (String(targetPath) === path.join(scopedBookDir, "index.json")) {
				return JSON.stringify({
					bookId: "book-1",
					title: "蛊真人",
					chapterCount: 2,
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

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "给我第二章关键帧的最终图片提示词。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				bookId: "book-1",
				chapterId: "2",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeKind: "image",
					creationMode: "scene",
				},
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as {
			meta: { diagnosticFlags: Array<{ code: string }>; turnVerdict: { status: string; reasons: string[] } };
		}).meta;
		expect(rawMeta.diagnosticFlags).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "image_prompt_spec_v2_missing",
				}),
			]),
		);
		expect(rawMeta.turnVerdict).toEqual({
			status: "failed",
			reasons: expect.arrayContaining(["image_prompt_spec_v2_missing"]),
		});
	});

	it("accepts chapter-grounded image prompt turns when imagePromptSpecV2 is present", async () => {
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
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-image-spec-present",
					text: JSON.stringify({
						imagePrompt: "画面目标：山巅对峙关键帧。\n空间布局：前景碎石，中景方源与群雄，背景黄昏山谷。",
						imagePromptSpecV2: buildImagePromptSpecV2Payload(),
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
							head: "imagePrompt",
							tail: "imagePromptSpecV2",
						},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(fs, "readdir").mockImplementation(async (targetPath) => {
			if (String(targetPath) === scopedBooksRoot) {
				return [{ name: "book-1", isDirectory: () => true }] as unknown as Awaited<
					ReturnType<typeof fs.readdir>
				>;
			}
			return [] as Awaited<ReturnType<typeof fs.readdir>>;
		});
		vi.spyOn(fs, "readFile").mockImplementation(async (targetPath) => {
			if (String(targetPath) === path.join(scopedBookDir, "index.json")) {
				return JSON.stringify({
					bookId: "book-1",
					title: "蛊真人",
					chapterCount: 2,
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

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "给我第二章关键帧的最终图片提示词。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				bookId: "book-1",
				chapterId: "2",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeKind: "image",
					creationMode: "scene",
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

	it("fails chapter-grounded image prompts when role age/state evidence exists but continuityConstraints is empty", async () => {
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
		const specWithoutContinuity = buildImagePromptSpecV2Payload();
		specWithoutContinuity.continuityConstraints = [];
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-image-spec-character-continuity-missing",
					text: JSON.stringify({
						imagePrompt: "山巅对峙关键帧",
						imagePromptSpecV2: specWithoutContinuity,
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
							head: "imagePrompt",
							tail: "imagePromptSpecV2",
						},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(fs, "readdir").mockImplementation(async (targetPath) => {
			if (String(targetPath) === scopedBooksRoot) {
				return [{ name: "book-1", isDirectory: () => true }] as unknown as Awaited<
					ReturnType<typeof fs.readdir>
				>;
			}
			return [] as Awaited<ReturnType<typeof fs.readdir>>;
		});
		vi.spyOn(fs, "readFile").mockImplementation(async (targetPath) => {
			if (String(targetPath) === path.join(scopedBookDir, "index.json")) {
				return JSON.stringify({
					bookId: "book-1",
					title: "蛊真人",
					chapterCount: 2,
					chapters: [{ chapter: 2, characters: [{ name: "方源" }] }],
					assets: {
						roleCards: [
							{
								cardId: "role-fangyuan",
								roleName: "方源",
								roleId: "fangyuan",
								imageUrl: "https://example.com/fangyuan-role-card.png",
								threeViewImageUrl: "https://example.com/fangyuan-three-view.png",
								status: "generated",
								confirmedAt: "2026-03-30T02:00:00.000Z",
								updatedAt: "2026-03-30T02:00:00.000Z",
								chapterSpan: [2],
								ageDescription: "十五岁",
								stateDescription: "重伤濒死，血袍破损。",
								stateKey: "near_death",
							},
						],
						storyboardChunks: [
							{
								chapter: 2,
								updatedAt: "2026-03-30T02:05:00.000Z",
								tailFrameUrl: "https://example.com/chapter2-tail-frame.png",
							},
						],
					},
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

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "给我第二章关键帧的最终图片提示词。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				bookId: "book-1",
				chapterId: "2",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeKind: "image",
					creationMode: "scene",
				},
			},
		});

		const rawMeta = (result.raw as {
			meta: { diagnosticFlags: Array<{ code: string }>; turnVerdict: { status: string; reasons: string[] } };
		}).meta;
		expect(rawMeta.diagnosticFlags).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "image_prompt_spec_v2_character_continuity_missing",
				}),
			]),
		);
		expect(rawMeta.turnVerdict).toEqual({
			status: "failed",
			reasons: expect.arrayContaining(["image_prompt_spec_v2_character_continuity_missing"]),
		});
	});

	it("fails chapter-grounded image prompts when structuredPrompt omits reference/identity/environment fields under anchor inputs", async () => {
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
		const specMissingBindings = {
			version: "v2",
			shotIntent: "山巅对峙关键帧",
			spatialLayout: ["前景碎石", "中景方源与群雄", "背景黄昏山谷"],
			cameraPlan: ["中景低机位"],
			lightingPlan: ["黄昏侧逆光"],
			continuityConstraints: ["保持方源年龄与重伤状态连续"],
			negativeConstraints: ["禁止切换到其他场景"],
		};
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-image-spec-bindings-missing",
					text: JSON.stringify({
						imagePrompt: "山巅对峙关键帧",
						imagePromptSpecV2: specMissingBindings,
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
							head: "imagePrompt",
							tail: "imagePromptSpecV2",
						},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(fs, "readdir").mockImplementation(async (targetPath) => {
			if (String(targetPath) === scopedBooksRoot) {
				return [{ name: "book-1", isDirectory: () => true }] as unknown as Awaited<
					ReturnType<typeof fs.readdir>
				>;
			}
			return [] as Awaited<ReturnType<typeof fs.readdir>>;
		});
		vi.spyOn(fs, "readFile").mockImplementation(async (targetPath) => {
			if (String(targetPath) === path.join(scopedBookDir, "index.json")) {
				return JSON.stringify({
					bookId: "book-1",
					title: "蛊真人",
					chapterCount: 2,
					chapters: [{ chapter: 2, characters: [{ name: "方源" }] }],
					assets: {
						roleCards: [
							{
								cardId: "role-fangyuan",
								roleName: "方源",
								roleId: "fangyuan",
								imageUrl: "https://example.com/fangyuan-role-card.png",
								threeViewImageUrl: "https://example.com/fangyuan-three-view.png",
								status: "generated",
								confirmedAt: "2026-03-30T02:00:00.000Z",
								updatedAt: "2026-03-30T02:00:00.000Z",
								chapterSpan: [2],
								ageDescription: "十五岁",
								stateDescription: "重伤濒死，血袍破损。",
								stateKey: "near_death",
							},
						],
						storyboardChunks: [
							{
								chapter: 2,
								updatedAt: "2026-03-30T02:05:00.000Z",
								tailFrameUrl: "https://example.com/chapter2-tail-frame.png",
							},
						],
					},
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

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "给我第二章关键帧的最终图片提示词。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				bookId: "book-1",
				chapterId: "2",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeKind: "image",
					creationMode: "scene",
				},
			},
		});

		const rawMeta = (result.raw as {
			meta: { diagnosticFlags: Array<{ code: string }>; turnVerdict: { status: string; reasons: string[] } };
		}).meta;
		expect(rawMeta.diagnosticFlags).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "image_prompt_spec_v2_reference_bindings_missing",
				}),
				expect.objectContaining({
					code: "image_prompt_spec_v2_identity_constraints_missing",
				}),
				expect.objectContaining({
					code: "image_prompt_spec_v2_environment_objects_missing",
				}),
			]),
		);
		expect(rawMeta.turnVerdict).toEqual({
			status: "failed",
			reasons: expect.arrayContaining([
				"image_prompt_spec_v2_reference_bindings_missing",
				"image_prompt_spec_v2_identity_constraints_missing",
				"image_prompt_spec_v2_environment_objects_missing",
			]),
		});
	});

	it("fails chapter-grounded image prompts when chapter角色缺少年龄/状态锚点", async () => {
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
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-role-state-missing",
					text: JSON.stringify({
						imagePrompt: "山巅对峙关键帧",
						imagePromptSpecV2: buildImagePromptSpecV2Payload(),
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
							head: "imagePrompt",
							tail: "imagePromptSpecV2",
						},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(fs, "readdir").mockImplementation(async (targetPath) => {
			if (String(targetPath) === scopedBooksRoot) {
				return [{ name: "book-1", isDirectory: () => true }] as unknown as Awaited<
					ReturnType<typeof fs.readdir>
				>;
			}
			return [] as Awaited<ReturnType<typeof fs.readdir>>;
		});
		vi.spyOn(fs, "readFile").mockImplementation(async (targetPath) => {
			if (String(targetPath) === path.join(scopedBookDir, "index.json")) {
				return JSON.stringify({
					bookId: "book-1",
					title: "蛊真人",
					chapterCount: 2,
					chapters: [{ chapter: 2, characters: [{ name: "方源" }] }],
					assets: {
						roleCards: [
							{
								cardId: "role-fangyuan",
								roleName: "方源",
								roleId: "fangyuan",
								imageUrl: "https://example.com/fangyuan-role-card.png",
								threeViewImageUrl: "https://example.com/fangyuan-three-view.png",
								status: "generated",
								confirmedAt: "2026-03-30T02:00:00.000Z",
								updatedAt: "2026-03-30T02:00:00.000Z",
								chapterSpan: [2],
							},
						],
					},
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

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "给我第二章关键帧的最终图片提示词。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				bookId: "book-1",
				chapterId: "2",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeKind: "image",
					creationMode: "scene",
				},
			},
		});

		const rawMeta = (result.raw as {
			meta: { diagnosticFlags: Array<{ code: string }>; turnVerdict: { status: string; reasons: string[] } };
		}).meta;
		expect(rawMeta.diagnosticFlags).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "chapter_grounded_character_state_missing",
				}),
			]),
		);
		expect(rawMeta.turnVerdict).toEqual({
			status: "failed",
			reasons: expect.arrayContaining(["chapter_grounded_character_state_missing"]),
		});
	});

	it("accepts chapter-grounded image prompts when previous semanticAssets carry the latest state and scene continuity", async () => {
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
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-semantic-assets-continuity",
					text: JSON.stringify({
						imagePrompt: "第二章学堂回望关键帧",
						imagePromptSpecV2: buildImagePromptSpecV2Payload(),
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
							head: "imagePrompt",
							tail: "imagePromptSpecV2",
						},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(fs, "readdir").mockImplementation(async (targetPath) => {
			if (String(targetPath) === scopedBooksRoot) {
				return [{ name: "book-1", isDirectory: () => true }] as unknown as Awaited<
					ReturnType<typeof fs.readdir>
				>;
			}
			return [] as Awaited<ReturnType<typeof fs.readdir>>;
		});
		vi.spyOn(fs, "readFile").mockImplementation(async (targetPath) => {
			if (String(targetPath) === path.join(scopedBookDir, "index.json")) {
				return JSON.stringify({
					bookId: "book-1",
					title: "蛊真人",
					chapterCount: 2,
					chapters: [
						{
							chapter: 2,
							characters: [{ name: "方源" }],
							scenes: [{ name: "学堂" }],
						},
					],
					assets: {
						roleCards: [
							{
								cardId: "role-fangyuan",
								roleName: "方源",
								roleId: "fangyuan",
								imageUrl: "https://example.com/fangyuan-role-card.png",
								threeViewImageUrl: "https://example.com/fangyuan-three-view.png",
								status: "generated",
								confirmedAt: "2026-03-30T02:00:00.000Z",
								updatedAt: "2026-03-30T02:00:00.000Z",
							},
						],
						semanticAssets: [
							{
								semanticId: "shot-1",
								mediaKind: "image",
								status: "generated",
								imageUrl: "https://example.com/fangyuan-broken-arm-shot.png",
								chapter: 1,
								stateDescription: "方源右臂已断，袖口被鲜血浸透",
								anchorBindings: [
									{
										kind: "character",
										refId: "fangyuan",
										label: "方源",
										note: "state=方源右臂已断，袖口被鲜血浸透 | stateKey=broken_arm",
									},
									{
										kind: "scene",
										refId: "school",
										label: "学堂",
									},
								],
								confirmationMode: "auto",
								confirmedAt: "2026-03-31T08:00:00.000Z",
								updatedAt: "2026-03-31T08:00:00.000Z",
							},
						],
					},
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

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "给我第二章学堂回望方源的最终图片提示词。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				bookId: "book-1",
				chapterId: "2",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeKind: "image",
					creationMode: "scene",
				},
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as {
			meta: { diagnosticFlags: Array<{ code: string }>; turnVerdict: { status: string; reasons: string[] } };
		}).meta;
		expect(rawMeta.diagnosticFlags).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "chapter_grounded_character_state_missing",
				}),
				expect.objectContaining({
					code: "chapter_grounded_scene_prop_reference_missing",
				}),
			]),
		);
		expect(rawMeta.turnVerdict).toEqual({
			status: "satisfied",
			reasons: ["validated_result"],
		});
	});

	it("does not fail chapter script persistence runs on missing visual anchors once the plan is written back", async () => {
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
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-chapter-script-persistence",
					text: "已完成第5章章节剧本与分镜计划写回。",
					trace: {
						toolCalls: [
							{ name: "tapcanvas_books_list", status: "succeeded" },
							{ name: "tapcanvas_book_index_get", status: "succeeded" },
							{ name: "tapcanvas_book_chapter_get", status: "succeeded" },
							{ name: "TodoWrite", status: "succeeded" },
							{ name: "tapcanvas_book_storyboard_plan_upsert", status: "succeeded" },
						],
						summary: {
							totalToolCalls: 5,
							succeededToolCalls: 5,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 90,
						},
						output: {
							head: "已完成第5章章节剧本与分镜计划写回。",
							tail: "已完成第5章章节剧本与分镜计划写回。",
						},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(fs, "readdir").mockImplementation(async (targetPath) => {
			if (String(targetPath) === scopedBooksRoot) {
				return [{ name: "book-1", isDirectory: () => true }] as unknown as Awaited<
					ReturnType<typeof fs.readdir>
				>;
			}
			return [] as Awaited<ReturnType<typeof fs.readdir>>;
		});
		vi.spyOn(fs, "readFile").mockImplementation(async (targetPath) => {
			if (String(targetPath) === path.join(scopedBookDir, "index.json")) {
				return JSON.stringify({
					bookId: "book-1",
					title: "蛊真人",
					chapterCount: 5,
					chapters: [
						{
							chapter: 5,
							characters: [{ name: "方源" }, { name: "学堂家老" }],
							scenes: [{ name: "地下溶洞" }],
							props: [{ name: "月兰花" }],
						},
					],
					assets: {
						roleCards: [],
						visualRefs: [],
					},
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

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "只生成第5章的章节剧本与分镜计划。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				bookId: "book-1",
				chapterId: "5",
				chatContext: {
					currentProjectName: "蛊真人",
					workspaceAction: "chapter_script_generation",
				},
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as {
			meta: {
				diagnosticFlags: Array<{ code: string }>;
				turnVerdict: { status: string; reasons: string[] };
			};
		}).meta;
		expect(rawMeta.diagnosticFlags).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "chapter_grounded_character_reference_missing" }),
				expect.objectContaining({ code: "chapter_grounded_character_state_missing" }),
				expect.objectContaining({ code: "chapter_grounded_character_three_view_missing" }),
				expect.objectContaining({ code: "chapter_grounded_scene_prop_reference_missing" }),
			]),
		);
		expect(rawMeta.turnVerdict).toEqual({
			status: "satisfied",
			reasons: ["validated_result"],
		});
	});

	it("fails chapter-grounded image prompts when repeated角色 only has generic role cards without three-view assets", async () => {
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
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-role-three-view-missing",
					text: JSON.stringify({
						imagePrompt: "方源在学堂窗前醒来的关键帧",
						imagePromptSpecV2: buildImagePromptSpecV2Payload(),
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
							head: "imagePrompt",
							tail: "imagePromptSpecV2",
						},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(fs, "readdir").mockImplementation(async (targetPath) => {
			if (String(targetPath) === scopedBooksRoot) {
				return [{ name: "book-1", isDirectory: () => true }] as unknown as Awaited<
					ReturnType<typeof fs.readdir>
				>;
			}
			return [] as Awaited<ReturnType<typeof fs.readdir>>;
		});
		vi.spyOn(fs, "readFile").mockImplementation(async (targetPath) => {
			if (String(targetPath) === path.join(scopedBookDir, "index.json")) {
				return JSON.stringify({
					bookId: "book-1",
					title: "蛊真人",
					chapterCount: 3,
					chapters: [
						{
							chapter: 3,
							characters: [{ name: "方源" }],
							scenes: [{ name: "古月寨学堂" }],
							props: [{ name: "春秋蝉木盒" }],
						},
					],
					assets: {
						roleCards: [
							{
								cardId: "role-fangyuan",
								roleName: "方源",
								roleId: "fangyuan",
								imageUrl: "https://example.com/fangyuan-role-card.png",
								status: "generated",
								confirmedAt: "2026-03-30T02:00:00.000Z",
								updatedAt: "2026-03-30T02:00:00.000Z",
								chapterSpan: [3],
								ageDescription: "十五岁",
								stateDescription: "少年方源，黑发，神情冷静。",
							},
						],
						visualRefs: [
							{
								refId: "scene_gu_yue_school",
								category: "scene_prop",
								name: "古月寨学堂",
								status: "generated",
								confirmedAt: "2026-03-30T02:00:00.000Z",
								updatedAt: "2026-03-30T02:00:00.000Z",
								imageUrl: "https://example.com/gu-yue-school.png",
								chapterSpan: [3],
							},
							{
								refId: "prop_chun_qiu_chan_box",
								category: "scene_prop",
								name: "春秋蝉木盒",
								status: "generated",
								confirmedAt: "2026-03-30T02:00:00.000Z",
								updatedAt: "2026-03-30T02:00:00.000Z",
								imageUrl: "https://example.com/chun-qiu-chan-box.png",
								chapterSpan: [3],
							},
						],
					},
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

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "给我第三章学堂场景的最终图片提示词。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				bookId: "book-1",
				chapterId: "3",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeKind: "image",
					creationMode: "scene",
				},
			},
		});

		const rawMeta = (result.raw as {
			meta: { diagnosticFlags: Array<{ code: string }>; turnVerdict: { status: string; reasons: string[] } };
		}).meta;
		expect(rawMeta.diagnosticFlags).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "chapter_grounded_character_three_view_missing",
				}),
			]),
		);
		expect(rawMeta.turnVerdict).toEqual({
			status: "failed",
			reasons: expect.arrayContaining(["chapter_grounded_character_three_view_missing"]),
		});
	});

	it("fails chapter-grounded image prompts when chapter scenes or props have no visual reference assets", async () => {
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
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-scene-prop-missing",
					text: JSON.stringify({
						imagePrompt: "方源在学堂窗前醒来的关键帧",
						imagePromptSpecV2: buildImagePromptSpecV2Payload(),
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
							head: "imagePrompt",
							tail: "imagePromptSpecV2",
						},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(fs, "readdir").mockImplementation(async (targetPath) => {
			if (String(targetPath) === scopedBooksRoot) {
				return [{ name: "book-1", isDirectory: () => true }] as unknown as Awaited<
					ReturnType<typeof fs.readdir>
				>;
			}
			return [] as Awaited<ReturnType<typeof fs.readdir>>;
		});
		vi.spyOn(fs, "readFile").mockImplementation(async (targetPath) => {
			if (String(targetPath) === path.join(scopedBookDir, "index.json")) {
				return JSON.stringify({
					bookId: "book-1",
					title: "蛊真人",
					chapterCount: 3,
					chapters: [
						{
							chapter: 3,
							characters: [{ name: "方源" }],
							scenes: [{ name: "古月寨学堂" }],
							props: [{ name: "春秋蝉木盒" }],
						},
					],
					assets: {
						roleCards: [
							{
								cardId: "role-fangyuan",
								roleName: "方源",
								roleId: "fangyuan",
								imageUrl: "https://example.com/fangyuan-role-card.png",
								threeViewImageUrl: "https://example.com/fangyuan-three-view.png",
								status: "generated",
								confirmedAt: "2026-03-30T02:00:00.000Z",
								updatedAt: "2026-03-30T02:00:00.000Z",
								chapterSpan: [3],
								ageDescription: "十五岁",
								stateDescription: "少年方源，黑发，神情冷静。",
							},
						],
					},
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

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "给我第三章学堂场景的最终图片提示词。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				bookId: "book-1",
				chapterId: "3",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeKind: "image",
					creationMode: "scene",
				},
			},
		});

		const rawMeta = (result.raw as {
			meta: { diagnosticFlags: Array<{ code: string }>; turnVerdict: { status: string; reasons: string[] } };
		}).meta;
		expect(rawMeta.diagnosticFlags).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "chapter_grounded_scene_prop_reference_missing",
				}),
			]),
		);
		expect(rawMeta.turnVerdict).toEqual({
			status: "failed",
			reasons: expect.arrayContaining(["chapter_grounded_scene_prop_reference_missing"]),
		});
	});

	it("accepts chapter-grounded image prompts when three-view角色与场景道具参考都已齐备", async () => {
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
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-scene-prop-ready",
					text: JSON.stringify({
						imagePrompt: "第三章学堂场景最终图像提示词",
						imagePromptSpecV2: buildImagePromptSpecV2Payload(),
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
							head: "imagePrompt",
							tail: "imagePromptSpecV2",
						},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(fs, "readdir").mockImplementation(async (targetPath) => {
			if (String(targetPath) === scopedBooksRoot) {
				return [{ name: "book-1", isDirectory: () => true }] as unknown as Awaited<
					ReturnType<typeof fs.readdir>
				>;
			}
			return [] as Awaited<ReturnType<typeof fs.readdir>>;
		});
		vi.spyOn(fs, "readFile").mockImplementation(async (targetPath) => {
			if (String(targetPath) === path.join(scopedBookDir, "index.json")) {
				return JSON.stringify({
					bookId: "book-1",
					title: "蛊真人",
					chapterCount: 3,
					chapters: [
						{
							chapter: 3,
							characters: [{ name: "方源" }],
							scenes: [{ name: "古月寨学堂" }],
							props: [{ name: "春秋蝉木盒" }],
						},
					],
					assets: {
						roleCards: [
							{
								cardId: "role-fangyuan",
								roleName: "方源",
								roleId: "fangyuan",
								imageUrl: "https://example.com/fangyuan-role-card.png",
								threeViewImageUrl: "https://example.com/fangyuan-three-view.png",
								status: "generated",
								confirmedAt: "2026-03-30T02:00:00.000Z",
								updatedAt: "2026-03-30T02:00:00.000Z",
								chapterSpan: [3],
								ageDescription: "十五岁",
								stateDescription: "少年方源，黑发，神情冷静。",
							},
						],
						visualRefs: [
							{
								refId: "scene_gu_yue_school",
								category: "scene_prop",
								name: "古月寨学堂",
								status: "generated",
								confirmedAt: "2026-03-30T02:00:00.000Z",
								updatedAt: "2026-03-30T02:00:00.000Z",
								imageUrl: "https://example.com/gu-yue-school.png",
								chapterSpan: [3],
							},
							{
								refId: "prop_chun_qiu_chan_box",
								category: "scene_prop",
								name: "春秋蝉木盒",
								status: "generated",
								confirmedAt: "2026-03-30T02:00:00.000Z",
								updatedAt: "2026-03-30T02:00:00.000Z",
								imageUrl: "https://example.com/chun-qiu-chan-box.png",
								chapterSpan: [3],
							},
						],
						storyboardChunks: [
							{
								chapter: 3,
								updatedAt: "2026-03-30T02:05:00.000Z",
								tailFrameUrl: "https://example.com/chapter3-tail-frame.png",
							},
						],
					},
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

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "给我第三章学堂场景的最终图片提示词。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				bookId: "book-1",
				chapterId: "3",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeKind: "image",
					creationMode: "scene",
				},
			},
		});

		const rawMeta = (result.raw as {
			meta: { diagnosticFlags: Array<{ code: string }>; turnVerdict: { status: string; reasons: string[] } };
		}).meta;
		expect(rawMeta.diagnosticFlags).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "chapter_grounded_character_three_view_missing",
				}),
				expect.objectContaining({
					code: "chapter_grounded_scene_prop_reference_missing",
				}),
			]),
		);
		expect(rawMeta.turnVerdict).toEqual({
			status: "satisfied",
			reasons: ["validated_result"],
		});
	});

	it("accepts chapter-grounded flow_patch final state when structuredPrompt is supplied by a later patch", async () => {
		const repoRoot = path.resolve(process.cwd(), "..", "..");
		const scopedBookDir = path.join(
			repoRoot,
			"project-data",
			"users",
			"user-1",
			"projects",
			"project-1",
			"books",
			"book-1",
		);
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-final-state-repaired",
					text: "已在同轮修正第三章单张权威基底帧的结构化提示词。",
					trace: {
						toolCalls: [
							{
								name: "tapcanvas_flow_patch",
								status: "succeeded",
								input: {
									createNodes: [
										{
											id: "chapter3-baseframe-01",
											type: "taskNode",
											position: { x: 0, y: 0 },
											data: {
												kind: "image",
												label: "第三章-权威基底帧",
												prompt: "第三章权威基底帧",
												productionMetadata: buildChapterGroundedProductionMetadata("planned"),
											},
										},
									],
								},
							},
							{
								name: "tapcanvas_flow_patch",
								status: "succeeded",
								input: {
									patchNodeData: [
										{
											id: "chapter3-baseframe-01",
											data: {
												structuredPrompt: buildImagePromptSpecV2Payload(),
											},
										},
									],
								},
							},
						],
						summary: {
							totalToolCalls: 2,
							succeededToolCalls: 2,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 42,
						},
						output: {
							head: "已在同轮修正第三章单张权威基底帧的结构化提示词。",
							tail: "已在同轮修正第三章单张权威基底帧的结构化提示词。",
						},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(fs, "readFile").mockImplementation(async (targetPath) => {
			if (String(targetPath) === path.join(scopedBookDir, "index.json")) {
				return JSON.stringify({
					bookId: "book-1",
					title: "蛊真人",
					chapterCount: 3,
					assets: {},
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

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "继续完成第三章的横屏短剧资产及分镜静态帧。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				bookId: "book-1",
				chapterId: "3",
				referenceImages: ["https://cdn.tapcanvas.test/c3-anchor.png"],
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeKind: "image",
					creationMode: "scene",
				},
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as {
			meta: { diagnosticFlags: Array<{ code: string }>; turnVerdict: { status: string; reasons: string[] } };
		}).meta;
		expect(rawMeta.diagnosticFlags).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "image_prompt_spec_v2_missing",
				}),
				expect.objectContaining({
					code: "image_prompt_spec_v2_invalid",
				}),
			]),
		);
		expect(rawMeta.turnVerdict).toEqual({
			status: "satisfied",
			reasons: ["validated_result"],
		});
	});

	it("fails chapter-grounded visual batches without stable visual anchors when the turn writes multiple static frames", async () => {
		const repoRoot = path.resolve(process.cwd(), "..", "..");
		const scopedBookDir = path.join(
			repoRoot,
			"project-data",
			"users",
			"user-1",
			"projects",
			"project-1",
			"books",
			"book-1",
		);
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-missing-visual-anchors",
					text: "已写入第二章三张静态帧节点。",
					trace: {
						toolCalls: [
							{
								name: "tapcanvas_flow_patch",
								status: "succeeded",
								input: {
									createNodes: [
										{
											id: "chapter2-baseframe-01",
											type: "taskNode",
											position: { x: 0, y: 0 },
											data: {
												kind: "image",
												label: "第二章-静态帧1",
												prompt: "第一张静态帧",
												structuredPrompt: buildImagePromptSpecV2Payload(),
												productionMetadata: buildChapterGroundedProductionMetadata("confirmed"),
											},
										},
										{
											id: "chapter2-baseframe-02",
											type: "taskNode",
											position: { x: 240, y: 0 },
											data: {
												kind: "image",
												label: "第二章-静态帧2",
												prompt: "第二张静态帧",
												structuredPrompt: buildImagePromptSpecV2Payload(),
												productionMetadata: buildChapterGroundedProductionMetadata("confirmed"),
											},
										},
										{
											id: "chapter2-baseframe-03",
											type: "taskNode",
											position: { x: 480, y: 0 },
											data: {
												kind: "image",
												label: "第二章-静态帧3",
												prompt: "第三张静态帧",
												structuredPrompt: buildImagePromptSpecV2Payload(),
												productionMetadata: buildChapterGroundedProductionMetadata("confirmed"),
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
							runMs: 45,
						},
						output: {
							head: "已写入第二章三张静态帧节点。",
							tail: "已写入第二章三张静态帧节点。",
						},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(fs, "readFile").mockImplementation(async (targetPath) => {
			if (String(targetPath) === path.join(scopedBookDir, "index.json")) {
				return JSON.stringify({
					bookId: "book-1",
					title: "蛊真人",
					chapterCount: 2,
					assets: {},
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

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "继续生成第二章静态帧图片。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				bookId: "book-1",
				chapterId: "2",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeKind: "image",
					creationMode: "scene",
				},
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as {
			meta: { diagnosticFlags: Array<{ code: string }>; turnVerdict: { status: string; reasons: string[] } };
		}).meta;
		expect(rawMeta.diagnosticFlags).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "chapter_grounded_visual_anchor_missing",
				}),
			]),
		);
		expect(rawMeta.turnVerdict).toEqual({
			status: "failed",
			reasons: expect.arrayContaining(["chapter_grounded_visual_anchor_missing"]),
		});
	});

	it("allows a single planned authority base frame when chapter-grounded visual anchors are still missing", async () => {
		const repoRoot = path.resolve(process.cwd(), "..", "..");
		const scopedBookDir = path.join(
			repoRoot,
			"project-data",
			"users",
			"user-1",
			"projects",
			"project-1",
			"books",
			"book-1",
		);
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-planned-baseframe-only",
					text: "已先写入单张权威基底帧占位节点。",
					trace: {
						toolCalls: [
							{
								name: "tapcanvas_flow_patch",
								status: "succeeded",
								input: {
									createNodes: [
										{
											id: "chapter2-authority-baseframe",
											type: "taskNode",
											position: { x: 0, y: 0 },
											data: {
												kind: "image",
												label: "第二章-权威基底帧",
												prompt: "单张权威基底帧",
												structuredPrompt: buildImagePromptSpecV2Payload(),
												productionMetadata: buildChapterGroundedProductionMetadata("planned"),
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
							runMs: 35,
						},
						output: {
							head: "已先写入单张权威基底帧占位节点。",
							tail: "已先写入单张权威基底帧占位节点。",
						},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(fs, "readFile").mockImplementation(async (targetPath) => {
			if (String(targetPath) === path.join(scopedBookDir, "index.json")) {
				return JSON.stringify({
					bookId: "book-1",
					title: "蛊真人",
					chapterCount: 2,
					assets: {},
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

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "先给我建立第二章单张权威基底帧。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				bookId: "book-1",
				chapterId: "2",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeKind: "image",
					creationMode: "scene",
				},
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as {
			meta: { diagnosticFlags: Array<{ code: string }>; turnVerdict: { status: string; reasons: string[] } };
		}).meta;
		expect(rawMeta.diagnosticFlags).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "chapter_grounded_visual_anchor_missing",
				}),
			]),
		);
		expect(rawMeta.turnVerdict).toEqual({
			status: "satisfied",
			reasons: ["validated_result"],
		});
	});

	it("accepts chapter-grounded visual batches once role cards or continuity tail frames supply visual anchors", async () => {
		const repoRoot = path.resolve(process.cwd(), "..", "..");
		const scopedBookDir = path.join(
			repoRoot,
			"project-data",
			"users",
			"user-1",
			"projects",
			"project-1",
			"books",
			"book-1",
		);
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-visual-anchors-injected",
					text: "已在角色卡和尾帧锚点基础上写入第二章静态帧节点。",
					trace: {
						toolCalls: [
							{
								name: "tapcanvas_flow_patch",
								status: "succeeded",
								input: {
									createNodes: [
										{
											id: "chapter2-baseframe-01",
											type: "taskNode",
											position: { x: 0, y: 0 },
											data: {
												kind: "image",
												label: "第二章-静态帧1",
												prompt: "第一张静态帧",
												structuredPrompt: buildImagePromptSpecV2Payload(),
												productionMetadata: buildChapterGroundedProductionMetadata("confirmed"),
											},
										},
										{
											id: "chapter2-baseframe-02",
											type: "taskNode",
											position: { x: 240, y: 0 },
											data: {
												kind: "image",
												label: "第二章-静态帧2",
												prompt: "第二张静态帧",
												structuredPrompt: buildImagePromptSpecV2Payload(),
												productionMetadata: buildChapterGroundedProductionMetadata("confirmed"),
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
							runMs: 40,
						},
						output: {
							head: "已在角色卡和尾帧锚点基础上写入第二章静态帧节点。",
							tail: "已在角色卡和尾帧锚点基础上写入第二章静态帧节点。",
						},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(fs, "readFile").mockImplementation(async (targetPath) => {
			if (String(targetPath) === path.join(scopedBookDir, "index.json")) {
				return JSON.stringify({
					bookId: "book-1",
					title: "蛊真人",
					chapterCount: 2,
					chapters: [
						{
							chapter: 2,
							characters: [{ name: "方源" }],
						},
					],
					assets: {
						roleCards: [
							{
								cardId: "role-fangyuan",
								roleName: "方源",
								roleId: "fangyuan",
								imageUrl: "https://example.com/fangyuan-role-card.png",
								threeViewImageUrl: "https://example.com/fangyuan-three-view.png",
								status: "generated",
								confirmedAt: "2026-03-30T02:00:00.000Z",
								updatedAt: "2026-03-30T02:00:00.000Z",
								chapterSpan: [2],
								ageDescription: "十五岁",
								stateDescription: "十五岁，黑发，神情冷静。",
							},
						],
						storyboardChunks: [
							{
								chapter: 2,
								updatedAt: "2026-03-30T02:05:00.000Z",
								tailFrameUrl: "https://example.com/chapter2-tail-frame.png",
							},
						],
					},
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

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "继续生成第二章静态帧图片。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				bookId: "book-1",
				chapterId: "2",
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
		expect(requestBody.referenceImages).toEqual(
			expect.arrayContaining([
				"https://example.com/fangyuan-three-view.png",
				"https://example.com/chapter2-tail-frame.png",
			]),
		);
		expect(requestBody.assetInputs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					role: "character",
					url: "https://example.com/fangyuan-three-view.png",
				}),
				expect.objectContaining({
					role: "context",
					url: "https://example.com/chapter2-tail-frame.png",
				}),
			]),
		);
		expect(String(requestBody.prompt || "")).toContain("【角色年龄与状态连续性约束】");
		expect(String(requestBody.prompt || "")).toContain("age=十五岁");
		expect(String(requestBody.prompt || "")).toContain("state=十五岁，黑发，神情冷静。");
		const rawMeta = (result.raw as {
			meta: { diagnosticFlags: Array<{ code: string }>; turnVerdict: { status: string; reasons: string[] } };
		}).meta;
		expect(rawMeta.diagnosticFlags).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "chapter_grounded_visual_anchor_missing",
				}),
			]),
		);
		expect(rawMeta.turnVerdict).toEqual({
			status: "satisfied",
			reasons: ["validated_result"],
		});
	});

	it("marks the turn as failed when canvas plan payload is structurally invalid", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-invalid-plan",
					text: [
						"以下为规划，尚未执行。",
						'<tapcanvas_canvas_plan>{"action":"create_canvas_workflow","summary":"broken","reason":"broken","nodes":[],"edges":[]}</tapcanvas_canvas_plan>',
					].join("\n\n"),
					trace: {
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

		expect(result.status).toBe("succeeded");
		expect((result.raw as { meta: { turnVerdict: { status: string; reasons: string[] } } }).meta.turnVerdict).toEqual({
			status: "failed",
			reasons: ["invalid_canvas_plan"],
		});
	});

	it("marks the turn as partial when tool execution had failures but a usable result still exists", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-partial",
					text: "下面是基于已读取信息整理的镜头建议。",
					trace: {
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

		expect(result.status).toBe("succeeded");
		expect((result.raw as { meta: { turnVerdict: { status: string; reasons: string[] } } }).meta.turnVerdict).toEqual({
			status: "partial",
			reasons: ["tool_execution_issues", "diagnostic_flags_present"],
		});
	});

	it("does not downgrade coordination-only blocked tool calls to execution issues", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
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
				JSON.stringify({
					id: "bridge-task-real-blocked",
					text: "图片生成被阻塞，我先返回已确认的分析结果。",
					trace: {
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

		expect(result.status).toBe("succeeded");
		expect((result.raw as { meta: { turnVerdict: { status: string; reasons: string[] } } }).meta.turnVerdict).toEqual({
			status: "partial",
			reasons: ["tool_execution_issues", "diagnostic_flags_present"],
		});
	});

	it("prefers runtime completion explicit failure over text-only satisfied heuristics", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-runtime-explicit-failure",
					text: "子代理超时未终态，本轮显式失败。",
					trace: {
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
						completion: {
							source: "deterministic",
							terminal: "explicit_failure",
							allowFinish: true,
							failureReason: null,
							rationale: "runtime 已确认显式失败可直接收口。",
							successCriteria: ["显式报告失败"],
							missingCriteria: [],
							requiredActions: [],
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

		expect(result.status).toBe("succeeded");
		const turnVerdict = (result.raw as { meta: { turnVerdict: { status: string; reasons: string[] } } }).meta.turnVerdict;
		expect(turnVerdict.status).toBe("failed");
		expect(turnVerdict.reasons).toEqual(expect.arrayContaining(["runtime_completion_explicit_failure"]));
	});

	it("propagates structured todoList trace into bridge meta", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
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

	it("downgrades execution-intent turn to partial when todo checklist is incomplete", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-todo-incomplete",
					text: "已完成本轮结构搭建。",
					trace: {
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

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as {
			meta: {
				diagnosticFlags: Array<{ code: string }>;
				turnVerdict: { status: string; reasons: string[] };
			};
		}).meta;
		expect(rawMeta.diagnosticFlags).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "todo_checklist_incomplete" }),
			]),
		);
		expect(rawMeta.turnVerdict.status).toBe("partial");
		expect(rawMeta.turnVerdict.reasons).toEqual(
			expect.arrayContaining(["todo_checklist_incomplete", "diagnostic_flags_present"]),
		);
	});

	it("fails unmet forceAssetGeneration when the turn only returned text", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-force-asset-partial",
					text: "第二个关键帧建议先把人物关系和动作起势钉住，再决定是否进入冲突。",
					trace: {
						toolCalls: [
							{ name: "tapcanvas_project_context_get", status: "succeeded" },
						],
						summary: {
							totalToolCalls: 1,
							succeededToolCalls: 1,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 42,
						},
						output: {
							head: "第二个关键帧建议先把人物关系和动作起势钉住",
							tail: "再决定是否进入冲突。",
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
			prompt: "第二个关键帧打算做什么样的",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				forceAssetGeneration: true,
				chatContext: {
					currentProjectName: "蛊真人",
				},
			},
		});

		expect(result.status).toBe("succeeded");
		const turnVerdict = (result.raw as { meta: { turnVerdict: { status: string; reasons: string[] } } }).meta.turnVerdict;
		expect(turnVerdict.status).toBe("failed");
		expect(turnVerdict.reasons).toEqual(
			expect.arrayContaining(["force_asset_generation_unmet"]),
		);
	});

	it("treats forceAssetGeneration as deferred when an empty project returns an executable canvas plan", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-empty-project-plan",
					text: [
						"先在空项目里落一套可执行角色图工作流。",
						`<tapcanvas_canvas_plan>${JSON.stringify({
							action: "create_canvas_workflow",
							summary: "为李长安角色三视图创建首批图片节点",
							reason: "当前项目还没有服务器 flow，先把可执行节点落到本地画布，后续由前端首存并自动执行。",
							nodes: [
								{
									clientId: "n1",
									kind: "image",
									label: "李长安角色三视图",
									position: { x: 0, y: 0 },
									config: {
										prompt:
											"3D CG国漫风，李长安年轻道士角色三视图设定，正面/侧面/背面统一头身比、道袍结构与腰间法器，角色设定图。",
									},
								},
							],
							edges: [],
						})}</tapcanvas_canvas_plan>`,
					].join("\n\n"),
					trace: {
						toolCalls: [
							{ name: "tapcanvas_books_list", status: "succeeded" },
							{ name: "tapcanvas_book_chapter_get", status: "succeeded" },
							{ name: "tapcanvas_project_flows_list", status: "succeeded" },
						],
						summary: {
							totalToolCalls: 3,
							succeededToolCalls: 3,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 90,
						},
						output: {
							head: "先在空项目里落一套可执行角色图工作流。",
							tail: "后续由前端首存并自动执行。",
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
			prompt: "完成李长安的角色三视图设计并出图",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: null,
				forceAssetGeneration: true,
				chatContext: {
					currentProjectName: "地煞七十二变",
					creationMode: "scene",
				},
			},
		});

		expect(result.status).toBe("succeeded");
		expect((result.raw as { meta: { turnVerdict: { status: string; reasons: string[] } } }).meta.turnVerdict).toEqual({
			status: "partial",
			reasons: ["force_asset_generation_deferred_to_canvas_plan"],
		});
	});

	it("fails semantic execution tasks that stop at task-interrogation JSON without canvas write, plan, or assets", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-semantic-execution-unmet",
					text: JSON.stringify({
						taskGoal: "重新完成第4章漫剧创作，按最佳实践先做预生产必要图片，再生成分镜图片。",
						requestedOutput: "第4章预生产图片节点与分镜图片节点",
						taskKind: "chapter_grounded_storyboard_regeneration_with_preproduction",
						successCriteria: [
							"先建立可执行的预生产锚点，再创建第4章分镜图片节点",
							"节点元数据完整，包含 production metadata",
						],
						blockingGaps: [],
						softGaps: ["缺少沈翠正式角色卡，只能先做本章临时预生产锚点"],
						mustStop: false,
						recommendedNextStage:
							"先创建第4章预生产节点（方源清晨状态锚点、沈翠角色锚点、吊脚楼清晨场景锚点），再创建第4章 storyboard/image 分镜节点。",
					}),
					trace: {
						toolCalls: [
							{ name: "tapcanvas_book_chapter_get", status: "succeeded" },
							{ name: "tapcanvas_storyboard_source_bundle_get", status: "succeeded" },
						],
						summary: {
							totalToolCalls: 2,
							succeededToolCalls: 2,
							failedToolCalls: 0,
							deniedToolCalls: 0,
							blockedToolCalls: 0,
							runMs: 80,
						},
						output: {
							head: "taskGoal",
							tail: "recommendedNextStage",
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
			prompt: "重新完成第四章的漫剧创作，按照最佳实践，先预生产必要图片，然后生成分镜图片",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					currentBookId: "book-1",
					currentChapterId: "4",
				},
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as {
			meta: {
				semanticExecutionIntent: {
					detected: boolean;
					taskKind: string | null;
					requiresExecutionDelivery: boolean;
				};
				turnVerdict: { status: string; reasons: string[] };
			};
		}).meta;
		expect(rawMeta.semanticExecutionIntent).toMatchObject({
			detected: true,
			taskKind: "chapter_grounded_storyboard_regeneration_with_preproduction",
			requiresExecutionDelivery: true,
		});
		expect(rawMeta.turnVerdict).toEqual({
			status: "failed",
			reasons: ["semantic_execution_delivery_unmet"],
		});
	});

	it("allows outputs when Task calls use writer instead of the specialist agent_type", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
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
				JSON.stringify({
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
				JSON.stringify({
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
				JSON.stringify({
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

		expect(accessSpy).toHaveBeenCalled();
		expect(readdirSpy).toHaveBeenCalled();
		expect(readFileSpy).toHaveBeenCalled();
		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.diagnosticContext).toMatchObject({
			bookId: "__________sosdbot-1773463170328",
			chapterId: "2",
		});
		expect(String(requestBody.systemPrompt || "")).toContain(
			"selectedReference.bookId: __________sosdbot-1773463170328",
		);
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
				JSON.stringify({
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
				JSON.stringify({
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
		expect(requestBody.privilegedLocalAccess).toBe(true);
	});

	it("keeps generation tools available even when visual anchors are not present yet", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			return new Response(
				JSON.stringify({
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
		expect(requestBody.privilegedLocalAccess).toBe(true);
	});

	it("keeps canvas write and generation tools available for planOnly bridge chats", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				JSON.stringify({
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
		expect(requestBody.privilegedLocalAccess).toBe(true);
		expect(String(requestBody.systemPrompt || "")).not.toContain("data.productionMetadata");
	});

	it("keeps tools available when agents chat forwards requiredSkills", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				JSON.stringify({
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
		expect(requestBody.maxTurns).toBe(36);
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
					title: "七十二变",
					chapters: [{ chapter: 3 }],
				});
			}
			if (pathText.includes("/skills/tapcanvas-demo-patterns/SKILL.md")) {
				return nodeFs.readFileSync(pathText, "utf8");
			}
			throw new Error(`unexpected path: ${pathText}`);
		});
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				JSON.stringify({
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
		expect(diagnosticContext.promptPipeline).toMatchObject({
			target: "general_chat",
			precheck: {
				status: "not_needed",
				reason: "general_chat_without_project_precheck",
			},
			prerequisiteGeneration: {
				status: "not_needed",
				reason: "no_prerequisite_assets_required",
			},
			promptGeneration: {
				status: "not_needed",
				reason: "general_chat_without_visual_prompt_pipeline",
			},
			precheckSnapshot: {
				directGenerationReady: false,
				generationGateReason: "missing_visual_anchors_for_book_context",
			},
		});
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
					title: "七十二变",
					chapters: [{ chapter: 3 }],
				});
			}
			if (pathText.includes("/skills/tapcanvas-demo-patterns/SKILL.md")) {
				return nodeFs.readFileSync(pathText, "utf8");
			}
			throw new Error(`unexpected path: ${pathText}`);
		});
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				JSON.stringify({
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
				JSON.stringify({
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

	it("injects auto mode team skill and success criteria into the forwarded bridge request", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				JSON.stringify({
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
		expect(requestBody.maxTurns).toBe(36);
		expect(String(requestBody.systemPrompt || "")).not.toContain("【结果透明要求】");
		expect(String(requestBody.systemPrompt || "")).toContain("本轮请求显式要求真实资产交付。");
		expect(String(requestBody.prompt || "")).not.toContain("【AUTO 模式成功标准】");
		const diagnosticContext = requestBody.diagnosticContext as Record<string, unknown>;
		expect(diagnosticContext.promptPipeline).toMatchObject({
			target: "general_chat",
			precheck: {
				status: "not_needed",
				reason: "general_chat_without_project_precheck",
			},
			prerequisiteGeneration: {
				status: "not_needed",
				reason: "no_prerequisite_assets_required",
			},
			promptGeneration: {
				status: "not_needed",
				reason: "general_chat_without_visual_prompt_pipeline",
			},
		});
	});

	it("does not fail non-chapter-grounded auto mode solely because no real agents-team execution evidence was recorded", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
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
				JSON.stringify({
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
		const rawMeta = (result.raw as {
			meta: {
				diagnosticFlags: Array<{ code: string }>;
			};
		}).meta;
		expect(rawMeta.diagnosticFlags).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "auto_mode_agents_team_execution_missing" }),
				expect.objectContaining({ code: "agents_runtime_general_profile" }),
			]),
		);
		expect(writeUserExecutionTrace).toHaveBeenCalledTimes(1);
		const traceInput = writeUserExecutionTrace.mock.calls[0]?.[2] as ExecutionTraceInput;
		expect((traceInput.meta?.requestContext as Record<string, unknown> | undefined)).toMatchObject({
			runtimeProfile: "general",
			runtimeRegisteredTeamToolNames: [],
			runtimeRequireAgentsTeamExecution: false,
		});
		expect((traceInput.meta?.responseTrace as Record<string, unknown> | undefined)).toMatchObject({
			runtime: expect.objectContaining({
				profile: "general",
				registeredTeamToolNames: [],
			}),
		});
	});

	it("surfaces runtime context truncation and policy gating as bridge diagnostics", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
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
		const rawMeta = (result.raw as {
			meta: {
				diagnosticFlags: Array<{ code: string }>;
			};
		}).meta;
		expect(rawMeta.diagnosticFlags).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "agents_runtime_context_truncated" }),
				expect.objectContaining({ code: "agents_runtime_requires_approval" }),
				expect.objectContaining({ code: "agents_runtime_policy_denials_present" }),
			]),
		);

		const traceInput = writeUserExecutionTrace.mock.calls[0]?.[2] as ExecutionTraceInput;
		expect((traceInput.meta?.requestContext as Record<string, unknown> | undefined)).toMatchObject({
			runtimeContextTotalChars: 8000,
			runtimeContextTotalBudgetChars: 12000,
			runtimeContextTruncatedSourceIds: ["runtime_diagnostics"],
			runtimePolicySummary: {
				totalDecisions: 2,
				denyCount: 1,
				requiresApprovalCount: 1,
			},
		});
	});

	it("accepts auto mode when real agents-team execution evidence exists", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
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
				JSON.stringify({
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

	it("prefers forced local bash guard over generic privileged local access copy", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				JSON.stringify({
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

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "读取这本书第一章正文并告诉我讲了什么。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				forceLocalResourceViaBash: true,
				localResourcePaths: ["/app/project-data/users/user-1/projects/project-1/books/book-1"],
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.forceLocalResourceViaBash).toBe(true);
		expect(requestBody.localResourcePaths).toEqual([
			"/app/project-data/users/user-1/projects/project-1/books/book-1",
		]);
		expect(String(requestBody.systemPrompt || "")).not.toContain("硬性要求：必须先使用 bash 工具读取本地资源");
		expect(String(requestBody.systemPrompt || "")).not.toContain("特权模式：已授权访问本地资源");
	});

	it("auto-forces scoped local bash evidence for plain project book chats when exactly one book is present", async () => {
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
				JSON.stringify({
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
					bookId: "book-1",
					title: "地煞七十二变",
					chapterCount: 1,
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
		expect(String(requestBody.systemPrompt || "")).not.toContain("硬性要求：必须先使用 bash 工具读取本地资源");
		expect(String(requestBody.systemPrompt || "")).not.toContain("先读取该目录下的 index.json");
	});

	it("auto-forces scoped local bash evidence for scene creation chats even when visual refs are present", async () => {
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
				JSON.stringify({
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
					bookId: "book-1",
					title: "地煞七十二变",
					chapterCount: 1,
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
		expect(String(requestBody.systemPrompt || "")).not.toContain("硬性要求：必须先使用 bash 工具读取本地资源");
		expect(String(requestBody.systemPrompt || "")).not.toContain("先读取该目录下的 index.json");
	});

	it("does not extract chapter number from prompt into bridge request metadata when chapterId was not provided", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				JSON.stringify({
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

		expect(writeUserExecutionTrace).toHaveBeenCalledTimes(1);
		const traceInput = writeUserExecutionTrace.mock.calls[0]?.[2] as ExecutionTraceInput;
		expect(traceInput.inputSummary).not.toContain("chapter=1");
		const traceMeta = traceInput.meta || {};
		expect((traceMeta as Record<string, unknown>).chapterId).toBeUndefined();
		expect((traceMeta.requestContext as Record<string, unknown> | undefined)?.promptChars).toBe(
			"小说第一章内容讲了什么？".length,
		);
	});

	it("forwards project-scoped remote canvas tools to agents-cli", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				JSON.stringify({
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
		expect(String(requestBody.systemPrompt || "")).toContain("selectedNodeKind: image");
		expect(String(requestBody.systemPrompt || "")).toContain("selectedReference.kind: image");
		expect(String(requestBody.systemPrompt || "")).not.toContain("selectedNodeKind: storyboard");
		expect(requestBody.remoteToolConfig).toMatchObject({
			endpoint: "https://api.tapcanvas.test/public/agents/tools/execute",
			projectId: "project-1",
			flowId: "flow-1",
		});
		expect(Array.isArray(requestBody.remoteTools)).toBe(true);
		const remoteTools = requestBody.remoteTools as Array<Record<string, unknown>>;
		const canvasCapabilityManifest = requestBody.canvasCapabilityManifest as Record<string, unknown>;
		expect(remoteTools.map((tool) => tool.name)).toEqual([
			"tapcanvas_project_flows_list",
			"tapcanvas_project_context_get",
			"tapcanvas_books_list",
			"tapcanvas_book_index_get",
			"tapcanvas_book_chapter_get",
			"tapcanvas_book_storyboard_plan_get",
			"tapcanvas_book_storyboard_plan_upsert",
			"tapcanvas_storyboard_continuity_get",
			"tapcanvas_pipeline_runs_list",
			"tapcanvas_pipeline_run_get",
			"tapcanvas_storyboard_source_bundle_get",
			"tapcanvas_node_context_bundle_get",
			"tapcanvas_video_review_bundle_get",
			"tapcanvas_executions_list",
			"tapcanvas_execution_get",
			"tapcanvas_execution_node_runs_get",
			"tapcanvas_execution_events_list",
			"tapcanvas_flow_get",
			"tapcanvas_flow_patch",
		]);
		expect(canvasCapabilityManifest.version).toBe("2026-04-03");
		expect(Array.isArray(canvasCapabilityManifest.localCanvasTools)).toBe(true);
		expect(Array.isArray(canvasCapabilityManifest.remoteTools)).toBe(true);
		expect(
			(canvasCapabilityManifest.remoteTools as Array<Record<string, unknown>>).map((tool) => tool.name),
		).toEqual(remoteTools.map((tool) => tool.name));
		expect(canvasCapabilityManifest.nodeSpecs).toMatchObject({
			text: expect.objectContaining({ label: "文本" }),
			video: expect.objectContaining({ label: "图生/文生视频" }),
		});
		expect(canvasCapabilityManifest.nodeSpecs).not.toHaveProperty("storyboard");
		expect(canvasCapabilityManifest.protocols).toMatchObject({
			flowPatch: expect.objectContaining({
				supportedCreateNodeTypes: ["taskNode", "groupNode"],
			}),
		});
		const flowPatchTool = remoteTools.find((tool) => tool.name === "tapcanvas_flow_patch");
		const flowPatchDescription = String(flowPatchTool?.description || "");
		expect(flowPatchDescription).toContain("Supported createNodes object types are taskNode / groupNode only");
		expect(flowPatchDescription).toContain("Asset generation is executed by the web app after runnable nodes are added");
		expect(flowPatchDescription).toContain("persist the real reference inputs into node data");
		expect(flowPatchDescription).toContain("never rely on prompt wording alone to preserve references");
		expect(flowPatchDescription).toContain("every referenced createNode must declare an explicit stable id first");
		expect(flowPatchDescription).toContain("labels are never valid node ids for edges");
		expect(flowPatchDescription).toContain("Child nodes that declare parentId must use positions relative to that parent group");
		expect(flowPatchDescription).toContain("persisted node order is normalized parent-first");
		expect(flowPatchDescription).toContain("list grouped children in the exact visual order you want preserved");
		expect(flowPatchDescription).toContain("data.kind='text'");
		expect(flowPatchDescription).toContain("Do not invent textNode");
		expect(flowPatchDescription).toContain("prefer createEdges with the real source/target node ids");
		expect(flowPatchDescription).toContain("out-image / in-image / out-video / in-any");
		expect(flowPatchDescription).toContain("text-like nodes such as text / storyboardScript / novelDoc / scriptDoc use source handles out-text / out-text-wide and have no target handles");
		expect(flowPatchDescription).toContain("sourceHandle:'out-image'");
		expect(flowPatchDescription).toContain("Never invent semantic aliases like image / reference");
		expect(flowPatchDescription).toContain("appendNodeArrays only appends items into data[key] of an existing node id");
		expect(flowPatchDescription).toContain("The item shape is {id:'node-id', key:'arrayField', items:[...]}; items is required");
		expect(flowPatchDescription).toContain("productionMetadata:{chapterGrounded:true,lockedAnchors");
		expect(flowPatchDescription).toContain("do not plan a follow-up cleanup patch just to add metadata");
		expect(flowPatchDescription).toContain("must already carry data.productionLayer / data.creationStage / data.approvalStatus plus complete data.productionMetadata");
		expect(flowPatchDescription).not.toContain("primary visual deliverables");
		expect(flowPatchDescription).not.toContain("Placeholder pending image/video nodes for later execution are allowed");
		expect((flowPatchTool?.parameters as { properties?: Record<string, unknown> } | undefined)?.properties?.createEdges).toMatchObject({
			type: "array",
		});
		expect(
			(
				(
					flowPatchTool?.parameters as {
						properties?: Record<string, { items?: { oneOf?: Array<Record<string, unknown>> } }>;
					}
				)?.properties?.createNodes?.items?.oneOf?.[0] as
					| { properties?: { data?: { properties?: Record<string, unknown> } } }
					| undefined
			)?.properties?.data?.properties,
		).not.toHaveProperty("storyboardEditorCells");
		expect(
			(
				(
					flowPatchTool?.parameters as {
						properties?: Record<string, { items?: { oneOf?: Array<Record<string, unknown>> } }>;
					}
				)?.properties?.createNodes?.items?.oneOf?.[0] as
					| { properties?: { data?: { properties?: Record<string, unknown> } } }
					| undefined
			)?.properties?.data?.properties?.productionMetadata,
		).toMatchObject({
			type: "object",
		});
		expect(
			(
				(
					flowPatchTool?.parameters as {
						properties?: Record<string, { items?: { oneOf?: Array<Record<string, unknown>> } }>;
					}
				)?.properties?.createNodes?.items?.oneOf?.[0] as
					| { properties?: { data?: { properties?: Record<string, unknown> } } }
					| undefined
			)?.properties?.data?.properties?.productionLayer,
		).toMatchObject({
			type: "string",
		});
		expect(
			(
				(
					flowPatchTool?.parameters as {
						properties?: Record<string, { items?: { oneOf?: Array<Record<string, unknown>> } }>;
					}
				)?.properties?.createNodes?.items?.oneOf?.[0] as
					| { properties?: { data?: { properties?: Record<string, unknown> } } }
					| undefined
			)?.properties?.data?.properties?.creationStage,
		).toMatchObject({
			type: "string",
		});
		expect(
			(
				(
					flowPatchTool?.parameters as {
						properties?: Record<string, { items?: { oneOf?: Array<Record<string, unknown>> } }>;
					}
				)?.properties?.createNodes?.items?.oneOf?.[0] as
					| { properties?: { data?: { properties?: Record<string, unknown> } } }
					| undefined
			)?.properties?.data?.properties?.approvalStatus,
		).toMatchObject({
			type: "string",
		});
		expect(
			(
				(
					flowPatchTool?.parameters as {
						properties?: Record<string, { items?: { oneOf?: Array<Record<string, unknown>> } }>;
					}
				)?.properties?.createNodes?.items?.oneOf?.[0] as
					| { properties?: { data?: { properties?: Record<string, unknown> } } }
					| undefined
			)?.properties?.data?.properties?.referenceImages,
		).toMatchObject({
			type: "array",
		});
		expect(
			(
				(
					flowPatchTool?.parameters as {
						properties?: Record<string, { items?: { oneOf?: Array<Record<string, unknown>> } }>;
					}
				)?.properties?.createNodes?.items?.oneOf?.[0] as
					| { properties?: { data?: { properties?: Record<string, unknown> } } }
					| undefined
			)?.properties?.data?.properties?.firstFrameUrl,
		).toMatchObject({
			type: "string",
		});
	});

	it("forwards project tools and auto-resolved flow tools when flowId is omitted", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				JSON.stringify({
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
		const canvasCapabilityManifest = requestBody.canvasCapabilityManifest as Record<string, unknown>;
		expect(remoteTools.map((tool) => tool.name)).toEqual([
			"tapcanvas_project_flows_list",
			"tapcanvas_project_context_get",
			"tapcanvas_books_list",
			"tapcanvas_book_index_get",
			"tapcanvas_book_chapter_get",
			"tapcanvas_book_storyboard_plan_get",
			"tapcanvas_book_storyboard_plan_upsert",
			"tapcanvas_storyboard_continuity_get",
			"tapcanvas_pipeline_runs_list",
			"tapcanvas_pipeline_run_get",
			"tapcanvas_storyboard_source_bundle_get",
			"tapcanvas_node_context_bundle_get",
			"tapcanvas_video_review_bundle_get",
			"tapcanvas_executions_list",
			"tapcanvas_execution_get",
			"tapcanvas_execution_node_runs_get",
			"tapcanvas_execution_events_list",
			"tapcanvas_flow_get",
			"tapcanvas_flow_patch",
		]);
		expect(
			(canvasCapabilityManifest.remoteTools as Array<Record<string, unknown>>).map((tool) => tool.name),
		).toEqual(remoteTools.map((tool) => tool.name));
		expect(requestBody.remoteToolConfig).toMatchObject({
			endpoint: "https://api.tapcanvas.test/public/agents/tools/execute",
			projectId: "project-1",
			flowId: "flow-1",
		});
	});

	it("auto-resolves the latest writable flow when canvasFlowId is omitted", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				JSON.stringify({
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
		expect(requestBody.tapcanvasProjectId).toBe("project-1");
		expect(requestBody.tapcanvasFlowId).toBe("flow-1");
		expect("sessionId" in requestBody).toBe(false);
	});

	it("forwards response_format preferences to agents-cli chat requests", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				JSON.stringify({
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

		await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "添加空白文本节点",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				responseFormat,
			},
		});

		const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
		const requestBody = JSON.parse(String(requestInit?.body || "{}")) as Record<string, unknown>;
		expect(requestBody.responseFormat).toEqual(responseFormat);
	});

	it("marks successful tapcanvas_flow_patch calls as direct canvas writes", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
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
				requiresConfirmation: false,
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
				JSON.stringify({
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
				JSON.stringify({
					id: "bridge-task-flow-patch-failed",
					text: "flow patch 失败，未写入画布。",
					trace: {
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

		expect(result.status).toBe("succeeded");
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
			status: "partial",
			reasons: ["tool_execution_issues", "diagnostic_flags_present"],
		});
	});

	it("marks storyboard text-only flow patches as partial when the storyboard editor contract is violated", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-storyboard-text-only",
					text: "已把第一章分镜节点写进画布。",
					trace: {
						toolCalls: [
							{
								name: "tapcanvas_flow_patch",
								status: "succeeded",
								input: {
									createNodes: [
										{
											type: "taskNode",
											position: { x: 0, y: 0 },
											data: {
												kind: "storyboard",
												label: "第一章镜头拆解",
												content: "镜头1：强拆冲突\n镜头2：分钱与旧宅倒塌",
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
							runMs: 35,
						},
						output: {
							head: "已把第一章分镜节点写进画布。",
							tail: "已把第一章分镜节点写进画布。",
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
			prompt: "把第一章分镜写进画布",
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
		expect(rawMeta.diagnosticFlags).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "storyboard_editor_text_only_misuse",
				}),
			]),
		);
		expect(rawMeta.turnVerdict).toEqual({
			status: "partial",
			reasons: expect.arrayContaining([
				"storyboard_editor_text_only_misuse",
				"diagnostic_flags_present",
			]),
		});
	});

	it("does not flag reference binding missing when a new in-batch authority base frame replaces the old selected authority chain", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-in-batch-authority-handover",
					text: "已重建第三章锁资产业务链。",
					trace: {
						toolCalls: [
							{
								name: "tapcanvas_flow_patch",
								status: "succeeded",
								input: {
									patchNodeData: [
										{
											id: "chapter3_baseframe",
											data: {
												kind: "image",
												approvalStatus: "rejected",
												productionMetadata: buildChapterGroundedProductionMetadata("confirmed"),
											},
										},
									],
									createNodes: [
										{
											id: "chapter3_baseframe_locked",
											type: "taskNode",
											position: { x: 40, y: 40 },
											data: {
												kind: "image",
												label: "第3章新权威基底帧",
												prompt: "第三章新权威基底帧",
												structuredPrompt: buildImagePromptSpecV2Payload(),
												productionLayer: "preproduction",
												creationStage: "authority_base_frame",
												approvalStatus: "needs_confirmation",
												productionMetadata: buildChapterGroundedProductionMetadata("planned"),
											},
										},
										{
											id: "chapter3_stills_plan",
											type: "taskNode",
											position: { x: 340, y: 40 },
											data: {
												kind: "image",
												label: "第3章静帧组",
												prompt: "第三章多镜头静帧",
												structuredPrompt: buildImagePromptSpecV2Payload(),
												productionLayer: "draft",
												creationStage: "storyboard_stills",
												approvalStatus: "needs_confirmation",
												productionMetadata: buildChapterGroundedProductionMetadata("planned"),
											},
										},
										{
											id: "chapter3_video_plan",
											type: "taskNode",
											position: { x: 640, y: 40 },
											data: {
												kind: "composeVideo",
												label: "第3章视频补充",
												prompt: "第三章视频补充占位",
												productionLayer: "draft",
												creationStage: "video_followup",
												approvalStatus: "needs_confirmation",
												productionMetadata: buildChapterGroundedProductionMetadata("planned"),
											},
										},
									],
									createEdges: [
										{
											id: "edge_ch3_base_locked_stills",
											source: "chapter3_baseframe_locked",
											target: "chapter3_stills_plan",
											sourceHandle: "out-image",
											targetHandle: "in-image",
										},
										{
											id: "edge_ch3_base_locked_video",
											source: "chapter3_baseframe_locked",
											target: "chapter3_video_plan",
											sourceHandle: "out-image",
											targetHandle: "in-any",
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
							runMs: 31,
						},
						output: {
							head: "已重建第三章锁资产业务链。",
							tail: "已重建第三章锁资产业务链。",
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
			prompt: "重新完成第三章的定格动画图片创作，重建锁资产业务链",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeKind: "image",
					selectedReference: {
						nodeId: "chapter3_baseframe",
						label: "错误旧基底帧",
						kind: "image",
						imageUrl: "https://cdn.tapcanvas.test/ch3-old-baseframe.png",
						approvalStatus: "approved",
						authorityBaseFrameNodeId: "chapter3_baseframe",
						authorityBaseFrameStatus: "confirmed",
						hasUpstreamTextEvidence: true,
						hasDownstreamComposeVideo: true,
						chapterId: "3",
					},
				},
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as {
			meta: {
				diagnosticFlags: Array<{ code: string }>;
				canvasMutation: {
					deletedNodeIds: string[];
					deletedEdgeIds: string[];
					createdNodeIds: string[];
					patchedNodeIds: string[];
					executableNodeIds: string[];
				};
			};
		}).meta;
		expect(rawMeta.canvasMutation).toMatchObject({
			createdNodeIds: expect.arrayContaining([
				"chapter3_baseframe_locked",
				"chapter3_stills_plan",
				"chapter3_video_plan",
			]),
			patchedNodeIds: expect.arrayContaining(["chapter3_baseframe"]),
		});
		expect(rawMeta.diagnosticFlags).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "chapter_grounded_reference_binding_missing",
				}),
			]),
		);
	});

	it("flags chapter grounded image nodes that drop runtime reference images without persisting bindings", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-runtime-reference-binding-missing",
					text: "已创建第四章场景资产节点。",
					trace: {
						toolCalls: [
							{
								name: "tapcanvas_flow_patch",
								status: "succeeded",
								input: {
									createNodes: [
										{
											id: "chapter4_scene_anchor",
											type: "taskNode",
											position: { x: 120, y: 120 },
											data: {
												kind: "image",
												label: "第4章房内晨光场景",
												prompt: "清晨木屋内景，晨光透窗，写实空间描写。",
												productionLayer: "draft",
												creationStage: "preproduction",
												approvalStatus: "needs_confirmation",
												productionMetadata: {
													chapterGrounded: true,
													lockedAnchors: {
														character: [],
														scene: ["木屋内景"],
														shot: ["晨光建立镜头"],
														continuity: ["承接第4章清晨起行氛围"],
														missing: [],
													},
												},
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
						output: {
							head: "已创建第四章场景资产节点。",
							tail: "已创建第四章场景资产节点。",
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
			prompt: "完成第四章的创作。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				assetInputs: [
					{
						url: "https://cdn.tapcanvas.test/style-board.png",
						role: "style",
						name: "chapter-4-style-anchor",
					},
				],
				chatContext: {
					currentProjectName: "蛊真人",
					selectedNodeKind: "image",
				},
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as {
			meta: {
				diagnosticFlags: Array<{ code: string }>;
			};
		}).meta;
		expect(rawMeta.diagnosticFlags).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "chapter_grounded_reference_binding_missing",
				}),
			]),
		);
	});

	it("fails prompt-only storyboard delivery even when the turn also created image-like plan nodes", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-storyboard-prompt-only-delivery",
					text: "已拆出第三章 12 镜头并写入分镜板。",
					trace: {
						toolCalls: [
							{
								name: "tapcanvas_flow_patch",
								status: "succeeded",
								input: {
									createNodes: [
										{
											id: "rolecard-fangyuan-c3",
											type: "taskNode",
											position: { x: 40, y: 60 },
											data: {
												kind: "image",
												label: "角色卡-方源-第三章",
												prompt: "少年方源角色卡，黑金古装，夜雨世界观。",
											},
										},
										{
											id: "chapter3_board",
											type: "taskNode",
											position: { x: 40, y: 520 },
											data: {
												kind: "storyboard",
												label: "第三章漫剧分镜板",
												storyboardEditorCells: [
													{
														id: "c3s1",
														shotNo: 1,
														label: "重生确认",
														prompt: "古装玄幻雨夜木屋，方源抬手凝视。",
													},
													{
														id: "c3s2",
														shotNo: 2,
														label: "光阴之河",
														prompt: "方源窗边闭眼，背后出现逆流光阴幻象。",
													},
												],
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
							runMs: 46,
						},
						output: {
							head: "已拆出第三章 12 镜头并写入分镜板。",
							tail: "已拆出第三章 12 镜头并写入分镜板。",
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
			prompt: "完成第三章节的漫剧创作",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				mode: "auto",
				forceAssetGeneration: true,
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as {
			meta: {
				diagnosticFlags: Array<{ code: string }>;
				turnVerdict: { status: string; reasons: string[] };
			};
		}).meta;
		expect(rawMeta.diagnosticFlags).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "storyboard_prompt_only_visual_delivery_missing",
				}),
			]),
		);
		expect(rawMeta.turnVerdict).toEqual({
			status: "failed",
			reasons: expect.arrayContaining(["storyboard_prompt_only_visual_delivery_missing"]),
		});
	});

	it("fails chapter-grounded stop-motion deliveries that only write one base frame plus a video placeholder", async () => {
		const repoRoot = path.resolve(process.cwd(), "..", "..");
		const scopedBookDir = path.join(
			repoRoot,
			"project-data",
			"users",
			"user-1",
			"projects",
			"project-1",
			"books",
			"book-1",
		);
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					id: "bridge-task-chapter-single-baseframe-video-placeholder",
					text: "已完成第三章定格动画创作并写入画布。",
					trace: {
						toolCalls: [
							{
								name: "tapcanvas_flow_patch",
								status: "succeeded",
								input: {
									createNodes: [
										{
											id: "chapter3_group",
											type: "groupNode",
											position: { x: 40, y: 40 },
											style: { width: 1200, height: 760 },
											data: { label: "第3章定格动画", isGroup: true, groupKind: "chapterProduction" },
										},
										{
											id: "chapter3_script",
											type: "taskNode",
											parentId: "chapter3_group",
											position: { x: 40, y: 80 },
											data: {
												kind: "storyboardScript",
												label: "第三章脚本",
												content: "8 个镜头文本脚本",
											},
										},
										{
											id: "chapter3_baseframe",
											type: "taskNode",
											parentId: "chapter3_group",
											position: { x: 380, y: 80 },
											data: {
												kind: "image",
												label: "第三章基底帧",
												prompt: "古装玄幻雨夜木屋，方源重生确认。",
												structuredPrompt: buildImagePromptSpecV2Payload(),
												productionLayer: "preproduction",
												creationStage: "authority_base_frame",
												approvalStatus: "planned",
												productionMetadata: {
													chapterGrounded: true,
													lockedAnchors: {
														character: ["方源"],
														scene: ["木屋", "雨夜"],
														shot: ["抬手确认重生"],
														continuity: [],
														missing: [],
													},
													authorityBaseFrame: {
														status: "planned",
														source: "chapter_context",
														reason: "等待确认",
														nodeId: null,
													},
												},
											},
										},
										{
											id: "chapter3_video_plan",
											type: "taskNode",
											parentId: "chapter3_group",
											position: { x: 720, y: 80 },
											data: {
												kind: "composeVideo",
												label: "第三章视频占位",
												prompt: "基于第三章基底帧做后续定格动画视频。",
												productionLayer: "draft",
												creationStage: "video_followup",
												approvalStatus: "planned",
												productionMetadata: {
													chapterGrounded: true,
													lockedAnchors: {
														character: ["方源"],
														scene: ["木屋", "雨夜"],
														shot: ["重生确认", "长生执念"],
														continuity: [],
														missing: [],
													},
													authorityBaseFrame: {
														status: "planned",
														source: "chapter_context",
														reason: "等待确认",
														nodeId: "chapter3_baseframe",
													},
												},
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
							runMs: 52,
						},
						output: {
							head: "已完成第三章定格动画创作并写入画布。",
							tail: "已完成第三章定格动画创作并写入画布。",
						},
						turns: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(fs, "readFile").mockImplementation(async (targetPath) => {
			if (String(targetPath) === path.join(scopedBookDir, "index.json")) {
				return JSON.stringify({
					bookId: "book-1",
					title: "蛊真人",
					chapterCount: 3,
					assets: {},
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

		const result = await runAgentsBridgeChatTask(createContext(), "user-1", {
			kind: "chat",
			prompt: "完成第三章节的定格动画创作",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				mode: "auto",
				forceAssetGeneration: true,
				bookId: "book-1",
				chapterId: "3",
				chatContext: {
					currentProjectName: "蛊真人",
					currentBookId: "book-1",
					currentChapterId: "3",
				},
			},
		});

		expect(result.status).toBe("succeeded");
		const rawMeta = (result.raw as {
			meta: {
				diagnosticFlags: Array<{ code: string }>;
				expectedDelivery: { kind: string; reason: string };
				deliveryVerification: { status: string; code: string | null };
				deliveryEvidence: { imageLikeNodeCount: number; hasVideoNodes: boolean };
				turnVerdict: { status: string; reasons: string[] };
			};
		}).meta;
		expect(rawMeta.diagnosticFlags).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "chapter_grounded_multishot_delivery_missing" }),
			]),
		);
		expect(rawMeta.expectedDelivery).toMatchObject({
			kind: "chapter_multishot_stills",
		});
		expect(rawMeta.deliveryEvidence).toMatchObject({
			imageLikeNodeCount: 1,
			hasVideoNodes: true,
		});
		expect(rawMeta.deliveryVerification).toMatchObject({
			applicable: true,
			status: "failed",
			code: "chapter_grounded_multishot_delivery_missing",
		});
		expect(rawMeta.turnVerdict).toEqual({
			status: "failed",
			reasons: ["chapter_grounded_multishot_delivery_missing"],
		});
	});

	it("marks successful tapcanvas_video_generate_to_canvas calls as generated assets and direct canvas writes", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
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
				requiresConfirmation: false,
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
				JSON.stringify({
					id: "bridge-task-image-generate-failed",
					text: "图片生成失败。",
					trace: {
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

		expect(result.status).toBe("succeeded");
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
			status: "partial",
			reasons: ["tool_execution_issues", "diagnostic_flags_present"],
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
				JSON.stringify({
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
				JSON.stringify({
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
				JSON.stringify({
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
				JSON.stringify({
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
				JSON.stringify({
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
				JSON.stringify({
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
			expect(requestBody.privilegedLocalAccess).toBe(true);
			expect(requestBody.forceLocalResourceViaBash).toBeUndefined();
			expect(String(requestBody.prompt || "")).not.toContain("自动项目文本访问");
			expect(String(requestBody.prompt || "")).not.toContain("强制读取顺序：先用 tapcanvas_books_list");
			expect(String(requestBody.systemPrompt || "")).not.toContain("自动项目文本访问");
			expect(String(requestBody.systemPrompt || "")).not.toContain("强制读取顺序：先用 tapcanvas_books_list");
			expect(String(requestBody.systemPrompt || "")).not.toContain("【结果透明要求】");
			expect(String(requestBody.systemPrompt || "")).not.toContain("只陈述已被本轮工具或结构化结果直接证实的事实");
			expect(String(requestBody.systemPrompt || "")).not.toContain("若未读取当前项目状态，不得把项目进度、画布状态或界面可见性写成已确认事实");
			return new Response(
				JSON.stringify({
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
				JSON.stringify({
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
				JSON.stringify({
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
				JSON.stringify({
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
				JSON.stringify({
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
				JSON.stringify({
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
				JSON.stringify({
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
				JSON.stringify({
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
						url: "https://example.com/character.png",
						role: "character",
						name: "李长安",
						note: "主角外观锚点",
					},
					{
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
				role: "角色参考",
				label: "李长安",
				note: "主角外观锚点",
			},
			{
				slot: "图2",
				url: "https://example.com/scene.png",
				role: "场景参考",
				label: "老屋建立镜头",
				note: "老屋空间关系",
			},
		]);

		expect(writeUserExecutionTrace).toHaveBeenCalledTimes(1);
		const traceInput = writeUserExecutionTrace.mock.calls[0]?.[2] as ExecutionTraceInput;
		expect((traceInput.meta?.requestContext as Record<string, unknown>)?.referenceImageSlots).toEqual([
			"图1 | 李长安 | role=角色参考 | note=主角外观锚点",
			"图2 | 老屋建立镜头 | role=场景参考 | note=老屋空间关系",
		]);
	});

	it("injects runtime reference context even when the prompt already mentions natural-language reference headings", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				JSON.stringify({
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
			prompt: "请把【参考图】和【资产输入】都体现在最终执行 prompt 里。",
			extras: {
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				referenceImages: ["https://example.com/character.png"],
				assetInputs: [
					{
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
		expect(forwardedPrompt).toContain("role=character | url=https://example.com/character.png");
		expect(forwardedPrompt).toContain("【参考图图位清单】");
		expect(forwardedPrompt).toContain("图1 | url=https://example.com/character.png");
	});

	it("does not inject product integrity constraints for chapter-grounded storyboard requests with target/reference assets", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(
				JSON.stringify({
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
		expect(String(requestBody.prompt || "")).toContain("【参考图图位协议】");
	});

});
