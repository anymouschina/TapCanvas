import { z } from "zod";

export const AccountSettingsSchema = z.object({
	checkInEnabled: z.boolean(),
	checkInRewardCredits: z.number().int().min(1).max(1_000_000),
	membershipEnabled: z.boolean(),
	sessionTtlDays: z.number().int().min(1).max(90),
	maxActiveSessions: z.number().int().min(1).max(50),
});

export type AccountSettings = z.infer<typeof AccountSettingsSchema>;

export const NotificationActionUrlSchema = z.string().trim().max(2048).refine((value) => {
	if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) return true;
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}, "消息链接必须是 HTTPS URL 或站内相对路径");

export const UpdateProfileSchema = z
	.object({
		name: z.string().trim().min(1).max(32).optional(),
		bio: z.string().trim().max(300).nullable().optional(),
		avatarUrl: z.string().url().max(2048).nullable().optional(),
	})
	.refine((value) => Object.keys(value).length > 0, "至少提交一个需要更新的字段");

export const NotificationFilterSchema = z.enum(["all", "unread", "read"]);

export const AdminNotificationCreateSchema = z
	.object({
		audience: z.enum(["all", "users"]),
		userIds: z.array(z.string().trim().min(1)).max(500).optional(),
		type: z.string().trim().min(1).max(64),
		title: z.string().trim().min(1).max(120),
		body: z.string().trim().min(1).max(2000),
		actionUrl: NotificationActionUrlSchema.nullable().optional(),
		metadata: z.record(z.unknown()).nullable().optional(),
	})
	.superRefine((value, ctx) => {
		if (value.audience === "users" && (!value.userIds || value.userIds.length === 0)) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["userIds"], message: "定向发送必须选择用户" });
		}
	});

export const ListQuerySchema = z.object({
	cursor: z.string().trim().min(1).optional(),
	limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const UpdateWorkPublicationSchema = z.object({
	published: z.boolean(),
});

export const AdminSessionListQuerySchema = z.object({
	cursor: z.string().trim().min(1).optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	userId: z.string().trim().min(1).optional(),
	activeOnly: z
		.enum(["true", "false"])
		.transform((value) => value === "true")
		.default("true"),
});
