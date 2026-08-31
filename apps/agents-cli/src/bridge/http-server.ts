import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { randomUUID } from "node:crypto";

import { BridgeRequestError, parseAgentsChatRequest } from "./contracts.js";
import type { JsonObject } from "./contracts.js";
import type { BridgeStreamEvent } from "./event-projector.js";
import { HarnessChatLifecycleStore } from "./chat-lifecycle.js";
import { HarnessRuntime, resolveDshHome } from "./harness-runtime.js";
import { RequestMcpGateway } from "./mcp-gateway.js";

export type HarnessHttpServerOptions = Readonly<{
  host: string;
  port: number;
  workspaceRoot: string;
  token?: string;
  bodyLimitBytes?: number;
  environment?: NodeJS.ProcessEnv;
}>;

export type HarnessHttpServer = Readonly<{
  url: string;
  close(): Promise<void>;
}>;

class BodyLimitError extends Error {}

class SseWriter {
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly response: ServerResponse) {}

  emit(event: BridgeStreamEvent): void {
    if (this.closed) return;
    const frame = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
    this.queue = this.queue.then(async () => {
      if (this.closed || this.response.writableEnded) return;
      if (!this.response.write(frame)) await once(this.response, "drain");
    });
  }

  async finish(): Promise<void> {
    await this.queue;
    this.closed = true;
    if (!this.response.writableEnded) this.response.end();
  }

  stop(): void {
    this.closed = true;
  }
}

class SessionSerialGate {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(key) ?? Promise.resolve();
    const current = prior.catch(() => undefined).then(task);
    this.tails.set(key, current);
    try {
      return await current;
    } finally {
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }
}

function authorize(request: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true;
  const authorization = request.headers.authorization;
  const agentsToken = request.headers["x-agents-token"];
  return authorization === `Bearer ${token}` || agentsToken === token;
}

async function readJson(request: IncomingMessage, limitBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > limitBytes) throw new BodyLimitError(`request body exceeds ${limitBytes} bytes`);
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) throw new SyntaxError("request body is empty");
  return JSON.parse(text) as unknown;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  response.end(payload);
}

function beginSse(response: ServerResponse): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
}

function errorDetails(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof BridgeRequestError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error instanceof BodyLimitError) {
    return { status: 413, code: "request_body_too_large", message: error.message };
  }
  if (error instanceof SyntaxError) {
    return { status: 400, code: "invalid_json", message: error.message };
  }
  return {
    status: 500,
    code: "deepseek_harness_bridge_failed",
    message: error instanceof Error ? error.message : String(error),
  };
}

function requestAbortSignal(request: IncomingMessage, response: ServerResponse): AbortSignal {
  const controller = new AbortController();
  request.once("aborted", () => controller.abort(new Error("client request aborted")));
  response.once("close", () => {
    if (!response.writableEnded) controller.abort(new Error("client response closed"));
  });
  return controller.signal;
}

function combineAbortSignals(signals: readonly AbortSignal[]): AbortSignal {
  if (signals.length === 1) return signals[0];
  return AbortSignal.any([...signals]);
}

function requiredBodyString(body: unknown, key: string): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BridgeRequestError("request body must be a JSON object", "invalid_request_body");
  }
  const value = (body as Record<string, unknown>)[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new BridgeRequestError(`${key} is required`, `${key}_required`);
  }
  return value.trim();
}

function chatGateKey(request: ReturnType<typeof parseAgentsChatRequest>): string {
  return `${request.userId ?? "anonymous"}\0${request.sessionId ?? randomUUID()}`;
}

export async function startHarnessHttpServer(
  options: HarnessHttpServerOptions,
): Promise<HarnessHttpServer> {
  const gateway = new RequestMcpGateway();
  const gate = new SessionSerialGate();
  const hostForChild = options.host === "0.0.0.0" || options.host === "::"
    ? "127.0.0.1"
    : options.host;
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const publicOrigin = `http://${options.host}:${address.port}`;
  const childOrigin = `http://${hostForChild}:${address.port}`;
  const runtime = new HarnessRuntime({
    workspaceRoot: options.workspaceRoot,
    bridgeOrigin: childOrigin,
    mcpGateway: gateway,
    environment: options.environment,
  });
  const lifecycle = new HarnessChatLifecycleStore(
    `${resolveDshHome(options.environment ?? process.env)}/tapcanvas-chat-status`,
  );
  try {
    await runtime.initialize();
  } catch (error: unknown) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }

  server.on("request", async (request, response) => {
    const method = (request.method ?? "GET").toUpperCase();
    const url = new URL(request.url ?? "/", childOrigin);
    try {
      if (method === "GET" && url.pathname === "/health") {
        writeJson(response, 200, {
          ok: true,
          runtime: "deepseek-harness",
          profile: "sdk",
          upstreamVersion: "0.1.2-alpha.2",
        });
        return;
      }
      if (method === "GET" && url.pathname === "/collab/status") {
        writeJson(response, 200, {
          runtime: "deepseek-harness",
          status: "ready",
          agents: [],
          submissions: [],
        });
        return;
      }
      if (method === "POST" && url.pathname.startsWith("/internal/mcp/")) {
        const token = decodeURIComponent(url.pathname.slice("/internal/mcp/".length));
        const body = await readJson(request, options.bodyLimitBytes ?? 8_000_000);
        const result = await gateway.handle(token, request.headers.authorization, body);
        if (typeof result.body === "undefined") {
          response.writeHead(result.status);
          response.end();
        } else {
          writeJson(response, result.status, result.body);
        }
        return;
      }
      if (method === "POST" && url.pathname === "/chat/status") {
        if (!authorize(request, options.token)) {
          writeJson(response, 401, { error: "unauthorized" });
          return;
        }
        const body = await readJson(request, options.bodyLimitBytes ?? 8_000_000);
        const userId = requiredBodyString(body, "userId");
        const sessionId = requiredBodyString(body, "sessionId");
        writeJson(response, 200, await lifecycle.status(userId, sessionId));
        return;
      }
      if (method === "POST" && url.pathname === "/chat/interrupt") {
        if (!authorize(request, options.token)) {
          writeJson(response, 401, { error: "unauthorized" });
          return;
        }
        const body = await readJson(request, options.bodyLimitBytes ?? 8_000_000);
        const userId = requiredBodyString(body, "userId");
        const sessionId = requiredBodyString(body, "sessionId");
        const turnId = requiredBodyString(body, "turnId");
        const reasonCode = body && typeof body === "object" && !Array.isArray(body)
          ? requiredBodyString(
              { reasonCode: (body as Record<string, unknown>).reasonCode ?? "chat_turn_user_interrupt" },
              "reasonCode",
            )
          : "chat_turn_user_interrupt";
        const result = await lifecycle.interrupt({ userId, sessionId, turnId, reasonCode });
        writeJson(response, 200, {
          ok: true,
          interrupted: result.interrupted,
          sessionId,
          turnId: result.snapshot.turn && typeof result.snapshot.turn.turnId === "string"
            ? result.snapshot.turn.turnId
            : null,
          status: result.snapshot,
        });
        return;
      }
      if (method !== "POST" || url.pathname !== "/chat") {
        writeJson(response, 404, { error: "not_found" });
        return;
      }
      if (!authorize(request, options.token)) {
        writeJson(response, 401, { error: "unauthorized" });
        return;
      }

      const raw = await readJson(request, options.bodyLimitBytes ?? 8_000_000);
      const chatRequest = parseAgentsChatRequest(raw, options.environment ?? process.env);
      const requestSignal = requestAbortSignal(request, response);
      const run = async (): Promise<void> => {
        const lifecycleLease = await lifecycle.begin(chatRequest);
        const abortSignal = combineAbortSignals([requestSignal, lifecycleLease.signal]);
        const lifecycleUserId = chatRequest.userId ?? "anonymous";
        if (!chatRequest.stream) {
          try {
            const result = await runtime.run(chatRequest, () => undefined, abortSignal);
            await lifecycle.complete(lifecycleUserId, lifecycleLease.sessionId, result);
            writeJson(response, 200, result.response);
          } catch (error: unknown) {
            await lifecycle.fail(lifecycleUserId, lifecycleLease.sessionId, error);
            throw error;
          }
          return;
        }
        beginSse(response);
        const writer = new SseWriter(response);
        response.once("close", () => writer.stop());
        try {
          const result = await runtime.run(chatRequest, (event) => writer.emit(event), abortSignal);
          await lifecycle.complete(lifecycleUserId, lifecycleLease.sessionId, result);
          result.projector.finish(result.response, result.text);
        } catch (error: unknown) {
          await lifecycle.fail(lifecycleUserId, lifecycleLease.sessionId, error);
          const details = errorDetails(error);
          writer.emit({
            event: "error",
            data: {
              code: details.code,
              message: details.message,
              terminal: false,
              scope: "provider",
              retryability: "unknown",
              acceptanceKnown: true,
              sideEffectOutcomeKnown: false,
            },
          });
          writer.emit({ event: "done", data: { reason: "error" } });
        } finally {
          await writer.finish();
        }
      };
      await gate.run(chatGateKey(chatRequest), run);
    } catch (error: unknown) {
      const details = errorDetails(error);
      if (!response.headersSent) {
        writeJson(response, details.status, {
          error: details.code,
          message: details.message,
        });
      } else if (!response.writableEnded) {
        response.end();
      }
    }
  });

  return {
    url: publicOrigin,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}
