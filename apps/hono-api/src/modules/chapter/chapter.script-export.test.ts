import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";
import { encodeWorkflowOutput } from "../execution/execution.output-storage";
import { parseScriptExportSelection } from "../../../../../packages/schemas/chapter-script-export";

const mocks = vi.hoisted(() => ({ project: vi.fn(), chapters: vi.fn(), runs: vi.fn(), output: vi.fn() }));
vi.mock("../project/project.repo", () => ({ getProjectForUserAccess: mocks.project }));
import { exportChapterScriptsForUser, listChapterScriptPlansForUser, readChapterScriptPlan } from "./chapter.script-export";

const c = { env: { DB: { chapters: { findMany: mocks.chapters },
  workflow_node_runs: { findMany: mocks.runs, findFirst: mocks.output } } } } as unknown as AppContext;
const clips = [
  { itemId: "later", index: 1, durationSeconds: 8, prompt: "第二段原文\n对白：走吧。" },
  { itemId: "first", index: 0, durationSeconds: 12, prompt: "  第一段原文，保留空格。\n" },
];
const promptPackage = { artifactType: "tapcanvas.prompt-package/v2", clips };
const output = (ports: Record<string, unknown>) => JSON.stringify(encodeWorkflowOutput({
  protocolVersion: "1", executorRef: "test", nodeId: "film:clip-production-pipeline", executionMode: "once",
  ports, artifacts: [], evidence: {}, itemRuns: [],
}));
const chapter = (id: string, index: number, sortOrder = index, sourceBookChapter: number | null = null) => ({
  id, chapter_index: index, sort_order: sortOrder, source_book_chapter: sourceBookChapter,
  created_at: "2026-10-24T00:00:00.000Z", title: `第${index}章`,
});
const run = (chapterId: string, executionId: string, date: string) => ({ execution_id: executionId,
  node_id: "film:clip-production-pipeline", created_at: date, finished_at: date,
  workflow_executions: { canvas_id: `chapter:${chapterId}`, status: "running" } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.project.mockResolvedValue({ id: "project", owner_id: "user", name: "原书" });
  mocks.chapters.mockResolvedValue([chapter("one", 1), chapter("two", 2)]);
  mocks.runs.mockResolvedValue([run("two", "run-two", "2026-10-25"), run("one", "run-one", "2026-10-24")]);
  mocks.output.mockResolvedValue({ output_refs: output({ "prompt-package": promptPackage }) });
});

describe("persisted chapter script export", () => {
  it("exports selected chapters in book order with verbatim prompts, even before video completion", async () => {
    const file = await exportChapterScriptsForUser(c, "user", "project", ["two", "one"]);
    expect(file.fileName).toBe("原书-剧本-2集.txt");
    expect(file.text.indexOf("第1集　第1章")).toBeLessThan(file.text.indexOf("第2集　第2章"));
    expect(file.text).toContain("  第一段原文，保留空格。\n");
    expect(file.text.indexOf(clips[1].prompt)).toBeLessThan(file.text.indexOf(clips[0].prompt));
    expect(file.text).toContain("时长：约 20 秒 · 2 个片段");
    expect(mocks.runs.mock.calls[0][0].where.workflow_executions).toEqual({
      owner_id: "user", project_id: "project", canvas_id: { in: ["chapter:one", "chapter:two"] },
    });
    expect(mocks.chapters.mock.calls[0][0].where).toEqual({ owner_id: "user", project_id: "project" });
    expect(mocks.output.mock.calls[0][0].where.workflow_executions.owner_id).toBe("user");
  });

  it("lists only saved prompts and returns factual duration and clip count", async () => {
    mocks.runs.mockResolvedValue([run("one", "run-one", "2026-10-24")]);
    expect(await listChapterScriptPlansForUser(c, "user", "project")).toEqual([{
      chapterId: "one", chapterIndex: 1, title: "第1章", executionId: "run-one", executionStatus: "running",
      plannedAt: "2026-10-24", clipCount: 2, durationSeconds: 20,
    }]);
  });

  it.each([
    {
      name: "source-book order overrides conflicting sort order",
      chapters: [chapter("one", 1, 10, 1), chapter("three", 3, 20, 3), chapter("two", 2, 30, 2)],
      expected: ["one", "two", "three"],
      titles: ["第1章", "第2章", "第3章"],
    },
    {
      name: "mapped chapters precede unmapped chapters in their respective order",
      chapters: [chapter("draft-a", 5, 10), chapter("draft-b", 6, 20), chapter("two", 2, 30, 2), chapter("one", 1, 40, 1)],
      expected: ["one", "two", "draft-a", "draft-b"],
      titles: ["第1章", "第2章", "第5章", "第6章"],
    },
  ])("keeps the selector and TXT in chapter-list order when $name", async ({ chapters, expected, titles }) => {
    mocks.chapters.mockResolvedValue(chapters);
    mocks.runs.mockResolvedValue(chapters.map(item => run(item.id, `run-${item.id}`, "2026-10-24")));

    const plans = await listChapterScriptPlansForUser(c, "user", "project");
    expect(plans.map(plan => plan.chapterId)).toEqual(expected);

    const file = await exportChapterScriptsForUser(c, "user", "project", [...expected].reverse());
    const episodeHeaders = file.text.split("\n").filter(line => line.startsWith("第") && line.includes("集　"));
    expect(episodeHeaders).toEqual(titles.map((title, index) => `第${index + 1}集　${title}`));
  });

  it("refuses an inaccessible project before querying any scripts", async () => {
    mocks.project.mockResolvedValue(null);
    await expect(exportChapterScriptsForUser(c, "intruder", "project", ["one"])).rejects.toMatchObject({ code: "project_not_found" });
    expect(mocks.chapters).not.toHaveBeenCalled();
    expect(mocks.runs).not.toHaveBeenCalled();
  });

  it("rejects chapters outside the authorized project before reading output", async () => {
    await expect(exportChapterScriptsForUser(c, "user", "project", ["foreign"])).rejects.toMatchObject({ code: "script_export_chapter_unknown" });
    expect(mocks.runs).not.toHaveBeenCalled();
  });

  it("reports missing saved content without generating or filling prompts", async () => {
    mocks.runs.mockResolvedValue([]);
    await expect(exportChapterScriptsForUser(c, "user", "project", ["one"])).rejects.toMatchObject({ code: "script_export_plan_missing" });
  });

  it("does not silently export an older package when the latest saved output is corrupt", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.runs.mockResolvedValue([run("one", "new", "2026-10-25"), run("one", "old", "2026-10-24")]);
    mocks.output.mockResolvedValue({ output_refs: "corrupt" });
    await expect(exportChapterScriptsForUser(c, "user", "project", ["one"])).rejects.toMatchObject({
      code: "script_export_plan_invalid", details: { chapterId: "one", executionId: "new" },
    });
    expect(mocks.output).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ executionId: "new", userId: "user" }));
    error.mockRestore();
  });

  it("rejects malformed clip content and invalid selections rather than inventing defaults", () => {
    expect(() => readChapterScriptPlan({ ...promptPackage, clips: [...clips, null] })).toThrow();
    expect(() => readChapterScriptPlan({ ...promptPackage, clips: [{ ...clips[0], durationSeconds: undefined }] })).toThrow();
    expect(() => readChapterScriptPlan({ ...promptPackage, clips: [{ ...clips[0], prompt: " " }] })).toThrow();
    for (const chapterIds of [[], ["one", "one"], ["one", 42], Array.from({ length: 201 }, (_, index) => String(index))]) {
      expect(() => parseScriptExportSelection({ chapterIds })).toThrow();
    }
  });
});
