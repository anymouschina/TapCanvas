import { countDialogueCapacityCharacters } from "./video-orchestrator.dialogue-conservation";

export type ShotDurationReconciliationEvidence = {
  originalTotalSeconds: number;
  finalTotalSeconds: number;
  changedShotIndexes: number[];
};

export type ShotDurationReconciliationResult =
  | {
      ok: true;
      clip: Record<string, unknown>;
      evidence: ShotDurationReconciliationEvidence | null;
    }
  | {
      ok: false;
      reason: "invalid_duration_structure" | "dialogue_capacity_exceeds_clip_duration";
    };

const EXECUTION_DURATION_UNIT_SECONDS = 0.1;
const DIALOGUE_MINIMUM_UNIT_SECONDS = 0.5;

function toDurationUnits(seconds: number): number | null {
  const units = seconds / EXECUTION_DURATION_UNIT_SECONDS;
  const roundedUnits = Math.round(units);
  return Math.abs(units - roundedUnits) < 1e-9 && roundedUnits > 0
    ? roundedUnits
    : null;
}

/**
 * Reconciles only executable duration numbers. Dialogue text, shot order,
 * actions, framing, continuity, and every other creative field remain byte-for-
 * byte owned by the writer. Dialogue minima stay rounded up to the frozen
 * half-second speaking unit; remaining executable timing uses a 0.1-second
 * unit so the compiler does not invent a 0.5-second creative minimum for
 * silent/reaction shots. The total clip duration remains exact.
 */
export function reconcileShotDurations(input: {
  clip: Record<string, unknown>;
  dialoguePaceRate: number;
}): ShotDurationReconciliationResult {
  const clipDurationSeconds = Number(input.clip.durationSeconds);
  const totalUnits = toDurationUnits(clipDurationSeconds);
  const dialoguePaceRate = Number(input.dialoguePaceRate);
  const rawShots = input.clip.shots;
  if (
    totalUnits === null ||
    !Number.isFinite(dialoguePaceRate) ||
    dialoguePaceRate <= 0 ||
    !Array.isArray(rawShots) ||
    rawShots.length === 0
  ) {
    return { ok: false, reason: "invalid_duration_structure" };
  }

  const shots: Record<string, unknown>[] = [];
  const originalDurations: number[] = [];
  const minimumUnits: number[] = [];
  for (const rawShot of rawShots) {
    if (!rawShot || typeof rawShot !== "object" || Array.isArray(rawShot)) {
      return { ok: false, reason: "invalid_duration_structure" };
    }
    const shot = rawShot as Record<string, unknown>;
    const durationSeconds = Number(shot.durationSeconds);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return { ok: false, reason: "invalid_duration_structure" };
    }
    const dialogue = typeof shot.dialogue === "string" ? shot.dialogue.trim() : "";
    const dialogueCharacters = countDialogueCapacityCharacters(dialogue);
    const dialogueMinimumSeconds = dialogueCharacters > 0
      ? Math.ceil(
          (dialogueCharacters / dialoguePaceRate) / DIALOGUE_MINIMUM_UNIT_SECONDS,
        ) * DIALOGUE_MINIMUM_UNIT_SECONDS
      : EXECUTION_DURATION_UNIT_SECONDS;
    const dialogueMinimumUnits = Math.round(
      dialogueMinimumSeconds / EXECUTION_DURATION_UNIT_SECONDS,
    );
    shots.push(shot);
    originalDurations.push(durationSeconds);
    minimumUnits.push(Math.max(1, dialogueMinimumUnits));
  }

  const minimumTotalUnits = minimumUnits.reduce((sum, value) => sum + value, 0);
  if (minimumTotalUnits > totalUnits) {
    return { ok: false, reason: "dialogue_capacity_exceeds_clip_duration" };
  }

  const originalTotalSeconds = originalDurations.reduce((sum, value) => sum + value, 0);
  const originalWeightTotal = originalDurations.reduce((sum, value) => sum + value, 0);
  const desiredUnits = originalDurations.map((duration) =>
    originalWeightTotal > 0 ? (duration / originalWeightTotal) * totalUnits : 0
  );
  const reconciledUnits = [...minimumUnits];
  let remainingUnits = totalUnits - minimumTotalUnits;
  while (remainingUnits > 0) {
    let selectedIndex = 0;
    let selectedDeficit = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < reconciledUnits.length; index += 1) {
      const deficit = (desiredUnits[index] ?? 0) - (reconciledUnits[index] ?? 0);
      if (deficit > selectedDeficit) {
        selectedDeficit = deficit;
        selectedIndex = index;
      }
    }
    reconciledUnits[selectedIndex] = (reconciledUnits[selectedIndex] ?? 0) + 1;
    remainingUnits -= 1;
  }

  const changedShotIndexes: number[] = [];
  const reconciledShots = shots.map((shot, index) => {
    const durationSeconds = Number(
      ((reconciledUnits[index] ?? 0) * EXECUTION_DURATION_UNIT_SECONDS).toFixed(1),
    );
    if (Math.abs(durationSeconds - originalDurations[index]) > 1e-9) {
      changedShotIndexes.push(index);
    }
    return { ...shot, durationSeconds };
  });
  if (changedShotIndexes.length === 0) {
    return { ok: true, clip: input.clip, evidence: null };
  }
  return {
    ok: true,
    clip: { ...input.clip, shots: reconciledShots },
    evidence: {
      originalTotalSeconds,
      finalTotalSeconds: clipDurationSeconds,
      changedShotIndexes,
    },
  };
}
