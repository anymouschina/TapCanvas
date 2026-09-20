import { z } from "zod";
import type { MaterialAssetDto } from "../material/material.schemas";
import { findWorkflowNode, resolveWorkflowNodeExecutorRef } from "./execution.node-runtime";
import { resolveCoreWorkflowExecutorSemantics } from "./execution.core-semantics";
import { projectAssetSnapshot, type WorkflowProjectContext } from "./execution.project-context";
import type { NodeRunRow } from "./execution.repo";

export const WorkflowPlanningRevisionSchema = z.object({
  nodeId: z.string().trim().min(1),
  instruction: z.string().trim().min(1),
  refreshAssetIds: z.array(z.string().trim().min(1)),
}).strict();
export type WorkflowPlanningRevision = z.infer<typeof WorkflowPlanningRevisionSchema>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExternalReceipt(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasExternalReceipt);
  if (!record(value)) return false;
  return Object.entries(value).some(([key, item]) => (
    ["taskId", "providerTaskId", "imageUrl", "videoUrl", "childExecutionId"].includes(key)
      && typeof item === "string" && item.length > 0
  ) || hasExternalReceipt(item));
}

/** Explicit revision of an unsubmitted production plan; never invalidates accepted media. */
export function prepareWorkflowPlanningRevision(input: {
  root: Record<string, unknown>;
  revision: WorkflowPlanningRevision;
  nodeRuns: readonly Pick<NodeRunRow, "node_id" | "status" | "output_refs">[];
}): { root: Record<string, unknown>; invalidatedNodeIds: string[] } {
  const node = findWorkflowNode(input.root, input.revision.nodeId);
  if (resolveWorkflowNodeExecutorRef(node) !== "agents.logical-task/v2") {
    throw new Error("planning_revision_requires_agent_node");
  }
  if (!Array.isArray(input.root.edges) || !Array.isArray(input.root.nodes)) {
    throw new Error("planning_revision_graph_invalid");
  }
  const affected = new Set([node.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of input.root.edges) {
      if (!record(edge) || typeof edge.source !== "string" || typeof edge.target !== "string") {
        throw new Error("planning_revision_edge_invalid");
      }
      if (affected.has(edge.source) && !affected.has(edge.target)) {
        affected.add(edge.target); changed = true;
      }
    }
  }
  for (const run of input.nodeRuns) {
    if (!affected.has(run.node_id)) continue;
    const executor = resolveWorkflowNodeExecutorRef(findWorkflowNode(input.root, run.node_id));
    if (executor === "agents.logical-task/v2") continue;
    const semantics = executor ? resolveCoreWorkflowExecutorSemantics(executor) : null;
    if (!semantics) throw new Error(`planning_revision_executor_unknown:${run.node_id}`);
    if (semantics.sideEffect === "none") continue;
    const output: unknown = run.output_refs ? JSON.parse(run.output_refs) : null;
    if (["success", "running", "waiting_external"].includes(run.status) || hasExternalReceipt(output)) {
      throw new Error(`planning_revision_has_external_receipt:${run.node_id}`);
    }
  }
  return {
    invalidatedNodeIds: [...affected],
    root: { ...input.root, nodes: input.root.nodes.map((raw) => {
      if (!record(raw) || raw.id !== node.id) return raw;
      if (!record(raw.data) || typeof raw.data.workflowInstruction !== "string") {
        throw new Error("planning_revision_instruction_missing");
      }
      return { ...raw, data: { ...raw.data,
        workflowInstruction: `${raw.data.workflowInstruction}\n\n本次授权的计划修订要求（保留原始来源与交付范围）：\n${input.revision.instruction}`,
      } };
    }) },
  };
}

/** Refresh only explicitly named, already-visible assets; source and selections stay frozen. */
export function reviseWorkflowAssetSnapshots(
  context: WorkflowProjectContext,
  assetIds: readonly string[],
  currentAssets: readonly MaterialAssetDto[],
): WorkflowProjectContext {
  if (assetIds.length === 0) return context;
  const ids = new Set(assetIds);
  const replacements = new Map(currentAssets.filter((asset) => asset.projectId === context.projectId)
    .map((asset) => [asset.id, projectAssetSnapshot(asset)]));
  for (const id of ids) {
    if (!context.projectAssetIds.includes(id) || !context.assetSnapshot.some((asset) => asset.assetId === id)) {
      throw new Error(`planning_revision_asset_not_frozen:${id}`);
    }
    if (!replacements.has(id)) throw new Error(`planning_revision_asset_missing:${id}`);
  }
  return { ...context, assetSnapshot: context.assetSnapshot.map((asset) => ids.has(asset.assetId)
    ? replacements.get(asset.assetId)! : asset),
    mediaUnderstanding: context.mediaUnderstanding?.filter((item) => !ids.has(item.referenceId)),
    // A new explicit snapshot has a new evidence cutoff. Earlier zero-result
    // lookups must not suppress receipts now available for equivalent assets.
    // Their original diagnostics remain in the previous execution snapshot.
    mediaUnderstandingDiagnostics: [],
  };
}
