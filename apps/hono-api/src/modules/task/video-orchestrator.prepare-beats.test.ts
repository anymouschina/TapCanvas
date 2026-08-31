import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getVideoRunMock,
  saveBeatSheetDraftMock,
  patchBeatSheetDraftMock,
  saveReferenceBudgetProposalMock,
  readReferenceBudgetProposalMock,
  freshReadFlowRowMock,
  readFlowNodesMock,
} = vi.hoisted(() => ({
  getVideoRunMock: vi.fn(),
  saveBeatSheetDraftMock: vi.fn(),
  patchBeatSheetDraftMock: vi.fn(),
  saveReferenceBudgetProposalMock: vi.fn(),
  readReferenceBudgetProposalMock: vi.fn(),
  freshReadFlowRowMock: vi.fn(),
  readFlowNodesMock: vi.fn(),
}));

vi.mock("./video-orchestrator.flow-io", async () => {
  const actual = await vi.importActual<typeof import("./video-orchestrator.flow-io")>("./video-orchestrator.flow-io");
  return { ...actual, freshReadFlowRow: freshReadFlowRowMock, readFlowNodes: readFlowNodesMock };
});

vi.mock("./video-run.repo", async () => {
  const actual = await vi.importActual<typeof import("./video-run.repo")>("./video-run.repo");
  return { ...actual, getVideoRun: getVideoRunMock };
});

vi.mock("./video-orchestrator.beat-sheet-draft", async () => {
  const actual = await vi.importActual<typeof import("./video-orchestrator.beat-sheet-draft")>(
    "./video-orchestrator.beat-sheet-draft",
  );
  return {
    ...actual,
    saveBeatSheetDraft: saveBeatSheetDraftMock,
    patchBeatSheetDraft: patchBeatSheetDraftMock,
  };
});

vi.mock("./video-orchestrator.reference-budget-proposal", async () => {
  const actual = await vi.importActual<typeof import("./video-orchestrator.reference-budget-proposal")>(
    "./video-orchestrator.reference-budget-proposal",
  );
  return {
    ...actual,
    saveReferenceBudgetProposal: saveReferenceBudgetProposalMock,
    readReferenceBudgetProposal: readReferenceBudgetProposalMock,
  };
});

import { orchestrateVideoPrepareBeats, orchestrateVideoReferenceBudget } from "./video-orchestrator.authoring";

const generationContract = {
  videoModel: "doubao-seedance-2-0-260128",
  durationOptions: [5],
  maxDurationSeconds: 5,
  referenceImagePolicy: { countUnit: "unique_url" as const, maximumTotalImages: 9, maximumBusinessImages: 9 },
  referenceAudioPolicy: { minimumDurationSeconds: 1.8, maximumDurationSeconds: 30.2 },
};

const sourceRun = {
  id: "source-run",
  owner_id: "owner-1",
  project_id: "project-1",
  chapter_id: "chapter-1",
  flow_id: "flow-1",
  state: "concatenated",
  beat_sheet: JSON.stringify({
    version: 2,
    runId: "source-run",
    chapterId: "chapter-1",
    beats: [{ clipIndex: 0, storyboardImageNodeId: "old-frame" }],
  }),
};

describe("orchestrateVideoPrepareBeats", () => {
  beforeEach(() => {
    getVideoRunMock.mockReset();
    saveBeatSheetDraftMock.mockReset();
    patchBeatSheetDraftMock.mockReset();
    saveReferenceBudgetProposalMock.mockReset();
    readReferenceBudgetProposalMock.mockReset();
    saveReferenceBudgetProposalMock.mockResolvedValue({});
    freshReadFlowRowMock.mockResolvedValue({ id: "flow-1" });
    readFlowNodesMock.mockReturnValue([{ id: "old-frame", data: { imageUrl: "https://cdn.example/old.png" } }]);
  });

  it("从同作用域权威 run 初始化新 run 草稿、应用 patch 并进入完整 commit 门禁", async () => {
    getVideoRunMock.mockImplementation(async (runId: string) =>
      runId === "source-run" ? sourceRun : null,
    );
    saveBeatSheetDraftMock.mockResolvedValue({ revision: "revision-1" });
    patchBeatSheetDraftMock.mockResolvedValue({
      revision: "revision-2",
      beatSheet: {
        version: 2,
        runId: "target-run",
        chapterId: "chapter-1",
        beats: [{ clipIndex: 0, storyboardImageNodeId: "new-frame" }],
      },
    });

    const operations = [
      { op: "set" as const, path: "/beats/0/storyboardImageNodeId", value: "new-frame" },
    ];
    const budget = await orchestrateVideoReferenceBudget({
      bodyArgs: { sourceRunId: "source-run", operations },
      requestUserId: "owner-1",
      projectId: "project-1",
      chapterId: "chapter-1",
      flowId: "flow-1",
      generationContract,
      c: {} as never,
    });
    readReferenceBudgetProposalMock.mockResolvedValue({
      ownerId: "owner-1",
      projectId: "project-1",
      scopeId: "chapter-1",
      sourceRunId: "source-run",
      budgetRevision: budget.budgetRevision,
      operations,
      createdAt: "2026-07-30T00:00:00.000Z",
    });
    const result = await orchestrateVideoPrepareBeats({
      bodyArgs: {
        mode: "prepare_beats",
        sourceRunId: "source-run",
        runId: "target-run",
        budgetRevision: budget.budgetRevision,
      },
      requestUserId: "owner-1",
      projectId: "project-1",
      chapterId: "chapter-1",
      flowId: "flow-1",
      generationContract,
      c: {} as never,
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code: "parent_agent_provenance_required",
      runId: "target-run",
      preparedFromRunId: "source-run",
    }));
    expect(saveBeatSheetDraftMock).toHaveBeenCalledWith({
      ownerId: "owner-1",
      runId: "target-run",
      beatSheet: {
        version: 2,
        runId: "target-run",
        chapterId: "chapter-1",
        beats: [{ clipIndex: 0, storyboardImageNodeId: "old-frame" }],
      },
    });
    expect(saveBeatSheetDraftMock).toHaveBeenCalledTimes(1);
    expect(patchBeatSheetDraftMock).toHaveBeenCalledWith({
      ownerId: "owner-1",
      runId: "target-run",
      revision: "revision-1",
      operations,
    });
    expect(readReferenceBudgetProposalMock).toHaveBeenCalledWith({
      ownerId: "owner-1",
      projectId: "project-1",
      scopeId: "chapter-1",
      sourceRunId: "source-run",
      budgetRevision: budget.budgetRevision,
    });
  });

  it("reference budget revision 对 operation value 的对象键顺序稳定", async () => {
    getVideoRunMock.mockImplementation(async (runId: string) =>
      runId === "source-run" ? sourceRun : null,
    );

    const first = await orchestrateVideoReferenceBudget({
      bodyArgs: {
        sourceRunId: "source-run",
        operations: [
          {
            op: "set",
            path: "/beats/0/referenceBudgetProbe",
            value: {
              alpha: "same",
              nested: { first: 1, second: 2 },
            },
          },
        ],
      },
      requestUserId: "owner-1",
      projectId: "project-1",
      chapterId: "chapter-1",
      flowId: "flow-1",
      generationContract,
      c: {} as never,
    });
    const reordered = await orchestrateVideoReferenceBudget({
      bodyArgs: {
        sourceRunId: "source-run",
        operations: [
          {
            path: "/beats/0/referenceBudgetProbe",
            value: {
              nested: { second: 2, first: 1 },
              alpha: "same",
            },
            op: "set",
          },
        ],
      },
      requestUserId: "owner-1",
      projectId: "project-1",
      chapterId: "chapter-1",
      flowId: "flow-1",
      generationContract,
      c: {} as never,
    });

    expect(first).toEqual(expect.objectContaining({ ok: true }));
    expect(reordered).toEqual(expect.objectContaining({ ok: true }));
    expect(reordered.budgetRevision).toBe(first.budgetRevision);
  });

  it("拒绝跨 owner 或画布作用域读取源 BeatSheet", async () => {
    getVideoRunMock.mockImplementation(async (runId: string) =>
      runId === "source-run" ? { ...sourceRun, owner_id: "other-owner" } : null,
    );

    const result = await orchestrateVideoPrepareBeats({
      bodyArgs: {
        sourceRunId: "source-run",
        runId: "target-run",
        budgetRevision: "stale-but-structurally-present",
      },
      requestUserId: "owner-1",
      projectId: "project-1",
      chapterId: "chapter-1",
      flowId: "flow-1",
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code: "run_scope_mismatch",
    }));
    expect(saveBeatSheetDraftMock).not.toHaveBeenCalled();
  });

  it("prepare_beats 硬切后拒绝模型再次发送 operations", async () => {
    const result = await orchestrateVideoPrepareBeats({
      bodyArgs: {
        sourceRunId: "source-run",
        runId: "target-run",
        budgetRevision: "revision-from-budget",
        operations: [{ op: "set", path: "/beats/0/storyboardImageNodeId", value: "new-frame" }],
      },
      requestUserId: "owner-1",
      projectId: "project-1",
      chapterId: "chapter-1",
      flowId: "flow-1",
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code: "beat_sheet_prepare_operations_forbidden",
    }));
    expect(readReferenceBudgetProposalMock).not.toHaveBeenCalled();
  });
});
