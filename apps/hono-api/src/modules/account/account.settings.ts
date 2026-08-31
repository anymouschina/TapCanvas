import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { getPrismaClient } from "../../platform/node/prisma";
import { AccountSettingsSchema, type AccountSettings } from "./account.schemas";

export const ACCOUNT_SETTINGS_DICT_TYPE = "platform_account";
export const ACCOUNT_SETTINGS_CODE = "member_center";
export const DEFAULT_SESSION_TTL_DAYS = 7;
export const DEFAULT_MAX_ACTIVE_SESSIONS = 10;

export type AccountSettingsState = {
	configured: boolean;
	settings: AccountSettings | null;
	effectiveSessionTtlDays: number;
	effectiveMaxActiveSessions: number;
};

export function resolveConfiguredPlatformOwnerId(c: AppContext): string | null {
	const ownerId = String(c.env.COMMERCE_PLATFORM_OWNER_ID || "").trim();
	return ownerId || null;
}

export async function readAccountSettings(c: AppContext): Promise<AccountSettingsState> {
	const ownerId = resolveConfiguredPlatformOwnerId(c);
	if (!ownerId) {
		return {
			configured: false,
			settings: null,
			effectiveSessionTtlDays: DEFAULT_SESSION_TTL_DAYS,
			effectiveMaxActiveSessions: DEFAULT_MAX_ACTIVE_SESSIONS,
		};
	}
	const row = await getPrismaClient().commerce_dictionaries.findUnique({
		where: {
			owner_id_dict_type_code: {
				owner_id: ownerId,
				dict_type: ACCOUNT_SETTINGS_DICT_TYPE,
				code: ACCOUNT_SETTINGS_CODE,
			},
		},
		select: { value_json: true, enabled: true },
	});
	if (!row?.value_json) {
		return {
			configured: false,
			settings: null,
			effectiveSessionTtlDays: DEFAULT_SESSION_TTL_DAYS,
			effectiveMaxActiveSessions: DEFAULT_MAX_ACTIVE_SESSIONS,
		};
	}
	let raw: unknown;
	try {
		raw = JSON.parse(row.value_json);
	} catch (error: unknown) {
		throw new AppError("账户中心配置 JSON 已损坏", {
			status: 500,
			code: "account_settings_invalid_json",
			details: error instanceof Error ? error.message : String(error),
		});
	}
	const parsed = AccountSettingsSchema.safeParse(raw);
	if (!parsed.success) {
		throw new AppError("账户中心配置不符合当前契约", {
			status: 500,
			code: "account_settings_invalid",
			details: parsed.error.issues,
		});
	}
	const settings = { ...parsed.data, checkInEnabled: row.enabled === 1 && parsed.data.checkInEnabled };
	return {
		configured: true,
		settings,
		effectiveSessionTtlDays: settings.sessionTtlDays,
		effectiveMaxActiveSessions: settings.maxActiveSessions,
	};
}

export async function saveAccountSettings(
	c: AppContext,
	settings: AccountSettings,
): Promise<AccountSettingsState> {
	const ownerId = resolveConfiguredPlatformOwnerId(c);
	if (!ownerId) {
		throw new AppError("未配置 COMMERCE_PLATFORM_OWNER_ID，无法保存账户中心配置", {
			status: 503,
			code: "account_platform_owner_not_configured",
		});
	}
	const owner = await getPrismaClient().users.findUnique({ where: { id: ownerId }, select: { id: true } });
	if (!owner) {
		throw new AppError("COMMERCE_PLATFORM_OWNER_ID 对应用户不存在", {
			status: 409,
			code: "account_platform_owner_missing",
			details: { ownerId },
		});
	}
	const nowIso = new Date().toISOString();
	await getPrismaClient().commerce_dictionaries.upsert({
		where: {
			owner_id_dict_type_code: {
				owner_id: ownerId,
				dict_type: ACCOUNT_SETTINGS_DICT_TYPE,
				code: ACCOUNT_SETTINGS_CODE,
			},
		},
		create: {
			id: crypto.randomUUID(),
			owner_id: ownerId,
			dict_type: ACCOUNT_SETTINGS_DICT_TYPE,
			code: ACCOUNT_SETTINGS_CODE,
			name: "账户与会员中心配置",
			value_json: JSON.stringify(settings),
			enabled: 1,
			sort_order: 0,
			created_at: nowIso,
			updated_at: nowIso,
		},
		update: { value_json: JSON.stringify(settings), enabled: 1, updated_at: nowIso },
	});
	return readAccountSettings(c);
}
