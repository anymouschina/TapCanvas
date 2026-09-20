import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";
import { listProjectNodeAssetsForOwner } from "./material.project-node-assets.service";
import { projectNodeAssetsFromCanvases } from "./material.project-node-assets";
import { listProjectNodeVersionsForOwner } from "./material.project-node-versions";

vi.mock("./material.project-node-assets.service", () => ({
	listProjectNodeAssetsForOwner: vi.fn(),
}));

describe("project node version lookup", () => {
	const context = { env: { DB: {} } } as AppContext;
	const assets = projectNodeAssetsFromCanvases([{
		projectId: "project-1", ownerType: "project", ownerId: "project-1", flowId: "flow-1",
		canvasRevision: 7, createdAt: "2026-09-07", updatedAt: "2026-09-07",
		data: { nodes: [{ id: "output::video", type: "taskNode", data: {
			label: "Video", videoUrl: "https://media.example.test/video.mp4",
		} }] },
	}]);
	beforeEach(() => { vi.mocked(listProjectNodeAssetsForOwner).mockReset(); });

	it("resolves the exact listed identity, preserving media and revision without inventing history", async () => {
		vi.mocked(listProjectNodeAssetsForOwner).mockResolvedValue(assets);
		const result = await listProjectNodeVersionsForOwner(context, "user-1", {
			projectId: "project-1", assetId: assets[0]!.id,
		});
		expect(result).toEqual([assets[0]!.latestVersion]);
		expect(result[0]?.data.videoUrl).toBe("https://media.example.test/video.mp4");
		expect(listProjectNodeAssetsForOwner).toHaveBeenCalledWith(context, "user-1", { projectId: "project-1" });
	});

	it("rejects identities absent from the authorized projection", async () => {
		vi.mocked(listProjectNodeAssetsForOwner).mockResolvedValue(assets);
		await expect(listProjectNodeVersionsForOwner(context, "user-1", {
			projectId: "project-1", assetId: "project-node:project:another-project:output::video",
		})).rejects.toMatchObject({ code: "project_node_material_not_found", status: 404 });
	});

	it("propagates access failures without reading another material source", async () => {
		const denied = new Error("Project access denied");
		vi.mocked(listProjectNodeAssetsForOwner).mockRejectedValue(denied);
		await expect(listProjectNodeVersionsForOwner(context, "user-2", {
			projectId: "project-1", assetId: assets[0]!.id,
		})).rejects.toBe(denied);
	});
});
