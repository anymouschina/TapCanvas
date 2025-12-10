import { z } from "zod";

export const UserPayloadSchema = z.object({
	sub: z.string(),
	login: z.string(),
	name: z.string().optional(),
	avatarUrl: z.string().nullable().optional(),
	email: z.string().nullable().optional(),
	guest: z.boolean().default(false),
});

export type UserPayload = z.infer<typeof UserPayloadSchema>;

export const GithubExchangeRequestSchema = z.object({
	code: z.string(),
});

export const AuthResponseSchema = z.object({
	token: z.string(),
	user: UserPayloadSchema,
});

export const GuestLoginRequestSchema = z.object({
	nickname: z.string().optional(),
});

