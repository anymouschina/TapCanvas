import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";
import type { TaskResultDto } from "../task/task.schemas";

const { persistUserConversationTurn, appendPublicChatTurnRun, resolveOrCreatePublicChatSession, buildPublicChatTurnEntityId } = vi.hoisted(() => ({
	persistUserConversationTurn: vi.fn(),
	appendPublicChatTurnRun: vi.fn(),
	resolveOrCreatePublicChatSession: vi.fn(),
	buildPublicChatTurnEntityId: vi.fn(() => "public-chat-turn_run:stable"),
}));

vi.mock("../memory/memory.service", () => ({
	persistUserConversationTurn,
}));

vi.mock("./public-chat-session.repo", () => ({
	appendPublicChatTurnRun,
	buildPublicChatTurnEntityId,
	resolveOrCreatePublicChatSession,
}));

import {
	buildAgentsChatResponseFromTaskResult,
	persistAgentsChatConversationTurn,
	persistInterruptedAgentsChatRun,
} from "./public-agents-chat-response";

function createContext(): AppContext {
	return {
		env: {
			DB: {},
		} as unknown as AppContext["env"],
	} as AppContext;
}

function createLogicalTaskState(
	status: "active" | "waiting_input" | "waiting_external" | "succeeded" | "failed" | "cancelled",
	reasonCode: string,
) {
	return {
		version: 1 as const,
		logicalTaskId: "req-1",
		status,
		reasonCode,
		physicalRunStatus: status === "active"
			? "running" as const
			: status === "waiting_external"
				? "handed_off" as const
				: status === "failed" || status === "cancelled"
					? "interrupted" as const
					: "completed" as const,
		deliveryStatus: status === "succeeded"
			? "satisfied" as const
			: status === "failed" || status === "cancelled"
				? "unsatisfied" as const
				: "pending" as const,
		taskNodeId: "root",
		taskRevision: 1,
		updatedAt: "2026-08-30T04:00:00.000Z",
		continuationTicket: null,
	};
}

function createSucceededTaskResult(): TaskResultDto {
	return {
		id: "task-1",
		kind: "chat",
		status: "succeeded",
		assets: [
			{
				type: "image",
				url: "https://cdn.tapcanvas.test/result.png",
				thumbnailUrl: "https://cdn.tapcanvas.test/result-thumb.png",
				assetId: "asset-1",
				assetRefId: "hero_ref",
				assetName: "主角定妆",
			},
		],
		raw: {
			text: "最终结果正文",
			meta: {
				modelAlias: "deepseek-v4-flash",
				requestId: "req-1",
				sessionId: "project:1:conversation:abc",
				outputMode: "direct_assets",
				toolEvidence: {
					toolNames: ["generate_image_to_canvas"],
					readProjectState: true,
					readBookList: false,
					readBookIndex: false,
					readChapter: false,
					readStoryboardPlan: false,
					readStoryboardContinuity: false,
					readStoryboardSourceBundle: false,
					readNodeContextBundle: false,
					readVideoReviewBundle: false,
					readMaterialAssets: false,
					generatedAssets: true,
					wroteCanvas: true,
				},
				toolStatusSummary: {
					totalToolCalls: 1,
					succeededToolCalls: 1,
					failedToolCalls: 0,
					deniedToolCalls: 0,
					blockedToolCalls: 0,
					runMs: 3200,
				},
				canvasMutation: {
					deletedNodeIds: [],
					deletedEdgeIds: [],
					createdNodeIds: ["node-1"],
					patchedNodeIds: [],
					executableNodeIds: ["node-1"],
				},
				diagnosticFlags: [],
				canvasPlan: {
					tagPresent: false,
					normalized: false,
					parseSuccess: false,
					error: "",
					errorCode: "",
					errorDetail: "",
					schemaIssues: [],
					detectedTagName: "",
					nodeCount: 0,
					edgeCount: 0,
					nodeKinds: [],
					hasAssetUrls: false,
					action: "none",
					summary: "",
					reason: "",
					rawPayload: "",
				},
				todoList: {
					sourceToolCallId: "tool-1",
					items: [{ text: "生成图片", completed: true, status: "completed" }],
					totalCount: 1,
					completedCount: 1,
					inProgressCount: 0,
					pendingCount: 0,
				},
				todoEvents: [],
				runtime: {
					profile: "code",
					registeredToolNames: ["Skill", "tapcanvas_flow_patch"],
					registeredTeamToolNames: ["spawn_agent"],
					requiredSkills: ["tapcanvas"],
					loadedSkills: ["tapcanvas"],
					allowedSubagentTypes: ["worker"],
					requireAgentsTeamExecution: false,
					inputProgressionGate: {
						status: "completed",
						model: "deepseek-v4-flash",
						decision: "allow",
						reasonCode: "safe_request",
						reason: "可继续处理",
					},
					contextDiagnostics: {
						totalChars: 1200,
						totalBudgetChars: 6000,
						sources: [
							{
								id: "persona",
								kind: "persona",
								summary: "persona bundle",
								chars: 300,
								budgetChars: 2000,
								truncated: false,
							},
						],
					},
					capabilitySnapshot: {
						providers: [
							{
								kind: "local",
								name: "local_registry",
								toolNames: ["Skill"],
								toolCount: 1,
							},
						],
						exposedToolNames: ["Skill", "tapcanvas_flow_patch"],
						exposedTeamToolNames: ["spawn_agent"],
					},
					policySummary: {
						totalDecisions: 2,
						allowCount: 1,
						denyCount: 0,
						requiresApprovalCount: 1,
						uniqueDeniedSignatures: ["request:command:needs approval"],
					},
				},
				turnVerdict: {
					status: "satisfied",
					reasons: ["generated_assets"],
				},
				requestTerminal: {
					version: 1,
					terminal: true,
					status: "succeeded",
					reason: "image_delivery_verified",
				},
				logicalTaskState: createLogicalTaskState("succeeded", "image_delivery_verified"),
				expectedDelivery: {
					active: true,
					kind: "image",
					source: "agents_cli_tool_trace",
					reason: "explicit_structured_delivery_contract",
					deliveryContract: { kind: "image", minimumAssetCount: 1 },
					contractHash: "sha256:image-contract",
				},
				deliveryEvidence: {
					version: 2,
					items: [
						{
							evidenceId: "artifact:node-1",
							kind: "artifact",
							mediaType: "image",
							sourceRef: "node-1",
							requirementIds: ["image-materialized"],
							artifactClass: "image",
							attributes: { assetUrl: "https://cdn.tapcanvas.test/result.png" },
						},
					],
					artifacts: [
						{
							toolCallId: "tool-1",
							toolName: "tapcanvas_image_generate_to_canvas",
							assetType: "image",
							deliveryState: "materialized",
							nodeId: "node-1",
							taskId: "task-image-1",
							runId: null,
							clipIndex: null,
							assetUrl: "https://cdn.tapcanvas.test/result.png",
						},
					],
					assetCount: 1,
					imageAssetCount: 1,
					videoAssetCount: 0,
					wroteCanvas: true,
					generatedAssets: true,
					imageLikeNodeCount: 1,
					preproductionImageLikeNodeCount: 0,
					reusablePreproductionImageLikeNodeCount: 0,
					materializedStoryboardStillCount: 0,
					hasVideoNodes: false,
					hasMaterializedVisualOutputs: true,
					hasPlannedAuthorityBaseFrame: false,
					hasConfirmedAuthorityBaseFrame: false,
					storyboardPlanPersistenceCount: 0,
				},
				deliveryVerification: {
					version: 2,
					contractHash: "sha256:image-contract",
					status: "satisfied",
					criteria: [
						{
							requirementId: "image-materialized",
							status: "satisfied",
							evidenceIds: ["artifact:node-1"],
							reason: "A materialized image URL was reported.",
						},
					],
					verifiedAt: "2026-08-10T01:02:03.000Z",
				},
				agentDecision: {
					executionKind: "generate",
					canvasAction: "write_canvas",
					assetCount: 1,
					projectStateRead: true,
					requiresConfirmation: false,
					reason: "已生成并回填画布",
				},
				projectId: "project-1",
				bookId: "book-1",
				chapterId: "chapter-1",
				label: "chat-main",
			},
		},
	};
}

describe("public agents chat response helpers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		persistUserConversationTurn.mockResolvedValue({
			sessionId: "session-row-1",
			userMessageId: "user-msg-1",
			assistantMessageId: "assistant-msg-1",
		});
		appendPublicChatTurnRun.mockResolvedValue(undefined);
		resolveOrCreatePublicChatSession.mockResolvedValue({
			id: "session-row-1",
			user_id: "user-1",
			session_key: "project:1:conversation:abc",
			created_at: "2026-08-08T00:00:00.000Z",
			updated_at: "2026-08-08T00:00:00.000Z",
		});
	});

	it("builds a full agents chat response from bridge task result", () => {
		const response = buildAgentsChatResponseFromTaskResult(createSucceededTaskResult());
		expect(response.text).toBe("最终结果正文");
		expect(response.modelAlias).toBe("deepseek-v4-flash");
		expect(response.assets?.[0]).toMatchObject({
			url: "https://cdn.tapcanvas.test/result.png",
			thumbnailUrl: "https://cdn.tapcanvas.test/result-thumb.png",
			title: "主角定妆",
			assetId: "asset-1",
			assetRefId: "hero_ref",
		});
		expect(response.agentDecision).toMatchObject({
			executionKind: "generate",
			canvasAction: "write_canvas",
			assetCount: 1,
		});
		expect(response.trace).toMatchObject({
			requestId: "req-1",
			sessionId: "project:1:conversation:abc",
			outputMode: "direct_assets",
			runtime: {
				profile: "code",
				registeredToolNames: ["Skill", "tapcanvas_flow_patch"],
				loadedSkills: ["tapcanvas"],
				inputProgressionGate: {
					status: "completed",
					model: "deepseek-v4-flash",
					decision: "allow",
					reasonCode: "safe_request",
					reason: "可继续处理",
				},
				contextDiagnostics: {
					totalChars: 1200,
				},
				capabilitySnapshot: {
					exposedToolNames: ["Skill", "tapcanvas_flow_patch"],
				},
				policySummary: {
					requiresApprovalCount: 1,
				},
			},
			turnVerdict: {
				status: "satisfied",
				reasons: ["generated_assets"],
			},
			logicalTaskState: {
				version: 1,
				status: "succeeded",
				reasonCode: "image_delivery_verified",
			},
			expectedDelivery: {
				kind: "image",
			},
			deliveryEvidence: {
				artifacts: [
					expect.objectContaining({
						deliveryState: "materialized",
						assetUrl: "https://cdn.tapcanvas.test/result.png",
					}),
				],
			},
			deliveryVerification: {
				status: "satisfied",
				contractHash: "sha256:image-contract",
			},
		});
	});

	it("binds the public response to the stable logical turn without mutating transport evidence", () => {
		const result = createSucceededTaskResult();
		const response = buildAgentsChatResponseFromTaskResult(result, {
			publicTurnId: "public-chat-turn:stable-1",
		});

		expect(response.trace?.requestId).toBe("public-chat-turn:stable-1");
		expect(
			(result.raw as Record<string, unknown>).meta,
		).toEqual(expect.objectContaining({ requestId: "req-1" }));
	});

	it("projects exact Skill and Knowledge provenance into the public response trace", () => {
		const result = createSucceededTaskResult();
		const meta = (result.raw as { meta: Record<string, unknown> }).meta;
		meta.executionProvenance = {
			version: 1,
			executionId: "execution-1",
			depth: 0,
			model: "gpt-5.6-terra",
			apiStyle: "responses",
			requiredSkills: ["tapcanvas-video-workflow"],
			loadedSkills: ["tapcanvas-video-workflow"],
			loadedSkillSources: [{
				skill: "tapcanvas-video-workflow",
				sourceKind: "skill",
				source: "SKILL.md",
				contentHash: `sha256:${"a".repeat(64)}`,
				contentChars: 1200,
			}],
			loadedKnowledgeSources: [{
				cardId: "cinematic-lighting",
				title: "电影感布光.md",
				domain: "视听语言演出",
				sourceUrls: [],
				contentHash: `sha256:${"b".repeat(64)}`,
				contentChars: 900,
			}],
			startedAt: "2026-08-11T00:00:00.000Z",
		};

		const response = buildAgentsChatResponseFromTaskResult(result);

		expect(response.trace?.executionProvenance).toMatchObject({
			executionId: "execution-1",
			loadedSkillSources: [expect.objectContaining({ source: "SKILL.md" })],
			loadedKnowledgeSources: [expect.objectContaining({ title: "电影感布光.md" })],
		});
	});

	it("preserves audio assets and the full audio delivery trace", () => {
		const result = createSucceededTaskResult();
		result.assets = [
			{
				type: "audio",
				url: "https://cdn.tapcanvas.test/voice.mp3",
				assetId: "audio-asset-1",
				assetName: "角色试听",
			},
		];
		const meta = (result.raw as { meta: Record<string, unknown> }).meta;
		meta.requestTerminal = {
			version: 1,
			terminal: true,
			status: "succeeded",
			reason: "audio_delivery_verified",
		};
		meta.expectedDelivery = {
			active: true,
			kind: "audio",
					source: "agents_cli_tool_trace",
			reason: "explicit_structured_delivery_contract",
			deliveryContract: { kind: "audio", minimumAssetCount: 1 },
			contractHash: "sha256:audio-contract",
		};
		meta.deliveryEvidence = {
			version: 2,
			items: [
				{
					evidenceId: "artifact:audio-node-1",
					kind: "artifact",
					mediaType: "audio",
					sourceRef: "audio-node-1",
					requirementIds: ["audio-materialized"],
					artifactClass: "audio",
					attributes: { assetUrl: "https://cdn.tapcanvas.test/voice.mp3" },
				},
			],
			artifacts: [
				{
					toolCallId: "tool-audio-1",
					toolName: "tapcanvas_audio_generate_to_canvas",
					assetType: "audio",
					deliveryState: "materialized",
					nodeId: "audio-node-1",
					taskId: "audio-task-1",
					runId: null,
					clipIndex: null,
					assetUrl: "https://cdn.tapcanvas.test/voice.mp3",
				},
			],
			assetCount: 1,
			imageAssetCount: 0,
			videoAssetCount: 0,
			wroteCanvas: true,
			generatedAssets: true,
			imageLikeNodeCount: 0,
			preproductionImageLikeNodeCount: 0,
			reusablePreproductionImageLikeNodeCount: 0,
			materializedStoryboardStillCount: 0,
			hasVideoNodes: false,
			hasMaterializedVisualOutputs: false,
			hasPlannedAuthorityBaseFrame: false,
			hasConfirmedAuthorityBaseFrame: false,
			storyboardPlanPersistenceCount: 0,
		};
		meta.deliveryVerification = {
			version: 2,
			contractHash: "sha256:audio-contract",
			status: "satisfied",
			criteria: [
				{
					requirementId: "audio-materialized",
					status: "satisfied",
					evidenceIds: ["artifact:audio-node-1"],
					reason: "A materialized audio URL was reported.",
				},
			],
			verifiedAt: "2026-08-10T01:02:03.000Z",
		};

		const response = buildAgentsChatResponseFromTaskResult(result);

		expect(response.assets).toEqual([
			expect.objectContaining({
				type: "audio",
				url: "https://cdn.tapcanvas.test/voice.mp3",
				title: "角色试听",
				assetId: "audio-asset-1",
			}),
		]);
		expect(response.trace).toMatchObject({
			expectedDelivery: { kind: "audio" },
			deliveryEvidence: {
				artifacts: [
					expect.objectContaining({
						assetType: "audio",
						assetUrl: "https://cdn.tapcanvas.test/voice.mp3",
					}),
				],
			},
			deliveryVerification: {
				status: "satisfied",
				contractHash: "sha256:audio-contract",
			},
		});
	});

	it("returns chat model metadata from bridge result meta", () => {
		const result = createSucceededTaskResult();
		(result.raw as { meta: Record<string, unknown> }).meta.modelKey = "gpt-5.5";
		(result.raw as { meta: Record<string, unknown> }).meta.modelAlias = "gpt-5.5";
		const response = buildAgentsChatResponseFromTaskResult(result);
		expect(response.modelKey).toBe("gpt-5.5");
		expect(response.modelAlias).toBe("gpt-5.5");
	});

	it("preserves external host ownership when unrelated rich diagnostics are malformed", () => {
		const result = createSucceededTaskResult();
		const meta = (result.raw as { meta: Record<string, unknown> }).meta;
		delete meta.outputMode;
		delete meta.toolEvidence;
		delete meta.toolStatusSummary;
		delete meta.canvasPlan;
		delete meta.diagnosticFlags;
		delete meta.turnVerdict;
		meta.diagnosticFlags = "invalid-rich-field";
		meta.requestTerminal = {
			version: 1,
			terminal: true,
			status: "suspended",
			reason: "async_execution_suspended_until_delivery_verified",
		};
		meta.logicalTaskState = createLogicalTaskState(
			"waiting_external",
			"async_execution_suspended_until_delivery_verified",
		);
		meta.continuationRegistration = {
			status: "external_handoff",
			reason: "async_external_host_execution_handoff",
			effectOwner: "host_execution",
			ticketId: "logical-1:task-1:4",
			host: "tanva",
			commandCount: 2,
			runNodeCount: 1,
		};

		const response = buildAgentsChatResponseFromTaskResult(result);

		expect(response.text).toBe("");
		expect(response.trace).toEqual(expect.objectContaining({
			requestId: "req-1",
			logicalTaskState: expect.objectContaining({
				version: 1,
				status: "waiting_external",
				reasonCode: "async_execution_suspended_until_delivery_verified",
			}),
			continuationRegistration: {
				status: "external_handoff",
				reason: "async_external_host_execution_handoff",
				effectOwner: "host_execution",
				ticketId: "logical-1:task-1:4",
				host: "tanva",
				commandCount: 2,
				runNodeCount: 1,
			},
		}));
		expect(response.trace?.outputMode).toBeUndefined();
	});

	it("preserves a valid outputMode when an optional rich trace field is invalid", () => {
		const result = createSucceededTaskResult();
		const meta = (result.raw as { meta: Record<string, unknown> }).meta;
		meta.diagnosticFlags = "invalid-rich-field";
		meta.requestTerminal = {
			version: 1,
			terminal: true,
			status: "suspended",
			reason: "root_physical_execution_budget_exhausted",
		};
		meta.logicalTaskState = createLogicalTaskState(
			"active",
			"root_physical_execution_budget_exhausted",
		);

		const response = buildAgentsChatResponseFromTaskResult(result);

		expect(response.trace?.outputMode).toBe("direct_assets");
		expect(response.trace?.logicalTaskState.status).toBe("active");
	});

	it("does not reconstruct a missing terminal from async delivery evidence", () => {
		const result = createSucceededTaskResult();
		const meta = (result.raw as { meta: Record<string, unknown> }).meta;
		delete meta.requestTerminal;
		delete meta.turnVerdict;
		meta.deliveryEvidence = {
			artifacts: [
				{
					toolCallId: "call-image-batch",
					toolName: "tapcanvas_image_generate_to_canvas",
					assetType: "image",
					deliveryState: "accepted_async",
					nodeId: "image-node-1",
					taskId: "task-image-1",
					assetUrl: null,
				},
			],
		};

		const response = buildAgentsChatResponseFromTaskResult(result);

		expect(response.trace?.logicalTaskState.status).toBe("succeeded");
	});

	it("does not reconstruct a missing terminal from a local verdict", () => {
		const result = createSucceededTaskResult();
		const meta = (result.raw as { meta: Record<string, unknown> }).meta;
		delete meta.requestTerminal;
		meta.turnVerdict = { status: "failed", reasons: ["one_asset_failed"] };
		meta.deliveryEvidence = {
			artifacts: [
				{
					toolCallId: "call-image-batch",
					toolName: "tapcanvas_image_generate_to_canvas",
					assetType: "image",
					deliveryState: "accepted_async",
					nodeId: "image-node-1",
					taskId: "task-image-1",
					assetUrl: null,
				},
			],
		};

		const response = buildAgentsChatResponseFromTaskResult(result);

		expect(response.trace?.logicalTaskState.status).toBe("succeeded");
	});

	it("does not reconstruct a missing terminal from completion diagnostics", () => {
		const result = createSucceededTaskResult();
		const meta = (result.raw as { meta: Record<string, unknown> }).meta;
		delete meta.requestTerminal;
		meta.completionTrace = {
			terminal: "explicit_failure",
			allowFinish: false,
			failureReason: "post_tool_continuation_timeout",
		};

		const response = buildAgentsChatResponseFromTaskResult(result);

		expect(response.trace?.logicalTaskState.status).toBe("succeeded");
	});

	it("keeps a committed logical terminal when legacy terminal diagnostics are absent", () => {
		const result = createSucceededTaskResult();
		const meta = (result.raw as { meta: Record<string, unknown> }).meta;
		delete meta.requestTerminal;
		delete meta.completionTrace;
		delete meta.turnVerdict;

		const response = buildAgentsChatResponseFromTaskResult(result);

		expect(response.trace?.logicalTaskState.status).toBe("succeeded");
	});

	it("does not re-run delivery arbitration after the logical terminal is committed", () => {
		const result = createSucceededTaskResult();
		const meta = (result.raw as { meta: Record<string, unknown> }).meta;
		delete meta.expectedDelivery;
		delete meta.deliveryEvidence;
		delete meta.deliveryVerification;

		const response = buildAgentsChatResponseFromTaskResult(result);

		expect(response.assets).toHaveLength(1);
		expect(response.trace?.logicalTaskState.status).toBe("succeeded");
	});

	it("keeps delivery hash drift diagnostic without overriding logicalTaskState", () => {
		const result = createSucceededTaskResult();
		const meta = (result.raw as { meta: Record<string, unknown> }).meta;
		meta.deliveryVerification = {
			...meta.deliveryVerification as Record<string, unknown>,
			contractHash: "sha256:another-contract",
		};

		const response = buildAgentsChatResponseFromTaskResult(result);

		expect(response.trace?.logicalTaskState.status).toBe("succeeded");
	});

	it("keeps terminal protocol failure independent from malformed diagnostics", () => {
		const result = createSucceededTaskResult();
		const meta = (result.raw as { meta: Record<string, unknown> }).meta;
		delete meta.requestTerminal;
		meta.completionTrace = {
			failureReason: "post_tool_continuation_timeout",
		};
		meta.runtime = { malformed: true };
		meta.turnVerdict = { malformed: true };

		const response = buildAgentsChatResponseFromTaskResult(result);

		expect(response.trace?.logicalTaskState.status).toBe("succeeded");
	});

	it("preserves terminal evidence when another optional diagnostic field is malformed", () => {
		const result = createSucceededTaskResult();
		const meta = (result.raw as { meta: Record<string, unknown> }).meta;
		meta.toolEvidence = { malformed: true };

		const response = buildAgentsChatResponseFromTaskResult(result);

		expect(response.trace?.logicalTaskState.status).toBe("succeeded");
		expect(response.trace?.turnVerdict).toBeDefined();
		expect(response.trace?.toolEvidence).toBeUndefined();
	});

	it("passes pendingUserInput (request_user_input 确认卡) through to the response", () => {
		const result = createSucceededTaskResult();
		(result.raw as Record<string, unknown>).pendingUserInput = {
			status: "needs_input",
			requestId: "rui_test123",
			questions: [
				{
					id: "video_start_confirm",
					header: "确认起跑",
					question: "已完成真实预估（28 秒 · 3 段）。确认起跑吗？",
					options: [
						{ label: "确认起跑", description: "后台出片" },
						{ label: "先不启动" },
					],
				},
			],
		};
		const response = buildAgentsChatResponseFromTaskResult(result);
		expect(response.pendingUserInput).toMatchObject({
			status: "needs_input",
			requestId: "rui_test123",
			questions: [
				expect.objectContaining({
					id: "video_start_confirm",
					options: [
						{ label: "确认起跑", description: "后台出片" },
						{ label: "先不启动" },
					],
				}),
			],
		});
	});

	it("omits pendingUserInput when the bridge result has none", () => {
		const response = buildAgentsChatResponseFromTaskResult(createSucceededTaskResult());
		expect(response.pendingUserInput).toBeUndefined();
	});

	it("persists conversation history and turn ledger from structured response", async () => {
		const result = createSucceededTaskResult();
		const response = buildAgentsChatResponseFromTaskResult(result);
		await persistAgentsChatConversationTurn({
			c: createContext(),
			userId: "user-1",
			requestInput: {
				prompt: "隐式 prompt",
				displayPrompt: "用户真实输入",
				sessionKey: "project:1:conversation:abc",
				mode: "auto",
				forceAssetGeneration: true,
				canvasProjectId: "project-1",
				bookId: "book-1",
				chapterId: "chapter-1",
			},
			response,
			result,
		});

		expect(persistUserConversationTurn).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				userId: "user-1",
				sessionKey: "project:1:conversation:abc",
				userText: "用户真实输入",
				assistantText: "最终结果正文",
			}),
		);
		expect(appendPublicChatTurnRun).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				userId: "user-1",
				sessionKey: "project:1:conversation:abc",
				projectId: "project-1",
				bookId: "book-1",
				chapterId: "chapter-1",
				workflowKey: "public_chat.asset_forced",
				outputMode: "direct_assets",
				turnVerdict: "satisfied",
				assetCount: 1,
				canvasWrite: true,
			}),
		);
	});

	it("records a silent continuation window without writing synthetic chat messages", async () => {
		const result = createSucceededTaskResult();
		const response = buildAgentsChatResponseFromTaskResult(result);
		await persistAgentsChatConversationTurn({
			c: createContext(),
			userId: "user-1",
			requestInput: {
				prompt: "服务器生成的 continuation prompt",
				sessionKey: "project:1:conversation:abc",
				canvasProjectId: "project-1",
			},
			response,
			result,
			publicationMode: "silent",
		});

		expect(persistUserConversationTurn).not.toHaveBeenCalled();
		expect(resolveOrCreatePublicChatSession).toHaveBeenCalledTimes(1);
		expect(appendPublicChatTurnRun).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				userMessageId: null,
				assistantMessageId: null,
			}),
		);
	});

	it("publishes a terminal continuation as assistant-only conversation output", async () => {
		const result = createSucceededTaskResult();
		const response = buildAgentsChatResponseFromTaskResult(result);
		await persistAgentsChatConversationTurn({
			c: createContext(),
			userId: "user-1",
			requestInput: {
				prompt: "服务器生成的 continuation prompt",
				sessionKey: "project:1:conversation:abc",
				canvasProjectId: "project-1",
			},
			response,
			result,
			publicationId: "continuation:root-1:attempt-2",
			publicationMode: "assistant_only",
		});

		expect(persistUserConversationTurn).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				turnId: "continuation:root-1:attempt-2",
				userText: "",
				assistantText: "最终结果正文",
			}),
		);
	});

	it("persists an interrupted run with all three correlation identities", async () => {
		await persistInterruptedAgentsChatRun({
			c: createContext(),
			userId: "user-1",
			requestInput: {
				prompt: "执行当前任务",
				clientPendingId: "m_ai_pending_1786157917837",
				sessionKey: "project:1:conversation:abc",
				modelKey: "gpt-5.6-terra",
				canvasProjectId: "project-1",
			},
			publicTurnId: "turn_public_1",
			reasonCode: "chat_turn_user_interrupt",
			runMs: 619_535,
		});

		expect(resolveOrCreatePublicChatSession).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				userId: "user-1",
				sessionKey: "project:1:conversation:abc",
			}),
		);
		expect(appendPublicChatTurnRun).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				requestId: "turn_public_1",
				assistantMessageId: "m_ai_pending_1786157917837",
				turnVerdict: "failed",
				runOutcome: "discard",
				outputMode: "interrupted",
				runMs: 619_535,
			}),
		);
	});
});
