import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentDefinition, CapabilityProviderKind } from "../../types/index.js";

let activeDefinitions = new Map<string, AgentDefinition>();

const DEFAULT_BUNDLED_DEFINITION_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "agent-definitions",
  "defaults.json",
);

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = String(item || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeCapabilityProviderBundle(value: unknown): CapabilityProviderKind[] {
  return normalizeStringArray(value)
    .filter(
      (item): item is CapabilityProviderKind =>
        item === "local" || item === "remote" || item === "mcp" || item === "skill",
    );
}

function normalizeAgentDefinition(value: unknown): AgentDefinition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  const tools = normalizeStringArray(record.tools);
  if (!name || !description || !prompt || tools.length === 0) return null;
  const executionModeRaw =
    typeof record.executionMode === "string" ? record.executionMode.trim() : "";
  const isolationModeRaw =
    typeof record.isolationMode === "string" ? record.isolationMode.trim() : "";
  const modelPolicy =
    record.modelPolicy && typeof record.modelPolicy === "object" && !Array.isArray(record.modelPolicy)
      ? record.modelPolicy as Record<string, unknown>
      : null;
  return {
    name,
    description,
    prompt,
    tools,
    ...(record.team === true ? { team: true } : {}),
    ...(executionModeRaw === "direct" || executionModeRaw === "private_workspace"
      ? { executionMode: executionModeRaw }
      : {}),
    ...(isolationModeRaw === "shared_workspace" || isolationModeRaw === "private_workspace"
      ? { isolationMode: isolationModeRaw }
      : {}),
    ...(modelPolicy
      ? {
          modelPolicy: {
            ...(modelPolicy.inheritFromParent === true ? { inheritFromParent: true } : {}),
            ...(typeof modelPolicy.defaultModel === "string" && modelPolicy.defaultModel.trim()
              ? { defaultModel: modelPolicy.defaultModel.trim() }
              : {}),
          },
        }
      : {}),
    ...(normalizeStringArray(record.skillBundle).length > 0
      ? { skillBundle: normalizeStringArray(record.skillBundle) }
      : {}),
    ...(normalizeCapabilityProviderBundle(record.capabilityProviderBundle).length > 0
      ? { capabilityProviderBundle: normalizeCapabilityProviderBundle(record.capabilityProviderBundle) }
      : {}),
  };
}

function readDefinitionFile(filePath: string): AgentDefinition[] {
  if (!fs.existsSync(filePath)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
  } catch {
    return [];
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const definitions: AgentDefinition[] = [];
  for (const item of items) {
    const normalized = normalizeAgentDefinition(item);
    if (normalized) definitions.push(normalized);
  }
  return definitions;
}

export function resolveAgentDefinitionFiles(workspaceRoot: string): string[] {
  const cwd = process.cwd();
  const candidates = [
    DEFAULT_BUNDLED_DEFINITION_FILE,
    path.join(workspaceRoot, ".agents", "agent-definitions", "defaults.json"),
    path.join(workspaceRoot, "agent-definitions", "defaults.json"),
    path.join(cwd, "agent-definitions", "defaults.json"),
  ];
  const seen = new Set<string>();
  const files: string[] = [];
  for (const candidate of candidates) {
    const normalized = path.resolve(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (fs.existsSync(normalized)) files.push(normalized);
  }
  return files;
}

export function loadAgentDefinitions(files: string[]): Map<string, AgentDefinition> {
  const merged = new Map<string, AgentDefinition>();
  for (const filePath of files) {
    for (const definition of readDefinitionFile(filePath)) {
      merged.set(definition.name, definition);
    }
  }
  return merged;
}

export function setActiveAgentDefinitions(definitions: Map<string, AgentDefinition>): void {
  activeDefinitions = new Map(definitions);
}

export function getActiveAgentDefinitions(): Map<string, AgentDefinition> {
  if (activeDefinitions.size === 0) {
    activeDefinitions = loadAgentDefinitions([DEFAULT_BUNDLED_DEFINITION_FILE]);
  }
  return activeDefinitions;
}

export function getAgentDefinition(name: string): AgentDefinition | null {
  return getActiveAgentDefinitions().get(String(name || "").trim()) ?? null;
}
