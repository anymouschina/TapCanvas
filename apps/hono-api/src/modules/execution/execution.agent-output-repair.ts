export type WorkflowAgentOutputRepair = Readonly<{
	version: 1;
	sourceTurnId: string;
	candidate: string;
	error: string;
	repairAttemptCount?: number;
}>;

/** Host verifier facts, never a locally authored creative replacement. */
export function readWorkflowAgentOutputRepair(
	evidence: Record<string, unknown> | null | undefined,
): WorkflowAgentOutputRepair | null {
	const value = evidence?.outputRepair;
	if (value === undefined || value === null) return null;
	if (typeof value !== "object" || Array.isArray(value)) throw new Error("workflow_agent_output_repair_invalid");
	const record = value as Record<string, unknown>;
	if (record.version !== 1 || typeof record.sourceTurnId !== "string" || !record.sourceTurnId
		|| typeof record.candidate !== "string" || typeof record.error !== "string" || !record.error) {
		throw new Error("workflow_agent_output_repair_invalid");
	}
	const repairAttemptCount = typeof record.repairAttemptCount === "number" && Number.isInteger(record.repairAttemptCount) && record.repairAttemptCount > 0
		? record.repairAttemptCount
		: undefined;
	return {
		version: 1,
		sourceTurnId: record.sourceTurnId,
		candidate: record.candidate,
		error: record.error,
		...(repairAttemptCount !== undefined ? { repairAttemptCount } : {}),
	};
}
