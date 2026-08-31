import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";

const mocks = vi.hoisted(() => ({
	getProjectForUserAccess: vi.fn(),
	findFlow: vi.fn(),
	findChapter: vi.fn(),
	findExecution: vi.fn(),
}));

vi.mock("../project/project.repo", () => ({
	getProjectForUserAccess: mocks.getProjectForUserAccess,
}));

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => ({
		flows: { findFirst: mocks.findFlow },
		chapters: { findFirst: mocks.findChapter },
		workflow_executions: { findFirst: mocks.findExecution },
	}),
}));

import { resolveAuthorizedGenerationAssetContext } from "./generation-asset-context";

function context(): AppContext {
	return { env: { DB: {} } } as AppContext;
}

const request = {
	extras: {
		generationContext: {
			projectId: "project-1",
			flowId: "flow-1",
			chapterId: "chapter-1",
			nodeId: "node-1",
			workflowExecutionId: "execution-1",
		},
	},
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getProjectForUserAccess.mockResolvedValue({ id: "project-1" });
	mocks.findFlow.mockResolvedValue({ id: "flow-1" });
	mocks.findChapter.mockResolvedValue({ id: "chapter-1" });
	mocks.findExecution.mockResolvedValue({ id: "execution-1" });
});

describe("generation asset context authorization", () => {
	it("validates every declared project relation before provider submission", async () => {
		await expect(resolveAuthorizedGenerationAssetContext(
			context(),
			"user-1",
			request,
		)).resolves.toEqual(request.extras.generationContext);

		expect(mocks.getProjectForUserAccess).toHaveBeenCalledWith(
			expect.anything(),
			"project-1",
			"user-1",
		);
		expect(mocks.findFlow).toHaveBeenCalledWith(expect.objectContaining({
			where: { id: "flow-1", project_id: "project-1" },
		}));
		expect(mocks.findChapter).toHaveBeenCalledWith(expect.objectContaining({
			where: { id: "chapter-1", project_id: "project-1" },
		}));
		expect(mocks.findExecution).toHaveBeenCalledWith(expect.objectContaining({
			where: { id: "execution-1", project_id: "project-1" },
		}));
	});

	it("rejects an inaccessible project before checking child relations", async () => {
		mocks.getProjectForUserAccess.mockResolvedValue(null);

		await expect(resolveAuthorizedGenerationAssetContext(
			context(),
			"user-1",
			request,
		)).rejects.toMatchObject({ code: "generation_asset_project_forbidden" });
		expect(mocks.findFlow).not.toHaveBeenCalled();
	});

	it("rejects a flow from another project", async () => {
		mocks.findFlow.mockResolvedValue(null);

		await expect(resolveAuthorizedGenerationAssetContext(
			context(),
			"user-1",
			request,
		)).rejects.toMatchObject({
			code: "generation_asset_flow_project_mismatch",
		});
		expect(mocks.findChapter).not.toHaveBeenCalled();
	});
});
