import { beforeEach, describe, expect, it, vi } from "vitest";

const { proposalStore, redisGetMock, redisSetMock } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    proposalStore: store,
    redisGetMock: vi.fn(async (key: string) => store.get(key) ?? null),
    redisSetMock: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
  };
});

vi.mock("../../platform/redis-shared", () => ({
  getSharedRedis: () => ({
    get: redisGetMock,
    set: redisSetMock,
  }),
}));

import {
  readReferenceBudgetProposal,
  saveReferenceBudgetProposal,
} from "./video-orchestrator.reference-budget-proposal";

describe("reference budget opaque proposal", () => {
  beforeEach(() => {
    proposalStore.clear();
    redisGetMock.mockClear();
    redisSetMock.mockClear();
  });

  it("按 owner/source/revision 保存原始 operations，并在同作用域完整读回", async () => {
    const operations = [
      {
        op: "set" as const,
        path: "/beats/6",
        value: { clipIndex: 6, nested: { second: 2, first: 1 } },
      },
    ];
    await saveReferenceBudgetProposal({
      ownerId: "owner-1",
      projectId: "project-1",
      scopeId: "chapter-1",
      sourceRunId: "source-run",
      budgetRevision: "budget-revision",
      operations,
    });

    operations[0].value.clipIndex = 99;
    const proposal = await readReferenceBudgetProposal({
      ownerId: "owner-1",
      projectId: "project-1",
      scopeId: "chapter-1",
      sourceRunId: "source-run",
      budgetRevision: "budget-revision",
    });

    expect(proposal.operations).toEqual([
      {
        op: "set",
        path: "/beats/6",
        value: { clipIndex: 6, nested: { second: 2, first: 1 } },
      },
    ]);
  });

  it("拒绝把 proposal 跨项目或画布作用域复用", async () => {
    await saveReferenceBudgetProposal({
      ownerId: "owner-1",
      projectId: "project-1",
      scopeId: "chapter-1",
      sourceRunId: "source-run",
      budgetRevision: "budget-revision",
      operations: [{ op: "remove", path: "/meta/styleReferenceImageUrl" }],
    });

    await expect(
      readReferenceBudgetProposal({
        ownerId: "owner-1",
        projectId: "project-2",
        scopeId: "chapter-1",
        sourceRunId: "source-run",
        budgetRevision: "budget-revision",
      }),
    ).rejects.toMatchObject({
      code: "reference_budget_proposal_scope_mismatch",
    });
  });
});
