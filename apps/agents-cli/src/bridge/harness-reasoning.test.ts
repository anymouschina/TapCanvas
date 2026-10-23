import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { isJsonObject, type AgentsChatRequest, type JsonObject } from "./contracts.js";
import { HarnessRuntime } from "./harness-runtime.js";
import { RequestMcpGateway } from "./mcp-gateway.js";

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    else if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
    else throw new Error("Unexpected HTTP request chunk");
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function writeCompletion(response: ServerResponse, text: string): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  const chunk = {
    id: "reasoning-regression-completion",
    object: "chat.completion.chunk",
    created: 1,
    model: "deepseek-v4.1-flash",
  };
  response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
  response.end("data: [DONE]\n\n");
}

function writeResponsesCompletion(response: ServerResponse, text: string): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  const item = { id: "msg_local_reasoning", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
  const events: JsonObject[] = [
    { type: "response.created", response: { id: "resp_local_reasoning", status: "in_progress" } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
    { type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: item.id, delta: text },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id: "resp_local_reasoning", status: "completed", output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ];
  for (const event of events) response.write(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`);
  response.end();
}

function makeRequest(origin: string, reasoningEffort?: string): AgentsChatRequest {
  return {
    prompt: "Return the local gateway's exact answer.",
    stream: true,
    systemPrompt: "Use only the configured local model gateway.",
    model: "deepseek-v4.1-flash",
    apiBaseUrl: `${origin}/v1`,
    apiKey: "local-regression-key",
    apiStyle: "openai-completions",
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    requiredSkills: [],
    requiredSkillCalls: [],
    externalSkills: [],
    externalSkillResolverConfig: null,
    referenceImages: [],
    assetInputs: [],
    remoteTools: [],
    remoteToolCatalog: [],
    remoteToolConfig: null,
    turnContext: { logicalTaskId: "local-reasoning-regression" },
    raw: {},
  };
}

test("real sdk profile preserves reasoning effort through the TapCanvas provider overlay", { timeout: 240_000 }, async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tapcanvas-harness-reasoning-"));
  const skills = path.join(root, "skills");
  await mkdir(skills);
  context.after(() => rm(root, { recursive: true, force: true }));

  const gateway = new RequestMcpGateway();
  const providerRequests: JsonObject[] = [];
  const serverErrors: Error[] = [];
  let providerError = false;
  const answer = "local-provider-reasoning-result";
  const errorMessage = "local-provider-reasoning-error: quota denied";
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname.startsWith("/internal/mcp/")) {
        response.writeHead(405, { Allow: "POST" });
        response.end();
        return;
      }
      if (request.method === "POST" && url.pathname.startsWith("/internal/mcp/")) {
        const token = decodeURIComponent(url.pathname.slice("/internal/mcp/".length));
        const result = await gateway.handle(token, request.headers.authorization, await readJson(request));
        if (result.body === undefined) {
          response.writeHead(result.status);
          response.end();
        } else writeJson(response, result.status, result.body);
        return;
      }
      if (request.method === "POST" && (url.pathname === "/v1/chat/completions" || url.pathname === "/v1/responses")) {
        const body = await readJson(request);
        assert.ok(isJsonObject(body), "provider request must be a JSON object");
        providerRequests.push(body);
        assert.equal(body.model, "deepseek-v4.1-flash");
        assert.equal(request.headers.authorization, "Bearer local-regression-key");
        if (providerError) writeJson(response, 400, { error: { message: errorMessage, type: "invalid_request_error", code: "local_quota_denied" } });
        else if (url.pathname === "/v1/responses") writeResponsesCompletion(response, answer);
        else writeCompletion(response, answer);
        return;
      }
      throw new Error(`Unexpected local HTTP request: ${request.method} ${url.pathname}`);
    })().catch((error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      serverErrors.push(failure);
      writeJson(response, 500, { error: { message: failure.message } });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const runtime = new HarnessRuntime({
    workspaceRoot: root,
    bridgeOrigin: origin,
    mcpGateway: gateway,
    environment: {
      ...process.env,
      DSH_HOME: path.join(root, "dsh"),
      AGENTS_SKILLS_DIR: skills,
      AGENTS_INITIALIZE_TIMEOUT_MS: "30000",
      AGENTS_REQUEST_TIMEOUT_MS: "20000",
      // Request-scoped settings must replace, or clear, inherited process state.
      TAPCANVAS_DSH_REASONING_EFFORT: "high",
    },
  });

  for (const effort of ["low", "xhigh", "none", undefined] as const) {
    await context.test(`sends ${effort ?? "unspecified"} without rejecting the model capability`, async (subtest) => {
      const before = providerRequests.length;
      const result = await runtime.run(makeRequest(origin, effort), () => {}, subtest.signal);
      assert.deepEqual(serverErrors, []);
      assert.equal(providerRequests.length, before + 1, "the real Harness must reach the local provider exactly once");
      const wire = providerRequests[before];
      assert.ok(wire);
      assert.equal(wire.reasoning_effort, effort);
      assert.equal(Object.hasOwn(wire, "reasoning_effort"), effort !== undefined);
      assert.equal(result.text, answer, "assert the actual provider result, not only absence of a capability error");
      assert.doesNotMatch(JSON.stringify(result.response), /UNSUPPORTED_REASONING_EFFORT|does not support reasoning effort/u);
      // This fixture intentionally omits report_delivery: transport success must
      // not manufacture a successful logical delivery receipt.
      const trace = result.response.trace;
      assert.ok(isJsonObject(trace));
      const termination = isJsonObject(trace.completion) ? trace.completion.termination : undefined;
      assert.ok(isJsonObject(termination));
      assert.equal(termination.kind, "completed");
    });
  }

  await context.test("preserves low in the Responses API wire format", async (subtest) => {
    const before = providerRequests.length;
    const result = await runtime.run({ ...makeRequest(origin, "low"), apiStyle: "openai-responses" }, () => {}, subtest.signal);
    assert.deepEqual(serverErrors, []);
    assert.equal(providerRequests.length, before + 1);
    const wire = providerRequests[before];
    assert.ok(wire && isJsonObject(wire.reasoning));
    assert.equal(wire.reasoning.effort, "low");
    assert.equal(Object.hasOwn(wire, "reasoning_effort"), false);
    assert.equal(result.text, answer);
    assert.doesNotMatch(JSON.stringify(result.response), /UNSUPPORTED_REASONING_EFFORT|does not support reasoning effort/u);
  });

  await context.test("preserves the provider's actual failure without retrying or changing models", async (subtest) => {
    providerError = true;
    const before = providerRequests.length;
    const result = await runtime.run(makeRequest(origin, "low"), () => {}, subtest.signal);
    assert.deepEqual(serverErrors, []);
    assert.equal(providerRequests.length, before + 1);
    assert.equal(providerRequests[before]?.reasoning_effort, "low");
    assert.equal(result.completed, false);
    assert.match(JSON.stringify(result.response), new RegExp(errorMessage, "u"));
    assert.doesNotMatch(JSON.stringify(result.response), /UNSUPPORTED_REASONING_EFFORT|does not support reasoning effort/u);
  });
});
