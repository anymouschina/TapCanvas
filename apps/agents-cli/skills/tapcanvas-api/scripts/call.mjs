#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  profileRequestBaseUrl,
  resolveProfileCredentials,
} from "./profile-config.mjs";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const skillRoot = path.resolve(__dirname, "..");
const defaultConfigPath = path.join(skillRoot, "config.json");

// 长任务（视频生成等）会让 SSE 流静默数分钟，undici 默认 bodyTimeout=300s 会误判断连、
// 中断客户端并连带杀掉服务端 run（孤儿任务）。禁用超时，让长连撑过整段生成。
// undici 非默认可导入，找不到则静默降级为原生 fetch。
try {
  // Resolve undici from the monorepo pnpm store without hardcoding a version
  // (a pinned version path silently breaks on upgrade and the timeout regresses).
  const repoRoot = path.resolve(__dirname, "../../../../..");
  const candidateStores = [
    path.join(repoRoot, "apps/hono-api/node_modules/.pnpm"),
    path.join(repoRoot, "node_modules/.pnpm"),
  ];
  let undiciEntry = "";
  for (const store of candidateStores) {
    if (!fs.existsSync(store)) continue;
    const match = fs
      .readdirSync(store)
      .filter((d) => /^undici@/.test(d))
      .sort()
      .pop();
    if (!match) continue;
    const entry = path.join(store, match, "node_modules/undici/index.js");
    if (fs.existsSync(entry)) {
      undiciEntry = entry;
      break;
    }
  }
  if (undiciEntry) {
    const { Agent, setGlobalDispatcher } = await import("file://" + undiciEntry);
    setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 30_000 }));
  }
} catch {
  // ignore — fall back to default fetch behavior
}

const ENDPOINTS = {
  chat: { method: "POST", path: "/public/agents/chat", needsPayload: true },
  openAiChat: {
    method: "POST",
    path: "/public/v1/chat/completions",
    needsPayload: true,
    streamResponse: true,
  },
  chatStatus: { method: "POST", path: "/public/agents/chat/status", needsPayload: true },
  chatResume: { method: "POST", path: "/public/agents/chat/resume", needsPayload: true },
  chatInterrupt: { method: "POST", path: "/public/agents/chat/interrupt", needsPayload: true },
  draw: { method: "POST", path: "/public/draw", needsPayload: true },
  vision: { method: "POST", path: "/public/vision", needsPayload: true },
  video: { method: "POST", path: "/public/video", needsPayload: true },
  taskResult: { method: "POST", path: "/public/tasks/result", needsPayload: true },
  taskLogs: { method: "GET", path: "/tasks/logs", needsPayload: false, access: "protected" },
  taskReceiptInspect: { method: "POST", path: "/tasks/receipt-inspect", needsPayload: true, access: "protected" },
  models: { method: "GET", path: "/public/v1/models", needsPayload: false },
  modelCatalogModels: {
    method: "GET",
    path: "/model-catalog/models",
    needsPayload: false,
    access: "protected",
  },
  newApiModels: {
    method: "GET",
    path: "/new-api-models",
    needsPayload: false,
    access: "protected",
  },
  // 视频理解：向 doubao-seed-2.0 系列模型发送视频 URL，返回文本分析结果
  // payload: { model, videoUrl, userPrompt, fps }  → response: { text }
  llmChat: { method: "POST", path: "/agents/llm/v1/chat/completions", needsPayload: true, access: "protected" },
  videoUnderstand: { method: "POST", path: "/agents/llm/v1/video-understand", needsPayload: true, access: "protected" },
  projects: { method: "GET", path: "/projects", needsPayload: false, access: "protected" },
  projectCreate: { method: "POST", path: "/projects", needsPayload: true, access: "protected" },
  projectChapters: { method: "GET", path: "/projects/:projectId/chapters", needsPayload: false, access: "protected" },
  chapterCreate: { method: "POST", path: "/projects/:projectId/chapters", needsPayload: true, access: "protected" },
  chapterGet: { method: "GET", path: "/chapters/:id", needsPayload: false, access: "protected" },
  chapterUpdate: { method: "PATCH", path: "/chapters/:id", needsPayload: true, access: "protected" },
  assets: { method: "GET", path: "/assets", needsPayload: false, access: "protected" },
  assetCreate: { method: "POST", path: "/assets", needsPayload: true, access: "protected" },
  assetUpdate: { method: "PATCH", path: "/assets/:id/data", needsPayload: true, access: "protected" },
  publishedAssets: { method: "GET", path: "/assets/published", needsPayload: false, access: "protected" },
  capabilityBayProjectAdopt: {
    method: "PUT",
    path: "/agents/capability-bay/projects/:projectId",
    needsPayload: true,
    access: "protected",
  },
  capabilityBayGet: {
    method: "GET",
    path: "/agents/capability-bay",
    needsPayload: false,
    access: "protected",
  },
  capabilityBayInspect: {
    method: "POST",
    path: "/agents/capability-bay/inspect",
    needsPayload: true,
    access: "protected",
  },
  capabilityBayWorkflowEquip: {
    method: "PUT",
    path: "/agents/capability-bay/workflows/:flowId",
    needsPayload: true,
    access: "protected",
  },
  capabilityBayWorkflowUnequip: {
    method: "DELETE",
    path: "/agents/capability-bay/workflows/:flowId",
    needsPayload: false,
    access: "protected",
  },
  books: { method: "GET", path: "/assets/books", needsPayload: false, access: "protected" },
  bookIndex: { method: "GET", path: "/assets/books/:bookId/index", needsPayload: false, access: "protected" },
  bookChapter: { method: "GET", path: "/assets/books/:bookId/chapter", needsPayload: false, access: "protected" },
  bookIngest: { method: "POST", path: "/assets/books/ingest", needsPayload: true, access: "protected" },
  bookUploadStart: { method: "POST", path: "/assets/books/upload/start", needsPayload: true, access: "protected" },
  bookUploadAppend: { method: "POST", path: "/assets/books/upload/:uploadId/append", needsPayload: true, access: "protected", rawBinaryBase64: true },
  bookUploadFinish: { method: "POST", path: "/assets/books/upload/:uploadId/finish", needsPayload: true, access: "protected" },
  bookUploadJob: { method: "GET", path: "/assets/books/upload/jobs/:jobId", needsPayload: false, access: "protected" },
  projectSessions: { method: "POST", path: "/memory/project-sessions", needsPayload: true, access: "protected" },
  memoryContext: { method: "POST", path: "/memory/context", needsPayload: true, access: "protected" },
  memoryWrite: { method: "POST", path: "/memory/write", needsPayload: true, access: "protected" },
  memorySearch: { method: "POST", path: "/memory/search", needsPayload: true, access: "protected" },
  flows: { method: "GET", path: "/public/projects/:projectId/flows", needsPayload: false },
  flowCreate: { method: "POST", path: "/flows", needsPayload: true, access: "protected" },
  flowGet: { method: "GET", path: "/public/flows/:id", needsPayload: false },
  flowVersions: { method: "GET", path: "/flows/:id/versions", needsPayload: false, access: "protected" },
  flowRollback: { method: "POST", path: "/flows/:id/rollback", needsPayload: true, access: "protected" },
  chapterFlowGet: { method: "GET", path: "/chapters/:id/canvas-flow", needsPayload: false, access: "protected" },
  chapterCanvasMembership: { method: "GET", path: "/chapters/:id/canvas-membership", needsPayload: false, access: "protected" },
  chapterFlowPut: { method: "PUT", path: "/chapters/:id/canvas-flow", needsPayload: true, access: "protected" },
  communityPublish: { method: "PATCH", path: "/community/projects/:projectId/publish", needsPayload: true, access: "protected" },
  communityProjectGet: { method: "GET", path: "/community/projects/:projectId", needsPayload: false, access: "protected" },
  agentDiagnostics: { method: "GET", path: "/admin/agents/diagnostics", needsPayload: false, access: "protected" },
  agentDiagnosticEvents: {
    method: "GET",
    path: "/admin/agents/diagnostics/executions/:traceId/events",
    needsPayload: false,
    access: "protected",
  },
  flowPatch: { method: "POST", path: "/public/flows/:id/patch", needsPayload: true },
  flowScopeRepair: {
    method: "POST",
    path: "/public/projects/:projectId/flows/:id/scope/repair",
    needsPayload: true,
  },
  executions: { method: "GET", path: "/executions", needsPayload: false, access: "protected" },
  executionRun: { method: "POST", path: "/executions/run", needsPayload: true, access: "protected" },
  executionGet: { method: "GET", path: "/executions/:id", needsPayload: false, access: "protected" },
  executionCancel: { method: "POST", path: "/executions/:id/cancel", needsPayload: false, access: "protected" },
  executionNodeRuns: { method: "GET", path: "/executions/:id/node-runs", needsPayload: false, access: "protected" },
  executionAttempts: { method: "GET", path: "/executions/:id/attempts", needsPayload: false, access: "protected" },
  executionFamily: { method: "GET", path: "/executions/:id/family", needsPayload: false, access: "protected" },
  executionContext: { method: "GET", path: "/executions/:id/context", needsPayload: false, access: "protected" },
  executionSnapshot: { method: "GET", path: "/executions/:id/snapshot", needsPayload: false, access: "protected" },
  executionResume: { method: "POST", path: "/executions/:id/resume", needsPayload: true, access: "protected" },
  executionMetrics: { method: "GET", path: "/executions/metrics", needsPayload: false, access: "protected" },
  executionNodeHistory: { method: "GET", path: "/executions/node-history", needsPayload: false, access: "protected" },
  // 调用 agents-tool-bridge 的任意工具（生图/生视频/读画布等）
  // payload: { toolName, canvasProjectId, canvasFlowId, args: {...} }
  toolExecute: { method: "POST", path: "/public/agents/tools/execute", needsPayload: true },
};

function parseArgs(argv) {
  const out = {};
  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    index += 1;
  }
  return out;
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

function readConfig(configPath) {
  const resolved = path.resolve(process.cwd(), configPath || defaultConfigPath);
  if (!fs.existsSync(resolved)) throw new Error(`Config file does not exist: ${resolved}`);
  try {
    return { path: resolved, value: readJsonFile(resolved) };
  } catch {
    throw new Error(`Config file is not valid JSON: ${resolved}`);
  }
}

function parsePayload(args) {
	if (args.payload === "-") {
		return JSON.parse(fs.readFileSync(0, "utf-8"));
	}
  if (typeof args.payload === "string" && args.payload.trim()) {
    return JSON.parse(args.payload);
  }
  if (typeof args.payloadFile === "string" && args.payloadFile.trim()) {
    const filePath = path.resolve(process.cwd(), args.payloadFile.trim());
    return readJsonFile(filePath);
  }
  return null;
}

function resolveEndpoint(args) {
  const endpointKey = String(args.endpoint || "").trim();
  const endpoint = ENDPOINTS[endpointKey];
  if (!endpoint) {
    throw new Error(
      `Unsupported endpoint "${endpointKey}". Allowed: ${Object.keys(ENDPOINTS).join(", ")}`,
    );
  }
  return { endpointKey, endpoint };
}

function buildUrl(baseUrl, endpointKey, endpoint, args) {
  if (endpointKey === "capabilityBayGet") {
    const projectId = String(args.projectId || "").trim();
    const suffix = projectId ? `?${new URLSearchParams({ projectId }).toString()}` : "";
    return `${baseUrl}${endpoint.path}${suffix}`;
  }

  if (
    endpointKey === "capabilityBayWorkflowEquip" ||
    endpointKey === "capabilityBayWorkflowUnequip"
  ) {
    const flowId = String(args.flowId || "").trim();
    if (!flowId) throw new Error(`Missing --flowId for endpoint=${endpointKey}`);
    return `${baseUrl}${endpoint.path.replace(":flowId", encodeURIComponent(flowId))}`;
  }

  if (endpointKey === "capabilityBayProjectAdopt") {
    const projectId = String(args.projectId || "").trim();
    if (!projectId) throw new Error("Missing --projectId for endpoint=capabilityBayProjectAdopt");
    return `${baseUrl}${endpoint.path.replace(":projectId", encodeURIComponent(projectId))}`;
  }

  if (endpointKey === "flows") {
    const projectId = String(args.projectId || "").trim();
    if (!projectId) throw new Error("Missing --projectId for endpoint=flows");
    return `${baseUrl}${endpoint.path.replace(":projectId", encodeURIComponent(projectId))}`;
  }

  if (endpointKey === "books") {
    const projectId = String(args.projectId || "").trim();
    if (!projectId) throw new Error("Missing --projectId for endpoint=books");
    return `${baseUrl}${endpoint.path}?projectId=${encodeURIComponent(projectId)}`;
  }

  if (endpointKey === "bookIndex" || endpointKey === "bookChapter") {
    const projectId = String(args.projectId || "").trim();
    const bookId = String(args.bookId || "").trim();
    if (!projectId) throw new Error(`Missing --projectId for endpoint=${endpointKey}`);
    if (!bookId) throw new Error(`Missing --bookId for endpoint=${endpointKey}`);
    const query = new URLSearchParams({ projectId });
    if (endpointKey === "bookChapter") {
      const chapter = String(args.chapter || "").trim();
      if (!chapter) throw new Error("Missing --chapter for endpoint=bookChapter");
      query.set("chapter", chapter);
    }
    return `${baseUrl}${endpoint.path.replace(":bookId", encodeURIComponent(bookId))}?${query.toString()}`;
  }

  if (endpointKey === "bookUploadAppend" || endpointKey === "bookUploadFinish") {
    const projectId = String(args.projectId || "").trim();
    const uploadId = String(args.uploadId || "").trim();
    if (!projectId) throw new Error(`Missing --projectId for endpoint=${endpointKey}`);
    if (!uploadId) throw new Error(`Missing --uploadId for endpoint=${endpointKey}`);
    const query = new URLSearchParams({ projectId });
    if (endpointKey === "bookUploadAppend") {
      const offset = String(args.offset || "").trim();
      if (!offset && offset !== "0") throw new Error("Missing --offset for endpoint=bookUploadAppend");
      query.set("offset", offset);
    }
    return `${baseUrl}${endpoint.path.replace(":uploadId", encodeURIComponent(uploadId))}?${query.toString()}`;
  }

  if (endpointKey === "bookUploadJob") {
    const projectId = String(args.projectId || "").trim();
    const jobId = String(args.jobId || "").trim();
    if (!projectId) throw new Error("Missing --projectId for endpoint=bookUploadJob");
    if (!jobId) throw new Error("Missing --jobId for endpoint=bookUploadJob");
    return `${baseUrl}${endpoint.path.replace(":jobId", encodeURIComponent(jobId))}?${new URLSearchParams({ projectId }).toString()}`;
  }

  if (endpointKey === "projectChapters" || endpointKey === "chapterCreate") {
    const projectId = String(args.projectId || "").trim();
    if (!projectId) throw new Error(`Missing --projectId for endpoint=${endpointKey}`);
    return `${baseUrl}${endpoint.path.replace(":projectId", encodeURIComponent(projectId))}`;
  }

  if (
    endpointKey === "chapterGet"
    || endpointKey === "chapterUpdate"
    || endpointKey === "chapterCanvasMembership"
    || endpointKey === "chapterFlowGet"
    || endpointKey === "chapterFlowPut"
  ) {
    const chapterId = String(args.chapterId || "").trim();
    if (!chapterId) throw new Error(`Missing --chapterId for endpoint=${endpointKey}`);
    return `${baseUrl}${endpoint.path.replace(":id", encodeURIComponent(chapterId))}`;
  }

  if (endpointKey === "communityPublish" || endpointKey === "communityProjectGet") {
    const projectId = String(args.projectId || "").trim();
    if (!projectId) throw new Error(`Missing --projectId for endpoint=${endpointKey}`);
    return `${baseUrl}${endpoint.path.replace(":projectId", encodeURIComponent(projectId))}`;
  }

  if (endpointKey === "assetUpdate") {
    const assetId = String(args.assetId || "").trim();
    if (!assetId) throw new Error("Missing --assetId for endpoint=assetUpdate");
    return `${baseUrl}${endpoint.path.replace(":id", encodeURIComponent(assetId))}`;
  }

  if (endpointKey === "publishedAssets") {
    const query = new URLSearchParams();
    const limit = String(args.limit || "").trim();
    if (limit) query.set("limit", limit);
    return `${baseUrl}${endpoint.path}${query.size ? `?${query.toString()}` : ""}`;
  }

  if (
    endpointKey === "flowGet"
    || endpointKey === "flowPatch"
    || endpointKey === "flowVersions"
    || endpointKey === "flowRollback"
  ) {
    const flowId = String(args.flowId || "").trim();
    if (!flowId) throw new Error(`Missing --flowId for endpoint=${endpointKey}`);
    return `${baseUrl}${endpoint.path.replace(":id", encodeURIComponent(flowId))}`;
  }

  if (endpointKey === "flowScopeRepair") {
    const projectId = String(args.projectId || "").trim();
    const flowId = String(args.flowId || "").trim();
    if (!projectId) throw new Error("Missing --projectId for endpoint=flowScopeRepair");
    if (!flowId) throw new Error("Missing --flowId for endpoint=flowScopeRepair");
    return `${baseUrl}${endpoint.path
      .replace(":projectId", encodeURIComponent(projectId))
      .replace(":id", encodeURIComponent(flowId))}`;
  }

  if (endpointKey === "executions") {
    const flowId = String(args.flowId || "").trim();
    if (!flowId) throw new Error("Missing --flowId for endpoint=executions");
    const query = new URLSearchParams({ flowId });
    const limit = String(args.limit || "").trim();
    if (limit) query.set("limit", limit);
    return `${baseUrl}${endpoint.path}?${query.toString()}`;
  }

  if (endpointKey === "assets") {
    const projectId = String(args.projectId || "").trim();
    if (!projectId) throw new Error("Missing --projectId for endpoint=assets");
    const query = new URLSearchParams({ projectId });
    const limit = String(args.limit || "").trim();
    const kind = String(args.kind || "").trim();
    const cursor = String(args.cursor || "").trim();
    if (limit) query.set("limit", limit);
    if (kind) query.set("kind", kind);
    if (cursor) query.set("cursor", cursor);
    if (args.fullData === true || String(args.fullData || "").trim() === "1") query.set("fullData", "1");
    return `${baseUrl}${endpoint.path}?${query.toString()}`;
  }

  if (
    endpointKey === "executionGet"
    || endpointKey === "executionCancel"
    || endpointKey === "executionNodeRuns"
    || endpointKey === "executionAttempts"
    || endpointKey === "executionFamily"
    || endpointKey === "executionContext"
    || endpointKey === "executionSnapshot"
    || endpointKey === "executionResume"
  ) {
    const executionId = String(args.executionId || "").trim();
    if (!executionId) throw new Error(`Missing --executionId for endpoint=${endpointKey}`);
    const url = `${baseUrl}${endpoint.path.replace(":id", encodeURIComponent(executionId))}`;
    if (endpointKey !== "executionAttempts" && endpointKey !== "executionFamily") return url;
    const query = new URLSearchParams();
    const cursor = String(args.cursor || "").trim();
    const limit = String(args.limit || "").trim();
    if (cursor) query.set("cursor", cursor);
    if (limit) query.set("limit", limit);
    const suffix = query.toString();
    return `${url}${suffix ? `?${suffix}` : ""}`;
  }

  if (endpointKey === "executionMetrics") {
    const flowId = String(args.flowId || "").trim();
    if (!flowId) throw new Error("Missing --flowId for endpoint=executionMetrics");
    return `${baseUrl}${endpoint.path}?${new URLSearchParams({ flowId }).toString()}`;
  }

  if (endpointKey === "executionNodeHistory") {
    const flowId = String(args.flowId || "").trim();
    const nodeId = String(args.nodeId || "").trim();
    if (!flowId) throw new Error("Missing --flowId for endpoint=executionNodeHistory");
    if (!nodeId) throw new Error("Missing --nodeId for endpoint=executionNodeHistory");
    const query = new URLSearchParams({ flowId, nodeId });
    const limit = String(args.limit || "").trim();
    if (limit) query.set("limit", limit);
    return `${baseUrl}${endpoint.path}?${query.toString()}`;
  }

  if (endpointKey === "agentDiagnostics") {
    const query = new URLSearchParams();
    for (const key of ["projectId", "bookId", "chapterId", "label", "workflowKey", "turnVerdict", "runOutcome", "limit"]) {
      const value = String(args[key] || "").trim();
      if (value) query.set(key, value);
    }
    const suffix = query.toString();
    return `${baseUrl}${endpoint.path}${suffix ? `?${suffix}` : ""}`;
  }

  if (endpointKey === "agentDiagnosticEvents") {
    const traceId = String(args.traceId || "").trim();
    if (!traceId) throw new Error("Missing --traceId for endpoint=agentDiagnosticEvents");
    const query = new URLSearchParams();
    for (const key of ["afterSeq", "beforeSeq", "limit"]) {
      const value = String(args[key] || "").trim();
      if (value) query.set(key, value);
    }
    const suffix = query.toString();
    const url = `${baseUrl}${endpoint.path.replace(":traceId", encodeURIComponent(traceId))}`;
    return `${url}${suffix ? `?${suffix}` : ""}`;
  }

  if (endpointKey === "taskLogs") {
    const query = new URLSearchParams();
    for (const key of [
      "page",
      "pageSize",
      "taskId",
      "vendor",
      "status",
      "taskKind",
      "createdFrom",
      "createdTo",
    ]) {
      const value = String(args[key] || "").trim();
      if (value) query.set(key, value);
    }
    const suffix = query.toString();
    return `${baseUrl}${endpoint.path}${suffix ? `?${suffix}` : ""}`;
  }

  if (endpointKey === "newApiModels") {
    const query = new URLSearchParams();
    for (const key of ["kind", "enabled", "refresh", "selectable", "include_action_models"]) {
      const value = String(args[key] ?? "").trim();
      if (value) query.set(key, value);
    }
    const suffix = query.toString();
    return `${baseUrl}${endpoint.path}${suffix ? `?${suffix}` : ""}`;
  }

  if (endpointKey === "modelCatalogModels") {
    const query = new URLSearchParams();
    for (const key of ["vendorKey", "kind", "enabled"]) {
      const value = String(args[key] || "").trim();
      if (value) query.set(key, value);
    }
    const suffix = query.toString();
    return `${baseUrl}${endpoint.path}${suffix ? `?${suffix}` : ""}`;
  }

  return `${baseUrl}${endpoint.path}`;
}

function buildHeaders({ apiKey, authToken, payload }) {
  const headers = {};
  if (authToken) {
    headers.Authorization = authToken.startsWith("Bearer ")
      ? authToken
      : `Bearer ${authToken}`;
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  if (payload !== null) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

async function readResponse(response) {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const COMPACT_EXECUTION_ENDPOINTS = new Set([
  "executions",
  "executionRun",
  "executionGet",
  "executionCancel",
  "executionResume",
]);

function compactExecution(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const {
    projectContext: _projectContext,
    assetSnapshot: _assetSnapshot,
    userInput: _userInput,
    ...summary
  } = value;
  return summary;
}

function compactExecutionResponse(endpointKey, data) {
  if (!COMPACT_EXECUTION_ENDPOINTS.has(endpointKey)) return data;
  if (Array.isArray(data)) return data.map(compactExecution);
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data.items)) {
    return { ...data, items: data.items.map(compactExecution) };
  }
  return compactExecution(data);
}

async function readOpenAiStream(response, startedAt) {
  if (!response.body) return { firstChunkMs: null, totalMs: performance.now() - startedAt };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let firstChunkMs = null;
  let networkChunkCount = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    firstChunkMs ??= performance.now() - startedAt;
    networkChunkCount += 1;
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();

  let eventCount = 0;
  let assistantDeltaCount = 0;
  let assistantCharacters = 0;
  let finishReason = null;
  let usage = null;
  const errors = [];
  const patchOperations = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const value = line.slice(5).trim();
    if (!value || value === "[DONE]") continue;
    let event;
    try {
      event = JSON.parse(value);
    } catch {
      continue;
    }
    eventCount += 1;
    if (event?.error) {
      errors.push({
        code: event.error.code || null,
        message: event.error.message || String(event.error),
      });
    }
    if (event?.usage) usage = event.usage;
    const choice = event?.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    const content = choice?.delta?.content;
    if (typeof content === "string" && content) {
      assistantDeltaCount += 1;
      assistantCharacters += content.length;
    }
    for (const toolCall of choice?.delta?.tool_calls || []) {
      if (toolCall?.function?.name !== "flow_patch") continue;
      let args = null;
      try {
        args = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        args = null;
      }
      if (!args || typeof args !== "object") continue;
      patchOperations.push({
        op: args.op || null,
        nodeId: args.node?.id || args.id || null,
        nodeType: args.node?.type || null,
        source: args.source || null,
        target: args.target || null,
      });
    }
  }

  return {
    firstChunkMs: firstChunkMs === null ? null : Math.round(firstChunkMs),
    totalMs: Math.round(performance.now() - startedAt),
    networkChunkCount,
    eventCount,
    assistantDeltaCount,
    assistantCharacters,
    toolCallCount: patchOperations.length,
    patchOperations,
    finishReason,
    usage,
    errors,
  };
}

function printHelp() {
  process.stdout.write(
    [
      "TapCanvas unified API caller",
      "",
      "Required:",
      "  --endpoint <chat|openAiChat|chatStatus|chatResume|chatInterrupt|draw|vision|video|taskResult|taskLogs|models|modelCatalogModels|newApiModels|videoUnderstand|projects|projectCreate|chapterCreate|chapterGet|chapterUpdate|assets|assetCreate|capabilityBayGet|capabilityBayInspect|capabilityBayWorkflowEquip|capabilityBayWorkflowUnequip|capabilityBayProjectAdopt|books|bookIndex|bookChapter|bookIngest|projectSessions|memoryContext|flows|flowCreate|flowGet|flowVersions|flowRollback|chapterFlowGet|chapterCanvasMembership|chapterFlowPut|communityPublish|communityProjectGet|agentDiagnostics|agentDiagnosticEvents|flowPatch|flowScopeRepair|executions|executionRun|executionGet|executionCancel|executionNodeRuns|executionAttempts|executionFamily|executionContext|executionSnapshot|executionResume|executionMetrics|executionNodeHistory|toolExecute>",
      "",
      "Optional config overrides:",
      "  --config <path>",
      "  --profile <local|production>  required unless TAPCANVAS_PROFILE is set",
      "  --apiBaseUrl <url>",
      "  --apiKey <key>",
      "  --authToken <jwt>",
      "",
      "Payload:",
      "  --payload '<json>'",
	  "  --payload -              read JSON payload from stdin",
      "  --payloadFile <path>",
      "",
      "New API model catalog (read-only):",
      "  --kind <text|image|video|audio> --enabled <true|false>",
      "  --refresh <true|false> --selectable <true|false> --include_action_models <true|false>",
      "",
      "Flow endpoints:",
      "  --projectId <id>   for endpoint=assets|assetCreate|capabilityBayGet|capabilityBayProjectAdopt|books|bookIndex|bookChapter|chapterCreate|communityPublish|communityProjectGet|flows|flowScopeRepair",
      "  --bookId <id>      for endpoint=bookIndex|bookChapter",
      "  --chapter <n>      for endpoint=bookChapter",
      "  --flowId <id>      for endpoint=capabilityBayWorkflowEquip|capabilityBayWorkflowUnequip|flowGet|flowVersions|flowRollback|flowPatch|flowScopeRepair|executions|executionMetrics|executionNodeHistory",
      "  --executionId <id> for endpoint=executionGet|executionCancel|executionNodeRuns|executionAttempts|executionFamily|executionContext|executionSnapshot|executionResume",
	  "  --cursor <id>      exclusive nextCursor for endpoint=executionAttempts|executionFamily",
	  "  --limit <1..200>   page size for endpoint=executionAttempts|executionFamily",
      "  --nodeId <id>      for endpoint=executionNodeHistory",
      "  --taskId <id>      exact filter for endpoint=taskLogs",
      "  --chapterId <id>   for endpoint=chapterGet|chapterUpdate|chapterFlowGet|chapterCanvasMembership|chapterFlowPut",
      "  --traceId <id>     for endpoint=agentDiagnosticEvents",
      "  --afterSeq <n>     forward event cursor for endpoint=agentDiagnosticEvents",
      "  --beforeSeq <n>    backward event cursor for endpoint=agentDiagnosticEvents",
      "",
    ].join("\n"),
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const { endpointKey, endpoint } = resolveEndpoint(args);
  const config = readConfig(args.config);
  const { profile, apiBaseUrl, apiKey, authToken } = resolveProfileCredentials({
    args,
    config: config.value,
    configPath: config.path,
    environment: process.env,
  });

  const payload = parsePayload(args);
  if (endpoint.needsPayload && payload === null) {
    throw new Error(`Endpoint "${endpointKey}" requires --payload or --payloadFile.`);
  }
  if (!endpoint.needsPayload && payload !== null && endpointKey !== "flowPatch") {
    throw new Error(`Endpoint "${endpointKey}" does not accept payload.`);
  }

  const requestBaseUrl = profileRequestBaseUrl({
    profile,
    apiBaseUrl,
    access: endpoint.access === "protected" ? "protected" : "public",
  });
  const url = buildUrl(requestBaseUrl, endpointKey, endpoint, args);
  const startedAt = performance.now();
  const requestHeaders = buildHeaders({ apiKey, authToken, payload });
  const requestBody = endpoint.rawBinaryBase64
    ? Buffer.from(String(payload?.chunkBase64 || ""), "base64")
    : payload !== null
      ? JSON.stringify(payload)
      : null;
  if (endpoint.rawBinaryBase64) requestHeaders["Content-Type"] = "application/octet-stream";
  const response = await fetch(url, {
    method: endpoint.method,
    headers: requestHeaders,
    ...(requestBody !== null ? { body: requestBody } : {}),
  });

  const rawData = endpoint.streamResponse
    ? await readOpenAiStream(response, startedAt)
    : await readResponse(response);
  if (!response.ok) {
    throw new Error(
      JSON.stringify(
        {
          endpoint: endpointKey,
          url,
          status: response.status,
          statusText: response.statusText,
          response: rawData,
        },
        null,
        2,
      ),
    );
  }

  const data = compactExecutionResponse(endpointKey, rawData);

  process.stdout.write(
    `${JSON.stringify({ endpoint: endpointKey, url, data }, null, 2)}\n`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
