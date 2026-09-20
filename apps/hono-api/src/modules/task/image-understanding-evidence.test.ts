import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../types";
import { loadImageUnderstandingEvidence } from "./image-understanding-evidence";

const url = "https://owned.example/assets/image-1.png";
const question = "Describe visible details and uncertainty";
const text = "A knitted garment. Fibre composition is unknown.";
const log = (taskId: string, imageUrl = url) => ({ task_id: taskId,
  finished_at: "2026-09-08T14:10:00.000Z",
  request_json: JSON.stringify({ request: { kind: "image_to_prompt", prompt: question,
    extras: { imageUrl, modelKey: "vision-model" } } }) });
const result = (taskId: string, status = "succeeded") => ({ task_id: taskId,
  result: JSON.stringify({ id: taskId, status, raw: { text } }) });

function database(logs: ReturnType<typeof log>[], results: ReturnType<typeof result>[]) {
  const calls = { vendor_api_call_logs: { findMany: vi.fn(async () => logs) },
    task_results: { findMany: vi.fn(async () => results) } };
  return { calls, db: calls as unknown as Pick<PrismaClient, "vendor_api_call_logs" | "task_results"> };
}

describe("successful image understanding evidence", () => {
  it("recovers the exact content-key receipt across a changed source URL", async () => {
    const old = log("content-task", "https://old.test/style.png");
    old.request_json = JSON.stringify({ request: { kind: "image_to_prompt", prompt: question,
      extras: { imageUrl: "https://old.test/style.png", modelKey: "vision-model", imageUnderstandingKey: "content-key-1" } } });
    const { db } = database([old, log("unrelated")], [result("content-task"), result("unrelated")]);
    const evidence = await loadImageUnderstandingEvidence({ db, ownerId: "owner-1", contentKey: "content-key-1",
      references: [{ referenceId: "new-reference", url: "https://new.test/style.png" }],
    });
    expect(evidence.map((item) => item.provenance.taskId)).toEqual(["content-task"]);
  });
  it("joins full receipts by owner and exact URL, preserves uncertainty and stable references", async () => {
    const { db, calls } = database([log("task-1"), log("other", `${url}?changed=1`)], [result("task-1"), result("other")]);
    const evidence = await loadImageUnderstandingEvidence({ db, ownerId: "owner-1",
      references: [{ referenceId: "project-node:stable-1", url }], before: "2026-09-08T14:15:00.000Z" });
    expect(evidence).toEqual([expect.objectContaining({ referenceId: "project-node:stable-1", text, question,
      provenance: expect.objectContaining({ taskId: "task-1", referenceId: "project-node:stable-1", source: "persisted_task_result" }) })]);
    expect(calls.vendor_api_call_logs.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      user_id: "owner-1", task_kind: "image_to_prompt", status: "succeeded",
      finished_at: { lte: "2026-09-08T14:15:00.000Z" },
    }) }));
    expect(calls.task_results.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      user_id: "owner-1", task_id: { in: ["task-1"] }, status: "succeeded",
    }) }));
    expect(JSON.stringify(evidence)).not.toContain(url);
  });

  it("never uses truncated logs, missing results, failed results or malformed JSON as evidence", async () => {
    const { db } = database([log("missing"), log("failed"), { ...log("invalid"), request_json: "{" }], [result("failed", "failed")]);
    expect(await loadImageUnderstandingEvidence({ db, ownerId: "owner-1", references: [{ referenceId: "asset-1", url }] })).toEqual([]);
  });

  it("deduplicates repeated receipts for the same question/model while preserving distinct questions", async () => {
    const otherQuestion = { ...log("task-3"), request_json: log("task-3").request_json.replace(question, "Read visible text") };
    const { db } = database([log("task-2"), log("task-1"), otherQuestion], [result("task-1"), result("task-2"), result("task-3")]);
    const evidence = await loadImageUnderstandingEvidence({ db, ownerId: "owner-1", references: [{ referenceId: "asset-1", url }] });
    expect(evidence.map((item) => item.provenance.taskId)).toEqual(["task-2", "task-3"]);
  });

  it("does no database work without authorized references and exposes storage failures", async () => {
    const { db, calls } = database([], []);
    expect(await loadImageUnderstandingEvidence({ db, ownerId: "owner-1", references: [] })).toEqual([]);
    expect(calls.vendor_api_call_logs.findMany).not.toHaveBeenCalled();
    calls.vendor_api_call_logs.findMany.mockRejectedValue(new Error("offline"));
    await expect(loadImageUnderstandingEvidence({ db, ownerId: "owner-1", references: [{ referenceId: "asset-1", url }] })).rejects.toThrow("offline");
  });
});
