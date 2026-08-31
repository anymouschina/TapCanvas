import { describe, it, expect } from "vitest";
import {
  isUnknownRoleRefWarnEnabled,
  collectKnownRoleNames,
  buildUnknownRoleReferenceWarning,
} from "./video-orchestrator.unknown-role-ref";

const node = (data: Record<string, unknown>) => ({ id: "n", data }) as never;
const clip = (over: Record<string, unknown>) => over as never;

describe("unknown-role 引用软告警（吸收 LumenX 实体引用约束）", () => {
  it("characterRoleNames 全在库 → null（不报）", () => {
    const known = new Set(["郑吒", "萧逸"]);
    const w = buildUnknownRoleReferenceWarning(
      [clip({ characterRoleNames: ["郑吒"] }), clip({ characterRoleNames: ["萧逸", "郑吒"] })],
      known,
    );
    expect(w).toBeNull();
  });

  it("某镜引用库外名 → 报，含镜序号与该名字", () => {
    const known = new Set(["郑吒", "萧逸"]);
    const w = buildUnknownRoleReferenceWarning(
      [clip({ characterRoleNames: ["郑吒"] }), clip({ characterRoleNames: ["郑诧"] })],
      known,
    );
    expect(w).toContain("镜1");
    expect(w).toContain("郑诧");
    expect(w).toContain("郑吒"); // 已知名清单帮定位错字
  });

  it("繁简/错字名精确不匹配 → 报（不做模糊归一）", () => {
    const w = buildUnknownRoleReferenceWarning(
      [clip({ characterRoleNames: ["郑诧"] })],
      new Set(["郑吒"]),
    );
    expect(w).not.toBeNull();
    expect(w).toContain("郑诧");
  });

  it("纯空镜（无 characterRoleNames / 空数组）→ 不报", () => {
    expect(buildUnknownRoleReferenceWarning([clip({}), clip({ characterRoleNames: [] })], new Set(["郑吒"]))).toBeNull();
  });

  it("collectKnownRoleNames：只收 character-card/v3，拒绝裸字段与旧节点", () => {
    const known = collectKnownRoleNames([
      node({
        kind: "image",
        referenceType: "character",
        characterProfileVersion: "character-card/v3",
        roleName: " 郑吒 ",
      }),
      node({ characterName: "萧逸" }),
      node({ referenceType: "character", label: "李长安" }),
      node({ referenceType: "scene", label: "庭院" }), // 非 character，不收
      node({ roleName: "郑吒" }), // 重复去重
      node({ label: "无 referenceType 的 label 不收" }),
    ]);
    expect(known.has("郑吒")).toBe(true);
    expect(known.has("萧逸")).toBe(false);
    expect(known.has("李长安")).toBe(false);
    expect(known.has("庭院")).toBe(false);
    expect(known.has("无 referenceType 的 label 不收")).toBe(false);
    expect(known.size).toBe(1);
  });

  it("flag：off/0/false/no → 关；默认/未设 → 开", () => {
    expect(isUnknownRoleRefWarnEnabled({})).toBe(true);
    for (const v of ["off", "0", "false", "no"]) {
      expect(isUnknownRoleRefWarnEnabled({ VIDEO_UNKNOWN_ROLE_REF_WARN: v })).toBe(false);
    }
    expect(isUnknownRoleRefWarnEnabled({ VIDEO_UNKNOWN_ROLE_REF_WARN: "on" })).toBe(true);
  });

  it("库内无任何卡时给出对应提示文案", () => {
    const w = buildUnknownRoleReferenceWarning([clip({ characterRoleNames: ["郑吒"] })], new Set());
    expect(w).toContain("库内尚无任何角色卡");
  });
});
