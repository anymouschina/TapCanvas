import { createHash } from "node:crypto";
import type { PrismaClient } from "../../types";

export type ImageUnderstandingEvidence = Readonly<{
  referenceId: string;
  text: string;
  question: string;
  provenance: Readonly<{
    version: 1;
    mediaType: "image";
    source: "persisted_task_result";
    taskId: string;
    modelKey: string;
    referenceId: string;
    promptHash: string;
    analysisHash: string;
    analyzedAt: string;
  }>;
}>;

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function parse(value: string): Record<string, unknown> | null {
  return record(JSON.parse(value) as unknown);
}

/** Match server-resolved media identities, never filenames or model descriptions.
 * The full successful result is authoritative; truncated diagnostic responses
 * must never become an analysis. Observations remain model evidence, not user facts.
 */
export async function loadImageUnderstandingEvidence(input: {
  db: Pick<PrismaClient, "vendor_api_call_logs" | "task_results">;
  ownerId: string;
  references: readonly Readonly<{ referenceId: string; url: string }>[];
  before?: string;
  contentKey?: string;
  requestedAnalysis?: Readonly<{ promptHash: string; modelKey: string }>;
}): Promise<ImageUnderstandingEvidence[]> {
  if (input.references.length === 0) return [];
  const urls = [...new Set(input.references.map((reference) => reference.url))];
  const logs = await input.db.vendor_api_call_logs.findMany({
    where: {
      user_id: input.ownerId,
      task_kind: "image_to_prompt",
      status: "succeeded",
      ...(input.before ? { finished_at: { lte: input.before } } : {}),
      OR: (input.contentKey ? [input.contentKey] : urls).map((value) => ({ request_json: { contains: JSON.stringify(value).slice(1, -1) } })),
    },
    select: { task_id: true, request_json: true, finished_at: true },
    orderBy: [{ finished_at: "desc" }, { task_id: "asc" }],
  });
  const matched = logs.flatMap((log) => {
    try {
      const request = log.request_json ? record(parse(log.request_json)?.request) : null;
      const extras = record(request?.extras);
      if (request?.kind !== "image_to_prompt" || typeof request.prompt !== "string"
        || typeof extras?.imageUrl !== "string"
        || (input.contentKey ? extras.imageUnderstandingKey !== input.contentKey : !urls.includes(extras.imageUrl))
        || typeof extras.modelKey !== "string" || !log.finished_at) return [];
      if (input.requestedAnalysis && (hash(request.prompt) !== input.requestedAnalysis.promptHash
        || extras.modelKey !== input.requestedAnalysis.modelKey)) return [];
      return [{ taskId: log.task_id, url: extras.imageUrl, question: request.prompt,
        modelKey: extras.modelKey, analyzedAt: log.finished_at }];
    } catch (error: unknown) {
      console.warn(JSON.stringify({ event: "media_understanding_evidence", status: "invalid_request_receipt",
        taskId: log.task_id, error: error instanceof Error ? error.name : "unknown" }));
      return [];
    }
  });
  if (matched.length === 0) return [];
  const results = await input.db.task_results.findMany({
    where: { user_id: input.ownerId, task_id: { in: matched.map((item) => item.taskId) },
      kind: "image_to_prompt", status: "succeeded" },
    select: { task_id: true, result: true },
  });
  const texts = new Map<string, string>();
  for (const row of results) {
    try {
      const result = parse(row.result);
      const text = record(result?.raw)?.text;
      if (result?.status === "succeeded" && result.id === row.task_id
        && typeof text === "string" && text.trim()) texts.set(row.task_id, text);
    } catch (error: unknown) {
      console.warn(JSON.stringify({ event: "media_understanding_evidence", status: "invalid_result_receipt",
        taskId: row.task_id, error: error instanceof Error ? error.name : "unknown" }));
    }
  }
  const evidence: ImageUnderstandingEvidence[] = [];
  if (input.requestedAnalysis && matched.some((receipt) => !texts.has(receipt.taskId))) {
    throw new Error("A successful image analysis receipt has no readable full result; do not resubmit it");
  }
  const seen = new Set<string>();
  for (const reference of input.references) {
    for (const receipt of matched) {
      const text = texts.get(receipt.taskId);
      if ((!input.contentKey && receipt.url !== reference.url) || !text) continue;
      const promptHash = hash(receipt.question);
      const identity = JSON.stringify([reference.referenceId, receipt.modelKey, promptHash]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      evidence.push({ referenceId: reference.referenceId, text, question: receipt.question,
        provenance: { version: 1, mediaType: "image", source: "persisted_task_result",
          taskId: receipt.taskId, modelKey: receipt.modelKey, referenceId: reference.referenceId,
          promptHash, analysisHash: hash(text), analyzedAt: receipt.analyzedAt } });
    }
  }
  console.info(JSON.stringify({ event: "media_understanding_evidence", status: "resolved",
    referenceCount: input.references.length, evidenceCount: evidence.length,
    taskIds: evidence.map((item) => item.provenance.taskId) }));
  return evidence;
}
