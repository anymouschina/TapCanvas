const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Compile redundant coordinates from the authored ordered beat durations.
 * Invalid source shape remains untouched for the structural verifier.
 * Temporal directives are authored absolute windows and are never reinterpreted.
 */
export function compileSequenceTimeline(root) {
  const plan = root.sequenceControlPlan;
  if (!record(plan) || !Array.isArray(root.beats) || !Array.isArray(plan.segments)
    || root.beats.length === 0 || root.beats.length !== plan.segments.length) return root;
  if (!root.beats.every((beat, i) => record(beat) && Number.isFinite(beat.durationSeconds)
    && beat.durationSeconds > 0 && record(plan.segments[i]))) return root;
  let cursor = 0;
  const segments = plan.segments.map((segment, index) => {
    const startSeconds = cursor;
    cursor = Math.round((cursor + root.beats[index].durationSeconds) * 1e6) / 1e6;
    return {...segment, startSeconds, endSeconds: cursor};
  });
  const compiled = {...plan, totalDurationSeconds: cursor, segments};
  return JSON.stringify(compiled) === JSON.stringify(plan) ? root : {...root, sequenceControlPlan: compiled};
}
