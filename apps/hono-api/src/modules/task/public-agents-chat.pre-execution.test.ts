import { describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";
import type { AsyncAgentContinuation } from "./async-agent-continuation";

const mocks = vi.hoisted(() => ({
	deferOrFailAsyncAgentContinuation: vi.fn(),
}));

vi.mock("./async-agent-continuation", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./async-agent-continuation")>();
	return {
		...actual,
		deferOrFailAsyncAgentContinuation: mocks.deferOrFailAsyncAgentContinuation,
	};
});

import { runAsyncAgentContinuation } from "./public-agents-chat";

function createLegacyClaimedContinuation(): AsyncAgentContinuation {
	return {
		id: "continuation-legacy-contract",
		rootRequestId: "turn-legacy-contract",
		stage: 1,
		resumeTrigger: "physical_budget",
		parentContinuationId: null,
		userId: "user-1",
		projectId: "",
		flowId: "",
		chapterId: null,
		bookId: null,
		canvasNodeId: null,
		executionToolPolicy: null,
		sessionKey: "session-legacy-contract",
		modelKey: null,
		modelAlias: null,
		requiredSkills: [],
		dependencyNodeIds: [],
		dependencyTaskIds: [],
		dependencyRunIds: [],
		handledArtifactIds: [],
		progressFingerprint: "legacy-contract-fingerprint",
		expectedDelivery: { active: false },
		userIntentContract: {
			version: 1,
			contractHash: "legacy-contract-hash",
			referenceResolution: { mode: "new_task" },
			delivery: { kind: "video", output: "成片" },
			must: [],
			forbid: [],
			prefer: [],
			confirmedFacts: [],
			unresolved: [],
			precedence: [],
		},
		createdAt: "2026-08-22T00:00:00.000Z",
		attempt: 0,
		nextAttemptAt: null,
		lastFailure: null,
		claimToken: "claim-legacy-contract",
	};
}

describe("async continuation pre-execution settlement", () => {
	it("routes a deterministic frozen-contract failure through claimed-row settlement", async () => {
		mocks.deferOrFailAsyncAgentContinuation.mockResolvedValueOnce({
			shouldRetry: false,
			attempt: 1,
			nextAttemptAt: null,
			failure: {
				occurredAt: "2026-08-22T00:00:01.000Z",
				code: "async_continuation_user_intent_contract_invalid",
				status: null,
				upstreamStatus: null,
				message: "legacy contract rejected",
				retryable: false,
			},
		});
		const runtimeValues = new Map<string, unknown>();
		const c = {
			env: { DB: {} },
			get(key: string): unknown {
				return runtimeValues.get(key);
			},
			set(key: string, value: unknown): void {
				runtimeValues.set(key, value);
			},
		} as unknown as AppContext;
		const continuation = createLegacyClaimedContinuation();

		await expect(runAsyncAgentContinuation(c, continuation)).rejects.toMatchObject({
			code: "async_continuation_user_intent_contract_invalid",
		});
		expect(mocks.deferOrFailAsyncAgentContinuation).toHaveBeenCalledOnce();
		expect(mocks.deferOrFailAsyncAgentContinuation).toHaveBeenCalledWith({
			c,
			continuation,
			error: expect.objectContaining({
				code: "async_continuation_user_intent_contract_invalid",
			}),
		});
	});
});
