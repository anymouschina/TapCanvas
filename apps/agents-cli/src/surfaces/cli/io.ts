export async function readPromptFromStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}

export function previewToolCallOutput(name: string, output: string): void {
  if (name === "Skill") {
    console.log("\n> Loading skill");
    console.log(`  Skill loaded (${output.length} chars)`);
    return;
  }
  if (name === "write_stdin") {
    const parsed = safeParseJsonRecord(output);
    if (parsed) {
      const hasSessionId = typeof parsed.session_id === "number";
      const hasExitCode = typeof parsed.exit_code === "number";
      const text = typeof parsed.output === "string" ? parsed.output : "";
      if (!hasExitCode && hasSessionId && text.trim().length === 0) {
        console.log("\n• Waited for background terminal");
        return;
      }
      if (text.trim().length > 0) {
        console.log("\n↳ Interacted with background terminal");
        console.log(`  ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}`);
        return;
      }
    }
  }
  const preview = output.length > 200 ? `${output.slice(0, 200)}...` : output;
  console.log(`\n> ${name}`);
  console.log(`  ${preview}`);
}

function safeParseJsonRecord(input: string): Record<string, unknown> | null {
  const text = String(input || "").trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
