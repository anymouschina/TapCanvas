import { describe, expect, it } from "vitest";

import type { FlowRow } from "../flow/flow.repo";
import { resolveDesignBoardImageUrl } from "./video-orchestrator.orchestrate";

const rowWith = (nodes: Array<Record<string, unknown>>): FlowRow => ({
  id: "flow-1",
  name: "Flow",
  data: JSON.stringify({ nodes, edges: [] }),
  owner_id: "user-1",
  project_id: "project-1",
  created_at: "2026-06-08T00:00:00.000Z",
  updated_at: "2026-06-08T00:00:00.000Z",
});

const board = "https://cdn/x/design-board.png";

describe("resolveDesignBoardImageUrl — orchestrator 消费整套设计板（治走单帧结构根）", () => {
  it("无组：命中 flow 内 productionLayer=design_board 且有真实 imageUrl 的节点", () => {
    const row = rowWith([
      { id: "script", data: { kind: "text", prompt: "..." } },
      { id: "char", data: { kind: "image", imageUrl: "https://cdn/x/hero.png" } },
      { id: "db", data: { kind: "image", productionLayer: "design_board", imageUrl: board } },
    ]);
    expect(resolveDesignBoardImageUrl(row, "")).toBe(board);
  });

  it("无设计板 → 返回 ''（回退逐镜生成）", () => {
    const row = rowWith([
      { id: "char", data: { kind: "image", imageUrl: "https://cdn/x/hero.png" } },
    ]);
    expect(resolveDesignBoardImageUrl(row, "")).toBe("");
  });

  it("设计板节点无真实 http imageUrl（还在 running）→ 不当成就绪，返回 ''", () => {
    const row = rowWith([
      { id: "db", data: { kind: "image", productionLayer: "design_board", status: "running" } },
    ]);
    expect(resolveDesignBoardImageUrl(row, "")).toBe("");
  });

  it("有组：优先命中组内设计板，不误抓别组/自由的板", () => {
    const row = rowWith([
      { id: "db-free", data: { kind: "image", productionLayer: "design_board", imageUrl: "https://cdn/x/free.png" } },
      { id: "db-grp", parentId: "grp-1", data: { kind: "image", productionLayer: "design_board", imageUrl: board } },
    ]);
    expect(resolveDesignBoardImageUrl(row, "grp-1")).toBe(board);
  });

  it("有组但设计板不在本组内 → 返回 ''（不抓 flow 里别处的板）", () => {
    const row = rowWith([
      { id: "db-other", parentId: "grp-OTHER", data: { kind: "image", productionLayer: "design_board", imageUrl: board } },
    ]);
    expect(resolveDesignBoardImageUrl(row, "grp-1")).toBe("");
  });
});
