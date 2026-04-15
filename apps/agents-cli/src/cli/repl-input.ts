import readline from "node:readline";

import type { LlmTurnTrace, ToolCallTrace } from "../core/hooks/types.js";
import { SkillLoader } from "../core/skills/loader.js";
import {
  buildSuggestions,
  refreshSkills,
  shouldApplySuggestionOnEnter,
  type SuggestionState,
} from "../surfaces/tui/repl-suggestions.js";
import {
  buildTranscriptSeed,
  type TranscriptEntry,
} from "../surfaces/tui/repl-transcript.js";
import {
  buildSessionPickerEntry,
  closeSessionPicker,
  createSessionPickerState,
  createTimelineState,
  getSelectedSessionKey,
  moveSessionPickerSelection,
  openSessionPicker,
  recordTimelineRuntimeEvent,
  recordTimelineToolCall,
  recordTimelineTurn,
  type SessionPickerState,
  type TimelineState,
} from "../surfaces/tui/repl-panels.js";
import type { SessionSummary } from "../core/memory/session.js";
import type { Message } from "../types/index.js";
import type { RuntimeRunEvent } from "../runtime/events.js";

type PromptHistoryState = {
  entries: string[];
  index: number;
  draft: string;
};

type InputParserState = {
  inPaste: boolean;
  pasteBuffer: string;
  pendingEscape: string;
};

type ComposerMode = "editing" | "running";

type ReplPromptOptions = {
  prompt: string;
};

type ReplTuiOptions = {
  skills: SkillLoader;
  historyEntries: string[];
  onCopyLastAssistant?: () => Promise<string> | string;
  contextLabel?: string;
};

const graphemeSegmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("en", { granularity: "grapheme" })
    : null;
const COMBINING_OR_VARIATION = /[\p{Mark}\u200d\ufe0e\ufe0f]/u;
const ONLY_COMBINING = /^[\p{Mark}\u200d\ufe0e\ufe0f]+$/u;
const EXTENDED_PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const CONTINUATION_PREFIX = "… ";
const SOFT_WRAP_PREFIX = "  ";
const MAX_TRANSCRIPT_ITEMS = 120;
const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  cyanBright: "\x1b[96m",
  gray: "\x1b[90m",
  white: "\x1b[37m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
};
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

function splitGraphemes(value: string): string[] {
  if (!value) return [];
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(value), (item) => item.segment);
  }
  return Array.from(value);
}

function isFullwidthCodePoint(codePoint: number) {
  if (codePoint >= 0x1100 && (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0x3247 && codePoint !== 0x303f) ||
    (codePoint >= 0x3250 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0xa4c6) ||
    (codePoint >= 0xa960 && codePoint <= 0xa97c) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6b) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1b000 && codePoint <= 0x1b001) ||
    (codePoint >= 0x1f200 && codePoint <= 0x1f251) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  )) {
    return true;
  }
  return false;
}

function graphemeWidth(value: string) {
  if (!value) return 0;
  if (ONLY_COMBINING.test(value)) return 0;
  if (EXTENDED_PICTOGRAPHIC.test(value)) return 2;
  const codePoint = value.codePointAt(0);
  if (codePoint === undefined) return 0;
  if ((codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f)) return 0;
  if (COMBINING_OR_VARIATION.test(value)) {
    const stripped = value.replaceAll(COMBINING_OR_VARIATION, "");
    if (!stripped) return 0;
    return graphemeWidth(stripped);
  }
  return isFullwidthCodePoint(codePoint) ? 2 : 1;
}

function stringDisplayWidth(value: string) {
  return splitGraphemes(value).reduce((sum, item) => sum + graphemeWidth(item), 0);
}

function stripAnsi(value: string) {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

export function lineRenderRows(value: string, columns: number) {
  const width = stringDisplayWidth(stripAnsi(value));
  const safeColumns = Math.max(1, columns);
  return Math.max(1, Math.ceil(Math.max(1, width) / safeColumns));
}

type WrappedComposerRow = {
  text: string;
  startOffset: number;
  endOffset: number;
};

function wrapComposerLine(
  line: string,
  prefix: string,
  width: number,
): WrappedComposerRow[] {
  const safeWidth = Math.max(8, width);
  const rows: WrappedComposerRow[] = [];
  const graphemes = splitGraphemes(line);
  let rowText = prefix;
  let rowWidth = stringDisplayWidth(prefix);
  let rowStart = 0;
  let consumed = 0;

  if (graphemes.length === 0) {
    return [{ text: prefix, startOffset: 0, endOffset: 0 }];
  }

  for (const grapheme of graphemes) {
    const widthDelta = graphemeWidth(grapheme);
    if (rowWidth + widthDelta > safeWidth && consumed > rowStart) {
      rows.push({ text: rowText, startOffset: rowStart, endOffset: consumed });
      rowText = SOFT_WRAP_PREFIX;
      rowWidth = stringDisplayWidth(SOFT_WRAP_PREFIX);
      rowStart = consumed;
    }
    rowText += grapheme;
    rowWidth += widthDelta;
    consumed += grapheme.length;
  }

  rows.push({ text: rowText, startOffset: rowStart, endOffset: consumed });
  return rows;
}

function previousCodePointIndex(value: string, index: number) {
  if (index <= 0) return 0;
  const prev = value.charCodeAt(index - 1);
  if (index > 1 && prev >= 0xdc00 && prev <= 0xdfff) {
    const high = value.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return index - 2;
  }
  return index - 1;
}

function nextCodePointIndex(value: string, index: number) {
  if (index >= value.length) return value.length;
  const first = value.charCodeAt(index);
  if (first >= 0xd800 && first <= 0xdbff && index + 1 < value.length) {
    const low = value.charCodeAt(index + 1);
    if (low >= 0xdc00 && low <= 0xdfff) return index + 2;
  }
  return index + 1;
}

function countNewlines(value: string) {
  let total = 0;
  for (const char of value) {
    if (char === "\n") total += 1;
  }
  return total;
}

function findLineStart(value: string, cursor: number) {
  let index = cursor;
  while (index > 0 && value[index - 1] !== "\n") {
    index -= 1;
  }
  return index;
}

function findLineEnd(value: string, cursor: number) {
  let index = cursor;
  while (index < value.length && value[index] !== "\n") {
    index += 1;
  }
  return index;
}

function deletePreviousWord(value: string, cursor: number) {
  if (cursor <= 0) return { value, cursor };
  let nextCursor = cursor;
  while (nextCursor > 0 && /\s/.test(value[nextCursor - 1] || "")) {
    nextCursor = previousCodePointIndex(value, nextCursor);
  }
  while (nextCursor > 0 && !/\s/.test(value[nextCursor - 1] || "")) {
    nextCursor = previousCodePointIndex(value, nextCursor);
  }
  return {
    value: `${value.slice(0, nextCursor)}${value.slice(cursor)}`,
    cursor: nextCursor,
  };
}

function style(text: string, ...codes: string[]) {
  return `${codes.join("")}${text}${ANSI.reset}`;
}

function truncateDisplay(value: string, width: number) {
  const plain = stripAnsi(value);
  if (stringDisplayWidth(plain) <= width) return value;
  const graphemes = splitGraphemes(plain);
  let out = "";
  let used = 0;
  for (const item of graphemes) {
    const nextWidth = used + graphemeWidth(item);
    if (nextWidth >= Math.max(0, width - 1)) break;
    out += item;
    used = nextWidth;
  }
  return `${out}…`;
}

function padDisplay(value: string, width: number) {
  const plain = stripAnsi(value);
  const padding = Math.max(0, width - stringDisplayWidth(plain));
  return `${value}${" ".repeat(padding)}`;
}

function wrapPlainText(value: string, width: number): string[] {
  const safeWidth = Math.max(8, width);
  const lines = value.split("\n");
  const wrapped: string[] = [];
  for (const line of lines) {
    if (!line) {
      wrapped.push("");
      continue;
    }
    let current = "";
    let currentWidth = 0;
    for (const grapheme of splitGraphemes(line)) {
      const widthDelta = graphemeWidth(grapheme);
      if (currentWidth + widthDelta > safeWidth) {
        wrapped.push(current);
        current = grapheme;
        currentWidth = widthDelta;
      } else {
        current += grapheme;
        currentWidth += widthDelta;
      }
    }
    wrapped.push(current);
  }
  return wrapped.length > 0 ? wrapped : [""];
}

export function clampTranscriptBodyLines(
  kind: TranscriptEntry["kind"],
  bodyLines: string[],
): string[] {
  const maxLines =
    kind === "assistant" ? Number.POSITIVE_INFINITY :
    kind === "user" ? Number.POSITIVE_INFINITY :
    kind === "tool" ? 6 :
    kind === "system" ? 4 :
    4;
  if (bodyLines.length <= maxLines) return bodyLines;
  const hiddenCount = bodyLines.length - (maxLines - 1);
  return [
    ...bodyLines.slice(0, maxLines - 1),
    `… (+${hiddenCount} more lines)`,
  ];
}

function buildPanelLines(title: string, bodyLines: string[], width: number, accent: "info" | "selected" | "status") {
  const innerWidth = Math.max(10, width - 4);
  const borderColor = accent === "selected" ? ANSI.cyanBright : ANSI.gray;
  const titleColor = accent === "selected" ? ANSI.cyanBright : ANSI.white;
  const top = `${borderColor}┌${"─".repeat(innerWidth + 2)}┐${ANSI.reset}`;
  const header = `${borderColor}│${ANSI.reset} ${padDisplay(style(truncateDisplay(title, innerWidth), ANSI.bold, titleColor), innerWidth)} ${borderColor}│${ANSI.reset}`;
  const rows = bodyLines.map((line) => `${borderColor}│${ANSI.reset} ${padDisplay(truncateDisplay(line, innerWidth), innerWidth)} ${borderColor}│${ANSI.reset}`);
  const bottom = `${borderColor}└${"─".repeat(innerWidth + 2)}┘${ANSI.reset}`;
  return [top, header, ...rows, bottom];
}

function renderReplFooter(
  mode: ComposerMode,
  input: string,
  contextLabel: string,
  status: string,
  queuedCount: number,
) {
  const lineCount = countNewlines(input) + 1;
  const summary = lineCount > 1 ? `当前 ${lineCount} 行` : "单行输入";
  const modeLabel = mode === "running" ? "运行中" : "编辑中";
  const statusText = status.trim() ? ` · ${status.trim()}` : "";
  const queueText = queuedCount > 0 ? ` · queued=${queuedCount}` : "";
  return `${modeLabel} · ${summary} · ${contextLabel}${statusText}${queueText}  [Enter]发送  [Ctrl+J]换行  [Up/Down]历史  [Tab]补全  [Ctrl+Y]复制回复`;
}

export function renderReplHelp() {
  return [
    "TUI 操作清单：",
    "1. 上下键浏览历史输入；有斜杠提示时，上下键切换候选。",
    "2. Tab 或右箭头补全当前斜杠候选；支持 /help /copy /clear /status /sessions /resume <id> /new [id] 和 /skill <name>。",
    "3. Ctrl+J 插入换行，可直接编辑多行 prompt；终端粘贴多行文本会原样保留。",
    "4. Ctrl+Y 复制最后一条 assistant 回复到系统剪贴板。",
    "5. Ctrl+A / Ctrl+E 跳到当前行首尾，Ctrl+W 删前一个词，Ctrl+U 清空输入。",
    "6. /status 查看当前 profile/session/runtime，/sessions 查看最近会话，/resume <id> 恢复会话。",
    "7. /sessions 会打开 session picker；可用上下键切换，Enter 恢复，Esc 关闭。",
    "8. 底部 composer 固定显示；发送后进入运行态，完成后回到编辑态。",
  ].join("\n");
}

export { buildTranscriptSeed } from "../surfaces/tui/repl-transcript.js";

function promptLine(label: string) {
  return new Promise<string>((resolve) => {
    process.stdout.write(label);
    process.stdin.resume();
    process.stdin.once("data", (data) => {
      resolve(String(data).trim());
    });
  });
}

export class ReplTui {
  private suggestionState: SuggestionState;
  private historyState: PromptHistoryState;
  private parserState: InputParserState = {
    inPaste: false,
    pasteBuffer: "",
    pendingEscape: "",
  };
  private transcript: TranscriptEntry[] = [];
  private promptLabel = "You: ";
  private composerInput = "";
  private composerCursor = 0;
  private composerMode: ComposerMode = "editing";
  private composerStatus = "";
  private queuedPrompts: string[] = [];
  private renderedRows = 0;
  private composerAnchorActive = false;
  private dataListener?: (chunk: Buffer | string) => void;
  private resolvePrompt?: (value: string | null) => void;
  private lastAssistantReply = "";
  private currentAssistantIndex: number | null = null;
  private contextLabel: string;
  private timelineState: TimelineState = createTimelineState();
  private sessionPickerState: SessionPickerState = createSessionPickerState();

  constructor(private options: ReplTuiOptions) {
    this.suggestionState = {
      active: false,
      allSkills: refreshSkills(this.options.skills),
      list: [],
      selected: 0,
    };
    this.historyState = {
      entries: [...options.historyEntries],
      index: -1,
      draft: "",
    };
    this.contextLabel = options.contextLabel ?? "session=ephemeral";
  }

  addHistoryEntry(input: string) {
    if (!input.trim()) return;
    if (this.historyState.entries[this.historyState.entries.length - 1] === input) return;
    this.historyState.entries.push(input);
  }

  clearTranscript() {
    this.transcript = [];
    this.currentAssistantIndex = null;
    this.timelineState = createTimelineState();
    this.composerStatus = "已清空 transcript。";
    this.render();
  }

  addSystemNote(text: string) {
    const entry = {
      kind: "system",
      title: "System",
      body: text,
      accent: "status",
    } satisfies TranscriptEntry;
    this.pushTranscript(entry);
    this.printTranscriptEntry(entry);
  }

  setContextLabel(label: string) {
    this.contextLabel = label;
    this.render();
  }

  hydrateTranscript(messages: Message[]) {
    this.transcript = buildTranscriptSeed(messages);
    this.currentAssistantIndex = null;
    for (let index = this.transcript.length - 1; index >= 0; index -= 1) {
      if (this.transcript[index]?.kind === "assistant") {
        this.lastAssistantReply = this.transcript[index]?.body ?? "";
        break;
      }
    }
    for (const entry of this.transcript) {
      this.printTranscriptEntry(entry);
    }
  }

  applyRuntimeEvent(event: RuntimeRunEvent) {
    recordTimelineRuntimeEvent(this.timelineState, event);
    let shouldRender = false;
    if (event.type === "run.started") {
      this.composerStatus = "执行中…";
      shouldRender = true;
    }
    if (event.type === "run.completed") {
      this.composerStatus = "执行完成";
      shouldRender = true;
    }
    if (event.type === "run.failed") {
      this.composerStatus = `运行失败：${event.message}`;
      shouldRender = true;
    }
    if (event.type === "tool.started" || event.type === "todo.updated") {
      shouldRender = true;
    }
    if (shouldRender) {
      this.render();
    }
  }

  addUserMessage(text: string) {
    const entry = {
      kind: "user",
      title: "You",
      body: text,
      accent: "info",
    } satisfies TranscriptEntry;
    this.pushTranscript(entry);
    this.printTranscriptEntry(entry);
    this.currentAssistantIndex = null;
  }

  startRun() {
    this.composerMode = "running";
    this.composerStatus = "执行中…";
    this.composerInput = "";
    this.composerCursor = 0;
    this.currentAssistantIndex = null;
    closeSessionPicker(this.sessionPickerState);
    this.render();
  }

  finishRun() {
    this.composerMode = "editing";
    this.composerStatus =
      this.queuedPrompts.length > 0
        ? `已排队 ${this.queuedPrompts.length} 条消息`
        : "";
    this.currentAssistantIndex = null;
  }

  takeQueuedPrompt(): string | null {
    const next = this.queuedPrompts.shift() ?? null;
    if (next === null && this.composerMode === "editing" && this.composerStatus.startsWith("已排队")) {
      this.composerStatus = "";
    }
    return next;
  }

  appendAssistantDelta(delta: string) {
    const text = String(delta || "");
    if (!text) return;
    if (this.currentAssistantIndex === null) {
      this.currentAssistantIndex = this.pushTranscript({
        kind: "assistant",
        title: "Assistant",
        body: "",
        accent: "selected",
      });
    }
    const current = this.transcript[this.currentAssistantIndex];
    current.body += text;
    this.lastAssistantReply = current.body;
  }

  addToolCall(toolCall: ToolCallTrace) {
    recordTimelineToolCall(this.timelineState, toolCall);
    const preview =
      toolCall.output.trim().length > 240
        ? `${toolCall.output.trim().slice(0, 240)}…`
        : toolCall.output.trim() || "(无输出)";
    const entry = {
      kind: "tool",
      title: `${toolCall.name} · ${toolCall.status}`,
      body: preview,
      accent: toolCall.status === "succeeded" ? "status" : "info",
    } satisfies TranscriptEntry;
    this.pushTranscript(entry);
    this.printTranscriptEntry(entry);
    this.composerStatus = `${toolCall.name} 已执行`;
  }

  addTurnSummary(turn: LlmTurnTrace) {
    recordTimelineTurn(this.timelineState, turn);
    if (turn.toolCallCount <= 0) return;
    const entry = {
      kind: "status",
      title: `Turn ${turn.turn}`,
      body: `调用工具：${turn.toolNames.join(", ")}`,
      accent: "status",
    } satisfies TranscriptEntry;
    this.pushTranscript(entry);
    this.printTranscriptEntry(entry);
  }

  finalizeAssistant(result: string) {
    if (!this.lastAssistantReply.trim() && result.trim()) {
      const entry = {
        kind: "assistant",
        title: "Assistant",
        body: result,
        accent: "selected",
      } satisfies TranscriptEntry;
      this.pushTranscript(entry);
      this.lastAssistantReply = result;
      this.printTranscriptEntry(entry);
    } else if (this.lastAssistantReply.trim()) {
      this.printTranscriptEntry({
        kind: "assistant",
        title: "Assistant",
        body: this.lastAssistantReply,
        accent: "selected",
      });
    }
    this.finishRun();
  }

  openSessionPicker(summaries: SessionSummary[], currentSessionKey: string | null) {
    openSessionPicker(this.sessionPickerState, summaries, currentSessionKey);
    this.composerStatus =
      summaries.length > 0
        ? "选择会话后按 Enter 恢复，Esc 关闭。"
        : "当前没有可恢复的会话。";
    this.render();
  }

  async copyLastAssistantReply(): Promise<string> {
    if (!this.options.onCopyLastAssistant) {
      return "当前没有可复制的 assistant 回复。";
    }
    const message = await Promise.resolve(this.options.onCopyLastAssistant());
    this.composerStatus = message;
    this.render();
    return message;
  }

  async promptForInput(prompt: ReplPromptOptions): Promise<string | null> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return promptLine(prompt.prompt);
    }

    this.promptLabel = prompt.prompt;
    this.composerMode = "editing";
    this.composerInput = "";
    this.composerCursor = 0;
    this.composerStatus = "";
    this.historyState.index = -1;
    this.historyState.draft = "";
    this.enableRawMode();
    this.attachInputListener();
    this.render();

    return await new Promise<string | null>((resolve) => {
      this.resolvePrompt = resolve;
    });
  }

  shutdown() {
    this.detachInputListener();
    this.disableRawMode();
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[?25h");
      process.stdout.write("\x1b[?2004l");
      this.clearRenderedArea();
    }
  }

  private pushTranscript(entry: TranscriptEntry) {
    this.transcript.push(entry);
    if (this.transcript.length > MAX_TRANSCRIPT_ITEMS) {
      const overflow = this.transcript.length - MAX_TRANSCRIPT_ITEMS;
      this.transcript.splice(0, overflow);
      if (this.currentAssistantIndex !== null) {
        this.currentAssistantIndex = Math.max(0, this.currentAssistantIndex - overflow);
      }
    }
    return this.transcript.length - 1;
  }

  private updateSuggestions() {
    this.suggestionState.allSkills = refreshSkills(this.options.skills);
    this.suggestionState.list = buildSuggestions(this.composerInput, this.suggestionState.allSkills);
    this.suggestionState.active = this.composerInput.trimStart().startsWith("/");
    if (this.suggestionState.selected >= this.suggestionState.list.length) {
      this.suggestionState.selected = Math.max(0, this.suggestionState.list.length - 1);
    }
  }

  private renderComposerPanel(columns: number) {
    const innerWidth = Math.max(10, columns - 4);
    const inputLines = this.composerInput.split("\n");
    const wrappedLines = inputLines.flatMap((line, index) =>
      wrapComposerLine(
        line,
        index === 0 ? this.promptLabel : CONTINUATION_PREFIX,
        innerWidth,
      ),
    );
    const decorated = wrappedLines.map((row) => style(row.text, ANSI.cyan));
    const title = this.composerMode === "running" ? "Composer · Running" : "Composer";
    const panelLines = buildPanelLines(title, decorated, columns, "info");
    let cursorCol = 2;
    let cursorRowOffset = 2;

    {
      const logicalLines = this.composerInput.split("\n");
      let rawIndex = 0;
      let lineIndex = 0;
      let lineOffset = 0;
      for (let index = 0; index < logicalLines.length; index += 1) {
        const lineLength = logicalLines[index].length;
        if (this.composerCursor <= rawIndex + lineLength) {
          lineIndex = index;
          lineOffset = this.composerCursor - rawIndex;
          break;
        }
        rawIndex += lineLength + 1;
        lineIndex = index + 1;
        lineOffset = 0;
      }

      const priorWrappedRows = logicalLines
        .slice(0, lineIndex)
        .reduce(
          (sum, line, index) =>
            sum +
            wrapComposerLine(
              line,
              index === 0 ? this.promptLabel : CONTINUATION_PREFIX,
              innerWidth,
            ).length,
          0,
        );

      const currentLine = logicalLines[lineIndex] ?? "";
      const prefix = lineIndex === 0 ? this.promptLabel : CONTINUATION_PREFIX;
      const currentWrappedRows = wrapComposerLine(currentLine, prefix, innerWidth);
      const activeRow =
        currentWrappedRows.find(
          (row) => lineOffset >= row.startOffset && lineOffset <= row.endOffset,
        ) ?? currentWrappedRows[currentWrappedRows.length - 1] ?? { text: prefix, startOffset: 0, endOffset: 0 };
      const activeRowIndex = Math.max(0, currentWrappedRows.indexOf(activeRow));
      const rowPrefix = activeRowIndex === 0 ? prefix : SOFT_WRAP_PREFIX;
      const cursorText = `${rowPrefix}${currentLine.slice(activeRow.startOffset, lineOffset)}`;

      cursorRowOffset += priorWrappedRows + activeRowIndex;
      cursorCol = 2 + stringDisplayWidth(cursorText);
    }

    if (this.suggestionState.active) {
      const suggestionLines =
        this.suggestionState.list.length > 0
          ? this.suggestionState.list.map((item, index) => {
              const marker = index === this.suggestionState.selected ? "›" : " ";
              const content = `${marker} ${item.label}  ${item.description}`;
              return index === this.suggestionState.selected
                ? style(content, ANSI.bold, ANSI.white)
                : style(content, ANSI.gray);
            })
          : [style("无匹配项", ANSI.gray)];
      panelLines.push(...buildPanelLines("Suggestions", suggestionLines, columns, "selected"));
    }

    const sessionPickerEntry = buildSessionPickerEntry(
      this.sessionPickerState,
      this.extractSessionKeyFromContext(),
    );
    if (sessionPickerEntry) {
      panelLines.push(
        ...buildPanelLines(
          sessionPickerEntry.title,
          sessionPickerEntry.body.split("\n"),
          columns,
          sessionPickerEntry.accent,
        ),
      );
    }

    panelLines.push(
      style(
        renderReplFooter(
          this.composerMode,
          this.composerInput,
          this.contextLabel,
          this.composerStatus,
          this.queuedPrompts.length,
        ),
        ANSI.dim,
      ),
    );
    return { lines: panelLines, cursorCol, cursorRowOffset };
  }

  private render() {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return;
    this.updateSuggestions();
    const stdout = process.stdout;
    const columns = Math.max(40, stdout.columns || 80);
    const composer = this.renderComposerPanel(columns);
    const screenLines = [...composer.lines];
    const totalRows = screenLines.reduce((sum, line) => sum + lineRenderRows(line, columns), 0);

    this.clearRenderedArea();
    stdout.write("\x1b[s");
    this.composerAnchorActive = true;
    for (const line of screenLines) {
      stdout.write(`${line}\n`);
    }

    this.renderedRows = totalRows;
    stdout.write("\x1b[u");
    readline.moveCursor(stdout, 0, composer.cursorRowOffset);
    readline.cursorTo(stdout, composer.cursorCol);
    stdout.write("\x1b[?25h");
  }

  private enableRawMode() {
    if (process.stdin.isTTY) {
      process.stdin.resume();
      process.stdin.setRawMode(true);
      process.stdout.write("\x1b[?2004h");
    }
  }

  private disableRawMode() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdout.write("\x1b[?2004l");
    }
  }

  private attachInputListener() {
    if (this.dataListener) return;
    this.dataListener = (chunk: Buffer | string) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      this.processChunk(text);
    };
    process.stdin.on("data", this.dataListener);
  }

  private detachInputListener() {
    if (!this.dataListener) return;
    process.stdin.off("data", this.dataListener);
    this.dataListener = undefined;
  }

  private resolveCurrentPrompt(value: string | null) {
    const resolver = this.resolvePrompt;
    this.resolvePrompt = undefined;
    resolver?.(value);
  }

  private setComposerInput(next: string) {
    this.composerInput = next;
    this.composerCursor = Math.min(this.composerCursor, this.composerInput.length);
    this.historyState.draft = this.composerInput;
  }

  private insertText(text: string) {
    const normalized = text.replace(/\r\n/g, "\n");
    if (!normalized) return;
    this.composerInput =
      `${this.composerInput.slice(0, this.composerCursor)}${normalized}${this.composerInput.slice(this.composerCursor)}`;
    this.composerCursor += normalized.length;
    this.historyState.draft = this.composerInput;
    if (normalized.includes("\n")) {
      this.composerStatus = `已粘贴 ${countNewlines(normalized) + 1} 行文本。`;
    } else {
      this.composerStatus = "";
    }
  }

  private navigateHistory(direction: "up" | "down") {
    const input = this.composerInput;
    if (this.historyState.entries.length === 0) return;
    if (direction === "up") {
      if (this.historyState.index === -1) {
        this.historyState.draft = input;
        this.historyState.index = this.historyState.entries.length - 1;
      } else if (this.historyState.index > 0) {
        this.historyState.index -= 1;
      }
      this.setComposerInput(this.historyState.entries[this.historyState.index]);
      this.composerCursor = this.composerInput.length;
      return;
    }
    if (this.historyState.index === -1) return;
    if (this.historyState.index < this.historyState.entries.length - 1) {
      this.historyState.index += 1;
      this.setComposerInput(this.historyState.entries[this.historyState.index]);
    } else {
      this.historyState.index = -1;
      this.setComposerInput(this.historyState.draft);
    }
    this.composerCursor = this.composerInput.length;
  }

  private maybeApplySuggestion() {
    if (!this.suggestionState.active || this.suggestionState.list.length === 0) return false;
    const next = this.suggestionState.list[this.suggestionState.selected]?.insertText ?? this.composerInput;
    if (next === this.composerInput) return false;
    this.composerInput = next;
    this.composerCursor = next.length;
    this.historyState.draft = next;
    return true;
  }

  private submitPrompt() {
    const submitted = this.composerInput.trim();
    if (!submitted) {
      this.composerStatus = this.composerMode === "running" ? "运行中，空消息未加入队列" : "";
      this.render();
      return;
    }
    this.composerInput = "";
    this.composerCursor = 0;
    this.historyState.index = -1;
    this.historyState.draft = "";

    if (this.resolvePrompt) {
      this.composerMode = "running";
      this.composerStatus = "执行中…";
      this.render();
      this.resolveCurrentPrompt(submitted);
      return;
    }

    this.queuedPrompts.push(submitted);
    this.composerMode = "running";
    this.composerStatus = `已排队 ${this.queuedPrompts.length} 条消息`;
    this.render();
  }

  private processControl(code: string) {
    if (this.sessionPickerState.active) {
      if (code === "\x03") {
        this.detachInputListener();
        this.disableRawMode();
        this.resolveCurrentPrompt(null);
        return true;
      }
      if (code === "\r") {
        const sessionKey = getSelectedSessionKey(this.sessionPickerState);
        if (sessionKey) {
          closeSessionPicker(this.sessionPickerState);
          this.composerInput = `/resume ${sessionKey}`;
          this.composerCursor = this.composerInput.length;
          this.submitPrompt();
          return true;
        }
      }
      return false;
    }
    if (code === "\x03") {
      this.detachInputListener();
      this.disableRawMode();
      this.resolveCurrentPrompt(null);
      return true;
    }
    if (code === "\x19") {
      void this.copyLastAssistantReply();
      return true;
    }
    if (code === "\x0c") {
      this.render();
      return true;
    }
    if (code === "\x01") {
      this.composerCursor = findLineStart(this.composerInput, this.composerCursor);
      this.render();
      return true;
    }
    if (code === "\x05") {
      this.composerCursor = findLineEnd(this.composerInput, this.composerCursor);
      this.render();
      return true;
    }
    if (code === "\x15") {
      this.composerInput = "";
      this.composerCursor = 0;
      this.historyState.index = -1;
      this.historyState.draft = "";
      this.composerStatus = "";
      this.render();
      return true;
    }
    if (code === "\x0b") {
      this.composerInput = this.composerInput.slice(0, this.composerCursor);
      this.historyState.draft = this.composerInput;
      this.render();
      return true;
    }
    if (code === "\x17") {
      const next = deletePreviousWord(this.composerInput, this.composerCursor);
      this.composerInput = next.value;
      this.composerCursor = next.cursor;
      this.historyState.draft = this.composerInput;
      this.render();
      return true;
    }
    if (code === "\x0a") {
      this.insertText("\n");
      this.render();
      return true;
    }
    return false;
  }

  private processEscape(sequence: string) {
    if (this.sessionPickerState.active) {
      if (sequence === "\x1b[A") {
        moveSessionPickerSelection(this.sessionPickerState, "up");
        this.render();
        return true;
      }
      if (sequence === "\x1b[B") {
        moveSessionPickerSelection(this.sessionPickerState, "down");
        this.render();
        return true;
      }
      if (sequence === "\x1b") {
        closeSessionPicker(this.sessionPickerState);
        this.composerStatus = "已关闭 session picker。";
        this.render();
        return true;
      }
    }
    if (sequence === "\x1b[A") {
      if (this.suggestionState.active && this.suggestionState.list.length > 0) {
        this.suggestionState.selected =
          (this.suggestionState.selected - 1 + this.suggestionState.list.length) % this.suggestionState.list.length;
      } else {
        this.navigateHistory("up");
      }
      this.render();
      return true;
    }
    if (sequence === "\x1b[B") {
      if (this.suggestionState.active && this.suggestionState.list.length > 0) {
        this.suggestionState.selected = (this.suggestionState.selected + 1) % this.suggestionState.list.length;
      } else {
        this.navigateHistory("down");
      }
      this.render();
      return true;
    }
    if (sequence === "\x1b[C") {
      if (this.suggestionState.active && this.suggestionState.list.length > 0 && this.composerCursor >= this.composerInput.length) {
        this.maybeApplySuggestion();
      } else {
        this.composerCursor = nextCodePointIndex(this.composerInput, this.composerCursor);
      }
      this.render();
      return true;
    }
    if (sequence === "\x1b[D") {
      this.composerCursor = previousCodePointIndex(this.composerInput, this.composerCursor);
      this.render();
      return true;
    }
    if (sequence === "\x1b[H" || sequence === "\x1bOH" || sequence === "\x1b[1~" || sequence === "\x1b[7~") {
      this.composerCursor = 0;
      this.render();
      return true;
    }
    if (sequence === "\x1b[F" || sequence === "\x1bOF" || sequence === "\x1b[4~" || sequence === "\x1b[8~") {
      this.composerCursor = this.composerInput.length;
      this.render();
      return true;
    }
    if (sequence === "\x1b[3~") {
      if (this.composerCursor < this.composerInput.length) {
        const next = nextCodePointIndex(this.composerInput, this.composerCursor);
        this.composerInput = `${this.composerInput.slice(0, this.composerCursor)}${this.composerInput.slice(next)}`;
        this.historyState.draft = this.composerInput;
        this.render();
      }
      return true;
    }
    return false;
  }

  private processText(text: string) {
    for (const char of text) {
      if (this.sessionPickerState.active && char === "\x1b") {
        closeSessionPicker(this.sessionPickerState);
        this.composerStatus = "已关闭 session picker。";
        this.render();
        continue;
      }
      if (this.processControl(char)) continue;
      if (char === "\r") {
        if (shouldApplySuggestionOnEnter(this.composerInput, this.suggestionState)) {
          this.maybeApplySuggestion();
          this.render();
          continue;
        }
        this.submitPrompt();
        continue;
      }
      if (char === "\t") {
        this.maybeApplySuggestion();
        this.render();
        continue;
      }
      if (char === "\x7f" || char === "\b") {
        if (this.composerCursor > 0) {
          const prev = previousCodePointIndex(this.composerInput, this.composerCursor);
          this.composerInput = `${this.composerInput.slice(0, prev)}${this.composerInput.slice(this.composerCursor)}`;
          this.composerCursor = prev;
          this.historyState.draft = this.composerInput;
        }
        this.render();
        continue;
      }
      this.insertText(char);
      this.historyState.index = -1;
      this.render();
    }
  }

  private processChunk(chunk: string) {
    let rest = `${this.parserState.pendingEscape}${chunk}`;
    this.parserState.pendingEscape = "";

    while (rest.length > 0) {
      if (this.sessionPickerState.active && rest === "\x1b") {
        this.processEscape("\x1b");
        return;
      }

      if (this.parserState.inPaste) {
        const endIndex = rest.indexOf(PASTE_END);
        if (endIndex === -1) {
          this.parserState.pasteBuffer += rest;
          return;
        }
        this.parserState.pasteBuffer += rest.slice(0, endIndex);
        this.insertText(this.parserState.pasteBuffer);
        this.parserState.inPaste = false;
        this.parserState.pasteBuffer = "";
        rest = rest.slice(endIndex + PASTE_END.length);
        this.render();
        continue;
      }

      const pasteIndex = rest.indexOf(PASTE_START);
      if (pasteIndex === 0) {
        this.parserState.inPaste = true;
        this.parserState.pasteBuffer = "";
        rest = rest.slice(PASTE_START.length);
        continue;
      }
      if (pasteIndex > 0) {
        this.processText(rest.slice(0, pasteIndex));
        rest = rest.slice(pasteIndex);
        continue;
      }

      if (rest.startsWith("\x1b[")) {
        const match = rest.match(/^\x1b\[[0-9;?]*[~A-Za-z]/u);
        if (!match) {
          this.parserState.pendingEscape = rest;
          return;
        }
        this.processEscape(match[0]);
        rest = rest.slice(match[0].length);
        continue;
      }

      if (rest.startsWith("\x1bO")) {
        const match = rest.match(/^\x1bO[A-Za-z]/u);
        if (!match) {
          this.parserState.pendingEscape = rest;
          return;
        }
        this.processEscape(match[0]);
        rest = rest.slice(match[0].length);
        continue;
      }

      if (rest.startsWith("\x1b")) {
        if (rest.length === 1) {
          this.parserState.pendingEscape = rest;
          return;
        }
        rest = rest.slice(1);
        continue;
      }

      const escapeAt = rest.indexOf("\x1b");
      if (escapeAt === -1) {
        this.processText(rest);
        return;
      }
      this.processText(rest.slice(0, escapeAt));
      rest = rest.slice(escapeAt);
    }
  }

  private printTranscriptEntry(entry: TranscriptEntry): void {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return;
    const stdout = process.stdout;
    const columns = Math.max(40, stdout.columns || 80);
    const innerWidth = Math.max(10, columns - 4);
    const styledBody = clampTranscriptBodyLines(entry.kind, wrapPlainText(entry.body, innerWidth)).map((line) => {
      switch (entry.kind) {
        case "user":
          return style(line, ANSI.cyan);
        case "assistant":
          return style(line, ANSI.white, ANSI.bold);
        case "tool":
          return style(line, ANSI.yellow);
        case "system":
          return style(line, ANSI.magenta);
        case "status":
          return style(line, ANSI.gray);
      }
    });
    const lines = buildPanelLines(entry.title, styledBody, columns, entry.accent);
    this.clearRenderedArea();
    for (const line of lines) {
      stdout.write(`${line}\n`);
    }
    this.render();
  }

  private clearRenderedArea(): void {
    if (!process.stdout.isTTY) return;
    if (this.composerAnchorActive) {
      process.stdout.write("\x1b[u");
      this.composerAnchorActive = false;
    }
    readline.cursorTo(process.stdout, 0);
    readline.clearScreenDown(process.stdout);
    this.renderedRows = 0;
  }

  private extractSessionKeyFromContext(): string | null {
    const match = this.contextLabel.match(/session=([^\s]+)/u);
    return match?.[1] ?? null;
  }
}
