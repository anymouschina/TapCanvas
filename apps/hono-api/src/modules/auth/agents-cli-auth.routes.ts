import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware, resolveAuth } from "../../middleware/auth";
import { getConfig } from "../../config";
import { signJwtHS256, verifyJwtHS256 } from "../../jwt";

export const agentsCliAuthRouter = new Hono<AppEnv>();

type AgentsCliGrantPayload = {
  sub: string;
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
  type: "agents_cli_grant";
  scopes: string[];
  bridgeBaseUrl?: string | null;
};

type LoginSessionStatus = "pending" | "approved" | "denied" | "expired";

type PendingLoginSession = {
  sessionId: string;
  status: LoginSessionStatus;
  createdAt: string;
  expiresAt: string;
  grantExpiresAt: string | null;
  clientName: string;
  bridgeBaseUrl: string | null;
  scopes: string[];
  approvedAt: string | null;
  deniedAt: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  issuedAt: string | null;
  user: {
    id: string;
    login: string;
    name: string | null;
    avatarUrl: string | null;
  } | null;
};

const LOGIN_SESSION_TTL_MS = 10 * 60 * 1000;
const LOGIN_GRANT_TTL_SECONDS = 7 * 24 * 60 * 60;
const LOGIN_REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const POLL_INTERVAL_MS = 2000;
const MAX_IN_MEMORY_SESSIONS = 200;

const loginSessionStore = new Map<string, PendingLoginSession>();

function pruneLoginSessions(now = Date.now()): void {
  for (const [sessionId, session] of loginSessionStore.entries()) {
    const expiresAtMs = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
      loginSessionStore.set(sessionId, { ...session, status: "expired" });
      loginSessionStore.delete(sessionId);
      continue;
    }
  }
  while (loginSessionStore.size > MAX_IN_MEMORY_SESSIONS) {
    const oldest = loginSessionStore.keys().next();
    if (oldest.done) break;
    loginSessionStore.delete(oldest.value);
  }
}

function randomSessionId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function resolveApiOrigin(url: string): string {
  return new URL(url).origin;
}

function normalizeScopes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 16);
}

function getLoginSessionOrExpired(sessionId: string): PendingLoginSession | null {
  pruneLoginSessions();
  const existing = loginSessionStore.get(sessionId);
  if (!existing) return null;
  const expiresAtMs = Date.parse(existing.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    const expired = { ...existing, status: "expired" as const };
    loginSessionStore.set(sessionId, expired);
    return expired;
  }
  return existing;
}

async function signAgentsCliGrant(
  c: Parameters<typeof authMiddleware>[0],
  payload: AgentsCliGrantPayload,
  expiresInSeconds: number,
): Promise<string> {
  const config = getConfig(c.env);
  return await signJwtHS256(payload as Record<string, unknown>, config.jwtSecret, expiresInSeconds);
}

async function verifyAgentsCliGrant(c: Parameters<typeof authMiddleware>[0], token: string): Promise<AgentsCliGrantPayload | null> {
  const config = getConfig(c.env);
  const payload = await verifyJwtHS256<AgentsCliGrantPayload>(token, config.jwtSecret);
  if (!payload || payload.type !== "agents_cli_grant" || !payload.sub || !payload.login) return null;
  return payload;
}

agentsCliAuthRouter.post("/session", async (c) => {
  pruneLoginSessions();
  const body = (await c.req.json().catch(() => ({}))) ?? {};
  const clientName = typeof body.clientName === "string" && body.clientName.trim() ? body.clientName.trim().slice(0, 120) : "local-agents-cli";
  const bridgeBaseUrl = typeof body.bridgeBaseUrl === "string" && body.bridgeBaseUrl.trim() ? body.bridgeBaseUrl.trim().slice(0, 500) : null;
  const scopes = normalizeScopes(body.scopes);
  const sessionId = randomSessionId();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + LOGIN_SESSION_TTL_MS).toISOString();
  const apiOrigin = resolveApiOrigin(c.req.url);
  const session: PendingLoginSession = {
    sessionId,
    status: "pending",
    createdAt,
    expiresAt,
    grantExpiresAt: null,
    clientName,
    bridgeBaseUrl,
    scopes,
    approvedAt: null,
    deniedAt: null,
    accessToken: null,
    refreshToken: null,
    issuedAt: null,
    user: null,
  };
  loginSessionStore.set(sessionId, session);
  return c.json({
    success: true,
    sessionId,
    status: session.status,
    expiresAt,
    intervalMs: POLL_INTERVAL_MS,
    verificationUrl: `${apiOrigin}/auth/agents-cli/approve?sessionId=${encodeURIComponent(sessionId)}`,
    pollUrl: `${apiOrigin}/auth/agents-cli/session/${encodeURIComponent(sessionId)}`,
  });
});

agentsCliAuthRouter.get("/session/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = getLoginSessionOrExpired(sessionId);
  if (!session) {
    return c.json({ success: false, error: "session_not_found" }, 404);
  }
  return c.json({
    success: true,
    sessionId: session.sessionId,
    status: session.status,
    expiresAt: session.expiresAt,
    grantExpiresAt: session.grantExpiresAt,
    issuedAt: session.issuedAt,
    accessToken: session.accessToken ?? undefined,
    refreshToken: session.refreshToken ?? undefined,
    bridgeBaseUrl: session.bridgeBaseUrl,
    scopes: session.scopes,
    user: session.user ?? undefined,
  });
});

agentsCliAuthRouter.get("/approve", async (c) => {
  const sessionId = String(c.req.query("sessionId") || "").trim();
  if (!sessionId) return c.text("missing sessionId", 400);
  const session = getLoginSessionOrExpired(sessionId);
  if (!session) return c.text("session not found", 404);
  const resolved = await resolveAuth(c);
  if (!resolved) {
    const redirect = `/auth/session?redirect=${encodeURIComponent(c.req.url)}`;
    return c.redirect(redirect, 302);
  }
  const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agents CLI 授权</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif;background:#0f1115;color:#fff;display:flex;justify-content:center;padding:40px}
    .card{max-width:640px;width:100%;background:#171a21;border-radius:16px;padding:24px}
    .muted{color:#98a2b3}.scope{display:inline-block;background:#222733;border-radius:999px;padding:6px 10px;margin:4px}
    button{border:0;border-radius:10px;padding:12px 18px;font-size:16px;cursor:pointer}
    .approve{background:#7c5cff;color:#fff}.deny{background:#2a2f3a;color:#fff}
  </style>
</head>
<body>
  <div class="card">
    <h1>授权本机 agents-cli</h1>
    <p class="muted">当前浏览器已登录 TapCanvas。确认后，该 CLI 会话将获得短期授权，可继续通过 agents-cli 调用画布/生图/视频能力。</p>
    <p><strong>设备：</strong>${escapeHtml(session.clientName)}</p>
    <p><strong>账号：</strong>${escapeHtml(String(resolved.payload.login || resolved.payload.sub || ""))}</p>
    <p><strong>权限：</strong>${session.scopes.map((scope) => `<span class="scope">${escapeHtml(scope)}</span>`).join("") || "<span class=\"scope\">agents:chat</span>"}</p>
    <p><strong>过期：</strong>${escapeHtml(session.expiresAt)}</p>
    <form method="post" action="/auth/agents-cli/approve">
      <input type="hidden" name="sessionId" value="${escapeHtml(session.sessionId)}" />
      <input type="hidden" name="decision" value="approve" />
      <button class="approve" type="submit">允许并继续</button>
    </form>
    <form method="post" action="/auth/agents-cli/approve" style="margin-top:12px">
      <input type="hidden" name="sessionId" value="${escapeHtml(session.sessionId)}" />
      <input type="hidden" name="decision" value="deny" />
      <button class="deny" type="submit">拒绝</button>
    </form>
  </div>
</body>
</html>`;
  return c.html(page);
});

agentsCliAuthRouter.post("/approve", authMiddleware, async (c) => {
  const contentType = String(c.req.header("content-type") || "").toLowerCase();
  let sessionId = "";
  let decision = "approve";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await c.req.formData();
    sessionId = String(form.get("sessionId") || "").trim();
    decision = String(form.get("decision") || "approve").trim();
  } else {
    const body = (await c.req.json().catch(() => ({}))) ?? {};
    sessionId = String((body as Record<string, unknown>).sessionId || "").trim();
    decision = String((body as Record<string, unknown>).decision || "approve").trim();
  }
  if (!sessionId) return c.json({ success: false, error: "sessionId_required" }, 400);
  const session = getLoginSessionOrExpired(sessionId);
  if (!session) return c.json({ success: false, error: "session_not_found" }, 404);
  if (session.status !== "pending") {
    return c.json({ success: true, sessionId: session.sessionId, status: session.status });
  }
  if (decision !== "approve") {
    const denied = { ...session, status: "denied" as const, deniedAt: new Date().toISOString() };
    loginSessionStore.set(sessionId, denied);
    return c.html(`<html><body><p>已拒绝该 agents-cli 授权请求。</p></body></html>`);
  }

  const resolved = await resolveAuth(c);
  if (!resolved) return c.json({ success: false, error: "unauthorized" }, 401);
  const user = {
    id: String(resolved.payload.sub),
    login: String(resolved.payload.login || resolved.payload.sub),
    name: typeof resolved.payload.name === "string" ? resolved.payload.name : null,
    avatarUrl: typeof resolved.payload.avatarUrl === "string" ? resolved.payload.avatarUrl : null,
  };
  const issuedAt = new Date().toISOString();
  const grantExpiresAt = new Date(Date.now() + LOGIN_GRANT_TTL_SECONDS * 1000).toISOString();
  const accessToken = await signAgentsCliGrant(c, {
    sub: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
    type: "agents_cli_grant",
    scopes: session.scopes,
    bridgeBaseUrl: session.bridgeBaseUrl,
  }, LOGIN_GRANT_TTL_SECONDS);
  const refreshToken = await signAgentsCliGrant(c, {
    sub: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
    type: "agents_cli_grant",
    scopes: session.scopes,
    bridgeBaseUrl: session.bridgeBaseUrl,
  }, LOGIN_REFRESH_TTL_SECONDS);
  const approved = {
    ...session,
    status: "approved" as const,
    approvedAt: issuedAt,
    accessToken,
    refreshToken,
    issuedAt,
    grantExpiresAt,
    user,
  };
  loginSessionStore.set(sessionId, approved);
  return c.html(`<html><body><p>授权成功，现在可以回到终端继续使用 agents-cli。</p></body></html>`);
});

export async function resolveAgentsCliGrant(c: Parameters<typeof authMiddleware>[0]): Promise<{
  userId: string;
  login: string;
  scopes: string[];
  bridgeBaseUrl: string | null;
} | null> {
  const authorization = String(c.req.header("authorization") || "").trim();
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!token) return null;
  const payload = await verifyAgentsCliGrant(c, token);
  if (!payload) return null;
  return {
    userId: payload.sub,
    login: payload.login,
    scopes: Array.isArray(payload.scopes) ? payload.scopes : [],
    bridgeBaseUrl: typeof payload.bridgeBaseUrl === "string" ? payload.bridgeBaseUrl : null,
  };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
