import fs from "node:fs/promises";
import path from "node:path";

import { AppError } from "../../middleware/error";
import { BookIndexStoreError, readBookIndex } from "../asset/book-index-store";
import { resolveProjectDataRepoRoot } from "../asset/project-data-root";

function sanitizePathSegment(raw: string): string {
  return String(raw || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
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
    return await readBookIndex(indexPath);
  } catch (error) {
    if (error instanceof BookIndexStoreError && error.code === "book_index_not_found") return null;
    if (error instanceof BookIndexStoreError) {
      throw new AppError(error.message, {
        status: 500,
        code: error.code,
        details: error.details,
      });
    }
    throw error;
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
    if (await readBookIndexSafe(directIndexPath)) return directDirName;
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

export async function resolveProjectBookDirectoryPath(input: {
  projectId: string;
  userId: string;
  requestedBookId: string;
}): Promise<string | null> {
  const directoryName = await resolveProjectBookDirectoryName(input);
  return directoryName
    ? path.join(buildProjectBooksRoot(input.projectId, input.userId), directoryName)
    : null;
}
