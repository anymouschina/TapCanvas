import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type MemoryStoreKind = "core" | "episodic" | "semantic" | "procedural" | "vault";

export type MemoryEntry = {
  id: string;
  time: string;
  updatedAt: string;
  lastAccessedAt: string;
  accessCount: number;
  tags: string[];
  content: string;
  store: MemoryStoreKind;
  source: string;
  importance: number;
  decayScore: number;
  archived: boolean;
};

export type MemorySaveOptions = {
  store?: MemoryStoreKind;
  source?: string;
  importance?: number;
};

export type MemorySearchOptions = {
  limit?: number;
  store?: MemoryStoreKind;
  includeArchived?: boolean;
};

export type MemoryListOptions = {
  store?: MemoryStoreKind;
  includeArchived?: boolean;
};

export type MemoryForgetResult = {
  count: number;
  ids: string[];
};

export type ReflectionPrepareOptions = {
  query?: string;
  limit?: number;
  minDecayScore?: number;
  requestedTokens?: number;
  extraTokens?: number;
  penaltyTokens?: number;
  extraReason?: string;
  penaltyReason?: string;
};

export type ReflectionDecision = "approved" | "reduced" | "rejected";

export type ReflectionPrepareResult = {
  reflectionId: string;
  pendingPath: string;
  pendingMarkdownPath: string;
  request: {
    baselineTokens: number;
    extraTokens: number;
    penaltyTokens: number;
    requestedTokens: number;
    extraReason: string;
    penaltyReason: string;
  };
  scope: {
    totalCandidates: number;
    selectedCount: number;
    query: string;
    minDecayScore: number;
  };
  summary: string;
  preview: Array<{
    id: string;
    store: MemoryStoreKind;
    tags: string[];
    snippet: string;
    decayScore: number;
  }>;
};

export type ReflectionCommitOptions = {
  reflectionId: string;
  decision: ReflectionDecision;
  approvedTokens: number;
  reason: string;
};

export type ReflectionCommitResult = {
  reflectionId: string;
  decision: ReflectionDecision;
  approvedTokens: number;
  reflectionPath?: string;
  rewardPath: string;
  reflectionLogPath?: string;
  rewardLogPath: string;
};

const DECAY_WEIGHTS: Record<MemoryStoreKind, number> = {
  core: 1.5,
  episodic: 0.8,
  semantic: 1.2,
  procedural: 1.0,
  vault: 10,
};

export class MemoryStore {
  constructor(private baseDir: string) {}

  private ensureDir() {
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  private filePath() {
    return path.join(this.baseDir, "notes.jsonl");
  }

  private metaDir() {
    return path.join(this.baseDir, "meta");
  }

  private reflectionsDir() {
    return path.join(this.metaDir(), "reflections");
  }

  private rewardsDir() {
    return path.join(this.metaDir(), "rewards");
  }

  private pendingReflectionJsonPath() {
    return path.join(this.metaDir(), "pending-reflection.json");
  }

  private pendingReflectionMdPath() {
    return path.join(this.metaDir(), "pending-reflection.md");
  }

  private reflectionLogPath() {
    return path.join(this.metaDir(), "reflection-log.md");
  }

  private rewardLogPath() {
    return path.join(this.metaDir(), "reward-log.md");
  }

  private decayScoresPath() {
    return path.join(this.metaDir(), "decay-scores.json");
  }

  private readEntries() {
    this.ensureDir();
    const file = this.filePath();
    if (!fs.existsSync(file)) return [] as MemoryEntry[];
    const lines = fs.readFileSync(file, "utf-8").split("\n").filter(Boolean);
    const entries: MemoryEntry[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as unknown;
        const normalized = normalizeEntry(parsed);
        if (normalized) entries.push(normalized);
      } catch {
        // Skip malformed lines to keep memory store resilient.
      }
    }
    return entries;
  }

  private writeEntries(entries: MemoryEntry[]) {
    this.ensureDir();
    const file = this.filePath();
    const tmp = `${file}.tmp`;
    const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
    fs.writeFileSync(tmp, body ? `${body}\n` : "", "utf-8");
    fs.renameSync(tmp, file);
  }

  private ensureReflectionDirs() {
    this.ensureDir();
    fs.mkdirSync(this.metaDir(), { recursive: true });
    fs.mkdirSync(this.reflectionsDir(), { recursive: true });
    fs.mkdirSync(this.rewardsDir(), { recursive: true });
  }

  async save(content: string, tags: string[], options: MemorySaveOptions = {}) {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("memory_save content 不能为空。");
    }
    const normalizedTags = normalizeTags(tags);
    const store = normalizeStoreKind(options.store);
    const now = new Date().toISOString();
    this.ensureDir();
    const entry: MemoryEntry = {
      id: randomUUID(),
      time: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      tags: normalizedTags,
      content: trimmed,
      store,
      source: typeof options.source === "string" && options.source.trim()
        ? options.source.trim()
        : "manual",
      importance: clampImportance(options.importance),
      decayScore: computeDecayScore({
        store,
        importance: clampImportance(options.importance),
        accessCount: 0,
        lastAccessedAt: now,
      }),
      archived: false,
    };
    fs.appendFileSync(this.filePath(), `${JSON.stringify(entry)}\n`, "utf-8");
    return entry;
  }

  list(options: MemoryListOptions = {}) {
    const includeArchived = options.includeArchived === true;
    const requestedStore = options.store ? normalizeStoreKind(options.store) : null;
    return this.readEntries()
      .filter((entry) => (requestedStore ? entry.store === requestedStore : true))
      .filter((entry) => (includeArchived ? true : !entry.archived))
      .sort((a, b) => b.decayScore - a.decayScore || b.updatedAt.localeCompare(a.updatedAt));
  }

  markAccessed(ids: string[]) {
    const uniqueIds = new Set(ids.map((id) => String(id || "").trim()).filter(Boolean));
    if (uniqueIds.size === 0) return;
    const entries = this.readEntries();
    const now = new Date().toISOString();
    let changed = false;
    const updated = entries.map((entry) => {
      if (!uniqueIds.has(entry.id)) return entry;
      changed = true;
      const accessCount = entry.accessCount + 1;
      return {
        ...entry,
        accessCount,
        lastAccessedAt: now,
        updatedAt: now,
        decayScore: computeDecayScore({
          store: entry.store,
          importance: entry.importance,
          accessCount,
          lastAccessedAt: now,
        }),
      };
    });
    if (changed) {
      this.writeEntries(updated);
    }
  }

  async search(query: string, options: MemorySearchOptions = {}) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      throw new Error("memory_search query 不能为空。");
    }
    const normalizedQuery = trimmedQuery.toLowerCase();
    const limit = clampLimit(options.limit);
    const requestedStore = normalizeStoreKind(options.store);
    const includeArchived = options.includeArchived === true;
    const entries = this.readEntries();
    const scored = entries
      .filter((entry) => (options.store ? entry.store === requestedStore : true))
      .filter((entry) => (includeArchived ? true : !entry.archived))
      .map((entry) => ({ entry, score: scoreEntry(entry, normalizedQuery) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.time.localeCompare(a.entry.time));
    const selected = scored.slice(0, limit).map((item) => item.entry);
    if (selected.length > 0) {
      const now = new Date().toISOString();
      const selectedIds = new Set(selected.map((item) => item.id));
      const updated = entries.map((entry) => {
        if (!selectedIds.has(entry.id)) return entry;
        const accessCount = entry.accessCount + 1;
        return {
          ...entry,
          accessCount,
          lastAccessedAt: now,
          updatedAt: now,
          decayScore: computeDecayScore({
            store: entry.store,
            importance: entry.importance,
            accessCount,
            lastAccessedAt: now,
          }),
        };
      });
      this.writeEntries(updated);
    }
    return selected;
  }

  async forget(target: { id?: string; query?: string }) {
    const id = typeof target.id === "string" ? target.id.trim() : "";
    const query = typeof target.query === "string" ? target.query.trim().toLowerCase() : "";
    if (!id && !query) {
      throw new Error("memory_forget 需要 id 或 query。");
    }
    const entries = this.readEntries();
    const now = new Date().toISOString();
    const forgottenIds: string[] = [];
    const updated = entries.map((entry) => {
      const matchedById = id ? entry.id === id : false;
      const matchedByQuery = query
        ? entry.content.toLowerCase().includes(query) ||
          entry.tags.some((tag) => tag.toLowerCase().includes(query))
        : false;
      if (!matchedById && !matchedByQuery) return entry;
      forgottenIds.push(entry.id);
      return {
        ...entry,
        archived: true,
        decayScore: 0,
        updatedAt: now,
      };
    });
    if (forgottenIds.length > 0) {
      this.writeEntries(updated);
    }
    return {
      count: forgottenIds.length,
      ids: forgottenIds,
    } satisfies MemoryForgetResult;
  }

  async prepareReflection(options: ReflectionPrepareOptions = {}) {
    const entries = this.readEntries();
    const query = typeof options.query === "string" ? options.query.trim().toLowerCase() : "";
    const minDecayScore =
      typeof options.minDecayScore === "number" && Number.isFinite(options.minDecayScore)
        ? Math.max(0, options.minDecayScore)
        : 0.3;
    const limit = clampLimit(options.limit);
    const baselineTokens = 8000;
    const extraTokens = normalizeInteger(options.extraTokens, 0, 0, 100000);
    const penaltyTokens = normalizeInteger(options.penaltyTokens, 0, 0, 100000);
    const requestedTokens = normalizeInteger(
      options.requestedTokens,
      baselineTokens + extraTokens - penaltyTokens,
      1000,
      200000
    );
    const extraReason = typeof options.extraReason === "string" ? options.extraReason.trim() : "";
    const penaltyReason =
      typeof options.penaltyReason === "string" ? options.penaltyReason.trim() : "";
    const filtered = entries
      .filter((entry) => !entry.archived)
      .filter((entry) => entry.decayScore >= minDecayScore)
      .filter((entry) => {
        if (!query) return true;
        const contentHit = entry.content.toLowerCase().includes(query);
        const tagHit = entry.tags.some((tag) => tag.toLowerCase().includes(query));
        return contentHit || tagHit;
      })
      .sort((a, b) => b.decayScore - a.decayScore || b.time.localeCompare(a.time))
      .slice(0, limit);
    if (filtered.length === 0) {
      throw new Error("memory_reflect 未找到可反思记忆，请降低 minDecayScore 或调整 query。");
    }
    const reflectionId = randomUUID();
    const now = new Date().toISOString();
    const summary = buildReflectionSummary(filtered);
    const preview = filtered.map((entry) => ({
      id: entry.id,
      store: entry.store,
      tags: entry.tags,
      snippet: excerpt(entry.content, 180),
      decayScore: entry.decayScore,
    }));
    const pending = {
      reflectionId,
      createdAt: now,
      status: "awaiting_approval",
      request: {
        baselineTokens,
        extraTokens,
        penaltyTokens,
        requestedTokens,
        extraReason,
        penaltyReason,
      },
      scope: {
        totalCandidates: entries.length,
        selectedCount: filtered.length,
        query,
        minDecayScore,
      },
      summary,
      selectedIds: filtered.map((entry) => entry.id),
      preview,
    };

    this.ensureReflectionDirs();
    fs.writeFileSync(this.pendingReflectionJsonPath(), `${JSON.stringify(pending, null, 2)}\n`, "utf-8");
    fs.writeFileSync(
      this.pendingReflectionMdPath(),
      buildPendingReflectionMarkdown(pending),
      "utf-8"
    );
    return {
      reflectionId,
      pendingPath: this.pendingReflectionJsonPath(),
      pendingMarkdownPath: this.pendingReflectionMdPath(),
      request: pending.request,
      scope: pending.scope,
      summary: pending.summary,
      preview: pending.preview,
    } satisfies ReflectionPrepareResult;
  }

  async commitReflection(input: ReflectionCommitOptions) {
    const reflectionId = String(input.reflectionId || "").trim();
    if (!reflectionId) {
      throw new Error("memory_reflect_commit 需要 reflectionId。");
    }
    this.ensureReflectionDirs();
    const pendingPath = this.pendingReflectionJsonPath();
    if (!fs.existsSync(pendingPath)) {
      throw new Error("不存在待审批反思记录，请先执行 memory_reflect。");
    }
    const pendingRaw = fs.readFileSync(pendingPath, "utf-8");
    const pending = JSON.parse(pendingRaw) as {
      reflectionId?: string;
      createdAt?: string;
      request?: { requestedTokens?: number };
      summary?: string;
      preview?: Array<{ id: string; store: MemoryStoreKind; tags: string[]; snippet: string; decayScore: number }>;
    };
    if ((pending.reflectionId || "") !== reflectionId) {
      throw new Error("reflectionId 与当前待审批记录不一致。");
    }

    const decision = normalizeDecision(input.decision);
    const approvedTokens = normalizeInteger(
      input.approvedTokens,
      normalizeInteger(pending.request?.requestedTokens, 8000, 0, 200000),
      0,
      200000
    );
    const reason = String(input.reason || "").trim();
    if (!reason) {
      throw new Error("memory_reflect_commit 需要 reason。");
    }
    const now = new Date().toISOString();
    const stamp = toDateStamp(now);
    const rewardPath = path.join(this.rewardsDir(), `${stamp}.md`);
    const rewardDoc = [
      `# Reward Decision ${stamp}`,
      "",
      `- reflectionId: ${reflectionId}`,
      `- decision: ${decision}`,
      `- approvedTokens: ${approvedTokens}`,
      `- reason: ${reason}`,
      `- createdAt: ${now}`,
      "",
    ].join("\n");
    fs.writeFileSync(rewardPath, rewardDoc, "utf-8");
    appendLine(
      this.rewardLogPath(),
      `## ${stamp}\n**Result:** ${decision} (${approvedTokens})\n**Reason:** ${reason}\n`
    );

    let reflectionPath: string | undefined;
    let reflectionLogPath: string | undefined;
    if (decision !== "rejected") {
      reflectionPath = path.join(this.reflectionsDir(), `${stamp}.md`);
      const reflectionDoc = [
        `# Reflection ${stamp}`,
        "",
        `- reflectionId: ${reflectionId}`,
        `- approvedTokens: ${approvedTokens}`,
        `- decision: ${decision}`,
        "",
        "## Summary",
        `${pending.summary || ""}`,
        "",
        "## Memory Preview",
        ...((pending.preview || []).map(
          (item) =>
            `- [${item.store}] id=${item.id} decay=${item.decayScore.toFixed(3)} tags=${item.tags.join(", ")} :: ${item.snippet}`
        )),
        "",
      ].join("\n");
      fs.writeFileSync(reflectionPath, reflectionDoc, "utf-8");
      reflectionLogPath = this.reflectionLogPath();
      appendLine(
        this.reflectionLogPath(),
        `## ${stamp}\n- reflectionId: ${reflectionId}\n- decision: ${decision}\n- approvedTokens: ${approvedTokens}\n- summary: ${pending.summary || ""}\n`
      );
    }

    const entries = this.readEntries();
    const decaySnapshot = entries.map((entry) => ({
      id: entry.id,
      store: entry.store,
      decayScore: entry.decayScore,
      updatedAt: entry.updatedAt,
      archived: entry.archived,
    }));
    fs.writeFileSync(this.decayScoresPath(), `${JSON.stringify(decaySnapshot, null, 2)}\n`, "utf-8");

    safeRemove(this.pendingReflectionJsonPath());
    safeRemove(this.pendingReflectionMdPath());

    return {
      reflectionId,
      decision,
      approvedTokens,
      ...(reflectionPath ? { reflectionPath } : {}),
      rewardPath,
      ...(reflectionLogPath ? { reflectionLogPath } : {}),
      rewardLogPath: this.rewardLogPath(),
    } satisfies ReflectionCommitResult;
  }
}

function normalizeEntry(raw: unknown): MemoryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : randomUUID();
  const time = typeof obj.time === "string" && obj.time.trim() ? obj.time.trim() : new Date().toISOString();
  const updatedAt =
    typeof obj.updatedAt === "string" && obj.updatedAt.trim() ? obj.updatedAt.trim() : time;
  const lastAccessedAt =
    typeof obj.lastAccessedAt === "string" && obj.lastAccessedAt.trim()
      ? obj.lastAccessedAt.trim()
      : time;
  const tags = Array.isArray(obj.tags) ? normalizeTags(obj.tags.map((item) => String(item))) : [];
  const content = typeof obj.content === "string" ? obj.content.trim() : "";
  if (!content) return null;
  const store = normalizeStoreKind(obj.store);
  const importance = clampImportance(
    typeof obj.importance === "number" ? obj.importance : undefined
  );
  const accessCount =
    typeof obj.accessCount === "number" && Number.isFinite(obj.accessCount) && obj.accessCount >= 0
      ? Math.floor(obj.accessCount)
      : 0;
  const decayScore =
    typeof obj.decayScore === "number" && Number.isFinite(obj.decayScore)
      ? obj.decayScore
      : computeDecayScore({ store, importance, accessCount, lastAccessedAt });
  return {
    id,
    time,
    updatedAt,
    lastAccessedAt,
    accessCount,
    tags,
    content,
    store,
    source: typeof obj.source === "string" && obj.source.trim() ? obj.source.trim() : "manual",
    importance,
    decayScore,
    archived: obj.archived === true,
  };
}

function normalizeStoreKind(input: unknown): MemoryStoreKind {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (value === "core") return "core";
  if (value === "episodic") return "episodic";
  if (value === "semantic") return "semantic";
  if (value === "procedural") return "procedural";
  if (value === "vault") return "vault";
  return "semantic";
}

function normalizeTags(tags: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of tags) {
    const cleaned = String(raw || "").trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(cleaned);
  }
  return normalized;
}

function clampImportance(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.6;
  return Math.min(1, Math.max(0, value));
}

function clampLimit(limit: number | undefined) {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 5;
  return Math.max(1, Math.min(50, Math.floor(limit)));
}

function computeDecayScore(input: {
  store: MemoryStoreKind;
  importance: number;
  accessCount: number;
  lastAccessedAt: string;
}) {
  const lastAccessed = new Date(input.lastAccessedAt).getTime();
  const now = Date.now();
  const diffMs = Number.isFinite(lastAccessed) ? Math.max(0, now - lastAccessed) : 0;
  const days = diffMs / (1000 * 60 * 60 * 24);
  const decay = Math.exp(-0.03 * days);
  const accessBoost = Math.log2(input.accessCount + 1);
  const weighted = input.importance * DECAY_WEIGHTS[input.store] * decay * (1 + accessBoost);
  return Number(weighted.toFixed(6));
}

function scoreEntry(entry: MemoryEntry, normalizedQuery: string) {
  const content = entry.content.toLowerCase();
  const tags = entry.tags.map((item) => item.toLowerCase());
  let score = 0;
  if (content.includes(normalizedQuery)) score += 2;
  for (const tag of tags) {
    if (tag === normalizedQuery) score += 1.5;
    else if (tag.includes(normalizedQuery)) score += 0.75;
  }
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const matchedTerms = terms.filter((term) => content.includes(term)).length;
  score += matchedTerms * 0.25;
  score += entry.decayScore;
  return score;
}

function buildReflectionSummary(entries: MemoryEntry[]) {
  const byStore = new Map<MemoryStoreKind, number>();
  for (const entry of entries) {
    byStore.set(entry.store, (byStore.get(entry.store) || 0) + 1);
  }
  const parts = Array.from(byStore.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([store, count]) => `${store}:${count}`);
  return `Top memory clusters -> ${parts.join(", ")}. Total=${entries.length}.`;
}

function excerpt(input: string, max = 180) {
  const cleaned = input.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 3)}...`;
}

function normalizeInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const floored = Math.floor(value);
  return Math.min(max, Math.max(min, floored));
}

function normalizeDecision(input: ReflectionDecision | string): ReflectionDecision {
  const value = String(input || "").trim().toLowerCase();
  if (value === "approved") return "approved";
  if (value === "reduced") return "reduced";
  if (value === "rejected") return "rejected";
  throw new Error("decision 仅支持 approved | reduced | rejected。");
}

function toDateStamp(iso: string) {
  const date = new Date(iso);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}-${hour}${minute}${second}Z`;
}

function appendLine(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${content.trimEnd()}\n\n`, "utf-8");
}

function safeRemove(file: string) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // ignore cleanup failures
  }
}

function buildPendingReflectionMarkdown(pending: {
  reflectionId: string;
  createdAt: string;
  request: {
    baselineTokens: number;
    extraTokens: number;
    penaltyTokens: number;
    requestedTokens: number;
    extraReason: string;
    penaltyReason: string;
  };
  summary: string;
  preview: Array<{ id: string; store: MemoryStoreKind; tags: string[]; snippet: string; decayScore: number }>;
}) {
  return [
    `# Pending Reflection ${pending.reflectionId}`,
    "",
    `- createdAt: ${pending.createdAt}`,
    "",
    "## Reward Request",
    `- baselineTokens: ${pending.request.baselineTokens}`,
    `- extraTokens: ${pending.request.extraTokens}`,
    `- penaltyTokens: ${pending.request.penaltyTokens}`,
    `- requestedTokens: ${pending.request.requestedTokens}`,
    `- extraReason: ${pending.request.extraReason || "(none)"}`,
    `- penaltyReason: ${pending.request.penaltyReason || "(none)"}`,
    "",
    "## Summary",
    pending.summary,
    "",
    "## Preview",
    ...pending.preview.map(
      (item) =>
        `- [${item.store}] id=${item.id} decay=${item.decayScore.toFixed(3)} tags=${item.tags.join(", ")} :: ${item.snippet}`
    ),
    "",
    "Status: awaiting_approval",
    "",
  ].join("\n");
}
