import type { StoryPlan } from "./video-orchestrator.orchestrate";
import { buildCanonicalVideoReferenceNodeIds } from "./video-orchestrator.clip-reference-contract";

export type BeatSheetReferenceAuthorityResult =
  | {
      ok: true;
      restoredClipIndexes: number[];
    }
  | {
      ok: false;
      code: "beat_sheet_reference_authority_invalid";
      message: string;
    };

type BeatReferenceAuthority = {
  clipIndex: number;
  videoReferenceNodeIds: string[];
};

function parseBeatReferenceAuthorities(beatSheetJson: string): BeatReferenceAuthority[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(beatSheetJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const beats = (parsed as Record<string, unknown>).beats;
  if (!Array.isArray(beats) || beats.length === 0) return null;

  const authorities: BeatReferenceAuthority[] = [];
  for (const [expectedClipIndex, rawBeat] of beats.entries()) {
    if (!rawBeat || typeof rawBeat !== "object" || Array.isArray(rawBeat)) return null;
    const beat = rawBeat as Record<string, unknown>;
    const clipIndex = Number(beat.clipIndex);
    const videoReferenceNodeIds = Array.isArray(beat.videoReferenceNodeIds)
      ? beat.videoReferenceNodeIds.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    const assetObjectContracts = Array.isArray(beat.assetObjectContracts)
      ? beat.assetObjectContracts.flatMap((rawContract) => {
          if (!rawContract || typeof rawContract !== "object" || Array.isArray(rawContract)) {
            return [];
          }
          const record = rawContract as Record<string, unknown>;
          const referenceImageNodeIds = Array.isArray(record.referenceImageNodeIds)
            ? record.referenceImageNodeIds
                .map((value) => String(value ?? "").trim())
                .filter(Boolean)
            : [];
          return [{ referenceImageNodeIds }];
        })
      : [];
    if (clipIndex !== expectedClipIndex) return null;
    authorities.push({
      clipIndex,
      videoReferenceNodeIds: buildCanonicalVideoReferenceNodeIds({
        videoReferenceNodeIds,
        assetObjectContracts,
      }),
    });
  }
  return authorities;
}

/**
 * A committed BeatSheet owns each clip's canonical video-image node IDs: explicit business anchors
 * plus every asset-object reference compiled into the same list. Start-time self-healing cannot
 * append extra boards or ensemble images after the reference budget has passed.
 */
export function restoreBeatSheetVideoReferenceAuthority(input: {
  plan: StoryPlan;
  beatSheetJson: string;
}): BeatSheetReferenceAuthorityResult {
  const authorities = parseBeatReferenceAuthorities(input.beatSheetJson);
  if (!authorities) {
    return {
      ok: false,
      code: "beat_sheet_reference_authority_invalid",
      message: "已提交 BeatSheet 缺少连续 clipIndex 或合法图片引用声明，无法恢复视频引用权威。",
    };
  }
  if (authorities.length !== input.plan.clips.length) {
    return {
      ok: false,
      code: "beat_sheet_reference_authority_invalid",
      message: `已提交 BeatSheet 含 ${authorities.length} 镜，但 StoryPlan 含 ${input.plan.clips.length} 镜，无法一一恢复视频引用权威。`,
    };
  }

  const authorityByClipIndex = new Map(authorities.map((item) => [item.clipIndex, item]));
  const restoredClipIndexes: number[] = [];
  for (const [planIndex, clip] of input.plan.clips.entries()) {
    const clipIndex = planIndex;
    const authority = authorityByClipIndex.get(clipIndex);
    if (!authority) {
      return {
        ok: false,
        code: "beat_sheet_reference_authority_invalid",
        message: `StoryPlan 镜${clipIndex} 在已提交 BeatSheet 中没有对应引用权威。`,
      };
    }
    const nextReferenceIds = authority.videoReferenceNodeIds;
    const previousReferenceIds = Array.isArray(clip.videoReferenceNodeIds)
      ? clip.videoReferenceNodeIds
      : [];
    if (
      previousReferenceIds.length !== nextReferenceIds.length ||
      previousReferenceIds.some((nodeId, index) => nodeId !== nextReferenceIds[index])
    ) {
      restoredClipIndexes.push(clipIndex);
    }
    clip.videoReferenceNodeIds = nextReferenceIds;
  }

  return { ok: true, restoredClipIndexes };
}
