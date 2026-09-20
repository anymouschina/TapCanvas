import { describe, expect, it } from "vitest";
import { authorizeWorkflowMediaRetries, WorkflowMediaRetriesSchema } from "./execution.media-retry";
import { WorkflowExecutionResumeRequestSchema } from "./execution.schemas";

const retry = { nodeId: "images", itemId: "background", taskId: "task-old" };
function outputs(status = "failed", taskId = "task-old") {
  return [{ nodeId: "images", outputRefs: { protocolVersion: "1", executorRef: "tapcanvas.image.generate/v1",
    nodeId: "images", executionMode: "each", ports: {}, artifacts: [], evidence: {},
    itemRuns: [{ itemId: "background", index: 0, runtimeNodeId: "images::item::background", lineage: [],
      status, ports: {}, artifacts: [], evidence: { taskId, canvasNodeId: "old-image" } }] } }];
}
describe("explicit media retry authorization", () => {
  it("binds a stable new attempt to an exact failed receipt without changing it", () => {
    const source = outputs(); const before = JSON.stringify(source);
    const input = { sourceExecutionId: "old-execution", retries: [retry], outputs: source };
    const authorized = authorizeWorkflowMediaRetries(input);
    expect(authorized).toEqual(authorizeWorkflowMediaRetries(input));
    expect(authorized[0]).toMatchObject({ ...retry, canvasNodeId: "old-image" });
    expect(authorized[0].retryKey).toHaveLength(64);
    expect(JSON.stringify(source)).toBe(before);
  });
  it("rejects accepted, successful, missing and mismatched receipts", () => {
    for (const source of [outputs("success"), outputs("waiting_external"), outputs("failed", "other"), []]) {
      expect(() => authorizeWorkflowMediaRetries({ sourceExecutionId: "old", retries: [retry], outputs: source })).toThrow();
    }
  });
  it("rejects duplicate retry targets", () => {
    expect(WorkflowMediaRetriesSchema.safeParse([retry, retry]).success).toBe(false);
  });
  it("admits the explicit endpoint contract but rejects mixing recovery modes", () => {
    expect(WorkflowExecutionResumeRequestSchema.parse({ mediaRetries: [retry] })).toEqual({ mediaRetries: [retry] });
    expect(WorkflowExecutionResumeRequestSchema.safeParse({ mediaRetries: [retry], nodeId: "images" }).success).toBe(false);
  });
});
