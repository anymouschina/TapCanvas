export const VOICE_REFERENCE_RELATION_KIND = "voice_reference" as const;
export const REFERENCE_ONLY_EXECUTION_ROLE = "reference_only" as const;
export const VOICE_REFERENCE_EDGE_LABEL = "音色" as const;

export type VoiceReferenceEdgeData = {
  edgeType: "audio";
  relationKind: typeof VOICE_REFERENCE_RELATION_KIND;
  executionRole: typeof REFERENCE_ONLY_EXECUTION_ROLE;
  label: typeof VOICE_REFERENCE_EDGE_LABEL;
};

export type CanvasEdgeDataCarrier = {
  data?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function createVoiceReferenceEdgeData(): VoiceReferenceEdgeData {
  return {
    edgeType: "audio",
    relationKind: VOICE_REFERENCE_RELATION_KIND,
    executionRole: REFERENCE_ONLY_EXECUTION_ROLE,
    label: VOICE_REFERENCE_EDGE_LABEL,
  };
}

export function buildVoiceReferenceEdgeId(sourceNodeId: string, targetNodeId: string): string {
  const source = sourceNodeId.trim();
  const target = targetNodeId.trim();
  if (!source || !target) {
    throw new Error("voice reference edge requires non-empty source and target node ids");
  }
  return `e-voice-reference-${source}-${target}`;
}

export function isReferenceOnlyCanvasEdge(
  edge: CanvasEdgeDataCarrier | null | undefined,
): boolean {
  return asRecord(edge?.data)?.executionRole === REFERENCE_ONLY_EXECUTION_ROLE;
}

export function isVoiceReferenceCanvasEdge(
  edge: CanvasEdgeDataCarrier | null | undefined,
): boolean {
  const data = asRecord(edge?.data);
  return (
    data?.edgeType === "audio" &&
    data.relationKind === VOICE_REFERENCE_RELATION_KIND &&
    data.executionRole === REFERENCE_ONLY_EXECUTION_ROLE
  );
}
