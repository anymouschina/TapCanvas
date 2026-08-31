import type {
	ExecutionTraceEvent,
	ExecutionTraceRunStatus,
} from "../memory/execution-trace-events.repo";

const PUBLIC_CHAT_STREAM_MARKER_KEY = "__tapcanvasPublicChatStream";
const PUBLIC_CHAT_EVENT_ID_SEPARATOR = "#";

export const PUBLIC_CHAT_REPLAY_POLL_INTERVAL_MS = 250;
export const PUBLIC_CHAT_REPLAY_PAGE_SIZE = 200;

export type PublicChatReplayableEventName =
	| "initial"
	| "session"
	| "thinking"
	| "content"
	| "block"
	| "suggestions"
	| "tool"
	| "skill"
	| "todo_list"
	| "agent_role"
	| "thread.started"
	| "turn.started"
	| "item.started"
	| "item.updated"
	| "item.completed"
	| "status-update"
	| "artifact-update"
	| "result"
	| "error"
	| "done";

export type PublicChatReplayFrame = Readonly<{
	event: PublicChatReplayableEventName;
	data: Record<string, unknown>;
	eventId: string;
	sequence: number;
	terminal: boolean;
}>;

export type PublicChatReplayResyncReason =
	| "retention_gap"
	| "cursor_ahead"
	| "payload_truncated"
	| "terminal_projection_missing";

export type PublicChatReplayResyncPayload = Readonly<{
	publicTurnId: string;
	reason: PublicChatReplayResyncReason;
	requestedAfterEventId: string | null;
	earliestAvailableEventId: string | null;
	latestEventId: string | null;
	recovery: Readonly<{
		kind: "status_reconcile";
		referenceId: string;
	}>;
}>;

export type PublicChatReplaySessionIdentity =
	| Readonly<{ status: "matched"; sessionKey: string }>
	| Readonly<{ status: "missing" }>
	| Readonly<{ status: "mismatch"; acceptedSessionKey: string }>;

type PublicChatStreamMarkerV1 = Readonly<{
	version: 1;
	event: PublicChatReplayableEventName;
	terminal: boolean;
}>;

const REPLAYABLE_EVENT_NAMES = new Set<PublicChatReplayableEventName>([
	"initial",
	"session",
	"thinking",
	"content",
	"block",
	"suggestions",
	"tool",
	"skill",
	"todo_list",
	"agent_role",
	"thread.started",
	"turn.started",
	"item.started",
	"item.updated",
	"item.completed",
	"status-update",
	"artifact-update",
	"result",
	"error",
	"done",
]);

function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function toJsonTransportRecord(value: unknown): Record<string, unknown> {
	const serialized = JSON.stringify(value);
	if (typeof serialized !== "string") return { value: null };
	const parsed = JSON.parse(serialized) as unknown;
	return readRecord(parsed) ?? { value: parsed };
}

function isReplayableEventName(value: unknown): value is PublicChatReplayableEventName {
	return typeof value === "string" && REPLAYABLE_EVENT_NAMES.has(value as PublicChatReplayableEventName);
}

function isTerminalEvent(
	event: PublicChatReplayableEventName,
	data: Record<string, unknown>,
): boolean {
	if (event === "result" || event === "done") return true;
	if (event !== "error") return false;
	return data.terminal === true;
}

function parseMarker(value: unknown): PublicChatStreamMarkerV1 | null {
	const record = readRecord(value);
	if (
		record?.version !== 1 ||
		!isReplayableEventName(record.event) ||
		typeof record.terminal !== "boolean"
	) return null;
	return {
		version: 1,
		event: record.event,
		terminal: record.terminal,
	};
}

/**
 * Marks exactly the frames that were projected to the browser. The execution
 * trace also contains raw provider/agents lifecycle events; replay must never
 * reinterpret one of those raw records as the Hono-owned public terminal.
 */
export function markPublicChatStreamPayload(
	event: PublicChatReplayableEventName,
	data: unknown,
): Record<string, unknown> {
	const payload = toJsonTransportRecord(data);
	return {
		...payload,
		[PUBLIC_CHAT_STREAM_MARKER_KEY]: {
			version: 1,
			event,
			terminal: isTerminalEvent(event, payload),
		} satisfies PublicChatStreamMarkerV1,
	};
}

export function buildPublicChatEventId(publicTurnIdValue: string, sequenceValue: number): string {
	const publicTurnId = publicTurnIdValue.trim();
	const sequence = Math.trunc(sequenceValue);
	if (!publicTurnId || publicTurnId.includes(PUBLIC_CHAT_EVENT_ID_SEPARATOR)) {
		throw new Error("public chat event id requires a stable turn id without separators");
	}
	if (!Number.isSafeInteger(sequence) || sequence <= 0) {
		throw new Error("public chat event id requires a positive safe sequence");
	}
	return `${publicTurnId}${PUBLIC_CHAT_EVENT_ID_SEPARATOR}${sequence}`;
}

export function parsePublicChatEventId(
	eventIdValue: string,
	expectedPublicTurnIdValue: string,
): { eventId: string; sequence: number } | null {
	const eventId = eventIdValue.trim();
	const expectedPublicTurnId = expectedPublicTurnIdValue.trim();
	if (!eventId || !expectedPublicTurnId) return null;
	const separatorIndex = eventId.lastIndexOf(PUBLIC_CHAT_EVENT_ID_SEPARATOR);
	if (separatorIndex <= 0) return null;
	if (eventId.slice(0, separatorIndex) !== expectedPublicTurnId) return null;
	const rawSequence = eventId.slice(separatorIndex + 1);
	if (!/^[1-9][0-9]*$/.test(rawSequence)) return null;
	const sequence = Number(rawSequence);
	if (!Number.isSafeInteger(sequence) || sequence <= 0) return null;
	return { eventId, sequence };
}

export function resolvePublicChatReplayAfterEvent(input: Readonly<{
	publicTurnId: string;
	afterEventId?: unknown;
	lastEventIdHeader?: unknown;
}>): { eventId: string | null; sequence: number } {
	const bodyEventId = typeof input.afterEventId === "string" ? input.afterEventId.trim() : "";
	const headerEventId = typeof input.lastEventIdHeader === "string"
		? input.lastEventIdHeader.trim()
		: "";
	if (bodyEventId && headerEventId && bodyEventId !== headerEventId) {
		throw new Error("public_chat_replay_cursor_mismatch");
	}
	const eventId = bodyEventId || headerEventId;
	if (!eventId) return { eventId: null, sequence: 0 };
	const parsed = parsePublicChatEventId(eventId, input.publicTurnId);
	if (!parsed) throw new Error("public_chat_replay_cursor_invalid");
	return parsed;
}

export function projectExecutionTraceEventToPublicChatFrame(
	event: ExecutionTraceEvent,
	publicTurnId: string,
): PublicChatReplayFrame | null {
	const marker = parseMarker(event.payload[PUBLIC_CHAT_STREAM_MARKER_KEY]);
	if (!marker || marker.event !== event.eventType) return null;
	const data = { ...event.payload };
	delete data[PUBLIC_CHAT_STREAM_MARKER_KEY];
	return {
		event: marker.event,
		data,
		eventId: buildPublicChatEventId(publicTurnId, event.seq),
		sequence: event.seq,
		terminal: marker.terminal,
	};
}

export function detectPublicChatReplayGap(input: Readonly<{
	afterSequence: number;
	latestSequence: number;
	events: readonly Pick<ExecutionTraceEvent, "seq">[];
}>): PublicChatReplayResyncReason | null {
	const afterSequence = Math.max(0, Math.trunc(input.afterSequence));
	const latestSequence = Math.max(0, Math.trunc(input.latestSequence));
	if (afterSequence > latestSequence) return "cursor_ahead";
	const firstSequence = input.events[0]?.seq ?? null;
	if (firstSequence !== null && firstSequence > afterSequence + 1) return "retention_gap";
	if (firstSequence === null && latestSequence > afterSequence) return "retention_gap";
	return null;
}

export function verifyPublicChatReplaySessionIdentity(input: Readonly<{
	event: Pick<ExecutionTraceEvent, "seq" | "eventType" | "payload"> | undefined;
	expectedSessionKey: string;
}>): PublicChatReplaySessionIdentity {
	const expectedSessionKey = input.expectedSessionKey.trim();
	const event = input.event;
	if (!expectedSessionKey || !event || event.seq !== 1 || event.eventType !== "request.accepted") {
		return { status: "missing" };
	}
	const request = readRecord(event.payload.request);
	const acceptedSessionKey = typeof request?.sessionKey === "string"
		? request.sessionKey.trim()
		: "";
	if (!acceptedSessionKey) return { status: "missing" };
	if (acceptedSessionKey !== expectedSessionKey) {
		return { status: "mismatch", acceptedSessionKey };
	}
	return { status: "matched", sessionKey: acceptedSessionKey };
}

export function buildPublicChatReplayResyncPayload(input: Readonly<{
	publicTurnId: string;
	reason: PublicChatReplayResyncReason;
	requestedAfterEventId: string | null;
	earliestAvailableSequence: number | null;
	latestSequence: number;
}>): PublicChatReplayResyncPayload {
	const publicTurnId = input.publicTurnId.trim();
	if (!publicTurnId) throw new Error("public chat replay resync requires publicTurnId");
	return {
		publicTurnId,
		reason: input.reason,
		requestedAfterEventId: input.requestedAfterEventId,
		earliestAvailableEventId: input.earliestAvailableSequence && input.earliestAvailableSequence > 0
			? buildPublicChatEventId(publicTurnId, input.earliestAvailableSequence)
			: null,
		latestEventId: input.latestSequence > 0
			? buildPublicChatEventId(publicTurnId, input.latestSequence)
			: null,
		recovery: {
			kind: "status_reconcile",
			referenceId: publicTurnId,
		},
	};
}

export function traceStatusCanProduceMorePublicChatEvents(status: ExecutionTraceRunStatus): boolean {
	return status === "running";
}
