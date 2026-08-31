import type { CanvasFlow } from "../chapter/chapter.canvas-flow.schemas";
import type { ChapterDto } from "../chapter/chapter.schemas";
import {
  selectFlowNodesForTool,
  type FlowGetSelectOpts,
  type FlowNodeFull,
} from "./chapter-canvas-summary";

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function readBoundedInteger(value: unknown, maximum: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(maximum, Math.trunc(value)));
}

export function buildProjectChapterReadPayload(input: {
  chapter: ChapterDto;
  revision: number;
  flow: CanvasFlow | null;
  args: Record<string, unknown>;
}) {
  const nodes = (input.flow?.nodes ?? []) as FlowNodeFull[];
  const edges = input.flow?.edges ?? [];
  const nodeIds = readStringArray(input.args.nodeIds);
  const fields = readStringArray(input.args.fields);
  const limit = readBoundedInteger(input.args.limit, 200);
  const offset = readBoundedInteger(input.args.offset, Number.MAX_SAFE_INTEGER);
  const selectOptions: FlowGetSelectOpts = {
    ...(nodeIds ? { nodeIds } : {}),
    ...(fields ? { fields } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
  };
  const selected = selectFlowNodesForTool(nodes, selectOptions);
  const sourceNodeId = `chapter-seed-${input.chapter.id}`;
  const sourceNode = nodes.find((node) => String(node.id ?? "") === sourceNodeId);
  const sourceData = sourceNode?.data && typeof sourceNode.data === "object" && !Array.isArray(sourceNode.data)
    ? sourceNode.data as Record<string, unknown>
    : null;
  const sourceHash = typeof sourceData?.sourceHash === "string" && sourceData.sourceHash.trim()
    ? sourceData.sourceHash.trim()
    : null;
  const storyPreviewContract = sourceData?.storyPreviewContract
    && typeof sourceData.storyPreviewContract === "object"
    && !Array.isArray(sourceData.storyPreviewContract)
      ? sourceData.storyPreviewContract
      : null;

  return {
    // Concurrency and source-identity facts deliberately come first. Chapter
    // summaries can be very large and provider-side structural projection may
    // abbreviate their tail; callers must never lose the CAS revision/hash
    // needed by the next chapter update or story-preview generation action.
    canvasRevision: input.revision,
    sourceHash,
    sourceNodeId: sourceNode ? sourceNodeId : null,
    storyPreviewContract,
    chapter: input.chapter,
    sourceKind: input.chapter.sourceBookId ? "uploaded_book" as const : "manual" as const,
    canvas: {
      initialized: input.flow !== null,
      revision: input.revision,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      selectionMode: selected.mode,
      nodes: selected.nodes,
      edges,
      ...(selected.total !== undefined
        ? {
            matched: selected.total,
            shown: selected.shown,
            offset: selected.offset,
          }
        : {}),
      hint: selected.mode === "slim"
        ? "章节元数据（含本章构思 summary）已完整返回；画布节点为精简事实。需要读取某个文本节点时，再传 nodeIds 和所需 fields。"
        : "已按 nodeIds 返回指定章节画布节点，并仅保留显式 fields 或默认执行事实字段。",
    },
  };
}
