import { createHash, randomUUID } from "node:crypto";
import type { AppContext, PrismaClient } from "../../types";
import { getConfig } from "../../config";
import { signJwtHS256, verifyJwtHS256 } from "../../jwt";
import { AppError } from "../../middleware/error";
import {
	getProjectAccessSummary,
	listProjectAccessSummaries,
} from "../project/project.repo";
import { deleteProjectForUser } from "../project/project.service";
import { stripWorkflowAuthoringRuntimeData } from "../flow/flow-authoring-runtime";
import { isAdminRequest } from "../team/team.service";
import {
	AgentCapabilityAttachmentSchema,
	AdoptAiWorkflowProjectResponseSchema,
	CapabilityInvocationSchema,
	CapabilityRouteDecisionSchema,
	CapabilityBayResponseSchema,
	CapabilityConflictReportSchema,
	CapabilityInspectionGrantSchema,
	GenerateWorkflowCapabilityDescriptionResponseSchema,
	WorkflowCapabilityEquipScopeSchema,
	type CapabilityConflictReport,
	type GenerateWorkflowCapabilityDescriptionRequest,
	type WorkflowCapabilityDescriptor,
	type WorkflowCapabilityEquipScope,
	WorkflowCapabilityDescriptorSchema,
} from "./capability-bay.schemas";
import {
	assertVideoWorkflowCanvasDefinitionCurrent,
	buildWorkflowCapabilityDescriptor,
	capabilityDescriptorSha256,
	deriveWorkflowInvocationContractFromVersionData,
	detectBuiltInCapabilityConflicts,
	detectStructuralCapabilityConflicts,
	inspectVideoWorkflowCanvasDefinition,
	omitNonCompetingCapabilityConflicts,
	workflowCapabilityDescriptorsShareInvocationRoute,
} from "./capability-bay.descriptor";
import { listBuiltInSmallTCapabilities } from "../task/agents-bridge-remote-tool-surface";
import {
	listSystemDisabledBuiltInCapabilityKeys,
	readBuiltInCapabilitySystemSettings,
} from "./built-in-capability-settings.service";

type CapabilityConflict = CapabilityConflictReport["conflicts"][number];
type CapabilityRouteResolution = {
	conflictId: string;
	withCapabilityId: string | null;
	action: "acknowledge" | "replace_existing";
};

type LatestFlowVersionRow = {
	id: string;
	flow_id: string;
	data: string;
	created_at: string;
};

type CapabilitySourceFlow = {
	id: string;
	name: string;
	data: string;
	owner_id: string | null;
	project_id: string | null;
	canvas_revision: number;
	updated_at: string;
};

function stringValue(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function parseJson(value: string, label: string): unknown {
	try {
		return JSON.parse(value);
	} catch (error: unknown) {
		throw new AppError(`${label} 不是合法 JSON`, {
			status: 500,
			code: "capability_storage_corrupt",
			details: { reason: error instanceof Error ? error.message : String(error) },
		});
	}
}

function stableStateSha256(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function attachmentStateSha256(rows: Array<{
	id: string;
	source_id: string;
	source_version_id: string;
	descriptor_sha256: string;
	route_decisions_json?: string | null;
}>): string {
	return stableStateSha256(rows
		.map((row) => ({
			id: row.id,
			sourceId: row.source_id,
			sourceVersionId: row.source_version_id,
			descriptorSha256: row.descriptor_sha256,
			routeDecisionsJson: row.route_decisions_json ?? null,
		}))
		.sort((left, right) => left.id.localeCompare(right.id)));
}

function skillStateSha256(skills: Array<{
	id: string;
	key: string;
	name: string;
	description: string | null;
}>): string {
	return stableStateSha256(skills
		.map((skill) => ({ ...skill }))
		.sort((left, right) => left.id.localeCompare(right.id)));
}

function preferenceStateSha256(rows: Array<{
	id: string;
	capability_kind: string;
	capability_id: string;
	enabled: number;
	disabled_reason: string | null;
	replaced_by_capability_id: string | null;
}>): string {
	return stableStateSha256(rows
		.map((row) => ({
			id: row.id,
			capabilityKind: row.capability_kind,
			capabilityId: row.capability_id,
			enabled: row.enabled,
			disabledReason: row.disabled_reason,
			replacedByCapabilityId: row.replaced_by_capability_id,
		}))
		.sort((left, right) => left.id.localeCompare(right.id)));
}

type CapabilityPreferenceSnapshot = Readonly<{
	capability_kind: string;
	capability_id: string;
	enabled: number;
	disabled_reason: string | null;
	replaced_by_capability_id: string | null;
}>;

type CapabilityPreferenceKey = Readonly<{
	capabilityKind: "skill" | "built_in";
	capabilityId: string;
}>;

function replacementTargetId(preference: CapabilityPreferenceSnapshot): string | null {
	const capabilityId = stringValue(preference.capability_id);
	if (!capabilityId) return null;
	if (preference.capability_kind === "skill") return capabilityId;
	if (preference.capability_kind === "built_in") return `builtin:${capabilityId}`;
	return null;
}

/**
 * Returns replacement preferences that became invalid because the workflow's
 * frozen graph now declares the replaced Skill as a runtime dependency.
 *
 * Confirmed replacement decisions otherwise survive a version update. The
 * conflict inspector intentionally excludes capabilities already replaced by
 * this workflow, so absence from a later report is not evidence that the user
 * revoked the primary-route decision. Treating it as such would silently
 * restore the built-in route and let the Agent bypass the equipped workflow.
 */
export function obsoleteWorkflowReplacementPreferences(input: Readonly<{
	workflowCapabilityId: string;
	replacementTargets: readonly string[];
	requiredSkills: readonly string[];
	preferences: readonly CapabilityPreferenceSnapshot[];
}>): CapabilityPreferenceKey[] {
	const activeTargets = new Set(input.replacementTargets);
	const requiredSkills = new Set(input.requiredSkills);
	return input.preferences.flatMap((preference) => {
		if (
			preference.enabled !== 0 ||
			preference.disabled_reason !== "replaced" ||
			preference.replaced_by_capability_id !== input.workflowCapabilityId
		) return [];
		const targetId = replacementTargetId(preference);
		if (
			!targetId ||
			activeTargets.has(targetId) ||
			preference.capability_kind !== "skill" ||
			!requiredSkills.has(targetId)
		) return [];
		return [{
			capabilityKind: preference.capability_kind as CapabilityPreferenceKey["capabilityKind"],
			capabilityId: preference.capability_id,
		}];
	});
}

function builtInCapabilityStateSha256(
	settings: Awaited<ReturnType<typeof readBuiltInCapabilitySystemSettings>>,
): string {
	return stableStateSha256({
		catalog: listBuiltInSmallTCapabilities(),
		systemSettings: [...settings.values()].sort((left, right) => (
			left.capabilityId.localeCompare(right.capabilityId)
		)),
	});
}

function validateCapabilityRouteResolutions(input: {
	descriptor: WorkflowCapabilityDescriptor;
	report: CapabilityConflictReport;
	resolutions: CapabilityRouteResolution[];
}): string[] {
	const byConflictId = new Map<string, CapabilityRouteResolution>();
	for (const resolution of input.resolutions) {
		if (byConflictId.has(resolution.conflictId)) {
			throw new AppError("同一能力冲突不能重复提交决策", {
				status: 400,
				code: "capability_conflict_resolution_duplicate",
				details: { conflictId: resolution.conflictId },
			});
		}
		byConflictId.set(resolution.conflictId, resolution);
	}
	const reportConflictIds = new Set(input.report.conflicts.map((conflict) => conflict.id));
	const unknown = input.resolutions.find((resolution) => !reportConflictIds.has(resolution.conflictId));
	if (unknown) {
		throw new AppError("提交了不属于本次检查报告的能力决策", {
			status: 409,
			code: "capability_conflict_resolution_mismatch",
			details: { conflictId: unknown.conflictId },
		});
	}

	const replacementTargets: string[] = [];
	for (const conflict of input.report.conflicts) {
		const resolution = byConflictId.get(conflict.id);
		if (!resolution) {
			throw new AppError("每一项能力关系都必须确认后才能装配", {
				status: 409,
				code: "capability_conflict_resolution_required",
				details: { conflictId: conflict.id, title: conflict.title },
			});
		}
		if (resolution.withCapabilityId !== conflict.withCapabilityId) {
			throw new AppError("能力决策对象与检查报告不一致，请重新检查", {
				status: 409,
				code: "capability_conflict_resolution_mismatch",
				details: { conflictId: conflict.id },
			});
		}
		if (conflict.resolutionMode === "acknowledge") {
			if (resolution.action !== "acknowledge" || conflict.severity === "blocking") {
				throw new AppError("该阻断关系不能通过普通确认解决", {
					status: 409,
					code: "capability_conflict_blocking",
					details: { conflictId: conflict.id, title: conflict.title },
				});
			}
			continue;
		}
		if (resolution.action !== "replace_existing" || !conflict.withCapabilityId) {
			throw new AppError("职责重叠必须明确替换原主能力；保留原能力时不能装配候选工作流", {
				status: 409,
				code: "capability_primary_route_not_selected",
				details: { conflictId: conflict.id, withCapabilityId: conflict.withCapabilityId },
			});
		}
		if (conflict.withCapabilityId.startsWith("builtin:")) {
			const capabilityKey = conflict.withCapabilityId.slice("builtin:".length);
			const builtIn = listBuiltInSmallTCapabilities().find((item) => item.key === capabilityKey);
			if (builtIn?.replaceable === false) {
				throw new AppError("底层媒体能力不能被工作流替换；请重新检查能力关系", {
					status: 409,
					code: "capability_non_replaceable_target",
					details: { capabilityId: conflict.withCapabilityId },
				});
			}
		}
		if (input.descriptor.requiredSkills.includes(conflict.withCapabilityId)) {
			throw new AppError("工作流依赖的 Skill 不能同时被该工作流停用；请返回工作流编辑并修正职责合同", {
				status: 409,
				code: "capability_required_skill_replacement_invalid",
				details: { conflictId: conflict.id, skillKey: conflict.withCapabilityId },
			});
		}
		replacementTargets.push(conflict.withCapabilityId);
	}
	return [...new Set(replacementTargets)];
}

function currentCapabilityVersion(flow: CapabilitySourceFlow): LatestFlowVersionRow {
	const authoringGraph = normalizeWorkflowAuthoringGraph(readStoredFlowGraph(flow.data), {
		stripInvocationMediaOverrides: false,
	});
	const identity = normalizeFlowDataForComparison(JSON.stringify({
		flowId: flow.id,
		name: flow.name,
		projectId: flow.project_id,
		authoringGraph,
	}));
	const digest = createHash("sha256").update(identity).digest("hex");
	return {
		id: `capability-version-${digest}`,
		flow_id: flow.id,
		data: flow.data,
		created_at: flow.updated_at,
	};
}

async function ensureCurrentCapabilityVersion(
	db: PrismaClient,
	flow: CapabilitySourceFlow,
	userId: string,
): Promise<LatestFlowVersionRow> {
	const version = currentCapabilityVersion(flow);
	await db.flow_versions.upsert({
		where: { id: version.id },
		create: {
			id: version.id,
			flow_id: version.flow_id,
			name: flow.name,
			data: version.data,
			user_id: userId,
			created_at: version.created_at,
		},
		update: {},
	});
	return version;
}


function mapAttachment(row: {
	id: string;
	capability_kind: string;
	source_id: string;
	source_version_id: string;
	descriptor_json: string;
	descriptor_sha256: string;
	conflict_report_json: string;
	route_decisions_json?: string | null;
	scope?: string | null;
	created_at: string;
	updated_at: string;
}, userEnabled = true) {
	const routingReady = typeof row.route_decisions_json === "string";
	const routeDecisions = routingReady
		? CapabilityRouteDecisionSchema.array().parse(parseJson(row.route_decisions_json ?? "[]", "主路径决策"))
		: [];
	return AgentCapabilityAttachmentSchema.parse({
		id: row.id,
		kind: row.capability_kind,
		sourceId: row.source_id,
		sourceVersionId: row.source_version_id,
		descriptorSha256: row.descriptor_sha256,
		descriptor: WorkflowCapabilityDescriptorSchema.parse(parseJson(row.descriptor_json, "能力描述")),
		conflictReport: CapabilityConflictReportSchema.parse(parseJson(row.conflict_report_json, "冲突报告")),
		routeDecisions,
		routingReady,
		scope: normalizeAttachmentScope(row.scope),
		userEnabled,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

/** 老数据没有 scope 列时按 current_user 处理（保持个人装配语义不变）。 */
function normalizeAttachmentScope(raw: string | null | undefined): WorkflowCapabilityEquipScope {
	return raw === "all_users" ? "all_users" : "current_user";
}

/**
 * 用户手动关闭的系统级工作流来源集合（capability_kind="workflow" + enabled=0）。
 * 只作用于 all_users 装配；自己的装配不受影响（用 unequip 管理）。
 */
async function listUserDisabledWorkflowSourceIds(c: AppContext, userId: string): Promise<Set<string>> {
	const rows = await c.env.DB.agent_capability_preferences.findMany({
		where: { user_id: userId, capability_kind: "workflow", enabled: 0 },
		select: { capability_id: true },
	});
	return new Set(rows.map((row) => row.capability_id));
}

async function assertFlowAccess(c: AppContext, userId: string, flowId: string) {
	const db = c.env.DB;
	const flow = await db.flows.findFirst({ where: { id: flowId } });
	if (!flow) throw new AppError("工作流不存在", { status: 404, code: "capability_workflow_not_found" });
	if (flow.project_id) {
		const project = await getProjectAccessSummary(db, flow.project_id, userId);
		if (!project) throw new AppError("工作流不存在或无权访问", { status: 404, code: "capability_workflow_not_found" });
	} else if (flow.owner_id !== userId) {
		throw new AppError("工作流不存在或无权访问", { status: 404, code: "capability_workflow_not_found" });
	}
	const version = await ensureCurrentCapabilityVersion(db, flow as CapabilitySourceFlow, userId);
	return { flow, version };
}

async function analyzeSemanticConflicts(c: AppContext, input: {
	target: WorkflowCapabilityDescriptor;
	existing: WorkflowCapabilityDescriptor[];
	builtInSkills: Array<{ id: string; key: string; name: string; description: string | null }>;
	builtInCapabilities: ReturnType<typeof listBuiltInSmallTCapabilities>;
}) {
	const envBase = stringValue(c.env.AGENTS_BRIDGE_BASE_URL);
	const processBase = typeof process !== "undefined" ? stringValue(process.env.AGENTS_BRIDGE_BASE_URL) : "";
	const baseUrl = (envBase || processBase).replace(/\/+$/, "");
	if (!baseUrl) throw new AppError("能力冲突分析器未配置", { status: 503, code: "capability_conflict_analyzer_unavailable" });
	const token = stringValue(c.env.AGENTS_BRIDGE_TOKEN) || (typeof process !== "undefined" ? stringValue(process.env.AGENTS_BRIDGE_TOKEN) : "");
	let response: Response;
	try {
		response = await fetch(`${baseUrl}/capabilities/conflicts/analyze`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...(token ? { authorization: `Bearer ${token}` } : {}),
			},
			body: JSON.stringify(input),
			signal: AbortSignal.timeout(120_000),
		});
	} catch (error: unknown) {
		throw new AppError("能力语义冲突分析器连接失败或超时", {
			status: 502,
			code: "capability_conflict_analysis_transport_failed",
			details: { reason: error instanceof Error ? error.message : String(error) },
		});
	}
	const payload: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		throw new AppError("能力语义冲突分析失败", {
			status: 502,
			code: "capability_conflict_analysis_failed",
			details: { status: response.status, payload },
		});
	}
	const parsed = CapabilityConflictReportSchema.pick({ conflicts: true }).safeParse(payload);
	if (!parsed.success) {
		throw new AppError("能力语义冲突分析返回了无效合同", {
			status: 502,
			code: "capability_conflict_analysis_invalid",
			details: { issues: parsed.error.issues },
		});
	}
	return parsed.data.conflicts;
}

export async function generateWorkflowCapabilityDescription(
	c: AppContext,
	input: GenerateWorkflowCapabilityDescriptionRequest,
): Promise<{ description: string }> {
	const envBase = stringValue(c.env.AGENTS_BRIDGE_BASE_URL);
	const processBase = typeof process !== "undefined" ? stringValue(process.env.AGENTS_BRIDGE_BASE_URL) : "";
	const baseUrl = (envBase || processBase).replace(/\/+$/, "");
	if (!baseUrl) {
		throw new AppError("工作流能力说明生成器未配置", {
			status: 503,
			code: "workflow_capability_description_generator_unavailable",
		});
	}
	const token = stringValue(c.env.AGENTS_BRIDGE_TOKEN)
		|| (typeof process !== "undefined" ? stringValue(process.env.AGENTS_BRIDGE_TOKEN) : "");
	let response: Response;
	try {
		response = await fetch(`${baseUrl}/capabilities/descriptions/generate`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...(token ? { authorization: `Bearer ${token}` } : {}),
			},
			body: JSON.stringify(input),
			signal: AbortSignal.timeout(60_000),
		});
	} catch (error: unknown) {
		throw new AppError("工作流能力说明生成器连接失败或超时", {
			status: 502,
			code: "workflow_capability_description_transport_failed",
			details: { reason: error instanceof Error ? error.message : String(error) },
		});
	}
	const payload: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		throw new AppError("工作流能力说明生成失败", {
			status: 502,
			code: "workflow_capability_description_failed",
			details: { status: response.status, payload },
		});
	}
	const parsed = GenerateWorkflowCapabilityDescriptionResponseSchema.safeParse(payload);
	if (!parsed.success) {
		throw new AppError("工作流能力说明生成器返回了无效合同", {
			status: 502,
			code: "workflow_capability_description_invalid",
			details: { issues: parsed.error.issues },
		});
	}
	return parsed.data;
}

export async function inspectWorkflowCapability(c: AppContext, userId: string, flowId: string): Promise<{
	descriptor: WorkflowCapabilityDescriptor;
	descriptorSha256: string;
	report: CapabilityConflictReport;
	inspectionToken: string;
}> {
	const db = c.env.DB;
	const { flow, version } = await assertFlowAccess(c, userId, flowId);
	assertVideoWorkflowCanvasDefinitionCurrent(version.data);
	const descriptor = buildWorkflowCapabilityDescriptor({ flow, version });
	const descriptorSha256 = capabilityDescriptorSha256(descriptor);
	const [rows, preferenceRows, systemSettings] = await Promise.all([
		db.agent_capability_attachments.findMany({ where: { user_id: userId }, orderBy: { updated_at: "desc" } }),
		db.agent_capability_preferences.findMany({ where: { user_id: userId }, orderBy: { updated_at: "desc" } }),
		readBuiltInCapabilitySystemSettings(c),
	]);
	const attachments = rows.map((row) => mapAttachment(row));
	const disabledSkillKeys = new Set(preferenceRows
		.filter((row) => row.capability_kind === "skill" && row.enabled === 0)
		.map((row) => row.capability_id));
	const disabledBuiltInCapabilityKeys = new Set(preferenceRows
		.filter((row) => row.capability_kind === "built_in" && row.enabled === 0)
		.map((row) => row.capability_id));
	const builtInSkills = (await db.agent_skills.findMany({
		where: { enabled: 1, visible: 1 },
		select: { id: true, key: true, name: true, description: true },
		orderBy: [{ sort_order: "asc" }, { name: "asc" }],
	})).map((skill) => ({ ...skill, description: skill.description ?? null }))
		.filter((skill) => !disabledSkillKeys.has(skill.key));
	const builtInCapabilityCatalog = listBuiltInSmallTCapabilities();
	const builtInCapabilities = builtInCapabilityCatalog
		.filter((capability) => (
			!disabledBuiltInCapabilityKeys.has(capability.key) &&
			(systemSettings.get(capability.key)?.enabled ?? true)
		));
	const deterministic = [
		...detectStructuralCapabilityConflicts(descriptor, attachments.map((attachment) => attachment.descriptor)),
		...detectBuiltInCapabilityConflicts(descriptor, builtInCapabilities),
	];
	const existingWorkflowDescriptors = attachments
		.filter((item) => item.sourceId !== flowId)
		.map((item) => item.descriptor);
	let analyzedSemantic: CapabilityConflict[] = [];
	let semanticAnalysis: CapabilityConflictReport["semanticAnalysis"] = { status: "succeeded" };
	try {
		analyzedSemantic = await analyzeSemanticConflicts(c, {
			target: descriptor,
			existing: existingWorkflowDescriptors.filter((existing) => (
				workflowCapabilityDescriptorsShareInvocationRoute(descriptor, existing)
			)),
			builtInSkills,
			builtInCapabilities,
		});
	} catch (error: unknown) {
		const errorCode = error instanceof AppError
			? error.code
			: "capability_conflict_analysis_unexpected";
		const message = error instanceof Error ? error.message : String(error);
		semanticAnalysis = { status: "unavailable", errorCode, message };
		console.warn(JSON.stringify({
			type: "capability_conflict_analysis_diagnostic",
			flowId,
			descriptorSha256,
			status: "unavailable",
			errorCode,
			message,
		}));
	}
	const semantic = omitNonCompetingCapabilityConflicts(
		descriptor,
		existingWorkflowDescriptors,
		analyzedSemantic,
	);
	const conflicts: CapabilityConflict[] = [...deterministic, ...semantic].filter(
		(item: CapabilityConflict, index: number, values: CapabilityConflict[]) => values.findIndex((candidate: CapabilityConflict) => candidate.id === item.id) === index,
	);
	const report = CapabilityConflictReportSchema.parse({
		protocolVersion: "tapcanvas.capability-conflict-report/v1",
		targetCapabilityId: descriptor.capabilityId,
		checkedAt: new Date().toISOString(),
		descriptorSha256,
		semanticAnalysis,
		conflicts,
		blocking: conflicts.some((item) => item.severity === "blocking" && item.resolutionMode === "acknowledge"),
		requiresConfirmation: conflicts.some((item) => item.resolutionMode === "choose_primary" || item.severity === "warning"),
	});
	const inspectionToken = await signJwtHS256({
		purpose: "capability_inspection",
		userId,
		flowId,
		sourceVersionId: descriptor.sourceVersionId,
		descriptorSha256,
		attachmentStateSha256: attachmentStateSha256(rows),
		skillStateSha256: skillStateSha256(builtInSkills),
		preferenceStateSha256: preferenceStateSha256(preferenceRows),
		builtInCapabilityStateSha256: builtInCapabilityStateSha256(systemSettings),
		report,
	}, getConfig(c.env).jwtSecret, 10 * 60);
	return { descriptor, descriptorSha256, report, inspectionToken };
}

function parseInvocationInput(value: string | null): Record<string, unknown> | null {
	if (!value) return null;
	const parsed = parseJson(value, "能力调用输入");
	return parsed && typeof parsed === "object" && !Array.isArray(parsed)
		? parsed as Record<string, unknown>
		: null;
}

export async function getCapabilityBay(c: AppContext, userId: string, projectId?: string) {
	const db = c.env.DB;
	const accessibleProjects = await listProjectAccessSummaries(db, userId);
	const currentProject = projectId
		? accessibleProjects.find((project) => project.id === projectId) ?? null
		: null;
	if (projectId && !currentProject) {
		throw new AppError("项目不存在或无权访问", {
			status: 404,
			code: "capability_project_not_found",
		});
	}
	const managedProjects = accessibleProjects.filter((project) => project.project_kind === "ai_workflow");
	const sourceProjectIds = [...new Set([
		...managedProjects.map((project) => project.id),
		...(currentProject ? [currentProject.id] : []),
	])];
	const [attachmentRows, skillRows, preferenceRows, invocationRows, systemSettings] = await Promise.all([
		db.agent_capability_attachments.findMany({
			where: {
				OR: [{ user_id: userId }, { scope: "all_users" }],
			},
			orderBy: { updated_at: "desc" },
		}),
		db.agent_skills.findMany({
			where: { enabled: 1, visible: 1 },
			select: { id: true, key: true, name: true, description: true, logo_url: true, category: true },
			orderBy: [{ sort_order: "asc" }, { name: "asc" }],
		}),
		db.agent_capability_preferences.findMany({ where: { user_id: userId }, orderBy: { updated_at: "desc" } }),
		db.agent_capability_invocations.findMany({
			where: { user_id: userId },
			orderBy: { created_at: "desc" },
			take: 100,
			include: { workflow_executions: true },
		}),
		readBuiltInCapabilitySystemSettings(c),
	]);
	// 系统级（all_users）工作流对全体用户可见：即使其项目不在调用者可访问范围内，
	// 也要把它纳入候选列表，让用户在 Agent 配置里能看到并了解已发布的系统工作流。
	const systemAttachmentFlowIds = [...new Set(attachmentRows
		.filter((attachment) => attachment.scope === "all_users")
		.map((attachment) => attachment.source_id))];
	const flowRows = await db.flows.findMany({
		where: systemAttachmentFlowIds.length > 0
			? { OR: [{ project_id: { in: sourceProjectIds } }, { id: { in: systemAttachmentFlowIds } }] }
			: { project_id: { in: sourceProjectIds } },
		orderBy: { updated_at: "desc" },
	});
	const projectNameById = new Map(accessibleProjects.map((project) => [project.id, project.name]));
	// 系统级工作流可能属于调用者不可访问的项目，补齐其项目名用于展示。
	const missingProjectIds = [...new Set(flowRows
		.map((flow) => flow.project_id)
		.filter((projectId): projectId is string => projectId !== null && projectId !== "" && !projectNameById.has(projectId)))];
	if (missingProjectIds.length > 0) {
		const extraProjects = await db.projects.findMany({
			where: { id: { in: missingProjectIds } },
			select: { id: true, name: true },
		});
		for (const project of extraProjects) projectNameById.set(project.id, project.name);
	}
	const versionRows = flowRows.map((flow) => currentCapabilityVersion(flow as CapabilitySourceFlow));
	const latestVersionByFlow = new Map<string, typeof versionRows[number]>();
	for (const version of versionRows) {
		if (!latestVersionByFlow.has(version.flow_id)) latestVersionByFlow.set(version.flow_id, version);
	}
	// 保留已关闭的系统级工作流（userEnabled=false），让用户在 Agent 配置里能重新启用。
	const userDisabledWorkflowSourceIds = await listUserDisabledWorkflowSourceIds(c, userId);
	const attachments = attachmentRows.map((row) => {
		const scope = normalizeAttachmentScope(row.scope);
		const userEnabled = scope === "all_users" ? !userDisabledWorkflowSourceIds.has(row.source_id) : true;
		return mapAttachment(row, userEnabled);
	});
	const attachedSourceVersionIds = [...new Set(attachments.map((attachment) => attachment.sourceVersionId))];
	const attachedSourceVersions = attachedSourceVersionIds.length > 0
		? await db.flow_versions.findMany({
				where: { id: { in: attachedSourceVersionIds } },
				select: { id: true, data: true },
		  })
		: [];
	const attachedSourceVersionDataById = new Map(
		attachedSourceVersions.map((version) => [version.id, version.data] as const),
	);
	const candidates = [];
	for (const flow of flowRows) {
		const currentVersion = latestVersionByFlow.get(flow.id);
		if (!currentVersion) continue;
		try {
			const attached = attachments.find((item) => item.sourceId === flow.id) ?? null;
			const pinnedVersionData = attached
				? attachedSourceVersionDataById.get(attached.sourceVersionId)
				: undefined;
			const attachedAuthoringIsCurrent = Boolean(attached && isWorkflowAttachmentAuthoringCurrent({
				attachment: attached,
				pinnedVersionData,
				liveFlowData: flow.data,
			}));
			// An attachment pins an immutable published version. When the live
			// authoring graph is still identical, keep that published identity;
			// a content-derived draft id would otherwise report a false update.
			const descriptorVersion = attached && pinnedVersionData !== undefined && attachedAuthoringIsCurrent
				? {
					id: attached.sourceVersionId,
					flow_id: flow.id,
					data: pinnedVersionData,
					created_at: currentVersion.created_at,
				}
				: currentVersion;
			const descriptor = buildWorkflowCapabilityDescriptor({ flow, version: descriptorVersion });
			const descriptorSha256 = capabilityDescriptorSha256(descriptor);
			const canvasDefinition = inspectVideoWorkflowCanvasDefinition(descriptorVersion.data);
			candidates.push({
				descriptor,
				descriptorSha256,
				projectName: flow.project_id ? projectNameById.get(flow.project_id) ?? null : null,
				attached: Boolean(attached),
				attachedVersionId: attached?.sourceVersionId ?? null,
				stale: !canvasDefinition.current || Boolean(attached && (
					attached.sourceVersionId !== descriptor.sourceVersionId
					|| attached.descriptorSha256 !== descriptorSha256
					|| !attached.routingReady
					|| !isEquippedWorkflowCanvasDefinitionCurrent({
						attachmentId: attached.id,
						pinnedVersionData: attachedSourceVersionDataById.get(attached.sourceVersionId),
					})
				)),
			});
		} catch (error: unknown) {
			if (!(error instanceof AppError) || !["capability_workflow_trigger_invalid", "capability_workflow_empty"].includes(error.code)) throw error;
		}
	}
	const preferenceBySkillKey = new Map(preferenceRows
		.filter((row) => row.capability_kind === "skill")
		.map((row) => [row.capability_id, row]));
	const preferenceByBuiltInKey = new Map(preferenceRows
		.filter((row) => row.capability_kind === "built_in")
		.map((row) => [row.capability_id, row]));
	const skills = skillRows.map((skill) => {
		const preference = preferenceBySkillKey.get(skill.key) ?? null;
		return {
			id: skill.id,
			key: skill.key,
			name: skill.name,
			description: skill.description ?? null,
			logoUrl: skill.logo_url ?? null,
			category: skill.category,
			enabled: preference?.enabled !== 0,
			disabledReason: preference?.enabled === 0 && (preference.disabled_reason === "user" || preference.disabled_reason === "replaced")
				? preference.disabled_reason
				: null,
			replacedByCapabilityId: preference?.enabled === 0 ? preference.replaced_by_capability_id ?? null : null,
		};
	});
	const builtInCapabilities = listBuiltInSmallTCapabilities().map((capability) => {
		const preference = preferenceByBuiltInKey.get(capability.key) ?? null;
		const systemEnabled = systemSettings.get(capability.key)?.enabled ?? true;
		const staleReplacementIgnored = capability.replaceable === false
			&& preference?.enabled === 0
			&& preference.disabled_reason === "replaced";
		const userEnabled = staleReplacementIgnored || preference?.enabled !== 0;
		return {
			...capability,
			requiredTools: [...capability.requiredTools],
			sideEffects: [...capability.sideEffects],
			enabled: systemEnabled && userEnabled,
			systemEnabled,
			userEnabled,
			disabledReason: !systemEnabled
				? "system" as const
				: !staleReplacementIgnored && preference?.enabled === 0 && (preference.disabled_reason === "user" || preference.disabled_reason === "replaced")
					? preference.disabled_reason
					: null,
			replacedByCapabilityId: !staleReplacementIgnored && preference?.enabled === 0
				? preference.replaced_by_capability_id ?? null
				: null,
			replaceable: capability.replaceable,
		};
	});
	const flowCountByProjectId = new Map<string, number>();
	for (const flow of flowRows) {
		if (!flow.project_id) continue;
		flowCountByProjectId.set(flow.project_id, (flowCountByProjectId.get(flow.project_id) ?? 0) + 1);
	}
	const workflowProjects = managedProjects.map((project) => ({
		id: project.id,
		name: project.name,
		projectKind: "ai_workflow" as const,
		flowCount: flowCountByProjectId.get(project.id) ?? 0,
		updatedAt: project.updated_at,
		canDelete: project.access === "owner",
	}));
	const currentProjectSummary = currentProject ? {
		id: currentProject.id,
		name: currentProject.name,
		projectKind: currentProject.project_kind === "ai_workflow" ? "ai_workflow" as const : "creative" as const,
		flowCount: flowCountByProjectId.get(currentProject.id) ?? 0,
		updatedAt: currentProject.updated_at,
	} : null;
	const invocations = invocationRows.map((row) => CapabilityInvocationSchema.parse({
		id: row.id,
		attachmentId: row.attachment_id,
		capabilityId: row.capability_id,
		capabilityName: row.capability_name,
		sourceId: row.source_id,
		sourceVersionId: row.source_version_id,
		descriptorSha256: row.descriptor_sha256,
		workflowExecutionId: row.workflow_execution_id,
		executionStatus: row.workflow_executions.status,
		executionErrorMessage: row.workflow_executions.error_message,
		agentExecutionId: row.agent_execution_id,
		sessionId: row.session_id,
		toolCallId: row.tool_call_id,
		input: parseInvocationInput(row.input_json),
		createdAt: row.created_at,
		startedAt: row.workflow_executions.started_at,
		finishedAt: row.workflow_executions.finished_at,
	}));
	return CapabilityBayResponseSchema.parse({
		productName: "Agent 配置",
		candidates,
		attachments,
		skills,
		builtInCapabilities,
		currentProject: currentProjectSummary,
		workflowProjects,
		invocations,
	});
}

export async function deleteAiWorkflowProject(
	c: AppContext,
	userId: string,
	projectId: string,
): Promise<void> {
	const normalizedProjectId = projectId.trim();
	if (!normalizedProjectId) {
		throw new AppError("工作流项目 ID 不能为空", {
			status: 400,
			code: "capability_project_id_required",
		});
	}
	const project = await getProjectAccessSummary(c.env.DB, normalizedProjectId, userId);
	if (!project || project.project_kind !== "ai_workflow") {
		throw new AppError("工作流项目不存在或无权访问", {
			status: 404,
			code: "capability_workflow_project_not_found",
		});
	}
	if (project.access !== "owner") {
		throw new AppError("只有工作流项目所有者可以删除项目", {
			status: 403,
			code: "capability_workflow_project_owner_required",
		});
	}
	await deleteProjectForUser(c, userId, normalizedProjectId);
}

export async function adoptAiWorkflowProject(
	c: AppContext,
	userId: string,
	projectId: string,
): Promise<{
	projectId: string;
	projectName: string;
	projectKind: "ai_workflow";
	flowCount: number;
	eligibleFlowCount: number;
	changed: boolean;
	updatedAt: string;
}> {
	const normalizedProjectId = projectId.trim();
	if (!normalizedProjectId) {
		throw new AppError("项目 ID 不能为空", { status: 400, code: "capability_project_id_required" });
	}
	const db = c.env.DB;
	const project = await getProjectAccessSummary(db, normalizedProjectId, userId);
	if (!project) {
		throw new AppError("项目不存在或无权编辑", {
			status: 404,
			code: "capability_project_not_found",
		});
	}
	if (project.access !== "owner" && project.access !== "team_edit") {
		throw new AppError("当前账号没有修改项目分类的权限", {
			status: 403,
			code: "capability_project_write_forbidden",
		});
	}
	const flows = await db.flows.findMany({
		where: { project_id: normalizedProjectId },
		orderBy: { updated_at: "desc" },
	});
	const versions = flows.map((flow) => currentCapabilityVersion(flow as CapabilitySourceFlow));
	const latestVersionByFlow = new Map<string, LatestFlowVersionRow>();
	for (const version of versions) {
		if (!latestVersionByFlow.has(version.flow_id)) latestVersionByFlow.set(version.flow_id, version);
	}
	let eligibleFlowCount = 0;
	for (const flow of flows) {
		const version = latestVersionByFlow.get(flow.id);
		if (!version) continue;
		try {
			buildWorkflowCapabilityDescriptor({ flow, version });
			eligibleFlowCount += 1;
		} catch (error: unknown) {
			if (!(error instanceof AppError) || !["capability_workflow_trigger_invalid", "capability_workflow_empty"].includes(error.code)) {
				throw error;
			}
		}
	}
	if (eligibleFlowCount === 0) {
		throw new AppError("当前项目没有可纳入的已保存工作流；请先保存一张仅含一个触发器且至少包含一个执行节点的工作流", {
			status: 409,
			code: "capability_project_workflow_missing",
			details: { projectId: normalizedProjectId, flowCount: flows.length },
		});
	}
	const changed = project.project_kind !== "ai_workflow";
	const updatedAt = changed ? new Date().toISOString() : project.updated_at;
	if (changed) {
		await db.projects.update({
			where: { id: normalizedProjectId },
			data: { project_kind: "ai_workflow", updated_at: updatedAt },
		});
	}
	return AdoptAiWorkflowProjectResponseSchema.parse({
		projectId: normalizedProjectId,
		projectName: project.name,
		projectKind: "ai_workflow",
		flowCount: flows.length,
		eligibleFlowCount,
		changed,
		updatedAt,
	});
}

export async function createAiWorkflowProject(
	c: AppContext,
	userId: string,
	name: string,
): Promise<{ projectId: string; flowId: string; projectName: string; flowName: string }> {
	const projectName = name.trim();
	if (!projectName) throw new AppError("项目名称不能为空", { status: 400, code: "capability_project_name_required" });
	const projectId = randomUUID();
	const flowId = randomUUID();
	const flowVersionId = randomUUID();
	const flowName = "AI 编排工作流";
	const now = new Date().toISOString();
	const data = JSON.stringify({
		nodes: [],
		edges: [],
		viewport: { x: 0, y: 0, zoom: 1 },
		__tapcanvasFlowOwner: { ownerType: "project", ownerId: projectId },
	});
	await c.env.DB.$transaction(async (transaction) => {
		await transaction.projects.create({
			data: {
				id: projectId,
				name: projectName,
				owner_id: userId,
				project_kind: "ai_workflow",
				created_at: now,
				updated_at: now,
			},
		});
		await transaction.flows.create({
			data: {
				id: flowId,
				name: flowName,
				data,
				owner_id: userId,
				project_id: projectId,
				created_at: now,
				updated_at: now,
			},
		});
		await transaction.flow_versions.create({
			data: {
				id: flowVersionId,
				flow_id: flowId,
				name: flowName,
				data,
				user_id: userId,
				created_at: now,
			},
		});
	});
	return { projectId, flowId, projectName, flowName };
}

export async function recordCapabilityInvocation(c: AppContext, input: {
	userId: string;
	attachment: ReturnType<typeof mapAttachment>;
	workflowExecutionId: string;
	agentExecutionId: string | null;
	sessionId: string | null;
	toolCallId: string | null;
	invocationInput: Record<string, unknown> | null;
}): Promise<void> {
	const now = new Date().toISOString();
	await c.env.DB.agent_capability_invocations.upsert({
		where: { workflow_execution_id: input.workflowExecutionId },
		create: {
			id: randomUUID(),
			user_id: input.userId,
			attachment_id: input.attachment.id,
			capability_id: input.attachment.descriptor.capabilityId,
			capability_name: input.attachment.descriptor.name,
			source_id: input.attachment.sourceId,
			source_version_id: input.attachment.sourceVersionId,
			descriptor_sha256: input.attachment.descriptorSha256,
			workflow_execution_id: input.workflowExecutionId,
			agent_execution_id: input.agentExecutionId,
			session_id: input.sessionId,
			tool_call_id: input.toolCallId,
			input_json: input.invocationInput ? JSON.stringify(input.invocationInput) : null,
			created_at: now,
			updated_at: now,
		},
		update: {},
	});
}

export async function listDisabledSkillKeys(c: AppContext, userId: string): Promise<string[]> {
	const rows = await c.env.DB.agent_capability_preferences.findMany({
		where: { user_id: userId, capability_kind: "skill", enabled: 0 },
		select: { capability_id: true },
		orderBy: { capability_id: "asc" },
	});
	return rows.map((row) => row.capability_id);
}

/**
 * Skills hidden because an equipped workflow replaced their top-level entry.
 *
 * `replaced` is routing metadata, not an explicit user veto on using the skill
 * as a dependency. A deterministic product route may therefore require one of
 * these skills without making it visible again in the capability bay. Keep the
 * distinction separate from `listDisabledSkillKeys`, whose callers still need
 * the complete hidden-skill set for ordinary model discovery.
 */
export async function listReplacedSkillKeys(c: AppContext, userId: string): Promise<string[]> {
	const rows = await c.env.DB.agent_capability_preferences.findMany({
		where: {
			user_id: userId,
			capability_kind: "skill",
			enabled: 0,
			disabled_reason: "replaced",
		},
		select: { capability_id: true },
		orderBy: { capability_id: "asc" },
	});
	return rows.map((row) => row.capability_id);
}

export async function listDisabledBuiltInCapabilityKeys(c: AppContext, userId: string): Promise<string[]> {
	const rows = await c.env.DB.agent_capability_preferences.findMany({
		where: { user_id: userId, capability_kind: "built_in", enabled: 0 },
		select: { capability_id: true, disabled_reason: true },
		orderBy: { capability_id: "asc" },
	});
	const nonReplaceableKeys = new Set<string>(
		listBuiltInSmallTCapabilities()
			.filter((capability) => !capability.replaceable)
			.map((capability) => capability.key),
	);
	return rows
		.filter((row) => !(
			row.disabled_reason === "replaced"
			&& nonReplaceableKeys.has(row.capability_id)
		))
		.map((row) => row.capability_id);
}

export type BuiltInCapabilityAvailability = {
	systemDisabledKeys: string[];
	userDisabledKeys: string[];
	disabledKeys: string[];
};

export async function getBuiltInCapabilityAvailability(
	c: AppContext,
	userId: string,
): Promise<BuiltInCapabilityAvailability> {
	const [systemDisabledKeys, userDisabledKeys] = await Promise.all([
		listSystemDisabledBuiltInCapabilityKeys(c),
		listDisabledBuiltInCapabilityKeys(c, userId),
	]);
	return {
		systemDisabledKeys,
		userDisabledKeys,
		disabledKeys: [...new Set([...systemDisabledKeys, ...userDisabledKeys])].sort(),
	};
}

export async function updateSkillCapabilityState(
	c: AppContext,
	userId: string,
	skillKey: string,
	enabled: boolean,
): Promise<{ skillKey: string; enabled: boolean }> {
	const normalizedSkillKey = skillKey.trim();
	if (!normalizedSkillKey) {
		throw new AppError("Skill key 不能为空", { status: 400, code: "capability_skill_key_required" });
	}
	const db = c.env.DB;
	const skill = await db.agent_skills.findFirst({
		where: { key: normalizedSkillKey, enabled: 1, visible: 1 },
		select: { id: true },
	});
	if (!skill) throw new AppError("Skill 不存在或不可用", { status: 404, code: "capability_skill_not_found" });
	const current = await db.agent_capability_preferences.findFirst({
		where: { user_id: userId, capability_kind: "skill", capability_id: normalizedSkillKey },
	});
	if (enabled && current?.enabled === 0 && current.replaced_by_capability_id) {
		const sourceId = current.replaced_by_capability_id.startsWith("workflow:")
			? current.replaced_by_capability_id.slice("workflow:".length)
			: "";
		const replacementStillEquipped = sourceId
			? await db.agent_capability_attachments.findFirst({
				where: { user_id: userId, capability_kind: "workflow", source_id: sourceId },
				select: { id: true },
			})
			: null;
		if (replacementStillEquipped) {
			throw new AppError("该 Skill 已被装配工作流替换；请先卸下替代工作流，再重新启用", {
				status: 409,
				code: "capability_primary_route_conflict",
				details: {
					skillKey: normalizedSkillKey,
					replacedByCapabilityId: current.replaced_by_capability_id,
				},
			});
		}
	}
	const now = new Date().toISOString();
	await db.agent_capability_preferences.upsert({
		where: {
			user_id_capability_kind_capability_id: {
				user_id: userId,
				capability_kind: "skill",
				capability_id: normalizedSkillKey,
			},
		},
		create: {
			id: randomUUID(),
			user_id: userId,
			capability_kind: "skill",
			capability_id: normalizedSkillKey,
			enabled: enabled ? 1 : 0,
			disabled_reason: enabled ? null : "user",
			replaced_by_capability_id: null,
			created_at: now,
			updated_at: now,
		},
		update: {
			enabled: enabled ? 1 : 0,
			disabled_reason: enabled ? null : "user",
			replaced_by_capability_id: null,
			updated_at: now,
		},
	});
	return { skillKey: normalizedSkillKey, enabled };
}

export async function updateBuiltInCapabilityState(
	c: AppContext,
	userId: string,
	capabilityKey: string,
	enabled: boolean,
): Promise<{ capabilityKey: string; enabled: boolean }> {
	const normalizedCapabilityKey = capabilityKey.trim();
	if (!normalizedCapabilityKey) {
		throw new AppError("内置能力 key 不能为空", { status: 400, code: "capability_builtin_key_required" });
	}
	const capability = listBuiltInSmallTCapabilities().find((item) => item.key === normalizedCapabilityKey);
	if (!capability) {
		throw new AppError("内置能力不存在", { status: 404, code: "capability_builtin_not_found" });
	}
	if (enabled) {
		const systemSettings = await readBuiltInCapabilitySystemSettings(c);
		if (systemSettings.get(normalizedCapabilityKey)?.enabled === false) {
			throw new AppError("该内置能力已被管理员在系统层停用", {
				status: 409,
				code: "capability_builtin_disabled_by_system",
				details: { capabilityKey: normalizedCapabilityKey },
			});
		}
	}
	const db = c.env.DB;
	const current = await db.agent_capability_preferences.findFirst({
		where: { user_id: userId, capability_kind: "built_in", capability_id: normalizedCapabilityKey },
	});
	if (enabled && capability.replaceable && current?.enabled === 0 && current.replaced_by_capability_id) {
		const sourceId = current.replaced_by_capability_id.startsWith("workflow:")
			? current.replaced_by_capability_id.slice("workflow:".length)
			: "";
		const replacementStillEquipped = sourceId
			? await db.agent_capability_attachments.findFirst({
				where: { user_id: userId, capability_kind: "workflow", source_id: sourceId },
				select: { id: true },
			})
			: null;
		if (replacementStillEquipped) {
			throw new AppError("该内置能力已被装配工作流替换；请先卸下替代工作流，再重新启用", {
				status: 409,
				code: "capability_primary_route_conflict",
				details: {
					capabilityKey: normalizedCapabilityKey,
					replacedByCapabilityId: current.replaced_by_capability_id,
				},
			});
		}
	}
	const now = new Date().toISOString();
	await db.agent_capability_preferences.upsert({
		where: {
			user_id_capability_kind_capability_id: {
				user_id: userId,
				capability_kind: "built_in",
				capability_id: normalizedCapabilityKey,
			},
		},
		create: {
			id: randomUUID(),
			user_id: userId,
			capability_kind: "built_in",
			capability_id: normalizedCapabilityKey,
			enabled: enabled ? 1 : 0,
			disabled_reason: enabled ? null : "user",
			replaced_by_capability_id: null,
			created_at: now,
			updated_at: now,
		},
		update: {
			enabled: enabled ? 1 : 0,
			disabled_reason: enabled ? null : "user",
			replaced_by_capability_id: null,
			updated_at: now,
		},
	});
	return { capabilityKey: capability.key, enabled };
}

/**
 * 普通用户手动关闭/重新启用系统级（all_users）工作流（针对自己）。
 * 只能作用于系统级装配；自己的装配用 unequip 管理。状态存
 * agent_capability_preferences(capability_kind="workflow", capability_id=flowId)。
 */
export async function updateWorkflowCapabilityState(
	c: AppContext,
	userId: string,
	flowId: string,
	enabled: boolean,
): Promise<{ flowId: string; enabled: boolean }> {
	const normalizedFlowId = flowId.trim();
	if (!normalizedFlowId) {
		throw new AppError("工作流 ID 不能为空", { status: 400, code: "capability_workflow_id_required" });
	}
	const db = c.env.DB;
	const systemAttachment = await db.agent_capability_attachments.findFirst({
		where: { capability_kind: "workflow", source_id: normalizedFlowId, scope: "all_users" },
		select: { id: true },
	});
	if (!systemAttachment) {
		throw new AppError("该系统级工作流不存在或已下线", { status: 404, code: "capability_system_workflow_not_found" });
	}
	const now = new Date().toISOString();
	await db.agent_capability_preferences.upsert({
		where: {
			user_id_capability_kind_capability_id: {
				user_id: userId,
				capability_kind: "workflow",
				capability_id: normalizedFlowId,
			},
		},
		create: {
			id: randomUUID(),
			user_id: userId,
			capability_kind: "workflow",
			capability_id: normalizedFlowId,
			enabled: enabled ? 1 : 0,
			disabled_reason: enabled ? null : "user",
			replaced_by_capability_id: null,
			created_at: now,
			updated_at: now,
		},
		update: {
			enabled: enabled ? 1 : 0,
			disabled_reason: enabled ? null : "user",
			replaced_by_capability_id: null,
			updated_at: now,
		},
	});
	return { flowId: normalizedFlowId, enabled };
}

export async function equipWorkflowCapability(c: AppContext, userId: string, flowId: string, input: {
	sourceVersionId: string;
	descriptorSha256: string;
	inspectionToken: string;
	resolutions: CapabilityRouteResolution[];
	scope?: unknown;
}) {
	// 作用范围：只允许管理员发布全体用户可用的系统级工作流；普通用户装配
	// 一律按 current_user（仅自己可见/可用），不允许越权发布。
	const scope = input.scope === undefined || input.scope === null
		? "current_user" as const
		: WorkflowCapabilityEquipScopeSchema.parse(input.scope);
	if (scope === "all_users" && !isAdminRequest(c)) {
		throw new AppError("只有管理员可以把工作流发布为全体用户可用", {
			status: 403,
			code: "capability_equip_scope_forbidden",
		});
	}
	const rawGrant = await verifyJwtHS256<unknown>(input.inspectionToken, getConfig(c.env).jwtSecret);
	const parsedGrant = CapabilityInspectionGrantSchema.safeParse(rawGrant);
	if (!parsedGrant.success) {
		throw new AppError("装配检查凭证无效或已过期，请重新检查", {
			status: 409,
			code: "capability_inspection_invalid",
		});
	}
	const grant = parsedGrant.data;
	if (
		grant.userId !== userId ||
		grant.flowId !== flowId ||
		grant.sourceVersionId !== input.sourceVersionId ||
		grant.descriptorSha256 !== input.descriptorSha256
	) {
		throw new AppError("装配检查凭证与当前提交不匹配，请重新检查", {
			status: 409,
			code: "capability_inspection_mismatch",
		});
	}

	const { flow, version } = await assertFlowAccess(c, userId, flowId);
	assertVideoWorkflowCanvasDefinitionCurrent(version.data);
	const descriptor = buildWorkflowCapabilityDescriptor({ flow, version });
	const descriptorSha256 = capabilityDescriptorSha256(descriptor);
	if (descriptor.sourceVersionId !== input.sourceVersionId || descriptorSha256 !== input.descriptorSha256) {
		throw new AppError("工作流在检查后发生了变化，请重新检查再装配", {
			status: 409,
			code: "capability_inspection_stale",
			details: { currentVersionId: descriptor.sourceVersionId, currentDescriptorSha256: descriptorSha256 },
		});
	}
	const db = c.env.DB;
	const systemSettings = await readBuiltInCapabilitySystemSettings(c);
	if (builtInCapabilityStateSha256(systemSettings) !== grant.builtInCapabilityStateSha256) {
		throw new AppError("能力目录在检查后发生了变化，请重新检查再装配", {
			status: 409,
			code: "capability_inspection_stale",
		});
	}
	const report = grant.report;
	if (report.targetCapabilityId !== descriptor.capabilityId || report.descriptorSha256 !== descriptorSha256) {
		throw new AppError("装配检查凭证中的冲突报告与当前工作流不匹配", {
			status: 409,
			code: "capability_inspection_mismatch",
		});
	}
	const replacementTargets = validateCapabilityRouteResolutions({
		descriptor,
		report,
		resolutions: input.resolutions,
	});
	const now = new Date().toISOString();
	let row: Awaited<ReturnType<typeof db.agent_capability_attachments.upsert>>;
	try {
		row = await db.$transaction(async (transaction) => {
			const [currentFlow, attachmentRows, allBuiltInSkills, preferenceRows] = await Promise.all([
				transaction.flows.findFirst({ where: { id: flowId } }),
				transaction.agent_capability_attachments.findMany({
					where: { user_id: userId },
					orderBy: { updated_at: "desc" },
				}),
				transaction.agent_skills.findMany({
					where: { enabled: 1, visible: 1 },
					select: { id: true, key: true, name: true, description: true },
					orderBy: [{ sort_order: "asc" }, { name: "asc" }],
				}).then((skills) => skills.map((skill) => ({ ...skill, description: skill.description ?? null }))),
				transaction.agent_capability_preferences.findMany({
					where: { user_id: userId },
					orderBy: { updated_at: "desc" },
				}),
			]);
			const latestVersion = currentFlow
				? currentCapabilityVersion(currentFlow as CapabilitySourceFlow)
				: null;
			if (!latestVersion || latestVersion.id !== descriptor.sourceVersionId) {
				throw new AppError("工作流在装配提交时发生了变化，请重新检查", {
					status: 409,
					code: "capability_inspection_stale",
					details: {
						inspectedVersionId: descriptor.sourceVersionId,
						latestVersionId: latestVersion?.id ?? null,
					},
				});
			}
			const disabledSkillKeys = new Set(preferenceRows
				.filter((preference) => preference.capability_kind === "skill" && preference.enabled === 0)
				.map((preference) => preference.capability_id));
			const builtInSkills = allBuiltInSkills.filter((skill) => !disabledSkillKeys.has(skill.key));
			if (
				attachmentStateSha256(attachmentRows) !== grant.attachmentStateSha256 ||
				skillStateSha256(builtInSkills) !== grant.skillStateSha256 ||
				preferenceStateSha256(preferenceRows) !== grant.preferenceStateSha256
			) {
				throw new AppError("能力目录在检查后发生了变化，请重新检查再装配", {
					status: 409,
					code: "capability_inspection_stale",
				});
			}
			const obsoleteReplacementPreferences = obsoleteWorkflowReplacementPreferences({
				workflowCapabilityId: descriptor.capabilityId,
				replacementTargets,
				requiredSkills: descriptor.requiredSkills,
				preferences: preferenceRows,
			});
			for (const preference of obsoleteReplacementPreferences) {
				await transaction.agent_capability_preferences.deleteMany({
					where: {
						user_id: userId,
						capability_kind: preference.capabilityKind,
						capability_id: preference.capabilityId,
						enabled: 0,
						disabled_reason: "replaced",
						replaced_by_capability_id: descriptor.capabilityId,
					},
				});
			}
			for (const targetCapabilityId of replacementTargets) {
				if (targetCapabilityId.startsWith("workflow:")) {
					const sourceId = targetCapabilityId.slice("workflow:".length).trim();
					if (!sourceId || sourceId === flowId) {
						throw new AppError("替换目标工作流无效", {
							status: 409,
							code: "capability_replacement_target_invalid",
							details: { targetCapabilityId },
						});
					}
					const detached = await transaction.agent_capability_attachments.deleteMany({
						where: { user_id: userId, capability_kind: "workflow", source_id: sourceId },
					});
					if (detached.count !== 1) {
						throw new AppError("待替换工作流已不在当前装配中，请重新检查", {
							status: 409,
							code: "capability_inspection_stale",
							details: { targetCapabilityId },
						});
					}
					continue;
				}
				if (targetCapabilityId.startsWith("builtin:")) {
					const builtInCapabilityKey = targetCapabilityId.slice("builtin:".length).trim();
					const knownBuiltInCapability = listBuiltInSmallTCapabilities()
						.some((capability) => capability.key === builtInCapabilityKey);
					if (!knownBuiltInCapability) {
						throw new AppError("待替换内置能力已不在当前能力目录，请重新检查", {
							status: 409,
							code: "capability_inspection_stale",
							details: { targetCapabilityId },
						});
					}
					await transaction.agent_capability_preferences.upsert({
						where: {
							user_id_capability_kind_capability_id: {
								user_id: userId,
								capability_kind: "built_in",
								capability_id: builtInCapabilityKey,
							},
						},
						create: {
							id: randomUUID(),
							user_id: userId,
							capability_kind: "built_in",
							capability_id: builtInCapabilityKey,
							enabled: 0,
							disabled_reason: "replaced",
							replaced_by_capability_id: descriptor.capabilityId,
							created_at: now,
							updated_at: now,
						},
						update: {
							enabled: 0,
							disabled_reason: "replaced",
							replaced_by_capability_id: descriptor.capabilityId,
							updated_at: now,
						},
					});
					continue;
				}
				const knownSkill = allBuiltInSkills.some((skill) => skill.key === targetCapabilityId);
				if (!knownSkill) {
					throw new AppError("待替换 Skill 已不在当前能力目录，请重新检查", {
						status: 409,
						code: "capability_inspection_stale",
						details: { targetCapabilityId },
					});
				}
				await transaction.agent_capability_preferences.upsert({
					where: {
						user_id_capability_kind_capability_id: {
							user_id: userId,
							capability_kind: "skill",
							capability_id: targetCapabilityId,
						},
					},
					create: {
						id: randomUUID(),
						user_id: userId,
						capability_kind: "skill",
						capability_id: targetCapabilityId,
						enabled: 0,
						disabled_reason: "replaced",
						replaced_by_capability_id: descriptor.capabilityId,
						created_at: now,
						updated_at: now,
					},
					update: {
						enabled: 0,
						disabled_reason: "replaced",
						replaced_by_capability_id: descriptor.capabilityId,
						updated_at: now,
					},
				});
			}
			return transaction.agent_capability_attachments.upsert({
				where: { user_id_capability_kind_source_id: { user_id: userId, capability_kind: "workflow", source_id: flowId } },
				create: {
					id: randomUUID(), user_id: userId, capability_kind: "workflow", source_id: flowId,
					source_version_id: descriptor.sourceVersionId,
					descriptor_json: JSON.stringify(descriptor), descriptor_sha256: descriptorSha256,
					conflict_report_json: JSON.stringify(report), route_decisions_json: JSON.stringify(input.resolutions),
					scope,
					created_at: now, updated_at: now,
				},
				update: {
					source_version_id: descriptor.sourceVersionId,
					descriptor_json: JSON.stringify(descriptor), descriptor_sha256: descriptorSha256,
					conflict_report_json: JSON.stringify(report),
					route_decisions_json: JSON.stringify(input.resolutions),
					scope,
					conflict_report_revision: { increment: 1 }, updated_at: now,
				},
			});
		}, { isolationLevel: "Serializable" });
	} catch (error: unknown) {
		const databaseCode = error && typeof error === "object" && "code" in error
			? String((error as { code?: unknown }).code ?? "")
			: "";
		if (databaseCode === "P2034") {
			throw new AppError("工作流在装配期间被其他保存更新，请重新检查", {
				status: 409,
				code: "capability_inspection_stale",
			});
		}
		throw error;
	}
	return mapAttachment(row);
}

/**
 * Attach a structurally declared workflow to an isolated evaluation workspace.
 *
 * Evaluation provisioning is an internal, authenticated operation: the
 * workspace request already carries the exact execution variant selected by
 * the suite, so no semantic conflict analysis or user-facing capability
 * confirmation is involved. We still derive the descriptor from the saved
 * graph, pin a content-addressed version, and persist the same attachment
 * contract used by normal capability equipment.
 */
export async function equipStandaloneEvalWorkflowCapability(
	c: AppContext,
	userId: string,
	projectId: string,
	executionVariant: "full_video" | "first_video",
): Promise<{ flowId: string; attachmentId: string; executionVariant: "full_video" | "first_video" }> {
	// Reuse only attachments that the real execution boundary can start. Eval
	// provisioning previously relaxed canvas-definition freshness while the
	// execution service correctly rejected that same frozen graph. That
	// split-brain advertised an impossible tool and let the Agent spend physical
	// windows varying invocation arguments even though no argument can repair an
	// outdated authored definition. Qualification is now a hard cutover: an eval
	// workspace never exposes a workflow version that startWorkflowExecution
	// would reject as workflow_definition_outdated.
	const existingAttachments = await listEquippedWorkflowCapabilities(c, userId);
	const reusableAttachment = existingAttachments.find(
		(attachment) => attachment.descriptor.invocation?.executionVariant === executionVariant,
	);
	if (reusableAttachment) {
		return {
			flowId: reusableAttachment.sourceId,
			attachmentId: reusableAttachment.id,
			executionVariant,
		};
	}
	const accessibleProjects = await listProjectAccessSummaries(c.env.DB, userId);
	const systemWorkflowProjects = await c.env.DB.projects.findMany({
		where: { project_kind: "ai_workflow" },
		select: { id: true },
	});
	const candidateProjectIds = [...new Set([
		projectId,
		...accessibleProjects
			.filter((project) => project.project_kind === "ai_workflow")
			.map((project) => project.id),
		...systemWorkflowProjects.map((project) => project.id),
	])];
	const flows = await c.env.DB.flows.findMany({
		where: { project_id: { in: candidateProjectIds } },
		orderBy: [{ updated_at: "desc" }, { id: "desc" }],
	});
	for (const flow of flows) {
		const version = currentCapabilityVersion(flow as CapabilitySourceFlow);
		try {
			// The evaluator pins the same immutable definition that execution will
			// consume. Reject stale template provenance before persisting or exposing
			// an attachment; provider/runtime validation cannot upgrade an authored
			// DAG and invocation retries cannot make an old graph current.
			assertVideoWorkflowCanvasDefinitionCurrent(version.data);
			const descriptor = buildWorkflowCapabilityDescriptor({
				flow: flow as CapabilitySourceFlow,
				version,
			});
			if (descriptor.invocation?.executionVariant !== executionVariant) continue;
			const descriptorSha256 = capabilityDescriptorSha256(descriptor);
			const report = CapabilityConflictReportSchema.parse({
				protocolVersion: "tapcanvas.capability-conflict-report/v1",
				targetCapabilityId: descriptor.capabilityId,
				checkedAt: new Date().toISOString(),
				descriptorSha256,
				semanticAnalysis: { status: "succeeded" },
				conflicts: [],
				blocking: false,
				requiresConfirmation: false,
			});
			const now = new Date().toISOString();
			await c.env.DB.flow_versions.upsert({
				where: { id: version.id },
				create: {
					id: version.id,
					flow_id: version.flow_id,
					name: flow.name,
					data: version.data,
					user_id: userId,
					created_at: version.created_at,
				},
				update: {},
			});
			const attachment = await c.env.DB.agent_capability_attachments.upsert({
				where: {
					user_id_capability_kind_source_id: {
						user_id: userId,
						capability_kind: "workflow",
						source_id: flow.id,
					},
				},
				create: {
					id: randomUUID(),
					user_id: userId,
					capability_kind: "workflow",
					source_id: flow.id,
					source_version_id: version.id,
					descriptor_json: JSON.stringify(descriptor),
					descriptor_sha256: descriptorSha256,
					conflict_report_json: JSON.stringify(report),
					route_decisions_json: JSON.stringify([]),
					scope: "current_user",
					created_at: now,
					updated_at: now,
				},
				update: {
					source_version_id: version.id,
					descriptor_json: JSON.stringify(descriptor),
					descriptor_sha256: descriptorSha256,
					conflict_report_json: JSON.stringify(report),
					route_decisions_json: JSON.stringify([]),
					scope: "current_user",
					updated_at: now,
				},
			});
			return { flowId: flow.id, attachmentId: attachment.id, executionVariant };
		} catch (error: unknown) {
			if (error instanceof AppError && ["capability_workflow_definition_outdated", "capability_workflow_trigger_invalid", "capability_workflow_empty"].includes(error.code)) {
				continue;
			}
			throw error;
		}
	}
	throw new AppError("隔离评测工作区缺少所请求执行变体的已保存工作流", {
		status: 409,
		code: "agents_eval_workflow_variant_unavailable",
		details: { projectId, executionVariant, flowCount: flows.length },
	});
}

export async function unequipWorkflowCapability(c: AppContext, userId: string, flowId: string): Promise<{ detached: true }> {
	const db = c.env.DB;
	const attachmentRow = await db.agent_capability_attachments.findFirst({
		where: { user_id: userId, capability_kind: "workflow", source_id: flowId },
	});
	if (!attachmentRow) {
		throw new AppError("该工作流未装配", { status: 404, code: "capability_attachment_not_found" });
	}
	const workflowCapabilityId = mapAttachment(attachmentRow).descriptor.capabilityId;
	await db.$transaction(async (transaction) => {
		const result = await transaction.agent_capability_attachments.deleteMany({
			where: {
				id: attachmentRow.id,
				user_id: userId,
				capability_kind: "workflow",
				source_id: flowId,
			},
		});
		if (result.count === 0) {
			throw new AppError("工作流装配状态已变化，请刷新后重试", {
				status: 409,
				code: "capability_attachment_stale",
			});
		}
		await transaction.agent_capability_preferences.deleteMany({
			where: {
				user_id: userId,
				enabled: 0,
				disabled_reason: "replaced",
				replaced_by_capability_id: workflowCapabilityId,
			},
		});
	});
	return { detached: true };
}

export async function listEquippedWorkflowCapabilities(
	c: AppContext,
	userId: string,
	options: Readonly<{
		requiredExecutionVariant?: "full_video" | "first_video" | null;
	}> = {},
) {
	// 用户自己的装配 + 管理员发布的系统级（all_users）工作流；系统级工作流对
	// 全体用户可见（工具面枚举 attachmentId），执行时再校验源工作流与版本。
	// 用户手动关闭的系统级工作流从工具面剔除（不再出现在小T可调用列表）。
	const [rows, preferenceRows] = await Promise.all([
		c.env.DB.agent_capability_attachments.findMany({
			where: {
				capability_kind: "workflow",
				OR: [{ user_id: userId }, { scope: "all_users" }],
			},
			orderBy: { updated_at: "desc" },
		}),
		c.env.DB.agent_capability_preferences.findMany({
			where: { user_id: userId, enabled: 0 },
			orderBy: { updated_at: "desc" },
		}),
	]);
	const disabledSourceIds = new Set(preferenceRows
		.filter((preference) => preference.capability_kind === "workflow")
		.map((preference) => preference.capability_id));
	const sourceVersionIds = [...new Set(rows.map((row) => row.source_version_id).filter(Boolean))];
	const sourceVersions = sourceVersionIds.length > 0
		? await c.env.DB.flow_versions.findMany({
			where: { id: { in: sourceVersionIds } },
			select: { id: true, data: true },
		})
		: [];
	const sourceVersionDataById = new Map(
		sourceVersions.map((version) => [version.id, version.data] as const),
	);
	const sourceFlowIds = [...new Set(rows.map((row) => row.source_id).filter(Boolean))];
	const sourceFlows = sourceFlowIds.length > 0
		? await c.env.DB.flows.findMany({
			where: { id: { in: sourceFlowIds } },
			select: { id: true, data: true },
		})
		: [];
	const liveFlowDataById = new Map(
		sourceFlows.map((flow) => [flow.id, String(flow.data ?? "")] as const),
	);
	const builtInCapabilityByKey = new Map<
		string,
		ReturnType<typeof listBuiltInSmallTCapabilities>[number]
	>(
		listBuiltInSmallTCapabilities().map((capability) => [capability.key, capability] as const),
	);
	const attachments = rows.map((row) => {
		const scope = normalizeAttachmentScope(row.scope);
		const userEnabled = scope === "all_users" ? !disabledSourceIds.has(row.source_id) : true;
		const attachment = mapAttachment(row, userEnabled);
		const pinnedVersionData = sourceVersionDataById.get(attachment.sourceVersionId);
		if (!pinnedVersionData) return attachment;
		return {
			...attachment,
			descriptor: {
				...attachment.descriptor,
				invocation: deriveWorkflowInvocationContractFromVersionData(pinnedVersionData),
			},
		};
	});
	const workflowByCapabilityId = new Map(attachments.map((attachment) => [
		attachment.descriptor.capabilityId,
		attachment.descriptor,
	] as const));
	const primaryCapabilityRelation = (capabilityId: string) => {
		if (capabilityId.startsWith("builtin:")) {
			const builtIn = builtInCapabilityByKey.get(capabilityId.slice("builtin:".length));
			if (builtIn?.replaceable === false) return null;
			return {
				capabilityId,
				name: builtIn?.name ?? capabilityId,
				description: builtIn?.description ?? "",
			};
		}
		const workflow = workflowByCapabilityId.get(capabilityId);
		return {
			capabilityId,
			name: workflow?.name ?? capabilityId,
			description: workflow?.summary ?? "",
		};
	};
	const primaryCapabilitiesByWorkflowId = new Map<string, Array<{
		capabilityId: string;
		name: string;
		description: string;
	}>>();
	for (const preference of preferenceRows) {
		const replacementWorkflowId = stringValue(preference.replaced_by_capability_id);
		if (
			preference.disabled_reason !== "replaced" ||
			!replacementWorkflowId ||
			preference.capability_kind === "workflow"
		) continue;
		const rawCapabilityId = stringValue(preference.capability_id);
		if (!rawCapabilityId) continue;
		const relation = primaryCapabilityRelation(preference.capability_kind === "built_in"
			? `builtin:${rawCapabilityId}`
			: rawCapabilityId);
		if (!relation) continue;
		const current = primaryCapabilitiesByWorkflowId.get(replacementWorkflowId) ?? [];
		if (!current.some((item) => item.capabilityId === relation.capabilityId)) {
			current.push(relation);
			primaryCapabilitiesByWorkflowId.set(replacementWorkflowId, current);
		}
	}
	const routedAttachments = attachments
		.map((attachment) => {
			// route_decisions_json is the signed, inspected source of truth. In
			// particular an all_users attachment must carry its replacement route
			// to every caller; the publishing admin's personal preference rows are
			// not visible when another user opens 小T.
			const confirmedRoutes = attachment.routeDecisions.flatMap((decision) => {
				if (decision.action !== "replace_existing" || !decision.withCapabilityId) return [];
				const relation = primaryCapabilityRelation(decision.withCapabilityId);
				return relation ? [relation] : [];
			});
			const preferenceRoutes = primaryCapabilitiesByWorkflowId.get(attachment.descriptor.capabilityId) ?? [];
			const primaryForCapabilities = [...confirmedRoutes, ...preferenceRoutes].filter(
				(item, index, values) => values.findIndex((candidate) => candidate.capabilityId === item.capabilityId) === index,
			);
			return {
				...attachment,
				primaryForCapabilities,
			};
		});
	const availableAttachments = routedAttachments.filter((attachment) =>
			attachment.routingReady &&
			attachment.userEnabled &&
			isEquippedWorkflowCanvasDefinitionCurrent({
				attachmentId: attachment.id,
				pinnedVersionData: sourceVersionDataById.get(attachment.sourceVersionId),
			}) &&
			isWorkflowAttachmentAuthoringCurrent({
				attachment,
				pinnedVersionData: sourceVersionDataById.get(attachment.sourceVersionId),
				liveFlowData: liveFlowDataById.get(attachment.sourceId),
			}));
	const requiredExecutionVariant = options.requiredExecutionVariant ?? null;
	if (
		requiredExecutionVariant
		&& !availableAttachments.some(
			(attachment) => attachment.descriptor.invocation?.executionVariant === requiredExecutionVariant,
		)
	) {
		const requestedAttachment = routedAttachments.find(
			(attachment) => attachment.descriptor.invocation?.executionVariant === requiredExecutionVariant,
		);
		if (!requestedAttachment) {
			throw new AppError("当前用户没有可用于该成片模式的已装备工作流", {
				status: 409,
				code: "capability_workflow_variant_unavailable",
				terminal: true,
				details: { requiredExecutionVariant },
			});
		}
		if (!requestedAttachment.routingReady) {
			throw new AppError("已装备工作流尚未确认使用关系，请在 Agent 配置中重新检查并更新", {
				status: 409,
				code: "capability_attachment_routing_unconfirmed",
				terminal: true,
				details: { attachmentId: requestedAttachment.id, requiredExecutionVariant },
			});
		}
		if (!requestedAttachment.userEnabled) {
			throw new AppError("该成片工作流已被当前用户关闭", {
				status: 403,
				code: "capability_workflow_disabled_by_user",
				terminal: true,
				details: { attachmentId: requestedAttachment.id, requiredExecutionVariant },
			});
		}
		const pinnedVersionData = sourceVersionDataById.get(requestedAttachment.sourceVersionId);
		if (pinnedVersionData === undefined) {
			throw new AppError("已装备工作流版本不存在", {
				status: 409,
				code: "capability_attachment_version_missing",
				terminal: true,
				details: { attachmentId: requestedAttachment.id, requiredExecutionVariant },
			});
		}
		const definitionState = inspectVideoWorkflowCanvasDefinition(pinnedVersionData);
		if (!definitionState.current) {
			throw new AppError("一键成片工作流定义已过期，请先升级到当前模板并重新添加", {
				status: 409,
				code: "capability_workflow_definition_outdated",
				terminal: true,
				details: {
					attachmentId: requestedAttachment.id,
					requiredExecutionVariant,
					...definitionState,
				},
			});
		}
		throw new AppError("工作流数据已变化，原配置已失效；请在 Agent 配置中重新检查并更新", {
			status: 409,
			code: "capability_attachment_stale",
			terminal: true,
			details: { attachmentId: requestedAttachment.id, requiredExecutionVariant },
		});
	}
	return availableAttachments;
}

function isEquippedWorkflowCanvasDefinitionCurrent(input: Readonly<{
	attachmentId: string;
	pinnedVersionData: string | undefined;
}>): boolean {
	if (input.pinnedVersionData === undefined) return false;
	const state = inspectVideoWorkflowCanvasDefinition(input.pinnedVersionData);
	if (state.current) return true;
	console.info(JSON.stringify({
		type: "workflow_capability_definition_outdated",
		attachmentId: input.attachmentId,
		...state,
	}));
	return false;
}

function isWorkflowAttachmentAuthoringCurrent(input: Readonly<{
	attachment: ReturnType<typeof mapAttachment>;
	pinnedVersionData: string | undefined;
	liveFlowData: string | undefined;
}>): boolean {
	if (input.pinnedVersionData === undefined || input.liveFlowData === undefined) return false;
	if (normalizeFlowDataForComparison(input.pinnedVersionData) === normalizeFlowDataForComparison(input.liveFlowData)) {
		return true;
	}
	try {
		return describeWorkflowAuthoringGraphDifference(
			readStoredFlowGraph(input.pinnedVersionData),
			readStoredFlowGraph(input.liveFlowData),
			{ stripInvocationMediaOverrides: input.attachment.sourceVersionId.startsWith("workflow-version-") },
		).equal;
	} catch {
		return false;
	}
}

export async function resolveEquippedWorkflowExecutionTarget(
	c: AppContext,
	userId: string,
	attachmentId: string,
) {
	const db = c.env.DB;
	const row = await db.agent_capability_attachments.findFirst({
		where: {
			id: attachmentId,
			capability_kind: "workflow",
			OR: [{ user_id: userId }, { scope: "all_users" }],
		},
	});
	if (!row) throw new AppError("该能力未装配或不属于当前用户", { status: 404, code: "capability_attachment_not_found" });
	const attachment = mapAttachment(row);
	if (!attachment.routingReady) {
		throw new AppError("该工作流尚未确认使用关系，请在 Agent 配置中重新检查并更新", {
			status: 409,
			code: "capability_attachment_routing_unconfirmed",
		});
	}
	// 系统级工作流：用户可手动关闭（针对自己隐藏/禁止执行）。
	if (attachment.scope === "all_users") {
		const disabledSourceIds = await listUserDisabledWorkflowSourceIds(c, userId);
		if (disabledSourceIds.has(attachment.sourceId)) {
			throw new AppError("你已手动关闭该系统级工作流；请在 Agent 配置中重新启用后再调用", {
				status: 403,
				code: "capability_workflow_disabled_by_user",
			});
		}
	}
	const flow = await db.flows.findFirst({ where: { id: attachment.sourceId } });
	if (!flow) throw new AppError("已添加的工作流不存在", { status: 409, code: "capability_source_missing" });
	// 系统级工作流（all_users）由管理员发布给全体用户使用，执行身份是调用者自己、
	// 媒体写回调用者画布、计费挂调用者项目，因此不要求调用者拥有管理员工作流项目
	// 的访问权；personal（current_user）装配仍保持原有项目访问闸门。
	if (attachment.scope !== "all_users") {
		if (flow.project_id) {
			const project = await getProjectAccessSummary(db, flow.project_id, userId);
			if (!project) throw new AppError("已失去该工作流所属项目的访问权限", { status: 403, code: "capability_source_access_revoked" });
		} else if (flow.owner_id !== userId) {
			throw new AppError("已失去该工作流的访问权限", { status: 403, code: "capability_source_access_revoked" });
		}
	}
	// 版本流包含三种来源：用户画布保存（真实内容变化）、执行启动快照
	// （workflow-version-<executionId>，内容=触发时模板）、执行中物化版本（UUID，
	// 内容含 fan-out 中间节点，终态由 stripWorkflowFanoutNodes 从 flow 主表剥离）。
	// stale 判定应基于 flow 主表当前数据（终态后=干净模板）与装配版本的内容等价性，
	// 而不是最新版本 id——执行快照与执行中物化都不应让装配关系失效。
	const attachedVersion = await db.flow_versions.findUnique({
		where: { id: attachment.sourceVersionId },
		select: { data: true },
	});
	if (!attachedVersion) {
		throw new AppError("已装配的工作流版本不存在", { status: 409, code: "capability_attachment_version_missing" });
	}
	assertVideoWorkflowCanvasDefinitionCurrent(attachedVersion.data);
	const attachedData = normalizeFlowDataForComparison(attachedVersion.data);
	const liveFlowData = normalizeFlowDataForComparison(String(flow.data ?? ""));
	if (liveFlowData !== attachedData) {
		// flow 主表数据与装配版本不一致：可能是真实画布编辑，也可能是历史/当前
		// 执行产物与运行遥测。两边都先投影为纯作者图再比较；只有模板节点或 DAG
		// 连线的真实变化才会令装配失效。
		const live = readStoredFlowGraph(flow.data);
		const attached = readStoredFlowGraph(attachedVersion.data);
		const authoringDifference = describeWorkflowAuthoringGraphDifference(attached, live, {
			// Historical attachments could accidentally point at the deterministic execution
			// snapshot. Its per-call media overrides are invocation facts, not authoring edits.
			stripInvocationMediaOverrides: attachment.sourceVersionId.startsWith("workflow-version-"),
		});
		if (!authoringDifference.equal) {
			console.info(JSON.stringify({
				type: "workflow_capability_stale_diagnostic",
				attachmentId,
				flowId: flow.id,
				attachedVersionId: attachment.sourceVersionId,
				...authoringDifference,
			}));
			throw new AppError("工作流数据已变化，原配置已失效；请在 Agent 配置中重新检查并更新", {
				status: 409,
				code: "capability_attachment_stale",
				terminal: true,
				details: { attachedVersionId: attachment.sourceVersionId, authoringDifference },
			});
		}
	}
	const runtimeAttachment = {
		...attachment,
		descriptor: {
			...attachment.descriptor,
			invocation: deriveWorkflowInvocationContractFromVersionData(attachedVersion.data),
		},
	};
	return {
		attachment: runtimeAttachment,
		// Execution consumes the exact saved version that passed capability inspection.
		// Do not read a possibly newer mutable flow.data snapshot after authorization.
		flow: { ...flow, data: attachedVersion.data },
	};
}

type StoredFlowNode = Readonly<Record<string, unknown> & { id: string; data?: unknown }>;
type StoredFlowEdge = Readonly<Record<string, unknown> & {
	id?: unknown;
	source?: unknown;
	target?: unknown;
}>;
type StoredFlowGraph = Readonly<{
	nodes: readonly StoredFlowNode[];
	edges: readonly StoredFlowEdge[];
}>;

function readStoredFlowGraph(rawData: string): StoredFlowGraph {
	try {
		const parsed = JSON.parse(rawData || "{}") as Record<string, unknown>;
		const nodes = Array.isArray(parsed.nodes)
			? parsed.nodes.filter((node): node is StoredFlowNode => (
				Boolean(node)
				&& typeof node === "object"
				&& !Array.isArray(node)
				&& typeof (node as Record<string, unknown>).id === "string"
			))
			: [];
		const edges = Array.isArray(parsed.edges)
			? parsed.edges.filter((edge): edge is StoredFlowEdge => (
				Boolean(edge) && typeof edge === "object" && !Array.isArray(edge)
			))
			: [];
		return { nodes, edges };
	} catch {
		return { nodes: [], edges: [] };
	}
}

function isWorkflowExecutionArtifactNode(node: StoredFlowNode): boolean {
	const data = node.data;
	if (!data || typeof data !== "object" || Array.isArray(data)) return false;
	const record = data as Record<string, unknown>;
	if (typeof record.workflowExecutionId !== "string" || !record.workflowExecutionId.trim()) return false;
	return node.id.includes("::item::")
		|| (node.id.startsWith("film-") && record.kind === "composeVideo");
}

const WORKFLOW_INVOCATION_MEDIA_OVERRIDE_KEYS = new Set([
	"workflowVideoModelKey",
	"workflowVideoResolution",
	"workflowVideoAspectRatio",
]);

// React Flow presentation state is not part of the executable workflow contract.
// Moving/resizing/selecting a node must not revoke an attachment whose stage data
// and DAG edges are unchanged.
const WORKFLOW_AUTHORING_PRESENTATION_NODE_KEYS = new Set([
	"position",
	"positionAbsolute",
	"selected",
	"dragging",
	"resizing",
	"width",
	"height",
	"measured",
]);

function stripWorkflowAuthoringPresentationState(node: StoredFlowNode): StoredFlowNode {
	return Object.fromEntries(
		Object.entries(node).filter(([key]) => !WORKFLOW_AUTHORING_PRESENTATION_NODE_KEYS.has(key)),
	) as StoredFlowNode;
}

function isExecutableWorkflowAuthoringNode(node: StoredFlowNode): boolean {
	const data = node.data;
	if (!data || typeof data !== "object" || Array.isArray(data)) return false;
	const kind = (data as Record<string, unknown>).kind;
	return kind === "workflowTrigger" || kind === "workflowStage";
}

/**
 * Workflow execution consumes edge identity, endpoints and typed port handles.
 * React Flow presentation/default fields such as `type`, `animated`, selection,
 * style and empty `data` do not change the executable DAG and must not revoke an
 * already frozen capability attachment.
 */
function normalizeWorkflowAuthoringEdge(edge: StoredFlowEdge): StoredFlowEdge {
	return {
		...(typeof edge.id === "string" && edge.id.trim() ? { id: edge.id.trim() } : {}),
		source: edge.source,
		target: edge.target,
		...(typeof edge.sourceHandle === "string" && edge.sourceHandle.trim()
			? { sourceHandle: edge.sourceHandle.trim() }
			: {}),
		...(typeof edge.targetHandle === "string" && edge.targetHandle.trim()
			? { targetHandle: edge.targetHandle.trim() }
			: {}),
	};
}

function normalizeWorkflowAuthoringGraph(
	graph: StoredFlowGraph,
	options: Readonly<{ stripInvocationMediaOverrides: boolean }>,
): StoredFlowGraph {
	const nodes = graph.nodes
		.filter((node) => !isWorkflowExecutionArtifactNode(node) && isExecutableWorkflowAuthoringNode(node))
		.map((node) => {
			const authoringNode = stripWorkflowAuthoringPresentationState(node);
			if (!authoringNode.data || typeof authoringNode.data !== "object" || Array.isArray(authoringNode.data)) {
				return authoringNode;
			}
			const authoringData = stripWorkflowAuthoringRuntimeData(authoringNode.data as Record<string, unknown>);
			return {
				...authoringNode,
				data: options.stripInvocationMediaOverrides
					? Object.fromEntries(Object.entries(authoringData).filter(
						([key]) => !WORKFLOW_INVOCATION_MEDIA_OVERRIDE_KEYS.has(key),
					))
					: authoringData,
			};
		})
		.sort((left, right) => left.id.localeCompare(right.id));
	const authoringNodeIds = new Set(nodes.map((node) => node.id));
	const edges = graph.edges
		.filter((edge) => (
			typeof edge.source === "string"
			&& typeof edge.target === "string"
			&& authoringNodeIds.has(edge.source)
			&& authoringNodeIds.has(edge.target)
		))
		.map(normalizeWorkflowAuthoringEdge)
		.sort((left, right) => (
			normalizeFlowDataForComparison(JSON.stringify(left))
				.localeCompare(normalizeFlowDataForComparison(JSON.stringify(right)))
		));
	return { nodes, edges };
}

/**
 * 比较真正可编辑、可执行的工作流作者图。
 *
 * 两边的 fan-out/成片运行产物及其边都会被排除，模板节点上的运行遥测也会被
 * 剥离；模板配置、指令、模型、工具、节点增删和 DAG 连线仍参与严格比较。
 */
type WorkflowAuthoringNodeDifference = Readonly<{
	id: string;
	nodeFields: readonly string[];
	dataFields: readonly string[];
}>;

type WorkflowAuthoringGraphDifference = Readonly<{
	equal: boolean;
	attachedSha256: string;
	liveSha256: string;
	addedNodeIds: readonly string[];
	removedNodeIds: readonly string[];
	changedNodes: readonly WorkflowAuthoringNodeDifference[];
	addedEdgeIds: readonly string[];
	removedEdgeIds: readonly string[];
}>;

function normalizedJson(value: unknown): string {
	return normalizeFlowDataForComparison(JSON.stringify(value));
}

function differingRecordKeys(left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>): string[] {
	return [...new Set([...Object.keys(left), ...Object.keys(right)])]
		.filter((key) => normalizedJson(left[key]) !== normalizedJson(right[key]))
		.sort();
}

function edgeDiagnosticId(edge: StoredFlowEdge): string {
	if (typeof edge.id === "string" && edge.id.trim()) return edge.id;
	return stableStateSha256(edge).slice(0, 16);
}

function describeWorkflowAuthoringGraphDifference(
	attached: StoredFlowGraph,
	live: StoredFlowGraph,
	options: Readonly<{ stripInvocationMediaOverrides: boolean }> = { stripInvocationMediaOverrides: false },
): WorkflowAuthoringGraphDifference {
	const attachedAuthoringGraph = normalizeWorkflowAuthoringGraph(attached, options);
	const liveAuthoringGraph = normalizeWorkflowAuthoringGraph(live, options);
	const attachedJson = normalizedJson(attachedAuthoringGraph);
	const liveJson = normalizedJson(liveAuthoringGraph);
	const attachedNodes = new Map(attachedAuthoringGraph.nodes.map((node) => [node.id, node] as const));
	const liveNodes = new Map(liveAuthoringGraph.nodes.map((node) => [node.id, node] as const));
	const addedNodeIds = [...liveNodes.keys()].filter((id) => !attachedNodes.has(id)).sort();
	const removedNodeIds = [...attachedNodes.keys()].filter((id) => !liveNodes.has(id)).sort();
	const changedNodes = [...liveNodes.entries()].flatMap(([id, liveNode]) => {
		const attachedNode = attachedNodes.get(id);
		if (!attachedNode || normalizedJson(attachedNode) === normalizedJson(liveNode)) return [];
		const { data: attachedData, ...attachedNodeFields } = attachedNode;
		const { data: liveData, ...liveNodeFields } = liveNode;
		return [{
			id,
			nodeFields: differingRecordKeys(attachedNodeFields, liveNodeFields),
			dataFields: differingRecordKeys(
				attachedData && typeof attachedData === "object" && !Array.isArray(attachedData)
					? attachedData as Record<string, unknown>
					: {},
				liveData && typeof liveData === "object" && !Array.isArray(liveData)
					? liveData as Record<string, unknown>
					: {},
			),
		}];
	});
	const attachedEdges = new Map(attachedAuthoringGraph.edges.map((edge) => [normalizedJson(edge), edge] as const));
	const liveEdges = new Map(liveAuthoringGraph.edges.map((edge) => [normalizedJson(edge), edge] as const));
	return {
		equal: attachedJson === liveJson,
		attachedSha256: stableStateSha256(attachedAuthoringGraph),
		liveSha256: stableStateSha256(liveAuthoringGraph),
		addedNodeIds,
		removedNodeIds,
		changedNodes,
		addedEdgeIds: [...liveEdges.entries()]
			.filter(([signature]) => !attachedEdges.has(signature))
			.map(([, edge]) => edgeDiagnosticId(edge))
			.sort(),
		removedEdgeIds: [...attachedEdges.entries()]
			.filter(([signature]) => !liveEdges.has(signature))
			.map(([, edge]) => edgeDiagnosticId(edge))
			.sort(),
	};
}

/** 稳定规范化 JSON 字符串（递归排序键），仅用于 flow 内容等价判定，不参与语义判断。 */
function normalizeFlowDataForComparison(rawData: string): string {
	try {
		const sortKeys = (input: unknown): unknown => {
			if (Array.isArray(input)) return input.map(sortKeys);
			if (input && typeof input === "object") {
				return Object.fromEntries(
					Object.entries(input as Record<string, unknown>)
						.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
						.map(([key, item]) => [key, sortKeys(item)]),
				);
			}
			return input;
		};
		return JSON.stringify(sortKeys(JSON.parse(rawData || "{}")));
	} catch {
		return rawData;
	}
}
