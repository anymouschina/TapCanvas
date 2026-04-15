import type { Message } from "../../types/index.js";

export type TranscriptKind = "system" | "user" | "assistant" | "tool" | "status";

export type TranscriptEntry = {
  kind: TranscriptKind;
  title: string;
  body: string;
  accent: "info" | "selected" | "status";
};

export function buildTranscriptSeed(
  messages: Message[],
  limit = 20,
): TranscriptEntry[] {
  return messages
    .filter((message) => message.ephemeral !== true)
    .slice(-Math.max(0, limit))
    .map((message): TranscriptEntry | null => {
      const body = String(message.content || "").trim();
      if (!body) return null;
      if (message.role === "user") {
        return { kind: "user", title: "You", body, accent: "info" };
      }
      if (message.role === "assistant") {
        return { kind: "assistant", title: "Assistant", body, accent: "selected" };
      }
      return {
        kind: "tool",
        title: message.toolCallId ? `Tool · ${message.toolCallId}` : "Tool",
        body,
        accent: "status",
      };
    })
    .filter((item): item is TranscriptEntry => item !== null);
}
