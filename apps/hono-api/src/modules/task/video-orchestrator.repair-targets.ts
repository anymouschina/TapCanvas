export type BeatSheetRepairTargets = {
  header: boolean;
  clipIndexes: number[];
  continuityClipIndexes: number[];
};

export type BeatSheetRepairAction =
  | "preflight_get_header"
  | "preflight_get_beat"
  | "preflight_patch_header"
  | "preflight_patch_beat"
  | "preflight_repair_continuity"
  | "preflight_commit";

/** Build the exact operation surface from deterministic graph addresses. */
export function buildBeatSheetRepairActions(
  targets: BeatSheetRepairTargets,
): BeatSheetRepairAction[] {
  return [
    ...(targets.header
      ? ["preflight_get_header", "preflight_patch_header"] as const
      : []),
    ...(targets.clipIndexes.length > 0
      ? ["preflight_get_beat", "preflight_patch_beat"] as const
      : []),
    ...(targets.continuityClipIndexes.length > 0
      ? ["preflight_repair_continuity"] as const
      : []),
    "preflight_commit",
  ];
}

/**
 * True only for the deterministic adjacent-boundary paths owned by
 * `preflight_repair_continuity`. This parses validator path grammar; it does
 * not inspect story text or infer creative meaning.
 */
export function isInheritedContinuityRepairIssue(issue: string): boolean {
  const trimmed = issue.trim();
  if (!trimmed.startsWith("beats[")) return false;
  const closeBracket = trimmed.indexOf("]", "beats[".length);
  if (closeBracket <= "beats[".length) return false;
  const parsedIndex = Number(trimmed.slice("beats[".length, closeBracket));
  if (!Number.isInteger(parsedIndex) || parsedIndex <= 0) return false;
  return trimmed.slice(closeBracket + 1).startsWith(".continuityLedger.entry.");
}

/**
 * Extract deterministic graph node addresses from validator paths.
 * This parses only the public `beats[index]` path grammar; it never interprets
 * story text or chooses a creative repair.
 */
export function resolveBeatSheetRepairTargets(
  issues: readonly string[],
): BeatSheetRepairTargets {
  const clipIndexes = new Set<number>();
  const continuityClipIndexes = new Set<number>();
  let header = false;
  for (const rawIssue of issues) {
    const issue = rawIssue.trim();
    if (!issue.startsWith("beats[")) {
      header = true;
      continue;
    }
    const closeBracket = issue.indexOf("]", "beats[".length);
    const parsedIndex = closeBracket > "beats[".length
      ? Number(issue.slice("beats[".length, closeBracket))
      : Number.NaN;
    if (Number.isInteger(parsedIndex) && parsedIndex >= 0) {
      clipIndexes.add(parsedIndex);
      if (isInheritedContinuityRepairIssue(issue)) {
        continuityClipIndexes.add(parsedIndex);
      }
    } else {
      header = true;
    }
  }
  return {
    header,
    clipIndexes: [...clipIndexes].sort((left, right) => left - right),
    continuityClipIndexes: [...continuityClipIndexes].sort((left, right) => left - right),
  };
}
