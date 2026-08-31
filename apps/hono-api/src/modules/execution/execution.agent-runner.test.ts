import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../middleware/error";
import type { AppContext, WorkerEnv } from "../../types";

const { buildTaskRequest, runPersistedAgentsChatTask } = vi.hoisted(() => ({
	buildTaskRequest: vi.fn((input: Record<string, unknown>) => ({
		kind: "chat",
		prompt: input.prompt,
		extras: {
			modelKey: input.modelKey,
			sessionKey: input.sessionKey,
			canvasFlowId: input.canvasFlowId,
			canvasProjectId: input.canvasProjectId,
			canvasNodeId: input.canvasNodeId,
			requiredSkills: input.requiredSkills,
			mountedKnowledgeCardIds: input.mountedKnowledgeCardIds,
			executionToolPolicy: input.executionToolPolicy,
			disabledSkills: input.disabledSkills,
			disabledKnowledgeCardIds: input.disabledKnowledgeCardIds,
			forcedAgentRole: input.forcedAgentRole,
			allowedSubagentTypes: input.allowedSubagentTypes,
			response_format: input.response_format,
		},
	})),
	runPersistedAgentsChatTask: vi.fn(),
}));
const { getAgentsChatTurnStatus } = vi.hoisted(() => ({
	getAgentsChatTurnStatus: vi.fn(),
}));
const { resumePersistedAgentsChatTurn } = vi.hoisted(() => ({
	resumePersistedAgentsChatTurn: vi.fn(),
}));
const { cancelWorkflowAgentTurns } = vi.hoisted(() => ({
	cancelWorkflowAgentTurns: vi.fn(),
}));
const { getExecutionTraceLifecycleSnapshot } = vi.hoisted(() => ({
	getExecutionTraceLifecycleSnapshot: vi.fn(),
}));

vi.mock("../task/task.agents-chat-runtime", () => ({ getAgentsChatTurnStatus }));
vi.mock("../task/public-agents-chat", () => ({
	buildTaskRequest,
	resolveInactiveChatTurnRecoveryKind: (turn: {
		state: string;
		phase: string;
		reasonCode: string | null;
	}) => {
		if (turn.state === "suspended") {
			return turn.reasonCode === "provider_stream_interrupted"
				? "orphaned_checkpoint"
				: "physical_budget";
		}
		if (
			(turn.state === "unknown" || turn.state === "failed") &&
			(
				turn.reasonCode === "provider_stream_interrupted" ||
				turn.phase === "accepted" ||
				turn.phase === "agent_running" ||
				turn.phase === "completion_verifying"
			)
		) return "orphaned_checkpoint";
		return null;
	},
	resumePersistedAgentsChatTurn,
	runPersistedAgentsChatTask,
}));
vi.mock("./execution.agent-cancellation", () => ({ cancelWorkflowAgentTurns }));
vi.mock("../memory/execution-trace-events.repo", () => ({ getExecutionTraceLifecycleSnapshot }));

import {
	isRecoverableWorkflowAgentInterruption,
	runWorkflowAgentNode,
} from "./execution.agent-runner";
import { workflowAgentPublicTurnId } from "./execution.agent-identity";

const request = {
	executionId: "execution-1",
	executionFamilyId: "execution-family-1",
	nodeId: "agent-1",
	ownerId: "user-1",
	flowId: "flow-1",
	projectId: "project-1",
	workflowKey: "agent-workflow/v1",
	instruction: "生成完整产物",
	outputArtifactType: "tapcanvas.text/v1",
	outputEncoding: "plain_text" as const,
	deliveryRequirement: "交付完整文本",
	modelKey: "model-1",
	maxOutputTokens: 4096,
	inputs: { input: ["source"] },
	requiredSkills: [],
	mountedKnowledgeCardIds: ["knowledge-card-mounted"],
	disabledSkills: ["disabled-skill"],
	disabledKnowledgeCardIds: ["knowledge-card-disabled"],
	allowedTools: [],
	forcedAgentRole: "writer",
	resumeOnly: false,
	previousEvidence: null,
};

const recentIso = (ageMs = 1_000): string => new Date(Date.now() - ageMs).toISOString();

describe("workflow Agent runner durable interruption contract", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getExecutionTraceLifecycleSnapshot.mockResolvedValue(null);
		cancelWorkflowAgentTurns.mockResolvedValue([{
			target: {
				sessionId: "workflow:execution-1:agent-1",
				turnId: "workflow:execution-1:agent-1",
				nodeId: "agent-1",
				runtimeNodeId: "agent-1",
			},
			status: "already_inactive",
			receipt: {
				localTransport: "not_running",
				runtime: "already_inactive",
				continuations: "none",
			},
			errorCode: null,
			errorMessage: null,
		}]);
	});

	it("publishes the one-submission policy as a first-class runtime contract", async () => {
		const expectedTurnId = workflowAgentPublicTurnId({
			executionId: request.executionId,
			nodeId: request.nodeId,
			physicalRetryOrdinal: null,
		});
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: expectedTurnId,
				assets: [],
					raw: {
						text: "一次完整产物",
						meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { items: [{ evidenceId: "e-first-submission" }] },
						deliveryVerification: { status: "satisfied" },
							requestTerminal: { status: "succeeded" },
							runtime: {
								promptExampleCandidateSearch: {
									version: 1,
									status: "no_match",
									mediaType: "video",
									attempted: true,
									remoteAttempted: true,
									candidateCount: 0,
									blocking: false,
									rationale: "同媒体案例检索零命中。",
									toolCallId: "prompt-search-1",
								},
							},
						},
					},
			},
			response: {},
		});

		const result = await runWorkflowAgentNode({} as WorkerEnv, request);
		expect(result.promptExampleCandidateSearch).toMatchObject({
			status: "no_match",
			attempted: true,
			candidateCount: 0,
			toolCallId: "prompt-search-1",
		});

		const call = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
			rootRequestId: string;
			taskRequest: { extras?: Record<string, unknown> };
		};
		expect(call.rootRequestId).toBe(expectedTurnId);
		expect(call.taskRequest.extras?.publicTurnId).toBe(expectedTurnId);
		expect(call.taskRequest.extras?.logicalTaskId).toBe(expectedTurnId);
		expect(call.taskRequest.extras?.sessionKey).toBe(expectedTurnId);
		expect(call.taskRequest.extras?.structuredOutputSubmissionPolicy)
			.toBe("single_submission_record_and_fail");
		expect(call.taskRequest.extras?.continuationExecutionContract).toMatchObject({
			structuredOutputSubmissionPolicy: "single_submission_record_and_fail",
		});
		expect((runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
			taskRequest: { prompt: string };
		}).taskRequest.prompt).toContain("模型只提交一次完整首稿");
	});

	it("propagates a dynamic pre-provider physical attempt deadline to agents-cli", async () => {
		const nowMs = Date.parse("2026-08-29T05:01:00.000Z");
		const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: "完整产物",
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { items: [{ evidenceId: "e-deadline" }] },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		try {
			await runWorkflowAgentNode({} as WorkerEnv, {
				...request,
				productionStartDeadline: {
					version: 2,
					kind: "video_provider_receipt",
					source: "public_chat",
					anchor: "workflow_execution_created",
					publicTurnId: "public-turn-1",
					acceptedAt: "2026-08-29T05:00:00.000Z",
					deadlineAt: "2026-08-29T05:05:00.000Z",
					targetExecutorRef: "tapcanvas.video.generate/v1",
					controlledNodeIds: ["agent-1"],
				},
			});
		} finally {
			dateNow.mockRestore();
		}

		const call = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
			taskRequest?: { extras?: Record<string, unknown> };
		} | undefined;
		expect(call?.taskRequest?.extras?.workflowPhysicalAttemptDeadlineAt)
			.toBe("2026-08-29T05:05:00.000Z");
		expect(call?.taskRequest?.extras?.continuationExecutionContract).toMatchObject({
			workflowPhysicalAttemptDeadlineAt: "2026-08-29T05:05:00.000Z",
		});
	});

	it("polls the same active durable turn without starting a second chat", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: true,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-1",
				state: "running",
				phase: "agent_running",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:01.000Z",
				lastConfirmedAt: "2026-08-12T00:00:01.000Z",
				requestText: "",
				reasonCode: null,
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "Agent 正在执行当前任务",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: { transportInterrupted: true },
		})).resolves.toMatchObject({
			taskId: "workflow:execution-1:agent-1",
			text: "",
			deliveryEvidence: {
				source: "agents_cli_durable_turn_status",
				state: "running",
			},
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_turn_still_running",
			},
		});
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("moves an inactive accepted checkpoint to a new physical attempt after the bridge restarts", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-orphaned",
				state: "unknown",
				phase: "accepted",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:01.000Z",
				lastConfirmedAt: "2026-08-12T00:00:01.000Z",
				requestText: "",
				reasonCode: null,
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "Agent 请求已受理",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockRejectedValueOnce(new AppError(
			"continuation is not ready",
			{ status: 409, code: "chat_resume_continuation_not_ready" },
		));

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: { transportInterrupted: true },
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_physical_retry_pending",
			},
			deliveryEvidence: {
				source: "agents_cli_durable_turn_status",
				state: "unknown",
				phase: "accepted",
				retryablePhysicalFailure: true,
				physicalFailureReason: "workflow_agent_orphaned_checkpoint",
				physicalRetryOrdinal: 1,
			},
		});
		expect(resumePersistedAgentsChatTurn).toHaveBeenCalledWith(expect.objectContaining({
			userId: "user-1",
			sessionKey: "workflow:execution-1:agent-1",
			turnId: "workflow:execution-1:agent-1",
		}));
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("waits through the fresh durable-admission handoff before orphan recovery", async () => {
		const admittedAt = new Date().toISOString();
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-fresh-admission",
				state: "unknown",
				phase: "accepted",
				startedAt: admittedAt,
				updatedAt: admittedAt,
				lastConfirmedAt: admittedAt,
				requestText: "",
				reasonCode: null,
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "Agent 请求刚刚受理",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: { transportInterrupted: true },
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_accepted_turn_activation_pending",
			},
			deliveryEvidence: {
				source: "agents_cli_durable_turn_status",
				state: "unknown",
				phase: "accepted",
			},
		});
		expect(resumePersistedAgentsChatTurn).not.toHaveBeenCalled();
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("counts each orphaned physical generation once in the generic no-progress window", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1:physical-retry:2",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1:physical-retry:2",
				internalTurnId: "turn-orphaned-2",
				state: "unknown",
				phase: "accepted",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:01.000Z",
				lastConfirmedAt: "2026-08-12T00:00:01.000Z",
				requestText: "",
				reasonCode: null,
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "Agent 请求已受理",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockRejectedValueOnce(new AppError(
			"continuation is not ready",
			{ status: 409, code: "chat_resume_continuation_not_ready" },
		));

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: {
					physicalRetryOrdinal: 2,
					recoveryWindow: {
						progressRevision: 0,
						physicalRunId: "workflow:execution-1:agent-1:physical-retry:1",
						windowsWithoutProgress: 2,
						limit: 5,
					},
				},
			},
		})).resolves.toMatchObject({
			deliveryEvidence: {
				physicalRetryOrdinal: 3,
				recoveryWindow: {
					progressRevision: 0,
					physicalRunId: "workflow:execution-1:agent-1:physical-retry:2",
					windowsWithoutProgress: 3,
					limit: 5,
				},
			},
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_physical_retry_pending",
			},
		});
	});

	it("keeps waiting when another reconciler resumes an inactive accepted checkpoint first", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-orphaned-race",
				state: "unknown",
				phase: "accepted",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:01.000Z",
				lastConfirmedAt: "2026-08-12T00:00:01.000Z",
				requestText: "",
				reasonCode: null,
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "Agent 请求已受理",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockRejectedValueOnce(new AppError(
			"turn is already active",
			{ status: 409, code: "chat_resume_turn_active" },
		));

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: { transportInterrupted: true },
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_orphaned_turn_continuation_scheduled",
			},
			deliveryEvidence: {
				source: "agents_cli_durable_turn_status",
				state: "unknown",
				phase: "accepted",
			},
		});
		expect(resumePersistedAgentsChatTurn).toHaveBeenCalledTimes(1);
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("closes interactive tools for an initial typed output node", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: "{\"items\":[]}",
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { version: 1 },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			outputArtifactType: "tapcanvas.test/v1",
			outputEncoding: "json_object",
			jsonObjectContract: {
				requiredArrayFields: ["items"],
				allowedFields: ["items"],
			},
		});

		const call = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
			requestInput?: Record<string, unknown>;
		} | undefined;
		expect(call?.requestInput?.requiredSkills).toBeUndefined();
		expect(call?.requestInput?.executionToolPolicy).toEqual({ mode: "restricted", allowedTools: [] });
	});

	it("preloads frozen Workflow Skill dependencies while preserving bounded discovery tools", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: "{\"items\":[]}",
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { version: 1 },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			outputArtifactType: "tapcanvas.clip-prompts/v2",
			outputEncoding: "json_object",
			jsonObjectContract: {
				requiredArrayFields: ["items"],
				allowedFields: ["items"],
			},
			requiredSkills: ["tapcanvas-video-prompt-writer"],
			allowedTools: ["skill_search", "Skill", "knowledge_search", "knowledge_read"],
		});

		const call = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
			requestInput?: Record<string, unknown>;
			taskRequest?: { prompt?: string };
		} | undefined;
		expect(call?.requestInput?.requiredSkills).toEqual(["tapcanvas-video-prompt-writer"]);
		expect(call?.requestInput?.executionToolPolicy).toEqual({
			mode: "restricted",
			allowedTools: ["skill_search", "Skill", "knowledge_search", "knowledge_read"],
		});
		expect(call?.taskRequest?.prompt).toContain("冻结 Workflow Skill 依赖已经预载");
		expect(call?.taskRequest?.prompt).toContain("禁止调用 skill_search 重新发现或替换这些依赖");
		expect(call?.taskRequest?.prompt).toContain("shots[].durationSeconds 是最终可执行秒数，不是相对权重");
		expect(call?.taskRequest?.prompt).toContain("事件在 16 秒结束、镜头从 16 秒开始时，该镜绝不能继续声明该事件");
		expect(call?.taskRequest?.prompt).toContain("runtime 不缩放镜头时长、不重映射事件索引，也不回灌修订");
	});

	it("preserves the recovery window while the scheduled physical continuation is running", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: true,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-continuation",
				state: "running",
				phase: "agent_running",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:03.000Z",
				lastConfirmedAt: "2026-08-12T00:00:03.000Z",
				requestText: "",
				reasonCode: null,
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "Agent 正在续跑当前任务",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: {
					recoveryWindow: {
						progressRevision: 0,
						physicalRunId: "physical-1",
						windowsWithoutProgress: 1,
						limit: 5,
					},
				},
			},
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_turn_still_running",
			},
			deliveryEvidence: {
				recoveryWindow: {
					progressRevision: 0,
					physicalRunId: "physical-1",
					windowsWithoutProgress: 1,
					limit: 5,
				},
			},
		});
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("defers a fresh physical generation after five recovery windows without durable progress", async () => {
		resumePersistedAgentsChatTurn.mockClear();
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-3",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:06.000Z",
				lastConfirmedAt: "2026-08-12T00:00:06.000Z",
				requestText: "",
				reasonCode: "provider_stream_interrupted",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "provider_stream_interrupted",
					physicalRunId: "physical-3",
					progressRevision: 0,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "供应商响应流中断",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: {
					recoveryWindow: {
						progressRevision: 0,
						physicalRunId: "physical-2",
						windowsWithoutProgress: 4,
						limit: 5,
					},
				},
			},
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_no_progress_recovery_deferred",
			},
			deliveryEvidence: {
				retryablePhysicalFailure: true,
				physicalFailureReason: "workflow_agent_no_progress_window_exhausted",
				physicalRetryOrdinal: 1,
				noProgressRecoveryEpoch: 1,
				retryNotBeforeAt: expect.any(String),
				recoveryWindow: {
					progressRevision: 0,
					physicalRunId: "workflow:execution-1:agent-1:physical-retry:1",
					windowsWithoutProgress: 0,
					limit: 5,
				},
			},
		});
		expect(resumePersistedAgentsChatTurn).not.toHaveBeenCalled();
	});

	it("starts a distinct physical retry when the same suspended run has no continuation owner", async () => {
		resumePersistedAgentsChatTurn.mockClear();
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-pending",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:06.000Z",
				lastConfirmedAt: "2026-08-12T00:00:06.000Z",
				requestText: "",
				reasonCode: "provider_stream_interrupted",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "provider_stream_interrupted",
					physicalRunId: "physical-pending",
					progressRevision: 0,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "供应商响应流中断",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockRejectedValueOnce(new AppError(
			"continuation is not ready",
			{ status: 409, code: "chat_resume_continuation_not_ready" },
		));

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: {
					recoveryWindow: {
						progressRevision: 0,
						physicalRunId: "physical-pending",
						windowsWithoutProgress: 2,
						limit: 5,
					},
				},
			},
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_physical_retry_pending",
			},
			deliveryEvidence: {
				retryablePhysicalFailure: true,
				physicalFailureReason: "provider_stream_interrupted",
				physicalRetryOrdinal: 1,
				recoveryWindow: {
					progressRevision: 0,
					physicalRunId: "physical-pending",
					windowsWithoutProgress: 2,
					limit: 5,
				},
			},
		});
		expect(resumePersistedAgentsChatTurn).toHaveBeenCalledTimes(1);
	});

	it("keeps provider balance as external wait without resuming or consuming physical retries", async () => {
		resumePersistedAgentsChatTurn.mockClear();
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-provider-balance",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-22T13:00:00.000Z",
				updatedAt: "2026-08-22T13:00:01.000Z",
				lastConfirmedAt: "2026-08-22T13:00:01.000Z",
				requestText: "",
				reasonCode: "provider_balance_required",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "provider_balance_required",
					physicalRunId: "physical-provider-balance",
					progressRevision: 7,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "模型渠道余额不足，任务已进入持久等待",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: {
					previousExternalWait: true,
					recoveryWindow: {
						progressRevision: 7,
						physicalRunId: "physical-before-provider-balance",
						windowsWithoutProgress: 4,
						limit: 5,
					},
				},
			},
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "provider_balance_required",
			},
			deliveryEvidence: {
				state: "suspended",
				phase: "suspended",
				recoveryCheckpoint: {
					reasonCode: "provider_balance_required",
					physicalRunId: "physical-provider-balance",
					progressRevision: 7,
				},
				recoveryWindow: {
					windowsWithoutProgress: 4,
					limit: 5,
				},
			},
		});
		expect(resumePersistedAgentsChatTurn).not.toHaveBeenCalled();
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("preserves the advanced durable checkpoint while scheduling a distinct physical retry", async () => {
		resumePersistedAgentsChatTurn.mockClear();
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-progressed",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:06.000Z",
				lastConfirmedAt: "2026-08-12T00:00:06.000Z",
				requestText: "",
				reasonCode: "root_physical_execution_budget_exhausted",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "root_physical_execution_budget_exhausted",
					physicalRunId: "physical-progressed",
					progressRevision: 1,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "物理执行窗口已结束",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockRejectedValueOnce(new AppError(
			"continuation is not ready",
			{ status: 409, code: "chat_resume_continuation_not_ready" },
		));

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: {
					recoveryWindow: {
						progressRevision: 0,
						physicalRunId: "physical-before-progress",
						windowsWithoutProgress: 2,
						limit: 5,
					},
				},
			},
		})).resolves.toMatchObject({
			deliveryEvidence: {
				recoveryCheckpoint: {
					physicalRunId: "physical-progressed",
					progressRevision: 1,
				},
				retryablePhysicalFailure: true,
				physicalRetryOrdinal: 1,
			},
		});
		expect(resumePersistedAgentsChatTurn).toHaveBeenCalledTimes(1);
	});

	it("recovers the persisted response without bypassing the caller's typed-output verifier", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-1",
				state: "succeeded",
				phase: "succeeded",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:02.000Z",
				lastConfirmedAt: "2026-08-12T00:00:02.000Z",
				requestText: "",
				reasonCode: null,
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "当前回合已完成",
				finalResponse: "完整产物",
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: { transportInterrupted: true },
		})).resolves.toMatchObject({
			taskId: "workflow:execution-1:agent-1",
			text: "完整产物",
			deliveryVerification: null,
			requestTerminal: {
				status: "succeeded",
				reason: "agents_cli_durable_turn_succeeded",
			},
		});
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("schedules the persisted continuation for a physical-budget suspension", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-1",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:02.000Z",
				lastConfirmedAt: "2026-08-12T00:00:02.000Z",
				requestText: "",
				reasonCode: "root_physical_execution_budget_exhausted",
				suspension: {
					physicalRunId: "physical-1",
					progressRevision: 3,
				},
				recoveryCheckpoint: {
					reasonCode: "root_physical_execution_budget_exhausted",
					physicalRunId: "physical-1",
					progressRevision: 3,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "物理执行窗口已结束",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockResolvedValueOnce({
			ok: true,
			resumed: true,
			sessionKey: "workflow:execution-1:agent-1",
			turnId: "workflow:execution-1:agent-1",
			continuationId: "continuation-1",
			stage: 2,
			resumeTrigger: "physical_budget",
			recoveryKind: "physical_budget",
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: { state: "suspended" },
		})).resolves.toMatchObject({
			taskId: "workflow:execution-1:agent-1",
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_same_task_continuation_scheduled",
			},
			deliveryEvidence: {
				recoveryCheckpoint: {
					reasonCode: "root_physical_execution_budget_exhausted",
					physicalRunId: "physical-1",
					progressRevision: 3,
					durableTaskReferenceCount: 0,
					durableProgressClaimCount: 0,
				},
			},
		});
		expect(resumePersistedAgentsChatTurn).toHaveBeenCalledWith(expect.objectContaining({
			userId: "user-1",
			sessionKey: "workflow:execution-1:agent-1",
			turnId: "workflow:execution-1:agent-1",
		}));
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("keeps waiting when another reconciler resumes a suspended checkpoint first", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-suspended-race",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:02.000Z",
				lastConfirmedAt: "2026-08-12T00:00:02.000Z",
				requestText: "",
				reasonCode: "root_physical_execution_budget_exhausted",
				suspension: {
					physicalRunId: "physical-race",
					progressRevision: 3,
				},
				recoveryCheckpoint: {
					reasonCode: "root_physical_execution_budget_exhausted",
					physicalRunId: "physical-race",
					progressRevision: 3,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "物理执行窗口已结束",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockRejectedValueOnce(new AppError(
			"turn is already active",
			{ status: 409, code: "chat_resume_turn_active" },
		));

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: { state: "suspended" },
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_same_task_continuation_scheduled",
			},
			deliveryEvidence: {
				recoveryCheckpoint: {
					physicalRunId: "physical-race",
					progressRevision: 3,
				},
			},
		});
		expect(resumePersistedAgentsChatTurn).toHaveBeenCalledTimes(1);
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("schedules a persisted physical continuation from its durable checkpoint", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-physical-continuation-1",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:02.000Z",
				lastConfirmedAt: "2026-08-12T00:00:02.000Z",
				requestText: "",
				reasonCode: "max_turns",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "max_turns",
					physicalRunId: "physical-continuation-1",
					progressRevision: 0,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "正在继续同一物理执行",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockResolvedValueOnce({
			ok: true,
			resumed: true,
			sessionKey: "workflow:execution-1:agent-1",
			turnId: "workflow:execution-1:agent-1",
			continuationId: "continuation-physical-1",
			stage: 2,
			resumeTrigger: "physical_budget",
			recoveryKind: "physical_budget",
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: { state: "suspended" },
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_same_task_continuation_scheduled",
			},
			deliveryEvidence: {
				recoveryCheckpoint: {
					reasonCode: "max_turns",
					physicalRunId: "physical-continuation-1",
					progressRevision: 0,
				},
			},
		});
		expect(resumePersistedAgentsChatTurn).toHaveBeenCalledWith(expect.objectContaining({
			userId: "user-1",
			sessionKey: "workflow:execution-1:agent-1",
			turnId: "workflow:execution-1:agent-1",
		}));
	});

	it("schedules the same persisted continuation after a provider stream interruption", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-1",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:02.000Z",
				lastConfirmedAt: "2026-08-12T00:00:02.000Z",
				requestText: "",
				reasonCode: "provider_stream_interrupted",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "provider_stream_interrupted",
					physicalRunId: "physical-provider-1",
					progressRevision: 0,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "供应商响应流中断",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockResolvedValueOnce({
			ok: true,
			resumed: true,
			sessionKey: "workflow:execution-1:agent-1",
			turnId: "workflow:execution-1:agent-1",
			continuationId: "continuation-provider-1",
			stage: 2,
			resumeTrigger: "provider_stream_interrupted",
			recoveryKind: "provider_stream_interrupted",
		});

		const result = await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				previousWorkflowEvidence: {
					previousWorkflowEvidence: { state: "must-not-be-copied" },
				},
			},
		});
		expect(result).toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_same_task_continuation_scheduled",
			},
			deliveryEvidence: {
				recoveryCheckpoint: {
					reasonCode: "provider_stream_interrupted",
					physicalRunId: "physical-provider-1",
					progressRevision: 0,
				},
			},
		});
		expect(result.deliveryEvidence).not.toHaveProperty("previousWorkflowEvidence");
		expect(resumePersistedAgentsChatTurn).toHaveBeenLastCalledWith(expect.objectContaining({
			userId: "user-1",
			sessionKey: "workflow:execution-1:agent-1",
			turnId: "workflow:execution-1:agent-1",
		}));
	});

	it("starts a bounded fresh physical run when provider interruption has no checkpoint", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-orphaned-provider",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:02.000Z",
				lastConfirmedAt: "2026-08-12T00:00:02.000Z",
				requestText: "",
				reasonCode: "provider_stream_interrupted",
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "供应商连接在首个持久 checkpoint 前中断",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: null,
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_physical_retry_pending",
			},
			deliveryEvidence: {
				retryablePhysicalFailure: true,
				physicalFailureReason: "provider_stream_interrupted",
				physicalRetryOrdinal: 1,
			},
		});
		expect(resumePersistedAgentsChatTurn).not.toHaveBeenCalled();
	});

	it("returns one recorded structured-output candidate without correction or regeneration", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-structured-1",
				state: "failed",
				phase: "failed",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:02.000Z",
				lastConfirmedAt: "2026-08-12T00:00:02.000Z",
				requestText: "",
				reasonCode: "structured_output_invalid",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "structured_output_invalid",
					physicalRunId: "physical-structured-1",
					progressRevision: 0,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "结构化输出未满足",
				finalResponse: '{"invalidCandidate":true}',
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			outputEncoding: "json_object",
			resumeOnly: true,
			previousEvidence: null,
		})).resolves.toMatchObject({
			taskId: "workflow:execution-1:agent-1",
			text: '{"invalidCandidate":true}',
			deliveryEvidence: {
				physicalActionTerminal: "structured_output_invalid",
			},
			requestTerminal: {
				status: "succeeded",
				reason: "agents_cli_single_submission_recorded",
			},
		});
		expect(resumePersistedAgentsChatTurn).not.toHaveBeenCalled();
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("moves a physical-budget suspension to a new physical attempt when no continuation is claimable", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-1",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:02.000Z",
				lastConfirmedAt: "2026-08-12T00:00:02.000Z",
				requestText: "",
				reasonCode: "root_physical_execution_budget_exhausted",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "root_physical_execution_budget_exhausted",
					physicalRunId: "physical-pending-1",
					progressRevision: 4,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "物理执行窗口已结束",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockRejectedValueOnce(new AppError(
			"continuation is not ready",
			{ status: 409, code: "chat_resume_continuation_not_ready" },
		));

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_physical_retry_pending",
			},
			deliveryEvidence: {
				retryablePhysicalFailure: true,
				physicalFailureReason: "root_physical_execution_budget_exhausted",
				physicalRetryOrdinal: 1,
			},
		});
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("performs no model or fence call before a persisted 429 quiet window is due", async () => {
		const retryNotBeforeAt = new Date(Date.now() + 60_000).toISOString();
		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: {
					version: 1,
					source: "workflow_agent_rate_limit_backpressure",
					retryablePhysicalFailure: true,
					physicalFailureReason: "llm_http_429",
					physicalRetryOrdinal: 1,
					rateLimitDeferralCount: 1,
					retryAfterMs: 65_000,
					retryNotBeforeAt,
				},
			},
		})).resolves.toMatchObject({
			taskId: "workflow:execution-1:agent-1:physical-retry:1",
			deliveryEvidence: {
				physicalFailureReason: "llm_http_429",
				retryNotBeforeAt,
			},
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_rate_limit_backpressure",
			},
		});
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
		expect(cancelWorkflowAgentTurns).not.toHaveBeenCalled();
		expect(getAgentsChatTurnStatus).not.toHaveBeenCalled();
	});

	it("performs no model or fence call before a deferred no-progress generation is due", async () => {
		const retryNotBeforeAt = new Date(Date.now() + 60_000).toISOString();
		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: {
					version: 1,
					source: "agents_cli_durable_turn_status",
					retryablePhysicalFailure: true,
					physicalFailureReason: "workflow_agent_no_progress_window_exhausted",
					physicalRetryOrdinal: 5,
					noProgressRecoveryEpoch: 1,
					retryAfterMs: 60_000,
					retryNotBeforeAt,
					recoveryWindow: {
						progressRevision: 0,
						physicalRunId: "workflow:execution-1:agent-1:physical-retry:5",
						windowsWithoutProgress: 0,
						limit: 5,
					},
				},
			},
		})).resolves.toMatchObject({
			taskId: "workflow:execution-1:agent-1:physical-retry:5",
			deliveryEvidence: {
				physicalFailureReason: "workflow_agent_no_progress_window_exhausted",
				retryNotBeforeAt,
			},
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_no_progress_recovery_deferred",
			},
		});
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
		expect(cancelWorkflowAgentTurns).not.toHaveBeenCalled();
		expect(getAgentsChatTurnStatus).not.toHaveBeenCalled();
	});

	it("keeps the logical node suspended when the previous generation fence is not yet confirmed", async () => {
		cancelWorkflowAgentTurns.mockResolvedValueOnce([{
			target: {
				sessionId: "workflow:execution-1:agent-1:physical-retry:1",
				turnId: "workflow:execution-1:agent-1:physical-retry:1",
				nodeId: "agent-1",
				runtimeNodeId: "agent-1",
			},
			status: "failed",
			receipt: null,
			errorCode: "runtime_interrupt_unknown",
			errorMessage: "runtime did not confirm interruption",
		}]);

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: {
					retryablePhysicalFailure: true,
					physicalFailureReason: "provider_stream_interrupted",
					physicalRetryOrdinal: 2,
				},
			},
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_physical_generation_fence_pending",
			},
			deliveryEvidence: {
				retryablePhysicalFailure: true,
				physicalFailureReason: "provider_stream_interrupted",
				physicalRetryOrdinal: 2,
				generationFencePending: true,
				previousPublicTurnId: "workflow:execution-1:agent-1:physical-retry:1",
				currentPublicTurnId: "workflow:execution-1:agent-1:physical-retry:2",
				fenceErrorCode: "runtime_interrupt_unknown",
			},
		});
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("forwards an explicit json_object prompt-package contract to agents-cli", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: JSON.stringify({ prompt: "动态提示词", negativePrompt: "动态负向词" }),
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { items: [{ evidenceId: "e-image-prompt" }] },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			outputEncoding: "json_object",
			outputArtifactType: "tapcanvas.image-prompt-package/v1",
			jsonObjectContract: {
				requiredStringFields: ["prompt", "negativePrompt", "sourceFingerprint"],
				exactStringFields: { sourceFingerprint: "fingerprint-1" },
				allowedFields: ["prompt", "negativePrompt", "sourceFingerprint"],
			},
		});

		expect(runPersistedAgentsChatTask).toHaveBeenLastCalledWith(
			expect.objectContaining({
				taskRequest: expect.objectContaining({
						extras: expect.objectContaining({
							outputContract: expect.objectContaining({
								requiredStringFields: ["prompt", "negativePrompt", "sourceFingerprint"],
								exactStringFields: { sourceFingerprint: "fingerprint-1" },
								allowedFields: ["prompt", "negativePrompt", "sourceFingerprint"],
						}),
						responseFormat: { type: "json_object" },
					}),
				}),
			}),
		);
	});

	it("enables provider JSON Output without imposing a fixed BeatSheet clip topology", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: JSON.stringify({
						protocolVersion: "2",
						filmBible: { title: "短片" },
						beats: [{ clipId: "clip-001" }],
					}),
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { items: [{ evidenceId: "e-object" }] },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			inputs: {
				"delivery-contract": [{
					targetDurationSeconds: 40,
					generationContract: {
						videoModel: "doubao-seedance-2.5",
						durationOptions: Array.from({ length: 27 }, (_, index) => index + 4),
						maxDurationSeconds: 30,
						clipPlanningPolicy: "agent_semantic_duration_budget",
					},
				}],
			},
			outputEncoding: "json_object",
			outputArtifactType: "tapcanvas.beat-sheet/v2",
			jsonObjectContract: {
				requiredStringFields: ["protocolVersion"],
				requiredObjectFields: ["filmBible"],
				requiredArrayFields: ["beats"],
				allowedFields: ["protocolVersion", "filmBible", "beats"],
			},
		});

		expect(runPersistedAgentsChatTask).toHaveBeenLastCalledWith(
			expect.objectContaining({
				taskRequest: expect.objectContaining({
					extras: expect.objectContaining({
						outputContract: expect.objectContaining({
							requiredStringFields: ["protocolVersion"],
							requiredObjectFields: ["filmBible"],
							requiredArrayFields: ["beats"],
							allowedFields: ["protocolVersion", "filmBible", "beats"],
						}),
						responseFormat: { type: "json_object" },
						continuationExecutionContract: expect.objectContaining({
							outputContract: expect.objectContaining({
								requiredObjectFields: ["filmBible"],
								requiredArrayFields: ["beats"],
							}),
							responseFormat: { type: "json_object" },
						}),
					}),
				}),
			}),
		);
	});

	it("gives BeatSheet every ready project image while keeping explicit selections mandatory", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: JSON.stringify({
						protocolVersion: "tapcanvas.beat-sheet/v2",
						objectRegistry: [{
							objectId: "char-zhangsan",
							referenceAssetIds: ["asset-zhangsan"],
						}],
						beats: [{ clipIndex: 0 }],
					}),
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { items: [{ evidenceId: "e-selected-asset" }] },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			outputEncoding: "json_object",
			outputArtifactType: "tapcanvas.beat-sheet/v2",
			jsonObjectContract: {
				requiredStringFields: ["protocolVersion"],
				requiredArrayFields: ["objectRegistry", "beats"],
				allowedFields: ["protocolVersion", "objectRegistry", "beats"],
			},
			projectContext: {
				version: 3,
				projectId: "project-1",
				canvasId: "chapter:chapter-1",
				sourceNodeId: "chapter-seed-1",
				selectedAssetIds: ["asset-zhangsan"],
				projectAssetIds: ["asset-zhangsan", "asset-qin-courtyard"],
				timeline: { clips: [] },
				selection: {
					nodeIds: ["node-zhangsan"],
					assetIds: ["asset-zhangsan"],
					activeNodeId: "node-zhangsan",
					groupId: null,
				},
				permissions: {
					principalId: "user-1",
					projectRead: true,
					canvasRead: true,
					assetRead: true,
					assetWrite: true,
				},
				assetSnapshot: [{
					assetId: "asset-zhangsan",
					assetVersion: 1,
					assetVersionId: "asset-zhangsan:v1",
					contentFingerprint: "sha256:zhangsan",
					projectId: "project-1",
					name: "张三游魂角色设定图",
					canonicalName: "张三",
					kind: "character",
					referenceType: "character",
					approvalStatus: "approved",
					origin: "material",
					flowId: "chapter-1",
					nodeId: "node-zhangsan",
					mediaKind: "image",
					state: "ready",
					assetUsage: "production",
					assetPurpose: null,
					productionEligible: true,
					productionExclusionReason: null,
					sourceFacts: {
						referenceType: "character",
						roleName: "张三",
						physicalIdentityKey: "spirit-zhangsan",
						characterAssetRole: "identity",
						characterProfileVersion: "character-card/v3",
						identityAnchors: ["三十多岁男性游魂"],
						prohibitedDrift: ["不得替换为秦小龙肉身"],
						sourceNodeId: "node-zhangsan",
						workflowExecutionId: "source-execution-1",
						taskId: "image-task-1",
						prompt: "三十多岁中国男性游魂角色设定图",
					},
					updatedAt: "2026-08-30T07:00:00.000Z",
				}, {
					assetId: "asset-qin-courtyard",
					assetVersion: 2,
					assetVersionId: "asset-qin-courtyard:v2",
					contentFingerprint: "sha256:qin-courtyard",
					projectId: "project-1",
					name: "第一章秦家院落与柴房",
					canonicalName: "qin-family-courtyard",
					kind: "scene",
					referenceType: "scene",
					approvalStatus: "approved",
					origin: "project_node",
					flowId: "chapter-1",
					nodeId: "node-qin-courtyard",
					mediaKind: "image",
					state: "ready",
					assetUsage: "production",
					assetPurpose: null,
					productionEligible: true,
					productionExclusionReason: null,
					sourceFacts: {
						referenceType: "scene",
						roleName: "秦家院落与柴房",
						physicalIdentityKey: null,
						characterAssetRole: null,
						characterProfileVersion: null,
						identityAnchors: [],
						prohibitedDrift: ["不得改变院落与柴房方位"],
						sourceNodeId: "node-qin-courtyard",
						workflowExecutionId: "source-execution-1",
						taskId: "image-task-2",
						prompt: "秦家院落、柴房和院门的固定空间关系",
					},
					updatedAt: "2026-08-30T07:00:30.000Z",
				}],
				capturedAt: "2026-08-30T07:01:00.000Z",
			},
		});

		const prompt = (runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
			taskRequest: { prompt: string };
		}).taskRequest.prompt;
		expect(prompt).toContain("显式所选资产是一等执行事实，不是可选参考");
		expect(prompt).toContain("根级 objectRegistry[].referenceAssetIds");
		expect(prompt).toContain("selectedAssetIds 的每个 ID 都在 objectRegistry[].referenceAssetIds 中精确出现一次");
		expect(prompt).toContain('"assetId":"asset-zhangsan"');
		expect(prompt).toContain('"assetId":"asset-qin-courtyard"');
		expect(prompt).toContain('"selected":false');
		expect(prompt).toContain('"physicalIdentityKey":"spirit-zhangsan"');
		expect(prompt).toContain('"projectAssetCandidates"');
		expect(prompt).toContain("展示名、canonicalName 或章节内称谓不同不代表新身份");
		expect(prompt).toContain("runtime 后续只验证精确 ID 的项目归属、图片就绪状态和单对象绑定，不会返回语义纠偏");
		expect(prompt).toContain("runtime 只验证绑定，不会补绑、猜测或把拒因回灌给模型");
		expect(prompt).toContain("一次性路人、匿名围观者、背景人群");
		expect(prompt).toContain("referenceRole=none 且两个引用 ID 数组为空");
	});

	it("adapts an array-only JSON object to the agents-cli non-empty array contract", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: JSON.stringify({ clips: [{ clipId: "clip-001" }] }),
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { items: [{ evidenceId: "e-clips" }] },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			outputEncoding: "json_object",
			outputArtifactType: "tapcanvas.clip-prompts/v2",
			jsonObjectContract: {
				requiredArrayFields: ["clips"],
				allowedFields: ["clips"],
			},
		});

		expect(runPersistedAgentsChatTask).toHaveBeenLastCalledWith(
			expect.objectContaining({
				taskRequest: expect.objectContaining({
					extras: expect.objectContaining({
						outputContract: expect.objectContaining({
							kind: "json",
							executionPolicy: "single_inference_no_tools_record_and_fail",
							contractName: "tapcanvas.video-writer-artifact",
							contractVersion: "14",
							requiredArrayField: "clips",
							description: expect.stringContaining("non-empty top-level array field"),
						}),
						responseFormat: { type: "json_object" },
					}),
				}),
			}),
		);
	});

	it("forwards clip writer version identity while leaving frozen asset projection to the compiler", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: JSON.stringify({ clips: [], selfQaNote: "done", creativeReview: {} }),
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { items: [{ evidenceId: "e-writer" }] },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			outputEncoding: "json_object",
			outputArtifactType: "tapcanvas.clip-prompts/v2",
			jsonObjectContract: {
				requiredStringFields: ["selfQaNote"],
				requiredObjectFields: ["creativeReview"],
				requiredArrayFields: ["clips"],
				expectedArrayLengths: { clips: 1 },
				arrayItemExactStringFields: { clips: [{ exitState: "老隼跪地开匣" }] },
				arrayItemExactStringArrayFields: { clips: [{ characterRoleNames: ["老隼"] }] },
				allowedFields: ["clips", "selfQaNote", "creativeReview"],
				itemExactAssetIds: {
					declarationPaths: ["assetObjectContracts"],
					expected: ["asset-hero", "asset-scene"],
				},
			},
		});

		expect(runPersistedAgentsChatTask).toHaveBeenLastCalledWith(expect.objectContaining({
			taskRequest: expect.objectContaining({
					extras: expect.objectContaining({
					outputContract: expect.objectContaining({
						kind: "json",
						executionPolicy: "single_inference_no_tools_record_and_fail",
						contractName: "tapcanvas.video-writer-artifact",
						contractVersion: "14",
						expectedArrayLength: 1,
					}),
				}),
			}),
		}));
		const outputContract = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0]?.taskRequest?.extras?.outputContract;
		expect(outputContract).not.toHaveProperty("arrayItemExactAssetIds");
		expect(outputContract).not.toHaveProperty("arrayItemExactNumberFields");
		expect(outputContract).not.toHaveProperty("arrayItemExactStringFields");
		expect(outputContract).not.toHaveProperty("arrayItemExactStringArrayFields");
		expect(outputContract).not.toHaveProperty("requiredStringFields");
		expect(outputContract).not.toHaveProperty("requiredObjectFields");
	});

	it("requires SpeechEvent arrays in the same Agent chain when the frozen clip context contains speech", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: JSON.stringify({ clips: [] }),
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { items: [{ evidenceId: "e-writer-speech" }] },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			outputEncoding: "json_object",
			outputArtifactType: "tapcanvas.clip-prompts/v2",
			inputs: {
				"clip-contexts": [{
					beat: { durationSeconds: 15 },
					spokenScript: [{ lineId: "L01", speakerName: "小美" }],
				}],
			},
			jsonObjectContract: {
				requiredArrayFields: ["clips"],
				expectedArrayLengths: { clips: 1 },
				itemRequiredNonEmptyArrayFields: ["shots"],
				allowedFields: ["clips"],
			},
		});

		const outputContract = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0]?.taskRequest?.extras?.outputContract;
		expect(outputContract).toMatchObject({
			kind: "json",
			executionPolicy: "single_inference_no_tools_record_and_fail",
			contractName: "tapcanvas.video-writer-artifact",
			contractVersion: "14",
			requiredArrayField: "clips",
			expectedArrayLength: 1,
			itemTimelineDurationSeconds: 15,
			requiredNonEmptyArrayPaths: ["shots", "speakerBindings", "speechEvents"],
		});
	});

	it("uses one bounded identity for the trace request and durable public turn", async () => {
		const longRequest = {
			...request,
			executionId: `execution-${"x".repeat(120)}`,
			nodeId: `agent-${"y".repeat(120)}`,
		};
		const expectedTurnId = workflowAgentPublicTurnId({
			executionId: longRequest.executionId,
			nodeId: longRequest.nodeId,
			physicalRetryOrdinal: null,
		});
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: expectedTurnId,
				assets: [],
				raw: {
				text: "完整产物",
				meta: {
					expectedDelivery: { active: true },
					deliveryEvidence: { items: [{ evidenceId: "e-long-id" }] },
					deliveryVerification: { status: "satisfied" },
					requestTerminal: { status: "succeeded" },
				},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, longRequest);

		const call = runPersistedAgentsChatTask.mock.calls.at(-1);
		expect(call).toBeDefined();
		const input = call?.[0] as {
			c: AppContext;
			rootRequestId: string;
			taskRequest: { extras?: Record<string, unknown> };
		};
		expect(expectedTurnId).toHaveLength(160);
		expect(input.c.get("requestId")).toBe(expectedTurnId);
		expect(input.taskRequest.extras?.publicTurnId).toBe(expectedTurnId);
		expect(input.taskRequest.extras?.logicalTaskId).toBe(expectedTurnId);
		expect(input.rootRequestId).toBe(expectedTurnId);
	});
});
