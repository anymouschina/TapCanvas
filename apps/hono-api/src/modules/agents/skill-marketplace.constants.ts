import { z } from "zod";

export const SKILL_MARKETPLACE_CATEGORIES = [
	"图像创作",
	"视频创作",
	"音频配音",
	"文案脚本",
	"故事小说",
	"角色设定",
	"电商营销",
	"社媒运营",
	"效率工具",
	"其他",
] as const;

export const SkillMarketplaceCategorySchema = z.enum(SKILL_MARKETPLACE_CATEGORIES);

export type SkillMarketplaceCategory = z.infer<typeof SkillMarketplaceCategorySchema>;
