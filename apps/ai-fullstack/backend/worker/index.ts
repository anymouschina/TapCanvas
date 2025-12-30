export interface Env {
  AGENT_BACKEND: any;
  AI: any;

  // Optional runtime configuration forwarded into the container.
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  LLM_PROVIDER?: string;
  SEARCH_PROVIDER?: string;
  SEARCH_MODEL?: string;
  QUERY_GENERATOR_MODEL?: string;
  ROLE_SELECTOR_MODEL?: string;
  REFLECTION_MODEL?: string;
  ANSWER_MODEL?: string;
  DEBUG_OPENAI_RESPONSES?: string;
  AUTORAG_ENDPOINT?: string;
  AUTORAG_ID?: string;

  // Internal endpoints auth (recommended to set via `wrangler secret put`).
  INTERNAL_API_SECRET?: string;
}

function summarizeAutoRagResult(result: any): string {
  try {
    const sources = Array.isArray(result?.sources)
      ? result.sources
      : Array.isArray(result?.results)
        ? result.results
        : [];
    const sourceCount = Array.isArray(sources) ? sources.length : 0;
    const titles: string[] = [];
    if (Array.isArray(sources)) {
      for (const s of sources) {
        const t = typeof s?.title === "string" ? s.title : typeof s?.label === "string" ? s.label : "";
        if (t) titles.push(t.slice(0, 80));
        if (titles.length >= 3) break;
      }
    }
    const answer =
      typeof result?.answer === "string"
        ? result.answer
        : typeof result?.output === "string"
          ? result.output
          : "";
    const answerLen = answer ? answer.length : 0;
    const keys =
      result && typeof result === "object" && !Array.isArray(result)
        ? Object.keys(result).slice(0, 12).join(",")
        : typeof result;
    const titlePart = titles.length ? ` titles=${JSON.stringify(titles)}` : "";
    return `keys=${keys} sources=${sourceCount} answerLen=${answerLen}${titlePart}`;
  } catch {
    return "unavailable";
  }
}

function buildCorsHeaders(request: Request): Headers {
  const origin = request.headers.get("Origin");
  const headers = new Headers();

  // Browser CORS: echo the request origin when present (works with credentials).
  // If no Origin header (server-to-server), do not set CORS headers.
  if (!origin) return headers;

  // Restrict to the production web origin only.
  if (origin !== "https://tapcanvas.beqlee.icu") return headers;

  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,Accept,Origin,X-Requested-With",
  );
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}

function pickContainerEnv(env: Env): Record<string, string> {
  const entries: Array<[string, string | undefined]> = [
    ["GEMINI_API_KEY", env.GEMINI_API_KEY],
    ["OPENAI_API_KEY", env.OPENAI_API_KEY],
    ["OPENAI_BASE_URL", env.OPENAI_BASE_URL],
    ["LLM_PROVIDER", env.LLM_PROVIDER],
    ["SEARCH_PROVIDER", env.SEARCH_PROVIDER],
    ["SEARCH_MODEL", env.SEARCH_MODEL],
    ["AUTORAG_ENDPOINT", env.AUTORAG_ENDPOINT],
    ["AUTORAG_ID", env.AUTORAG_ID],
    ["QUERY_GENERATOR_MODEL", env.QUERY_GENERATOR_MODEL],
    ["ROLE_SELECTOR_MODEL", env.ROLE_SELECTOR_MODEL],
    ["REFLECTION_MODEL", env.REFLECTION_MODEL],
    ["ANSWER_MODEL", env.ANSWER_MODEL],
    ["DEBUG_OPENAI_RESPONSES", env.DEBUG_OPENAI_RESPONSES],
    ["INTERNAL_API_SECRET", env.INTERNAL_API_SECRET],
    ["PORT", "8080"],
  ];

  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (typeof v === "string" && v.length) out[k] = v;
  }
  return out;
}

function toContainerRequest(request: Request): Request {
  const url = new URL(request.url);
  const upstream = new URL(`http://127.0.0.1:8080${url.pathname}${url.search}`);
  return new Request(upstream, request);
}

export class AgentBackend {
  private readonly ctx: any;
  private readonly env: Env;
  private starting: Promise<void> | null = null;
  private schemaReady: boolean = false;

  constructor(ctx: any, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  private get sql(): any | null {
    try {
      const storage = (this.ctx as any)?.storage;
      const sql = storage?.sql;
      if (sql && typeof sql.exec === "function") return sql;
      return null;
    } catch {
      return null;
    }
  }

  private ensureSqlSchema(): void {
    if (this.schemaReady) return;
    const sql = this.sql;
    if (!sql) return;
    sql.exec(
      `
      CREATE TABLE IF NOT EXISTS thread_aliases (
        alias TEXT PRIMARY KEY,
        internal_thread_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        refresh_count INTEGER NOT NULL DEFAULT 0
      )
    `,
    );
    this.schemaReady = true;
  }

  private getThreadMapping(alias: string): { internal: string; refreshCount: number } | null {
    this.ensureSqlSchema();
    const sql = this.sql;
    if (!sql) return null;
    try {
      const row = sql
        .exec(
          `SELECT internal_thread_id, refresh_count FROM thread_aliases WHERE alias = ? LIMIT 1`,
          alias,
        )
        .one() as any;
      const internal = typeof row?.internal_thread_id === "string" ? row.internal_thread_id : "";
      const refreshCount = Number(row?.refresh_count ?? 0) || 0;
      if (!internal) return null;
      return { internal, refreshCount };
    } catch {
      return null;
    }
  }

  private upsertThreadMapping(alias: string, internal: string, opts?: { bumpRefresh?: boolean }): void {
    this.ensureSqlSchema();
    const sql = this.sql;
    if (!sql) return;
    const nowIso = new Date().toISOString();
    const bump = opts?.bumpRefresh ? 1 : 0;
    sql.exec(
      `
      INSERT INTO thread_aliases (alias, internal_thread_id, created_at, updated_at, refresh_count)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(alias) DO UPDATE SET
        internal_thread_id = excluded.internal_thread_id,
        updated_at = excluded.updated_at,
        refresh_count = thread_aliases.refresh_count + ?
    `,
      alias,
      internal,
      nowIso,
      nowIso,
      0,
      bump,
    );
  }

  private parseThreadIdFromPath(pathname: string): string | null {
    const m = pathname.match(/^\/threads\/([^\/?#]+)/);
    if (!m) return null;
    const id = (m[1] || "").trim();
    return id ? decodeURIComponent(id) : null;
  }

  private rewriteThreadPath(pathname: string, alias: string, internal: string): string {
    if (!alias || !internal) return pathname;
    return pathname.replace(
      /^\/threads\/([^\/?#]+)/,
      `/threads/${encodeURIComponent(internal)}`,
    );
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async waitForReady(): Promise<void> {
    const start = Date.now();
    const deadlineMs = 30_000;
    let backoffMs = 150;

    while (Date.now() - start < deadlineMs) {
      try {
        const port = this.ctx.container.getTcpPort(8080);
        const res = await port.fetch(new Request("http://127.0.0.1:8080/ok"));
        if (res.ok) return;
      } catch {
        // ignore until ready
      }
      await this.sleep(backoffMs);
      backoffMs = Math.min(1000, Math.floor(backoffMs * 1.6));
    }

    throw new Error("Container did not become ready on port 8080 within 30s");
  }

  private async bufferRequest(request: Request): Promise<Request> {
    const method = request.method.toUpperCase();
    if (method === "GET" || method === "HEAD") return request;
    if (!request.body) return request;

    // Cloudflare streams request bodies; for streaming responses (SSE), the platform may
    // error if the upstream tries to read the request body after the response has started.
    // Buffer the body up-front to ensure it is fully consumed before proxying.
    const body = await request.arrayBuffer();
    return new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
    });
  }

  private async bufferRequestForRetry(
    request: Request,
  ): Promise<{ request: Request; body: ArrayBuffer | null }> {
    const method = request.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || !request.body) {
      return { request, body: null };
    }

    const body = await request.arrayBuffer();
    return {
      request: new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body,
      }),
      body,
    };
  }

  private async ensureStarted(): Promise<void> {
    if (this.ctx.container.running) {
      await this.waitForReady();
      return;
    }

    if (!this.starting) {
      this.starting = (async () => {
        await this.ctx.container.start({
          env: pickContainerEnv(this.env),
          enableInternet: true,
        });
        this.ctx.waitUntil(
          this.ctx.container.monitor().catch((err) => {
            console.log("[container] exited", err);
          }),
        );
        await this.waitForReady();
      })().finally(() => {
        this.starting = null;
      });
    }

    await this.starting;
  }

  private async createUpstreamThread(): Promise<string> {
    await this.ensureStarted();
    const port = this.ctx.container.getTcpPort(8080);
    const res = await port.fetch(
      new Request("http://127.0.0.1:8080/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    const text = await res.text().catch(() => "");
    if (!res.ok) throw new Error(`create thread failed: ${res.status} ${text}`.trim());
    try {
      const parsed = JSON.parse(text);
      const threadId =
        typeof parsed?.thread_id === "string"
          ? parsed.thread_id
          : typeof parsed?.id === "string"
            ? parsed.id
            : "";
      if (!threadId) throw new Error("missing thread_id in response");
      return threadId;
    } catch (err) {
      throw new Error(`invalid create thread response: ${String(err)} ${text.slice(0, 200)}`.trim());
    }
  }

  private async maybePatchThreadIdInJsonResponse(res: Response, alias: string, internal: string): Promise<Response> {
    try {
      const ct = res.headers.get("Content-Type") || "";
      if (!ct.toLowerCase().includes("application/json")) return res;
      // Never buffer streaming responses.
      if (ct.toLowerCase().includes("text/event-stream")) return res;
      const text = await res.text();
      if (!text) return res;
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        return res;
      }
      const replace = (v: any): any => {
        if (!v || typeof v !== "object") return v;
        if (typeof v.thread_id === "string" && v.thread_id === internal) {
          v = { ...v, thread_id: alias };
        }
        return v;
      };
      const next = Array.isArray(parsed) ? parsed.map(replace) : replace(parsed);
      const body = JSON.stringify(next);
      const headers = new Headers(res.headers);
      headers.set("Content-Length", String(new TextEncoder().encode(body).byteLength));
      return new Response(body, { status: res.status, statusText: res.statusText, headers });
    } catch {
      return res;
    }
  }

  async fetch(request: Request): Promise<Response> {
    const bufferedPayload = await this.bufferRequestForRetry(request);
    const buffered = bufferedPayload.request;
    const bufferedBody = bufferedPayload.body;

    // Stable threadId aliasing:
    // - Client continues to use the same threadId (alias).
    // - DO maps alias -> current upstream thread_id, and silently recreates upstream threads when expired.
    const url = new URL(buffered.url);
    const alias = this.parseThreadIdFromPath(url.pathname);
    const mapping = alias ? this.getThreadMapping(alias) : null;
    const internal = alias ? (mapping?.internal || alias) : null;
    if (alias && !mapping) {
      // First-seen alias: assume upstream thread_id equals alias for now.
      this.upsertThreadMapping(alias, internal || alias);
    }

    const initialPath = alias && internal ? this.rewriteThreadPath(url.pathname, alias, internal) : url.pathname;
    const rewrittenUrl = new URL(buffered.url);
    rewrittenUrl.pathname = initialPath;

    await this.ensureStarted();
    const port = this.ctx.container.getTcpPort(8080);
    const upstreamReq = new Request(
      `http://127.0.0.1:8080${rewrittenUrl.pathname}${rewrittenUrl.search}`,
      {
        method: buffered.method,
        headers: buffered.headers,
        body: bufferedBody,
      },
    );
    let res = await port.fetch(upstreamReq);

    // If upstream says thread not found, recreate and retry transparently.
    if (alias && res.status === 404) {
      try {
        const newInternal = await this.createUpstreamThread();
        this.upsertThreadMapping(alias, newInternal, { bumpRefresh: true });
        const retryUrl = new URL(buffered.url);
        retryUrl.pathname = this.rewriteThreadPath(url.pathname, alias, newInternal);
        const retryReq = new Request(
          `http://127.0.0.1:8080${retryUrl.pathname}${retryUrl.search}`,
          {
            method: buffered.method,
            headers: buffered.headers,
            body: bufferedBody,
          },
        );
        res = await port.fetch(retryReq);
        res = await this.maybePatchThreadIdInJsonResponse(res, alias, newInternal);
        const headers = new Headers(res.headers);
        headers.set("x-thread-alias", alias);
        headers.set("x-thread-refreshed", "1");
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      } catch {
        // fall through to original response
      }
    }

    // For JSON responses, hide internal thread id to keep client stable.
    if (alias && internal) {
      res = await this.maybePatchThreadIdInJsonResponse(res, alias, internal);
      const headers = new Headers(res.headers);
      headers.set("x-thread-alias", alias);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }

    return res;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      const cors = buildCorsHeaders(request);
      if (cors.get("Access-Control-Allow-Origin")) {
        return new Response(null, { status: 204, headers: cors });
      }
      return new Response(null, { status: 204 });
    }

    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const res = new Response("ok", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
      const cors = buildCorsHeaders(request);
      if (!cors.get("Access-Control-Allow-Origin")) return res;
      cors.forEach((v, k) => res.headers.set(k, v));
      return res;
    }

    // Cloudflare Workers AI AutoRAG proxy (container can't access `env.AI` directly).
    // Call from the container with: POST /internal/autorag/search { ragId, query, ... }
    if (url.pathname === "/internal/autorag/search") {
      if (request.method !== "POST") {
        return new Response("method not allowed", { status: 405 });
      }

      // Optional protection: if INTERNAL_API_SECRET is set, require it via `x-internal-secret`.
      const expected = env.INTERNAL_API_SECRET;
      if (expected) {
        const provided = request.headers.get("x-internal-secret") || "";
        if (provided !== expected) return new Response("unauthorized", { status: 401 });
      }

      let payload: any = null;
      try {
        payload = await request.json();
      } catch {
        return new Response("invalid json body", { status: 400 });
      }

      const ragId = typeof payload?.ragId === "string" ? payload.ragId.trim() : "";
      const query = typeof payload?.query === "string" ? payload.query.trim() : "";
      if (!ragId || !query) {
        return Response.json(
          { error: "ragId and query are required" },
          { status: 400 },
        );
      }

      const options = typeof payload?.options === "object" && payload.options ? payload.options : {};
      const startedAt = Date.now();
      const result = await env.AI.autorag(ragId).aiSearch({ query, ...options });
      const tookMs = Date.now() - startedAt;
      // Enabled by either DEBUG_AUTORAG=1 or DEBUG_OPENAI_RESPONSES=1 (reuse existing debug switch).
      const debug =
        (typeof (env as any).DEBUG_AUTORAG === "string" && (env as any).DEBUG_AUTORAG === "1") ||
        env.DEBUG_OPENAI_RESPONSES === "1";
      if (debug) {
        console.log(
          "[autorag] aiSearch",
          `ragId=${ragId}`,
          `tookMs=${tookMs}`,
          `query=${query.slice(0, 200)}`,
          summarizeAutoRagResult(result),
        );
      }
      return Response.json({ ok: true, ragId, query, result });
    }

    const id = env.AGENT_BACKEND.idFromName("default");
    const res = await env.AGENT_BACKEND.get(id).fetch(request);
    const cors = buildCorsHeaders(request);
    if (!cors.get("Access-Control-Allow-Origin")) return res;
    const out = new Response(res.body, res);
    cors.forEach((v, k) => out.headers.set(k, v));
    return out;
  },
};
