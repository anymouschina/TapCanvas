import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentsChatRequestDto } from "../apiKey/apiKey.schemas";
import type { AppContext } from "../../types";

const traceMocks = vi.hoisted(() => ({
	appendExecutionTraceEvents: vi.fn(async (_db: unknown, input: { events: unknown[] }) => input.events),
	beginExecutionTraceRun: vi.fn(async (): Promise<void> => undefined),
	finalizeExecutionTraceRun: vi.fn(async (): Promise<void> => undefined),
}));

vi.mock("../memory/execution-trace-events.repo", () => traceMocks);

import { startPublicChatExecutionRecorder } from "./public-chat-execution-recorder";

const context = { env: { DB: {} } } as unknown as AppContext;
const request = {
	prompt: "生成当前章节整片",
	sessionKey: "session-1",
	canvasProjectId: "project-1",
} as AgentsChatRequestDto;

describe("public chat execution recorder", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		traceMocks.appendExecutionTraceEvents.mockImplementation(async (_db: unknown, input: { events: unknown[] }) => input.events);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("buffers high-frequency content but flushes structural barriers immediately", async () => {
		const recorder = await startPublicChatExecutionRecorder({
			c: context,
			userId: "user-1",
			traceId: "trace-1",
			request,
			rootTraceId: "root-1",
			logicalTaskId: "logical-1",
			recoveryContext: {
				continuationExecutionContract: {
					version: 1,
					directForcedAgentExecution: true,
				},
			},
		});
		expect(traceMocks.appendExecutionTraceEvents).toHaveBeenCalledTimes(1);
		expect(traceMocks.appendExecutionTraceEvents.mock.calls[0]?.[1].events).toEqual([
			expect.objectContaining({
				eventType: "request.accepted",
				payload: expect.objectContaining({
					recoveryContext: {
						continuationExecutionContract: {
							version: 1,
							directForcedAgentExecution: true,
						},
					},
				}),
			}),
		]);

		await recorder.recordBridgeEvent({ event: "content", data: { delta: "A" } });
		await recorder.recordBridgeEvent({ event: "content", data: { delta: "B" } });
		await recorder.recordBridgeEvent({ event: "block", data: { op: "delta", textDelta: "AB" } });
		expect(traceMocks.appendExecutionTraceEvents).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(300);
		expect(traceMocks.appendExecutionTraceEvents).toHaveBeenCalledTimes(2);
		expect(traceMocks.appendExecutionTraceEvents.mock.calls[1]?.[1].events).toHaveLength(3);

		await recorder.recordBridgeEvent({
			event: "tool",
			data: {
				toolCallId: "tool-1",
				phase: "completed",
				status: "succeeded",
				workflowRunId: "run-1",
				workflowNodeId: "media-production",
				effectId: "effect-1",
				providerTaskId: "provider-1",
			},
		});
		expect(traceMocks.appendExecutionTraceEvents).toHaveBeenCalledTimes(3);
		const toolEvent = traceMocks.appendExecutionTraceEvents.mock.calls[2]?.[1].events[0] as Record<string, unknown>;
		expect(toolEvent).toEqual(expect.objectContaining({
			eventClass: "tool",
			logicalTaskId: "logical-1",
			rootTraceId: "root-1",
			workflowRunId: "run-1",
			workflowNodeId: "media-production",
			toolCallId: "tool-1",
			effectId: "effect-1",
			providerTaskId: "provider-1",
		}));
	});

	it("fails the run before agents dispatch when request.accepted cannot be persisted", async () => {
		traceMocks.appendExecutionTraceEvents.mockRejectedValueOnce(new Error("database unavailable"));
		await expect(startPublicChatExecutionRecorder({
			c: context,
			userId: "user-1",
			traceId: "trace-failed",
			request,
		})).rejects.toThrow("execution_trace_initial_event_write_failed");
		expect(traceMocks.finalizeExecutionTraceRun).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				traceId: "trace-failed",
				status: "failed",
				errorCode: "execution_trace_initial_event_write_failed",
			}),
		);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("returns the database-assigned sequence only after a public projection is durable", async () => {
		let nextSequence = 0;
		traceMocks.appendExecutionTraceEvents.mockImplementation(async (_db: unknown, input: { events: unknown[] }) => (
			input.events.map((value) => {
				const event = value as Record<string, unknown>;
				nextSequence += 1;
				return { ...event, seq: nextSequence };
			})
		));
		const recorder = await startPublicChatExecutionRecorder({
			c: context,
			userId: "user-1",
			traceId: "trace-durable",
			request,
		});

		const persisted = await recorder.recordDurableBridgeEvent({
			event: "content",
			data: { delta: "durable before SSE" },
		});

		expect(persisted.seq).toBe(2);
		expect(traceMocks.appendExecutionTraceEvents).toHaveBeenCalledTimes(2);
		expect(traceMocks.appendExecutionTraceEvents.mock.calls[1]?.[1].events).toEqual([
			expect.objectContaining({
				eventType: "content",
				payload: { delta: "durable before SSE" },
			}),
		]);
	});

	it("rejects the public projection at the crash boundary when no durable sequence was allocated", async () => {
		const recorder = await startPublicChatExecutionRecorder({
			c: context,
			userId: "user-1",
			traceId: "trace-crash-boundary",
			request,
		});
		traceMocks.appendExecutionTraceEvents.mockRejectedValueOnce(new Error("database disconnected before commit"));

		await expect(recorder.recordDurableBridgeEvent({
			event: "content",
			data: { delta: "must not receive an SSE id" },
		})).rejects.toThrow("execution_trace_durable_event_not_persisted");
		expect(recorder.getHealth()).toMatchObject({
			status: "degraded",
			failedEventCount: 1,
			pendingEventCount: 1,
		});
	});
});
