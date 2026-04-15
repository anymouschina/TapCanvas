import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import type { Message } from "../../types/index.js";

const DEFAULT_MAX_MESSAGES = 200;
const SESSION_INDEX_FILE = "_index.json";

export type SessionStore = {
  dir: string;
  key: string;
  maxMessages?: number;
};

type SessionIndexRecord = {
  key: string;
  safeKey: string;
  updatedAt: string;
};

export type SessionSummary = {
  key: string;
  safeKey: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
};

export function loadSessionMessages(store: SessionStore): Message[] {
  return readSessionMessagesFromFile(sessionFilePath(store), store.maxMessages ?? DEFAULT_MAX_MESSAGES);
}

export function saveSessionMessages(store: SessionStore, messages: Message[]) {
  const filePath = sessionFilePath(store);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const clamped = clampMessages(
    messages.filter((message) => message.ephemeral !== true),
    store.maxMessages ?? DEFAULT_MAX_MESSAGES,
  );
  const out = clamped.map((m) => JSON.stringify(m)).join("\n");
  fs.writeFileSync(filePath, out ? `${out}\n` : "", "utf-8");
  writeSessionIndex(store.dir, {
    key: store.key,
    safeKey: sanitizeKey(store.key),
    updatedAt: new Date().toISOString(),
  });
}

export function listSessionSummaries(dir: string, limit = 20): SessionSummary[] {
  if (!fs.existsSync(dir)) return [];
  const index = readSessionIndex(dir);
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name);

  const summaries = files
    .map((fileName) => {
      const safeKey = fileName.replace(/\.jsonl$/u, "");
      const absolutePath = path.join(dir, fileName);
      const stat = fs.statSync(absolutePath);
      const messages = readSessionMessagesFromFile(absolutePath, DEFAULT_MAX_MESSAGES);
      const preview = buildPreview(messages);
      const indexed = index.find((item) => item.safeKey === safeKey);
      return {
        key: indexed?.key ?? safeKey,
        safeKey,
        updatedAt: indexed?.updatedAt ?? stat.mtime.toISOString(),
        messageCount: messages.length,
        preview,
      } satisfies SessionSummary;
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return summaries.slice(0, Math.max(0, limit));
}

function sessionFilePath(store: SessionStore) {
  const safeKey = sanitizeKey(store.key);
  return path.join(store.dir, `${safeKey}.jsonl`);
}

function sanitizeKey(key: string) {
  const trimmed = key.trim();
  if (!trimmed) return "default";
  const normalized = trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
  const prefix = normalized.slice(0, 48) || "session";
  const digest = createHash("sha256").update(trimmed).digest("hex").slice(0, 24);
  return `${prefix}__${digest}`;
}

function clampMessages(messages: Message[], max: number) {
  if (messages.length <= max) return messages;
  if (max <= 1) return messages.slice(-max);
  return [messages[0], ...messages.slice(-(max - 1))];
}

function readSessionMessagesFromFile(filePath: string, maxMessages: number): Message[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    const messages = lines
      .map((line) => JSON.parse(line) as Message)
      .filter((msg) => typeof msg?.role === "string" && typeof msg?.content === "string");
    return clampMessages(messages, maxMessages);
  } catch {
    return [];
  }
}

function buildPreview(messages: Message[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const content = String(messages[index]?.content || "").trim();
    if (!content) continue;
    return content.length > 80 ? `${content.slice(0, 80)}…` : content;
  }
  return "(empty)";
}

function readSessionIndex(dir: string): SessionIndexRecord[] {
  const filePath = path.join(dir, SESSION_INDEX_FILE);
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SessionIndexRecord => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const record = item as Record<string, unknown>;
      return (
        typeof record.key === "string" &&
        typeof record.safeKey === "string" &&
        typeof record.updatedAt === "string"
      );
    });
  } catch {
    return [];
  }
}

function writeSessionIndex(dir: string, record: SessionIndexRecord): void {
  const next = readSessionIndex(dir)
    .filter((item) => item.safeKey !== record.safeKey)
    .concat(record)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  fs.writeFileSync(path.join(dir, SESSION_INDEX_FILE), JSON.stringify(next, null, 2), "utf-8");
}
