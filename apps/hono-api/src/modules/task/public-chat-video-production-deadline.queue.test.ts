import { describe, expect, it } from "vitest";

import { buildPublicChatVideoProductionDeadlineJobId } from "./public-chat-video-production-deadline.queue";

describe("public chat video production deadline queue identity", () => {
	it("keeps the initial deadline probe stable", () => {
		const job = {
			version: 2 as const,
			userId: "user-1",
			sessionKey: "session-1",
			publicTurnId: "turn-1",
			rootTraceId: "turn-1",
			deadlineAt: "2026-08-28T00:05:00.000Z",
		};
		expect(buildPublicChatVideoProductionDeadlineJobId(job))
			.toBe(buildPublicChatVideoProductionDeadlineJobId({ ...job }));
	});

	it("uses a distinct id for the contract-backed enforcement job", () => {
		const job = {
			version: 2 as const,
			userId: "user-1",
			sessionKey: "session-1",
			publicTurnId: "turn-1",
			rootTraceId: "turn-1",
			deadlineAt: "2026-08-28T00:05:00.000Z",
		};
		expect(buildPublicChatVideoProductionDeadlineJobId(job)).not.toBe(
			buildPublicChatVideoProductionDeadlineJobId({
				...job,
				userIntentContract: { contractHash: "contract-1" },
			}),
		);
	});
});
