import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";

export type AdminProjectRow = {
	id: string;
	name: string;
	is_public: number;
	owner_id: string | null;
	created_at: string;
	updated_at: string;
	owner_login?: string | null;
	owner_name?: string | null;
	flow_count?: number | null;
	template_title?: string | null;
	template_description?: string | null;
	template_cover_url?: string | null;
};

type TemplateMeta = {
	title: string | null;
	description: string | null;
	coverUrl: string | null;
};

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
		select: { project_id: true, data: true },
	});
	for (const row of rows) {
		if (!row.project_id || metaMap.has(row.project_id)) continue;
		metaMap.set(row.project_id, parseTemplateMeta(row.data));
	}
	return metaMap;
}

export async function listProjectsForAdmin(
	db: PrismaClient,
	input: {
		q?: string | null;
		ownerId?: string | null;
		isPublic?: boolean;
		limit: number;
	},
): Promise<AdminProjectRow[]> {
	void db;
	const q = (input.q || "").trim();
	const rows = await getPrismaClient().projects.findMany({
		where: {
			...(typeof input.isPublic === "boolean"
				? { is_public: input.isPublic ? 1 : 0 }
				: {}),
			...(input.ownerId && input.ownerId.trim()
				? { owner_id: input.ownerId.trim() }
				: {}),
			...(q
				? {
						OR: [
							{ name: { contains: q, mode: "insensitive" } },
							{ id: { contains: q, mode: "insensitive" } },
							{ owner_id: { contains: q, mode: "insensitive" } },
							{ users: { is: { login: { contains: q, mode: "insensitive" } } } },
							{ users: { is: { name: { contains: q, mode: "insensitive" } } } },
						],
					}
				: {}),
		},
		include: {
			users: { select: { login: true, name: true } },
			_count: { select: { flows: true } },
		},
		orderBy: [{ updated_at: "desc" }, { id: "desc" }],
		take: input.limit,
	});

	const metaMap = await loadTemplateMetaMap(rows.map((row) => row.id));
	return rows.map((row) => {
		const meta = metaMap.get(row.id);
		return {
			id: row.id,
			name: row.name,
			is_public: row.is_public,
			owner_id: row.owner_id,
			created_at: row.created_at,
			updated_at: row.updated_at,
			owner_login: row.users?.login ?? null,
			owner_name: row.users?.name ?? null,
			template_title: meta?.title ?? null,
			template_description: meta?.description ?? null,
			template_cover_url: meta?.coverUrl ?? null,
			flow_count: row._count.flows,
		};
	});
}

export async function getProjectForAdmin(
	db: PrismaClient,
	projectId: string,
): Promise<AdminProjectRow | null> {
	void db;
	const row = await getPrismaClient().projects.findUnique({
		where: { id: projectId },
		include: {
			users: { select: { login: true, name: true } },
			_count: { select: { flows: true } },
		},
	});
	if (!row) return null;
	const metaMap = await loadTemplateMetaMap([row.id]);
	const meta = metaMap.get(row.id);
	return {
		id: row.id,
		name: row.name,
		is_public: row.is_public,
		owner_id: row.owner_id,
		created_at: row.created_at,
		updated_at: row.updated_at,
		owner_login: row.users?.login ?? null,
		owner_name: row.users?.name ?? null,
		template_title: meta?.title ?? null,
		template_description: meta?.description ?? null,
		template_cover_url: meta?.coverUrl ?? null,
		flow_count: row._count.flows,
	};
}
