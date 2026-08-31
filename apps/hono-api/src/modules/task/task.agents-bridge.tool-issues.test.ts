import { describe, expect, it } from "vitest";

import {
	assertPublicAgentsRequestSafe,
	resolveAgentsBridgeRequestTerminal,
	summarizeBridgeToolExecutionIssues,
	type BridgeToolCall,
	type ToolStatusSummary,
} from "./task.agents-bridge";
import type {
	PublicChatDeliveryEvidence,
	PublicChatDeliveryVerificationSummary,
} from "./public-chat-delivery-verifier";

function bridgeToolCall(input: Pick<BridgeToolCall, "name" | "status"> & Partial<BridgeToolCall>): BridgeToolCall {
	return {
		toolCallId: input.toolCallId ?? `${input.name}-call`,
		seq: input.seq ?? null,
		atMs: input.atMs ?? null,
		name: input.name,
		status: input.status,
		severity: input.severity ?? "",
		pathHint: input.pathHint ?? "",
		errorMessage: input.errorMessage ?? "",
		outputPreview: input.outputPreview ?? "",
		outputChars: input.outputChars ?? null,
		outputHead: input.outputHead ?? "",
		outputTail: input.outputTail ?? "",
		outputJson: input.outputJson ?? null,
		inputJson: input.inputJson ?? null,
		requestedAgentType: input.requestedAgentType ?? "",
		startedAt: input.startedAt ?? "",
		finishedAt: input.finishedAt ?? "",
		durationMs: input.durationMs ?? null,
	};
}

const toolStatusSummary: ToolStatusSummary = {
	totalToolCalls: 2,
	succeededToolCalls: 1,
	failedToolCalls: 1,
	deniedToolCalls: 0,
	blockedToolCalls: 1,
	runMs: 200,
};

const deliveryEvidence: PublicChatDeliveryEvidence = {
	version: 2,
	items: [
		{
			evidenceId: "artifact:run-1",
			kind: "artifact",
			mediaType: "video",
			sourceRef: "run-1",
			requirementIds: ["video-submitted"],
			artifactClass: "video",
			attributes: { deliveryState: "accepted_async" },
		},
	],
	artifacts: [
		{
			toolCallId: "start-video",
			toolName: "tapcanvas_video_orchestrate",
			assetType: "video",
			deliveryState: "accepted_async",
			nodeId: "film-node",
			taskId: "task-1",
			runId: "run-1",
			clipIndex: null,
			assetUrl: null,
		},
	],
	assetCount: 0,
	imageAssetCount: 0,
	videoAssetCount: 0,
	wroteCanvas: true,
	generatedAssets: true,
	imageLikeNodeCount: 0,
	preproductionImageLikeNodeCount: 0,
	reusablePreproductionImageLikeNodeCount: 0,
	materializedStoryboardStillCount: 0,
	hasVideoNodes: true,
	hasMaterializedVisualOutputs: false,
	hasPlannedAuthorityBaseFrame: false,
	hasConfirmedAuthorityBaseFrame: false,
	storyboardPlanPersistenceCount: 0,
};

const satisfiedVerification: PublicChatDeliveryVerificationSummary = {
	version: 2,
	contractHash: "sha256:video-contract",
	status: "satisfied",
	criteria: [
		{
			requirementId: "video-submitted",
			status: "satisfied",
			evidenceIds: ["artifact:run-1"],
			reason: "The durable media run was accepted.",
		},
	],
	verifiedAt: "2026-08-10T01:02:03.000Z",
};

const textOnlyDeliveryEvidence: PublicChatDeliveryEvidence = {
	...deliveryEvidence,
	items: [],
	artifacts: [],
	wroteCanvas: false,
	generatedAssets: false,
	hasVideoNodes: false,
};

describe("summarizeBridgeToolExecutionIssues", () => {
	it("keeps an early failure in diagnostics but resolves it only with canonical verified evidence", () => {
		const toolCalls = [
			bridgeToolCall({ name: "tapcanvas_video_orchestrate", status: "blocked" }),
			bridgeToolCall({ name: "tapcanvas_video_orchestrate", status: "succeeded" }),
		];

		expect(summarizeBridgeToolExecutionIssues({
			toolCalls,
			toolStatusSummary,
			deliveryVerification: satisfiedVerification,
			deliveryEvidence,
		})).toMatchObject({
			blockedToolCalls: 1,
			actionableBlockedToolCalls: 1,
			hasHistoricalExecutionIssues: true,
			recoveredByDeliveryEvidence: true,
			hasExecutionIssues: false,
		});
	});

	it("does not treat text-only success as recovery evidence", () => {
		expect(summarizeBridgeToolExecutionIssues({
			toolCalls: [bridgeToolCall({ name: "write", status: "failed" })],
			toolStatusSummary,
			deliveryVerification: null,
			deliveryEvidence: textOnlyDeliveryEvidence,
		})).toMatchObject({
			hasHistoricalExecutionIssues: true,
			recoveredByDeliveryEvidence: false,
			hasExecutionIssues: true,
		});
	});

	it("resolves explicitly retryable attempts after the same logical tool succeeds", () => {
		const toolCalls = [
			bridgeToolCall({ name: "read_file", status: "blocked" }),
			bridgeToolCall({ name: "read_file", status: "succeeded" }),
			bridgeToolCall({
				name: "tapcanvas_shot_table_critic",
				status: "failed",
				outputJson: { terminal: false, code: "invalid_contract" },
			}),
			bridgeToolCall({ name: "tapcanvas_shot_table_critic", status: "succeeded" }),
		];

		expect(summarizeBridgeToolExecutionIssues({
			toolCalls,
			toolStatusSummary: {
				totalToolCalls: 4,
				succeededToolCalls: 2,
				failedToolCalls: 1,
				deniedToolCalls: 0,
				blockedToolCalls: 1,
				runMs: 300,
			},
			deliveryVerification: null,
			deliveryEvidence: textOnlyDeliveryEvidence,
		})).toMatchObject({
			retryRecoveredToolCalls: 2,
			unresolvedToolCalls: 0,
			recoveredBySuccessfulRetry: true,
			recoveredByDeliveryEvidence: false,
			hasExecutionIssues: false,
		});
	});

	it("keeps terminal failures unresolved even when the same tool later succeeds", () => {
		const toolCalls = [
			bridgeToolCall({
				name: "tapcanvas_shot_table_critic",
				status: "failed",
				outputJson: { terminal: true, code: "upstream_failed" },
			}),
			bridgeToolCall({ name: "tapcanvas_shot_table_critic", status: "succeeded" }),
		];

		expect(summarizeBridgeToolExecutionIssues({
			toolCalls,
			toolStatusSummary: {
				totalToolCalls: 2,
				succeededToolCalls: 1,
				failedToolCalls: 1,
				deniedToolCalls: 0,
				blockedToolCalls: 0,
				runMs: 200,
			},
			deliveryVerification: null,
			deliveryEvidence: textOnlyDeliveryEvidence,
		})).toMatchObject({
			retryRecoveredToolCalls: 0,
			unresolvedToolCalls: 1,
			recoveredBySuccessfulRetry: false,
			hasExecutionIssues: true,
		});
	});

	it("uses structured blocker codes and never classifies human-readable error text", () => {
		const structured = bridgeToolCall({
			name: "spawn_agent",
			status: "blocked",
			outputJson: { code: "team_subagents_pending" },
		});
		const textOnly = bridgeToolCall({
			name: "spawn_agent",
			status: "blocked",
			errorMessage: "已有 team 子代理尚未结束，等待子代理终态后才能继续。",
		});
		const summary = (toolCalls: BridgeToolCall[]) => summarizeBridgeToolExecutionIssues({
			toolCalls,
			toolStatusSummary: {
				totalToolCalls: 1,
				succeededToolCalls: 0,
				failedToolCalls: 0,
				deniedToolCalls: 0,
				blockedToolCalls: 1,
				runMs: 1,
			},
			deliveryVerification: null,
			deliveryEvidence: textOnlyDeliveryEvidence,
		});

		expect(summary([structured])).toMatchObject({
			coordinationBlockedToolCalls: 1,
			actionableBlockedToolCalls: 0,
		});
		expect(summary([textOnly])).toMatchObject({
			coordinationBlockedToolCalls: 0,
			actionableBlockedToolCalls: 1,
		});
	});
});

describe("resolveAgentsBridgeRequestTerminal", () => {
	it.each([
		["succeeded", "agent_run_completed", "succeeded"],
		["failed", "tool_execution_issues", "failed"],
		["suspended", "async_execution_suspended", "suspended"],
	] as const)("projects the agents-cli %s terminal without local reinterpretation", (
		runStatus,
		reason,
		expectedStatus,
	) => {
		expect(resolveAgentsBridgeRequestTerminal({
			runOutcome: {
				version: 1,
				terminal: true,
				status: runStatus,
				reason,
			},
			pendingUserInput: false,
		})).toEqual({
			version: 1,
			terminal: true,
			status: expectedStatus,
			reason,
		});
	});

	it("fails explicitly when needs_input disagrees with pending input evidence", () => {
		expect(resolveAgentsBridgeRequestTerminal({
			runOutcome: {
				version: 1,
				terminal: true,
				status: "needs_input",
				reason: "user_confirmation_required",
			},
			pendingUserInput: false,
		})).toMatchObject({
			status: "failed",
			reason: "agent_run_outcome_user_input_evidence_missing",
		});
	});
});

describe("assertPublicAgentsRequestSafe", () => {
	it("accepts a public request without local workspace authority", () => {
		expect(() => assertPublicAgentsRequestSafe({
			forceLocalResourceViaBash: false,
			privilegedLocalAccess: false,
			localResourcePaths: [],
		})).not.toThrow();
	});

	it("accepts local workspace authority only with an internal desktop authorization fact", () => {
		expect(() => assertPublicAgentsRequestSafe({
			forceLocalResourceViaBash: true,
			privilegedLocalAccess: true,
			localResourcePaths: [],
			trustedDesktopWorkspaceAccess: true,
		})).not.toThrow();
	});

	it.each([
		{
			forceLocalResourceViaBash: true,
			privilegedLocalAccess: false,
			localResourcePaths: [],
		},
		{
			forceLocalResourceViaBash: false,
			privilegedLocalAccess: true,
			localResourcePaths: [],
		},
		{
			forceLocalResourceViaBash: false,
			privilegedLocalAccess: false,
			localResourcePaths: ["/tmp/private-input"],
		},
		{
			forceLocalResourceViaBash: false,
			privilegedLocalAccess: false,
			localResourcePaths: [],
			autoProjectScopedLocalAccess: true,
		},
	])("rejects local authority in a public request", (input) => {
		expect(() => assertPublicAgentsRequestSafe(input)).toThrowError(
			/Public agents request cannot access local workspace resources/,
		);
	});
});
