export type WorkflowDurableRetryDirective = Readonly<{
	failureCode: string;
	retryOrdinal: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * A node-level retry budget only closes the current physical attempt. The
 * logical workflow may continue when the executor explicitly publishes a
 * durable retry directive together with its monotonic retry ordinal.
 *
 * The executor owns the bounded retry policy. Once that policy is exhausted it
 * stops emitting this directive, so the workflow runtime can fail normally.
 */
export function readWorkflowDurableRetryDirective(
	outputRefs: unknown,
): WorkflowDurableRetryDirective | null {
	if (!isRecord(outputRefs)) return null;
	const direct = readEvidenceDirective(outputRefs.evidence);
	if (direct) return direct;
	if (!Array.isArray(outputRefs.itemRuns)) return null;
	const itemDirectives = outputRefs.itemRuns
		.map((itemRun) => isRecord(itemRun) ? readEvidenceDirective(itemRun.evidence) : null)
		.filter((directive): directive is WorkflowDurableRetryDirective => directive !== null);
	if (itemDirectives.length === 0) return null;
	return {
		failureCode: [...new Set(itemDirectives.map((directive) => directive.failureCode))]
			.sort()
			.join("+"),
		retryOrdinal: Math.max(...itemDirectives.map((directive) => directive.retryOrdinal)),
	};
}

function readEvidenceDirective(evidenceValue: unknown): WorkflowDurableRetryDirective | null {
	if (!isRecord(evidenceValue)) return null;
	const evidence = evidenceValue;
	if (evidence.retryableByDurableWorkflow !== true) return null;
	const failureCode = typeof evidence.retryableFailure === "string"
		? evidence.retryableFailure.trim()
		: "";
	const retryOrdinal = evidence.workflowRetryCount;
	if (!failureCode) return null;
	if (typeof retryOrdinal !== "number" || !Number.isInteger(retryOrdinal) || retryOrdinal <= 0) {
		return null;
	}
	return { failureCode, retryOrdinal };
}
