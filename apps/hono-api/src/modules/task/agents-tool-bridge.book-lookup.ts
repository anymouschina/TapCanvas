import fs from "node:fs/promises";
import path from "node:path";

import { resolveProjectDataRepoRoot } from "../asset/project-data-root";

function sanitizePathSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

function buildProjectBooksRoot(projectId: string, userId: string): string {
  const repoRoot = resolveProjectDataRepoRoot();
  return path.join(
    repoRoot,
    "project-data",
    "users",
    sanitizePathSegment(userId),
    "projects",
    sanitizePathSegment(projectId),
    "books",
  );
}

function buildBookIndexPath(projectId: string, userId: string, bookId: string): string {
  return path.join(buildProjectBooksRoot(projectId, userId), bookId, "index.json");
}

async function readBookIndexSafe(indexPath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function resolveProjectBookDirectoryName(input: {
  projectId: string;
  userId: string;
  requestedBookId: string;
}): Promise<string | null> {
  const booksRoot = buildProjectBooksRoot(input.projectId, input.userId);
  const directDirName = sanitizePathSegment(input.requestedBookId);
  if (directDirName) {
    const directIndexPath = buildBookIndexPath(input.projectId, input.userId, directDirName);
    try {
      await fs.access(directIndexPath);
      return directDirName;
    } catch {
      // continue fallback scan
    }
  }
  const entries = await fs.readdir(booksRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const idx = await readBookIndexSafe(path.join(booksRoot, entry.name, "index.json"));
    if (!idx) continue;
    const logicalBookId = readTrimmedString(idx.bookId);
    if (logicalBookId && logicalBookId === input.requestedBookId) {
      return entry.name;
    }
  }
  return null;
}
