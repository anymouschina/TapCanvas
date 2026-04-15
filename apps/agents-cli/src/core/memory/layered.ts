import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { Message } from "../../types/index.js";
import type { ToolCallTrace } from "../hooks/types.js";
import { MemoryStore, type MemoryEntry, type MemoryStoreKind } from "./store.js";

const SESSION_ROLLUP_VERSION = 1;
const DEFAULT_SESSION_KEY = "default";

export type SessionRollup = {
  version: typeof SESSION_ROLLUP_VERSION;
  sessionId: string;
  updatedAt: string;
  messageCount: number;
  latestUserPrompt: string;
  latestAssistantReply: string;
  recentUserPrompts: string[];
  recentAssistantReplies: string[];
  loadedSkills: string[];
  latestRun: {
    prompt: string;
    resultPreview: string;
    completedAt: string;
    model: string | null;
    requiredSkills: string[];
    successfulToolNames: string[];
    failedToolNames: string[];
    toolSummary: string[];
    extractedInsights: string[];
  };
};

export type MemoryCandidate = {
  version: 1;
  id: string;
  sessionId: string;
  createdAt: string;
  category: "run_outcome" | "run_path";
  storeHint: "episodic" | "procedural";
  scope: "session" | "cross_session";
  title: string;
  content: string;
  importance: number;
  tags: string[];
  evidence: {
    prompt: string;
    resultPreview: string;
    requiredSkills: string[];
    loadedSkills: string[];
    successfulToolNames: string[];
    failedToolNames: string[];
  };
};

export type ConsolidatedMemoryCandidate = {
  version: 1;
  id: string;
  category: "run_path";
  storeHint: "procedural";
  title: string;
  content: string;
  tags: string[];
  importance: number;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  sessionIds: string[];
};

export type LayeredMemorySearchResult = {
  id: string;
  kind: "note" | "session_rollup" | "consolidated_candidate";
  time: string;
  store: MemoryStoreKind | "session_rollup" | "procedural_candidate";
  tags: string[];
  content: string;
  source: string;
  relevance: number;
  archived: boolean;
  sessionId?: string;
  filePath?: string;
};

export type SyncLayeredMemoryInput = {
  memoryRoot: string;
  prompt: string;
  resultText: string;
  messages: Message[];
  toolCalls: ToolCallTrace[];
  sessionId?: string;
  requiredSkills?: string[];
  model?: string;
  extractedInsights?: string[];
};

export type MemoryPromptFragmentInput = {
  memoryRoot: string;
  prompt: string;
  sessionId?: string;
  maxRelevantItems?: number;
  maxRecentSessions?: number;
};

type SessionRollupPaths = {
  dir: string;
  jsonPath: string;
  markdownPath: string;
};

type MemoryArtifactPaths = {
  root: string;
  sessionRollupsDir: string;
  candidateRunsDir: string;
  consolidatedCandidatesPath: string;
  consolidatedCandidatesMarkdownPath: string;
  memorySummaryPath: string;
  detailedMemoryPath: string;
  indexPath: string;
};

export function resolveMemoryRoot(
  meta: Record<string, unknown> | undefined,
  fallbackRoot: string,
): string {
  const userScopedRoot =
    typeof meta?.userMemoryRoot === "string" ? meta.userMemoryRoot.trim() : "";
  if (userScopedRoot) return path.resolve(userScopedRoot);

  const defaultRoot =
    typeof meta?.defaultMemoryRoot === "string" ? meta.defaultMemoryRoot.trim() : "";
  if (defaultRoot) return path.resolve(defaultRoot);

  return path.resolve(fallbackRoot);
}

export function syncLayeredMemory(input: SyncLayeredMemoryInput): {
  sessionRollupPath: string;
  candidateRunPath: string;
  consolidatedCandidatesPath: string;
  memorySummaryPath: string;
  detailedMemoryPath: string;
  indexPath: string;
} {
  const memoryRoot = path.resolve(input.memoryRoot);
  const sessionId = sanitizeKey(input.sessionId || DEFAULT_SESSION_KEY);
  const rollup = buildSessionRollup({
    sessionId,
    prompt: input.prompt,
    resultText: input.resultText,
    messages: input.messages,
    toolCalls: input.toolCalls,
    requiredSkills: input.requiredSkills ?? [],
    model: input.model,
    extractedInsights: input.extractedInsights ?? [],
  });
  const rollupPaths = resolveSessionRollupPaths(memoryRoot, sessionId);
  fs.mkdirSync(rollupPaths.dir, { recursive: true });
  fs.writeFileSync(rollupPaths.jsonPath, `${JSON.stringify(rollup, null, 2)}\n`, "utf-8");
  fs.writeFileSync(rollupPaths.markdownPath, buildSessionRollupMarkdown(rollup), "utf-8");
  const candidateRunPath = writeCandidateRun(memoryRoot, rollup);
  const summaryArtifacts = syncMemorySummaryArtifacts(memoryRoot);
  return {
    sessionRollupPath: rollupPaths.jsonPath,
    candidateRunPath,
    consolidatedCandidatesPath: summaryArtifacts.consolidatedCandidatesPath,
    memorySummaryPath: summaryArtifacts.memorySummaryPath,
    detailedMemoryPath: summaryArtifacts.detailedMemoryPath,
    indexPath: summaryArtifacts.indexPath,
  };
}

export function syncMemorySummaryArtifacts(memoryRoot: string): {
  consolidatedCandidatesPath: string;
  memorySummaryPath: string;
  detailedMemoryPath: string;
  indexPath: string;
} {
  const artifacts = resolveMemoryArtifacts(memoryRoot);
  fs.mkdirSync(artifacts.root, { recursive: true });
  const noteStore = new MemoryStore(artifacts.root);
  const noteEntries = noteStore.list();
  const sessionRollups = listSessionRollups(artifacts.root, 12);
  const consolidatedCandidates = consolidateMemoryCandidates(artifacts.root);
  const updatedAt = new Date().toISOString();
  fs.writeFileSync(
    artifacts.memorySummaryPath,
    buildMemorySummaryMarkdown(noteEntries, sessionRollups, consolidatedCandidates, updatedAt),
    "utf-8",
  );
  fs.writeFileSync(
    artifacts.detailedMemoryPath,
    buildDetailedMemoryMarkdown(noteEntries, sessionRollups, consolidatedCandidates, updatedAt),
    "utf-8",
  );
  fs.writeFileSync(
    artifacts.indexPath,
    `${JSON.stringify(buildMemoryIndex(noteEntries, sessionRollups, consolidatedCandidates, updatedAt), null, 2)}\n`,
    "utf-8",
  );
  return {
    consolidatedCandidatesPath: artifacts.consolidatedCandidatesPath,
    memorySummaryPath: artifacts.memorySummaryPath,
    detailedMemoryPath: artifacts.detailedMemoryPath,
    indexPath: artifacts.indexPath,
  };
}

export function buildMemoryPromptFragment(input: MemoryPromptFragmentInput): string {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) return "";
  const memoryRoot = path.resolve(input.memoryRoot);
  const artifacts = syncMemorySummaryArtifacts(memoryRoot);
  const activeSessionId = sanitizeKey(input.sessionId || DEFAULT_SESSION_KEY);
  const activeSession = readSessionRollup(memoryRoot, activeSessionId);
  const consolidatedCandidates = readConsolidatedCandidates(memoryRoot);
  const relevantItems = searchLayeredMemory({
    memoryRoot,
    query: prompt,
    limit: input.maxRelevantItems ?? 4,
  }).filter((item) => item.kind !== "session_rollup" || item.sessionId !== activeSession?.sessionId);
  const recentSessions = listSessionRollups(memoryRoot, input.maxRecentSessions ?? 3)
    .filter((item) => item.sessionId !== activeSession?.sessionId);
  const summaryExcerpt = excerpt(readTextFile(artifacts.memorySummaryPath), 1200);
  const lines = [
    "## Persisted Memory",
    "仅把以下内容当作已验证的历史上下文使用；若与本轮用户要求、当前代码或工具结果冲突，必须显式指出冲突，不得静默沿用旧记忆。",
  ];

  if (activeSession) {
    lines.push("");
    lines.push("### Session Recall");
    lines.push(`- sessionId: ${activeSession.sessionId}`);
    lines.push(`- latestUserPrompt: ${activeSession.latestUserPrompt}`);
    lines.push(`- latestAssistantReply: ${activeSession.latestAssistantReply}`);
    if (activeSession.loadedSkills.length > 0) {
      lines.push(`- loadedSkills: ${activeSession.loadedSkills.join(", ")}`);
    }
    if (activeSession.latestRun.toolSummary.length > 0) {
      lines.push(`- latestToolUsage: ${activeSession.latestRun.toolSummary.join("; ")}`);
    }
    if (activeSession.latestRun.extractedInsights.length > 0) {
      lines.push(`- extractedInsights: ${activeSession.latestRun.extractedInsights.join(" | ")}`);
    }
  }

  if (relevantItems.length > 0) {
    lines.push("");
    lines.push("### Relevant Memory Hits");
    for (const item of relevantItems) {
      const tags = item.tags.length > 0 ? ` tags=${item.tags.join(",")}` : "";
      const scope = item.kind === "note" ? `[${item.store}]` : `[session:${item.sessionId}]`;
      lines.push(`- ${scope}${tags} :: ${excerpt(item.content, 220)}`);
    }
  }

  if (recentSessions.length > 0) {
    lines.push("");
    lines.push("### Recent Sessions");
    for (const session of recentSessions) {
      lines.push(
        `- ${session.sessionId}: ${excerpt(session.latestUserPrompt, 120)} => ${excerpt(session.latestAssistantReply, 120)}`,
      );
    }
  }

  if (consolidatedCandidates.length > 0) {
    lines.push("");
    lines.push("### Consolidated Patterns");
    for (const candidate of consolidatedCandidates.slice(0, 3)) {
      lines.push(`- ${candidate.title}: ${excerpt(candidate.content, 180)}`);
    }
  }

  if (summaryExcerpt) {
    lines.push("");
    lines.push("### Consolidated Summary");
    lines.push(summaryExcerpt);
  }

  return lines.join("\n").trim();
}

export function searchLayeredMemory(input: {
  memoryRoot: string;
  query: string;
  limit?: number;
  store?: MemoryStoreKind;
  includeArchived?: boolean;
}): LayeredMemorySearchResult[] {
  const query = String(input.query || "").trim();
  if (!query) {
    throw new Error("memory_search query 不能为空。");
  }
  const limit = clampLimit(input.limit ?? 5);
  const memoryRoot = path.resolve(input.memoryRoot);
  const noteStore = new MemoryStore(memoryRoot);
  const noteResults = noteStore
    .list({
      ...(input.store ? { store: input.store } : {}),
      ...(input.includeArchived ? { includeArchived: true } : {}),
    })
    .map((entry) => ({
      entry,
      relevance: scoreNoteForQuery(entry, query),
    }))
    .filter((item) => item.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || b.entry.updatedAt.localeCompare(a.entry.updatedAt));
  noteStore.markAccessed(noteResults.slice(0, limit).map((item) => item.entry.id));
  const layeredNotes = noteResults.map((entry) => ({
    id: entry.entry.id,
    kind: "note" as const,
    time: entry.entry.updatedAt,
    store: entry.entry.store,
    tags: [...entry.entry.tags],
    content: entry.entry.content,
    source: entry.entry.source,
    relevance: entry.relevance,
    archived: entry.entry.archived,
  }));
  const layeredSessions = input.store
    ? []
    : searchSessionRollups(memoryRoot, query, Math.max(limit * 2, limit)).map((item) => ({
        id: item.id,
        kind: "session_rollup" as const,
        time: item.time,
        store: "session_rollup" as const,
        tags: item.tags,
        content: item.content,
        source: item.source,
        relevance: item.relevance,
        archived: false,
        sessionId: item.sessionId,
        ...(item.filePath ? { filePath: item.filePath } : {}),
      }));
  const layeredCandidates = input.store
    ? []
    : searchConsolidatedCandidates(memoryRoot, query, Math.max(limit * 2, limit)).map((item) => ({
        id: item.id,
        kind: "consolidated_candidate" as const,
        time: item.time,
        store: "procedural_candidate" as const,
        tags: item.tags,
        content: item.content,
        source: item.source,
        relevance: item.relevance,
        archived: false,
        ...(item.filePath ? { filePath: item.filePath } : {}),
      }));
  return [...layeredNotes, ...layeredSessions, ...layeredCandidates]
    .sort((a, b) => b.relevance - a.relevance || b.time.localeCompare(a.time))
    .slice(0, limit);
}

function buildSessionRollup(input: {
  sessionId: string;
  prompt: string;
  resultText: string;
  messages: Message[];
  toolCalls: ToolCallTrace[];
  requiredSkills: string[];
  model?: string;
  extractedInsights?: string[];
}): SessionRollup {
  const updatedAt = new Date().toISOString();
  const recentUserPrompts = collectRecentMessages(input.messages, "user", 3);
  const recentAssistantReplies = collectRecentMessages(input.messages, "assistant", 3);
  const loadedSkills = collectLoadedSkills(input.messages);
  const successfulToolNames = uniqueStrings(
    input.toolCalls.filter((tool) => tool.status === "succeeded").map((tool) => tool.name),
  );
  const failedToolNames = uniqueStrings(
    input.toolCalls
      .filter((tool) => tool.status === "failed" || tool.status === "blocked" || tool.status === "denied")
      .map((tool) => tool.name),
  );
  return {
    version: SESSION_ROLLUP_VERSION,
    sessionId: input.sessionId,
    updatedAt,
    messageCount: input.messages.length,
    latestUserPrompt: recentUserPrompts[0] ?? excerpt(input.prompt, 220),
    latestAssistantReply: recentAssistantReplies[0] ?? excerpt(input.resultText, 220),
    recentUserPrompts,
    recentAssistantReplies,
    loadedSkills,
    latestRun: {
      prompt: excerpt(input.prompt, 400),
      resultPreview: excerpt(input.resultText, 400),
      completedAt: updatedAt,
      model: typeof input.model === "string" && input.model.trim() ? input.model.trim() : null,
      requiredSkills: uniqueStrings(input.requiredSkills),
      successfulToolNames,
      failedToolNames,
      toolSummary: summarizeToolUsage(input.toolCalls),
      extractedInsights: uniqueStrings(input.extractedInsights ?? []).slice(0, 4),
    },
  };
}

function writeCandidateRun(memoryRoot: string, rollup: SessionRollup): string {
  const artifacts = resolveMemoryArtifacts(memoryRoot);
  const sessionDir = path.join(artifacts.candidateRunsDir, rollup.sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  const stamp = toSafeTimestamp(rollup.updatedAt);
  const filePath = path.join(sessionDir, `${stamp}.json`);
  const candidates = buildCandidatesFromRollup(rollup);
  fs.writeFileSync(filePath, `${JSON.stringify(candidates, null, 2)}\n`, "utf-8");
  return filePath;
}

function buildCandidatesFromRollup(rollup: SessionRollup): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  const baseTags = uniqueStrings([
    `session:${rollup.sessionId}`,
    ...rollup.loadedSkills,
    ...rollup.latestRun.requiredSkills,
  ]);
  const sharedEvidence = {
    prompt: rollup.latestRun.prompt,
    resultPreview: rollup.latestRun.resultPreview,
    requiredSkills: [...rollup.latestRun.requiredSkills],
    loadedSkills: [...rollup.loadedSkills],
    successfulToolNames: [...rollup.latestRun.successfulToolNames],
    failedToolNames: [...rollup.latestRun.failedToolNames],
  };
  candidates.push({
    version: 1,
    id: `candidate:${rollup.sessionId}:run_outcome`,
    sessionId: rollup.sessionId,
    createdAt: rollup.updatedAt,
    category: "run_outcome",
    storeHint: "episodic",
    scope: "session",
    title: "Recent Run Outcome",
    content: [
      `session=${rollup.sessionId}`,
      `goal=${rollup.latestUserPrompt}`,
      `result=${rollup.latestAssistantReply}`,
    ].join(" | "),
    importance: 0.42,
    tags: uniqueStrings([...baseTags, "run-outcome", "episodic"]),
    evidence: sharedEvidence,
  });
  const runPathContent = buildRunPathContent(rollup);
  if (runPathContent) {
    candidates.push({
      version: 1,
      id: `candidate:${rollup.sessionId}:run_path`,
      sessionId: rollup.sessionId,
      createdAt: rollup.updatedAt,
      category: "run_path",
      storeHint: "procedural",
      scope: "cross_session",
      title: "Observed Run Path",
      content: runPathContent,
      importance: rollup.latestRun.failedToolNames.length > 0 ? 0.48 : 0.58,
      tags: uniqueStrings([...baseTags, "run-path", "procedural"]),
      evidence: sharedEvidence,
    });
  }
  return candidates;
}

function buildRunPathContent(rollup: SessionRollup): string {
  const parts: string[] = [];
  if (rollup.loadedSkills.length > 0) {
    parts.push(`skills=${rollup.loadedSkills.join(", ")}`);
  }
  if (rollup.latestRun.requiredSkills.length > 0) {
    parts.push(`requiredSkills=${rollup.latestRun.requiredSkills.join(", ")}`);
  }
  if (rollup.latestRun.successfulToolNames.length > 0) {
    parts.push(`successfulTools=${rollup.latestRun.successfulToolNames.join(", ")}`);
  }
  if (rollup.latestRun.failedToolNames.length > 0) {
    parts.push(`failedTools=${rollup.latestRun.failedToolNames.join(", ")}`);
  }
  if (parts.length === 0) return "";
  return [
    `For runs similar to "${excerpt(rollup.latestUserPrompt, 120)}",`,
    ...parts,
  ].join(" ");
}

function resolveMemoryArtifacts(memoryRoot: string): MemoryArtifactPaths {
  const root = path.resolve(memoryRoot);
  return {
    root,
    sessionRollupsDir: path.join(root, "session-rollups"),
    candidateRunsDir: path.join(root, "memory-candidates", "runs"),
    consolidatedCandidatesPath: path.join(root, "memory-candidates", "consolidated.json"),
    consolidatedCandidatesMarkdownPath: path.join(root, "memory-candidates", "consolidated.md"),
    memorySummaryPath: path.join(root, "memory_summary.md"),
    detailedMemoryPath: path.join(root, "MEMORY.md"),
    indexPath: path.join(root, "index.json"),
  };
}

function resolveSessionRollupPaths(memoryRoot: string, sessionId: string): SessionRollupPaths {
  const artifacts = resolveMemoryArtifacts(memoryRoot);
  return {
    dir: artifacts.sessionRollupsDir,
    jsonPath: path.join(artifacts.sessionRollupsDir, `${sessionId}.json`),
    markdownPath: path.join(artifacts.sessionRollupsDir, `${sessionId}.md`),
  };
}

function readSessionRollup(memoryRoot: string, sessionId: string): SessionRollup | null {
  const rollupPaths = resolveSessionRollupPaths(memoryRoot, sessionId);
  if (!fs.existsSync(rollupPaths.jsonPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(rollupPaths.jsonPath, "utf-8")) as unknown;
    return normalizeSessionRollup(parsed);
  } catch {
    return null;
  }
}

function listSessionRollups(memoryRoot: string, limit: number): SessionRollup[] {
  const artifacts = resolveMemoryArtifacts(memoryRoot);
  if (!fs.existsSync(artifacts.sessionRollupsDir)) return [];
  const entries = fs.readdirSync(artifacts.sessionRollupsDir, { withFileTypes: true });
  const out: SessionRollup[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const fullPath = path.join(artifacts.sessionRollupsDir, entry.name);
    try {
      const parsed = JSON.parse(fs.readFileSync(fullPath, "utf-8")) as unknown;
      const rollup = normalizeSessionRollup(parsed);
      if (rollup) out.push(rollup);
    } catch {
      // Rollups are derived artifacts; ignore malformed files and let later sync overwrite them.
    }
  }
  return out
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, Math.max(1, Math.min(limit, 24)));
}

function searchSessionRollups(
  memoryRoot: string,
  query: string,
  limit: number,
): Array<{
  id: string;
  sessionId: string;
  time: string;
  tags: string[];
  content: string;
  source: string;
  relevance: number;
  filePath: string;
}> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];
  const artifacts = resolveMemoryArtifacts(memoryRoot);
  const rollups = listSessionRollups(memoryRoot, 24);
  return rollups
    .map((rollup) => {
      const content = buildSessionSearchText(rollup);
      return {
        id: `session:${rollup.sessionId}`,
        sessionId: rollup.sessionId,
        time: rollup.updatedAt,
        tags: ["session", ...rollup.loadedSkills],
        content,
        source: "session_rollup",
        relevance: scoreText(content, normalizedQuery),
        filePath: path.join(artifacts.sessionRollupsDir, `${rollup.sessionId}.json`),
      };
    })
    .filter((item) => item.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || b.time.localeCompare(a.time))
    .slice(0, Math.max(1, Math.min(limit, 24)));
}

function readCandidateRuns(memoryRoot: string): MemoryCandidate[] {
  const artifacts = resolveMemoryArtifacts(memoryRoot);
  if (!fs.existsSync(artifacts.candidateRunsDir)) return [];
  const sessionEntries = fs.readdirSync(artifacts.candidateRunsDir, { withFileTypes: true });
  const candidates: MemoryCandidate[] = [];
  for (const sessionEntry of sessionEntries) {
    if (!sessionEntry.isDirectory()) continue;
    const sessionDir = path.join(artifacts.candidateRunsDir, sessionEntry.name);
    const files = fs.readdirSync(sessionDir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      const filePath = path.join(sessionDir, file.name);
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
        const normalized = normalizeCandidates(parsed);
        candidates.push(...normalized);
      } catch {
        // Candidate runs are derived artifacts; ignore malformed files and let future runs overwrite.
      }
    }
  }
  return candidates.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function consolidateMemoryCandidates(memoryRoot: string): ConsolidatedMemoryCandidate[] {
  const artifacts = resolveMemoryArtifacts(memoryRoot);
  const grouped = new Map<string, ConsolidatedMemoryCandidate>();
  for (const candidate of readCandidateRuns(memoryRoot)) {
    if (candidate.scope !== "cross_session" || candidate.storeHint !== "procedural") continue;
    const key = fingerprintCandidate(candidate);
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        version: 1,
        id: key,
        category: "run_path",
        storeHint: "procedural",
        title: candidate.title,
        content: candidate.content,
        tags: [...candidate.tags],
        importance: candidate.importance,
        firstSeenAt: candidate.createdAt,
        lastSeenAt: candidate.createdAt,
        occurrenceCount: 1,
        sessionIds: [candidate.sessionId],
      });
      continue;
    }
    current.firstSeenAt = current.firstSeenAt.localeCompare(candidate.createdAt) <= 0
      ? current.firstSeenAt
      : candidate.createdAt;
    current.lastSeenAt = current.lastSeenAt.localeCompare(candidate.createdAt) >= 0
      ? current.lastSeenAt
      : candidate.createdAt;
    current.occurrenceCount += 1;
    current.sessionIds = uniqueStrings([...current.sessionIds, candidate.sessionId]);
    current.tags = uniqueStrings([...current.tags, ...candidate.tags]);
    current.importance = Number(
      Math.max(current.importance, candidate.importance, 0.3 + Math.min(current.occurrenceCount, 4) * 0.1).toFixed(3),
    );
  }
  const consolidated = Array.from(grouped.values())
    .sort((a, b) => {
      if (b.occurrenceCount !== a.occurrenceCount) return b.occurrenceCount - a.occurrenceCount;
      return b.lastSeenAt.localeCompare(a.lastSeenAt);
    })
    .slice(0, 24);
  fs.mkdirSync(path.dirname(artifacts.consolidatedCandidatesPath), { recursive: true });
  fs.writeFileSync(
    artifacts.consolidatedCandidatesPath,
    `${JSON.stringify(consolidated, null, 2)}\n`,
    "utf-8",
  );
  fs.writeFileSync(
    artifacts.consolidatedCandidatesMarkdownPath,
    buildConsolidatedCandidatesMarkdown(consolidated),
    "utf-8",
  );
  return consolidated;
}

function readConsolidatedCandidates(memoryRoot: string): ConsolidatedMemoryCandidate[] {
  const artifacts = resolveMemoryArtifacts(memoryRoot);
  if (!fs.existsSync(artifacts.consolidatedCandidatesPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(artifacts.consolidatedCandidatesPath, "utf-8")) as unknown;
    return normalizeConsolidatedCandidates(parsed);
  } catch {
    return [];
  }
}

function searchConsolidatedCandidates(
  memoryRoot: string,
  query: string,
  limit: number,
): Array<{
  id: string;
  time: string;
  tags: string[];
  content: string;
  source: string;
  relevance: number;
  filePath: string;
}> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];
  const artifacts = resolveMemoryArtifacts(memoryRoot);
  return readConsolidatedCandidates(memoryRoot)
    .map((candidate) => ({
      id: candidate.id,
      time: candidate.lastSeenAt,
      tags: candidate.tags,
      content: candidate.content,
      source: "consolidated_candidate",
      relevance: scoreText([candidate.title, candidate.content, ...candidate.tags].join("\n"), normalizedQuery)
        + candidate.importance,
      filePath: artifacts.consolidatedCandidatesPath,
    }))
    .filter((candidate) => candidate.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || b.time.localeCompare(a.time))
    .slice(0, Math.max(1, Math.min(limit, 24)));
}

function buildMemorySummaryMarkdown(
  noteEntries: MemoryEntry[],
  sessionRollups: SessionRollup[],
  consolidatedCandidates: ConsolidatedMemoryCandidate[],
  updatedAt: string,
): string {
  const coreEntries = pickTopNotes(noteEntries, ["vault", "core"], 6);
  const reusableEntries = pickTopNotes(noteEntries, ["procedural", "semantic"], 6);
  const candidatePatterns = consolidatedCandidates.slice(0, 4);
  const recentSessions = sessionRollups.slice(0, 3);
  return [
    "# Runtime Memory Summary",
    "",
    `- updatedAt: ${updatedAt}`,
    `- noteCount: ${noteEntries.length}`,
    `- sessionRollupCount: ${sessionRollups.length}`,
    `- consolidatedCandidateCount: ${consolidatedCandidates.length}`,
    "",
    "## Core Constraints",
    ...(coreEntries.length > 0
      ? coreEntries.map((entry) => formatNoteBullet(entry, 200))
      : ["- (none)"]),
    "",
    "## Reusable Knowledge",
    ...(reusableEntries.length > 0
      ? reusableEntries.map((entry) => formatNoteBullet(entry, 180))
      : ["- (none)"]),
    "",
    "## Consolidated Patterns",
    ...(candidatePatterns.length > 0
      ? candidatePatterns.map(
          (candidate) =>
            `- ${candidate.title} [count=${candidate.occurrenceCount}] :: ${excerpt(candidate.content, 180)}`,
        )
      : ["- (none)"]),
    "",
    "## Recent Sessions",
    ...(recentSessions.length > 0
      ? recentSessions.map(
          (session) =>
            `- ${session.sessionId}: ${excerpt(session.latestUserPrompt, 110)} => ${excerpt(session.latestAssistantReply, 110)}`,
        )
      : ["- (none)"]),
    "",
  ].join("\n");
}

function buildDetailedMemoryMarkdown(
  noteEntries: MemoryEntry[],
  sessionRollups: SessionRollup[],
  consolidatedCandidates: ConsolidatedMemoryCandidate[],
  updatedAt: string,
): string {
  const grouped = groupNotesByStore(noteEntries);
  return [
    "# MEMORY",
    "",
    `- updatedAt: ${updatedAt}`,
    "",
    "## Notes By Store",
    ...(["vault", "core", "procedural", "semantic", "episodic"] as MemoryStoreKind[]).flatMap((store) => {
      const entries = grouped.get(store) ?? [];
      return [
        "",
        `### ${store}`,
        ...(entries.length > 0
          ? entries.map((entry) => formatNoteBullet(entry, 260))
          : ["- (none)"]),
      ];
    }),
    "",
    "## Consolidated Candidates",
    ...(consolidatedCandidates.length > 0
      ? consolidatedCandidates.map((candidate) =>
          [
            `### ${candidate.title}`,
            `- count: ${candidate.occurrenceCount}`,
            `- firstSeenAt: ${candidate.firstSeenAt}`,
            `- lastSeenAt: ${candidate.lastSeenAt}`,
            `- content: ${candidate.content}`,
          ].join("\n"),
        )
      : ["- (none)"]),
    "",
    "## Session Rollups",
    ...(sessionRollups.length > 0
      ? sessionRollups.map((session) => {
          const lines = [
            `### ${session.sessionId}`,
            `- updatedAt: ${session.updatedAt}`,
            `- latestUserPrompt: ${session.latestUserPrompt}`,
            `- latestAssistantReply: ${session.latestAssistantReply}`,
          ];
          if (session.loadedSkills.length > 0) {
            lines.push(`- loadedSkills: ${session.loadedSkills.join(", ")}`);
          }
          if (session.latestRun.toolSummary.length > 0) {
            lines.push(`- toolUsage: ${session.latestRun.toolSummary.join("; ")}`);
          }
          if (session.latestRun.extractedInsights.length > 0) {
            lines.push(`- extractedInsights: ${session.latestRun.extractedInsights.join(" | ")}`);
          }
          return lines.join("\n");
        })
      : ["- (none)"]),
    "",
  ].join("\n");
}

function buildMemoryIndex(
  noteEntries: MemoryEntry[],
  sessionRollups: SessionRollup[],
  consolidatedCandidates: ConsolidatedMemoryCandidate[],
  updatedAt: string,
): {
  version: number;
  updatedAt: string;
  notes: {
    total: number;
    byStore: Record<MemoryStoreKind, number>;
  };
  sessions: Array<{
    sessionId: string;
    updatedAt: string;
    latestUserPrompt: string;
    latestAssistantReply: string;
  }>;
  consolidatedCandidates: Array<{
    id: string;
    title: string;
    occurrenceCount: number;
    lastSeenAt: string;
  }>;
  artifacts: {
    summary: string;
    detailed: string;
    sessionRollups: string;
    candidateRuns: string;
    consolidatedCandidates: string;
  };
} {
  const byStore = noteEntries.reduce<Record<MemoryStoreKind, number>>(
    (acc, entry) => {
      acc[entry.store] += 1;
      return acc;
    },
    {
      core: 0,
      episodic: 0,
      semantic: 0,
      procedural: 0,
      vault: 0,
    },
  );
  return {
    version: 1,
    updatedAt,
    notes: {
      total: noteEntries.length,
      byStore,
    },
    sessions: sessionRollups.slice(0, 8).map((session) => ({
      sessionId: session.sessionId,
      updatedAt: session.updatedAt,
      latestUserPrompt: session.latestUserPrompt,
      latestAssistantReply: session.latestAssistantReply,
    })),
    consolidatedCandidates: consolidatedCandidates.slice(0, 8).map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      occurrenceCount: candidate.occurrenceCount,
      lastSeenAt: candidate.lastSeenAt,
    })),
    artifacts: {
      summary: "memory_summary.md",
      detailed: "MEMORY.md",
      sessionRollups: "session-rollups",
      candidateRuns: "memory-candidates/runs",
      consolidatedCandidates: "memory-candidates/consolidated.json",
    },
  };
}

function normalizeSessionRollup(raw: unknown): SessionRollup | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const sessionId = sanitizeKey(String(record.sessionId || ""));
  if (!sessionId) return null;
  const updatedAt =
    typeof record.updatedAt === "string" && record.updatedAt.trim()
      ? record.updatedAt.trim()
      : new Date().toISOString();
  const recentUserPrompts = normalizeStringArray(record.recentUserPrompts, 3, 220);
  const recentAssistantReplies = normalizeStringArray(record.recentAssistantReplies, 3, 220);
  const loadedSkills = normalizeStringArray(record.loadedSkills, 8, 80);
  const latestRunRecord =
    record.latestRun && typeof record.latestRun === "object" && !Array.isArray(record.latestRun)
      ? (record.latestRun as Record<string, unknown>)
      : {};
  return {
    version: SESSION_ROLLUP_VERSION,
    sessionId,
    updatedAt,
    messageCount: normalizeInteger(record.messageCount, 0),
    latestUserPrompt:
      typeof record.latestUserPrompt === "string" && record.latestUserPrompt.trim()
        ? record.latestUserPrompt.trim()
        : recentUserPrompts[0] ?? "",
    latestAssistantReply:
      typeof record.latestAssistantReply === "string" && record.latestAssistantReply.trim()
        ? record.latestAssistantReply.trim()
        : recentAssistantReplies[0] ?? "",
    recentUserPrompts,
    recentAssistantReplies,
    loadedSkills,
    latestRun: {
      prompt:
        typeof latestRunRecord.prompt === "string" && latestRunRecord.prompt.trim()
          ? latestRunRecord.prompt.trim()
          : "",
      resultPreview:
        typeof latestRunRecord.resultPreview === "string" && latestRunRecord.resultPreview.trim()
          ? latestRunRecord.resultPreview.trim()
          : "",
      completedAt:
        typeof latestRunRecord.completedAt === "string" && latestRunRecord.completedAt.trim()
          ? latestRunRecord.completedAt.trim()
          : updatedAt,
      model:
        typeof latestRunRecord.model === "string" && latestRunRecord.model.trim()
          ? latestRunRecord.model.trim()
          : null,
      requiredSkills: normalizeStringArray(latestRunRecord.requiredSkills, 8, 80),
      successfulToolNames: normalizeStringArray(latestRunRecord.successfulToolNames, 12, 80),
      failedToolNames: normalizeStringArray(latestRunRecord.failedToolNames, 12, 80),
      toolSummary: normalizeStringArray(latestRunRecord.toolSummary, 12, 120),
      extractedInsights: normalizeStringArray(latestRunRecord.extractedInsights, 4, 160),
    },
  };
}

function buildSessionRollupMarkdown(rollup: SessionRollup): string {
  return [
    `# Session Rollup ${rollup.sessionId}`,
    "",
    `- updatedAt: ${rollup.updatedAt}`,
    `- messageCount: ${rollup.messageCount}`,
    "",
    "## Latest Run",
    `- prompt: ${rollup.latestRun.prompt || "(none)"}`,
    `- result: ${rollup.latestRun.resultPreview || "(none)"}`,
    `- model: ${rollup.latestRun.model || "(none)"}`,
    ...(rollup.latestRun.requiredSkills.length > 0
      ? [`- requiredSkills: ${rollup.latestRun.requiredSkills.join(", ")}`]
      : []),
    ...(rollup.latestRun.toolSummary.length > 0
      ? [`- toolUsage: ${rollup.latestRun.toolSummary.join("; ")}`]
      : []),
    ...(rollup.latestRun.extractedInsights.length > 0
      ? [`- extractedInsights: ${rollup.latestRun.extractedInsights.join(" | ")}`]
      : []),
    "",
    "## Recent User Prompts",
    ...(rollup.recentUserPrompts.length > 0 ? rollup.recentUserPrompts.map((item) => `- ${item}`) : ["- (none)"]),
    "",
    "## Recent Assistant Replies",
    ...(rollup.recentAssistantReplies.length > 0
      ? rollup.recentAssistantReplies.map((item) => `- ${item}`)
      : ["- (none)"]),
    "",
  ].join("\n");
}

function buildSessionSearchText(rollup: SessionRollup): string {
  return [
    rollup.sessionId,
    rollup.latestUserPrompt,
    rollup.latestAssistantReply,
    ...rollup.recentUserPrompts,
    ...rollup.recentAssistantReplies,
    ...rollup.loadedSkills,
    rollup.latestRun.prompt,
    rollup.latestRun.resultPreview,
    ...rollup.latestRun.toolSummary,
    ...rollup.latestRun.extractedInsights,
  ]
    .filter(Boolean)
    .join("\n");
}

function collectRecentMessages(messages: Message[], role: Message["role"], limit: number): string[] {
  const out: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== role) continue;
    const content = excerpt(String(message.content || ""), 220);
    if (!content) continue;
    out.push(content);
    if (out.length >= limit) break;
  }
  return out;
}

function collectLoadedSkills(messages: Message[]): string[] {
  const loaded = new Set<string>();
  for (const message of messages) {
    const content = String(message?.content || "");
    if (!content) continue;
    const pattern = /<skill-loaded\s+name="([^"]+)">/gi;
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(content))) {
      const name = String(match[1] || "").trim();
      if (name) loaded.add(name);
    }
  }
  return Array.from(loaded);
}

function summarizeToolUsage(toolCalls: ToolCallTrace[]): string[] {
  const summary = new Map<string, { succeeded: number; failed: number; denied: number; blocked: number }>();
  for (const toolCall of toolCalls) {
    const key = String(toolCall.name || "").trim();
    if (!key) continue;
    const current = summary.get(key) ?? { succeeded: 0, failed: 0, denied: 0, blocked: 0 };
    current[toolCall.status] += 1;
    summary.set(key, current);
  }
  return Array.from(summary.entries()).map(([name, counts]) => {
    const parts = [
      counts.succeeded > 0 ? `ok=${counts.succeeded}` : "",
      counts.failed > 0 ? `failed=${counts.failed}` : "",
      counts.denied > 0 ? `denied=${counts.denied}` : "",
      counts.blocked > 0 ? `blocked=${counts.blocked}` : "",
    ].filter(Boolean);
    return parts.length > 0 ? `${name}(${parts.join(",")})` : name;
  });
}

function pickTopNotes(
  noteEntries: MemoryEntry[],
  stores: MemoryStoreKind[],
  limit: number,
): MemoryEntry[] {
  const allowedStores = new Set(stores);
  return noteEntries
    .filter((entry) => allowedStores.has(entry.store))
    .sort((a, b) => b.decayScore - a.decayScore || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

function groupNotesByStore(noteEntries: MemoryEntry[]): Map<MemoryStoreKind, MemoryEntry[]> {
  const grouped = new Map<MemoryStoreKind, MemoryEntry[]>();
  for (const entry of noteEntries) {
    const bucket = grouped.get(entry.store) ?? [];
    bucket.push(entry);
    grouped.set(entry.store, bucket);
  }
  for (const [store, entries] of grouped.entries()) {
    grouped.set(
      store,
      [...entries].sort((a, b) => b.decayScore - a.decayScore || b.updatedAt.localeCompare(a.updatedAt)),
    );
  }
  return grouped;
}

function formatNoteBullet(entry: MemoryEntry, maxChars: number): string {
  const tags = entry.tags.length > 0 ? ` tags=${entry.tags.join(",")}` : "";
  return `- [${entry.store}]${tags} :: ${excerpt(entry.content, maxChars)}`;
}

function buildConsolidatedCandidatesMarkdown(candidates: ConsolidatedMemoryCandidate[]): string {
  return [
    "# Consolidated Memory Candidates",
    "",
    ...(candidates.length > 0
      ? candidates.flatMap((candidate) => [
          `## ${candidate.title}`,
          `- count: ${candidate.occurrenceCount}`,
          `- firstSeenAt: ${candidate.firstSeenAt}`,
          `- lastSeenAt: ${candidate.lastSeenAt}`,
          `- tags: ${candidate.tags.join(", ") || "(none)"}`,
          `- content: ${candidate.content}`,
          "",
        ])
      : ["- (none)", ""]),
  ].join("\n");
}

function scoreNoteForQuery(entry: MemoryEntry, query: string): number {
  return scoreText([entry.content, ...entry.tags].join("\n"), query) + entry.decayScore;
}

function scoreText(content: string, query: string): number {
  const normalizedContent = content.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedContent || !normalizedQuery) return 0;
  let score = 0;
  if (normalizedContent.includes(normalizedQuery)) score += 2;
  for (const term of normalizedQuery.split(/\s+/).filter(Boolean)) {
    if (normalizedContent.includes(term)) score += 0.35;
  }
  return Number(score.toFixed(6));
}

function normalizeStringArray(value: unknown, limit: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => excerpt(String(item || ""), maxChars))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeCandidates(raw: unknown): MemoryCandidate[] {
  if (!Array.isArray(raw)) return [];
  const out: MemoryCandidate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const category = record.category === "run_path" ? "run_path" : record.category === "run_outcome" ? "run_outcome" : "";
    const storeHint = record.storeHint === "procedural" ? "procedural" : record.storeHint === "episodic" ? "episodic" : "";
    const scope = record.scope === "cross_session" ? "cross_session" : record.scope === "session" ? "session" : "";
    if (!category || !storeHint || !scope) continue;
    const evidenceRecord =
      record.evidence && typeof record.evidence === "object" && !Array.isArray(record.evidence)
        ? (record.evidence as Record<string, unknown>)
        : {};
    out.push({
      version: 1,
      id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `candidate:${createFingerprintSeed(record)}`,
      sessionId: sanitizeKey(String(record.sessionId || "")),
      createdAt: typeof record.createdAt === "string" && record.createdAt.trim() ? record.createdAt.trim() : new Date().toISOString(),
      category,
      storeHint,
      scope,
      title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : "Candidate",
      content: typeof record.content === "string" ? excerpt(record.content, 400) : "",
      importance: normalizeImportance(record.importance),
      tags: normalizeStringArray(record.tags, 16, 80),
      evidence: {
        prompt: typeof evidenceRecord.prompt === "string" ? excerpt(evidenceRecord.prompt, 240) : "",
        resultPreview: typeof evidenceRecord.resultPreview === "string" ? excerpt(evidenceRecord.resultPreview, 240) : "",
        requiredSkills: normalizeStringArray(evidenceRecord.requiredSkills, 8, 80),
        loadedSkills: normalizeStringArray(evidenceRecord.loadedSkills, 8, 80),
        successfulToolNames: normalizeStringArray(evidenceRecord.successfulToolNames, 12, 80),
        failedToolNames: normalizeStringArray(evidenceRecord.failedToolNames, 12, 80),
      },
    });
  }
  return out.filter((candidate) => candidate.sessionId && candidate.content);
}

function normalizeConsolidatedCandidates(raw: unknown): ConsolidatedMemoryCandidate[] {
  if (!Array.isArray(raw)) return [];
  const out: ConsolidatedMemoryCandidate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    out.push({
      version: 1,
      id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `consolidated:${createFingerprintSeed(record)}`,
      category: "run_path",
      storeHint: "procedural",
      title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : "Observed Run Path",
      content: typeof record.content === "string" ? excerpt(record.content, 400) : "",
      tags: normalizeStringArray(record.tags, 20, 80),
      importance: normalizeImportance(record.importance),
      firstSeenAt:
        typeof record.firstSeenAt === "string" && record.firstSeenAt.trim()
          ? record.firstSeenAt.trim()
          : new Date().toISOString(),
      lastSeenAt:
        typeof record.lastSeenAt === "string" && record.lastSeenAt.trim()
          ? record.lastSeenAt.trim()
          : new Date().toISOString(),
      occurrenceCount: Math.max(1, normalizeInteger(record.occurrenceCount, 1)),
      sessionIds: normalizeStringArray(record.sessionIds, 24, 80),
    });
  }
  return out.filter((candidate) => candidate.content);
}

function normalizeInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.trunc(numeric));
}

function normalizeImportance(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return Number(Math.min(1, Math.max(0, numeric)).toFixed(3));
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function sanitizeKey(key: string): string {
  const trimmed = String(key || "").trim();
  if (!trimmed) return DEFAULT_SESSION_KEY;
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128);
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 5;
  return Math.max(1, Math.min(20, Math.trunc(limit)));
}

function fingerprintCandidate(candidate: MemoryCandidate): string {
  return `consolidated:${createHash("sha1")
    .update(
      JSON.stringify({
        category: candidate.category,
        storeHint: candidate.storeHint,
        content: candidate.content.toLowerCase(),
      }),
    )
    .digest("hex")
    .slice(0, 16)}`;
}

function createFingerprintSeed(value: Record<string, unknown>): string {
  return createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function toSafeTimestamp(iso: string): string {
  return String(iso || new Date().toISOString()).replace(/[:.]/g, "-");
}

function excerpt(input: string, max = 180): string {
  const cleaned = String(input || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, Math.max(0, max - 3))}...`;
}

function readTextFile(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  try {
    return fs.readFileSync(filePath, "utf-8").trim();
  } catch {
    return "";
  }
}
