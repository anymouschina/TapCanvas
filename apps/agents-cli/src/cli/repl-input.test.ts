import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTranscriptSeed,
  clampTranscriptBodyLines,
  lineRenderRows,
  ReplTui,
  renderReplHelp,
} from "./repl-input.js";
import { SkillLoader } from "../core/skills/loader.js";

test("renderReplHelp documents the new interaction features", () => {
  const help = renderReplHelp();
  assert.match(help, /Ctrl\+J 插入换行/);
  assert.match(help, /Ctrl\+Y 复制最后一条 assistant 回复/);
  assert.match(help, /\/copy/);
  assert.match(help, /\/sessions/);
  assert.match(help, /\/resume <id>/);
  assert.match(help, /session picker/);
});

test("buildTranscriptSeed turns session history into visible transcript entries", () => {
  const entries = buildTranscriptSeed([
    { role: "user", content: "先继续第三章" },
    { role: "assistant", content: "好的，继续第三章。" },
    { role: "tool", content: '{"ok":true}', toolCallId: "tool_1" },
  ]);

  assert.equal(entries.length, 3);
  assert.equal(entries[0]?.title, "You");
  assert.equal(entries[1]?.title, "Assistant");
  assert.match(entries[2]?.title ?? "", /tool_1/);
});

test("buildTranscriptSeed restores a larger recent history window by default", () => {
  const entries = buildTranscriptSeed(
    Array.from({ length: 24 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `message-${index + 1}`,
    })),
  );

  assert.equal(entries.length, 20);
  assert.equal(entries[0]?.body, "message-5");
  assert.equal(entries[19]?.body, "message-24");
});

test("session picker closes on a standalone escape key", () => {
  const repl = new ReplTui({
    skills: new SkillLoader([]),
    historyEntries: [],
  });
  repl.openSessionPicker(
    [
      {
        key: "chapter-1",
        safeKey: "chapter-1__hash",
        updatedAt: "2026-04-10T00:00:00.000Z",
        messageCount: 3,
        preview: "继续第一章",
      },
    ],
    null,
  );

  (
    repl as unknown as {
      processChunk: (chunk: string) => void;
      sessionPickerState: { active: boolean };
    }
  ).processChunk("\x1b");

  assert.equal(
    (
      repl as unknown as {
        sessionPickerState: { active: boolean };
      }
    ).sessionPickerState.active,
    false,
  );
});

test("lineRenderRows does not overcount exact-width lines", () => {
  assert.equal(lineRenderRows("1234", 4), 1);
  assert.equal(lineRenderRows("12345", 4), 2);
});

test("clampTranscriptBodyLines preserves more history by truncating long assistant bodies", () => {
  const lines = clampTranscriptBodyLines("assistant", [
    "l1",
    "l2",
    "l3",
    "l4",
    "l5",
    "l6",
  ]);

  assert.equal(lines.length, 6);
  assert.equal(lines[5], "l6");
});

test("clampTranscriptBodyLines still trims oversized tool output", () => {
  const lines = clampTranscriptBodyLines("tool", [
    "l1",
    "l2",
    "l3",
    "l4",
    "l5",
    "l6",
    "l7",
  ]);

  assert.equal(lines.length, 6);
  assert.match(lines[5] ?? "", /\+2 more lines/);
});

test("submit while running queues the prompt instead of dropping it", () => {
  const repl = new ReplTui({
    skills: new SkillLoader([]),
    historyEntries: [],
  });

  const internal = repl as unknown as {
    composerMode: "editing" | "running";
    composerInput: string;
    submitPrompt: () => void;
    takeQueuedPrompt: () => string | null;
  };

  internal.composerMode = "running";
  internal.composerInput = "继续处理第二个任务";
  internal.submitPrompt();

  assert.equal(repl.takeQueuedPrompt(), "继续处理第二个任务");
  assert.equal(repl.takeQueuedPrompt(), null);
});

test("processChunk keeps later messages from the same stdin batch", () => {
  const repl = new ReplTui({
    skills: new SkillLoader([]),
    historyEntries: [],
  });

  const internal = repl as unknown as {
    processChunk: (chunk: string) => void;
    resolvePrompt: ((value: string | null) => void) | undefined;
    composerMode: "editing" | "running";
    composerInput: string;
  };

  const submitted: Array<string | null> = [];
  internal.resolvePrompt = (value) => {
    submitted.push(value);
  };
  internal.composerMode = "editing";
  internal.composerInput = "";

  internal.processChunk("hello\rsecond\r");

  assert.deepEqual(submitted, ["hello"]);
  assert.equal(repl.takeQueuedPrompt(), "second");
});

test("composer panel soft-wraps long input instead of truncating it", () => {
  const repl = new ReplTui({
    skills: new SkillLoader([]),
    historyEntries: [],
  });

  const internal = repl as unknown as {
    composerInput: string;
    composerCursor: number;
    renderComposerPanel: (columns: number) => {
      lines: string[];
      cursorCol: number;
      cursorRowOffset: number;
    };
  };

  internal.composerInput = "abcdefghijklmnopqrstuvwxyz";
  internal.composerCursor = internal.composerInput.length;
  const panel = internal.renderComposerPanel(20);

  assert.ok(panel.lines.some((line) => line.includes("abcdefghij")));
  assert.ok(panel.lines.some((line) => line.includes("klmnopqrst")));
  assert.ok(panel.lines.some((line) => line.includes("uvwxyz")));
  assert.equal(panel.lines.some((line) => line.includes("…")), false);
  assert.ok(panel.cursorRowOffset > 2);
});

test("composer panel preserves explicit multiline input while wrapping later rows", () => {
  const repl = new ReplTui({
    skills: new SkillLoader([]),
    historyEntries: [],
  });

  const internal = repl as unknown as {
    composerInput: string;
    composerCursor: number;
    renderComposerPanel: (columns: number) => {
      lines: string[];
      cursorCol: number;
      cursorRowOffset: number;
    };
  };

  internal.composerInput = "first line\nsecond line is definitely longer";
  internal.composerCursor = internal.composerInput.length;
  const panel = internal.renderComposerPanel(22);

  assert.ok(panel.lines.some((line) => line.includes("You: first line")));
  assert.ok(panel.lines.some((line) => line.includes("… second line")));
  assert.ok(panel.lines.some((line) => line.includes("definitely")));
  assert.ok(panel.lines.some((line) => line.includes("longer")));
});
