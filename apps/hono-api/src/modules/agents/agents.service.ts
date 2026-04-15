import { AppError } from "../../middleware/error";
import { setTraceStage } from "../../trace";
import type { AppContext } from "../../types";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { isAdminRequest } from "../team/team.service";
import { getProjectById, getProjectForOwner } from "../project/project.repo";
import { getFlowForOwner, mapFlowRowToDto } from "../flow/flow.repo";
import { listAssetsForUser, createAssetRow, getAssetByIdForUser } from "../asset/asset.repo";
import { uploadInlineImageToRustfs } from "../task/task.inline-asset-utils";
import { runAgentsBridgeChatTask } from "../task/task.agents-bridge";
import type { TaskRequestDto } from "../task/task.schemas";
import { runPublicTask } from "../apiKey/apiKey.routes";
import { fetchTaskResultForPolling } from "../task/task.polling";
import { resolveProjectDataRepoRoot } from "../asset/project-data-root";
import {
	AgentSkillSchema,
	AgentPipelineRunSchema,
	type AgentDiagnosticsResponseDto,
	type ProjectWorkspaceContextDto,
	type UpdateGlobalWorkspaceContextFileRequestDto,
	type UpdateProjectWorkspaceContextFileRequestDto,
	type AgentSkillDto,
	type AgentPipelineRunDto,
	type UpsertAgentSkillRequestDto,
	type CreateAgentPipelineRunRequestDto,
	type UpdateAgentPipelineRunStatusRequestDto,
	type ExecuteAgentPipelineRunRequestDto,
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
import { resolveStoryboardGovernanceModelKey } from "./agents.model-keys";
import {
	listUserExecutionTraces,
	persistStoryboardChunkMemoryWithDb,
} from "../memory/memory.service";
import {
	listRecentPublicChatTurnRuns,
	type PublicChatTurnRunRow,
} from "../apiKey/public-chat-session.repo";
import { listStoryboardDiagnosticLogs } from "../storyboard/storyboard.repo";
import {
	listExecutionEvents,
	listExecutionsForOwnerFlow,
	listNodeRunsForExecutionOwner,
	mapExecutionEventRow,
	mapExecutionRow,
	mapNodeRunRow,
} from "../execution/execution.repo";
import {
	adaptStoryboardShotDesignToStructuredData,
	assessStoryboardMiniArc,
	derivePromptFromStructuredShot,
	type StoryboardShotDesignArtifact,
	type StoryboardStructuredData,
} from "../storyboard/storyboard-structure";
import {
	buildStoryboardPrecedentPromptBlock,
	loadStoryboardPrecedentLibrary,
	retrieveRelevantStoryboardPrecedents,
} from "../storyboard/storyboard-note-precedents";
import {
	ensureProjectWorkspaceContextFiles,
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
import type { PublicFlowAnchorBinding } from "../flow/flow.anchor-bindings";

const GENERATE_MEDIA_REQUIRED_SKILL = "generate-media";
const STORYBOARD_ORCHESTRATOR_SKILL = "tapcanvas-storyboard-expert";
const STORYBOARD_GRID_BATCH_SIZE = 25 as const;
const STORYBOARD_FALLBACK_CHAPTER_SHOT_CAP = 200 as const;
const STORYBOARD_NO_TEXT_OVERLAY_RULE =
	"硬约束：画面内禁止任何可见文字元素（对白气泡、字幕条、拟声字、标题字、UI字、水印、logo、签名、印章、边框注释）。";
const STORYBOARD_DEFAULT_GROUP_SIZE: StoryboardGroupSize = STORYBOARD_GRID_BATCH_SIZE;
const STORYBOARD_DEFAULT_IMAGE_MODEL_KEY = "gemini-2.5-flash-image";
const STORYBOARD_ANIME_QUALITY_RULES = [
	"【动漫审美与质量把控】",
	"- 风格定位：高完成度二维动画电影质感（非照片写实、非Q版、非低幼卡通）。",
	"- 角色一致性：同角色在发型轮廓、脸型比例、瞳色、服装主材质与配色ID上必须连续稳定。",
	"- 镜头可执行性：每镜必须明确主体动作、景别、机位运动、空间前后景关系。",
	"- 光影与色彩：主光方向与时间段要可追溯，避免无因跳光；色调围绕章节情绪稳定演进。",
	"- 质量负面词：禁止崩坏肢体、重复人脸分身、涂抹脸、漂移五官、过曝欠曝、脏污噪点。",
].join("\n");

function normalizeStoryboardGroupSize(input: unknown): StoryboardGroupSize {
	const n = Math.trunc(Number(input));
	if (n === 25 || n === 9 || n === 4 || n === 1) return n;
	return STORYBOARD_DEFAULT_GROUP_SIZE;
}

function getStoryboardGridLayout(groupSize: StoryboardGroupSize): "1x1" | "2x2" | "3x3" | "5x5" {
	if (groupSize === 25) return "5x5";
	if (groupSize === 9) return "3x3";
	if (groupSize === 4) return "2x2";
	return "1x1";
}

function readPositiveIntFromEnv(name: string, fallback: number, min = 1, max = 100000): number {
	const raw = Number(process.env[name] || fallback);
	if (!Number.isFinite(raw)) return fallback;
	const n = Math.trunc(raw);
	if (n < min) return min;
	if (n > max) return max;
	return n;
}

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
		label?: string;
	},
): boolean {
	const projectId = input.projectId ? extractTraceMetaValue(meta, "projectId") : "";
	const bookId = input.bookId ? extractTraceMetaValue(meta, "bookId") : "";
	const chapterId = input.chapterId ? extractTraceMetaValue(meta, "chapterId") : "";
	const label = input.label ? extractTraceMetaValue(meta, "label") : "";
	if (input.projectId && projectId !== input.projectId) return false;
	if (input.bookId && bookId !== input.bookId) return false;
	if (input.chapterId && chapterId !== input.chapterId) return false;
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

function truncateForLog(value: unknown, max = 2000): string {
	const text = String(value ?? "");
	return text.length > max ? `${text.slice(0, max)}…` : text;
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
	input: {
		projectId?: string;
		bookId?: string;
		chapterId?: string;
		label?: string;
		workflowKey?: string;
		turnVerdict?: "satisfied" | "partial" | "failed";
		runOutcome?: "promote" | "hold" | "discard";
		limit: number;
	},
): Promise<AgentDiagnosticsResponseDto> {
	requireAdmin(c);
	const traces = (await listUserExecutionTraces(c, userId, {
		limit: Math.max(input.limit * 3, 60),
		requestKindPrefix: "agents_bridge:",
	})).filter((item) => matchesDiagnosticsFilter(item.meta, input)).slice(0, input.limit);
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
		label: input.label ?? null,
		traces,
		publicChatRuns,
		storyboardDiagnostics,
	};
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

function inferChapterFromText(value: string): number | null {
	const text = String(value || "");
	const m = text.match(/第\s*([0-9]{1,4})\s*章/);
	if (!m) return null;
	const n = Number(m[1]);
	return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function sanitizePathSegment(raw: string): string {
	return String(raw || "")
		.trim()
		.replace(/[^a-zA-Z0-9._-]/g, "_")
		.slice(0, 120);
}

function buildLegacyProjectBooksRoot(projectId: string): string {
	return path.join(
		resolveProjectDataRepoRoot(process.cwd()),
		"project-data",
		sanitizePathSegment(projectId),
		"books",
	);
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

function buildProjectAgentRunsRoot(projectId: string, ownerId?: string): string {
	return path.join(
		buildProjectDataRoot(projectId, ownerId),
		"agents-runs",
	);
}

function buildBookIndexPath(projectId: string, bookId: string, ownerId?: string): string {
	return path.join(
		buildProjectBooksRoot(projectId, ownerId),
		sanitizePathSegment(bookId),
		"index.json",
	);
}

function buildBookProcessRoot(projectId: string, bookId: string, ownerId?: string): string {
	return path.join(
		buildProjectBooksRoot(projectId, ownerId),
		sanitizePathSegment(bookId),
		"process",
	);
}

function buildStoryboardShotProcessPath(input: {
	projectId: string;
	bookId: string;
	shotNo: number;
	ownerId?: string;
}): string {
	const safeShotNo = Math.max(1, Math.trunc(Number(input.shotNo) || 1));
	const shotNoPadded = String(safeShotNo).padStart(4, "0");
	return path.join(
		buildBookProcessRoot(input.projectId, input.bookId, input.ownerId),
		`shot-${shotNoPadded}.json`,
	);
}

function buildStoryboardChunkProcessPath(input: {
	projectId: string;
	bookId: string;
	chunkId: string;
	ownerId?: string;
}): string {
	const safeChunkId = sanitizePathSegment(String(input.chunkId || "").trim() || "chunk-unknown");
	return path.join(
		buildBookProcessRoot(input.projectId, input.bookId, input.ownerId),
		`${safeChunkId}.json`,
	);
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
	const dir = path.dirname(filePath);
	const tmp = path.join(
		dir,
		`.tmp-${sanitizePathSegment(path.basename(filePath))}-${Date.now()}-${crypto.randomUUID()}.json`,
	);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
	await fs.rename(tmp, filePath);
}

async function resolveReadableBookIndexPath(input: {
	projectId: string;
	bookId: string;
	ownerId?: string;
}): Promise<string> {
	const scoped = buildBookIndexPath(input.projectId, input.bookId, input.ownerId);
	const legacy = buildBookIndexPath(input.projectId, input.bookId);
	try {
		await fs.access(scoped);
		return scoped;
	} catch {
		return legacy;
	}
}

async function readJsonFileSafe(filePath: string): Promise<any | null> {
	try {
		const raw = await fs.readFile(filePath, "utf8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
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

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.min(max, Math.trunc(n)));
}

function readMaxNovelCharsForPrompt(): number {
	const raw = String((globalThis as any)?.process?.env?.AGENTS_PIPELINE_MAX_NOVEL_CHARS || "").trim();
	return clampInt(raw, 20_000, 300_000, 120_000);
}

function readMaxScriptCharsForPrompt(): number {
	const raw = String((globalThis as any)?.process?.env?.AGENTS_PIPELINE_MAX_SCRIPT_CHARS || "").trim();
	return clampInt(raw, 2_000, 120_000, 12_000);
}

function readMaxStoryboardCharsForPrompt(): number {
	const raw = String((globalThis as any)?.process?.env?.AGENTS_PIPELINE_MAX_STORYBOARD_CHARS || "").trim();
	return clampInt(raw, 2_000, 120_000, 12_000);
}

function buildNovelExcerptForPrompt(input: {
	fullText: string;
	chapterStartOffset?: number;
	chapterEndOffset?: number;
}): { text: string; truncated: boolean } {
	const fullText = String(input.fullText || "");
	const maxChars = readMaxNovelCharsForPrompt();
	if (!fullText) return { text: "", truncated: false };
	if (fullText.length <= maxChars) return { text: fullText, truncated: false };

	const chapterStart = Number.isFinite(input.chapterStartOffset) ? Math.max(0, Math.trunc(Number(input.chapterStartOffset))) : 0;
	const chapterEnd = Number.isFinite(input.chapterEndOffset)
		? Math.max(chapterStart, Math.trunc(Number(input.chapterEndOffset)))
		: chapterStart;

	const around = 6000;
	const start = Math.max(0, chapterStart - around);
	const end = Math.min(fullText.length, Math.max(chapterEnd + around, chapterStart + 1));
	const chapterWindow = fullText.slice(start, end).trim();
	const head = fullText.slice(0, Math.min(12_000, Math.max(0, maxChars - 24_000))).trim();
	const tail = fullText.slice(Math.max(0, fullText.length - 12_000)).trim();
	const sep = "\n\n---\n\n";
	const chapterBudget = Math.max(8_000, maxChars - head.length - tail.length - sep.length * 2 - 400);
	const chapterPart = chapterWindow.slice(0, Math.max(0, chapterBudget)).trim();

	const text = [
		"【说明】原文较长，以下保留：开头片段 + 目标章节附近片段 + 结尾片段（避免超长请求失败）。",
		"【开头片段】",
		head,
		"【目标章节附近片段】",
		chapterPart,
		"【结尾片段】",
		tail,
	]
		.filter(Boolean)
		.join(sep)
		.slice(0, maxChars);
	return { text, truncated: true };
}

function buildSimpleExcerptForPrompt(input: {
	text: string;
	maxChars: number;
	label: string;
}): { text: string; truncated: boolean } {
	const text = String(input.text || "").trim();
	const maxChars = Math.max(1_000, Math.trunc(Number(input.maxChars || 0)));
	if (!text) return { text: "", truncated: false };
	if (text.length <= maxChars) return { text, truncated: false };
	const head = text.slice(0, Math.max(600, Math.floor(maxChars * 0.7))).trim();
	const tail = text.slice(Math.max(0, text.length - Math.max(300, Math.floor(maxChars * 0.25)))).trim();
	const composed = [
		`【说明】${input.label}较长，以下为截断片段（头部+尾部）。`,
		head,
		"---",
		tail,
	]
		.filter(Boolean)
		.join("\n\n")
		.slice(0, maxChars);
	return { text: composed, truncated: true };
}

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
	const booksRoot = buildProjectBooksRoot(input.projectId, input.ownerId);
	const legacyBooksRoot = buildLegacyProjectBooksRoot(input.projectId);
	const chapterNo =
		typeof input.chapter === "number" && Number.isFinite(input.chapter) && input.chapter > 0
			? Math.trunc(input.chapter)
			: null;
	const requestedBookId = input.bookId ? sanitizePathSegment(input.bookId) : null;

	let candidateBookIds: string[] = [];
	if (requestedBookId) candidateBookIds.push(requestedBookId);

	if (!candidateBookIds.length) {
		try {
			let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
			let scopedReadable = false;
			let legacyReadable = false;
			try {
				entries = await fs.readdir(booksRoot, { withFileTypes: true });
				scopedReadable = true;
			} catch {
				entries = [];
			}
			if (!entries.length) {
				try {
					entries = await fs.readdir(legacyBooksRoot, { withFileTypes: true });
					legacyReadable = true;
				} catch {
					entries = [];
				}
			}
			if (!scopedReadable && !legacyReadable && entries.length === 0) {
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
				const idx =
					(await readJsonFileSafe(indexPath)) ||
					(await readJsonFileSafe(path.join(legacyBooksRoot, entry.name, "index.json")));
				if (!idx) continue;
				ranked.push({
					bookId: String(idx.bookId || entry.name),
					updatedAt: String(idx.updatedAt || ""),
				});
			}
			ranked.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
			candidateBookIds = ranked.map((x) => sanitizePathSegment(x.bookId));
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
		const idx = (await readJsonFileSafe(indexPath)) || (await readJsonFileSafe(path.join(legacyBooksRoot, bookId, "index.json")));
		if (!idx) {
			checks.push({ bookId, reason: "book_index_missing" });
			continue;
		}
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
		const raw =
			(await fs.readFile(rawPath, "utf8").catch(() => "")) ||
			(await fs.readFile(path.join(legacyBooksRoot, bookId, "raw.md"), "utf8").catch(() => ""));
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

async function resolveBookChapterContext(input: {
	projectId: string;
	ownerId?: string;
	chapter: number | null;
	bookId?: string | null;
}): Promise<BookChapterContext | null> {
	const resolved = await resolveBookChapterContextWithDiagnostics(input);
	return resolved.context;
}

function summarizeMaterials(
	rows: Array<{ name: string; data: string | null }>,
	input?: { chapter?: number | null },
): {
	novel: string;
	script: string;
	storyboard: string;
} {
	const targetChapter =
		typeof input?.chapter === "number" && Number.isFinite(input.chapter) && input.chapter > 0
			? Math.trunc(input.chapter)
			: null;
	let novel = "";
	let script = "";
	let storyboard = "";
	let fallbackNovel = "";
	let fallbackScript = "";
	let fallbackStoryboard = "";
	for (const row of rows) {
		const parsed = parseJsonSafe(row.data || "") as any;
		const kind = typeof parsed?.kind === "string" ? parsed.kind : "";
		const content = typeof parsed?.content === "string" ? parsed.content.trim() : "";
		if (!content) continue;
		const chapterFromData =
			typeof parsed?.chapter === "number" && Number.isFinite(parsed.chapter)
				? Math.trunc(parsed.chapter)
				: null;
		const chapterFromName = inferChapterFromText(row.name || "");
		const chapterFromContent = inferChapterFromText(content.slice(0, 80));
		const chapter = chapterFromData || chapterFromName || chapterFromContent;
		const chapterMatched = targetChapter ? chapter === targetChapter : true;

		if (kind === "novelDoc" && !fallbackNovel) fallbackNovel = content;
		if (kind === "scriptDoc" && !fallbackScript) fallbackScript = content;
		if (kind === "storyboardScript" && !fallbackStoryboard) fallbackStoryboard = content;

		if (!chapterMatched) continue;
		if (kind === "novelDoc" && !novel) novel = content;
		if (kind === "scriptDoc" && !script) script = content;
		if (kind === "storyboardScript" && !storyboard) storyboard = content;
	}
	return {
		novel: novel || fallbackNovel,
		script: script || fallbackScript,
		storyboard: storyboard || fallbackStoryboard,
	};
}

function buildPipelinePrompt(input: {
	projectName: string;
	title: string;
	goal: string | null;
	stages: string[];
	materials: { novel: string; script: string; storyboard: string };
	bookChapter?: BookChapterContext | null;
	precedentBlock?: string;
	progress?: {
		mode?: "single" | "full";
		groupSize?: 1 | 4 | 9 | 25;
		totalShots?: number;
		completedShots?: number;
		nextShotStart?: number;
		nextShotEnd?: number;
		totalGroups?: number;
		completedGroups?: number;
		existingStoryboardContent?: string;
	} | null;
}): string {
	const goal = input.goal?.trim() || "输出高质量、可拍摄、可生产的视频分镜脚本";
	const stages = input.stages.length ? input.stages.join(" -> ") : "storyboard_generation";
	const progress = input.progress || null;
	const isChunkContinuation =
		!!progress &&
		Number.isFinite(Number(progress.nextShotStart)) &&
		Number.isFinite(Number(progress.nextShotEnd));
	const chapterMeta = input.bookChapter;
	const chapterMetaBlock = chapterMeta
		? [
				`【小说章节元数据】`,
				`书名：${chapterMeta.bookTitle}`,
				`章节：第${chapterMeta.chapter}章 ${chapterMeta.chapterTitle}`,
				chapterMeta.summary ? `摘要：${chapterMeta.summary}` : "",
				chapterMeta.coreConflict ? `核心冲突：${chapterMeta.coreConflict}` : "",
				chapterMeta.keywords?.length ? `关键词：${chapterMeta.keywords.join("、")}` : "",
				chapterMeta.characters?.length
					? `角色：${chapterMeta.characters
							.map((x) => `${x.name}${x.description ? `(${x.description})` : ""}`)
							.join("；")}`
					: "",
				chapterMeta.props?.length
					? `道具：${chapterMeta.props
							.map((x) => `${x.name}${x.description ? `(${x.description})` : ""}`)
							.join("；")}`
					: "",
				chapterMeta.scenes?.length
					? `场景：${chapterMeta.scenes
							.map((x) => `${x.name}${x.description ? `(${x.description})` : ""}`)
							.join("；")}`
					: "",
				chapterMeta.locations?.length
					? `地点：${chapterMeta.locations
							.map((x) => `${x.name}${x.description ? `(${x.description})` : ""}`)
							.join("；")}`
					: "",
				chapterMeta.processedBy ? `元数据来源：${chapterMeta.processedBy}` : "",
		  ]
				.filter(Boolean)
				.join("\n")
		: "";
	const novelExcerpt = isChunkContinuation
		? buildSimpleExcerptForPrompt({
				text: input.materials.novel || "",
				maxChars: 4_000,
				label: "小说素材",
		  })
		: buildNovelExcerptForPrompt({
				fullText: input.materials.novel || "",
				chapterStartOffset: input.bookChapter?.chapterStartOffset,
				chapterEndOffset: input.bookChapter?.chapterEndOffset,
		  });
	const scriptExcerpt = buildSimpleExcerptForPrompt({
		text: input.materials.script || "",
		maxChars: readMaxScriptCharsForPrompt(),
		label: "剧本素材",
	});
	const storyboardExcerpt = buildSimpleExcerptForPrompt({
		text: progress?.existingStoryboardContent?.trim() || input.materials.storyboard || "",
		maxChars: readMaxStoryboardCharsForPrompt(),
		label: "已有分镜脚本",
	});
	const progressBlock = progress
		? [
				"【当前分镜生产进度】",
				progress.mode ? `模式：${progress.mode}` : "",
				typeof progress.groupSize === "number" ? `每组镜头数：${progress.groupSize}` : "",
				typeof progress.totalShots === "number" ? `总镜头数：${progress.totalShots}` : "",
				typeof progress.completedShots === "number" ? `已完成镜头数：${progress.completedShots}` : "",
				typeof progress.totalGroups === "number" ? `总分组数：${progress.totalGroups}` : "",
				typeof progress.completedGroups === "number" ? `已完成分组数：${progress.completedGroups}` : "",
				typeof progress.nextShotStart === "number" && typeof progress.nextShotEnd === "number"
					? `本次需要补全镜头范围：${progress.nextShotStart}-${progress.nextShotEnd}`
					: "",
		  ]
				.filter(Boolean)
				.join("\n")
		: "";
	const continuationRules = progress
		? [
				"【续写目标】",
				"请仅基于本次已确认的续写边界、上一组剧本片段与已存在分镜结果补全后续镜头。",
				isChunkContinuation
					? "仅输出本次需要补全的镜头范围，不要重复输出已完成镜头。"
					: "请输出完整可执行分镜（含已完成与新增镜头），并尽量保证编号连续。",
				typeof progress.nextShotStart === "number" && typeof progress.nextShotEnd === "number"
					? `本次优先覆盖镜头范围：${progress.nextShotStart}-${progress.nextShotEnd}（共 ${Math.max(1, Math.trunc(progress.nextShotEnd - progress.nextShotStart + 1))} 镜）。`
					: "",
				"先做可执行 MVP：每镜写清主体动作、景别/镜头类型、机位/运动，再补充必要的剧情意图与连续性。",
				"相邻镜头尽量拉开差异：主体动作、景别/镜头类型、机位/运动三项里至少变化两项。",
				"prompt_text 只写客观可见内容，不写方法论、解释或抽象修辞。",
		  ].join("\n")
		: "";
	const expectedGroupSize = normalizeStoryboardGroupSize(progress?.groupSize);
	const expectedGridLayout = getStoryboardGridLayout(expectedGroupSize);
	const deliverablesBlock = isChunkContinuation
		? [
				`期望产物（续写模式，关键帧分镜，MVP 版）：`,
				`1) 仅输出 JSON，不要输出任何解释、标题、代码块。`,
				`2) 必须输出 ${expectedGroupSize} 镜并仅覆盖本次镜头范围。`,
				`3) JSON 顶层只需保留最小结构：groupSize, grid_layout, shots。grid_layout=${expectedGridLayout}。`,
				`4) shots 必须是长度 ${expectedGroupSize} 的数组。`,
				"5) 每个 shot 至少包含：shot_number、beat_role、dramatic_beat、story_purpose、continuity、subject_action、shot_type、camera_movement、prompt_text。",
				"6) beat_role 只用 opening / escalation / payoff。首镜 opening，末镜 payoff，中间至少一镜 escalation。",
				"7) prompt_text 必须是可直接用于生图的客观镜头描述，直接写可见主体、动作、机位、光线、色调、构图。",
				"8) 不要输出 shot_design、风格计划、角色卡表、QC 表、流程说明等额外大块内容。",
				"",
				"输出 JSON 示例（只示例 1 镜，实际必须输出完整镜头数）：",
				`{"groupSize":${expectedGroupSize},"grid_layout":"${expectedGridLayout}","shots":[{"shot_number":"分镜 1","beat_role":"opening","dramatic_beat":"人物发现异常并停住","story_purpose":"建立危险信号","continuity":"承接上一组尾帧的站位与视线方向","subject_action":"人物回头，衣摆被风带起","shot_type":"中景","camera_movement":"轻微前推","prompt_text":"中景，人物突然回头停住，衣摆被风带起；镜头轻微前推；冷色夜景，背景走廊虚化，紧张感明确。"}]}`,
		  ].join("\n")
		: [
				"期望产物（必须完整输出，不可省略任一项）：",
				"1) 角色卡镜头约束表：列出本章核心角色（外观锚点、服装锚点、道具锚点、情绪锚点、禁改项）。",
				"2) 场景/道具视觉约束表：列出场景与关键道具在本章的统一美术要求（光线、色调、材质、时代感）。",
				"3) 结构化分镜脚本：按镜头编号连续输出，至少包含画面主体、景别、机位/运动、视角、人物/动物/环境、时间与光照、色调、构图、质量词、时长、台词/字幕、音效、转场。",
				"4) 每个镜头的图像提示词（中英双语）：强调角色一致性、风格连续性、镜头可执行性。",
				"5) 每个镜头的视频提示词：包含动作时序、镜头语言、物理一致性与连续性约束。",
				"6) 生产顺序建议：哪些镜头先做角色锚点关键帧，哪些镜头可并行。",
		  ].join("\n");
	const blocks = [
		`你是 TapCanvas 的专业影视分镜导演与制片 Agent。`,
		`当前项目：${input.projectName}`,
		`任务标题：${input.title}`,
		`目标：${goal}`,
		`阶段：${stages}`,
		"",
		"请基于现有素材直接生成可执行结果；你可以自主决定工作步骤与是否调用工具，不要求固定流程。",
		"如输入不足，请最小化假设并给出可执行方案，不要输出空泛模板。",
		"",
		deliverablesBlock,
		"",
		"输出要求：直接可执行、避免空泛；禁止模板化描述。",
		"提示词写作规则：必须使用客观事实句，直接描述可见事物与可执行镜头指令；禁止比喻、拟人、诗化抒情与抽象修辞。",
		"",
		STORYBOARD_ANIME_QUALITY_RULES,
		"",
		"【强制语义净化规则】",
		"小说素材可能混入作者自述、评论区互动、平台提示或章节外文本。",
		"你必须先做语义净化：仅保留“角色行为 + 场景状态变化 + 冲突推进”的剧情事实。",
		"以下内容禁止写入镜头：作者说明/后记、读者互动、公告、题外话、编辑注释。",
		"对“是否剧情”拿不准时，默认按噪声丢弃，不得强行入镜。",
		"若净化后暂时缺乏剧情事实，必须优先继续读取章节正文或已确认边界对应内容；只有在已拿到明确 chunkIndex、chunk 文件名或目录证据后，才允许继续读取章节相关 raw-chunks；仅在已遍历目标章节相关 chunk 后仍不足时，才允许显式失败；禁止编造。",
		chapterMetaBlock ? `\n${chapterMetaBlock}` : "",
		progressBlock ? `\n${progressBlock}` : "",
		continuationRules ? `\n${continuationRules}` : "",
		"",
		"【小说素材】",
		novelExcerpt.text || "（无）",
		"",
		"【剧本素材】",
		scriptExcerpt.text || "（无）",
		"",
		"【已有分镜脚本】",
		storyboardExcerpt.text || "（无）",
		input.precedentBlock ? `\n${input.precedentBlock}` : "",
	];
	return blocks.join("\n");
}

function validateStoryboardExpertOutputOrThrow(text: string): void {
	const content = String(text || "").trim();
	if (!content) {
		throw new AppError("分镜输出为空：未返回任何内容", {
			status: 400,
			code: "storyboard_output_empty",
		});
	}
	if (/(?:^|\n)\s*(?:TodoWrite|read_file|write_file|edit_file|bash)\b/i.test(content)) {
		throw new AppError("分镜输出包含工具调用痕迹：必须只返回镜头脚本", {
			status: 400,
			code: "storyboard_output_contains_tool_trace",
		});
	}
}

function validateStoryboardJsonContractOrThrow(input: {
	text: string;
	expectedCount: number;
	expectedGridLayout?: string;
	contextLabel: string;
}): void {
	const parsed = extractJsonObjectFromText(input.text);
	if (!parsed || !Array.isArray(parsed.shots)) {
		throw new AppError(`${input.contextLabel} 未返回可解析的 JSON shots`, {
			status: 400,
			code: "storyboard_output_json_required",
		});
	}
	const schemaVersion = String((parsed as { schemaVersion?: unknown }).schemaVersion || "").trim();
	if (schemaVersion === "storyboard-director/v1.1") {
		if (parsed.shots.length !== input.expectedCount) {
			throw new AppError(
				`${input.contextLabel} shots 数量非法：期望 ${input.expectedCount}，实际 ${parsed.shots.length}`,
				{
					status: 400,
					code: "storyboard_output_shot_count_invalid",
				},
			);
		}
		return;
	}
	const groupSizeRaw = Number(parsed.groupSize);
	const gridLayout = String((parsed as any).grid_layout || "").trim().toLowerCase();
	const hasGridLayout = Boolean(gridLayout);
	const expectedGridLayout = String(input.expectedGridLayout || "").trim().toLowerCase();
	if (hasGridLayout && expectedGridLayout && gridLayout !== expectedGridLayout) {
		throw new AppError(
			`${input.contextLabel} grid_layout 非法：期望 ${expectedGridLayout}，实际 ${gridLayout}`,
			{
				status: 400,
				code: "storyboard_output_grid_layout_invalid",
			},
		);
	}
	if (!hasGridLayout && (!Number.isFinite(groupSizeRaw) || Math.trunc(groupSizeRaw) !== input.expectedCount)) {
		throw new AppError(
			`${input.contextLabel} groupSize 非法：期望 ${input.expectedCount}，实际 ${Number.isFinite(groupSizeRaw) ? Math.trunc(groupSizeRaw) : "invalid"}`,
			{
				status: 400,
				code: "storyboard_output_group_size_invalid",
			},
		);
	}
	if (parsed.shots.length !== input.expectedCount) {
		throw new AppError(
			`${input.contextLabel} shots 数量非法：期望 ${input.expectedCount}，实际 ${parsed.shots.length}`,
			{
				status: 400,
				code: "storyboard_output_shot_count_invalid",
			},
		);
	}
	for (let i = 0; i < parsed.shots.length; i += 1) {
		const shot = parsed.shots[i];
		if (!shot || typeof shot !== "object") {
			throw new AppError(`${input.contextLabel} shots[${i}] 非法：必须是对象`, {
				status: 400,
				code: "storyboard_output_shot_item_invalid",
			});
		}
		const shotNumber = String((shot as { shot_number?: unknown }).shot_number || "").trim();
		const promptText = String(
			(shot as { prompt_text?: unknown; render_prompt?: unknown }).prompt_text ||
				(shot as { prompt_text?: unknown; render_prompt?: unknown }).render_prompt ||
				"",
		).trim();
		const beatRole = String(
			(shot as { beatRole?: unknown; beat_role?: unknown }).beatRole ||
				(shot as { beatRole?: unknown; beat_role?: unknown }).beat_role ||
				"",
		).trim();
		if (shotNumber && promptText && beatRole) continue;
		const subjectAction = String((shot as { subjectAction?: unknown }).subjectAction || "").trim();
		const shotType = String((shot as { shotType?: unknown }).shotType || "").trim();
		const cameraMovement = String((shot as { cameraMovement?: unknown }).cameraMovement || "").trim();
		const dramaticBeat = String(
			(shot as { dramaticBeat?: unknown; dramatic_beat?: unknown }).dramaticBeat ||
				(shot as { dramaticBeat?: unknown; dramatic_beat?: unknown }).dramatic_beat ||
				"",
		).trim();
		const storyPurpose = String(
			(shot as { storyPurpose?: unknown; story_purpose?: unknown }).storyPurpose ||
				(shot as { storyPurpose?: unknown; story_purpose?: unknown }).story_purpose ||
				"",
		).trim();
		const continuity = String((shot as { continuity?: unknown }).continuity || "").trim();
		if (!subjectAction || !shotType || !cameraMovement || !dramaticBeat || !storyPurpose || !continuity) {
			throw new AppError(
				`${input.contextLabel} shots[${i}] 缺少必填字段：shot_number/prompt_text/render_prompt 或 dramatic_beat/story_purpose/continuity/subjectAction/shotType/cameraMovement`,
				{
					status: 400,
					code: "storyboard_output_shot_required_fields_missing",
				},
			);
		}
		if (!promptText && !beatRole) {
			throw new AppError(`${input.contextLabel} shots[${i}] 缺少必填字段：beat_role`, {
				status: 400,
				code: "storyboard_output_shot_beat_role_missing",
			});
		}
	}
}

function serializeStoryboardStructuredDataToCanonicalJson(input: {
	structured: StoryboardStructuredData;
	groupSize?: number | null;
	gridLayout?: string | null;
}): string {
	const resolvedGridLayout = String(input.gridLayout || "").trim() || getStoryboardGridLayout(
		normalizeStoryboardGroupSize(input.groupSize ?? input.structured.shots.length),
	);
	const payload = {
		version: input.structured.version,
		groupSize: Math.max(1, Math.trunc(Number(input.groupSize || input.structured.shots.length || 1))),
		grid_layout: resolvedGridLayout,
		total_duration_sec:
			typeof input.structured.totalDurationSec === "number" && Number.isFinite(input.structured.totalDurationSec)
				? Math.max(1, Math.trunc(input.structured.totalDurationSec))
				: undefined,
		pacing_goal: String(input.structured.pacingGoal || "").trim() || undefined,
		progression_summary: String(input.structured.progressionSummary || "").trim() || undefined,
		continuity_plan: String(input.structured.continuityPlan || "").trim() || undefined,
		shots: input.structured.shots.map((shot, index) => ({
			shot_number:
				typeof shot.shotNo === "number" && Number.isFinite(shot.shotNo) && shot.shotNo > 0
					? `分镜 ${Math.trunc(shot.shotNo)}`
					: `分镜 ${index + 1}`,
			shot_no:
				typeof shot.shotNo === "number" && Number.isFinite(shot.shotNo) && shot.shotNo > 0
					? Math.trunc(shot.shotNo)
					: index + 1,
			beat_role: shot.purpose.beatRole || undefined,
			dramatic_beat: String(shot.purpose.dramaticBeat || "").trim(),
			story_purpose: String(shot.purpose.storyPurpose || "").trim(),
			continuity: String(shot.purpose.continuity || "").trim() || undefined,
			duration_sec:
				typeof shot.purpose.durationSec === "number" && Number.isFinite(shot.purpose.durationSec)
					? Math.max(1, Math.trunc(shot.purpose.durationSec))
					: undefined,
			transition_hook: String(shot.purpose.transitionHook || "").trim() || undefined,
			emotional_shift: String(shot.purpose.emotionalShift || "").trim() || undefined,
			escalation: String(shot.purpose.escalation || "").trim() || undefined,
			subject_action: String(shot.render.subjectAction || "").trim() || undefined,
			shot_type: String(shot.render.shotType || "").trim() || undefined,
			camera_movement: String(shot.render.cameraMovement || "").trim() || undefined,
			perspective: String(shot.render.perspective || "").trim() || undefined,
			subjects: Array.isArray(shot.render.subjects) ? shot.render.subjects.filter(Boolean) : undefined,
			environment: String(shot.render.environment || "").trim() || undefined,
			time_lighting: String(shot.render.timeLighting || "").trim() || undefined,
			color_tone: String(shot.render.colorTone || "").trim() || undefined,
			composition: String(shot.render.composition || "").trim() || undefined,
			quality_tags: Array.isArray(shot.render.qualityTags) ? shot.render.qualityTags.filter(Boolean) : undefined,
			prompt_text: String(shot.render.promptText || "").trim(),
		})),
	};
	return JSON.stringify(payload, null, 2);
}

function extractStoryboardShotPromptsFromScript(text: string): string[] {
	const content = String(text || "");
	if (!content.trim()) return [];
	const prompts: string[] = [];
	const pushPrompt = (value: string) => {
		const v = String(value || "").trim();
		if (!v) return;
		if (prompts.includes(v)) return;
		prompts.push(v);
	};
	const stripMarkdown = (value: string) =>
		String(value || "")
			.replace(/\*\*/g, "")
			.replace(/`/g, "")
			.trim();

	// Markdown table rows: | 1 | 画面 | 镜头运动 | ...
	for (const line of content.split("\n")) {
		const m = line.match(
			/^\|\s*(?:镜头\s*)?(\d{1,3})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|?\s*$/i,
		);
		if (!m) continue;
		const visual = String(m[2] || "").trim();
		const movement = String(m[3] || "").trim();
		pushPrompt([visual, movement].filter(Boolean).join("；"));
	}
	if (prompts.length) return prompts.slice(0, 64);

	// Fallback: list style "镜头 N：..."
	for (const line of content.split("\n")) {
		const m = line.match(/^\s*(?:[-*]\s*)?(?:镜头|S)\s*#?\s*(\d{1,3})\s*[:：]\s*(.+)\s*$/i);
		if (!m) continue;
		pushPrompt(String(m[2] || "").trim());
	}
	if (prompts.length) return prompts.slice(0, 64);

	// Block style:
	// ### 镜头1（1/4）xxx
	// - 画面：...
	// - 镜头运动：...
	const lines = content.split("\n");
	let current: {
		header: string;
		visual: string;
		movement: string;
	} | null = null;
	const flushCurrent = () => {
		if (!current) return;
		const merged = [current.visual, current.movement]
			.map((x) => stripMarkdown(x))
			.filter(Boolean)
			.join("；");
		pushPrompt(merged || stripMarkdown(current.header));
		current = null;
	};
	for (const rawLine of lines) {
		const line = String(rawLine || "");
		const headingMatch = line.match(
			/^\s*(?:#{1,6}\s*)?(?:[-*]\s*)?(?:镜头|shot)\s*#?\s*(\d{1,3})(?:\s*[（(][^)）]{0,12}[)）])?\s*[:：\-]?\s*(.*)\s*$/i,
		);
		if (headingMatch) {
			flushCurrent();
			current = {
				header: stripMarkdown(String(headingMatch[2] || "").trim()),
				visual: "",
				movement: "",
			};
			continue;
		}
		if (!current) continue;

		const visualMatch = line.match(/^\s*(?:[-*]\s*)?(?:\*\*)?(?:画面|场面|构图|景别)(?:\*\*)?\s*[:：]\s*(.+)\s*$/i);
		if (visualMatch) {
			current.visual = `${current.visual}${current.visual ? "；" : ""}${stripMarkdown(String(visualMatch[1] || ""))}`;
			continue;
		}
		const movementMatch = line.match(/^\s*(?:[-*]\s*)?(?:\*\*)?(?:镜头运动|机位运动|运动)(?:\*\*)?\s*[:：]\s*(.+)\s*$/i);
		if (movementMatch) {
			current.movement = `${current.movement}${current.movement ? "；" : ""}${stripMarkdown(String(movementMatch[1] || ""))}`;
			continue;
		}
	}
	flushCurrent();
	return prompts.slice(0, 64);
}

type StoryboardShotItem = {
	shotNo: number | null;
	prompt: string;
	subjectAction: string;
	shotType: string;
	cameraMovement: string;
	dramaticBeat?: string;
	storyPurpose?: string;
	emotionalShift?: string;
	escalation?: string;
	continuity?: string;
	durationSec?: number;
	transitionHook?: string;
};

function extractStoryboardShotItemsFromScript(text: string): StoryboardShotItem[] {
	const content = String(text || "");
	if (!content.trim()) return [];
	const items: StoryboardShotItem[] = [];
	const pushItem = (
		shotNo: number | null,
		prompt: string,
		structured?: { subjectAction?: string; shotType?: string; cameraMovement?: string },
	) => {
		const cleanPrompt = String(prompt || "").trim();
		if (!cleanPrompt) return;
		const normalizedShotNo =
			typeof shotNo === "number" && Number.isFinite(shotNo) && shotNo > 0 ? Math.trunc(shotNo) : null;
		if (items.some((x) => x.shotNo === normalizedShotNo && x.prompt === cleanPrompt)) return;
		items.push({
			shotNo: normalizedShotNo,
			prompt: cleanPrompt,
			subjectAction: String(structured?.subjectAction || "").trim(),
			shotType: String(structured?.shotType || "").trim(),
			cameraMovement: String(structured?.cameraMovement || "").trim(),
		});
	};
	const jsonBlock = extractJsonObjectFromText(content);
	if (jsonBlock && Array.isArray(jsonBlock.shots)) {
		for (const shot of jsonBlock.shots) {
			if (!shot || typeof shot !== "object") continue;
			const shotNumberRaw = String((shot as { shot_number?: unknown }).shot_number || "").trim();
			const shotNoRaw =
				typeof (shot as { shotNo?: unknown }).shotNo === "number"
					? Number((shot as { shotNo?: unknown }).shotNo)
					: null;
			const shotNoFromLabel = (() => {
				const m = shotNumberRaw.match(/(\d{1,4})/);
				if (!m) return null;
				const n = Number(m[1] || 0);
				return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
			})();
			const shotNo = shotNoRaw && Number.isFinite(shotNoRaw) && shotNoRaw > 0
				? Math.trunc(shotNoRaw)
				: shotNoFromLabel;
			const subjectActionStructured = String(
				(shot as { subjectAction?: unknown; subject_action?: unknown }).subjectAction ||
					(shot as { subjectAction?: unknown; subject_action?: unknown }).subject_action ||
					"",
			).trim();
			const shotTypeStructured = String(
				(shot as { shotType?: unknown; shot_type?: unknown }).shotType ||
					(shot as { shotType?: unknown; shot_type?: unknown }).shot_type ||
					"",
			).trim();
			const cameraMovementStructured = String(
				(shot as { cameraMovement?: unknown; camera_movement?: unknown }).cameraMovement ||
					(shot as { cameraMovement?: unknown; camera_movement?: unknown }).camera_movement ||
					"",
			).trim();
			const promptText = String((shot as { prompt_text?: unknown }).prompt_text || "").trim();
			if (promptText) {
				const inferred = extractKeyframeShotFeatures(promptText);
				pushItem(shotNo, promptText, {
					subjectAction: subjectActionStructured || inferred.action,
					shotType: shotTypeStructured || inferred.shotType,
					cameraMovement: cameraMovementStructured || inferred.camera,
				});
				continue;
			}
			const subjectAction = subjectActionStructured;
			const shotType = shotTypeStructured;
			const cameraMovement = cameraMovementStructured;
			const durationSecRaw = Number(
				(shot as { durationSec?: unknown; duration_sec?: unknown }).durationSec ??
					(shot as { durationSec?: unknown; duration_sec?: unknown }).duration_sec,
			);
			const durationSec =
				Number.isFinite(durationSecRaw) && durationSecRaw > 0 ? Math.max(1, Math.trunc(durationSecRaw)) : null;
			const dramaticBeat = String(
				(shot as { dramaticBeat?: unknown; dramatic_beat?: unknown }).dramaticBeat ||
					(shot as { dramaticBeat?: unknown; dramatic_beat?: unknown }).dramatic_beat ||
					"",
			).trim();
			const storyPurpose = String(
				(shot as { storyPurpose?: unknown; story_purpose?: unknown }).storyPurpose ||
					(shot as { storyPurpose?: unknown; story_purpose?: unknown }).story_purpose ||
					"",
			).trim();
			const emotionRhythm = String(
				(shot as { emotionRhythm?: unknown; emotion_rhythm?: unknown }).emotionRhythm ||
					(shot as { emotionRhythm?: unknown; emotion_rhythm?: unknown }).emotion_rhythm ||
					"",
			).trim();
			const transitionHook = String(
				(shot as { transitionHook?: unknown; transition_hook?: unknown }).transitionHook ||
					(shot as { transitionHook?: unknown; transition_hook?: unknown }).transition_hook ||
					"",
			).trim();
			const continuity = String(
				(shot as { continuity?: unknown; continuity_note?: unknown }).continuity ||
					(shot as { continuity?: unknown; continuity_note?: unknown }).continuity_note ||
					"",
			).trim();
			const prompt = [
				subjectAction ? `主体动作：${subjectAction}` : "",
				shotType ? `镜头类型：${shotType}` : "",
				cameraMovement ? `机位/运动：${cameraMovement}` : "",
				durationSec ? `时长：${durationSec}秒` : "",
				dramaticBeat ? `戏剧节拍：${dramaticBeat}` : "",
				storyPurpose ? `剧情目标：${storyPurpose}` : "",
				emotionRhythm ? `情绪/节奏：${emotionRhythm}` : "",
				continuity ? `连续性：${continuity}` : "",
				transitionHook ? `转场钩子：${transitionHook}` : "",
			]
				.filter(Boolean)
				.join("；");
			pushItem(shotNo, prompt, { subjectAction, shotType, cameraMovement });
			const last = items[items.length - 1];
			if (last) {
				last.dramaticBeat = dramaticBeat;
				last.storyPurpose = storyPurpose;
				last.emotionalShift = emotionRhythm;
				last.escalation = "";
				last.continuity = continuity;
				last.durationSec = durationSec ?? undefined;
				last.transitionHook = transitionHook;
			}
		}
		if (items.length) return items.slice(0, 64);
	}

	// Markdown table rows: | 1 | 画面 | 镜头运动 | ...
	for (const line of content.split("\n")) {
		const m = line.match(
			/^\|\s*(?:镜头\s*)?(\d{1,3})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|?\s*$/i,
		);
		if (!m) continue;
		const shotNo = Number(m[1] || 0);
		const visual = String(m[2] || "").trim();
		const movement = String(m[3] || "").trim();
		pushItem(shotNo, [visual, movement].filter(Boolean).join("；"));
	}

	// List style: "镜头 N：..."
	for (const line of content.split("\n")) {
		const m = line.match(/^\s*(?:[-*]\s*)?(?:镜头|S)\s*#?\s*(\d{1,3})\s*[:：]\s*(.+)\s*$/i);
		if (!m) continue;
		pushItem(Number(m[1] || 0), String(m[2] || "").trim());
	}

	if (items.length) return items.slice(0, 64);

	// Inline fallback: handle mixed outputs where tool traces and shot lines appear in one paragraph.
	const inlineMatches = Array.from(content.matchAll(/(?:^|[\s。；;])镜头\s*#?\s*(\d{1,3})\s*[:：]\s*/gi));
	if (inlineMatches.length) {
		for (let i = 0; i < inlineMatches.length; i += 1) {
			const current = inlineMatches[i];
			const start = (current.index || 0) + String(current[0] || "").length;
			const end = i + 1 < inlineMatches.length ? inlineMatches[i + 1].index || content.length : content.length;
			const rawPrompt = content.slice(start, end).trim();
			const shotNo = Number(current[1] || 0);
			pushItem(shotNo, rawPrompt);
		}
	}
	if (items.length) return items.slice(0, 64);

	const prompts = extractStoryboardShotPromptsFromScript(content);
	return prompts.map((prompt) => ({
		shotNo: null,
		prompt,
		subjectAction: "",
		shotType: "",
		cameraMovement: "",
	}));
}

function stripUrlsFromShotPrompt(prompt: string, tailFrameUrl?: string | null): string {
	let out = String(prompt || "");
	const tail = String(tailFrameUrl || "").trim();
	if (tail) {
		const escaped = tail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		out = out.replace(new RegExp(escaped, "g"), "【上一分组尾帧参考】");
	}
	out = out.replace(/https?:\/\/[^\s)）]+/gi, "【参考图】");
	return out.replace(/\s{2,}/g, " ").trim();
}

function buildStoryboardStructuredData(input: {
	text: string;
	shotItems: StoryboardShotItem[];
}): StoryboardStructuredData | null {
	const jsonBlock = extractJsonObjectFromText(input.text);
	const normalizedFromJson = adaptStoryboardShotDesignToStructuredData(
		typeof jsonBlock === "object" &&
			jsonBlock &&
			"shot_design" in jsonBlock &&
			typeof (jsonBlock as { shot_design?: unknown }).shot_design === "object" &&
			(jsonBlock as { shot_design?: unknown }).shot_design
			? ({
					...((jsonBlock as { shot_design?: Record<string, unknown> }).shot_design || {}),
					shots: Array.isArray((jsonBlock as { shots?: unknown }).shots)
						? (jsonBlock as { shots?: unknown[] }).shots
						: [],
			  } satisfies Record<string, unknown>)
			: jsonBlock,
	);
	if (normalizedFromJson) return normalizedFromJson;
		const fallbackShots: StoryboardShotDesignArtifact["shots"] = input.shotItems
			.map((item, index): StoryboardShotDesignArtifact["shots"][number] | null => {
			const promptText = String(item.prompt || "").trim();
			if (!promptText) return null;
			const beatRole: NonNullable<StoryboardShotDesignArtifact["shots"][number]["purpose"]["beatRole"]> =
				index === 0
					? "opening"
					: index === input.shotItems.length - 1
						? "payoff"
						: "escalation";
			return {
				shotNo: item.shotNo,
				purpose: {
					beatRole,
					dramaticBeat: String(item.dramaticBeat || "").trim() || "剧情推进",
					storyPurpose: String(item.storyPurpose || "").trim() || "推动当前段落的冲突与情绪变化",
					...(String(item.emotionalShift || "").trim()
						? { emotionalShift: String(item.emotionalShift || "").trim() }
						: null),
					...(String(item.escalation || "").trim()
						? { escalation: String(item.escalation || "").trim() }
						: null),
					...(String(item.continuity || "").trim()
						? { continuity: String(item.continuity || "").trim() }
						: null),
					...(typeof item.durationSec === "number" && Number.isFinite(item.durationSec)
						? { durationSec: Math.max(1, Math.min(15, Math.trunc(item.durationSec))) }
						: null),
					...(String(item.transitionHook || "").trim()
						? { transitionHook: String(item.transitionHook || "").trim() }
						: null),
				},
				renderDirectives: {
					promptText,
					...(String(item.subjectAction || "").trim()
						? { subjectAction: String(item.subjectAction || "").trim() }
						: null),
					...(String(item.shotType || "").trim() ? { shotType: String(item.shotType || "").trim() } : null),
					...(String(item.cameraMovement || "").trim()
						? { cameraMovement: String(item.cameraMovement || "").trim() }
						: null),
				},
			};
		})
			.filter((item): item is StoryboardShotDesignArtifact["shots"][number] => item !== null)
		.slice(0, 128);
	const fallbackDesign = {
		version: "shot_design_v1",
		pacingGoal: "按当前分组稳定推进关键帧分镜，保持连续性并逐镜拉开动作与镜头差异",
		progressionSummary: input.shotItems
			.slice(0, 4)
			.map((item) => `${item.shotNo ?? "?"}:${String(item.dramaticBeat || "").trim() || "剧情推进"}`)
			.join(" | "),
		continuityPlan: input.shotItems
			.map((item) => String(item.continuity || "").trim())
			.filter(Boolean)
			.slice(0, 4)
			.join(" | "),
		shots: fallbackShots,
	} satisfies StoryboardShotDesignArtifact;
	return adaptStoryboardShotDesignToStructuredData(fallbackDesign);
}

function validateStoryboardPromptPolicyOrThrow(input: {
	shotPrompts: string[];
	contextLabel: string;
	expectedCount?: number;
}): void {
	const prompts = input.shotPrompts.map((x) => String(x || "").trim()).filter(Boolean);
	const lowInfoPatterns = [
		/^第\d+章(?:电影级写实镜头|人物交互镜头|情绪推进镜头|转场收束镜头)$/i,
		/^(?:镜头|shot)\s*\d+\s*$/,
	];
	const expectedCount =
		typeof input.expectedCount === "number" &&
		Number.isFinite(input.expectedCount) &&
		input.expectedCount > 0
			? Math.trunc(input.expectedCount)
			: null;
	const isShortformPolicy = expectedCount === null || expectedCount <= 5;
	if (!prompts.length) {
		throw new AppError(`${input.contextLabel} 未解析到有效镜头提示词`, {
			status: 400,
			code: "storyboard_output_shot_prompts_missing",
		});
	}
	if (expectedCount !== null && prompts.length !== expectedCount) {
		throw new AppError(
			`${input.contextLabel} 镜头数量不符合要求：期望 ${expectedCount}，实际 ${prompts.length}`,
			{
				status: 400,
				code: "storyboard_output_shot_count_mismatch",
			},
		);
	}
	if (isShortformPolicy && prompts.length > 5) {
		throw new AppError(`${input.contextLabel} 镜头过多：当前版本要求少而强的镜头设计，单组最多 5 镜`, {
			status: 400,
			code: "storyboard_output_shot_count_too_large",
		});
	}
	for (const prompt of prompts) {
		if (lowInfoPatterns.some((pattern) => pattern.test(prompt)) || prompt.length < 24) {
			throw new AppError(`${input.contextLabel} 存在低信息量镜头提示词：${prompt}`, {
				status: 400,
				code: "storyboard_output_prompt_low_information",
			});
		}
	}
	const totalDurationSec = prompts.reduce((sum, prompt) => {
		const match = prompt.match(/(?:时长|duration)\s*[:：]?\s*(\d{1,2})\s*秒/i);
		if (!match) return sum;
		const sec = Number(match[1] || 0);
		return Number.isFinite(sec) && sec > 0 ? sum + Math.trunc(sec) : sum;
	}, 0);
	if (isShortformPolicy && totalDurationSec > 5) {
		throw new AppError(`${input.contextLabel} 总时长过长：${totalDurationSec} 秒，需压缩到 3-5 秒`, {
			status: 400,
			code: "storyboard_output_duration_too_long",
		});
	}
}

type StoryboardChunkRecord = {
	chunkId: string;
	planId?: string;
	chapter: number;
	groupSize: 1 | 4 | 9 | 25;
	chunkIndex: number;
	shotStart: number;
	shotEnd: number;
	nodeId?: string;
	prompt?: string;
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

type StoryboardChunkSemanticBindings = {
	roleReferences: Array<{
		cardId: string;
		roleName: string;
		imageUrl: string;
		stateDescription?: string;
	}>;
	scenePropReference?: { refId: string; label: string; imageUrl: string } | null;
	spellFxReference?: { refId: string; label: string; imageUrl: string } | null;
};

type StoryboardGroupSize = 1 | 4 | 9 | 25;

type StoryboardWorkflowContinuityContext = {
	roleReferenceImages: string[];
	roleReferenceEntries: Array<{
		cardId: string;
		roleName: string;
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
	roleRefMatchStrategy: "direct_match" | "chapter_fallback" | "global_fallback";
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
		roleName: string;
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
	roleRefMatchStrategy: "direct_match" | "chapter_fallback" | "global_fallback";
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

function extractChapterRoleNamesFromBookIndex(indexData: any, chapter: number): string[] {
	const chapters = Array.isArray(indexData?.chapters) ? indexData.chapters : [];
	const chapterMeta =
		chapters.find((ch: any) => Number(ch?.chapter) === Number(chapter)) || null;
	const rawNames = Array.isArray(chapterMeta?.characters)
		? chapterMeta.characters.map((item: any) => String(item?.name || "").trim())
		: [];
	return Array.from(
		new Set(rawNames.map((name: string) => normalizeRoleName(name)).filter(Boolean)),
	);
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

function hasApplicableGeneratedRoleCardForChapter(input: {
	indexData: any;
	chapter: number;
	roleNameKey: string;
}): boolean {
	const assets =
		typeof input.indexData?.assets === "object" && input.indexData.assets ? input.indexData.assets : {};
	const roleCardsRaw = Array.isArray(assets?.roleCards) ? assets.roleCards : [];
	return roleCardsRaw.some((card: any) => {
		const roleName = normalizeRoleName(card?.roleName);
		const status = String(card?.status || "").trim().toLowerCase();
		const imageUrl = String(card?.imageUrl || "").trim();
		if (!roleName || roleName !== input.roleNameKey) return false;
		if (status !== "generated" || !imageUrl) return false;
		return isRoleCardApplicableToChapter(
			{
				chapter:
					Number.isFinite(Number(card?.chapter)) && Number(card?.chapter) > 0
						? Math.trunc(Number(card?.chapter))
						: undefined,
				chapterStart:
					Number.isFinite(Number(card?.chapterStart)) && Number(card?.chapterStart) > 0
						? Math.trunc(Number(card?.chapterStart))
						: undefined,
				chapterEnd:
					Number.isFinite(Number(card?.chapterEnd)) && Number(card?.chapterEnd) > 0
						? Math.trunc(Number(card?.chapterEnd))
						: undefined,
				chapterSpan: Array.isArray(card?.chapterSpan)
					? (card.chapterSpan as any[])
							.map((x: any) => Number(x))
							.filter((x: number) => Number.isFinite(x) && x > 0)
							.map((x: number) => Math.trunc(x))
					: undefined,
			},
			input.chapter,
		);
	});
}

function hasApplicableGeneratedScenePropRefForChapter(input: {
	indexData: any;
	chapter: number;
}): boolean {
	const assets =
		typeof input.indexData?.assets === "object" && input.indexData.assets ? input.indexData.assets : {};
	const visualRefsRaw = Array.isArray(assets?.visualRefs) ? assets.visualRefs : [];
	return visualRefsRaw.some((item: any) => {
		const category = String(item?.category || "").trim().toLowerCase();
		const status = String(item?.status || "").trim().toLowerCase();
		const imageUrl = String(item?.imageUrl || "").trim();
		if (category !== "scene_prop" || status !== "generated" || !imageUrl) return false;
		if (item?.promptSchemaVersion !== STORYBOARD_REFERENCE_PROMPT_SCHEMA_VERSION) return false;
		return isRoleCardApplicableToChapter(
			{
				chapter:
					Number.isFinite(Number(item?.chapter)) && Number(item?.chapter) > 0
						? Math.trunc(Number(item?.chapter))
						: undefined,
				chapterStart:
					Number.isFinite(Number(item?.chapterStart)) && Number(item?.chapterStart) > 0
						? Math.trunc(Number(item?.chapterStart))
						: undefined,
				chapterEnd:
					Number.isFinite(Number(item?.chapterEnd)) && Number(item?.chapterEnd) > 0
						? Math.trunc(Number(item?.chapterEnd))
						: undefined,
				chapterSpan: Array.isArray(item?.chapterSpan)
					? (item.chapterSpan as any[])
							.map((x: any) => Number(x))
							.filter((x: number) => Number.isFinite(x) && x > 0)
							.map((x: number) => Math.trunc(x))
					: undefined,
			},
			input.chapter,
		);
	});
}

async function assertStoryboardChapterReady(input: {
	projectId: string;
	ownerId?: string;
	bookId: string;
	chapter: number;
}): Promise<void> {
	const indexPath = await resolveReadableBookIndexPath({
		projectId: input.projectId,
		bookId: input.bookId,
		ownerId: input.ownerId,
	});
	const indexData = (await readJsonFileSafe(indexPath)) || null;
	if (!indexData) {
		throw new AppError("book not found", { status: 404, code: "book_not_found" });
	}
}

export async function ensureStoryboardReferenceAssets(input: {
	c: AppContext;
	userId: string;
	projectId: string;
	bookId: string;
	chapter: number;
	shotPrompts: string[];
	modelKey: string;
	aspectRatio: string;
	vendorCandidates?: string[];
	spellFxRefId?: string;
}): Promise<void> {
	const indexPath = await resolveReadableBookIndexPath({
		projectId: input.projectId,
		bookId: input.bookId,
		ownerId: input.userId,
	});
	const indexData = (await readJsonFileSafe(indexPath)) || null;
	if (!indexData) {
		throw new AppError("book not found", { status: 404, code: "book_not_found" });
	}
	const assets =
		typeof indexData?.assets === "object" && indexData.assets ? indexData.assets : {};
	const chapters = Array.isArray(indexData?.chapters) ? indexData.chapters : [];
	const chapterMeta =
		chapters.find((ch: any) => Number(ch?.chapter) === Number(input.chapter)) || null;
	const chapterSummary = String(chapterMeta?.summary || "").trim();
	const chapterConflict = String(chapterMeta?.coreConflict || "").trim();
	const chapterScenes = Array.isArray(chapterMeta?.scenes)
		? chapterMeta.scenes.map((x: any) => String(x?.name || "").trim()).filter(Boolean).slice(0, 6)
		: [];
	const chapterProps = Array.isArray(chapterMeta?.props)
		? chapterMeta.props.map((x: any) => String(x?.name || "").trim()).filter(Boolean).slice(0, 6)
		: [];
	const styleBible =
		typeof assets?.styleBible === "object" && assets.styleBible ? assets.styleBible : {};
	const stylePromptPrefix = buildStylePromptPrefix(styleBible);
	const roleCards = Array.isArray(assets?.roleCards) ? [...assets.roleCards] : [];
	const visualRefs = Array.isArray(assets?.visualRefs) ? [...assets.visualRefs] : [];
	const nowIso = new Date().toISOString();
	let changed = false;

	for (let i = 0; i < roleCards.length; i += 1) {
		const card = roleCards[i];
		const generatedFrom = String(card?.generatedFrom || "").trim().toLowerCase();
		const status = String(card?.status || "").trim().toLowerCase();
		const imageUrl = String(card?.imageUrl || "").trim();
		const promptSchemaVersion = String(card?.promptSchemaVersion || "").trim();
		if (
			generatedFrom === "agents_auto" &&
			status === "generated" &&
			imageUrl &&
			promptSchemaVersion === STORYBOARD_REFERENCE_PROMPT_SCHEMA_VERSION &&
			!hasAssetConfirmedAt(card?.confirmedAt)
		) {
			roleCards[i] = {
				...card,
				confirmedAt: nowIso,
				confirmedBy: input.userId,
				updatedAt: nowIso,
				updatedBy: input.userId,
			};
			changed = true;
		}
	}

	for (let i = 0; i < visualRefs.length; i += 1) {
		const item = visualRefs[i];
		const generatedFrom = String(item?.generatedFrom || "").trim().toLowerCase();
		const status = String(item?.status || "").trim().toLowerCase();
		const imageUrl = String(item?.imageUrl || "").trim();
		const promptSchemaVersion = String(item?.promptSchemaVersion || "").trim();
		if (
			generatedFrom === "agents_auto" &&
			status === "generated" &&
			imageUrl &&
			promptSchemaVersion === STORYBOARD_REFERENCE_PROMPT_SCHEMA_VERSION &&
			!hasAssetConfirmedAt(item?.confirmedAt)
		) {
			visualRefs[i] = {
				...item,
				confirmedAt: nowIso,
				confirmedBy: input.userId,
				updatedAt: nowIso,
				updatedBy: input.userId,
			};
			changed = true;
		}
	}

	let chapterRoleNames = extractChapterRoleNamesFromBookIndex(indexData, input.chapter);
	let effectiveChapterScenes = [...chapterScenes];
	let effectiveChapterProps = [...chapterProps];
	const hasApplicableGeneratedRoleCard = chapterRoleNames.some((roleNameKey) =>
		hasApplicableGeneratedRoleCardForChapter({
			indexData,
			chapter: input.chapter,
			roleNameKey,
		}),
	);
	const hasApplicableGeneratedScenePropRef = hasApplicableGeneratedScenePropRefForChapter({
		indexData,
		chapter: input.chapter,
	});
	const shouldRunSemanticBootstrap =
		(!hasApplicableGeneratedRoleCard || !hasApplicableGeneratedScenePropRef) &&
		(chapterRoleNames.length === 0 || (effectiveChapterScenes.length === 0 && effectiveChapterProps.length === 0));
	if (shouldRunSemanticBootstrap) {
		const bootstrap = await inferStoryboardBootstrapByAgents({
			c: input.c,
			userId: input.userId,
			projectId: input.projectId,
			bookId: input.bookId,
			chapter: input.chapter,
			chapterSummary,
			chapterConflict,
			shotPrompts: input.shotPrompts,
		});
		if (!chapterRoleNames.length && bootstrap.roleNames.length) {
			chapterRoleNames = bootstrap.roleNames;
		}
		if (!effectiveChapterScenes.length && bootstrap.sceneNames.length) {
			effectiveChapterScenes = bootstrap.sceneNames;
		}
		if (!effectiveChapterProps.length && bootstrap.propNames.length) {
			effectiveChapterProps = bootstrap.propNames;
		}
		setTraceStage(input.c, "storyboard:reference:semantic-bootstrap", {
			chapter: input.chapter,
			roleCount: chapterRoleNames.length,
			sceneCount: effectiveChapterScenes.length,
			propCount: effectiveChapterProps.length,
		});
	}
	const recurringRoleNames = collectRecurringEntityNames(indexData, "characters");
	const recurringRoleCandidates = chapterRoleNames.filter((name) => recurringRoleNames.has(name));
	const autoGenerateRoleNames =
		(recurringRoleCandidates.length ? recurringRoleCandidates : chapterRoleNames).slice(0, 4);
	for (const roleNameKey of autoGenerateRoleNames) {
		const hasCard = roleCards.some((card: any) => {
			const roleName = normalizeRoleName(card?.roleName);
			const status = String(card?.status || "").trim().toLowerCase();
			const imageUrl = String(card?.imageUrl || "").trim();
			if (!roleName || roleName !== roleNameKey) return false;
			if (status !== "generated" || !imageUrl) return false;
			if (card?.promptSchemaVersion !== STORYBOARD_REFERENCE_PROMPT_SCHEMA_VERSION) return false;
			return isRoleCardApplicableToChapter(
				{
					chapter:
						Number.isFinite(Number(card?.chapter)) && Number(card?.chapter) > 0
							? Math.trunc(Number(card?.chapter))
							: undefined,
					chapterStart:
						Number.isFinite(Number(card?.chapterStart)) && Number(card?.chapterStart) > 0
							? Math.trunc(Number(card?.chapterStart))
							: undefined,
					chapterEnd:
						Number.isFinite(Number(card?.chapterEnd)) && Number(card?.chapterEnd) > 0
							? Math.trunc(Number(card?.chapterEnd))
							: undefined,
					chapterSpan: Array.isArray(card?.chapterSpan)
						? (card.chapterSpan as any[])
								.map((x: any) => Number(x))
								.filter((x: number) => Number.isFinite(x) && x > 0)
								.map((x: number) => Math.trunc(x))
						: undefined,
				},
				input.chapter,
			);
		});
		if (hasCard) continue;
		const roleNameLabel = roleNameKey;
		const referenceKind = inferAutoRoleCardKindFromIndexData({
			indexData,
			chapter: input.chapter,
			roleName: roleNameLabel,
		});
		const rolePrompt = buildAutoRoleReferencePrompt({
			stylePromptPrefix,
			kind: referenceKind,
			roleName: roleNameLabel,
			chapter: input.chapter,
			chapterSummary,
			chapterConflict,
			sceneNames: effectiveChapterScenes,
			propNames: effectiveChapterProps,
		});
		const roleReq: TaskRequestDto = {
			kind: "text_to_image",
			prompt: rolePrompt,
			extras: {
				modelAlias: input.modelKey,
				aspectRatio: "3:4",
			},
		};
		const { result } = await runTaskWithVendorFallback(
			input.c,
			input.userId,
			roleReq,
			input.vendorCandidates,
		);
		const imageUrl = extractImageUrlFromTaskResult(result);
		if (!imageUrl) {
			throw new AppError(`自动生成角色卡失败：${roleNameLabel}`, {
				status: 500,
				code: "storyboard_auto_role_card_generate_failed",
			});
		}
		roleCards.push({
			cardId: `card-${crypto.randomUUID()}`,
			roleName: roleNameLabel,
			referenceKind,
			promptSchemaVersion: STORYBOARD_REFERENCE_PROMPT_SCHEMA_VERSION,
			generatedFrom: "agents_auto",
			status: "generated",
			chapter: input.chapter,
			prompt: rolePrompt,
			modelKey: input.modelKey,
			imageUrl,
			confirmedAt: nowIso,
			confirmedBy: input.userId,
			createdAt: nowIso,
			updatedAt: nowIso,
			createdBy: input.userId,
			updatedBy: input.userId,
		});
		changed = true;
	}

	const hasScenePropRef = visualRefs.some((item: any) => {
		const category = String(item?.category || "").trim().toLowerCase();
		const status = String(item?.status || "").trim().toLowerCase();
		const imageUrl = String(item?.imageUrl || "").trim();
		if (category !== "scene_prop" || status !== "generated" || !imageUrl) return false;
		if (item?.promptSchemaVersion !== STORYBOARD_REFERENCE_PROMPT_SCHEMA_VERSION) return false;
		return isRoleCardApplicableToChapter(
			{
				chapter:
					Number.isFinite(Number(item?.chapter)) && Number(item?.chapter) > 0
						? Math.trunc(Number(item?.chapter))
						: undefined,
				chapterStart:
					Number.isFinite(Number(item?.chapterStart)) && Number(item?.chapterStart) > 0
						? Math.trunc(Number(item?.chapterStart))
						: undefined,
				chapterEnd:
					Number.isFinite(Number(item?.chapterEnd)) && Number(item?.chapterEnd) > 0
						? Math.trunc(Number(item?.chapterEnd))
						: undefined,
				chapterSpan: Array.isArray(item?.chapterSpan)
					? (item.chapterSpan as any[])
							.map((x: any) => Number(x))
							.filter((x: number) => Number.isFinite(x) && x > 0)
							.map((x: number) => Math.trunc(x))
					: undefined,
			},
			input.chapter,
		);
	});
	const recurringSceneNames = collectRecurringEntityNames(indexData, "scenes");
	const recurringPropNames = collectRecurringEntityNames(indexData, "props");
	const chapterSceneNames = Array.from(
		new Set([
			...listChapterEntityNames(indexData, input.chapter, "scenes"),
			...effectiveChapterScenes.map((x) => normalizeRoleName(x)).filter(Boolean),
		]),
	);
	const chapterPropNames = Array.from(
		new Set([
			...listChapterEntityNames(indexData, input.chapter, "props"),
			...effectiveChapterProps.map((x) => normalizeRoleName(x)).filter(Boolean),
		]),
	);
	const shouldAutoGenerateSceneProp =
		chapterSceneNames.some((name) => recurringSceneNames.has(name)) ||
		chapterPropNames.some((name) => recurringPropNames.has(name)) ||
		(effectiveChapterScenes.length > 0 || effectiveChapterProps.length > 0);

	if (!hasScenePropRef && shouldAutoGenerateSceneProp) {
		const scenePropItems = Array.from(new Set([...effectiveChapterScenes, ...effectiveChapterProps])).slice(0, 9);
		const scenePropPrompt = buildScenePropReferencePrompt({
			stylePromptPrefix,
			chapter: input.chapter,
			chapterSummary,
			chapterConflict,
			sceneNames: effectiveChapterScenes,
			propNames: effectiveChapterProps,
			scenePropItems,
		});
		const scenePropReq: TaskRequestDto = {
			kind: "text_to_image",
			prompt: scenePropPrompt,
			extras: {
				modelAlias: input.modelKey,
				aspectRatio: input.aspectRatio,
			},
		};
		const { result } = await runTaskWithVendorFallback(
			input.c,
			input.userId,
			scenePropReq,
			input.vendorCandidates,
		);
		const imageUrl = extractImageUrlFromTaskResult(result);
		if (!imageUrl) {
			throw new AppError("自动生成场景/道具参考图失败", {
				status: 500,
				code: "storyboard_auto_scene_prop_generate_failed",
			});
		}
		visualRefs.push({
			refId: `vref-${crypto.randomUUID()}`,
			category: "scene_prop",
			name: `第${input.chapter}章场景道具九宫格`,
			referenceKind: "scene_prop_grid",
			promptSchemaVersion: STORYBOARD_REFERENCE_PROMPT_SCHEMA_VERSION,
			generatedFrom: "agents_auto",
			status: "generated",
			chapter: input.chapter,
			tags: ["storyboard", "scene", "prop", "grid9"],
			layout: "3x3",
			cellLabels: scenePropItems.map((item, idx) => `#${idx + 1}:${item}`),
			prompt: scenePropPrompt,
			modelKey: input.modelKey,
			imageUrl,
			confirmedAt: nowIso,
			confirmedBy: input.userId,
			createdAt: nowIso,
			updatedAt: nowIso,
			createdBy: input.userId,
			updatedBy: input.userId,
		});
		changed = true;
	}

	const explicitSpellFxRefId = String(input.spellFxRefId || "").trim();
	if (explicitSpellFxRefId) {
		const hasSpellFxRef = visualRefs.some((item: any) => {
			const refId = String(item?.refId || "").trim();
			const category = String(item?.category || "").trim().toLowerCase();
			const status = String(item?.status || "").trim().toLowerCase();
			const imageUrl = String(item?.imageUrl || "").trim();
			return (
				refId === explicitSpellFxRefId &&
				category === "spell_fx" &&
				status === "generated" &&
				Boolean(imageUrl)
			);
		});
		if (!hasSpellFxRef) {
			const spellPrompt = [
				stylePromptPrefix,
				`第${input.chapter}章法术/特效参考图`,
				chapterSummary ? `章节摘要：${chapterSummary}` : "",
				"要求：突出法术特效形态、发光色谱、粒子流向和残影层次；保持电影级一致性；禁止文字水印。",
			]
				.filter(Boolean)
				.join("\n");
			const spellReq: TaskRequestDto = {
				kind: "text_to_image",
				prompt: spellPrompt,
				extras: {
					modelAlias: input.modelKey,
					aspectRatio: input.aspectRatio,
				},
			};
			const { result } = await runTaskWithVendorFallback(
				input.c,
				input.userId,
				spellReq,
				input.vendorCandidates,
			);
			const imageUrl = extractImageUrlFromTaskResult(result);
			if (!imageUrl) {
				throw new AppError("自动生成法术/特效参考图失败", {
					status: 500,
					code: "storyboard_auto_spell_fx_generate_failed",
				});
			}
			visualRefs.push({
				refId: explicitSpellFxRefId,
				category: "spell_fx",
				name: `第${input.chapter}章法术特效`,
				referenceKind: "spell_fx",
				promptSchemaVersion: STORYBOARD_REFERENCE_PROMPT_SCHEMA_VERSION,
				generatedFrom: "agents_auto",
				status: "generated",
				chapter: input.chapter,
				tags: ["storyboard", "spell", "fx"],
				prompt: spellPrompt,
				modelKey: input.modelKey,
				imageUrl,
				confirmedAt: nowIso,
				confirmedBy: input.userId,
				createdAt: nowIso,
				updatedAt: nowIso,
				createdBy: input.userId,
				updatedBy: input.userId,
			});
			changed = true;
		}
	}

	if (!changed) return;
	const nextIndex = {
		...indexData,
		assets: {
			...(indexData?.assets || {}),
			roleCards,
			visualRefs,
		},
		updatedAt: nowIso,
	};
	await writeJsonAtomic(indexPath, nextIndex);
	// Keep legacy path in sync for existing asset APIs still reading legacy layout.
	const legacyIndexPath = buildBookIndexPath(input.projectId, input.bookId);
	if (legacyIndexPath !== indexPath) {
		await writeJsonAtomic(legacyIndexPath, nextIndex);
	}
}

function extractImageUrlFromTaskResult(result: any): string {
	const assets = Array.isArray(result?.assets) ? result.assets : [];
	for (const asset of assets) {
		const url = typeof asset?.url === "string" ? asset.url.trim() : "";
		if (url) return url;
	}
	return "";
}

type StoryboardShotEditDiagnosis = {
	issues: string[];
	fixDirectives: string[];
	rewritePrompt: string;
};

type StoryboardWorkflowShotInputDto = {
	promptText: string;
	subjectAction?: string;
	shotType?: string;
	cameraMovement?: string;
	perspective?: string;
	subjects?: string[];
	environment?: string;
	timeLighting?: string;
	colorTone?: string;
	composition?: string;
	qualityTags?: string[];
	durationSec?: number;
	emotionRhythm?: string;
	transitionHook?: string;
	dialogueOrSubtitle?: string;
	sfx?: string;
};

type StoryboardWorkflowGenerateRequestDto = {
	projectId: string;
	bookId: string;
	chapter: number;
	chunkIndex: number;
	groupSize: 1 | 4 | 9 | 25;
	shots: StoryboardWorkflowShotInputDto[];
	scenePropRefId?: string;
	spellFxRefId?: string;
	modelKey?: string;
	aspectRatio?: string;
	vendorCandidates?: string[];
	skipDiversityPrecheck?: boolean;
	composite?: {
		enabled?: boolean;
		cellSize?: number;
		dividerWidth?: number;
		dividerColor?: string;
	};
	referenceComposite?: {
		enabled?: boolean;
		includeLabels?: boolean;
		cellSize?: number;
		dividerWidth?: number;
		dividerColor?: string;
	};
};

type StoryboardWorkflowShotEditRequestDto = {
	projectId: string;
	bookId: string;
	chapter: number;
	chunkIndex: number;
	groupSize: 1 | 4 | 9 | 25;
	shotIndex: number;
	prompt: string;
	referenceImages: string[];
	modelKey?: string;
	aspectRatio?: string;
	vendorCandidates?: string[];
};

type StoryboardWorkflowShotSelectCandidateRequestDto = {
	projectId: string;
	bookId: string;
	chapter: number;
	chunkIndex: number;
	groupSize: 1 | 4 | 9 | 25;
	shotIndex: number;
	candidateId?: string;
	imageUrl?: string;
};

type StoryboardWorkflowMergeRequestDto = {
	projectId: string;
	bookId: string;
	frameUrls: string[];
	modelKey?: string;
	aspectRatio?: string;
	cellSize?: number;
	dividerWidth?: number;
	dividerColor?: string;
	vendorCandidates?: string[];
};

type StoryboardSemanticBootstrap = {
	roleNames: string[];
	sceneNames: string[];
	propNames: string[];
	rawText: string;
};

function normalizeTextList(input: unknown, limit = 12): string[] {
	if (!Array.isArray(input)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of input) {
		const text = typeof item === "string" ? item.trim() : "";
		if (!text) continue;
		if (seen.has(text)) continue;
		seen.add(text);
		out.push(text);
		if (out.length >= limit) break;
	}
	return out;
}

function extractJsonObjectFromText(text: string): Record<string, unknown> | null {
	const raw = String(text || "").trim();
	if (!raw) return null;
	const candidates: string[] = [];
	const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
	let m: RegExpExecArray | null = null;
	while ((m = fenceRegex.exec(raw))) {
		const body = String(m?.[1] || "").trim();
		if (body) candidates.push(body);
	}
	candidates.push(raw);
	for (const chunk of candidates) {
		const direct = tryParseJsonObject(chunk);
		if (direct) return direct;
		for (const extracted of extractEmbeddedJsonObjectCandidates(chunk)) {
			const nested = tryParseJsonObject(extracted);
			if (nested) return nested;
		}
	}
	return null;
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(text);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// ignore parse failure and let caller continue probing
	}
	return null;
}

function extractEmbeddedJsonObjectCandidates(text: string): string[] {
	const out: string[] = [];
	const raw = String(text || "");
	let start = -1;
	let depth = 0;
	let quote: '"' | "'" | null = null;
	let escaped = false;
	for (let i = 0; i < raw.length; i += 1) {
		const ch = raw[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (quote) {
			if (ch === "\\") {
				escaped = true;
				continue;
			}
			if (ch === quote) {
				quote = null;
			}
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (ch === "{") {
			if (depth === 0) start = i;
			depth += 1;
			continue;
		}
		if (ch === "}" && depth > 0) {
			depth -= 1;
			if (depth === 0 && start >= 0) {
				out.push(raw.slice(start, i + 1).trim());
				start = -1;
			}
		}
	}
	return out;
}

function normalizeEntityNameList(input: unknown, limit = 8): string[] {
	if (!Array.isArray(input)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of input) {
		const text = String(item || "").trim();
		if (!text) continue;
		const key = text.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(text);
		if (out.length >= limit) break;
	}
	return out;
}

async function inferStoryboardBootstrapByAgents(input: {
	c: AppContext;
	userId: string;
	projectId: string;
	bookId: string;
	chapter: number;
	chapterSummary: string;
	chapterConflict: string;
	shotPrompts: string[];
}): Promise<StoryboardSemanticBootstrap> {
	const prompt = [
		"你是小说分镜语义抽取器。任务：从当前章节信息与镜头脚本中抽取“可用于首轮一致性锚定”的实体。",
		"必须先做语义净化：丢弃作者自述、评论互动、公告、题外话、编辑注释与平台噪声。",
		"仅保留可拍摄剧情事实涉及的实体。",
		"",
		"输出要求：仅返回 JSON，不要任何解释文字。",
		'JSON Schema: {"roleNames": string[], "sceneNames": string[], "propNames": string[]}',
		"约束：",
		"- roleNames 最多 4 个，优先当前镜头真实出现且后续可复用的角色；不能用“主角/众人/他/她/他们”这类泛称。",
		"- sceneNames 最多 4 个，必须是可视化场景。",
		"- propNames 最多 6 个，必须是可视化道具/器物。",
		"- 若无法确定，返回空数组，不得编造。",
		"",
		`项目: ${input.projectId}`,
		`bookId: ${input.bookId}`,
		`章节: 第${input.chapter}章`,
		input.chapterSummary ? `章节摘要: ${input.chapterSummary}` : "章节摘要: （空）",
		input.chapterConflict ? `核心冲突: ${input.chapterConflict}` : "核心冲突: （空）",
		"镜头脚本:",
		...input.shotPrompts.map((x, idx) => `- 镜头${idx + 1}: ${String(x || "").trim()}`),
	].join("\n");
	await ensureProjectWorkspaceContextFiles({
		c: input.c,
		ownerId: input.userId,
		projectId: input.projectId,
		bookId: input.bookId,
		chapter: input.chapter,
	});
	const task = await runAgentsBridgeChatTask(input.c, input.userId, {
		kind: "chat",
		prompt,
		extras: {
			requiredSkills: [STORYBOARD_ORCHESTRATOR_SKILL],
			privilegedLocalAccess: true,
			localResourcePaths: [buildProjectDataRoot(input.projectId, input.userId)],
			modelKey: resolveStoryboardGovernanceModelKey(),
			canvasProjectId: input.projectId,
			bookId: input.bookId,
			chapterId: String(input.chapter),
			diagnosticsLabel: "storyboard_semantic_bootstrap",
		},
	});
		const taskRaw = task?.raw as { text?: unknown } | undefined;
		const text = String(taskRaw?.text || "").trim();
	const parsed = extractJsonObjectFromText(text);
	if (!parsed) {
		throw new AppError("语义锚定抽取失败：agents 未返回可解析 JSON", {
			status: 500,
			code: "storyboard_semantic_bootstrap_parse_failed",
			details: { preview: truncateForLog(text, 600) },
		});
	}
	const roleNames = normalizeEntityNameList((parsed as any).roleNames, 4);
	const sceneNames = normalizeEntityNameList((parsed as any).sceneNames, 4);
	const propNames = normalizeEntityNameList((parsed as any).propNames, 6);
	if (!roleNames.length && !sceneNames.length && !propNames.length) {
		throw new AppError("语义锚定抽取失败：未识别到可用角色/场景/道具", {
			status: 400,
			code: "storyboard_semantic_bootstrap_empty",
		});
	}
	return { roleNames, sceneNames, propNames, rawText: text };
}

function parseStoryboardShotEditDiagnosis(text: string): StoryboardShotEditDiagnosis | null {
	const parsed = extractJsonObjectFromText(text);
	if (!parsed) return null;
	const issues = normalizeTextList((parsed as any).issues, 8);
	const fixDirectives = normalizeTextList(
		(parsed as any).fixDirectives || (parsed as any).fixes || (parsed as any).instructions,
		10,
	);
	const rewritePrompt = typeof (parsed as any).rewritePrompt === "string"
		? String((parsed as any).rewritePrompt).trim()
		: typeof (parsed as any).prompt === "string"
			? String((parsed as any).prompt).trim()
			: "";
	if (!issues.length || !fixDirectives.length) return null;
	return {
		issues,
		fixDirectives,
		rewritePrompt,
	};
}

function buildStoryboardShotEditDiagnosisPrompt(input: {
	chapter: number;
	shotIndex: number;
	userPrompt: string;
	shotPrompt: string;
	currentImageUrl: string | null;
	referenceImages: string[];
}): string {
	const lines: string[] = [];
	lines.push("你是 TapCanvas 的分镜修复诊断 Agent。");
	lines.push("必须先做图像理解，再给出可执行修复指令；禁止泛泛而谈。");
	lines.push("输出必须是 JSON（不要 Markdown），字段：issues, fixDirectives, rewritePrompt。");
	lines.push("规则：issues 3-6 条；fixDirectives 4-8 条；rewritePrompt 必须可直接用于 image_edit。");
	lines.push("要求：聚焦角色一致性、人数正确性、构图、透视、肢体、光线、服装连续性。");
	lines.push("若发现重复人像/同脸分身，必须明确指出并给出“保留唯一主体”的修复指令。");
	lines.push(STORYBOARD_NO_TEXT_OVERLAY_RULE);
	lines.push("");
	lines.push(`章节=${input.chapter} 镜头=${input.shotIndex + 1}`);
	if (input.shotPrompt) {
		lines.push("【当前镜头脚本】");
		lines.push(input.shotPrompt);
	}
	lines.push("【用户修复诉求】");
	lines.push(input.userPrompt);
	if (input.currentImageUrl) {
		lines.push("【当前待修复镜头图】");
		lines.push(`- ${input.currentImageUrl}`);
	}
	if (input.referenceImages.length) {
		lines.push("【参考图】");
		for (const url of input.referenceImages) lines.push(`- ${url}`);
	}
	lines.push("");
	lines.push('输出示例：{"issues":["..."],"fixDirectives":["..."],"rewritePrompt":"..."}');
	return lines.join("\n");
}

function buildStoryboardShotEditFinalPrompt(input: {
	userPrompt: string;
	diagnosis: StoryboardShotEditDiagnosis;
}): string {
	const lines: string[] = [];
	lines.push(input.userPrompt.trim());
	lines.push("");
	lines.push("【agents-cli 图像诊断】");
	input.diagnosis.issues.forEach((item, idx) => {
		lines.push(`${idx + 1}. ${item}`);
	});
	lines.push("");
	lines.push("【强制修复指令】");
	input.diagnosis.fixDirectives.forEach((item, idx) => {
		lines.push(`${idx + 1}. ${item}`);
	});
	if (input.diagnosis.rewritePrompt) {
		lines.push("");
		lines.push("【重写修复提示词（必须遵守）】");
		lines.push(input.diagnosis.rewritePrompt);
	}
	lines.push("");
	lines.push(STORYBOARD_NO_TEXT_OVERLAY_RULE);
	lines.push("输出要求：仅返回 1 张修复后的镜头图；不得新增无关角色；不得重复同一人物。");
	return lines.join("\n");
}

function normalizeUrlList(input: unknown, limit = 8): string[] {
	if (!Array.isArray(input)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of input) {
		const value = typeof item === "string" ? item.trim() : "";
		if (!value) continue;
		if (seen.has(value)) continue;
		seen.add(value);
		out.push(value);
		if (out.length >= limit) break;
	}
	return out;
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

function isCharacterMetadataApplicableToChapter(
	value: {
		firstChapter?: number;
		lastChapter?: number;
		chapterSpan?: number[];
		unlockChapter?: number;
	},
	chapter: number,
): boolean {
	const chapterNo = Number.isFinite(chapter) && chapter > 0 ? Math.trunc(chapter) : 0;
	if (!chapterNo) return true;
	const span = Array.isArray(value.chapterSpan)
		? value.chapterSpan
				.map((item) => Number(item))
				.filter((item) => Number.isFinite(item) && item > 0)
				.map((item) => Math.trunc(item))
		: [];
	if (span.length > 0) return span.includes(chapterNo);
	const firstChapter =
		typeof value.firstChapter === "number" && Number.isFinite(value.firstChapter) && value.firstChapter > 0
			? Math.trunc(value.firstChapter)
			: typeof value.unlockChapter === "number" &&
					Number.isFinite(value.unlockChapter) &&
					value.unlockChapter > 0
				? Math.trunc(value.unlockChapter)
				: null;
	const lastChapter =
		typeof value.lastChapter === "number" && Number.isFinite(value.lastChapter) && value.lastChapter > 0
			? Math.trunc(value.lastChapter)
			: null;
	if (firstChapter !== null && lastChapter !== null) return chapterNo >= firstChapter && chapterNo <= lastChapter;
	if (firstChapter !== null) return chapterNo >= firstChapter;
	if (lastChapter !== null) return chapterNo <= lastChapter;
	return true;
}

function inferAutoRoleCardKindFromIndexData(input: {
	indexData: any;
	chapter: number;
	roleName: string;
}): StoryboardReferenceCardKind {
	const assets =
		typeof input.indexData?.assets === "object" && input.indexData?.assets
			? input.indexData.assets
			: {};
	const roleKey = normalizeRoleName(input.roleName);
	if (!roleKey) return "group_cast";
	const profiles = Array.isArray(assets.characterProfiles) ? assets.characterProfiles : [];
	for (const item of profiles) {
		const nameKey = normalizeRoleName(item?.name);
		if (!nameKey || nameKey !== roleKey) continue;
		if (
			isCharacterMetadataApplicableToChapter(
				{
					firstChapter: Number.isFinite(Number(item?.firstChapter)) ? Number(item.firstChapter) : undefined,
					lastChapter: Number.isFinite(Number(item?.lastChapter)) ? Number(item.lastChapter) : undefined,
					chapterSpan: Array.isArray(item?.chapterSpan)
						? item.chapterSpan.map((value: unknown) => Number(value))
						: undefined,
				},
				input.chapter,
			)
		) {
			return "single_character";
		}
	}
	const graphNodes = Array.isArray(assets.characterGraph?.nodes) ? assets.characterGraph.nodes : [];
	for (const item of graphNodes) {
		const nameKey = normalizeRoleName(item?.name);
		if (!nameKey || nameKey !== roleKey) continue;
		if (
			isCharacterMetadataApplicableToChapter(
				{
					firstChapter: Number.isFinite(Number(item?.firstChapter)) ? Number(item.firstChapter) : undefined,
					lastChapter: Number.isFinite(Number(item?.lastChapter)) ? Number(item.lastChapter) : undefined,
					unlockChapter: Number.isFinite(Number(item?.unlockChapter)) ? Number(item.unlockChapter) : undefined,
					chapterSpan: Array.isArray(item?.chapterSpan)
						? item.chapterSpan.map((value: unknown) => Number(value))
						: undefined,
				},
				input.chapter,
			)
		) {
			return "single_character";
		}
	}
	return "group_cast";
}

function buildAutoRoleReferencePrompt(input: {
	stylePromptPrefix: string;
	kind: StoryboardReferenceCardKind;
	roleName: string;
	chapter: number;
	chapterSummary: string;
	chapterConflict: string;
	sceneNames: string[];
	propNames: string[];
}): string {
	const lines: string[] = [
		input.stylePromptPrefix,
		`提示词模板版本：${STORYBOARD_REFERENCE_PROMPT_SCHEMA_VERSION}`,
		`参考类型：${input.kind}`,
		input.kind === "single_character"
			? `角色参考图，角色名：${input.roleName}`
			: `群像参考图，群体名：${input.roleName}`,
		`章节：第${input.chapter}章`,
		input.chapterSummary ? `章节摘要：${input.chapterSummary}` : "",
		input.chapterConflict ? `核心冲突：${input.chapterConflict}` : "",
		input.sceneNames.length ? `场景：${input.sceneNames.join("、")}` : "",
		input.propNames.length ? `道具：${input.propNames.join("、")}` : "",
	];
	if (input.kind === "single_character") {
		lines.push("要求：只生成该角色单人定妆参考，不得出现第二角色，不得混入其他角色的脸型、年龄感、服装或道具。");
		lines.push("要求：突出可持续复用的年龄感、发式、服装基底、身份气质与神态，背景保持简洁。");
	} else {
		lines.push("要求：生成该群体的多人群像参考，不得误画成单人肖像。");
		lines.push("要求：突出群体人数关系、身份秩序、服装基调和站位氛围，不得把多个成员特征硬混成一个人。");
	}
	lines.push("禁止文字水印。");
	return lines.filter(Boolean).join("\n");
}

function buildScenePropReferencePrompt(input: {
	stylePromptPrefix: string;
	chapter: number;
	chapterSummary: string;
	chapterConflict: string;
	sceneNames: string[];
	propNames: string[];
	scenePropItems: string[];
}): string {
	const itemLabels = input.scenePropItems.map((item, idx) => `${idx + 1}. ${item}`).join("；");
	return [
		input.stylePromptPrefix,
		`提示词模板版本：${STORYBOARD_REFERENCE_PROMPT_SCHEMA_VERSION}`,
		"参考类型：scene_prop_grid",
		`第${input.chapter}章场景与道具参考图`,
		input.chapterSummary ? `章节摘要：${input.chapterSummary}` : "",
		input.chapterConflict ? `核心冲突：${input.chapterConflict}` : "",
		input.sceneNames.length ? `核心场景：${input.sceneNames.join("、")}` : "",
		input.propNames.length ? `关键道具：${input.propNames.join("、")}` : "",
		itemLabels ? `元素清单：${itemLabels}` : "",
		"要求：输出单张 3x3 参考板，每格只表现一个场景或道具，保持同一美术体系、材质逻辑与主光方向。",
		"要求：不得混入角色单人定妆特征，不得把多个元素挤成同一格，不得出现文字水印。",
	]
		.filter(Boolean)
		.join("\n");
}

function dedupeRoleCardEntries(
	items: Array<{
		cardId: string;
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

function buildRoleAliases(inputRoleNames: string[]): Map<string, string[]> {
	const normalized = inputRoleNames
		.map((x) => String(x || "").trim())
		.filter(Boolean);
	const unique = Array.from(new Set(normalized));
	const lastCharCount = new Map<string, number>();
	for (const roleName of unique) {
		const compact = roleName.replace(/\s+/g, "");
		const chars = Array.from(compact);
		const lastChar = chars.length ? chars[chars.length - 1] : "";
		if (lastChar) {
			lastCharCount.set(lastChar, (lastCharCount.get(lastChar) || 0) + 1);
		}
	}
	const out = new Map<string, string[]>();
	for (const roleName of unique) {
		const compact = roleName.replace(/\s+/g, "");
		const chars = Array.from(compact);
		const aliases = new Set<string>();
		if (compact) aliases.add(compact);
		if (chars.length >= 2) aliases.add(chars.slice(-2).join(""));
		if (chars.length >= 1) {
			const lastChar = chars[chars.length - 1];
			if ((lastCharCount.get(lastChar) || 0) === 1) aliases.add(lastChar);
		}
		out.set(normalizeRoleName(roleName), Array.from(aliases).filter(Boolean));
	}
	return out;
}

function extractMentionRoleTokens(lines: string[]): string[] {
	const tokens: string[] = [];
	const re = /@([^\s,，。；;:：!！?？"'“”‘’()（）\[\]【】]+)/g;
	for (const line of lines) {
		const text = String(line || "");
		let m: RegExpExecArray | null = null;
		while ((m = re.exec(text))) {
			const token = String(m?.[1] || "").trim();
			if (!token) continue;
			tokens.push(token);
		}
	}
	return Array.from(new Set(tokens));
}

function resolveMentionToRoleName(
	token: string,
	availableRoleNames: string[],
	roleAliasMap: Map<string, string[]>,
): string | null {
	const normalizedToken = normalizeRoleName(token);
	if (!normalizedToken) return null;
	if (availableRoleNames.includes(normalizedToken)) return normalizedToken;

	const matchedByAlias = availableRoleNames.filter((roleName) => {
		const aliases = roleAliasMap.get(roleName) || [];
		return aliases.some((alias) => normalizeRoleName(alias) === normalizedToken);
	});
	if (matchedByAlias.length === 1) return matchedByAlias[0];
	return null;
}

function buildRoleAliasesFromCards(
	roleCards: Array<{ roleName: string; imageUrl: string }>,
): Map<string, string[]> {
	const roleNames = Array.from(
		new Set(roleCards.map((card) => normalizeRoleName(card.roleName)).filter(Boolean)),
	);
	return buildRoleAliases(roleNames);
}

function detectRoleNamesFromPromptByAlias(
	promptCorpus: string,
	availableRoleNames: string[],
	roleAliasMap: Map<string, string[]>,
): string[] {
	const hits: string[] = [];
	for (const roleName of availableRoleNames) {
		const aliases = roleAliasMap.get(roleName) || [roleName];
		const matched = aliases.some((alias) => {
			const key = String(alias || "").trim().toLowerCase();
			return key ? promptCorpus.includes(key) : false;
		});
		if (matched) hits.push(roleName);
	}
	return Array.from(new Set(hits));
}

function findPrevChunkTailFrameUrl(input: {
	chunks: StoryboardChunkRecord[];
	chapter: number;
	groupSize: StoryboardGroupSize;
	chunkIndex: number;
}): string | null {
	const readChunkTailFrameUrl = (chunk: StoryboardChunkRecord | null | undefined): string => {
		const tail = typeof chunk?.tailFrameUrl === "string" ? chunk.tailFrameUrl.trim() : "";
		if (tail) return tail;
		const frameUrls = Array.isArray(chunk?.frameUrls)
			? chunk.frameUrls.map((item) => String(item || "").trim()).filter(Boolean)
			: [];
		return frameUrls[frameUrls.length - 1] || "";
	};

	if (input.chunkIndex > 0) {
		const target = input.chunks.find(
			(chunk) =>
				Number(chunk?.chapter) === input.chapter &&
				Number(chunk?.groupSize) === input.groupSize &&
				Number(chunk?.chunkIndex) === input.chunkIndex - 1,
		);
		const tail = readChunkTailFrameUrl(target);
		return tail || null;
	}

	const crossChapterFallback = [...input.chunks]
		.filter((chunk) => Number(chunk?.chapter) < input.chapter)
		.sort((a, b) => {
			const chapterDiff = Number(b?.chapter || 0) - Number(a?.chapter || 0);
			if (chapterDiff !== 0) return chapterDiff;
			const chunkDiff = Number(b?.chunkIndex || 0) - Number(a?.chunkIndex || 0);
			if (chunkDiff !== 0) return chunkDiff;
			return Number(b?.shotEnd || 0) - Number(a?.shotEnd || 0);
		})
		.find((chunk) => Boolean(readChunkTailFrameUrl(chunk)));
	const fallbackTail = readChunkTailFrameUrl(crossChapterFallback);
	return fallbackTail || null;
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

function validateStoryboardShotPrompts(shotPrompts: string[]): { prompts: string[] } {
	const prompts = shotPrompts.map((x) => String(x || "").trim()).filter(Boolean);
	return { prompts };
}

type StoryboardWorkflowShotInput = StoryboardWorkflowGenerateRequestDto["shots"][number];

function normalizeStoryboardShotInputs(shots: StoryboardWorkflowShotInput[]): {
	shots: StoryboardWorkflowShotInput[];
	prompts: string[];
} {
	const normalizedShots = shots
		.map((item) => ({
			...item,
			promptText: String(item?.promptText || "").trim(),
		}))
		.filter((item) => item.promptText);
	const prompts = normalizedShots.map((item) => item.promptText);
	return { shots: normalizedShots, prompts };
}

type KeyframeShotFeatures = {
	action: string;
	shotType: string;
	camera: string;
};

function compactFeatureText(input: string): string {
	return String(input || "")
		.trim()
		.toLowerCase()
		.replace(/[，。；：!！?？、]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function extractKeyframeShotFeatures(prompt: string): KeyframeShotFeatures {
	const text = String(prompt || "").trim();
	const parts = text
		.split(/[;；\n]/)
		.map((x) => String(x || "").trim())
		.filter(Boolean);
	const pick = (patterns: RegExp[]): string => {
		for (const part of parts) {
			for (const re of patterns) {
				const m = part.match(re);
				const val = String(m?.[1] || "").trim();
				if (val) return val;
			}
		}
		return "";
	};
	const pickInline = (patterns: RegExp[]): string => {
		for (const re of patterns) {
			const m = text.match(re);
			const val = String(m?.[1] || "").trim();
			if (val) return val;
		}
		return "";
	};
	const action =
		pick([/^(?:主体动作|画面主体)\s*[：:]\s*(.+)$/i]) ||
		pickInline([/(?:主体动作|画面主体)\s*[：:]\s*([^；;\n]+)(?=[；;\n]|$)/i]) ||
		(parts[0] ? String(parts[0]).replace(/^镜头\s*\d+\s*[：:]/, "").trim() : "");
	const shotType =
		pick([/^(?:镜头类型|景别)\s*[：:]\s*(.+)$/i]) ||
		pickInline([/(?:镜头类型|景别)\s*[：:]\s*([^；;\n]+)(?=[；;\n]|$)/i]);
	const camera =
		pick([/^(?:机位(?:\/运动)?|机位\/运动)\s*[：:]\s*(.+)$/i]) ||
		pickInline([/(?:机位(?:\/运动)?|机位\/运动)\s*[：:]\s*([^；;\n]+)(?=[；;\n]|$)/i]);
	return {
		action: compactFeatureText(action),
		shotType: compactFeatureText(shotType),
		camera: compactFeatureText(camera),
	};
}

function preflightKeyframeDiversity(shotPrompts: string[]): {
	ok: boolean;
	features: KeyframeShotFeatures[];
	violations: Array<{ pair: string; reason: string }>;
} {
	const features = shotPrompts.map((x) => extractKeyframeShotFeatures(x));
	const violations: Array<{ pair: string; reason: string }> = [];
	for (let i = 1; i < features.length; i += 1) {
		const prev = features[i - 1];
		const curr = features[i];
		const changedCount =
			(prev.action !== curr.action ? 1 : 0) +
			(prev.shotType !== curr.shotType ? 1 : 0) +
			(prev.camera !== curr.camera ? 1 : 0);
		if (changedCount < 2) {
			violations.push({
				pair: `${i}-${i + 1}`,
				reason: "相邻镜头在 主体动作/镜头类型/机位运动 三项中变化少于两项",
			});
		}
	}
	return { ok: violations.length === 0, features, violations };
}

function preflightKeyframeDiversityByStructuredShots(
	shotItems: Array<{ subjectAction: string; shotType: string; cameraMovement: string }>,
): {
	ok: boolean;
	features: KeyframeShotFeatures[];
	violations: Array<{ pair: string; reason: string }>;
} {
	const features = shotItems.map((item) => ({
		action: compactFeatureText(item.subjectAction),
		shotType: compactFeatureText(item.shotType),
		camera: compactFeatureText(item.cameraMovement),
	}));
	const violations: Array<{ pair: string; reason: string }> = [];
	for (let i = 1; i < features.length; i += 1) {
		const prev = features[i - 1];
		const curr = features[i];
		const changedCount =
			(prev.action !== curr.action ? 1 : 0) +
			(prev.shotType !== curr.shotType ? 1 : 0) +
			(prev.camera !== curr.camera ? 1 : 0);
		if (changedCount < 2) {
			violations.push({
				pair: `${i}-${i + 1}`,
				reason: "相邻镜头在 主体动作/镜头类型/机位运动 三项中变化少于两项",
			});
		}
	}
	return { ok: violations.length === 0, features, violations };
}

function countKeyframeFeatureChanges(prevPrompt: string, currentPrompt: string): number {
	const prev = extractKeyframeShotFeatures(prevPrompt);
	const curr = extractKeyframeShotFeatures(currentPrompt);
	return (
		(prev.action !== curr.action ? 1 : 0) +
		(prev.shotType !== curr.shotType ? 1 : 0) +
		(prev.camera !== curr.camera ? 1 : 0)
	);
}

function hasRoleReferenceAnchor(items: Array<{ label: string; url: string }>): boolean {
	return items.some((item) => {
		const label = String(item?.label || "").trim();
		return label.startsWith("角色锚点：") || label.startsWith("角色参考：");
	});
}

function hasSceneReferenceAnchor(items: Array<{ label: string; url: string }>): boolean {
	return items.some((item) => {
		const label = String(item?.label || "").trim();
		return (
			label.startsWith("场景道具参考：") ||
			label.startsWith("上一分组尾帧（连续性参考）") ||
			label.startsWith("上一分组尾帧（必须承接）")
		);
	});
}

function resolveStoryboardWorkflowContinuity(input: {
	indexData: any;
	chunks: StoryboardChunkRecord[];
	chapter: number;
	groupSize: StoryboardGroupSize;
	chunkIndex: number;
	shotPrompts: string[];
	scenePropRefId?: string;
	spellFxRefId?: string;
}): StoryboardWorkflowContinuityContext {
	const assets =
		typeof input.indexData?.assets === "object" && input.indexData?.assets
			? input.indexData.assets
			: {};
	const roleCardsRaw = Array.isArray(assets.roleCards) ? assets.roleCards : [];
	const roleCardsAll = roleCardsRaw
			.map((card: any) => ({
				cardId: typeof card?.cardId === "string" ? card.cardId.trim() : "",
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
	const chapterRoleAliasMap = buildRoleAliases(chapterRoleNames);
	const cardRoleAliasMap = buildRoleAliasesFromCards(roleCards);
	const promptCorpus = String(input.shotPrompts.join("\n")).toLowerCase();
	const chapterRoleCards = roleCards.filter((card: any) =>
		new Set(chapterRoleNames).has(normalizeRoleName(card?.roleName)) &&
		isRoleCardApplicableToChapter(card as any, input.chapter),
	);
	const applicableRoleCards = roleCards.filter((card: any) =>
		isRoleCardApplicableToChapter(card as any, input.chapter),
	);
	const mentionTokens = extractMentionRoleTokens(input.shotPrompts);
	const mentionRoleNames = mentionTokens
		.map((token) =>
			resolveMentionToRoleName(
				token,
				Array.from(new Set(roleCards.map((card: any) => normalizeRoleName(card?.roleName)).filter(Boolean))),
				cardRoleAliasMap,
			),
		)
		.filter(Boolean) as string[];
	const inferredRoleNames = detectRoleNamesFromPromptByAlias(
		promptCorpus,
		chapterRoleNames,
		chapterRoleAliasMap,
	);
	const recurringRoleNames = collectRecurringEntityNames(input.indexData, "characters");
	const explicitMentionSet = new Set(mentionRoleNames);
	const roleCardCandidates =
		explicitMentionSet.size > 0
			? roleCards.filter((card: any) => isRoleCardApplicableToChapter(card as any, input.chapter))
			: chapterRoleCards.length
				? chapterRoleCards
				: roleCards.filter((card: any) => isRoleCardApplicableToChapter(card as any, input.chapter));
	const matchedRoleCards = roleCardCandidates
		.filter((card: any) => {
			const roleNameKey = normalizeRoleName(card?.roleName);
			if (!roleNameKey) return false;
			if (explicitMentionSet.size > 0) {
				return explicitMentionSet.has(roleNameKey);
			}
			const aliases = chapterRoleAliasMap.get(roleNameKey) || [roleNameKey];
			return aliases.some((alias) => (alias && promptCorpus.includes(alias.toLowerCase())));
		})
		.sort((a: any, b: any) => Number(b?.updatedAtTs || 0) - Number(a?.updatedAtTs || 0));
	const chapterFallbackRoleCards =
		matchedRoleCards.length === 0 && explicitMentionSet.size === 0 && chapterRoleCards.length > 0
			? [...chapterRoleCards].sort(
					(a: any, b: any) => Number(b?.updatedAtTs || 0) - Number(a?.updatedAtTs || 0),
				)
			: [];
	const globalFallbackRoleCards =
		matchedRoleCards.length === 0 &&
		chapterFallbackRoleCards.length === 0 &&
		explicitMentionSet.size === 0 &&
		applicableRoleCards.length > 0
			? [...applicableRoleCards].sort(
					(a: any, b: any) => Number(b?.updatedAtTs || 0) - Number(a?.updatedAtTs || 0),
				)
			: [];
	const roleRefCandidates =
		matchedRoleCards.length > 0
			? matchedRoleCards
			: chapterFallbackRoleCards.length > 0
				? chapterFallbackRoleCards
				: globalFallbackRoleCards;
	const roleRefMatchStrategy: StoryboardWorkflowContinuityContext["roleRefMatchStrategy"] =
		matchedRoleCards.length > 0
			? "direct_match"
			: chapterFallbackRoleCards.length > 0
				? "chapter_fallback"
				: "global_fallback";
	const matchedRoleNameSet = new Set(
		matchedRoleCards.map((x: any) => normalizeRoleName(x?.roleName)).filter(Boolean),
	);
	const requiredRoleNames: string[] = explicitMentionSet.size > 0
		? Array.from(explicitMentionSet.values())
		: inferredRoleNames.length > 0
			? inferredRoleNames
			: chapterRoleNames.length > 0
				? chapterRoleNames
				: (Array.from(matchedRoleNameSet.values()) as string[]);
	const persistentRequiredRoleNames = requiredRoleNames.filter((name) =>
		recurringRoleNames.has(name),
	);
	const missingRequiredRoleNames = persistentRequiredRoleNames.filter((name) => {
		const hasCard = roleCards.some(
			(card: any) =>
				normalizeRoleName(card?.roleName) === name &&
				isRoleCardApplicableToChapter(card as any, input.chapter),
		);
		return !hasCard;
	});
	const unconfirmedRequiredRoleNames = persistentRequiredRoleNames.filter((name) => {
		const hasOnlyUnconfirmed = unconfirmedRoleCards.some(
			(card: any) =>
				normalizeRoleName(card?.roleName) === name &&
				isRoleCardApplicableToChapter(card as any, input.chapter),
		);
		if (!hasOnlyUnconfirmed) return false;
		const hasConfirmed = roleCards.some(
			(card: any) =>
				normalizeRoleName(card?.roleName) === name &&
				isRoleCardApplicableToChapter(card as any, input.chapter),
		);
		return !hasConfirmed;
	});
	const preferredRoleCards = dedupeRoleCardEntries(roleRefCandidates, 6);
	const roleReferenceImages: string[] = preferredRoleCards.map((x) => x.imageUrl);
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
		if (explicitRefId) {
			const explicit = applicable.find((item: { refId: string }) => item.refId === explicitRefId) || null;
			return explicit;
		}
		return applicable[0] || null;
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
	const styleReferenceImages: string[] = Array.isArray(assets?.styleBible?.referenceImages)
		? Array.from(
			new Set(
				assets.styleBible.referenceImages
					.map((item: any) => String(item || "").trim())
					.filter(Boolean),
			),
		).slice(0, 6) as string[]
		: [];
	const prevTailFrameUrl = findPrevChunkTailFrameUrl({
		chunks: input.chunks,
		chapter: input.chapter,
		groupSize: input.groupSize,
		chunkIndex: input.chunkIndex,
	});
	const stylePromptPrefix = buildStylePromptPrefix(assets.styleBible);
	return {
		roleReferenceImages,
		roleReferenceEntries: preferredRoleCards.map((x) => ({
			cardId: String(x.cardId || "").trim(),
			roleName: String(x.roleName || "").trim(),
			imageUrl: String(x.imageUrl || "").trim(),
			...(String(x.stateDescription || "").trim() ? { stateDescription: String(x.stateDescription || "").trim() } : null),
			...(typeof x.chapter === "number" ? { chapter: x.chapter } : null),
			...(typeof x.chapterStart === "number" ? { chapterStart: x.chapterStart } : null),
			...(typeof x.chapterEnd === "number" ? { chapterEnd: x.chapterEnd } : null),
			...(Array.isArray(x.chapterSpan) && x.chapterSpan.length ? { chapterSpan: x.chapterSpan } : null),
		})),
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
		requiredRoleNames,
		persistentRequiredRoleNames,
		missingRequiredRoleNames,
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

function dedupeReferenceItems(
	items: Array<{ url: string; label: string }>,
	limit = 8,
): Array<{ url: string; label: string }> {
	const out: Array<{ url: string; label: string }> = [];
	const seen = new Set<string>();
	for (const item of items) {
		const url = String(item?.url || "").trim();
		const label = String(item?.label || "").trim();
		if (!url || seen.has(url)) continue;
		seen.add(url);
		out.push({ url, label });
		if (out.length >= limit) break;
	}
	return out;
}

function selectRoleReferenceEntriesForShot(
	shotPrompt: string,
	entries: Array<{ cardId: string; roleName: string; imageUrl: string }>,
	limit = 4,
): Array<{ cardId: string; roleName: string; imageUrl: string }> {
	const normalizedEntries = entries
		.map((entry) => ({
			cardId: String(entry?.cardId || "").trim(),
			roleName: String(entry?.roleName || "").trim(),
			imageUrl: String(entry?.imageUrl || "").trim(),
		}))
		.filter((entry) => entry.roleName && entry.imageUrl);
	if (!normalizedEntries.length) return [];
	const mentionTokens = extractMentionRoleTokens([shotPrompt]).map((x) => normalizeRoleName(x));
	const mentionSet = new Set(mentionTokens.filter(Boolean));
	if (!mentionSet.size) return normalizedEntries.slice(0, limit);
	const matched = normalizedEntries.filter((entry) => mentionSet.has(normalizeRoleName(entry.roleName)));
	return (matched.length ? matched : normalizedEntries).slice(0, limit);
}

function selectChunkAnchorRoleReferenceEntries(
	shotPrompts: string[],
	entries: Array<{ cardId: string; roleName: string; imageUrl: string }>,
	limit = 2,
): Array<{ cardId: string; roleName: string; imageUrl: string }> {
	const normalizedEntries = entries
		.map((entry) => ({
			cardId: String(entry?.cardId || "").trim(),
			roleName: String(entry?.roleName || "").trim(),
			imageUrl: String(entry?.imageUrl || "").trim(),
		}))
		.filter((entry) => entry.roleName && entry.imageUrl);
	if (!normalizedEntries.length || limit <= 0) return [];

	const mentionStats = new Map<string, number>();
	for (const shotPrompt of shotPrompts) {
		const mentionTokens = extractMentionRoleTokens([shotPrompt]).map((x) => normalizeRoleName(x));
		for (const token of mentionTokens) {
			if (!token) continue;
			mentionStats.set(token, (mentionStats.get(token) || 0) + 1);
		}
	}

	const scored = normalizedEntries
		.map((entry, idx) => {
			const roleKey = normalizeRoleName(entry.roleName);
			return {
				...entry,
				score: mentionStats.get(roleKey) || 0,
				idx,
			};
		})
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return a.idx - b.idx;
		});

	return scored.slice(0, limit).map((item) => ({
		cardId: item.cardId,
		roleName: item.roleName,
		imageUrl: item.imageUrl,
	}));
}

async function resolveLocalCollageScriptPath(): Promise<string> {
	const candidates = [
		"/workspace/apps/agents-cli/skills/tapcanvas-collage-local/scripts/collage.py",
		path.resolve(
			process.cwd(),
			"apps/agents-cli/skills/tapcanvas-collage-local/scripts/collage.py",
		),
		path.resolve(
			process.cwd(),
			"../agents-cli/skills/tapcanvas-collage-local/scripts/collage.py",
		),
		path.resolve(
			process.cwd(),
			"skills/tapcanvas-collage-local/scripts/collage.py",
		),
	];
	for (const p of candidates) {
		try {
			await fs.access(p);
			return p;
		} catch {
			// continue
		}
	}
	throw new AppError("本地拼图脚本不存在：tapcanvas-collage-local", {
		status: 500,
		code: "storyboard_local_collage_script_missing",
		details: { candidates },
	});
}

async function runLocalCollageScript(input: {
	imageUrls: string[];
	outputPath: string;
	grid: 2 | 3;
	cellSize: number;
	dividerWidth: number;
	dividerColor: string;
	labels?: string[];
}): Promise<void> {
	const scriptPath = await resolveLocalCollageScriptPath();
	const args = [
		scriptPath,
		...input.imageUrls.flatMap((url) => ["--input", url]),
		...((input.labels || []).flatMap((label) => ["--label", String(label || "").trim()]).filter(Boolean)),
		"--output",
		input.outputPath,
		"--grid",
		String(input.grid),
		"--cell-size",
		String(input.cellSize),
		"--divider-width",
		String(input.dividerWidth),
		"--divider-color",
		input.dividerColor,
	];

	await new Promise<void>((resolve, reject) => {
		const child = spawn("python3", args, {
			cwd: process.cwd(),
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(
				new AppError("本地拼图超时（python3）", {
					status: 500,
					code: "storyboard_local_collage_timeout",
					details: { timeoutMs: 90_000, scriptPath },
				}),
			);
		}, 90_000);
		child.stdout.on("data", (chunk) => {
			stdout += String(chunk || "");
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk || "");
		});
		child.on("error", (err: any) => {
			clearTimeout(timer);
			reject(
				new AppError(`本地拼图执行失败：${String(err?.message || err)}`, {
					status: 500,
					code: "storyboard_local_collage_spawn_failed",
					details: { scriptPath },
				}),
			);
		});
		child.on("exit", (code) => {
			clearTimeout(timer);
			if (code === 0) {
				resolve();
				return;
			}
			reject(
				new AppError("本地拼图执行失败（python3）", {
					status: 500,
					code: "storyboard_local_collage_failed",
					details: {
						exitCode: code,
						stdout: truncateForLog(stdout, 2000),
						stderr: truncateForLog(stderr, 2000),
						scriptPath,
					},
				}),
			);
		});
	});
}

async function buildLocalStoryboardCompositeAndUpload(input: {
	c: AppContext;
	userId: string;
	imageUrls: string[];
	grid: 2 | 3;
	cellSize: number;
	dividerWidth: number;
	dividerColor: string;
	labels?: string[];
	prefix?: string;
}): Promise<string> {
	const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tapcanvas-collage-"));
	const outPath = path.join(tmpRoot, "composite.png");
	try {
		await runLocalCollageScript({
			imageUrls: input.imageUrls,
			outputPath: outPath,
			grid: input.grid,
			cellSize: input.cellSize,
			dividerWidth: input.dividerWidth,
			dividerColor: input.dividerColor,
			labels: input.labels,
		});
		const bytes = await fs.readFile(outPath);
		const url = await uploadInlineImageToRustfs({
			c: input.c,
			userId: input.userId,
			mimeType: "image/png",
			base64: bytes.toString("base64"),
			prefix: input.prefix || "storyboard/composite",
		});
		return url;
	} finally {
		await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
	}
}

async function splitLocalStoryboardGridIntoFiles(input: {
	imageUrl: string;
	outputDir: string;
	grid: number;
	count: number;
}): Promise<string[]> {
	const script = `
import io, os, sys, urllib.request
from PIL import Image
url = sys.argv[1]
out_dir = sys.argv[2]
grid = int(sys.argv[3])
count = int(sys.argv[4])
os.makedirs(out_dir, exist_ok=True)
with urllib.request.urlopen(url, timeout=45) as resp:
    data = resp.read()
img = Image.open(io.BytesIO(data)).convert("RGB")
w, h = img.size
if grid <= 0:
    raise RuntimeError("invalid grid")
cell_w = w // grid
cell_h = h // grid
if cell_w <= 0 or cell_h <= 0:
    raise RuntimeError("grid too large for image size")
paths = []
for i in range(count):
    r = i // grid
    c = i % grid
    left = c * cell_w
    top = r * cell_h
    right = (c + 1) * cell_w if c < grid - 1 else w
    bottom = (r + 1) * cell_h if r < grid - 1 else h
    if left >= right or top >= bottom:
        raise RuntimeError(f"invalid crop box at cell {i+1}")
    tile = img.crop((left, top, right, bottom))
    fp = os.path.join(out_dir, f"cell-{i+1:02d}.png")
    tile.save(fp)
    paths.append(fp)
print("\\n".join(paths))
`.trim();
	return await new Promise<string[]>((resolve, reject) => {
		const child = spawn("python3", ["-c", script, input.imageUrl, input.outputDir, String(input.grid), String(input.count)], {
			cwd: process.cwd(),
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(
				new AppError("宫格切图超时（python3）", {
					status: 500,
					code: "storyboard_grid_split_timeout",
					details: { timeoutMs: 90_000 },
				}),
			);
		}, 90_000);
		child.stdout.on("data", (chunk) => {
			stdout += String(chunk || "");
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk || "");
		});
		child.on("error", (err: any) => {
			clearTimeout(timer);
			reject(
				new AppError(`宫格切图执行失败：${String(err?.message || err)}`, {
					status: 500,
					code: "storyboard_grid_split_spawn_failed",
				}),
			);
		});
		child.on("exit", (code) => {
			clearTimeout(timer);
			if (code !== 0) {
				reject(
					new AppError("宫格切图执行失败（python3）", {
						status: 500,
						code: "storyboard_grid_split_failed",
						details: {
							exitCode: code,
							stdout: truncateForLog(stdout, 2000),
							stderr: truncateForLog(stderr, 2000),
						},
					}),
				);
				return;
			}
			const lines = stdout
				.split(/\r?\n/)
				.map((x) => String(x || "").trim())
				.filter(Boolean);
			resolve(lines);
		});
	});
}

async function splitStoryboardGridAndUpload(input: {
	c: AppContext;
	userId: string;
	gridImageUrl: string;
	grid: number;
	count: number;
	prefix?: string;
}): Promise<string[]> {
	const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tapcanvas-grid-split-"));
	try {
		const paths = await splitLocalStoryboardGridIntoFiles({
			imageUrl: input.gridImageUrl,
			outputDir: tmpRoot,
			grid: input.grid,
			count: input.count,
		});
		if (paths.length !== input.count) {
			throw new AppError(`宫格切图数量异常：期望 ${input.count}，实际 ${paths.length}`, {
				status: 500,
				code: "storyboard_grid_split_count_mismatch",
			});
		}
		const out: string[] = [];
		for (let i = 0; i < paths.length; i += 1) {
			// eslint-disable-next-line no-await-in-loop
			const bytes = await fs.readFile(paths[i]);
			// eslint-disable-next-line no-await-in-loop
			const url = await uploadInlineImageToRustfs({
				c: input.c,
				userId: input.userId,
				mimeType: "image/png",
				base64: bytes.toString("base64"),
				prefix: input.prefix || "storyboard/workflow-grid-cell",
			});
			out.push(url);
		}
		return out;
	} finally {
		await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
	}
}

async function runTaskWithVendorFallback(
	c: AppContext,
	userId: string,
	request: TaskRequestDto,
	vendorCandidates?: string[],
): Promise<{ vendor: string; result: any }> {
	try {
		const isImageTask = request.kind === "text_to_image" || request.kind === "image_edit";
		const normalizeCandidates = (list?: string[]): string[] => {
			if (!Array.isArray(list) || !list.length) return [];
			const seen = new Set<string>();
			const out: string[] = [];
			for (const item of list) {
				const key = String(item || "").trim().toLowerCase();
				if (!key || seen.has(key)) continue;
				seen.add(key);
				out.push(key);
			}
			return out;
		};
		const failureText = (result: any): string =>
			[
				typeof result?.message === "string" ? result.message : "",
				typeof result?.error === "string" ? result.error : "",
				typeof result?.errorMessage === "string" ? result.errorMessage : "",
				typeof result?.raw?.message === "string" ? result.raw.message : "",
				typeof result?.raw?.error === "string" ? result.raw.error : "",
				typeof result?.raw?.error?.message === "string" ? result.raw.error.message : "",
			]
				.filter(Boolean)
				.join(" | ")
				.toLowerCase();
		const isModelNotSupported = (result: any): boolean => {
			const text = failureText(result);
			return (
				text.includes("not supported model") ||
				text.includes("unsupported model") ||
				text.includes("model_not_supported") ||
				text.includes("模型不支持") ||
				text.includes("不支持模型")
			);
		};
		const removeVendor = (list: string[], vendor: string): string[] => {
			const key = String(vendor || "").trim().toLowerCase();
			if (!key) return list;
			return list.filter((item) => item !== key);
		};

		let remainingCandidates = normalizeCandidates(vendorCandidates);
		const hasExplicitCandidates = remainingCandidates.length > 0;
		const retryWithoutExplicitMax = clampInt(
			process?.env?.STORYBOARD_IMAGE_VENDOR_RETRY_MAX,
			1,
			4,
			2,
		);
		const submitAttemptsMax = hasExplicitCandidates
			? remainingCandidates.length
			: retryWithoutExplicitMax;

		let lastVendor = "auto";
		let lastResult: any = null;

		for (let submitAttempt = 0; submitAttempt < submitAttemptsMax; submitAttempt += 1) {
			const created = await runPublicTask(c as any, userId, {
				vendor: "auto",
				...(remainingCandidates.length ? { vendorCandidates: remainingCandidates } : null),
				request,
			});
			const initialStatus = String(created?.result?.status || "").trim().toLowerCase();
			lastVendor = String(created?.vendor || "").trim() || lastVendor;
			lastResult = created?.result ?? null;

			if (!isImageTask || (initialStatus !== "queued" && initialStatus !== "running")) {
				if (
					isImageTask &&
					initialStatus === "failed" &&
					isModelNotSupported(lastResult) &&
					remainingCandidates.length > 1
				) {
					remainingCandidates = removeVendor(remainingCandidates, lastVendor);
					continue;
				}
				return created;
			}

			const taskId = String(created?.result?.id || "").trim();
			if (!taskId) return created;

			const maxWaitMs = clampInt(
				process?.env?.STORYBOARD_IMAGE_POLL_TIMEOUT_MS,
				10_000,
				600_000,
				180_000,
			);
			const perVendorWaitMs =
				hasExplicitCandidates && remainingCandidates.length > 1
					? Math.min(maxWaitMs, 60_000)
					: maxWaitMs;
			const intervalMs = clampInt(
				process?.env?.STORYBOARD_IMAGE_POLL_INTERVAL_MS,
				300,
				5_000,
				1500,
			);
			const deadline = Date.now() + perVendorWaitMs;
			let currentResult = created.result;
			let currentVendor = String(created.vendor || "").trim() || lastVendor;
			while (Date.now() < deadline) {
				const outcome = await fetchTaskResultForPolling(c as any, userId, {
					taskId,
					vendor: currentVendor,
					taskKind: request.kind,
					prompt: typeof request.prompt === "string" ? request.prompt : null,
					mode: "public",
				});
				if (outcome.ok) {
					currentResult = outcome.result;
					currentVendor = String(outcome.vendor || "").trim() || currentVendor;
					const status = String(currentResult?.status || "").trim().toLowerCase();
					if (status === "succeeded") {
						return { vendor: currentVendor, result: currentResult };
					}
					if (status === "failed") {
						lastVendor = currentVendor;
						lastResult = currentResult;
						if (remainingCandidates.length > 1) {
							remainingCandidates = removeVendor(remainingCandidates, currentVendor);
							break;
						}
						return { vendor: currentVendor, result: currentResult };
					}
				}
				await new Promise((resolve) => setTimeout(resolve, intervalMs));
			}

			// polling timeout: try next explicit candidate first, otherwise return latest status
			lastVendor = currentVendor;
			lastResult = currentResult;
			if (remainingCandidates.length > 1) {
				remainingCandidates = removeVendor(remainingCandidates, currentVendor);
				continue;
			}
			return { vendor: currentVendor, result: currentResult };
		}

		return { vendor: lastVendor, result: lastResult };
	} catch (err: any) {
		throw new AppError(
			String(err?.message || "no available vendor for storyboard workflow"),
			{
				status: 400,
				code: "storyboard_vendor_unavailable",
				details: err?.details ?? null,
			},
		);
	}
}

async function readStoryboardChunksForBook(
	projectId: string,
	bookId: string,
	ownerId?: string,
): Promise<{ indexPath: string; chunks: StoryboardChunkRecord[]; indexData: any }> {
	const indexPath = await resolveReadableBookIndexPath({ projectId, bookId, ownerId });
	const indexData = (await readJsonFileSafe(indexPath)) || {};
	const assets = typeof indexData?.assets === "object" && indexData.assets ? indexData.assets : {};
	const chunks = Array.isArray(assets.storyboardChunks) ? (assets.storyboardChunks as StoryboardChunkRecord[]) : [];
	return { indexPath, chunks, indexData };
}

function buildStoryboardChunkSemanticAssetRecords(input: {
	record: StoryboardChunkRecord;
	userId: string;
	semanticBindings?: StoryboardChunkSemanticBindings;
}): Array<Record<string, unknown>> {
	const out: Array<Record<string, unknown>> = [];
	const frameUrls = Array.isArray(input.record.frameUrls) ? input.record.frameUrls : [];
	const shotPrompts = Array.isArray(input.record.shotPrompts) ? input.record.shotPrompts : [];
	const roleBindings = Array.isArray(input.semanticBindings?.roleReferences)
		? input.semanticBindings.roleReferences
		: [];
	const scenePropReference = input.semanticBindings?.scenePropReference || null;
	const spellFxReference = input.semanticBindings?.spellFxReference || null;
	for (let index = 0; index < frameUrls.length; index += 1) {
		const imageUrl = String(frameUrls[index] || "").trim();
		if (!imageUrl) continue;
		const shotNo = input.record.shotStart + index;
		const prompt = String(shotPrompts[index] || "").trim();
		const anchorBindings: PublicFlowAnchorBinding[] = [
			...roleBindings.map((role) => ({
				kind: "character" as const,
				refId: role.cardId,
				label: role.roleName,
				imageUrl: role.imageUrl,
				...(role.stateDescription ? { note: role.stateDescription } : null),
			})),
			...(scenePropReference
				? [
						{
							kind: "scene" as const,
							refId: scenePropReference.refId,
							label: scenePropReference.label,
							imageUrl: scenePropReference.imageUrl,
						},
					]
				: []),
			...(spellFxReference
				? [
						{
							kind: "prop" as const,
							refId: spellFxReference.refId,
							label: spellFxReference.label,
							imageUrl: spellFxReference.imageUrl,
							category: "spell_fx",
						},
					]
				: []),
		];
		const stateDescription = roleBindings
			.map((item) => String(item.stateDescription || "").trim())
			.filter(Boolean)
			.join("；");
		out.push({
			semanticId: `${input.record.chunkId}:shot:${String(shotNo)}`,
			mediaKind: "image",
			status: "generated",
			chunkId: input.record.chunkId,
			imageUrl,
			chapter: input.record.chapter,
			chapterStart: input.record.chapter,
			chapterEnd: input.record.chapter,
			chapterSpan: [input.record.chapter],
			shotNo,
			...(stateDescription ? { stateDescription } : null),
			...(prompt ? { prompt } : null),
			...(anchorBindings.length ? { anchorBindings } : null),
			productionLayer: "results",
			creationStage: "storyboard_stills",
			approvalStatus: "approved",
			confirmationMode: "auto",
			confirmedAt: input.record.updatedAt,
			confirmedBy: input.userId,
			createdAt: input.record.createdAt,
			updatedAt: input.record.updatedAt,
			createdBy: input.userId,
			updatedBy: input.userId,
		});
	}
	return out;
}

export async function getStoryboardContinuityEvidence(
	input: {
		projectId: string;
		bookId: string;
		chapter: number;
		groupSize: StoryboardGroupSize;
		chunkIndex: number;
		shotPrompts?: string[];
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
	const continuity = resolveStoryboardWorkflowContinuity({
		indexData,
		chunks,
		chapter: input.chapter,
		groupSize: input.groupSize,
		chunkIndex: input.chunkIndex,
		shotPrompts: Array.isArray(input.shotPrompts)
			? input.shotPrompts.map((item) => String(item || "").trim()).filter(Boolean)
			: [],
		...(input.scenePropRefId ? { scenePropRefId: input.scenePropRefId } : {}),
		...(input.spellFxRefId ? { spellFxRefId: input.spellFxRefId } : {}),
	});
	const chapterChunks = chunks
		.filter(
			(chunk) =>
				Number(chunk?.chapter) === input.chapter &&
				Number(chunk?.groupSize) === input.groupSize,
		)
		.sort((a, b) => Number(a?.chunkIndex || 0) - Number(b?.chunkIndex || 0));
	const currentChunk =
		chapterChunks.find((chunk) => Number(chunk?.chunkIndex) === input.chunkIndex) || null;
	const previousChunk =
		chapterChunks.find((chunk) => Number(chunk?.chunkIndex) === input.chunkIndex - 1) || null;

	return {
		projectId: input.projectId,
		bookId: input.bookId,
		chapter: input.chapter,
		groupSize: input.groupSize,
		chunkIndex: input.chunkIndex,
		prevTailFrameUrl: continuity.prevTailFrameUrl,
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
}): Promise<NodeContextBundleDto> {
	const flow = await getFlowForOwner(input.c.env.DB, input.flowId, input.ownerId);
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

type StoryboardShotProcessRecord = {
	version: 1;
	projectId: string;
	bookId: string;
	chapter: number;
	chunkId: string;
	chunkIndex: number;
	groupSize: StoryboardGroupSize;
	shotNo: number;
	shotIndexInChunk: number;
	script: string;
	imageUrl: string;
	selectedImageUrl?: string;
	selectedCandidateId?: string;
	imageCandidates?: StoryboardShotImageCandidate[];
	selectionHistory?: StoryboardShotSelectionRecord[];
	references: Array<{ label: string; url: string }>;
	roleCardAnchors: Array<{ cardId: string; roleName: string; imageUrl: string; source: "chunk_anchor" | "shot_match" }>;
	modelThinking: {
		modelKey: string;
		promptForShot: string;
		referenceRoleHint: string;
		roleToRefHint: string;
		anchorRoleHint: string;
		referenceCompositeInjected: boolean;
	};
	generation?: {
		vendor: string;
		taskId: string;
		attemptCount: number;
		referenceImagesUsed: string[];
		qc: {
			passed: boolean;
			score: number;
			reason: string;
			retryTriggered: boolean;
		};
	};
	worldEvolutionThinking: string;
	createdAt: string;
	updatedAt: string;
	updatedBy: string;
};

type StoryboardShotCandidateSource = "generated" | "edited";

type StoryboardShotImageCandidate = {
	candidateId: string;
	imageUrl: string;
	source: StoryboardShotCandidateSource;
	selected: boolean;
	createdAt: string;
	createdBy: string;
	vendor?: string;
	taskId?: string;
};

type StoryboardShotSelectionRecord = {
	candidateId: string;
	imageUrl: string;
	source: StoryboardShotCandidateSource;
	selectedAt: string;
	selectedBy: string;
};

function buildStoryboardShotCandidateId(shotNo: number): string {
	const rand = Math.random().toString(36).slice(2, 8);
	return `shot-${Math.max(1, Math.trunc(shotNo))}-${Date.now().toString(36)}-${rand}`;
}

function normalizeStoryboardShotImageCandidates(
	value: unknown,
): StoryboardShotImageCandidate[] {
	if (!Array.isArray(value)) return [];
	const out: StoryboardShotImageCandidate[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const parsed = item as Record<string, unknown>;
		const candidateId = String(parsed.candidateId || "").trim();
		const imageUrl = String(parsed.imageUrl || "").trim();
		if (!candidateId || !imageUrl) continue;
		const sourceRaw = String(parsed.source || "").trim().toLowerCase();
		const source: StoryboardShotCandidateSource =
			sourceRaw === "edited" ? "edited" : "generated";
		const selected = parsed.selected === true;
		const createdAt = String(parsed.createdAt || "").trim() || new Date().toISOString();
		const createdBy = String(parsed.createdBy || "").trim() || "system";
		const vendor = String(parsed.vendor || "").trim();
		const taskId = String(parsed.taskId || "").trim();
		out.push({
			candidateId,
			imageUrl,
			source,
			selected,
			createdAt,
			createdBy,
			...(vendor ? { vendor } : {}),
			...(taskId ? { taskId } : {}),
		});
	}
	return out.slice(0, 200);
}

function normalizeStoryboardShotSelectionHistory(
	value: unknown,
): StoryboardShotSelectionRecord[] {
	if (!Array.isArray(value)) return [];
	const out: StoryboardShotSelectionRecord[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const parsed = item as Record<string, unknown>;
		const candidateId = String(parsed.candidateId || "").trim();
		const imageUrl = String(parsed.imageUrl || "").trim();
		if (!candidateId || !imageUrl) continue;
		const sourceRaw = String(parsed.source || "").trim().toLowerCase();
		const source: StoryboardShotCandidateSource =
			sourceRaw === "edited" ? "edited" : "generated";
		const selectedAt = String(parsed.selectedAt || "").trim() || new Date().toISOString();
		const selectedBy = String(parsed.selectedBy || "").trim() || "system";
		out.push({
			candidateId,
			imageUrl,
			source,
			selectedAt,
			selectedBy,
		});
	}
	return out.slice(0, 500);
}

type StoryboardChunkProcessRecord = {
	version: 1;
	projectId: string;
	bookId: string;
	chapter: number;
	chunkId: string;
	chunkIndex: number;
	groupSize: StoryboardGroupSize;
	shotStart: number;
	shotEnd: number;
	shots: StoryboardShotProcessRecord[];
	gridImageUrl?: string;
	createdAt: string;
	updatedAt: string;
	updatedBy: string;
};

function normalizeStoryboardShotProcessRecord(value: unknown): StoryboardShotProcessRecord | null {
	if (!value || typeof value !== "object") return null;
	const parsed = value as any;
	const shotNo = Math.trunc(Number(parsed?.shotNo || 0));
	const chapter = Math.trunc(Number(parsed?.chapter || 0));
	if (shotNo <= 0 || chapter <= 0) return null;
	return parsed as StoryboardShotProcessRecord;
}

type StoryboardBookProgressState = {
	totalShots: number | null;
	completedShots: number;
	progress01: number | null;
	next: {
		chapter: number;
		nextShotStart: number;
		nextShotEnd: number;
		groupSize: StoryboardGroupSize;
	};
};

type StoryboardChapterProgressSnapshot = {
	chapter: number;
	totalShots: number | null;
	completedShots: number;
	nextShotStart: number | null;
	nextShotEnd: number | null;
	groupSize: StoryboardGroupSize;
};

async function listStoryboardShotProcessRecords(input: {
	projectId: string;
	bookId: string;
	ownerId?: string;
}): Promise<StoryboardShotProcessRecord[]> {
	const dirs = [
		buildBookProcessRoot(input.projectId, input.bookId, input.ownerId),
		buildBookProcessRoot(input.projectId, input.bookId),
	];
	for (const dir of dirs) {
		try {
			const entries = await fs.readdir(dir, { withFileTypes: true });
			const shotFiles = entries
				.filter((x) => x.isFile() && /^shot-\d{4,}\.json$/i.test(String(x.name || "")))
				.map((x) => path.join(dir, x.name));
			const chunkFiles = entries
				.filter((x) => x.isFile() && /^ch\d+-g\d+-i\d+\.json$/i.test(String(x.name || "")))
				.map((x) => path.join(dir, x.name));
			const out: StoryboardShotProcessRecord[] = [];
			for (const filePath of shotFiles) {
				// eslint-disable-next-line no-await-in-loop
				const parsed = (await readJsonFileSafe(filePath)) as StoryboardShotProcessRecord | null;
				const rec = normalizeStoryboardShotProcessRecord(parsed);
				if (!rec) continue;
				out.push(rec);
			}
			for (const filePath of chunkFiles) {
				// eslint-disable-next-line no-await-in-loop
				const parsed = (await readJsonFileSafe(filePath)) as StoryboardChunkProcessRecord | null;
				if (!parsed || typeof parsed !== "object") continue;
				const shots = Array.isArray((parsed as any)?.shots) ? (parsed as any).shots : [];
				for (const shot of shots) {
					const rec = normalizeStoryboardShotProcessRecord(shot);
					if (!rec) continue;
					out.push(rec);
				}
			}
			return out;
		} catch {
			// continue
		}
	}
	return [];
}

async function readStoryboardShotProcessRecord(input: {
	projectId: string;
	bookId: string;
	shotNo: number;
	ownerId?: string;
}): Promise<StoryboardShotProcessRecord | null> {
	if (!Number.isFinite(input.shotNo) || input.shotNo <= 0) return null;
	const candidates = [
		buildStoryboardShotProcessPath({
			projectId: input.projectId,
			bookId: input.bookId,
			shotNo: input.shotNo,
			ownerId: input.ownerId,
		}),
		buildStoryboardShotProcessPath({
			projectId: input.projectId,
			bookId: input.bookId,
			shotNo: input.shotNo,
		}),
	];
	for (const fp of candidates) {
		// eslint-disable-next-line no-await-in-loop
		const parsed = (await readJsonFileSafe(fp)) as StoryboardShotProcessRecord | null;
		const rec = normalizeStoryboardShotProcessRecord(parsed);
		if (rec) return rec;
	}
	const dirs = [
		buildBookProcessRoot(input.projectId, input.bookId, input.ownerId),
		buildBookProcessRoot(input.projectId, input.bookId),
	];
	for (const dir of dirs) {
		try {
			// eslint-disable-next-line no-await-in-loop
			const entries = await fs.readdir(dir, { withFileTypes: true });
			const chunkFiles = entries
				.filter((x) => x.isFile() && /^ch\d+-g\d+-i\d+\.json$/i.test(String(x.name || "")))
				.map((x) => path.join(dir, x.name));
			for (const fp of chunkFiles) {
				// eslint-disable-next-line no-await-in-loop
				const parsed = (await readJsonFileSafe(fp)) as StoryboardChunkProcessRecord | null;
				if (!parsed || typeof parsed !== "object") continue;
				const shots = Array.isArray((parsed as any)?.shots) ? (parsed as any).shots : [];
				const found = shots.find((x: any) => Math.trunc(Number(x?.shotNo || 0)) === Math.trunc(input.shotNo));
				const rec = normalizeStoryboardShotProcessRecord(found);
				if (rec) return rec;
			}
		} catch {
			// continue
		}
	}
	return null;
}

async function evaluateShotContinuityQCByAgents(input: {
	c: AppContext;
	userId: string;
	projectId: string;
	bookId: string;
	shotNo: number;
	prevScript: string;
	currentScript: string;
	prevImageUrl: string;
	currentImageUrl: string;
	roleAnchors: string[];
}): Promise<{ passed: boolean; score: number; reason: string; rewriteHint: string }> {
	const prompt = [
		"你是分镜连续性QC审核器。请判断当前镜头是否与上一镜头保持角色与场景连续，同时具备必要变化。",
		"输出必须是 JSON：{\"passed\":boolean,\"score\":number,\"reason\":string,\"rewriteHint\":string}",
		"评分规则：0-100，>=70 通过。",
		"硬约束：",
		"- 不能出现角色身份漂移、服装/面部关键特征突变。",
		"- 不能与上一镜头构图几乎重复（需要动作/景别/机位至少两项有变化）。",
		"- 不能引入与剧情无关的新主体。",
		"",
		`bookId=${input.bookId}, shotNo=${input.shotNo}`,
		`上一镜URL=${input.prevImageUrl || "(无)"}`,
		`当前镜URL=${input.currentImageUrl || "(无)"}`,
		input.roleAnchors.length ? `角色锚点=${input.roleAnchors.join("、")}` : "角色锚点=(无)",
		`上一镜脚本=${input.prevScript}`,
		`当前镜脚本=${input.currentScript}`,
	].join("\n");
	await ensureProjectWorkspaceContextFiles({
		c: input.c,
		ownerId: input.userId,
		projectId: input.projectId,
		bookId: input.bookId,
	});
	const task = await runAgentsBridgeChatTask(input.c, input.userId, {
		kind: "chat",
		prompt,
		extras: {
			requiredSkills: [STORYBOARD_ORCHESTRATOR_SKILL],
			privilegedLocalAccess: true,
			localResourcePaths: [buildProjectDataRoot(input.projectId, input.userId)],
			modelKey: resolveStoryboardGovernanceModelKey(),
			canvasProjectId: input.projectId,
			bookId: input.bookId,
			shotNo: input.shotNo,
			diagnosticsLabel: "storyboard_continuity_qc",
		},
	});
		const taskRaw = task?.raw as { text?: unknown } | undefined;
		const text = String(taskRaw?.text || "").trim();
	const parsed = extractJsonObjectFromText(text);
	if (!parsed) {
		throw new AppError("连续性QC失败：agents 输出不可解析", {
			status: 500,
			code: "storyboard_qc_parse_failed",
			details: {
				preview: truncateForLog(text, 1200),
			},
		});
	}
	const scoreRaw = Number((parsed as any).score);
	const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, Math.trunc(scoreRaw))) : 0;
	const passedRaw = (parsed as any).passed;
	const passed = typeof passedRaw === "boolean" ? passedRaw : score >= 70;
	const reason = String((parsed as any).reason || "").trim() || (passed ? "pass" : "failed");
	const rewriteHint = String((parsed as any).rewriteHint || "").trim();
	return { passed, score, reason, rewriteHint };
}

async function resolveStoryboardBookProgressState(input: {
	projectId: string;
	bookId: string;
	ownerId?: string;
}): Promise<StoryboardBookProgressState> {
	const indexPath = await resolveReadableBookIndexPath({
		projectId: input.projectId,
		bookId: input.bookId,
		ownerId: input.ownerId,
	});
	const indexData = (await readJsonFileSafe(indexPath)) || {};
	const assets = typeof indexData?.assets === "object" && indexData.assets ? indexData.assets : {};
	const plansRaw = Array.isArray(assets?.storyboardPlans) ? assets.storyboardPlans : [];
	const plans = plansRaw
		.map((item: any) => {
			const chapter = Number(item?.chapter || 0);
			const shotPrompts = Array.isArray(item?.shotPrompts)
				? item.shotPrompts.map((x: any) => String(x || "").trim()).filter(Boolean)
				: [];
			return {
				chapter: Number.isFinite(chapter) && chapter > 0 ? Math.trunc(chapter) : 0,
				shotPrompts,
			};
		})
		.filter((x: { chapter: number; shotPrompts: string[] }) => x.chapter > 0 && x.shotPrompts.length > 0)
		.sort((a: { chapter: number }, b: { chapter: number }) => a.chapter - b.chapter);

	const processRecords = await listStoryboardShotProcessRecords({
		projectId: input.projectId,
		bookId: input.bookId,
		ownerId: input.ownerId,
	});
	const shotSetByChapter = new Map<number, Set<number>>();
	const groupSizeByChapter = new Map<number, StoryboardGroupSize>();
	for (const rec of processRecords) {
		const chapter = Math.trunc(Number(rec.chapter || 0));
		const shotNo = Math.trunc(Number(rec.shotNo || 0));
		if (!chapter || !shotNo) continue;
		const existing = shotSetByChapter.get(chapter) || new Set<number>();
		existing.add(shotNo);
		shotSetByChapter.set(chapter, existing);
		if (!groupSizeByChapter.has(chapter)) {
			groupSizeByChapter.set(chapter, normalizeStoryboardGroupSize(rec.groupSize));
		}
	}

	const chapterList = Array.isArray(indexData?.chapters) ? indexData.chapters : [];
	const firstChapterFromIndex = chapterList
		.map((x: any) => Number(x?.chapter || 0))
		.filter((x: number) => Number.isFinite(x) && x > 0)
		.map((x: number) => Math.trunc(x))
		.sort((a: number, b: number) => a - b)[0] || 1;
	const completedShots = Math.max(0, processRecords.length);
	let totalShots: number | null = null;
	let progress01: number | null = null;
	let next: StoryboardBookProgressState["next"] | null = null;
	if (plans.length) {
		let knownTotalShots = 0;
		let knownCompletedShots = 0;
		const planTotalByChapter = new Map<number, number>();
		for (const plan of plans) planTotalByChapter.set(plan.chapter, plan.shotPrompts.length);
		for (const plan of plans) {
			const chapterTotal = plan.shotPrompts.length;
			const chapterShots = shotSetByChapter.get(plan.chapter) || new Set<number>();
			let chapterCompleted = 0;
			let chapterMissing: number | null = null;
			for (let shotNo = 1; shotNo <= chapterTotal; shotNo += 1) {
				if (chapterShots.has(shotNo)) chapterCompleted += 1;
				else if (chapterMissing === null) chapterMissing = shotNo;
			}
			knownTotalShots += chapterTotal;
			knownCompletedShots += chapterCompleted;
			if (!next && chapterMissing !== null) {
				const chapterGroupSize =
					groupSizeByChapter.get(plan.chapter) || STORYBOARD_DEFAULT_GROUP_SIZE;
				const chapterRangeEnd = Math.min(
					chapterTotal,
					chapterMissing + chapterGroupSize - 1,
				);
				next = {
					chapter: plan.chapter,
					nextShotStart: chapterMissing,
					nextShotEnd: chapterRangeEnd,
					groupSize: chapterGroupSize,
				};
			}
		}
		let totalReliable = true;
		for (const [chapter, shots] of shotSetByChapter.entries()) {
			const chapterTotal = planTotalByChapter.get(chapter);
			if (!chapterTotal) {
				totalReliable = false;
				break;
			}
			const maxShotNo = shots.size ? Math.max(...shots) : 0;
			if (maxShotNo > chapterTotal) {
				totalReliable = false;
				break;
			}
		}
		totalShots = totalReliable && knownTotalShots > 0 ? knownTotalShots : null;
		progress01 = totalShots && totalShots > 0
			? Math.max(0, Math.min(1, knownCompletedShots / totalShots))
			: null;
	}
	if (!next) {
		const knownChapters = chapterList
			.map((x: any) => Number(x?.chapter || 0))
			.filter((x: number) => Number.isFinite(x) && x > 0)
			.map((x: number) => Math.trunc(x))
			.sort((a: number, b: number) => a - b);
		const fallbackShotCap = readPositiveIntFromEnv(
			"STORYBOARD_FALLBACK_CHAPTER_SHOT_CAP",
			STORYBOARD_FALLBACK_CHAPTER_SHOT_CAP,
			25,
			5000,
		);
		const chapters = Array.from(shotSetByChapter.keys()).sort((a, b) => a - b);
		const fallbackChapter =
			chapters.length > 0 ? chapters[chapters.length - 1] : plans[0]?.chapter || firstChapterFromIndex;
		const fallbackGroupSize = groupSizeByChapter.get(fallbackChapter) || STORYBOARD_DEFAULT_GROUP_SIZE;

		if (!plans.length) {
			const currentShots = shotSetByChapter.get(fallbackChapter) || new Set<number>();
			const currentMaxShot = currentShots.size ? Math.max(...currentShots) : 0;
			const nextKnownChapter = knownChapters.find((ch: number) => ch > fallbackChapter) || null;
			const shouldAdvanceChapter = currentMaxShot >= fallbackShotCap && !!nextKnownChapter;
			const targetChapter = shouldAdvanceChapter ? Number(nextKnownChapter) : fallbackChapter;
			const targetShots = shotSetByChapter.get(targetChapter) || new Set<number>();
			let fallbackShot = 1;
			while (targetShots.has(fallbackShot)) fallbackShot += 1;
			next = {
				chapter: targetChapter,
				nextShotStart: fallbackShot,
				nextShotEnd: fallbackShot + fallbackGroupSize - 1,
				groupSize: fallbackGroupSize,
			};
		} else {
			const chapterShots = shotSetByChapter.get(fallbackChapter) || new Set<number>();
			let fallbackShot = 1;
			while (chapterShots.has(fallbackShot)) fallbackShot += 1;
			const fallbackPlanTotal = Math.max(
				0,
				Math.trunc(
							Number(
								plans.find((plan: { chapter: number; shotPrompts: string[] }) => Number(plan.chapter) === Number(fallbackChapter))?.shotPrompts.length || 0,
							),
				),
			);
			const fallbackRangeEnd = fallbackPlanTotal
				? Math.min(fallbackPlanTotal, fallbackShot + fallbackGroupSize - 1)
				: fallbackShot + fallbackGroupSize - 1;
			next = {
				chapter: fallbackChapter,
				nextShotStart: fallbackShot,
				nextShotEnd: fallbackRangeEnd,
				groupSize: fallbackGroupSize,
			};
		}
	}
	return {
		totalShots,
		completedShots,
		progress01,
		next: next!,
	};
}

async function resolveStoryboardChapterProgressSnapshot(input: {
	projectId: string;
	bookId: string;
	chapter: number;
	ownerId?: string;
	groupSize?: StoryboardGroupSize | null;
}): Promise<StoryboardChapterProgressSnapshot> {
	const normalizedGroupSize = normalizeStoryboardGroupSize(input.groupSize);
	const indexPath = await resolveReadableBookIndexPath({
		projectId: input.projectId,
		bookId: input.bookId,
		ownerId: input.ownerId,
	});
	const indexData = (await readJsonFileSafe(indexPath)) || {};
	const assets = typeof indexData?.assets === "object" && indexData.assets ? indexData.assets : {};
	const plansRaw = Array.isArray(assets?.storyboardPlans) ? assets.storyboardPlans : [];
	let totalShots: number | null = null;
	for (const item of plansRaw) {
		if (!item || typeof item !== "object") continue;
		const record = item as Record<string, unknown>;
		const chapter = Math.trunc(Number(record.chapter || 0));
		if (chapter !== input.chapter) continue;
		const shotPromptsRaw = Array.isArray(record.shotPrompts) ? record.shotPrompts : [];
		const shotPrompts = shotPromptsRaw
			.map((entry) => String(entry || "").trim())
			.filter(Boolean);
		totalShots = shotPrompts.length;
		break;
	}
	const processRecords = await listStoryboardShotProcessRecords({
		projectId: input.projectId,
		bookId: input.bookId,
		ownerId: input.ownerId,
	});
	const chapterShotSet = new Set<number>();
	let groupSize = normalizedGroupSize;
	for (const rec of processRecords) {
		const chapter = Math.trunc(Number(rec.chapter || 0));
		const shotNo = Math.trunc(Number(rec.shotNo || 0));
		if (chapter !== input.chapter || shotNo <= 0) continue;
		chapterShotSet.add(shotNo);
		groupSize = normalizeStoryboardGroupSize(rec.groupSize);
	}
	let nextShotStart: number | null = null;
	let nextShotEnd: number | null = null;
	if (totalShots !== null && totalShots > 0) {
		for (let shotNo = 1; shotNo <= totalShots; shotNo += 1) {
			if (chapterShotSet.has(shotNo)) continue;
			nextShotStart = shotNo;
			nextShotEnd = Math.min(totalShots, shotNo + groupSize - 1);
			break;
		}
	} else if (chapterShotSet.size > 0) {
		const maxShotNo = Math.max(...chapterShotSet);
		nextShotStart = maxShotNo + 1;
		nextShotEnd = nextShotStart + groupSize - 1;
	}
	return {
		chapter: input.chapter,
		totalShots,
		completedShots: chapterShotSet.size,
		nextShotStart,
		nextShotEnd,
		groupSize,
	};
}

async function writeStoryboardBookProgressState(input: {
	projectId: string;
	bookId: string;
	userId: string;
}): Promise<void> {
	const state = await resolveStoryboardBookProgressState({
		projectId: input.projectId,
		bookId: input.bookId,
		ownerId: input.userId,
	});
	const nowIso = new Date().toISOString();
	const payload = {
		version: 1,
		mode: "book_progressive",
		totalShots: state.totalShots,
		completedShots: state.completedShots,
		progress01: state.progress01,
		next: state.next,
		updatedAt: nowIso,
		updatedBy: input.userId,
	};
	const scoped = path.join(
		buildBookProcessRoot(input.projectId, input.bookId, input.userId),
		"index.json",
	);
	await writeJsonAtomic(scoped, payload);
	const legacy = path.join(
		buildBookProcessRoot(input.projectId, input.bookId),
		"index.json",
	);
	if (legacy !== scoped) {
		await writeJsonAtomic(legacy, payload);
	}
}

async function upsertStoryboardShotProcessRecord(input: {
	projectId: string;
	bookId: string;
	userId: string;
	record: StoryboardShotProcessRecord;
}): Promise<void> {
	const processPath = buildStoryboardShotProcessPath({
		projectId: input.projectId,
		bookId: input.bookId,
		shotNo: input.record.shotNo,
		ownerId: input.userId,
	});
	const existing = (await readJsonFileSafe(processPath)) as StoryboardShotProcessRecord | null;
	const nowIso = new Date().toISOString();
	const nextRecord: StoryboardShotProcessRecord = {
		...input.record,
		createdAt: existing?.createdAt || input.record.createdAt || nowIso,
		updatedAt: nowIso,
		updatedBy: input.userId,
	};
	await writeJsonAtomic(processPath, nextRecord);
	const legacyProcessPath = buildStoryboardShotProcessPath({
		projectId: input.projectId,
		bookId: input.bookId,
		shotNo: input.record.shotNo,
	});
	if (legacyProcessPath !== processPath) {
		await writeJsonAtomic(legacyProcessPath, nextRecord);
	}
}

async function upsertStoryboardChunkProcessRecord(input: {
	projectId: string;
	bookId: string;
	userId: string;
	record: StoryboardChunkProcessRecord;
}): Promise<void> {
	const processPath = buildStoryboardChunkProcessPath({
		projectId: input.projectId,
		bookId: input.bookId,
		chunkId: input.record.chunkId,
		ownerId: input.userId,
	});
	const existing = (await readJsonFileSafe(processPath)) as StoryboardChunkProcessRecord | null;
	const nowIso = new Date().toISOString();
	const nextRecord: StoryboardChunkProcessRecord = {
		...input.record,
		createdAt: existing?.createdAt || input.record.createdAt || nowIso,
		updatedAt: nowIso,
		updatedBy: input.userId,
	};
	await writeJsonAtomic(processPath, nextRecord);
	const legacyProcessPath = buildStoryboardChunkProcessPath({
		projectId: input.projectId,
		bookId: input.bookId,
		chunkId: input.record.chunkId,
	});
	if (legacyProcessPath !== processPath) {
		await writeJsonAtomic(legacyProcessPath, nextRecord);
	}
}

function buildGenerateMediaBootstrapBlock(input: {
	projectId: string;
	ownerId?: string;
	bookId: string;
	chapter: number;
	progress: ExecuteAgentPipelineRunRequestDto["progress"] | null | undefined;
	continuity?: {
		groupSize: StoryboardGroupSize;
		chunkIndex: number;
		prevTailFrameUrl?: string | null;
		prevTailRecovered?: boolean;
	} | null;
}): string {
	const projectDataRoot = buildProjectDataRoot(input.projectId, input.ownerId);
	const booksRoot = buildProjectBooksRoot(input.projectId, input.ownerId);
	const bookIndexPath = buildBookIndexPath(input.projectId, input.bookId, input.ownerId);
	const bookDir = path.dirname(bookIndexPath);
	const payload = {
		projectId: input.projectId,
		bookId: input.bookId,
		chapter: input.chapter,
		progress: input.progress || null,
		localPaths: {
			projectDataRoot,
			booksRoot,
			bookIndexPath,
			bookDir,
			bookRawPath: path.join(bookDir, "raw.md"),
			bookRawChunksDir: path.join(bookDir, "raw-chunks"),
		},
		readPolicy: {
			mode: "chunk_progressive",
			continueWhenInsufficient: true,
			requiredOrder: [
				"read index.json metadata first",
				"then read chapter-related raw-chunks incrementally",
				"fallback to raw.md section read only when chunk coverage is insufficient",
			],
			forbidden: ["stop at first insufficient evidence", "return missing-context failure before chunk traversal"],
		},
		continuity:
			input.continuity && Number.isFinite(input.continuity.chunkIndex)
				? {
						groupSize: input.continuity.groupSize,
						chunkIndex: input.continuity.chunkIndex,
						prevTailFrameUrl: input.continuity.prevTailFrameUrl || null,
						prevTailRecovered: Boolean(input.continuity.prevTailRecovered),
					}
				: null,
	};
	return JSON.stringify(payload, null, 2);
}

type PipelineContinuationContext = {
	groupSize: StoryboardGroupSize;
	chunkIndex: number;
	prevTailFrameUrl: string | null;
	prevTailRecovered: boolean;
};

function inferContinuationChunkIndex(input: {
	progress: ExecuteAgentPipelineRunRequestDto["progress"] | null | undefined;
	groupSize: StoryboardGroupSize;
}): number {
	const progress = input.progress || null;
	const fromShot =
		typeof progress?.nextShotStart === "number" && Number.isFinite(progress.nextShotStart)
			? Math.max(0, Math.floor((Math.max(1, Math.trunc(progress.nextShotStart)) - 1) / input.groupSize))
			: null;
	if (typeof fromShot === "number") return fromShot;
	if (typeof progress?.completedGroups === "number" && Number.isFinite(progress.completedGroups)) {
		return Math.max(0, Math.trunc(progress.completedGroups));
	}
	if (typeof progress?.completedShots === "number" && Number.isFinite(progress.completedShots)) {
		return Math.max(0, Math.floor(Math.max(0, Math.trunc(progress.completedShots)) / input.groupSize));
	}
	return 0;
}

async function resolvePipelineContinuationContext(input: {
	projectId: string;
	ownerId?: string;
	bookId: string;
	chapter: number;
	progress: ExecuteAgentPipelineRunRequestDto["progress"] | null | undefined;
}): Promise<PipelineContinuationContext | null> {
	const groupSize = normalizeStoryboardGroupSize(input.progress?.groupSize);
	const chunkIndex = inferContinuationChunkIndex({ progress: input.progress, groupSize });
	if (chunkIndex <= 0) {
		return {
			groupSize,
			chunkIndex,
			prevTailFrameUrl: null,
			prevTailRecovered: false,
		};
	}
	const { indexPath, chunks, indexData } = await readStoryboardChunksForBook(
		input.projectId,
		input.bookId,
		input.ownerId,
	);
	const prevChunk = chunks.find(
		(item) =>
			Number(item?.chapter) === Number(input.chapter) &&
			Number(item?.groupSize) === Number(groupSize) &&
			Number(item?.chunkIndex) === Number(chunkIndex) - 1,
	);
	if (!prevChunk) {
		return {
			groupSize,
			chunkIndex,
			prevTailFrameUrl: null,
			prevTailRecovered: false,
		};
	}
	const existingTail = typeof prevChunk.tailFrameUrl === "string" ? prevChunk.tailFrameUrl.trim() : "";
	if (existingTail) {
		return {
			groupSize,
			chunkIndex,
			prevTailFrameUrl: existingTail,
			prevTailRecovered: false,
		};
	}
	const frameUrls = Array.isArray(prevChunk.frameUrls)
		? prevChunk.frameUrls.map((x) => String(x || "").trim()).filter(Boolean)
		: [];
	const recoveredTail = frameUrls.length ? frameUrls[frameUrls.length - 1] : "";
	if (!recoveredTail) {
		return {
			groupSize,
			chunkIndex,
			prevTailFrameUrl: null,
			prevTailRecovered: false,
		};
	}
	const nextChunks = chunks.map((item) => {
		if (
			Number(item?.chapter) === Number(input.chapter) &&
			Number(item?.groupSize) === Number(groupSize) &&
			Number(item?.chunkIndex) === Number(chunkIndex) - 1
		) {
			return {
				...item,
				tailFrameUrl: recoveredTail,
				updatedAt: new Date().toISOString(),
			} as StoryboardChunkRecord;
		}
		return item;
	});
	const nextIndex = {
		...indexData,
		assets: {
			...(indexData?.assets || {}),
			storyboardChunks: nextChunks,
		},
		updatedAt: new Date().toISOString(),
	};
	await writeJsonAtomic(indexPath, nextIndex);
	const legacyIndexPath = buildBookIndexPath(input.projectId, input.bookId);
	if (legacyIndexPath !== indexPath) {
		await writeJsonAtomic(legacyIndexPath, nextIndex);
	}
	return {
		groupSize,
		chunkIndex,
		prevTailFrameUrl: recoveredTail,
		prevTailRecovered: true,
	};
}

async function upsertStoryboardChunkForBook(input: {
	db: AppContext["env"]["DB"];
	projectId: string;
	bookId: string;
	record: StoryboardChunkRecord;
	semanticBindings?: StoryboardChunkSemanticBindings;
	userId: string;
}): Promise<void> {
	const { indexPath, chunks, indexData } = await readStoryboardChunksForBook(
		input.projectId,
		input.bookId,
		input.userId,
	);
	if (input.record.chunkIndex > 0) {
		const prevChunk = chunks.find(
			(item) =>
				Number(item?.chapter) === Number(input.record.chapter) &&
				Number(item?.groupSize) === Number(input.record.groupSize) &&
				Number(item?.chunkIndex) === Number(input.record.chunkIndex) - 1,
		);
		const prevTailFrameUrl = typeof prevChunk?.tailFrameUrl === "string" ? prevChunk.tailFrameUrl.trim() : "";
		if (!prevTailFrameUrl) {
			throw new AppError("未找到上一分组 tailFrameUrl，无法保证分镜连续性，请先生成上一组", {
				status: 400,
				code: "storyboard_prev_tail_missing",
			});
		}
		const expectedShotStart = Number(prevChunk?.shotEnd || 0) + 1;
		if (expectedShotStart > 1 && Number(input.record.shotStart) !== expectedShotStart) {
			throw new AppError(
				`shotStart must equal previous shotEnd + 1 (expected ${expectedShotStart}, got ${input.record.shotStart})`,
				{
					status: 400,
					code: "storyboard_shot_range_invalid",
				},
			);
		}
	}
	const nextChunks = [...chunks];
	const idx = nextChunks.findIndex((x) => String(x?.chunkId || "") === input.record.chunkId);
	const nowIso = new Date().toISOString();
	const nextRecord: StoryboardChunkRecord = {
		...input.record,
		updatedAt: nowIso,
		createdAt: idx >= 0 ? String(nextChunks[idx]?.createdAt || nowIso) : nowIso,
		updatedBy: input.userId,
		createdBy: idx >= 0 ? String(nextChunks[idx]?.createdBy || input.userId) : input.userId,
	};
	if (idx >= 0) nextChunks[idx] = nextRecord;
	else nextChunks.push(nextRecord);

	const existingSemanticAssets =
		indexData?.assets && Array.isArray(indexData.assets.semanticAssets)
			? [...indexData.assets.semanticAssets]
			: [];
	const semanticAssetMap = new Map<string, unknown>();
	for (const [assetIndex, asset] of existingSemanticAssets.entries()) {
		const semanticId =
			asset && typeof asset === "object" && !Array.isArray(asset) && typeof (asset as { semanticId?: unknown }).semanticId === "string"
				? String((asset as { semanticId?: string }).semanticId || "").trim()
				: "";
		semanticAssetMap.set(semanticId || `legacy:${String(assetIndex)}`, asset);
	}
	for (const asset of buildStoryboardChunkSemanticAssetRecords({
		record: nextRecord,
		userId: input.userId,
		semanticBindings: input.semanticBindings,
	})) {
		const semanticId =
			typeof asset.semanticId === "string" && asset.semanticId.trim()
				? asset.semanticId.trim()
				: `generated:${String(semanticAssetMap.size)}`;
		semanticAssetMap.set(semanticId, asset);
	}
	const nextIndex = {
		...indexData,
		assets: {
			...(indexData?.assets || {}),
			storyboardChunks: nextChunks,
			semanticAssets: Array.from(semanticAssetMap.values()).slice(-2000),
		},
		updatedAt: nowIso,
	};
	await writeJsonAtomic(indexPath, nextIndex);
	const legacyIndexPath = buildBookIndexPath(input.projectId, input.bookId);
	if (legacyIndexPath !== indexPath) {
		await writeJsonAtomic(legacyIndexPath, nextIndex);
	}
	await persistStoryboardChunkMemoryWithDb(input.db, {
		userId: input.userId,
		projectId: input.projectId,
		bookId: input.bookId,
		chapterId: String(input.record.chapter),
		chunkId: input.record.chunkId,
		sourceId: input.record.chunkId,
		groupSize: input.record.groupSize,
		chunkIndex: input.record.chunkIndex,
		shotStart: input.record.shotStart,
		shotEnd: input.record.shotEnd,
		tailFrameUrl: input.record.tailFrameUrl,
		frameUrls: input.record.frameUrls,
		roleCardRefIds: input.record.roleCardRefIds,
		scenePropRefId: input.record.scenePropRefId,
		scenePropRefLabel: input.record.scenePropRefLabel,
		spellFxRefId: input.record.spellFxRefId,
		spellFxRefLabel: input.record.spellFxRefLabel,
	});
}

async function runStoryboardWorkflowGenerate(
	c: AppContext,
	userId: string,
	input: StoryboardWorkflowGenerateRequestDto,
): Promise<{
	shots: Array<{ shotNo: number; prompt: string; imageUrl: string; vendor: string }>;
	compositeUrl: string | null;
	tailFrameUrl: string;
	binding: {
		roleReferences: Array<{ cardId: string; roleName: string; imageUrl: string }>;
		scenePropReference: { refId: string; label: string; imageUrl: string } | null;
		spellFxReference: { refId: string; label: string; imageUrl: string } | null;
	};
}> {
	const project = await getProjectForOwner(c.env.DB, input.projectId, userId);
	if (!project) {
		throw new AppError("Project not found", { status: 404, code: "project_not_found" });
	}
	const requestedModelAlias =
		String(input.modelKey || STORYBOARD_DEFAULT_IMAGE_MODEL_KEY).trim() ||
		STORYBOARD_DEFAULT_IMAGE_MODEL_KEY;
	const { prompts: normalizedShotPrompts } = normalizeStoryboardShotInputs(input.shots);
	await assertStoryboardChapterReady({
		projectId: input.projectId,
		ownerId: userId,
		bookId: input.bookId,
		chapter: input.chapter,
	});
	await ensureStoryboardReferenceAssets({
		c,
		userId,
		projectId: input.projectId,
		bookId: input.bookId,
		chapter: input.chapter,
		shotPrompts: normalizedShotPrompts,
		modelKey: requestedModelAlias,
		aspectRatio: input.aspectRatio || "16:9",
		vendorCandidates: Array.isArray(input.vendorCandidates) ? input.vendorCandidates : undefined,
		spellFxRefId: input.spellFxRefId,
	});

	const shotStart = input.chunkIndex * input.groupSize + 1;
	const chunkId = `ch${input.chapter}-g${input.groupSize}-i${input.chunkIndex}`;
	setTraceStage(c, "storyboard:workflow:begin", {
		projectId: input.projectId,
		bookId: input.bookId,
		chapter: input.chapter,
		chunkIndex: input.chunkIndex,
		groupSize: input.groupSize,
	});
	const shots: Array<{ shotNo: number; prompt: string; imageUrl: string; vendor: string }> = [];
	const { prompts: checkedShotPrompts } = validateStoryboardShotPrompts(normalizedShotPrompts);
	if (!normalizedShotPrompts.length) {
		throw new AppError("镜头生成失败：shots 为空", {
			status: 400,
			code: "storyboard_shot_prompt_empty",
		});
	}
	if (checkedShotPrompts.length !== input.groupSize) {
		throw new AppError(
			`镜头生成失败：shots 数量必须与 groupSize 一致（groupSize=${input.groupSize}, shots=${checkedShotPrompts.length})`,
			{
				status: 400,
				code: "storyboard_shot_prompt_count_mismatch",
			},
		);
	}
	if (!input.skipDiversityPrecheck && input.groupSize > 1 && checkedShotPrompts.length > 1) {
		const preflight = preflightKeyframeDiversity(checkedShotPrompts);
		if (!preflight.ok) {
			throw new AppError(
				`关键帧差异预检未通过：${preflight.violations
					.slice(0, 3)
					.map((x) => `${x.pair}(${x.reason})`)
					.join("；")}`,
				{
					status: 400,
					code: "storyboard_diversity_precheck_failed",
					details: {
						groupSize: input.groupSize,
						violations: preflight.violations,
						features: preflight.features,
					},
				},
			);
		}
	}
	const { chunks, indexData } = await readStoryboardChunksForBook(input.projectId, input.bookId, userId);
	const continuity = resolveStoryboardWorkflowContinuity({
		indexData,
		chunks,
		chapter: input.chapter,
		groupSize: input.groupSize,
		chunkIndex: input.chunkIndex,
		shotPrompts: checkedShotPrompts,
		scenePropRefId: input.scenePropRefId,
		spellFxRefId: input.spellFxRefId,
	});
	const continuityReferenceAdvisories: string[] = [];
	if (continuity.missingRequiredRoleNames.length) {
		continuityReferenceAdvisories.push(
			`角色参考未完全就绪：${continuity.missingRequiredRoleNames.join("、")}`,
		);
	}
	if (continuity.unconfirmedRequiredRoleNames.length) {
		continuityReferenceAdvisories.push(
			`章节存在未确认角色卡：${continuity.unconfirmedRequiredRoleNames.join("、")}`,
		);
	}
	if (!continuity.roleReferenceImages.length && continuity.persistentRequiredRoleNames.length > 0) {
		const message = !continuity.chapterRoleNames.length
			? "章节角色分析为空，未匹配到角色参考图"
			: "自动补齐后仍未匹配到当前章节适用角色参考图";
		continuityReferenceAdvisories.push(message);
	}
	if (!continuity.scenePropReference?.imageUrl && continuity.scenePropRequired) {
		if (continuity.hasUnconfirmedScenePropReference) {
			continuityReferenceAdvisories.push("场景/道具参考图存在未确认项");
		} else {
			continuityReferenceAdvisories.push("自动补齐后仍未匹配到当前章节的场景/道具参考图");
		}
	}
	const roleAnchorRequired =
		continuity.requiredRoleNames.length > 0 ||
		continuity.persistentRequiredRoleNames.length > 0;
	const hasSceneAnchor = Boolean(
		continuity.scenePropReference?.imageUrl || continuity.prevTailFrameUrl,
	);
	if (
		(roleAnchorRequired && !continuity.roleReferenceEntries.length) ||
		!hasSceneAnchor
	) {
		const minsetLabel = roleAnchorRequired ? "角色锚点 + 场景锚点" : "场景锚点";
		continuityReferenceAdvisories.push(`一致性锚点不足（建议至少有 1 个${minsetLabel}）`);
	}
	if (input.chunkIndex > 0 && !continuity.prevTailFrameUrl) {
		continuityReferenceAdvisories.push(
			"未找到上一分组 tailFrameUrl：非首组建议带参考继续生成，但本次不做强阻断",
		);
	}
	if (continuityReferenceAdvisories.length > 0) {
		setTraceStage(c, "storyboard:reference:advisory", {
			projectId: input.projectId,
			bookId: input.bookId,
			chapter: input.chapter,
			chunkIndex: input.chunkIndex,
			advisories: continuityReferenceAdvisories,
			roleAnchorRequired,
			roleAnchorCount: continuity.roleReferenceEntries.length,
			hasSceneAnchor,
			hasPrevTailFrame: Boolean(continuity.prevTailFrameUrl),
		});
	}
	const explicitCandidates =
		Array.isArray(input.vendorCandidates) && input.vendorCandidates.length
			? input.vendorCandidates
			: null;
	const referenceCompositeEnabled = input.referenceComposite?.enabled === true;
	const referenceCompositeWithLabels = input.referenceComposite?.includeLabels !== false;
	const referenceCompositeCellSize = clampInt(
		input.referenceComposite?.cellSize,
		256,
		2048,
		512,
	);
	const referenceCompositeDividerWidth = Math.max(
		0,
		Math.min(24, Number(input.referenceComposite?.dividerWidth || 4)),
	);
	const referenceCompositeDividerColor =
		String(input.referenceComposite?.dividerColor || "#ffffff").trim() || "#ffffff";
	const referenceCompositeCache = new Map<string, string>();
	const chunkAnchorRoleRefs = selectChunkAnchorRoleReferenceEntries(
		normalizedShotPrompts,
		continuity.roleReferenceEntries,
		2,
	);
	let stickyVendor: string | null = null;
	const buildCandidates = (): string[] | undefined => {
		if (stickyVendor && explicitCandidates?.length) {
			const rest = explicitCandidates.filter(
				(v) => String(v || "").trim().toLowerCase() !== stickyVendor,
			);
			return [stickyVendor, ...rest];
		}
		if (stickyVendor) return [stickyVendor];
		return explicitCandidates || undefined;
	};
	if (input.groupSize === STORYBOARD_GRID_BATCH_SIZE) {
		const rawReferenceItems: Array<{ url: string; label: string }> = [];
		if (continuity.prevTailFrameUrl) {
			rawReferenceItems.push({
				url: continuity.prevTailFrameUrl,
				label: "上一分组尾帧（连续性参考）",
			});
		}
		if (continuity.scenePropReference?.imageUrl) {
			rawReferenceItems.push({
				url: continuity.scenePropReference.imageUrl,
				label: `场景道具参考：${continuity.scenePropReference.label}`,
			});
		}
		if (continuity.spellFxReference?.imageUrl) {
			rawReferenceItems.push({
				url: continuity.spellFxReference.imageUrl,
				label: `法术特效参考：${continuity.spellFxReference.label}`,
			});
		}
		for (const anchorRef of chunkAnchorRoleRefs) {
			rawReferenceItems.push({
				url: anchorRef.imageUrl,
				label: `角色锚点：${anchorRef.roleName}`,
			});
		}
		for (const entry of continuity.roleReferenceEntries.slice(0, 4)) {
			rawReferenceItems.push({
				url: entry.imageUrl,
				label: `角色参考：${entry.roleName}`,
			});
		}
		const referenceItems = dedupeReferenceItems(rawReferenceItems, 6);
		let effectiveReferenceItems = referenceItems;
		let referenceImages = effectiveReferenceItems.map((x) => x.url);
		let referenceCompositeInjected = false;
		if (referenceCompositeEnabled && referenceItems.length >= 2) {
			const cacheKey = referenceItems
				.map((item) => `${item.url}@@${item.label}`)
				.join("||");
			let compositeRefUrl = referenceCompositeCache.get(cacheKey) || "";
			if (!compositeRefUrl) {
				const refGrid: 2 | 3 = referenceItems.length >= 5 ? 3 : 2;
				compositeRefUrl = await buildLocalStoryboardCompositeAndUpload({
					c,
					userId,
					imageUrls: referenceItems.map((item) => item.url),
					grid: refGrid,
					cellSize: referenceCompositeCellSize,
					dividerWidth: referenceCompositeDividerWidth,
					dividerColor: referenceCompositeDividerColor,
					labels: referenceCompositeWithLabels
						? referenceItems.map((item, idx) => `参考图${idx + 1} ${item.label}`)
						: undefined,
					prefix: "storyboard/workflow-reference",
				});
				if (compositeRefUrl) referenceCompositeCache.set(cacheKey, compositeRefUrl);
			}
			if (compositeRefUrl) {
				const tailRefItem = continuity.prevTailFrameUrl
					? { url: continuity.prevTailFrameUrl, label: "上一分组尾帧（必须承接）" }
					: null;
				effectiveReferenceItems = tailRefItem
					? [tailRefItem, { url: compositeRefUrl, label: "参考图拼图（含角色标注）" }]
					: [{ url: compositeRefUrl, label: "参考图拼图（含角色标注）" }];
				referenceImages = effectiveReferenceItems.map((item) => item.url);
				referenceCompositeInjected = true;
			}
		}
		const anchorCheckItems = referenceCompositeInjected ? referenceItems : effectiveReferenceItems;
		if (
			((roleAnchorRequired && !hasRoleReferenceAnchor(anchorCheckItems)) ||
				!hasSceneReferenceAnchor(anchorCheckItems))
		) {
			throw new AppError(`分组 ${chunkId} 缺少最小锚点集（角色+场景），已阻止出图`, {
				status: 400,
				code: "storyboard_anchor_minset_missing",
				details: {
					chunkId,
					roleAnchorRequired,
					references: effectiveReferenceItems,
					anchorCheckReferences: anchorCheckItems,
					referenceCompositeInjected,
				},
			});
		}

		const modelLabel = (() => {
			const normalized = String(requestedModelAlias || "").trim().toLowerCase();
			if (normalized.includes("banana")) return "NanoBananaPro";
			return String(requestedModelAlias || "NanoBananaPro").trim() || "NanoBananaPro";
		})();
		const styleSummary = String(
			[
				...((continuity.stylePromptPrefix || "").split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 6)),
				...(continuity.scenePropReference?.label ? [`场景基准:${continuity.scenePropReference.label}`] : []),
			]
				.join(" | ")
				.slice(0, 600),
		);
		const shotPayload = normalizedShotPrompts.map((prompt, idx) => ({
			shot_number: `分镜 ${idx + 1}`,
			prompt_text: stripUrlsFromShotPrompt(prompt, continuity.prevTailFrameUrl),
		}));
		const gridLayout = getStoryboardGridLayout(input.groupSize);
		const shotPayloadJson = JSON.stringify(
			{
				image_generation_model: modelLabel,
				grid_layout: gridLayout,
				grid_aspect_ratio: "16:9",
				global_watermark: { position: " ", size: "extremely small" },
				style_summary: styleSummary || "cinematic storyboard consistency",
				shots: shotPayload,
			},
			null,
			2,
		);
		const batchPrompt = [
			continuity.stylePromptPrefix,
			`目标：一次性生成 ${input.groupSize} 宫格分镜总图（${gridLayout}），不得拆分为多次调用。`,
			"输出要求：单张图片内从左到右、从上到下对应镜头顺序；每格画面保持角色一致并体现镜头差异。",
			STORYBOARD_NO_TEXT_OVERLAY_RULE,
			continuity.prevTailFrameUrl
				? "首格必须承接上一分组尾帧的角色状态与空间关系。"
				: "",
			continuity.scenePropReference?.label
				? `场景/道具基准：${continuity.scenePropReference.label}。`
				: "",
			continuity.spellFxReference?.label
				? `法术/特效基准：${continuity.spellFxReference.label}。`
				: "",
			referenceCompositeInjected
				? "参考图含拼图标签，请按标签锁定角色，不得漂移。"
				: effectiveReferenceItems.map((item, idx) => `参考图${idx + 1}：${item.label}`).join("；"),
			"以下为本批次镜头 JSON（必须完整覆盖并按顺序生成）：",
			shotPayloadJson,
		]
			.filter(Boolean)
			.join("\n\n");

		const taskReq: TaskRequestDto = {
			kind: "image_edit",
			prompt: batchPrompt,
			extras: {
				modelAlias: requestedModelAlias,
				aspectRatio: input.aspectRatio || "16:9",
				referenceImages,
			},
		};
		const generated = await runTaskWithVendorFallback(
			c,
			userId,
			taskReq,
			buildCandidates(),
		);
		const vendor = String(generated.vendor || "").trim();
		stickyVendor = vendor.toLowerCase() || stickyVendor;
		const result = generated.result as any;
		const imageUrl = extractImageUrlFromTaskResult(result);
		const taskId = String(result?.id || "").trim();
		if (!imageUrl) {
			const status = String(result?.status || "").trim() || "unknown";
			throw new AppError(
				`分组 ${chunkId} 生成失败：未返回图片（status=${status}, taskId=${taskId || "unknown"}, vendor=${vendor || "unknown"}）`,
				{
					status: 500,
					code: "storyboard_batch_no_image",
				},
			);
		}
		const shotImageUrls = await splitStoryboardGridAndUpload({
			c,
			userId,
			gridImageUrl: imageUrl,
			grid: 5,
			count: normalizedShotPrompts.length,
			prefix: "storyboard/workflow-grid-cell",
		});
		if (shotImageUrls.length !== normalizedShotPrompts.length) {
			throw new AppError(
				`宫格拆分失败：期望 ${normalizedShotPrompts.length} 张子帧，实际 ${shotImageUrls.length}`,
				{
					status: 500,
					code: "storyboard_grid_split_count_mismatch",
				},
			);
		}
		const shots = normalizedShotPrompts.map((shotPrompt, i) => ({
			shotNo: shotStart + i,
			prompt: shotPrompt,
			imageUrl: shotImageUrls[i],
			vendor,
		}));
		const chunkShotRecords: StoryboardShotProcessRecord[] = normalizedShotPrompts.map((shotPrompt, i) => {
			const shotNo = shotStart + i;
			const generatedCandidateId = buildStoryboardShotCandidateId(shotNo);
			const generatedAtIso = new Date().toISOString();
			const roleCardAnchors = Array.from(
				new Map(
					[
						...chunkAnchorRoleRefs.map((entry) => ({
							cardId: String(entry.cardId || "").trim(),
							roleName: String(entry.roleName || "").trim(),
							imageUrl: String(entry.imageUrl || "").trim(),
							source: "chunk_anchor" as const,
						})),
						...selectRoleReferenceEntriesForShot(shotPrompt, continuity.roleReferenceEntries, 4).map((entry) => ({
							cardId: String(entry.cardId || "").trim(),
							roleName: String(entry.roleName || "").trim(),
							imageUrl: String(entry.imageUrl || "").trim(),
							source: "shot_match" as const,
						})),
					]
						.filter((item) => item.imageUrl)
						.map((item) => [`${item.roleName}@@${item.imageUrl}`, item]),
				).values(),
			).slice(0, 12);
			return {
				version: 1,
				projectId: input.projectId,
				bookId: input.bookId,
				chapter: input.chapter,
				chunkId,
				chunkIndex: input.chunkIndex,
				groupSize: input.groupSize,
				shotNo,
				shotIndexInChunk: i,
				script: shotPrompt,
				imageUrl: shotImageUrls[i],
				selectedImageUrl: shotImageUrls[i],
				selectedCandidateId: generatedCandidateId,
				imageCandidates: [
					{
						candidateId: generatedCandidateId,
						imageUrl: shotImageUrls[i],
						source: "generated",
						selected: true,
						createdAt: generatedAtIso,
						createdBy: userId,
						vendor: String(vendor || "").trim() || undefined,
						taskId: String(taskId || "").trim() || undefined,
					},
				],
				selectionHistory: [
					{
						candidateId: generatedCandidateId,
						imageUrl: shotImageUrls[i],
						source: "generated",
						selectedAt: generatedAtIso,
						selectedBy: userId,
					},
				],
				references: effectiveReferenceItems.map((item) => ({
					label: String(item.label || "").trim(),
					url: String(item.url || "").trim(),
				})),
				roleCardAnchors,
				modelThinking: {
					modelKey: requestedModelAlias,
					promptForShot: batchPrompt,
					referenceRoleHint: referenceCompositeInjected
						? "参考图1为拼图总览（含角色标签），请优先按图内标签建立角色对应关系。"
						: effectiveReferenceItems.map((item, idx) => `参考图${idx + 1}：${item.label}`).join("；"),
					roleToRefHint: "",
					anchorRoleHint: "",
					referenceCompositeInjected,
				},
				generation: {
					vendor: String(vendor || "").trim(),
					taskId: String(taskId || "").trim(),
					attemptCount: 1,
					referenceImagesUsed: referenceImages.slice(0, 8),
					qc: {
						passed: true,
						score: 80,
						reason: "batch_grid_single_call",
						retryTriggered: false,
					},
				},
				worldEvolutionThinking: `${input.groupSize}宫格单调用模式：镜头${shotNo}由分组网格切分子帧并承接统一锚点。`,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				updatedBy: userId,
			};
		});
		await upsertStoryboardChunkProcessRecord({
			projectId: input.projectId,
			bookId: input.bookId,
			userId,
			record: {
				version: 1,
				projectId: input.projectId,
				bookId: input.bookId,
				chapter: input.chapter,
				chunkId,
				chunkIndex: input.chunkIndex,
				groupSize: input.groupSize,
				shotStart,
				shotEnd: shotStart + normalizedShotPrompts.length - 1,
				shots: chunkShotRecords,
				gridImageUrl: imageUrl,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				updatedBy: userId,
			},
		});
		const frameUrls = shots.map((x) => x.imageUrl);
		const tailFrameUrl = frameUrls[frameUrls.length - 1] || "";
		await upsertStoryboardChunkForBook({
			db: c.env.DB,
			projectId: input.projectId,
			bookId: input.bookId,
			userId,
			semanticBindings: {
				roleReferences: continuity.roleReferenceEntries,
				scenePropReference: continuity.scenePropReference,
				spellFxReference: continuity.spellFxReference,
			},
			record: {
				chunkId,
				chapter: input.chapter,
				groupSize: input.groupSize,
				chunkIndex: input.chunkIndex,
				shotStart,
				shotEnd: shotStart + normalizedShotPrompts.length - 1,
				prompt: normalizedShotPrompts.join("\n"),
				shotPrompts: normalizedShotPrompts,
				frameUrls,
				tailFrameUrl,
				roleCardRefIds: Array.from(
					new Set(
						continuity.roleReferenceEntries
							.map((entry) => String(entry.cardId || "").trim())
							.filter(Boolean),
					),
				).slice(0, 12),
				scenePropRefId: continuity.scenePropReference?.refId,
				scenePropRefLabel: continuity.scenePropReference?.label,
				spellFxRefId: continuity.spellFxReference?.refId,
				spellFxRefLabel: continuity.spellFxReference?.label,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			},
		});
		await writeStoryboardBookProgressState({
			projectId: input.projectId,
			bookId: input.bookId,
			userId,
		});
		return {
			shots,
			compositeUrl: imageUrl,
			tailFrameUrl,
			binding: {
				roleReferences: continuity.roleReferenceEntries,
				scenePropReference: continuity.scenePropReference,
				spellFxReference: continuity.spellFxReference,
			},
		};
	}
	for (let i = 0; i < normalizedShotPrompts.length; i += 1) {
		const shotPrompt = normalizedShotPrompts[i];
		const sanitizedShotPrompt = stripUrlsFromShotPrompt(shotPrompt, continuity.prevTailFrameUrl);
		const shotNo = shotStart + i;
		// Idempotent resume: if same shot already persisted with same script, reuse it.
		// eslint-disable-next-line no-await-in-loop
		const existingShotRecord = await readStoryboardShotProcessRecord({
			projectId: input.projectId,
			bookId: input.bookId,
			shotNo,
			ownerId: userId,
		});
		if (
			existingShotRecord &&
			String(existingShotRecord.chunkId || "").trim() === chunkId &&
			String(existingShotRecord.script || "").trim() === shotPrompt &&
			String(existingShotRecord.imageUrl || "").trim()
		) {
			shots.push({
				shotNo,
				prompt: shotPrompt,
				imageUrl: String(existingShotRecord.imageUrl || "").trim(),
				vendor: String(existingShotRecord?.generation?.vendor || "resume"),
			});
			continue;
		}
		const prevShotPrompt =
			i > 0 && typeof normalizedShotPrompts[i - 1] === "string"
				? stripUrlsFromShotPrompt(normalizedShotPrompts[i - 1], continuity.prevTailFrameUrl)
				: "";
		setTraceStage(c, "storyboard:workflow:shot:begin", {
			shotNo,
			shotIndex: i + 1,
			totalShots: normalizedShotPrompts.length,
		});
		const rawReferenceItems: Array<{ url: string; label: string }> = [];
		if (i === 0 && continuity.prevTailFrameUrl) {
			rawReferenceItems.push({
				url: continuity.prevTailFrameUrl,
				label: "上一分组尾帧（连续性参考）",
			});
		}
		if (continuity.scenePropReference?.imageUrl) {
			rawReferenceItems.push({
				url: continuity.scenePropReference.imageUrl,
				label: `场景道具参考：${continuity.scenePropReference.label}`,
			});
		}
		if (continuity.spellFxReference?.imageUrl) {
			rawReferenceItems.push({
				url: continuity.spellFxReference.imageUrl,
				label: `法术特效参考：${continuity.spellFxReference.label}`,
			});
		}
		for (const anchorRef of chunkAnchorRoleRefs) {
			rawReferenceItems.push({
				url: anchorRef.imageUrl,
				label: `角色锚点：${anchorRef.roleName}`,
			});
		}
		if (i > 0) {
			const prevShotFrameUrl = String(shots[shots.length - 1]?.imageUrl || "").trim();
			if (prevShotFrameUrl) {
				rawReferenceItems.push({
					url: prevShotFrameUrl,
					label: "上一镜头输出（同组连续性参考）",
				});
			}
		}
		const shotRoleRefs = selectRoleReferenceEntriesForShot(shotPrompt, continuity.roleReferenceEntries, 4);
		for (const entry of shotRoleRefs) {
			rawReferenceItems.push({
				url: entry.imageUrl,
				label: `角色参考：${entry.roleName}`,
			});
		}
		const referenceItems = dedupeReferenceItems(rawReferenceItems, 5);
		let effectiveReferenceItems = referenceItems;
		let referenceImages = effectiveReferenceItems.map((x) => x.url);
		let referenceCompositeInjected = false;
			if (referenceCompositeEnabled && referenceItems.length >= 2) {
			const cacheKey = referenceItems
				.map((item) => `${item.url}@@${item.label}`)
				.join("||");
			let compositeRefUrl = referenceCompositeCache.get(cacheKey) || "";
			if (!compositeRefUrl) {
				const refGrid: 2 | 3 = referenceItems.length >= 5 ? 3 : 2;
				// eslint-disable-next-line no-await-in-loop
				compositeRefUrl = await buildLocalStoryboardCompositeAndUpload({
					c,
					userId,
					imageUrls: referenceItems.map((item) => item.url),
					grid: refGrid,
					cellSize: referenceCompositeCellSize,
					dividerWidth: referenceCompositeDividerWidth,
					dividerColor: referenceCompositeDividerColor,
					labels: referenceCompositeWithLabels
						? referenceItems.map((item, idx) => `参考图${idx + 1} ${item.label}`)
						: undefined,
					prefix: "storyboard/workflow-reference",
				});
				if (compositeRefUrl) {
					referenceCompositeCache.set(cacheKey, compositeRefUrl);
				}
			}
				if (compositeRefUrl) {
					const tailRefItem =
						i === 0 && continuity.prevTailFrameUrl
							? { url: continuity.prevTailFrameUrl, label: "上一分组尾帧（必须承接）" }
							: null;
					// Hard cutover with explicit tail-frame preservation on first shot.
					effectiveReferenceItems = tailRefItem
						? [tailRefItem, { url: compositeRefUrl, label: "参考图拼图（含角色标注）" }]
						: [{ url: compositeRefUrl, label: "参考图拼图（含角色标注）" }];
					referenceImages = effectiveReferenceItems.map((item) => item.url);
					referenceCompositeInjected = true;
				}
			}
			const anchorCheckItems = referenceCompositeInjected ? referenceItems : effectiveReferenceItems;
			if (
				((roleAnchorRequired && !hasRoleReferenceAnchor(anchorCheckItems)) ||
					!hasSceneReferenceAnchor(anchorCheckItems))
			) {
				throw new AppError(`第 ${shotNo} 镜缺少最小锚点集（角色+场景），已阻止出图`, {
					status: 400,
					code: "storyboard_anchor_minset_missing",
					details: {
						shotNo,
						roleAnchorRequired,
						references: effectiveReferenceItems,
						anchorCheckReferences: anchorCheckItems,
						referenceCompositeInjected,
					},
				});
			}
		const referenceRoleHint = referenceCompositeInjected
			? "参考图1为拼图总览（含角色标签），请优先按图内标签建立角色对应关系。"
			: effectiveReferenceItems
			.map((item, idx) => `参考图${idx + 1}：${item.label}`)
			.join("；");
		const roleToRefHint = referenceCompositeInjected
			? Array.from(
				new Set(
					referenceItems
						.map((item) => {
							const label = String(item.label || "").trim();
							if (!label.startsWith("角色参考：")) return "";
							return label.replace("角色参考：", "").trim();
						})
						.filter(Boolean),
				),
			)
				.join("、")
			: effectiveReferenceItems
			.map((item, idx) => {
				const label = String(item.label || "").trim();
				if (!label.startsWith("角色参考：")) return "";
				const roleName = label.replace("角色参考：", "").trim();
				return roleName ? `${roleName}=参考图${idx + 1}` : "";
			})
				.filter(Boolean)
				.join("；");
		const anchorRoleHint = referenceCompositeInjected
			? Array.from(
				new Set(
					referenceItems
						.map((item) => {
							const label = String(item.label || "").trim();
							if (!label.startsWith("角色锚点：")) return "";
							return label.replace("角色锚点：", "").trim();
						})
						.filter(Boolean),
				),
			)
				.join("、")
			: effectiveReferenceItems
			.map((item, idx) => {
				const label = String(item.label || "").trim();
				if (!label.startsWith("角色锚点：")) return "";
				const roleName = label.replace("角色锚点：", "").trim();
				return roleName ? `${roleName}=参考图${idx + 1}` : "";
			})
			.filter(Boolean)
			.join("；");
		if (input.groupSize === 1 && shotNo > 1) {
			// eslint-disable-next-line no-await-in-loop
			const prevShotRecord = await readStoryboardShotProcessRecord({
				projectId: input.projectId,
				bookId: input.bookId,
				shotNo: shotNo - 1,
				ownerId: userId,
			});
			const prevScript = String(prevShotRecord?.script || "").trim();
			if (prevScript) {
				const changedCount = countKeyframeFeatureChanges(prevScript, shotPrompt);
				if (changedCount < 2) {
					throw new AppError(
						`第 ${shotNo} 镜与上一镜差异不足（动作/镜头类型/机位至少变化两项）`,
						{
							status: 400,
							code: "storyboard_single_diversity_precheck_failed",
							details: { shotNo, changedCount },
						},
					);
				}
			}
		}
			let promptForShot = [
				continuity.stylePromptPrefix,
			"目标：使用图中画风，将分镜流畅运行起来；保持角色外观、服装、光线与美术风格连续。",
			STORYBOARD_NO_TEXT_OVERLAY_RULE,
			continuity.scenePropReference?.label
				? `场景/道具基准：${continuity.scenePropReference.label}。镜头内空间布局、关键道具与时代质感需保持一致。`
				: "",
			continuity.spellFxReference?.label
				? `法术/特效基准：${continuity.spellFxReference.label}。特效形态、发光色谱、粒子方向与强度必须稳定延续。`
				: "",
			continuity.styleReferenceImages.length
				? "全局风格规则已注入：所有镜头必须保持相同美术体系、色调与材质表现。"
				: "",
			continuity.missingRequiredRoleNames.length
				? `警告：本镜头涉及角色缺少角色卡（${continuity.missingRequiredRoleNames.join("、")}），请基于剧情与全局风格规则保持角色一致性。`
				: "",
			referenceCompositeInjected
				? "参考图1为带标签拼图总览，请优先按拼图中的角色标注建立人物对应关系。"
				: "",
			i === 0 && continuity.prevTailFrameUrl
				? "镜头1必须与上一分组尾帧自然衔接，再推进当前镜头内容。"
				: "",
			i > 0
				? "请在镜头过渡中继承上一镜头角色外观与服装细节，避免同角色形象漂移。"
				: "",
			input.groupSize > 1 && i > 0
				? "同组去同质化硬约束：本镜必须与上一镜至少在以下三项中变化两项：主体动作、景别、机位/运动。禁止仅换词复述同一构图。"
				: "",
			input.groupSize > 1 && i > 0 && prevShotPrompt
				? `上一镜脚本（仅用于差异化对照，不可复制）：${prevShotPrompt}`
				: "",
			anchorRoleHint
				? referenceCompositeInjected
					? `分组固定角色锚点（均在参考图1拼图标签中）: ${anchorRoleHint}。所有镜头优先保持这些角色锚点不变。`
					: `分组固定角色锚点映射: ${anchorRoleHint}。所有镜头优先保持这些角色锚点不变。`
				: "",
			roleToRefHint
				? referenceCompositeInjected
					? `角色与参考图映射（均在参考图1拼图标签中）: ${roleToRefHint}`
					: `角色与参考图映射: ${roleToRefHint}`
				: "",
				referenceRoleHint
					? `参考图角色标注（中文）: ${referenceRoleHint}`
					: "",
				sanitizedShotPrompt,
			]
			.filter(Boolean)
			.join("\n\n");
		const maxAttempts = 2;
		let vendor = "";
		let imageUrl = "";
		let taskId = "";
		let attemptCount = 0;
		let qcPassed = true;
		let qcScore = 80;
		let qcReason = "not_checked";
		let qcRetryTriggered = false;
		for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
			attemptCount = attempt;
			const taskReq: TaskRequestDto = {
				kind: "image_edit",
				prompt: promptForShot,
				extras: {
					modelAlias: requestedModelAlias,
					aspectRatio: input.aspectRatio || "16:9",
					referenceImages,
				},
			};
			// eslint-disable-next-line no-await-in-loop
			const generated = await runTaskWithVendorFallback(
				c,
				userId,
				taskReq,
				buildCandidates(),
			);
			vendor = String(generated.vendor || "").trim();
			stickyVendor = vendor.toLowerCase() || stickyVendor;
			const result = generated.result as any;
			imageUrl = extractImageUrlFromTaskResult(result);
			taskId = String(result?.id || "").trim();
			if (!imageUrl) {
				const status = String(result?.status || "").trim() || "unknown";
				const normalizedStatus = status.toLowerCase();
				if (normalizedStatus === "queued" || normalizedStatus === "running") {
					throw new AppError(
						`第 ${shotStart + i} 镜生成超时：任务仍在${status}（taskId=${taskId || "unknown"}, vendor=${vendor || "unknown"}）`,
						{
							status: 504,
							code: "storyboard_shot_poll_timeout",
							details: { shotNo: shotStart + i, taskId, vendor, status },
						},
					);
				}
				throw new AppError(
					`第 ${shotStart + i} 镜生成失败：未返回图片（status=${status}, taskId=${taskId || "unknown"}, vendor=${vendor || "unknown"}）`,
					{
						status: 500,
						code: "storyboard_shot_no_image",
					},
				);
			}
			const prevShotForQc = shotNo > 1
				? // eslint-disable-next-line no-await-in-loop
					await readStoryboardShotProcessRecord({
						projectId: input.projectId,
						bookId: input.bookId,
						shotNo: shotNo - 1,
						ownerId: userId,
					})
				: null;
			const prevScriptForQc = String(prevShotForQc?.script || "").trim();
			const prevImageForQc = String(prevShotForQc?.imageUrl || "").trim();
			if (!prevScriptForQc || !prevImageForQc) {
				qcPassed = true;
				qcScore = 80;
				qcReason = "no_prev_shot_for_qc";
				break;
			}
			const qc = await evaluateShotContinuityQCByAgents({
				c,
				userId,
				projectId: input.projectId,
				bookId: input.bookId,
				shotNo,
				prevScript: prevScriptForQc,
				currentScript: shotPrompt,
				prevImageUrl: prevImageForQc,
				currentImageUrl: imageUrl,
				roleAnchors: Array.from(
					new Set(
						effectiveReferenceItems
							.map((item) => String(item.label || "").trim())
							.filter((label) => label.startsWith("角色锚点：") || label.startsWith("角色参考："))
							.map((label) => label.replace(/^角色锚点：|^角色参考：/, "").trim())
							.filter(Boolean),
					),
				),
			});
			qcPassed = qc.passed;
			qcScore = qc.score;
			qcReason = qc.reason;
			if (qc.passed || attempt >= maxAttempts) break;
			qcRetryTriggered = true;
			promptForShot = [
				promptForShot,
				"",
				"【QC重试修正指令】",
				`上一次生成未通过连续性QC（score=${qc.score}, reason=${qc.reason}）。`,
				qc.rewriteHint ? `修正建议：${qc.rewriteHint}` : "修正建议：保持角色特征不漂移，并与上一镜做明确构图差异。",
				STORYBOARD_NO_TEXT_OVERLAY_RULE,
			]
				.filter(Boolean)
				.join("\n");
		}
		if (!imageUrl) {
			throw new AppError(`第 ${shotNo} 镜生成失败：未得到有效图像`, {
				status: 500,
				code: "storyboard_shot_no_image",
			});
		}
		setTraceStage(c, "storyboard:workflow:shot:done", {
			shotNo,
			shotIndex: i + 1,
			totalShots: normalizedShotPrompts.length,
			vendor,
		});
		shots.push({
			shotNo,
			prompt: shotPrompt,
			imageUrl,
			vendor,
		});
		const roleCardAnchors = Array.from(
			new Map(
				[
					...chunkAnchorRoleRefs.map((entry) => ({
						cardId: String(entry.cardId || "").trim(),
						roleName: String(entry.roleName || "").trim(),
						imageUrl: String(entry.imageUrl || "").trim(),
						source: "chunk_anchor" as const,
					})),
					...shotRoleRefs.map((entry) => ({
						cardId: String(entry.cardId || "").trim(),
						roleName: String(entry.roleName || "").trim(),
						imageUrl: String(entry.imageUrl || "").trim(),
						source: "shot_match" as const,
					})),
				]
					.filter((item) => item.imageUrl)
					.map((item) => [`${item.roleName}@@${item.imageUrl}`, item]),
			).values(),
		).slice(0, 12);
		const worldEvolutionThinking = [
			i === 0 && continuity.prevTailFrameUrl
				? `先承接上一分组尾帧，再推进到镜头${shotNo}的新动作与构图。`
				: `镜头${shotNo}在当前分组内延续上一镜头的角色与光影，并加入新的动作变化。`,
			continuity.scenePropReference?.label
				? `场景/道具继续锁定为「${continuity.scenePropReference.label}」，仅允许剧情驱动的状态变化。`
				: "",
			continuity.spellFxReference?.label
				? `法术/特效延续「${continuity.spellFxReference.label}」视觉语法，保持能量形态连续。`
				: "",
			roleCardAnchors.length
				? `角色锚点保持：${roleCardAnchors.map((x) => x.roleName).filter(Boolean).join("、")}。`
				: "本镜头无明确角色锚点，按剧情与风格约束保持一致性。",
		]
			.filter(Boolean)
			.join(" ");
		const generatedCandidateId = buildStoryboardShotCandidateId(shotNo);
		const generatedAtIso = new Date().toISOString();
		// eslint-disable-next-line no-await-in-loop
		await upsertStoryboardShotProcessRecord({
			projectId: input.projectId,
			bookId: input.bookId,
			userId,
			record: {
				version: 1,
				projectId: input.projectId,
				bookId: input.bookId,
				chapter: input.chapter,
				chunkId,
				chunkIndex: input.chunkIndex,
				groupSize: input.groupSize,
				shotNo,
				shotIndexInChunk: i,
				script: shotPrompt,
				imageUrl,
				selectedImageUrl: imageUrl,
				selectedCandidateId: generatedCandidateId,
				imageCandidates: [
					{
						candidateId: generatedCandidateId,
						imageUrl,
						source: "generated",
						selected: true,
						createdAt: generatedAtIso,
						createdBy: userId,
						vendor: String(vendor || "").trim() || undefined,
						taskId: String(taskId || "").trim() || undefined,
					},
				],
				selectionHistory: [
					{
						candidateId: generatedCandidateId,
						imageUrl,
						source: "generated",
						selectedAt: generatedAtIso,
						selectedBy: userId,
					},
				],
				references: effectiveReferenceItems.map((item) => ({
					label: String(item.label || "").trim(),
					url: String(item.url || "").trim(),
				})),
				roleCardAnchors,
				modelThinking: {
					modelKey: requestedModelAlias,
					promptForShot,
					referenceRoleHint,
					roleToRefHint,
					anchorRoleHint,
					referenceCompositeInjected,
				},
				generation: {
					vendor: String(vendor || "").trim(),
					taskId: String(taskId || "").trim(),
					attemptCount,
					referenceImagesUsed: referenceImages.slice(0, 8),
					qc: {
						passed: qcPassed,
						score: qcScore,
						reason: qcReason,
						retryTriggered: qcRetryTriggered,
					},
				},
				worldEvolutionThinking,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				updatedBy: userId,
			},
		});
	}
	if (shots.length !== normalizedShotPrompts.length) {
		throw new AppError(
			`分镜生成数量异常：输入 ${normalizedShotPrompts.length} 镜，实际输出 ${shots.length} 镜`,
			{
				status: 500,
				code: "storyboard_shot_count_mismatch",
			},
		);
	}
	if (!shots.length) {
		throw new AppError("镜头生成失败：无可用输出", {
			status: 500,
			code: "storyboard_shot_empty",
		});
	}

	const frameUrls = shots.map((x) => x.imageUrl);
	let compositeUrl: string | null = null;
	const compositeEnabled = input.composite?.enabled === true;
	if (compositeEnabled && frameUrls.length >= 2) {
		const grid: 2 | 3 = input.groupSize === 9 ? 3 : 2;
		const cellSize = clampInt(input.composite?.cellSize, 256, 2048, 640);
		const dividerWidth = Math.max(0, Math.min(24, Number(input.composite?.dividerWidth || 4)));
		const dividerColor = String(input.composite?.dividerColor || "#ffffff").trim() || "#ffffff";
		compositeUrl = await buildLocalStoryboardCompositeAndUpload({
			c,
			userId,
			imageUrls: frameUrls.slice(0, 9),
			grid,
			cellSize,
			dividerWidth,
			dividerColor,
			prefix: "storyboard/workflow-composite",
		});
	}

	await upsertStoryboardChunkForBook({
		db: c.env.DB,
		projectId: input.projectId,
		bookId: input.bookId,
		userId,
		semanticBindings: {
			roleReferences: continuity.roleReferenceEntries,
			scenePropReference: continuity.scenePropReference,
			spellFxReference: continuity.spellFxReference,
		},
		record: {
			chunkId,
			chapter: input.chapter,
			groupSize: input.groupSize,
			chunkIndex: input.chunkIndex,
			shotStart,
			shotEnd: shotStart + normalizedShotPrompts.length - 1,
			prompt: normalizedShotPrompts.join("\n"),
			shotPrompts: normalizedShotPrompts,
			frameUrls,
			tailFrameUrl: frameUrls[frameUrls.length - 1] || "",
			roleCardRefIds: Array.from(
				new Set(
					continuity.roleReferenceEntries
						.map((entry) => String(entry.cardId || "").trim())
						.filter(Boolean),
				),
			).slice(0, 12),
			scenePropRefId: continuity.scenePropReference?.refId,
			scenePropRefLabel: continuity.scenePropReference?.label,
			spellFxRefId: continuity.spellFxReference?.refId,
			spellFxRefLabel: continuity.spellFxReference?.label,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		},
	});
	await writeStoryboardBookProgressState({
		projectId: input.projectId,
		bookId: input.bookId,
		userId,
	});

	return {
		shots,
		compositeUrl,
		tailFrameUrl: frameUrls[frameUrls.length - 1] || "",
		binding: {
			roleReferences: continuity.roleReferenceEntries,
			scenePropReference: continuity.scenePropReference,
			spellFxReference: continuity.spellFxReference,
		},
	};
}

async function runStoryboardWorkflowShotEdit(
	c: AppContext,
	userId: string,
	input: StoryboardWorkflowShotEditRequestDto,
): Promise<{ shotIndex: number; imageUrl: string; tailFrameUrl: string | null }> {
	const project = await getProjectForOwner(c.env.DB, input.projectId, userId);
	if (!project) {
		throw new AppError("Project not found", { status: 404, code: "project_not_found" });
	}
	const chunkId = `ch${input.chapter}-g${input.groupSize}-i${input.chunkIndex}`;
	const { chunks, indexData } = await readStoryboardChunksForBook(input.projectId, input.bookId, userId);
	const target = chunks.find((x) => String(x?.chunkId || "") === chunkId);
	const frameUrls = Array.isArray(target?.frameUrls) ? [...target.frameUrls] : [];
	const shotPrompts = Array.isArray(target?.shotPrompts) ? target.shotPrompts : [];
	const continuity = target
		? resolveStoryboardWorkflowContinuity({
				indexData,
				chunks,
				chapter: input.chapter,
				groupSize: input.groupSize,
				chunkIndex: input.chunkIndex,
				shotPrompts,
				scenePropRefId: target.scenePropRefId,
				spellFxRefId: target.spellFxRefId,
			})
		: null;
	const currentShotPrompt =
		typeof shotPrompts[input.shotIndex] === "string" ? String(shotPrompts[input.shotIndex]).trim() : "";
	const currentShotImageUrl =
		input.shotIndex >= 0 && input.shotIndex < frameUrls.length
			? String(frameUrls[input.shotIndex] || "").trim() || null
			: null;
	const normalizedReferenceImages = normalizeUrlList(
		[currentShotImageUrl, ...input.referenceImages],
		8,
	);

	await ensureProjectWorkspaceContextFiles({
		c,
		ownerId: userId,
		projectId: input.projectId,
		bookId: input.bookId,
		chapter: input.chapter,
	});
	setTraceStage(c, "storyboard:workflow:shot-edit:diagnosis:begin", {
		projectId: input.projectId,
		bookId: input.bookId,
		chapter: input.chapter,
		chunkIndex: input.chunkIndex,
		shotIndex: input.shotIndex,
	});
	const diagnosisTask = await runAgentsBridgeChatTask(c, userId, {
		kind: "chat",
		prompt: buildStoryboardShotEditDiagnosisPrompt({
			chapter: input.chapter,
			shotIndex: input.shotIndex,
			userPrompt: input.prompt,
			shotPrompt: currentShotPrompt,
			currentImageUrl: currentShotImageUrl,
			referenceImages: normalizedReferenceImages,
		}),
		extras: {
			privilegedLocalAccess: true,
			localResourcePaths: [buildProjectDataRoot(input.projectId, userId)],
			referenceImages: normalizedReferenceImages.slice(0, 3),
			bridgeTimeoutMs: 240_000,
			modelKey: resolveStoryboardGovernanceModelKey(),
		},
	});
	const diagnosisText = typeof (diagnosisTask as any)?.raw?.text === "string"
		? String((diagnosisTask as any).raw.text).trim()
		: "";
	const diagnosis = parseStoryboardShotEditDiagnosis(diagnosisText);
	if (!diagnosis) {
		throw new AppError("镜头修复失败：agents-cli 图像诊断输出不可解析", {
			status: 500,
			code: "storyboard_shot_edit_diagnosis_invalid",
			details: {
				preview: truncateForLog(diagnosisText, 1200),
			},
		});
	}

	setTraceStage(c, "storyboard:workflow:shot-edit:render:begin", {
		projectId: input.projectId,
		bookId: input.bookId,
		chapter: input.chapter,
		chunkIndex: input.chunkIndex,
		shotIndex: input.shotIndex,
		diagnosisIssueCount: diagnosis.issues.length,
	});
	const req: TaskRequestDto = {
		kind: "image_edit",
		prompt: buildStoryboardShotEditFinalPrompt({
			userPrompt: input.prompt,
			diagnosis,
		}),
		extras: {
			modelAlias:
				String(input.modelKey || STORYBOARD_DEFAULT_IMAGE_MODEL_KEY).trim() ||
				STORYBOARD_DEFAULT_IMAGE_MODEL_KEY,
			aspectRatio: input.aspectRatio || "16:9",
			referenceImages: normalizedReferenceImages,
		},
	};
	const { result } = await runTaskWithVendorFallback(c, userId, req, input.vendorCandidates);
	const imageUrl = extractImageUrlFromTaskResult(result);
	if (!imageUrl) {
		throw new AppError("镜头编辑失败：未返回图片", {
			status: 500,
			code: "storyboard_shot_edit_no_image",
		});
	}

	if (!target) {
		return { shotIndex: input.shotIndex, imageUrl, tailFrameUrl: null };
	}
	const shotNo = Number.isFinite(Number(target.shotStart))
		? Math.max(1, Math.trunc(Number(target.shotStart)) + Math.max(0, Math.trunc(input.shotIndex)))
		: 0;
	if (shotNo > 0) {
		const shotProcess = await readStoryboardShotProcessRecord({
			projectId: input.projectId,
			bookId: input.bookId,
			shotNo,
			ownerId: userId,
		});
		if (shotProcess) {
			const nowIso = new Date().toISOString();
			const candidates = normalizeStoryboardShotImageCandidates(shotProcess.imageCandidates);
			const nextCandidates = candidates.map((item) => ({ ...item, selected: false }));
			const existing = nextCandidates.find((item) => item.imageUrl === imageUrl) || null;
			const selectedCandidateId = existing
				? existing.candidateId
				: buildStoryboardShotCandidateId(shotNo);
			if (existing) {
				existing.selected = true;
			} else {
				nextCandidates.push({
					candidateId: selectedCandidateId,
					imageUrl,
					source: "edited",
					selected: true,
					createdAt: nowIso,
					createdBy: userId,
				});
			}
			const nextHistory = [
				...normalizeStoryboardShotSelectionHistory(shotProcess.selectionHistory),
				{
					candidateId: selectedCandidateId,
					imageUrl,
					source: "edited" as const,
					selectedAt: nowIso,
					selectedBy: userId,
				},
			].slice(-500);
			await upsertStoryboardShotProcessRecord({
				projectId: input.projectId,
				bookId: input.bookId,
				userId,
				record: {
					...shotProcess,
					imageUrl,
					selectedImageUrl: imageUrl,
					selectedCandidateId,
					imageCandidates: nextCandidates.slice(0, 200),
					selectionHistory: nextHistory,
				},
			});
		}
	}
	if (input.shotIndex >= 0 && input.shotIndex < frameUrls.length) {
		frameUrls[input.shotIndex] = imageUrl;
	}
	const tailFrameUrl = frameUrls.length ? frameUrls[frameUrls.length - 1] : null;
	await upsertStoryboardChunkForBook({
		db: c.env.DB,
		projectId: input.projectId,
		bookId: input.bookId,
		userId,
		...(continuity
			? {
					semanticBindings: {
						roleReferences: continuity.roleReferenceEntries,
						scenePropReference: continuity.scenePropReference,
						spellFxReference: continuity.spellFxReference,
					},
				}
			: null),
		record: {
			...target,
			frameUrls,
			tailFrameUrl: tailFrameUrl || "",
		},
	});
	return { shotIndex: input.shotIndex, imageUrl, tailFrameUrl };
}

async function runStoryboardWorkflowShotSelectCandidate(
	c: AppContext,
	userId: string,
	input: StoryboardWorkflowShotSelectCandidateRequestDto,
): Promise<{ shotIndex: number; imageUrl: string; tailFrameUrl: string | null }> {
	const project = await getProjectForOwner(c.env.DB, input.projectId, userId);
	if (!project) {
		throw new AppError("Project not found", { status: 404, code: "project_not_found" });
	}
	const chunkId = `ch${input.chapter}-g${input.groupSize}-i${input.chunkIndex}`;
	const { chunks, indexData } = await readStoryboardChunksForBook(input.projectId, input.bookId, userId);
	const target = chunks.find((x) => String(x?.chunkId || "") === chunkId);
	if (!target) {
		throw new AppError("Storyboard chunk not found", {
			status: 404,
			code: "storyboard_chunk_not_found",
		});
	}
	const continuity = resolveStoryboardWorkflowContinuity({
		indexData,
		chunks,
		chapter: input.chapter,
		groupSize: input.groupSize,
		chunkIndex: input.chunkIndex,
		shotPrompts: Array.isArray(target.shotPrompts) ? target.shotPrompts : [],
		scenePropRefId: target.scenePropRefId,
		spellFxRefId: target.spellFxRefId,
	});
	const shotNo = Number.isFinite(Number(target.shotStart))
		? Math.max(1, Math.trunc(Number(target.shotStart)) + Math.max(0, Math.trunc(input.shotIndex)))
		: 0;
	if (!shotNo) {
		throw new AppError("Invalid shot index", {
			status: 400,
			code: "storyboard_shot_index_invalid",
		});
	}
	const shotProcess = await readStoryboardShotProcessRecord({
		projectId: input.projectId,
		bookId: input.bookId,
		shotNo,
		ownerId: userId,
	});
	if (!shotProcess) {
		throw new AppError("Storyboard shot process not found", {
			status: 404,
			code: "storyboard_shot_not_found",
		});
	}
	const candidates = normalizeStoryboardShotImageCandidates(shotProcess.imageCandidates);
	if (!candidates.length) {
		throw new AppError("No shot candidates to select", {
			status: 400,
			code: "storyboard_shot_candidates_empty",
		});
	}
	const selectedById = input.candidateId
		? candidates.find((item) => item.candidateId === input.candidateId)
		: null;
	const normalizedImageUrl = String(input.imageUrl || "").trim();
	const selectedByUrl = normalizedImageUrl
		? candidates.find((item) => item.imageUrl === normalizedImageUrl)
		: null;
	const selected = selectedById || selectedByUrl || null;
	if (!selected) {
		throw new AppError("Candidate not found in shot candidates", {
			status: 400,
			code: "storyboard_candidate_not_found",
		});
	}
	const selectedImageUrl = String(selected.imageUrl || "").trim();
	if (!selectedImageUrl) {
		throw new AppError("Selected candidate has empty imageUrl", {
			status: 400,
			code: "storyboard_candidate_invalid",
		});
	}
	const nowIso = new Date().toISOString();
	const nextCandidates = candidates
		.map((item) => ({ ...item, selected: item.candidateId === selected.candidateId }))
		.slice(0, 200);
	const nextHistory = [
		...normalizeStoryboardShotSelectionHistory(shotProcess.selectionHistory),
		{
			candidateId: selected.candidateId,
			imageUrl: selectedImageUrl,
			source: selected.source,
			selectedAt: nowIso,
			selectedBy: userId,
		},
	].slice(-500);
	await upsertStoryboardShotProcessRecord({
		projectId: input.projectId,
		bookId: input.bookId,
		userId,
		record: {
			...shotProcess,
			imageUrl: selectedImageUrl,
			selectedImageUrl: selectedImageUrl,
			selectedCandidateId: selected.candidateId,
			imageCandidates: nextCandidates,
			selectionHistory: nextHistory,
		},
	});
	const frameUrls = Array.isArray(target.frameUrls) ? [...target.frameUrls] : [];
	if (input.shotIndex >= 0 && input.shotIndex < frameUrls.length) {
		frameUrls[input.shotIndex] = selectedImageUrl;
	}
	const tailFrameUrl = frameUrls.length ? frameUrls[frameUrls.length - 1] : null;
	await upsertStoryboardChunkForBook({
		db: c.env.DB,
		projectId: input.projectId,
		bookId: input.bookId,
		userId,
		semanticBindings: {
			roleReferences: continuity.roleReferenceEntries,
			scenePropReference: continuity.scenePropReference,
			spellFxReference: continuity.spellFxReference,
		},
		record: {
			...target,
			frameUrls,
			tailFrameUrl: tailFrameUrl || "",
		},
	});
	return { shotIndex: input.shotIndex, imageUrl: selectedImageUrl, tailFrameUrl };
}

async function mergeStoryboardWorkflow(
	c: AppContext,
	userId: string,
	input: StoryboardWorkflowMergeRequestDto,
): Promise<{ compositeUrl: string; frameCount: number }> {
	const project = await getProjectForOwner(c.env.DB, input.projectId, userId);
	if (!project) {
		throw new AppError("Project not found", { status: 404, code: "project_not_found" });
	}
	const frameUrls = Array.from(
		new Set(input.frameUrls.map((x) => String(x || "").trim()).filter(Boolean)),
	).slice(0, 16);
	if (frameUrls.length < 2) {
		throw new AppError("合并分镜至少需要 2 张图片", {
			status: 400,
			code: "storyboard_merge_insufficient_frames",
		});
	}
	const grid: 2 | 3 = frameUrls.length > 4 ? 3 : 2;
	const cellSize = clampInt(input.cellSize, 256, 2048, 640);
	const dividerWidth = Math.max(0, Math.min(24, Number(input.dividerWidth || 4)));
	const dividerColor = String(input.dividerColor || "#ffffff").trim() || "#ffffff";
	const compositeUrl = await buildLocalStoryboardCompositeAndUpload({
		c,
		userId,
		imageUrls: frameUrls.slice(0, 9),
		grid,
		cellSize,
		dividerWidth,
		dividerColor,
		prefix: "storyboard/merge-composite",
	});
	return { compositeUrl, frameCount: frameUrls.length };
}

export async function executeUserAgentPipelineRun(
	c: AppContext,
	userId: string,
	id: string,
	input?: ExecuteAgentPipelineRunRequestDto,
): Promise<AgentPipelineRunDto> {
	const run = await getAgentPipelineRunRowById(c.env.DB, { id, ownerId: userId });
	if (!run) {
		throw new AppError("Pipeline run not found", {
			status: 404,
			code: "pipeline_run_not_found",
		});
	}

	const force = input?.force === true;
	if (!force && (run.status === "running" || run.status === "succeeded")) {
		throw new AppError("Pipeline run already in progress/completed", {
			status: 409,
			code: "pipeline_run_conflict",
		});
	}

	const project = await getProjectForOwner(c.env.DB, run.project_id, userId);
	if (!project) {
		throw new AppError("Project not found", {
			status: 400,
			code: "project_not_found",
		});
	}

	const nowIso = new Date().toISOString();
	const skipMediaGeneration = input?.skipMediaGeneration === true;
	const runLogs: string[] = [];
	const runLogDir = path.join(
		buildProjectAgentRunsRoot(run.project_id, userId),
		`${sanitizePathSegment(id)}-${Date.now()}`,
	);
	const runLogFile = path.join(runLogDir, "run.log");
	let logWriteQueue: Promise<void> = Promise.resolve();
	const writeLocalLog = (entry: string) => {
		logWriteQueue = logWriteQueue
			.then(async () => {
				await fs.mkdir(runLogDir, { recursive: true });
				await fs.appendFile(runLogFile, `${entry}\n`, "utf8");
			})
			.catch(() => {
				// noop: keep runtime resilient even when local log write fails
			});
	};
	const appendRunLog = (line: string) => {
		const ts = new Date().toISOString();
		const entry = `[${ts}] ${line}`;
		runLogs.push(entry);
		// eslint-disable-next-line no-console
		console.log(`[agents-run:${id}] ${entry}`);
		writeLocalLog(entry);
	};
	try {
		await fs.mkdir(runLogDir, { recursive: true });
		await fs.writeFile(runLogFile, "", "utf8");
	} catch {
		// ignore local log init failure; runtime should continue
	}
	appendRunLog("pipeline execution started");
	appendRunLog(`runId=${id} projectId=${run.project_id}`);
	if (skipMediaGeneration) {
		appendRunLog("media generation skipped by request: storyboard script only mode");
	}
	await updateAgentPipelineRunRow(c.env.DB, {
		id,
		ownerId: userId,
		status: "running",
		progressJson: JSON.stringify({ stage: "storyboard_generation", percent: 10 }),
		errorMessage: null,
		startedAt: run.started_at || nowIso,
		finishedAt: null,
		nowIso,
	});

	try {
		const materialRows = await listAssetsForUser(c.env.DB, userId, {
			projectId: run.project_id,
			limit: 200,
		});
		const chapterFromGoal = inferChapterFromText(run.goal || "");
		const explicitChapterRequested =
			typeof input?.chapter === "number" && Number.isFinite(input.chapter) && input.chapter > 0;
		const explicitProgressProvided = !!input?.progress;
		let chapter =
			typeof input?.chapter === "number" && Number.isFinite(input.chapter) && input.chapter > 0
				? Math.trunc(input.chapter)
				: chapterFromGoal;
		let effectiveProgress: ExecuteAgentPipelineRunRequestDto["progress"] | null = input?.progress || null;
		let effectiveGroupSize = normalizeStoryboardGroupSize(effectiveProgress?.groupSize);
		if (input?.bookId) {
			const backendProgress = await resolveStoryboardBookProgressState({
				projectId: run.project_id,
				bookId: input.bookId,
				ownerId: userId,
			});
			if (!(typeof chapter === "number" && chapter > 0)) {
				chapter = backendProgress.next.chapter;
			}
			effectiveGroupSize = normalizeStoryboardGroupSize(
				effectiveProgress?.groupSize ?? backendProgress.next.groupSize,
			);
			if (explicitChapterRequested && !explicitProgressProvided && typeof chapter === "number" && chapter > 0) {
				const chapterProgress = await resolveStoryboardChapterProgressSnapshot({
					projectId: run.project_id,
					bookId: input.bookId,
					chapter,
					ownerId: userId,
					groupSize: effectiveGroupSize,
				});
				if (chapterProgress.completedShots > 0) {
					appendRunLog(
						`explicit chapter request blocked: chapter=${chapter} completedShots=${chapterProgress.completedShots} nextShot=${chapterProgress.nextShotStart ?? 1}`,
					);
					throw new AppError("当前章节已存在已生成分镜；本次请求未声明是续写还是从头重开，已阻止执行", {
						status: 409,
						code: "storyboard_chapter_progress_ambiguous",
						details: {
							chapter,
							completedShots: chapterProgress.completedShots,
							nextShotStart: chapterProgress.nextShotStart,
							nextShotEnd: chapterProgress.nextShotEnd,
							backendNextChapter: backendProgress.next.chapter,
							backendNextShotStart: backendProgress.next.nextShotStart,
						},
					});
				}
				const freshNextShotStart = 1;
				const freshNextShotEnd =
					typeof chapterProgress.totalShots === "number" && chapterProgress.totalShots > 0
						? Math.min(chapterProgress.totalShots, freshNextShotStart + effectiveGroupSize - 1)
						: freshNextShotStart + effectiveGroupSize - 1;
				effectiveProgress = {
					mode: "full",
					groupSize: effectiveGroupSize,
					...(typeof chapterProgress.totalShots === "number" && chapterProgress.totalShots > 0
						? {
								totalShots: chapterProgress.totalShots,
								totalGroups: Math.ceil(chapterProgress.totalShots / effectiveGroupSize),
							}
						: null),
					completedShots: 0,
					nextShotStart: freshNextShotStart,
					nextShotEnd: freshNextShotEnd,
					completedGroups: 0,
					existingStoryboardContent: input?.progress?.existingStoryboardContent,
				};
				appendRunLog(
					`explicit chapter request isolated from saved progress: chapter=${chapter} nextShot=${freshNextShotStart} groupSize=${effectiveGroupSize}`,
				);
			} else {
				effectiveProgress = {
					mode: effectiveProgress?.mode || "single",
					groupSize: effectiveGroupSize,
					...(typeof backendProgress.totalShots === "number" && backendProgress.totalShots > 0
						? {
								totalShots: backendProgress.totalShots,
								totalGroups: Math.ceil(backendProgress.totalShots / effectiveGroupSize),
							}
						: null),
					completedShots:
						typeof effectiveProgress?.completedShots === "number"
							? effectiveProgress.completedShots
							: backendProgress.completedShots,
					nextShotStart:
						typeof effectiveProgress?.nextShotStart === "number"
							? effectiveProgress.nextShotStart
							: backendProgress.next.nextShotStart,
					nextShotEnd:
						typeof effectiveProgress?.nextShotEnd === "number"
							? effectiveProgress.nextShotEnd
							: backendProgress.next.nextShotEnd,
					completedGroups:
						typeof effectiveProgress?.completedGroups === "number"
							? effectiveProgress.completedGroups
							: Math.floor(backendProgress.completedShots / effectiveGroupSize),
					existingStoryboardContent: input?.progress?.existingStoryboardContent,
				};
				appendRunLog(
					`backend progress merged: chapter=${chapter} nextShot=${effectiveProgress.nextShotStart ?? backendProgress.next.nextShotStart} groupSize=${effectiveGroupSize}`,
				);
			}
		}
		const materials = summarizeMaterials(materialRows, { chapter: chapter || null });
		const bookChapter = await resolveBookChapterContext({
			projectId: run.project_id,
			ownerId: userId,
			chapter: chapter || null,
			bookId: input?.bookId || null,
		});
		if (bookChapter?.bookId && bookChapter?.chapter) {
			await assertStoryboardChapterReady({
				projectId: run.project_id,
				ownerId: userId,
				bookId: bookChapter.bookId,
				chapter: bookChapter.chapter,
			});
		}
		if (bookChapter?.content) {
			materials.novel = bookChapter.content;
		}
		appendRunLog(
			`materials loaded: novel=${materials.novel ? "yes" : "no"}, script=${materials.script ? "yes" : "no"}, storyboard=${materials.storyboard ? "yes" : "no"}`,
		);
		appendRunLog(
			bookChapter
				? `chapter context resolved: bookId=${bookChapter.bookId} chapter=${bookChapter.chapter}`
				: "chapter context not found, fallback to materials summary",
		);
			const stages = Array.isArray(parseJsonSafe(run.stages_json))
				? ((parseJsonSafe(run.stages_json) as string[]) || [])
				: [];
			let continuationContext: PipelineContinuationContext | null = null;
			if (bookChapter?.bookId && bookChapter?.chapter) {
				try {
					continuationContext = await resolvePipelineContinuationContext({
						projectId: run.project_id,
						ownerId: userId,
						bookId: bookChapter.bookId,
						chapter: bookChapter.chapter,
						progress: effectiveProgress || null,
					});
					if (continuationContext?.chunkIndex && continuationContext.prevTailFrameUrl) {
						appendRunLog(
							`continuity resolved: chunkIndex=${continuationContext.chunkIndex} groupSize=${continuationContext.groupSize} prevTail=${continuationContext.prevTailFrameUrl} recovered=${continuationContext.prevTailRecovered ? "yes" : "no"}`,
						);
					}
				} catch (err: any) {
					appendRunLog(
						`continuity resolve failed (ignored): ${truncateForLog(err?.message || err || "unknown", 500)}`,
					);
				}
			}
			let precedentBlock = "";
			try {
				const precedentLibrary = await loadStoryboardPrecedentLibrary();
				const precedentQuery = [
					project.name,
					run.title,
					run.goal || "",
					bookChapter?.bookTitle || "",
					bookChapter?.chapterTitle || "",
					bookChapter?.summary || "",
					bookChapter?.coreConflict || "",
					(bookChapter?.keywords || []).join(" "),
					materials.storyboard,
					materials.novel.slice(0, 1600),
					materials.script.slice(0, 1200),
				]
					.filter(Boolean)
					.join("\n");
				const precedentMatches = retrieveRelevantStoryboardPrecedents({
					summaries: precedentLibrary,
					queryText: precedentQuery,
					limit: 2,
				});
				if (!precedentMatches.length && precedentLibrary.length) {
					const fallbackSummaries = precedentLibrary
						.slice()
						.sort(
							(left, right) =>
								right.evidence.length +
									right.shotPatterns.length +
									right.antiPatterns.length -
									(left.evidence.length + left.shotPatterns.length + left.antiPatterns.length) ||
								left.sourceName.localeCompare(right.sourceName),
						)
						.slice(0, 1)
						.map((summary) => ({ summary, score: 1, reasons: ["quality_fallback"] }));
					precedentBlock = buildStoryboardPrecedentPromptBlock(fallbackSummaries);
				} else {
					precedentBlock = buildStoryboardPrecedentPromptBlock(precedentMatches);
				}
				if (precedentBlock) {
					appendRunLog(
						`storyboard precedent summaries injected: items=${precedentMatches.length || (precedentLibrary.length ? 1 : 0)}`,
					);
				}
			} catch (err: unknown) {
				appendRunLog(
					`storyboard precedent indexing skipped: ${truncateForLog(
						err instanceof Error ? err.message : String(err || "unknown"),
						300,
					)}`,
				);
			}
			let prompt = buildPipelinePrompt({
				projectName: project.name,
				title: run.title,
				goal: run.goal,
				stages,
				materials,
				bookChapter,
				precedentBlock,
				progress: effectiveProgress || null,
			});
			if (bookChapter?.bookId && bookChapter?.chapter) {
				const bootstrapBlock = buildGenerateMediaBootstrapBlock({
					projectId: run.project_id,
					ownerId: userId,
					bookId: bookChapter.bookId,
					chapter: bookChapter.chapter,
					progress: effectiveProgress || null,
					continuity: continuationContext,
				});
				prompt = [
					prompt,
					"",
					"【generate-media 启动元数据（仅元数据与目录）】",
					"```json",
					bootstrapBlock,
					"```",
					"执行约束：",
					"- 你必须先自行读取 localPaths.bookIndexPath（或同目录下关联文件）再做语义判断。",
					"- 允许你自主决定读取方式（bash/read_file）与读取顺序。",
					"- 若证据不足，必须继续读取 localPaths.bookRawChunksDir 下后续 chunk（按 chunkIndex 递增），不得直接返回“剧情不足”。",
					"- 仅在目标章节相关 chunk 已遍历仍不足时，才允许返回结构化失败原因。",
					"- 若续写任务存在 continuity.prevTailFrameUrl，则必须将该 URL 作为本组首镜参考图并继续生成。",
					"- 最终输出必须包含可解析的结构化镜头提示词，不得只返回缺失项说明。",
				].join("\n");
				appendRunLog("generate-media bootstrap injected: metadata+paths only");
			}
			appendRunLog(`prompt length=${prompt.length}`);
		appendRunLog(`novel length(raw)=${materials.novel.length}`);
		appendRunLog(`script length(raw)=${materials.script.length}`);
		appendRunLog(`storyboard length(raw)=${materials.storyboard.length}`);
		appendRunLog(`novel chars limit=${readMaxNovelCharsForPrompt()}`);
		appendRunLog(`script chars limit=${readMaxScriptCharsForPrompt()}`);
		appendRunLog(`storyboard chars limit=${readMaxStoryboardCharsForPrompt()}`);
		appendRunLog(`prompt preview=${truncateForLog(prompt, 900).replace(/\s+/g, " ")}`);

				await ensureProjectWorkspaceContextFiles({
					c,
					ownerId: userId,
					projectId: run.project_id,
					bookId: bookChapter?.bookId ?? null,
					chapter: bookChapter?.chapter ?? null,
				});
				const governanceModelKey = resolveStoryboardGovernanceModelKey(input?.modelKey);
				const runBridgeOnce = async (nextPrompt: string) =>
					runAgentsBridgeChatTask(c, userId, {
						kind: "chat",
						prompt: nextPrompt,
						extras: {
							requiredSkills: effectiveProgress
								? [STORYBOARD_ORCHESTRATOR_SKILL]
								: [GENERATE_MEDIA_REQUIRED_SKILL],
							privilegedLocalAccess: true,
							localResourcePaths: [buildProjectDataRoot(run.project_id, userId)],
							modelKey: governanceModelKey,
							systemPrompt:
								typeof input?.systemPrompt === "string" && input.systemPrompt.trim()
									? input.systemPrompt.trim()
									: undefined,
						},
					});
			let bridgeTaskId = "";
			let validatedText = "";
			let parsedShotPrompts: string[] = [];
			let structuredStoryboard: StoryboardStructuredData | null = null;
			let canonicalStoryboardContent = "";
			const runAttemptLimit = effectiveProgress ? 2 : 1;
			let attemptPrompt = prompt;
			let lastDiversityError: AppError | null = null;
			for (let attempt = 0; attempt < runAttemptLimit; attempt += 1) {
				const taskResult = await runBridgeOnce(attemptPrompt);
				const text =
					typeof (taskResult as any)?.raw?.text === "string"
						? String((taskResult as any).raw.text).trim()
						: "";
				bridgeTaskId =
					typeof (taskResult as any)?.id === "string" ? String((taskResult as any).id).trim() : bridgeTaskId;
				appendRunLog(
					`agents bridge finished: attempt=${attempt + 1}/${runAttemptLimit}, taskId=${bridgeTaskId || "n/a"}, textLength=${text.length}`,
				);
				appendRunLog(`agents output preview=${truncateForLog(text, 1200).replace(/\s+/g, " ")}`);
				validateStoryboardExpertOutputOrThrow(text);
				if (effectiveProgress) {
					const expectedGridLayout = getStoryboardGridLayout(effectiveGroupSize);
					validateStoryboardJsonContractOrThrow({
						text,
						expectedCount: effectiveGroupSize,
						expectedGridLayout,
						contextLabel: "agents 分镜输出",
					});
				}
				const parsedShotItems = extractStoryboardShotItemsFromScript(text);
				const nextStructured = buildStoryboardStructuredData({
					text,
					shotItems: parsedShotItems,
				});
				const nextPrompts =
					(nextStructured?.shots || []).map(derivePromptFromStructuredShot).filter(Boolean).length > 0
						? (nextStructured?.shots || []).map(derivePromptFromStructuredShot).filter(Boolean)
						: parsedShotItems.map((x) => x.prompt).filter(Boolean);
				validateStoryboardPromptPolicyOrThrow({
					shotPrompts: nextPrompts,
					contextLabel: "agents 分镜输出",
					expectedCount: effectiveProgress ? effectiveGroupSize : undefined,
				});
				if (effectiveProgress && effectiveGroupSize <= 5 && nextStructured && nextStructured.shots.length >= 2) {
					const miniArcAssessment = assessStoryboardMiniArc(nextStructured);
					if (!miniArcAssessment.ok) {
						const err = new AppError(
							`短视频 mini-arc 质检未通过：${miniArcAssessment.reasons.slice(0, 4).join("、")}`,
							{
								status: 400,
								code: "storyboard_shortform_arc_invalid",
								details: {
									reasons: miniArcAssessment.reasons,
									totalDurationSec: miniArcAssessment.totalDurationSec,
									shotCount: miniArcAssessment.shotCount,
								},
							},
						);
						appendRunLog(
							`storyboard mini-arc precheck failed (attempt ${attempt + 1}): ${truncateForLog(err.message, 800)}`,
						);
						if (attempt + 1 < runAttemptLimit) {
							attemptPrompt = [
								prompt,
								"",
								"【短视频 mini-arc 重试指令】",
								"上一次输出没有形成真实的 7-15 秒 mini-arc。请重新输出完整 JSON，并显式保证 opening -> escalation -> payoff 三段成立。",
								"每个 shot 必须填写 beat_role，且首镜=opening，中间至少一镜=escalation，末镜=payoff。",
								"总时长必须控制在 7-15 秒，每镜建议 2-5 秒。",
								"dramatic_beat 与 story_purpose 不能重复改写同一句话，必须体现设定压力、升级转折、落点揭示的推进差异。",
							].join("\n");
							continue;
						}
						throw err;
					}
					appendRunLog(
						`storyboard mini-arc precheck passed: shots=${miniArcAssessment.shotCount}, duration=${miniArcAssessment.totalDurationSec}`,
					);
				}
				if (effectiveProgress && parsedShotItems.length > 1) {
					const preflight = preflightKeyframeDiversityByStructuredShots(parsedShotItems);
					if (!preflight.ok) {
						const err = new AppError(
							`关键帧差异预检未通过：${preflight.violations
								.slice(0, 3)
								.map((x) => `${x.pair}(${x.reason})`)
								.join("；")}`,
							{
								status: 400,
								code: "storyboard_diversity_precheck_failed",
								details: {
									groupSize: effectiveGroupSize,
									violations: preflight.violations,
									features: preflight.features,
								},
							},
						);
						lastDiversityError = err;
						appendRunLog(
							`storyboard diversity precheck failed (attempt ${attempt + 1}): ${truncateForLog(err.message, 800)}`,
						);
						if (attempt + 1 < runAttemptLimit) {
							attemptPrompt = [
								prompt,
								"",
								"【关键帧差异重试指令】",
								`上一次输出未通过关键帧差异预检。请重新生成完整 ${effectiveGroupSize} 镜 JSON，禁止沿用上一版措辞。`,
								"每个 shots[i] 必须同时包含并填充非空字段：dramatic_beat、story_purpose、continuity、subjectAction、shotType、cameraMovement、render_prompt、prompt_text。",
								"约束：任意相邻镜头在 subjectAction/shotType/cameraMovement 三项中至少变化两项。",
								"约束：相邻镜头必须体现更强冲突或情绪升级，避免只是同一动作换说法。",
								"保持剧情连续与角色一致性，但必须显式拉开镜头语言差异。",
							].join("\n");
							continue;
						}
						throw err;
					} else {
						appendRunLog("storyboard diversity precheck passed (structured)");
					}
				}
				appendRunLog(`storyboard shot prompts parsed=${nextPrompts.length}`);
				validatedText = text;
				parsedShotPrompts = nextPrompts;
				structuredStoryboard = nextStructured;
				canonicalStoryboardContent =
					effectiveProgress && nextStructured
						? serializeStoryboardStructuredDataToCanonicalJson({
								structured: nextStructured,
								groupSize: effectiveGroupSize,
								gridLayout: getStoryboardGridLayout(effectiveGroupSize),
						  })
						: nextStructured
							? serializeStoryboardStructuredDataToCanonicalJson({
									structured: nextStructured,
									groupSize: nextStructured.shots.length,
									gridLayout: null,
							  })
							: validatedText;
				break;
			}
			if (!validatedText) {
				if (lastDiversityError) throw lastDiversityError;
				throw new AppError("agents 分镜输出为空或不可解析", {
					status: 400,
					code: "storyboard_output_invalid",
				});
			}
			appendRunLog("storyboard output validation passed");
			await updateAgentPipelineRunRow(c.env.DB, {
				id,
				ownerId: userId,
				status: "running",
				progressJson: JSON.stringify({ stage: "storyboard_generation", percent: 55 }),
				nowIso: new Date().toISOString(),
			});

		let outputAssetId: string | null = null;
		let storyboardCompositeUrl: string | null = null;
		if (validatedText) {
			const asset = await createAssetRow(
				c.env.DB,
				userId,
				{
					name: `分镜脚本 · ${new Date().toLocaleString()}`,
					projectId: run.project_id,
					data: {
						kind: "storyboardScript",
				content: canonicalStoryboardContent || validatedText,
				source: "agent_pipeline_run",
				runId: run.id,
				...(structuredStoryboard ? { storyboardStructured: structuredStoryboard } : null),
			},
				},
				new Date().toISOString(),
			);
				outputAssetId = asset.id;
				appendRunLog(`storyboard asset persisted: outputAssetId=${outputAssetId}`);
				const persisted = await getAssetByIdForUser(c.env.DB, outputAssetId, userId);
				if (!persisted) {
					throw new AppError("分镜资产写入后校验失败：无法读取输出资产", {
						status: 500,
						code: "storyboard_output_asset_verify_failed",
					});
				}
			} else {
				appendRunLog("agents output empty: no storyboard asset created");
			}
				if (!skipMediaGeneration) {
					appendRunLog(
						"storyboard media generation removed from agent pipeline: use /public/agents/chat for storyboard asset production",
					);
				} else {
					appendRunLog("storyboard media generation skipped: /public/agents/chat is the only production entry");
				}

			const updated = await updateAgentPipelineRunRow(c.env.DB, {
			id,
			ownerId: userId,
			status: "succeeded",
			progressJson: JSON.stringify({ stage: "qc_publish", percent: 100 }),
			resultJson: JSON.stringify({
				textLength: validatedText.length,
				outputAssetId,
				chapter: bookChapter?.chapter || chapter || null,
				bookId: bookChapter?.bookId || input?.bookId || null,
				storyboardContent: canonicalStoryboardContent || validatedText || null,
				storyboardStructured: structuredStoryboard,
				storyboardCompositeUrl,
				mediaGenerationSkipped: skipMediaGeneration,
				bridgeTaskId: bridgeTaskId || null,
				logs: runLogs.slice(-200),
			}),
			errorMessage: null,
			finishedAt: new Date().toISOString(),
			nowIso: new Date().toISOString(),
		});
		if (!updated) {
			throw new AppError("Pipeline run not found", {
				status: 404,
				code: "pipeline_run_not_found",
			});
		}
		await logWriteQueue;
		return mapAgentPipelineRunRow(updated);
	} catch (err: any) {
		const errDetails = (() => {
			try {
				return err?.details ? JSON.stringify(err.details) : "";
			} catch {
				return "";
			}
		})();
		appendRunLog(`pipeline execution failed: ${truncateForLog(err?.message || err || "unknown error", 1200)}`);
		if (errDetails) appendRunLog(`pipeline error details: ${truncateForLog(errDetails, 2400)}`);
		const updated = await updateAgentPipelineRunRow(c.env.DB, {
			id,
			ownerId: userId,
			status: "failed",
			progressJson: JSON.stringify({ stage: "storyboard_generation", percent: 100 }),
			resultJson: JSON.stringify({
				logs: runLogs.slice(-200),
			}),
			errorMessage: String(err?.message || err || "pipeline execution failed"),
			finishedAt: new Date().toISOString(),
			nowIso: new Date().toISOString(),
		});
		if (!updated) {
			throw err;
		}
		await logWriteQueue;
		return mapAgentPipelineRunRow(updated);
	}
}
