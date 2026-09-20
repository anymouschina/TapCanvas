const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const requiredText = value => typeof value === 'string' ? value.trim() : '';

/** Shared structural speech identity contract; null denotes an authored occurrence. */
export function inspectNarrativeAudioPlan(plan, dialogueScript, path) {
  if (plan !== undefined) {
    if (!isRecord(plan)
      || !Array.isArray(plan.lines)) {
      return `${path}.narrativeAudioPlan.lines must be an array`;
    }
    const narrativeLineIds = new Set();
    for (const [lineIndex, rawLine] of plan.lines.entries()) {
      const linePath = `${path}.narrativeAudioPlan.lines[${lineIndex}]`;
      if (!isRecord(rawLine)) return `${linePath} must be an object`;
      const lineId = requiredText(rawLine.lineId);
      if (!lineId) return `${linePath}.lineId must be non-empty`;
      if (narrativeLineIds.has(lineId)) return `${linePath}.lineId must be unique`;
      narrativeLineIds.add(lineId);
      if (!requiredText(rawLine.speakerName)) return `${linePath}.speakerName must be non-empty`;
      if (!requiredText(rawLine.text)) return `${linePath}.text must be non-empty`;
      if (rawLine.delivery !== undefined
        && rawLine.delivery !== "on_screen"
        && rawLine.delivery !== "off_screen"
        && rawLine.delivery !== "voice_over") {
        return `${linePath}.delivery must be on_screen/off_screen/voice_over`;
      }
      if (rawLine.sourceLineId !== undefined && rawLine.sourceLineId !== null && !requiredText(rawLine.sourceLineId)) return `${linePath}.sourceLineId must be a non-empty source identity`;
      if (typeof rawLine.sourceLineId === "string" && !dialogueScript.some(
        source => isRecord(source) && source.lineId === rawLine.sourceLineId,
      )) return `${linePath}.sourceLineId must reference an existing dialogueScript lineId`;
      if (rawLine.afterSourceLineId !== null && !requiredText(rawLine.afterSourceLineId)) {
        return `${linePath}.afterSourceLineId must be a non-empty string or null`;
      }
      if (typeof rawLine.afterSourceLineId === 'string' && !dialogueScript.some(
        source => isRecord(source) && source.lineId === rawLine.afterSourceLineId,
      )) return `${linePath}.afterSourceLineId must reference an existing dialogueScript lineId`;
      if (!Array.isArray(rawLine.sourceEvidence)
        || rawLine.sourceEvidence.some((value) => typeof value !== "string")) {
        return `${linePath}.sourceEvidence must be a string array`;
      }
    }
  }
  return null;
}
