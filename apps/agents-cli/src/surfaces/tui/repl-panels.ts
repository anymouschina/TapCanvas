import type { LlmTurnTrace, ToolCallTrace } from "../../core/hooks/types.js";
import type { SessionSummary } from "../../core/memory/session.js";
import type { RuntimeRunEvent } from "../../runtime/events.js";
import type { TranscriptEntry } from "./repl-transcript.js";

const MAX_TIMELINE_ITEMS = 8;

export type TimelineRunStatus = "idle" | "running" | "completed" | "failed";

export type TimelineState = {
  runCount: number;
  status: TimelineRunStatus;
  lastSessionId: string | null;
  lastSummary: string;
  items: TranscriptEntry[];
};

export type SessionPickerState = {
  active: boolean;
  selected: number;
  items: SessionSummary[];
};

export function createTimelineState(): TimelineState {
  return {
    runCount: 0,
    status: "idle",
    lastSessionId: null,
    lastSummary: "等待输入",
    items: [],
  };
}

export function createSessionPickerState(): SessionPickerState {
  return {
    active: false,
    selected: 0,
    items: [],
  };
}

export function recordTimelineRuntimeEvent(state: TimelineState, event: RuntimeRunEvent): void {
  if (event.type === "run.started") {
    state.runCount += 1;
    state.status = "running";
    state.lastSessionId = event.sessionId ?? state.lastSessionId;
    state.lastSummary = `Run ${state.runCount} 执行中`;
    pushTimelineItem(state, {
      kind: "status",
      title: `Run ${state.runCount} · started`,
      body: `开始执行${event.sessionId ? ` · session=${event.sessionId}` : ""}`,
      accent: "status",
    });
    return;
  }
  if (event.type === "run.completed") {
    state.status = "completed";
    state.lastSummary = `Run ${state.runCount || 1} 完成`;
    pushTimelineItem(state, {
      kind: "status",
      title: `Run ${state.runCount || 1} · completed`,
      body: previewText(event.result, 180) || "(空结果)",
      accent: "status",
    });
    return;
  }
  if (event.type === "run.failed") {
    state.status = "failed";
    state.lastSummary = `Run ${state.runCount || 1} 失败`;
    pushTimelineItem(state, {
      kind: "system",
      title: `Run ${state.runCount || 1} · failed`,
      body: event.message,
      accent: "info",
    });
    return;
  }
  if (event.type === "tool.started") {
    state.lastSummary = `${event.name} 开始执行`;
    pushTimelineItem(state, {
      kind: "status",
      title: `${event.name} · started`,
      body: "工具执行开始",
      accent: "status",
    });
    return;
  }
  if (event.type === "todo.updated") {
    state.lastSummary = `Checklist ${event.todo.completedCount}/${event.todo.totalCount}`;
    pushTimelineItem(state, {
      kind: "status",
      title: "Todo Updated",
      body: event.todo.items.map((item) => `[${item.status}] ${item.text}`).join("\n"),
      accent: "status",
    });
  }
}

export function recordTimelineToolCall(state: TimelineState, toolCall: ToolCallTrace): void {
  pushTimelineItem(state, {
    kind: "tool",
    title: `${toolCall.name} · ${toolCall.status}`,
    body: previewText(toolCall.output, 180) || "(无输出)",
    accent: toolCall.status === "succeeded" ? "status" : "info",
  });
  state.lastSummary = `${toolCall.name} · ${toolCall.status}`;
}

export function recordTimelineTurn(state: TimelineState, turn: LlmTurnTrace): void {
  if (turn.toolCallCount <= 0) return;
  pushTimelineItem(state, {
    kind: "status",
    title: `Turn ${turn.turn}`,
    body: `调用工具：${turn.toolNames.join(", ")}`,
    accent: "status",
  });
  state.lastSummary = `Turn ${turn.turn} 完成`;
}

export function buildTimelineEntries(state: TimelineState): TranscriptEntry[] {
  const summary = `${renderStatusLabel(state.status)} · ${state.lastSummary}${state.lastSessionId ? ` · ${state.lastSessionId}` : ""}`;
  return [
    {
      kind: "status",
      title: "Run Timeline",
      body: summary,
      accent: "status",
    },
    ...state.items,
  ];
}

export function openSessionPicker(
  state: SessionPickerState,
  summaries: SessionSummary[],
  currentSessionKey: string | null,
): void {
  state.items = summaries;
  state.active = summaries.length > 0;
  const selectedIndex = summaries.findIndex((item) => item.key === currentSessionKey);
  state.selected = selectedIndex >= 0 ? selectedIndex : 0;
}

export function closeSessionPicker(state: SessionPickerState): void {
  state.active = false;
}

export function moveSessionPickerSelection(
  state: SessionPickerState,
  direction: "up" | "down",
): void {
  if (!state.active || state.items.length === 0) return;
  if (direction === "up") {
    state.selected = (state.selected - 1 + state.items.length) % state.items.length;
    return;
  }
  state.selected = (state.selected + 1) % state.items.length;
}

export function getSelectedSessionKey(state: SessionPickerState): string | null {
  return state.items[state.selected]?.key ?? null;
}

export function buildSessionPickerEntry(
  state: SessionPickerState,
  currentSessionKey: string | null,
): TranscriptEntry | null {
  if (!state.active || state.items.length === 0) return null;
  const lines = state.items.map((item, index) => {
    const marker = index === state.selected ? ">" : " ";
    const current = item.key === currentSessionKey ? "current" : "resume";
    return `${marker} ${item.key} · ${current} · ${item.messageCount} msgs · ${item.preview}`;
  });
  return {
    kind: "status",
    title: "Session Picker",
    body: lines.join("\n"),
    accent: "selected",
  };
}

function pushTimelineItem(state: TimelineState, item: TranscriptEntry): void {
  state.items.push(item);
  if (state.items.length > MAX_TIMELINE_ITEMS) {
    state.items.splice(0, state.items.length - MAX_TIMELINE_ITEMS);
  }
}

function previewText(value: string, limit: number): string {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

function renderStatusLabel(status: TimelineRunStatus): string {
  switch (status) {
    case "running":
      return "运行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return "空闲";
  }
}
