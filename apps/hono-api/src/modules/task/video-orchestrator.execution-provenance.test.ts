import { describe, expect, it } from "vitest";

import { buildVideoRunExecutionProvenance } from "./video-orchestrator.execution-provenance";

function provenance(executionId: string, agentId?: string) {
  return {
    version: 1 as const,
    executionId,
    ...(agentId ? { agentId } : {}),
    depth: agentId ? 1 : 0,
    model: "gpt-5.6-sol",
    apiStyle: "responses" as const,
    requiredSkills: [agentId ? "tapcanvas-video-prompt-writer" : "tapcanvas-video-workflow"],
    loadedSkills: [agentId ? "tapcanvas-video-prompt-writer" : "tapcanvas-video-workflow"],
    startedAt: "2026-07-23T00:00:00.000Z",
  };
}

describe("buildVideoRunExecutionProvenance", () => {
  it("links the parent and every writer to its frozen clip hashes", () => {
    const parent = provenance("parent-run");
    const writer0 = provenance("writer-run-0", "agent-0");
    const writer1 = provenance("writer-run-1", "agent-1");
    const result = buildVideoRunExecutionProvenance({
      beatSheetJson: JSON.stringify({
        beats: [{ clipIndex: 0 }, { clipIndex: 1 }],
        meta: { parentExecutionProvenance: parent },
      }),
      totalClips: 2,
      artifacts: [
        {
          artifact_key: "clip:1",
          status: "ready",
          payload: JSON.stringify({
            clipIndex: 1,
            sourceHash: "source-1",
            outputHash: "output-1",
            agentId: "agent-1",
            writerExecutionProvenance: writer1,
            clip: {
              dramaticCoverage: {
                stateActions: [{ actionId: "state-1", shotNos: [1] }],
              },
            },
          }),
        },
        {
          artifact_key: "clip:0",
          status: "failed",
          error: "bridge /collab/spawn 400: outputContract invalid",
          payload: JSON.stringify({
            clipIndex: 0,
            sourceHash: "source-0",
            agentId: "agent-0",
            repairable: true,
            repairAttempt: 1,
            repairProblems: ["writer dispatch failed"],
            writerExecutionProvenance: writer0,
          }),
        },
      ],
    });

    expect(result.state).toBe("complete");
    expect(result.parentExecutionProvenance).toEqual(parent);
    expect(result.missingWriterClipIndexes).toEqual([]);
    expect(result.clips.map((clip) => clip.clipIndex)).toEqual([0, 1]);
    expect(result.clips[0]).toEqual(expect.objectContaining({
      artifactStatus: "failed",
      artifactError: "bridge /collab/spawn 400: outputContract invalid",
      sourceHash: "source-0",
      repairable: true,
      repairAttempt: 1,
      repairProblems: ["writer dispatch failed"],
      writerExecutionProvenance: writer0,
    }));
    expect(result.clips[1]).toEqual(expect.objectContaining({
      outputHash: "output-1",
      dramaticCoverage: { stateActions: [{ actionId: "state-1", shotNos: [1] }] },
    }));
  });

  it("labels historical artifacts without inventing provenance", () => {
    const result = buildVideoRunExecutionProvenance({
      beatSheetJson: JSON.stringify({ beats: [{ clipIndex: 0 }], meta: { filmGenre: "神话" } }),
      totalClips: 1,
      artifacts: [{
        artifact_key: "clip:0",
        status: "ready",
        payload: JSON.stringify({ clipIndex: 0, sourceHash: "legacy-source", agentId: "legacy-agent" }),
      }],
    });
    expect(result.state).toBe("legacy_unavailable");
    expect(result.parentExecutionProvenance).toBeNull();
    expect(result.clips[0]?.writerExecutionProvenance).toBeNull();
    expect(result.missingWriterClipIndexes).toEqual([0]);
  });
});
