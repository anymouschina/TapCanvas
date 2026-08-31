import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { isAdminRequest } from "../team/team.service";
import { listBuiltInSmallTCapabilities } from "../task/agents-bridge-remote-tool-surface";
import {
	AdminBuiltInCapabilitySchema,
	type AdminBuiltInCapability,
} from "./built-in-capability-settings.schemas";

export type BuiltInCapabilitySystemSetting = {
	capabilityId: string;
	enabled: boolean;
	updatedAt: string;
	updatedByUserId: string;
};

function requireAdmin(c: AppContext): void {
	if (!isAdminRequest(c)) {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
}

export async function readBuiltInCapabilitySystemSettings(
	c: AppContext,
): Promise<Map<string, BuiltInCapabilitySystemSetting>> {
	const rows = await c.env.DB.agent_builtin_capability_settings.findMany({
		orderBy: { capability_id: "asc" },
	});
	return new Map(rows.map((row) => [row.capability_id, {
		capabilityId: row.capability_id,
		enabled: row.enabled === 1,
		updatedAt: row.updated_at,
		updatedByUserId: row.updated_by_user_id,
	}]));
}

export async function listSystemDisabledBuiltInCapabilityKeys(c: AppContext): Promise<string[]> {
	const rows = await c.env.DB.agent_builtin_capability_settings.findMany({
		where: { enabled: 0 },
		select: { capability_id: true },
		orderBy: { capability_id: "asc" },
	});
	return rows.map((row) => row.capability_id);
}

export async function listAdminBuiltInCapabilities(c: AppContext): Promise<AdminBuiltInCapability[]> {
	requireAdmin(c);
	const settings = await readBuiltInCapabilitySystemSettings(c);
	return listBuiltInSmallTCapabilities().map((capability) => {
		const setting = settings.get(capability.key) ?? null;
		return AdminBuiltInCapabilitySchema.parse({
			...capability,
			requiredTools: [...capability.requiredTools],
			sideEffects: [...capability.sideEffects],
			enabled: setting?.enabled ?? true,
			updatedAt: setting?.updatedAt ?? null,
			updatedByUserId: setting?.updatedByUserId ?? null,
		});
	});
}

export async function updateAdminBuiltInCapabilityState(
	c: AppContext,
	actorUserId: string,
	capabilityKey: string,
	enabled: boolean,
): Promise<AdminBuiltInCapability> {
	requireAdmin(c);
	const normalizedCapabilityKey = capabilityKey.trim();
	const capability = listBuiltInSmallTCapabilities().find(
		(item) => item.key === normalizedCapabilityKey,
	);
	if (!capability) {
		throw new AppError("内置能力不存在", {
			status: 404,
			code: "admin_builtin_capability_not_found",
			details: { capabilityKey: normalizedCapabilityKey },
		});
	}
	const now = new Date().toISOString();
	const row = await c.env.DB.agent_builtin_capability_settings.upsert({
		where: { capability_id: normalizedCapabilityKey },
		create: {
			capability_id: normalizedCapabilityKey,
			enabled: enabled ? 1 : 0,
			updated_by_user_id: actorUserId,
			created_at: now,
			updated_at: now,
		},
		update: {
			enabled: enabled ? 1 : 0,
			updated_by_user_id: actorUserId,
			updated_at: now,
		},
	});
	return AdminBuiltInCapabilitySchema.parse({
		...capability,
		requiredTools: [...capability.requiredTools],
		sideEffects: [...capability.sideEffects],
		enabled: row.enabled === 1,
		updatedAt: row.updated_at,
		updatedByUserId: row.updated_by_user_id,
	});
}
