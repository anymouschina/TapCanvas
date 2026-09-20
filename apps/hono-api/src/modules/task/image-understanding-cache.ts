import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../middleware/error";

export const ImageAnalysisSchema = z.object({
  text: z.string().min(1),
  provenance: z.object({
    version: z.literal(1), mediaType: z.literal("image"), modelKey: z.string().min(1),
    taskId: z.string().min(1), promptHash: z.string().min(1), analysisHash: z.string().min(1),
    analyzedAt: z.string().min(1), referenceId: z.string().nullable(),
  }),
});
export type ImageAnalysis = z.infer<typeof ImageAnalysisSchema>;
export type ImageAnalysisCacheRow = { status: string; data: string | null; updated_at: string };
export type ImageAnalysisCacheStore = {
  claim: () => Promise<boolean>;
  read: () => Promise<ImageAnalysisCacheRow | null>;
  touch: () => Promise<void>;
  finish: (status: "succeeded" | "uncertain" | "rejected_pre_upstream", data: string) => Promise<void>;
};

export function imageAnalysisCacheKey(input: { ownerId: string; billingScope: string; contentHash: string; promptHash: string; modelKey: string }): string {
  return `image-understanding:v1:${createHash("sha256").update(JSON.stringify([
    input.ownerId, input.billingScope, input.contentHash, input.promptHash, input.modelKey,
  ])).digest("hex")}`;
}

/** The durable claim never expires into permission to repeat a paid request. */
export async function shareImageAnalysis(input: {
  key: string;
  store: ImageAnalysisCacheStore;
  execute: () => Promise<ImageAnalysis>;
  recover: () => Promise<ImageAnalysis | null>;
  pollMs?: number;
  staleMs?: number;
}): Promise<ImageAnalysis> {
  const emit = (status: string) => console.info(JSON.stringify({ event: "image_understanding_cache", key: input.key, status }));
  if (await input.store.claim()) {
    emit("claimed");
    // No other process takes over the claim if this heartbeat fails or stops.
    let heartbeat: Promise<void> | null = null;
    const timer = setInterval(() => {
      if (heartbeat) return;
      heartbeat = input.store.touch().catch((error: unknown) => {
        console.error(JSON.stringify({ event: "image_understanding_cache", key: input.key,
          status: "heartbeat_failed", reason: error instanceof Error ? error.message : String(error) }));
      }).finally(() => { heartbeat = null; });
    }, 10_000);
    timer.unref();
    try {
      const analysis = ImageAnalysisSchema.parse(await input.execute());
      await input.store.finish("succeeded", JSON.stringify(analysis));
      emit("succeeded");
      return analysis;
    } catch (error: unknown) {
      // Includes transport failure and a result-save failure: either can have
      // happened after provider acceptance. Reconciliation is read-only.
      const details = error instanceof AppError ? error.details : null;
      const noSubmission = details && typeof details === "object" && "upstreamRequestAttempted" in details
        && details.upstreamRequestAttempted === false;
      await input.store.finish(noSubmission ? "rejected_pre_upstream" : "uncertain", JSON.stringify({
        message: error instanceof Error ? error.message : String(error),
      }));
      emit(noSubmission ? "rejected_pre_upstream" : "uncertain");
      throw error;
    } finally {
      clearInterval(timer);
      if (heartbeat) await heartbeat;
    }
  }
  emit("shared_wait");
  while (true) {
    const row = await input.store.read();
    if (!row) throw new Error("Image analysis claim disappeared; refusing duplicate submission");
    if (row.status === "succeeded") {
      const analysis = ImageAnalysisSchema.parse(JSON.parse(row.data ?? "null"));
      emit("reused");
      return analysis;
    }
    if (row.status === "rejected_pre_upstream") {
      throw new AppError("共享图片识别动作未提交到供应商，可在修复原始错误后重新执行", {
        status: 503, code: "image_analysis_rejected_pre_upstream",
        details: { upstreamRequestAttempted: false, reason: row.data },
      });
    }
    if (row.status === "uncertain" || Date.now() - Date.parse(row.updated_at) > (input.staleMs ?? 60_000)) {
      const recovered = await input.recover();
      if (recovered) {
        const analysis = ImageAnalysisSchema.parse(recovered);
        await input.store.finish("succeeded", JSON.stringify(analysis));
        emit("recovered");
        return analysis;
      }
      emit("awaiting_receipt");
      throw new AppError("已有图片识别请求结果尚未确认，未重复提交付费识别", {
        status: 503, code: "image_analysis_outcome_uncertain", details: { cacheKey: input.key },
      });
    }
    if (row.status !== "running") throw new Error(`Unexpected image analysis cache status: ${row.status}`);
    await new Promise<void>((resolve) => setTimeout(resolve, input.pollMs ?? 500));
  }
}
