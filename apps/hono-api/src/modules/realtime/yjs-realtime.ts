import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
// 仅类型导入（构建时擦除，运行时不产生 require）——避免 flag 关闭时强依赖未安装的包。
import type { WebSocket } from "ws";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { verifyJwtHS256 } from "../../jwt";
import { validateAuthSession } from "../auth/auth-session.service";
import { attachWebSocketSessionGuard } from "../auth/websocket-session-guard";
import { readWebSocketSessionToken } from "../auth/websocket-auth";

/**
 * 画布 Yjs 实时层（自管 y-websocket 服务端）。
 *
 * 路径约定：客户端 WebsocketProvider(`${base}/yjs`, flowId, doc) → 实际连 `/yjs/<flowId>?token=..&teamId=..`
 * 房间名 = flowId，每个 flow 一个 Y.Doc + Awareness。
 *
 * 协议：手写标准 y-protocols sync(messageType=0) / awareness(messageType=1) 处理循环，
 *       与前端 y-websocket@3 + yjs@13.6 严格同版本（此前 @y/websocket-server 拉入 yjs@14
 *       会与 13.6 客户端协议错配，已弃用）。
 *
 * 灰度开关：环境变量 CANVAS_YJS_WS=on 才挂载；默认关闭 → 不注册任何 upgrade 监听，
 *           且**不会 import** ws / yjs / y-protocols / lib0（这些仅灰度开启时才需安装）。
 */

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const WS_CONNECTING = 0;
const WS_OPEN = 1;
const PING_INTERVAL_MS = 30_000;

type YjsLibs = {
  Y: typeof Y;
  sync: typeof import("y-protocols/sync");
  awareness: typeof import("y-protocols/awareness");
  encoding: typeof import("lib0/encoding");
  decoding: typeof import("lib0/decoding");
};

type Room = {
  doc: Y.Doc;
  awareness: Awareness;
  conns: Map<WebSocket, Set<number>>;
};

let libs: YjsLibs | null = null;
const rooms = new Map<string, Room>();
let attached = false;

export function isYjsWsEnabled(): boolean {
  return String(process.env.CANVAS_YJS_WS || "").trim().toLowerCase() === "on";
}

function getJwtSecret(): string {
  return process.env.JWT_SECRET || "dev-secret";
}

// ── 房间 + 同步协议（标准 y-protocols 实现）─────────────────────────────────────

function getRoom(flowId: string): Room {
  const existing = rooms.get(flowId);
  if (existing) return existing;
  const L = libs!;
  const doc = new L.Y.Doc();
  const awareness = new L.awareness.Awareness(doc);
  awareness.setLocalState(null);
  const room: Room = { doc, awareness, conns: new Map() };
  rooms.set(flowId, room);

  // 文档变更 → 广播 sync update
  doc.on("update", (update: Uint8Array) => {
    const encoder = L.encoding.createEncoder();
    L.encoding.writeVarUint(encoder, MESSAGE_SYNC);
    L.sync.writeUpdate(encoder, update);
    const msg = L.encoding.toUint8Array(encoder);
    room.conns.forEach((_ids, conn) => sendMsg(room, conn, msg));
  });

  // awareness 变更 → 广播
  awareness.on("update", (changes, origin) => {
    const changed = changes.added.concat(changes.updated, changes.removed);
    if (origin && room.conns.has(origin as WebSocket)) {
      const ids = room.conns.get(origin as WebSocket)!;
      changes.added.forEach((id) => ids.add(id));
      changes.removed.forEach((id) => ids.delete(id));
    }
    const encoder = L.encoding.createEncoder();
    L.encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    L.encoding.writeVarUint8Array(encoder, L.awareness.encodeAwarenessUpdate(awareness, changed));
    const msg = L.encoding.toUint8Array(encoder);
    room.conns.forEach((_ids, conn) => sendMsg(room, conn, msg));
  });

  return room;
}

function sendMsg(room: Room, conn: WebSocket, msg: Uint8Array): void {
  const ready = (conn as unknown as { readyState: number }).readyState;
  if (ready !== WS_CONNECTING && ready !== WS_OPEN) {
    closeConn(room, conn);
    return;
  }
  try {
    conn.send(msg, (err?: Error) => {
      if (err) closeConn(room, conn);
    });
  } catch {
    closeConn(room, conn);
  }
}

function closeConn(room: Room, conn: WebSocket): void {
  const ids = room.conns.get(conn);
  if (ids) {
    room.conns.delete(conn);
    libs!.awareness.removeAwarenessStates(room.awareness, Array.from(ids), null);
  }
  try { conn.close(); } catch { /* already closed */ }
  // 房间空：暂保留 doc 以便短期复用（Phase 5 可在此 checkpoint 到 flows.data 后销毁）。
}

function onMessage(room: Room, conn: WebSocket, data: Uint8Array): void {
  const L = libs!;
  try {
    const decoder = L.decoding.createDecoder(data);
    const messageType = L.decoding.readVarUint(decoder);
    if (messageType === MESSAGE_SYNC) {
      const encoder = L.encoding.createEncoder();
      L.encoding.writeVarUint(encoder, MESSAGE_SYNC);
      L.sync.readSyncMessage(decoder, encoder, room.doc, conn);
      // 只有 syncStep1 会产生回复（length>1）
      if (L.encoding.length(encoder) > 1) sendMsg(room, conn, L.encoding.toUint8Array(encoder));
    } else if (messageType === MESSAGE_AWARENESS) {
      L.awareness.applyAwarenessUpdate(room.awareness, L.decoding.readVarUint8Array(decoder), conn);
    }
  } catch {
    closeConn(room, conn);
  }
}

function setupConnection(conn: WebSocket, auth: AuthedUpgrade): void {
  (conn as unknown as { binaryType: string }).binaryType = "arraybuffer";
  const room = getRoom(auth.flowId);
  room.conns.set(conn, new Set());
  const stopSessionGuard = attachWebSocketSessionGuard(conn, {
    userId: auth.userId,
    sessionId: auth.sessionId,
  });

  conn.on("message", (data: ArrayBuffer | Buffer) => {
    onMessage(room, conn, new Uint8Array(data as ArrayBuffer));
  });

  // keepalive：30s ping，无 pong 则断开
  let alive = true;
  conn.on("pong", () => { alive = true; });
  const pingTimer = setInterval(() => {
    if (!room.conns.has(conn)) { clearInterval(pingTimer); return; }
    if (!alive) { closeConn(room, conn); clearInterval(pingTimer); return; }
    alive = false;
    try { conn.ping(); } catch { closeConn(room, conn); clearInterval(pingTimer); }
  }, PING_INTERVAL_MS);
  conn.on("close", () => { stopSessionGuard(); closeConn(room, conn); clearInterval(pingTimer); });

  // 初始 sync step 1
  const L = libs!;
  const encoder = L.encoding.createEncoder();
  L.encoding.writeVarUint(encoder, MESSAGE_SYNC);
  L.sync.writeSyncStep1(encoder, room.doc);
  sendMsg(room, conn, L.encoding.toUint8Array(encoder));

  // 初始 awareness 状态
  const states = room.awareness.getStates();
  if (states.size > 0) {
    const e2 = L.encoding.createEncoder();
    L.encoding.writeVarUint(e2, MESSAGE_AWARENESS);
    L.encoding.writeVarUint8Array(e2, L.awareness.encodeAwarenessUpdate(room.awareness, Array.from(states.keys())));
    sendMsg(room, conn, L.encoding.toUint8Array(e2));
  }
}

type AuthedUpgrade = { flowId: string; userId: string; sessionId: string };

async function authorizeUpgrade(url: string, request: IncomingMessage): Promise<AuthedUpgrade | null> {
  // 浏览器凭据只从 HttpOnly Cookie 读取，URL 只承载非敏感作用域参数。
  const u = new URL(url, "http://localhost");
  const rest = u.pathname.replace(/^\/yjs\/?/, "");
  const flowId = decodeURIComponent((rest.split("/")[0] || "").trim());
  const token = readWebSocketSessionToken(request);
  if (!flowId || !token) return null;
  const payload = await verifyJwtHS256<{ sub?: string; sid?: string }>(token, getJwtSecret()).catch(() => null);
  if (!payload?.sub) return null;
  const session = await validateAuthSession(String(payload.sub), payload.sid);
  if (!session.valid) return null;
  // TODO(phase3): 校验该用户对 flowId 的访问权限（项目成员 / 团队共享）。
  // v1 仅校验登录态，足以用于受信内网灰度验证。
  return { flowId, userId: payload.sub, sessionId: session.id };
}

export async function attachYjsWebsocketServer(httpServer: HttpServer): Promise<void> {
  if (attached) return;
  if (!isYjsWsEnabled()) {
    // eslint-disable-next-line no-console
    console.log("[yjs] CANVAS_YJS_WS!=on，跳过 y-websocket 挂载（仅旧 SSE 生效）");
    return;
  }
  attached = true;

  // 惰性加载：仅在灰度开启时才 import 这些包，避免默认部署强依赖。
  const wsMod = await import("ws");
  const WebSocketServer = wsMod.WebSocketServer;
  libs = {
    Y: (await import("yjs")) as unknown as typeof Y,
    sync: await import("y-protocols/sync"),
    awareness: await import("y-protocols/awareness"),
    encoding: await import("lib0/encoding"),
    decoding: await import("lib0/decoding"),
  };

  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (ws: WebSocket, _req: IncomingMessage, auth: AuthedUpgrade) => {
    setupConnection(ws, auth);
  });

  httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url || "";
    // 只接管 /yjs 路径，其余 upgrade 交给其它监听器（不动 socket）
    if (url !== "/yjs" && !url.startsWith("/yjs/") && !url.startsWith("/yjs?")) return;

    void authorizeUpgrade(url, req).then((auth) => {
      if (!auth) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, auth);
      });
    });
  });

  // eslint-disable-next-line no-console
  console.log("[yjs] y-websocket 已挂载于 /yjs/<flowId>（CANVAS_YJS_WS=on）");
}

/** 暴露房间内的 Y.Doc（供 agent 回写桥 / 后续持久化使用）。仅灰度开启后可用。 */
export function getFlowYDoc(flowId: string): Y.Doc | null {
  return libs ? getRoom(flowId).doc : null;
}

export function listActiveFlowRooms(): string[] {
  return Array.from(rooms.keys());
}

// ── Phase 4：agent 回写桥（SyncPatch → 服务端 Y.Doc）────────────────────────────
//
// 与前端 canvasDoc.ts 的数据模型严格对齐：
//   doc.getMap('nodes'): nodeId → Y.Map { type, position, data, parentId, style, width, height }
//   doc.getMap('edges'): edgeId → Y.Map { source, target, sourceHandle, targetHandle, data }
// agent 出图/出视频完成后，除 broadcastPatch 给旧 SSE 客户端外，再调用本函数把同一 patch
// 写进 Y.Doc，y-websocket 自动同步给所有 ws 客户端。flag 关或未加载时为 no-op。

const NODE_KEYS = ["type", "position", "data", "parentId", "style", "width", "height"] as const;
const EDGE_KEYS = ["source", "target", "sourceHandle", "targetHandle", "data"] as const;

type SyncNodeItem = {
  id: string;
  type?: unknown;
  position?: unknown;
  data?: unknown;
  parentId?: unknown;
  style?: unknown;
  width?: unknown;
  height?: unknown;
};
type SyncEdgeItem = {
  id: string;
  source?: unknown;
  target?: unknown;
  sourceHandle?: unknown;
  targetHandle?: unknown;
  data?: unknown;
};
export type CanvasSyncPatch = {
  upsertNodes?: SyncNodeItem[];
  removeNodeIds?: string[];
  upsertEdges?: SyncEdgeItem[];
  removeEdgeIds?: string[];
};

function writeFields(target: Y.Map<unknown>, src: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    const next = src[key];
    if (next === undefined || next === null) {
      if (target.has(key)) target.delete(key);
      continue;
    }
    const prev = target.get(key);
    if (JSON.stringify(prev) !== JSON.stringify(next)) target.set(key, next);
  }
}

/**
 * 纯逻辑：把 SyncPatch 写进给定 Y.Doc（结构镜像前端 canvasDoc.ts）。
 * 显式接收 Y 模块与 doc，便于单测（不依赖惰性加载与 WS 挂载）。
 */
export function applyPatchToDoc(
  Yns: typeof Y,
  doc: Y.Doc,
  patchInput: CanvasSyncPatch | Record<string, unknown>,
): void {
  const patch = patchInput as CanvasSyncPatch;
  const hasCanvas =
    patch.upsertNodes?.length ||
    patch.removeNodeIds?.length ||
    patch.upsertEdges?.length ||
    patch.removeEdgeIds?.length;
  if (!hasCanvas) return;

  doc.transact(() => {
    const nMap = doc.getMap<Y.Map<unknown>>("nodes");
    for (const node of patch.upsertNodes ?? []) {
      if (!node?.id) continue;
      let entry = nMap.get(node.id);
      if (!(entry instanceof Yns.Map)) {
        entry = new Yns.Map<unknown>();
        nMap.set(node.id, entry);
      }
      writeFields(entry, node as Record<string, unknown>, NODE_KEYS);
    }
    for (const id of patch.removeNodeIds ?? []) nMap.delete(id);

    const eMap = doc.getMap<Y.Map<unknown>>("edges");
    for (const edge of patch.upsertEdges ?? []) {
      if (!edge?.id) continue;
      let entry = eMap.get(edge.id);
      if (!(entry instanceof Yns.Map)) {
        entry = new Yns.Map<unknown>();
        eMap.set(edge.id, entry);
      }
      writeFields(entry, edge as Record<string, unknown>, EDGE_KEYS);
    }
    for (const id of patch.removeEdgeIds ?? []) eMap.delete(id);
  }, "agent-writeback");
}

/** 把一个画布 SyncPatch 应用到 flowId 对应的服务端 Y.Doc。flag 关/未加载时为 no-op。 */
export function applyPatchToFlowYDoc(
  flowId: string,
  patchInput: CanvasSyncPatch | Record<string, unknown>,
): void {
  if (!libs || !flowId) return;
  applyPatchToDoc(libs.Y, getRoom(flowId).doc, patchInput);
}
