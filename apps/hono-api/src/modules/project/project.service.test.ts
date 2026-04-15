import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";
import type { FlowRow } from "../flow/flow.repo";
import type { ProjectRow } from "./project.repo";

const {
	createProject,
	findLatestProjectForOwnerByNamePrefix,
	getProjectById,
	getProjectForOwner,
	listFlowsByProject,
	prisma,
	transactionClient,
} = vi.hoisted(() => ({
	createProject: vi.fn(),
	findLatestProjectForOwnerByNamePrefix: vi.fn(),
	getProjectById: vi.fn(),
	getProjectForOwner: vi.fn(),
	listFlowsByProject: vi.fn(),
	prisma: {
		flows: {
			create: vi.fn(),
		},
		$transaction: vi.fn(),
	},
	transactionClient: {
		flows: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
			createMany: vi.fn(),
		},
		flow_versions: {
			deleteMany: vi.fn(),
		},
		projects: {
			update: vi.fn(),
		},
	},
}));

vi.mock("./project.repo", async () => {
	const actual = await vi.importActual<typeof import("./project.repo")>(
		"./project.repo",
	);
	return {
		...actual,
		createProject,
		findLatestProjectForOwnerByNamePrefix,
		getProjectById,
		getProjectForOwner,
	};
});

vi.mock("../flow/flow.repo", async () => {
	const actual = await vi.importActual<typeof import("../flow/flow.repo")>(
		"../flow/flow.repo",
	);
	return {
		...actual,
		listFlowsByProject,
	};
});

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => prisma,
}));

import { cloneProjectForUser } from "./project.service";

type TransactionCallback = (
	tx: typeof transactionClient,
) => Promise<unknown> | unknown;

function createContext(): AppContext {
	return {
		env: { DB: {} } as AppContext["env"],
	} as AppContext;
}

function createProjectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
	return {
		id: "project-1",
		name: "七十二变（0327）",
		is_public: 0,
		owner_id: "user-1",
		created_at: "2026-03-29T00:00:00.000Z",
		updated_at: "2026-03-29T00:00:00.000Z",
		owner_login: "phone_1273",
		owner_name: "phone_1273",
		template_title: null,
		template_description: null,
		template_cover_url: null,
		...overrides,
	};
}

function createFlowRow(overrides: Partial<FlowRow> = {}): FlowRow {
	return {
		id: "flow-1",
		name: "第一章",
		data: JSON.stringify({ nodes: [], edges: [] }),
		owner_id: "user-1",
		project_id: "project-1",
		created_at: "2026-03-29T00:00:00.000Z",
		updated_at: "2026-03-29T00:00:00.000Z",
		...overrides,
	};
}

describe("cloneProjectForUser replay clone reuse", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listFlowsByProject.mockResolvedValue([
			createFlowRow({ id: "flow-a", name: "分镜 A" }),
			createFlowRow({ id: "flow-b", name: "分镜 B" }),
		]);
		transactionClient.flows.findMany.mockResolvedValue([]);
		transactionClient.flows.deleteMany.mockResolvedValue({ count: 0 });
		transactionClient.flows.createMany.mockResolvedValue({ count: 0 });
		transactionClient.flow_versions.deleteMany.mockResolvedValue({ count: 0 });
		transactionClient.projects.update.mockResolvedValue(undefined);
		prisma.flows.create.mockResolvedValue(undefined);
		prisma.$transaction.mockImplementation(async (callback: unknown) => {
			if (typeof callback !== "function") {
				throw new Error("Expected transaction callback");
			}
			return await (callback as TransactionCallback)(transactionClient);
		});
	});

	it("reuses an existing local replay project and refreshes its flows", async () => {
		const sourceProject = createProjectRow({ id: "source-project" });
		const replayProject = createProjectRow({
			id: "replay-project",
			name: "七十二变（0327） local replay 2026-03-29T03-27-01-177Z",
		});

		getProjectById.mockResolvedValue(sourceProject);
		findLatestProjectForOwnerByNamePrefix.mockResolvedValue(replayProject);
		getProjectForOwner.mockResolvedValue(replayProject);
		transactionClient.flows.findMany.mockResolvedValue([{ id: "old-flow-1" }]);

		const result = await cloneProjectForUser(
			createContext(),
			"user-1",
			"source-project",
			"七十二变（0327） local replay 2026-03-29T03-30-28-745Z",
		);

		expect(findLatestProjectForOwnerByNamePrefix).toHaveBeenCalledWith(
			expect.anything(),
			{
				ownerId: "user-1",
				namePrefix: "七十二变（0327） local replay ",
				excludeProjectId: "source-project",
			},
		);
		expect(createProject).not.toHaveBeenCalled();
		expect(prisma.flows.create).not.toHaveBeenCalled();
		expect(transactionClient.flow_versions.deleteMany).toHaveBeenCalledWith({
			where: { flow_id: { in: ["old-flow-1"] } },
		});
		expect(transactionClient.flows.deleteMany).toHaveBeenCalledWith({
			where: {
				project_id: "replay-project",
				owner_id: "user-1",
			},
		});
		expect(transactionClient.flows.createMany).toHaveBeenCalledWith({
			data: [
				expect.objectContaining({
					name: "分镜 A",
					data: JSON.stringify({ nodes: [], edges: [] }),
					owner_id: "user-1",
					project_id: "replay-project",
				}),
				expect.objectContaining({
					name: "分镜 B",
					data: JSON.stringify({ nodes: [], edges: [] }),
					owner_id: "user-1",
					project_id: "replay-project",
				}),
			],
		});
		expect(transactionClient.projects.update).toHaveBeenCalledWith({
			where: { id: "replay-project" },
			data: expect.objectContaining({
				name: "七十二变（0327） local replay 2026-03-29T03-30-28-745Z",
			}),
		});
		expect(result).toMatchObject({ id: "replay-project" });
	});

	it("recognizes local direct replay names and reuses the existing replay project", async () => {
		const sourceProject = createProjectRow({ id: "source-project" });
		const replayProject = createProjectRow({
			id: "direct-replay-project",
			name: "七十二变（0327） local direct replay 2026-03-29T03-38-42-105Z",
		});

		getProjectById.mockResolvedValue(sourceProject);
		findLatestProjectForOwnerByNamePrefix.mockResolvedValue(replayProject);
		getProjectForOwner.mockResolvedValue(replayProject);

		const result = await cloneProjectForUser(
			createContext(),
			"user-1",
			"source-project",
			"七十二变（0327） local direct replay 2026-03-29T04-00-00-000Z",
		);

		expect(findLatestProjectForOwnerByNamePrefix).toHaveBeenCalledWith(
			expect.anything(),
			{
				ownerId: "user-1",
				namePrefix: "七十二变（0327） local direct replay ",
				excludeProjectId: "source-project",
			},
		);
		expect(transactionClient.flow_versions.deleteMany).not.toHaveBeenCalled();
		expect(createProject).not.toHaveBeenCalled();
		expect(result).toMatchObject({ id: "direct-replay-project" });
	});

	it("creates a fresh replay project when no prior replay clone exists", async () => {
		const sourceProject = createProjectRow({ id: "source-project" });
		const clonedProject = createProjectRow({
			id: "new-replay-project",
			name: "七十二变（0327） local replay 2026-03-29T05-00-00-000Z",
		});

		getProjectById.mockResolvedValue(sourceProject);
		findLatestProjectForOwnerByNamePrefix.mockResolvedValue(null);
		createProject.mockResolvedValue(clonedProject);

		const result = await cloneProjectForUser(
			createContext(),
			"user-1",
			"source-project",
			"七十二变（0327） local replay 2026-03-29T05-00-00-000Z",
		);

		expect(createProject).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				name: "七十二变（0327） local replay 2026-03-29T05-00-00-000Z",
				ownerId: "user-1",
			}),
		);
		expect(prisma.flows.create).toHaveBeenCalledTimes(2);
		expect(result).toMatchObject({ id: "new-replay-project" });
	});

	it("keeps normal clone names on the original create-new-project path", async () => {
		const sourceProject = createProjectRow({ id: "source-project" });
		const clonedProject = createProjectRow({
			id: "plain-clone-project",
			name: "七十二变（0327） 自定义副本",
		});

		getProjectById.mockResolvedValue(sourceProject);
		createProject.mockResolvedValue(clonedProject);

		const result = await cloneProjectForUser(
			createContext(),
			"user-1",
			"source-project",
			"七十二变（0327） 自定义副本",
		);

		expect(findLatestProjectForOwnerByNamePrefix).not.toHaveBeenCalled();
		expect(createProject).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				name: "七十二变（0327） 自定义副本",
				ownerId: "user-1",
			}),
		);
		expect(prisma.$transaction).not.toHaveBeenCalled();
		expect(prisma.flows.create).toHaveBeenCalledTimes(2);
		expect(result).toMatchObject({ id: "plain-clone-project" });
	});
});
