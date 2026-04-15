import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteProjectGraph } = vi.hoisted(() => ({
	deleteProjectGraph: vi.fn(),
}));

vi.mock("./project-delete", () => ({
	deleteProjectGraph,
}));

import { deleteProjectById } from "./project.repo";

describe("deleteProjectById", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("delegates project deletion to deleteProjectGraph", async () => {
		deleteProjectGraph.mockResolvedValue(undefined);

		await deleteProjectById({} as never, "project-123");

		expect(deleteProjectGraph).toHaveBeenCalledWith("project-123");
		expect(deleteProjectGraph).toHaveBeenCalledTimes(1);
	});
});
