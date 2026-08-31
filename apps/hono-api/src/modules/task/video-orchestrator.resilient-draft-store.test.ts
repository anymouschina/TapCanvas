import { beforeEach, describe, expect, it, vi } from "vitest";

const { redisRef, redisValues, durableRows, prismaClient } = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  const rowKey = (runId: string, artifactKey: string): string => `${runId}:${artifactKey}`;
  const artifacts = {
    findUnique: vi.fn(async (input: Record<string, any>) => {
      const selector = input.where.run_id_artifact_key;
      const row = rows.get(rowKey(selector.run_id, selector.artifact_key));
      if (!row) return null;
      if (!input.select) return { ...row };
      return Object.fromEntries(
        Object.keys(input.select).filter((key) => input.select[key]).map((key) => [key, row[key]]),
      );
    }),
    findMany: vi.fn(async (input: Record<string, any>) => {
      const runIds = new Set(input.where.run_id.in as string[]);
      return [...rows.values()]
        .filter((row) => runIds.has(String(row.run_id)) && row.artifact_key === input.where.artifact_key)
        .map((row) => Object.fromEntries(
          Object.keys(input.select).filter((key) => input.select[key]).map((key) => [key, row[key]]),
        ));
    }),
    upsert: vi.fn(async (input: Record<string, any>) => {
      const selector = input.where.run_id_artifact_key;
      const key = rowKey(selector.run_id, selector.artifact_key);
      const existing = rows.get(key);
      rows.set(key, existing ? { ...existing, ...input.update } : { ...input.create });
      return rows.get(key);
    }),
    deleteMany: vi.fn(async (input: Record<string, any>) => {
      const key = rowKey(input.where.run_id, input.where.artifact_key);
      const deleted = rows.delete(key);
      return { count: deleted ? 1 : 0 };
    }),
  };
  const client: Record<string, any> = { authoring_artifacts: artifacts };
  client.$transaction = vi.fn(async (callback: (db: Record<string, any>) => unknown) => callback(client));
  return {
    redisRef: { current: null as null | Record<string, unknown> },
    redisValues: new Map<string, string>(),
    durableRows: rows,
    prismaClient: client,
  };
});

vi.mock("../../platform/redis-shared", () => ({
  getSharedRedis: () => redisRef.current,
}));

vi.mock("../../platform/node/prisma", () => ({
  getPrismaClient: () => prismaClient,
}));

import {
  resilientDraftBatch,
  resilientDraftCompareAndSetBeat,
  resilientDraftGet,
  resilientDraftMget,
  resilientDraftSet,
  resilientDraftSetRepair,
  resetResilientDraftStoreForTests,
} from "./video-orchestrator.resilient-draft-store";
import {
  patchBeatSheetDraft,
  readBeatSheetDraft,
  saveBeatSheetDraft,
} from "./video-orchestrator.beat-sheet-draft";
import {
  bindBeatSheetSourceAuthority,
  readBeatSheetSourceAuthority,
} from "./video-orchestrator.source-authority";
import {
  readReferenceBudgetProposal,
  saveReferenceBudgetProposal,
} from "./video-orchestrator.reference-budget-proposal";

describe("video authoring draft storage degradation", () => {
  beforeEach(() => {
    redisRef.current = null;
    redisValues.clear();
    durableRows.clear();
    delete process.env.VIDEO_DRAFT_DURABLE_TEST;
    resetResilientDraftStoreForTests();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("keeps BeatSheet save/read/patch available when Redis is unavailable", async () => {
    const saved = await saveBeatSheetDraft({
      ownerId: "owner-degraded",
      runId: "run-degraded",
      beatSheet: { version: 2, beats: [{ clipIndex: 0, prompt: "start" }] },
    });

    const read = await readBeatSheetDraft("owner-degraded", "run-degraded");
    expect(read.revision).toBe(saved.revision);
    expect(read.beatSheet).toEqual(saved.beatSheet);

    const patched = await patchBeatSheetDraft({
      ownerId: "owner-degraded",
      runId: "run-degraded",
      revision: saved.revision,
      operations: [{ op: "set", path: "/beats/0/prompt", value: "continue" }],
    });
    expect(patched.beatSheet).toMatchObject({ beats: [{ prompt: "continue" }] });
  });

  it("preserves draft graph CAS semantics in fallback mode and backfills Redis after recovery", async () => {
    const ttlSeconds = 60;
    await resilientDraftSet("draft", JSON.stringify({ revision: "rev-1" }), ttlSeconds);
    expect(await resilientDraftSetRepair({
      draftKey: "draft",
      repairKey: "repair",
      expectedRevision: "rev-1",
      repairJson: JSON.stringify({ actions: ["repair"] }),
      ttlSeconds,
    })).toBe(true);

    expect(await resilientDraftCompareAndSetBeat({
      currentKey: "beat",
      previousHistoryKey: "history-old",
      nextHistoryKey: "history-new",
      revisionKey: "beat-revision",
      repairKey: "repair",
      observedRaw: "",
      observedRevision: "",
      nextRaw: JSON.stringify({ clipIndex: 0 }),
      nextRevision: "beat-rev-1",
      ttlSeconds,
    })).toBe(true);

    await resilientDraftBatch([
      { type: "set", key: "assembly", value: "ready", ttlSeconds },
      { type: "del", key: "unused" },
    ]);
    expect(await resilientDraftMget(
      ["draft", "repair", "beat", "beat-revision", "assembly"],
      ttlSeconds,
    )).toEqual([
      JSON.stringify({ revision: "rev-1" }),
      JSON.stringify({ actions: ["repair"] }),
      JSON.stringify({ clipIndex: 0 }),
      "beat-rev-1",
      "ready",
    ]);

    const redis = {
      get: vi.fn(async (key: string) => redisValues.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        redisValues.set(key, value);
        return "OK";
      }),
    };
    redisRef.current = redis;

    expect(await resilientDraftGet("draft", ttlSeconds)).toBe(JSON.stringify({ revision: "rev-1" }));
    expect(redis.set).toHaveBeenCalledWith(
      "draft",
      JSON.stringify({ revision: "rev-1" }),
      "EX",
      ttlSeconds,
    );
    expect(redisValues.get("draft")).toBe(JSON.stringify({ revision: "rev-1" }));
  });

  it("keeps source authority and reference-budget proposals available without Redis", async () => {
    const authority = await bindBeatSheetSourceAuthority({
      ownerId: "owner-authority",
      runId: "run-authority",
      kind: "chapter",
      sourceId: "chapter-1",
      text: "阿乔是枪炮师，幽魂大头佛只使用狼牙棒。",
    });
    await expect(readBeatSheetSourceAuthority("owner-authority", "run-authority"))
      .resolves.toEqual(authority);

    await saveReferenceBudgetProposal({
      ownerId: "owner-authority",
      projectId: "project-1",
      scopeId: "chapter-1",
      sourceRunId: "run-authority",
      budgetRevision: "budget-1",
      operations: [{ op: "remove", path: "/beats/0/optionalReference" }],
    });
    await expect(readReferenceBudgetProposal({
      ownerId: "owner-authority",
      projectId: "project-1",
      scopeId: "chapter-1",
      sourceRunId: "run-authority",
      budgetRevision: "budget-1",
    })).resolves.toMatchObject({
      operations: [{ op: "remove", path: "/beats/0/optionalReference" }],
    });
  });

  it("recovers frozen authoring state from PostgreSQL after the process cache is cleared", async () => {
    process.env.VIDEO_DRAFT_DURABLE_TEST = "1";
    const saved = await saveBeatSheetDraft({
      ownerId: "owner-restart",
      runId: "run-restart",
      beatSheet: { version: 2, beats: [{ clipIndex: 0, prompt: "durable" }] },
    });
    await bindBeatSheetSourceAuthority({
      ownerId: "owner-restart",
      runId: "run-restart",
      kind: "chapter",
      sourceId: "chapter-restart",
      text: "60秒故事；阿乔使用枪炮；幽魂大头佛使用狼牙棒。",
    });
    await saveReferenceBudgetProposal({
      ownerId: "owner-restart",
      projectId: "project-restart",
      scopeId: "chapter-restart",
      sourceRunId: "run-restart",
      budgetRevision: "budget-restart",
      operations: [{ op: "remove", path: "/beats/0/optionalAudio" }],
    });

    resetResilientDraftStoreForTests();
    redisRef.current = null;

    await expect(readBeatSheetDraft("owner-restart", "run-restart"))
      .resolves.toMatchObject({ revision: saved.revision, beatSheet: saved.beatSheet });
    await expect(readBeatSheetSourceAuthority("owner-restart", "run-restart"))
      .resolves.toMatchObject({ sourceId: "chapter-restart" });
    await expect(readReferenceBudgetProposal({
      ownerId: "owner-restart",
      projectId: "project-restart",
      scopeId: "chapter-restart",
      sourceRunId: "run-restart",
      budgetRevision: "budget-restart",
    })).resolves.toMatchObject({
      operations: [{ op: "remove", path: "/beats/0/optionalAudio" }],
    });
  });
});
