export const WRITER_MAX_REPAIR_ATTEMPTS = 0;
export const WRITER_MAX_EXECUTION_RECOVERY_ATTEMPTS = 0;
export const WRITER_STRUCTURED_OUTPUT_SUBMISSION_POLICY = "single_submission_record_and_fail" as const;
// Bump whenever the persisted writer dispatch contract changes. v16 removes
// Agent-owned shot-to-speech references and compiles them once after final
// duration reconciliation, invalidating older writer input fingerprints.
export const WRITER_OUTPUT_CONTRACT_VERSION = 16;

export type WriterRepairPayload = {
	agentId?: string;
	clipIndex?: number;
	sourceHash?: string;
	repairable?: boolean;
	repairAttempt?: number;
	repairProblems?: string[];
	writerResultHash?: string;
	writerResultSummary?: string;
	executionRecoveryAttempt?: number;
	writerContractVersion?: number;
};

/** Hard-cut every historical correction marker into record-only terminal evidence. */
export function normalizeWriterContractMigrationForRepair<T extends WriterRepairPayload>(payload: T): T {
	return {
		...payload,
		repairable: false,
		writerContractVersion: WRITER_OUTPUT_CONTRACT_VERSION,
	};
}

/** Historical helper retained for persisted payload normalization only. */
export function normalizeWriterExecutionFailureForRepair<T extends WriterRepairPayload>(payload: T): T {
	return {
		...payload,
		repairable: false,
	};
}

export type WriterRepairPlan = {
	repair: boolean;
	attempt: number;
	reason: string;
};

export type PersistedWriterArtifactDisposition =
	| "ready"
	| "pending_dispatch"
	| "running_resume"
	| "blocked";

export type PersistedWriterArtifactPlan = {
	disposition: PersistedWriterArtifactDisposition;
	resumable: boolean;
	attempt: number | null;
	maxAttempts: number | null;
	normalizedPayload: WriterRepairPayload;
	reason: string;
};

export type WriterRepairWindow = {
	pending: boolean;
	failedClipCount: number;
	repairableClipCount: number;
	blockedClipCount: number;
	pendingClipCount: number;
	runningClipCount: number;
	resumableClipCount: number;
	nextAttempt: number | null;
	maxAttempts: number;
};

export function isCancelledWriterRecoveryCandidate(input: {
	state: string | null | undefined;
	authoringState: string | null | undefined;
	totalClips: number;
	clipsDone: number;
	writerRecovery: WriterRepairWindow | null | undefined;
}): boolean {
	void input;
	return false;
}

/** Historical helper: preserve the cancellation reason as audit-only evidence. */
export function markWriterSiblingCancellationRepairable<T extends WriterRepairPayload>(
	payload: T,
	reason: string,
): T & { repairable: false; repairProblems: string[] } {
	const normalizedReason = reason.trim();
	const priorProblems = Array.isArray(payload.repairProblems)
		? payload.repairProblems.filter((problem) => typeof problem === "string" && problem.trim())
		: [];
	return {
		...payload,
		repairable: false,
		repairProblems: normalizedReason
			? [...priorProblems, normalizedReason]
			: priorProblems,
	};
}

type WriterRepairArtifact = {
	artifact_key: string;
	status: string;
	payload?: string | null;
};

export function planClipRepair(input: {
	status: string;
	payload: WriterRepairPayload;
	maxAttempts?: number;
}): WriterRepairPlan {
	const attempted = Number(input.payload.repairAttempt ?? 0);
	void input.maxAttempts;
	return {
		repair: false,
		attempt: attempted,
		reason: input.status === "failed"
			? `${WRITER_STRUCTURED_OUTPUT_SUBMISSION_POLICY}: 首次提交失败只记录，不重派`
			: "非 failed 工件",
	};
}

function readWriterRepairPayload(raw: string | null | undefined): WriterRepairPayload {
	if (!raw) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const record = parsed as Record<string, unknown>;
		return {
			...(typeof record.agentId === "string" && record.agentId.trim()
				? { agentId: record.agentId.trim() }
				: {}),
			...(record.repairable === true
				? { repairable: true as const }
				: record.repairable === false
					? { repairable: false as const }
					: {}),
			...(typeof record.repairAttempt === "number" &&
			Number.isInteger(record.repairAttempt) &&
				record.repairAttempt >= 0
				? { repairAttempt: record.repairAttempt }
				: {}),
			...(typeof record.writerResultHash === "string" && record.writerResultHash.trim()
				? { writerResultHash: record.writerResultHash.trim() }
				: {}),
			...(typeof record.writerResultSummary === "string" && record.writerResultSummary.trim()
				? { writerResultSummary: record.writerResultSummary.trim() }
				: {}),
			...(typeof record.executionRecoveryAttempt === "number" &&
			Number.isInteger(record.executionRecoveryAttempt) &&
			record.executionRecoveryAttempt >= 0
				? { executionRecoveryAttempt: record.executionRecoveryAttempt }
				: {}),
			...(typeof record.writerContractVersion === "number" &&
			Number.isInteger(record.writerContractVersion) &&
			record.writerContractVersion >= 0
				? { writerContractVersion: record.writerContractVersion }
				: {}),
		};
	} catch {
		return {};
	}
}

/**
 * Single structural planner for persisted writer artifacts. Scheduler, status,
 * recovery, and driver must agree on the same persisted facts; error prose and
 * prompt content never participate in this decision.
 */
export function planPersistedWriterArtifact(input: {
	status: string;
	payload: WriterRepairPayload;
}): PersistedWriterArtifactPlan {
	if (input.status === "ready") {
		return {
			disposition: "ready",
			resumable: false,
			attempt: null,
			maxAttempts: null,
			normalizedPayload: input.payload,
			reason: "writer 工件已冻结",
		};
	}
	if (input.status === "pending") {
		return {
			disposition: "pending_dispatch",
			resumable: true,
			attempt: null,
			maxAttempts: null,
			normalizedPayload: input.payload,
			reason: "writer 尚未派发",
		};
	}
	if (input.status === "running") {
		return {
			disposition: "running_resume",
			resumable: true,
			attempt: null,
			maxAttempts: null,
			normalizedPayload: input.payload,
			reason: "writer 已派发，继续读取持久执行",
		};
	}
	if (input.status !== "failed") {
		return {
			disposition: "blocked",
			resumable: false,
			attempt: null,
			maxAttempts: null,
			normalizedPayload: input.payload,
			reason: `未知 writer 工件状态：${input.status}`,
		};
	}

	return {
		disposition: "blocked",
		resumable: false,
		attempt: Math.max(0, Math.trunc(input.payload.repairAttempt ?? 0)),
		maxAttempts: 0,
		normalizedPayload: {
			...input.payload,
			repairable: false,
		},
		reason: `${WRITER_STRUCTURED_OUTPUT_SUBMISSION_POLICY}: writer 首次结构化提交失败，只记录证据，不纠正、不重派`,
	};
}

/**
 * Projects only persisted writer lifecycle facts. It deliberately does not
 * interpret error text, prompt content, clip names, or semantic keywords.
 */
export function inspectWriterRepairWindow(
	artifacts: readonly WriterRepairArtifact[],
): WriterRepairWindow {
	const clipArtifacts = artifacts.filter((artifact) => artifact.artifact_key.startsWith("clip:"));
	const failed = artifacts.filter(
		(artifact) => artifact.artifact_key.startsWith("clip:") && artifact.status === "failed",
	);
	const pendingClipCount = clipArtifacts.filter((artifact) => artifact.status === "pending").length;
	const runningClipCount = clipArtifacts.filter((artifact) => artifact.status === "running").length;
	const plans = failed.map((artifact) =>
		planPersistedWriterArtifact({
			status: artifact.status,
			payload: readWriterRepairPayload(artifact.payload),
		}),
	);
	const repairable = plans.filter((plan) => plan.resumable);
	const nextAttempt = repairable.length > 0
		? Math.max(...repairable.flatMap((plan) => plan.attempt === null ? [] : [plan.attempt]))
		: null;
	const blockedClipCount = failed.length - repairable.length;
	const resumableClipCount = repairable.length + pendingClipCount + runningClipCount;
	return {
		pending: blockedClipCount === 0 && resumableClipCount > 0,
		failedClipCount: failed.length,
		repairableClipCount: repairable.length,
		blockedClipCount,
		pendingClipCount,
		runningClipCount,
		resumableClipCount,
		nextAttempt,
		maxAttempts: 0,
	};
}
