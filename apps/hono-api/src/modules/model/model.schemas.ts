import { z } from "zod";

export const ModelProviderSchema = z.object({
	id: z.string(),
	name: z.string(),
	vendor: z.string(),
	baseUrl: z.string().nullable().optional(),
	sharedBaseUrl: z.boolean().optional(),
});

export type ModelProviderDto = z.infer<typeof ModelProviderSchema>;

export const UpsertProviderSchema = z.object({
	id: z.string().optional(),
	name: z.string().min(1),
	vendor: z.string().min(1),
	baseUrl: z.string().nullable().optional(),
	sharedBaseUrl: z.boolean().optional(),
});

export const ModelTokenSchema = z.object({
	id: z.string(),
	providerId: z.string(),
	label: z.string(),
	secretToken: z.string(),
	userAgent: z.string().nullable().optional(),
	enabled: z.boolean(),
	shared: z.boolean().optional(),
});

export type ModelTokenDto = z.infer<typeof ModelTokenSchema>;

export const UpsertTokenSchema = z.object({
	id: z.string().optional(),
	providerId: z.string(),
	label: z.string().min(1),
	secretToken: z.string().min(1),
	userAgent: z.string().nullable().optional(),
	enabled: z.boolean().optional(),
	shared: z.boolean().optional(),
});

export const ModelEndpointSchema = z.object({
	id: z.string(),
	providerId: z.string(),
	key: z.string(),
	label: z.string(),
	baseUrl: z.string(),
	shared: z.boolean().optional(),
});

export type ModelEndpointDto = z.infer<typeof ModelEndpointSchema>;

export const UpsertEndpointSchema = z.object({
	id: z.string().optional(),
	providerId: z.string(),
	key: z.string(),
	label: z.string(),
	baseUrl: z.string(),
	shared: z.boolean().optional(),
});

export const ProfileKindSchema = z.enum([
	"chat",
	"prompt_refine",
	"text_to_image",
	"image_to_prompt",
	"image_to_video",
	"text_to_video",
	"image_edit",
]);

export type ProfileKind = z.infer<typeof ProfileKindSchema>;

export const ModelProfileSchema = z.object({
	id: z.string(),
	ownerId: z.string(),
	providerId: z.string(),
	name: z.string(),
	kind: ProfileKindSchema,
	modelKey: z.string(),
	settings: z.unknown().optional(),
	provider: z
		.object({
			id: z.string(),
			name: z.string(),
			vendor: z.string(),
		})
		.optional(),
});

export type ModelProfileDto = z.infer<typeof ModelProfileSchema>;

export const UpsertProfileSchema = z.object({
	id: z.string().optional(),
	providerId: z.string(),
	name: z.string().min(1),
	kind: ProfileKindSchema,
	modelKey: z.string().min(1),
	settings: z.unknown().optional(),
});

export const AvailableModelSchema = z.object({
	value: z.string(),
	label: z.string(),
	vendor: z.string().optional(),
});

export type AvailableModelDto = z.infer<typeof AvailableModelSchema>;

export const ProxyConfigSchema = z.object({
	id: z.string(),
	name: z.string(),
	vendor: z.string(),
	baseUrl: z.string(),
	enabled: z.boolean(),
	enabledVendors: z.array(z.string()).default([]),
	hasApiKey: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type ProxyConfigDto = z.infer<typeof ProxyConfigSchema>;

export const UpsertProxySchema = z.object({
	baseUrl: z.string().optional(),
	apiKey: z.string().nullable().optional(),
	enabled: z.boolean().optional(),
	enabledVendors: z.array(z.string()).optional(),
	name: z.string().optional(),
});

// ---- Model export/import ----

export const ModelExportTokenSchema = z.object({
	id: z.string(),
	label: z.string(),
	secretToken: z.string(),
	enabled: z.boolean(),
	userAgent: z.string().nullable().optional(),
	shared: z.boolean(),
});

export const ModelExportEndpointSchema = z.object({
	id: z.string(),
	key: z.string(),
	label: z.string(),
	baseUrl: z.string(),
	shared: z.boolean(),
});

export const ModelExportProviderSchema = z.object({
	id: z.string(),
	name: z.string(),
	vendor: z.string(),
	baseUrl: z.string().nullable().optional(),
	sharedBaseUrl: z.boolean().optional(),
	tokens: z.array(ModelExportTokenSchema),
	endpoints: z.array(ModelExportEndpointSchema),
});

export const ModelExportDataSchema = z.object({
	version: z.string(),
	exportedAt: z.string(),
	providers: z.array(ModelExportProviderSchema),
});

export type ModelExportData = z.infer<typeof ModelExportDataSchema>;
