const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmptyString = value => typeof value === "string" && value.trim() ? value.trim() : null;
const equalDurationAtContractPrecision = (a,b) => Number(a.toFixed(6)) === Number(b.toFixed(6));
const WORKFLOW_SEQUENCE_CONTROL_PLAN_PROTOCOL_VERSION = "tapcanvas.sequence-control-plan/v1";
export function validateSequenceControlPlan(root) {
    const plan = root.sequenceControlPlan;
    if (!isRecord(plan))
        return "sequenceControlPlan must be an object";
    if (plan.protocolVersion !== WORKFLOW_SEQUENCE_CONTROL_PLAN_PROTOCOL_VERSION) {
        return `sequenceControlPlan.protocolVersion must be ${WORKFLOW_SEQUENCE_CONTROL_PLAN_PROTOCOL_VERSION}`;
    }
    const totalDurationSeconds = plan.totalDurationSeconds;
    if (typeof totalDurationSeconds !== "number" || !Number.isFinite(totalDurationSeconds) || totalDurationSeconds <= 0) {
        return "sequenceControlPlan.totalDurationSeconds must be positive";
    }
    if (!Array.isArray(plan.segments) || plan.segments.length !== (Array.isArray(root.beats) ? root.beats.length : 0)) {
        return `sequenceControlPlan.segments must contain one item for every BeatSheet beat; expected=${root.beats?.length}, observed=${Array.isArray(plan.segments) ? plan.segments.length : typeof plan.segments}`;
    }
    let cursor = 0;
    // One repair window must be able to fix every misplaced directive. Returning at
    // the first offender turned a document with a dozen out-of-range windows into a
    // dozen sequential windows of repair on an ~84K-character artifact.
    const directiveIssues = [];
    for (const [index, rawTimingBeat] of plan.segments.entries()) {
        if (!isRecord(rawTimingBeat))
            return `sequenceControlPlan.segments[${index}] must be an object`;
        const beat = Array.isArray(root.beats) && isRecord(root.beats[index]) ? root.beats[index] : null;
        const clipId = nonEmptyString(rawTimingBeat.clipId);
        const startSeconds = rawTimingBeat.startSeconds;
        const endSeconds = rawTimingBeat.endSeconds;
        if (!clipId || !beat)
            return `sequenceControlPlan.segments[${index}] requires clipId matching beats[${index}]`;
        // clipId is a transport identity compiled at the BeatSheet boundary. The
        // segment remains positionally paired with its Beat; do not reject a
        // compiler-projected identity rewrite here.
        if (typeof startSeconds !== "number" || !Number.isFinite(startSeconds) || typeof endSeconds !== "number" || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
            return `sequenceControlPlan.segments[${index}] requires a positive startSeconds/endSeconds interval`;
        }
        if (!equalDurationAtContractPrecision(startSeconds, cursor)) {
            return `sequenceControlPlan.segments[${index}].startSeconds must continue the previous beat at ${String(cursor)}`;
        }
        const beatDuration = beat.durationSeconds;
        if (typeof beatDuration !== "number" || !equalDurationAtContractPrecision(endSeconds - startSeconds, beatDuration)) {
            return `sequenceControlPlan.segments[${index}] interval must equal beats[${index}].durationSeconds`;
        }
        if (!Array.isArray(rawTimingBeat.temporalDirectives)) {
            return `sequenceControlPlan.segments[${index}].temporalDirectives must be an array`;
        }
        for (const [windowIndex, rawWindow] of rawTimingBeat.temporalDirectives.entries()) {
            if (!isRecord(rawWindow))
                return `sequenceControlPlan.segments[${index}].temporalDirectives[${windowIndex}] must be an object`;
            const windowStart = rawWindow.startSeconds;
            const windowEnd = rawWindow.endSeconds;
            for (const field of ["startSeconds", "endSeconds"]) {
                if (typeof rawWindow[field] !== "number" || !Number.isFinite(rawWindow[field])) {
                    return `sequenceControlPlan.segments[${index}].temporalDirectives[${windowIndex}].${field} must be a finite number directly on the directive object; observed keys: ${Object.keys(rawWindow).join(", ")}`;
                }
            }
            if (typeof windowStart !== "number" || !Number.isFinite(windowStart) || typeof windowEnd !== "number" || !Number.isFinite(windowEnd) || windowStart < startSeconds || windowEnd <= windowStart || windowEnd > endSeconds || !nonEmptyString(rawWindow.kind) || !nonEmptyString(rawWindow.reason)) {
                directiveIssues.push(`sequenceControlPlan.segments[${index}].temporalDirectives[${windowIndex}] must stay within the segment interval and include kind/reason; segment=[${startSeconds},${endSeconds}], observed=[${String(windowStart)},${String(windowEnd)}], kindPresent=${nonEmptyString(rawWindow.kind)}, reasonPresent=${nonEmptyString(rawWindow.reason)}. Directive times use the same absolute timeline as the segment.`);
            }
        }
        if (!nonEmptyString(rawTimingBeat.transitionFromPrevious) || !nonEmptyString(rawTimingBeat.transitionToNext)) {
            return `sequenceControlPlan.segments[${index}] requires transitionFromPrevious and transitionToNext`;
        }
        cursor = endSeconds;
    }
    if (!equalDurationAtContractPrecision(cursor, totalDurationSeconds)) {
        return "sequenceControlPlan.totalDurationSeconds must equal the final segment endSeconds";
    }
    if (directiveIssues.length > 0) {
        return `${directiveIssues.join(" | ")} Repair every listed directive in this same candidate.`;
    }
    return null;
}
