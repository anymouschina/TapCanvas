import { describe, expect, it } from "vitest";

import { normalizePublicChatSessionKey } from "./public-chat-session.repo";
import {
	detectPublicTaskAssetHostingGap,
	derivePublicChatRunOutcome,
	derivePublicChatWorkflowKey,
	normalizePublicChatAgentStreamEvent,
	resolvePublicChatStreamSessionId,
} from "./apiKey.routes";

describe("agents chat stream helpers", () => {
	it("derives deterministic project session ids when explicit sessionKey is missing", () => {
		expect(
			resolvePublicChatStreamSessionId({
				canvasProjectId: "project-1",
				canvasFlowId: "flow-9",
			}),
		).toBe("project:project-1:flow:flow-9");
		expect(
			resolvePublicChatStreamSessionId({
				sessionKey: "chat:explicit",
				canvasProjectId: "project-1",
				canvasFlowId: "flow-9",
			}),
		).toBe("chat:explicit");
	});

	it("keeps long structured session keys instead of truncating them to 120 chars", () => {
		const sessionKey =
			"project:5b42c647-dd90-475e-9e74-06034e9a4a23:flow:8d73cee2-78ca-4e2a-914f-4dfd7ef50d38:conversation:canvas-mn9i7yl7-pm3fv2a9:lane:general:skill:default";
		expect(sessionKey.length).toBeGreaterThan(120);
		expect(normalizePublicChatSessionKey(sessionKey)).toBe(sessionKey);
	});

	it("forwards canonical content/tool/todo_list events", () => {
		expect(
			normalizePublicChatAgentStreamEvent({
				event: "content",
				data: { delta: "你好" },
			}),
		).toEqual({
			event: "content",
			data: { delta: "你好" },
		});
		expect(
			normalizePublicChatAgentStreamEvent({
				event: "tool",
				data: { toolName: "TodoWrite", phase: "started" },
			}),
		).toEqual({
			event: "tool",
			data: { toolName: "TodoWrite", phase: "started" },
		});
		expect(
			normalizePublicChatAgentStreamEvent({
				event: "todo_list",
				data: {
					sourceToolCallId: "tool_1",
					items: [{ text: "补全角色卡", completed: false, status: "in_progress" }],
					totalCount: 1,
					completedCount: 0,
					inProgressCount: 1,
				},
			}),
		).toEqual({
			event: "todo_list",
			data: {
				sourceToolCallId: "tool_1",
				items: [{ text: "补全角色卡", completed: false, status: "in_progress" }],
				totalCount: 1,
				completedCount: 0,
				inProgressCount: 1,
			},
		});
		expect(
			normalizePublicChatAgentStreamEvent({
				event: "thread.started",
				data: { threadId: "thread_1" },
			}),
		).toBeNull();
		expect(
			normalizePublicChatAgentStreamEvent({
				event: "result",
				data: { response: {} },
			}),
		).toBeNull();
	});

	it("derives stable workflow keys from structured agents chat context", () => {
		expect(
			derivePublicChatWorkflowKey({
				mode: "auto",
			}),
		).toBe("public_chat.auto");
		expect(
			derivePublicChatWorkflowKey({
				forceAssetGeneration: true,
			}),
		).toBe("public_chat.asset_forced");
		expect(
			derivePublicChatWorkflowKey({
				planOnly: true,
			}),
		).toBe("public_chat.plan_only");
		expect(
			derivePublicChatWorkflowKey({
				mode: "chat",
			}),
		).toBe("public_chat.chat");
		expect(derivePublicChatWorkflowKey({})).toBe("public_chat.chat");
	});

	it("derives promote hold discard outcomes from verdict and side effects", () => {
		expect(
			derivePublicChatRunOutcome({
				turnVerdict: "failed",
				assetCount: 3,
				canvasWrite: true,
			}),
		).toBe("discard");
		expect(
			derivePublicChatRunOutcome({
				turnVerdict: "partial",
				assetCount: 1,
				canvasWrite: false,
			}),
		).toBe("hold");
		expect(
			derivePublicChatRunOutcome({
				turnVerdict: "satisfied",
				assetCount: 2,
				canvasWrite: false,
			}),
		).toBe("promote");
		expect(
			derivePublicChatRunOutcome({
				turnVerdict: "satisfied",
				assetCount: 0,
				canvasWrite: false,
			}),
		).toBe("hold");
	});

	it("detects when public task sanitization hides unhosted inline assets", () => {
		expect(
			detectPublicTaskAssetHostingGap({
				originalResult: {
					status: "succeeded",
					assets: [
						{
							type: "image",
							url: "data:image/png;base64,abcd",
							thumbnailUrl: null,
						},
					],
					raw: {
						hosting: { status: "pending", mode: "async" },
					},
				},
				sanitizedResult: {
					status: "succeeded",
					assets: [],
					raw: {
						hosting: { status: "pending", mode: "async" },
					},
				},
			}),
		).toEqual({
			originalAssetCount: 1,
			inlineAssetCount: 1,
			hosting: { status: "pending", mode: "async" },
		});
	});

	it("ignores public task sanitization when at least one hosted asset remains", () => {
		expect(
			detectPublicTaskAssetHostingGap({
				originalResult: {
					status: "succeeded",
					assets: [
						{
							type: "image",
							url: "data:image/png;base64,abcd",
							thumbnailUrl: null,
						},
						{
							type: "image",
							url: "https://file.example.com/gen/images/1.png",
							thumbnailUrl: null,
						},
					],
				},
				sanitizedResult: {
					status: "succeeded",
					assets: [
						{
							type: "image",
							url: "https://file.example.com/gen/images/1.png",
							thumbnailUrl: null,
						},
					],
				},
			}),
		).toBeNull();
	});
});
