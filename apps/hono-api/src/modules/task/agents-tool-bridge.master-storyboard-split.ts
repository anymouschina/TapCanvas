import { z } from "zod";

import type { AppContext } from "../../types";
import type { FlowRow } from "../flow/flow.repo";
import { FLOW_NODE_ID_MAX_LENGTH } from "../flow/flow-node-id.constants";
import {
  persistFlowPatch,
  readFlowEdges,
  readFlowNodes,
} from "./video-orchestrator.flow-io";
import { resolveModelDurationOptions } from "./video-orchestrator.model-duration";
import {
  planMasterStoryboardSplit,
  type MasterStoryboardSplitFailure,
} from "./master-storyboard.split-plan";

const StableRunIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, {
    message: "runId must use only letters, numbers, dot, underscore, colon, or hyphen",
  });

export const MasterStoryboardSplitArgsSchema = z
  .object({
    masterBoardNodeId: z.string().trim().min(1).max(FLOW_NODE_ID_MAX_LENGTH),
    runId: StableRunIdSchema,
    videoModel: z.string().trim().min(1).max(200),
    aspect: z.string().trim().regex(/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/).optional(),
    parentGroupId: z.string().trim().min(1).max(FLOW_NODE_ID_MAX_LENGTH).optional(),
    masterShotTable: z.unknown().optional(),
  })
  .strict();

export type MasterStoryboardSplitToolSuccess = {
  ok: true;
  deliveryState: "structure_ready";
  requiresAgentContinuation: true;
  masterBoardNodeId: string;
  runId: string;
  videoModel: string;
  allowedDurationSeconds: number[];
  segmentCount: number;
  groupNodeId: string;
  createdNodes: number;
  reusedNodes: number;
  createdEdges: number;
  reusedEdges: number;
  patchedNodes: number;
  createdNodeIds: string[];
  reusedNodeIds: string[];
  createdEdgeIds: string[];
  reusedEdgeIds: string[];
  pendingActions: string[];
};

export type MasterStoryboardSplitToolResult =
  | MasterStoryboardSplitToolSuccess
  | MasterStoryboardSplitFailure;

function invalidArgsFailure(error: z.ZodError): MasterStoryboardSplitFailure {
  return {
    ok: false,
    code: "master_storyboard_split_args_invalid",
    message:
      "Master storyboard split arguments are invalid. Supply explicit runId/videoModel and structured values; no defaults are applied.",
    issues: error.issues.map((issue) => ({
      path: issue.path,
      message: issue.message,
      code: issue.code,
    })),
  };
}

export async function splitMasterStoryboardForAgent(input: {
  c: AppContext;
  row: FlowRow;
  flowId: string;
  chapterId?: string;
  requestUserId: string;
  devBypass: boolean;
  bodyArgs: Record<string, unknown>;
}): Promise<MasterStoryboardSplitToolResult> {
  const parsedArgs = MasterStoryboardSplitArgsSchema.safeParse(input.bodyArgs);
  if (!parsedArgs.success) return invalidArgsFailure(parsedArgs.error);
  const args = parsedArgs.data;

  let allowedDurationSeconds: number[];
  try {
    allowedDurationSeconds = await resolveModelDurationOptions({
      c: input.c,
      modelKey: args.videoModel,
    });
  } catch (error) {
    return {
      ok: false,
      code: "master_storyboard_video_model_unavailable",
      message: `The selected video model cannot provide an enabled duration contract: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const plan = planMasterStoryboardSplit({
    masterBoardNodeId: args.masterBoardNodeId,
    runId: args.runId,
    videoModel: args.videoModel,
    ...(args.aspect ? { aspect: args.aspect } : {}),
    ...(args.parentGroupId ? { parentGroupId: args.parentGroupId } : {}),
    ...(Object.prototype.hasOwnProperty.call(args, "masterShotTable")
      ? { masterShotTable: args.masterShotTable }
      : {}),
    allowedDurationSeconds,
    nodes: readFlowNodes(input.row),
    edges: readFlowEdges(input.row),
  });
  if (!plan.ok) return plan;

  if (
    plan.createNodes.length > 0 ||
    plan.createEdges.length > 0 ||
    plan.patchNodeData.length > 0
  ) {
    await persistFlowPatch({
      c: input.c,
      row: input.row,
      flowId: input.flowId,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
      patch: {
        ...(plan.createNodes.length > 0 ? { createNodes: plan.createNodes } : {}),
        ...(plan.createEdges.length > 0 ? { createEdges: plan.createEdges } : {}),
        ...(plan.patchNodeData.length > 0 ? { patchNodeData: plan.patchNodeData } : {}),
      },
      affectedNodeIds: Array.from(
        new Set([
          ...plan.createNodes.map((node) => node.id),
          ...plan.patchNodeData.map((item) => item.id),
        ]),
      ),
    });
  }

  // A split is deliberately not a media delivery. The authoring agent must
  // still write specialist prompts and execute each asset-producing node.
  return {
    ok: true,
    deliveryState: "structure_ready",
    requiresAgentContinuation: true,
    masterBoardNodeId: args.masterBoardNodeId,
    runId: args.runId,
    videoModel: args.videoModel,
    allowedDurationSeconds,
    segmentCount: plan.segmentCount,
    groupNodeId: plan.groupNodeId,
    createdNodes: plan.createNodes.length,
    reusedNodes: plan.reusedNodeIds.length,
    createdEdges: plan.createEdges.length,
    reusedEdges: plan.reusedEdgeIds.length,
    patchedNodes: plan.patchNodeData.length,
    createdNodeIds: plan.createNodes.map((node) => node.id),
    reusedNodeIds: plan.reusedNodeIds,
    createdEdgeIds: plan.createEdges.map((edge) => edge.id),
    reusedEdgeIds: plan.reusedEdgeIds,
    pendingActions: [
      "Write model-ready prompts into every child storyboard and video node using the appropriate agents-cli specialists.",
      "Generate each child storyboard to a real persisted image URL before executing its downstream video node.",
      "Generate every video to a real persisted video URL, then execute the compose node and verify its durable asset URL.",
    ],
  };
}
