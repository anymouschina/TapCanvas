export type InternalWorkerStageFailure = {
  enabled: true;
  failed: true;
  stage: string;
  errorName: string;
  errorMessage: string;
};

export type InternalWorkerTickResult = {
  ok: boolean;
  failures: InternalWorkerStageFailure[];
  [key: string]: unknown;
};

export function assertInternalWorkerTickSucceeded(
  lane: string,
  result: InternalWorkerTickResult,
): void {
  if (result.ok) return;
  const summary = result.failures
    .map((failure) => `${failure.stage}: ${failure.errorMessage}`)
    .join("; ");
  throw new Error(`${lane} tick failed${summary ? `: ${summary}` : ""}`);
}

export function buildInternalWorkerStageFailure(
  stage: string,
  error: unknown,
): InternalWorkerStageFailure {
  return {
    enabled: true,
    failed: true,
    stage,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

export function recordInternalWorkerStageFailure(
	stage: string,
	error: unknown,
): InternalWorkerStageFailure {
	const failure = buildInternalWorkerStageFailure(stage, error);
	console.error("[internal-worker-stage-failed]", JSON.stringify(failure));
	if (error instanceof Error && error.stack) {
		console.error("[internal-worker-stage-stack]", error.stack);
	}
	return failure;
}
