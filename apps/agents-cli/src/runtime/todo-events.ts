import type { ToolCallTrace } from "../core/hooks/types.js";

export type RuntimeTodoItem = {
  text: string;
  completed: boolean;
  status: "pending" | "in_progress" | "completed";
};

export type RuntimeTodoUpdate = {
  sourceToolCallId: string;
  items: RuntimeTodoItem[];
  totalCount: number;
  completedCount: number;
  inProgressCount: number;
  pendingCount: number;
};

export function parseRuntimeTodoUpdate(toolCall: ToolCallTrace): RuntimeTodoUpdate | null {
  if (toolCall.status !== "succeeded") return null;
  if (String(toolCall.name || "").trim() !== "TodoWrite") return null;

  const items: RuntimeTodoItem[] = [];
  for (const line of String(toolCall.output || "").split(/\r?\n/u)) {
    const match = line.match(/^\[(x|>| )\]\s+(.+)$/iu);
    if (!match) continue;
    const marker = match[1]?.toLowerCase() ?? " ";
    const text = String(match[2] || "").trim();
    if (!text) continue;
    const status =
      marker === "x" ? "completed" : marker === ">" ? "in_progress" : "pending";
    items.push({
      text,
      completed: status === "completed",
      status,
    });
  }

  if (items.length === 0) return null;
  const completedCount = items.filter((item) => item.status === "completed").length;
  const inProgressCount = items.filter((item) => item.status === "in_progress").length;

  return {
    sourceToolCallId: toolCall.toolCallId,
    items,
    totalCount: items.length,
    completedCount,
    inProgressCount,
    pendingCount: Math.max(items.length - completedCount - inProgressCount, 0),
  };
}
