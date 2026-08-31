import {
  VOICE_REFERENCE_EDGE_LABEL,
  buildVoiceReferenceEdgeId,
  createVoiceReferenceEdgeData,
  isVoiceReferenceCanvasEdge,
  type VoiceReferenceEdgeData,
} from "@tapcanvas/canvas-edge-semantics";

export type VoiceReferenceEdgeSpec = {
  id: string;
  source: string;
  target: string;
  sourceHandle: "out-audio";
  targetHandle: "in-any";
  type: "typed";
  label: typeof VOICE_REFERENCE_EDGE_LABEL;
  data: VoiceReferenceEdgeData;
};

export type VoiceReferenceEdgeSyncPlan = {
  createEdges: VoiceReferenceEdgeSpec[];
  deleteEdgeIds: string[];
};

type LooseGraphNode = {
  id?: unknown;
  data?: unknown;
};

type LooseGraphEdge = {
  id?: unknown;
  source?: unknown;
  target?: unknown;
  sourceHandle?: unknown;
  targetHandle?: unknown;
  type?: unknown;
  label?: unknown;
  data?: unknown;
};

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function createVoiceReferenceEdge(source: string, target: string): VoiceReferenceEdgeSpec {
  return {
    id: buildVoiceReferenceEdgeId(source, target),
    source,
    target,
    sourceHandle: "out-audio",
    targetHandle: "in-any",
    type: "typed",
    label: VOICE_REFERENCE_EDGE_LABEL,
    data: createVoiceReferenceEdgeData(),
  };
}

function isCanonicalVoiceReferenceEdge(
  edge: LooseGraphEdge,
  expected: VoiceReferenceEdgeSpec,
): boolean {
  const data = asRecord(edge.data);
  return (
    trimmed(edge.id) === expected.id &&
    trimmed(edge.source) === expected.source &&
    trimmed(edge.target) === expected.target &&
    trimmed(edge.sourceHandle) === expected.sourceHandle &&
    trimmed(edge.targetHandle) === expected.targetHandle &&
    trimmed(edge.type) === expected.type &&
    trimmed(edge.label) === expected.label &&
    isVoiceReferenceCanvasEdge(edge) &&
    data.label === VOICE_REFERENCE_EDGE_LABEL
  );
}

function requireDeletableEdgeId(edge: LooseGraphEdge, reason: string): string {
  const id = trimmed(edge.id);
  if (!id) {
    throw new Error(`voice reference edge sync cannot repair an edge without id: ${reason}`);
  }
  return id;
}

/**
 * Reads the authoritative voice-card node ids written by the orchestrator into
 * video node `data.voiceBinding`. It performs only structural validation: the
 * referenced nodes themselves are validated against the fresh canvas graph by
 * `buildVoiceReferenceEdgeSyncPlan`.
 */
export function readVoiceReferenceNodeIds(voiceBinding: unknown): string[] {
  if (!Array.isArray(voiceBinding)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of voiceBinding) {
    const nodeId = trimmed(asRecord(item).nodeId);
    if (!nodeId || seen.has(nodeId)) continue;
    seen.add(nodeId);
    result.push(nodeId);
  }
  return result;
}

/**
 * Synchronizes visual voice provenance for one video clip.
 *
 * `voice_reference/reference_only` edges are deliberately not executable audio
 * edges. The plan hard-converts any ordinary direct edge for an authoritative
 * voice binding, removes stale reference edges, and emits deterministic edge ids
 * so repeated placeholder/final writes are idempotent.
 */
export function buildVoiceReferenceEdgeSyncPlan(input: {
  current: unknown;
  clipNodeId: string;
  voiceReferenceNodeIds: string[];
  targetWillBeCreated?: boolean;
}): VoiceReferenceEdgeSyncPlan {
  const clipNodeId = trimmed(input.clipNodeId);
  if (!clipNodeId) throw new Error("voice reference edge sync requires clipNodeId");

  const graph = asRecord(input.current);
  const nodes = Array.isArray(graph.nodes) ? graph.nodes as LooseGraphNode[] : [];
  const edges = Array.isArray(graph.edges) ? graph.edges as LooseGraphEdge[] : [];
  const nodesById = new Map<string, LooseGraphNode>();
  for (const node of nodes) {
    const id = trimmed(node.id);
    if (id) nodesById.set(id, node);
  }

  if (input.targetWillBeCreated !== true) {
    const target = nodesById.get(clipNodeId);
    if (!target) throw new Error(`voice reference target node does not exist: ${clipNodeId}`);
    const targetKind = trimmed(asRecord(target.data).kind).toLowerCase();
    if (targetKind !== "video" && targetKind !== "composevideo" && targetKind !== "videocompose") {
      throw new Error(`voice reference target must be a video node: ${clipNodeId}`);
    }
  }

  const desiredSourceIds: string[] = [];
  const desiredSet = new Set<string>();
  for (const rawSourceId of input.voiceReferenceNodeIds) {
    const sourceId = trimmed(rawSourceId);
    if (!sourceId || desiredSet.has(sourceId)) continue;
    const source = nodesById.get(sourceId);
    if (!source) throw new Error(`voice reference source node does not exist: ${sourceId}`);
    const sourceData = asRecord(source.data);
    if (
      trimmed(sourceData.kind).toLowerCase() !== "audio" ||
      trimmed(sourceData.audioType).toLowerCase() !== "voice_card"
    ) {
      throw new Error(`voice reference source is not an audio voice card: ${sourceId}`);
    }
    desiredSet.add(sourceId);
    desiredSourceIds.push(sourceId);
  }

  const expectedBySource = new Map(
    desiredSourceIds.map((sourceId) => [sourceId, createVoiceReferenceEdge(sourceId, clipNodeId)]),
  );
  for (const expected of expectedBySource.values()) {
    const collision = edges.find(
      (edge) =>
        trimmed(edge.id) === expected.id &&
        (trimmed(edge.source) !== expected.source || trimmed(edge.target) !== expected.target),
    );
    if (collision) {
      throw new Error(`voice reference edge id collision: ${expected.id}`);
    }
  }

  const deleteEdgeIds = new Set<string>();
  const createEdges: VoiceReferenceEdgeSpec[] = [];

  for (const edge of edges) {
    if (trimmed(edge.target) !== clipNodeId || !isVoiceReferenceCanvasEdge(edge)) continue;
    const source = trimmed(edge.source);
    if (!desiredSet.has(source)) {
      deleteEdgeIds.add(requireDeletableEdgeId(edge, `stale source ${source || "(empty)"}`));
    }
  }

  for (const sourceId of desiredSourceIds) {
    const expected = expectedBySource.get(sourceId);
    if (!expected) throw new Error(`voice reference edge plan lost expected source: ${sourceId}`);
    const pairEdges = edges.filter(
      (edge) => trimmed(edge.source) === sourceId && trimmed(edge.target) === clipNodeId,
    );
    if (pairEdges.length === 1 && isCanonicalVoiceReferenceEdge(pairEdges[0], expected)) continue;
    for (const edge of pairEdges) {
      deleteEdgeIds.add(requireDeletableEdgeId(edge, `non-canonical pair ${sourceId} -> ${clipNodeId}`));
    }
    createEdges.push(expected);
  }

  return { createEdges, deleteEdgeIds: [...deleteEdgeIds] };
}
