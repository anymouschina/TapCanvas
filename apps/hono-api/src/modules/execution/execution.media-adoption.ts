import { z } from "zod";
import { parseWorkflowNodeOutputV1, type WorkflowNodeOutputV1 } from "./execution.node-runtime";
import { findWorkflowNode, resolveWorkflowNodeExecutorRef } from "./execution.node-runtime";
import { resolveCoreWorkflowExecutorSemantics } from "./execution.core-semantics";

/** An explicit reference amendment. The original output remains in its source run. */
export const WorkflowMediaAdoptionSchema = z.object({
  nodeId: z.string().trim().min(1),
  itemId: z.string().trim().min(1),
  assetId: z.string().trim().min(1),
}).strict();
export const WorkflowMediaAdoptionsSchema = z.array(WorkflowMediaAdoptionSchema).min(1)
  .superRefine((items, ctx) => {
    const targets = new Set<string>();
    items.forEach((item, index) => {
      const key = JSON.stringify([item.nodeId, item.itemId]);
      if (targets.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom,
        path: [index], message: "Each output item can adopt only one asset" });
      targets.add(key);
    });
  });
export type WorkflowMediaAdoption = z.infer<typeof WorkflowMediaAdoptionSchema>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readWorkflowMediaAdoptions(root: unknown): readonly WorkflowMediaAdoption[] {
  if (!record(root) || root.workflowMediaAdoptions === undefined) return [];
  return WorkflowMediaAdoptionsSchema.parse(root.workflowMediaAdoptions);
}

export function workflowMediaAdoptionAssetId(root: unknown, runtimeNodeId: string): string | null {
  return readWorkflowMediaAdoptions(root).find((item) =>
    `${item.nodeId}::item::${encodeURIComponent(item.itemId)}` === runtimeNodeId)?.assetId ?? null;
}

export function validateWorkflowMediaAdoptionDescendants(input: {
  root: Record<string, unknown>;
  adoptions: readonly Pick<WorkflowMediaAdoption, "nodeId" | "itemId">[];
  runs: readonly Readonly<{ nodeId: string; status: string; outputRefs: unknown }>[];
}): void {
  if (!Array.isArray(input.root.edges)) throw new Error("media_adoption_graph_missing");
  const roots = new Set(input.adoptions.map((item) => item.nodeId));
  const affected = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of input.root.edges) {
      if (!record(edge) || typeof edge.source !== "string" || typeof edge.target !== "string") throw new Error("media_adoption_edge_invalid");
      if (affected.has(edge.source) && !affected.has(edge.target)) { affected.add(edge.target); changed = true; }
    }
  }
  for (const run of input.runs) {
    if (!affected.has(run.nodeId) || roots.has(run.nodeId)) continue;
    const ref = resolveWorkflowNodeExecutorRef(findWorkflowNode(input.root, run.nodeId));
    const semantics = ref ? resolveCoreWorkflowExecutorSemantics(ref) : null;
    if (!semantics) throw new Error(`media_adoption_executor_unknown:${run.nodeId}`);
    if (semantics.sideEffect === "none" || ref === "agents.logical-task/v2") continue;
    const output = parseWorkflowNodeOutputV1(run.outputRefs);
    if (["running", "waiting_external", "success"].includes(run.status)
      || (output && (output.artifacts.length > 0 || output.itemRuns.some((item) =>
        item.artifacts.length > 0 || typeof item.evidence.taskId === "string")))
      || (output && typeof output.evidence.taskId === "string")) {
      throw new Error(`media_adoption_downstream_receipt_exists:${run.nodeId}`);
    }
  }
}

export function validateWorkflowMediaAdoptionTargets(input: {
  adoptions: readonly WorkflowMediaAdoption[];
  outputs: readonly Readonly<{ nodeId: string; outputRefs: unknown }>[];
}): void {
  for (const adoption of input.adoptions) {
    const source = input.outputs.find((item) => item.nodeId === adoption.nodeId);
    const output = parseWorkflowNodeOutputV1(source?.outputRefs);
    if (!output || output.executorRef !== "tapcanvas.image.generate/v1" || output.executionMode !== "each") {
      throw new Error(`media_adoption_image_collection_required:${adoption.nodeId}`);
    }
    const item = output.itemRuns.find((candidate) => candidate.itemId === adoption.itemId);
    if (!item) throw new Error(`media_adoption_item_missing:${adoption.itemId}`);
    if (item.status !== "success" && item.status !== "failed") {
      throw new Error(`media_adoption_item_unsettled:${adoption.itemId}`);
    }
  }
}

/** Remove only amended items from the *new* replay cursor, not stored history.
 * Every untouched receipt remains eligible for ordinary reconciliation.
 */
export function workflowMediaAdoptionCheckpoint(
  output: WorkflowNodeOutputV1,
  adoptions: readonly Pick<WorkflowMediaAdoption, "nodeId" | "itemId">[],
): WorkflowNodeOutputV1 {
  const ids = new Set(adoptions.filter((item) => item.nodeId === output.nodeId).map((item) => item.itemId));
  if (ids.size === 0) return output;
  const itemRuns = output.itemRuns.filter((item) => !ids.has(item.itemId));
  return { ...output, ports: {}, artifacts: itemRuns.flatMap((item) => item.artifacts), itemRuns,
    evidence: { executorCompleted: false, adoptedItemIds: [...ids],
      retainedItemCount: itemRuns.length, sourceEvidence: output.evidence } };
}
