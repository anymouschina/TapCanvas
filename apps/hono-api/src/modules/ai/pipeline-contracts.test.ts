// apps/hono-api/src/modules/ai/pipeline-contracts.test.ts
import { describe, it, expect } from "vitest";
import {
	CharacterCardOutputSchema,
	StoryboardParseOutputSchema,
	ChapterSectionOutputSchema,
	NovelToScriptOutputSchema,
} from "./pipeline-contracts";

describe("CharacterCardOutputSchema", () => {
	it("accepts valid character", () => {
		const result = CharacterCardOutputSchema.safeParse({
			name: "Alice",
			staticTraits: "长金发，蓝眼睛，苗条",
			dynamicTraits: "红色连衣裙",
		});
		expect(result.success).toBe(true);
	});

	it("rejects missing name", () => {
		const result = CharacterCardOutputSchema.safeParse({
			name: "",
			staticTraits: "long hair",
			dynamicTraits: "blue dress",
		});
		expect(result.success).toBe(false);
	});

	it("rejects missing staticTraits", () => {
		const result = CharacterCardOutputSchema.safeParse({
			name: "Alice",
			staticTraits: "",
			dynamicTraits: "blue dress",
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty dynamicTraits", () => {
		const result = CharacterCardOutputSchema.safeParse({
			name: "Alice",
			staticTraits: "long hair",
			dynamicTraits: "",
		});
		expect(result.success).toBe(false);
	});
});

describe("StoryboardParseOutputSchema", () => {
	it("accepts valid storyboard output", () => {
		const result = StoryboardParseOutputSchema.safeParse({
			shots: [
				{
					idx: 0,
					description: "Wide shot of empty street at dusk",
					characterRefs: ["Alice"],
					sceneType: "wide",
				},
			],
			totalShots: 1,
		});
		expect(result.success).toBe(true);
	});

	it("rejects empty shots array", () => {
		const result = StoryboardParseOutputSchema.safeParse({
			shots: [],
			totalShots: 0,
		});
		expect(result.success).toBe(false);
	});

	it("rejects invalid sceneType", () => {
		const result = StoryboardParseOutputSchema.safeParse({
			shots: [
				{
					idx: 0,
					description: "A shot",
					characterRefs: [],
					sceneType: "macro",
				},
			],
			totalShots: 1,
		});
		expect(result.success).toBe(false);
	});

	it("rejects totalShots mismatch", () => {
		const result = StoryboardParseOutputSchema.safeParse({
			shots: [{ idx: 0, description: "A shot", characterRefs: [], sceneType: "wide" }],
			totalShots: 2,
		});
		expect(result.success).toBe(false);
	});
});

describe("ChapterSectionOutputSchema", () => {
	it("accepts valid section", () => {
		const result = ChapterSectionOutputSchema.safeParse({
			idx: 0,
			title: "序章",
			body: "正文内容...",
			continuityHints: ["Alice 此时在咖啡馆"],
		});
		expect(result.success).toBe(true);
	});

	it("rejects empty body", () => {
		const result = ChapterSectionOutputSchema.safeParse({
			idx: 0,
			title: "序章",
			body: "",
			continuityHints: [],
		});
		expect(result.success).toBe(false);
	});
});

describe("NovelToScriptOutputSchema", () => {
	it("accepts minimal valid output", () => {
		const result = NovelToScriptOutputSchema.safeParse({
			scenes: [
				{
					idx: 0,
					environment: "城市街道，黄昏",
					script: "<Alice>: 你好。",
					isLast: true,
				},
			],
			characters: [
				{
					name: "Alice",
					staticTraits: "长发",
					dynamicTraits: "红色外套",
				},
			],
		});
		expect(result.success).toBe(true);
	});
});
