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

  constructor(ctx: any, env: Env) {
    this.ctx = ctx;
    this.env = env;
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

  async fetch(request: Request): Promise<Response> {
    const buffered = await this.bufferRequest(request);
    await this.ensureStarted();
    return this.ctx.container
      .getTcpPort(8080)
      .fetch(toContainerRequest(buffered));
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
    if (url.pathname === "/health") return new Response("ok");

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
