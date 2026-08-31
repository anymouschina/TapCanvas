import { z } from "zod";

import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { PublicFlowCreateTaskNodeSchema } from "../flow/flow.public.schemas";
import type { FlowRow } from "../flow/flow.repo";
import { resolveExecutionImageReferences } from "./agents-tool-bridge.image-reference-ids";
import {
  freshReadFlowRow,
  persistFlowPatch,
  readFlowNodes,
} from "./video-orchestrator.flow-io";

const AssetReferenceRoleSchema = z.enum([
  "layout",
  "style",
  "identity",
  "content",
]);

const AssetCanvasNodeSchema = PublicFlowCreateTaskNodeSchema.superRefine(
  (node, context) => {
    if (node.data.kind !== "image") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "node.data.kind must be image",
        path: ["data", "kind"],
      });
    }
  },
);

export const PublicAgentsAssetAddToCanvasArgsSchema = z.object({
  assetId: z.string().trim().min(1),
  referenceRole: AssetReferenceRoleSchema,
  referenceStrength: z.number().finite().min(0).max(1).optional(),
  node: AssetCanvasNodeSchema,
});

export type PublicAgentsAssetAddToCanvasResult = {
  ok: true;
  flowId: string;
  updatedAt: string;
  nodeId: string;
  assetId: string;
  assetRefId: string | null;
  name: string;
  referenceRole: z.infer<typeof AssetReferenceRoleSchema>;
  ready: true;
  alreadyPresent: boolean;
};

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolve an uploaded/material image asset at the server boundary and place a
 * previewable image node on the authorized canvas. The agent only supplies and
 * receives stable IDs; the storage URL remains inside the persisted node.
 */
export async function addAssetToCanvas(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  row: FlowRow;
  bodyArgs: unknown;
  chapterId?: string;
}): Promise<PublicAgentsAssetAddToCanvasResult> {
  const parsed = PublicAgentsAssetAddToCanvasArgsSchema.safeParse(input.bodyArgs);
  if (!parsed.success) {
    throw new AppError("Invalid asset add to canvas request", {
      status: 400,
      code: "invalid_asset_add_to_canvas_request",
      details: { issues: parsed.error.issues },
    });
  }

  const { assetId, referenceRole, referenceStrength, node } = parsed.data;
  const [reference] = await resolveExecutionImageReferences({
    c: input.c,
    ownerId: input.requestUserId,
    row: input.row,
    assetIds: [assetId],
  });
  if (!reference) {
    throw new AppError("Asset did not resolve to a ready image", {
      status: 422,
      code: "agents_tool_image_reference_unresolved",
      details: { missingAssetIds: [assetId] },
    });
  }

  // `row` was captured before this tool invocation. A durable continuation can
  // replay presentation after another physical window already placed the same
  // immutable asset on the canvas. Always inspect the current graph and use
  // the natural (assetId, referenceRole) binding as the idempotency identity;
  // node labels, positions and model-generated node ids are not stable across
  // physical windows.
  const currentRow = await freshReadFlowRow({
    c: input.c,
    flowId: input.flowId,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
  });
  const currentNodes = readFlowNodes(currentRow);
  const existingBinding = currentNodes.find((candidate) => {
    const existingAssetId =
      readTrimmedString(candidate.data.sourceAssetId) ||
      readTrimmedString(candidate.data.assetId);
    return existingAssetId === assetId &&
      readTrimmedString(candidate.data.referenceRole) === referenceRole;
  });
  if (existingBinding) {
    return {
      ok: true,
      flowId: input.chapterId || input.flowId,
      updatedAt: currentRow.updated_at,
      nodeId: existingBinding.id,
      assetId,
      assetRefId: reference.assetRefId,
      name: reference.name,
      referenceRole,
      ready: true,
      alreadyPresent: true,
    };
  }

  const nodeId = readTrimmedString(node.id) || crypto.randomUUID();
  const label = readTrimmedString(node.data.label) || reference.name;
  const existing = currentNodes.find((candidate) => candidate.id === nodeId);
  if (existing) {
    const existingAssetId =
      readTrimmedString(existing.data.sourceAssetId) ||
      readTrimmedString(existing.data.assetId);
    const existingRole = readTrimmedString(existing.data.referenceRole);
    if (existingAssetId !== assetId || existingRole !== referenceRole) {
      throw new AppError("Canvas node ID already exists with different asset binding", {
        status: 409,
        code: "asset_canvas_node_conflict",
        details: { nodeId, assetId, referenceRole },
      });
    }
    return {
      ok: true,
      flowId: input.chapterId || input.flowId,
      updatedAt: currentRow.updated_at,
      nodeId,
      assetId,
      assetRefId: reference.assetRefId,
      name: reference.name,
      referenceRole,
      ready: true,
      alreadyPresent: true,
    };
  }

  const finalNode = {
    ...node,
    id: nodeId,
    data: {
      ...node.data,
      kind: "image" as const,
      label,
      status: "success",
      imageUrl: reference.url,
      imageResults: [
        {
          url: reference.url,
          title: label,
          assetId,
          ...(reference.assetRefId ? { assetRefId: reference.assetRefId } : {}),
        },
      ],
      imagePrimaryIndex: 0,
      assetId,
      sourceAssetId: assetId,
      ...(reference.assetRefId ? { assetRefId: reference.assetRefId } : {}),
      referenceAssetIds: [assetId],
      referenceRole,
      ...(referenceStrength !== undefined ? { referenceStrength } : {}),
      approvalStatus: "approved" as const,
    },
  };

  const persisted = await persistFlowPatch({
    c: input.c,
    row: currentRow,
    flowId: input.flowId,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    patch: { createNodes: [finalNode] },
    affectedNodeIds: [nodeId],
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
  });

  return {
    ok: true,
    flowId: input.chapterId || persisted.row.id,
    updatedAt: persisted.row.updated_at,
    nodeId,
    assetId,
    assetRefId: reference.assetRefId,
    name: reference.name,
    referenceRole,
    ready: true,
    alreadyPresent: false,
  };
}
