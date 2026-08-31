import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { AppContext } from "../../types";
import {
	getAgentsChatTurnStatus,
	interruptAgentsChatTurn,
	isAgentsChatRuntimeOutcomeUnknown,
	parseAgentsChatTurnStatusSnapshot as parseAgentsChatTurnStatusSnapshotRaw,
} from "./task.agents-chat-runtime";
import {
	AGENTS_BRIDGE_SESSION_AFFINITY_HEADER,
	buildAgentsBridgeSessionAffinity,
} from "./agents-bridge-session-affinity";

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function parseAgentsChatTurnStatusSnapshot(payload: unknown, expectedSessionId: string) {
	const root = asRecord(payload);
	const turn = asRecord(root?.turn);
	if (!root || !turn || turn.logicalTaskState) {
		return parseAgentsChatTurnStatusSnapshotRaw(payload, expectedSessionId);
	}
	const physicalState = String(turn.state || "");
	const status = physicalState === "running"
		? "active"
		: physicalState === "needs_input"
			? "waiting_input"
			: physicalState === "suspended"
				? "waiting_external"
				: physicalState === "succeeded" || physicalState === "cancelled"
					? physicalState
					: "failed";
	const reasonCode = typeof turn.reasonCode === "string" && turn.reasonCode.trim()
		? turn.reasonCode
		: `logical_${status}`;
	return parseAgentsChatTurnStatusSnapshotRaw({
		...root,
		turn: {
			...turn,
			logicalTaskState: {
				version: 1,
				logicalTaskId: String(turn.turnId || ""),
				status,
				reasonCode,
				physicalRunStatus: status === "active"
					? "running"
					: status === "waiting_external"
						? "handed_off"
						: status === "failed" || status === "cancelled"
							? "interrupted"
							: "completed",
				deliveryStatus: status === "succeeded"
					? "satisfied"
					: status === "failed" || status === "cancelled"
						? "unsatisfied"
						: "pending",
				taskNodeId: "root",
				taskRevision: 0,
				updatedAt: String(turn.updatedAt || turn.lastConfirmedAt || ""),
				continuationTicket: null,
			},
		},
	}, expectedSessionId);
}

function createDurableTerminalDelivery(contractHash = "contract-1") {
	return {
		version: 1,
		requestTerminal: {
			version: 1,
			terminal: true,
			status: "succeeded",
			reason: "delivery_verification_satisfied",
		},
		expectedDelivery: { version: 2, contractHash },
		deliveryEvidence: [{
			evidenceId: "runtime-final-response",
			kind: "final_response",
			sourceRef: "final_response",
			requirementIds: ["result"],
			attributes: {},
		}],
		deliveryVerification: {
			version: 2,
			contractHash,
			status: "satisfied",
			criteria: [],
			verifiedAt: "2026-08-03T05:00:03.000Z",
		},
	};
}

describe("agents chat runtime status", () => {
	const replayFixture = JSON.parse(readFileSync("../../packages/schemas/agent-observability/replay-fixtures/replan-attention-projection.v1.json", "utf8")) as {
		expected: { attentionProjection: Record<string, unknown> };
	};
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("routes status and interrupt for one session through the same bridge affinity", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.endsWith("/chat/status")) {
				return new Response(JSON.stringify({
					sessionId: "session-1",
					durable: true,
					activeTurn: false,
					turn: null,
				}), { status: 200, headers: { "content-type": "application/json" } });
			}
			return new Response(JSON.stringify({
				ok: true,
				interrupted: true,
				turnId: "turn-1",
				status: null,
			}), { status: 200, headers: { "content-type": "application/json" } });
		});
		vi.stubGlobal("fetch", fetchMock);
		const context = {
			env: {
				AGENTS_BRIDGE_BASE_URL: "http://agents.test",
			},
			get: () => undefined,
		} as unknown as AppContext;

		await getAgentsChatTurnStatus(context, "user-1", "session-1", { timeoutMs: 1_000 });
		await interruptAgentsChatTurn(context, "user-1", {
			sessionId: "session-1",
			turnId: "turn-1",
			reasonCode: "provider_stream_interrupted",
		}, { timeoutMs: 1_000 });

		const expectedAffinity = buildAgentsBridgeSessionAffinity({
			userId: "user-1",
			sessionId: "session-1",
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		for (const call of fetchMock.mock.calls) {
			const init = call[1];
			expect(new Headers(init?.headers).get(
				AGENTS_BRIDGE_SESSION_AFFINITY_HEADER,
			)).toBe(expectedAffinity);
		}
		expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
			userId: "user-1",
			sessionId: "session-1",
			turnId: "turn-1",
			reasonCode: "provider_stream_interrupted",
		});
	});

	it("aborts a runtime request at the caller-owned deadline and reports an unknown outcome", async () => {
		const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					const error = new Error("aborted");
					error.name = "AbortError";
					reject(error);
				}, { once: true });
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const context = {
			env: { AGENTS_BRIDGE_BASE_URL: "http://agents.test" },
			get: () => undefined,
		} as unknown as AppContext;

		const request = interruptAgentsChatTurn(context, "user-1", {
			sessionId: "session-1",
			turnId: "turn-1",
		}, { timeoutMs: 5 });

		await expect(request).rejects.toMatchObject({
			code: "agents_chat_runtime_timeout",
			status: 504,
			details: {
				operation: "interrupt",
				operationOutcome: "unknown",
				reason: "deadline_exceeded",
				timeoutMs: 5,
			},
		});
		await request.catch((error: unknown) => {
			expect(isAgentsChatRuntimeOutcomeUnknown(error)).toBe(true);
		});
		expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
	});

	it("classifies transport failure as unknown instead of claiming the interrupt failed", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => {
			throw new TypeError("connection reset");
		}));
		const context = {
			env: { AGENTS_BRIDGE_BASE_URL: "http://agents.test" },
			get: () => undefined,
		} as unknown as AppContext;

		await expect(interruptAgentsChatTurn(context, "user-1", {
			sessionId: "session-1",
			turnId: "turn-1",
		}, { timeoutMs: 1_000 })).rejects.toMatchObject({
			code: "agents_chat_runtime_transport_unknown",
			details: {
				operation: "interrupt",
				operationOutcome: "unknown",
				reason: "transport_failure",
			},
		});
	});

	it("parses a durable active turn without inferring progress", () => {
		const result = parseAgentsChatTurnStatusSnapshot({
			sessionId: "session_1",
			durable: true,
			activeTurn: true,
			turn: {
				turnId: "request_1",
				internalTurnId: "turn_1",
				state: "running",
				phase: "agent_running",
				startedAt: "2026-08-03T05:00:00.000Z",
				updatedAt: "2026-08-03T05:00:01.000Z",
				lastConfirmedAt: "2026-08-03T05:00:02.000Z",
				requestText: "制作视频",
				reasonCode: "initial_execution",
				lastConfirmedSummary: "模型正在处理当前任务",
				finalResponse: null,
				pendingQueueCount: 0,
				recentEvents: [{
					type: "llm_turn_started",
					at: "2026-08-03T05:00:02.000Z",
					toolName: null,
					toolStatus: null,
				}],
			},
		}, "session_1");

		expect(result.activeTurn).toBe(true);
		expect(result.turn?.turnId).toBe("request_1");
		expect(result.turn?.lastConfirmedSummary).toBe("模型正在处理当前任务");
		expect(result.turn?.finalResponse).toBeNull();
	});

	it("treats a recovery checkpoint carried by an active resumed run as inert historical evidence", () => {
		const result = parseAgentsChatTurnStatusSnapshot({
			sessionId: "session_1",
			durable: true,
			activeTurn: true,
			turn: {
				turnId: "request_1",
				internalTurnId: "turn_1",
				state: "running",
				phase: "agent_running",
				startedAt: "2026-08-03T05:00:00.000Z",
				updatedAt: "2026-08-03T05:00:01.000Z",
				lastConfirmedAt: "2026-08-03T05:00:02.000Z",
				requestText: "继续制作视频",
				reasonCode: "initial_execution",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "provider_stream_interrupted",
					physicalRunId: "physical_run_previous_1",
					progressRevision: 3,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "模型正在处理当前任务",
				finalResponse: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		}, "session_1");

		expect(result.activeTurn).toBe(true);
		expect(result.turn?.state).toBe("running");
		expect(result.turn?.recoveryCheckpoint).toBeNull();
	});

	it("preserves the versioned attention projection as status evidence", () => {
		const result = parseAgentsChatTurnStatusSnapshot({
			sessionId: "session_1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "request_1",
				internalTurnId: "turn_1",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-03T05:00:00.000Z",
				updatedAt: "2026-08-03T05:00:03.000Z",
				lastConfirmedAt: "2026-08-03T05:00:03.000Z",
				requestText: "继续任务",
				reasonCode: "replan_required",
				attentionProjection: {
					version: 1,
					logicalTaskId: "logical_replay_1",
					status: "replan",
					waitingOn: "replan_required",
					obligation: "建立新的执行计划",
					sourceHeads: { graphRevision: null, evidenceRevision: null, physicalRunId: "physical_replay_1" },
				},
				lastConfirmedSummary: "需要重规划",
				finalResponse: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		}, "session_1");

		expect(result.turn?.attentionProjection).toMatchObject(replayFixture.expected.attentionProjection);
	});

	it("preserves the verified terminal response for SSE transport recovery", () => {
		const result = parseAgentsChatTurnStatusSnapshot({
			sessionId: "session_1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "request_1",
				internalTurnId: "turn_1",
				state: "succeeded",
				phase: "succeeded",
				startedAt: "2026-08-03T05:00:00.000Z",
				updatedAt: "2026-08-03T05:00:03.000Z",
				lastConfirmedAt: "2026-08-03T05:00:03.000Z",
				requestText: "应用项目视觉圣经",
				reasonCode: null,
					lastConfirmedSummary: "当前回合已完成",
					finalResponse: "项目视觉圣经 V1 已激活",
					terminalDelivery: createDurableTerminalDelivery(),
					pendingQueueCount: 0,
				recentEvents: [],
			},
		}, "session_1");

			expect(result.turn?.finalResponse).toBe("项目视觉圣经 V1 已激活");
			expect(result.turn?.terminalDelivery?.deliveryVerification.status).toBe("satisfied");
		});

		it("uses the committed logical terminal without re-running delivery arbitration", () => {
			const result = parseAgentsChatTurnStatusSnapshot({
				sessionId: "session_1",
				durable: true,
				activeTurn: false,
				turn: {
					turnId: "request_legacy",
					internalTurnId: "turn_legacy",
					state: "succeeded",
					phase: "succeeded",
					startedAt: "2026-08-03T05:00:00.000Z",
					updatedAt: "2026-08-03T05:00:03.000Z",
					lastConfirmedAt: "2026-08-03T05:00:03.000Z",
					requestText: "生成图片",
					reasonCode: null,
					lastConfirmedSummary: "当前回合已完成",
					finalResponse: "历史回复仍保留",
					pendingQueueCount: 0,
					recentEvents: [],
				},
			}, "session_1");

			expect(result.turn?.state).toBe("succeeded");
			expect(result.turn?.logicalTaskState.status).toBe("succeeded");
			expect(result.turn?.reasonCode).toBe("logical_succeeded");
			expect(result.turn?.finalResponse).toBe("历史回复仍保留");
		});

		it("keeps a Workflow action terminal observable for the internal workflow runner", () => {
			const result = parseAgentsChatTurnStatusSnapshot({
				sessionId: "session_1",
				durable: true,
				activeTurn: false,
				turn: {
					turnId: "workflow_request_1",
					internalTurnId: "workflow_turn_1",
					state: "succeeded",
					phase: "succeeded",
					startedAt: "2026-08-03T05:00:00.000Z",
					updatedAt: "2026-08-03T05:00:03.000Z",
					lastConfirmedAt: "2026-08-03T05:00:03.000Z",
					requestText: "执行 clip writer",
					terminalAuthority: "workflow_action",
					reasonCode: null,
					lastConfirmedSummary: "当前动作已完成",
					finalResponse: "{\"clipId\":\"clip_02\"}",
					pendingQueueCount: 0,
					recentEvents: [],
				},
			}, "session_1");

			expect(result.turn?.state).toBe("succeeded");
			expect(result.turn?.terminalAuthority).toBe("workflow_action");
			expect(result.turn?.terminalDelivery).toBeNull();
		});

		it("rejects an explicit unknown terminal authority instead of guessing its scope", () => {
			expect(() => parseAgentsChatTurnStatusSnapshot({
				sessionId: "session_1",
				durable: true,
				activeTurn: false,
				turn: {
					turnId: "request_invalid_authority",
					internalTurnId: "turn_invalid_authority",
					state: "failed",
					phase: "failed",
					startedAt: "2026-08-03T05:00:00.000Z",
					updatedAt: "2026-08-03T05:00:03.000Z",
					lastConfirmedAt: "2026-08-03T05:00:03.000Z",
					requestText: "执行任务",
					terminalAuthority: "unknown_scope",
					reasonCode: "invalid",
					lastConfirmedSummary: "失败",
					finalResponse: null,
					pendingQueueCount: 0,
					recentEvents: [],
				},
			}, "session_1")).toThrow(/invalid terminal authority/);
		});

	it("preserves one provenance receipt per physical execution window", () => {
		const provenance = (executionId: string) => ({
			version: 1,
			executionId,
			depth: 1,
			model: "deepseek-v4-flash",
			apiStyle: "chat",
			requiredSkills: ["tapcanvas-video-workflow"],
			loadedSkills: ["tapcanvas-video-workflow"],
			loadedSkillResources: [],
			loadedSkillSources: [],
			loadedKnowledgeSources: [],
			startedAt: "2026-08-15T00:00:00.000Z",
		});
		const result = parseAgentsChatTurnStatusSnapshot({
			sessionId: "session_1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "request_1",
				internalTurnId: "turn_2",
				state: "succeeded",
				phase: "succeeded",
				startedAt: "2026-08-15T00:00:00.000Z",
				updatedAt: "2026-08-15T00:01:00.000Z",
				lastConfirmedAt: "2026-08-15T00:01:00.000Z",
				requestText: "执行工作流",
				reasonCode: null,
					lastConfirmedSummary: "当前回合已完成",
					finalResponse: "done",
					terminalDelivery: createDurableTerminalDelivery(),
				executionProvenanceHistory: [provenance("physical-1"), provenance("physical-2")],
				pendingQueueCount: 0,
				recentEvents: [],
			},
		}, "session_1");

		expect(result.turn?.executionProvenanceHistory?.map((item) => item.executionId)).toEqual([
			"physical-1",
			"physical-2",
		]);
	});

	it("preserves the cancelled terminal state from an explicit user interrupt", () => {
		const result = parseAgentsChatTurnStatusSnapshot({
			sessionId: "session_1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "request_1",
				internalTurnId: "turn_1",
				state: "cancelled",
				phase: "failed",
				startedAt: "2026-08-03T05:00:00.000Z",
				updatedAt: "2026-08-03T05:00:01.000Z",
				lastConfirmedAt: "2026-08-03T05:00:01.000Z",
				requestText: "停止当前任务",
				reasonCode: "chat_turn_user_interrupt",
				lastConfirmedSummary: "当前回合已中断",
				finalResponse: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		}, "session_1");

		expect(result.activeTurn).toBe(false);
		expect(result.turn?.state).toBe("cancelled");
	});

	it("preserves structured physical budget evidence for exact continuation recovery", () => {
		const result = parseAgentsChatTurnStatusSnapshot({
			sessionId: "session_1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "request_1",
				internalTurnId: "turn_1",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-03T05:00:00.000Z",
				updatedAt: "2026-08-03T05:05:00.000Z",
				lastConfirmedAt: "2026-08-03T05:05:00.000Z",
				requestText: "执行 V2",
				reasonCode: "root_physical_execution_budget_exhausted",
				suspension: {
					reasonCode: "root_physical_execution_budget_exhausted",
					physicalRunId: "physical_run_1",
					progressRevision: 4,
					progressSinceRunStart: 4,
					budgetKind: "wall_time",
					observed: 300_308,
					limit: 300_000,
				},
				recoveryCheckpoint: {
					reasonCode: "root_physical_execution_budget_exhausted",
					physicalRunId: "physical_run_1",
					progressRevision: 4,
					durableTaskReferences: [{
						version: 1,
						toolName: "tapcanvas_video_orchestrate",
						mode: "preflight_get_header",
						runId: "video_v2",
						taskId: null,
						draftRevision: "revision_4",
						beatRevision: null,
						preflightRevision: null,
						preflightFingerprint: null,
						clipIndex: null,
						acceptedAsync: false,
					}],
					durableProgressClaims: [{
						key: "assetId:look-bible-1",
						fingerprint: "fingerprint-1",
						kind: "durable_action",
						toolName: "tapcanvas_call_tool",
						toolCallId: "call_confirm_1",
						observedAt: "2026-08-03T05:04:00.000Z",
						revision: 4,
					}],
					userIntentContract: null,
				},
				lastConfirmedSummary: "正在切换续跑窗口",
				finalResponse: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		}, "session_1");

		expect(result.turn?.suspension).toMatchObject({
			physicalRunId: "physical_run_1",
			progressRevision: 4,
			budgetKind: "wall_time",
		});
		expect(result.turn?.recoveryCheckpoint?.durableProgressClaims[0]).toMatchObject({
			key: "assetId:look-bible-1",
			toolCallId: "call_confirm_1",
			revision: 4,
		});
		expect(result.turn?.recoveryCheckpoint?.durableTaskReferences[0]?.runId).toBe("video_v2");
	});

	it("preserves a failed physical run checkpoint after the user cancels its logical turn", () => {
		const result = parseAgentsChatTurnStatusSnapshot({
			sessionId: "session_1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "request_1",
				internalTurnId: "turn_1",
				state: "cancelled",
				phase: "failed",
				startedAt: "2026-08-03T05:00:00.000Z",
				updatedAt: "2026-08-03T05:00:02.000Z",
				lastConfirmedAt: "2026-08-03T05:00:02.000Z",
				requestText: "执行 V2",
				reasonCode: "chat_turn_user_interrupt",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "chat_turn_user_interrupt",
					physicalRunId: "physical_run_failed_1",
					progressRevision: 1,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "当前回合已中断",
				finalResponse: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		}, "session_1");

		expect(result.turn?.state).toBe("cancelled");
		expect(result.turn?.recoveryCheckpoint?.physicalRunId).toBe("physical_run_failed_1");
	});

	it("preserves a machine-authored repair suspension without a reason-code allowlist", () => {
		const result = parseAgentsChatTurnStatusSnapshot({
			sessionId: "session_1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "request_1",
				internalTurnId: "turn_1",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-03T05:00:00.000Z",
				updatedAt: "2026-08-03T05:00:02.000Z",
				lastConfirmedAt: "2026-08-03T05:00:02.000Z",
				requestText: "",
				reasonCode: "max_turns",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "max_turns",
					physicalRunId: "physical_run_repair_1",
					progressRevision: 0,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "正在继续修正交付",
				finalResponse: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		}, "session_1");

		expect(result.turn?.state).toBe("suspended");
		expect(result.turn?.reasonCode).toBe("max_turns");
		expect(result.turn?.recoveryCheckpoint).toMatchObject({
			reasonCode: "max_turns",
			physicalRunId: "physical_run_repair_1",
			progressRevision: 0,
		});
	});

	it("preserves an active logical task across an interrupted physical run", () => {
		const result = parseAgentsChatTurnStatusSnapshot({
			sessionId: "session_1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "request_1",
				internalTurnId: "turn_1",
				state: "unknown",
				logicalTaskState: {
					version: 1,
					logicalTaskId: "request_1",
					status: "active",
					reasonCode: "provider_stream_interrupted",
					physicalRunStatus: "interrupted",
					deliveryStatus: "pending",
					taskNodeId: "root",
					taskRevision: 7,
					updatedAt: "2026-08-03T05:00:02.000Z",
					continuationTicket: null,
				},
				phase: "agent_running",
				startedAt: "2026-08-03T05:00:00.000Z",
				updatedAt: "2026-08-03T05:00:02.000Z",
				lastConfirmedAt: "2026-08-03T05:00:02.000Z",
				requestText: "",
				reasonCode: "provider_stream_interrupted",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "provider_stream_interrupted",
					physicalRunId: "physical_run_interrupted_1",
					progressRevision: 7,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "模型响应流已中断，持久进度已保存",
				finalResponse: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		}, "session_1");

		expect(result.activeTurn).toBe(false);
		expect(result.turn).toMatchObject({
			state: "running",
			logicalTaskState: { status: "active", physicalRunStatus: "interrupted" },
			phase: "agent_running",
			reasonCode: "provider_stream_interrupted",
			recoveryCheckpoint: {
				physicalRunId: "physical_run_interrupted_1",
				progressRevision: 7,
			},
		});
	});

	it("preserves a provider interruption without a checkpoint as an orphaned physical boundary", () => {
		const result = parseAgentsChatTurnStatusSnapshot({
			sessionId: "session_1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "request_1",
				internalTurnId: "turn_1",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-03T05:00:00.000Z",
				updatedAt: "2026-08-03T05:00:02.000Z",
				lastConfirmedAt: "2026-08-03T05:00:02.000Z",
				requestText: "",
				reasonCode: "provider_stream_interrupted",
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "供应商连接在首个持久 checkpoint 前中断",
				finalResponse: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		}, "session_1");

		expect(result.turn).toMatchObject({
			state: "suspended",
			reasonCode: "provider_stream_interrupted",
			recoveryCheckpoint: null,
		});
	});

	it("rejects a cross-session or internally inconsistent response", () => {
		expect(() => parseAgentsChatTurnStatusSnapshot({
			sessionId: "other_session",
			durable: true,
			activeTurn: false,
			turn: null,
		}, "session_1")).toThrow(/sessionId mismatch/);

		expect(() => parseAgentsChatTurnStatusSnapshot({
			sessionId: "session_1",
			durable: true,
			activeTurn: true,
			turn: null,
		}, "session_1")).toThrow(/activeTurn cannot be true/);
	});
});
