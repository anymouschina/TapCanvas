// apps/hono-api/src/modules/ai/pipeline-contracts.ts
import { z } from "zod";

// ── 角色契约 ─────────────────────────────────────────────────────────────────

export const CharacterCardOutputSchema = z.object({
	name: z.string().min(1).describe("角色标识名（与原著保持一致）"),
	staticTraits: z
		.string()
		.min(1)
		.describe("永久外貌特征：面部、体型等（跨镜不变）"),
	dynamicTraits: z
		.string()
		.min(1)
		.describe("可变外貌特征：服装、配饰等（场景可变）"),
	voiceStyle: z.string().optional().describe("语音风格/语气描述"),
});
export type CharacterCardOutput = z.infer<typeof CharacterCardOutputSchema>;

// ── 分镜契约 ─────────────────────────────────────────────────────────────────

export const StoryboardShotSchema = z.object({
	idx: z.number().int().min(0).describe("镜头序号，从 0 开始"),
	description: z.string().min(1).describe("可拍摄的客观视觉描述"),
	characterRefs: z
		.array(z.string())
		.describe("本镜出现的角色名列表"),
	sceneType: z
		.enum(["wide", "medium", "close-up", "extreme-close-up", "aerial", "pov"])
		.describe("景别"),
	audioDesc: z.string().optional().describe("台词/音效描述"),
});
export type StoryboardShot = z.infer<typeof StoryboardShotSchema>;

export const StoryboardParseOutputSchema = z
	.object({
		shots: z.array(StoryboardShotSchema).min(1),
		totalShots: z.number().int().min(1),
	})
	.refine((v) => v.totalShots === v.shots.length, {
		message: "totalShots must equal shots.length",
		path: ["totalShots"],
	});
export type StoryboardParseOutput = z.infer<typeof StoryboardParseOutputSchema>;

// ── 小节契约 ─────────────────────────────────────────────────────────────────

export const ChapterSectionOutputSchema = z.object({
	idx: z.number().int().min(0).describe("小节序号"),
	title: z.string(),
	body: z.string().min(1).describe("正文内容"),
	continuityHints: z
		.array(z.string())
		.describe("与相邻小节的连续性注记（人物、地点、时间线）"),
});
export type ChapterSectionOutput = z.infer<typeof ChapterSectionOutputSchema>;

// ── 小说→剧本契约 ─────────────────────────────────────────────────────────────

export const NovelToScriptOutputSchema = z.object({
	scenes: z.array(
		z.object({
			idx: z.number().int().min(0),
			environment: z.string().describe("场景环境描述"),
			script: z.string().min(1).describe("标准剧本格式，角色名用 <> 括起"),
			isLast: z.boolean(),
		}),
	),
	characters: z.array(CharacterCardOutputSchema),
	globalConstraints: z
		.string()
		.optional()
		.describe("风格/基调/设定约束"),
});
export type NovelToScriptOutput = z.infer<typeof NovelToScriptOutputSchema>;

// ── 通用禁止清单（注入 prompt 用）────────────────────────────────────────────

export const COMMON_OUTPUT_CONSTRAINTS = `
## OUTPUT CONSTRAINTS
- MUST output valid JSON matching the provided schema — no prose wrapping
- NEVER omit required fields; use "" or [] instead of null for required fields
- NEVER wrap JSON in markdown code blocks (\`\`\`json ... \`\`\`)
- NEVER add explanations or commentary outside the JSON
- NEVER use metaphors, similes, or abstract descriptions in visual fields
- NEVER use future/progressive tense for static frame descriptions (use present-state snapshots)
`.trim();

export const STORYBOARD_EXTRA_CONSTRAINTS = `
- NEVER write camera movement instructions inside shot descriptions (dolly, pan etc. belong in motion_desc only)
- NEVER use voiceover format; use dialogue with "" symbols
- NEVER reference shot numbers in description text
`.trim();

export const CHARACTER_EXTRA_CONSTRAINTS = `
- NEVER invent characters not present in the source material
- staticTraits MUST describe objective visible features only, no personality traits
`.trim();
