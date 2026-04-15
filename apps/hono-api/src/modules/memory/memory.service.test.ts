import { describe, expect, it } from "vitest";
import { formatMemoryContextForPrompt } from "./memory.service";
import type { MemoryContextResult } from "./memory.repo";

function createMemoryContext(): MemoryContextResult {
	return {
		userPreferences: [],
		projectFacts: [
			{
				id: "project-fact-1",
				scopeType: "project",
				scopeId: "project-1",
				memoryType: "domain_fact",
				title: "project fact",
				summaryText: "项目已绑定当前用户",
				content: { fact: "project-bound" },
				importance: 0.9,
				status: "active",
				createdAt: "2026-03-24T00:00:00.000Z",
				updatedAt: "2026-03-24T00:00:00.000Z",
			},
		],
		bookFacts: [],
		chapterFacts: [],
		artifactRefs: [],
		rollups: {
			user: [],
			project: [],
			book: [],
			chapter: [],
			session: [
				{
					id: "session-rollup-1",
					scopeType: "session",
					scopeId: "project:project-1:flow:flow-1",
					memoryType: "summary",
					title: "session rollup",
					summaryText: "用户最近请求：能读到当前项目吗",
					content: { kind: "conversation_rollup" },
					importance: 0.88,
					status: "active",
					createdAt: "2026-03-24T00:00:00.000Z",
					updatedAt: "2026-03-24T00:00:00.000Z",
				},
			],
		},
		recentConversation: [
			{
				role: "assistant",
				content: "已验证项目级接口会报：projectId 不在 bridge 授权白名单内",
				assets: [],
				createdAt: "2026-03-24T00:00:00.000Z",
			},
		],
	};
}

describe("formatMemoryContextForPrompt", () => {
	it("demotes session history to background-only context", () => {
		const prompt = formatMemoryContextForPrompt(createMemoryContext());
		expect(prompt).toContain("Session Rollups (Background Only)");
		expect(prompt).toContain("Recent Conversation (Background Only)");
		expect(prompt).toContain("assistant 历史输出可能过期、出错或已被后续回合推翻");
		expect(prompt).toContain("Project Facts");
		expect(prompt).not.toContain("仅将其视为已确认事实来源");
	});
});
