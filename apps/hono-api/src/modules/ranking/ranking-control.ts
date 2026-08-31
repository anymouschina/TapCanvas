import { z } from "zod";
import { AppError } from "../../middleware/error";
import { getPrismaClient } from "../../platform/node/prisma";
import type { AppContext } from "../../types";
import { createAssetRow, getGlobalAssetByName } from "../asset/asset.repo";
import { getPersonalBillingTeamId } from "../team/team.service";

const RANKING_ASSET_NAME = "rankingControl";
const HOMEPAGE_VIDEO_MODERATION_ASSET_NAME = "homepageVideoModeration";
const RANKING_VERSION = 1 as const;

export const RankingItemControlSchema = z.object({
	manualBoost: z.number().int().min(-10_000).max(10_000),
	recommended: z.boolean(),
	pinned: z.boolean(),
	displayOrder: z.number().int().min(-10_000).max(10_000),
}).strict();

export type RankingItemControl = z.infer<typeof RankingItemControlSchema>;

export const SkillRankingConfigSchema = z.object({
	purchaseWeight: z.number().min(0).max(100),
	freshnessWeight: z.number().min(0).max(100),
	freshnessHalfLifeDays: z.number().min(1).max(3650),
	items: z.record(z.string(), RankingItemControlSchema),
}).strict();

export const HomepageVideoRankingConfigSchema = z.object({
	engagementWeight: z.number().min(0).max(100),
	freshnessWeight: z.number().min(0).max(100),
	freshnessHalfLifeDays: z.number().min(1).max(3650),
	items: z.record(z.string(), RankingItemControlSchema),
}).strict();

export type SkillRankingConfig = z.infer<typeof SkillRankingConfigSchema>;
export type HomepageVideoRankingConfig = z.infer<typeof HomepageVideoRankingConfigSchema>;

export const HomepageVideoModerationConfigSchema = z.object({
	kind: z.literal("homepageVideoModeration"),
	version: z.literal(1),
	blockedAssetIds: z.array(z.string().min(1)).max(10_000),
}).strict();

export type HomepageVideoModerationConfig = z.infer<typeof HomepageVideoModerationConfigSchema>;

const RankingControlSchema = z.object({
	kind: z.literal("rankingControl"),
	version: z.literal(RANKING_VERSION),
	surfaces: z.object({
		skillMarketplace: SkillRankingConfigSchema,
		homepageVideos: HomepageVideoRankingConfigSchema,
	}).strict(),
}).strict();

type RankingControl = z.infer<typeof RankingControlSchema>;

export const DEFAULT_SKILL_RANKING_CONFIG: SkillRankingConfig = {
	purchaseWeight: 70,
	freshnessWeight: 30,
	freshnessHalfLifeDays: 90,
	items: {},
};

export const DEFAULT_HOMEPAGE_VIDEO_RANKING_CONFIG: HomepageVideoRankingConfig = {
	engagementWeight: 70,
	freshnessWeight: 30,
	freshnessHalfLifeDays: 30,
	items: {},
};

export const EMPTY_HOMEPAGE_VIDEO_MODERATION_CONFIG: HomepageVideoModerationConfig = {
	kind: "homepageVideoModeration",
	version: 1,
	blockedAssetIds: [],
};

export function filterHomepageModeratedAssets<T extends { id: string }>(
	items: readonly T[],
	blockedAssetIds: ReadonlySet<string>,
	homepageSurface: boolean,
): T[] {
	return homepageSurface
		? items.filter((item) => !blockedAssetIds.has(item.id))
		: [...items];
}

function createInitialRankingControl(): RankingControl {
	return {
		kind: "rankingControl",
		version: RANKING_VERSION,
		surfaces: {
			skillMarketplace: DEFAULT_SKILL_RANKING_CONFIG,
			homepageVideos: DEFAULT_HOMEPAGE_VIDEO_RANKING_CONFIG,
		},
	};
}

async function readRankingControl(): Promise<{ configured: boolean; value: RankingControl }> {
	const row = await getGlobalAssetByName(RANKING_ASSET_NAME);
	if (!row) return { configured: false, value: createInitialRankingControl() };
	let raw: unknown;
	try {
		raw = JSON.parse(row.data || "null");
	} catch (error: unknown) {
		throw new AppError("排行榜配置 JSON 无法解析", {
			status: 500,
			code: "ranking_control_json_invalid",
			details: { assetId: row.id, cause: error instanceof Error ? error.message : String(error) },
		});
	}
	const parsed = RankingControlSchema.safeParse(raw);
	if (!parsed.success) {
		throw new AppError("排行榜配置结构无效", {
			status: 500,
			code: "ranking_control_schema_invalid",
			details: { assetId: row.id, issues: parsed.error.issues },
		});
	}
	return { configured: true, value: parsed.data };
}

async function writeRankingControl(c: AppContext, actorUserId: string, value: RankingControl): Promise<void> {
	const parsed = RankingControlSchema.parse(value);
	const current = await getGlobalAssetByName(RANKING_ASSET_NAME);
	if (!current) {
		await createAssetRow(c.env.DB, actorUserId, { name: RANKING_ASSET_NAME, data: parsed }, new Date().toISOString());
		return;
	}
	await getPrismaClient().assets.update({
		where: { id: current.id },
		data: { data: JSON.stringify(parsed), updated_at: new Date().toISOString() },
	});
}

export async function getSkillRankingConfig(): Promise<{ configured: boolean; config: SkillRankingConfig }> {
	const current = await readRankingControl();
	return { configured: current.configured, config: current.value.surfaces.skillMarketplace };
}

export async function saveSkillRankingConfig(
	c: AppContext,
	actorUserId: string,
	config: SkillRankingConfig,
): Promise<SkillRankingConfig> {
	const current = await readRankingControl();
	const next = {
		...current.value,
		surfaces: { ...current.value.surfaces, skillMarketplace: SkillRankingConfigSchema.parse(config) },
	};
	await writeRankingControl(c, actorUserId, next);
	return next.surfaces.skillMarketplace;
}

export async function getHomepageVideoRankingConfig(): Promise<{ configured: boolean; config: HomepageVideoRankingConfig }> {
	const current = await readRankingControl();
	return { configured: current.configured, config: current.value.surfaces.homepageVideos };
}

export async function saveHomepageVideoRankingConfig(
	c: AppContext,
	actorUserId: string,
	config: HomepageVideoRankingConfig,
): Promise<HomepageVideoRankingConfig> {
	const current = await readRankingControl();
	const next = {
		...current.value,
		surfaces: { ...current.value.surfaces, homepageVideos: HomepageVideoRankingConfigSchema.parse(config) },
	};
	await writeRankingControl(c, actorUserId, next);
	return next.surfaces.homepageVideos;
}

export async function getHomepageVideoModerationConfig(): Promise<{
	configured: boolean;
	config: HomepageVideoModerationConfig;
}> {
	const row = await getGlobalAssetByName(HOMEPAGE_VIDEO_MODERATION_ASSET_NAME);
	if (!row) return { configured: false, config: EMPTY_HOMEPAGE_VIDEO_MODERATION_CONFIG };

	let raw: unknown;
	try {
		raw = JSON.parse(row.data || "null");
	} catch (error: unknown) {
		throw new AppError("首页作品拉黑配置 JSON 无法解析", {
			status: 500,
			code: "homepage_video_moderation_json_invalid",
			details: { assetId: row.id, cause: error instanceof Error ? error.message : String(error) },
		});
	}
	const parsed = HomepageVideoModerationConfigSchema.safeParse(raw);
	if (!parsed.success) {
		throw new AppError("首页作品拉黑配置结构无效", {
			status: 500,
			code: "homepage_video_moderation_schema_invalid",
			details: { assetId: row.id, issues: parsed.error.issues },
		});
	}
	return { configured: true, config: parsed.data };
}

export async function saveHomepageVideoModerationConfig(
	c: AppContext,
	actorUserId: string,
	config: HomepageVideoModerationConfig,
): Promise<HomepageVideoModerationConfig> {
	const parsed = HomepageVideoModerationConfigSchema.parse(config);
	const current = await getGlobalAssetByName(HOMEPAGE_VIDEO_MODERATION_ASSET_NAME);
	if (!current) {
		await createAssetRow(c.env.DB, actorUserId, {
			name: HOMEPAGE_VIDEO_MODERATION_ASSET_NAME,
			data: parsed,
		}, new Date().toISOString());
		return parsed;
	}
	await getPrismaClient().assets.update({
		where: { id: current.id },
		data: { data: JSON.stringify(parsed), updated_at: new Date().toISOString() },
	});
	return parsed;
}

type RankingCandidate = {
	id: string;
	metric: number;
	createdAt: string;
};

export type RankingResult = {
	id: string;
	algorithmScore: number;
	manualBoost: number;
	effectiveScore: number;
	recommended: boolean;
	pinned: boolean;
	displayOrder: number;
	rank: number;
};

export function countSkillPromptCharacters(content: string): number {
	return Array.from(content).length;
}

function roundScore(value: number): number {
	return Math.round(value * 100) / 100;
}

export function calculateRanking(
	candidates: readonly RankingCandidate[],
	input: {
		metricWeight: number;
		freshnessWeight: number;
		freshnessHalfLifeDays: number;
		items: Record<string, RankingItemControl>;
		nowMs?: number;
	},
): RankingResult[] {
	const nowMs = input.nowMs ?? Date.now();
	const maxMetric = candidates.reduce((maximum, candidate) => Math.max(maximum, Math.max(0, candidate.metric)), 0);
	const weightTotal = input.metricWeight + input.freshnessWeight;
	const metricRatio = weightTotal > 0 ? input.metricWeight / weightTotal : 0;
	const freshnessRatio = weightTotal > 0 ? input.freshnessWeight / weightTotal : 0;
	const metricDenominator = Math.log1p(maxMetric);
	const ranked = candidates.map((candidate) => {
		const control = input.items[candidate.id] ?? {
			manualBoost: 0,
			recommended: false,
			pinned: false,
			displayOrder: 0,
		};
		const createdAtMs = Date.parse(candidate.createdAt);
		const ageDays = Number.isFinite(createdAtMs) ? Math.max(0, (nowMs - createdAtMs) / 86_400_000) : 0;
		const metricScore = metricDenominator > 0 ? Math.log1p(Math.max(0, candidate.metric)) / metricDenominator : 0;
		const freshnessScore = Math.pow(0.5, ageDays / input.freshnessHalfLifeDays);
		const algorithmScore = 100 * (metricScore * metricRatio + freshnessScore * freshnessRatio);
		const effectiveScore = algorithmScore
			+ control.manualBoost
			+ (control.recommended ? 10_000 : 0)
			+ (control.pinned ? 100_000 : 0);
		return {
			id: candidate.id,
			algorithmScore: roundScore(algorithmScore),
			manualBoost: control.manualBoost,
			effectiveScore: roundScore(effectiveScore),
			recommended: control.recommended,
			pinned: control.pinned,
			displayOrder: control.displayOrder,
			rank: 0,
		};
	});
	ranked.sort((left, right) =>
		right.effectiveScore - left.effectiveScore
		|| left.displayOrder - right.displayOrder
		|| left.id.localeCompare(right.id),
	);
	return ranked.map((item, index) => ({ ...item, rank: index + 1 }));
}

const OfficialSkillLicenseConfigSchema = z.object({
	sourceType: z.literal("official"),
	skillId: z.string().min(1),
}).passthrough();

const UserAssetSkillLicenseConfigSchema = z.object({
	sourceType: z.literal("user_asset"),
	skillId: z.string().min(1),
	skillName: z.string().min(1),
	description: z.string().nullable(),
	logoUrl: z.string().url().nullable().optional(),
	sellerUserId: z.string().min(1),
	sourceAssetId: z.string().min(1),
	createdAt: z.string().min(1),
	category: z.string().min(1),
}).passthrough();

const SkillLicenseConfigSchema = z.discriminatedUnion("sourceType", [
	OfficialSkillLicenseConfigSchema,
	UserAssetSkillLicenseConfigSchema,
]);

type SkillLicenseConfig = z.infer<typeof SkillLicenseConfigSchema>;

export function parseSkillLicenseConfig(configJson: string | null, productId: string): SkillLicenseConfig {
	let rawConfig: unknown;
	try {
		rawConfig = JSON.parse(configJson || "null");
	} catch (error: unknown) {
		throw new AppError("Skill 商品权益配置 JSON 无法解析", {
			status: 500,
			code: "skill_license_config_json_invalid",
			details: { productId, cause: error instanceof Error ? error.message : String(error) },
		});
	}
	const parsed = SkillLicenseConfigSchema.safeParse(rawConfig);
	if (!parsed.success) {
		throw new AppError("Skill 商品权益配置结构无效", {
			status: 500,
			code: "skill_license_config_schema_invalid",
			details: { productId, issues: parsed.error.issues },
		});
	}
	return parsed.data;
}

export const SkillMarketplaceItemSchema = z.object({
	skill: z.object({
		id: z.string(),
		key: z.string(),
		name: z.string(),
		description: z.string().nullable(),
		logoUrl: z.string().url().nullable(),
		category: z.string(),
		enabled: z.boolean(),
		visible: z.boolean(),
		sortOrder: z.number().int().nullable(),
		createdAt: z.string(),
		updatedAt: z.string(),
	}),
	productId: z.string().nullable(),
	priceCredits: z.number().int().positive().nullable(),
	purchasable: z.boolean(),
	owned: z.boolean(),
	sourceType: z.enum(["official", "user_asset"]),
	sellerUserId: z.string().nullable(),
	sellerName: z.string().nullable(),
	sizeBytes: z.number().int().nonnegative().nullable(),
	promptCharacterCount: z.number().int().nonnegative(),
	listedAt: z.string().nullable(),
	realPurchaseCount: z.number().int().nonnegative(),
	algorithmScore: z.number(),
	manualBoost: z.number().int(),
	effectiveScore: z.number(),
	recommended: z.boolean(),
	pinned: z.boolean(),
	displayOrder: z.number().int(),
	rank: z.number().int().positive(),
});

export const SkillMarketplaceResponseSchema = z.object({
	configured: z.boolean(),
	config: SkillRankingConfigSchema,
	creditBalance: z.number().int().nonnegative(),
	canListSkills: z.boolean(),
	items: z.array(SkillMarketplaceItemSchema),
});

export async function listSkillMarketplace(userId: string) {
	const prisma = getPrismaClient();
	const rankingConfig = await getSkillRankingConfig();
	const nowIso = new Date().toISOString();
	const [skills, entitlements, billingTeam, activeMembership] = await Promise.all([
		prisma.agent_skills.findMany({
			where: { enabled: 1, visible: 1 },
			orderBy: [{ sort_order: "asc" }, { name: "asc" }],
		}),
		prisma.product_entitlements.findMany({
			where: { entitlement_type: "skill_license", products: { status: "active" } },
			include: { products: true },
			orderBy: { updated_at: "desc" },
		}),
		prisma.teams.findUnique({
			where: { id: getPersonalBillingTeamId(userId) },
			select: { credits: true, credits_frozen: true },
		}),
		prisma.subscriptions.findFirst({
			where: { owner_id: userId, status: "active", start_at: { lte: nowIso }, end_at: { gt: nowIso } },
			select: { id: true },
		}),
	]);
	if (!billingTeam) {
		throw new AppError("个人积分账户不存在", {
			status: 409,
			code: "personal_billing_team_missing",
		});
	}
	const licenseBySkillId = new Map<string, {
		entitlement: (typeof entitlements)[number];
		config: SkillLicenseConfig;
	}>();
	for (const entitlement of entitlements) {
		const config = parseSkillLicenseConfig(entitlement.config_json, entitlement.product_id);
		if (licenseBySkillId.has(config.skillId)) {
			throw new AppError("同一个 Skill 关联了多个有效商品", {
				status: 500,
				code: "skill_license_product_duplicate",
				details: { skillId: config.skillId },
			});
		}
		licenseBySkillId.set(config.skillId, { entitlement, config });
	}
	const productIds = entitlements.map((item) => item.product_id);
	const installedAssets = productIds.length > 0
		? await prisma.user_skill_assets.findMany({
			where: { source_marketplace_product_id: { in: productIds } },
			select: { owner_id: true, source_marketplace_product_id: true },
		})
		: [];
	const purchaseCountByProductId = new Map<string, number>();
	const ownedProductIds = new Set<string>();
	for (const installed of installedAssets) {
		const productId = installed.source_marketplace_product_id;
		if (!productId) continue;
		purchaseCountByProductId.set(productId, (purchaseCountByProductId.get(productId) ?? 0) + 1);
		if (installed.owner_id === userId) ownedProductIds.add(productId);
	}
	const sellerUserIds = Array.from(new Set(
		Array.from(licenseBySkillId.values())
			.map((license) => license.config.sourceType === "user_asset" ? license.config.sellerUserId : null)
			.filter((sellerUserId): sellerUserId is string => Boolean(sellerUserId)),
	));
	const sellers = sellerUserIds.length > 0
		? await prisma.users.findMany({
			where: { id: { in: sellerUserIds } },
			select: { id: true, login: true, name: true },
		})
		: [];
	const sellerNameById = new Map(sellers.map((seller) => [seller.id, seller.name?.trim() || seller.login]));
	const sourceAssetIds = Array.from(licenseBySkillId.values())
		.filter((license): license is typeof license & { config: z.infer<typeof UserAssetSkillLicenseConfigSchema> } => license.config.sourceType === "user_asset")
		.map((license) => license.config.sourceAssetId);
	const sourceAssets = sourceAssetIds.length > 0
		? await prisma.user_skill_assets.findMany({
			where: { id: { in: sourceAssetIds } },
			select: {
				id: true,
				name: true,
				description: true,
				logo_url: true,
				content: true,
				size_bytes: true,
				marketplace_listed_at: true,
				created_at: true,
				updated_at: true,
			},
		})
		: [];
	const sourceAssetById = new Map(sourceAssets.map((asset) => [asset.id, asset]));
	const officialSeeds = skills.map((skill) => {
		const license = licenseBySkillId.get(skill.id);
		return {
			skill: {
				id: skill.id,
				key: skill.key,
				name: skill.name,
				description: skill.description,
				logoUrl: skill.logo_url,
				category: skill.category || "系统技能",
				enabled: skill.enabled !== 0,
				visible: skill.visible !== 0,
				sortOrder: skill.sort_order,
				createdAt: skill.created_at,
				updatedAt: skill.updated_at,
			},
			promptCharacterCount: countSkillPromptCharacters(skill.content),
			license,
			sourceType: "official" as const,
			sellerUserId: null,
		};
	});
	const userAssetSeeds = Array.from(licenseBySkillId.values())
		.filter((license): license is typeof license & { config: z.infer<typeof UserAssetSkillLicenseConfigSchema> } => license.config.sourceType === "user_asset")
		.map((license) => {
			const sourceAsset = sourceAssetById.get(license.config.sourceAssetId);
			if (!sourceAsset) {
				throw new AppError("Skill 商城商品缺少真实源资产", {
					status: 500,
					code: "skill_marketplace_source_asset_missing",
					details: { productId: license.entitlement.product_id, sourceAssetId: license.config.sourceAssetId },
				});
			}
			const product = license.entitlement.products;
			if (product.currency !== "CREDITS") {
				throw new AppError("用户 Skill 商品必须使用站内积分交易", {
					status: 500,
					code: "skill_marketplace_currency_invalid",
					details: { productId: product.id, currency: product.currency },
				});
			}
			if (!Number.isSafeInteger(product.price_cents) || product.price_cents < 1 || product.price_cents > 10_000_000) {
				throw new AppError("Skill 积分售价无效", {
					status: 500,
					code: "skill_marketplace_price_invalid",
					details: { productId: product.id, priceCredits: product.price_cents },
				});
			}
			return { skill: {
				id: license.config.skillId,
				key: license.config.skillId,
				name: sourceAsset.name,
				description: sourceAsset.description,
				logoUrl: sourceAsset.logo_url,
				category: license.config.category,
				enabled: true,
				visible: true,
				sortOrder: null,
				createdAt: sourceAsset.created_at,
				updatedAt: sourceAsset.updated_at,
			},
			license,
			sourceType: "user_asset" as const,
			sellerUserId: license.config.sellerUserId,
			promptCharacterCount: countSkillPromptCharacters(sourceAsset.content),
			sizeBytes: sourceAsset.size_bytes,
			listedAt: sourceAsset.marketplace_listed_at,
		};
	});
	const seeds = [...officialSeeds, ...userAssetSeeds];
	const candidates = seeds.map((seed) => ({
		id: seed.skill.id,
		metric: seed.sourceType === "user_asset" && seed.license
			? purchaseCountByProductId.get(seed.license.entitlement.product_id) ?? 0
			: 0,
		createdAt: seed.skill.createdAt,
	}));
	const ranks = calculateRanking(candidates, {
		metricWeight: rankingConfig.config.purchaseWeight,
		freshnessWeight: rankingConfig.config.freshnessWeight,
		freshnessHalfLifeDays: rankingConfig.config.freshnessHalfLifeDays,
		items: rankingConfig.config.items,
	});
	const rankById = new Map(ranks.map((rank) => [rank.id, rank]));
	const items = seeds.map((seed) => {
		const rank = rankById.get(seed.skill.id);
		if (!rank) throw new AppError("技能排行计算结果缺失", { status: 500, code: "skill_ranking_result_missing" });
		const product = seed.license?.entitlement.products;
		const isSystemSkill = seed.sourceType === "official";
		return {
			skill: seed.skill,
			productId: isSystemSkill ? null : product?.id ?? null,
			priceCredits: isSystemSkill ? null : product?.price_cents ?? null,
			purchasable: !isSystemSkill && Boolean(product),
			owned: isSystemSkill || (product ? ownedProductIds.has(product.id) || seed.sellerUserId === userId : true),
			sourceType: seed.sourceType,
			sellerUserId: seed.sellerUserId,
			sellerName: seed.sellerUserId ? sellerNameById.get(seed.sellerUserId) ?? null : "TapCanvas",
			sizeBytes: "sizeBytes" in seed ? seed.sizeBytes : null,
			promptCharacterCount: seed.promptCharacterCount,
			listedAt: "listedAt" in seed ? seed.listedAt : null,
			realPurchaseCount: !isSystemSkill && product ? purchaseCountByProductId.get(product.id) ?? 0 : 0,
			...rank,
		};
	}).sort((left, right) => left.rank - right.rank);
	const creditBalance = Math.max(0, billingTeam.credits - billingTeam.credits_frozen);
	return SkillMarketplaceResponseSchema.parse({
		configured: rankingConfig.configured,
		config: rankingConfig.config,
		creditBalance,
		canListSkills: Boolean(activeMembership),
		items,
	});
}
