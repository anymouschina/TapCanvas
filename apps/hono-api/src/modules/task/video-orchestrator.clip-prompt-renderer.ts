import { formatAssetObjectReferenceLocks, type AssetReferenceIndicesByContractKey } from "./video-orchestrator.asset-object-contract";
import type { ClipSpeechEvent, FilmBible, StructuredClip } from "./video-orchestrator.clip-shots";

/** Only execution fields cross the provider boundary; planning evidence stays on the clip. */
export type ClipPromptRenderOptions = {
  assetReferenceIndicesByContractKey?: AssetReferenceIndicesByContractKey;
};

const speechDeliveryLabels: Record<ClipSpeechEvent["delivery"], string> = {
  on_screen: "画内对白",
  off_screen: "画外对白",
  voice_over: "旁白",
};

/** Pure projection: no semantic filtering, rewriting, or inferred state repair. */
export function renderClipPromptFromShots(
  clip: StructuredClip,
  _bible?: FilmBible | null,
  options?: ClipPromptRenderOptions,
): string {
  const fmtSec = (value: number): string => {
    // Match the verified clock's microsecond precision. Rounding to tenths
    // collapses short authored cuts and changes speech/impact alignment.
    return String(Number(value.toFixed(6)));
  };
  const serialize = (value: unknown): string => {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("structured_clip_prompt_value_not_serializable");
    return serialized;
  };
  // Canonical names remain the subjects. The reference header binds each
  // object to the final transport images without replacing prose substrings.
  const cell = (value: unknown): string => serialize(value)
    .trim()
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "／");
  const emittedSpeech = new Set<number>();
  const clock = (seconds: number): number => Number(seconds.toFixed(6));

  let elapsedSeconds = 0;
  const shotRows = (clip.shots ?? []).map((shot, index) => {
    const durationSeconds = Number(shot.durationSeconds);
    const startSeconds = elapsedSeconds;
    const endSeconds = clock(elapsedSeconds + durationSeconds);
    elapsedSeconds = endSeconds;
    if (typeof shot.action !== "string" || !shot.action.trim()) {
      throw new Error(`structured_clip_action_missing:shots[${index}].action`);
    }
    const visual = [
      shot.action,
      shot.framing,
      shot.lensIntent,
      shot.composition,
      shot.cameraMove,
      shot.lighting,
      shot.materialResponse,
    ].map(cell).filter(Boolean).join("；");
    const sfx = [shot.soundPerspective, shot.sound].map(cell).filter(Boolean).join("；");
    // Project the independent speech clock into the same shot rows. Emit each
    // verbatim line once; a cut carries the existing utterance, never restarts it.
    const speechRows = (clip.speechEvents ?? []).flatMap((event, eventIndex) => {
      const speechStart = clock(event.startSeconds);
      const speechEnd = clock(event.endSeconds);
      if (speechStart >= endSeconds || speechEnd <= startSeconds) return [];
      const overlap = `${fmtSec(Math.max(startSeconds, speechStart))}-${fmtSec(Math.min(endSeconds, speechEnd))}s`;
      if (emittedSpeech.has(eventIndex)) {
        return [`  对白接续（本镜 ${overlap}，${cell(event.speakerName)}，${speechDeliveryLabels[event.delivery]}）：续前句${speechEnd <= endSeconds ? `，${fmtSec(speechEnd)}s 结束` : ""}。`];
      }
      emittedSpeech.add(eventIndex);
      const performance = event.performance ? `，${cell(event.performance)}` : "";
      return [`  对白（${fmtSec(speechStart)}-${fmtSec(speechEnd)}s，${cell(event.speakerName)}，${speechDeliveryLabels[event.delivery]}${performance}）：${JSON.stringify(event.spokenText ?? "")}${speechEnd > endSeconds ? `；跨镜连续` : ""}`];
    });
    return [`镜头${shot.shotNo ?? index + 1}（${fmtSec(startSeconds)}-${fmtSec(endSeconds)}s）：${visual}${sfx ? `。声音：${sfx}` : ""}`, ...speechRows].join("\n");
  });

  const references = clip.assetObjectContracts?.length
    ? formatAssetObjectReferenceLocks(clip.assetObjectContracts, options?.assetReferenceIndicesByContractKey)
    : "";

  return [
    references,
    shotRows.join("\n"),
  ].filter(Boolean).join("\n\n");
}

