import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getVideoRunMock,
  freshReadFlowRowMock,
  readFlowNodesMock,
} = vi.hoisted(() => ({
  getVideoRunMock: vi.fn(),
  freshReadFlowRowMock: vi.fn(),
  readFlowNodesMock: vi.fn(),
}));

vi.mock("./video-run.repo", async () => {
  const actual = await vi.importActual<typeof import("./video-run.repo")>("./video-run.repo");
  return { ...actual, getVideoRun: getVideoRunMock };
});

vi.mock("./video-orchestrator.flow-io", async () => {
  const actual = await vi.importActual<typeof import("./video-orchestrator.flow-io")>("./video-orchestrator.flow-io");
  return { ...actual, freshReadFlowRow: freshReadFlowRowMock, readFlowNodes: readFlowNodesMock };
});

import { orchestrateVideoReferenceBudget } from "./video-orchestrator.authoring";

const generationContract = {
  videoModel: "doubao-seedance-2-0-260128",
  durationOptions: [5, 10, 15],
  maxDurationSeconds: 15,
  referenceImagePolicy: {
    countUnit: "unique_url" as const,
    maximumTotalImages: 9,
    maximumBusinessImages: 9,
  },
  referenceAudioPolicy: {
    minimumDurationSeconds: 1.8,
    maximumDurationSeconds: 30.2,
  },
};

describe("orchestrateVideoReferenceBudget", () => {
  beforeEach(() => {
    getVideoRunMock.mockReset();
    freshReadFlowRowMock.mockReset();
    readFlowNodesMock.mockReset();
  });

  it("在 prepare 前按真实 URL 展开关键帧和候选资产成本", async () => {
    getVideoRunMock.mockResolvedValue({
      owner_id: "owner-1",
      project_id: "project-1",
      chapter_id: "chapter-1",
      flow_id: "flow-1",
      state: "concatenated",
      beat_sheet: JSON.stringify({
        beats: [{
          clipIndex: 0,
          continuityMode: "editorial_cut",
          storyboardImageNodeId: "storyboard-0",
          assetObjectContracts: [{
            kind: "character",
            name: "主角",
            referenceRole: "identity",
            referenceImageNodeIds: ["role-card"],
          }],
        }],
      }),
    });
    freshReadFlowRowMock.mockResolvedValue({ id: "flow-1" });
    readFlowNodesMock.mockReturnValue([
      { id: "storyboard-0", data: { imageUrl: "https://cdn.example/storyboard.png" } },
      { id: "role-card", data: {
        imageUrl: "https://cdn.example/front.png",
        roleCardReferenceImages: [
          { url: "https://cdn.example/front.png" },
          { url: "https://cdn.example/side.png" },
          { url: "https://cdn.example/back.png" },
        ],
      } },
    ]);

    const result = await orchestrateVideoReferenceBudget({
      bodyArgs: { mode: "reference_budget", sourceRunId: "source-run" },
      requestUserId: "owner-1",
      projectId: "project-1",
      chapterId: "chapter-1",
      flowId: "flow-1",
      generationContract,
      c: {} as never,
    });

    expect(result).toMatchObject({
      ok: true,
      referenceImagePolicy: { maximumBusinessImages: 9 },
      clipBudgets: [{
        clipIndex: 0,
        storyboard: { resolvedUniqueUrlCount: 1, budgetCost: 1 },
        availableBusinessImagesAfterStoryboard: 8,
        candidates: [{ nodeId: "role-card", resolvedUniqueUrlCount: 3, incrementalBusinessUrlCost: 3, eligible: true }],
      }],
    });
  });
});
