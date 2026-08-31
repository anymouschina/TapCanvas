import { describe, it, expect } from "vitest";
import { parsePresenceUpgrade, presenceWsEnabled } from "./presence-ws";

describe("parsePresenceUpgrade", () => {
  it("只从 URL 解析非敏感 resourceId", () => {
    const r = parsePresenceUpgrade("/canvas-presence/proj-1?teamId=t1");
    expect(r).toEqual({ resourceId: "proj-1" });
  });
  it("缺 resourceId 返回 null，但鉴权凭据不属于 URL 解析职责", () => {
    expect(parsePresenceUpgrade("/canvas-presence/")).toBeNull();
    expect(parsePresenceUpgrade("/canvas-presence/proj-1")).toEqual({ resourceId: "proj-1" });
  });
  it("非 presence 路径返回 null", () => {
    expect(parsePresenceUpgrade("/yjs/flow-1?token=abc")).toBeNull();
  });
});

describe("presenceWsEnabled", () => {
  it("默认（未设）开启", () => {
    delete process.env.CANVAS_PRESENCE_WS;
    expect(presenceWsEnabled()).toBe(true);
  });
  it("显式 off 关闭", () => {
    process.env.CANVAS_PRESENCE_WS = "off";
    expect(presenceWsEnabled()).toBe(false);
    delete process.env.CANVAS_PRESENCE_WS;
  });
});
