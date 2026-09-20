import { inspectNarrativeAudioPlan } from '../narrative-audio-contract/index.mjs';
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const requiredText = value => typeof value === 'string' ? value.trim() : '';
const isPositiveFiniteNumber = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function inspectBeatExecutionStructure(rawBeat, beatIndex) {
  const path = `beats[${beatIndex}]`;
  if (!isRecord(rawBeat)) return `${path} must be an object`;
  if (!isPositiveFiniteNumber(rawBeat.durationSeconds)) {
    return `${path}.durationSeconds must be positive`;
  }
  if (!Array.isArray(rawBeat.dialogueScript)) return `${path}.dialogueScript must be an array`;
  for (const [lineIndex, rawLine] of rawBeat.dialogueScript.entries()) {
    const linePath = `${path}.dialogueScript[${lineIndex}]`;
    if (!isRecord(rawLine)) return `${linePath} must be an object`;
    if (!requiredText(rawLine.lineId)) return `${linePath}.lineId must be non-empty`;
    if (!requiredText(rawLine.speakerName)) return `${linePath}.speakerName must be non-empty`;
    if (!requiredText(rawLine.text)) return `${linePath}.text must be non-empty`;
    if (rawLine.delivery !== "on_screen"
      && rawLine.delivery !== "off_screen"
      && rawLine.delivery !== "voice_over") {
      return `${linePath}.delivery must be on_screen/off_screen/voice_over`;
    }
  }
  const narrativeError = inspectNarrativeAudioPlan(rawBeat.narrativeAudioPlan, rawBeat.dialogueScript, path);
  if (narrativeError) return narrativeError;
  if (!Array.isArray(rawBeat.storyEvents) || rawBeat.storyEvents.length === 0) {
    return `${path}.storyEvents must be a non-empty array`;
  }
  for (const [eventIndex, rawEvent] of rawBeat.storyEvents.entries()) {
    const eventPath = `${path}.storyEvents[${eventIndex}]`;
    if (!isRecord(rawEvent)) return `${eventPath} must be an object`;
    if (!requiredText(rawEvent.sourceBeatId)) return `${eventPath}.sourceBeatId must be non-empty`;
    if (!requiredText(rawEvent.event)) return `${eventPath}.event must be non-empty`;
    if (!requiredText(rawEvent.entryState)) return `${eventPath}.entryState must be non-empty`;
    if (!requiredText(rawEvent.exitState)) return `${eventPath}.exitState must be non-empty`;
    if (typeof rawEvent.startSeconds !== "number"
      || !Number.isFinite(rawEvent.startSeconds)
      || typeof rawEvent.endSeconds !== "number"
      || !Number.isFinite(rawEvent.endSeconds)
      || rawEvent.endSeconds <= rawEvent.startSeconds) {
      return `${eventPath} must use a finite positive time interval`;
    }
    if (eventIndex > 0) {
      const previousEvent = rawBeat.storyEvents[eventIndex - 1];
      if (isRecord(previousEvent)
        && requiredText(rawEvent.entryState) !== requiredText(previousEvent.exitState)) {
        return `${eventPath}.entryState must equal the previous event exitState`;
      }
    }
  }
  const lastEvent = rawBeat.storyEvents.at(-1);
  if (isRecord(lastEvent)
    && requiredText(rawBeat.exitState) !== requiredText(lastEvent.exitState)) {
    return `${path}.exitState must equal the final story event exitState`;
  }

  return null;
}

