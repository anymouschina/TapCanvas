export const CLIP_CONTINUITY_MODES = [
  "editorial_cut",
  "bridge_frames",
  "reference_video",
] as const;

export type ClipContinuityMode = (typeof CLIP_CONTINUITY_MODES)[number];

export type ClipContinuityContractInput = {
  clipIndex: number;
  continuityMode?: unknown;
  storyboardImageNodeId?: unknown;
  lastFrameImageNodeId?: unknown;
  timeJumpNote?: unknown;
  chainFromPrevPresent?: boolean;
};

export type ClipContinuityContractIssue = {
  clipIndex: number;
  code:
    | "continuity_mode_required"
    | "legacy_chain_field_forbidden"
    | "first_clip_continuity_invalid"
    | "reference_video_time_jump_conflict"
    | "reference_video_previous_clip_missing"
    | "bridge_previous_clip_missing"
    | "bridge_storyboard_missing"
    | "bridge_previous_tail_missing"
    | "bridge_frame_mismatch"
    | "orphan_last_frame";
  message: string;
};

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readClipContinuityMode(value: unknown): ClipContinuityMode | null {
  const mode = trimmed(value) as ClipContinuityMode;
  return CLIP_CONTINUITY_MODES.includes(mode) ? mode : null;
}

/**
 * `continuityMode` 定义“本 clip 与上一 clip 的剪辑缝”：
 * - clip0 只能 editorial_cut（没有上游媒体）；
 * - editorial_cut 是有意剪切点；
 * - bridge_frames 必须由 `上一 clip.lastFrameImageNodeId === 本 clip.storyboardImageNodeId`
 *   形成同一真实桥接帧；
 * - reference_video 由调度层等待并引用上一段真实成片。
 *
 * `complete=false` 用于 add_clips 分批写入：只校验当前已存在的相邻边，不把尚未提交的槽位
 * 当作缺失；estimate/start 对完整序列使用 `complete=true` 收口。
 */
export function validateClipContinuitySequence(
  clips: readonly ClipContinuityContractInput[],
  options: { complete: boolean },
): ClipContinuityContractIssue[] {
  const byIndex = new Map(clips.map((clip) => [clip.clipIndex, clip]));
  const issues: ClipContinuityContractIssue[] = [];
  const add = (
    clipIndex: number,
    code: ClipContinuityContractIssue["code"],
    message: string,
  ): void => {
    if (!issues.some((issue) => issue.clipIndex === clipIndex && issue.code === code)) {
      issues.push({ clipIndex, code, message });
    }
  };

  for (const clip of [...clips].sort((left, right) => left.clipIndex - right.clipIndex)) {
    const clipIndex = clip.clipIndex;
    const mode = readClipContinuityMode(clip.continuityMode);
    if (!mode) {
      add(
        clipIndex,
        "continuity_mode_required",
        `clips[${clipIndex}].continuityMode 必须显式为 editorial_cut / bridge_frames / reference_video`,
      );
      continue;
    }
    if (clip.chainFromPrevPresent) {
      add(
        clipIndex,
        "legacy_chain_field_forbidden",
        `clips[${clipIndex}].chainFromPrev 是执行派生字段；只允许声明 continuityMode`,
      );
    }
    if (clipIndex === 0 && mode !== "editorial_cut") {
      add(
        clipIndex,
        "first_clip_continuity_invalid",
        "clips[0].continuityMode 必须为 editorial_cut；首 clip 没有上一段媒体或桥接帧可承接",
      );
    }
    if (mode === "reference_video" && trimmed(clip.timeJumpNote)) {
      add(
        clipIndex,
        "reference_video_time_jump_conflict",
        `clips[${clipIndex}] 同时声明 reference_video 与 timeJumpNote，物理连续和叙事跳时互相冲突`,
      );
    }

    const previous = byIndex.get(clipIndex - 1);
    if (mode === "reference_video" && clipIndex > 0 && !previous && options.complete) {
      add(
        clipIndex,
        "reference_video_previous_clip_missing",
        `clips[${clipIndex}] 声明 reference_video，但上一 clip 不存在`,
      );
    }
    const storyboardImageNodeId = trimmed(clip.storyboardImageNodeId);
    if (mode === "bridge_frames" && clipIndex > 0) {
      if (!previous) {
        if (options.complete) {
          add(
            clipIndex,
            "bridge_previous_clip_missing",
            `clips[${clipIndex}] 声明 bridge_frames，但上一 clip 不存在`,
          );
        }
      } else {
        const previousTailNodeId = trimmed(previous.lastFrameImageNodeId);
        if (!storyboardImageNodeId) {
          add(
            clipIndex,
            "bridge_storyboard_missing",
            `clips[${clipIndex}].storyboardImageNodeId 必填；它必须是与上一 clip 共用的真实桥接帧`,
          );
        }
        if (!previousTailNodeId) {
          add(
            clipIndex,
            "bridge_previous_tail_missing",
            `clips[${clipIndex - 1}].lastFrameImageNodeId 必填；下一 clip 已声明 bridge_frames`,
          );
        }
        if (
          storyboardImageNodeId &&
          previousTailNodeId &&
          storyboardImageNodeId !== previousTailNodeId
        ) {
          add(
            clipIndex,
            "bridge_frame_mismatch",
            `bridge_frames 未闭合：clips[${clipIndex - 1}].lastFrameImageNodeId=${previousTailNodeId}，` +
              `但 clips[${clipIndex}].storyboardImageNodeId=${storyboardImageNodeId}`,
          );
        }
      }
    }

    const next = byIndex.get(clipIndex + 1);
    const lastFrameImageNodeId = trimmed(clip.lastFrameImageNodeId);
    const nextMode = readClipContinuityMode(next?.continuityMode);
    if (nextMode === "bridge_frames") {
      const nextStoryboardImageNodeId = trimmed(next?.storyboardImageNodeId);
      if (!lastFrameImageNodeId) {
        add(
          clipIndex,
          "bridge_previous_tail_missing",
          `clips[${clipIndex}].lastFrameImageNodeId 必填；clips[${clipIndex + 1}] 已声明 bridge_frames`,
        );
      } else if (
        nextStoryboardImageNodeId &&
        lastFrameImageNodeId !== nextStoryboardImageNodeId
      ) {
        add(
          clipIndex + 1,
          "bridge_frame_mismatch",
          `bridge_frames 未闭合：clips[${clipIndex}].lastFrameImageNodeId=${lastFrameImageNodeId}，` +
            `但 clips[${clipIndex + 1}].storyboardImageNodeId=${nextStoryboardImageNodeId}`,
        );
      }
    } else if (lastFrameImageNodeId && (next || options.complete)) {
      add(
        clipIndex,
        "orphan_last_frame",
        `clips[${clipIndex}].lastFrameImageNodeId 只允许服务下一 clip 的 continuityMode=bridge_frames`,
      );
    }
  }
  return issues;
}
