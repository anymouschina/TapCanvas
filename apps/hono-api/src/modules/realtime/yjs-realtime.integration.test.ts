// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

const { validateAuthSession } = vi.hoisted(() => ({
  validateAuthSession: vi.fn(
    async (_userId: string, sessionId: string | undefined) =>
      sessionId
        ? { valid: true as const, id: sessionId }
        : { valid: false as const, code: "session_missing" as const },
  ),
}));

vi.mock("../auth/auth-session.service", () => ({ validateAuthSession }));

import { attachYjsWebsocketServer } from "./yjs-realtime";
import { signJwtHS256 } from "../../jwt";

const SECRET = "yjs-integration-secret";

async function waitFor(pred: () => boolean, timeout = 15000, interval = 50): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return pred();
}

let server: Server;
let base: string;
const providers: WebsocketProvider[] = [];

function makeClient(flowId: string, doc: Y.Doc, token: string | null): WebsocketProvider {
  const AuthenticatedWebSocket = class extends WebSocket {
    constructor(address: string | URL, protocols?: string | string[]) {
      super(address, protocols, token
        ? { headers: { cookie: `tap_token=${encodeURIComponent(token)}` } }
        : undefined);
    }
  };
  const p = new WebsocketProvider(base, flowId, doc, {
    WebSocketPolyfill: AuthenticatedWebSocket as unknown as typeof globalThis.WebSocket,
    maxBackoffTime: 500,
  });
  providers.push(p);
  return p;
}

describe("yjs-realtime 真实 WebSocket 端到端", () => {
  beforeAll(async () => {
    process.env.CANVAS_YJS_WS = "on";
    process.env.JWT_SECRET = SECRET;
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    await attachYjsWebsocketServer(server);
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    base = `ws://127.0.0.1:${port}/yjs`;
  });

  afterAll(async () => {
    for (const p of providers) {
      try { p.disconnect(); p.destroy(); } catch { /* noop */ }
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("合法 JWT 下两客户端同房间实时同步节点", async () => {
    const flowId = "flow-sync-1";
    const token = await signJwtHS256(
      { sub: "user-1", sid: "session-user-1" },
      SECRET,
      3600,
    );
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const pA = makeClient(flowId, docA, token);
    const pB = makeClient(flowId, docB, token);

    expect(await waitFor(() => pA.synced && pB.synced)).toBe(true);

    // A 端写入一个节点（结构同 canvasDoc.ts：node 为 Y.Map）
    docA.transact(() => {
      const nodes = docA.getMap<Y.Map<unknown>>("nodes");
      const n = new Y.Map<unknown>();
      n.set("type", "taskNode");
      n.set("position", { x: 42, y: 0 });
      n.set("data", { kind: "image", imageUrl: "https://r2/x.png" });
      nodes.set("n1", n);
    });

    // B 端实时收到
    const got = await waitFor(() => {
      const m = docB.getMap<Y.Map<unknown>>("nodes").get("n1");
      return m instanceof Y.Map && m.get("type") === "taskNode";
    });
    expect(got).toBe(true);
    const mB = docB.getMap<Y.Map<unknown>>("nodes").get("n1") as Y.Map<unknown>;
    const data = mB.get("data");
    expect(data).toMatchObject({ imageUrl: "https://r2/x.png" });
    expect(mB.get("position")).toEqual({ x: 42, y: 0 });
  }, 30000);

  it("无 token 的连接被拒，无法 sync", async () => {
    const docX = new Y.Doc();
    const pX = makeClient("flow-auth-deny", docX, null);
    // 鉴权失败 → 服务端 destroy socket；客户端始终无法 synced
    const synced = await waitFor(() => pX.synced, 2500);
    expect(synced).toBe(false);
  }, 8000);

  it("不同 flow 房间相互隔离", async () => {
    const token = await signJwtHS256(
      { sub: "user-2", sid: "session-user-2" },
      SECRET,
      3600,
    );
    const docP = new Y.Doc();
    const docQ = new Y.Doc();
    const pP = makeClient("flow-room-A", docP, token);
    const pQ = makeClient("flow-room-B", docQ, token);
    expect(await waitFor(() => pP.synced && pQ.synced)).toBe(true);

    docP.getMap<Y.Map<unknown>>("nodes").set("only-A", new Y.Map());
    // 给足时间让（不该发生的）跨房间同步有机会发生
    await new Promise((r) => setTimeout(r, 800));
    expect(docQ.getMap("nodes").has("only-A")).toBe(false);
  }, 30000);
});
