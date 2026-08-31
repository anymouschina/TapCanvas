export type JsonObject = Record<string, unknown>;

export type RemoteToolDefinition = Readonly<{
  name: string;
  description: string;
  parameters: JsonObject;
  wireName?: string;
  schemaDeferred?: boolean;
}>;

export type ExternalSkillReference = Readonly<{
  id: string;
  key: string;
  name: string;
  description: string;
  source: string;
  version?: string;
  hash?: string;
}>;

export type ExternalSkillResolverConfig = Readonly<{
  endpoint: string;
  authToken?: string;
  apiKey?: string;
}>;

export type RemoteToolConfig = Readonly<{
  endpoint: string;
  authToken?: string;
  apiKey?: string;
  projectId?: string;
  flowId?: string;
  nodeId?: string;
  bookId?: string;
  chapterId?: string;
  publicTurnId?: string;
  agentApiJobId?: string;
  requestedWorkflowExecutionVariant?: string;
  parentAgentExecution?: Readonly<{
    model: string;
    apiStyle: "chat" | "responses";
  }>;
}>;

export type AgentsChatRequest = Readonly<{
  prompt: string;
  stream: boolean;
  systemPrompt: string;
  sessionId?: string;
  userId?: string;
  model: string;
  apiBaseUrl: string;
  apiKey: string;
  apiStyle: "openai-completions" | "openai-responses";
  maxOutputTokens?: number;
  reasoningEffort?: string;
  requiredSkills: readonly string[];
  requiredSkillCalls: readonly string[];
  externalSkills: readonly ExternalSkillReference[];
  externalSkillResolverConfig: ExternalSkillResolverConfig | null;
  allowedTools?: readonly string[];
  referenceImages: readonly string[];
  assetInputs: readonly JsonObject[];
  remoteTools: readonly RemoteToolDefinition[];
  remoteToolCatalog: readonly RemoteToolDefinition[];
  remoteToolConfig: RemoteToolConfig | null;
  turnContext: JsonObject;
  raw: JsonObject;
}>;

export class BridgeRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "BridgeRequestError";
    this.code = code;
    this.status = status;
  }
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of value) {
    const normalized = nonEmptyString(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function positiveInteger(value: unknown): number | undefined {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue <= 0) return undefined;
  return numberValue;
}

function normalizeRemoteTools(value: unknown): RemoteToolDefinition[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tools: RemoteToolDefinition[] = [];
  for (const candidate of value) {
    if (!isJsonObject(candidate)) continue;
    const name = nonEmptyString(candidate.name);
    const description = nonEmptyString(candidate.description);
    const parameters = isJsonObject(candidate.parameters)
      ? candidate.parameters
      : isJsonObject(candidate.inputSchema)
        ? candidate.inputSchema
        : undefined;
    if (!name || !description || !parameters || seen.has(name)) continue;
    seen.add(name);
    tools.push({ name, description, parameters });
  }
  return tools;
}

const DEFERRED_PARAMETERS: JsonObject = {
  type: "object",
  additionalProperties: true,
};

function normalizeRemoteToolCatalog(value: unknown): RemoteToolDefinition[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tools: RemoteToolDefinition[] = [];
  for (const candidate of value) {
    if (!isJsonObject(candidate)) continue;
    const name = nonEmptyString(candidate.name);
    const description = nonEmptyString(candidate.description);
    if (!name || !description || seen.has(name)) continue;
    if (candidate.schemaDeferred !== true) {
      throw new BridgeRequestError(
        `远程工具目录 ${name} 缺少 schemaDeferred=true`,
        "remote_tool_catalog_contract_invalid",
      );
    }
    seen.add(name);
    tools.push({
      name,
      description: `${description} Call tapcanvas_get_tool_schema for this exact tool before invoking it.`,
      parameters: DEFERRED_PARAMETERS,
      schemaDeferred: true,
    });
  }
  return tools;
}

function normalizeExternalSkills(value: unknown): ExternalSkillReference[] {
  if (!Array.isArray(value)) return [];
  const skills: ExternalSkillReference[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!isJsonObject(candidate)) continue;
    const id = nonEmptyString(candidate.id);
    const key = nonEmptyString(candidate.key);
    const name = nonEmptyString(candidate.name);
    const description = nonEmptyString(candidate.description);
    const source = nonEmptyString(candidate.source);
    if (!id || !key || !name || !description || !source || seen.has(key)) continue;
    seen.add(key);
    skills.push({
      id,
      key,
      name,
      description,
      source,
      ...(nonEmptyString(candidate.version) ? { version: nonEmptyString(candidate.version) } : {}),
      ...(nonEmptyString(candidate.hash) || nonEmptyString(candidate.contentHash)
        ? { hash: nonEmptyString(candidate.hash) ?? nonEmptyString(candidate.contentHash) }
        : {}),
    });
  }
  return skills;
}

function normalizeExternalSkillResolverConfig(value: unknown): ExternalSkillResolverConfig | null {
  if (!isJsonObject(value)) return null;
  const endpoint = nonEmptyString(value.endpoint);
  if (!endpoint) return null;
  const authToken = nonEmptyString(value.authToken);
  const apiKey = nonEmptyString(value.apiKey);
  return {
    endpoint: endpoint.replace(/\/+$/u, ""),
    ...(authToken ? { authToken } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

const TURN_CONTEXT_KEYS = [
  "logicalTaskId",
  "publicTurnId",
  "responseFormat",
  "outputContract",
  "generationContract",
  "userIntentContract",
  "userIntentContractLocked",
  "durableTaskReferences",
  "retrievalCandidateSets",
  "actionRecoveryFacts",
  "trustedMaterializedArtifacts",
  "requestUserInputResponse",
  "disabledSkills",
  "mountedKnowledgeCardIds",
  "disabledKnowledgeCardIds",
  "promptExampleRetrievalScope",
  "retrievalUserRequest",
  "retrievalContext",
  "roleSkillAssignments",
  "chapterDirectorPersona",
  "chapterStyleOverride",
  "allowedSubagentTypes",
  "forcedAgentRole",
  "executeForcedAgentDirectly",
  "requireAgentsTeamExecution",
  "primaryCapabilityRoutes",
	"equippedWorkflowCapabilities",
  "toolSurfaceConfig",
  "resourceWhitelist",
  "referenceImageSlots",
  "localResourcePaths",
  "diagnosticContext",
] as const;

function projectTurnContext(value: JsonObject): JsonObject {
  const context: JsonObject = {};
  for (const key of TURN_CONTEXT_KEYS) {
    if (typeof value[key] !== "undefined") context[key] = value[key];
  }
  const serialized = JSON.stringify(context);
  if (serialized.length > 1_000_000) {
    throw new BridgeRequestError(
      `TapCanvas 本轮事实合同超过 Harness 注入上限（${serialized.length}/1000000）`,
      "deepseek_harness_turn_context_too_large",
      413,
    );
  }
  return context;
}

function normalizeRemoteToolConfig(value: unknown): RemoteToolConfig | null {
  if (!isJsonObject(value)) return null;
  const endpoint = nonEmptyString(value.endpoint);
  if (!endpoint) return null;
  const optional = (key: keyof Omit<RemoteToolConfig, "endpoint">): string | undefined =>
    nonEmptyString(value[key]);
  return {
    endpoint,
    ...(optional("authToken") ? { authToken: optional("authToken") } : {}),
    ...(optional("apiKey") ? { apiKey: optional("apiKey") } : {}),
    ...(optional("projectId") ? { projectId: optional("projectId") } : {}),
    ...(optional("flowId") ? { flowId: optional("flowId") } : {}),
    ...(optional("nodeId") ? { nodeId: optional("nodeId") } : {}),
    ...(optional("bookId") ? { bookId: optional("bookId") } : {}),
    ...(optional("chapterId") ? { chapterId: optional("chapterId") } : {}),
    ...(optional("publicTurnId") ? { publicTurnId: optional("publicTurnId") } : {}),
    ...(optional("agentApiJobId") ? { agentApiJobId: optional("agentApiJobId") } : {}),
    ...(optional("requestedWorkflowExecutionVariant")
      ? { requestedWorkflowExecutionVariant: optional("requestedWorkflowExecutionVariant") }
      : {}),
  };
}

function resolveApiStyle(value: unknown): "openai-completions" | "openai-responses" {
  const normalized = nonEmptyString(value)?.toLowerCase();
  if (normalized === "responses" || normalized === "openai-responses") {
    return "openai-responses";
  }
  if (
    normalized === "chat" ||
    normalized === "chat-completions" ||
    normalized === "openai-completions"
  ) {
    return "openai-completions";
  }
  throw new BridgeRequestError(
    `DeepSeek Harness 不支持当前 API 协议：${String(value ?? "")}`,
    "deepseek_harness_api_style_invalid",
  );
}

export function parseAgentsChatRequest(
  value: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): AgentsChatRequest {
  if (!isJsonObject(value)) {
    throw new BridgeRequestError("请求体必须是 JSON 对象", "invalid_request_body");
  }

  const prompt = nonEmptyString(value.prompt);
  if (!prompt) {
    throw new BridgeRequestError("prompt 不能为空", "prompt_required");
  }

  const systemPrompt = nonEmptyString(value.systemPrompt);
  if (!systemPrompt) {
    throw new BridgeRequestError(
      "DeepSeek Harness 运行需要 Hono 注入本轮事实型 systemPrompt",
      "deepseek_harness_system_prompt_required",
    );
  }

  const model =
    nonEmptyString(value.model) ??
    nonEmptyString(value.modelAlias) ??
    nonEmptyString(value.modelKey);
  if (!model) {
    throw new BridgeRequestError(
      "DeepSeek Harness 运行缺少本轮显式模型",
      "deepseek_harness_model_required",
    );
  }

  const apiBaseUrl =
    nonEmptyString(value.overrideApiBaseUrl) ??
    nonEmptyString(environment.AGENTS_API_BASE_URL);
  const apiKey =
    nonEmptyString(value.overrideApiKey) ??
    nonEmptyString(environment.AGENTS_API_KEY);
  if (!apiBaseUrl) {
    throw new BridgeRequestError(
      "DeepSeek Harness 运行缺少模型网关地址",
      "deepseek_harness_api_base_url_required",
      503,
    );
  }
  if (!apiKey) {
    throw new BridgeRequestError(
      "DeepSeek Harness 运行缺少模型网关凭据",
      "deepseek_harness_api_key_required",
      503,
    );
  }

  const remoteTools = normalizeRemoteTools(value.remoteTools);
  const directToolNames = new Set(remoteTools.map((tool) => tool.name));
  const remoteToolCatalog = normalizeRemoteToolCatalog(value.remoteToolCatalog)
    .filter((tool) => !directToolNames.has(tool.name));
  const remoteToolConfig = normalizeRemoteToolConfig(value.remoteToolConfig);
  if (remoteTools.length + remoteToolCatalog.length > 0 && !remoteToolConfig) {
    throw new BridgeRequestError(
      "本轮声明了远程工具，但缺少 remoteToolConfig.endpoint",
      "remote_tool_config_required",
    );
  }

  const rawAssetInputs = Array.isArray(value.assetInputs)
    ? value.assetInputs.filter(isJsonObject)
    : [];
  const explicitStyle =
    value.overrideApiStyle ?? value.apiStyle ?? environment.AGENTS_API_STYLE ?? "chat";

  const requiredSkillCalls = stringList(value.requiredSkillCalls);
  const externalSkills = normalizeExternalSkills(value.externalSkills);
  const externalSkillResolverConfig = normalizeExternalSkillResolverConfig(
    value.externalSkillResolverConfig,
  );
  const externalSkillKeys = new Set(externalSkills.map((skill) => skill.key));
  const unresolvedExternalSkill = requiredSkillCalls.find((key) => externalSkillKeys.has(key));
  if (unresolvedExternalSkill && !externalSkillResolverConfig) {
    throw new BridgeRequestError(
      `必需外部 Skill ${unresolvedExternalSkill} 缺少解析器配置`,
      "external_skill_resolver_required",
    );
  }

  return {
    prompt,
    stream: value.stream !== false,
    systemPrompt,
    ...(nonEmptyString(value.sessionId) ? { sessionId: nonEmptyString(value.sessionId) } : {}),
    ...(nonEmptyString(value.userId) ? { userId: nonEmptyString(value.userId) } : {}),
    model,
    apiBaseUrl: apiBaseUrl.replace(/\/+$/u, ""),
    apiKey,
    apiStyle: resolveApiStyle(explicitStyle),
    ...(positiveInteger(value.maxOutputTokens)
      ? { maxOutputTokens: positiveInteger(value.maxOutputTokens) }
      : {}),
    ...(nonEmptyString(value.reasoningEffort)
      ? { reasoningEffort: nonEmptyString(value.reasoningEffort) }
      : {}),
    requiredSkills: stringList(value.requiredSkills),
    requiredSkillCalls,
    externalSkills,
    externalSkillResolverConfig,
    ...(Array.isArray(value.allowedTools) ? { allowedTools: stringList(value.allowedTools) } : {}),
    referenceImages: stringList(value.referenceImages),
    assetInputs: rawAssetInputs,
    remoteTools,
    remoteToolCatalog,
    remoteToolConfig,
    turnContext: projectTurnContext(value),
    raw: value,
  };
}
