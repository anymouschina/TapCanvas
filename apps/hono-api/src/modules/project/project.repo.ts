import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { deleteProjectGraph } from "./project-delete";

export type ProjectRow = {
	id: string;
	name: string;
	is_public: number;
	owner_id: string | null;
	created_at: string;
	updated_at: string;
	owner_login?: string | null;
	owner_name?: string | null;
	template_title?: string | null;
	template_description?: string | null;
	template_cover_url?: string | null;
};

type TemplateMeta = {
	title: string | null;
	description: string | null;
	coverUrl: string | null;
};

function normalizeNonEmptyString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function resolveFlowNodePrimaryImageUrl(node: unknown): string | null {
	if (!node || typeof node !== "object") return null;
	const typedNode = node as {
		type?: unknown;
		data?: unknown;
	};
	if (typedNode.type !== "taskNode") return null;
	if (!typedNode.data || typeof typedNode.data !== "object") return null;
	const data = typedNode.data as {
		imageResults?: unknown;
		imagePrimaryIndex?: unknown;
		imageUrl?: unknown;
	};

	const imageResults = Array.isArray(data.imageResults) ? data.imageResults : [];
	const imagePrimaryIndexRaw =
		typeof data.imagePrimaryIndex === "number"
			? data.imagePrimaryIndex
			: Number(data.imagePrimaryIndex);
	const imagePrimaryIndex = Number.isFinite(imagePrimaryIndexRaw)
		? Math.max(0, Math.floor(imagePrimaryIndexRaw))
		: 0;

	const preferredResult = imageResults[imagePrimaryIndex];
	if (preferredResult && typeof preferredResult === "object") {
		const preferredUrl = normalizeNonEmptyString(
			(preferredResult as { url?: unknown }).url,
		);
		if (preferredUrl) return preferredUrl;
	}

	for (const result of imageResults) {
		if (!result || typeof result !== "object") continue;
		const url = normalizeNonEmptyString((result as { url?: unknown }).url);
		if (url) return url;
	}

	return normalizeNonEmptyString(data.imageUrl);
}

function resolveTemplateCoverUrlFromFlowData(data: string): string | null {
	try {
		const parsed = JSON.parse(data) as { nodes?: unknown };
		const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
		for (const node of nodes) {
			const imageUrl = resolveFlowNodePrimaryImageUrl(node);
			if (imageUrl) return imageUrl;
		}
		return null;
	} catch {
		return null;
	}
}

function parseTemplateMeta(data: string | null): TemplateMeta {
	if (!data) return { title: null, description: null, coverUrl: null };
	try {
		const parsed = JSON.parse(data) as {
			kind?: unknown;
			title?: unknown;
			description?: unknown;
			coverUrl?: unknown;
		};
		if (parsed.kind !== "workflowTemplateMeta") {
			return { title: null, description: null, coverUrl: null };
		}
		return {
			title: typeof parsed.title === "string" ? parsed.title : null,
			description:
				typeof parsed.description === "string" ? parsed.description : null,
			coverUrl: typeof parsed.coverUrl === "string" ? parsed.coverUrl : null,
		};
	} catch {
		return { title: null, description: null, coverUrl: null };
	}
}

async function loadTemplateMetaMap(
	projectIds: string[],
): Promise<Map<string, TemplateMeta>> {
	const metaMap = new Map<string, TemplateMeta>();
	if (projectIds.length === 0) return metaMap;
	const rows = await getPrismaClient().assets.findMany({
		where: {
			project_id: { in: projectIds },
			data: { contains: `"kind":"workflowTemplateMeta"` },
		},
		orderBy: [{ updated_at: "desc" }, { id: "desc" }],
		select: {
			project_id: true,
			data: true,
		},
	});
	for (const row of rows) {
		if (!row.project_id || metaMap.has(row.project_id)) continue;
		metaMap.set(row.project_id, parseTemplateMeta(row.data));
	}
	return metaMap;
}

async function loadDerivedTemplateCoverMap(
	projectIds: string[],
): Promise<Map<string, string>> {
	const coverMap = new Map<string, string>();
	if (projectIds.length === 0) return coverMap;
	const rows = await getPrismaClient().flows.findMany({
		where: {
			project_id: { in: projectIds },
		},
		orderBy: [{ updated_at: "desc" }, { id: "desc" }],
		select: {
			project_id: true,
			data: true,
		},
	});
	for (const row of rows) {
		if (!row.project_id || coverMap.has(row.project_id)) continue;
		const coverUrl = resolveTemplateCoverUrlFromFlowData(row.data);
		if (coverUrl) {
			coverMap.set(row.project_id, coverUrl);
		}
	}
	return coverMap;
}

function mapProjectRow(
	row: {
		id: string;
		name: string;
		is_public: number;
		owner_id: string | null;
		created_at: string;
		updated_at: string;
		users?: { login: string | null; name: string | null } | null;
	},
	metaMap: Map<string, TemplateMeta>,
	derivedCoverMap: Map<string, string>,
): ProjectRow {
	const meta = metaMap.get(row.id) ?? {
		title: null,
		description: null,
		coverUrl: null,
	};
	return {
		id: row.id,
		name: row.name,
		is_public: row.is_public,
		owner_id: row.owner_id,
		created_at: row.created_at,
		updated_at: row.updated_at,
		owner_login: row.users?.login ?? null,
		owner_name: row.users?.name ?? null,
		template_title: meta.title,
		template_description: meta.description,
		template_cover_url: meta.coverUrl ?? derivedCoverMap.get(row.id) ?? null,
	};
}

export async function listProjectsByOwner(
	db: PrismaClient,
	ownerId: string,
): Promise<ProjectRow[]> {
	void db;
	const projects = await getPrismaClient().projects.findMany({
		where: { owner_id: ownerId },
		orderBy: { updated_at: "desc" },
		include: {
			users: { select: { login: true, name: true } },
		},
	});
	const metaMap = await loadTemplateMetaMap(projects.map((p) => p.id));
	const derivedCoverMap = await loadDerivedTemplateCoverMap(
		projects.map((p) => p.id),
	);
	return projects.map((row) => mapProjectRow(row, metaMap, derivedCoverMap));
}

export async function listPublicProjects(db: PrismaClient): Promise<ProjectRow[]> {
	void db;
	const projects = await getPrismaClient().projects.findMany({
		where: { is_public: 1 },
		orderBy: { updated_at: "desc" },
		include: {
			users: { select: { login: true, name: true } },
		},
	});
	const metaMap = await loadTemplateMetaMap(projects.map((p) => p.id));
	const derivedCoverMap = await loadDerivedTemplateCoverMap(
		projects.map((p) => p.id),
	);
	return projects.map((row) => mapProjectRow(row, metaMap, derivedCoverMap));
}

export async function getProjectById(
	db: PrismaClient,
	projectId: string,
): Promise<ProjectRow | null> {
	void db;
	const row = await getPrismaClient().projects.findUnique({
		where: { id: projectId },
		include: {
			users: { select: { login: true, name: true } },
		},
	});
	if (!row) return null;
	const metaMap = await loadTemplateMetaMap([row.id]);
	const derivedCoverMap = await loadDerivedTemplateCoverMap([row.id]);
	return mapProjectRow(row, metaMap, derivedCoverMap);
}

export async function getProjectForOwner(
	db: PrismaClient,
	projectId: string,
	ownerId: string,
): Promise<ProjectRow | null> {
	void db;
	const row = await getPrismaClient().projects.findFirst({
		where: { id: projectId, owner_id: ownerId },
		include: {
			users: { select: { login: true, name: true } },
		},
	});
	if (!row) return null;
	const metaMap = await loadTemplateMetaMap([row.id]);
	const derivedCoverMap = await loadDerivedTemplateCoverMap([row.id]);
	return mapProjectRow(row, metaMap, derivedCoverMap);
}

export async function findLatestProjectForOwnerByNamePrefix(
	db: PrismaClient,
	input: {
		ownerId: string;
		namePrefix: string;
		excludeProjectId?: string;
	},
): Promise<ProjectRow | null> {
	void db;
	const row = await getPrismaClient().projects.findFirst({
		where: {
			owner_id: input.ownerId,
			name: { startsWith: input.namePrefix },
			...(input.excludeProjectId
				? { id: { not: input.excludeProjectId } }
				: {}),
		},
		orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
		include: {
			users: { select: { login: true, name: true } },
		},
	});
	if (!row) return null;
	const metaMap = await loadTemplateMetaMap([row.id]);
	const derivedCoverMap = await loadDerivedTemplateCoverMap([row.id]);
	return mapProjectRow(row, metaMap, derivedCoverMap);
}

export async function createProject(
	db: PrismaClient,
	params: { id: string; name: string; ownerId: string; nowIso: string },
): Promise<ProjectRow> {
	void db;
	const { id, name, ownerId, nowIso } = params;
	await getPrismaClient().projects.create({
		data: {
			id,
			name,
			is_public: 0,
			owner_id: ownerId,
			created_at: nowIso,
			updated_at: nowIso,
		},
	});
	const row = await getProjectById(db, id);
	if (!row) {
		throw new Error("Failed to load created project");
	}
	return row;
}

export async function updateProjectName(
	db: PrismaClient,
	params: { id: string; name: string; nowIso: string },
): Promise<ProjectRow | null> {
	void db;
	await getPrismaClient().projects.update({
		where: { id: params.id },
		data: { name: params.name, updated_at: params.nowIso },
	});
	return getProjectById(db, params.id);
}

export async function updateProjectPublic(
	db: PrismaClient,
	params: { id: string; isPublic: boolean; nowIso: string },
): Promise<ProjectRow | null> {
	void db;
	await getPrismaClient().projects.update({
		where: { id: params.id },
		data: { is_public: params.isPublic ? 1 : 0, updated_at: params.nowIso },
	});
	return getProjectById(db, params.id);
}

export async function deleteProjectById(
	db: PrismaClient,
	projectId: string,
): Promise<void> {
	void db;
	await deleteProjectGraph(projectId);
}
