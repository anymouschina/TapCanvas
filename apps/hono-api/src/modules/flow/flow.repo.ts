import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import type { FlowDto } from "./flow.schemas";

export type FlowRow = {
	id: string;
	name: string;
	data: string;
	owner_id: string | null;
	project_id: string | null;
	created_at: string;
	updated_at: string;
};

export type FlowVersionRow = {
	id: string;
	flow_id: string;
	name: string;
	data: string;
	user_id: string | null;
	created_at: string;
};

function parseFlowData(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function readFlowOwnerMeta(value: unknown): {
	ownerType: "project" | "chapter" | "shot" | null;
	ownerId: string | null;
} {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { ownerType: null, ownerId: null };
	}
	const record = value as Record<string, unknown>;
	const meta = record.__tapcanvasFlowOwner;
	if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
		return { ownerType: null, ownerId: null };
	}
	const ownerRecord = meta as Record<string, unknown>;
	const ownerType =
		ownerRecord.ownerType === "project" || ownerRecord.ownerType === "chapter" || ownerRecord.ownerType === "shot"
			? ownerRecord.ownerType
			: null;
	const ownerId =
		typeof ownerRecord.ownerId === "string" && ownerRecord.ownerId.trim()
			? ownerRecord.ownerId.trim()
			: null;
	return { ownerType, ownerId };
}

export function mapFlowRowToDto(row: FlowRow): FlowDto {
	const data = parseFlowData(row.data);
	const ownerMeta = readFlowOwnerMeta(data);
	return {
		id: row.id,
		name: row.name,
		data,
		ownerType: ownerMeta.ownerType,
		ownerId: ownerMeta.ownerId,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function listFlowsByOwner(
	db: PrismaClient,
	ownerId: string,
	projectId?: string,
): Promise<FlowRow[]> {
	void db;
	return getPrismaClient().flows.findMany({
		where: {
			owner_id: ownerId,
			...(projectId ? { project_id: projectId } : {}),
		},
		orderBy: { updated_at: "desc" },
	});
}

export async function listFlowsByProject(
	db: PrismaClient,
	projectId: string,
): Promise<FlowRow[]> {
	void db;
	return getPrismaClient().flows.findMany({
		where: { project_id: projectId },
		orderBy: { updated_at: "desc" },
	});
}

export async function getFlowForOwner(
	db: PrismaClient,
	id: string,
	ownerId: string,
): Promise<FlowRow | null> {
	void db;
	return getPrismaClient().flows.findFirst({
		where: { id, owner_id: ownerId },
	});
}

export async function getFlowByIdUnsafe(
	db: PrismaClient,
	id: string,
): Promise<FlowRow | null> {
	void db;
	return getPrismaClient().flows.findFirst({
		where: { id },
	});
}

export async function createFlow(
	db: PrismaClient,
	params: {
		id: string;
		name: string;
		data: string;
		ownerId: string;
		projectId?: string | null;
		nowIso: string;
	},
): Promise<FlowRow> {
	void db;
	const { id, name, data, ownerId, projectId, nowIso } = params;
	await getPrismaClient().flows.create({
		data: {
			id,
			name,
			data,
			owner_id: ownerId,
			project_id: projectId ?? null,
			created_at: nowIso,
			updated_at: nowIso,
		},
	});
	const row = await getFlowForOwner(db, id, ownerId);
	if (!row) {
		throw new Error("Failed to load created flow");
	}
	return row;
}

export async function updateFlow(
	db: PrismaClient,
	params: {
		id: string;
		name: string;
		data: string;
		ownerId: string;
		projectId?: string | null;
		nowIso: string;
	},
): Promise<FlowRow | null> {
	void db;
	const { id, name, data, ownerId, projectId, nowIso } = params;
	await getPrismaClient().flows.updateMany({
		where: { id, owner_id: ownerId },
		data: {
			name,
			data,
			owner_id: ownerId,
			project_id: projectId ?? null,
			updated_at: nowIso,
		},
	});
	return getFlowForOwner(db, id, ownerId);
}

export async function updateFlowByIdUnsafe(
	db: PrismaClient,
	params: {
		id: string;
		name: string;
		data: string;
		nowIso: string;
	},
): Promise<FlowRow | null> {
	void db;
	const { id, name, data, nowIso } = params;
	await getPrismaClient().flows.updateMany({
		where: { id },
		data: {
			name,
			data,
			updated_at: nowIso,
		},
	});
	return getFlowByIdUnsafe(db, id);
}

export async function deleteFlowById(
	db: PrismaClient,
	id: string,
	ownerId: string,
): Promise<void> {
	void db;
	const prisma = getPrismaClient();
	await prisma.$transaction([
		prisma.flow_versions.deleteMany({ where: { flow_id: id } }),
		prisma.flows.deleteMany({ where: { id, owner_id: ownerId } }),
	]);
}

export async function createFlowVersion(
	db: PrismaClient,
	params: {
		id: string;
		flowId: string;
		name: string;
		data: string;
		userId: string;
		nowIso: string;
	},
): Promise<void> {
	void db;
	const { id, flowId, name, data, userId, nowIso } = params;
	await getPrismaClient().flow_versions.create({
		data: {
			id,
			flow_id: flowId,
			name,
			data,
			user_id: userId,
			created_at: nowIso,
		},
	});
}

export async function listFlowVersions(
	db: PrismaClient,
	flowId: string,
): Promise<FlowVersionRow[]> {
	void db;
	return getPrismaClient().flow_versions.findMany({
		where: { flow_id: flowId },
		orderBy: { created_at: "desc" },
	});
}

export async function getFlowVersion(
	db: PrismaClient,
	versionId: string,
	flowId: string,
): Promise<FlowVersionRow | null> {
	void db;
	return getPrismaClient().flow_versions.findFirst({
		where: { id: versionId, flow_id: flowId },
	});
}
