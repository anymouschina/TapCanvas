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
