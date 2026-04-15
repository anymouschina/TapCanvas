import { z } from "zod";

export const TEXT_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const TEXT_UPLOAD_MAX_LABEL = "50MB";
export const PROJECT_BOOK_UPLOAD_CHUNK_MAX_CHARS = 300_000;

const utf8Encoder = new TextEncoder();

export function getUtf8TextByteLength(value: string): number {
	return utf8Encoder.encode(value).byteLength;
}

export const ServerAssetSchema = z.object({
	id: z.string(),
	name: z.string(),
	data: z.unknown(),
	createdAt: z.string(),
	updatedAt: z.string(),
	userId: z.string(),
	projectId: z.string().nullable().optional(),
});

export type ServerAssetDto = z.infer<typeof ServerAssetSchema>;

export const ServerAssetListSchema = z.object({
	items: z.array(ServerAssetSchema),
	cursor: z.string().nullable(),
});

export type ServerAssetListDto = z.infer<typeof ServerAssetListSchema>;

export const PublicAssetSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.enum(["image", "video"]),
	url: z.string(),
	thumbnailUrl: z.string().nullable().optional(),
	duration: z.number().nullable().optional(),
	prompt: z.string().nullable().optional(),
	vendor: z.string().nullable().optional(),
	modelKey: z.string().nullable().optional(),
	createdAt: z.string(),
	ownerLogin: z.string().nullable().optional(),
	ownerName: z.string().nullable().optional(),
	projectName: z.string().nullable().optional(),
});

export type PublicAssetDto = z.infer<typeof PublicAssetSchema>;

export const CreateAssetSchema = z.object({
	name: z.string().min(1),
	data: z.unknown(),
	projectId: z.string().nullable().optional(),
});

export const RenameAssetSchema = z.object({
	name: z.string().min(1),
});

export const UpdateAssetDataSchema = z.object({
	data: z.unknown(),
});

export const IngestProjectMaterialSchema = z.object({
	projectId: z.string().min(1),
	kind: z.enum(["novelDoc", "scriptDoc", "storyboardScript"]),
	name: z.string().min(1).max(200),
	content: z.string().min(1),
	chapter: z.number().int().min(1).max(9999).nullable().optional(),
});

export type IngestProjectMaterialDto = z.infer<typeof IngestProjectMaterialSchema>;

export const IngestProjectBookSchema = z.object({
	projectId: z.string().min(1),
	title: z.string().min(1).max(200),
	content: z.string().min(1),
});

export type IngestProjectBookDto = z.infer<typeof IngestProjectBookSchema>;

export const StartProjectBookUploadSchema = z.object({
	projectId: z.string().min(1),
	title: z.string().min(1).max(200),
	contentBytes: z.number().int().positive(),
});

export type StartProjectBookUploadDto = z.infer<typeof StartProjectBookUploadSchema>;

export const AppendProjectBookUploadChunkSchema = z.object({
	chunk: z.string().min(1).max(PROJECT_BOOK_UPLOAD_CHUNK_MAX_CHARS),
});

export type AppendProjectBookUploadChunkDto = z.infer<typeof AppendProjectBookUploadChunkSchema>;

export const FinishProjectBookUploadSchema = z.object({
	strictAgents: z.boolean().optional(),
});

export type FinishProjectBookUploadDto = z.infer<typeof FinishProjectBookUploadSchema>;
