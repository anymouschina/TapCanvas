// 通过 Yjs 长连接往画布注入一个空白文本节点（验证 Phase 2-4 端到端）。
// 用法：
//   node scripts/yjs-add-text-node.mjs <flowId> [wsBase] [userId]
// 依赖 apps/hono-api/node_modules 的 yjs + y-websocket + ws。
// 需要 api 已启用 CANVAS_YJS_WS=on 并安装了 yjs/ws/y-protocols/lib0。
import crypto from "node:crypto";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { WebSocket } from "ws";

const flowId = process.argv[2];
const wsBase = process.argv[3] || "ws://localhost:8788/yjs";
const userId = process.argv[4] || "phone_11dd9f14a3c25ed8947cd76e12fdc0123ea17f972ad99cf25d4d4abcdfda2272";
const secret = process.env.JWT_SECRET || "dev-secret-change-me";
if (!flowId) {
  console.error("usage: node yjs-add-text-node.mjs <flowId> [wsBase] [userId]");
  process.exit(1);
}

// 极简 HS256 JWT（与 hono-api signJwtHS256 同算法）
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function signJwt(payload, sec, expSec = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + expSec }));
  const data = `${header}.${body}`;
  const sig = b64url(crypto.createHmac("sha256", sec).update(data).digest());
  return `${data}.${sig}`;
}

const token = signJwt({ sub: userId }, secret);
const doc = new Y.Doc();
const provider = new WebsocketProvider(wsBase, flowId, doc, {
  WebSocketPolyfill: WebSocket,
  params: { token },
});

provider.on("status", (e) => console.log("[status]", e.status));

const done = (code) => {
  try { provider.disconnect(); provider.destroy(); } catch {}
  process.exit(code);
};

provider.once("sync", (synced) => {
  console.log("[sync]", synced, "→ 现有节点数:", doc.getMap("nodes").size);
  const nodeId = `text-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  doc.transact(() => {
    const nodes = doc.getMap("nodes");
    const n = new Y.Map();
    n.set("type", "taskNode");
    n.set("position", { x: 40, y: 40 });
    n.set("data", { label: "text", kind: "text", text: "" });
    nodes.set(nodeId, n);
  });
  console.log("[added] 空白文本节点:", nodeId, "→ 现节点数:", doc.getMap("nodes").size);
  // 给一点时间把 update 推给服务端与其它客户端
  setTimeout(() => { console.log("[ok] 已通过长连接注入，关闭。"); done(0); }, 1500);
});

setTimeout(() => { console.error("[timeout] 15s 内未 sync，请确认 api 已 CANVAS_YJS_WS=on 且依赖已装"); done(2); }, 15000);
