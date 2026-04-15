import { randomUUID } from "node:crypto";
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { getProjectForOwner } from "../project/project.repo";
import { TaskAssetSchema, TaskResultSchema, type TaskKind, type TaskRequestDto, type TaskResultDto } from "../task/task.schemas";
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

function parseDreaminaSubmitPayload(stdout: string, stderr: string): {
	submitId: string | null;
	genStatus: string | null;
	failReason: string | null;
	raw: unknown;
} {
	const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
	const json = extractJsonObject(combined);
	const submitId =
		trimOptionalString(json?.submit_id) ||
		extractSimpleField(combined, "submit_id");
	const genStatus =
		trimOptionalString(json?.gen_status) ||
		extractSimpleField(combined, "gen_status");
	const failReason =
		trimOptionalString(json?.fail_reason) ||
		extractSimpleField(combined, "fail_reason");
	return {
		submitId,
		genStatus: genStatus ? genStatus.toLowerCase() : null,
		failReason,
		raw: json || combined,
	};
}

function collectUrls(value: unknown, out: string[]): void {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (/^https?:\/\//i.test(trimmed)) out.push(trimmed);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectUrls(item, out);
		return;
	}
	if (!value || typeof value !== "object") return;
	for (const nested of Object.values(value as JsonRecord)) collectUrls(nested, out);
}

function inferAssetTypeFromUrl(url: string): "image" | "video" | null {
	const normalized = url.toLowerCase();
	if (/\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(normalized)) return "image";
	if (/\.(mp4|mov|webm|mkv)(\?|$)/i.test(normalized)) return "video";
	return null;
}

function buildAssetsFromQueryPayload(
	payload: unknown,
): Array<ReturnType<typeof TaskAssetSchema.parse>> {
	const urls: string[] = [];
	collectUrls(payload, urls);
	const uniqueUrls = Array.from(new Set(urls));
	return uniqueUrls
		.map((url) => {
			const type = inferAssetTypeFromUrl(url);
			if (!type) return null;
			return TaskAssetSchema.parse({ type, url });
		})
		.filter((item): item is ReturnType<typeof TaskAssetSchema.parse> => item !== null);
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

function buildDreaminaSubmitArgs(
	req: TaskRequestDto,
	binding: DreaminaProjectBindingRow | null,
): string[] {
	const extras = (req.extras || {}) as Record<string, unknown>;
	const modelVersion =
		trimOptionalString(extras.modelVersion) ||
		trimOptionalString(extras.modelAlias) ||
		trimOptionalString(extras.modelKey) ||
		binding?.default_model_version ||
		null;
	const ratio =
		trimOptionalString(extras.ratio) ||
		binding?.default_ratio ||
		null;
	const resolutionType =
		trimOptionalString(extras.resolutionType) ||
		binding?.default_resolution_type ||
		null;
	const videoResolution =
		trimOptionalString(extras.videoResolution) ||
		binding?.default_video_resolution ||
		null;
	const durationRaw = Number(extras.duration ?? extras.durationSeconds ?? 0);
	const duration =
		Number.isFinite(durationRaw) && durationRaw > 0 ? Math.floor(durationRaw) : null;

	if (req.kind === "text_to_image") {
		const args = ["text2image", `--prompt=${req.prompt}`];
		if (ratio) args.push(`--ratio=${ratio}`);
		if (resolutionType) args.push(`--resolution_type=${resolutionType}`);
		if (modelVersion) args.push(`--model_version=${modelVersion}`);
		return args;
	}
	if (req.kind === "text_to_video") {
		const args = ["text2video", `--prompt=${req.prompt}`];
		if (duration) args.push(`--duration=${duration}`);
		if (ratio) args.push(`--ratio=${ratio}`);
		if (videoResolution) args.push(`--video_resolution=${videoResolution}`);
		if (modelVersion) args.push(`--model_version=${modelVersion}`);
		return args;
	}
	throw new AppError("Dreamina 当前仅支持 text_to_image / text_to_video", {
		status: 400,
		code: "dreamina_unsupported_task_kind",
		details: { taskKind: req.kind },
	});
}

export async function submitDreaminaTask(
	c: AppContext,
	ownerId: string,
	req: TaskRequestDto,
): Promise<TaskResultDto> {
	const extras = (req.extras || {}) as Record<string, unknown>;
	const resolved = await resolveDreaminaTaskContext(c, ownerId, {
		projectId:
			trimOptionalString(extras.canvasProjectId) || trimOptionalString(extras.projectId),
		accountId: trimOptionalString(extras.dreaminaAccountId),
	});
	const probe = await probeDreaminaAccount(c, ownerId, resolved.account.id);
	if (!probe.loggedIn) {
		throw new AppError("Dreamina 账号未登录，请先在 Web 端导入登录态", {
			status: 400,
			code: "dreamina_not_logged_in",
			details: { accountId: resolved.account.id, message: probe.message },
		});
	}

	const run = await runDreaminaCli({
		c,
		cliPath: resolved.account.cli_path,
		sessionRoot: resolved.account.session_root,
		args: buildDreaminaSubmitArgs(req, resolved.binding),
		timeoutMs: 60_000,
	});
	if (run.exitCode !== 0) {
		throw new AppError("Dreamina 任务提交失败", {
			status: 400,
			code: "dreamina_submit_failed",
			details: {
				stdout: trimOptionalString(run.stdout),
				stderr: trimOptionalString(run.stderr),
			},
		});
	}

	const parsed = parseDreaminaSubmitPayload(run.stdout, run.stderr);
	if (!parsed.submitId) {
		throw new AppError("Dreamina 提交返回缺少 submit_id", {
			status: 500,
			code: "dreamina_submit_id_missing",
			details: parsed.raw,
		});
	}
	if (parsed.genStatus === "fail") {
		throw new AppError(parsed.failReason || "Dreamina 提交失败", {
			status: 400,
			code: "dreamina_submit_rejected",
			details: parsed.raw,
		});
	}

	return TaskResultSchema.parse({
		id: parsed.submitId,
		kind: req.kind,
		status: parsed.genStatus === "success" ? "succeeded" : "running",
		assets: [],
		raw: {
			vendor: "dreamina-cli",
			submitId: parsed.submitId,
			genStatus: parsed.genStatus || "querying",
			accountId: resolved.accountId,
			projectId: resolved.projectId,
			stdout: trimOptionalString(run.stdout),
			stderr: trimOptionalString(run.stderr),
			payload: parsed.raw,
		},
	});
}

export async function fetchDreaminaTaskResult(
	c: AppContext,
	ownerId: string,
	input: {
		taskId: string;
		taskKind: TaskKind;
		projectId?: string | null;
		accountId?: string | null;
	},
): Promise<TaskResultDto> {
	const resolved = await resolveDreaminaTaskContext(c, ownerId, {
		projectId: input.projectId,
		accountId: input.accountId,
	});
	const run = await runDreaminaCli({
		c,
		cliPath: resolved.account.cli_path,
		sessionRoot: resolved.account.session_root,
		args: ["query_result", `--submit_id=${input.taskId}`],
		timeoutMs: 60_000,
	});
	if (run.exitCode !== 0) {
		throw new AppError("Dreamina 查询任务失败", {
			status: 400,
			code: "dreamina_query_failed",
			details: {
				stdout: trimOptionalString(run.stdout),
				stderr: trimOptionalString(run.stderr),
			},
		});
	}
	const parsed = parseDreaminaSubmitPayload(run.stdout, run.stderr);
	const assets = buildAssetsFromQueryPayload(parsed.raw);
	const status =
		parsed.genStatus === "success"
			? "succeeded"
			: parsed.genStatus === "fail"
				? "failed"
				: "running";

	return TaskResultSchema.parse({
		id: input.taskId,
		kind: input.taskKind,
		status,
		assets,
		raw: {
			vendor: "dreamina-cli",
			submitId: input.taskId,
			genStatus: parsed.genStatus || "querying",
			failReason: parsed.failReason,
			accountId: resolved.accountId,
			projectId: resolved.projectId,
			stdout: trimOptionalString(run.stdout),
			stderr: trimOptionalString(run.stderr),
			payload: parsed.raw,
		},
	});
}
