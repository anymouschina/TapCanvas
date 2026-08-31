import { describe, expect, it } from "vitest";
import { analyzeMaterialMigration } from "./material-migration-analyzer";

const assets = [
  { id: "a1", kind: "character", name: "李长安｜V3.3", updatedAt: "2026-06-17T13:31:18Z", styleLockId: null },
  { id: "a2", kind: "character", name: "李长安｜写实", updatedAt: "2026-06-17T06:43:53Z", styleLockId: null },
  { id: "a3", kind: "character", name: "山蜘蛛", updatedAt: "2026-06-16T14:14:25Z", styleLockId: null },
  { id: "a4", kind: "scene", name: "枯木浓雾林 场景参考图", updatedAt: "2026-06-17T11:24:26Z", styleLockId: null },
];

describe("analyzeMaterialMigration", () => {
  it("按(kind,identityKey)分组并选 canonical=最新", () => {
    const groups = analyzeMaterialMigration({ assets, currentStyleLockId: null });
    const li = groups.find((g) => g.identityKey === "李长安" && g.kind === "character")!;
    expect(li.normalizedName).toBe("李长安");
    expect(li.canonicalCandidateId).toBe("a1"); // a1 比 a2 新
    expect(li.foldVersionIds).toEqual(["a2"]);
  });
  it("单成员组：canonical=自己，无折叠", () => {
    const groups = analyzeMaterialMigration({ assets, currentStyleLockId: null });
    const spider = groups.find((g) => g.identityKey === "山蜘蛛")!;
    expect(spider.canonicalCandidateId).toBe("a3");
    expect(spider.foldVersionIds).toEqual([]);
  });
  it("styleLockId 匹配当前锁的优先当 canonical", () => {
    const withStyle = [
      { id: "b1", kind: "character", name: "甲｜旧", updatedAt: "2026-06-18T00:00:00Z", styleLockId: "old" },
      { id: "b2", kind: "character", name: "甲｜新", updatedAt: "2026-06-17T00:00:00Z", styleLockId: "cur" },
    ];
    const groups = analyzeMaterialMigration({ assets: withStyle, currentStyleLockId: "cur" });
    expect(groups[0]!.canonicalCandidateId).toBe("b2"); // 匹配当前画风优先于更新时间
  });
  it("character/scene 同名不混组", () => {
    const mixed = [
      { id: "c1", kind: "character", name: "影", updatedAt: "2026-06-18T00:00:00Z", styleLockId: null },
      { id: "c2", kind: "scene", name: "影", updatedAt: "2026-06-18T00:00:00Z", styleLockId: null },
    ];
    const groups = analyzeMaterialMigration({ assets: mixed, currentStyleLockId: null });
    expect(groups.length).toBe(2);
  });
  it("含空格的多词身份不被截断", () => {
    const spaced = [
      { id: "s1", kind: "scene", name: "东海 龙宫", updatedAt: "2026-06-18T00:00:00Z", styleLockId: null },
    ];
    const groups = analyzeMaterialMigration({ assets: spaced, currentStyleLockId: null });
    expect(groups[0]!.identityKey).toBe("东海 龙宫");
    expect(groups[0]!.normalizedName).toBe("东海 龙宫");
  });
});
