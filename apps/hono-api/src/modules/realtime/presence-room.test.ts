import { describe, it, expect } from "vitest";
import { addConn, removeConn, broadcast, roomSize, type PresenceConn } from "./presence-room";

function fakeConn(userId: string) {
  const sent: string[] = [];
  return { conn: { userId, send: (d: string) => sent.push(d) } as PresenceConn, sent };
}

describe("presence-room", () => {
  it("broadcast 发给同房间其他连接，跳过发送者", () => {
    const a = fakeConn("ua"); const b = fakeConn("ub");
    addConn("room1", a.conn); addConn("room1", b.conn);
    broadcast("room1", "hello", a.conn);
    expect(a.sent).toEqual([]);
    expect(b.sent).toEqual(["hello"]);
  });
  it("removeConn 后不再收广播，roomSize 递减", () => {
    const a = fakeConn("ua"); const b = fakeConn("ub");
    addConn("r2", a.conn); addConn("r2", b.conn);
    removeConn("r2", b.conn);
    expect(roomSize("r2")).toBe(1);
    broadcast("r2", "x", a.conn);
    expect(b.sent).toEqual([]);
  });
  it("空房间 broadcast 安全、roomSize 为 0", () => {
    expect(roomSize("none")).toBe(0);
    expect(() => broadcast("none", "x", fakeConn("u").conn)).not.toThrow();
  });
});
