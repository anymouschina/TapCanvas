function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
/** Project confirmed local recovery facts without marking the overall task failed. */
export function workflowAuthoringWaitLabel(value) {
    const evidence = record(value);
    const explicit = evidence?.waitingReasonLabel;
    if (typeof explicit === "string" && explicit.trim())
        return explicit.trim();
    const repair = record(evidence?.outputRepair);
    if (typeof repair?.error !== "string" || !repair.error.trim())
        return null;
    const delivery = record(evidence?.deliveryEvidence);
    const ordinal = delivery?.physicalRetryOrdinal;
    const suffix = typeof ordinal === "number" && Number.isInteger(ordinal) && ordinal > 0
        ? `（执行轮次 ${ordinal}）` : "";
    return `正在修订结构化产物${suffix}：${repair.error}`;
}
