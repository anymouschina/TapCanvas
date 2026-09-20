import { expect, it } from "vitest";
import { workflowAuthoringWaitLabel } from "./execution.authoring-wait-label";
it("projects a recorded repair even when the physical inference succeeded", () => {
  expect(workflowAuthoringWaitLabel({ outputRepair: { error: "nested field missing", candidate: "PRIVATE" },
    deliveryEvidence: { state: "succeeded", physicalRetryOrdinal: 8 } }))
    .toBe("正在修订结构化产物（执行轮次 8）：nested field missing");
});
it("does not invent a repair or replace a specific dependency wait", () => {
  expect(workflowAuthoringWaitLabel({ deliveryEvidence: { state: "running" } })).toBeNull();
  expect(workflowAuthoringWaitLabel({ waitingReasonLabel: "等待目录", outputRepair: { error: "old" } })).toBe("等待目录");
});
