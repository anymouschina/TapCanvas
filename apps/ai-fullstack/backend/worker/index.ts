export interface Env {
  AGENT_BACKEND: any;

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
}

function pickContainerEnv(env: Env): Record<string, string> {
  const entries: Array<[string, string | undefined]> = [
    ["GEMINI_API_KEY", env.GEMINI_API_KEY],
    ["OPENAI_API_KEY", env.OPENAI_API_KEY],
    ["OPENAI_BASE_URL", env.OPENAI_BASE_URL],
    ["LLM_PROVIDER", env.LLM_PROVIDER],
    ["SEARCH_PROVIDER", env.SEARCH_PROVIDER],
    ["SEARCH_MODEL", env.SEARCH_MODEL],
    ["QUERY_GENERATOR_MODEL", env.QUERY_GENERATOR_MODEL],
    ["ROLE_SELECTOR_MODEL", env.ROLE_SELECTOR_MODEL],
    ["REFLECTION_MODEL", env.REFLECTION_MODEL],
    ["ANSWER_MODEL", env.ANSWER_MODEL],
    ["DEBUG_OPENAI_RESPONSES", env.DEBUG_OPENAI_RESPONSES],
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

  constructor(ctx: any, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  private async ensureStarted(): Promise<void> {
    if (this.ctx.container.running) return;
    await this.ctx.container.start({
      env: pickContainerEnv(this.env),
      enableInternet: true,
    });
    this.ctx.waitUntil(
      this.ctx.container.monitor().catch((err) => {
        console.log("[container] exited", err);
      }),
    );
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureStarted();
    return this.ctx.container.getTcpPort(8080).fetch(toContainerRequest(request));
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");

    const id = env.AGENT_BACKEND.idFromName("default");
    return env.AGENT_BACKEND.get(id).fetch(request);
  },
};
