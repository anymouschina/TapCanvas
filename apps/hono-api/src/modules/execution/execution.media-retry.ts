import { createHash } from "node:crypto";
import { z } from "zod";
import { parseWorkflowNodeOutputV1 } from "./execution.node-runtime";

export const WorkflowMediaRetrySchema = z.object({
  nodeId: z.string().trim().min(1),
  itemId: z.string().trim().min(1),
  taskId: z.string().trim().min(1),
}).strict();
export const WorkflowMediaRetriesSchema = z.array(WorkflowMediaRetrySchema).min(1).superRefine((items, ctx) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const key = JSON.stringify([item.nodeId, item.itemId]);
    if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: "Duplicate media retry target" });
    seen.add(key);
  });
});
export type WorkflowMediaRetry = z.infer<typeof WorkflowMediaRetrySchema>;
const AuthorizedRetrySchema = WorkflowMediaRetrySchema.extend({
  canvasNodeId: z.string().min(1), retryKey: z.string().min(1),
});
export type AuthorizedWorkflowMediaRetry = z.infer<typeof AuthorizedRetrySchema>;

/** Explicit caller authorization is bound to the exact failed receipt, never its message. */
export function authorizeWorkflowMediaRetries(input: {
  sourceExecutionId: string;
  retries: readonly WorkflowMediaRetry[];
  outputs: readonly { nodeId: string; outputRefs: unknown }[];
}): AuthorizedWorkflowMediaRetry[] {
  return input.retries.map((retry) => {
    const output = parseWorkflowNodeOutputV1(input.outputs.find((run) => run.nodeId === retry.nodeId)?.outputRefs);
    if (!output || output.executorRef !== "tapcanvas.image.generate/v1" || output.executionMode !== "each") {
      throw new Error(`media_retry_image_collection_required:${retry.nodeId}`);
    }
    const item = output.itemRuns.find((entry) => entry.itemId === retry.itemId);
    if (!item || item.status !== "failed" || item.evidence.taskId !== retry.taskId
      || typeof item.evidence.canvasNodeId !== "string" || !item.evidence.canvasNodeId
      || item.artifacts.length > 0) throw new Error(`media_retry_failed_receipt_required:${retry.itemId}`);
    return { ...retry, canvasNodeId: item.evidence.canvasNodeId,
      retryKey: createHash("sha256").update(JSON.stringify([
        input.sourceExecutionId, retry.nodeId, retry.itemId, retry.taskId,
      ])).digest("hex") };
  });
}

export function readWorkflowMediaRetries(root: unknown): AuthorizedWorkflowMediaRetry[] {
  if (!root || typeof root !== "object" || Array.isArray(root)) return [];
  const value = (root as Record<string, unknown>).workflowMediaRetries;
  return value === undefined ? [] : z.array(AuthorizedRetrySchema).parse(value);
}

export function workflowMediaRetryForItem(root: unknown, runtimeNodeId: string): AuthorizedWorkflowMediaRetry | undefined {
  return readWorkflowMediaRetries(root).find((item) => `${item.nodeId}::item::${encodeURIComponent(item.itemId)}` === runtimeNodeId);
}
