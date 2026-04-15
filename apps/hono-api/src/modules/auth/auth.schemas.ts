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

export const PhoneLoginRequestSchema = z.object({
	phone: z
		.string()
		.trim()
		.min(6, "手机号不正确")
		.max(32, "手机号不正确"),
});

export const PhoneVerifyRequestSchema = z.object({
	phone: z
		.string()
		.trim()
		.min(6, "手机号不正确")
		.max(32, "手机号不正确"),
	code: z
		.string()
		.trim()
		.regex(/^\d{6}$/, "验证码需为 6 位数字"),
});

export const PhonePasswordLoginRequestSchema = z.object({
	phone: z
		.string()
		.trim()
		.min(6, "手机号不正确")
		.max(32, "手机号不正确"),
	password: z
		.string()
		.min(8, "密码至少 8 位")
		.max(128, "密码过长"),
});

export const SetPasswordRequestSchema = z.object({
	password: z
		.string()
		.min(8, "密码至少 8 位")
		.max(128, "密码过长"),
});
