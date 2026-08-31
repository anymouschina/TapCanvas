import { z } from "zod";

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
	accountId: z.string().nullable(),
	accountName: z.string().nullable(),
	credits: z.number().nullable(),
	creditsFrozen: z.number().nullable(),
	creditsAvailable: z.number().nullable(),
	membership: z.object({
		subscriptionId: z.string(),
		planCode: z.string(),
		startAt: z.string(),
		endAt: z.string(),
		billingCycle: z.enum(["monthly", "annual"]),
		monthlyCredits: z.number().int().positive(),
		dailyGiftCredits: z.number().int().positive(),
		concurrencyLimit: z.number().int().positive(),
		capacityLabel: z.string(),
		timezone: z.string(),
	}).nullable(),
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

const AdminRecordPaginationSchema = {
	page: z.coerce.number().int().min(1).max(100000).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

const AdminRecordDateTimeSchema = z.string()
	.datetime({ offset: true })
	.transform((value) => new Date(value).toISOString());

export const AdminCreditGrantQuerySchema = z.object({
	q: z.string().trim().max(128).optional(),
	grantType: z.enum(["monthly", "daily"]).optional(),
	from: AdminRecordDateTimeSchema.optional(),
	to: AdminRecordDateTimeSchema.optional(),
	...AdminRecordPaginationSchema,
});

export const AdminCreditGrantRecordSchema = z.object({
	id: z.string(),
	subscriptionId: z.string().nullable(),
	ownerId: z.string(),
	teamId: z.string(),
	userLogin: z.string(),
	userName: z.string().nullable(),
	userEmail: z.string().nullable(),
	planCode: z.string().nullable(),
	subscriptionStatus: z.string().nullable(),
	grantType: z.enum(["monthly", "daily"]),
	grantKey: z.string(),
	amount: z.number().int().positive(),
	grantedAt: z.string(),
	expiresAt: z.string().nullable(),
	expiredAmount: z.number().int().nonnegative(),
	processedAt: z.string().nullable(),
});
export type AdminCreditGrantRecordDto = z.infer<typeof AdminCreditGrantRecordSchema>;

export const AdminCreditGrantListResponseSchema = z.object({
	items: z.array(AdminCreditGrantRecordSchema),
	total: z.number().int().nonnegative(),
	page: z.number().int().positive(),
	pageSize: z.number().int().positive(),
});
export type AdminCreditGrantListResponseDto = z.infer<typeof AdminCreditGrantListResponseSchema>;

export const AdminUpdateUserRequestSchema = z.object({
	role: z.enum(["admin"]).nullable().optional(),
	disabled: z.boolean().optional(),
});

export const AdminAdjustUserCreditsRequestSchema = z.object({
	delta: z.number().int().min(-10_000_000).max(10_000_000),
	note: z.string().max(200).optional(),
});

export const AdminSetUserMembershipRequestSchema = z.object({
	productId: z.string().trim().min(1).nullable(),
	skuId: z.string().trim().min(1).nullable().optional(),
	endAt: z.string().datetime({ offset: true }).nullable().optional(),
}).superRefine((value, context) => {
	if (value.productId && !value.endAt) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["endAt"],
			message: "选择个人套餐时必须设置有效期",
		});
	}
});

// ===== 积分总览 =====
export const UserCreditsOverviewSchema = z.object({
	userId: z.string(),
	teamId: z.string().nullable(),
	totals: z.object({
		deductTotal: z.number().int().nonnegative(),
		deductMonth: z.number().int().nonnegative(),
		deductToday: z.number().int().nonnegative(),
		frozenNow: z.number().int().nonnegative(),
		countTotal: z.number().int().nonnegative(),
	}),
	byTaskKind: z.array(
		z.object({
			taskKind: z.string(),
			count: z.number().int().nonnegative(),
			amount: z.number().int().nonnegative(),
		}),
	),
});
export type UserCreditsOverviewDto = z.infer<typeof UserCreditsOverviewSchema>;

// ===== Ledger 列表 =====
export const LedgerListQuerySchema = z.object({
	entryTypes: z.string().max(200).optional(),
	taskIdLike: z.string().max(64).optional(),
	since: z.string().max(40).optional(),
	until: z.string().max(40).optional(),
	cursor: z.string().max(64).optional(),
	cursorAt: z.string().max(40).optional(),
	limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const LedgerEntrySchema = z.object({
	id: z.string(),
	entryType: z.string(),
	amount: z.number().int().nonnegative(),
	taskId: z.string().nullable(),
	taskKind: z.string().nullable(),
	actorUserId: z.string().nullable(),
	note: z.string().nullable(),
	createdAt: z.string(),
});

export const LedgerListResponseSchema = z.object({
	items: z.array(LedgerEntrySchema),
	nextCursor: z
		.object({ id: z.string(), createdAt: z.string() })
		.nullable(),
});
export type LedgerListResponseDto = z.infer<typeof LedgerListResponseSchema>;
export type LedgerEntryDto = z.infer<typeof LedgerEntrySchema>;

// ===== Task log bundle =====
export const TaskLogBundleSchema = z.object({
	taskId: z.string(),
	userId: z.string(),
	result: z
		.object({
			vendor: z.string().nullable(),
			kind: z.string().nullable(),
			status: z.string().nullable(),
			completedAt: z.string().nullable(),
			updatedAt: z.string().nullable(),
			raw: z.unknown().nullable(),
		})
		.nullable(),
	credits: z.object({
		reserved: z.number().int().nonnegative(),
		deducted: z.number().int().nonnegative(),
		released: z.number().int().nonnegative(),
		pending: z.number().int().nonnegative(),
	}),
	statuses: z.array(
		z.object({
			id: z.string(),
			provider: z.string(),
			status: z.string(),
			data: z.unknown().nullable(),
			createdAt: z.string(),
			completedAt: z.string().nullable(),
		}),
	),
	vendorCalls: z.array(
		z.object({
			rowId: z.number().nullable(),
			vendor: z.string(),
			status: z.string(),
			startedAt: z.string().nullable(),
			finishedAt: z.string().nullable(),
			durationMs: z.number().nullable(),
			errorMessage: z.string().nullable(),
			requestJson: z.unknown().nullable(),
			responseJson: z.unknown().nullable(),
		}),
	),
});
export type TaskLogBundleDto = z.infer<typeof TaskLogBundleSchema>;
