import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";

type AgentSkillRow = {
	id: string;
	key: string;
	name: string;
	description: string | null;
	content: string;
	enabled: number;
	visible: number;
	sort_order: number | null;
	created_at: string;
	updated_at: string;
};

type AgentPipelineRunRow = {
	id: string;
	owner_id: string;
	project_id: string;
	title: string;
	goal: string | null;
	status: string;
	stages_json: string;
	progress_json: string | null;
	result_json: string | null;
	error_message: string | null;
	created_at: string;
	updated_at: string;
	started_at: string | null;
	finished_at: string | null;
};

export async function ensureAgentsSchema(db: PrismaClient): Promise<void> {
	void db;
}

export async function listAgentSkillsRows(
	db: PrismaClient,
	input?: { enabled?: boolean; visible?: boolean },
): Promise<AgentSkillRow[]> {
	void db;
	const rows = await getPrismaClient().agent_skills.findMany({
		where: {
			...(typeof input?.enabled === "boolean"
				? { enabled: input.enabled ? 1 : 0 }
				: {}),
			...(typeof input?.visible === "boolean"
				? { visible: input.visible ? 1 : 0 }
				: {}),
		},
		orderBy: [{ updated_at: "desc" }],
	});
	return rows.sort((a, b) => {
		const aOrder = a.sort_order;
		const bOrder = b.sort_order;
		if (aOrder == null && bOrder == null) return 0;
		if (aOrder == null) return 1;
		if (bOrder == null) return -1;
		return aOrder - bOrder;
	});
}

export async function getAgentSkillRowById(
	db: PrismaClient,
	id: string,
): Promise<AgentSkillRow | null> {
	void db;
	return getPrismaClient().agent_skills.findUnique({ where: { id } });
}

export async function getAgentSkillRowByKey(
	db: PrismaClient,
	key: string,
): Promise<AgentSkillRow | null> {
	void db;
	return getPrismaClient().agent_skills.findUnique({ where: { key } });
}

export async function upsertAgentSkillRow(
	db: PrismaClient,
	input: {
		id: string;
		key: string;
		name: string;
		description: string | null;
		content: string;
		enabled: boolean;
		visible: boolean;
		sortOrder: number | null;
	},
	nowIso: string,
): Promise<AgentSkillRow> {
	void db;
	const row = await getPrismaClient().agent_skills.upsert({
		where: { key: input.key },
		create: {
			id: input.id,
			key: input.key,
			name: input.name,
			description: input.description,
			content: input.content,
			enabled: input.enabled ? 1 : 0,
			visible: input.visible ? 1 : 0,
			sort_order: input.sortOrder,
			created_at: nowIso,
			updated_at: nowIso,
		},
		update: {
			name: input.name,
			description: input.description,
			content: input.content,
			enabled: input.enabled ? 1 : 0,
			visible: input.visible ? 1 : 0,
			sort_order: input.sortOrder,
			updated_at: nowIso,
		},
	});
	return row;
}

export async function deleteAgentSkillRow(
	db: PrismaClient,
	id: string,
): Promise<void> {
	void db;
	await getPrismaClient().agent_skills.deleteMany({ where: { id } });
}

export async function listAgentPipelineRunsRows(
	db: PrismaClient,
	input: { ownerId: string; projectId?: string | null; limit?: number },
): Promise<AgentPipelineRunRow[]> {
	void db;
	const limit =
		typeof input.limit === "number" && Number.isFinite(input.limit)
			? Math.max(1, Math.min(200, Math.trunc(input.limit)))
			: 50;
	return getPrismaClient().agent_pipeline_runs.findMany({
		where: {
			owner_id: input.ownerId,
			...(typeof input.projectId === "string" && input.projectId.trim()
				? { project_id: input.projectId.trim() }
				: {}),
		},
		orderBy: { updated_at: "desc" },
		take: limit,
	});
}

export async function getAgentPipelineRunRowById(
	db: PrismaClient,
	input: { id: string; ownerId: string },
): Promise<AgentPipelineRunRow | null> {
	void db;
	return getPrismaClient().agent_pipeline_runs.findFirst({
		where: { id: input.id, owner_id: input.ownerId },
	});
}

export async function createAgentPipelineRunRow(
	db: PrismaClient,
	input: {
		id: string;
		ownerId: string;
		projectId: string;
		title: string;
		goal: string | null;
		status: string;
		stagesJson: string;
		nowIso: string;
	},
): Promise<AgentPipelineRunRow> {
	void db;
	await getPrismaClient().agent_pipeline_runs.create({
		data: {
			id: input.id,
			owner_id: input.ownerId,
			project_id: input.projectId,
			title: input.title,
			goal: input.goal,
			status: input.status,
			stages_json: input.stagesJson,
			created_at: input.nowIso,
			updated_at: input.nowIso,
		},
	});
	const row = await getAgentPipelineRunRowById(db, {
		id: input.id,
		ownerId: input.ownerId,
	});
	if (!row) throw new Error("agent pipeline run create failed");
	return row;
}

export async function updateAgentPipelineRunRow(
	db: PrismaClient,
	input: {
		id: string;
		ownerId: string;
		status: string;
		progressJson?: string | null;
		resultJson?: string | null;
		errorMessage?: string | null;
		startedAt?: string | null;
		finishedAt?: string | null;
		nowIso: string;
	},
): Promise<AgentPipelineRunRow | null> {
	void db;
	const data: {
		status: string;
		progress_json?: string | null;
		result_json?: string | null;
		error_message: string | null;
		started_at?: string | null;
		finished_at: string | null;
		updated_at: string;
	} = {
		status: input.status,
		error_message:
			typeof input.errorMessage === "undefined" ? null : input.errorMessage,
		finished_at:
			typeof input.finishedAt === "undefined" ? null : input.finishedAt,
		updated_at: input.nowIso,
	};

	if (typeof input.progressJson !== "undefined") {
		data.progress_json = input.progressJson;
	}
	if (typeof input.resultJson !== "undefined") {
		data.result_json = input.resultJson;
	}
	if (typeof input.startedAt !== "undefined") {
		data.started_at = input.startedAt;
	}

	await getPrismaClient().agent_pipeline_runs.updateMany({
		where: { id: input.id, owner_id: input.ownerId },
		data,
	});
	return getAgentPipelineRunRowById(db, { id: input.id, ownerId: input.ownerId });
}

export type { AgentSkillRow, AgentPipelineRunRow };
