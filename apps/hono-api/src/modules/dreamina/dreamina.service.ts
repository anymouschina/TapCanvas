import { randomUUID } from "node:crypto";
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { getProjectForOwner } from "../project/project.repo";
import type { TaskRequestDto } from "../task/task.schemas";
import {
	buildDreaminaSessionRoot,
	runDreaminaCli,
} from "./dreamina.runner";
import {
	deleteDreaminaAccountForOwner,
	deleteDreaminaProjectBindingForOwner,
	getDreaminaAccountByIdForOwner,
	getDreaminaProjectBindingForOwner,
	listDreaminaAccountsByOwner,
	type DreaminaAccountRow,
	type DreaminaProjectBindingRow,
	updateDreaminaAccountProbeRow,
	upsertDreaminaAccountRow,
	upsertDreaminaProjectBindingRow,
} from "./dreamina.repo";
import {
	DreaminaAccountProbeSchema,
	DreaminaAccountSchema,
	DreaminaProjectBindingSchema,
	type DreaminaAccountDto,
	type DreaminaAccountProbeDto,
	type DreaminaProjectBindingDto,
} from "./dreamina.schemas";

type JsonRecord = Record<string, unknown>;

function parseOptionalJson(value: string | null): unknown {
	if (!value) return undefined;
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

function mapAccount(row: DreaminaAccountRow): DreaminaAccountDto {
	return DreaminaAccountSchema.parse({
		id: row.id,
		ownerId: row.owner_id,
		label: row.label,
		cliPath: row.cli_path,
		sessionRoot: row.session_root,
		enabled: Number(row.enabled ?? 0) !== 0,
		lastHealthcheckAt: row.last_healthcheck_at,
		lastLoginAt: row.last_login_at,
		lastError: row.last_error,
		meta: parseOptionalJson(row.meta_json),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

function mapBinding(row: DreaminaProjectBindingRow): DreaminaProjectBindingDto {
	return DreaminaProjectBindingSchema.parse({
		id: row.id,
		ownerId: row.owner_id,
		projectId: row.project_id,
		accountId: row.account_id,
		enabled: Number(row.enabled ?? 0) !== 0,
		defaultModelVersion: row.default_model_version,
		defaultRatio: row.default_ratio,
		defaultResolutionType: row.default_resolution_type,
		defaultVideoResolution: row.default_video_resolution,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

function trimOptionalString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function extractJsonObject(text: string): JsonRecord | null {
	const trimmed = String(text || "").trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
		try {
			const parsed = JSON.parse(trimmed);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as JsonRecord;
			}
		} catch {
			// ignore
		}
	}
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start >= 0 && end > start) {
		try {
			const parsed = JSON.parse(trimmed.slice(start, end + 1));
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as JsonRecord;
			}
		} catch {
			// ignore
		}
	}
	return null;
}

function extractSimpleField(text: string, field: string): string | null {
	const match = text.match(new RegExp(`${field}\\s*[:=]\\s*["']?([^"'\\n]+)["']?`, "i"));
	return match?.[1]?.trim() || null;
}

async function requireAccountForOwner(
	c: AppContext,
	ownerId: string,
	accountId: string,
): Promise<DreaminaAccountRow> {
	const account = await getDreaminaAccountByIdForOwner(c.env.DB, accountId, ownerId);
	if (!account) {
		throw new AppError("Dreamina 账号不存在", {
			status: 404,
			code: "dreamina_account_not_found",
		});
	}
	return account;
}

async function requireProjectForOwner(
	c: AppContext,
	ownerId: string,
	projectId: string,
): Promise<void> {
	const project = await getProjectForOwner(c.env.DB, projectId, ownerId);
	if (!project) {
		throw new AppError("Project not found", {
			status: 404,
			code: "project_not_found",
		});
	}
}

export async function listDreaminaAccounts(
	c: AppContext,
	ownerId: string,
): Promise<DreaminaAccountDto[]> {
	const rows = await listDreaminaAccountsByOwner(c.env.DB, ownerId);
	return rows.map(mapAccount);
}

export async function upsertDreaminaAccount(
	c: AppContext,
	ownerId: string,
	input: {
		id?: string;
		label: string;
		cliPath?: string | null;
		enabled?: boolean;
		meta?: unknown;
	},
): Promise<DreaminaAccountDto> {
	const nowIso = new Date().toISOString();
	const nextId = (input.id || "").trim() || randomUUID();
	const sessionRoot = buildDreaminaSessionRoot(ownerId, nextId);
	const row = await upsertDreaminaAccountRow(c.env.DB, {
		id: nextId,
		ownerId,
		label: input.label.trim(),
		cliPath: trimOptionalString(input.cliPath) || null,
		sessionRoot,
		enabled: input.enabled !== false,
		metaJson: typeof input.meta === "undefined" ? null : JSON.stringify(input.meta),
		nowIso,
	});
	return mapAccount(row);
}

export async function deleteDreaminaAccount(
	c: AppContext,
	ownerId: string,
	accountId: string,
): Promise<void> {
	await requireAccountForOwner(c, ownerId, accountId);
	await deleteDreaminaAccountForOwner(c.env.DB, accountId, ownerId);
}

export async function probeDreaminaAccount(
	c: AppContext,
	ownerId: string,
	accountId: string,
): Promise<DreaminaAccountProbeDto> {
	const account = await requireAccountForOwner(c, ownerId, accountId);
	const checkedAt = new Date().toISOString();

	const versionRun = await runDreaminaCli({
		c,
		cliPath: account.cli_path,
		sessionRoot: account.session_root,
		args: ["version"],
		timeoutMs: 20_000,
	});

	const creditRun = await runDreaminaCli({
		c,
		cliPath: account.cli_path,
		sessionRoot: account.session_root,
		args: ["user_credit"],
		timeoutMs: 20_000,
	});

	const loggedIn =
		creditRun.exitCode === 0 &&
		!creditRun.stdout.includes("未检测到有效登录态") &&
		!creditRun.stderr.includes("未检测到有效登录态");
	const creditText = trimOptionalString(creditRun.stdout) || trimOptionalString(creditRun.stderr);
	const message = loggedIn
		? "Dreamina 账号可用"
		: trimOptionalString(creditRun.stderr) ||
			trimOptionalString(creditRun.stdout) ||
			"Dreamina 账号未登录";

	await updateDreaminaAccountProbeRow(c.env.DB, {
		id: account.id,
		ownerId,
		lastHealthcheckAt: checkedAt,
		lastLoginAt: loggedIn ? checkedAt : account.last_login_at,
		lastError: loggedIn ? null : message,
	});

	return DreaminaAccountProbeSchema.parse({
		accountId,
		ok: loggedIn,
		version: trimOptionalString(versionRun.stdout) || trimOptionalString(versionRun.stderr),
		loggedIn,
		creditText,
		message,
		stdout: trimOptionalString(creditRun.stdout),
		stderr: trimOptionalString(creditRun.stderr),
		checkedAt,
	});
}

export async function importDreaminaLoginResponse(
	c: AppContext,
	ownerId: string,
	accountId: string,
	loginResponseJson: string,
): Promise<DreaminaAccountProbeDto> {
	const account = await requireAccountForOwner(c, ownerId, accountId);
	const run = await runDreaminaCli({
		c,
		cliPath: account.cli_path,
		sessionRoot: account.session_root,
		args: ["import_login_response"],
		stdinText: loginResponseJson,
		timeoutMs: 30_000,
	});
	if (run.exitCode !== 0) {
		throw new AppError("Dreamina 登录态导入失败", {
			status: 400,
			code: "dreamina_import_login_failed",
			details: {
				stdout: trimOptionalString(run.stdout),
				stderr: trimOptionalString(run.stderr),
			},
		});
	}
	return await probeDreaminaAccount(c, ownerId, accountId);
}

export async function getDreaminaProjectBinding(
	c: AppContext,
	ownerId: string,
	projectId: string,
): Promise<DreaminaProjectBindingDto | null> {
	await requireProjectForOwner(c, ownerId, projectId);
	const row = await getDreaminaProjectBindingForOwner(c.env.DB, projectId, ownerId);
	return row ? mapBinding(row) : null;
}

export async function upsertDreaminaProjectBinding(
	c: AppContext,
	ownerId: string,
	projectId: string,
	input: {
		accountId: string;
		enabled?: boolean;
		defaultModelVersion?: string | null;
		defaultRatio?: string | null;
		defaultResolutionType?: string | null;
		defaultVideoResolution?: string | null;
	},
): Promise<DreaminaProjectBindingDto> {
	await requireProjectForOwner(c, ownerId, projectId);
	await requireAccountForOwner(c, ownerId, input.accountId);
	const nowIso = new Date().toISOString();
	const row = await upsertDreaminaProjectBindingRow(c.env.DB, {
		projectId,
		ownerId,
		accountId: input.accountId,
		enabled: input.enabled !== false,
		defaultModelVersion: trimOptionalString(input.defaultModelVersion),
		defaultRatio: trimOptionalString(input.defaultRatio),
		defaultResolutionType: trimOptionalString(input.defaultResolutionType),
		defaultVideoResolution: trimOptionalString(input.defaultVideoResolution),
		nowIso,
	});
	return mapBinding(row);
}

export async function deleteDreaminaProjectBinding(
	c: AppContext,
	ownerId: string,
	projectId: string,
): Promise<void> {
	await requireProjectForOwner(c, ownerId, projectId);
	await deleteDreaminaProjectBindingForOwner(c.env.DB, projectId, ownerId);
}

type ResolvedDreaminaTaskContext = {
	account: DreaminaAccountRow;
	binding: DreaminaProjectBindingRow | null;
	projectId: string | null;
	accountId: string;
};

export async function resolveDreaminaTaskContext(
	c: AppContext,
	ownerId: string,
	input: {
		projectId?: string | null;
		accountId?: string | null;
	},
): Promise<ResolvedDreaminaTaskContext> {
	const explicitAccountId = trimOptionalString(input.accountId);
	const projectId = trimOptionalString(input.projectId);
	if (explicitAccountId) {
		const account = await requireAccountForOwner(c, ownerId, explicitAccountId);
		return {
			account,
			binding: null,
			projectId,
			accountId: account.id,
		};
	}
	if (!projectId) {
		throw new AppError("Dreamina 任务缺少 projectId，无法解析项目绑定账号", {
			status: 400,
			code: "dreamina_project_binding_required",
		});
	}
	const binding = await getDreaminaProjectBindingForOwner(c.env.DB, projectId, ownerId);
	if (!binding || Number(binding.enabled ?? 0) === 0) {
		throw new AppError("当前项目未绑定可用的 Dreamina 账号", {
			status: 400,
			code: "dreamina_project_binding_missing",
			details: { projectId },
		});
	}
	const account = await requireAccountForOwner(c, ownerId, binding.account_id);
	return {
		account,
		binding,
		projectId,
		accountId: account.id,
	};
}
