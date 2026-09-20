import { ExternalDependencyError } from "../../platform/external-dependency-error";
import { workflowExternalPollAfter } from "./execution.external-check";
import { workflowNodeWaiting, type WorkflowNodeExecutionResult, type WorkflowNodeOutputV1 } from "./execution.node-runtime";

type DependencyObservation = Readonly<{
	version: 1;
	dependency: ExternalDependencyError["dependency"];
	firstObservedAt: string;
	lastObservedAt: string;
	checkCount: number;
}>;

/** One fresh read can repair stale external facts. No paid or mutating callback belongs here. */
export async function readWithImmediateDependencyRepair<T>(input: Readonly<{
	read: () => Promise<T>;
	previousEvidence: Record<string, unknown> | null;
}>): Promise<Readonly<{ value: T; repairEvidence: Record<string, unknown> }>> {
	const previousObservation = readObservation(input.previousEvidence?.dependencyObservation);
	try {
		const value = await input.read();
		return { value, repairEvidence: previousObservation ? {
			dependencyObservation: { ...previousObservation, resolvedAt: new Date().toISOString() },
			...(input.previousEvidence?.dependencyRepair ? { dependencyRepair: input.previousEvidence.dependencyRepair } : {}),
		} : {} };
	} catch (error: unknown) {
		if (!(error instanceof ExternalDependencyError)) throw error;
		// A resumed dependency wait already performed its immediate repair. The
		// persisted scheduler now owns fresh reads; do not double every poll.
		if (previousObservation) throw error;
		const repairEvidence = {
			dependencyRepair: { version: 1, action: "refresh_authoritative_read", attemptCount: 1, initialFailure: error.dependency },
		};
		try {
			return { value: await input.read(), repairEvidence };
		} catch (repairError: unknown) {
			if (repairError instanceof ExternalDependencyError) {
				throw new ExternalDependencyError(repairError.dependency, repairEvidence);
			}
			throw repairError;
		}
	}
}

function readObservation(value: unknown): DependencyObservation | null {
	if (value === undefined) return null;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("workflow_dependency_observation_invalid");
	const record = value as Record<string, unknown>;
	if (record.version !== 1 || !record.dependency || typeof record.dependency !== "object"
		|| Array.isArray(record.dependency) || typeof record.firstObservedAt !== "string"
		|| !Number.isFinite(Date.parse(record.firstObservedAt)) || typeof record.lastObservedAt !== "string"
		|| !Number.isFinite(Date.parse(record.lastObservedAt)) || typeof record.checkCount !== "number"
		|| !Number.isSafeInteger(record.checkCount) || record.checkCount < 1) throw new Error("workflow_dependency_observation_invalid");
	const dependency = record.dependency as Record<string, unknown>;
	if (dependency.kind !== "model_catalog" || typeof dependency.identity !== "string"
		|| typeof dependency.field !== "string" || typeof dependency.code !== "string") throw new Error("workflow_dependency_observation_invalid");
	return {
		version: 1,
		dependency: { kind: dependency.kind, identity: dependency.identity, field: dependency.field, code: dependency.code, observed: dependency.observed },
		firstObservedAt: record.firstObservedAt, lastObservedAt: record.lastObservedAt, checkCount: record.checkCount,
	};
}

/** Only call at an explicitly read-only boundary. This never authorizes replay of a mutation. */
export function waitForReadOnlyDependency(input: Readonly<{
	error: ExternalDependencyError;
	output: WorkflowNodeOutputV1;
	previousEvidence: Record<string, unknown> | null;
	nowMs?: number;
}>): WorkflowNodeExecutionResult {
	const nowMs = input.nowMs ?? Date.now();
	const previous = readObservation(input.previousEvidence?.dependencyObservation);
	const sameDependency = previous?.dependency.kind === input.error.dependency.kind
		&& previous.dependency.identity === input.error.dependency.identity
		&& previous.dependency.field === input.error.dependency.field;
	const checkCount = sameDependency && previous ? previous.checkCount + 1 : 1;
	const observedAt = new Date(nowMs).toISOString();
	const observation: DependencyObservation = {
		version: 1, dependency: input.error.dependency,
		firstObservedAt: sameDependency && previous ? previous.firstObservedAt : observedAt,
		lastObservedAt: observedAt, checkCount,
	};
	// Recheck only the external read, with persisted bounded backoff. The ceiling
	// controls query frequency; it cannot terminate the user's logical task.
	const externalCheck = workflowExternalPollAfter(Math.min(900_000, 30_000 * 2 ** Math.min(checkCount - 1, 5)), nowMs);
	return workflowNodeWaiting({
		...input.output,
		externalCheck,
		evidence: {
			...input.output.evidence,
			...(input.previousEvidence?.dependencyRepair ? { dependencyRepair: input.previousEvidence.dependencyRepair } : {}),
			...input.error.repairEvidence,
			executorCompleted: false,
			waitingReason: "external_dependency_unavailable",
			waitingReasonLabel: `等待模型目录修复：${input.error.dependency.identity} / ${input.error.dependency.field}`,
			failureCode: input.error.dependency.code,
			failureMessage: input.error.message,
			dependencyObservation: observation,
			recoveryAction: "recheck_read_only_dependency",
			sideEffect: "none",
		},
	}, externalCheck);
}
