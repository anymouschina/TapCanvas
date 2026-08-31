import { describe, it, expect, vi, beforeEach } from "vitest";

// 内存 flows 表 + prisma 桩
type Row = {
	id: string;
	name: string;
	data: string;
	owner_id: string | null;
	project_id: string | null;
	created_at: string;
	updated_at: string;
	canvas_revision: number;
};
const rows = new Map<string, Row>();
function match(row: Row, where: any): boolean {
	if (where.id !== undefined && row.id !== where.id) return false;
	if (where.owner_id !== undefined && row.owner_id !== where.owner_id) return false;
	if (where.canvas_revision !== undefined && row.canvas_revision !== where.canvas_revision) return false;
	return true;
}
const prismaStub = {
	flows: {
		updateMany: vi.fn(async ({ where, data }: any) => {
			let count = 0;
			for (const row of rows.values()) {
				if (!match(row, where)) continue;
				if (data.name !== undefined) row.name = data.name;
				if (data.data !== undefined) row.data = data.data;
				if (data.updated_at !== undefined) row.updated_at = data.updated_at;
				if (data.canvas_revision?.increment) row.canvas_revision += data.canvas_revision.increment;
				count++;
			}
			return { count };
		}),
		findFirst: vi.fn(async ({ where }: any) => {
			for (const row of rows.values()) if (match(row, where)) return { ...row };
			return null;
		}),
	},
};

// ⚠️ 与 plan 占位路径不同：flow.repo.ts 实际从 "../../platform/node/prisma" import getPrismaClient。
vi.mock("../../platform/node/prisma", () => ({ getPrismaClient: () => prismaStub }));

import { updateFlowByIdUnsafe, FlowRevisionConflictError, mapFlowRowToDto } from "./flow.repo";

beforeEach(() => {
	rows.clear();
	rows.set("f1", {
		id: "f1",
		name: "n",
		data: "{}",
		owner_id: "u1",
		project_id: "p1",
		created_at: "t",
		updated_at: "t",
		canvas_revision: 5,
	});
});

describe("flow.repo canvas_revision 乐观锁", () => {
	it("source:user + 匹配版本 → 成功 +1", async () => {
		const r = await updateFlowByIdUnsafe({} as any, {
			id: "f1",
			name: "n2",
			data: "{}",
			nowIso: "t2",
			expectedRevision: 5,
			source: "user",
		});
		expect(r?.canvas_revision).toBe(6);
	});
	it("source:user + 落后版本 → 抛 FlowRevisionConflictError(带 actual)", async () => {
		await expect(
			updateFlowByIdUnsafe({} as any, {
				id: "f1",
				name: "n2",
				data: "{}",
				nowIso: "t2",
				expectedRevision: 3,
				source: "user",
			}),
		).rejects.toMatchObject({ name: "FlowRevisionConflictError", actual: 5 });
	});
	it("source:agent 与用户写入共享同一版本锁", async () => {
		const result = await updateFlowByIdUnsafe({} as never, {
			id: "f1",
			name: "agent-write",
			data: "{}",
			nowIso: "t2",
			expectedRevision: 5,
			source: "agent",
		});
		expect(result?.canvas_revision).toBe(6);
		await expect(
			updateFlowByIdUnsafe({} as never, {
				id: "f1",
				name: "stale-agent-write",
				data: "{}",
				nowIso: "t3",
				expectedRevision: 5,
				source: "agent",
			}),
		).rejects.toMatchObject({ name: "FlowRevisionConflictError", actual: 6 });
	});
	it("不带 expectedRevision 的系统写入仍推进 revision", async () => {
		const r = await updateFlowByIdUnsafe({} as any, { id: "f1", name: "n2", data: "{}", nowIso: "t2" });
		expect(r?.name).toBe("n2");
		expect(r?.canvas_revision).toBe(6);
	});
	it("图更新省略存储元数据时仍保留原归属", async () => {
		const existing = rows.get("f1");
		if (!existing) throw new Error("test row missing");
		existing.data = JSON.stringify({
			nodes: [{ id: "old" }],
			edges: [],
			__tapcanvasFlowOwner: { ownerType: "project", ownerId: "p1" },
		});

		const result = await updateFlowByIdUnsafe({} as never, {
			id: "f1",
			name: "n2",
			data: JSON.stringify({ nodes: [{ id: "new" }], edges: [] }),
			nowIso: "t2",
		});
		const data = JSON.parse(result?.data || "null") as Record<string, unknown>;
		expect(data.nodes).toEqual([{ id: "new" }]);
		expect(data.__tapcanvasFlowOwner).toEqual({ ownerType: "project", ownerId: "p1" });
	});
});

describe("mapFlowRowToDto canvasRevision（Task 3）", () => {
	it("映射 row.canvas_revision → dto.canvasRevision", () => {
		const dto = mapFlowRowToDto({
			id: "f1",
			name: "n",
			data: "{}",
			owner_id: "u1",
			project_id: "p1",
			created_at: "t",
			updated_at: "t2",
			canvas_revision: 7,
		});
		expect(dto.canvasRevision).toBe(7);
	});
});
