import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import fs from "node:fs/promises";
import path from "node:path";
import { isAdminRequest } from "../team/team.service";
import { getProjectById, getProjectForOwner } from "../project/project.repo";
import { getFlowForOwner, mapFlowRowToDto, type FlowRow } from "../flow/flow.repo";
import { resolveProjectDataRepoRoot } from "../asset/project-data-root";
import {
	BookIndexStoreError,
	readBookIndex,
	type BookIndexRecord,
} from "../asset/book-index-store";
import {
	AgentSkillSchema,
	AgentPipelineRunSchema,
	type AgentDiagnosticsResponseDto,
	type AgentDiagnosticsQueryDto,
	type ProjectWorkspaceContextDto,
	type UpdateGlobalWorkspaceContextFileRequestDto,
	type UpdateProjectWorkspaceContextFileRequestDto,
	type AgentSkillDto,
	type AgentPipelineRunDto,
	type UpsertAgentSkillRequestDto,
	type CreateAgentPipelineRunRequestDto,
	type UpdateAgentPipelineRunStatusRequestDto,
	type ProjectWorkspaceContextVerifyResponseDto,
	type RollbackGlobalWorkspaceContextFileRequestDto,
	type RollbackProjectWorkspaceContextFileRequestDto,
} from "./agents.schemas";
import {
	createAgentPipelineRunRow,
	deleteAgentSkillRow,
	getAgentPipelineRunRowById,
	getAgentSkillRowById,
	getAgentSkillRowByKey,
	listAgentPipelineRunsRows,
	listAgentSkillsRows,
	updateAgentPipelineRunRow,
	upsertAgentSkillRow,
	type AgentPipelineRunRow,
	type AgentSkillRow,
} from "./agents.repo";
import { listUserExecutionTraces } from "../memory/memory.service";
import { queryExecutionTraceHealth } from "../memory/execution-trace-events.repo";
import {
	listRecentPublicChatTurnRuns,
	type PublicChatTurnRunRow,
} from "../apiKey/public-chat-session.repo";
import { listStoryboardDiagnosticLogs } from "../storyboard/storyboard.repo";
import {
	captureAgentRegressionExample,
	queryAgentObservability,
	submitAgentHumanFeedback,
} from "./agent-observability.service";
import type {
	CreateAgentHumanFeedbackRequestDto,
	CreateAgentRegressionExampleRequestDto,
} from "./agent-observability.schemas";
import {
	listExecutionEvents,
	listExecutionsForOwnerFlow,
	listNodeRunsForExecutionOwner,
	mapExecutionEventRow,
	mapExecutionRow,
	mapNodeRunRow,
} from "../execution/execution.repo";
import type { StoryboardStructuredData } from "../storyboard/storyboard-structure";
import {
	requireExactStoryboardPreviousChunk,
	requireStoryboardV12ArtifactPayload,
} from "../storyboard/storyboard-persistence-contract";
import {
	getGlobalWorkspaceContextFileVersionContent,
	getProjectWorkspaceContext,
	getProjectWorkspaceContextFileVersionContent,
	rollbackGlobalWorkspaceContextFileVersion,
	rollbackProjectWorkspaceContextFileVersion,
	updateGlobalWorkspaceContextFile,
	updateProjectWorkspaceContextFile,
	type ProjectWorkspaceContextFileDto,
	type ProjectWorkspaceContextFileVersionContentDto,
} from "./project-context.service";

function requireAdmin(c: AppContext): void {
	if (!isAdminRequest(c)) {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
}

function normalizeKey(value: unknown): string {
	const trimmed = typeof value === "string" ? value.trim() : "";
	return trimmed;
}

function extractTraceMetaValue(
	meta: Record<string, unknown> | null,
	key: string,
): string {
	if (!meta) return "";
	const value = meta[key];
	if (typeof value !== "string") return "";
	const trimmed = value.trim();
	return trimmed ? trimmed : "";
}

function matchesDiagnosticsFilter(
	meta: Record<string, unknown> | null,
	input: {
		projectId?: string;
		bookId?: string;
		chapterId?: string;
		flowId?: string;
		nodeId?: string;
		label?: string;
	},
): boolean {
	const projectId = input.projectId ? extractTraceMetaValue(meta, "projectId") : "";
	const bookId = input.bookId ? extractTraceMetaValue(meta, "bookId") : "";
	const chapterId = input.chapterId ? extractTraceMetaValue(meta, "chapterId") : "";
	const flowId = input.flowId ? extractTraceMetaValue(meta, "flowId") : "";
	const nodeId = input.nodeId ? extractTraceMetaValue(meta, "nodeId") : "";
	const label = input.label ? extractTraceMetaValue(meta, "label") : "";
	if (input.projectId && projectId !== input.projectId) return false;
	if (input.bookId && bookId !== input.bookId) return false;
	if (input.chapterId && chapterId !== input.chapterId) return false;
	if (input.flowId && flowId !== input.flowId) return false;
	if (input.nodeId && nodeId !== input.nodeId) return false;
	if (input.label && label !== input.label) return false;
	return true;
}

function normalizeOptionalString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function parseJsonValue<T>(raw: string | null | undefined, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function mapPublicChatTurnRunRow(row: PublicChatTurnRunRow) {
	return {
		id: row.id,
		sessionId: row.session_id,
		sessionKey: row.session_key,
		requestId: normalizeOptionalString(row.request_id),
		projectId: normalizeOptionalString(row.project_id),
		bookId: normalizeOptionalString(row.book_id),
		chapterId: normalizeOptionalString(row.chapter_id),
		label: normalizeOptionalString(row.label),
		workflowKey: row.workflow_key,
		requestKind: row.request_kind,
		userMessageId: normalizeOptionalString(row.user_message_id),
		assistantMessageId: normalizeOptionalString(row.assistant_message_id),
		outputMode: row.output_mode,
		turnVerdict: row.turn_verdict,
		turnVerdictReasons: parseJsonValue<string[]>(row.turn_verdict_reasons_json, []),
		runOutcome: row.run_outcome,
		agentDecision: parseJsonValue<Record<string, unknown> | null>(row.agent_decision_json, null),
		toolStatusSummary: parseJsonValue<Record<string, unknown> | null>(
			row.tool_status_summary_json,
			null,
		),
		diagnosticFlags: parseJsonValue<Array<Record<string, unknown>>>(
			row.diagnostic_flags_json,
			[],
		),
		canvasPlan: parseJsonValue<Record<string, unknown> | null>(row.canvas_plan_json, null),
		assetCount: Math.max(0, Math.trunc(Number(row.asset_count || 0))),
		canvasWrite: Number(row.canvas_write || 0) === 1,
		runMs:
			typeof row.run_ms === "number" && Number.isFinite(row.run_ms)
				? Math.max(0, Math.trunc(row.run_ms))
				: null,
		createdAt: row.created_at,
	} as const;
}

function normalizeRequiredString(value: unknown, label: string): string {
	const trimmed = typeof value === "string" ? value.trim() : "";
	if (!trimmed) {
		throw new AppError(`${label} 不能为空`, {
			status: 400,
			code: "invalid_request",
		});
	}
	return trimmed;
}

function mapAgentSkillRow(row: AgentSkillRow): AgentSkillDto {
	return AgentSkillSchema.parse({
		id: row.id,
		key: row.key,
		name: row.name,
		description: row.description ?? null,
		content: row.content,
		logoUrl: row.logo_url ?? null,
		category: row.category || "系统技能",
		enabled: Number(row.enabled ?? 1) !== 0,
		visible: Number(row.visible ?? 1) !== 0,
		sortOrder:
			typeof row.sort_order === "number" && Number.isFinite(row.sort_order)
				? Math.trunc(row.sort_order)
				: row.sort_order ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

function parseJsonSafe(value: string | null | undefined): unknown {
	if (typeof value !== "string" || !value.trim()) return undefined;
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}


function mapAgentPipelineRunRow(row: AgentPipelineRunRow): AgentPipelineRunDto {
	const parsedStages = parseJsonSafe(row.stages_json);
	const stages = Array.isArray(parsedStages) ? parsedStages : [];
	return AgentPipelineRunSchema.parse({
		id: row.id,
		ownerId: row.owner_id,
		projectId: row.project_id,
		title: row.title,
		goal: row.goal ?? null,
		status: row.status,
		stages,
		progress: parseJsonSafe(row.progress_json),
		result: parseJsonSafe(row.result_json),
		errorMessage: row.error_message ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		startedAt: row.started_at ?? null,
		finishedAt: row.finished_at ?? null,
	});
}

const DEFAULT_PUBLIC_AGENT_SKILL_KEY = "skill_default";
const BUILTIN_REPLICATE_SKILL_KEY = "tapcanvas-replicate";
const BUILTIN_REPLICATE_SKILL_ID = "builtin_tapcanvas_replicate";
const BUILTIN_REPLICATE_SKILL_SORT_ORDER = -100;
const BUILTIN_REPLICATE_SKILL_CONTENT = [
	"你是 TapCanvas 的“复刻/替换”基础能力。",
	"",
	"目标：把用户提供的多资产输入（assetInputs）用于图像复刻与主体替换。",
	"",
	"输入约定：",
	"- assetInputs 支持 N 张图，不写死两图。",
	"- 常见角色：target(被改造图)、reference/character/product/style/context/mask。",
	"- 若存在 role=target，优先保持 target 的构图与版式，仅替换主体身份与局部特征。",
	"",
	"执行原则：",
	"- 语义理解由你完成；系统不会用本地正则做语义决策。",
	"- 若当前请求已经绑定章节文本、分镜脚本、视频节点或 project-grounded 画布生产上下文，assetInputs 只应视作视觉锚点；不得仅因存在 target/reference 就把任务劫持为复刻链。",
	"- 只有当用户明确要求“复刻/替换/保持版式替换主体/沿用原图结构重做主体/在既有图上换人换物”时，才应把本技能作为主路径。",
	"- 若输入包含多个 reference，请先抽取一致性锚点（轮廓、材质、配色、关键识别特征），再统一应用。",
	"- 对 9 宫格/分镜类任务，优先保持镜头顺序与分格结构，逐格替换主体身份。",
	"- 对带版式与文字区的设计图任务，优先保持信息层级与版式骨架，替换主体并保持可读文案区域。",
	"",
	"失败策略：",
	"- 关键资产不足或冲突时必须明确报错原因，不做静默兜底。",
	"- 若某一轮无法满足一致性约束，直接说明冲突项并要求补充资产。",
].join("\n");

function getBuiltinReplicateSkill(nowIso: string): AgentSkillDto {
	return AgentSkillSchema.parse({
		id: BUILTIN_REPLICATE_SKILL_ID,
		key: BUILTIN_REPLICATE_SKILL_KEY,
		name: "复刻与主体替换",
		description: "基础能力：支持多资产输入（N 张图）进行角色/产品复刻与替换。",
		content: BUILTIN_REPLICATE_SKILL_CONTENT,
		logoUrl: null,
		category: "系统技能",
		enabled: true,
		visible: true,
		sortOrder: BUILTIN_REPLICATE_SKILL_SORT_ORDER,
		createdAt: nowIso,
		updatedAt: nowIso,
	});
}

function mergeBuiltinPublicSkills(skills: AgentSkillDto[]): AgentSkillDto[] {
	const nowIso = new Date().toISOString();
	const out = [...skills];
	const existing = out.find((item) => item.key === BUILTIN_REPLICATE_SKILL_KEY);
	if (!existing) {
		out.push(getBuiltinReplicateSkill(nowIso));
	}
	return out.sort((a, b) => {
		const sa = typeof a.sortOrder === "number" ? a.sortOrder : Number.MAX_SAFE_INTEGER;
		const sb = typeof b.sortOrder === "number" ? b.sortOrder : Number.MAX_SAFE_INTEGER;
		if (sa !== sb) return sa - sb;
		return String(a.updatedAt || "").localeCompare(String(b.updatedAt || ""));
	});
}

export async function getPublicAgentSkill(
	c: AppContext,
): Promise<AgentSkillDto | null> {
	const byKey = await getAgentSkillRowByKey(
		c.env.DB,
		DEFAULT_PUBLIC_AGENT_SKILL_KEY,
	);
	if (byKey) {
		const enabled = Number(byKey.enabled ?? 1) !== 0;
		const visible = Number(byKey.visible ?? 1) !== 0;
		return enabled && visible ? mapAgentSkillRow(byKey) : null;
	}

	const rows = await listAgentSkillsRows(c.env.DB, { enabled: true, visible: true });
	const merged = mergeBuiltinPublicSkills(rows.map(mapAgentSkillRow));
	const first = merged[0];
	return first ?? null;
}

export async function listPublicAgentSkills(
	c: AppContext,
): Promise<AgentSkillDto[]> {
	const rows = await listAgentSkillsRows(c.env.DB, { enabled: true, visible: true });
	return mergeBuiltinPublicSkills(rows.map(mapAgentSkillRow));
}

export async function listAdminAgentSkills(
	c: AppContext,
): Promise<AgentSkillDto[]> {
	requireAdmin(c);
	const rows = await listAgentSkillsRows(c.env.DB);
	return rows.map(mapAgentSkillRow);
}

export async function upsertAdminAgentSkill(
	c: AppContext,
	input: UpsertAgentSkillRequestDto,
): Promise<AgentSkillDto> {
	requireAdmin(c);

	const requestedId =
		typeof input.id === "string" && input.id.trim() ? input.id.trim() : "";
	const requestedKey = normalizeKey(input.key);

	const existingById = requestedId
		? await getAgentSkillRowById(c.env.DB, requestedId)
		: null;
	if (existingById && requestedKey && requestedKey !== existingById.key) {
		throw new AppError("key 不允许修改", {
			status: 400,
			code: "invalid_request",
		});
	}
	const existingByKey =
		!existingById && requestedKey
			? await getAgentSkillRowByKey(c.env.DB, requestedKey)
			: null;
	const existing: AgentSkillRow | null = existingById || existingByKey;

	const key =
		requestedKey ||
		existing?.key ||
		`skill_${crypto.randomUUID()}`;
	const id = existing?.id || requestedId || crypto.randomUUID();

	const name = normalizeRequiredString(
		normalizeOptionalString(input.name) || existing?.name || key,
		"name",
	);

	const hasDescription = Object.prototype.hasOwnProperty.call(
		input,
		"description",
	);
	const description = hasDescription
		? normalizeOptionalString(input.description)
		: (existing?.description ?? null);
	const logoUrl = Object.prototype.hasOwnProperty.call(input, "logoUrl")
		? normalizeOptionalString(input.logoUrl)
		: (existing?.logo_url ?? null);
	const category = normalizeOptionalString(input.category) || existing?.category || "系统技能";

	const hasContent = Object.prototype.hasOwnProperty.call(input, "content");
	const content = hasContent
		? normalizeRequiredString(input.content, "content")
		: existing
			? existing.content
			: normalizeRequiredString(input.content, "content");

	const enabled =
		typeof input.enabled === "boolean"
			? input.enabled
			: existing
				? Number(existing.enabled ?? 1) !== 0
				: true;
	const visible =
		typeof input.visible === "boolean"
			? input.visible
			: existing
				? Number(existing.visible ?? 1) !== 0
				: true;
	const sortOrder = (() => {
		if (Object.prototype.hasOwnProperty.call(input, "sortOrder")) {
			if (typeof input.sortOrder === "number" && Number.isFinite(input.sortOrder)) {
				return Math.trunc(input.sortOrder);
			}
			return input.sortOrder === null ? null : null;
		}
		if (existing) {
			return typeof existing.sort_order === "number" && Number.isFinite(existing.sort_order)
				? Math.trunc(existing.sort_order)
				: existing.sort_order ?? null;
		}
		return null;
	})();

	const nowIso = new Date().toISOString();
	const row = await upsertAgentSkillRow(
		c.env.DB,
		{
			id,
			key,
			name,
			description,
			content,
			logoUrl,
			category,
			enabled,
			visible,
			sortOrder,
		},
		nowIso,
	);
	return mapAgentSkillRow(row);
}

export async function deleteAdminAgentSkill(
	c: AppContext,
	id: string,
): Promise<void> {
	requireAdmin(c);
	const existing = await getAgentSkillRowById(c.env.DB, id);
	if (!existing) {
		throw new AppError("未找到该 skill", {
			status: 404,
			code: "skill_not_found",
		});
	}
	await deleteAgentSkillRow(c.env.DB, id);
}

export async function getAdminAgentSkillById(
	c: AppContext,
	id: string,
): Promise<AgentSkillDto> {
	requireAdmin(c);
	const row = await getAgentSkillRowById(c.env.DB, id);
	if (!row) {
		throw new AppError("未找到该 skill", {
			status: 404,
			code: "skill_not_found",
		});
	}
	return mapAgentSkillRow(row);
}

export async function createUserAgentPipelineRun(
	c: AppContext,
	userId: string,
	input: CreateAgentPipelineRunRequestDto,
): Promise<AgentPipelineRunDto> {
	const projectId = input.projectId.trim();
	const ownedProject = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!ownedProject) {
		throw new AppError("Project not found", {
			status: 400,
			code: "project_not_found",
		});
	}
	const nowIso = new Date().toISOString();
	const row = await createAgentPipelineRunRow(c.env.DB, {
		id: crypto.randomUUID(),
		ownerId: userId,
		projectId,
		title: input.title.trim(),
		goal:
			typeof input.goal === "string" && input.goal.trim()
				? input.goal.trim()
				: null,
		status: "queued",
		stagesJson: JSON.stringify(input.stages),
		nowIso,
	});
	return mapAgentPipelineRunRow(row);
}

async function assertProjectWorkspaceContextAccess(
	c: AppContext,
	userId: string,
	projectId: string,
): Promise<string> {
	if (isAdminRequest(c)) {
		const project = await getProjectById(c.env.DB, projectId);
		if (!project) {
			throw new AppError("Project not found", { status: 404, code: "project_not_found" });
		}
		const ownerId = typeof project.owner_id === "string" ? project.owner_id.trim() : "";
		if (!ownerId) {
			throw new AppError("Project owner is missing", {
				status: 500,
				code: "project_owner_missing",
				details: { projectId },
			});
		}
		return ownerId;
	}
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) {
		throw new AppError("Project not found or no permission", {
			status: 403,
			code: "project_context_forbidden",
			details: { projectId },
		});
	}
	return userId;
}

export async function getUserProjectWorkspaceContext(
	c: AppContext,
	userId: string,
	input: {
		projectId: string;
		bookId?: string;
		chapter?: number | null;
		refresh?: boolean;
	},
): Promise<ProjectWorkspaceContextDto> {
	const ownerId = await assertProjectWorkspaceContextAccess(c, userId, input.projectId);
	return getProjectWorkspaceContext({
		c,
		ownerId,
		projectId: input.projectId,
		...(input.bookId ? { bookId: input.bookId } : {}),
		...(typeof input.chapter === "number" ? { chapter: input.chapter } : {}),
		...(input.refresh === true ? { refresh: true } : {}),
	});
}

export async function updateUserProjectWorkspaceContextFile(
	c: AppContext,
	userId: string,
	input: UpdateProjectWorkspaceContextFileRequestDto,
): Promise<ProjectWorkspaceContextDto> {
	const ownerId = await assertProjectWorkspaceContextAccess(c, userId, input.projectId);
	await updateProjectWorkspaceContextFile({
		c,
		ownerId,
		projectId: input.projectId,
		fileName: input.fileName,
		content: input.content,
	});
	return getProjectWorkspaceContext({
		c,
		ownerId,
		projectId: input.projectId,
	});
}

export async function updateAdminGlobalWorkspaceContextFile(
	c: AppContext,
	input: UpdateGlobalWorkspaceContextFileRequestDto,
): Promise<ProjectWorkspaceContextFileDto> {
	requireAdmin(c);
	return updateGlobalWorkspaceContextFile({
		fileName: input.fileName,
		content: input.content,
		updatedBy: "admin:" + String(c.get("userId") || "unknown"),
	});
}

export async function getUserProjectWorkspaceContextFileVersion(
	c: AppContext,
	userId: string,
	input: { projectId: string; fileName: string; versionId: string },
): Promise<ProjectWorkspaceContextFileVersionContentDto> {
	const ownerId = await assertProjectWorkspaceContextAccess(c, userId, input.projectId);
	return getProjectWorkspaceContextFileVersionContent({
		ownerId,
		projectId: input.projectId,
		fileName: input.fileName,
		versionId: input.versionId,
	});
}

export async function rollbackUserProjectWorkspaceContextFileVersion(
	c: AppContext,
	userId: string,
	input: RollbackProjectWorkspaceContextFileRequestDto,
): Promise<ProjectWorkspaceContextFileDto> {
	const ownerId = await assertProjectWorkspaceContextAccess(c, userId, input.projectId);
	return rollbackProjectWorkspaceContextFileVersion({
		ownerId,
		projectId: input.projectId,
		fileName: input.fileName,
		versionId: input.versionId,
		updatedBy: userId,
	});
}

export async function getAdminGlobalWorkspaceContextFileVersion(
	c: AppContext,
	input: { fileName: string; versionId: string },
): Promise<ProjectWorkspaceContextFileVersionContentDto> {
	requireAdmin(c);
	return getGlobalWorkspaceContextFileVersionContent({
		fileName: input.fileName,
		versionId: input.versionId,
	});
}

export async function rollbackAdminGlobalWorkspaceContextFileVersion(
	c: AppContext,
	input: RollbackGlobalWorkspaceContextFileRequestDto,
): Promise<ProjectWorkspaceContextFileDto> {
	requireAdmin(c);
	return rollbackGlobalWorkspaceContextFileVersion({
		fileName: input.fileName,
		versionId: input.versionId,
		updatedBy: "admin:" + String(c.get("userId") || "unknown"),
	});
}

export async function verifyUserProjectWorkspaceContext(
	c: AppContext,
	userId: string,
	input: { projectId: string },
): Promise<ProjectWorkspaceContextVerifyResponseDto> {
	const ownerId = await assertProjectWorkspaceContextAccess(c, userId, input.projectId);
	const ctx = await getProjectWorkspaceContext({
		c,
		ownerId,
		projectId: input.projectId,
	});

	const maxCharsPerFile = 3_000;
	const maxTotalChars = 12_000;
	let totalChars = 0;
	const files: Array<{
		layer: "global" | "project";
		path: string;
		charCount: number;
		truncated: boolean;
		updatedAt: string | null;
		updatedBy: string | null;
	}> = [];
	const warnings: string[] = [];

	const takeFiles = (items: ProjectWorkspaceContextFileDto[]) => {
		for (const item of items) {
			if (totalChars >= maxTotalChars) break;
			const raw = String(item.content || "");
			const remaining = Math.max(0, maxTotalChars - totalChars);
			const budget = Math.min(maxCharsPerFile, remaining);
			if (budget <= 0) break;
			const effective = raw.length > budget ? raw.slice(0, budget) : raw;
			const truncated = raw.length > effective.length;
			totalChars += effective.length;
			files.push({
				layer: item.layer,
				path: item.path,
				charCount: effective.length,
				truncated,
				updatedAt: item.updatedAt,
				updatedBy: item.updatedBy,
			});
		}
	};

	// Match agents-cli assembler order: roots include workspaceRoot first, then resourceRoots.
	// In this app, project context is the key runtime root (localResourcePaths).
	takeFiles(ctx.globalFiles);
	takeFiles(ctx.projectFiles);

	if (files.length === 0) warnings.push("No context files found under global/project context dirs.");
	if (totalChars >= maxTotalChars) warnings.push("Context hit maxTotalChars budget; later files were omitted.");
	if (files.some((f) => f.truncated)) warnings.push("Some files were truncated due to maxCharsPerFile budget.");

	return {
		projectId: ctx.projectId,
		ownerId: ctx.ownerId,
		projectRoot: ctx.projectRoot,
		globalContextDir: ctx.globalContextDir,
		projectContextDir: ctx.projectContextDir,
		budgets: { maxCharsPerFile, maxTotalChars },
		totalChars,
		files,
		warnings,
	};
}

export async function getAdminProjectWorkspaceContext(
	c: AppContext,
	userId: string,
	input: {
		projectId: string;
		bookId?: string;
		chapter?: number | null;
		refresh?: boolean;
	},
): Promise<ProjectWorkspaceContextDto> {
	requireAdmin(c);
	const ownerId = await assertProjectWorkspaceContextAccess(c, userId, input.projectId);
	return getProjectWorkspaceContext({
		c,
		ownerId,
		projectId: input.projectId,
		...(input.bookId ? { bookId: input.bookId } : {}),
		...(typeof input.chapter === "number" ? { chapter: input.chapter } : {}),
		...(input.refresh === true ? { refresh: true } : {}),
	});
}

export async function getAdminAgentDiagnostics(
	c: AppContext,
	userId: string,
	input: AgentDiagnosticsQueryDto,
): Promise<AgentDiagnosticsResponseDto> {
	requireAdmin(c);
	return getUserAgentDiagnostics(c, userId, input);
}

export async function getUserAgentDiagnostics(
	c: AppContext,
	userId: string,
	input: AgentDiagnosticsQueryDto,
): Promise<AgentDiagnosticsResponseDto> {
	const observability = await queryAgentObservability(c, userId, {
		...(input.traceId ? { traceId: input.traceId } : {}),
		...(input.projectId ? { projectId: input.projectId } : {}),
		...(input.bookId ? { bookId: input.bookId } : {}),
		...(input.chapterId ? { chapterId: input.chapterId } : {}),
		...(input.flowId ? { flowId: input.flowId } : {}),
		...(input.nodeId ? { nodeId: input.nodeId } : {}),
		...(input.label ? { label: input.label } : {}),
		...(input.workflowKey ? { workflowKey: input.workflowKey } : {}),
		...(input.modelKey ? { modelKey: input.modelKey } : {}),
		...(input.status ? { status: input.status } : {}),
		...(input.kind ? { kind: input.kind } : {}),
		...(input.from ? { from: input.from } : {}),
		...(input.to ? { to: input.to } : {}),
		...(input.cursor ? { cursor: input.cursor } : {}),
		limit: input.limit,
	});
	const baseTraces = (await listUserExecutionTraces(c, userId, {
		limit: Math.max(input.limit * 3, 60),
		...(input.traceId ? { traceFamilyId: input.traceId } : {}),
		requestKindPrefix: "agents_bridge:",
	})).filter((item) => matchesDiagnosticsFilter(item.meta, input)).slice(0, input.limit);
	const traces = baseTraces;
	const executionHealth = await queryExecutionTraceHealth(c.env.DB, { userId });
	const publicChatRuns = (
		await listRecentPublicChatTurnRuns(c.env.DB, {
			userId,
			...(input.projectId ? { projectId: input.projectId, sessionKeyPrefix: `project:${input.projectId}` } : {}),
			...(input.bookId ? { bookId: input.bookId } : {}),
			...(input.chapterId ? { chapterId: input.chapterId } : {}),
			...(input.label ? { label: input.label } : {}),
			...(input.workflowKey ? { workflowKey: input.workflowKey } : {}),
			...(input.turnVerdict ? { turnVerdict: input.turnVerdict } : {}),
			...(input.runOutcome ? { runOutcome: input.runOutcome } : {}),
			limit: input.limit,
		})
	).map(mapPublicChatTurnRunRow);
	const storyboardDiagnostics = input.projectId
		? await listStoryboardDiagnosticLogs(c.env.DB, {
			ownerId: userId,
			projectId: input.projectId,
			limit: input.limit,
			...(input.label ? { stage: input.label } : {}),
		})
		: [];
	return {
		projectId: input.projectId ?? null,
		bookId: input.bookId ?? null,
		chapterId: input.chapterId ?? null,
		flowId: input.flowId ?? null,
		nodeId: input.nodeId ?? null,
		label: input.label ?? null,
		traces,
		executionHealth,
		publicChatRuns,
		storyboardDiagnostics,
		spans: observability.spans,
		metrics: observability.metrics,
		evaluations: observability.evaluations,
		humanFeedback: observability.humanFeedback,
		annotationQueue: observability.annotationQueue,
		regressionExamples: observability.regressionExamples,
		nextCursor: observability.nextCursor,
	};
}

export async function submitAdminAgentHumanFeedback(
	c: AppContext,
	userId: string,
	input: CreateAgentHumanFeedbackRequestDto,
) {
	requireAdmin(c);
	return submitAgentHumanFeedback(c, userId, input);
}

export async function submitUserAgentHumanFeedback(
	c: AppContext,
	userId: string,
	input: CreateAgentHumanFeedbackRequestDto,
) {
	return submitAgentHumanFeedback(c, userId, input);
}

export async function captureAdminAgentRegressionExample(
	c: AppContext,
	userId: string,
	input: CreateAgentRegressionExampleRequestDto,
) {
	requireAdmin(c);
	return captureAgentRegressionExample(c, userId, input);
}

export async function captureUserAgentRegressionExample(
	c: AppContext,
	userId: string,
	input: CreateAgentRegressionExampleRequestDto,
) {
	return captureAgentRegressionExample(c, userId, input);
}

export async function listUserAgentPipelineRuns(
	c: AppContext,
	userId: string,
	input?: { projectId?: string | null; limit?: number },
): Promise<AgentPipelineRunDto[]> {
	const rows = await listAgentPipelineRunsRows(c.env.DB, {
		ownerId: userId,
		projectId: input?.projectId ?? null,
		limit: input?.limit ?? 50,
	});
	return rows.map(mapAgentPipelineRunRow);
}

export async function getUserAgentPipelineRunById(
	c: AppContext,
	userId: string,
	id: string,
): Promise<AgentPipelineRunDto> {
	const row = await getAgentPipelineRunRowById(c.env.DB, { id, ownerId: userId });
	if (!row) {
		throw new AppError("Pipeline run not found", {
			status: 404,
			code: "pipeline_run_not_found",
		});
	}
	return mapAgentPipelineRunRow(row);
}

export async function updateUserAgentPipelineRunStatus(
	c: AppContext,
	userId: string,
	id: string,
	input: UpdateAgentPipelineRunStatusRequestDto,
): Promise<AgentPipelineRunDto> {
	const existing = await getAgentPipelineRunRowById(c.env.DB, { id, ownerId: userId });
	if (!existing) {
		throw new AppError("Pipeline run not found", {
			status: 404,
			code: "pipeline_run_not_found",
		});
	}

	const nowIso = new Date().toISOString();
	const hasErrorMessage = Object.prototype.hasOwnProperty.call(
		input,
		"errorMessage",
	);
	const nextErrorMessage = hasErrorMessage
		? input.errorMessage ?? null
		: existing.error_message ?? null;
	const startedAt =
		input.status === "running" && !existing.started_at ? nowIso : undefined;
	const finishedAt =
		input.status === "succeeded" ||
		input.status === "failed" ||
		input.status === "canceled"
			? nowIso
			: input.status === "running"
				? null
				: undefined;

	const updated = await updateAgentPipelineRunRow(c.env.DB, {
		id,
		ownerId: userId,
		status: input.status,
		progressJson:
			Object.prototype.hasOwnProperty.call(input, "progress")
				? JSON.stringify(input.progress ?? null)
				: undefined,
		resultJson:
			Object.prototype.hasOwnProperty.call(input, "result")
				? JSON.stringify(input.result ?? null)
				: undefined,
		errorMessage: nextErrorMessage,
		startedAt,
		finishedAt:
			typeof finishedAt === "undefined" ? existing.finished_at : finishedAt,
		nowIso,
	});
	if (!updated) {
		throw new AppError("Pipeline run not found", {
			status: 404,
			code: "pipeline_run_not_found",
		});
	}
	return mapAgentPipelineRunRow(updated);
}


function sanitizePathSegment(raw: string): string {
	return String(raw || "")
		.trim()
		.replace(/[^a-zA-Z0-9._-]/g, "_")
		.slice(0, 120);
}

function buildScopedProjectDataRoot(ownerId: string, projectId: string): string {
	return path.join(
		resolveProjectDataRepoRoot(process.cwd()),
		"project-data",
		"users",
		sanitizePathSegment(ownerId),
		"projects",
		sanitizePathSegment(projectId),
	);
}

function buildProjectDataRoot(projectId: string, ownerId?: string): string {
	if (ownerId) return buildScopedProjectDataRoot(ownerId, projectId);
	return path.join(
		resolveProjectDataRepoRoot(process.cwd()),
		"project-data",
		sanitizePathSegment(projectId),
	);
}

function buildProjectBooksRoot(projectId: string, ownerId?: string): string {
	return path.join(buildProjectDataRoot(projectId, ownerId), "books");
}


function buildBookIndexPath(projectId: string, bookId: string, ownerId?: string): string {
	return path.join(
		buildProjectBooksRoot(projectId, ownerId),
		sanitizePathSegment(bookId),
		"index.json",
	);
}





function mapBookIndexStoreError(error: BookIndexStoreError): AppError {
	return new AppError(error.message, {
		status: error.code === "book_index_not_found" ? 404 : 500,
		code: error.code,
		details: error.details,
	});
}

async function readBookIndexForAgents(indexPath: string): Promise<BookIndexRecord> {
	try {
		return await readBookIndex(indexPath);
	} catch (error) {
		if (error instanceof BookIndexStoreError) throw mapBookIndexStoreError(error);
		throw error;
	}
}



async function resolveReadableBookIndexPath(input: {
	projectId: string;
	bookId: string;
	ownerId?: string;
}): Promise<string> {
	if (!input.ownerId) {
		throw new AppError("Book index owner scope is required", {
			status: 400,
			code: "book_index_owner_scope_required",
			details: { projectId: input.projectId, bookId: input.bookId },
		});
	}
	return buildBookIndexPath(input.projectId, input.bookId, input.ownerId);
}


type BookChapterContext = {
	bookId: string;
	bookTitle: string;
	chapter: number;
	chapterTitle: string;
	content: string;
	chapterStartOffset?: number;
	chapterEndOffset?: number;
	summary?: string;
	keywords?: string[];
	coreConflict?: string;
	characters?: Array<{ name: string; description?: string }>;
	props?: Array<{
		name: string;
		description?: string;
		narrativeImportance?: "critical" | "supporting" | "background";
		visualNeed?: "must_render" | "shared_scene_only" | "mention_only";
		functionTags?: Array<
			| "plot_trigger"
			| "combat"
			| "threat"
			| "identity_marker"
			| "continuity_anchor"
			| "transaction"
			| "environment_clutter"
		>;
		reusableAssetPreferred?: boolean;
		independentlyFramable?: boolean;
	}>;
	scenes?: Array<{ name: string; description?: string }>;
	locations?: Array<{ name: string; description?: string }>;
	processedBy?: string;
};

type BookChapterContextCheckReason =
	| "book_index_missing"
	| "book_chapters_missing"
	| "chapter_meta_missing"
	| "book_raw_missing"
	| "book_raw_empty"
	| "resolved";

type BookChapterContextResolutionReason =
	| "resolved"
	| "books_root_unreadable"
	| "candidate_books_not_found"
	| Exclude<BookChapterContextCheckReason, "resolved">;

type BookChapterContextCheck = {
	bookId: string;
	reason: BookChapterContextCheckReason;
};

type BookChapterContextDiagnostics = {
	requestedBookId: string | null;
	requestedChapter: number | null;
	candidateBookIds: string[];
	checks: BookChapterContextCheck[];
	resolved: boolean;
	resolvedFromBookId: string | null;
	finalReason: BookChapterContextResolutionReason;
};

type BookChapterContextResolution = {
	context: BookChapterContext | null;
	diagnostics: BookChapterContextDiagnostics;
};

function normalizeEntityItems(
	value: unknown,
	maxItems = 12,
): Array<{ name: string; description?: string }> {
	if (!Array.isArray(value)) return [];
	const out: Array<{ name: string; description?: string }> = [];
	const seen = new Set<string>();
	for (const item of value) {
		const name = String((item as any)?.name || "").trim();
		if (!name) continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		const description = String((item as any)?.description || "").trim();
		out.push(description ? { name, description } : { name });
		if (out.length >= maxItems) break;
	}
	return out;
}

function normalizePropItems(
	value: unknown,
	maxItems = 12,
): NonNullable<BookChapterContext["props"]> {
	if (!Array.isArray(value)) return [];
	const out: NonNullable<BookChapterContext["props"]> = [];
	const seen = new Set<string>();
	for (const item of value) {
		const record = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
		const name = String(record?.name || "").trim();
		if (!name) continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		const description = String(record?.description || "").trim();
		const narrativeImportanceRaw = String(record?.narrativeImportance || "").trim();
		const visualNeedRaw = String(record?.visualNeed || "").trim();
		const functionTags = Array.isArray(record?.functionTags)
			? record.functionTags
					.map((tag) => String(tag || "").trim())
					.filter((tag): tag is NonNullable<NonNullable<BookChapterContext["props"]>[number]["functionTags"]>[number] =>
						tag === "plot_trigger" ||
						tag === "combat" ||
						tag === "threat" ||
						tag === "identity_marker" ||
						tag === "continuity_anchor" ||
						tag === "transaction" ||
						tag === "environment_clutter",
					)
			: [];
		out.push({
			name,
			...(description ? { description } : null),
			...(narrativeImportanceRaw === "critical" ||
			narrativeImportanceRaw === "supporting" ||
			narrativeImportanceRaw === "background"
				? { narrativeImportance: narrativeImportanceRaw }
				: null),
			...(visualNeedRaw === "must_render" ||
			visualNeedRaw === "shared_scene_only" ||
			visualNeedRaw === "mention_only"
				? { visualNeed: visualNeedRaw }
				: null),
			...(functionTags.length ? { functionTags } : null),
			...(typeof record?.reusableAssetPreferred === "boolean"
				? { reusableAssetPreferred: record.reusableAssetPreferred }
				: null),
			...(typeof record?.independentlyFramable === "boolean"
				? { independentlyFramable: record.independentlyFramable }
				: null),
		});
		if (out.length >= maxItems) break;
	}
	return out;
}

function normalizeKeywords(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const item of value) {
		const word = String(item || "").trim();
		if (!word) continue;
		if (out.includes(word)) continue;
		out.push(word);
		if (out.length >= 12) break;
	}
	return out;
}

async function resolveBookChapterContextWithDiagnostics(input: {
	projectId: string;
	ownerId?: string;
	chapter: number | null;
	bookId?: string | null;
}): Promise<BookChapterContextResolution> {
	if (!input.ownerId) {
		throw new AppError("Book context owner scope is required", {
			status: 400,
			code: "book_index_owner_scope_required",
			details: { projectId: input.projectId, bookId: input.bookId ?? null },
		});
	}
	const booksRoot = buildProjectBooksRoot(input.projectId, input.ownerId);
	const chapterNo =
		typeof input.chapter === "number" && Number.isFinite(input.chapter) && input.chapter > 0
			? Math.trunc(input.chapter)
			: null;
	const requestedBookId = input.bookId ? sanitizePathSegment(input.bookId) : null;

	let candidateBookIds: string[] = [];
	if (requestedBookId) candidateBookIds.push(requestedBookId);

	if (!candidateBookIds.length) {
		let entries: Array<{ name: string; isDirectory: () => boolean }>;
		try {
			entries = await fs.readdir(booksRoot, { withFileTypes: true });
		} catch {
			return {
				context: null,
				diagnostics: {
					requestedBookId,
					requestedChapter: chapterNo,
					candidateBookIds: [],
					checks: [],
					resolved: false,
					resolvedFromBookId: null,
					finalReason: "books_root_unreadable",
				},
			};
		}
		const ranked: Array<{ bookId: string; updatedAt: string }> = [];
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const indexPath = path.join(booksRoot, entry.name, "index.json");
			const idx = await readBookIndexForAgents(indexPath);
			ranked.push({
				bookId: String(idx.bookId || entry.name),
				updatedAt: String(idx.updatedAt || ""),
			});
		}
		ranked.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
		candidateBookIds = ranked.map((item) => sanitizePathSegment(item.bookId));
	}
	if (!candidateBookIds.length) {
		return {
			context: null,
			diagnostics: {
				requestedBookId,
				requestedChapter: chapterNo,
				candidateBookIds: [],
				checks: [],
				resolved: false,
				resolvedFromBookId: null,
				finalReason: "candidate_books_not_found",
			},
		};
	}

	const checks: BookChapterContextCheck[] = [];

	for (const bookId of candidateBookIds) {
		if (!bookId) continue;
		const bookDir = path.join(booksRoot, bookId);
		const indexPath = path.join(bookDir, "index.json");
		const rawPath = path.join(bookDir, "raw.md");
		const idx = await readBookIndexForAgents(indexPath);
		const chapters = Array.isArray(idx.chapters) ? idx.chapters : [];
		if (!chapters.length) {
			checks.push({ bookId, reason: "book_chapters_missing" });
			continue;
		}
		const chapterMeta =
			chapters.find((ch: any) => Number(ch?.chapter) === chapterNo) ||
			(chapterNo ? null : chapters[0]);
		if (!chapterMeta) {
			checks.push({ bookId, reason: "chapter_meta_missing" });
			continue;
		}
		const raw = await fs.readFile(rawPath, "utf8").catch(() => "");
		if (!raw) {
			checks.push({ bookId, reason: "book_raw_missing" });
			continue;
		}
		const content = raw.trim();
		if (!content) {
			checks.push({ bookId, reason: "book_raw_empty" });
			continue;
		}
		const context: BookChapterContext = {
			bookId: String(idx.bookId || bookId),
			bookTitle: String(idx.title || bookId),
			chapter: Number(chapterMeta?.chapter || chapterNo || 1) || 1,
			chapterTitle: String(chapterMeta?.title || `第${chapterNo || 1}章`),
			content,
			chapterStartOffset:
				typeof chapterMeta?.startOffset === "number" && Number.isFinite(chapterMeta.startOffset)
					? Math.trunc(chapterMeta.startOffset)
					: undefined,
			chapterEndOffset:
				typeof chapterMeta?.endOffset === "number" && Number.isFinite(chapterMeta.endOffset)
					? Math.trunc(chapterMeta.endOffset)
					: undefined,
			summary: String(chapterMeta?.summary || "").trim() || undefined,
			keywords: normalizeKeywords(chapterMeta?.keywords),
			coreConflict: String(chapterMeta?.coreConflict || "").trim() || undefined,
			characters: normalizeEntityItems(chapterMeta?.characters, 16),
			props: normalizePropItems(chapterMeta?.props, 16),
			scenes: normalizeEntityItems(chapterMeta?.scenes, 16),
			locations: normalizeEntityItems(chapterMeta?.locations, 16),
			processedBy: String(idx?.processedBy || "").trim() || undefined,
		};
		checks.push({ bookId, reason: "resolved" });
		return {
			context,
			diagnostics: {
				requestedBookId,
				requestedChapter: chapterNo,
				candidateBookIds,
				checks,
				resolved: true,
				resolvedFromBookId: context.bookId,
				finalReason: "resolved",
			},
		};
	}

	return {
		context: null,
		diagnostics: {
			requestedBookId,
			requestedChapter: chapterNo,
			candidateBookIds,
			checks,
			resolved: false,
			resolvedFromBookId: null,
			finalReason: checks.length > 0 ? checks[checks.length - 1]!.reason : "candidate_books_not_found",
		},
	};
}

type StoryboardChunkRecord = {
	chunkId: string;
	taskId?: string;
	planId?: string;
	previousChunkId?: string;
	chapter: number;
	groupSize: 1 | 4 | 9 | 25;
	chunkIndex: number;
	shotStart: number;
	shotEnd: number;
	nodeId?: string;
	prompt?: string;
	storyboardArtifact?: Record<string, unknown>;
	artifactSha256?: string;
	storyboardStructured?: StoryboardStructuredData;
	/** Opaque compatibility metadata from records written before the artifact-only cutover. */
	semanticReview?: unknown;
	shotPrompts: string[];
	frameUrls: string[];
	tailFrameUrl: string;
	roleCardRefIds?: string[];
	scenePropRefId?: string;
	scenePropRefLabel?: string;
	spellFxRefId?: string;
	spellFxRefLabel?: string;
	createdAt: string;
	updatedAt: string;
	createdBy?: string;
	updatedBy?: string;
};



type StoryboardGroupSize = 1 | 4 | 9 | 25;

type StoryboardWorkflowContinuityContext = {
	roleReferenceImages: string[];
	roleReferenceEntries: Array<{
		cardId: string;
		characterBibleId?: string;
		roleName: string;
		identityHint?: string;
		imageUrl: string;
		stateDescription?: string;
		chapter?: number;
		chapterStart?: number;
		chapterEnd?: number;
		chapterSpan?: number[];
	}>;
	styleReferenceImages: string[];
	scenePropReference: { refId: string; label: string; imageUrl: string } | null;
	scenePropRequired: boolean;
	spellFxReference: { refId: string; label: string; imageUrl: string } | null;
	chapterRoleNames: string[];
	requiredRoleNames: string[];
	persistentRequiredRoleNames: string[];
	missingRequiredRoleNames: string[];
	unconfirmedRequiredRoleNames: string[];
	availableChapterRoleCardNames: string[];
	availableApplicableRoleCardNames: string[];
	availableUnconfirmedChapterRoleCardNames: string[];
	hasUnconfirmedScenePropReference: boolean;
	roleRefMatchStrategy: "direct_match" | "none";
	prevTailFrameUrl: string | null;
	stylePromptPrefix: string;
};

export type StoryboardContinuityEvidenceDto = {
	projectId: string;
	bookId: string;
	chapter: number;
	groupSize: StoryboardGroupSize;
	chunkIndex: number;
	prevTailFrameUrl: string | null;
	roleReferenceImages: string[];
	roleReferenceEntries: Array<{
		cardId: string;
		characterBibleId?: string;
		roleName: string;
		identityHint?: string;
		imageUrl: string;
		stateDescription?: string;
		chapter?: number;
		chapterStart?: number;
		chapterEnd?: number;
		chapterSpan?: number[];
	}>;
	styleReferenceImages: string[];
	scenePropReference: { refId: string; label: string; imageUrl: string } | null;
	scenePropRequired: boolean;
	spellFxReference: { refId: string; label: string; imageUrl: string } | null;
	chapterRoleNames: string[];
	requiredRoleNames: string[];
	persistentRequiredRoleNames: string[];
	missingRequiredRoleNames: string[];
	unconfirmedRequiredRoleNames: string[];
	availableChapterRoleCardNames: string[];
	availableApplicableRoleCardNames: string[];
	availableUnconfirmedChapterRoleCardNames: string[];
	hasUnconfirmedScenePropReference: boolean;
	roleRefMatchStrategy: "direct_match" | "none";
	stylePromptPrefix: string;
	currentChunk: StoryboardChunkRecord | null;
	previousChunk: StoryboardChunkRecord | null;
	chapterChunks: StoryboardChunkRecord[];
};

type StoryboardSourceBundleNodeSummary = {
	nodeId: string;
	type: string | null;
	kind: string | null;
	label: string | null;
	status: string | null;
	position: { x: number; y: number } | null;
	promptPreview: string | null;
	contentPreview: string | null;
	imageUrl: string | null;
	videoUrl: string | null;
};

export type StoryboardSourceBundleDto = {
	projectId: string;
	flowId: string;
	bookId: string | null;
	chapter: number | null;
	projectContext: ProjectWorkspaceContextDto;
	chapterContext: {
		bookId: string;
		bookTitle: string;
		chapter: number;
		chapterTitle: string;
		content: string;
		summary: string | null;
		keywords: string[];
		coreConflict: string | null;
		characters: Array<{ name: string; description?: string }>;
		props: Array<{ name: string; description?: string }>;
		scenes: Array<{ name: string; description?: string }>;
		locations: Array<{ name: string; description?: string }>;
	} | null;
	flowSummary: {
		flowId: string;
		flowName: string;
		nodeCount: number;
		edgeCount: number;
		relevantNodes: StoryboardSourceBundleNodeSummary[];
	};
	diagnostics: {
		progress: {
			currentBookId: string | null;
			currentChapter: number | null;
			latestStoryboardChunk: {
				chunkIndex: number;
				groupSize?: number;
				shotStart?: number;
				shotEnd?: number;
				tailFrameUrl?: string;
				updatedAt?: string;
			} | null;
		};
		recentShots: Array<{
			nodeId: string;
			kind: string | null;
			label: string | null;
			imageUrl: string | null;
			videoUrl: string | null;
		}>;
		chapterContextResolution: BookChapterContextDiagnostics;
	};
};

export type NodeContextBundleDto = {
	projectId: string;
	flowId: string;
	nodeId: string;
	node: StoryboardSourceBundleNodeSummary & {
		rawData: Record<string, unknown>;
	};
	upstreamNodes: StoryboardSourceBundleNodeSummary[];
	downstreamNodes: StoryboardSourceBundleNodeSummary[];
	recentExecutions: Array<{
		id: string;
		status: string;
		createdAt: string;
		startedAt: string | null;
		finishedAt: string | null;
		nodeRuns: Array<{
			id: string;
			status: string;
			attempt: number;
			errorMessage: string | null;
			outputRefs: unknown;
			createdAt: string;
			startedAt: string | null;
			finishedAt: string | null;
		}>;
		events: Array<{
			id: string;
			seq: number;
			eventType: string;
			level: string;
			nodeId: string | null;
			message: string | null;
			data: unknown;
			createdAt: string;
		}>;
	}>;
	diagnostics: {
		executionTraces: Array<{
			id: string;
			requestKind: string;
			inputSummary: string;
			resultSummary: string | null;
			errorCode: string | null;
			errorDetail: string | null;
			createdAt: string;
			meta: Record<string, unknown> | null;
		}>;
		storyboardDiagnostics: Array<{
			shotId: string | null;
			jobId: string | null;
			stage: string;
			level: string;
			message: string;
			summary: Record<string, unknown> | null;
			createdAt: string;
		}>;
	};
};

export type VideoReviewBundleDto = {
	projectId: string;
	flowId: string;
	nodeId: string;
	videoNode: {
		nodeId: string;
		kind: string | null;
		label: string | null;
		prompt: string | null;
		storyBeatPlan: string[];
		videoUrl: string | null;
		videoResults: Array<{ url: string | null; thumbnailUrl: string | null }>;
	};
	nodeContext: NodeContextBundleDto;
};

function hasAssetConfirmedAt(value: unknown): boolean {
	return typeof value === "string" && value.trim().length > 0;
}


function listChapterEntityNames(
	indexData: any,
	chapterNo: number,
	field: "characters" | "scenes" | "props",
): string[] {
	const chapters = Array.isArray(indexData?.chapters) ? indexData.chapters : [];
	const chapterMeta = chapters.find((ch: any) => Number(ch?.chapter) === Number(chapterNo)) || null;
	const raw = Array.isArray(chapterMeta?.[field]) ? chapterMeta[field] : [];
	const names = raw
		.map((item: any) => (typeof item === "string" ? item : item?.name))
		.map((x: any) => String(x || "").trim())
		.filter(Boolean);
	return Array.from(new Set(names.map((x) => normalizeRoleName(x)).filter(Boolean)));
}

function collectRecurringEntityNames(indexData: any, field: "characters" | "scenes" | "props"): Set<string> {
	const chapters = Array.isArray(indexData?.chapters) ? indexData.chapters : [];
	const counts = new Map<string, number>();
	for (const chapterMeta of chapters) {
		const raw = Array.isArray(chapterMeta?.[field]) ? chapterMeta[field] : [];
		const names = Array.from(
			new Set(
				raw
					.map((item: any) => (typeof item === "string" ? item : item?.name))
					.map((x: any) => normalizeRoleName(x))
					.filter(Boolean),
			),
		);
		for (const name of names) {
			counts.set(name, (counts.get(name) || 0) + 1);
		}
	}
	return new Set(
		Array.from(counts.entries())
			.filter(([, count]) => count >= 2)
			.map(([name]) => name),
	);
}







function normalizeDirectiveList(input: unknown, limit = 6): string[] {
	if (!Array.isArray(input)) return [];
	const out: string[] = [];
	for (const item of input) {
		const value = typeof item === "string" ? item.trim() : "";
		if (!value) continue;
		out.push(value);
		if (out.length >= limit) break;
	}
	return out;
}

const STORYBOARD_REFERENCE_PROMPT_SCHEMA_VERSION = "storyboard_reference_v2";

type StoryboardReferenceCardKind = "single_character" | "group_cast";

type StoryboardReferenceVisualKind = "scene_prop_grid" | "spell_fx";

function normalizeRoleName(value: unknown): string {
	return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function readStoryboardReferenceCardKind(value: unknown): StoryboardReferenceCardKind | null {
	return value === "single_character" || value === "group_cast" ? value : null;
}

function readStoryboardReferenceVisualKind(value: unknown): StoryboardReferenceVisualKind | null {
	return value === "scene_prop_grid" || value === "spell_fx" ? value : null;
}

function isCurrentStoryboardReferenceRecord(value: { promptSchemaVersion?: string | null }): boolean {
	return value.promptSchemaVersion === STORYBOARD_REFERENCE_PROMPT_SCHEMA_VERSION;
}


function dedupeRoleCardEntries(
	items: Array<{
		cardId: string;
		characterBibleId?: string;
		roleName: string;
		imageUrl: string;
		stateDescription?: string;
		chapter?: number;
		chapterStart?: number;
		chapterEnd?: number;
		chapterSpan?: number[];
	}>,
	limit = 8,
): Array<{
	cardId: string;
	characterBibleId?: string;
	roleName: string;
	imageUrl: string;
	stateDescription?: string;
	chapter?: number;
	chapterStart?: number;
	chapterEnd?: number;
	chapterSpan?: number[];
}> {
	const out: Array<{
		cardId: string;
		roleName: string;
		imageUrl: string;
		stateDescription?: string;
		chapter?: number;
		chapterStart?: number;
		chapterEnd?: number;
		chapterSpan?: number[];
	}> = [];
	const seenUrl = new Set<string>();
	for (const item of items) {
		const cardId = String(item?.cardId || "").trim();
		const characterBibleId = String(item?.characterBibleId || "").trim();
		const roleName = String(item?.roleName || "").trim();
		const imageUrl = String(item?.imageUrl || "").trim();
		const stateDescription = String(item?.stateDescription || "").trim();
		const chapter =
			typeof item?.chapter === "number" && Number.isFinite(item.chapter) && item.chapter > 0
				? Math.trunc(item.chapter)
				: undefined;
		const chapterStart =
			typeof item?.chapterStart === "number" && Number.isFinite(item.chapterStart) && item.chapterStart > 0
				? Math.trunc(item.chapterStart)
				: undefined;
		const chapterEnd =
			typeof item?.chapterEnd === "number" && Number.isFinite(item.chapterEnd) && item.chapterEnd > 0
				? Math.trunc(item.chapterEnd)
				: undefined;
		const chapterSpan = Array.isArray(item?.chapterSpan)
			? item.chapterSpan
					.map((x) => Number(x))
					.filter((x) => Number.isFinite(x) && x > 0)
					.map((x) => Math.trunc(x))
			: undefined;
		if (!imageUrl || seenUrl.has(imageUrl)) continue;
		seenUrl.add(imageUrl);
		out.push({
			cardId,
			...(characterBibleId ? { characterBibleId } : null),
			roleName,
			imageUrl,
			...(stateDescription ? { stateDescription } : null),
			...(typeof chapter === "number" ? { chapter } : null),
			...(typeof chapterStart === "number" ? { chapterStart } : null),
			...(typeof chapterEnd === "number" ? { chapterEnd } : null),
			...(Array.isArray(chapterSpan) && chapterSpan.length ? { chapterSpan } : null),
		});
		if (out.length >= limit) break;
	}
	return out;
}

function isRoleCardApplicableToChapter(
	card: {
		chapter?: number;
		chapterStart?: number;
		chapterEnd?: number;
		chapterSpan?: number[];
	},
	chapter: number,
): boolean {
	const chapterNo = Number.isFinite(chapter) && chapter > 0 ? Math.trunc(chapter) : 0;
	if (!chapterNo) return true;
	const span = Array.isArray(card?.chapterSpan)
		? card.chapterSpan
				.map((x: any) => Number(x))
				.filter((x: number) => Number.isFinite(x) && x > 0)
				.map((x: number) => Math.trunc(x))
		: [];
	if (span.length > 0) return span.includes(chapterNo);
	const startRaw = Number((card as any)?.chapterStart);
	const endRaw = Number((card as any)?.chapterEnd);
	const singleRaw = Number((card as any)?.chapter);
	if (Number.isFinite(startRaw) && startRaw > 0) {
		const start = Math.trunc(startRaw);
		const end = Number.isFinite(endRaw) && endRaw > 0 ? Math.trunc(endRaw) : start;
		return chapterNo >= start && chapterNo <= end;
	}
	if (Number.isFinite(singleRaw) && singleRaw > 0) return chapterNo === Math.trunc(singleRaw);
	return true;
}

type StoryboardCharacterBibleRef = {
	id: string;
	name: string;
	sourceCharacterId: string;
	identityHint?: string;
	outfit?: string;
	distinctiveFeatures?: string;
	scene?: string;
	hasThreeView: boolean;
	threeViewUrl?: string;
};

function normalizeStoryboardCharacterBibleRefs(value: unknown): StoryboardCharacterBibleRef[] {
	if (!Array.isArray(value)) return [];
	const out: StoryboardCharacterBibleRef[] = [];
	const seenIds = new Set<string>();
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const record = item as Record<string, unknown>;
		const id = String(record.id || "").trim();
		const name = String(record.name || "").trim();
		const sourceCharacterId = String(record.sourceCharacterId || "").trim();
		if (!id || !name || !sourceCharacterId || seenIds.has(id)) continue;
		seenIds.add(id);
		const sourceImages =
			record.sourceImages && typeof record.sourceImages === "object" && !Array.isArray(record.sourceImages)
				? (record.sourceImages as Record<string, unknown>)
				: {};
		const importedImages =
			record.importedImages && typeof record.importedImages === "object" && !Array.isArray(record.importedImages)
				? (record.importedImages as Record<string, unknown>)
				: {};
		const threeView = String(sourceImages.threeView || importedImages.threeView || "").trim();
		out.push({
			id,
			name,
			sourceCharacterId,
			...(String(record.identityHint || "").trim() ? { identityHint: String(record.identityHint || "").trim() } : null),
			...(String(record.outfit || "").trim() ? { outfit: String(record.outfit || "").trim() } : null),
			...(String(record.distinctiveFeatures || "").trim()
				? { distinctiveFeatures: String(record.distinctiveFeatures || "").trim() }
				: null),
			...(String(record.scene || "").trim() ? { scene: String(record.scene || "").trim() } : null),
			hasThreeView: !!threeView,
			...(threeView ? { threeViewUrl: threeView } : null),
		});
		if (out.length >= 200) break;
	}
	return out;
}

function buildStylePromptPrefix(styleBible: any): string {
	if (!styleBible || typeof styleBible !== "object") return "";
	const styleName = String(styleBible?.styleName || "").trim();
	const styleLocked = Boolean(styleBible?.styleLocked);
	const visualDirectives = normalizeDirectiveList(styleBible?.visualDirectives, 8);
	const consistencyRules = normalizeDirectiveList(styleBible?.consistencyRules, 6);
	const negativeDirectives = normalizeDirectiveList(styleBible?.negativeDirectives, 6);
	if (
		!styleLocked &&
		!styleName &&
		visualDirectives.length === 0 &&
		consistencyRules.length === 0 &&
		negativeDirectives.length === 0
	) {
		return "";
	}
	return [
		"【画风与一致性锁定】",
		styleName ? `画风名称：${styleName}` : "",
		visualDirectives.length ? `视觉规则：${visualDirectives.join("；")}` : "",
		styleLocked
			? "画风锁定：严格沿用参考图画风与角色特征，不新增与参考图冲突的风格描述。"
			: "",
		consistencyRules.length ? `一致性规则：${consistencyRules.join("；")}` : "",
		negativeDirectives.length ? `禁止项：${negativeDirectives.join("；")}` : "",
		"如文字与参考图冲突，以参考图为最高优先级；不得切换到其他美术体系。",
	]
		.filter(Boolean)
		.join("\n");
}

function resolveStoryboardWorkflowContinuity(input: {
	indexData: BookIndexRecord;
	chapter: number;
	requiredRoleNames: string[];
	prevTailFrameUrl?: string | null;
	scenePropRefId?: string;
	spellFxRefId?: string;
}): StoryboardWorkflowContinuityContext {
	const assets = asRecord(input.indexData?.assets) ?? {};
	const styleBible = asRecord(assets.styleBible);
	const characterBibles = normalizeStoryboardCharacterBibleRefs(assets.characterBibles);
	const roleCardsRaw = Array.isArray(assets.roleCards) ? assets.roleCards : [];
	const roleCardsAll = roleCardsRaw
			.map((card: any) => ({
				cardId: typeof card?.cardId === "string" ? card.cardId.trim() : "",
				characterBibleId: typeof card?.characterBibleId === "string" ? card.characterBibleId.trim() : "",
				roleName: typeof card?.roleName === "string" ? card.roleName.trim() : "",
				imageUrl: typeof card?.imageUrl === "string" ? card.imageUrl.trim() : "",
				stateDescription: typeof card?.stateDescription === "string" ? card.stateDescription.trim() : "",
				referenceKind: readStoryboardReferenceCardKind(card?.referenceKind),
			promptSchemaVersion:
				typeof card?.promptSchemaVersion === "string" ? card.promptSchemaVersion.trim() : null,
			confirmedAt:
				typeof card?.confirmedAt === "string" && card.confirmedAt.trim()
					? card.confirmedAt.trim()
					: null,
			updatedAtTs: (() => {
				const ts = Date.parse(String(card?.updatedAt || ""));
				return Number.isFinite(ts) ? ts : 0;
			})(),
			chapter:
				Number.isFinite(Number(card?.chapter)) && Number(card?.chapter) > 0
					? Math.trunc(Number(card.chapter))
					: undefined,
			chapterStart:
				Number.isFinite(Number(card?.chapterStart)) && Number(card?.chapterStart) > 0
					? Math.trunc(Number(card.chapterStart))
					: undefined,
			chapterEnd:
				Number.isFinite(Number(card?.chapterEnd)) && Number(card?.chapterEnd) > 0
					? Math.trunc(Number(card.chapterEnd))
					: undefined,
			chapterSpan: Array.isArray(card?.chapterSpan)
				? (card.chapterSpan as any[])
						.map((x: any) => Number(x))
						.filter((x: number) => Number.isFinite(x) && x > 0)
						.map((x: number) => Math.trunc(x))
				: undefined,
		}))
		.filter((card: any) => card.imageUrl && isCurrentStoryboardReferenceRecord(card));
	const roleCards = roleCardsAll.filter((card: any) => hasAssetConfirmedAt(card?.confirmedAt));
	const unconfirmedRoleCards = roleCardsAll.filter((card: any) => !hasAssetConfirmedAt(card?.confirmedAt));
	const visualRefsRaw = Array.isArray(assets.visualRefs) ? assets.visualRefs : [];
	const visualRefsAll = visualRefsRaw
		.map((item: any) => {
			const refId = typeof item?.refId === "string" ? item.refId.trim() : "";
			const categoryRaw = typeof item?.category === "string" ? item.category.trim().toLowerCase() : "";
			const category: "scene_prop" | "spell_fx" = categoryRaw === "spell_fx" ? "spell_fx" : "scene_prop";
			const name = typeof item?.name === "string" ? item.name.trim() : "";
			const imageUrl = typeof item?.imageUrl === "string" ? item.imageUrl.trim() : "";
			const statusRaw = typeof item?.status === "string" ? item.status.trim().toLowerCase() : "";
			const status: "draft" | "generated" = statusRaw === "generated" ? "generated" : "draft";
			const chapter =
				Number.isFinite(Number(item?.chapter)) && Number(item?.chapter) > 0
					? Math.trunc(Number(item.chapter))
					: undefined;
			const chapterStart =
				Number.isFinite(Number(item?.chapterStart)) && Number(item?.chapterStart) > 0
					? Math.trunc(Number(item.chapterStart))
					: undefined;
			const chapterEnd =
				Number.isFinite(Number(item?.chapterEnd)) && Number(item?.chapterEnd) > 0
					? Math.trunc(Number(item.chapterEnd))
					: undefined;
			const chapterSpan = Array.isArray(item?.chapterSpan)
				? (item.chapterSpan as unknown[])
						.map((x) => Number(x))
						.filter((x) => Number.isFinite(x) && x > 0)
						.map((x) => Math.trunc(x))
				: undefined;
			const tags = Array.isArray(item?.tags)
				? (item.tags as unknown[])
						.map((x) => String(x || "").trim())
						.filter(Boolean)
						.slice(0, 20)
				: [];
			const updatedAtTs = (() => {
				const ts = Date.parse(String(item?.updatedAt || ""));
				return Number.isFinite(ts) ? ts : 0;
			})();
			return {
				refId,
				category,
				name,
				imageUrl,
				referenceKind: readStoryboardReferenceVisualKind(item?.referenceKind),
				promptSchemaVersion:
					typeof item?.promptSchemaVersion === "string" ? item.promptSchemaVersion.trim() : null,
				status,
				confirmedAt:
					typeof item?.confirmedAt === "string" && item.confirmedAt.trim()
						? item.confirmedAt.trim()
						: null,
				chapter,
				chapterStart,
				chapterEnd,
				chapterSpan,
				tags,
				updatedAtTs,
			};
		})
		.filter((item: {
			refId: string;
			imageUrl: string;
			status: "draft" | "generated";
			promptSchemaVersion: string | null;
		}) => item.refId && item.imageUrl && item.status === "generated" && isCurrentStoryboardReferenceRecord(item));
	const visualRefs = visualRefsAll.filter((item: any) => hasAssetConfirmedAt(item?.confirmedAt));
	const unconfirmedVisualRefs = visualRefsAll.filter((item: any) => !hasAssetConfirmedAt(item?.confirmedAt));
	const chapters = Array.isArray(input.indexData?.chapters) ? input.indexData.chapters : [];
	const chapterMeta =
		chapters.find((ch: any) => Number(ch?.chapter) === Number(input.chapter)) || null;
	const chapterRoleNames: string[] = Array.from(
		new Set(
		(Array.isArray(chapterMeta?.characters) ? chapterMeta.characters : [])
			.map((item: any) => normalizeRoleName(item?.name))
			.filter(Boolean),
		),
	) as string[];
	const chapterRoleCards = roleCards.filter((card: any) =>
		new Set(chapterRoleNames).has(normalizeRoleName(card?.roleName)) &&
		isRoleCardApplicableToChapter(card as any, input.chapter),
	);
	const applicableRoleCards = roleCards.filter((card: any) =>
		isRoleCardApplicableToChapter(card as any, input.chapter),
	);
	const requiredRoleNames = Array.from(
		new Set(input.requiredRoleNames.map((name) => normalizeRoleName(name)).filter(Boolean)),
	);
	const recurringRoleNames = collectRecurringEntityNames(input.indexData, "characters");
	const requiredCharacterBibles = characterBibles.filter((item) => {
		const nameKey = normalizeRoleName(item.name);
		const sourceKey = normalizeRoleName(item.sourceCharacterId);
		return requiredRoleNames.some((roleName) => roleName === nameKey || (!!sourceKey && roleName === sourceKey));
	});
	const requiredCharacterBibleIds = new Set(requiredCharacterBibles.map((item) => item.id));
	const matchedRoleCards = applicableRoleCards
		.filter((card: any) => {
			const characterBibleId = String(card?.characterBibleId || "").trim();
			if (characterBibleId && requiredCharacterBibleIds.has(characterBibleId)) return true;
			const roleNameKey = normalizeRoleName(card?.roleName);
			return roleNameKey.length > 0 && requiredRoleNames.includes(roleNameKey);
		})
		.sort((a: any, b: any) => Number(b?.updatedAtTs || 0) - Number(a?.updatedAtTs || 0));
	const roleRefMatchStrategy: StoryboardWorkflowContinuityContext["roleRefMatchStrategy"] =
		requiredRoleNames.length > 0 ? "direct_match" : "none";
	const finalizedRequiredRoleNames = requiredRoleNames;
	const persistentRequiredRoleNames = requiredRoleNames.filter((name) =>
		recurringRoleNames.has(name),
	);
	const missingRequiredRoleNames = requiredRoleNames.filter((name) => {
		const matchedBibleIds = characterBibles
			.filter((item) => normalizeRoleName(item.name) === name || normalizeRoleName(item.sourceCharacterId) === name)
			.map((item) => item.id);
		const hasCard = roleCards.some(
			(card: any) =>
				(
					normalizeRoleName(card?.roleName) === name ||
					(String(card?.characterBibleId || "").trim() &&
						matchedBibleIds.includes(String(card?.characterBibleId || "").trim()))
				) &&
				isRoleCardApplicableToChapter(card as any, input.chapter),
		);
		return !hasCard;
	});
	const unconfirmedRequiredRoleNames = requiredRoleNames.filter((name) => {
		const matchedBibleIds = characterBibles
			.filter((item) => normalizeRoleName(item.name) === name || normalizeRoleName(item.sourceCharacterId) === name)
			.map((item) => item.id);
		const hasOnlyUnconfirmed = unconfirmedRoleCards.some(
			(card: any) =>
				(
					normalizeRoleName(card?.roleName) === name ||
					(String(card?.characterBibleId || "").trim() &&
						matchedBibleIds.includes(String(card?.characterBibleId || "").trim()))
				) &&
				isRoleCardApplicableToChapter(card as any, input.chapter),
		);
		if (!hasOnlyUnconfirmed) return false;
		const hasConfirmed = roleCards.some(
			(card: any) =>
				(
					normalizeRoleName(card?.roleName) === name ||
					(String(card?.characterBibleId || "").trim() &&
						matchedBibleIds.includes(String(card?.characterBibleId || "").trim()))
				) &&
				isRoleCardApplicableToChapter(card as any, input.chapter),
		);
		return !hasConfirmed;
	});
	const preferredRoleCards = dedupeRoleCardEntries(matchedRoleCards, 100);
	const coveredRoleNames = new Set(preferredRoleCards.map((x: any) => normalizeRoleName(x?.roleName)).filter(Boolean));
	const bibleFallbackEntries = characterBibles
		.filter((bible) => {
			if (!bible.threeViewUrl) return false;
			const nameKey = normalizeRoleName(bible.name);
			const sourceKey = normalizeRoleName(bible.sourceCharacterId);
			if (coveredRoleNames.has(nameKey) || (sourceKey && coveredRoleNames.has(sourceKey))) return false;
			return finalizedRequiredRoleNames.some((r) => r === nameKey || (!!sourceKey && r === sourceKey));
		})
		.slice(0, Math.max(0, 100 - preferredRoleCards.length));
	const roleReferenceImages: string[] = [
		...preferredRoleCards.map((x) => x.imageUrl),
		...bibleFallbackEntries.map((b) => b.threeViewUrl as string),
	];
	const selectVisualRef = (category: "scene_prop" | "spell_fx", explicitRefId?: string) => {
		const applicable = visualRefs
			.filter(
				(item: {
					category: "scene_prop" | "spell_fx";
					chapter?: number;
					chapterStart?: number;
					chapterEnd?: number;
					chapterSpan?: number[];
				}) =>
					item.category === category &&
					isRoleCardApplicableToChapter(
						{
							chapter: item.chapter,
							chapterStart: item.chapterStart,
							chapterEnd: item.chapterEnd,
							chapterSpan: item.chapterSpan,
						},
						input.chapter,
					),
			)
			.sort((a: { updatedAtTs: number }, b: { updatedAtTs: number }) => b.updatedAtTs - a.updatedAtTs);
		if (!explicitRefId) return null;
		return applicable.find((item: { refId: string }) => item.refId === explicitRefId) || null;
	};
	const scenePropSelected = selectVisualRef("scene_prop", input.scenePropRefId);
	const spellFxSelected = selectVisualRef("spell_fx", input.spellFxRefId);
	const recurringSceneNames = collectRecurringEntityNames(input.indexData, "scenes");
	const recurringPropNames = collectRecurringEntityNames(input.indexData, "props");
	const chapterSceneNames = listChapterEntityNames(input.indexData, input.chapter, "scenes");
	const chapterPropNames = listChapterEntityNames(input.indexData, input.chapter, "props");
	const scenePropRequired =
		chapterSceneNames.some((name) => recurringSceneNames.has(name)) ||
		chapterPropNames.some((name) => recurringPropNames.has(name));
	const hasUnconfirmedScenePropReference = unconfirmedVisualRefs.some(
		(item: {
			category: "scene_prop" | "spell_fx";
			chapter?: number;
			chapterStart?: number;
			chapterEnd?: number;
			chapterSpan?: number[];
		}) =>
			item.category === "scene_prop" &&
			isRoleCardApplicableToChapter(
				{
					chapter: item.chapter,
					chapterStart: item.chapterStart,
					chapterEnd: item.chapterEnd,
					chapterSpan: item.chapterSpan,
				},
				input.chapter,
			),
	);
	const availableChapterRoleCardNames: string[] = Array.from(
		new Set(
			chapterRoleCards
				.map((x: any) => String(x?.roleName || "").trim())
				.filter(Boolean),
		),
	);
	const availableApplicableRoleCardNames: string[] = Array.from(
		new Set(
			applicableRoleCards
				.map((x: any) => String(x?.roleName || "").trim())
				.filter(Boolean),
		),
	);
	const availableUnconfirmedChapterRoleCardNames: string[] = Array.from(
		new Set(
			unconfirmedRoleCards
				.filter((card: any) =>
					new Set(chapterRoleNames).has(normalizeRoleName(card?.roleName)) &&
					isRoleCardApplicableToChapter(card as any, input.chapter),
				)
				.map((x: any) => String(x?.roleName || "").trim())
				.filter(Boolean),
		),
	);
	const styleReferenceImages: string[] = Array.isArray(styleBible?.referenceImages)
		? Array.from(
			new Set(
				styleBible.referenceImages
					.map((item: any) => String(item || "").trim())
					.filter(Boolean),
			),
		).slice(0, 6) as string[]
		: [];
	const prevTailFrameUrl = String(input.prevTailFrameUrl || "").trim() || null;
	const stylePromptPrefix = buildStylePromptPrefix(styleBible);
	const bibleCoveredRoleNames = new Set(
		bibleFallbackEntries.flatMap((b) => [normalizeRoleName(b.name), normalizeRoleName(b.sourceCharacterId)].filter(Boolean)),
	);
	const missingRequiredRoleNamesFiltered = missingRequiredRoleNames.filter((name) => !bibleCoveredRoleNames.has(name));
	return {
		roleReferenceImages,
		roleReferenceEntries: [
			...preferredRoleCards.map((x) => ({
				cardId: String(x.cardId || "").trim(),
				...(String((x as any).characterBibleId || "").trim()
					? { characterBibleId: String((x as any).characterBibleId || "").trim() }
					: null),
				roleName: String(x.roleName || "").trim(),
				...(() => {
					const bible = characterBibles.find(
						(item) => item.id === String((x as any).characterBibleId || "").trim(),
					);
					return bible?.identityHint ? { identityHint: bible.identityHint } : null;
				})(),
				imageUrl: String(x.imageUrl || "").trim(),
				...(String(x.stateDescription || "").trim() ? { stateDescription: String(x.stateDescription || "").trim() } : null),
				...(typeof x.chapter === "number" ? { chapter: x.chapter } : null),
				...(typeof x.chapterStart === "number" ? { chapterStart: x.chapterStart } : null),
				...(typeof x.chapterEnd === "number" ? { chapterEnd: x.chapterEnd } : null),
				...(Array.isArray(x.chapterSpan) && x.chapterSpan.length ? { chapterSpan: x.chapterSpan } : null),
			})),
			...bibleFallbackEntries.map((bible) => ({
				cardId: `bible-${bible.id}`,
				characterBibleId: bible.id,
				roleName: bible.name,
				...(bible.identityHint ? { identityHint: bible.identityHint } : null),
				imageUrl: bible.threeViewUrl as string,
				stateDescription: "角色圣经三视图",
			})),
		],
		styleReferenceImages,
		scenePropReference: scenePropSelected
			? {
					refId: String(scenePropSelected.refId || "").trim(),
					label: String(scenePropSelected.name || "").trim() || "场景道具参考",
					imageUrl: String(scenePropSelected.imageUrl || "").trim(),
			  }
			: null,
		scenePropRequired,
		spellFxReference: spellFxSelected
			? {
					refId: String(spellFxSelected.refId || "").trim(),
					label: String(spellFxSelected.name || "").trim() || "法术特效参考",
					imageUrl: String(spellFxSelected.imageUrl || "").trim(),
			  }
			: null,
		chapterRoleNames,
		requiredRoleNames: finalizedRequiredRoleNames,
		persistentRequiredRoleNames,
		missingRequiredRoleNames: missingRequiredRoleNamesFiltered,
		unconfirmedRequiredRoleNames,
		availableChapterRoleCardNames,
		availableApplicableRoleCardNames,
		availableUnconfirmedChapterRoleCardNames,
		hasUnconfirmedScenePropReference,
		roleRefMatchStrategy,
		prevTailFrameUrl,
		stylePromptPrefix,
	};
}

async function readStoryboardChunksForBook(
	projectId: string,
	bookId: string,
	ownerId?: string,
): Promise<{ indexPath: string; chunks: StoryboardChunkRecord[]; indexData: BookIndexRecord }> {
	const indexPath = await resolveReadableBookIndexPath({ projectId, bookId, ownerId });
	const indexData = await readBookIndexForAgents(indexPath);
	const assets =
		indexData.assets && typeof indexData.assets === "object" && !Array.isArray(indexData.assets)
			? (indexData.assets as Record<string, unknown>)
			: {};
	const chunks = Array.isArray(assets.storyboardChunks) ? (assets.storyboardChunks as StoryboardChunkRecord[]) : [];
	return { indexPath, chunks, indexData };
}


export async function getStoryboardContinuityEvidence(
	input: {
		projectId: string;
		bookId: string;
		taskId: string;
		chapter: number;
		groupSize: StoryboardGroupSize;
		chunkIndex: number;
		previousChunkId?: string;
		requiredRoleNames?: string[];
		scenePropRefId?: string;
		spellFxRefId?: string;
	},
	ownerId?: string,
): Promise<StoryboardContinuityEvidenceDto> {
	const { chunks, indexData } = await readStoryboardChunksForBook(
		input.projectId,
		input.bookId,
		ownerId,
	);
	const taskId = String(input.taskId || "").trim();
	if (!taskId) {
		throw new AppError("taskId is required", {
			status: 400,
			code: "storyboard_task_id_required",
		});
	}
	const chapterChunks = chunks
		.filter(
			(chunk) =>
				String(chunk.taskId || "").trim() === taskId &&
				Number(chunk?.chapter) === input.chapter &&
				Number(chunk?.groupSize) === input.groupSize,
		)
		.sort((a, b) => Number(a?.chunkIndex || 0) - Number(b?.chunkIndex || 0));
	const previousChunk = requireExactStoryboardPreviousChunk({
		chunks: chunks.map((chunk) => ({
			...chunk,
			taskId: String(chunk.taskId || "").trim(),
		})),
		taskId,
		chapter: input.chapter,
		groupSize: input.groupSize,
		chunkIndex: input.chunkIndex,
		previousChunkId: input.previousChunkId,
		contextLabel: "storyboard continuity",
	});
	if (previousChunk) {
		const previousArtifact = previousChunk.storyboardArtifact;
		if (!previousArtifact) {
			throw new AppError("上一分组缺少 storyboard-director/v1.2 artifact", {
				status: 409,
				code: "storyboard_previous_v12_artifact_required",
			});
		}
		requireStoryboardV12ArtifactPayload({
			storyboardStructured: previousArtifact,
			shotPrompts: previousChunk.shotPrompts,
			maxShotPrompts: 128,
			contextLabel: "storyboard continuity previous chunk",
		});
	}
	const continuity = resolveStoryboardWorkflowContinuity({
		indexData,
		chapter: input.chapter,
		requiredRoleNames: Array.isArray(input.requiredRoleNames)
			? input.requiredRoleNames.map((item) => String(item || "").trim()).filter(Boolean)
			: [],
		prevTailFrameUrl: previousChunk?.tailFrameUrl ?? null,
		...(input.scenePropRefId ? { scenePropRefId: input.scenePropRefId } : {}),
		...(input.spellFxRefId ? { spellFxRefId: input.spellFxRefId } : {}),
	});
	const currentChunk =
		chapterChunks.find((chunk) => Number(chunk?.chunkIndex) === input.chunkIndex) || null;
	const exactPrevTailFrameUrl = previousChunk ? previousChunk.tailFrameUrl.trim() : null;

	return {
		projectId: input.projectId,
		bookId: input.bookId,
		chapter: input.chapter,
		groupSize: input.groupSize,
		chunkIndex: input.chunkIndex,
		prevTailFrameUrl: exactPrevTailFrameUrl,
		roleReferenceImages: continuity.roleReferenceImages,
		roleReferenceEntries: continuity.roleReferenceEntries,
		styleReferenceImages: continuity.styleReferenceImages,
		scenePropReference: continuity.scenePropReference,
		scenePropRequired: continuity.scenePropRequired,
		spellFxReference: continuity.spellFxReference,
		chapterRoleNames: continuity.chapterRoleNames,
		requiredRoleNames: continuity.requiredRoleNames,
		persistentRequiredRoleNames: continuity.persistentRequiredRoleNames,
		missingRequiredRoleNames: continuity.missingRequiredRoleNames,
		unconfirmedRequiredRoleNames: continuity.unconfirmedRequiredRoleNames,
		availableChapterRoleCardNames: continuity.availableChapterRoleCardNames,
		availableApplicableRoleCardNames: continuity.availableApplicableRoleCardNames,
		availableUnconfirmedChapterRoleCardNames:
			continuity.availableUnconfirmedChapterRoleCardNames,
		hasUnconfirmedScenePropReference: continuity.hasUnconfirmedScenePropReference,
		roleRefMatchStrategy: continuity.roleRefMatchStrategy,
		stylePromptPrefix: continuity.stylePromptPrefix,
		currentChunk,
		previousChunk,
		chapterChunks,
	};
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function readTrimmedString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed || null;
}

function readFiniteNumber(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return value;
}

function buildChapterContentSlice(chapter: BookChapterContext): string {
	const fullText = String(chapter.content || "");
	if (!fullText) return "";
	const start =
		typeof chapter.chapterStartOffset === "number" && Number.isFinite(chapter.chapterStartOffset)
			? Math.max(0, Math.trunc(chapter.chapterStartOffset))
			: 0;
	const end =
		typeof chapter.chapterEndOffset === "number" && Number.isFinite(chapter.chapterEndOffset)
			? Math.max(start, Math.trunc(chapter.chapterEndOffset))
			: fullText.length;
	return fullText.slice(start, Math.min(end, fullText.length)).trim();
}

function buildPreview(value: unknown, maxChars: number): string | null {
	const text = readTrimmedString(value);
	if (!text) return null;
	return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function summarizeStoryboardSourceFlow(flowData: unknown): {
	nodeCount: number;
	edgeCount: number;
	relevantNodes: StoryboardSourceBundleNodeSummary[];
} {
	const graph = asRecord(flowData);
	const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
	const edges = Array.isArray(graph?.edges) ? graph.edges : [];
	const relevantKinds = new Set([
		"text",
		"novelDoc",
		"scriptDoc",
		"storyboardScript",
		"storyboard",
		"storyboardImage",
		"image",
		"imageEdit",
		"composeVideo",
		"video",
	]);
	const relevantNodes: StoryboardSourceBundleNodeSummary[] = [];
	for (const rawNode of nodes) {
		const node = asRecord(rawNode);
		if (!node) continue;
		const data = asRecord(node.data);
		const type = readTrimmedString(node.type);
		const kind = readTrimmedString(data?.kind);
		const shouldKeep =
			(type === "taskNode" && kind !== null && relevantKinds.has(kind)) ||
			Boolean(readTrimmedString(data?.prompt)) ||
			Boolean(readTrimmedString(data?.content));
		if (!shouldKeep) continue;
		const positionRecord = asRecord(node.position);
		const x = readFiniteNumber(positionRecord?.x);
		const y = readFiniteNumber(positionRecord?.y);
		relevantNodes.push({
			nodeId: readTrimmedString(node.id) || "",
			type,
			kind,
			label: readTrimmedString(data?.label),
			status: readTrimmedString(data?.status),
			position: x !== null && y !== null ? { x, y } : null,
			promptPreview: buildPreview(data?.prompt ?? data?.systemPrompt ?? data?.negativePrompt, 280),
			contentPreview: buildPreview(
				data?.content ??
					data?.text ??
					(Array.isArray(data?.textResults) ? asRecord(data.textResults[data.textResults.length - 1])?.text : null),
				280,
			),
			imageUrl:
				readTrimmedString(data?.imageUrl) ||
				(Array.isArray(data?.imageResults)
					? readTrimmedString(asRecord(data.imageResults[0])?.url)
					: null),
			videoUrl:
				readTrimmedString(data?.videoUrl) ||
				(Array.isArray(data?.videoResults)
					? readTrimmedString(asRecord(data.videoResults[0])?.url)
					: null),
		});
	}
	relevantNodes.sort((left, right) => {
		const ly = left.position?.y ?? 0;
		const ry = right.position?.y ?? 0;
		if (ly !== ry) return ly - ry;
		const lx = left.position?.x ?? 0;
		const rx = right.position?.x ?? 0;
		return lx - rx;
	});
	return {
		nodeCount: nodes.length,
		edgeCount: edges.length,
		relevantNodes: relevantNodes.slice(0, 24),
	};
}

function summarizeNodeForBundle(rawNode: unknown): (StoryboardSourceBundleNodeSummary & {
	rawData: Record<string, unknown>;
}) | null {
	const node = asRecord(rawNode);
	if (!node) return null;
	const data = asRecord(node.data) || {};
	const type = readTrimmedString(node.type);
	const kind = readTrimmedString(data.kind);
	const positionRecord = asRecord(node.position);
	const x = readFiniteNumber(positionRecord?.x);
	const y = readFiniteNumber(positionRecord?.y);
	return {
		nodeId: readTrimmedString(node.id) || "",
		type,
		kind,
		label: readTrimmedString(data.label),
		status: readTrimmedString(data.status),
		position: x !== null && y !== null ? { x, y } : null,
		promptPreview: buildPreview(data.prompt ?? data.systemPrompt ?? data.negativePrompt, 280),
		contentPreview: buildPreview(
			data.content ??
				data.text ??
				(Array.isArray(data.textResults) ? asRecord(data.textResults[data.textResults.length - 1])?.text : null),
			280,
		),
		imageUrl:
			readTrimmedString(data.imageUrl) ||
			(Array.isArray(data.imageResults)
				? readTrimmedString(asRecord(data.imageResults[0])?.url)
				: null),
		videoUrl:
			readTrimmedString(data.videoUrl) ||
			(Array.isArray(data.videoResults)
				? readTrimmedString(asRecord(data.videoResults[0])?.url)
				: null),
		rawData: data,
	};
}

export async function getStoryboardSourceBundle(input: {
	c: AppContext;
	ownerId: string;
	projectId: string;
	flowId: string;
	bookId?: string | null;
	chapter?: number | null;
	refresh?: boolean;
}): Promise<StoryboardSourceBundleDto> {
	const projectContext = await getProjectWorkspaceContext({
		c: input.c,
		ownerId: input.ownerId,
		projectId: input.projectId,
		bookId: input.bookId ?? null,
		chapter: input.chapter ?? null,
		refresh: input.refresh ?? false,
	});
	const flow = await getFlowForOwner(input.c.env.DB, input.flowId, input.ownerId);
	if (!flow) {
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}
	const flowDto = mapFlowRowToDto(flow);
	const flowSummary = summarizeStoryboardSourceFlow(flowDto.data);
	const chapterContextResolution = await resolveBookChapterContextWithDiagnostics({
		projectId: input.projectId,
		ownerId: input.ownerId,
		bookId: input.bookId ?? null,
		chapter: input.chapter ?? null,
	});
	const chapterContext = chapterContextResolution.context;
	const effectiveBookId = projectContext.currentBookId ?? chapterContext?.bookId ?? null;
	const effectiveChapter = projectContext.currentChapter ?? chapterContext?.chapter ?? null;
	const latestChunk =
		effectiveBookId && effectiveChapter
			? (
					await readStoryboardChunksForBook(
						input.projectId,
						effectiveBookId,
						input.ownerId,
					)
				).chunks
					.filter((chunk) => Number(chunk?.chapter) === effectiveChapter)
					.sort((left, right) => {
						const updatedDiff = String(right?.updatedAt || "").localeCompare(
							String(left?.updatedAt || ""),
						);
						if (updatedDiff !== 0) return updatedDiff;
						return Number(right?.chunkIndex || 0) - Number(left?.chunkIndex || 0);
					})[0] ?? null
			: null;
	return {
		projectId: input.projectId,
		flowId: input.flowId,
		bookId: effectiveBookId,
		chapter: effectiveChapter,
		projectContext,
		chapterContext: chapterContext
			? {
					bookId: chapterContext.bookId,
					bookTitle: chapterContext.bookTitle,
					chapter: chapterContext.chapter,
					chapterTitle: chapterContext.chapterTitle,
					content: buildChapterContentSlice(chapterContext),
					summary: chapterContext.summary ?? null,
					keywords: Array.isArray(chapterContext.keywords) ? chapterContext.keywords : [],
					coreConflict: chapterContext.coreConflict ?? null,
					characters: Array.isArray(chapterContext.characters) ? chapterContext.characters : [],
					props: Array.isArray(chapterContext.props) ? chapterContext.props : [],
					scenes: Array.isArray(chapterContext.scenes) ? chapterContext.scenes : [],
					locations: Array.isArray(chapterContext.locations) ? chapterContext.locations : [],
				}
			: null,
		flowSummary: {
			flowId: flowDto.id,
			flowName: flowDto.name,
			nodeCount: flowSummary.nodeCount,
			edgeCount: flowSummary.edgeCount,
			relevantNodes: flowSummary.relevantNodes,
		},
		diagnostics: {
			progress: {
				currentBookId: projectContext.currentBookId,
				currentChapter: projectContext.currentChapter,
				latestStoryboardChunk: latestChunk,
			},
			recentShots: flowSummary.relevantNodes
				.filter((node) =>
					node.kind === "image" ||
					node.kind === "imageEdit" ||
					node.kind === "storyboardImage" ||
					node.kind === "composeVideo" ||
					node.kind === "video",
				)
				.slice(-8)
				.map((node) => ({
					nodeId: node.nodeId,
					kind: node.kind,
					label: node.label,
					imageUrl: node.imageUrl,
					videoUrl: node.videoUrl,
				})),
			chapterContextResolution: chapterContextResolution.diagnostics,
		},
	};
}

export async function getNodeContextBundle(input: {
	c: AppContext;
	ownerId: string;
	projectId: string;
	flowId: string;
	nodeId: string;
	flowRow?: FlowRow;
}): Promise<NodeContextBundleDto> {
	const flow = input.flowRow ?? await getFlowForOwner(input.c.env.DB, input.flowId, input.ownerId);
	if (!flow) {
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}
	const flowDto = mapFlowRowToDto(flow);
	const graph = asRecord(flowDto.data);
	const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
	const edges = Array.isArray(graph?.edges) ? graph.edges : [];
	const nodeById = new Map<string, unknown>();
	for (const node of nodes) {
		const record = asRecord(node);
		const id = readTrimmedString(record?.id);
		if (!id) continue;
		nodeById.set(id, node);
	}
	const rawNode = nodeById.get(input.nodeId);
	if (!rawNode) {
		throw new AppError("Node not found", {
			status: 404,
			code: "flow_node_not_found",
			details: { nodeId: input.nodeId },
		});
	}
	const upstreamIds = new Set<string>();
	const downstreamIds = new Set<string>();
	for (const rawEdge of edges) {
		const edge = asRecord(rawEdge);
		const source = readTrimmedString(edge?.source);
		const target = readTrimmedString(edge?.target);
		if (!source || !target) continue;
		if (target === input.nodeId) upstreamIds.add(source);
		if (source === input.nodeId) downstreamIds.add(target);
	}
	const upstreamNodes = Array.from(upstreamIds)
		.map((id) => summarizeNodeForBundle(nodeById.get(id)))
		.filter((item): item is NonNullable<typeof item> => item !== null);
	const downstreamNodes = Array.from(downstreamIds)
		.map((id) => summarizeNodeForBundle(nodeById.get(id)))
		.filter((item): item is NonNullable<typeof item> => item !== null);

	const executionRows = await listExecutionsForOwnerFlow(input.c.env.DB, {
		ownerId: input.ownerId,
		flowId: input.flowId,
		limit: 10,
	});
	const recentExecutions: NodeContextBundleDto["recentExecutions"] = [];
	for (const row of executionRows) {
		const nodeRuns = (await listNodeRunsForExecutionOwner(input.c.env.DB, {
			ownerId: input.ownerId,
			executionId: row.id,
		}))
			.filter((item) => item.node_id === input.nodeId)
			.slice(0, 8)
			.map((item) => mapNodeRunRow(item));
		const events = (await listExecutionEvents(input.c.env.DB, {
			executionId: row.id,
			afterSeq: 0,
			limit: 100,
		}))
			.filter((item) => item.node_id === input.nodeId)
			.slice(-20)
			.map((item) => mapExecutionEventRow(item));
		if (!nodeRuns.length && !events.length) continue;
		const execution = mapExecutionRow(row);
		recentExecutions.push({
			id: execution.id,
			status: execution.status,
			createdAt: execution.createdAt,
			startedAt: execution.startedAt ?? null,
			finishedAt: execution.finishedAt ?? null,
			nodeRuns: nodeRuns.map((item) => ({
				id: item.id,
				status: item.status,
				attempt: item.attempt,
				errorMessage: item.errorMessage ?? null,
				outputRefs: item.outputRefs,
				createdAt: item.createdAt,
				startedAt: item.startedAt ?? null,
				finishedAt: item.finishedAt ?? null,
			})),
			events: events.map((item) => ({
				id: item.id,
				seq: item.seq,
				eventType: item.eventType,
				level: item.level,
				nodeId: item.nodeId ?? null,
				message: item.message ?? null,
				data: item.data,
				createdAt: item.createdAt,
			})),
		});
		if (recentExecutions.length >= 5) break;
	}

	const executionTraces = (await listUserExecutionTraces(input.c, input.ownerId, {
		limit: 40,
		requestKindPrefix: "agents_bridge:",
	}))
		.filter((trace) => {
			const metaNodeId = readTrimmedString(trace.meta?.nodeId);
			const metaProjectId = readTrimmedString(trace.meta?.projectId);
			const metaFlowId = readTrimmedString(trace.meta?.flowId);
			return metaNodeId === input.nodeId && metaProjectId === input.projectId && metaFlowId === input.flowId;
		})
		.slice(0, 12)
		.map((trace) => ({
			id: trace.id,
			requestKind: trace.requestKind,
			inputSummary: trace.inputSummary,
			resultSummary: trace.resultSummary ?? null,
			errorCode: trace.errorCode ?? null,
			errorDetail: trace.errorDetail ?? null,
			createdAt: trace.createdAt,
			meta: trace.meta ?? null,
		}));

	const storyboardDiagnostics = (await listStoryboardDiagnosticLogs(input.c.env.DB, {
		ownerId: input.ownerId,
		projectId: input.projectId,
		limit: 30,
	}))
		.slice(0, 30)
		.map((item) => ({
			shotId: item.shotId ?? null,
			jobId: item.jobId ?? null,
			stage: item.stage,
			level: item.level,
			message: item.message,
			summary: item.summary ?? null,
			createdAt: item.createdAt,
		}));

	return {
		projectId: input.projectId,
		flowId: input.flowId,
		nodeId: input.nodeId,
		node: summarizeNodeForBundle(rawNode) as NodeContextBundleDto["node"],
		upstreamNodes,
		downstreamNodes,
		recentExecutions,
		diagnostics: {
			executionTraces,
			storyboardDiagnostics,
		},
	};
}

export async function getVideoReviewBundle(input: {
	c: AppContext;
	ownerId: string;
	projectId: string;
	flowId: string;
	nodeId: string;
	flowRow?: FlowRow;
}): Promise<VideoReviewBundleDto> {
	const nodeContext = await getNodeContextBundle(input);
	const rawData = nodeContext.node.rawData;
	const kind = nodeContext.node.kind;
	const videoResultsRaw = Array.isArray(rawData.videoResults) ? rawData.videoResults : [];
	const videoResults = videoResultsRaw
		.map((item) => asRecord(item))
		.filter((item): item is Record<string, unknown> => item !== null)
		.map((item) => ({
			url: readTrimmedString(item.url),
			thumbnailUrl: readTrimmedString(item.thumbnailUrl),
		}));
	const videoUrl = readTrimmedString(rawData.videoUrl) || videoResults[0]?.url || null;
	const isVideoNode =
		kind === "composeVideo" ||
		kind === "video" ||
		Boolean(videoUrl) ||
		videoResults.length > 0;
	if (!isVideoNode) {
		throw new AppError("Node is not a video review target", {
			status: 400,
			code: "node_not_video_review_target",
			details: { nodeId: input.nodeId, kind },
		});
	}
	const storyBeatPlan = Array.isArray(rawData.storyBeatPlan)
		? rawData.storyBeatPlan.map((item) => String(item || "").trim()).filter(Boolean)
		: [];
	return {
		projectId: input.projectId,
		flowId: input.flowId,
		nodeId: input.nodeId,
		videoNode: {
			nodeId: nodeContext.node.nodeId,
			kind,
			label: nodeContext.node.label,
			prompt: readTrimmedString(rawData.prompt),
			storyBeatPlan,
			videoUrl,
			videoResults,
		},
		nodeContext,
	};
}
