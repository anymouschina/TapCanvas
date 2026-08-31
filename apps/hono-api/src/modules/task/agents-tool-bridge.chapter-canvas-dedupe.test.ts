import { describe, expect, it } from "vitest";
import {
  characterCardIdentity,
  dedupeCharacterCardCreatesAgainstCanvas,
  isCharacterCardNameDedupeEnabled,
  resolveCharacterCardFinalWriteTarget,
} from "./agents-tool-bridge.chapter-canvas-dedupe";

// 角色卡节点（图节点产物）。classifyCanvasCardForRegistry 只认 kind=image/空。
const charNode = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "taskNode",
  data: {
    kind: "image",
    referenceType: "character",
    roleName: name,
    characterProfileVersion: "character-card/v3",
    label: `角色卡｜${name}`,
    ...extra,
  },
});

describe("characterCardIdentity", () => {
  it("同名基态 → 同身份键", () => {
    expect(characterCardIdentity(charNode("a", "李长安").data)).toBe(
      characterCardIdentity(charNode("b", "李长安").data),
    );
  });

  it("状态版（stateDescription）身份键不同于基态", () => {
    const base = characterCardIdentity(charNode("a", "李长安").data);
    const state = characterCardIdentity(
      charNode("b", "李长安", { stateDescription: "受伤血衣" }).data,
    );
    expect(state).not.toBe(base);
  });

  it("非角色卡（场景/文本/分镜帧）→ null", () => {
    expect(characterCardIdentity({ kind: "text", label: "第一章" })).toBeNull();
    expect(characterCardIdentity({ kind: "image", label: "场景卡｜云萝山" })).toBeNull();
    expect(characterCardIdentity({ kind: "storyboardImage", roleName: "李长安" })).toBeNull();
  });
});

describe("dedupeCharacterCardCreatesAgainstCanvas", () => {
  it("同名角色卡已在画布 → 折叠重复创建（首卡为准），createNodes 不含副本", () => {
    const currentNodes = [charNode("existing-1", "李长安")];
    const patch = { createNodes: [charNode("new-2", "李长安")] };
    const out = dedupeCharacterCardCreatesAgainstCanvas({ currentNodes, patch, enabled: true });
    expect(out.collapsed).toHaveLength(1);
    expect(out.collapsed[0]).toMatchObject({ fromId: "new-2", toId: "existing-1" });
    expect((out.patch.createNodes as unknown[])).toHaveLength(0);
  });

  it("被折叠节点上的边端点改指既有卡", () => {
    const currentNodes = [charNode("existing-1", "李长安")];
    const patch = {
      createNodes: [charNode("new-2", "李长安")],
      createEdges: [{ id: "e1", source: "video-x", target: "new-2" }],
    };
    const out = dedupeCharacterCardCreatesAgainstCanvas({ currentNodes, patch, enabled: true });
    const edges = out.patch.createEdges as Array<Record<string, unknown>>;
    expect(edges[0].target).toBe("existing-1");
  });

  it("折叠后形成自环的边被丢弃", () => {
    const currentNodes = [charNode("existing-1", "李长安")];
    const patch = {
      createNodes: [charNode("new-2", "李长安")],
      createEdges: [{ id: "e1", source: "existing-1", target: "new-2" }],
    };
    const out = dedupeCharacterCardCreatesAgainstCanvas({ currentNodes, patch, enabled: true });
    expect((out.patch.createEdges as unknown[])).toHaveLength(0);
  });

  it("同一 patch 内两张同名创建 → 保留首张、折叠次张", () => {
    const patch = { createNodes: [charNode("new-1", "李长安"), charNode("new-2", "李长安")] };
    const out = dedupeCharacterCardCreatesAgainstCanvas({ currentNodes: [], patch, enabled: true });
    expect(out.collapsed).toHaveLength(1);
    expect(out.collapsed[0]).toMatchObject({ fromId: "new-2", toId: "new-1" });
    const kept = out.patch.createNodes as Array<Record<string, unknown>>;
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe("new-1");
  });

  it("状态版同名卡不折叠（同身体换装允许共存）", () => {
    const currentNodes = [charNode("existing-1", "李长安")];
    const patch = { createNodes: [charNode("new-2", "李长安", { stateDescription: "受伤血衣" })] };
    const out = dedupeCharacterCardCreatesAgainstCanvas({ currentNodes, patch, enabled: true });
    expect(out.collapsed).toHaveLength(0);
    expect((out.patch.createNodes as unknown[])).toHaveLength(1);
  });

  it("非角色卡创建一律不动", () => {
    const patch = {
      createNodes: [
        { id: "vid-1", type: "taskNode", data: { kind: "video", label: "镜头1" } },
        { id: "scene-1", type: "taskNode", data: { kind: "image", label: "场景卡｜云萝山" } },
      ],
    };
    const out = dedupeCharacterCardCreatesAgainstCanvas({
      currentNodes: [charNode("existing-1", "李长安")],
      patch,
      enabled: true,
    });
    expect(out.collapsed).toHaveLength(0);
    expect(out.patch).toBe(patch); // 零拷贝
  });

  it("flag 关闭 → 原样透传", () => {
    const currentNodes = [charNode("existing-1", "李长安")];
    const patch = { createNodes: [charNode("new-2", "李长安")] };
    const out = dedupeCharacterCardCreatesAgainstCanvas({ currentNodes, patch, enabled: false });
    expect(out.collapsed).toHaveLength(0);
    expect(out.patch).toBe(patch);
  });
});

describe("resolveCharacterCardFinalWriteTarget", () => {
  it("同名既有卡（不同 id）→ 重定向到既有卡", () => {
    const out = resolveCharacterCardFinalWriteTarget({
      currentNodes: [charNode("existing-1", "李长安")],
      finalNodeData: charNode("new-2", "李长安").data,
      finalNodeId: "new-2",
      enabled: true,
    });
    expect(out.redirectToId).toBe("existing-1");
  });

  it("同 id（占位→最终写）→ 不重定向", () => {
    const out = resolveCharacterCardFinalWriteTarget({
      currentNodes: [charNode("node-1", "李长安")],
      finalNodeData: charNode("node-1", "李长安").data,
      finalNodeId: "node-1",
      enabled: true,
    });
    expect(out.redirectToId).toBeNull();
  });

  it("非角色卡 → 不重定向", () => {
    const out = resolveCharacterCardFinalWriteTarget({
      currentNodes: [charNode("existing-1", "李长安")],
      finalNodeData: { kind: "video", label: "镜头1" },
      finalNodeId: "vid-9",
      enabled: true,
    });
    expect(out.redirectToId).toBeNull();
  });
});

describe("isCharacterCardNameDedupeEnabled", () => {
  it("默认 ON", () => {
    expect(isCharacterCardNameDedupeEnabled({})).toBe(true);
  });
  it("0/false/off 关闭", () => {
    expect(isCharacterCardNameDedupeEnabled({ CHARACTER_CARD_NAME_DEDUPE: "0" })).toBe(false);
    expect(isCharacterCardNameDedupeEnabled({ CHARACTER_CARD_NAME_DEDUPE: "false" })).toBe(false);
    expect(isCharacterCardNameDedupeEnabled({ CHARACTER_CARD_NAME_DEDUPE: "off" })).toBe(false);
  });
});
