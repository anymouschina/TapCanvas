import { z } from "zod";

export const MaterialKindSchema = z.enum([
	"character",
	"scene",
	"prop",
	"style",
	"text",
	// 群像图：多人同框设定图（主角 + 路人A/B/C，≤5 人，含站位），作为前置资产喂视频
	// 参考，根治群像/人群镜「同脸」。kind 列是 String（非 DB enum），无需迁移。
	"ensemble",
	// 姿态图（2026-07-16 用户拍板·类比群像图）：人物×道具非常规组合形态的单格设定图
	// （扛/挑/背/骑/抱/拖等交互姿势，如「导盲杖当扁担挑两桶油」）。文字描述这类形态必然
	// 走样（扁担悬空/无手扶点/道具浮空），必须批前生成、QC 后作视频参考。kind 列同上无需迁移。
	"pose",
	// 配音卡（声音锚）：与角色卡同权重的一等资产——每个说话角色的可复用音色锚（豆包音色 id +
	// voiceCharacter=角色名），按名跨镜跨章复用（同角色同一把嗓＝声音连续性）。与角色卡「成对生成」。
	"voice",
]);

export const MaterialAssetSchema = z
	.object({
		id: z.string(),
		projectId: z.string(),
		teamId: z.string().optional().nullable(),
		folderId: z.string().optional().nullable(),
		scope: z.enum(["project", "official", "personal", "team"]).optional(),
		kind: MaterialKindSchema,
		name: z.string(),
		favorite: z.boolean().optional(),
		currentVersion: z.number().int().min(1),
		latestVersion: z.lazy(() => MaterialAssetVersionSchema).nullable().optional(),
		createdAt: z.string(),
		updatedAt: z.string(),
		origin: z
			.object({
				type: z.literal("project_node"),
				ownerType: z.enum(["project", "chapter", "shot"]),
				ownerId: z.string(),
				ownerLabel: z.string().optional(),
				flowId: z.string(),
				nodeId: z.string(),
			})
			.strict()
			.optional(),
	})
	.strict();

export const MaterialAssetVersionSchema = z
	.object({
		id: z.string(),
		assetId: z.string(),
		projectId: z.string(),
		version: z.number().int().min(1),
		data: z.record(z.unknown()),
		note: z.string().nullable(),
		createdAt: z.string(),
	})
	.strict();

export const MaterialShotRefSchema = z
	.object({
		id: z.string(),
		projectId: z.string(),
		shotId: z.string(),
		assetId: z.string(),
		assetVersion: z.number().int().min(1),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.strict();

export const MaterialFolderSchema = z
	.object({
		id: z.string(),
		projectId: z.string().nullable().optional(),
		teamId: z.string().nullable().optional(),
		ownerId: z.string().nullable().optional(),
		scope: z.enum(["official", "personal", "team"]).optional(),
		name: z.string(),
		createdAt: z.string(),
	})
	.strict();

export const CreateMaterialAssetRequestSchema = z
	.object({
		projectId: z.string().min(1).optional(),
		kind: MaterialKindSchema,
		name: z.string().min(1).max(200),
		initialData: z.record(z.unknown()),
		note: z.string().max(500).optional(),
		folderId: z.string().optional(),
	})
	.strict();

export const CreateTeamMaterialAssetRequestSchema = z
	.object({
		teamId: z.string().min(1),
		kind: MaterialKindSchema,
		name: z.string().min(1).max(200),
		initialData: z.record(z.unknown()),
		note: z.string().max(500).optional(),
		folderId: z.string().optional(),
	})
	.strict();

export const CreateMaterialFolderRequestSchema = z
	.object({
		teamId: z.string().optional(),
		name: z.string().min(1).max(200),
	})
	.strict();

export const CreateMaterialVersionRequestSchema = z
	.object({
		data: z.record(z.unknown()),
		note: z.string().max(500).optional(),
	})
	.strict();

export const UpdateMaterialAssetRequestSchema = z
	.object({
		name: z.string().min(1).max(200).optional(),
		data: z.record(z.unknown()).optional(),
		favorite: z.boolean().optional(),
	})
	.strict();

export const UpsertShotMaterialRefsRequestSchema = z
	.object({
		projectId: z.string().min(1),
		shotId: z.string().min(1),
		refs: z
			.array(
				z
					.object({
						assetId: z.string().min(1),
						assetVersion: z.number().int().min(1),
					})
					.strict(),
			)
			.max(128),
	})
	.strict();

export const MaterialImpactItemSchema = z
	.object({
		shotId: z.string(),
		assetId: z.string(),
		boundVersion: z.number().int().min(1),
		currentVersion: z.number().int().min(1),
		isOutdated: z.boolean(),
	})
	.strict();

export const MaterialImpactResponseSchema = z
	.object({
		projectId: z.string(),
		items: z.array(MaterialImpactItemSchema),
	})
	.strict();

export type MaterialAssetDto = z.infer<typeof MaterialAssetSchema>;
export type MaterialKind = z.infer<typeof MaterialKindSchema>;
export type MaterialAssetVersionDto = z.infer<typeof MaterialAssetVersionSchema>;
export type MaterialShotRefDto = z.infer<typeof MaterialShotRefSchema>;
export type MaterialFolderDto = z.infer<typeof MaterialFolderSchema>;
export type CreateMaterialAssetRequest = z.infer<
	typeof CreateMaterialAssetRequestSchema
>;
export type CreateTeamMaterialAssetRequest = z.infer<
	typeof CreateTeamMaterialAssetRequestSchema
>;
export type CreateMaterialFolderRequest = z.infer<
	typeof CreateMaterialFolderRequestSchema
>;
export type CreateMaterialVersionRequest = z.infer<
	typeof CreateMaterialVersionRequestSchema
>;
export type UpsertShotMaterialRefsRequest = z.infer<
	typeof UpsertShotMaterialRefsRequestSchema
>;
export type UpdateMaterialAssetRequest = z.infer<typeof UpdateMaterialAssetRequestSchema>;
export type MaterialImpactResponseDto = z.infer<typeof MaterialImpactResponseSchema>;
