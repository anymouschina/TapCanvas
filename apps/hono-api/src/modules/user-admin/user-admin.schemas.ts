import { z } from "zod";

const AdminUserTeamRoleSchema = z.enum(["owner", "admin", "member"]);

export const AdminUserSchema = z.object({
	id: z.string(),
	login: z.string(),
	name: z.string().nullable(),
	avatarUrl: z.string().nullable(),
	email: z.string().nullable(),
	phone: z.string().nullable(),
	role: z.string().nullable(),
	guest: z.boolean(),
	disabled: z.boolean(),
	deletedAt: z.string().nullable(),
	lastSeenAt: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
	teamId: z.string().nullable(),
	teamName: z.string().nullable(),
	teamRole: AdminUserTeamRoleSchema.nullable(),
	teamCredits: z.number().nullable(),
	teamCreditsFrozen: z.number().nullable(),
	teamCreditsAvailable: z.number().nullable(),
});
export type AdminUserDto = z.infer<typeof AdminUserSchema>;

export const AdminUserListResponseSchema = z.object({
	items: z.array(AdminUserSchema),
	total: z.number().int().nonnegative(),
	page: z.number().int().positive(),
	pageSize: z.number().int().positive(),
});
export type AdminUserListResponseDto = z.infer<
	typeof AdminUserListResponseSchema
>;

export const ListAdminUsersQuerySchema = z.object({
	q: z.string().max(128).optional(),
	page: z.coerce.number().int().min(1).max(100000).optional(),
	pageSize: z.coerce.number().int().min(1).max(500).optional(),
	includeDeleted: z
		.union([
			z.literal("1"),
			z.literal("true"),
			z.literal("yes"),
			z.literal("on"),
			z.literal("0"),
			z.literal("false"),
			z.literal("no"),
			z.literal("off"),
		])
		.optional(),
});

export const AdminUpdateUserRequestSchema = z.object({
	role: z.enum(["admin"]).nullable().optional(),
	disabled: z.boolean().optional(),
});

export const AdminAdjustUserTeamCreditsRequestSchema = z.object({
	delta: z.number().int().min(-1_000_000).max(1_000_000),
	note: z.string().max(200).optional(),
});
