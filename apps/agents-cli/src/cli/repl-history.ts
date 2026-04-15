import fs from "node:fs";
import path from "node:path";

const DEFAULT_MAX_ENTRIES = 200;

type ReplHistoryRecord = {
  prompt: string;
  createdAt: string;
};

function safeParseRecord(line: string): ReplHistoryRecord | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const candidate = parsed as { prompt?: unknown; createdAt?: unknown };
    if (typeof candidate.prompt !== "string" || typeof candidate.createdAt !== "string") {
      return null;
    }
    return {
      prompt: candidate.prompt,
      createdAt: candidate.createdAt,
    };
  } catch {
    return null;
  }
}

export function loadReplPromptHistory(filePath: string, maxEntries = DEFAULT_MAX_ENTRIES): string[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const entries = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => safeParseRecord(line))
      .filter((item): item is ReplHistoryRecord => item !== null && item.prompt.trim().length > 0)
      .map((item) => item.prompt);
    return entries.slice(-Math.max(0, maxEntries));
  } catch {
    return [];
  }
}

export function appendReplPromptHistory(filePath: string, promptText: string, maxEntries = DEFAULT_MAX_ENTRIES) {
  const normalized = String(promptText || "");
  if (!normalized.trim()) return;

  const existing = loadReplPromptHistory(filePath, maxEntries);
  if (existing.length > 0 && existing[existing.length - 1] === normalized) {
    return;
  }

  const next = [...existing, normalized].slice(-Math.max(1, maxEntries));
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const out = next
    .map((prompt) =>
      JSON.stringify({
        prompt,
        createdAt: new Date().toISOString(),
      } satisfies ReplHistoryRecord)
    )
    .join("\n");
  fs.writeFileSync(filePath, `${out}\n`, "utf8");
}
