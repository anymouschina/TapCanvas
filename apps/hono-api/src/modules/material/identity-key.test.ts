import { describe, expect, it } from "vitest";
import { toIdentityKey, computeIdentityKeyBackfill } from "./identity-key";

describe("toIdentityKey", () => {
  it("剥前缀：角色卡/场景卡", () => {
    expect(toIdentityKey("角色卡｜李长安")).toBe("李长安");
    expect(toIdentityKey("场景卡｜云萝山")).toBe("云萝山");
  });
  it("剥画风尾缀", () => {
    expect(toIdentityKey("李长安｜V3.3")).toBe("李长安");
    expect(toIdentityKey("李长安｜写实")).toBe("李长安");
    expect(toIdentityKey("书生｜写实v2")).toBe("书生");
  });
  it("剥状态/复用尾缀", () => {
    expect(toIdentityKey("山蜘蛛｜焚伤残躯")).toBe("山蜘蛛");
    expect(toIdentityKey("角色卡｜李长安｜火场强撑态")).toBe("李长安");
    expect(toIdentityKey("角色卡｜牛秀才｜复用")).toBe("牛秀才");
  });
  it("剥空格尾缀（场景参考图）", () => {
    expect(toIdentityKey("枯木浓雾林 场景参考图")).toBe("枯木浓雾林");
  });
  it("纯身份名原样返回 + trim", () => {
    expect(toIdentityKey(" 李长安 ")).toBe("李长安");
    expect(toIdentityKey("薛大家")).toBe("薛大家");
  });
  it("多段尾缀只保留首段身份", () => {
    expect(toIdentityKey("李长安｜写实｜火场强撑态")).toBe("李长安");
  });
  it("不剥中点/冒号（合法名字含·:）", () => {
    expect(toIdentityKey("蝙蝠侠·黑暗骑士")).toBe("蝙蝠侠·黑暗骑士");
    expect(toIdentityKey("蜘蛛侠:平行宇宙")).toBe("蜘蛛侠:平行宇宙");
    expect(toIdentityKey("角色卡｜蝙蝠侠·黑暗骑士")).toBe("蝙蝠侠·黑暗骑士");
  });
  it("退化空身份回退到原名", () => {
    expect(toIdentityKey("角色卡｜")).toBe("角色卡｜");
  });
});

describe("computeIdentityKeyBackfill", () => {
  it("为每行算出规范 identity_key", () => {
    const rows = [
      { id: "1", name: "李长安｜V3.3" },
      { id: "2", name: "角色卡｜薛大家｜焚山主导" },
      { id: "3", name: "枯木浓雾林 场景参考图" },
    ];
    expect(computeIdentityKeyBackfill(rows)).toEqual([
      { id: "1", identityKey: "李长安" },
      { id: "2", identityKey: "薛大家" },
      { id: "3", identityKey: "枯木浓雾林" },
    ]);
  });
});
