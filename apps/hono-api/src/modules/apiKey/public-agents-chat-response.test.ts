import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";
import type { TaskResultDto } from "../task/task.schemas";

const { persistUserConversationTurn, appendPublicChatTurnRun } = vi.hoisted(() => ({
	persistUserConversationTurn: vi.fn(),
	appendPublicChatTurnRun: vi.fn(),
}));

vi.mock("../memory/memory.service", () => ({
	persistUserConversationTurn,
}));

vi.mock("./public-chat-session.repo", () => ({
	appendPublicChatTurnRun,
}));

import {
	buildAgentsChatResponseFromTaskResult,
	persistAgentsChatConversationTurn,
} from "./public-agents-chat-response";

function createContext(): AppContext {
	return {
		env: {
			DB: {},
		} as unknown as AppContext["env"],
	} as AppContext;
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
				requestId: "req-1",
				sessionId: "project:1:conversation:abc",
				outputMode: "direct_assets",
				toolEvidence: {
					toolNames: ["generate_image_to_canvas"],
					readProjectState: true,
					readBookList: false,
					readBookIndex: false,
					readChapter: false,
					readStoryboardHistory: false,
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
	});

	it("builds a full agents chat response from bridge task result", () => {
		const response = buildAgentsChatResponseFromTaskResult(createSucceededTaskResult());
		expect(response.text).toBe("最终结果正文");
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
		});
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
});
