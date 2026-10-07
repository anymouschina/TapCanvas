import { readFirstImageResult } from "../material/material.image-source";

type CanvasImageNode = Readonly<{ id: string; data: Readonly<Record<string, unknown>> }>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Resolve an unsubmitted video's planned image handle through exact persisted retry receipts. */
export function authorizedImageRetryUrl(plannedNodeId: string, canvasNodes: readonly CanvasImageNode[]): string {
  const imageNodes = canvasNodes.filter((node) => node.data.kind === "image" || node.data.kind === "imageEdit");
  const byId = new Map(imageNodes.map((node) => [node.id, node] as const));
  const planned = byId.get(plannedNodeId);
  if (!planned || !["error", "failed"].includes(text(planned.data.status))
    || readFirstImageResult(planned.data)) return "";
  const familyId = text(planned.data.workflowExecutionFamilyId);
  const assetReuseKey = text(planned.data.assetReuseKey);
  if (!familyId || !assetReuseKey) return "";

  const visited = new Set<string>([plannedNodeId]);
  const queue = [planned];
  const resolved: string[] = [];
  while (queue.length > 0) {
    const parent = queue.shift();
    if (!parent) break;
    const parentTaskId = text(parent.data.taskId) || text(parent.data.imageTaskId);
    const parentRuntimeNodeId = text(parent.data.workflowRuntimeNodeId);
    if (!parentTaskId || !parentRuntimeNodeId || !["error", "failed"].includes(text(parent.data.status))
      || readFirstImageResult(parent.data)) continue;
    for (const child of imageNodes) {
      if (visited.has(child.id)) continue;
      const authorization = child.data.workflowMediaRetry;
      if (!authorization || typeof authorization !== "object" || Array.isArray(authorization)) continue;
      const retry = authorization as Record<string, unknown>;
      const retryKey = text(retry.retryKey);
      const mode = text(retry.executionMode);
      const retryNodeId = text(retry.nodeId);
      const retryItemId = text(retry.itemId);
      const retryRuntimeNodeId = mode === "each"
        && retryNodeId && retryItemId ? `${retryNodeId}::item::${encodeURIComponent(retryItemId)}`
        : mode === "once" && retryNodeId ? retryNodeId : "";
      if (text(retry.canvasNodeId) !== parent.id
        || text(retry.taskId) !== parentTaskId
        || text(retry.executorRef) !== "tapcanvas.image.generate/v1"
        || retryRuntimeNodeId !== parentRuntimeNodeId
        || !retryKey || !child.id.endsWith(`::retry::${retryKey}`)
        || text(child.data.workflowRuntimeNodeId) !== parentRuntimeNodeId
        || text(child.data.workflowExecutionFamilyId) !== familyId
        || text(child.data.assetReuseKey) !== assetReuseKey
        || text(child.data.workflowObjectId) !== text(planned.data.workflowObjectId)) continue;
      visited.add(child.id);
      if (child.data.status === "success") {
        const result = readFirstImageResult(child.data);
        if (result?.url && (text(child.data.assetId) || result.assetId)) resolved.push(result.url);
      } else if (["error", "failed"].includes(text(child.data.status))) {
        queue.push(child);
      }
    }
  }
  return resolved.length === 1 ? resolved[0] ?? "" : "";
}
