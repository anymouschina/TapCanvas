import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../middleware/error";

import {
	buildBroadcastChatMessages,
	buildStablePublicChatTurnId,
	buildAsyncContinuationDeliveryReportLock,
	buildAsyncAgentContinuationRequestCandidate,
	buildTrustedContinuationIntentContext,
	buildContinuationTaskCapsule,
	resolveContinuationExecutionContract,
	assertSuspendedContinuationOwnership,
	resolveAsyncContinuationDeliveryReportLock,
	buildTaskRequest,
	CHAT_HEARTBEAT_MS,
	coordinatePublicChatInterrupt,
	recordAsyncContinuationRegistrationDiagnostic,
	resolveContinuationRootRequestId,
	resolveServerOwnedContinuationRequestId,
	resolveChatTurnLanguageModelFact,
	resolveAsyncContinuationConversationPublication,
	resolveAsyncContinuationPersistenceStatus,
	continuationRegistrationOwnsChatActivity,
	resolveInactiveChatTurnRecoveryKind,
	isPersistedContinuationRecoveryLifecycleEligible,
	resolvePublicChatDoneReason,
	readContinuationDurableTaskReferences,
	readContinuationSelectedSkillIds,
	readRootPhysicalContinuationSuspension,
	shouldRegisterPhysicalContinuation,
	resolvePendingContinuationResumePlan,
	collectInheritedPhysicalArtifactFrontier,
	collectDurableClaimTaskArtifactFrontier,
	resolveRecoveryContinuationSuspension,
	mergeClaimedContinuationRecoveryCheckpoint,
	parsePhysicalBudgetRecoveryRequest,
	projectTerminalContinuationSettlementStatus,
	pruneResolvedIntentRecoveryFacts,
	assertPhysicalBudgetRecoveryFrontier,
	selectNewContinuationDependencies,
	selectDurableContinuationDependencies,
	shouldForwardAgentsBridgeStreamEvent,
	shouldPersistTurn,
	toStreamErrorPayload,
} from "./public-agents-chat";
import {
	ASYNC_AGENT_CONTINUATION_TASK_GOAL_MAX_UTF8_BYTES,
	parseAsyncAgentContinuation,
	type AsyncAgentContinuation,
} from "./async-agent-continuation";
import { AgentsChatRequestSchema } from "../apiKey/apiKey.schemas";
import type { AgentsChatRequestDto } from "../apiKey/apiKey.schemas";
import type { TaskResultDto } from "./task.schemas";
import type { AgentsChatTurnStatusSnapshot } from "./task.agents-chat-runtime";
import type { ContinuationSettlementRecordV1 } from "./agents-continuation-settlement";

function canonicalizeIntentContract(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalizeIntentContract);
	if (!value || typeof value !== "object") return value;
	const record = value as Record<string, unknown>;
	return Object.fromEntries(
		Object.keys(record)
			.filter((key) => key !== "contractHash")
			.sort()
			.map((key) => [key, canonicalizeIntentContract(record[key])]),
	);
}

function createTestIntentContract(): Record<string, unknown> {
	const contract: Record<string, unknown> = {
		version: 2,
		referenceResolution: { mode: "new_task" },
		delivery: { mode: "async_artifact", mediaType: "video", kind: "video", output: "最终成片", durationSeconds: 40 },
		must: [{ id: "deliver-video", statement: "交付最终成片", source: "user", evidence: ["test request"] }],
		forbid: [],
		prefer: [],
		confirmedFacts: [],
		unresolved: [],
		precedence: [],
	};
	contract.contractHash = createHash("sha256")
		.update(JSON.stringify(canonicalizeIntentContract(contract)))
		.digest("hex");
	return contract;
}

describe("pruneResolvedIntentRecoveryFacts", () => {
	it("drops stale record_user_intent failures once a frozen contract exists", () => {
		const facts: NonNullable<AsyncAgentContinuation["actionRecoveryFacts"]> = [{
			version: 1,
			toolName: "record_user_intent",
			mode: null,
			status: "failed",
			code: "reference_resolution_unknown_reference",
			message: "unknown prior execution reference",
			runId: null,
			draftRevision: null,
		}, {
			version: 1,
			toolName: "tapcanvas_equipped_workflow_run",
			mode: "run",
			status: "failed",
			code: "workflow_unavailable",
			message: "workflow unavailable",
			runId: null,
			draftRevision: null,
		}];

		expect(pruneResolvedIntentRecoveryFacts(facts, createTestIntentContract()))
			.toEqual([facts[1]]);
		expect(pruneResolvedIntentRecoveryFacts(facts, null)).toEqual(facts);
	});
});

describe("continuation selected skill projection", () => {
	it("carries only agent-selected skill candidates into the next physical window", () => {
		expect(readContinuationSelectedSkillIds({
			executionProvenance: {
				loadedSkills: ["historical-unselected-skill", "tapcanvas-video-workflow"],
				intentSelectionTrace: [{
					candidateId: "tapcanvas-video-workflow",
					candidateKind: "skill",
					selected: true,
				}, {
					candidateId: "historical-unselected-skill",
					candidateKind: "skill",
					selected: false,
				}],
			},
		})).toEqual(["tapcanvas-video-workflow"]);
	});
});

describe("terminal continuation settlement public projection", () => {
	it("overrides a stale suspended checkpoint with the exact durable terminal boundary", () => {
		const status: AgentsChatTurnStatusSnapshot = {
			sessionId: "session-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "turn-1",
				internalTurnId: "turn-1",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-20T00:00:00.000Z",
				updatedAt: "2026-08-20T00:00:01.000Z",
				lastConfirmedAt: "2026-08-20T00:00:01.000Z",
				requestText: "生成视频",
				terminalAuthority: "user_delivery",
				reasonCode: "root_physical_execution_budget_exhausted",
				suspension: {
					reasonCode: "root_physical_execution_budget_exhausted",
					physicalRunId: "run-1",
					progressRevision: 1,
					progressSinceRunStart: 1,
					budgetKind: "turns",
					observed: 10,
					limit: 10,
				},
				recoveryCheckpoint: null,
				lastConfirmedSummary: "waiting",
				finalResponse: "unverified candidate",
				pendingQueueCount: 0,
				recentEvents: [],
			},
		};
		const settlement = {
			version: 1,
			effectId: "continuation-registration:turn-1:continuation-1",
			userId: "user-1",
			logicalTaskId: "logical-1",
			publicTurnId: "turn-1",
			physicalRunId: "run-1",
			phase: "failed",
			attempt: 2,
			lastError: "identity drift",
			createdAt: "2026-08-20T00:00:00.000Z",
			updatedAt: "2026-08-20T00:00:02.000Z",
			terminalBoundary: {
				version: 1,
				code: "continuation_settlement_registration_identity_drift",
				safePathsExhausted: true,
				failedAt: "2026-08-20T00:00:02.000Z",
			},
		} satisfies ContinuationSettlementRecordV1;

		expect(projectTerminalContinuationSettlementStatus({ status, settlement })).toMatchObject({
			activeTurn: false,
			turn: {
				state: "failed",
				phase: "failed",
				reasonCode: "continuation_settlement_registration_identity_drift",
				suspension: null,
				recoveryCheckpoint: null,
				finalResponse: null,
				attentionProjection: { status: "terminal" },
			},
		});
	});

	it("never overrides an already succeeded logical turn", () => {
		const status = {
			sessionId: "session-1",
			durable: true,
			activeTurn: false,
			turn: { turnId: "turn-1", state: "succeeded" },
		} as unknown as AgentsChatTurnStatusSnapshot;
		const settlement = {
			publicTurnId: "turn-1",
			terminalBoundary: { safePathsExhausted: true },
		} as unknown as ContinuationSettlementRecordV1;
		expect(projectTerminalContinuationSettlementStatus({ status, settlement })).toBe(status);
	});
});

describe("public chat interrupt coordination", () => {
	it("cancels continuations even when the runtime interrupt outcome is unknown", async () => {
		const cancelContinuations = vi.fn(async () => 2);
		const receipt = await coordinatePublicChatInterrupt({
			sessionKey: "session-1",
			turnId: "turn-1",
			dependencies: {
				interruptLocalTransport: () => true,
				interruptRuntime: async () => {
					throw new AppError("runtime interrupt timed out", {
						status: 504,
						code: "agents_chat_runtime_timeout",
						details: {
							operation: "interrupt",
							operationOutcome: "unknown",
						},
					});
				},
				cancelContinuations,
			},
		});

		expect(cancelContinuations).toHaveBeenCalledTimes(1);
		expect(receipt).toMatchObject({
			ok: true,
			interrupted: true,
			fullyInterrupted: false,
			turnId: "turn-1",
			localTransport: { status: "interrupted" },
			runtime: {
				status: "unknown",
				error: { code: "agents_chat_runtime_timeout" },
			},
			continuations: { status: "cancelled", cancelledCount: 2 },
			status: null,
		});
	});

	it("reports every branch independently when no active work remains", async () => {
		const receipt = await coordinatePublicChatInterrupt({
			sessionKey: "session-1",
			turnId: "turn-1",
			dependencies: {
				interruptLocalTransport: () => false,
				interruptRuntime: async () => ({
					ok: true,
					interrupted: false,
					sessionId: "session-1",
					turnId: "turn-1",
					status: null,
				}),
				cancelContinuations: async () => 0,
			},
		});

		expect(receipt).toMatchObject({
			interrupted: false,
			fullyInterrupted: true,
			localTransport: { status: "not_running" },
			runtime: { status: "already_inactive", turnId: "turn-1" },
			continuations: { status: "none", cancelledCount: 0 },
		});
	});

	it("still runs runtime and continuation cancellation when local transport interruption throws", async () => {
		const interruptRuntime = vi.fn(async () => ({
			ok: true as const,
			interrupted: true,
			sessionId: "session-1",
			turnId: "turn-1",
			status: null,
		}));
		const cancelContinuations = vi.fn(async () => 1);
		const receipt = await coordinatePublicChatInterrupt({
			sessionKey: "session-1",
			turnId: "turn-1",
			dependencies: {
				interruptLocalTransport: () => {
					throw new Error("local controller unavailable");
				},
				interruptRuntime,
				cancelContinuations,
			},
		});

		expect(interruptRuntime).toHaveBeenCalledTimes(1);
		expect(cancelContinuations).toHaveBeenCalledTimes(1);
		expect(receipt.localTransport).toMatchObject({ status: "failed" });
		expect(receipt.runtime).toMatchObject({ status: "interrupted" });
		expect(receipt.continuations).toMatchObject({ status: "cancelled", cancelledCount: 1 });
		expect(receipt.interrupted).toBe(true);
		expect(receipt.fullyInterrupted).toBe(false);
	});
});

describe("shouldPersistTurn（S2：客户端断连也要落库，治结果丢失）", () => {
  it("result 为 null/undefined → 不落库(上游真失败,避免写空助手 turn)", () => {
    expect(shouldPersistTurn(null)).toBe(false);
    expect(shouldPersistTurn(undefined)).toBe(false);
  });

  it("非空 result → 落库(即便客户端已断连,结果可复用、重连「继续」能拉回)", () => {
    const result = { id: "task_x", status: "succeeded" } as unknown as TaskResultDto;
    expect(shouldPersistTurn(result)).toBe(true);
  });
});

describe("CHAT_HEARTBEAT_MS", () => {
  it("心跳间隔为 15s(顶开 idle 超时,远小于常见 60s+ 代理/undici idle 窗口)", () => {
    expect(CHAT_HEARTBEAT_MS).toBe(15_000);
  });
});

describe("public chat stream failure envelope", () => {
	it("preserves action-level nonterminal and status reconciliation facts", () => {
		expect(toStreamErrorPayload(new AppError("受理状态未知", {
			status: 504,
			code: "agents_bridge_acceptance_unknown",
			details: {
				acceptance: "unknown",
				recovery: { kind: "status_reconcile", referenceId: "turn-1" },
			},
		}))).toMatchObject({
			code: "agents_bridge_acceptance_unknown",
			terminal: false,
			acceptanceKnown: false,
			sideEffectOutcomeKnown: false,
			recovery: { kind: "status_reconcile", referenceId: "turn-1" },
		});
	});

	it("terminalizes a structurally rejected admission without losing its error code", () => {
		expect(toStreamErrorPayload(new AppError("当前回合仍在执行", {
			status: 409,
			code: "chat_turn_inflight",
			terminal: true,
			details: {
				acceptance: "rejected",
				operationOutcome: "not_started",
				activeTurnId: "turn-1",
			},
		}))).toMatchObject({
			code: "chat_turn_inflight",
			terminal: true,
			retryability: "not_retryable",
			acceptanceKnown: true,
			sideEffectOutcomeKnown: true,
		});
	});
});

describe("inactive chat turn recovery classification", () => {
	it("reclaims suspended, lost and failed physical checkpoints without reinterpreting prompts", () => {
		expect(resolveInactiveChatTurnRecoveryKind({
			state: "suspended",
			phase: "suspended",
			reasonCode: "root_physical_execution_budget_exhausted",
		})).toBe("physical_budget");
		expect(resolveInactiveChatTurnRecoveryKind({
			state: "unknown",
			phase: "agent_running",
			reasonCode: "initial_execution",
		})).toBe("orphaned_checkpoint");
		expect(resolveInactiveChatTurnRecoveryKind({
			state: "failed",
			phase: "failed",
			reasonCode: "TypeError",
		})).toBe("orphaned_checkpoint");
		expect(resolveInactiveChatTurnRecoveryKind({
			state: "suspended",
			phase: "suspended",
			reasonCode: "provider_stream_interrupted",
		})).toBe("orphaned_checkpoint");
		expect(resolveInactiveChatTurnRecoveryKind({
			state: "suspended",
			phase: "suspended",
			reasonCode: "tool_progress_circuit_exhausted",
		})).toBe("physical_budget");
	});

	it("does not reopen completed or ordinary inactive checkpoints", () => {
		expect(resolveInactiveChatTurnRecoveryKind({
			state: "succeeded",
			phase: "completed",
			reasonCode: null,
		})).toBeNull();
		expect(resolveInactiveChatTurnRecoveryKind({
			state: "unknown",
			phase: "idle",
			reasonCode: null,
		})).toBeNull();
	});
});

describe("persisted continuation recovery lifecycle", () => {
	it("only authorizes the exact waiting_async root logical task", () => {
		const lifecycle = {
			traceId: "public-turn-1",
			logicalTaskId: "public-turn-1",
			rootTraceId: "public-turn-1",
			status: "waiting_async" as const,
			startedAt: "2026-08-22T00:00:00.000Z",
			updatedAt: "2026-08-22T00:01:00.000Z",
			finishedAt: null,
		};
		expect(isPersistedContinuationRecoveryLifecycleEligible({
			turnId: "public-turn-1",
			lifecycle,
		})).toBe(true);
		expect(isPersistedContinuationRecoveryLifecycleEligible({
			turnId: "public-turn-2",
			lifecycle,
		})).toBe(false);
		expect(isPersistedContinuationRecoveryLifecycleEligible({
			turnId: "public-turn-1",
			lifecycle: { ...lifecycle, status: "succeeded" },
		})).toBe(false);
	});
});

describe("public chat logical terminal projection", () => {
	it.each([
		["succeeded", "logical_succeeded"],
		["failed", "logical_failed"],
		["active", "physical_suspended"],
		["waiting_external", "physical_suspended"],
		["waiting_input", "needs_input"],
	] as const)("maps %s without calling a physical suspension finished", (status, reason) => {
		expect(resolvePublicChatDoneReason(status)).toBe(reason);
	});
});

describe("physical budget continuation request recovery", () => {
	it("keeps the host application user identity on durable continuation replay", () => {
		const continuation = parseAsyncAgentContinuation({
			id: "continuation_host_identity",
			rootRequestId: "root_host_identity",
			stage: 1,
			resumeTrigger: "physical_budget",
			parentContinuationId: null,
			userId: "owner-user",
			hostUserId: "tanva-user-42",
			projectId: "",
			flowId: "",
			chapterId: null,
			bookId: null,
			canvasNodeId: null,
			executionToolPolicy: null,
			sessionKey: "host:session-42",
			modelKey: null,
			modelAlias: "gpt-test",
			requiredSkills: ["pptx-generator"],
			dependencyNodeIds: [],
			dependencyTaskIds: [],
			dependencyRunIds: [],
			handledArtifactIds: ["root_physical_run:test:1"],
			progressFingerprint: "fingerprint",
			expectedDelivery: { active: false },
			createdAt: new Date(0).toISOString(),
			attempt: 0,
			nextAttemptAt: null,
			lastFailure: null,
		});

		expect(continuation?.hostUserId).toBe("tanva-user-42");
		const taskRequest = buildTaskRequest({
			prompt: "continue",
			modelAlias: "gpt-test",
			sessionKey: continuation?.sessionKey,
		});
		if (continuation?.hostUserId) {
			(taskRequest.extras as Record<string, unknown>).hostUserId = continuation.hostUserId;
		}
		expect(taskRequest.extras).toMatchObject({ hostUserId: "tanva-user-42" });
	});

	it("preserves a cursor-only repair frontier with its execution generation and rejects references without durable progress", () => {
		expect(readContinuationDurableTaskReferences([{
			version: 1,
			toolName: "tapcanvas_video_orchestrate",
			mode: "repair_assets",
			progressCursor: {
				version: 1,
				graph: "video_asset_repair",
				scopeId: "run-1:asset-repair",
				phase: "repair_required",
				revision: "asset-revision-1",
				executionGeneration: "repair-lease-generation-1",
				completedUnitIds: ["asset:0"],
				pendingUnitIds: ["asset:1"],
				allowedNextActions: ["repair_assets"],
				requiredReadActions: ["read_asset_declaration"],
				allowedSupportingTools: ["tapcanvas_image_reconcile"],
			},
			acceptedAsync: false,
		}, {
			version: 1,
			toolName: "tapcanvas_video_orchestrate",
			mode: "repair_assets",
			acceptedAsync: false,
		}])).toEqual([{
			version: 1,
			toolName: "tapcanvas_video_orchestrate",
			mode: "repair_assets",
			runId: null,
			taskId: null,
			draftRevision: null,
			beatRevision: null,
			preflightRevision: null,
			preflightFingerprint: null,
			clipIndex: null,
			progressCursor: {
				version: 1,
				graph: "video_asset_repair",
				scopeId: "run-1:asset-repair",
				phase: "repair_required",
				revision: "asset-revision-1",
				executionGeneration: "repair-lease-generation-1",
				completedUnitIds: ["asset:0"],
				pendingUnitIds: ["asset:1"],
				allowedNextActions: ["repair_assets"],
				requiredReadActions: ["read_asset_declaration"],
				allowedSupportingTools: ["tapcanvas_image_reconcile"],
			},
			acceptedAsync: false,
		}]);
	});

	it("rebuilds a schema-valid trusted request without an empty display prompt", () => {
		const userIntentContract = createTestIntentContract();
		const continuation: AsyncAgentContinuation = {
			id: "continuation-request-1",
			rootRequestId: "turn-request-1",
			stage: 1,
			resumeTrigger: "physical_budget",
			parentContinuationId: null,
			userId: "user-1",
			projectId: "project-1",
			flowId: "flow-1",
			chapterId: null,
			bookId: null,
			canvasNodeId: "node-1",
			executionToolPolicy: null,
			sessionKey: "workflow:execution-1:node-1",
			modelKey: "deepseek-v4-flash",
			modelAlias: null,
			requiredSkills: ["tapcanvas-video-prompt-writer"],
			dependencyNodeIds: [],
			dependencyTaskIds: [],
			dependencyRunIds: [],
			handledArtifactIds: [],
			progressFingerprint: "fingerprint-1",
			expectedDelivery: { active: true },
			userIntentContract,
			taskCapsule: {
				version: 1,
				goal: "生成一个结构化镜头提示词",
				requestFacts: {
					requiredSkills: ["tapcanvas-video-prompt-writer"],
				},
			},
			createdAt: "2026-08-14T00:00:00.000Z",
			attempt: 0,
			nextAttemptAt: null,
			lastFailure: null,
		};
		const candidate = buildAsyncAgentContinuationRequestCandidate({
			continuation,
			prompt: "从持久 checkpoint 继续，不创建新的用户消息。",
		});

		expect(candidate).not.toHaveProperty("displayPrompt");
		expect(candidate).not.toHaveProperty("userIntentContract");
		expect(candidate).not.toHaveProperty("userIntentContractLocked");
		expect(AgentsChatRequestSchema.safeParse(candidate)).toMatchObject({ success: true });
		expect(buildTrustedContinuationIntentContext(userIntentContract)).toEqual({
			userIntentContract,
			userIntentContractLocked: true,
		});
	});

	it("rejects a corrupted machine-owned continuation intent contract", () => {
		const contract = createTestIntentContract();
		contract.delivery = {
			...(contract.delivery as Record<string, unknown>),
			output: "被篡改的交付",
		};
		expect(() => buildTrustedContinuationIntentContext(contract)).toThrow(
			expect.objectContaining({
				code: "async_continuation_user_intent_contract_invalid",
				message: expect.stringContaining(
					"async_continuation_user_intent_contract_invalid:user_intent_contract_hash_mismatch",
				),
			}),
		);
	});

	it("classifies a pre-v2 frozen contract as a deterministic continuation preparation failure", () => {
		const legacyContract = {
			...createTestIntentContract(),
			version: 1,
		};
		expect(() => buildTrustedContinuationIntentContext(legacyContract)).toThrow(
			expect.objectContaining({
				code: "async_continuation_user_intent_contract_invalid",
				message: expect.stringContaining("userIntentContract 的集合字段不符合冻结合同 schema"),
			}),
		);
	});

	it("uses the agents-cli continuation ticket as the durable handoff identity", () => {
		expect(readRootPhysicalContinuationSuspension({
			runtime: {
				physicalRunExit: {
					version: 1,
					kind: "handoff",
					continuationTicket: {
						version: 1,
						ticketId: "turn-1:task-1:12",
						taskRevision: 12,
						nextTrigger: "durable_resume",
						reasonCode: "tool_progress_circuit_exhausted",
					},
				},
			},
		})).toEqual({
			reasonCode: "tool_progress_circuit_exhausted",
			physicalRunId: "turn-1:task-1:12",
			progressRevision: 12,
		});
	});

	it("uses a direct Agent repair suspension receipt as its durable continuation identity", () => {
		expect(readRootPhysicalContinuationSuspension({
			runOutcome: { status: "suspended" },
			runtime: {
				suspension: {
					reasonCode: "max_turns",
					physicalRunId: "workflow-physical-run-1",
					progressRevision: 0,
				},
			},
		})).toEqual({
			reasonCode: "max_turns",
			physicalRunId: "workflow-physical-run-1",
			progressRevision: 0,
		});
	});

	it("registers an unsatisfied suspended response-mode delivery for same-task repair", () => {
		expect(shouldRegisterPhysicalContinuation({
			meta: {
				logicalTaskState: { status: "active" },
				expectedDelivery: { active: true, kind: "text" },
				runtime: {
					userIntentContract: {
						version: 2,
						delivery: { mode: "response", mediaType: null, kind: "text", output: "高质量答复" },
					},
					physicalRunExit: {
						version: 1,
						kind: "handoff",
						continuationTicket: {
							version: 1,
							ticketId: "text-run-1",
							taskRevision: 1,
							nextTrigger: "durable_resume",
							reasonCode: "root_physical_execution_budget_exhausted",
						},
					},
				},
			},
		})).toBe(true);
	});

	it("does not register after an authoritative logical terminal", () => {
		expect(shouldRegisterPhysicalContinuation({
			meta: {
				logicalTaskState: { status: "succeeded" },
				runtime: { physicalRunExit: { version: 1, kind: "handoff" } },
			},
		})).toBe(false);
	});

	it("does not register a succeeded response-mode delivery even with a stale handoff", () => {
		expect(shouldRegisterPhysicalContinuation({
			meta: {
				logicalTaskState: { status: "succeeded" },
				runtime: {
					userIntentContract: {
						version: 2,
						delivery: { mode: "response", mediaType: null, kind: "text", output: "高质量答复" },
					},
					physicalRunExit: { version: 1, kind: "handoff" },
				},
			},
		})).toBe(false);
	});

	it("enriches an already-claimed continuation with the latest agents checkpoint frontier", () => {
		const userIntentContract = createTestIntentContract();
		const continuation: AsyncAgentContinuation = {
			id: "continuation-1",
			rootRequestId: "turn-1",
			stage: 2,
			resumeTrigger: "physical_budget",
			parentContinuationId: "continuation-0",
			userId: "user-1",
			projectId: "project-1",
			flowId: "",
			chapterId: "chapter-1",
			bookId: "book-1",
			canvasNodeId: null,
			executionToolPolicy: null,
			sessionKey: "session-1",
			modelKey: "deepseek-v4-flash",
			modelAlias: null,
			requiredSkills: [],
			dependencyNodeIds: [],
			dependencyTaskIds: [],
			dependencyRunIds: [],
			handledArtifactIds: [],
			progressFingerprint: "fingerprint-1",
			expectedDelivery: { active: true },
			durableTaskReferences: [{
				version: 1,
				toolName: "tapcanvas_video_orchestrate",
				mode: "preflight_patch_header",
				runId: "video-1",
				taskId: null,
				draftRevision: "revision-1",
				beatRevision: null,
				preflightRevision: null,
				preflightFingerprint: null,
				clipIndex: null,
				acceptedAsync: false,
			}],
			createdAt: "2026-08-12T00:00:00.000Z",
			attempt: 0,
			nextAttemptAt: null,
			lastFailure: null,
		};
		const enriched = mergeClaimedContinuationRecoveryCheckpoint({
			continuation,
			recoveryCheckpoint: {
				reasonCode: "root_physical_execution_budget_exhausted",
				physicalRunId: "physical-2",
				progressRevision: 43,
				durableTaskReferences: [{
					version: 1,
					toolName: "tapcanvas_video_orchestrate",
					mode: "preflight_get_header",
					runId: "video-1",
					taskId: null,
					draftRevision: "revision-1",
					beatRevision: null,
					preflightRevision: null,
					preflightFingerprint: null,
					clipIndex: null,
					progressCursor: {
						version: 1,
						graph: "video_authoring",
						scopeId: "video-1:preflight",
						phase: "preflight_draft",
						revision: "revision-1",
						completedUnitIds: ["preflight:header", "beat:0", "beat:1"],
						pendingUnitIds: [],
						allowedNextActions: ["preflight_commit"],
						requiredReadActions: [],
						allowedSupportingTools: ["tapcanvas_book_chapter_get"],
					},
					acceptedAsync: false,
				}],
				durableProgressClaims: [{
					key: "video-1:beat:1",
					fingerprint: "claim-1",
					kind: "durable_action",
					toolName: "tapcanvas_video_orchestrate",
					toolCallId: "call-1",
					observedAt: "2026-08-12T00:01:00.000Z",
					revision: 43,
				}],
				userIntentContract,
			},
		});
		expect(enriched.userIntentContract).toEqual(userIntentContract);
		expect(enriched.durableTaskReferences).toHaveLength(2);
		expect(enriched.durableTaskReferences?.at(-1)?.progressCursor?.allowedNextActions)
			.toEqual(["preflight_commit"]);
		expect(enriched.durableTaskReferences?.at(-1)?.progressCursor?.scopeId)
			.toBe("video-1:preflight");
		expect(enriched.durableTaskReferences?.at(-1)?.progressCursor?.allowedSupportingTools)
			.toEqual(["tapcanvas_book_chapter_get"]);
		expect(enriched.durableProgressClaims?.at(-1)?.revision).toBe(43);
	});

	it("rejects an intent contract mismatch while enriching a claimed continuation", () => {
		const continuationIntent = createTestIntentContract();
		const checkpointIntent = createTestIntentContract();
		checkpointIntent.delivery = {
			...(checkpointIntent.delivery as Record<string, unknown>),
			durationSeconds: 60,
		};
		checkpointIntent.contractHash = createHash("sha256")
			.update(JSON.stringify(canonicalizeIntentContract(checkpointIntent)))
			.digest("hex");
		const continuation = {
			id: "continuation-intent-mismatch",
			userIntentContract: continuationIntent,
		} as AsyncAgentContinuation;
		expect(() => mergeClaimedContinuationRecoveryCheckpoint({
			continuation,
			recoveryCheckpoint: {
				reasonCode: "provider_stream_interrupted",
				physicalRunId: "physical-intent-mismatch",
				progressRevision: 1,
				durableTaskReferences: [],
				durableProgressClaims: [],
				userIntentContract: checkpointIntent,
			},
		})).toThrowError("async_recovery_checkpoint_user_intent_contract_mismatch");
	});

	it("reconstructs checkpoint-matched physical suspensions without semantic reason routing", () => {
		const budgetCheckpoint = {
			reasonCode: "root_physical_execution_budget_exhausted" as const,
			physicalRunId: "physical_run_1",
			progressRevision: 4,
			durableTaskReferences: [],
			durableProgressClaims: [],
			userIntentContract: null,
		};
		expect(resolveRecoveryContinuationSuspension({
			recoveryKind: "physical_budget",
			reasonCode: budgetCheckpoint.reasonCode,
			suspension: {
				reasonCode: "root_physical_execution_budget_exhausted",
				physicalRunId: "physical_run_1",
				progressRevision: 4,
				progressSinceRunStart: 2,
				budgetKind: "wall_time",
				observed: 300_001,
				limit: 300_000,
			},
			recoveryCheckpoint: budgetCheckpoint,
		})).toEqual({
			reasonCode: "root_physical_execution_budget_exhausted",
			physicalRunId: "physical_run_1",
			progressRevision: 4,
		});
		expect(resolveRecoveryContinuationSuspension({
			recoveryKind: "orphaned_checkpoint",
			reasonCode: "provider_stream_interrupted",
			suspension: null,
			recoveryCheckpoint: {
				...budgetCheckpoint,
				reasonCode: "provider_stream_interrupted",
			},
		})).toEqual({
			reasonCode: "provider_stream_interrupted",
			physicalRunId: "physical_run_1",
			progressRevision: 4,
		});
		expect(resolveRecoveryContinuationSuspension({
			recoveryKind: "orphaned_checkpoint",
			reasonCode: "llm_response_too_large",
			suspension: null,
			recoveryCheckpoint: {
				...budgetCheckpoint,
				reasonCode: "llm_response_too_large",
			},
		})).toEqual({
			reasonCode: "llm_response_too_large",
			physicalRunId: "physical_run_1",
			progressRevision: 4,
		});
		expect(resolveRecoveryContinuationSuspension({
			recoveryKind: "orphaned_checkpoint",
			reasonCode: "workflow_agent_role_timeout",
			suspension: null,
			recoveryCheckpoint: {
				...budgetCheckpoint,
				reasonCode: "workflow_agent_role_timeout",
			},
		})).toEqual({
			reasonCode: "workflow_agent_role_timeout",
			physicalRunId: "physical_run_1",
			progressRevision: 4,
		});
		expect(resolveRecoveryContinuationSuspension({
			recoveryKind: "physical_budget",
			reasonCode: budgetCheckpoint.reasonCode,
			suspension: null,
			recoveryCheckpoint: budgetCheckpoint,
		})).toBeNull();
		expect(resolveRecoveryContinuationSuspension({
			recoveryKind: "physical_budget",
			reasonCode: "max_turns",
			suspension: null,
			recoveryCheckpoint: {
				...budgetCheckpoint,
				reasonCode: "max_turns",
				physicalRunId: "physical_run_repair_1",
				progressRevision: 0,
			},
		})).toEqual({
			reasonCode: "max_turns",
			physicalRunId: "physical_run_repair_1",
			progressRevision: 0,
		});
	});

	it("inherits the first public turn identity across every physical window", () => {
		expect(resolveContinuationRootRequestId({
			rootRequestId: "public-turn-1",
			parentRootRequestId: null,
		})).toBe("public-turn-1");
		expect(resolveContinuationRootRequestId({
			rootRequestId: null,
			parentRootRequestId: "public-turn-1",
		})).toBe("public-turn-1");
		expect(resolveContinuationRootRequestId({
			rootRequestId: "",
			parentRootRequestId: "public-turn-1",
		})).toBe("public-turn-1");
		expect(resolveContinuationRootRequestId({
			rootRequestId: null,
			parentRootRequestId: null,
		})).toBeNull();
	});

	it("refuses to recreate a business run when durable progress has no frontier", () => {
		expect(() => assertPhysicalBudgetRecoveryFrontier({
			progressRevision: 4,
			physicalRunId: "physical_run_1",
			durableTaskReferences: [],
			durableProgressClaims: [],
		})).toThrow(/缺少可验证的 task\/run 或 durable-action frontier/);
		expect(() => assertPhysicalBudgetRecoveryFrontier({
			progressRevision: 0,
			physicalRunId: "physical_run_2",
			durableTaskReferences: [],
			durableProgressClaims: [],
		})).not.toThrow();
		expect(() => assertPhysicalBudgetRecoveryFrontier({
			progressRevision: 4,
			physicalRunId: "physical_run_3",
			durableTaskReferences: [],
			durableProgressClaims: [{
				key: "assetId:asset-1",
				toolCallId: "call-1",
			}],
		})).not.toThrow();
	});

	it("accepts the exact persisted request for the same session", () => {
		const request = parsePhysicalBudgetRecoveryRequest({
			acceptedRequest: {
				prompt: "执行 V2",
				modelKey: "deepseek-v4-flash",
				sessionKey: "session-v2",
				stream: true,
			},
			expectedSessionKey: "session-v2",
		});
		expect(request).toMatchObject({
			prompt: "执行 V2",
			modelKey: "deepseek-v4-flash",
			sessionKey: "session-v2",
		});
	});

	it("rejects a persisted request from another session", () => {
		expect(() => parsePhysicalBudgetRecoveryRequest({
			acceptedRequest: { prompt: "执行 V2", sessionKey: "session-old" },
			expectedSessionKey: "session-v2",
		})).toThrowError("持久化请求与当前会话身份不一致");
	});
});

describe("agents bridge SSE ownership", () => {
	it("forwards live progress but reserves terminal frames for the Hono-enriched response", () => {
		expect(shouldForwardAgentsBridgeStreamEvent("tool")).toBe(true);
		expect(shouldForwardAgentsBridgeStreamEvent("item.completed")).toBe(true);
		expect(shouldForwardAgentsBridgeStreamEvent("result")).toBe(false);
		expect(shouldForwardAgentsBridgeStreamEvent("turn.completed")).toBe(false);
		expect(shouldForwardAgentsBridgeStreamEvent("error")).toBe(false);
		expect(shouldForwardAgentsBridgeStreamEvent("done")).toBe(false);
	});
});

describe("async continuation delivery lock", () => {
	it("anchors the first continuation to Hono's public turn id without depending on provider result meta", () => {
		expect(resolveServerOwnedContinuationRequestId(" fe_public_turn_1 ")).toBe("fe_public_turn_1");
		expect(resolveServerOwnedContinuationRequestId("   ")).toBeNull();
		expect(resolveServerOwnedContinuationRequestId(null)).toBeNull();
	});

	it("captures every validated request fact while stripping only transient transport fields", () => {
		const capsule = buildContinuationTaskCapsule({
			prompt: "完成当前逻辑任务",
			modelKey: "model-a",
			sessionKey: "session-a",
			canvasProjectId: "project-a",
			chapterContext: {
				projectId: "project-a",
				bookId: "book-a",
				chapterId: "chapter-a",
				flowSnapshot: { nodes: [], edges: [] },
			},
			requestedImageCount: 3,
			aspectRatio: "16:9",
			forcedAgentRole: "future-specialist",
		} as AgentsChatRequestDto);

		expect(capsule).toEqual({
			version: 1,
			goal: "完成当前逻辑任务",
			requestFacts: {
				chapterContext: {
					projectId: "project-a",
					bookId: "book-a",
					chapterId: "chapter-a",
					flowSnapshot: { nodes: [], edges: [] },
				},
				requestedImageCount: 3,
				aspectRatio: "16:9",
				forcedAgentRole: "future-specialist",
			},
		});
	});

	it("locks trusted workflow output semantics into every physical continuation capsule", () => {
		const capsule = buildContinuationTaskCapsule(
			{
				prompt: "把章节拆成 15 秒提示词数组",
				modelKey: "model-a",
				sessionKey: "workflow:execution-a:planner",
				forcedAgentRole: "writer",
			} as AgentsChatRequestDto,
			undefined,
			{
				kind: "chat",
				prompt: "把章节拆成 15 秒提示词数组",
					extras: {
					continuationExecutionContract: {
						version: 1,
						directForcedAgentExecution: true,
						retrievalUserRequest: "把章节拆成 15 秒提示词数组",
						retrievalContext: {
							protocolVersion: "retrieval-context/v1",
							facts: [
								{
									id: "workflow:input:beatsheet",
									text: "上游已经冻结 BeatSheet",
									source: "input",
								},
							],
						},
						outputContract: {
							kind: "json",
							requiredArrayField: "$",
						},
						responseFormat: {
							type: "json_schema",
						},
					},
				},
			},
		);

		expect(capsule?.executionContract).toEqual({
			version: 1,
			directForcedAgentExecution: true,
			retrievalUserRequest: "把章节拆成 15 秒提示词数组",
			retrievalContext: {
				protocolVersion: "retrieval-context/v1",
				facts: [
					{
						id: "workflow:input:beatsheet",
						text: "上游已经冻结 BeatSheet",
						source: "input",
					},
				],
			},
			outputContract: {
				kind: "json",
				requiredArrayField: "$",
			},
			responseFormat: {
				type: "json_schema",
			},
		});
	});

	it("preserves a long typed Workflow Agent goal and execution contract across durable parsing", () => {
		const goal = `执行当前资产规划节点。\n${"上游 BeatSheet 冻结事实。".repeat(12_000)}`;
		expect(goal.length).toBeGreaterThan(64_000);
		const capsule = buildContinuationTaskCapsule(
			{
				prompt: goal,
				sessionKey: "workflow:execution-long:asset-coverage",
			} as AgentsChatRequestDto,
			undefined,
			{
				kind: "chat",
				prompt: goal,
				extras: {
					continuationExecutionContract: {
						version: 1,
						directForcedAgentExecution: true,
						outputContract: { kind: "json", artifactType: "tapcanvas.asset-plans/v1" },
					},
				},
			},
		);

		expect(capsule?.goal).toBe(goal);
		expect(capsule?.executionContract?.directForcedAgentExecution).toBe(true);
		const parsed = parseAsyncAgentContinuation({
			id: "async-continuation:long-typed-goal",
			stage: 1,
			resumeTrigger: "physical_budget",
			parentContinuationId: null,
			userId: "user-a",
			projectId: "project-a",
			flowId: "flow-a",
			chapterId: "chapter-a",
			bookId: "book-a",
			canvasNodeId: "asset-coverage",
			executionToolPolicy: null,
			sessionKey: "workflow:execution-long:asset-coverage",
			modelKey: "model-a",
			modelAlias: null,
			requiredSkills: [],
			dependencyNodeIds: [],
			dependencyTaskIds: [],
			dependencyRunIds: [],
			handledArtifactIds: ["root_physical_run:1"],
			progressFingerprint: "frontier-long-typed-goal",
			expectedDelivery: { active: true, kind: "tapcanvas.asset-plans/v1" },
			taskCapsule: capsule,
			createdAt: "2026-08-22T00:00:00.000Z",
			attempt: 0,
			nextAttemptAt: null,
			lastFailure: null,
		});

		expect(parsed?.taskCapsule?.goal).toBe(goal);
		expect(parsed?.taskCapsule?.executionContract?.directForcedAgentExecution).toBe(true);
		if (!parsed) throw new Error("expected the long continuation capsule to parse");
		expect(parseAsyncAgentContinuation({
			...parsed,
			taskCapsule: {
				...parsed.taskCapsule,
				goal: "a".repeat(ASYNC_AGENT_CONTINUATION_TASK_GOAL_MAX_UTF8_BYTES + 1),
			},
		})).toBeNull();
	});

	it("fails explicitly when an immutable continuation goal exceeds the transport-safe bound", () => {
		const goal = "a".repeat(ASYNC_AGENT_CONTINUATION_TASK_GOAL_MAX_UTF8_BYTES + 1);
		expect(() => buildContinuationTaskCapsule({ prompt: goal } as AgentsChatRequestDto))
			.toThrowError(/async_continuation_task_goal_too_large/);
	});

	it("merges a newly authenticated execution contract without replacing the immutable parent goal", () => {
		const parent = {
			sessionKey: "workflow:execution-a:planner",
			taskCapsule: {
				version: 1,
				goal: "完成原始章节任务",
				requestFacts: { canvasProjectId: "project-a" },
				executionContract: {
					version: 1,
					directForcedAgentExecution: true,
					outputContract: { kind: "json", requiredArrayField: "$" },
				},
			},
		} as NonNullable<Parameters<typeof buildContinuationTaskCapsule>[1]>;
		const capsule = buildContinuationTaskCapsule(
			{ prompt: "不能替换父目标" } as AgentsChatRequestDto,
			parent,
			{
				kind: "chat",
				prompt: "续跑",
				extras: {
					continuationExecutionContract: {
						version: 1,
						directForcedAgentExecution: true,
						maxOutputTokens: 32_768,
						outputContract: { kind: "json", requiredArrayField: "$" },
					},
				},
			},
		);

		expect(capsule?.goal).toBe("完成原始章节任务");
		expect(capsule?.requestFacts).toEqual({ canvasProjectId: "project-a" });
		expect(capsule?.executionContract?.maxOutputTokens).toBe(32_768);
	});

	it("returns the stored execution contract without synthesizing correction state", () => {
		const continuation = {
			id: "async-continuation:legacy",
			sessionKey: "workflow:execution-a:planner",
			taskCapsule: {
				version: 1,
				goal: "完成章节一键成片",
				requestFacts: {},
				executionContract: {
					version: 1,
					directForcedAgentExecution: true,
					outputContract: { kind: "json", requiredArrayField: "$" },
				},
			},
		} as AsyncAgentContinuation;

		expect(resolveContinuationExecutionContract(continuation)).toEqual({
			version: 1,
			directForcedAgentExecution: true,
			outputContract: { kind: "json", requiredArrayField: "$" },
		});
	});

	it("keeps nonterminal physical windows silent and publishes only logical terminal results", () => {
		expect(resolveAsyncContinuationConversationPublication("active")).toBe("silent");
		expect(resolveAsyncContinuationConversationPublication("waiting_external")).toBe("silent");
		expect(resolveAsyncContinuationConversationPublication(null)).toBe("silent");
		expect(resolveAsyncContinuationConversationPublication("succeeded")).toBe("assistant_only");
		expect(resolveAsyncContinuationConversationPublication("failed")).toBe("assistant_only");
		expect(resolveAsyncContinuationConversationPublication("waiting_input")).toBe("assistant_only");
	});

	it.each([
		{
			registration: {
				status: "invalid" as const,
				reason: "suspended delivery has no addressable canvas dependency",
			},
			expectedReason: "async_continuation_registration_invalid",
		},
	])("records $registration.status diagnostics without mutating the agents result", ({
		registration,
		expectedReason,
	}) => {
		const result = {
			raw: {
			meta: {
				requestTerminal: {
					version: 1,
					terminal: true,
						status: "suspended",
						reason: "async_execution_suspended_until_delivery_verified",
					},
					turnVerdict: {
						status: "partial",
						reasons: ["async_execution_accepted_not_completed"],
					},
				},
			},
		} as unknown as TaskResultDto;

		recordAsyncContinuationRegistrationDiagnostic(result, registration);

		expect(result.raw).toMatchObject({
			meta: {
				requestTerminal: {
					status: "suspended",
					reason: "async_execution_suspended_until_delivery_verified",
				},
				turnVerdict: {
					status: "partial",
					reasons: ["async_execution_accepted_not_completed"],
				},
				continuationRegistration: {
					status: registration.status,
					reason: expectedReason,
					details: registration.reason,
				},
			},
		});
	});

	it("refuses to publish a suspension unless a durable continuation owner exists", () => {
		const result = {
			raw: {
				meta: {
					logicalTaskState: { status: "active" },
					requestTerminal: {
						version: 1,
						terminal: true,
						status: "suspended",
						reason: "tool_progress_circuit_exhausted",
					},
				},
			},
		} as unknown as TaskResultDto;

		expect(() => assertSuspendedContinuationOwnership({
			result,
			registration: { status: "invalid", reason: "no durable capsule" },
		})).toThrowError(/没有可验证的持久续跑执行者/);
		expect(() => assertSuspendedContinuationOwnership({
			result,
			registration: {
				status: "external_handoff",
				reason: "declared host owns emitted canvas commands",
				effectOwner: "host_execution",
				ownership: {
					version: 1,
					owner: "external_host",
					ticketId: "logical-1:task-1:4",
					logicalTaskId: "logical-1",
					taskNodeId: "task-1",
					taskRevision: 4,
					reasonCode: "host_execution_required",
					host: "tanva",
					commandCount: 3,
					runNodeCount: 1,
					commandToolCallIds: ["add-1", "connect-1", "run-1"],
				},
			},
		})).not.toThrow();
		expect(() => assertSuspendedContinuationOwnership({
			result,
			registration: {
				status: "reconcile_pending",
				reason: "durable settlement owns recovery",
				effectOwner: "continuation_settlement",
			},
		})).not.toThrow();
		expect(() => assertSuspendedContinuationOwnership({
			result,
			registration: {
				status: "reconcile_pending",
				reason: "ExecutionDO owns the suspended workflow node",
				effectOwner: "workflow_execution",
			},
		})).not.toThrow();
	});

	it("records external host ownership without claiming a durable AI continuation", () => {
		const result = {
			raw: {
				meta: {
					requestTerminal: {
						version: 1,
						terminal: true,
						status: "suspended",
						reason: "host_execution_required",
					},
				},
			},
		} as unknown as TaskResultDto;
		recordAsyncContinuationRegistrationDiagnostic(result, {
			status: "external_handoff",
			reason: "declared host owns emitted canvas commands",
			effectOwner: "host_execution",
			ownership: {
				version: 1,
				owner: "external_host",
				ticketId: "logical-1:task-1:4",
				logicalTaskId: "logical-1",
				taskNodeId: "task-1",
				taskRevision: 4,
				reasonCode: "host_execution_required",
				host: "tanva",
				commandCount: 2,
				runNodeCount: 1,
				commandToolCallIds: ["add-1", "run-1"],
			},
		});
		expect(result.raw).toMatchObject({
			meta: {
				continuationRegistration: {
					status: "external_handoff",
					reason: "async_external_host_execution_handoff",
					effectOwner: "host_execution",
					ticketId: "logical-1:task-1:4",
					host: "tanva",
					commandCount: 2,
					runNodeCount: 1,
				},
			},
		});
		expect(resolveAsyncContinuationPersistenceStatus({
			registrationStatus: "external_handoff",
			logicalTaskStatus: "waiting_external",
		})).toBe("completed");
		expect(continuationRegistrationOwnsChatActivity({
			registrationStatus: "external_handoff",
			logicalTaskStatus: "waiting_external",
		})).toBe(false);
		expect(continuationRegistrationOwnsChatActivity({
			registrationStatus: "registered",
			logicalTaskStatus: "waiting_external",
		})).toBe(true);
	});

	it("keeps backend continuation persistence separate from the AI turn", () => {
		expect(resolveAsyncContinuationPersistenceStatus({
			registrationStatus: "not_required",
			logicalTaskStatus: "waiting_external",
		})).toBe("completed");
		expect(resolveAsyncContinuationPersistenceStatus({
			registrationStatus: "registered",
			logicalTaskStatus: "failed",
		})).toBe("failed");
	});

	it("rejects already handled artifact identities so a continuation cannot loop backward", () => {
		const artifacts = [
			{
				assetType: "image",
				deliveryState: "materialized",
				nodeId: "image-1",
				taskId: "task-image-1",
			},
			{
				assetType: "video",
				deliveryState: "accepted_async",
				nodeId: "video-1",
				taskId: "task-video-1",
			},
		];

		expect(selectNewContinuationDependencies(
			artifacts,
			["image:node:image-1"],
		)).toEqual([artifacts[1]]);
		expect(selectNewContinuationDependencies(
			artifacts,
			["image:node:image-1", "video:node:video-1"],
		)).toEqual([]);
	});

	it("keeps probing an already accepted immutable provider job without replaying submission", () => {
		const accepted = {
			assetType: "video",
			deliveryState: "accepted_async",
			nodeId: "video-1",
			taskId: "task-video-1",
			runId: "run-video-1",
		};
		expect(selectDurableContinuationDependencies({
			artifacts: [accepted],
			handledArtifactIds: ["video:node:video-1"],
			hasParentContinuation: true,
		})).toEqual([accepted]);
		expect(selectDurableContinuationDependencies({
			artifacts: [{ ...accepted, deliveryState: "materialized", assetUrl: "https://cdn.example/video.mp4" }],
			handledArtifactIds: ["video:node:video-1"],
			hasParentContinuation: true,
		})).toEqual([]);
	});

	it("waits on the exact accepted image task before opening another physical window", () => {
		expect(resolvePendingContinuationResumePlan({
			meta: {
				expectedDelivery: { active: true, kind: "image" },
				logicalTaskState: { status: "waiting_external" },
				deliveryEvidence: {
					artifacts: [{
						assetType: "image",
						deliveryState: "accepted_async",
						nodeId: "image-node-1",
						taskId: "image-task-1",
					}],
				},
				runtime: {
					suspension: {
						reasonCode: "root_physical_execution_budget_exhausted",
						physicalRunId: "physical-run-1",
						progressRevision: 4,
					},
				},
			},
		})).toMatchObject({
			trigger: "dependency",
			dependencies: [{ taskId: "image-task-1", nodeId: "image-node-1" }],
		});
	});

	it("preserves exact materialized image evidence across a later physical rollover", () => {
		const parent: AsyncAgentContinuation = {
			id: "continuation-image-1",
			rootRequestId: "turn-image-1",
			stage: 2,
			resumeTrigger: "dependency",
			parentContinuationId: "continuation-image-0",
			userId: "user-1",
			projectId: "project-1",
			flowId: "flow-1",
			chapterId: null,
			bookId: null,
			canvasNodeId: "image-node-1",
			executionToolPolicy: null,
			sessionKey: "session-image-1",
			modelKey: "model-1",
			modelAlias: null,
			requiredSkills: [],
			artifactDependencies: [{
				version: 2,
				artifactId: "image:node:image-node-1",
				nodeId: "image-node-1",
				taskId: "image-task-1",
				runId: null,
				runProtocol: null,
			}],
			materializedArtifacts: [{
				version: 1,
				artifactId: "image:node:image-node-1",
				mediaType: "image",
				nodeId: "image-node-1",
				taskId: "image-task-1",
				runId: null,
				assetId: "asset-image-1",
				assetUrl: "https://assets.example/cat.png",
				observedAt: "2026-08-24T00:00:00.000Z",
				source: "task_result",
			}],
			dependencyNodeIds: ["image-node-1"],
			dependencyTaskIds: ["image-task-1"],
			dependencyRunIds: [],
			handledArtifactIds: ["image:node:image-node-1"],
			progressFingerprint: "image-ready",
			expectedDelivery: { active: true, kind: "image" },
			createdAt: "2026-08-24T00:00:00.000Z",
			attempt: 0,
			nextAttemptAt: null,
			lastFailure: null,
		};

		expect(collectInheritedPhysicalArtifactFrontier(parent)).toEqual({
			artifactDependencies: parent.artifactDependencies,
			materializedArtifacts: parent.materializedArtifacts,
			dependencyNodeIds: ["image-node-1"],
			dependencyTaskIds: ["image-task-1"],
			dependencyRunIds: [],
		});
	});

	it("recovers settled task-result artifacts from durable claims after a stale parent branch", () => {
		const result = collectDurableClaimTaskArtifactFrontier({
			mediaType: "image",
			durableProgressClaims: [{
				key: "taskId:image-task-1",
				kind: "task_state",
				toolName: "tapcanvas_image_generate_to_canvas",
				toolCallId: "generate-image-1",
				observedAt: "2026-08-24T00:00:00.000Z",
				fingerprint: "task-image-ready",
				revision: 1,
			}],
			taskResults: [{
				user_id: "user-1",
				task_id: "image-task-1",
				vendor: "newapi",
				kind: "text_to_image",
				status: "succeeded",
				result: JSON.stringify({
					id: "image-task-1",
					kind: "text_to_image",
					status: "succeeded",
					assets: [{
						type: "image",
						url: "https://assets.example/cat.png",
						assetId: "asset-image-1",
					}],
					raw: {},
				}),
				created_at: "2026-08-24T00:00:00.000Z",
				updated_at: "2026-08-24T00:01:00.000Z",
				completed_at: "2026-08-24T00:01:00.000Z",
				chapter_id: null,
				node_id: "image-node-1",
			}],
		});

		expect(result.artifactDependencies).toEqual([{
			version: 2,
			artifactId: "image:node:image-node-1",
			nodeId: "image-node-1",
			taskId: "image-task-1",
			runId: null,
		}]);
		expect(result.materializedArtifacts).toMatchObject([{
			artifactId: "image:node:image-node-1",
			mediaType: "image",
			taskId: "image-task-1",
			assetUrl: "https://assets.example/cat.png",
		}]);
	});

	it("uses a durable video run identity when an async orchestrator has no canvas node yet", () => {
		const artifact = {
			assetType: "video",
			deliveryState: "accepted_async",
			nodeId: null,
			taskId: null,
			runId: "video-run-1",
		};
		expect(selectNewContinuationDependencies([artifact], [])).toEqual([artifact]);
		expect(selectNewContinuationDependencies([artifact], ["video:run:video-run-1"])).toEqual([]);
	});

	it("reconstructs the immutable report fields from persisted expected delivery", () => {
		expect(buildAsyncContinuationDeliveryReportLock({
			active: true,
			kind: "video",
				source: "agents_cli_tool_trace",
			reason: "explicit_structured_delivery_contract",
			taskGoal: "完成第33章整章成片",
			requestedOutput: "第33章真实成片",
			successCriteria: ["全部 clip 有真实 videoUrl", "最终 concat URL 存在"],
			deliveryContract: { kind: "video", targetDurationSeconds: 150 },
		})).toEqual({
			taskGoal: "完成第33章整章成片",
			requestedOutput: "第33章真实成片",
			successCriteria: ["全部 clip 有真实 videoUrl", "最终 concat URL 存在"],
			deliveryContract: { kind: "video", targetDurationSeconds: 150 },
		});
	});

	it("keeps a full-chapter video delivery lock when duration and clip count are intentionally open", () => {
		expect(buildAsyncContinuationDeliveryReportLock({
			active: true,
			kind: "video",
				source: "agents_cli_tool_trace",
			reason: "explicit_structured_delivery_contract",
			taskGoal: "第2章整章成片",
			requestedOutput: "多段视频节点与最终成片",
			successCriteria: ["完整原文覆盖", "全部 clip 与 concat 有真实 URL"],
			deliveryContract: { kind: "video" },
		})).toEqual({
			taskGoal: "第2章整章成片",
			requestedOutput: "多段视频节点与最终成片",
			successCriteria: ["完整原文覆盖", "全部 clip 与 concat 有真实 URL"],
			deliveryContract: { kind: "video" },
		});
	});

	it("fails explicitly when persisted continuation facts cannot reconstruct a contract", () => {
		expect(() => buildAsyncContinuationDeliveryReportLock({
			active: true,
			kind: "video",
			taskGoal: "完成成片",
		})).toThrowError("async_continuation_expected_delivery_lock_invalid");
	});

	it("lets only a physical-window rollover repair an as-yet unfrozen delivery contract", () => {
		expect(resolveAsyncContinuationDeliveryReportLock({
			resumeTrigger: "physical_budget",
			expectedDelivery: { active: false },
		})).toBeNull();
		expect(resolveAsyncContinuationDeliveryReportLock({
			resumeTrigger: "physical_budget",
			expectedDelivery: {
				active: true,
				kind: "text",
				taskGoal: "应用项目视觉圣经",
			},
		})).toBeNull();

		expect(() => resolveAsyncContinuationDeliveryReportLock({
			resumeTrigger: "dependency",
			expectedDelivery: {
				active: true,
				kind: "text",
				taskGoal: "应用项目视觉圣经",
			},
		})).toThrowError("async_continuation_expected_delivery_lock_invalid");
	});
});

describe("public agents chat model propagation", () => {
	it("fails explicitly instead of falling back to the agents-cli configured model", () => {
		expect(() => buildTaskRequest({ prompt: "不要替我选择模型" })).toThrowError(
			"小T 主对话缺少当前选择的语言模型",
		);
	});

	it("fails explicitly when more than one model selector is supplied", () => {
		expect(() =>
			buildTaskRequest({
				prompt: "不要猜测模型优先级",
				modelKey: "gpt-5.6-terra",
				modelAlias: "claude-sonnet-4-6",
			}),
		).toThrowError("小T 主对话收到多个模型标识，无法确定唯一语言模型");
	});

  it("preserves the exact selected model key instead of rewriting it to another model", () => {
    const request = buildTaskRequest({
      prompt: "使用当前选择的模型",
      modelKey: "  gpt-5.2-xhigh  ",
    });

    expect(request.extras?.modelKey).toBe("gpt-5.2-xhigh");
  });

  it("preserves an exact model alias for chat-shaped callers", () => {
    const request = buildTaskRequest({
      prompt: "使用当前选择的模型",
      modelAlias: "  claude-sonnet-4-6  ",
    });

    expect(request.extras?.modelAlias).toBe("claude-sonnet-4-6");
  });

	it("projects chapter intent inputs as facts into the canonical agents request", () => {
		const chapterContext = {
			projectId: "project-1",
			bookId: "book-1",
			chapterId: "chapter-3",
			flowSnapshot: {
				nodes: [{ id: "chapter-seed-3", kind: "chapterSeed", data: { chapter: 3 } }],
				edges: [],
			},
		};
		const request = buildTaskRequest({
			prompt: "生成本章场景参考",
			modelKey: "gpt-5.6-terra",
			intent: "generate_scene_references",
			chapterIntentSourceNodeId: " chapter-seed-3 ",
			chapterContext,
			chapterIntentGenerationConfig: {
				imageModel: "gpt-image-2",
				imageSize: "2K",
			},
			chapterIntentVariantParams: { onlyMissing: true },
			chapterIntentStyleGuide: {
				styleName: "水墨电影感",
				referenceImages: ["https://cdn.example/style.png"],
			},
		});

		expect(request.extras).toMatchObject({
			intent: "generate_scene_references",
			chapterIntentSourceNodeId: "chapter-seed-3",
			chapterContext,
			chapterIntentGenerationConfig: {
				imageModel: "gpt-image-2",
				imageSize: "2K",
			},
			chapterIntentVariantParams: { onlyMissing: true },
			chapterIntentStyleGuide: {
				styleName: "水墨电影感",
				referenceImages: ["https://cdn.example/style.png"],
			},
		});
		expect(request.extras).not.toHaveProperty("goalSuggestion");
		expect(request.extras).not.toHaveProperty("executionPlanningDirective");
	});

	it("projects the exact resolved model fact into the user chat message", () => {
		expect(resolveChatTurnLanguageModelFact(
			{ prompt: "继续", modelAlias: "requested-alias" },
			{ id: "task-1", vendor: "agents", modelKey: "resolved-model", text: "完成" },
		)).toBe("resolved-model");
	});

	it("broadcasts both projections with the same stable public turn identity", () => {
		expect(buildBroadcastChatMessages(
			{
				prompt: "给出视频时长",
				modelKey: "deepseek-v4-flash",
			},
			{
				id: "response-1",
				vendor: "agents",
				modelKey: "deepseek-v4-flash",
				text: "建议 180 秒",
			},
			"fe-root-turn-1",
			"2026-08-11T10:07:43.655Z",
		)).toEqual([
			{
				id: "sse-user-response-1",
				turnId: "fe-root-turn-1",
				role: "user",
				content: "给出视频时长",
				ts: "2026-08-11T10:07:43.655Z",
				source: "agents",
				languageModel: "deepseek-v4-flash",
			},
			{
				id: "sse-asst-response-1",
				turnId: "fe-root-turn-1",
				role: "assistant",
				content: "建议 180 秒",
				ts: "2026-08-11T10:07:43.655Z",
				source: "agents",
			},
		]);
	});

	it("fails explicitly when a projected chat turn has no model fact", () => {
		expect(() => resolveChatTurnLanguageModelFact(
			{ prompt: "继续" },
			{ id: "task-1", vendor: "agents", text: "完成" },
		)).toThrowError("聊天消息投影缺少本轮语言模型事实");
	});
});

describe("public agents chat required Skill propagation", () => {
	it("derives the same opaque public turn for the same user, session and client id", () => {
		const first = buildStablePublicChatTurnId({
			userId: "user-1",
			sessionKey: "session-1",
			clientPendingId: "pending-1",
		});
		expect(buildStablePublicChatTurnId({
			userId: "user-1",
			sessionKey: "session-1",
			clientPendingId: "pending-1",
		})).toBe(first);
		expect(buildStablePublicChatTurnId({
			userId: "user-1",
			sessionKey: "session-2",
			clientPendingId: "pending-1",
		})).not.toBe(first);
		expect(first).toMatch(/^public-chat-turn:[a-f0-9]{64}$/);
	});

	it("preserves the client pending correlation identity without treating it as the public turn id", () => {
		const publicRequest = AgentsChatRequestSchema.parse({
			prompt: "执行当前任务",
			modelKey: "gpt-5.6-terra",
			clientPendingId: "m_ai_pending_1786157917837",
		});

		const taskRequest = buildTaskRequest(publicRequest);

		expect(taskRequest.extras?.clientPendingId).toBe("m_ai_pending_1786157917837");
	});

	it("preserves requiredSkills and the restricted tool policy across public schema parsing and task request projection", () => {
		const publicRequest = AgentsChatRequestSchema.parse({
			prompt: "使用分镜专家整理视频事实",
			modelKey: "gpt-5.6-terra",
			requiredSkills: ["tapcanvas-storyboard-expert"],
			executionToolPolicy: {
				mode: "restricted",
				allowedTools: ["read_file", "read_file_range", "tapcanvas_shot_table_critic"],
			},
		});

		const taskRequest = buildTaskRequest(publicRequest);

		expect(taskRequest.extras?.requiredSkills).toEqual(["tapcanvas-storyboard-expert"]);
		expect(taskRequest.extras?.executionToolPolicy).toEqual({
			mode: "restricted",
			allowedTools: ["read_file", "read_file_range", "tapcanvas_shot_table_critic"],
		});
	});
});
