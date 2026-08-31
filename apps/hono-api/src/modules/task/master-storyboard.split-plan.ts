import {
  MasterShotTableSchema,
  describeMasterShotTableIssues,
  type MasterShotTable,
  type MasterShotTableIssue,
  type MasterStoryboardSegment,
} from "./master-storyboard.types";
import type { VideoFlowNode } from "./video-orchestrator.flow-io";

export type MasterStoryboardSplitNodeSpec = {
  id: string;
  type: "taskNode" | "groupNode";
  position: { x: number; y: number };
  parentId?: string;
  data: Record<string, unknown>;
  style?: { width: number; height: number };
};

export type MasterStoryboardSplitEdgeSpec = {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
};

export type MasterStoryboardSplitFailure = {
  ok: false;
  code: string;
  message: string;
  issues?: MasterShotTableIssue[];
  allowedDurationSeconds?: number[];
  conflictingIds?: string[];
};

export type MasterStoryboardSplitPlan = {
  ok: true;
  masterShotTable: MasterShotTable;
  segmentCount: number;
  groupNodeId: string;
  createNodes: MasterStoryboardSplitNodeSpec[];
  createEdges: MasterStoryboardSplitEdgeSpec[];
  reusedNodeIds: string[];
  reusedEdgeIds: string[];
  patchNodeData: Array<{ id: string; data: Record<string, unknown> }>;
};

type MasterStoryboardSplitPlanInput = {
  masterBoardNodeId: string;
  runId: string;
  videoModel: string;
  aspect?: string;
  parentGroupId?: string;
  masterShotTable?: unknown;
  allowedDurationSeconds: readonly number[];
  nodes: readonly VideoFlowNode[];
  edges: readonly Record<string, unknown>[];
};

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = asRecord(value);
  if (record) {
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function copySourceProvenance(data: Record<string, unknown>): Record<string, unknown> {
  const copied: Record<string, unknown> = {};
  for (const key of ["sourceBookId", "materialChapter", "bookId", "chapterId"] as const) {
    const value = readTrimmedString(data[key]);
    if (value) copied[key] = value;
  }
  const productionMetadata = asRecord(data.productionMetadata);
  if (productionMetadata) copied.productionMetadata = productionMetadata;
  return copied;
}

function nodeParentId(node: VideoFlowNode): string {
  return readTrimmedString(node.parentId ?? node.parentNode);
}

function nodeMatchesExpectedIdentity(
  existing: VideoFlowNode,
  expected: MasterStoryboardSplitNodeSpec,
): boolean {
  if (readTrimmedString(existing.type) !== expected.type) return false;
  if (nodeParentId(existing) !== readTrimmedString(expected.parentId)) return false;
  const actual = existing.data ?? {};
  const wanted = expected.data;
  const identityKeys =
    expected.type === "groupNode"
      ? ["isGroup", "groupKind", "clipRunId", "masterBoardNodeId"]
      : wanted.kind === "storyboardImage"
        ? ["kind", "clipRunId", "masterBoardNodeId", "segmentIndex", "storyboardScope"]
        : wanted.kind === "video"
          ? [
              "kind",
              "clipRunId",
              "clipIndex",
              "masterBoardNodeId",
              "storyboardImageNodeId",
              "durationSeconds",
              "videoModel",
            ]
          : ["kind", "clipRunId", "masterBoardNodeId"];
  return identityKeys.every((key) => canonicalJson(actual[key]) === canonicalJson(wanted[key]));
}

function edgeMatchesExpectedIdentity(
  existing: Record<string, unknown>,
  expected: MasterStoryboardSplitEdgeSpec,
): boolean {
  return (["source", "target", "sourceHandle", "targetHandle"] as const).every(
    (key) => canonicalJson(existing[key]) === canonicalJson(expected[key]),
  );
}

function createSegmentNodes(input: {
  masterBoardNodeId: string;
  runId: string;
  videoModel: string;
  aspect: string;
  groupNodeId: string;
  sourceProvenance: Record<string, unknown>;
  segment: MasterStoryboardSegment;
  column: number;
  row: number;
}): { board: MasterStoryboardSplitNodeSpec; video: MasterStoryboardSplitNodeSpec } {
  const boardId = `storyboard-${input.runId}-${input.segment.segmentIndex}`;
  const board: MasterStoryboardSplitNodeSpec = {
    id: boardId,
    type: "taskNode",
    parentId: input.groupNodeId,
    position: { x: 40 + input.column * 360, y: 80 + input.row * 520 },
    data: {
      kind: "storyboardImage",
      label: `小故事板 · ${input.segment.beatName}`,
      status: "planned",
      productionLayer: "design_board",
      creationStage: "beat_keyframe",
      approvalStatus: "needs_confirmation",
      storyboardScope: "clip",
      clipRunId: input.runId,
      masterBoardNodeId: input.masterBoardNodeId,
      segmentIndex: input.segment.segmentIndex,
      masterStoryboardSegment: input.segment,
      promptNeedsFill: true,
      ...(input.aspect ? { aspectRatio: input.aspect } : {}),
      ...input.sourceProvenance,
    },
  };
  const video: MasterStoryboardSplitNodeSpec = {
    id: `video-${input.runId}-${input.segment.segmentIndex}`,
    type: "taskNode",
    parentId: input.groupNodeId,
    position: { x: 40 + input.column * 360, y: 300 + input.row * 520 },
    data: {
      kind: "video",
      label: `视频 · ${input.segment.beatName}`,
      status: "planned",
      productionLayer: "execution",
      creationStage: "video_plan",
      approvalStatus: "needs_confirmation",
      clipRunId: input.runId,
      clipIndex: input.segment.segmentIndex,
      durationSeconds: input.segment.durationSeconds,
      videoModel: input.videoModel,
      storyboardImageNodeId: boardId,
      masterBoardNodeId: input.masterBoardNodeId,
      masterStoryboardSegment: input.segment,
      promptNeedsFill: true,
      ...(input.aspect ? { videoAspect: input.aspect, aspectRatio: input.aspect } : {}),
      ...input.sourceProvenance,
    },
  };
  return { board, video };
}

function validateGroupPins(input: {
  groupNode: VideoFlowNode;
  videoModel: string;
  aspect: string;
}): MasterStoryboardSplitFailure | { ok: true; patch: Record<string, unknown> } {
  if (readTrimmedString(input.groupNode.type) !== "groupNode") {
    return {
      ok: false,
      code: "master_storyboard_parent_group_invalid",
      message: `Parent node ${input.groupNode.id} is not a groupNode.`,
      conflictingIds: [input.groupNode.id],
    };
  }
  const patch: Record<string, unknown> = {};
  const currentModel = readTrimmedString(input.groupNode.data.videoModel);
  if (currentModel && currentModel !== input.videoModel) {
    return {
      ok: false,
      code: "master_storyboard_parent_group_model_conflict",
      message: `Parent group pins videoModel=${currentModel}, but the split requested ${input.videoModel}.`,
      conflictingIds: [input.groupNode.id],
    };
  }
  if (!currentModel) patch.videoModel = input.videoModel;
  const currentAspect =
    readTrimmedString(input.groupNode.data.videoAspect) ||
    readTrimmedString(input.groupNode.data.aspectRatio);
  if (input.aspect && currentAspect && currentAspect !== input.aspect) {
    return {
      ok: false,
      code: "master_storyboard_parent_group_aspect_conflict",
      message: `Parent group pins aspect=${currentAspect}, but the split requested ${input.aspect}.`,
      conflictingIds: [input.groupNode.id],
    };
  }
  if (input.aspect && !currentAspect) patch.videoAspect = input.aspect;
  return { ok: true, patch };
}

export function planMasterStoryboardSplit(
  input: MasterStoryboardSplitPlanInput,
): MasterStoryboardSplitPlan | MasterStoryboardSplitFailure {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node] as const));
  const masterNode = nodeById.get(input.masterBoardNodeId);
  if (!masterNode) {
    return {
      ok: false,
      code: "master_board_node_missing",
      message: `Master board node ${input.masterBoardNodeId} does not exist in the authorized canvas.`,
    };
  }
  if (
    readTrimmedString(masterNode.type) !== "taskNode" ||
    readTrimmedString(masterNode.data.kind) !== "storyboardImage" ||
    readTrimmedString(masterNode.data.productionLayer) !== "master_board"
  ) {
    return {
      ok: false,
      code: "master_board_node_invalid",
      message:
        "The selected node must be a taskNode with data.kind=storyboardImage and data.productionLayer=master_board.",
      conflictingIds: [input.masterBoardNodeId],
    };
  }

  const directTableProvided = typeof input.masterShotTable !== "undefined";
  const rawTable = directTableProvided ? input.masterShotTable : masterNode.data.masterShotTable;
  const parsedTable = MasterShotTableSchema.safeParse(rawTable);
  if (!parsedTable.success) {
    return {
      ok: false,
      code: "master_shot_table_invalid",
      message:
        "masterShotTable is missing or structurally invalid. Repair it in the authoring agent and retry; the server does not coerce or fabricate missing fields.",
      issues: describeMasterShotTableIssues(parsedTable.error),
    };
  }
  const masterShotTable = parsedTable.data;
  const allowedDurations = Array.from(new Set(input.allowedDurationSeconds)).sort((a, b) => a - b);
  const unsupportedSegments = masterShotTable.segments.filter(
    (segment) => !allowedDurations.includes(segment.durationSeconds),
  );
  if (unsupportedSegments.length > 0) {
    return {
      ok: false,
      code: "master_shot_table_duration_unsupported",
      message:
        "One or more segment durations are not supported by the selected enabled video model. Revise the authored table using the catalog durationOptions and retry.",
      allowedDurationSeconds: allowedDurations,
      conflictingIds: unsupportedSegments.map((segment) => String(segment.segmentIndex)),
    };
  }

  const patchNodeData: Array<{ id: string; data: Record<string, unknown> }> = [];
  if (directTableProvided) {
    const existingRawTable = masterNode.data.masterShotTable;
    if (typeof existingRawTable !== "undefined") {
      const existingTable = MasterShotTableSchema.safeParse(existingRawTable);
      if (!existingTable.success || canonicalJson(existingTable.data) !== canonicalJson(masterShotTable)) {
        return {
          ok: false,
          code: "master_shot_table_write_conflict",
          message:
            "The master node already contains a different masterShotTable. Explicitly resolve that overwrite with tapcanvas_flow_patch, then retry the split without conflicting table data.",
          conflictingIds: [input.masterBoardNodeId],
        };
      }
    } else {
      patchNodeData.push({ id: input.masterBoardNodeId, data: { masterShotTable } });
    }
  }

  const aspect =
    readTrimmedString(input.aspect) ||
    readTrimmedString(masterNode.data.aspectRatio) ||
    readTrimmedString(masterNode.data.videoAspect);
  const inheritedGroupId = nodeParentId(masterNode);
  const requestedGroupId = readTrimmedString(input.parentGroupId) || inheritedGroupId;
  const autoGroupId = `group-${input.runId}`;
  const groupNodeId = requestedGroupId || autoGroupId;
  const existingGroup = nodeById.get(groupNodeId);
  const sourceProvenance = copySourceProvenance(masterNode.data);
  const columns = Math.min(4, masterShotTable.segments.length);
  const rows = Math.ceil(masterShotTable.segments.length / columns);
  const masterPosition = asRecord(masterNode.position);
  const masterPositionX =
    typeof masterPosition?.x === "number" && Number.isFinite(masterPosition.x)
      ? masterPosition.x
      : 0;
  const masterPositionY =
    typeof masterPosition?.y === "number" && Number.isFinite(masterPosition.y)
      ? masterPosition.y
      : 0;
  const groupSpec: MasterStoryboardSplitNodeSpec = {
    id: groupNodeId,
    type: "groupNode",
    position: {
      x: masterPositionX,
      y: masterPositionY + 320,
    },
    data: {
      isGroup: true,
      groupKind: "master_storyboard_split",
      label: `${masterShotTable.title} · 拆板`,
      clipRunId: input.runId,
      masterBoardNodeId: input.masterBoardNodeId,
      videoModel: input.videoModel,
      ...(aspect ? { videoAspect: aspect } : {}),
    },
    style: {
      width: Math.max(900, columns * 360 + 80),
      height: rows * 520 + 300,
    },
  };

  const allExpectedNodes: MasterStoryboardSplitNodeSpec[] = [];
  if (!existingGroup) {
    if (requestedGroupId) {
      return {
        ok: false,
        code: "master_storyboard_parent_group_missing",
        message: `Requested parent group ${requestedGroupId} does not exist in the authorized canvas.`,
        conflictingIds: [requestedGroupId],
      };
    }
    allExpectedNodes.push(groupSpec);
  } else {
    const groupPins = validateGroupPins({ groupNode: existingGroup, videoModel: input.videoModel, aspect });
    if (!groupPins.ok) return groupPins;
    if (Object.keys(groupPins.patch).length > 0) {
      patchNodeData.push({ id: groupNodeId, data: groupPins.patch });
    }
    if (!requestedGroupId && !nodeMatchesExpectedIdentity(existingGroup, groupSpec)) {
      return {
        ok: false,
        code: "master_storyboard_split_node_conflict",
        message: `Stable auto-group id ${groupNodeId} is occupied by a different node identity.`,
        conflictingIds: [groupNodeId],
      };
    }
  }

  const allExpectedEdges: MasterStoryboardSplitEdgeSpec[] = [];
  const composeId = `film-${input.runId}`;
  masterShotTable.segments.forEach((segment, index) => {
    const pair = createSegmentNodes({
      masterBoardNodeId: input.masterBoardNodeId,
      runId: input.runId,
      videoModel: input.videoModel,
      aspect,
      groupNodeId,
      sourceProvenance,
      segment,
      column: index % columns,
      row: Math.floor(index / columns),
    });
    allExpectedNodes.push(pair.board, pair.video);
    allExpectedEdges.push(
      {
        id: `edge-${input.runId}-master-${segment.segmentIndex}`,
        source: input.masterBoardNodeId,
        target: pair.board.id,
        sourceHandle: "out-image",
        targetHandle: "in-image",
      },
      {
        id: `edge-${input.runId}-board-${segment.segmentIndex}`,
        source: pair.board.id,
        target: pair.video.id,
        sourceHandle: "out-image",
        targetHandle: "in-any",
      },
      {
        id: `edge-${input.runId}-compose-${segment.segmentIndex}`,
        source: pair.video.id,
        target: composeId,
        sourceHandle: "out-video",
        targetHandle: "in-any",
      },
    );
  });
  allExpectedNodes.push({
    id: composeId,
    type: "taskNode",
    parentId: groupNodeId,
    position: { x: 40, y: 80 + rows * 520 },
    data: {
      kind: "composeVideo",
      label: "成片合成",
      status: "planned",
      productionLayer: "results",
      creationStage: "result_persistence",
      approvalStatus: "needs_confirmation",
      clipRunId: input.runId,
      masterBoardNodeId: input.masterBoardNodeId,
      ...sourceProvenance,
    },
  });

  const createNodes: MasterStoryboardSplitNodeSpec[] = [];
  const reusedNodeIds: string[] = [];
  const conflictingNodeIds: string[] = [];
  for (const expected of allExpectedNodes) {
    const existing = nodeById.get(expected.id);
    if (!existing) {
      createNodes.push(expected);
    } else if (nodeMatchesExpectedIdentity(existing, expected)) {
      reusedNodeIds.push(expected.id);
    } else {
      conflictingNodeIds.push(expected.id);
    }
  }
  if (conflictingNodeIds.length > 0) {
    return {
      ok: false,
      code: "master_storyboard_split_node_conflict",
      message:
        "One or more stable split node ids are occupied by nodes with a different structured identity. No patch was written.",
      conflictingIds: conflictingNodeIds,
    };
  }

  const edgeById = new Map(
    input.edges
      .map((edge) => [readTrimmedString(edge.id), edge] as const)
      .filter(([id]) => Boolean(id)),
  );
  const createEdges: MasterStoryboardSplitEdgeSpec[] = [];
  const reusedEdgeIds: string[] = [];
  const conflictingEdgeIds: string[] = [];
  for (const expected of allExpectedEdges) {
    const existing = edgeById.get(expected.id);
    if (!existing) {
      createEdges.push(expected);
    } else if (edgeMatchesExpectedIdentity(existing, expected)) {
      reusedEdgeIds.push(expected.id);
    } else {
      conflictingEdgeIds.push(expected.id);
    }
  }
  if (conflictingEdgeIds.length > 0) {
    return {
      ok: false,
      code: "master_storyboard_split_edge_conflict",
      message:
        "One or more stable split edge ids are occupied by edges with a different structured identity. No patch was written.",
      conflictingIds: conflictingEdgeIds,
    };
  }

  return {
    ok: true,
    masterShotTable,
    segmentCount: masterShotTable.segments.length,
    groupNodeId,
    createNodes,
    createEdges,
    reusedNodeIds,
    reusedEdgeIds,
    patchNodeData,
  };
}
