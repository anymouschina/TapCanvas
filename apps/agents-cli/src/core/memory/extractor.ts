import type { LLMClient } from "../../llm/client.js";

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export async function extractMemoryInsights(input: {
  client: LLMClient;
  model?: string;
  prompt: string;
  resultText: string;
  toolSummary: string[];
  abortSignal?: AbortSignal;
}): Promise<string[]> {
  const prompt = String(input.prompt || "").trim();
  const resultText = String(input.resultText || "").trim();
  if (!resultText) return [];
  const insights = uniqueStrings([
    input.toolSummary.length > 0 ? `successful_run_path: ${input.toolSummary.slice(-3).join("; ")}` : "",
    prompt ? `latest_user_goal: ${prompt.slice(0, 160)}` : "",
    resultText ? `latest_delivery: ${resultText.slice(0, 160)}` : "",
  ]).slice(0, 4);
  return insights;
}
