import { classifyCanvasCardForRegistry } from "./material-card-classify";
import { readPropMaterialIdentity } from "./prop-material-identity";

type AnyRecord = Record<string, unknown>;

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNodeData(node: unknown): AnyRecord {
  if (!node || typeof node !== "object" || Array.isArray(node)) return {};
  const data = (node as AnyRecord).data;
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as AnyRecord)
    : {};
}

function hasRealImage(data: AnyRecord): boolean {
  if (/^https?:\/\//.test(readString(data.imageUrl))) return true;
  if (!Array.isArray(data.imageResults)) return false;
  return data.imageResults.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    return /^https?:\/\//.test(readString((item as AnyRecord).url));
  });
}

function resolveSuccessfulStateTargets(input: {
  currentNodes: unknown[];
  patch: AnyRecord;
}): Array<{ nodeId: string; canonicalName: string }> {
  const currentById = new Map<string, AnyRecord>();
  for (const node of input.currentNodes) {
    const id = readString((node as AnyRecord | undefined)?.id);
    if (id) currentById.set(id, readNodeData(node));
  }
  const candidates: Array<{ nodeId: string; data: AnyRecord }> = [];
  if (Array.isArray(input.patch.createNodes)) {
    for (const node of input.patch.createNodes) {
      const nodeId = readString((node as AnyRecord | undefined)?.id);
      if (nodeId) candidates.push({ nodeId, data: readNodeData(node) });
    }
  }
  if (Array.isArray(input.patch.patchNodeData)) {
    for (const item of input.patch.patchNodeData) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const record = item as AnyRecord;
      const nodeId = readString(record.id);
      const patchData =
        record.data && typeof record.data === "object" && !Array.isArray(record.data)
          ? (record.data as AnyRecord)
          : {};
      if (nodeId) {
        candidates.push({
          nodeId,
          data: { ...(currentById.get(nodeId) ?? {}), ...patchData },
        });
      }
    }
  }
  return candidates.flatMap((candidate) => {
    const identity = readPropMaterialIdentity(candidate.data);
    if (
      identity?.mode !== "state" ||
      readString(candidate.data.status) !== "success" ||
      !hasRealImage(candidate.data)
    ) {
      return [];
    }
    return [{ nodeId: candidate.nodeId, canonicalName: identity.canonicalName }];
  });
}

export function consolidateSuccessfulPropStatePatch(input: {
  currentNodes: unknown[];
  currentEdges: unknown[];
  patch: AnyRecord | null | undefined;
}): {
  patch: AnyRecord;
  replacements: Array<{
    canonicalName: string;
    stateNodeId: string;
    removedNodeIds: string[];
  }>;
} {
  const patch = input.patch ?? {};
  const targets = resolveSuccessfulStateTargets({ currentNodes: input.currentNodes, patch });
  if (!targets.length) return { patch, replacements: [] };

  const deleteNodeIds = new Set(
    Array.isArray(patch.deleteNodeIds)
      ? patch.deleteNodeIds.map(readString).filter(Boolean)
      : [],
  );
  const createEdges = Array.isArray(patch.createEdges) ? [...patch.createEdges] : [];
  const existingEdgeKeys = new Set<string>();
  for (const edge of [...input.currentEdges, ...createEdges]) {
    if (!edge || typeof edge !== "object" || Array.isArray(edge)) continue;
    const record = edge as AnyRecord;
    existingEdgeKeys.add(
      `${readString(record.source)}->${readString(record.target)}:${readString(record.sourceHandle)}:${readString(record.targetHandle)}`,
    );
  }

  const replacements: Array<{
    canonicalName: string;
    stateNodeId: string;
    removedNodeIds: string[];
  }> = [];
  for (const target of targets) {
    const removedNodeIds = input.currentNodes
      .filter((node) => {
        const nodeId = readString((node as AnyRecord | undefined)?.id);
        if (!nodeId || nodeId === target.nodeId) return false;
        const classification = classifyCanvasCardForRegistry(readNodeData(node));
        return classification?.kind === "prop" && classification.name === target.canonicalName;
      })
      .map((node) => readString((node as AnyRecord).id));
    if (!removedNodeIds.length) continue;

    for (const removedNodeId of removedNodeIds) deleteNodeIds.add(removedNodeId);
    for (const edge of input.currentEdges) {
      if (!edge || typeof edge !== "object" || Array.isArray(edge)) continue;
      const record = edge as AnyRecord;
      const source = readString(record.source);
      const targetId = readString(record.target);
      if (!removedNodeIds.includes(source) && !removedNodeIds.includes(targetId)) continue;
      const nextSource = removedNodeIds.includes(source) ? target.nodeId : source;
      const nextTarget = removedNodeIds.includes(targetId) ? target.nodeId : targetId;
      if (!nextSource || !nextTarget || nextSource === nextTarget) continue;
      if (deleteNodeIds.has(nextSource) || deleteNodeIds.has(nextTarget)) continue;
      const key = `${nextSource}->${nextTarget}:${readString(record.sourceHandle)}:${readString(record.targetHandle)}`;
      if (existingEdgeKeys.has(key)) continue;
      existingEdgeKeys.add(key);
      createEdges.push({
        ...record,
        id: `prop-state-${target.nodeId}-${readString(record.id) || crypto.randomUUID()}`,
        source: nextSource,
        target: nextTarget,
      });
    }
    replacements.push({
      canonicalName: target.canonicalName,
      stateNodeId: target.nodeId,
      removedNodeIds,
    });
  }

  if (!replacements.length) return { patch, replacements: [] };
  return {
    patch: {
      ...patch,
      deleteNodeIds: [...deleteNodeIds],
      ...(createEdges.length ? { createEdges } : {}),
    },
    replacements,
  };
}
