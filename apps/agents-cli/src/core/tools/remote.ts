import type { RemoteToolDefinition, ToolResult } from "../../types/index.js";

export type RemoteToolConfig = {
  endpoint: string;
  authToken?: string;
  apiKey?: string;
  projectId?: string;
  flowId?: string;
  nodeId?: string;
};

type ExternalToolConfig = RemoteToolConfig;

export function normalizeRemoteToolDefinitions(value: unknown): RemoteToolDefinition[] {
  if (!Array.isArray(value)) return [];
  const out: RemoteToolDefinition[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const description =
      typeof record.description === "string" ? record.description.trim() : "";
    const parameters =
      record.parameters && typeof record.parameters === "object" && !Array.isArray(record.parameters)
        ? (record.parameters as Record<string, unknown>)
        : null;
    if (!name || !description || !parameters || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, description, parameters });
  }
  return out;
}

export function readRemoteToolDefinitions(meta?: Record<string, unknown>): RemoteToolDefinition[] {
  return normalizeRemoteToolDefinitions(meta?.remoteTools);
}

export function readMcpToolDefinitions(meta?: Record<string, unknown>): RemoteToolDefinition[] {
  return normalizeRemoteToolDefinitions(meta?.mcpTools);
}

export function readRemoteToolConfig(meta?: Record<string, unknown>): RemoteToolConfig | null {
  return readToolConfig(meta?.remoteToolConfig);
}

export function readMcpToolConfig(meta?: Record<string, unknown>): RemoteToolConfig | null {
  return readToolConfig(meta?.mcpToolConfig);
}

function readToolConfig(value: unknown): ExternalToolConfig | null {
  const raw = value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const endpoint = typeof record.endpoint === "string" ? record.endpoint.trim() : "";
  if (!endpoint) return null;
  const authToken =
    typeof record.authToken === "string" && record.authToken.trim()
      ? record.authToken.trim()
      : undefined;
  const apiKey =
    typeof record.apiKey === "string" && record.apiKey.trim()
      ? record.apiKey.trim()
      : undefined;
  const projectId =
    typeof record.projectId === "string" && record.projectId.trim()
      ? record.projectId.trim()
      : undefined;
  const flowId =
    typeof record.flowId === "string" && record.flowId.trim()
      ? record.flowId.trim()
      : undefined;
  const nodeId =
    typeof record.nodeId === "string" && record.nodeId.trim()
      ? record.nodeId.trim()
      : undefined;
  return {
    endpoint,
    ...(authToken ? { authToken } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(projectId ? { projectId } : {}),
    ...(flowId ? { flowId } : {}),
    ...(nodeId ? { nodeId } : {}),
  };
}

export async function executeRemoteTool(input: {
  name: string;
  args: Record<string, unknown>;
  toolCallId: string;
  meta?: Record<string, unknown>;
}): Promise<ToolResult | null> {
  const remoteTools = readRemoteToolDefinitions(input.meta);
  const mcpTools = readMcpToolDefinitions(input.meta);
  const isRemote = remoteTools.some((tool) => tool.name === input.name);
  const isMcp = !isRemote && mcpTools.some((tool) => tool.name === input.name);
  if (!isRemote && !isMcp) return null;
  const config = isRemote ? readRemoteToolConfig(input.meta) : readMcpToolConfig(input.meta);
  if (!config) {
    throw new Error(`${isRemote ? "远程" : "MCP"} 工具 ${input.name} 缺少执行配置。`);
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (config.authToken) {
    headers.Authorization = config.authToken.startsWith("Bearer ")
      ? config.authToken
      : `Bearer ${config.authToken}`;
  }
  if (config.apiKey) {
    headers["x-api-key"] = config.apiKey;
  }
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      toolName: input.name,
      providerKind: isRemote ? "remote" : "mcp",
      args: input.args,
      ...(config.projectId ? { canvasProjectId: config.projectId } : {}),
      ...(config.flowId ? { canvasFlowId: config.flowId } : {}),
      ...(config.nodeId ? { canvasNodeId: config.nodeId } : {}),
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`远程工具 ${input.name} 执行失败: ${response.status} ${text}`);
  }
  let payload: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    payload = null;
  }
  const content =
    typeof payload?.content === "string" && payload.content.trim()
      ? payload.content
      : text;
  return {
    toolCallId: input.toolCallId,
    content,
    ...(payload ? { payload: { text: content, structuredOutput: payload } } : {}),
  };
}
