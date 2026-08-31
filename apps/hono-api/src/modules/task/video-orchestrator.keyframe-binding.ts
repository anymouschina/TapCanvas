import type { VideoFlowNode } from "./video-orchestrator.flow-io";

/**
 * A keyframe-to-clip handoff is intentionally metadata-driven. The image node
 * must declare the exact run and clip slot it belongs to; labels, prompts,
 * positions, and graph proximity are not binding evidence.
 */
export type ExplicitClipKeyframeBinding = {
  clipIndex: number;
  nodeId: string;
  storyboardFrameCount?: number;
};

type ClipKeyframeBindingFailureCode =
  | "clip_keyframe_binding_ambiguous"
  | "clip_keyframe_binding_conflict"
  | "clip_keyframe_binding_metadata_invalid";

export type ClipKeyframeBindingResult<T> =
  | {
      ok: true;
      clips: T[];
      bindings: ExplicitClipKeyframeBinding[];
    }
  | {
      ok: false;
      code: ClipKeyframeBindingFailureCode;
      message: string;
      details: Record<string, unknown>;
    };

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNonNegativeInteger(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function readOptionalFrameCount(value: unknown): number | undefined {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return undefined;
  }
  const parsed = readNonNegativeInteger(value);
  return parsed !== null && parsed >= 1 && parsed <= 3 ? parsed : undefined;
}

function hasFrameCountValue(value: unknown): boolean {
  return value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");
}

function isImageNodeKind(value: unknown): boolean {
  const kind = readTrimmedString(value);
  return kind === "image" || kind === "imageEdit" || kind === "storyboardImage";
}

/**
 * Bind explicitly declared clip keyframes to a plan/BeatSheet.
 *
 * The caller supplies the clip-index and field accessors so this helper can be
 * shared by the BeatSheet and incremental add_clips paths without weakening
 * either type contract. It only fills a missing binding or verifies that an
 * already declared binding agrees with the image node's structural metadata.
 */
export function bindExplicitClipKeyframes<T>(input: {
  runId: string;
  clips: readonly T[];
  nodes: readonly VideoFlowNode[];
  clipIndexFor: (clip: T, arrayIndex: number) => number;
  existingNodeIdFor: (clip: T) => string;
  existingFrameCountFor: (clip: T) => number | undefined;
  withBinding: (clip: T, binding: ExplicitClipKeyframeBinding) => T;
}): ClipKeyframeBindingResult<T> {
  const runId = readTrimmedString(input.runId);
  if (!runId) {
    return { ok: true, clips: [...input.clips], bindings: [] };
  }

  const candidatesByClip = new Map<number, ExplicitClipKeyframeBinding[]>();
  for (const node of input.nodes) {
    const nodeId = readTrimmedString(node.id);
    const data = node.data ?? {};
    if (!nodeId || !isImageNodeKind(data.kind)) continue;
    if (readTrimmedString(data.clipRunId) !== runId) continue;
    if (readTrimmedString(data.storyboardScope) !== "clip") continue;
    if (readTrimmedString(data.creationStage) !== "beat_keyframe") continue;

    const clipIndex = readNonNegativeInteger(data.clipIndex);
    if (clipIndex === null) continue;

    let storyboardFrameCount: number | undefined;
    if (hasFrameCountValue(data.storyboardFrameCount)) {
      storyboardFrameCount = readOptionalFrameCount(data.storyboardFrameCount);
      if (storyboardFrameCount === undefined) {
        return {
          ok: false,
          code: "clip_keyframe_binding_metadata_invalid",
          message:
            `关键帧节点 ${nodeId} 的 storyboardFrameCount 无效；必须是 1～3 的整数。`,
          details: { nodeId, clipIndex, storyboardFrameCount: data.storyboardFrameCount },
        };
      }
    }

    const candidates = candidatesByClip.get(clipIndex) ?? [];
    if (!candidates.some((candidate) => candidate.nodeId === nodeId)) {
      candidates.push({
        clipIndex,
        nodeId,
        ...(storyboardFrameCount !== undefined ? { storyboardFrameCount } : {}),
      });
    }
    candidatesByClip.set(clipIndex, candidates);
  }

  for (const [clipIndex, candidates] of candidatesByClip) {
    if (candidates.length > 1) {
      return {
        ok: false,
        code: "clip_keyframe_binding_ambiguous",
        message:
          `run ${runId} 的 clip ${clipIndex} 有多个显式关键帧节点，无法确定唯一消费节点。`,
        details: {
          runId,
          clipIndex,
          nodeIds: candidates.map((candidate) => candidate.nodeId),
        },
      };
    }
  }

  const bindings: ExplicitClipKeyframeBinding[] = [];
  const clips: T[] = [];
  for (const [arrayIndex, clip] of input.clips.entries()) {
    const clipIndex = input.clipIndexFor(clip, arrayIndex);
    const candidate = candidatesByClip.get(clipIndex)?.[0];
    if (!candidate) {
      clips.push(clip);
      continue;
    }

    const existingNodeId = readTrimmedString(input.existingNodeIdFor(clip));
    if (existingNodeId && existingNodeId !== candidate.nodeId) {
      return {
        ok: false,
        code: "clip_keyframe_binding_conflict",
        message:
          `clip ${clipIndex} 已声明关键帧 ${existingNodeId}，但显式 clip 绑定指向 ${candidate.nodeId}。`,
        details: {
          runId,
          clipIndex,
          existingNodeId,
          candidateNodeId: candidate.nodeId,
        },
      };
    }

    const existingFrameCount = input.existingFrameCountFor(clip);
    if (
      existingFrameCount !== undefined &&
      candidate.storyboardFrameCount !== undefined &&
      existingFrameCount !== candidate.storyboardFrameCount
    ) {
      return {
        ok: false,
        code: "clip_keyframe_binding_conflict",
        message:
          `clip ${clipIndex} 已声明 ${existingFrameCount} 状态关键帧，但节点 ${candidate.nodeId} 声明 ${candidate.storyboardFrameCount} 状态。`,
        details: {
          runId,
          clipIndex,
          nodeId: candidate.nodeId,
          existingFrameCount,
          candidateFrameCount: candidate.storyboardFrameCount,
        },
      };
    }

    const binding: ExplicitClipKeyframeBinding = {
      clipIndex,
      nodeId: candidate.nodeId,
      ...(candidate.storyboardFrameCount !== undefined && existingFrameCount === undefined
        ? { storyboardFrameCount: candidate.storyboardFrameCount }
        : {}),
    };
    clips.push(input.withBinding(clip, binding));
    bindings.push({
      clipIndex,
      nodeId: candidate.nodeId,
      ...(candidate.storyboardFrameCount !== undefined
        ? { storyboardFrameCount: candidate.storyboardFrameCount }
        : {}),
    });
  }

  return { ok: true, clips, bindings };
}
