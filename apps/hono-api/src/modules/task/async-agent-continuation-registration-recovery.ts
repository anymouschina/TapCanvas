import type { AppContext } from "../../types";
import {
	ensureAsyncAgentContinuationRegistered,
	type AsyncAgentContinuation,
	type AsyncAgentContinuationRegistrationRecovery,
} from "./async-agent-continuation";
import { ContinuationSettlementRecoveryError } from "./continuation-settlement-recovery-error";

export type AsyncAgentContinuationRegistrationRecoveryResult = Readonly<{
	registration: AsyncAgentContinuationRegistrationRecovery;
	queued: boolean;
}>;

/**
 * Completes the two durable effects that constitute continuation registration:
 * the authoritative continuation row and its idempotent queue publication.
 * The caller owns the settlement marker; this function throws until both
 * effects are either already owned or successfully published.
 */
export async function recoverAsyncAgentContinuationRegistration(input: {
	c: AppContext;
	continuation: AsyncAgentContinuation;
	enqueue: (continuations: readonly AsyncAgentContinuation[]) => Promise<number>;
}): Promise<AsyncAgentContinuationRegistrationRecoveryResult> {
	const registration = await ensureAsyncAgentContinuationRegistered(input.c, input.continuation);
	if (!registration.queueRequired) {
		return { registration, queued: false };
	}
	const queuedCount = await input.enqueue([input.continuation]);
	if (queuedCount !== 1) {
		throw new ContinuationSettlementRecoveryError({
			code: queuedCount < 1
				? "continuation_settlement_queue_publication_incomplete"
				: "continuation_settlement_queue_publication_cardinality_invalid",
			retryable: queuedCount < 1,
			detail: String(queuedCount),
		});
	}
	return { registration, queued: true };
}
