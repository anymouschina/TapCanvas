/**
 * 【章节原文·编排器服务端权威自加载（2026-07-13 ch24 根治）】
 *
 * 病根：chapterText 此前是「调用方可选参数」——route 层记得加载就有、driver 回灌/内部调用忘传就空，
 * 而整套原文守恒机制（锚点代修/覆盖率机检/台词条数守恒/信息点守恒/跨度物化进任务书）全部
 * 以「有 chapterText」为前提，断供即**集体静默失效**（ch24 实测：回灌按段机检全跳过、
 * 任务书无原文跨度，丢信息一路放行到 start 才被兜底闸拦下）。
 *
 * 根治＝入参兜底自加载：orchestrate 各 handler 入口统一走 resolveChapterTextForOrchestrate——
 * 调用方传了非空 chapterText 用它（route 快路径不变）；没传则按 chapterId 解析出书目录与章节序号，
 * 服务端自己读盘。从此不存在「哪条调用路径忘了传」这一失效类别。
 * 读法与 tapcanvas_book_chapter_get / agents-tool-bridge 的 loadChapterSourceTextSafe 同源：
 * canvas 内建书读独立 JSON 的 content；上传书读 raw.md 按 offset 切片。任何失败返回 ""
 * （best-effort·绝不影响出片主流程，机检拿不到原文时按旧行为跳过）。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "../../middleware/error";
import { BookIndexStoreError, readBookIndex } from "../asset/book-index-store";
import { resolveProjectDataRepoRoot } from "../asset/project-data-root";

const CHAPTER_ID_RE = /^book-(.+)-ch(\d+)$/;

function sanitizePathSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** chapterId（如 book-<书目录名>-ch24）→ {bookDirName, chapter}；不匹配返回 null。 */
export function parseChapterIdParts(
  chapterId: unknown,
): { bookDirName: string; chapter: number } | null {
  const m = CHAPTER_ID_RE.exec(String(chapterId ?? "").trim());
  if (!m) return null;
  const bookDirName = m[1];
  // 路径穿越防护（OCR 2026-07-13）：bookDirName 直接进 path.join，白名单字符 + 显式拒 ".."
  if (!/^[a-zA-Z0-9._-]+$/.test(bookDirName) || bookDirName.includes("..")) return null;
  const chapter = Number(m[2]);
  if (!Number.isFinite(chapter) || chapter <= 0) return null;
  return { bookDirName, chapter };
}

function buildProjectBooksRoot(projectId: string, userId: string, repoRoot?: string): string {
  return path.join(
    repoRoot || resolveProjectDataRepoRoot(),
    "project-data",
    "users",
    sanitizePathSegment(userId),
    "projects",
    sanitizePathSegment(projectId),
    "books",
  );
}

async function readBookIndexSafe(indexPath: string): Promise<Record<string, unknown> | null> {
  try {
    return await readBookIndex(indexPath);
  } catch (error) {
    if (error instanceof BookIndexStoreError && error.code === "book_index_not_found") return null;
    if (error instanceof BookIndexStoreError) {
      throw new AppError(error.message, { status: 500, code: error.code, details: error.details });
    }
    throw error;
  }
}

/** 按 (projectId, ownerId, bookDirName, chapter) 读章节原文全文；索引错误显式失败。 */
export async function loadChapterSourceText(input: {
  projectId: string;
  ownerId: string;
  bookDirName: string;
  chapter: number;
  /** 仓根覆盖（测试注入用；缺省按 pnpm-workspace.yaml 向上定位）。 */
  repoRoot?: string;
}): Promise<string> {
  try {
    if (!input.projectId || !input.ownerId || !input.bookDirName || !input.chapter) return "";
    const booksRoot = buildProjectBooksRoot(input.projectId, input.ownerId, input.repoRoot);
    const idx = await readBookIndexSafe(path.join(booksRoot, input.bookDirName, "index.json"));
    if (!idx) return "";
    const chapters = Array.isArray(idx.chapters) ? idx.chapters : [];
    const target = chapters.find(
      (item) => Number((item as { chapter?: unknown }).chapter) === input.chapter,
    );
    if (!target || typeof target !== "object" || Array.isArray(target)) return "";
    const targetRecord = target as Record<string, unknown>;
    const contentFile = readTrimmedString(targetRecord.contentFile);
    if (contentFile) {
      try {
        const raw = await fs.readFile(
          path.join(booksRoot, input.bookDirName, contentFile),
          "utf8",
        );
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return readTrimmedString(parsed.content);
      } catch {
        return "";
      }
    }
    const raw = await fs
      .readFile(path.join(booksRoot, input.bookDirName, "raw.md"), "utf8")
      .catch(() => "");
    if (!raw) return "";
    // offset=0 是合法值，禁 falsy 回退（OCR 2026-07-13：endOffset===0 曾会回退成整文件）
    const rawStart = Number(targetRecord.startOffset);
    const rawEnd = Number(targetRecord.endOffset);
    const startOffset = Math.max(0, Number.isFinite(rawStart) ? rawStart : 0);
    const endOffset = Math.min(raw.length, Number.isFinite(rawEnd) ? rawEnd : raw.length);
    return raw.slice(startOffset, Math.max(startOffset, endOffset)).trim();
  } catch (error) {
    if (error instanceof AppError) throw error;
    return "";
  }
}

/**
 * orchestrate 入口统一兜底：调用方给了非空 chapterText 原样返回；否则按 chapterId 自加载。
 * ownerId 传 run 归属者/请求用户（书目录挂在项目所有者名下，二者在本产品当前形态一致）。
 */
export async function resolveChapterTextForOrchestrate(input: {
  chapterText?: string | null;
  chapterId?: string | null;
  projectId?: string | null;
  ownerId?: string | null;
}): Promise<string> {
  const passed = String(input.chapterText ?? "");
  if (passed.trim()) return passed;
  const parts = parseChapterIdParts(input.chapterId);
  if (!parts) return "";
  const projectId = String(input.projectId ?? "").trim();
  const ownerId = String(input.ownerId ?? "").trim();
  if (!projectId || !ownerId) return "";
  return loadChapterSourceText({ projectId, ownerId, ...parts });
}
