import type { ToolRuntimeState } from "./registry.js";

const DEFAULT_TOOL_CACHE_TTL_MS = 15_000;

export function getToolCacheTtlMs(): number {
  const raw = Number(process.env.AGENTS_TOOL_CACHE_TTL_MS ?? DEFAULT_TOOL_CACHE_TTL_MS);
  if (!Number.isFinite(raw)) return DEFAULT_TOOL_CACHE_TTL_MS;
  return Math.max(0, Math.trunc(raw));
}

export function readCache(
  store: Map<string, { content: string; expiresAt: number }>,
  key: string
): string | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    store.delete(key);
    return null;
  }
  return hit.content;
}

export function writeCache(
  store: Map<string, { content: string; expiresAt: number }>,
  key: string,
  content: string,
  ttlMs: number
) {
  if (ttlMs <= 0) return;
  store.set(key, { content, expiresAt: Date.now() + ttlMs });
}

export function invalidateToolCaches(state: ToolRuntimeState) {
  state.cache.readFile.clear();
  state.cache.bash.clear();
  state.guard.readFileUsageByPath?.clear();
}

const READ_ONLY_BINARIES = new Set([
  "ls",
  "cat",
  "sed",
  "head",
  "tail",
  "wc",
  "find",
  "rg",
  "grep",
  "awk",
  "cut",
  "sort",
  "uniq",
  "test",
  "stat",
  "du",
]);

export function isReadonlyBashCommand(command: string): boolean {
  const trimmed = String(command || "").trim();
  if (!trimmed) return false;
  if (/[<>]/.test(trimmed)) return false;
  const segments = trimmed
    .split(/\|\||&&|;|\|/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every((segment) => {
    const first = firstTokenWithoutEnv(segment);
    return !!first && READ_ONLY_BINARIES.has(first);
  });
}

function firstTokenWithoutEnv(segment: string): string | null {
  const tokens = segment.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token)) continue;
    return token;
  }
  return null;
}
