/** Seedance 2.0 单个视频任务最多接受的音色参考数量。 */
export const MAX_CLIP_REFERENCE_AUDIOS = 3;

export const SPEAKER_REFERENCE_AUDIO_LIMIT_EXCEEDED =
  "speaker_reference_audio_limit_exceeded";

export type SpeakerReferenceAudioBudgetIssue = {
  code: typeof SPEAKER_REFERENCE_AUDIO_LIMIT_EXCEEDED;
  speakerCount: number;
  maxSpeakerCount: number;
  speakerNames: string[];
};

export function normalizeSpeakerNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

export function validateSpeakerReferenceAudioBudget(
  value: unknown,
): SpeakerReferenceAudioBudgetIssue | null {
  const speakerNames = normalizeSpeakerNames(value);
  if (speakerNames.length <= MAX_CLIP_REFERENCE_AUDIOS) return null;
  return {
    code: SPEAKER_REFERENCE_AUDIO_LIMIT_EXCEEDED,
    speakerCount: speakerNames.length,
    maxSpeakerCount: MAX_CLIP_REFERENCE_AUDIOS,
    speakerNames,
  };
}
