import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  loadChapterSourceText,
  parseChapterIdParts,
  resolveChapterTextForOrchestrate,
} from "./video-orchestrator.chapter-source";

describe("parseChapterIdParts", () => {
  it("book-<dir>-chN 解析；书目录名含连字符/下划线也正确", () => {
    expect(parseChapterIdParts("book-_______________-1783266177207-ch24")).toEqual({
      bookDirName: "_______________-1783266177207",
      chapter: 24,
    });
    expect(parseChapterIdParts("book-abc-ch3")).toEqual({ bookDirName: "abc", chapter: 3 });
  });

  it("非法输入返回 null", () => {
    expect(parseChapterIdParts("")).toBeNull();
    expect(parseChapterIdParts("flow-xyz")).toBeNull();
    expect(parseChapterIdParts("book-abc-ch0")).toBeNull();
    expect(parseChapterIdParts(undefined)).toBeNull();
  });
});

describe("resolveChapterTextForOrchestrate（服务端权威自加载·2026-07-13 ch24 断供根治）", () => {
  let tmpRoot: string;
  const projectId = "proj-1";
  const ownerId = "user-1";
  const bookDir = "mybook-123";
  const chapterBody = "孟川御剑抵达东海之滨。他一步踏入海中，分水而下。";

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "chapter-source-"));
    const bookRoot = path.join(
      tmpRoot,
      "project-data",
      "users",
      ownerId,
      "projects",
      projectId,
      "books",
      bookDir,
    );
    await fs.mkdir(bookRoot, { recursive: true });
    const raw = `第1章 启程\n无关内容。\n第2章 东海\n${chapterBody}\n第3章 后续\n`;
    await fs.writeFile(path.join(bookRoot, "raw.md"), raw, "utf8");
    const start = raw.indexOf("第2章");
    const end = raw.indexOf("第3章");
    await fs.writeFile(
      path.join(bookRoot, "index.json"),
      JSON.stringify({
        bookId: bookDir,
        projectId,
        chapters: [{ chapter: 2, startOffset: start, endOffset: end }],
      }),
      "utf8",
    );
    // resolveProjectDataRepoRoot 按 pnpm-workspace.yaml 认根：临时目录放一个假标记文件
    await fs.writeFile(path.join(tmpRoot, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("调用方已传非空 chapterText → 原样返回（快路径零 I/O）", async () => {
    const text = await resolveChapterTextForOrchestrate({
      chapterText: "已有原文",
      chapterId: "book-x-ch1",
      projectId: "p",
      ownerId: "u",
    });
    expect(text).toBe("已有原文");
  });

  it("chapterId 不合法/缺 project·owner → 空串（旧行为零回归）", async () => {
    expect(
      await resolveChapterTextForOrchestrate({ chapterId: "not-a-chapter", projectId: "p", ownerId: "u" }),
    ).toBe("");
    expect(
      await resolveChapterTextForOrchestrate({ chapterId: "book-a-ch1", projectId: "", ownerId: "u" }),
    ).toBe("");
  });

  it("loadChapterSourceText：raw.md offset 切片读章（与 book_chapter_get 同源读法）", async () => {
    const text = await loadChapterSourceText({
      projectId,
      ownerId,
      bookDirName: bookDir,
      chapter: 2,
      repoRoot: tmpRoot,
    });
    expect(text).toContain("孟川御剑抵达东海之滨");
    expect(text).not.toContain("第3章");
    const missing = await loadChapterSourceText({
      projectId,
      ownerId,
      bookDirName: bookDir,
      chapter: 99,
      repoRoot: tmpRoot,
    });
    expect(missing).toBe("");
  });
});
