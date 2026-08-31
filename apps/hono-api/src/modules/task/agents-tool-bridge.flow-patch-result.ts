type FlowPatchNodeSnapshot = {
  id?: unknown;
  type?: unknown;
  data?: unknown;
  position?: unknown;
};

type FlowPatchEdgeSnapshot = {
  id?: unknown;
  source?: unknown;
  target?: unknown;
  sourceHandle?: unknown;
  targetHandle?: unknown;
};

const SAFE_NODE_DATA_KEYS = [
  "kind",
  "label",
  "status",
  "taskId",
  "assetId",
  "assetRefId",
  "serverAssetId",
  "roleName",
  "roleId",
  "roleCardId",
  "scenePropRefId",
  "visualRefId",
  "sourceBookId",
  "sourceNodeId",
  "clipRunId",
  "clipIndex",
  "sequenceIndex",
  "productionLayer",
  "creationStage",
  "approvalStatus",
  "referenceImageNodeIds",
  "referenceAssetIds",
] as const;

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasHttpMedia(value: unknown): boolean {
  if (typeof value === "string") return /^https?:\/\//i.test(value.trim());
  if (Array.isArray(value)) return value.some(hasHttpMedia);
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).some(hasHttpMedia);
}

function copySafeNodeValue(value: unknown): unknown {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return [...value];
  }
  return undefined;
}

export function summarizeFlowPatchNodeForAgent(
  snapshot: FlowPatchNodeSnapshot,
): Record<string, unknown> {
  const data = readRecord(snapshot.data);
  const safeData: Record<string, unknown> = {};
  for (const key of SAFE_NODE_DATA_KEYS) {
    const value = copySafeNodeValue(data[key]);
    if (value !== undefined) safeData[key] = value;
  }
  safeData.hasMedia = [
    data.imageUrl,
    data.videoUrl,
    data.audioUrl,
    data.imageResults,
    data.videoResults,
    data.audioResults,
    data.lastResult,
  ].some(hasHttpMedia);

  const position = readRecord(snapshot.position);
  return {
    id: String(snapshot.id ?? ""),
    ...(typeof snapshot.type === "string" ? { type: snapshot.type } : {}),
    ...(Object.keys(safeData).length > 0 ? { data: safeData } : {}),
    ...(typeof position.x === "number" && typeof position.y === "number"
      ? { position: { x: position.x, y: position.y } }
      : {}),
  };
}

export function buildAgentFlowPatchResult(input: {
  flowId: string;
  updatedAt: string;
  stats: Record<string, unknown>;
  createdNodeSnapshots: FlowPatchNodeSnapshot[];
  createdEdgeSnapshots: FlowPatchEdgeSnapshot[];
}): Record<string, unknown> {
  return {
    ok: true,
    flowId: input.flowId,
    updatedAt: input.updatedAt,
    stats: input.stats,
    createdNodeSnapshots: input.createdNodeSnapshots.map(summarizeFlowPatchNodeForAgent),
    createdEdgeSnapshots: input.createdEdgeSnapshots.map((edge) => ({
      id: String(edge.id ?? ""),
      source: String(edge.source ?? ""),
      target: String(edge.target ?? ""),
      ...(typeof edge.sourceHandle === "string" ? { sourceHandle: edge.sourceHandle } : {}),
      ...(typeof edge.targetHandle === "string" ? { targetHandle: edge.targetHandle } : {}),
    })),
  };
}
