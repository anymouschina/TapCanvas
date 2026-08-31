import { describe, expect, it } from "vitest";

import type { ExecutionTraceEvent } from "../memory/execution-trace-events.repo";
import {
	buildPublicChatEventId,
	buildPublicChatReplayResyncPayload,
	detectPublicChatReplayGap,
	markPublicChatStreamPayload,
	parsePublicChatEventId,
	projectExecutionTraceEventToPublicChatFrame,
	resolvePublicChatReplayAfterEvent,
	traceStatusCanProduceMorePublicChatEvents,
	verifyPublicChatReplaySessionIdentity,
} from "./public-agents-chat-event-replay";

function traceEvent(input: Partial<ExecutionTraceEvent> & Pick<ExecutionTraceEvent, "seq" | "eventType" | "payload">): ExecutionTraceEvent {
	return {
		id: `event-${input.seq}`,
		traceId: "public-chat-turn:abc",
		producerEventId: `producer-${input.seq}`,
		eventClass: "content",
		eventKey: input.eventType,
		phase: null,
		status: null,
		logicalTaskId: "public-chat-turn:abc",
		rootTraceId: "public-chat-turn:abc",
		parentTraceId: null,
		physicalRunId: null,
		workflowRunId: null,
		workflowNodeId: null,
		agentId: null,
		parentAgentId: null,
		toolCallId: null,
		effectId: null,
		providerTaskId: null,
		spanId: null,
		parentSpanId: null,
		attempt: null,
		payloadSizeBytes: 0,
		payloadTruncated: false,
		createdAt: "2026-08-22T00:00:00.000Z",
		...input,
	};
}

describe("public chat durable event replay protocol", () => {
	it("projects only explicitly marked browser frames and preserves the journal sequence", () => {
		const marked = traceEvent({
			seq: 7,
			eventType: "content",
			payload: markPublicChatStreamPayload("content", { delta: "hello" }),
		});
		expect(projectExecutionTraceEventToPublicChatFrame(marked, "public-chat-turn:abc")).toEqual({
			event: "content",
			data: { delta: "hello" },
			eventId: "public-chat-turn:abc#7",
			sequence: 7,
			terminal: false,
		});

		const rawProviderTerminal = traceEvent({
			seq: 8,
			eventType: "result",
			payload: { response: { text: "unenriched upstream result" } },
		});
		expect(projectExecutionTraceEventToPublicChatFrame(
			rawProviderTerminal,
			"public-chat-turn:abc",
		)).toBeNull();
	});

	it("treats an error frame as terminal only when its structured envelope says so", () => {
		const recoverableError = traceEvent({
			seq: 9,
			eventType: "error",
			payload: markPublicChatStreamPayload("error", {
				message: "provider warning",
				terminal: false,
			}),
		});
		const terminalError = traceEvent({
			seq: 10,
			eventType: "error",
			payload: markPublicChatStreamPayload("error", {
				message: "provider failed",
				terminal: true,
			}),
		});

		expect(projectExecutionTraceEventToPublicChatFrame(
			recoverableError,
			"public-chat-turn:abc",
		)?.terminal).toBe(false);
		expect(projectExecutionTraceEventToPublicChatFrame(
			terminalError,
			"public-chat-turn:abc",
		)?.terminal).toBe(true);
	});

	it("binds a replay cursor to one exact public turn and rejects conflicting transports", () => {
		expect(buildPublicChatEventId("public-chat-turn:abc", 12)).toBe("public-chat-turn:abc#12");
		expect(parsePublicChatEventId(
			"public-chat-turn:abc#12",
			"public-chat-turn:abc",
		)).toEqual({ eventId: "public-chat-turn:abc#12", sequence: 12 });
		expect(parsePublicChatEventId(
			"public-chat-turn:other#12",
			"public-chat-turn:abc",
		)).toBeNull();
		expect(resolvePublicChatReplayAfterEvent({
			publicTurnId: "public-chat-turn:abc",
			afterEventId: "public-chat-turn:abc#12",
			lastEventIdHeader: "public-chat-turn:abc#12",
		})).toEqual({ eventId: "public-chat-turn:abc#12", sequence: 12 });
		expect(() => resolvePublicChatReplayAfterEvent({
			publicTurnId: "public-chat-turn:abc",
			afterEventId: "public-chat-turn:abc#12",
			lastEventIdHeader: "public-chat-turn:abc#11",
		})).toThrow("public_chat_replay_cursor_mismatch");
	});

	it("distinguishes retention gaps and impossible cursors from an ordinary empty poll", () => {
		expect(detectPublicChatReplayGap({
			afterSequence: 4,
			latestSequence: 8,
			events: [{ seq: 7 }],
		})).toBe("retention_gap");
		expect(detectPublicChatReplayGap({
			afterSequence: 9,
			latestSequence: 8,
			events: [],
		})).toBe("cursor_ahead");
		expect(detectPublicChatReplayGap({
			afterSequence: 8,
			latestSequence: 8,
			events: [],
		})).toBeNull();
	});

	it("returns an explicit status-reconcile envelope instead of silently skipping a gap", () => {
		expect(buildPublicChatReplayResyncPayload({
			publicTurnId: "public-chat-turn:abc",
			reason: "retention_gap",
			requestedAfterEventId: "public-chat-turn:abc#4",
			earliestAvailableSequence: 7,
			latestSequence: 9,
		})).toEqual({
			publicTurnId: "public-chat-turn:abc",
			reason: "retention_gap",
			requestedAfterEventId: "public-chat-turn:abc#4",
			earliestAvailableEventId: "public-chat-turn:abc#7",
			latestEventId: "public-chat-turn:abc#9",
			recovery: {
				kind: "status_reconcile",
				referenceId: "public-chat-turn:abc",
			},
		});
		expect(traceStatusCanProduceMorePublicChatEvents("running")).toBe(true);
		expect(traceStatusCanProduceMorePublicChatEvents("succeeded")).toBe(false);
		expect(traceStatusCanProduceMorePublicChatEvents("waiting_async")).toBe(false);
	});

	it("fails closed when the seq=1 accepted session identity is missing or different", () => {
		expect(verifyPublicChatReplaySessionIdentity({
			event: undefined,
			expectedSessionKey: "session-1",
		})).toEqual({ status: "missing" });
		expect(verifyPublicChatReplaySessionIdentity({
			event: traceEvent({
				seq: 1,
				eventType: "request.accepted",
				payload: { request: { sessionKey: "session-other" } },
			}),
			expectedSessionKey: "session-1",
		})).toEqual({ status: "mismatch", acceptedSessionKey: "session-other" });
		expect(verifyPublicChatReplaySessionIdentity({
			event: traceEvent({
				seq: 1,
				eventType: "request.accepted",
				payload: { request: { sessionKey: "session-1" } },
			}),
			expectedSessionKey: "session-1",
		})).toEqual({ status: "matched", sessionKey: "session-1" });
	});
});
