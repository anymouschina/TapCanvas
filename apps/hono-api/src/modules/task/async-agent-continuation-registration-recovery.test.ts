import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";

const mocks = vi.hoisted(() => ({
	ensureRegistered: vi.fn(),
}));

vi.mock("./async-agent-continuation", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./async-agent-continuation")>();
	return {
		...actual,
		ensureAsyncAgentContinuationRegistered: mocks.ensureRegistered,
	};
});

import { recoverAsyncAgentContinuationRegistration } from "./async-agent-continuation-registration-recovery";
import type { AsyncAgentContinuation } from "./async-agent-continuation";

const continuation = {
	id: "continuation-recovery-test",
} as unknown as AsyncAgentContinuation;
const c = { env: { DB: {} } } as unknown as AppContext;

describe("async continuation registration recovery", () => {
	beforeEach(() => {
		mocks.ensureRegistered.mockReset();
	});

	it("publishes exactly one queue job after recovering a durable waiting row", async () => {
		mocks.ensureRegistered.mockResolvedValue({
			status: "existing",
			queueRequired: true,
			existingStatus: "waiting",
		});
		const enqueue = vi.fn().mockResolvedValue(1);

		await expect(recoverAsyncAgentContinuationRegistration({ c, continuation, enqueue }))
			.resolves.toMatchObject({ queued: true });
		expect(enqueue).toHaveBeenCalledOnce();
		expect(enqueue).toHaveBeenCalledWith([continuation]);
	});

	it("does not duplicate queue publication when a durable claim already owns execution", async () => {
		mocks.ensureRegistered.mockResolvedValue({
			status: "existing",
			queueRequired: false,
			existingStatus: "claimed",
		});
		const enqueue = vi.fn();

		await expect(recoverAsyncAgentContinuationRegistration({ c, continuation, enqueue }))
			.resolves.toMatchObject({ queued: false });
		expect(enqueue).not.toHaveBeenCalled();
	});

	it("keeps settlement recoverable when queue publication returns no durable job", async () => {
		mocks.ensureRegistered.mockResolvedValue({
			status: "created",
			queueRequired: true,
			existingStatus: null,
		});
		const enqueue = vi.fn().mockResolvedValue(0);

		await expect(recoverAsyncAgentContinuationRegistration({ c, continuation, enqueue }))
			.rejects.toThrow("continuation_settlement_queue_publication_incomplete:0");
	});

	it("marks impossible queue cardinality as a deterministic terminal contract failure", async () => {
		mocks.ensureRegistered.mockResolvedValue({
			status: "created",
			queueRequired: true,
			existingStatus: null,
		});
		const enqueue = vi.fn().mockResolvedValue(2);

		await expect(recoverAsyncAgentContinuationRegistration({ c, continuation, enqueue }))
			.rejects.toMatchObject({
				code: "continuation_settlement_queue_publication_cardinality_invalid",
				retryable: false,
			});
	});
});
