import { describe, expect, it, vi } from "vitest";
import {
	PublicAgentsChatStreamWriteDeadlineError,
	writePublicAgentsChatSseWithinDeadline,
} from "./public-agents-chat-stream";

describe("writePublicAgentsChatSseWithinDeadline", () => {
	it("resolves after a writable consumer receives the frame", async () => {
		const writeSSE = vi.fn(async () => undefined);
		await writePublicAgentsChatSseWithinDeadline(
			{ writeSSE },
			{
				event: "content",
				data: "{}",
				id: "public-chat-turn:abc#7",
				retry: 500,
			},
			20,
		);
		expect(writeSSE).toHaveBeenCalledOnce();
		expect(writeSSE).toHaveBeenCalledWith(expect.objectContaining({
			id: "public-chat-turn:abc#7",
			retry: 500,
		}));
	});

	it("preserves an immediate transport failure", async () => {
		await expect(writePublicAgentsChatSseWithinDeadline(
			{ writeSSE: async () => { throw new Error("consumer closed"); } },
			{ event: "content", data: "{}" },
			20,
		)).rejects.toThrow("consumer closed");
	});

	it("bounds a backpressured write that never settles", async () => {
		await expect(writePublicAgentsChatSseWithinDeadline(
			{ writeSSE: () => new Promise<void>(() => undefined) },
			{ event: "content", data: "{}" },
			5,
		)).rejects.toBeInstanceOf(PublicAgentsChatStreamWriteDeadlineError);
	});
});
