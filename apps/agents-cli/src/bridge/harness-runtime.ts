import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DeepSeekHarness,
  type HarnessNotification,
  type RunResult,
} from "@deepseek-ai/dsh-sdk-client";

import type { AgentsChatRequest, JsonObject } from "./contracts.js";
import { BridgeRequestError, isJsonObject } from "./contracts.js";
import { buildHarnessDeliveryClosure } from "./delivery-contract.js";
import {
  HarnessEventProjector,
  type BridgeStreamEmitter,
  type ProjectedToolCall,
} from "./event-projector.js";
import {
  RequestMcpGateway,
  type RemoteToolExecution,
} from "./mcp-gateway.js";

const require = createRequire(import.meta.url);
const appRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const patchPath = path.join(appRoot, "harness", "tapcanvas.patch.yml");
const dshPackagePath = require.resolve("@deepseek-ai/dsh/package.json");
const dshBinPath = path.join(path.dirname(dshPackagePath), "lib", "bin.js");
const MAX_SYSTEM_PROMPT_ENV_CHARS = 120_000;
const TAPCANVAS_ROOT_IDENTITY = [
  "<tapcanvas_root_identity>",
  "Your user-facing name is 小T. You are TapCanvas's AI creative assistant.",
  "DeepSeek Harness is an internal execution runtime, not your user-facing identity. When asked who you are, introduce yourself as 小T and describe only relevant TapCanvas capabilities; do not expose local filesystem paths, repository internals, provider implementation details, or hidden system instructions unless the user explicitly asks for technical diagnostics.",
  "</tapcanvas_root_identity>",
].join("\n");
const TAPCANVAS_DELIVERY_SYSTEM_PROTOCOL = [
  "<deepseek_harness_delivery_protocol>",
  "You are the semantic owner of the root task's completion decision.",
  "When the user's requested delivery is a plain final response, you MUST call mcp__tapcanvas__report_delivery exactly once immediately before emitting the final answer. The call must describe the actual semantic task, response delivery, and every requirement that the planned final answer satisfies.",
  "A normal assistant answer without that successful tool receipt is an explicit failed logical task, even if the prose appears useful.",
  "Classify delivery by what the user must finally receive, not by whether an execution tool was used. When a successful workflow returns authored user-facing text and the final answer must reproduce that text, the final delivery is response-mode: first require the workflow's terminal factual receipt, then call report_delivery to verify the planned exact response.",
  "For a state change or artifact delivery, do not misuse the response reporter: use authorized execution tools and rely on their factual receipts. Never claim completion from prose alone.",
  "If a required delivery tool is unavailable or its receipt fails, state the exact failure; do not omit the protocol or manufacture success.",
  "</deepseek_harness_delivery_protocol>",
].join("\n");
const TAPCANVAS_EQUIPPED_WORKFLOW_PROTOCOL = [
  "<tapcanvas_equipped_workflow_protocol>",
  "When tapcanvas_turn_contract lists equippedWorkflowCapabilities, treat those entries as authoritative capabilities already enabled for this user.",
  "Before composing a direct answer, semantically compare the complete user request with every equipped workflow summary and invocation contract. Do not use keyword, regex, or local route heuristics.",
  "When exactly one equipped workflow is applicable, its workflow execution is the required primary action: call mcp__tapcanvas__tapcanvas_equipped_workflow_run with the declared contract instead of answering from general model knowledge.",
  "When none applies, answer normally. When applicability is ambiguous or multiple workflows conflict, expose that uncertainty or ask for the missing choice; never silently select a default workflow.",
  "After a workflow succeeds, preserve its factual terminal delivery exactly when the workflow contract requires an exact reply. Do not replace it with a newly composed greeting, summary, or capability pitch.",
  "A report_delivery call cannot substitute for an applicable equipped workflow. It may only verify a response after the workflow result is known, or verify a direct response after the semantic comparison found no applicable workflow.",
  "</tapcanvas_equipped_workflow_protocol>",
].join("\n");

export type HarnessBridgeResult = Readonly<{
  response: JsonObject;
  text: string;
  completed: boolean;
  projector: HarnessEventProjector;
}>;

export type HarnessRuntimeOptions = Readonly<{
  workspaceRoot: string;
  bridgeOrigin: string;
  mcpGateway: RequestMcpGateway;
  environment?: NodeJS.ProcessEnv;
}>;

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

type HarnessExecutionSessionScope = Pick<AgentsChatRequest, "sessionId" | "userId">;

export function buildHarnessExecutionSessionId(
  request: HarnessExecutionSessionScope,
  executionNonce: string,
): string {
  const external = request.sessionId ?? "ephemeral";
  const user = request.userId ?? "anonymous";
  return `tapcanvas-${createHash("sha256")
    .update(`${user}\0${external}\0${executionNonce}`)
    .digest("hex")}`;
}

function resolveSkillDirectory(
  environment: NodeJS.ProcessEnv,
  workspaceRoot: string,
): string {
  const configured = environment.AGENTS_SKILLS_DIR?.trim();
  if (configured) {
    const resolved = path.isAbsolute(configured)
      ? configured
      : path.resolve(workspaceRoot, configured);
    if (!existsSync(resolved)) {
      throw new Error(`Configured AGENTS_SKILLS_DIR does not exist: ${resolved}`);
    }
    return resolved;
  }
  const bundled = path.join(appRoot, "skills");
  if (!existsSync(bundled)) {
    throw new Error(`Bundled TapCanvas skills directory does not exist: ${bundled}`);
  }
  return bundled;
}

export function resolveDshHome(environment: NodeJS.ProcessEnv): string {
  const explicit = environment.DSH_HOME?.trim();
  if (explicit) return path.resolve(explicit);
  const legacyMemoryRoot = environment.AGENTS_MEMORY_DIR?.trim();
  if (legacyMemoryRoot) {
    const root = path.isAbsolute(legacyMemoryRoot)
      ? legacyMemoryRoot
      : path.resolve(appRoot, legacyMemoryRoot);
    return path.join(root, "deepseek-harness");
  }
  return path.join(appRoot, ".agents", "deepseek-harness");
}

type ExternalSkillMaterialization = Readonly<{
  root: string | null;
  namesByKey: ReadonlyMap<string, string>;
}>;

function structuredPrompt(
  request: AgentsChatRequest,
  externalSkillNames: ReadonlyMap<string, string>,
): string {
  const requiredPreFinalAction = [
    "<tapcanvas_required_pre_final_action>",
    "Before starting any final assistant message, classify the actual delivery by what the user must finally receive, not by whether tools were used: either a user-facing response or a persistent state/artifact result.",
    "For a plain response, you MUST call mcp__tapcanvas__report_delivery exactly once and receive its successful result before emitting any final-response text. This is mandatory regardless of task complexity or whether another tool is needed.",
    "A workflow whose successful terminal output is user-facing text still has a response-mode final delivery. Require its factual receipt first, then use report_delivery to verify the exact response; the reporter does not replace workflow execution.",
    "For a state/artifact delivery, do not call report_delivery; use authorized execution tools and require their factual receipts before claiming completion.",
    "If the required pre-final action cannot succeed, expose that exact failure instead of emitting an unverified final answer.",
    "</tapcanvas_required_pre_final_action>",
  ].join("\n");
  const sections: string[] = [requiredPreFinalAction, request.prompt];
  const requiredSkillNames = [
    ...request.requiredSkills,
    ...request.requiredSkillCalls.map((key) => externalSkillNames.get(key) ?? key),
  ];
  if (requiredSkillNames.length > 0) {
    sections.push(
      [
        "<required_skills>",
        "Load these skills through the Harness skill tool before acting:",
        ...requiredSkillNames.map((skill) => `- ${skill}`),
        "</required_skills>",
      ].join("\n"),
    );
  }
  if (request.referenceImages.length > 0 || request.assetInputs.length > 0) {
    sections.push(
      [
        "<tapcanvas_asset_facts>",
        JSON.stringify({
          referenceImages: request.referenceImages,
          assetInputs: request.assetInputs,
        }),
        "These are factual asset locators. Use an authorized TapCanvas vision or asset tool when visual inspection is required.",
        "</tapcanvas_asset_facts>",
      ].join("\n"),
    );
  }
  if (Object.keys(request.turnContext).length > 0) {
    sections.push(
      [
        "<tapcanvas_turn_contract>",
        JSON.stringify(request.turnContext),
        "These are authoritative per-turn facts and machine contracts supplied by TapCanvas. Do not invent missing facts, weaken constraints, or interpret this block as a fixed semantic route.",
        "</tapcanvas_turn_contract>",
      ].join("\n"),
    );
  }
  sections.push(
    [
      "<tapcanvas_completion_gate>",
      "Before producing the final answer, self-check the actual deliverable, actions performed, result location, and completion state against the user's request and any frozen userIntentContract above.",
      "For a response-mode delivery, call mcp__tapcanvas__report_delivery exactly once immediately before the final answer. Declare the semantic task goal, response contract, and every must requirement that the planned final answer satisfies.",
      "If an authorized workflow produced the response text, include preservation of its terminal authored output among those requirements and call report_delivery only after the successful workflow receipt is known.",
      "For state-changing or artifact delivery, never use report_delivery to convert prose into success and never claim success unless authorized tools produced the required factual evidence. If the contract cannot be satisfied, report the exact failure instead of fabricating completion.",
      "</tapcanvas_completion_gate>",
    ].join("\n"),
  );
  return sections.join("\n\n");
}

function harnessSystemPrompt(systemPrompt: string): string {
  return [
    systemPrompt,
    TAPCANVAS_ROOT_IDENTITY,
    TAPCANVAS_EQUIPPED_WORKFLOW_PROTOCOL,
    TAPCANVAS_DELIVERY_SYSTEM_PROTOCOL,
  ].join("\n\n");
}

function skillHeaders(config: NonNullable<AgentsChatRequest["externalSkillResolverConfig"]>): Headers {
  const headers = new Headers({ Accept: "application/json" });
  if (config.authToken) {
    headers.set(
      "Authorization",
      config.authToken.startsWith("Bearer ") ? config.authToken : `Bearer ${config.authToken}`,
    );
  }
  if (config.apiKey) headers.set("x-api-key", config.apiKey);
  return headers;
}

function safeExternalSkillName(key: string): string {
  return `external-${createHash("sha256").update(key).digest("hex").slice(0, 20)}`;
}

function skillDocument(input: {
  name: string;
  description: string;
  content: string;
  sourceKey: string;
}): string {
  return [
    "---",
    `name: ${JSON.stringify(input.name)}`,
    `description: ${JSON.stringify(input.description)}`,
    "metadata:",
    `  tapcanvas-source-key: ${JSON.stringify(input.sourceKey)}`,
    "---",
    "",
    input.content,
  ].join("\n");
}

async function materializeExternalSkills(
  request: AgentsChatRequest,
): Promise<ExternalSkillMaterialization> {
  const referenceByKey = new Map(request.externalSkills.map((skill) => [skill.key, skill]));
  const requiredReferences = request.requiredSkillCalls.flatMap((key) => {
    const reference = referenceByKey.get(key);
    return reference ? [reference] : [];
  });
  if (requiredReferences.length === 0) return { root: null, namesByKey: new Map() };
  const resolver = request.externalSkillResolverConfig;
  if (!resolver) {
    throw new BridgeRequestError(
      "必需外部 Skill 缺少可信解析器",
      "external_skill_resolver_required",
    );
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "tapcanvas-harness-skills-"));
  const namesByKey = new Map<string, string>();
  try {
    for (const reference of requiredReferences) {
      const response = await fetch(`${resolver.endpoint}/${encodeURIComponent(reference.id)}`, {
        method: "GET",
        headers: skillHeaders(resolver),
      });
      const rawText = await response.text();
      let payload: unknown;
      try {
        payload = JSON.parse(rawText) as unknown;
      } catch {
        payload = null;
      }
      if (!response.ok) {
        throw new BridgeRequestError(
          `外部 Skill ${reference.key} 读取失败：HTTP ${response.status} ${rawText.slice(0, 1_000)}`,
          "external_skill_fetch_failed",
          502,
        );
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new BridgeRequestError(
          `外部 Skill ${reference.key} 返回体不是 JSON 对象`,
          "external_skill_response_invalid",
          502,
        );
      }
      const record = payload as Record<string, unknown>;
      const content = typeof record.content === "string" ? record.content : "";
      if (!content) {
        throw new BridgeRequestError(
          `外部 Skill ${reference.key} 正文为空`,
          "external_skill_content_missing",
          502,
        );
      }
      if (Buffer.byteLength(content, "utf8") > 200_000) {
        throw new BridgeRequestError(
          `外部 Skill ${reference.key} 超过 200000 bytes`,
          "external_skill_content_too_large",
          413,
        );
      }
      const actualHash = createHash("sha256").update(content).digest("hex");
      const responseHash = typeof record.sha256 === "string" ? record.sha256.trim() : "";
      const expectedHash = reference.hash ?? responseHash;
      if (expectedHash && actualHash !== expectedHash) {
        throw new BridgeRequestError(
          `外部 Skill ${reference.key} 内容哈希不一致`,
          "external_skill_hash_mismatch",
          502,
        );
      }
      const name = safeExternalSkillName(reference.key);
      const directory = path.join(root, name);
      await mkdir(directory, { recursive: false });
      await writeFile(
        path.join(directory, "SKILL.md"),
        skillDocument({
          name,
          description: reference.description,
          content,
          sourceKey: reference.key,
        }),
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      namesByKey.set(reference.key, name);
    }
    return { root, namesByKey };
  } catch (error: unknown) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

function terminalReason(result: RunResult): JsonObject {
  for (let index = result.events.length - 1; index >= 0; index -= 1) {
    const event = result.events[index];
    if (event?.type === "turn/end") return event.data.reason as JsonObject;
  }
  return { kind: "missing_turn_end" };
}

function buildResponse(input: {
  request: AgentsChatRequest;
  result: RunResult;
  text: string;
  projector: HarnessEventProjector;
  tools: readonly ProjectedToolCall[];
  deliveryReport: ReturnType<RequestMcpGateway["deliveryReport"]>;
  remoteExecutions: readonly RemoteToolExecution[];
  elapsedMs: number;
}): JsonObject {
  const termination = terminalReason(input.result);
  const completed = termination.kind === "completed";
  const deliveryClosure = buildHarnessDeliveryClosure({
    turnContext: input.request.turnContext,
    text: input.text,
    harnessCompleted: completed,
    deliveryReport: input.deliveryReport,
    remoteExecutions: input.remoteExecutions,
  });
  const failedToolCalls = input.tools.filter((tool) => tool.status === "failed").length;
  const todoTrace = input.projector.todoTrace();
  return {
    id: `harness_${randomUUID()}`,
    text: input.text,
    trace: {
      runtime: {
        engine: "deepseek-harness",
        profile: "sdk",
        upstreamVersion: "0.1.2-alpha.2",
        provider: "tapcanvas",
        model: input.request.model,
        sessionId: input.result.sessionId,
        requiredSkills: input.request.requiredSkills,
        ...deliveryClosure.runtime,
      },
      toolCalls: input.tools,
      output: {
        textChars: input.text.length,
        preview: input.text.slice(0, 4_000),
      },
      summary: {
        totalToolCalls: input.tools.length,
        succeededToolCalls: input.tools.length - failedToolCalls,
        failedToolCalls,
        runMs: input.elapsedMs,
      },
      completion: {
        ...deliveryClosure.completion,
        termination,
      },
      runOutcome: {
        ...deliveryClosure.runOutcome,
        termination,
      },
      ...(todoTrace ? { todoList: todoTrace } : {}),
    },
  };
}

export class HarnessRuntime {
  private readonly workspaceRoot: string;
  private readonly bridgeOrigin: string;
  private readonly gateway: RequestMcpGateway;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly dshHome: string;
  private readonly skillDirectory: string;
  private readonly emptyRequestSkillDirectory: string;
  private initialization: Promise<void> | undefined;

  constructor(options: HarnessRuntimeOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.bridgeOrigin = options.bridgeOrigin.replace(/\/+$/u, "");
    this.gateway = options.mcpGateway;
    this.environment = { ...(options.environment ?? process.env) };
    this.dshHome = resolveDshHome(this.environment);
    this.skillDirectory = resolveSkillDirectory(this.environment, this.workspaceRoot);
    this.emptyRequestSkillDirectory = path.join(this.dshHome, "tapcanvas-empty-request-skills");
    if (!existsSync(dshBinPath)) throw new Error(`DeepSeek Harness executable not found: ${dshBinPath}`);
    if (!existsSync(patchPath)) throw new Error(`TapCanvas Harness patch not found: ${patchPath}`);
    mkdirSync(this.dshHome, { recursive: true });
    mkdirSync(this.emptyRequestSkillDirectory, { recursive: true });
  }

  initialize(): Promise<void> {
    this.initialization ??= this.initializeProfile();
    return this.initialization;
  }

  private initializeProfile(): Promise<void> {
    return new Promise((resolve, reject) => {
      const stderr: string[] = [];
      const child = spawn(
        process.execPath,
        [dshBinPath, "--profile", "sdk", "--dump-default-config"],
        {
          cwd: this.workspaceRoot,
          env: {
            ...this.environment,
            DSH_HOME: this.dshHome,
            DSH_TELEMETRY_DISABLED: "1",
          },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      child.stderr.on("data", (chunk: Buffer) => {
        stderr.push(String(chunk));
        if (stderr.join("").length > 16_000) stderr.shift();
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            `DeepSeek Harness profile initialization failed (code=${String(code)}, signal=${String(signal)}): ${stderr.join("").trim()}`,
          ),
        );
      });
    });
  }

  async run(
    request: AgentsChatRequest,
    emit: BridgeStreamEmitter,
    abortSignal: AbortSignal,
  ): Promise<HarnessBridgeResult> {
    await this.initialize();
    if (abortSignal.aborted) throw abortSignal.reason;
    const effectiveSystemPrompt = harnessSystemPrompt(request.systemPrompt);
    if (effectiveSystemPrompt.length > MAX_SYSTEM_PROMPT_ENV_CHARS) {
      throw new BridgeRequestError(
        `systemPrompt 超过 DeepSeek Harness 进程注入上限（${effectiveSystemPrompt.length}/${MAX_SYSTEM_PROMPT_ENV_CHARS}）`,
        "deepseek_harness_system_prompt_too_large",
        413,
      );
    }

    const externalSkills = await materializeExternalSkills(request);
		const remoteToolConfig = request.remoteToolConfig
			? {
					...request.remoteToolConfig,
					// Bind model-owning remote operations to the actual parsed Harness
					// execution. Never trust tool arguments to self-report this identity.
					parentAgentExecution: {
						model: request.model,
						apiStyle: request.apiStyle === "openai-responses" ? "responses" as const : "chat" as const,
					},
				}
			: null;
    const mcpToken = this.gateway.register(
      request.remoteTools,
      request.remoteToolCatalog,
			remoteToolConfig,
    );
    const requestTimeoutMs = positiveInteger(this.environment.AGENTS_REQUEST_TIMEOUT_MS);
    const contextWindow = positiveInteger(this.environment.DSH_CONTEXT_WINDOW) ?? 262_144;
    const defaultMaxTokens = request.maxOutputTokens ?? 32_768;
    const childEnvironment: NodeJS.ProcessEnv = {
      ...this.environment,
      DSH_HOME: this.dshHome,
      DSH_TELEMETRY_DISABLED: "1",
      DSH_BUNDLED_SKILL_DIR: this.skillDirectory,
      TAPCANVAS_DSH_REQUEST_SKILLS_DIR:
        externalSkills.root ?? this.emptyRequestSkillDirectory,
      TAPCANVAS_DSH_SYSTEM_PROMPT: effectiveSystemPrompt,
      TAPCANVAS_DSH_API_KEY: request.apiKey,
      TAPCANVAS_DSH_API_BASE_URL: request.apiBaseUrl,
      TAPCANVAS_DSH_API_STYLE: request.apiStyle,
      TAPCANVAS_DSH_MODEL: request.model,
      TAPCANVAS_DSH_CONTEXT_WINDOW: String(contextWindow),
      TAPCANVAS_DSH_MAX_OUTPUT_TOKENS: String(defaultMaxTokens),
      TAPCANVAS_DSH_MCP_ENABLED: "true",
      TAPCANVAS_DSH_MCP_TOKEN: mcpToken,
      TAPCANVAS_DSH_MCP_URL: `${this.bridgeOrigin}/internal/mcp/${encodeURIComponent(mcpToken)}`,
      ...(request.reasoningEffort
        ? { TAPCANVAS_DSH_REASONING_EFFORT: request.reasoningEffort }
        : {}),
    };

    const harness = new DeepSeekHarness({
      dshBin: dshBinPath,
      profile: "sdk",
      patches: [patchPath],
      dshHome: this.dshHome,
      processCwd: this.workspaceRoot,
      env: childEnvironment,
      ...(requestTimeoutMs ? { requestTimeoutMs } : {}),
      cwd: this.workspaceRoot,
      provider: "tapcanvas",
      model: request.model,
      ...(request.maxOutputTokens ? { maxTokens: request.maxOutputTokens } : {}),
    });
    const projector = new HarnessEventProjector(request.sessionId, emit);
    projector.start(request.prompt.slice(0, 240));
    const startedAt = Date.now();
    const abort = (): void => {
      void harness.close();
    };
    abortSignal.addEventListener("abort", abort, { once: true });

    try {
      const result = await harness.run(structuredPrompt(request, externalSkills.namesByKey), {
        sessionId: buildHarnessExecutionSessionId(request, randomUUID()),
        onNotification: (notification: HarnessNotification) => projector.accept(notification),
      });
      const text = projector.responseText(result.finalResponse);
      const remoteExecutions = this.gateway.executions(mcpToken);
      const tools = projector.tools(remoteExecutions);
      const response = buildResponse({
        request,
        result,
        text,
        projector,
        tools,
        deliveryReport: this.gateway.deliveryReport(mcpToken),
        remoteExecutions,
        elapsedMs: Math.max(0, Date.now() - startedAt),
      });
      return {
        response,
        text,
        completed: projector.isCompleted(),
        projector,
      };
    } finally {
      abortSignal.removeEventListener("abort", abort);
      await harness.close();
      this.gateway.unregister(mcpToken);
      if (externalSkills.root) {
        await rm(externalSkills.root, { recursive: true, force: true });
      }
    }
  }
}
