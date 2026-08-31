// 【MCP 远程 server（Streamable HTTP·JSON 模式）】
// 让原生 MCP 客户端（Claude Code / Cursor 等）用 `claude mcp add --transport http <BASE>/public/mcp
// --header "Authorization: Bearer tc_sk_..."` 一行接入 TapCanvas，把小T 当子 agent 调用。
//
// 本层只做【协议翻译】：MCP JSON-RPC(initialize/tools/list/tools/call/ping) ↔ canonical
// agents bridge chat task。鉴权复用 /public/* 的 apiKeyAuthMiddleware（tc_sk_ Key）；
// tools/call 传 canvasProjectId 时，由 runAgentsBridgeChatTask 统一装配画布上下文、远程工具、
// API-key 生成计费、completion gate 与 delivery verifier，不再借道 A2A 协议。
//
// 纯 JSON 响应（不开 SSE 流）符合 MCP Streamable HTTP 规范的「server MAY return a single JSON response」，
// Claude Code 的 http transport 兼容。GET（服务端→客户端 SSE 流）不提供，按规范返回 405。

import type { AppContext } from "../../types";
import { runAgentsBridgeChatTask } from "../task/task.agents-bridge";
import type {
	TaskRequestDto,
	TaskResultDto,
} from "../task/task.schemas";
import {
	buildMcpAgentTaskRequest,
	formatMcpAgentTaskResult,
} from "./public-mcp-agent-adapter";

/** 当前实现真正支持的 MCP 协议版本。initialize 不回显未实现的客户端版本。 */
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "TapCanvas", version: "1.0.0" } as const;

/** 暴露给 MCP 客户端的工具集（v1 只暴露与小T 对话/编排，传 canvasProjectId 才解锁出图/出视频）。 */
export const MCP_TOOLS = [
  {
    name: "ask_tapcanvas",
    description:
      "向 TapCanvas 的 AI 智能体「小T」提问或下达创作指令（文案 / 分镜 / 画布编排）。" +
      "传 canvasProjectId 时，小T 会在该画布上出图 / 出视频（按本 API Key 计费）；不传则只做文本回复。",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          minLength: 1,
          description: "你的非空问题或创作指令",
        },
        canvasProjectId: {
          type: "string",
          description: "可选：目标画布项目 ID。传了才允许出图 / 出视频，产物落到该画布。",
        },
        canvasFlowId: {
          type: "string",
          description: "可选：画布内的具体 flow ID；必须与 canvasProjectId 一起提供。",
        },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
] as const;

type JsonRpcId = string | number | null;
interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** tools/call 的执行器签名——注入式，便于单测脱离 bridge。 */
export type McpToolCaller = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ text: string; isError?: boolean }>;

export type McpChatTaskRunner = (
	c: AppContext,
	userId: string,
	request: TaskRequestDto,
) => Promise<TaskResultDto>;

export function createMcpToolCaller(
	c: AppContext,
	userId: string,
	runChatTask: McpChatTaskRunner = runAgentsBridgeChatTask,
): McpToolCaller {
	return async (name, args) => {
		if (name !== "ask_tapcanvas") {
			throw new Error(`未知 MCP 工具：${name}`);
		}
		const request = buildMcpAgentTaskRequest(args);
		const result = await runChatTask(c, userId, request);
		return formatMcpAgentTaskResult(result);
	};
}

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

/**
 * 处理单条 MCP JSON-RPC 请求，返回要回给客户端的 JSON-RPC 对象；
 * 通知类（无 id 的 notifications/*）返回 null（HTTP 层回 202 空响应）。纯逻辑、可单测。
 */
export async function handleMcpMessage(
  req: JsonRpcRequest,
  callTool: McpToolCaller,
): Promise<Record<string, unknown> | null> {
  const method = String(req?.method ?? "");
  const id = (req?.id ?? null) as JsonRpcId;

  // 通知（无 id）：initialized 等，无需响应。
  if (method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize": {
      return rpcResult(id, {
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "用 ask_tapcanvas 与 TapCanvas 智能体小T 对话。要出图/出视频，传 canvasProjectId（按本 Key 计费）。",
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: MCP_TOOLS });
    case "tools/call": {
      const name = String(req?.params?.name ?? "");
      const args = isRecord(req?.params?.arguments)
        ? req.params.arguments
        : {};
      const known = MCP_TOOLS.some((t) => t.name === name);
      if (!known) return rpcError(id, -32602, `未知工具：${name}`);
      try {
        const { text, isError } = await callTool(name, args);
        return rpcResult(id, {
          content: [{ type: "text", text }],
          ...(isError ? { isError: true } : {}),
        });
      } catch (err) {
        // 工具执行错误按 MCP 约定放进 result.isError（而非 JSON-RPC error），让模型能看到原因。
        return rpcResult(id, {
          content: [{ type: "text", text: `工具执行失败：${String((err as Error)?.message || err)}` }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `方法不存在：${method}`);
  }
}

/** Hono 路由处理器：POST /public/mcp（已过 apiKeyAuthMiddleware）。 */
export async function handleMcpRoute(c: AppContext): Promise<Response> {
  if (c.req.method === "GET" || c.req.method === "DELETE") {
    // 不提供 server→client 的 SSE 流 / 会话删除：按 MCP 规范回 405。
    return c.json({ error: "method not allowed" }, 405);
  }
  const userId = String(
    c.get("userId") || c.get("apiKeyOwnerId") || "",
  ).trim();
  if (!userId) {
    return c.json({ error: "unauthorized", message: "缺少 API Key owner 身份" }, 401);
  }
  const callTool = createMcpToolCaller(c, userId);

  let body: JsonRpcRequest | JsonRpcRequest[];
  try {
    body = (await c.req.json()) as JsonRpcRequest | JsonRpcRequest[];
  } catch {
    return c.json(rpcError(null, -32700, "解析错误：请求体非合法 JSON"), 400);
  }

  // 批量（数组）：逐条处理，过滤掉通知的 null 响应。
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleMcpMessage(m, callTool)))).filter(
      (r): r is Record<string, unknown> => r !== null,
    );
    if (out.length === 0) return c.body(null, 202);
    return c.json(out);
  }

  const result = await handleMcpMessage(body, callTool);
  if (result === null) return c.body(null, 202); // 通知无响应
  return c.json(result);
}
