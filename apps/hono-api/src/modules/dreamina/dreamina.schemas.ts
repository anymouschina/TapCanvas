import { z } from "zod";

export const DreaminaAccountSchema = z.object({
	id: z.string(),
	ownerId: z.string(),
	label: z.string(),
	cliPath: z.string().nullable(),
	sessionRoot: z.string(),
	enabled: z.boolean(),
	lastHealthcheckAt: z.string().nullable(),
	lastLoginAt: z.string().nullable(),
	lastError: z.string().nullable(),
	meta: z.unknown().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type DreaminaAccountDto = z.infer<typeof DreaminaAccountSchema>;

export const UpsertDreaminaAccountSchema = z.object({
	id: z.string().trim().min(1).optional(),
	label: z.string().trim().min(1).max(120),
	cliPath: z.string().trim().min(1).max(1000).nullable().optional(),
	enabled: z.boolean().optional(),
	meta: z.unknown().optional(),
});

export const DreaminaAccountProbeSchema = z.object({
	accountId: z.string(),
	ok: z.boolean(),
	version: z.string().nullable().optional(),
	loggedIn: z.boolean(),
	creditText: z.string().nullable().optional(),
	message: z.string(),
	stdout: z.string().nullable().optional(),
	stderr: z.string().nullable().optional(),
	checkedAt: z.string(),
});

export type DreaminaAccountProbeDto = z.infer<typeof DreaminaAccountProbeSchema>;

export const DreaminaImportLoginSchema = z.object({
	loginResponseJson: z.string().trim().min(1),
});

export const DreaminaProjectBindingSchema = z.object({
	id: z.string(),
	ownerId: z.string(),
	projectId: z.string(),
	accountId: z.string(),
	enabled: z.boolean(),
	defaultModelVersion: z.string().nullable().optional(),
	defaultRatio: z.string().nullable().optional(),
	defaultResolutionType: z.string().nullable().optional(),
	defaultVideoResolution: z.string().nullable().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type DreaminaProjectBindingDto = z.infer<
	typeof DreaminaProjectBindingSchema
>;

export const UpsertDreaminaProjectBindingSchema = z.object({
	accountId: z.string().trim().min(1),
	enabled: z.boolean().optional(),
	defaultModelVersion: z.string().trim().max(120).nullable().optional(),
	defaultRatio: z.string().trim().max(40).nullable().optional(),
	defaultResolutionType: z.string().trim().max(40).nullable().optional(),
	defaultVideoResolution: z.string().trim().max(40).nullable().optional(),
});
