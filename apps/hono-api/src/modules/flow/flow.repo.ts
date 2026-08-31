import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import type { FlowDto } from "./flow.schemas";
import { mergeFlowStorageEnvelope, readFlowOwnerMeta } from "./flow.storage-envelope";

export type FlowRow = {
	id: string;
	name: string;
	data: string;
	owner_id: string | null;
	project_id: string | null;
	created_at: string;
	updated_at: string;
	// DB flows 行为 NOT NULL DEFAULT 0，真实查询回来一定有值；设可选是为兼容
	// synthetic FlowRow（章节画布伪造）和测试 mock 无需构造此字段。乐观锁逻辑用
	// expectedRevision 入参 + DB where/select，不依赖本 type 字段是否必填。
	canvas_revision?: number;
};

// 所有画布写入口共享同一个乐观锁版本。用户整图保存和 agent 增量回灌只要携带的
// canvas_revision 落后于最新值，就抛出本错误；调用方必须重读并基于新事实重放变更。
export class FlowRevisionConflictError extends Error {
	constructor(
		public flowId: string,
		public expected: number,
		public actual: number,
	) {
		super(`Flow revision conflict on ${flowId}: expected ${expected}, actual ${actual}`);
		this.name = "FlowRevisionConflictError";
	}
}

export type FlowVersionRow = {
	id: string;
	flow_id: string;
	name: string;
	data: string;
	user_id: string | null;
	created_at: string;
};

export type FlowVersionListRow = Pick<FlowVersionRow, "id" | "name" | "created_at">;

function parseFlowData(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
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
		canvasRevision: row.canvas_revision ?? 0,
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
		expectedRevision?: number | null;
		source?: "user" | "agent";
	},
): Promise<FlowRow | null> {
	void db;
	const { id, name, data, ownerId, projectId, nowIso, expectedRevision } = params;
	const useLock = typeof expectedRevision === "number";
	const prisma = getPrismaClient();
	const current = await prisma.flows.findFirst({
		where: { id, owner_id: ownerId },
		select: { data: true },
	});
	if (!current) return null;
	const mergedData = mergeFlowStorageEnvelope(current.data, data);
	const result = await prisma.flows.updateMany({
		where: useLock ? { id, owner_id: ownerId, canvas_revision: expectedRevision } : { id, owner_id: ownerId },
		data: {
			name,
			data: mergedData,
			owner_id: ownerId,
			project_id: projectId ?? null,
			updated_at: nowIso,
			canvas_revision: { increment: 1 },
		},
	});
	if (result.count === 0 && useLock) {
		const currentRevision = await prisma.flows.findFirst({
			where: { id, owner_id: ownerId },
			select: { canvas_revision: true },
		});
		if (currentRevision) {
			throw new FlowRevisionConflictError(id, expectedRevision as number, currentRevision.canvas_revision);
		}
	}
	return getFlowForOwner(db, id, ownerId);
}

export async function updateFlowByIdUnsafe(
	db: PrismaClient,
	params: {
		id: string;
		name: string;
		data: string;
		nowIso: string;
		expectedRevision?: number | null;
		source?: "user" | "agent";
	},
): Promise<FlowRow | null> {
	void db;
	const { id, name, data, nowIso, expectedRevision } = params;
	const useLock = typeof expectedRevision === "number";
	const prisma = getPrismaClient();
	const current = await prisma.flows.findFirst({
		where: { id },
		select: { data: true },
	});
	if (!current) return null;
	const mergedData = mergeFlowStorageEnvelope(current.data, data);
	const result = await prisma.flows.updateMany({
		where: useLock ? { id, canvas_revision: expectedRevision } : { id },
		data: {
			name,
			data: mergedData,
			updated_at: nowIso,
			canvas_revision: { increment: 1 },
		},
	});
	if (result.count === 0 && useLock) {
		const currentRevision = await prisma.flows.findFirst({
			where: { id },
			select: { canvas_revision: true },
		});
		if (currentRevision) {
			throw new FlowRevisionConflictError(id, expectedRevision as number, currentRevision.canvas_revision);
		}
	}
	return getFlowByIdUnsafe(db, id);
}

export async function replaceFlowDataIfUnchanged(
	db: PrismaClient,
	params: {
		id: string;
		projectId: string;
		expectedData: string;
		expectedUpdatedAt: string;
		nextData: string;
		nowIso: string;
	},
): Promise<FlowRow | null> {
	void db;
	const { id, projectId, expectedData, expectedUpdatedAt, nextData, nowIso } = params;
	const result = await getPrismaClient().flows.updateMany({
		where: {
			id,
			project_id: projectId,
			data: expectedData,
			updated_at: expectedUpdatedAt,
		},
		data: {
			data: nextData,
			updated_at: nowIso,
		},
	});
	if (result.count !== 1) return null;
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

export async function listFlowVersionPage(
	db: PrismaClient,
	flowId: string,
	options: Readonly<{ limit: number; cursor?: string }>,
): Promise<Readonly<{ items: FlowVersionListRow[]; nextCursor: string | null }>> {
	void db;
	const limit = Math.max(1, Math.min(100, Math.floor(options.limit)));
	const rows = await getPrismaClient().flow_versions.findMany({
		where: { flow_id: flowId },
		select: { id: true, name: true, created_at: true },
		orderBy: [{ created_at: "desc" }, { id: "desc" }],
		...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
		take: limit + 1,
	});
	const hasMore = rows.length > limit;
	const items = hasMore ? rows.slice(0, limit) : rows;
	return {
		items,
		nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
	};
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
