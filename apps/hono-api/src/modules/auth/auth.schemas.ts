import { z } from "zod";

export const UserPayloadSchema = z.object({
	sub: z.string(),
	login: z.string(),
	name: z.string().optional(),
	avatarUrl: z.string().nullable().optional(),
	email: z.string().nullable().optional(),
	phone: z.string().nullable().optional(),
	hasPassword: z.boolean().default(false),
	role: z.string().nullable().optional(),
	guest: z.boolean().default(false),
});

export type UserPayload = z.infer<typeof UserPayloadSchema>;

export const GithubExchangeRequestSchema = z.object({
	code: z.string(),
});

export const AuthResponseSchema = z.object({
	token: z.string(),
	refreshToken: z.string(),
	accessTokenExpiresInSeconds: z.number().int().positive(),
	refreshTokenExpiresInSeconds: z.number().int().positive(),
	user: UserPayloadSchema,
});

export const BrowserAuthResponseSchema = z.object({
	authenticated: z.literal(true),
	user: UserPayloadSchema,
});

export const GuestLoginRequestSchema = z.object({
	nickname: z.string().optional(),
});

export const EmailLoginRequestSchema = z.object({
	email: z
		.string()
		.trim()
		.toLowerCase()
		.email("邮箱格式不正确"),
});

export const EmailVerifyRequestSchema = z.object({
	email: z
		.string()
		.trim()
		.toLowerCase()
		.email("邮箱格式不正确"),
	code: z
		.string()
		.trim()
		.regex(/^\d{6}$/, "验证码需为 6 位数字"),
});

export const CredentialLoginRequestSchema = z.object({
	username: z
		.string()
		.trim()
		.min(1, "请输入账号")
		.max(64, "账号过长"),
	password: z
		.string()
		.min(6, "密码至少 6 位")
		.max(128, "密码过长"),
});
