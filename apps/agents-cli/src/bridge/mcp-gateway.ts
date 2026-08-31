import { createHash, randomUUID } from "node:crypto";

import type {
  JsonObject,
  RemoteToolConfig,
  RemoteToolDefinition,
} from "./contracts.js";
import { isJsonObject } from "./contracts.js";

export type RemoteToolExecution = Readonly<{
  name: string;
  args: JsonObject;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: "succeeded" | "failed";
  outputText: string;
  structuredOutput?: JsonObject;
}>;

export type HarnessDeliveryReport = Readonly<{
  expectedDelivery: JsonObject;
  taskSummary: JsonObject;
  requirementIds: readonly string[];
  successCriteria: readonly string[];
  rationale: string;
}>;

type McpRuntime = {
  tools: readonly RemoteToolDefinition[];
  config: RemoteToolConfig | null;
  executions: RemoteToolExecution[];
  loadedDeferredSchemas: Set<string>;
  deliveryReport: HarnessDeliveryReport | null;
};

const DELIVERY_REPORT_TOOL: RemoteToolDefinition = {
  name: "report_delivery",
  description:
    "Submit the root agent's final semantic self-check for a response-mode delivery. Call exactly once immediately before the final answer, and only when the planned final answer directly satisfies every declared requirement. This freezes the expectedDelivery contract; the Bridge later binds it to the exact emitted response SHA-256.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      taskGoal: { type: "string", minLength: 1, maxLength: 2_000 },
      requestedOutput: { type: "string", minLength: 1, maxLength: 2_000 },
      taskKind: { type: "string", minLength: 1, maxLength: 160 },
      delivery: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: { const: "response" },
          mediaType: { type: "null" },
          kind: { type: "string", minLength: 1, maxLength: 160 },
          output: { type: "string", minLength: 1, maxLength: 2_000 },
        },
        required: ["mode", "mediaType", "kind", "output"],
      },
      requirements: {
        type: "array",
        minItems: 1,
        maxItems: 32,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string", minLength: 1, maxLength: 120 },
            statement: { type: "string", minLength: 1, maxLength: 600 },
          },
          required: ["id", "statement"],
        },
      },
      rationale: { type: "string", minLength: 1, maxLength: 1_000 },
    },
    required: [
      "taskGoal",
      "requestedOutput",
      "taskKind",
      "delivery",
      "requirements",
      "rationale",
    ],
  },
};

const SCHEMA_LOADER_TOOL: RemoteToolDefinition = {
  name: "tapcanvas_get_tool_schema",
  wireName: "tapcanvas_tool_schema_get",
  description:
    "Load the exact current JSON Schema and execution contract for one authorized deferred TapCanvas tool. Call this before invoking a catalog tool.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1 },
      selector: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: { type: "string", minLength: 1 },
          value: { type: "string", minLength: 1 },
        },
        required: ["field", "value"],
      },
    },
    required: ["name"],
  },
};

type JsonRpcId = string | number | null;

type JsonRpcRequest = Readonly<{
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}>;

function rpcResult(id: JsonRpcId, result: unknown): JsonObject {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string): JsonObject {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function requestId(value: unknown): JsonRpcId {
  return typeof value === "string" || typeof value === "number" || value === null
    ? value
    : null;
}

function textFromPayload(payload: unknown, rawText: string): string {
  if (!isJsonObject(payload)) return rawText;
  if (typeof payload.content === "string" && payload.content.trim()) return payload.content;
  if (typeof payload.text === "string" && payload.text.trim()) return payload.text;
  return rawText;
}

function buildToolRequestBody(
  name: string,
  args: JsonObject,
  config: RemoteToolConfig,
): JsonObject {
  return {
    toolName: name,
    providerKind: "remote",
    args,
    ...(config.projectId ? { canvasProjectId: config.projectId } : {}),
    ...(config.flowId ? { canvasFlowId: config.flowId } : {}),
    ...(config.nodeId ? { canvasNodeId: config.nodeId } : {}),
    ...(config.bookId ? { bookId: config.bookId } : {}),
    ...(config.chapterId ? { chapterId: config.chapterId } : {}),
    ...(config.publicTurnId ? { publicTurnId: config.publicTurnId } : {}),
    ...(config.agentApiJobId ? { agentApiJobId: config.agentApiJobId } : {}),
    ...(config.requestedWorkflowExecutionVariant
      ? { requestedWorkflowExecutionVariant: config.requestedWorkflowExecutionVariant }
      : {}),
		...(config.parentAgentExecution
			? { parentAgentExecution: config.parentAgentExecution }
			: {}),
  };
}

function appendExecution(
  runtime: McpRuntime,
  input: {
    name: string;
    args: JsonObject;
    startedAt: string;
    startedAtMs: number;
    status: "succeeded" | "failed";
    outputText: string;
    structuredOutput?: JsonObject;
  },
): void {
  runtime.executions.push({
    name: input.name,
    args: input.args,
    startedAt: input.startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - input.startedAtMs),
    status: input.status,
    outputText: input.outputText,
    ...(input.structuredOutput ? { structuredOutput: input.structuredOutput } : {}),
  });
}

async function executeRemoteTool(
  runtime: McpRuntime,
  name: string,
  args: JsonObject,
): Promise<JsonObject> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const definition = runtime.tools.find((tool) => tool.name === name);
  if (!definition) {
    const outputText = `工具不存在或未授权：${name}`;
    appendExecution(runtime, { name, args, startedAt, startedAtMs, status: "failed", outputText });
    return {
      content: [{ type: "text", text: outputText }],
      isError: true,
    };
  }

  if (name === DELIVERY_REPORT_TOOL.name) {
    return executeDeliveryReport(runtime, args, startedAt, startedAtMs);
  }

  if (definition.schemaDeferred && !runtime.loadedDeferredSchemas.has(name)) {
    const outputText = `工具 ${name} 的精确 schema 尚未加载；必须先调用 tapcanvas_get_tool_schema`;
    appendExecution(runtime, { name, args, startedAt, startedAtMs, status: "failed", outputText });
    return {
      content: [{ type: "text", text: outputText }],
      isError: true,
    };
  }

  if (!runtime.config) {
    const outputText = `远程工具 ${name} 缺少请求级执行配置`;
    appendExecution(runtime, { name, args, startedAt, startedAtMs, status: "failed", outputText });
    return { content: [{ type: "text", text: outputText }], isError: true };
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (runtime.config.authToken) {
    headers.Authorization = runtime.config.authToken.startsWith("Bearer ")
      ? runtime.config.authToken
      : `Bearer ${runtime.config.authToken}`;
  }
  if (runtime.config.apiKey) headers["x-api-key"] = runtime.config.apiKey;

  const wireName = definition.wireName ?? name;
  let response: Response;
  try {
    response = await fetch(runtime.config.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(buildToolRequestBody(wireName, args, runtime.config)),
    });
  } catch (error: unknown) {
    const outputText = `远程工具 ${name} 传输失败：${error instanceof Error ? error.message : String(error)}`;
    appendExecution(runtime, { name, args, startedAt, startedAtMs, status: "failed", outputText });
    return {
      content: [{ type: "text", text: outputText }],
      isError: true,
    };
  }
  const rawText = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawText) as unknown;
  } catch {
    payload = null;
  }
  const text = textFromPayload(payload, rawText);
  if (!response.ok) {
    const outputText = `远程工具 ${name} 执行失败：HTTP ${response.status} ${text}`;
    appendExecution(runtime, {
      name,
      args,
      startedAt,
      startedAtMs,
      status: "failed",
      outputText,
      ...(isJsonObject(payload) ? { structuredOutput: payload } : {}),
    });
    return {
      content: [
        {
          type: "text",
          text: outputText,
        },
      ],
      isError: true,
    };
  }
  if (name === SCHEMA_LOADER_TOOL.name) {
    const deferredName = typeof args.name === "string" ? args.name.trim() : "";
    if (deferredName) runtime.loadedDeferredSchemas.add(deferredName);
  }
  appendExecution(runtime, {
    name,
    args,
    startedAt,
    startedAtMs,
    status: "succeeded",
    outputText: text,
    ...(isJsonObject(payload) ? { structuredOutput: payload } : {}),
  });
  return {
    content: [{ type: "text", text }],
    ...(isJsonObject(payload) ? { structuredContent: payload } : {}),
  };
}

function requiredText(value: unknown, maxLength: number): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= maxLength ? text : null;
}

function executeDeliveryReport(
  runtime: McpRuntime,
  args: JsonObject,
  startedAt: string,
  startedAtMs: number,
): JsonObject {
  const taskGoal = requiredText(args.taskGoal, 2_000);
  const requestedOutput = requiredText(args.requestedOutput, 2_000);
  const taskKind = requiredText(args.taskKind, 160);
  const rationale = requiredText(args.rationale, 1_000);
  const delivery = isJsonObject(args.delivery) ? args.delivery : null;
  const deliveryKind = requiredText(delivery?.kind, 160);
  const deliveryOutput = requiredText(delivery?.output, 2_000);
  const rawRequirements = Array.isArray(args.requirements) ? args.requirements : [];
  const requirements: Array<{ id: string; statement: string }> = [];
  const seenIds = new Set<string>();
  for (const item of rawRequirements) {
    if (!isJsonObject(item)) continue;
    const id = requiredText(item.id, 120);
    const statement = requiredText(item.statement, 600);
    if (!id || !statement || seenIds.has(id)) continue;
    seenIds.add(id);
    requirements.push({ id, statement });
  }
  if (
    !taskGoal
    || !requestedOutput
    || !taskKind
    || !rationale
    || !delivery
    || delivery.mode !== "response"
    || delivery.mediaType !== null
    || !deliveryKind
    || !deliveryOutput
    || requirements.length !== rawRequirements.length
    || requirements.length === 0
    || requirements.length > 32
  ) {
    const outputText = "report_delivery 参数不满足 response-mode 交付自检合同";
    appendExecution(runtime, { name: DELIVERY_REPORT_TOOL.name, args, startedAt, startedAtMs, status: "failed", outputText });
    return { content: [{ type: "text", text: outputText }], isError: true };
  }

  const unsignedContract: JsonObject = {
    version: 2,
    referenceResolution: { mode: "new_task" },
    delivery: {
      mode: "response",
      mediaType: null,
      kind: deliveryKind,
      output: deliveryOutput,
    },
    must: requirements.map((requirement) => ({
      id: requirement.id,
      statement: requirement.statement,
      source: "agent",
      evidence: ["DeepSeek Harness final self-check"],
    })),
    forbid: [],
    prefer: [],
    confirmedFacts: [],
    unresolved: [],
    precedence: ["provider_protocol_limits", "user_must"],
  };
  const contractHash = `sha256:${createHash("sha256")
    .update(JSON.stringify(unsignedContract), "utf8")
    .digest("hex")}`;
  const expectedDelivery: JsonObject = { ...unsignedContract, contractHash };
  const taskSummary: JsonObject = {
    taskGoal,
    requestedOutput,
    taskKind,
    recommendedNextStage: "deliver_verified_response",
    mustStop: false,
    requiresExecutionDelivery: false,
    blockingGaps: [],
    successCriteria: requirements.map((requirement) => requirement.statement),
    deliveryContract: expectedDelivery,
  };
  const report: HarnessDeliveryReport = {
    expectedDelivery,
    taskSummary,
    requirementIds: requirements.map((requirement) => requirement.id),
    successCriteria: requirements.map((requirement) => requirement.statement),
    rationale,
  };
  runtime.deliveryReport = report;
  const outputText = "响应交付自检已冻结；现在输出与该合同一致的最终正文。";
  appendExecution(runtime, {
    name: DELIVERY_REPORT_TOOL.name,
    args,
    startedAt,
    startedAtMs,
    status: "succeeded",
    outputText,
    structuredOutput: taskSummary,
  });
  return {
    content: [{ type: "text", text: outputText }],
    structuredContent: taskSummary,
  };
}

export class RequestMcpGateway {
  private readonly runtimes = new Map<string, McpRuntime>();

  register(
    tools: readonly RemoteToolDefinition[],
    catalog: readonly RemoteToolDefinition[],
    config: RemoteToolConfig | null,
  ): string {
    const token = randomUUID();
    const visibleTools = [
      DELIVERY_REPORT_TOOL,
      ...tools.filter((tool) =>
        tool.name !== "tapcanvas_tool_schema_get" && tool.name !== DELIVERY_REPORT_TOOL.name
      ),
      ...(catalog.length > 0 ? [SCHEMA_LOADER_TOOL, ...catalog] : []),
    ];
    this.runtimes.set(token, {
      tools: visibleTools,
      config,
      executions: [],
      loadedDeferredSchemas: new Set<string>(),
      deliveryReport: null,
    });
    return token;
  }

  executions(token: string): readonly RemoteToolExecution[] {
    return [...(this.runtimes.get(token)?.executions ?? [])];
  }

  deliveryReport(token: string): HarnessDeliveryReport | null {
    return this.runtimes.get(token)?.deliveryReport ?? null;
  }

  unregister(token: string): void {
    this.runtimes.delete(token);
  }

  has(token: string): boolean {
    return this.runtimes.has(token);
  }

  async handle(token: string, authorization: string | undefined, body: unknown): Promise<{
    status: number;
    body?: unknown;
  }> {
    const runtime = this.runtimes.get(token);
    if (!runtime || authorization !== `Bearer ${token}`) {
      return { status: 401, body: rpcError(null, -32001, "unauthorized") };
    }
    if (Array.isArray(body)) {
      const results = await Promise.all(
        body.map((entry) => this.handleMessage(runtime, entry)),
      );
      const visible = results.filter((entry): entry is JsonObject => entry !== null);
      return visible.length > 0 ? { status: 200, body: visible } : { status: 202 };
    }
    const result = await this.handleMessage(runtime, body);
    return result ? { status: 200, body: result } : { status: 202 };
  }

  private async handleMessage(runtime: McpRuntime, value: unknown): Promise<JsonObject | null> {
    if (!isJsonObject(value)) return rpcError(null, -32600, "invalid request");
    const request = value as JsonRpcRequest;
    const id = requestId(request.id);
    const method = typeof request.method === "string" ? request.method : "";
    if (!Object.prototype.hasOwnProperty.call(request, "id") && method.startsWith("notifications/")) {
      return null;
    }
    if (method === "initialize") {
      return rpcResult(id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "TapCanvas Harness Tool Gateway", version: "1.0.0" },
      });
    }
    if (method === "ping") return rpcResult(id, {});
    if (method === "tools/list") {
      return rpcResult(id, {
        tools: runtime.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.parameters,
        })),
      });
    }
    if (method === "tools/call") {
      const params = isJsonObject(request.params) ? request.params : {};
      const name = typeof params.name === "string" ? params.name.trim() : "";
      const args = isJsonObject(params.arguments) ? params.arguments : {};
      if (!name) return rpcError(id, -32602, "tool name is required");
      try {
        return rpcResult(id, await executeRemoteTool(runtime, name, args));
      } catch (error: unknown) {
        return rpcResult(id, {
          content: [
            {
              type: "text",
              text: `远程工具 ${name} 执行异常：${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        });
      }
    }
    return rpcError(id, -32601, `method not found: ${method}`);
  }
}
