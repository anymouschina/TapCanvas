import path from "node:path";
import { z } from "zod";
import { streamSSE } from "hono/streaming";
import type { Hono } from "hono";
import type { AppEnv } from "../../types";
import { runAgentsBridgeChatTask } from "../task/task.agents-bridge";

const CONSULT_USER_ID = "__consult__";
// In Docker, agents-bridge mounts docs at /runtime/workspace/docs (set via CONSULT_AGENTS_DOCS_ROOT).
// In local dev, falls back to apps/docs relative to process.cwd().
const DOCS_ROOT = process.env.CONSULT_AGENTS_DOCS_ROOT ?? path.resolve(process.cwd(), "apps/docs");

const ConsultRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  sessionId: z.string().optional(),
});

function buildConsultSystemPrompt(): string {
  return `你是 TapCanvas 的业务顾问 AI。

当用户描述业务需求时，请：
1. 使用 read 或 grep 工具查阅以下文档：
   - ${DOCS_ROOT}/PROJECT.md  （平台架构与节点协议）
   - ${DOCS_ROOT}/TOOLS.md    （13个最小执行单元及触发场景）
2. 用简体中文回答，结合具体文档内容
3. 回答结尾，输出一个 JSON 块（不加代码围栏）：
   {"recommendedUnits":["unit1","unit2"],"summary":"一句话概括推荐方案"}
   若无明确匹配的执行单元，recommendedUnits 为空数组。`;
}

function extractStructured(fullText: string): { recommendedUnits: string[]; summary: string } {
  const match = fullText.match(/\{"recommendedUnits"\s*:\s*\[.*?\]\s*,\s*"summary"\s*:\s*"[^"]*"\s*\}/s);
  if (!match) return { recommendedUnits: [], summary: "" };
  try {
    const parsed = JSON.parse(match[0]) as { recommendedUnits?: unknown; summary?: unknown };
    const units = Array.isArray(parsed.recommendedUnits)
      ? parsed.recommendedUnits.filter((u): u is string => typeof u === "string")
      : [];
    const summary = typeof parsed.summary === "string" ? parsed.summary : "";
    return { recommendedUnits: units, summary };
  } catch {
    return { recommendedUnits: [], summary: "" };
  }
}

export { extractStructured };

export function registerConsultRoute(app: Hono<AppEnv>): void {
  app.post("/public/consult", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, code: "invalid_request", message: "invalid JSON body" }, 400);
    }
    const parsed = ConsultRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, code: "invalid_request", message: "prompt is required (1–2000 chars)" }, 400);
    }
    const { prompt, sessionId } = parsed.data;

    return streamSSE(c, async (stream) => {
      const fullTextParts: string[] = [];
      try {
        await runAgentsBridgeChatTask(
          c,
          CONSULT_USER_ID,
          {
            kind: "chat",
            prompt,
            extras: {
              systemPrompt: buildConsultSystemPrompt(),
              privilegedLocalAccess: true,
              localResourcePaths: [DOCS_ROOT],
              ...(sessionId ? { sessionKey: sessionId } : {}),
            },
          },
          {
            abortSignal: c.req.raw.signal,
            onStreamEvent: async (event) => {
              if (event.event === "content") {
                const delta = event.data.delta ?? "";
                if (delta) {
                  fullTextParts.push(delta);
                  await stream.writeSSE({ event: "text", data: JSON.stringify({ delta }) });
                }
              }
            },
          },
        );
        if (c.req.raw.signal.aborted) return;
        const structured = extractStructured(fullTextParts.join(""));
        await stream.writeSSE({ event: "structured", data: JSON.stringify(structured) });
        await stream.writeSSE({ event: "done", data: JSON.stringify({ sessionId: sessionId ?? null }) });
      } catch (error) {
        if (c.req.raw.signal.aborted) return;
        const message = error instanceof Error ? error.message : "consult failed";
        await stream.writeSSE({ event: "error", data: JSON.stringify({ message }) });
        await stream.writeSSE({ event: "done", data: JSON.stringify({ reason: "error" }) });
      }
    });
  });
}
