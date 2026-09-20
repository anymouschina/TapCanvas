import { expect, it, vi } from "vitest";
import { projectWorkflowAssetReference } from "./execution.asset-reference-projection";
import type { WorkflowToolInvocationRequest } from "./execution.tool-runner";

const request = { executionId: "run-1", executionFamilyId: "family-1", runtimeNodeId: "image:asset-1",
 ownerId: "owner-1", projectId: "project-1", flowId: "flow-1", chapterId: "chapter-2", assetId: "chapter-1-asset", itemIndex: 2 };
it("projects the exact reused asset on the destination chapter through the existing idempotent tool", async () => {
 const invokeTool = vi.fn(async () => ({ toolName: "tapcanvas_asset_add_to_canvas", content: "", execution: null,
  data: { ready: true, nodeId: "destination-reference", alreadyPresent: true } }));
 expect(await projectWorkflowAssetReference({ ...request, invokeTool })).toEqual({ status: "success", nodeId: "destination-reference" });
 expect(invokeTool).toHaveBeenCalledWith(expect.objectContaining({ chapterId: "chapter-2", toolName: "tapcanvas_asset_add_to_canvas",
  args: expect.objectContaining({ assetId: "chapter-1-asset", node: expect.objectContaining({ data: expect.objectContaining({ kind: "image", workflowAssetOrigin: "existing_asset" }) }) }) }));
});
it("retains a presentation failure as evidence without re-generating or discarding the source asset", async () => {
 const invokeTool = vi.fn(async () => { throw new Error("canvas unavailable"); });
 expect(await projectWorkflowAssetReference({ ...request, invokeTool })).toEqual({ status: "failed", error: "canvas unavailable" });
 expect(invokeTool).toHaveBeenCalledTimes(1);
});
it("bounds projected identities independently of nested source IDs and keeps family isolation", async () => {
 const ids: string[] = [];
 const invokeTool = vi.fn(async (call: WorkflowToolInvocationRequest) => {
  const node = call.args.node as { id: string };
  ids.push(node.id);
  return { toolName: call.toolName, content: "", execution: null, data: { ready: true, nodeId: node.id } };
 });
 const longRequest = { ...request, runtimeNodeId: "nested-来源".repeat(200), invokeTool };
 await projectWorkflowAssetReference(longRequest);
 await projectWorkflowAssetReference({ ...longRequest, executionId: "resumed-run" });
 await projectWorkflowAssetReference({ ...longRequest, executionFamilyId: "other-family" });
 expect(ids[0]?.length).toBeLessThan(100);
 expect(ids[1]).toBe(ids[0]);
 expect(ids[2]).not.toBe(ids[0]);
});

it("retains the authored object name and type on reused assets without changing source identity", async () => {
 const invokeTool = vi.fn(async () => ({ toolName: "tapcanvas_asset_add_to_canvas", content: "", execution: null,
  data: { ready: true, nodeId: "destination-reference" } }));
 await projectWorkflowAssetReference({ ...request, invokeTool, assetMetadata: {
  label: "张羽", displayName: "张羽", referenceType: "character", workflowObjectId: "object-student",
 } });
 expect(invokeTool).toHaveBeenCalledWith(expect.objectContaining({ args: expect.objectContaining({
  assetId: request.assetId, node: expect.objectContaining({ data: expect.objectContaining({
   label: "张羽", displayName: "张羽", referenceType: "character", workflowObjectId: "object-student",
  }) }),
 }) }));
});
