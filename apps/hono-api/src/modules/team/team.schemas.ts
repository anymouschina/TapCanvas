import { z } from "zod";

export const TeamRoleSchema = z.enum(["owner", "admin", "member"]);
export type TeamRole = z.infer<typeof TeamRoleSchema>;

export const TeamSchema = z.object({
	id: z.string(),
	name: z.string(),
	credits: z.number(),
	creditsFrozen: z.number(),
	creditsAvailable: z.number(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type TeamDto = z.infer<typeof TeamSchema>;

export const TeamListItemSchema = TeamSchema.extend({
	memberCount: z.number(),
});
export type TeamListItemDto = z.infer<typeof TeamListItemSchema>;

export const TeamMemberSchema = z.object({
	userId: z.string(),
	login: z.string(),
	name: z.string().nullable(),
	avatarUrl: z.string().nullable(),
	email: z.string().nullable(),
	phone: z.string().nullable(),
	role: TeamRoleSchema,
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type TeamMemberDto = z.infer<typeof TeamMemberSchema>;

export const TeamMembershipSchema = z.object({
	team: TeamSchema,
	role: TeamRoleSchema,
});
export type TeamMembershipDto = z.infer<typeof TeamMembershipSchema>;

export const CreateTeamRequestSchema = z.object({
	name: z.string().min(1).max(64),
	// Admin-only: create team owned by another user.
	ownerUserId: z.string().min(1).optional(),
	ownerLogin: z.string().min(1).optional(),
});

export const AddTeamMemberRequestSchema = z.object({
	userId: z.string().min(1).optional(),
	login: z.string().min(1).optional(),
	role: TeamRoleSchema.optional(),
});

export const CreateTeamInviteRequestSchema = z.object({
	email: z.string().email().optional(),
	phone: z.string().min(6).max(32).optional(),
	login: z.string().min(1).optional(),
	expiresInDays: z.number().int().min(1).max(30).optional(),
});

export const TeamInviteSchema = z.object({
	id: z.string(),
	teamId: z.string(),
	code: z.string(),
	email: z.string().nullable(),
	phone: z.string().nullable(),
	login: z.string().nullable(),
	status: z.enum(["pending", "accepted", "revoked", "expired"]),
	expiresAt: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type TeamInviteDto = z.infer<typeof TeamInviteSchema>;

export const AcceptTeamInviteRequestSchema = z.object({
	code: z.string().min(1),
});

export const TopUpTeamCreditsRequestSchema = z.object({
	amount: z.number().int().min(1).max(1_000_000),
	note: z.string().max(200).optional(),
});

export const TeamCreditLedgerEntrySchema = z.object({
	id: z.string(),
	teamId: z.string(),
	entryType: z.enum(["topup", "reserve", "deduct", "release"]),
	amount: z.number(),
	taskId: z.string().nullable(),
	taskKind: z.string().nullable(),
	actorUserId: z.string().nullable(),
	note: z.string().nullable(),
	createdAt: z.string(),
});
export type TeamCreditLedgerEntryDto = z.infer<typeof TeamCreditLedgerEntrySchema>;
