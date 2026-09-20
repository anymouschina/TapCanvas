import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../middleware/error";
import { imageAnalysisCacheKey, shareImageAnalysis, type ImageAnalysis, type ImageAnalysisCacheRow, type ImageAnalysisCacheStore } from "./image-understanding-cache";

const analysis: ImageAnalysis = { text: "水墨", provenance: {
  version: 1, mediaType: "image", modelKey: "vision", taskId: "paid-task-1",
  promptHash: "prompt-hash", analysisHash: "result-hash", analyzedAt: "2026-09-14T00:00:00Z", referenceId: null,
} };

function storage(initial?: ImageAnalysisCacheRow) {
  let row = initial ?? null;
  // Independent clients share only the backing storage, not a Promise or a JS lock.
  const client = (): ImageAnalysisCacheStore => ({
    claim: async () => {
      if (row && row.status !== "rejected_pre_upstream") return false;
      row = { status: "running", data: null, updated_at: new Date().toISOString() };
      return true;
    },
    read: async () => row,
    touch: async () => { if (row) row.updated_at = new Date().toISOString(); },
    finish: async (status, data) => { row = { status, data, updated_at: new Date().toISOString() }; },
  });
  return { client };
}

describe("durable image understanding deduplication", () => {
  it("shares one cold submission across independent clients and reuses after client recreation", async () => {
    const store = storage();
    let release: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    const execute = vi.fn(async () => { await ready; return analysis; });
    const requests = Array.from({ length: 12 }, () => shareImageAnalysis({
      key: "same-image", store: store.client(), execute, recover: async () => null, pollMs: 1,
    }));
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(1);
    release();
    expect(await Promise.all(requests)).toEqual(Array.from({ length: 12 }, () => analysis));
    expect(await shareImageAnalysis({ key: "same-image", store: store.client(), execute, recover: async () => null })).toEqual(analysis);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not resubmit a stale claim after the owning process disappears", async () => {
    const store = storage({ status: "running", data: null, updated_at: "2000-01-01T00:00:00Z" });
    const execute = vi.fn();
    await expect(shareImageAnalysis({ key: "uncertain", store: store.client(), execute, recover: async () => null }))
      .rejects.toMatchObject({ code: "image_analysis_outcome_uncertain" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("recovers a successful provider receipt after a result-save crash", async () => {
    const store = storage({ status: "uncertain", data: null, updated_at: "2000-01-01T00:00:00Z" });
    const execute = vi.fn();
    expect(await shareImageAnalysis({ key: "recover", store: store.client(), execute, recover: async () => analysis })).toEqual(analysis);
    expect((await store.client().read())?.status).toBe("succeeded");
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not turn storage failure into permission for a paid request", async () => {
    const store = storage().client();
    store.claim = async () => { throw new Error("database offline"); };
    const execute = vi.fn();
    await expect(shareImageAnalysis({ key: "offline", store, execute, recover: async () => null })).rejects.toThrow("database offline");
    expect(execute).not.toHaveBeenCalled();
  });

  it("permits repair after proven pre-submission rejection without resubmitting uncertain requests", async () => {
    const store = storage();
    const execute = vi.fn().mockRejectedValueOnce(new AppError("disabled", { details: { upstreamRequestAttempted: false } }))
      .mockResolvedValueOnce(analysis);
    await expect(shareImageAnalysis({ key: "repair", store: store.client(), execute, recover: async () => null })).rejects.toThrow("disabled");
    expect(await shareImageAnalysis({ key: "repair", store: store.client(), execute, recover: async () => null })).toEqual(analysis);
  });

  it("separates owners, billing scopes, content, instructions and models", () => {
    const input = { ownerId: "owner", billingScope: "team", contentHash: "bytes", promptHash: "prompt", modelKey: "vision" };
    const original = imageAnalysisCacheKey(input);
    for (const field of Object.keys(input) as Array<keyof typeof input>) {
      expect(imageAnalysisCacheKey({ ...input, [field]: "changed" })).not.toBe(original);
    }
    expect(imageAnalysisCacheKey({ ...input })).toBe(original);
  });
});
