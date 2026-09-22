import { describe, expect, it } from "vitest";
import type { PrismaClient } from "../../types";
import { buildDirectorDeskRelayTool, claimDirectorDeskCall, listPendingDirectorDeskCalls, relayDirectorDeskTool, reportDirectorDeskCall } from "./director-desk-relay";

type Row = { user_id: string; task_id: string; vendor: string; kind: string; status: string; result: string; created_at: string; updated_at: string; completed_at: string | null; chapter_id: string | null; node_id: string | null };
type TaskKey = { user_id_task_id: { user_id: string; task_id: string } };
type UpsertArgs = { where: TaskKey; create: Record<string, unknown>; update: Record<string, unknown> };
type FindUniqueArgs = { where: TaskKey; select?: Record<string, boolean> };
type UpdateManyArgs = { where: { user_id: string; task_id: string; status: string }; data: Partial<Row> };
type FindManyArgs = { where: { user_id: string; vendor: string; kind: string; status: string } };
type FakeDb = {
  rows: Map<string, Row>;
  $transaction: (fn: (transaction: FakeDb) => Promise<unknown>) => Promise<unknown>;
  user_notifications: { upsert: (args: unknown) => Promise<null> };
  task_results: {
    upsert: (args: UpsertArgs) => Promise<null>;
    findUnique: (args: FindUniqueArgs) => Promise<Row | null>;
    updateMany: (args: UpdateManyArgs) => Promise<{ count: number }>;
    findMany: (args: FindManyArgs) => Promise<Row[]>;
  };
};

function fakeDb(): FakeDb {
  const rows = new Map<string, Row>();
  const key = (u: string, t: string) => `${u}::${t}`;
  const db: FakeDb = {
    rows,
    $transaction: async (fn) => fn(db),
    user_notifications: { async upsert() { return null; } },
    task_results: {
      async upsert({ where, create }: UpsertArgs) {
        const k = key(where.user_id_task_id.user_id, where.user_id_task_id.task_id);
        const prev = rows.get(k);
        rows.set(k, { ...create, created_at: prev?.created_at ?? create.created_at, completed_at: create.completed_at ?? null } as Row);
        return null;
      },
      async findUnique({ where }: FindUniqueArgs) {
        return rows.get(key(where.user_id_task_id.user_id, where.user_id_task_id.task_id)) ?? null;
      },
      async updateMany({ where, data }: UpdateManyArgs) {
        let count = 0;
        for (const [k, row] of rows) {
          if (row.user_id === where.user_id && row.task_id === where.task_id && row.status === where.status) {
            rows.set(k, { ...row, ...data }); count += 1;
          }
        }
        return { count };
      },
      async findMany({ where }: FindManyArgs) {
        return [...rows.values()].filter(r => r.user_id === where.user_id && r.vendor === where.vendor && r.kind === where.kind && r.status === where.status);
      },
    },
  };
  return db;
}

function asPrismaDb(db: FakeDb): PrismaClient {
  return db as unknown as PrismaClient;
}

describe("director desk relay", () => {
  it("registers all desk tools with a name enum", () => {
    const tool = buildDirectorDeskRelayTool();
    expect(tool.name).toBe("tapcanvas_director_desk");
    const params = tool.parameters as { properties: { tool: { enum: string[] } } };
    expect(params.properties.tool.enum.length).toBeGreaterThanOrEqual(17);
    expect(params.properties.tool.enum).toContain("director_apply");
    expect(tool.description).toContain("director_apply");
  });

  it("enqueues, is claimed once, and returns the reported result", async () => {
    const db = fakeDb();
    const relay = relayDirectorDeskTool({ db: asPrismaDb(db), userId: "u1", args: { tool: "director_read", arguments: { sections: ["entities"] } }, nodeId: "node-1", nowIso: new Date().toISOString() });
    await new Promise(r => setTimeout(r, 700));
    const pending = await listPendingDirectorDeskCalls(asPrismaDb(db), "u1");
    expect(pending).toHaveLength(1);
    expect(pending[0].tool).toBe("director_read");
    const claimed = await claimDirectorDeskCall(asPrismaDb(db), { userId: "u1", callId: pending[0].callId, nowIso: new Date().toISOString() });
    expect(claimed.ok).toBe(true);
    expect(await claimDirectorDeskCall(asPrismaDb(db), { userId: "u1", callId: pending[0].callId, nowIso: new Date().toISOString() })).toMatchObject({ ok: false });
    await reportDirectorDeskCall(asPrismaDb(db), { userId: "u1", callId: pending[0].callId, leaseToken: claimed.leaseToken!, ok: true, data: { revision: 7 }, nowIso: new Date().toISOString() });
    await expect(relay).resolves.toEqual({ ok: true, data: { revision: 7 } });
  });

  it("rejects unknown tools and stale leases", async () => {
    const db = fakeDb();
    await expect(relayDirectorDeskTool({ db: asPrismaDb(db), userId: "u1", args: { tool: "nope" }, nodeId: null, nowIso: new Date().toISOString() }))
      .resolves.toMatchObject({ ok: false });
    const relay = relayDirectorDeskTool({ db: asPrismaDb(db), userId: "u1", args: { tool: "director_view" }, nodeId: null, nowIso: new Date().toISOString() });
    await new Promise(r => setTimeout(r, 700));
    const [call] = await listPendingDirectorDeskCalls(asPrismaDb(db), "u1");
    await expect(reportDirectorDeskCall(asPrismaDb(db), { userId: "u1", callId: call.callId, leaseToken: "wrong", ok: true, nowIso: new Date().toISOString() }))
      .resolves.toEqual({ ok: false, code: "lease_invalid" });
    const claimed = await claimDirectorDeskCall(asPrismaDb(db), { userId: "u1", callId: call.callId, nowIso: new Date().toISOString() });
    await reportDirectorDeskCall(asPrismaDb(db), { userId: "u1", callId: call.callId, leaseToken: claimed.leaseToken!, ok: false, error: "导演台拒绝", nowIso: new Date().toISOString() });
    await expect(relay).resolves.toEqual({ ok: false, error: "导演台拒绝" });
  }, 15000);
});
