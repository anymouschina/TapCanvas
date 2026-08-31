export type PublicAgentsChatSseFrame = {
	event: string;
	data: string;
	/** Stable execution-journal cursor used by Last-Event-ID replay. */
	id?: string;
	/** Browser reconnect hint; it never controls durable task scheduling. */
	retry?: number;
};

export type PublicAgentsChatStreamWriter = {
	writeSSE: (frame: PublicAgentsChatSseFrame) => Promise<void>;
};

export const PUBLIC_AGENTS_CHAT_STREAM_WRITE_DEADLINE_MS = 2_000;

export class PublicAgentsChatStreamWriteDeadlineError extends Error {
	readonly code = "public_agents_chat_stream_write_deadline_exceeded";

	constructor(timeoutMs: number) {
		super(`public agents chat SSE write exceeded ${timeoutMs}ms`);
		this.name = "PublicAgentsChatStreamWriteDeadlineError";
	}
}

/**
 * Browser transport is not part of the durable agent execution contract. A
 * disconnected or backpressured SSE consumer must therefore have a bounded
 * wait and may never stop Hono from draining the agents bridge to its terminal
 * result, persistence and continuation registration.
 */
export async function writePublicAgentsChatSseWithinDeadline(
	writer: PublicAgentsChatStreamWriter,
	frame: PublicAgentsChatSseFrame,
	timeoutMs = PUBLIC_AGENTS_CHAT_STREAM_WRITE_DEADLINE_MS,
): Promise<void> {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		throw new Error("public agents chat SSE write deadline must be positive");
	}
	let timeout: ReturnType<typeof setTimeout> | null = null;
	try {
		await Promise.race([
			writer.writeSSE(frame),
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(() => {
					reject(new PublicAgentsChatStreamWriteDeadlineError(timeoutMs));
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}
