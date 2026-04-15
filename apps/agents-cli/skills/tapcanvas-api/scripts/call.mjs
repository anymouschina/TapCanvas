#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const skillRoot = path.resolve(__dirname, "..");
const defaultConfigPath = path.join(skillRoot, "config.json");

const ENDPOINTS = {
  chat: { method: "POST", path: "/public/agents/chat", needsPayload: true },
  draw: { method: "POST", path: "/public/draw", needsPayload: true },
  vision: { method: "POST", path: "/public/vision", needsPayload: true },
  video: { method: "POST", path: "/public/video", needsPayload: true },
  taskResult: { method: "POST", path: "/public/tasks/result", needsPayload: true },
  flows: { method: "GET", path: "/public/projects/:projectId/flows", needsPayload: false },
  flowGet: { method: "GET", path: "/public/flows/:id", needsPayload: false },
  flowPatch: { method: "POST", path: "/public/flows/:id/patch", needsPayload: true },
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

function readJsonFileIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return readJsonFile(filePath);
  } catch {
    return null;
  }
}

function readConfig(configPath) {
  const resolved = path.resolve(process.cwd(), configPath || defaultConfigPath);
  const value = readJsonFileIfExists(resolved);
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function normalizeBaseUrl(value) {
  const trimmed = String(value || "").trim();
  return trimmed.replace(/\/+$/, "");
}

function parsePayload(args) {
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
  if (endpointKey === "flows") {
    const projectId = String(args.projectId || "").trim();
    if (!projectId) throw new Error("Missing --projectId for endpoint=flows");
    return `${baseUrl}${endpoint.path.replace(":projectId", encodeURIComponent(projectId))}`;
  }

  if (endpointKey === "flowGet" || endpointKey === "flowPatch") {
    const flowId = String(args.flowId || "").trim();
    if (!flowId) throw new Error(`Missing --flowId for endpoint=${endpointKey}`);
    return `${baseUrl}${endpoint.path.replace(":id", encodeURIComponent(flowId))}`;
  }

  return `${baseUrl}${endpoint.path}`;
}

function buildHeaders(apiKey, payload) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
  };
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

function printHelp() {
  process.stdout.write(
    [
      "TapCanvas unified API caller",
      "",
      "Required:",
      "  --endpoint <chat|draw|vision|video|taskResult|flows|flowGet|flowPatch>",
      "",
      "Optional config overrides:",
      "  --config <path>",
      "  --apiBaseUrl <url>",
      "  --apiKey <key>",
      "",
      "Payload:",
      "  --payload '<json>'",
      "  --payloadFile <path>",
      "",
      "Flow endpoints:",
      "  --projectId <id>   for endpoint=flows",
      "  --flowId <id>      for endpoint=flowGet|flowPatch",
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

  const apiBaseUrl = normalizeBaseUrl(
    args.apiBaseUrl || config.apiBaseUrl || process.env.TAPCANVAS_API_BASE_URL || "",
  );
  const apiKey = String(
    args.apiKey || config.apiKey || process.env.TAPCANVAS_API_KEY || "",
  ).trim();

  if (!apiBaseUrl) {
    throw new Error("Missing apiBaseUrl. Fill tapcanvas-api/config.json or pass --apiBaseUrl.");
  }
  if (!apiKey) {
    throw new Error("Missing apiKey. Fill tapcanvas-api/config.json or pass --apiKey.");
  }

  const payload = parsePayload(args);
  if (endpoint.needsPayload && payload === null) {
    throw new Error(`Endpoint "${endpointKey}" requires --payload or --payloadFile.`);
  }
  if (!endpoint.needsPayload && payload !== null && endpointKey !== "flowPatch") {
    throw new Error(`Endpoint "${endpointKey}" does not accept payload.`);
  }

  const url = buildUrl(apiBaseUrl, endpointKey, endpoint, args);
  const response = await fetch(url, {
    method: endpoint.method,
    headers: buildHeaders(apiKey, payload),
    ...(payload !== null ? { body: JSON.stringify(payload) } : {}),
  });

  const data = await readResponse(response);
  if (!response.ok) {
    throw new Error(
      JSON.stringify(
        {
          endpoint: endpointKey,
          url,
          status: response.status,
          statusText: response.statusText,
          response: data,
        },
        null,
        2,
      ),
    );
  }

  process.stdout.write(
    `${JSON.stringify({ endpoint: endpointKey, url, data }, null, 2)}\n`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
