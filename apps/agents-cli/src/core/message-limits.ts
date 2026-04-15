const DEFAULT_MAX_TOOL_OUTPUT_CHARS = 200_000;
const MIN_MAX_TOOL_OUTPUT_CHARS = 4_096;
const BASH_COMPACT_MIN_LINES = 80;
const BASH_HEAD_LINES = 12;
const BASH_TAIL_LINES = 20;
const BASH_MAX_SIGNAL_LINES = 24;

type LineSample = {
  index: number;
  text: string;
};

export function getMaxToolOutputChars(): number {
  const raw = Number(process.env.AGENTS_MAX_TOOL_OUTPUT_CHARS ?? DEFAULT_MAX_TOOL_OUTPUT_CHARS);
  if (!Number.isFinite(raw)) return DEFAULT_MAX_TOOL_OUTPUT_CHARS;
  return Math.max(MIN_MAX_TOOL_OUTPUT_CHARS, Math.trunc(raw));
}

export function normalizeToolOutput(content: string, label: string): string {
  if (typeof content !== "string") return `[${label}] (non-string output)`;
  if (content.length === 0) return `[${label}] (empty output)`;

  const compacted = compactToolOutput(content, label);
  if (compacted !== content) {
    content = compacted;
  }

  const maxChars = getMaxToolOutputChars();
  if (content.length <= maxChars) return content;

  const reserved = 512;
  const budget = Math.max(1_024, maxChars - reserved);
  const head = Math.max(512, Math.floor(budget * 0.7));
  const tail = Math.max(256, budget - head);
  const prefix = content.slice(0, head);
  const suffix = content.slice(Math.max(head, content.length - tail));
  const omittedChars = Math.max(0, content.length - prefix.length - suffix.length);

  console.warn(`[agents] ${label} exceeded max tool output size: original=${content.length} limit=${maxChars} omitted=${omittedChars}`);

  return [
    prefix,
    `\n\n[${label}] output truncated before sending to LLM: original=${content.length} chars, limit=${maxChars} chars, omitted=${omittedChars} chars. Adjust AGENTS_MAX_TOOL_OUTPUT_CHARS if you intentionally need a larger payload.`,
    suffix ? `\n\n[${label}] tail preview:\n${suffix}` : "",
  ].join("");
}

function compactToolOutput(content: string, label: string): string {
  const normalized = stripAnsi(content);
  if (label !== "tool:bash") return normalized;

  const lines = normalized.replace(/\r\n/g, "\n").split("\n");
  if (lines.length < BASH_COMPACT_MIN_LINES) return normalized;

  const nonEmptyLineCount = lines.filter((line) => line.trim().length > 0).length;
  const signalSamples = collectSignalSamples(lines, BASH_MAX_SIGNAL_LINES);
  const headSamples = collectBoundarySamples(lines, 0, BASH_HEAD_LINES);
  const tailSamples = collectBoundarySamples(lines, Math.max(0, lines.length - BASH_TAIL_LINES), lines.length);
  const mergedSamples = mergeSamples(headSamples, signalSamples, tailSamples);

  const omittedLineCount = Math.max(0, lines.length - mergedSamples.length);
  const repeatedLineCount = countRepeatedLines(lines);
  const summary = [
    `[${label}] compacted noisy command output: ${lines.length} lines, ${normalized.length} chars, ${nonEmptyLineCount} non-empty lines, ${signalSamples.length} signal lines, ${repeatedLineCount} repeated adjacent lines omitted from raw flow.`,
    `[${label}] showing head/signal/tail excerpts only. If exact raw output is required, rerun a narrower command or redirect to a file and inspect with read_file_range.`,
  ].join("\n");

  if (mergedSamples.length === 0) {
    return `${summary}\n[${label}] no representative lines remained after compaction.`;
  }

  const excerpt = renderSamples(mergedSamples);
  return `${summary}\n[${label}] omitted ${omittedLineCount} lines from the middle of the raw output.\n\n${excerpt}`;
}

function stripAnsi(content: string): string {
  return content.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function collectSignalSamples(lines: string[], limit: number): LineSample[] {
  const samples: LineSample[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    if (!isSignalLine(text)) continue;
    samples.push({ index, text });
    if (samples.length >= limit) break;
  }
  return samples;
}

function collectBoundarySamples(lines: string[], start: number, end: number): LineSample[] {
  const samples: LineSample[] = [];
  for (let index = start; index < end; index += 1) {
    if (index < 0 || index >= lines.length) continue;
    samples.push({ index, text: lines[index] });
  }
  return samples;
}

function mergeSamples(...groups: LineSample[][]): LineSample[] {
  const byIndex = new Map<number, string>();
  for (const group of groups) {
    for (const sample of group) {
      byIndex.set(sample.index, sample.text);
    }
  }
  return Array.from(byIndex.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([index, text]) => ({ index, text }));
}

function renderSamples(samples: LineSample[]): string {
  const rendered: string[] = [];
  let previousIndex: number | null = null;

  for (const sample of samples) {
    if (previousIndex !== null && sample.index > previousIndex + 1) {
      rendered.push(`[... omitted ${sample.index - previousIndex - 1} lines ...]`);
    }
    rendered.push(`${sample.index + 1}| ${sample.text}`);
    previousIndex = sample.index;
  }

  return rendered.join("\n");
}

function countRepeatedLines(lines: string[]): number {
  let repeated = 0;
  let previousFingerprint = "";

  for (const line of lines) {
    const fingerprint = line.trim();
    if (!fingerprint) {
      previousFingerprint = fingerprint;
      continue;
    }
    if (fingerprint === previousFingerprint) {
      repeated += 1;
    }
    previousFingerprint = fingerprint;
  }

  return repeated;
}

function isSignalLine(line: string): boolean {
  const normalized = line.trim().toLowerCase();
  if (!normalized) return false;

  return [
    "error",
    "failed",
    "failure",
    "exception",
    "traceback",
    "warn",
    "warning",
    "cannot",
    "not found",
    "enoent",
    "eacces",
    "syntaxerror",
    "typeerror",
    "referenceerror",
    "stderr",
  ].some((needle) => normalized.includes(needle));
}
