import { describe, expect, it } from "vitest";
import { AgentsChatRequestSchema } from "./apiKey.schemas";

describe("AgentsChatRequestSchema", () => {
	it("accepts single_video chat context with selected reference metadata", () => {
		const parsed = AgentsChatRequestSchema.parse({
			prompt: "帮我快捷创作一个单视频",
			chatContext: {
				currentProjectName: "项目A",
				selectedNodeLabel: "已确认关键帧",
				selectedNodeKind: "image",
				selectedReference: {
					nodeId: "node-1",
					label: "已确认关键帧",
					kind: "image",
					anchorBindings: [
						{
							kind: "character",
							refId: "card-1",
							label: "方源",
							imageUrl: "https://example.com/role.png",
							referenceView: "three_view",
						},
					],
					imageUrl: "https://example.com/keyframe.png",
					sourceUrl: "/project-data/books/book-1/chapter-1.md",
					bookId: "book-1",
					chapterId: "chapter-1",
					shotNo: 7,
					productionLayer: "anchors",
					creationStage: "shot_anchor_lock",
					approvalStatus: "approved",
				},
			},
		});

		expect(parsed.chatContext?.selectedReference?.shotNo).toBe(7);
		expect(parsed.chatContext?.selectedReference?.anchorBindings?.[0]).toMatchObject({
			kind: "character",
			refId: "card-1",
			label: "方源",
		});
		expect(parsed.chatContext?.selectedReference?.productionLayer).toBe("anchors");
		expect(parsed.chatContext?.selectedReference?.creationStage).toBe("shot_anchor_lock");
		expect(parsed.chatContext?.selectedReference?.approvalStatus).toBe("approved");
	});

	it("accepts thin generation contract payload", () => {
		const parsed = AgentsChatRequestSchema.parse({
			prompt: "继续基于当前关键帧生成",
			generationContract: {
				version: "v1",
				lockedAnchors: ["角色外观", "机位构图"],
				editableVariable: "环境光线",
				forbiddenChanges: ["禁止换脸", "禁止改机位"],
				approvedKeyframeId: "keyframe-7",
			},
		});

		expect(parsed.generationContract).toEqual({
			version: "v1",
			lockedAnchors: ["角色外观", "机位构图"],
			editableVariable: "环境光线",
			forbiddenChanges: ["禁止换脸", "禁止改机位"],
			approvedKeyframeId: "keyframe-7",
		});
	});

	it("accepts named asset inputs for stable @ references", () => {
		const parsed = AgentsChatRequestSchema.parse({
			prompt: "基于角色卡继续出图",
			assetInputs: [
				{
					assetId: "asset-1",
					assetRefId: "hero_ref",
					url: "https://example.com/hero.png",
					role: "character",
					note: "保持主角造型",
					name: "女主角色卡",
				},
			],
		});

		expect(parsed.assetInputs?.[0]).toMatchObject({
			assetId: "asset-1",
			assetRefId: "hero_ref",
			url: "https://example.com/hero.png",
			role: "character",
			note: "保持主角造型",
			name: "女主角色卡",
		});
	});

	it("rejects unsupported generation contract keys", () => {
		expect(() =>
			AgentsChatRequestSchema.parse({
				prompt: "继续生成",
				generationContract: {
					version: "v1",
					lockedAnchors: ["角色外观"],
					editableVariable: null,
					forbiddenChanges: [],
					approvedKeyframeId: null,
					motionBudget: "fast",
				},
			}),
		).toThrow();
	});
});
