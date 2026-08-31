import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../types";

vi.mock("../task/task.agents-bridge", () => ({
  runAgentsBridgeChatTask: vi.fn(async () => ({ id: "t1", kind: "chat", status: "succeeded", assets: [], raw: null })),
}));

async function makeApp() {
  const { registerConsultRoute } = await import("./consult.routes.js");
  const app = new Hono<AppEnv>();
  registerConsultRoute(app);
  return app;
}

describe("POST /public/consult", () => {
  it("returns 400 when prompt is missing", async () => {
    const app = await makeApp();
    const res = await app.request("/public/consult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("invalid_request");
  });

  it("streams text events and emits structured + done at the end", async () => {
    const { runAgentsBridgeChatTask } = await import("../task/task.agents-bridge");
    const mockBridge = vi.mocked(runAgentsBridgeChatTask);
    mockBridge.mockImplementationOnce(async (_c, _u, _req, opts) => {
      await opts?.onStreamEvent?.({ event: "content", data: { delta: "根据文档，" } });
      await opts?.onStreamEvent?.({ event: "content", data: { delta: '步骤如下。{"recommendedUnits":["generate_shot_board"],"summary":"先生成分镜"}' } });
      return { id: "t1", kind: "chat", status: "succeeded", assets: [], raw: null };
    });

    const app = await makeApp();
    const res = await app.request("/public/consult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "我想做分镜", sessionId: "s1" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('event: text');
    expect(text).toContain('"delta":"根据文档，"');
    expect(text).toContain('event: structured');
    expect(text).toContain('"recommendedUnits":["generate_shot_board"]');
    expect(text).toContain('event: done');
    expect(text).toContain('"sessionId":"s1"');
  });

  it("extractStructured returns empty on no JSON block", async () => {
    const { extractStructured } = await import("./consult.routes.js");
    const result = extractStructured("这是没有 JSON 块的回答");
    expect(result).toEqual({ recommendedUnits: [], summary: "" });
  });

  it("sessionId is optional — done event has null sessionId when omitted", async () => {
    const app = await makeApp();
    const res = await app.request("/public/consult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });
    const text = await res.text();
    expect(text).toContain('"sessionId":null');
  });
});
