import { describe, expect, it } from "vitest";

import {
	buildPublicChatExpectedDeliverySummary,
	isPublicChatDeliveryEnvelopeStructurallyConsistent,
	normalizePublicChatDurableTerminalDelivery,
	normalizePublicChatDeliveryEvidence,
	normalizePublicChatDeliveryVerification,
	normalizePublicChatSemanticDeliveryContract,
} from "./public-chat-delivery-verifier";

describe("public-chat-delivery-verifier", () => {
	it("accepts one TaskStore-backed final-response terminal closure", () => {
		const terminalDelivery = normalizePublicChatDurableTerminalDelivery({
			version: 1,
			requestTerminal: {
				version: 1,
				terminal: true,
				status: "succeeded",
				reason: "delivery_verified",
			},
			expectedDelivery: {
				version: 2,
				contractHash: "sha256:text-contract",
				delivery: {
					mode: "response",
					mediaType: null,
					kind: "answer",
					output: "回答用户是谁",
				},
			},
			deliveryEvidence: [{
				evidenceId: "runtime-final-response",
				kind: "final_response",
				sourceRef: "final_response",
				requirementIds: ["intent:must:identity:1"],
				attributes: { sha256: "a".repeat(64) },
			}],
			deliveryVerification: {
				version: 2,
				contractHash: "sha256:text-contract",
				status: "satisfied",
				criteria: [{
					requirementId: "intent:must:identity:1",
					status: "satisfied",
					evidenceIds: ["runtime-final-response"],
					reason: "runtime 已绑定本轮实际正文",
				}],
				verifiedAt: "2026-08-24T07:12:00.000Z",
			},
		});

		expect(terminalDelivery?.deliveryEvidence[0]).toMatchObject({
			kind: "final_response",
			sourceRef: "final_response",
		});
		expect(terminalDelivery?.deliveryVerification.status).toBe("satisfied");
	});

	it("rejects a durable terminal closure whose contract hashes drift", () => {
		expect(normalizePublicChatDurableTerminalDelivery({
			version: 1,
			requestTerminal: {
				version: 1,
				terminal: true,
				status: "succeeded",
				reason: "delivery_verified",
			},
			expectedDelivery: { version: 2, contractHash: "contract-a" },
			deliveryEvidence: [{
				evidenceId: "runtime-final-response",
				kind: "final_response",
				sourceRef: "final_response",
				requirementIds: ["must-answer"],
				attributes: {},
			}],
			deliveryVerification: {
				version: 2,
				contractHash: "contract-b",
				status: "satisfied",
				criteria: [{
					requirementId: "must-answer",
					status: "satisfied",
					evidenceIds: ["runtime-final-response"],
					reason: "正文已绑定",
				}],
				verifiedAt: "2026-08-24T07:12:00.000Z",
			},
		})).toBeNull();
	});

	it("preserves an open agents-cli delivery contract without classifying its kind in Hono", () => {
		const contract = normalizePublicChatSemanticDeliveryContract({
			kind: "interactive_story_package",
			requirements: [
				{ id: "story", output: "branching narrative" },
				{ id: "canvas", output: "persisted nodes" },
			],
			minimumBranches: 3,
			requiresPublishedAsset: false,
		});

		expect(contract).toEqual({
			kind: "interactive_story_package",
			requirements: [
				{ id: "story", output: "branching narrative" },
				{ id: "canvas", output: "persisted nodes" },
			],
			minimumBranches: 3,
			requiresPublishedAsset: false,
		});
	});

	it("rejects malformed, non-JSON, and oversized delivery contracts", () => {
		const circular: Record<string, unknown> = { kind: "circular" };
		circular.self = circular;

		expect(normalizePublicChatSemanticDeliveryContract(null)).toBeNull();
		expect(normalizePublicChatSemanticDeliveryContract({ kind: "" })).toBeNull();
		expect(normalizePublicChatSemanticDeliveryContract(circular)).toBeNull();
		expect(normalizePublicChatSemanticDeliveryContract({
			kind: "oversized",
			payload: "x".repeat(16_001),
		})).toBeNull();
	});

	it("normalizes canonical evidence while preserving factual attributes", () => {
		const evidence = normalizePublicChatDeliveryEvidence([
			{
				evidenceId: "tool:generate-1",
				kind: "tool_call",
				sourceRef: "generate-1",
				requirementIds: ["asset-created", "asset-created"],
				artifactClass: "image",
				attributes: {
					status: "completed",
					assetCount: 1,
					persisted: true,
					failureCode: null,
				},
			},
		]);

		expect(evidence).toEqual([
			{
				evidenceId: "tool:generate-1",
				kind: "tool_call",
				sourceRef: "generate-1",
				requirementIds: ["asset-created"],
				artifactClass: "image",
				attributes: {
					status: "completed",
					assetCount: 1,
					persisted: true,
					failureCode: null,
				},
			},
		]);
	});

	it("rejects duplicate evidence identities and non-scalar evidence attributes", () => {
		const evidence = {
			evidenceId: "duplicate",
			kind: "artifact",
			mediaType: null,
			sourceRef: "https://cdn.example/asset.png",
			requirementIds: [],
			attributes: { materialized: true },
		};

		expect(normalizePublicChatDeliveryEvidence([evidence, evidence])).toBeNull();
		expect(normalizePublicChatDeliveryEvidence([{
			...evidence,
			evidenceId: "nested-attribute",
			attributes: { nested: { forbidden: true } },
		}])).toBeNull();
		expect(normalizePublicChatDeliveryEvidence([])).toBeNull();
	});

	it("requires explicit artifact media identity and preserves the typed value", () => {
		const untyped = {
			evidenceId: "untyped",
			kind: "artifact",
			sourceRef: "https://cdn.example/asset.png",
			requirementIds: ["asset-created"],
			attributes: { url: "https://cdn.example/asset.png" },
		};
		expect(normalizePublicChatDeliveryEvidence([untyped])).toBeNull();
		expect(normalizePublicChatDeliveryEvidence([{
			...untyped,
			mediaType: "image",
		}])).toEqual([{
			...untyped,
			mediaType: "image",
		}]);
	});

	it("normalizes the agents-cli v2 verification envelope without re-verifying it", () => {
		const verification = normalizePublicChatDeliveryVerification({
			version: 2,
			contractHash: "sha256:contract-1",
			status: "satisfied",
			criteria: [
				{
					requirementId: "asset-created",
					status: "satisfied",
					evidenceIds: ["tool:generate-1"],
					reason: "The generation tool returned a durable materialized asset.",
				},
			],
			verifiedAt: "2026-08-10T01:02:03.000Z",
		});

		expect(verification).toEqual({
			version: 2,
			contractHash: "sha256:contract-1",
			status: "satisfied",
			criteria: [
				{
					requirementId: "asset-created",
					status: "satisfied",
					evidenceIds: ["tool:generate-1"],
					reason: "The generation tool returned a durable materialized asset.",
				},
			],
			verifiedAt: "2026-08-10T01:02:03.000Z",
		});
	});

	it("rejects malformed verification envelopes instead of inventing a host verdict", () => {
		const baseVerification = {
			version: 2,
			contractHash: "sha256:contract-1",
			status: "unsatisfied",
			criteria: [
				{
					requirementId: "asset-created",
					status: "unresolved",
					evidenceIds: [],
					reason: "No durable asset evidence was reported.",
				},
			],
			verifiedAt: "2026-08-10T01:02:03.000Z",
		};

		expect(normalizePublicChatDeliveryVerification({
			...baseVerification,
			version: 1,
		})).toBeNull();
		expect(normalizePublicChatDeliveryVerification({
			...baseVerification,
			criteria: [...baseVerification.criteria, baseVerification.criteria[0]],
		})).toBeNull();
		expect(normalizePublicChatDeliveryVerification({
			...baseVerification,
			status: "pending",
		})).toBeNull();
		expect(normalizePublicChatDeliveryVerification({
			...baseVerification,
			status: "satisfied",
		})).toBeNull();
	});

	it("requires every criterion reference to bind evidence for the same requirement and contract", () => {
		const evidence = normalizePublicChatDeliveryEvidence([{
			evidenceId: "persisted:1",
			kind: "persisted_state",
			sourceRef: "state:1",
			requirementIds: ["persisted-output"],
			attributes: { revision: 1 },
		}]);
		const verification = normalizePublicChatDeliveryVerification({
			version: 2,
			contractHash: "sha256:contract-1",
			status: "satisfied",
			criteria: [{
				requirementId: "persisted-output",
				status: "satisfied",
				evidenceIds: ["persisted:1"],
				reason: "The persisted revision proves the output exists.",
			}],
			verifiedAt: "2026-08-10T01:02:03.000Z",
		});
		expect(evidence).not.toBeNull();
		expect(verification).not.toBeNull();
		if (!evidence || !verification) throw new Error("test fixture normalization failed");

		expect(isPublicChatDeliveryEnvelopeStructurallyConsistent({
			evidence,
			verification,
			expectedContractHash: "sha256:contract-1",
		})).toBe(true);
		expect(isPublicChatDeliveryEnvelopeStructurallyConsistent({
			evidence,
			verification: {
				...verification,
				criteria: [{ ...verification.criteria[0], requirementId: "different-requirement" }],
			},
			expectedContractHash: "sha256:contract-1",
		})).toBe(false);
		expect(isPublicChatDeliveryEnvelopeStructurallyConsistent({
			evidence,
			verification,
			expectedContractHash: "sha256:other-contract",
		})).toBe(false);
	});

	it("projects an open expected-delivery summary from an agents-cli tool trace", () => {
		const expected = buildPublicChatExpectedDeliverySummary({
			taskSummary: {
				taskGoal: "Create an interactive story package",
				requestedOutput: "A persisted branching narrative",
				taskKind: "story",
				recommendedNextStage: "ready_for_review",
				mustStop: false,
				requiresExecutionDelivery: true,
				blockingGaps: [],
				successCriteria: ["All branches are persisted"],
				deliveryContract: {
					kind: "interactive_story_package",
					minimumBranches: 3,
				},
				deliveryVerification: {
					version: 2,
					contractHash: "sha256:contract-1",
					status: "satisfied",
					criteria: [],
					verifiedAt: "2026-08-10T01:02:03.000Z",
				},
			},
			source: "agents_cli_tool_trace",
		});

		expect(expected).toEqual({
			active: true,
			kind: "interactive_story_package",
			source: "agents_cli_tool_trace",
			reason: "ready_for_review",
			taskGoal: "Create an interactive story package",
			requestedOutput: "A persisted branching narrative",
			successCriteria: ["All branches are persisted"],
			deliveryContract: {
				kind: "interactive_story_package",
				minimumBranches: 3,
			},
			contractHash: "sha256:contract-1",
		});
	});

	it("reports an inactive projection when agents-cli has no task summary", () => {
		expect(buildPublicChatExpectedDeliverySummary({
			taskSummary: null,
			source: "agents_cli_tool_trace",
		})).toEqual({
			active: false,
			kind: "none",
			source: "none",
			reason: "agents_cli_task_summary_missing",
		});
	});
});
