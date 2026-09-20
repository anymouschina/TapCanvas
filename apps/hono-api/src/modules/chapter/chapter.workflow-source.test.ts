import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { projectChapterNarrativeSnapshot, readBoundBookChapterText } from "./chapter.workflow-source";
import { projectNodeAssetsFromCanvases } from "../material/material.project-node-assets";
import { createWorkflowProjectContext } from "../execution/execution.project-context";
import { readWorkflowCanvasProjectContextFromFlowData } from "../execution/execution.canvas-source-runner";

describe("chapter workflow narrative snapshot", () => {
	it("executes an uninitialized chapter source without a browser save", () => {
		const flow = projectChapterNarrativeSnapshot({ chapterId: "c1", title: "第一章", text: "实际章节正文。", revision: 0, flow: null });
		const assets = projectNodeAssetsFromCanvases([{ projectId: "p1", ownerType: "chapter", ownerId: "c1", flowId: "chapter:c1",
			data: flow, canvasRevision: 0, createdAt: "2026-09-09T00:00:00Z", updatedAt: "2026-09-09T00:00:00Z" }]);
		const context = createWorkflowProjectContext({ projectId: "p1", canvasId: "chapter:c1", principalId: "u1",
			sourceNodeId: "chapter-seed-c1", canvasData: flow, assets, assetWrite: true });
		expect(() => readWorkflowCanvasProjectContextFromFlowData({ flowId: "chapter:c1", rowData: JSON.stringify(flow), projectContext: context })).not.toThrow();
		expect(context.assetSnapshot.some((asset) => asset.nodeId === "chapter-seed-c1" && asset.state === "ready")).toBe(true);
	});
	it("preserves unrelated assets and source contracts without mutating the saved canvas", () => {
		const flow = { nodes: [{ id: "chapter-seed-c1", data: { content: "陈旧页面", storyPreviewContract: { id: "contract" } } },
			{ id: "video1", data: { kind: "video", videoUrl: "https://assets.example/result.mp4" } }], edges: [] };
		const snapshot = projectChapterNarrativeSnapshot({ chapterId: "c1", title: "新标题", text: "权威正文", revision: 3, flow });
		expect(snapshot.nodes[1]).toBe(flow.nodes[1]);
		expect(snapshot.nodes[0].data).toMatchObject({ content: "权威正文", storyPreviewContract: { id: "contract" }, sourceChapterRevision: 3 });
		expect(flow.nodes[0].data.content).toBe("陈旧页面");
		expect(() => projectChapterNarrativeSnapshot({ chapterId: "c1", title: "章", text: "", revision: 0, flow })).toThrow("empty");
	});
	it("reads only the bound chapter range and rejects missing or invalid source facts", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tapcanvas-chapter-source-"));
		const raw = "第一章正文\n第二章正文";
		await fs.writeFile(path.join(directory, "raw.md"), raw);
		await fs.writeFile(path.join(directory, "index.json"), JSON.stringify({ bookId: "book1", projectId: "p1", chapters: [{ chapter: 1, startOffset: 0, endOffset: 6 }, { chapter: 2, startOffset: 6, endOffset: 999 }] }));
		expect(await readBoundBookChapterText(directory, 1)).toBe("第一章正文");
		await expect(readBoundBookChapterText(directory, 2)).rejects.toThrow("offsets");
		await expect(readBoundBookChapterText(directory, 3)).rejects.toThrow("missing");
	});
});
