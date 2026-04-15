import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	prisma,
	transactionClient,
} = vi.hoisted(() => ({
	prisma: {
		$transaction: vi.fn(),
	},
	transactionClient: {
		flows: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
		},
		flow_versions: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
		},
		workflow_executions: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
		},
		workflow_execution_events: {
			deleteMany: vi.fn(),
		},
		workflow_node_runs: {
			deleteMany: vi.fn(),
		},
		video_generation_histories: {
			deleteMany: vi.fn(),
		},
		agent_pipeline_runs: {
			deleteMany: vi.fn(),
		},
		assets: {
			deleteMany: vi.fn(),
		},
		chapters: {
			deleteMany: vi.fn(),
		},
		projects: {
			delete: vi.fn(),
		},
	},
}));

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => prisma,
}));

import { deleteProjectGraph } from "./project-delete";

type TransactionCallback = (
	tx: typeof transactionClient,
) => Promise<unknown> | unknown;

describe("deleteProjectGraph", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		prisma.$transaction.mockImplementation(async (callback: unknown) => {
			if (typeof callback !== "function") {
				throw new Error("Expected transaction callback");
			}
			return await (callback as TransactionCallback)(transactionClient);
		});
		transactionClient.flows.findMany.mockResolvedValue([]);
		transactionClient.flow_versions.findMany.mockResolvedValue([]);
		transactionClient.workflow_executions.findMany.mockResolvedValue([]);
		transactionClient.workflow_node_runs.deleteMany.mockResolvedValue({ count: 0 });
		transactionClient.workflow_execution_events.deleteMany.mockResolvedValue({
			count: 0,
		});
		transactionClient.workflow_executions.deleteMany.mockResolvedValue({
			count: 0,
		});
		transactionClient.flow_versions.deleteMany.mockResolvedValue({ count: 0 });
		transactionClient.flows.deleteMany.mockResolvedValue({ count: 0 });
		transactionClient.video_generation_histories.deleteMany.mockResolvedValue({
			count: 0,
		});
		transactionClient.agent_pipeline_runs.deleteMany.mockResolvedValue({
			count: 0,
		});
		transactionClient.assets.deleteMany.mockResolvedValue({ count: 0 });
		transactionClient.chapters.deleteMany.mockResolvedValue({ count: 0 });
		transactionClient.projects.delete.mockResolvedValue({ id: "project-1" });
	});

	it("deletes chapter and workflow dependents before deleting the project", async () => {
		transactionClient.flows.findMany.mockResolvedValue([{ id: "flow-1" }]);
		transactionClient.flow_versions.findMany.mockResolvedValue([
			{ id: "flow-version-1" },
		]);
		transactionClient.workflow_executions.findMany.mockResolvedValue([
			{ id: "execution-1" },
		]);

		await deleteProjectGraph("project-1");

		expect(transactionClient.workflow_node_runs.deleteMany).toHaveBeenCalledWith({
			where: { execution_id: { in: ["execution-1"] } },
		});
		expect(
			transactionClient.workflow_execution_events.deleteMany,
		).toHaveBeenCalledWith({
			where: { execution_id: { in: ["execution-1"] } },
		});
		expect(transactionClient.workflow_executions.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["execution-1"] } },
		});
		expect(transactionClient.flow_versions.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["flow-version-1"] } },
		});
		expect(transactionClient.flows.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["flow-1"] } },
		});
		expect(transactionClient.video_generation_histories.deleteMany).toHaveBeenCalledWith({
			where: { project_id: "project-1" },
		});
		expect(transactionClient.agent_pipeline_runs.deleteMany).toHaveBeenCalledWith({
			where: { project_id: "project-1" },
		});
		expect(transactionClient.assets.deleteMany).toHaveBeenCalledWith({
			where: { project_id: "project-1" },
		});
		expect(transactionClient.chapters.deleteMany).toHaveBeenCalledWith({
			where: { project_id: "project-1" },
		});
		expect(transactionClient.projects.delete).toHaveBeenCalledWith({
			where: { id: "project-1" },
		});
	});

	it("still deletes direct project dependents when the project has no flows", async () => {
		await deleteProjectGraph("project-2");

		expect(transactionClient.flow_versions.findMany).not.toHaveBeenCalled();
		expect(transactionClient.workflow_executions.findMany).not.toHaveBeenCalled();
		expect(transactionClient.workflow_node_runs.deleteMany).not.toHaveBeenCalled();
		expect(
			transactionClient.workflow_execution_events.deleteMany,
		).not.toHaveBeenCalled();
		expect(transactionClient.workflow_executions.deleteMany).not.toHaveBeenCalled();
		expect(transactionClient.chapters.deleteMany).toHaveBeenCalledWith({
			where: { project_id: "project-2" },
		});
		expect(transactionClient.projects.delete).toHaveBeenCalledWith({
			where: { id: "project-2" },
		});
	});
});
