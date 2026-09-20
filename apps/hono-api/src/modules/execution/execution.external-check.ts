export const WORKFLOW_EXTERNAL_CHECK_VERSION = 1 as const;

export type WorkflowExternalCheckScheduleV1 =
	| Readonly<{
			version: typeof WORKFLOW_EXTERNAL_CHECK_VERSION;
			mode: "poll";
			notBeforeAt: string;
	  }>
	| Readonly<{
			version: typeof WORKFLOW_EXTERNAL_CHECK_VERSION;
			mode: "signal_only";
	  }>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireTimestamp(value: unknown): string {
	if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
		throw new Error("Workflow external check notBeforeAt must be an ISO timestamp");
	}
	return value;
}

export function parseWorkflowExternalCheckScheduleV1(
	value: unknown,
): WorkflowExternalCheckScheduleV1 | null {
	if (value === null || value === undefined) return null;
	if (!isRecord(value) || value.version !== WORKFLOW_EXTERNAL_CHECK_VERSION) {
		throw new Error("Workflow external check must use protocol version 1");
	}
	if (value.mode === "signal_only") {
		return { version: WORKFLOW_EXTERNAL_CHECK_VERSION, mode: "signal_only" };
	}
	if (value.mode === "poll") {
		return {
			version: WORKFLOW_EXTERNAL_CHECK_VERSION,
			mode: "poll",
			notBeforeAt: requireTimestamp(value.notBeforeAt),
		};
	}
	throw new Error("Workflow external check mode is invalid");
}

export function workflowExternalPollAt(notBeforeAt: string): WorkflowExternalCheckScheduleV1 {
	return {
		version: WORKFLOW_EXTERNAL_CHECK_VERSION,
		mode: "poll",
		notBeforeAt: requireTimestamp(notBeforeAt),
	};
}

export function workflowExternalPollAfter(
	delayMs: number,
	nowMs = Date.now(),
): WorkflowExternalCheckScheduleV1 {
	if (!Number.isFinite(delayMs) || delayMs < 0) {
		throw new Error("Workflow external check delay must be a non-negative finite number");
	}
	return workflowExternalPollAt(new Date(nowMs + Math.ceil(delayMs)).toISOString());
}

export function workflowExternalSignalOnly(): WorkflowExternalCheckScheduleV1 {
	return { version: WORKFLOW_EXTERNAL_CHECK_VERSION, mode: "signal_only" };
}

/**
 * Migrates an already-persisted Agent no-progress receipt to its durable timer.
 *
 * A no-progress Agent recovery has no provider task or external callback to
 * wake it. Older receipts incorrectly marked this state as signal-only, which
 * made the reconciler skip them forever. This helper is deliberately limited
 * to the versioned executor and failure evidence that owns that protocol; real
 * external-signal waits remain dormant.
 */
export function workflowAgentNoProgressRecoveryPollSchedule(
	outputRefs: unknown,
): WorkflowExternalCheckScheduleV1 | null {
	if (!isRecord(outputRefs) || outputRefs.executorRef !== "agents.logical-task/v2") return null;
	let evidence: Record<string, unknown> | null = isRecord(outputRefs.evidence)
		? outputRefs.evidence
		: null;
	for (let depth = 0; evidence && depth < 8; depth += 1) {
		if (
			evidence.retryablePhysicalFailure === true
			&& evidence.physicalFailureReason === "workflow_agent_no_progress_window_exhausted"
			&& evidence.noProgressRecoveryMode === "signal_only"
		) {
			const retryNotBeforeAt = evidence.retryNotBeforeAt;
			if (
				typeof retryNotBeforeAt === "string"
				&& Number.isFinite(Date.parse(retryNotBeforeAt))
			) {
				return workflowExternalPollAt(retryNotBeforeAt);
			}
			return null;
		}
		const nested = evidence.deliveryEvidence;
		if (!isRecord(nested) || nested === evidence) break;
		evidence = nested;
	}
	return null;
}

/**
 * Returns null when the node must be woken only by an explicit external signal.
 * Queue delay is rounded up so a persisted not-before boundary is never crossed
 * early by a sub-second scheduler truncation.
 */
export function workflowExternalCheckDelaySeconds(
	schedule: WorkflowExternalCheckScheduleV1,
	nowMs = Date.now(),
): number | null {
	if (schedule.mode === "signal_only") return null;
	return Math.max(0, Math.ceil((Date.parse(schedule.notBeforeAt) - nowMs) / 1_000));
}

/** Earliest timer wins; signal-only waits remain dormant unless every wait is signal-only. */
export function mergeWorkflowExternalCheckSchedules(
	schedules: readonly WorkflowExternalCheckScheduleV1[],
): WorkflowExternalCheckScheduleV1 {
	const pollSchedules = schedules.filter(
		(schedule): schedule is Extract<WorkflowExternalCheckScheduleV1, { mode: "poll" }> => (
			schedule.mode === "poll"
		),
	);
	if (pollSchedules.length === 0) return workflowExternalSignalOnly();
	return pollSchedules.reduce((earliest, candidate) => (
		Date.parse(candidate.notBeforeAt) < Date.parse(earliest.notBeforeAt) ? candidate : earliest
	));
}
