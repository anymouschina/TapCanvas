import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { applyPatchToDoc } from "./yjs-realtime";

// 复刻前端 canvasDoc.ts 的读取逻辑，验证服务端写入与客户端读取结构兼容。
const NODE_KEYS = ["type", "position", "data", "parentId", "style", "width", "height"] as const;
function readNodes(doc: Y.Doc): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  doc.getMap<Y.Map<unknown>>("nodes").forEach((m, id) => {
    if (!(m instanceof Y.Map)) return;
    const node: Record<string, unknown> = { id };
    for (const k of NODE_KEYS) if (m.has(k)) node[k] = m.get(k);
    out.push(node);
  });
  return out;
}

describe("applyPatchToDoc (agent 回写桥)", () => {
  it("upsertNodes 写成 Y.Map 且字段可被客户端读回", () => {
    const doc = new Y.Doc();
    applyPatchToDoc(Y, doc, {
      upsertNodes: [
        { id: "a", type: "taskNode", position: { x: 10, y: 0 }, data: { kind: "image", imageUrl: "u" } },
      ],
    });
    const n = readNodes(doc);
    expect(n).toHaveLength(1);
    expect(doc.getMap("nodes").get("a")).toBeInstanceOf(Y.Map);
    expect((n[0].data as any).imageUrl).toBe("u");
    expect(n[0].position).toEqual({ x: 10, y: 0 });
  });

  it("removeNodeIds 删除节点；removeEdgeIds 删除边", () => {
    const doc = new Y.Doc();
    applyPatchToDoc(Y, doc, {
      upsertNodes: [{ id: "a" }, { id: "b" }],
      upsertEdges: [{ id: "e1", source: "a", target: "b" }],
    });
    applyPatchToDoc(Y, doc, { removeNodeIds: ["a"], removeEdgeIds: ["e1"] });
    expect(readNodes(doc).map((x) => x.id)).toEqual(["b"]);
    expect(doc.getMap("edges").size).toBe(0);
  });

  it("字段级回写不覆盖并发的位置改动（CRDT）", () => {
    const server = new Y.Doc();
    applyPatchToDoc(Y, server, { upsertNodes: [{ id: "n", position: { x: 0, y: 0 }, data: { imageUrl: "" } }] });
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));

    // 客户端拖动改 position（直接操作 Y.Map 模拟前端 set）
    client.transact(() => {
      const m = client.getMap<Y.Map<unknown>>("nodes").get("n") as Y.Map<unknown>;
      m.set("position", { x: 800, y: 0 });
    }, "local-store");
    // 服务端 agent 回写 data.imageUrl
    applyPatchToDoc(Y, server, { upsertNodes: [{ id: "n", data: { imageUrl: "https://r2/x.png" } }] });

    Y.applyUpdate(server, Y.encodeStateAsUpdate(client));
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));

    const m = server.getMap<Y.Map<unknown>>("nodes").get("n") as Y.Map<unknown>;
    expect(m.get("position")).toEqual({ x: 800, y: 0 }); // 客户端位置保留
    expect((m.get("data") as any).imageUrl).toBe("https://r2/x.png"); // agent 回写保留
  });

  it("空 patch / 无画布字段为 no-op", () => {
    const doc = new Y.Doc();
    applyPatchToDoc(Y, doc, {});
    applyPatchToDoc(Y, doc, { upsertNodes: [] });
    expect(doc.getMap("nodes").size).toBe(0);
  });
});
