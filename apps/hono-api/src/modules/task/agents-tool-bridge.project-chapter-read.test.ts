import { describe, expect, it } from "vitest";

import type { CanvasFlow } from "../chapter/chapter.canvas-flow.schemas";
import type { ChapterDto } from "../chapter/chapter.schemas";
import { buildProjectChapterReadPayload } from "./agents-tool-bridge.project-chapter-read";

const manualChapter: ChapterDto = {
  id: "chapter-manual-1",
  projectId: "project-1",
  index: 1,
  title: "第 1 章 · 登船",
  summary: "主角第一次进入方舟世界。",
  status: "draft",
  sortOrder: 0,
  createdAt: "2026-08-18T12:00:00.000Z",
  updatedAt: "2026-08-18T12:00:00.000Z",
};

describe("buildProjectChapterReadPayload", () => {
  it("keeps a manual chapter visible even before its independent canvas is initialized", () => {
    const result = buildProjectChapterReadPayload({
      chapter: manualChapter,
      revision: 0,
      flow: null,
      args: {},
    });

    expect(result.sourceKind).toBe("manual");
    expect(result.canvasRevision).toBe(0);
    expect(result.sourceHash).toBeNull();
    expect(result.chapter.summary).toBe("主角第一次进入方舟世界。");
    expect(result.canvas).toMatchObject({
      initialized: false,
      revision: 0,
      nodeCount: 0,
      edgeCount: 0,
      nodes: [],
    });
  });

  it("returns slim chapter-canvas facts first and selected semantic fields on demand", () => {
    const flow = {
      nodes: [
        {
          id: "chapter-source",
          type: "default",
          position: { x: 0, y: 0 },
          data: {
            kind: "text",
            label: "本章构思",
            content: "飞船离港，舷窗外出现方舟入口。",
            privateDraft: "不应在未请求时返回",
          },
        },
      ],
      edges: [],
    } satisfies CanvasFlow;

    const slim = buildProjectChapterReadPayload({
      chapter: manualChapter,
      revision: 3,
      flow,
      args: {},
    });
    expect(slim.canvas.selectionMode).toBe("slim");
    expect(slim.canvas.nodes).toEqual([
      expect.objectContaining({ id: "chapter-source", label: "本章构思", kind: "text" }),
    ]);
    expect(JSON.stringify(slim.canvas.nodes)).not.toContain("飞船离港");

    const detailed = buildProjectChapterReadPayload({
      chapter: manualChapter,
      revision: 3,
      flow,
      args: { nodeIds: ["chapter-source"], fields: ["content"] },
    });
    expect(detailed.canvas.selectionMode).toBe("full");
    expect(detailed.canvas.nodes).toEqual([
      expect.objectContaining({
        id: "chapter-source",
        data: expect.objectContaining({ content: "飞船离港，舷窗外出现方舟入口。" }),
      }),
    ]);
    expect(JSON.stringify(detailed.canvas.nodes)).not.toContain("privateDraft");
  });

  it("returns revision, source hash, and preview contract before a potentially long chapter body", () => {
    const storyPreviewContract = {
      schemaVersion: "story-preview-contract/v1",
      storyDurationSeconds: 60,
      previewWindow: { startSeconds: 0, endSeconds: 15 },
      frameIntervalSeconds: 1,
      requiredReferences: [],
    };
    const flow = {
      nodes: [
        {
          id: "chapter-seed-chapter-manual-1",
          type: "default",
          position: { x: 0, y: 0 },
          data: {
            kind: "text",
            sourceHash: "source-hash-464",
            storyPreviewContract,
          },
        },
      ],
      edges: [],
    } satisfies CanvasFlow;

    const result = buildProjectChapterReadPayload({
      chapter: manualChapter,
      revision: 464,
      flow,
      args: {},
    });

    expect(Object.keys(result).slice(0, 4)).toEqual([
      "canvasRevision",
      "sourceHash",
      "sourceNodeId",
      "storyPreviewContract",
    ]);
    expect(result.canvasRevision).toBe(464);
    expect(result.sourceHash).toBe("source-hash-464");
    expect(result.sourceNodeId).toBe("chapter-seed-chapter-manual-1");
    expect(result.storyPreviewContract).toEqual(storyPreviewContract);
  });
});
