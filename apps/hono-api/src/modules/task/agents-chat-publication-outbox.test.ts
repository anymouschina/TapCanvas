import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

const taskStatusMocks = vi.hoisted(() => ({
	createTaskStatusIfAbsent: vi.fn(),
	listTaskStatusesByProvider: vi.fn(),
	requeueStaleClaimedTaskStatuses: vi.fn(),
	tryClaimTaskStatus: vi.fn(),
	upsertTaskStatus: vi.fn(),
}));

const publicationMocks = vi.hoisted(() => ({
	persistAgentsChatConversationTurn: vi.fn(),
}));

vi.mock("./task-status.repo", () => taskStatusMocks);
vi.mock("../apiKey/public-agents-chat-response", async (importOriginal) => ({
	...(await importOriginal<typeof import("../apiKey/public-agents-chat-response")>()),
	persistAgentsChatConversationTurn: publicationMocks.persistAgentsChatConversationTurn,
}));

import {
	AGENTS_CHAT_PUBLICATION_PROVIDER,
	completeAgentsChatPublication,
	deferAgentsChatPublication,
	parseAgentsChatPublicationContractV1,
	registerAgentsChatPublication,
	sweepAgentsChatPublications,
	type AgentsChatPublicationContractV1,
} from "./agents-chat-publication-outbox";

const request = {
	prompt: "完成已受理任务",
	sessionKey: "project:1:conversation:publication",
};

const response = {
	id: "response-1",
	vendor: "agents",
	text: "交付完成",
	trace: { requestId: "public-turn-1" },
};

const result = {
	id: "result-1",
	kind: "chat" as const,
	status: "succeeded" as const,
	assets: [],
	raw: null,
};

function createContext(): AppContext {
	return { env: { DB: {} } } as unknown as AppContext;
}

function createContract(
	overrides: Partial<AgentsChatPublicationContractV1> = {},
): AgentsChatPublicationContractV1 {
	return {
		version: 1,
		id: "agents-chat-publication:physical-run-2",
		userId: "user-1",
		publicationId: "physical-run-2",
		publicTurnId: "public-turn-1",
		publicationMode: "assistant_only",
		request,
		response,
		result,
		createdAt: "2026-08-14T00:00:00.000Z",
		attempt: 0,
		lastError: null,
		...overrides,
	};
}

describe("agents chat publication outbox", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		taskStatusMocks.createTaskStatusIfAbsent.mockResolvedValue(true);
		taskStatusMocks.requeueStaleClaimedTaskStatuses.mockResolvedValue(0);
		taskStatusMocks.listTaskStatusesByProvider.mockResolvedValue([]);
		taskStatusMocks.tryClaimTaskStatus.mockResolvedValue(true);
		taskStatusMocks.upsertTaskStatus.mockResolvedValue(undefined);
		publicationMocks.persistAgentsChatConversationTurn.mockResolvedValue(undefined);
	});

	it("keeps physical publication identity separate from the stable public turn", async () => {
		const contract = await registerAgentsChatPublication({
			c: createContext(),
			userId: "user-1",
			publicationId: "physical-run-2",
			publicTurnId: "public-turn-1",
			publicationMode: "assistant_only",
			request,
			response,
			result,
		});

		expect(contract.id).toBe("agents-chat-publication:physical-run-2");
		expect(taskStatusMocks.createTaskStatusIfAbsent).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				taskId: "agents-chat-publication:physical-run-2",
				status: "claimed",
			}),
		);
	});

	it("rejects a response correlated to a different public turn", () => {
		expect(parseAgentsChatPublicationContractV1(createContract({
			publicTurnId: "different-turn",
		}))).toBeNull();
	});

	it("replays the exact publication mode and id before completing the outbox", async () => {
		const contract = createContract();
		taskStatusMocks.listTaskStatusesByProvider.mockResolvedValue([{
			id: "row-1",
			task_id: contract.id,
			provider: AGENTS_CHAT_PUBLICATION_PROVIDER,
			user_id: contract.userId,
			status: "waiting",
			data: JSON.stringify(contract),
			created_at: contract.createdAt,
			updated_at: contract.createdAt,
			completed_at: null,
		}]);

		const sweep = await sweepAgentsChatPublications({ c: createContext() });

		expect(sweep).toMatchObject({ scanned: 1, published: 1, failed: 0, invalid: 0 });
		expect(publicationMocks.persistAgentsChatConversationTurn).toHaveBeenCalledWith(
			expect.objectContaining({
				publicationId: "physical-run-2",
				publicationMode: "assistant_only",
			}),
		);
		expect(taskStatusMocks.upsertTaskStatus).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ status: "completed" }),
		);
	});

	it("moves malformed durable rows to failed instead of scanning them forever", async () => {
		taskStatusMocks.listTaskStatusesByProvider.mockResolvedValue([{
			id: "row-invalid",
			task_id: "agents-chat-publication:invalid",
			provider: AGENTS_CHAT_PUBLICATION_PROVIDER,
			user_id: "user-1",
			status: "waiting",
			data: "{not-json",
			created_at: "2026-08-14T00:00:00.000Z",
			updated_at: "2026-08-14T00:00:00.000Z",
			completed_at: null,
		}]);

		const sweep = await sweepAgentsChatPublications({ c: createContext() });

		expect(sweep.invalid).toBe(1);
		expect(taskStatusMocks.upsertTaskStatus).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				taskId: "agents-chat-publication:invalid",
				status: "failed",
			}),
		);
	});

	it("preserves a waiting contract when publication fails before the retry budget", async () => {
		const contract = createContract();
		taskStatusMocks.listTaskStatusesByProvider.mockResolvedValue([{
			id: "row-1",
			task_id: contract.id,
			provider: AGENTS_CHAT_PUBLICATION_PROVIDER,
			user_id: contract.userId,
			status: "waiting",
			data: JSON.stringify(contract),
			created_at: contract.createdAt,
			updated_at: contract.createdAt,
			completed_at: null,
		}]);
		publicationMocks.persistAgentsChatConversationTurn.mockRejectedValue(
			new Error("conversation database unavailable"),
		);

		const sweep = await sweepAgentsChatPublications({ c: createContext() });

		expect(sweep).toMatchObject({ published: 0, failed: 0 });
		expect(taskStatusMocks.upsertTaskStatus).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				status: "waiting",
				data: expect.objectContaining({ attempt: 1 }),
			}),
		);
	});

	it("can explicitly mark a registered publication complete", async () => {
		await completeAgentsChatPublication({ c: createContext(), contract: createContract() });
		expect(taskStatusMocks.upsertTaskStatus).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ status: "completed" }),
		);
	});

	it("releases a direct publisher claim immediately after conversation projection fails", async () => {
		await deferAgentsChatPublication({
			c: createContext(),
			contract: createContract(),
			error: new Error("conversation unavailable"),
		});
		expect(taskStatusMocks.upsertTaskStatus).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				status: "waiting",
				data: expect.objectContaining({ attempt: 1, lastError: "conversation unavailable" }),
			}),
		);
	});
});
