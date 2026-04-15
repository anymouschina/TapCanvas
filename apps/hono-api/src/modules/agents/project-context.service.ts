import fs from "node:fs/promises";
import path from "node:path";

import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { getProjectForOwner } from "../project/project.repo";

export type ProjectWorkspaceContextFileVersionDto = {
  versionId: string;
  fileName: string;
  layer: "global" | "project";
  updatedAt: string;
  updatedBy: string;
};

export type ProjectWorkspaceContextFileVersionContentDto = {
  versionId: string;
  fileName: string;
  layer: "global" | "project";
  updatedAt: string;
  updatedBy: string;
  content: string;
};

export type ProjectWorkspaceContextFileDto = {
  path: string;
  content: string;
  layer: "global" | "project";
  updatedAt: string | null;
  updatedBy: string | null;
  history: ProjectWorkspaceContextFileVersionDto[];
};

export type ProjectWorkspaceContextDto = {
  projectId: string;
  ownerId: string;
  projectRoot: string;
  globalContextDir: string;
  projectContextDir: string;
  currentBookId: string | null;
  currentChapter: number | null;
  globalFiles: ProjectWorkspaceContextFileDto[];
  projectFiles: ProjectWorkspaceContextFileDto[];
};

type EnsureProjectWorkspaceContextInput = {
  c: AppContext;
  ownerId: string;
  projectId: string;
  bookId?: string | null;
  chapter?: number | null;
};

type NamedSummary = {
  name: string;
  description?: string;
};

type ChapterSummary = {
  chapter: number;
  title?: string;
};

type StoryboardChunkSummary = {
  chunkIndex: number;
  groupSize?: number;
  shotStart?: number;
  shotEnd?: number;
  tailFrameUrl?: string;
  updatedAt?: string;
};

type SemanticAssetSummary = {
  semanticId: string;
  mediaKind: "image" | "video";
  nodeKind?: string;
  chapter?: number;
  shotNo?: number;
  stateDescription?: string;
  anchorLabels: string[];
  characterLabels: string[];
  imageUrl?: string;
  videoUrl?: string;
  updatedAt?: string;
};

type CharacterStateSummary = {
  name: string;
  chapter?: number;
  shotNo?: number;
  stateDescription?: string;
  imageUrl?: string;
  updatedAt?: string;
};

type BookContextSnapshot = {
  bookId: string;
  title?: string;
  chapterCount?: number;
  updatedAt?: string;
  chapters: ChapterSummary[];
  styleName?: string;
  styleVisualDirectives: string[];
  styleConsistencyRules: string[];
  styleNegativeDirectives: string[];
  characters: NamedSummary[];
  storyboardLatest?: StoryboardChunkSummary;
  recentSemanticAssets: SemanticAssetSummary[];
  latestCharacterStates: CharacterStateSummary[];
};

type ContextFileMeta = {
  updatedAt: string;
  updatedBy: string;
};

type UnknownRecord = Record<string, unknown>;

const PROJECT_CONTEXT_DIR = path.join(".tapcanvas", "context");
const GLOBAL_CONTEXT_DIR = path.join(process.cwd(), ".tapcanvas", "context");
const GLOBAL_HISTORY_DIR = path.join(process.cwd(), ".tapcanvas", "context-history");
const PROJECT_CONTEXT_FILE_NAMES = ["PROJECT.md", "RULES.md", "CHARACTERS.md", "STORY_STATE.md"] as const;
const GLOBAL_CONTEXT_FILE_NAMES = ["GLOBAL_RULES.md"] as const;
const HISTORY_LIMIT = 12;

type ProjectContextFileName = (typeof PROJECT_CONTEXT_FILE_NAMES)[number];
type GlobalContextFileName = (typeof GLOBAL_CONTEXT_FILE_NAMES)[number];

export async function updateProjectWorkspaceContextFile(input: {
  c: AppContext;
  ownerId: string;
  projectId: string;
  fileName: string;
  content: string;
}): Promise<ProjectWorkspaceContextFileDto> {
  const normalizedFileName = normalizeProjectContextFileName(input.fileName);
  if (!normalizedFileName) {
    throw new AppError("Invalid project context file", {
      status: 400,
      code: "invalid_project_context_file",
      details: { fileName: input.fileName },
    });
  }
  const projectRoot = buildProjectDataRoot(input.projectId, input.ownerId);
  const contextDir = path.join(projectRoot, PROJECT_CONTEXT_DIR);
  const historyDir = path.join(projectRoot, ".tapcanvas", "context-history");
  await fs.mkdir(contextDir, { recursive: true });
  const filePath = path.join(contextDir, normalizedFileName);
  await writeContextFileWithHistory({
    filePath,
    historyDir,
    fileName: normalizedFileName,
    content: input.content,
    layer: "project",
    updatedBy: input.ownerId,
  });
  return loadContextFile({
    dirPath: contextDir,
    historyDir,
    fileName: normalizedFileName,
    layer: "project",
  });
}

export async function updateGlobalWorkspaceContextFile(input: {
  fileName: string;
  content: string;
  updatedBy: string;
}): Promise<ProjectWorkspaceContextFileDto> {
  const normalizedFileName = normalizeGlobalContextFileName(input.fileName);
  if (!normalizedFileName) {
    throw new AppError("Invalid global context file", {
      status: 400,
      code: "invalid_global_context_file",
      details: { fileName: input.fileName },
    });
  }
  await fs.mkdir(GLOBAL_CONTEXT_DIR, { recursive: true });
  await writeContextFileWithHistory({
    filePath: path.join(GLOBAL_CONTEXT_DIR, normalizedFileName),
    historyDir: GLOBAL_HISTORY_DIR,
    fileName: normalizedFileName,
    content: input.content,
    layer: "global",
    updatedBy: input.updatedBy,
  });
  return loadContextFile({
    dirPath: GLOBAL_CONTEXT_DIR,
    historyDir: GLOBAL_HISTORY_DIR,
    fileName: normalizedFileName,
    layer: "global",
  });
}

export async function getProjectWorkspaceContextFileVersionContent(input: {
  ownerId: string;
  projectId: string;
  fileName: string;
  versionId: string;
}): Promise<ProjectWorkspaceContextFileVersionContentDto> {
  const normalizedFileName = normalizeProjectContextFileName(input.fileName);
  if (!normalizedFileName) {
    throw new AppError("Invalid project context file", {
      status: 400,
      code: "invalid_project_context_file",
      details: { fileName: input.fileName },
    });
  }
  const projectRoot = buildProjectDataRoot(input.projectId, input.ownerId);
  const historyDir = path.join(projectRoot, ".tapcanvas", "context-history");
  return readContextFileVersionContent({
    historyDir,
    fileName: normalizedFileName,
    layer: "project",
    versionId: input.versionId,
  });
}

export async function getGlobalWorkspaceContextFileVersionContent(input: {
  fileName: string;
  versionId: string;
}): Promise<ProjectWorkspaceContextFileVersionContentDto> {
  const normalizedFileName = normalizeGlobalContextFileName(input.fileName);
  if (!normalizedFileName) {
    throw new AppError("Invalid global context file", {
      status: 400,
      code: "invalid_global_context_file",
      details: { fileName: input.fileName },
    });
  }
  return readContextFileVersionContent({
    historyDir: GLOBAL_HISTORY_DIR,
    fileName: normalizedFileName,
    layer: "global",
    versionId: input.versionId,
  });
}

export async function rollbackProjectWorkspaceContextFileVersion(input: {
  ownerId: string;
  projectId: string;
  fileName: string;
  versionId: string;
  updatedBy: string;
}): Promise<ProjectWorkspaceContextFileDto> {
  const normalizedFileName = normalizeProjectContextFileName(input.fileName);
  if (!normalizedFileName) {
    throw new AppError("Invalid project context file", {
      status: 400,
      code: "invalid_project_context_file",
      details: { fileName: input.fileName },
    });
  }
  const projectRoot = buildProjectDataRoot(input.projectId, input.ownerId);
  const contextDir = path.join(projectRoot, PROJECT_CONTEXT_DIR);
  const historyDir = path.join(projectRoot, ".tapcanvas", "context-history");
  const version = await readContextFileVersionContent({
    historyDir,
    fileName: normalizedFileName,
    layer: "project",
    versionId: input.versionId,
  });
  await fs.mkdir(contextDir, { recursive: true });
  await writeContextFileWithHistory({
    filePath: path.join(contextDir, normalizedFileName),
    historyDir,
    fileName: normalizedFileName,
    content: version.content,
    layer: "project",
    updatedBy: input.updatedBy,
  });
  return loadContextFile({
    dirPath: contextDir,
    historyDir,
    fileName: normalizedFileName,
    layer: "project",
  });
}

export async function rollbackGlobalWorkspaceContextFileVersion(input: {
  fileName: string;
  versionId: string;
  updatedBy: string;
}): Promise<ProjectWorkspaceContextFileDto> {
  const normalizedFileName = normalizeGlobalContextFileName(input.fileName);
  if (!normalizedFileName) {
    throw new AppError("Invalid global context file", {
      status: 400,
      code: "invalid_global_context_file",
      details: { fileName: input.fileName },
    });
  }
  const version = await readContextFileVersionContent({
    historyDir: GLOBAL_HISTORY_DIR,
    fileName: normalizedFileName,
    layer: "global",
    versionId: input.versionId,
  });
  await fs.mkdir(GLOBAL_CONTEXT_DIR, { recursive: true });
  await writeContextFileWithHistory({
    filePath: path.join(GLOBAL_CONTEXT_DIR, normalizedFileName),
    historyDir: GLOBAL_HISTORY_DIR,
    fileName: normalizedFileName,
    content: version.content,
    layer: "global",
    updatedBy: input.updatedBy,
  });
  return loadContextFile({
    dirPath: GLOBAL_CONTEXT_DIR,
    historyDir: GLOBAL_HISTORY_DIR,
    fileName: normalizedFileName,
    layer: "global",
  });
}

export async function getProjectWorkspaceContext(input: {
  c: AppContext;
  ownerId: string;
  projectId: string;
  bookId?: string | null;
  chapter?: number | null;
  refresh?: boolean;
}): Promise<ProjectWorkspaceContextDto> {
  if (input.refresh === true) {
    await ensureProjectWorkspaceContextFiles({
      c: input.c,
      ownerId: input.ownerId,
      projectId: input.projectId,
      bookId: input.bookId ?? null,
      chapter: input.chapter ?? null,
    });
  }
  const projectRoot = buildProjectDataRoot(input.projectId, input.ownerId);
  const projectContextDir = path.join(projectRoot, PROJECT_CONTEXT_DIR);
  const projectHistoryDir = path.join(projectRoot, ".tapcanvas", "context-history");
  const projectFiles = await loadContextFilesFromDir({
    dirPath: projectContextDir,
    historyDir: projectHistoryDir,
    layer: "project",
    preferredFileNames: PROJECT_CONTEXT_FILE_NAMES,
  });
  const globalFiles = await loadContextFilesFromDir({
    dirPath: GLOBAL_CONTEXT_DIR,
    historyDir: GLOBAL_HISTORY_DIR,
    layer: "global",
  });
  return {
    projectId: input.projectId,
    ownerId: input.ownerId,
    projectRoot,
    globalContextDir: GLOBAL_CONTEXT_DIR,
    projectContextDir,
    currentBookId: normalizeNullableText(input.bookId),
    currentChapter: normalizePositiveInteger(input.chapter),
    globalFiles,
    projectFiles,
  };
}

export async function ensureProjectWorkspaceContextFiles(
  input: EnsureProjectWorkspaceContextInput,
): Promise<void> {
  const projectRoot = buildProjectDataRoot(input.projectId, input.ownerId);
  const contextDir = path.join(projectRoot, PROJECT_CONTEXT_DIR);
  const project = await getProjectForOwner(input.c.env.DB, input.projectId, input.ownerId);
  const book = await resolveBookContextSnapshot({
    projectId: input.projectId,
    ownerId: input.ownerId,
    bookId: input.bookId ?? null,
  });

  const projectMarkdown = renderProjectMarkdown({
    ownerId: input.ownerId,
    projectId: input.projectId,
    projectName: project?.name,
    projectRoot,
    book,
    chapter: normalizePositiveInteger(input.chapter),
  });
  const rulesMarkdown = renderRulesMarkdown({ book });
  const charactersMarkdown = renderCharactersMarkdown({ book });
  const storyStateMarkdown = renderStoryStateMarkdown({
    book,
    chapter: normalizePositiveInteger(input.chapter),
  });

  await fs.mkdir(contextDir, { recursive: true });
  await Promise.all([
    writeTextIfChanged(path.join(contextDir, "PROJECT.md"), projectMarkdown),
    writeTextIfChanged(path.join(contextDir, "RULES.md"), rulesMarkdown),
    writeTextIfChanged(path.join(contextDir, "CHARACTERS.md"), charactersMarkdown),
    writeTextIfChanged(path.join(contextDir, "STORY_STATE.md"), storyStateMarkdown),
  ]);
}

function sanitizePathSegment(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildProjectDataRoot(projectId: string, ownerId: string): string {
  return path.join(
    process.cwd(),
    "project-data",
    "users",
    sanitizePathSegment(ownerId),
    "projects",
    sanitizePathSegment(projectId),
  );
}

function buildLegacyProjectDataRoot(projectId: string): string {
  return path.join(process.cwd(), "project-data", sanitizePathSegment(projectId));
}

function buildBooksRoot(projectId: string, ownerId: string): string {
  return path.join(buildProjectDataRoot(projectId, ownerId), "books");
}

function buildLegacyBooksRoot(projectId: string): string {
  return path.join(buildLegacyProjectDataRoot(projectId), "books");
}

async function resolveBookContextSnapshot(input: {
  projectId: string;
  ownerId: string;
  bookId: string | null;
}): Promise<BookContextSnapshot | null> {
	const indexPath = input.bookId
		? await resolveReadableBookIndexPath({
				projectId: input.projectId,
				ownerId: input.ownerId,
				bookId: input.bookId,
			})
		: await resolveLatestReadableBookIndexPath(input.projectId, input.ownerId);
  if (!indexPath) return null;
  const raw = await fs.readFile(indexPath, "utf8").catch(() => "");
  if (!raw.trim()) return null;
  const parsed = parseJsonRecord(raw);
  if (!parsed) return null;
  return toBookContextSnapshot(parsed);
}

async function resolveReadableBookIndexPath(input: {
  projectId: string;
  ownerId: string;
  bookId: string;
}): Promise<string | null> {
  const safeBookId = sanitizePathSegment(input.bookId);
  const scopedPath = path.join(buildBooksRoot(input.projectId, input.ownerId), safeBookId, "index.json");
  if (await pathExists(scopedPath)) return scopedPath;
  const legacyPath = path.join(buildLegacyBooksRoot(input.projectId), safeBookId, "index.json");
  if (await pathExists(legacyPath)) return legacyPath;
  return null;
}

async function resolveLatestReadableBookIndexPath(projectId: string, ownerId: string): Promise<string | null> {
  const candidates = await collectBookIndexCandidates(projectId, ownerId);
  if (candidates.length === 0) return null;
  candidates.sort((left, right) => {
    const updatedDiff = right.updatedAt.localeCompare(left.updatedAt);
    if (updatedDiff !== 0) return updatedDiff;
    return left.path.localeCompare(right.path);
  });
  return candidates[0]?.path ?? null;
}

async function collectBookIndexCandidates(
  projectId: string,
  ownerId: string,
): Promise<Array<{ path: string; updatedAt: string }>> {
  const roots = [buildBooksRoot(projectId, ownerId), buildLegacyBooksRoot(projectId)];
  const candidates: Array<{ path: string; updatedAt: string }> = [];
  const seenPaths = new Set<string>();
  for (const booksRoot of roots) {
    const entries = await fs.readdir(booksRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const indexPath = path.join(booksRoot, entry.name, "index.json");
      if (seenPaths.has(indexPath)) continue;
      seenPaths.add(indexPath);
      const raw = await fs.readFile(indexPath, "utf8").catch(() => "");
      if (!raw.trim()) continue;
      const parsed = parseJsonRecord(raw);
      if (!parsed) continue;
      candidates.push({
        path: indexPath,
        updatedAt: readText(parsed.updatedAt),
      });
    }
  }
  return candidates;
}

function toBookContextSnapshot(data: UnknownRecord): BookContextSnapshot {
  const chapters = normalizeChapters(data.chapters);
  const assets = readRecord(data.assets);
  const styleBible = readRecord(assets?.styleBible);
  const storyboardChunks = normalizeStoryboardChunks(assets?.storyboardChunks);
  const semanticAssets = normalizeSemanticAssets(assets?.semanticAssets);
  const characters = normalizeNamedSummaries([
    ...(Array.isArray(assets?.characterProfiles) ? assets.characterProfiles : []),
    ...(Array.isArray(assets?.characters) ? assets.characters : []),
  ]);
  return {
    bookId: readText(data.bookId) || "unknown-book",
    title: readText(data.title) || undefined,
    chapterCount: normalizePositiveInteger(data.chapterCount) ?? undefined,
    updatedAt: readText(data.updatedAt) || undefined,
    chapters,
    styleName: readText(styleBible?.styleName) || undefined,
    styleVisualDirectives: readTextArray(styleBible?.visualDirectives, 8),
    styleConsistencyRules: readTextArray(styleBible?.consistencyRules, 8),
    styleNegativeDirectives: readTextArray(styleBible?.negativeDirectives, 8),
    characters,
    storyboardLatest: storyboardChunks[0],
    recentSemanticAssets: semanticAssets,
    latestCharacterStates: normalizeLatestCharacterStates(semanticAssets),
  };
}

function normalizeChapters(value: unknown): ChapterSummary[] {
  if (!Array.isArray(value)) return [];
  const chapters: ChapterSummary[] = [];
  for (const item of value) {
    const record = readRecord(item);
    if (!record) continue;
    const chapter = normalizePositiveInteger(record.chapter);
    if (!chapter) continue;
    const title = readText(record.title) || undefined;
    chapters.push(title ? { chapter, title } : { chapter });
    if (chapters.length >= 20) break;
  }
  return chapters;
}

function normalizeStoryboardChunks(value: unknown): StoryboardChunkSummary[] {
  if (!Array.isArray(value)) return [];
  const chunks: StoryboardChunkSummary[] = [];
  for (const item of value) {
    const record = readRecord(item);
    if (!record) continue;
    const chunkIndex = normalizeNonNegativeInteger(record.chunkIndex);
    if (chunkIndex === null) continue;
    const updatedAt = readText(record.updatedAt);
    const summary: StoryboardChunkSummary = {
      chunkIndex,
      groupSize: normalizePositiveInteger(record.groupSize) ?? undefined,
      shotStart: normalizePositiveInteger(record.shotStart) ?? undefined,
      shotEnd: normalizePositiveInteger(record.shotEnd) ?? undefined,
      tailFrameUrl: readText(record.tailFrameUrl) || undefined,
      updatedAt: updatedAt || undefined,
    };
    chunks.push(summary);
  }
  chunks.sort((left, right) => {
    const updatedDiff = String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
    if (updatedDiff !== 0) return updatedDiff;
    return right.chunkIndex - left.chunkIndex;
  });
  return chunks;
}

function normalizeSemanticAssets(value: unknown): SemanticAssetSummary[] {
  if (!Array.isArray(value)) return [];
  const assets: SemanticAssetSummary[] = [];
  for (const item of value) {
    const record = readRecord(item);
    if (!record) continue;
    const semanticId = readText(record.semanticId);
    const mediaKindRaw = readText(record.mediaKind).toLowerCase();
    const mediaKind = mediaKindRaw === "video" ? "video" : mediaKindRaw === "image" ? "image" : null;
    if (!semanticId || !mediaKind) continue;
    const chapter = normalizePositiveInteger(record.chapter) ?? undefined;
    const shotNo = normalizePositiveInteger(record.shotNo) ?? undefined;
    const updatedAt = readText(record.updatedAt) || readText(record.createdAt) || undefined;
    const anchorBindings = Array.isArray(record.anchorBindings) ? record.anchorBindings : [];
    const anchorLabels: string[] = [];
    const characterLabels: string[] = [];
    const seenLabels = new Set<string>();
    const seenCharacterLabels = new Set<string>();
    for (const binding of anchorBindings) {
      const bindingRecord = readRecord(binding);
      if (!bindingRecord) continue;
      const label = readText(bindingRecord.label);
      const kind = readText(bindingRecord.kind);
      if (!label) continue;
      const summary = kind ? `${label}(${kind})` : label;
      if (seenLabels.has(summary)) continue;
      seenLabels.add(summary);
      anchorLabels.push(summary);
      if (kind === "character" && !seenCharacterLabels.has(label)) {
        seenCharacterLabels.add(label);
        characterLabels.push(label);
      }
      if (anchorLabels.length >= 6) break;
    }
    assets.push({
      semanticId,
      mediaKind,
      nodeKind: readText(record.nodeKind) || undefined,
      chapter,
      shotNo,
      stateDescription: readText(record.stateDescription) || undefined,
      anchorLabels,
      characterLabels,
      imageUrl: readText(record.imageUrl) || undefined,
      videoUrl: readText(record.videoUrl) || undefined,
      updatedAt,
    });
  }
  assets.sort((left, right) => {
    const updatedDiff = String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
    if (updatedDiff !== 0) return updatedDiff;
    return (right.chapter || 0) - (left.chapter || 0);
  });
  return assets.slice(0, 24);
}

function normalizeLatestCharacterStates(items: SemanticAssetSummary[]): CharacterStateSummary[] {
  const latestByName = new Map<string, CharacterStateSummary>();
  for (const item of items) {
    for (const name of item.characterLabels) {
      if (latestByName.has(name)) continue;
      latestByName.set(name, {
        name,
        ...(typeof item.chapter === "number" ? { chapter: item.chapter } : null),
        ...(typeof item.shotNo === "number" ? { shotNo: item.shotNo } : null),
        ...(item.stateDescription ? { stateDescription: item.stateDescription } : null),
        ...(item.imageUrl ? { imageUrl: item.imageUrl } : null),
        ...(item.updatedAt ? { updatedAt: item.updatedAt } : null),
      });
    }
  }
  return Array.from(latestByName.values()).slice(0, 12);
}

function normalizeNamedSummaries(items: unknown[]): NamedSummary[] {
  const out: NamedSummary[] = [];
  const seenNames = new Set<string>();
  for (const item of items) {
    if (typeof item === "string") {
      const text = item.trim();
      if (!text || seenNames.has(text)) continue;
      seenNames.add(text);
      out.push({ name: text });
      if (out.length >= 24) break;
      continue;
    }
    const record = readRecord(item);
    if (!record) continue;
    const name = readFirstText(record, ["name", "title", "displayName", "roleName", "characterName"]);
    if (!name || seenNames.has(name)) continue;
    seenNames.add(name);
    const description = readFirstText(record, [
      "description",
      "summary",
      "prompt",
      "appearance",
      "profile",
      "visualPrompt",
    ]);
    out.push(description ? { name, description } : { name });
    if (out.length >= 24) break;
  }
  return out;
}

function renderProjectMarkdown(input: {
  ownerId: string;
  projectId: string;
  projectName?: string;
  projectRoot: string;
  book: BookContextSnapshot | null;
  chapter: number | null;
}): string {
  const lines = [
    "# TapCanvas Project Context",
    "",
    "- 这是项目专属上下文；平台共用规则见工作区 `.tapcanvas/context/GLOBAL_RULES.md`。",
    `- projectId: ${input.projectId}`,
    `- projectName: ${input.projectName || "(unknown)"}`,
    `- ownerId: ${input.ownerId}`,
    `- projectDataRoot: ${input.projectRoot}`,
    `- booksRoot: ${path.join(input.projectRoot, "books")}`,
    `- currentBookId: ${input.book?.bookId || "(none)"}`,
    `- currentChapter: ${input.chapter ? String(input.chapter) : "(none)"}`,
  ];
  if (input.book?.title) lines.push(`- currentBookTitle: ${input.book.title}`);
  if (input.book?.updatedAt) lines.push(`- bookUpdatedAt: ${input.book.updatedAt}`);
  if (typeof input.book?.chapterCount === "number") {
    lines.push(`- chapterCount: ${String(input.book.chapterCount)}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderRulesMarkdown(input: { book: BookContextSnapshot | null }): string {
  const lines = [
    "# Project Rules",
    "",
    "- 这是项目专属规则文件；这里只写当前项目的风格、角色、一致性要求。",
    "- 平台级通用执行规则请查看全局层 `GLOBAL_RULES.md`，不要在此重复。",
  ];
  if (input.book?.styleName) {
    lines.push(`- 当前项目风格锁定：${input.book.styleName}`);
  }
  if (input.book?.storyboardLatest?.tailFrameUrl) {
    lines.push(`- 当前已知最新续写尾帧：${input.book.storyboardLatest.tailFrameUrl}`);
  }
  if (input.book?.styleConsistencyRules.length) {
    lines.push("", "## Style Consistency Rules", "");
    for (const item of input.book.styleConsistencyRules) {
      lines.push(`- ${item}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderCharactersMarkdown(input: { book: BookContextSnapshot | null }): string {
  const lines = ["# Character Context", ""];
  if (!input.book || input.book.characters.length === 0) {
    lines.push("- 当前 book index 未提取到角色卡，请以章节脚本与已生成分镜为准。", "");
    return `${lines.join("\n")}\n`;
  }
  for (const character of input.book.characters) {
    lines.push(`## ${character.name}`, "");
    lines.push(character.description ? `- ${character.description}` : "- 无补充描述");
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function renderStoryStateMarkdown(input: {
  book: BookContextSnapshot | null;
  chapter: number | null;
}): string {
  const lines = ["# Story State", ""];
  if (!input.book) {
    lines.push("- 当前项目尚未解析出可读 book index。", "");
    return `${lines.join("\n")}\n`;
  }
  lines.push(`- bookId: ${input.book.bookId}`);
  lines.push(`- title: ${input.book.title || "(unknown)"}`);
  if (typeof input.book.chapterCount === "number") {
    lines.push(`- chapterCount: ${String(input.book.chapterCount)}`);
  }
  if (input.chapter) {
    const currentChapter = input.book.chapters.find((item) => item.chapter === input.chapter);
    lines.push(`- currentChapter: 第${String(input.chapter)}章${currentChapter?.title ? ` / ${currentChapter.title}` : ""}`);
  }
  if (input.book.updatedAt) {
    lines.push(`- updatedAt: ${input.book.updatedAt}`);
  }
  if (input.book.storyboardLatest) {
    lines.push(
      `- latestStoryboardChunk: chunk=${String(input.book.storyboardLatest.chunkIndex)} shots=${String(input.book.storyboardLatest.shotStart || "?")}-${String(input.book.storyboardLatest.shotEnd || "?")}${input.book.storyboardLatest.tailFrameUrl ? ` tailFrameUrl=${input.book.storyboardLatest.tailFrameUrl}` : ""}`,
    );
  }
  if (input.book.latestCharacterStates.length) {
    lines.push("", "## Latest Character States", "");
    for (const item of input.book.latestCharacterStates) {
      lines.push(
        `- ${item.name}${typeof item.chapter === "number" ? ` | chapter=${String(item.chapter)}` : ""}${typeof item.shotNo === "number" ? ` | shot=${String(item.shotNo)}` : ""}${item.stateDescription ? ` | state=${item.stateDescription}` : ""}${item.imageUrl ? ` | image=${item.imageUrl}` : ""}`,
      );
    }
  }
  if (input.book.recentSemanticAssets.length) {
    lines.push("", "## Recent Semantic Assets", "");
    for (const item of input.book.recentSemanticAssets) {
      lines.push(
        `- ${item.semanticId} | ${item.mediaKind}${item.nodeKind ? ` | nodeKind=${item.nodeKind}` : ""}${typeof item.chapter === "number" ? ` | chapter=${String(item.chapter)}` : ""}${typeof item.shotNo === "number" ? ` | shot=${String(item.shotNo)}` : ""}${item.anchorLabels.length ? ` | anchors=${item.anchorLabels.join("、")}` : ""}${item.stateDescription ? ` | state=${item.stateDescription}` : ""}${item.imageUrl ? ` | image=${item.imageUrl}` : item.videoUrl ? ` | video=${item.videoUrl}` : ""}`,
      );
    }
  }
  if (input.book.styleName) {
    lines.push(`- styleName: ${input.book.styleName}`);
  }
  if (input.book.chapters.length) {
    lines.push("", "## Chapters", "");
    for (const chapter of input.book.chapters) {
      lines.push(`- 第${String(chapter.chapter)}章${chapter.title ? `：${chapter.title}` : ""}`);
    }
  }
  if (input.book.styleVisualDirectives.length) {
    lines.push("", "## Visual Directives", "");
    for (const item of input.book.styleVisualDirectives) {
      lines.push(`- ${item}`);
    }
  }
  if (input.book.styleNegativeDirectives.length) {
    lines.push("", "## Negative Directives", "");
    for (const item of input.book.styleNegativeDirectives) {
      lines.push(`- ${item}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function loadContextFilesFromDir(input: {
  dirPath: string;
  historyDir: string;
  layer: "global" | "project";
  preferredFileNames?: readonly string[];
}): Promise<ProjectWorkspaceContextFileDto[]> {
  const explicitOrder = input.preferredFileNames ? Array.from(input.preferredFileNames) : [];
  const seen = new Set<string>(explicitOrder);
  const extraEntries = await fs.readdir(input.dirPath).catch(() => [] as string[]);
  const allNames = [
    ...explicitOrder,
    ...extraEntries.filter((name) => name.toLowerCase().endsWith(".md") && !seen.has(name)).sort(),
  ];
  const files: ProjectWorkspaceContextFileDto[] = [];
  for (const fileName of allNames) {
    if (!fileName.toLowerCase().endsWith(".md")) continue;
    const loaded = await loadContextFile({
      dirPath: input.dirPath,
      historyDir: input.historyDir,
      fileName,
      layer: input.layer,
    }).catch(() => null);
    if (!loaded) continue;
    files.push(loaded);
  }
  return files;
}

async function loadContextFile(input: {
  dirPath: string;
  historyDir: string;
  fileName: string;
  layer: "global" | "project";
}): Promise<ProjectWorkspaceContextFileDto> {
  const filePath = path.join(input.dirPath, input.fileName);
  const content = await fs.readFile(filePath, "utf8").catch(() => "");
  if (!content.trim()) {
    throw new AppError("Context file not found", { status: 404, code: "context_file_not_found" });
  }
  const meta = await readContextFileMeta(input.historyDir, input.fileName);
  const history = await readContextFileHistory(input.historyDir, input.fileName, input.layer);
  return {
    path: input.layer === "global" ? path.join(".tapcanvas", "context", input.fileName) : path.join(PROJECT_CONTEXT_DIR, input.fileName),
    content,
    layer: input.layer,
    updatedAt: meta?.updatedAt ?? null,
    updatedBy: meta?.updatedBy ?? null,
    history,
  };
}

async function writeContextFileWithHistory(input: {
  filePath: string;
  historyDir: string;
  fileName: string;
  content: string;
  layer: "global" | "project";
  updatedBy: string;
}): Promise<void> {
  const nowIso = new Date().toISOString();
  const versionId = `${nowIso.replace(/[:.]/g, "-")}-${sanitizePathSegment(input.updatedBy)}`;
  await fs.mkdir(path.join(input.historyDir, input.fileName), { recursive: true });
  await fs.writeFile(input.filePath, input.content, "utf8");
  await fs.writeFile(path.join(input.historyDir, `${input.fileName}.meta.json`), JSON.stringify({ updatedAt: nowIso, updatedBy: input.updatedBy }, null, 2), "utf8");
  await fs.writeFile(
    path.join(input.historyDir, input.fileName, `${versionId}.json`),
    JSON.stringify({ versionId, fileName: input.fileName, layer: input.layer, updatedAt: nowIso, updatedBy: input.updatedBy, content: input.content }, null, 2),
    "utf8",
  );
}

async function readContextFileMeta(historyDir: string, fileName: string): Promise<ContextFileMeta | null> {
  const raw = await fs.readFile(path.join(historyDir, `${fileName}.meta.json`), "utf8").catch(() => "");
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as { updatedAt?: unknown; updatedBy?: unknown };
    const updatedAt = readText(parsed.updatedAt);
    const updatedBy = readText(parsed.updatedBy);
    if (!updatedAt || !updatedBy) return null;
    return { updatedAt, updatedBy };
  } catch {
    return null;
  }
}

async function readContextFileHistory(
  historyDir: string,
  fileName: string,
  layer: "global" | "project",
): Promise<ProjectWorkspaceContextFileVersionDto[]> {
  const dirPath = path.join(historyDir, fileName);
  const entries = await fs.readdir(dirPath).catch(() => [] as string[]);
  const out: ProjectWorkspaceContextFileVersionDto[] = [];
  for (const entry of entries.sort().reverse()) {
    if (!entry.toLowerCase().endsWith(".json")) continue;
    const raw = await fs.readFile(path.join(dirPath, entry), "utf8").catch(() => "");
    if (!raw.trim()) continue;
    try {
      const parsed = JSON.parse(raw) as {
        versionId?: unknown;
        fileName?: unknown;
        updatedAt?: unknown;
        updatedBy?: unknown;
      };
      const versionId = readText(parsed.versionId);
      const loadedFileName = readText(parsed.fileName) || fileName;
      const updatedAt = readText(parsed.updatedAt);
      const updatedBy = readText(parsed.updatedBy);
      if (!versionId || !updatedAt || !updatedBy) continue;
      out.push({ versionId, fileName: loadedFileName, layer, updatedAt, updatedBy });
      if (out.length >= HISTORY_LIMIT) break;
    } catch {
      continue;
    }
  }
  return out;
}

async function readContextFileVersionContent(input: {
  historyDir: string;
  fileName: string;
  layer: "global" | "project";
  versionId: string;
}): Promise<ProjectWorkspaceContextFileVersionContentDto> {
  const safeVersionId = sanitizePathSegment(input.versionId);
  if (!safeVersionId) {
    throw new AppError("Invalid versionId", {
      status: 400,
      code: "invalid_context_version_id",
      details: { versionId: input.versionId },
    });
  }
  const filePath = path.join(input.historyDir, input.fileName, `${safeVersionId}.json`);
  const raw = await fs.readFile(filePath, "utf8").catch(() => "");
  if (!raw.trim()) {
    throw new AppError("Context version not found", {
      status: 404,
      code: "context_version_not_found",
      details: { fileName: input.fileName, versionId: input.versionId },
    });
  }
  try {
    const parsed = JSON.parse(raw) as {
      versionId?: unknown;
      fileName?: unknown;
      layer?: unknown;
      updatedAt?: unknown;
      updatedBy?: unknown;
      content?: unknown;
    };
    const versionId = readText(parsed.versionId) || safeVersionId;
    const fileName = readText(parsed.fileName) || input.fileName;
    const updatedAt = readText(parsed.updatedAt);
    const updatedBy = readText(parsed.updatedBy);
    const content = typeof parsed.content === "string" ? parsed.content : "";
    if (!updatedAt || !updatedBy) {
      throw new Error("missing updatedAt/updatedBy");
    }
    return { versionId, fileName, layer: input.layer, updatedAt, updatedBy, content };
  } catch (err) {
    throw new AppError("Context version is invalid", {
      status: 500,
      code: "context_version_invalid",
      details: {
        fileName: input.fileName,
        versionId: input.versionId,
        reason: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

async function writeTextIfChanged(filePath: string, content: string): Promise<void> {
  const current = await fs.readFile(filePath, "utf8").catch(() => "");
  if (current === content) return;
  await fs.writeFile(filePath, content, "utf8");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseJsonRecord(raw: string): UnknownRecord | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return readRecord(parsed);
  } catch {
    return null;
  }
}

function readRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readFirstText(record: UnknownRecord, keys: string[]): string {
  for (const key of keys) {
    const text = readText(record[key]);
    if (text) return text;
  }
  return "";
}

function readTextArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = readText(item);
    if (!text || out.includes(text)) continue;
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.trunc(parsed);
  if (normalized <= 0) return null;
  return normalized;
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.trunc(parsed);
  if (normalized < 0) return null;
  return normalized;
}

function normalizeNullableText(value: unknown): string | null {
  const text = readText(value);
  return text || null;
}

function normalizeProjectContextFileName(value: string): ProjectContextFileName | null {
  const trimmed = String(value || "").trim();
  return PROJECT_CONTEXT_FILE_NAMES.includes(trimmed as ProjectContextFileName)
    ? (trimmed as ProjectContextFileName)
    : null;
}

function normalizeGlobalContextFileName(value: string): GlobalContextFileName | null {
  const trimmed = String(value || "").trim();
  return GLOBAL_CONTEXT_FILE_NAMES.includes(trimmed as GlobalContextFileName)
    ? (trimmed as GlobalContextFileName)
    : null;
}
