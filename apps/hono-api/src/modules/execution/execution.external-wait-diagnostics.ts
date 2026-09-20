import { parseWorkflowNodeOutputV1 } from "./execution.node-runtime";

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Select only cursor facts, never candidate text, credentials, or arbitrary evidence. */
function cursorFacts(evidence: Record<string, unknown> | undefined): Record<string, unknown> {
	const delivery = record(evidence?.deliveryEvidence);
	const facts: Record<string, unknown> = {};
	for (const source of [evidence, delivery]) {
		for (const key of ["logicalTaskId", "internalTurnId", "state", "phase", "retryNotBeforeAt", "physicalFailureReason", "continuationReason", "physicalRetryOrdinal", "retryAfterMs", "noProgressRecoveryEpoch", "taskId", "canvasNodeId", "providerStatus"]) {
			const value = source?.[key];
			if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) facts[key] = value;
		}
	}
	for (const key of ["recoveryCheckpoint", "recoveryWindow"]) {
		const source = record(delivery?.[key]);
		if (!source) continue;
		const cursor: Record<string, unknown> = {};
		for (const field of ["reasonCode", "physicalRunId", "progressRevision", "windowsWithoutProgress"]) {
			const value = source[field];
			if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) cursor[field] = value;
		}
		facts[key] = cursor;
	}
	const observationFailure = record(evidence?.observationFailure);
	if (typeof observationFailure?.observedAt === "string") {
		facts.observationFailure = { observedAt: observationFailure.observedAt };
		facts.observationStatus = "query_failed";
	}
	const rejected = record(evidence?.outputRepair) ?? record(delivery?.outputRepair);
	if (typeof rejected?.sourceTurnId === "string") facts.rejectedSourceTurnId = rejected.sourceTurnId;
	return facts;
}

/** Observation only: this receipt never schedules, retries, or terminates an action. */
export function buildWorkflowExternalWaitDiagnostics(
	outputRefs: unknown,
	observedAtMs = Date.now(),
): Readonly<Record<string, unknown>> {
	const observedAt = new Date(observedAtMs).toISOString();
	try {
		const output = parseWorkflowNodeOutputV1(outputRefs);
		const schedule = output?.externalCheck;
		const evidence = output?.evidence;
		return {
			version: 1,
			observedAt,
			scheduleStatus: schedule ? "recorded" : "not_recorded",
			...(schedule ? { schedule } : {}),
			...(schedule?.mode === "poll" ? {
				notBeforeAt: schedule.notBeforeAt,
				remainingDelayMs: Math.max(0, Date.parse(schedule.notBeforeAt) - observedAtMs),
				pastDueMs: Math.max(0, observedAtMs - Date.parse(schedule.notBeforeAt)),
			} : {}),
			...cursorFacts(evidence),
			pendingItems: (output?.itemRuns ?? []).filter(item => item.status === "waiting_external")
				.map(item => ({ itemId: item.itemId, runtimeNodeId: item.runtimeNodeId, ...cursorFacts(item.evidence) })),
		};
	} catch (error: unknown) {
		return {
			version: 1,
			observedAt,
			scheduleStatus: "invalid_receipt",
			failureReason: error instanceof Error ? error.message : String(error),
		};
	}
}
