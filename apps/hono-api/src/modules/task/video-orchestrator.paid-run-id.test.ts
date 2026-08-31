import { describe, expect, it } from "vitest";

import { resolvePaidOperationRunId } from "./video-orchestrator.paid-run-id";

describe("estimate/start Run ID 单一解析", () => {
  it("顶层与内嵌 Run ID 不一致时显式失败", () => {
    expect(
      resolvePaidOperationRunId(
        { runId: "run-a", storyPlan: { runId: "run-b" } },
        { runId: "run-b" },
      ),
    ).toMatchObject({ ok: false, code: "run_id_conflict" });
  });

  it("parentGroupId 使用与最终计划一致的稳定 Run ID", () => {
    expect(
      resolvePaidOperationRunId(
        { storyPlan: { runId: "custom", parentGroupId: "group-29" } },
        { runId: "custom", parentGroupId: "group-29" },
      ),
    ).toEqual({ ok: true, runId: "video-run-group-29" });
  });
});
