import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { addConn, removeConn, broadcast, type PresenceConn } from "./presence-room";
import { verifyJwtHS256 } from "../../jwt";
import { validateAuthSession } from "../auth/auth-session.service";
import { attachWebSocketSessionGuard } from "../auth/websocket-session-guard";
import { getPrismaClient } from "../../platform/node/prisma";
import { getChapterById } from "../chapter/chapter.repo";
import { getProjectForUserAccess } from "../project/project.repo";
import { readWebSocketSessionToken } from "../auth/websocket-auth";

// 与 yjs-realtime.ts 保持一致：getJwtSecret 是本模块局部函数（jwt 模块不导出它）。
function getJwtSecret(): string {
  return process.env.JWT_SECRET || "dev-secret";
}

export function presenceWsEnabled(): boolean {
  const raw = String(process.env.CANVAS_PRESENCE_WS || "").trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}

export function parsePresenceUpgrade(url: string): { resourceId: string } | null {
  if (!url.startsWith("/canvas-presence/") && url !== "/canvas-presence" && !url.startsWith("/canvas-presence?")) {
    return null;
  }
  const u = new URL(url, "http://localhost");
  const rest = u.pathname.replace(/^\/canvas-presence\/?/, "");
  const resourceId = decodeURIComponent((rest.split("/")[0] || "").trim());
  if (!resourceId) return null;
  return { resourceId };
}

// presence 单轨走团队模式：resourceId(chapterId/projectId) 归属的项目必须对该用户团队共享，
// 个人项目一律拒绝——既是省流量，也堵住"任意登录用户凭 resourceId 进房看光标"的越权。
export async function authorizeTeamPresence(resourceId: string, userId: string): Promise<boolean> {
  const db = getPrismaClient();
  const chapter = await getChapterById({ db, chapterId: resourceId }).catch(() => null);
  const projectId = chapter?.project_id || resourceId;
  const project = await getProjectForUserAccess(db, projectId, userId).catch(() => null);
  return Boolean(project?.team_shared);
}

export async function attachPresenceWebsocketServer(httpServer: HttpServer): Promise<void> {
  if (!presenceWsEnabled()) {
    // eslint-disable-next-line no-console
    console.log("[presence] CANVAS_PRESENCE_WS=off，跳过 presence WS 挂载");
    return;
  }
  const wsMod = await import("ws");
  const WebSocketServer = wsMod.WebSocketServer;
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws: import("ws").WebSocket, _req: IncomingMessage, ctx: { resourceId: string; userId: string; sessionId: string }) => {
    const conn: PresenceConn = { userId: ctx.userId, send: (d: string) => { try { ws.send(d); } catch { /* drop */ } } };
    addConn(ctx.resourceId, conn);
    const stopSessionGuard = attachWebSocketSessionGuard(ws, {
      userId: ctx.userId,
      sessionId: ctx.sessionId,
    });
    ws.on("message", (data: unknown) => {
      let msg: { type?: string; name?: string; x?: number; y?: number };
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (!msg || msg.type !== "cursor" || typeof msg.x !== "number" || typeof msg.y !== "number") return;
      broadcast(
        ctx.resourceId,
        JSON.stringify({ type: "cursor", userId: ctx.userId, name: String(msg.name || ""), x: msg.x, y: msg.y }),
        conn,
      );
    });
    const cleanup = () => {
      stopSessionGuard();
      removeConn(ctx.resourceId, conn);
      broadcast(ctx.resourceId, JSON.stringify({ type: "leave", userId: ctx.userId }), conn);
    };
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });

  httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const parsed = parsePresenceUpgrade(req.url || "");
    if (!parsed) return;
    const sessionToken = readWebSocketSessionToken(req);
    if (!sessionToken) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    void verifyJwtHS256<{ sub?: string; sid?: string }>(sessionToken, getJwtSecret())
      .then(async (payload) => {
        if (!payload?.sub) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        const userId = String(payload.sub);
        const session = await validateAuthSession(userId, payload.sid);
        if (!session.valid) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        const allowed = await authorizeTeamPresence(parsed.resourceId, userId);
        if (!allowed) {
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req, { resourceId: parsed.resourceId, userId, sessionId: session.id });
        });
      })
      .catch(() => socket.destroy());
  });

  // eslint-disable-next-line no-console
  console.log("[presence] presence WS 已挂载于 /canvas-presence/<resourceId>（仅团队共享项目放行，CANVAS_PRESENCE_WS 默认 ON）");
}
