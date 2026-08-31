import { describe, expect, it } from "vitest";
import { resolveBeatSheetCanvasSource } from "./video-orchestrator.source-authority";

describe("resolveBeatSheetCanvasSource", () => {
	it("always selects the server-owned chapter seed even when the Agent submits a stale script node", () => {
		const result = resolveBeatSheetCanvasSource({
			flowId: "chapter-1",
			chapterId: "chapter-1",
			requestedSourceNodeId: "old-authoritative-looking-script",
			nodes: [
				{
					id: "chapter-seed-chapter-1",
					data: { kind: "text", content: "当前章节：Boss 残血反杀，随后拉出游戏。" },
				},
				{
					id: "old-authoritative-looking-script",
					data: { kind: "text", content: "旧剧情：主角击杀 Boss。" },
				},
			],
		});

		expect(result).toEqual({
			nodeId: "chapter-seed-chapter-1",
			kind: "chapter",
			sourceId: "chapter-1",
			text: "当前章节：Boss 残血反杀，随后拉出游戏。",
			selection: "server_canonical_chapter_seed",
			ignoredRequestedSourceNodeId: "old-authoritative-looking-script",
		});
	});

	it("selects the chapter seed without requiring the Agent to submit sourceNodeId", () => {
		const result = resolveBeatSheetCanvasSource({
			flowId: "chapter-1",
			chapterId: "chapter-1",
			nodes: [{
				id: "chapter-seed-chapter-1",
				data: { kind: "text", chapterText: "唯一真源" },
			}],
		});

		expect(result.nodeId).toBe("chapter-seed-chapter-1");
		expect(result.text).toBe("唯一真源");
		expect(result.ignoredRequestedSourceNodeId).toBeNull();
	});

	it("fails closed when a chapter has no canonical seed", () => {
		expect(() => resolveBeatSheetCanvasSource({
			flowId: "chapter-1",
			chapterId: "chapter-1",
			requestedSourceNodeId: "old-script",
			nodes: [{ id: "old-script", data: { kind: "text", content: "旧剧情" } }],
		})).toThrow(/beat_sheet_canonical_chapter_source_missing/u);
	});

	it("keeps the explicit source-node contract for a free-form canvas", () => {
		const result = resolveBeatSheetCanvasSource({
			flowId: "flow-1",
			requestedSourceNodeId: "script-1",
			nodes: [{ id: "script-1", data: { kind: "text", content: "自由画布正文" } }],
		});

		expect(result).toMatchObject({
			nodeId: "script-1",
			kind: "canvas_text_node",
			sourceId: "flow-1:script-1",
			text: "自由画布正文",
			selection: "explicit_canvas_text_node",
		});
	});
});
