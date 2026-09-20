import { createHash } from "node:crypto";
import type { WorkflowToolInvocationRequest, WorkflowToolInvocationResult } from "./execution.tool-runner";

/** Presentation receipt only: failures never discard an already resolved image. */
export async function projectWorkflowAssetReference(input: {
 executionId: string; executionFamilyId: string; runtimeNodeId: string; ownerId: string;
 projectId: string; flowId: string; chapterId?: string; assetId: string; itemIndex: number;
 assetMetadata?: Readonly<Record<string, unknown>>;
 invokeTool?: (request: WorkflowToolInvocationRequest) => Promise<WorkflowToolInvocationResult>;
}): Promise<{ status: "success"; nodeId: string } | { status: "failed"; error: string }> {
 try {
  if (!input.invokeTool) throw new Error("workflow_asset_projection_tool_unavailable");
  const result = await input.invokeTool({
   executionId: input.executionId, nodeId: `asset-reference:${createHash("sha256").update(input.runtimeNodeId).digest("hex")}`, ownerId: input.ownerId,
   projectId: input.projectId, flowId: input.flowId, chapterId: input.chapterId,
   toolName: "tapcanvas_asset_add_to_canvas",
   args: { assetId: input.assetId, referenceRole: "content", node: {
    id: `workflow-reference-${createHash("sha256").update(JSON.stringify([input.executionFamilyId, input.runtimeNodeId, input.assetId])).digest("hex")}`,
    type: "taskNode", position: { x: 160, y: 120 + input.itemIndex * 360 },
    data: { ...input.assetMetadata, kind: "image", workflowExecutionId: input.executionId,
     workflowExecutionFamilyId: input.executionFamilyId, workflowRuntimeNodeId: input.runtimeNodeId,
     workflowAssetOrigin: "existing_asset" },
   } },
  });
  const nodeId = result.data?.nodeId;
  if (result.data?.ready !== true || typeof nodeId !== "string" || !nodeId) throw new Error("workflow_asset_projection_receipt_invalid");
  return { status: "success", nodeId };
 } catch (error: unknown) {
  return { status: "failed", error: error instanceof Error ? error.message : String(error) };
 }
}
