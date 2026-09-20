import { describe, expect, it } from "vitest";
import { resolveLogicalTaskBudget, resolveWorkflowExecutionBudget } from "./logical-task-budget";
import type { ExecutionTraceLifecycleSnapshot } from "../memory/execution-trace-events.repo";

function trace(id: string, root: string, startedAt: string): ExecutionTraceLifecycleSnapshot {
  return { traceId: id, rootTraceId: root, logicalTaskId: id, startedAt, updatedAt: startedAt, finishedAt: null, status: "running" };
}
describe("logical task budget admission", () => {
  it("anchors workflow nodes to the owned execution family admission without a chat trace", async () => {
    const input = { executionFamilyId: "family-1", readExecution: async () => ({
      id: "family-1", execution_family_id: "family-1", created_at: "2026-09-08T08:00:00Z",
    }) };
    const budget = await resolveWorkflowExecutionBudget(input);
    expect(budget.logicalTaskId).toBe("family-1");
    expect(budget.acceptedAt).toBe("2026-09-08T08:00:00.000Z");
    expect(await resolveWorkflowExecutionBudget(input)).toEqual(budget);
    await expect(resolveWorkflowExecutionBudget({ ...input, readExecution: async () => null })).rejects.toThrow("admission_missing");
    await expect(resolveWorkflowExecutionBudget({ ...input, readExecution: async () => ({
      id: "child", execution_family_id: "family-1", created_at: "2026-09-08T09:00:00Z",
    }) })).rejects.toThrow("identity_mismatch");
  });
  it("anchors late workflow children and repeated physical requests to root acceptance", async () => {
    const root = trace("root", "root", "2026-09-07T00:00:00Z");
    const child = trace("child", "root", "2026-09-07T00:15:00Z");
    const readTrace = async (id: string) => id === "root" ? root : child;
    const initial = await resolveLogicalTaskBudget({ traceId: "root", readTrace });
    const resumed = await resolveLogicalTaskBudget({ traceId: "child", readTrace });
    expect(resumed).toEqual(initial);
    expect(resumed.targetAt).toBe("2026-09-07T00:10:00.000Z");
  });
  it("keeps an initial OpenAI request and its continuation on the same admission timestamp", async () => {
    const root = trace("root", "root", "2026-09-07T23:59:48.665Z");
    const readTrace = async (id: string) => id === "root" ? root : null;
    const initial = await resolveLogicalTaskBudget({ traceId: "", admissionTraceId: "root", readTrace });
    const resumed = await resolveLogicalTaskBudget({ traceId: "root", admissionTraceId: "physical-child", readTrace });
    expect(initial).toEqual(resumed);
    expect(initial.acceptedAt).toBe("2026-09-07T23:59:48.665Z");
  });
  it("does not fabricate admission timestamps for missing or inconsistent records", async () => {
    await expect(resolveLogicalTaskBudget({ traceId: "absent", readTrace: async () => null })).rejects.toThrow("admission_missing");
    await expect(resolveLogicalTaskBudget({ traceId: "root", readTrace: async () => trace("other", "other", "2026-09-07T00:00:00Z") })).rejects.toThrow("identity_mismatch");
    await expect(resolveLogicalTaskBudget({ traceId: "a", readTrace: async (id) => trace(id, id === "a" ? "b" : "a", "2026-09-07T00:00:00Z") })).rejects.toThrow("admission_cycle");
  });
});
