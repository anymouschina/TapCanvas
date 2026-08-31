import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";

const rootState = vi.hoisted(() => ({ value: "" }));
const projectRepoMocks = vi.hoisted(() => ({ getProjectForOwner: vi.fn() }));

vi.mock("../asset/project-data-root", () => ({
	resolveProjectDataRepoRoot: () => rootState.value,
}));

vi.mock("../project/project.repo", () => ({
	getProjectForOwner: projectRepoMocks.getProjectForOwner,
}));

import {
	ensureProjectWorkspaceContextFiles,
	getProjectWorkspaceContext,
	updateProjectWorkspaceContextFile,
} from "./project-context.service";

describe("project creative brief", () => {
	beforeEach(async () => {
		rootState.value = await fs.mkdtemp(path.join(os.tmpdir(), "tapcanvas-project-brief-"));
		projectRepoMocks.getProjectForOwner.mockResolvedValue({ id: "project-a", name: "Project A" });
	});

	afterEach(async () => {
		if (rootState.value) await fs.rm(rootState.value, { recursive: true, force: true });
		rootState.value = "";
	});

	it("persists CREATIVE_BRIEF.md inside the owning project context", async () => {
		const c = {} as AppContext;
		await updateProjectWorkspaceContextFile({
			c,
			ownerId: "owner-a",
			projectId: "project-a",
			fileName: "CREATIVE_BRIEF.md",
			content: "# 创作简报\n\n一部发生在雨夜的悬疑短片。\n",
		});

		const ownerContext = await getProjectWorkspaceContext({
			c,
			ownerId: "owner-a",
			projectId: "project-a",
		});
		const otherOwnerContext = await getProjectWorkspaceContext({
			c,
			ownerId: "owner-b",
			projectId: "project-a",
		});

		expect(ownerContext.projectFiles).toEqual([
			expect.objectContaining({
				path: ".tapcanvas/context/CREATIVE_BRIEF.md",
				content: "# 创作简报\n\n一部发生在雨夜的悬疑短片。\n",
			}),
		]);
		expect(otherOwnerContext.projectFiles).toEqual([]);
	});

	it("does not overwrite the saved brief when generated project context refreshes", async () => {
		const c = { env: { DB: {} } } as AppContext;
		await updateProjectWorkspaceContextFile({
			c,
			ownerId: "owner-a",
			projectId: "project-a",
			fileName: "CREATIVE_BRIEF.md",
			content: "# Locked brief\n",
		});

		await ensureProjectWorkspaceContextFiles({
			c,
			ownerId: "owner-a",
			projectId: "project-a",
		});

		const context = await getProjectWorkspaceContext({
			c,
			ownerId: "owner-a",
			projectId: "project-a",
		});
		expect(context.projectFiles.find((file) => file.path.endsWith("CREATIVE_BRIEF.md"))?.content)
			.toBe("# Locked brief\n");
	});
});
