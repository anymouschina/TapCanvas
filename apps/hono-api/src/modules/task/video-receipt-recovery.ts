import { z } from "zod";
import { TaskReceiptRecoverySchema, TaskReceiptReconciliationSchema, type TaskReceiptRecovery, type TaskResultDto } from "./task.schemas";

const ProviderReceiptRecoverySchema = z.object({
  disposition: TaskReceiptRecoverySchema.shape.disposition,
  failure_kind: z.string().optional(),
  observed_at: z.number().int().optional(),
  terminal_billing_preserved: z.boolean().optional(),
});

const ProviderReceiptReconciliationSchema = z.object({
  revision: z.number().int().nonnegative(), pending_receipts: z.number().int().nonnegative(),
  observed_receipts: z.number().int().nonnegative(), identity_error: z.boolean().optional(),
});
const ProviderReceiptAssetsSchema = z.array(z.object({ url: z.string().url(), observed_at: z.number().int() }));

export function readNewApiReceiptEvidence(payload: unknown): Pick<TaskResultDto, "receiptAssets" | "receiptReconciliation"> {
  const source = record(payload);
  const assets = source?.receipt_assets === undefined || source.receipt_assets === null
    ? undefined : ProviderReceiptAssetsSchema.parse(source.receipt_assets);
  const reconciliation = source?.receipt_reconciliation === undefined || source.receipt_reconciliation === null
    ? undefined : ProviderReceiptReconciliationSchema.parse(source.receipt_reconciliation);
  return {
    ...(assets ? { receiptAssets: assets.map((asset) => ({ type: "video" as const, url: asset.url, observedAt: asset.observed_at })) } : {}),
    ...(reconciliation ? { receiptReconciliation: {
      revision: reconciliation.revision, pendingReceipts: reconciliation.pending_receipts,
      observedReceipts: reconciliation.observed_receipts,
      ...(reconciliation.identity_error !== undefined ? { identityError: reconciliation.identity_error } : {}),
    } } : {}),
  };
}

export function videoNodeHasPendingHistoricalReceipts(data: Record<string, unknown>): boolean {
  const value = data.videoReceiptReconciliation;
  return value !== undefined && value !== null && TaskReceiptReconciliationSchema.parse(value).pendingReceipts > 0;
}

/** Historical provider assets are additive; they never replace the active video or billing identity. */
export function buildVideoReceiptEvidencePatch(input: {
  nodeData: Record<string, unknown>; taskId: string; vendor: string; result: TaskResultDto;
  includeReconciliation?: boolean;
}): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  const recovery = readTaskReceiptRecovery(input.result);
  if (input.includeReconciliation !== false && recovery
    && JSON.stringify(recovery) !== JSON.stringify(input.nodeData.videoReceiptRecovery)) {
    patch.videoReceiptRecovery = recovery;
  }
  const reconciliation = input.result.receiptReconciliation;
  const oldReconciliation = input.nodeData.videoReceiptReconciliation;
  if (input.includeReconciliation !== false && reconciliation && JSON.stringify(reconciliation) !== JSON.stringify(oldReconciliation)) {
    patch.videoReceiptReconciliation = reconciliation;
  }
  const history = Array.isArray(input.nodeData.videoReceiptHistory) ? input.nodeData.videoReceiptHistory : [];
  const existingUrls = new Set(history.flatMap((entry: unknown) => {
    const receipt = record(entry);
    if (receipt?.taskId !== input.taskId || !Array.isArray(receipt.assets)) return [];
    return receipt.assets.flatMap((asset: unknown) => {
      const value = record(asset)?.url;
      return typeof value === "string" ? [value] : [];
    });
  }));
  const additions = (input.result.receiptAssets ?? []).filter((asset) => !existingUrls.has(asset.url));
  if (additions.length > 0) patch.videoReceiptHistory = [...history, {
    taskId: input.taskId, vendor: input.vendor, status: "succeeded", historicalReceipt: true,
    assets: additions, observedAt: new Date().toISOString(),
  }];
  return Object.keys(patch).length > 0 ? patch : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Receipt recovery is provider protocol evidence; error prose cannot classify it. */
export function readNewApiReceiptRecovery(payload: unknown): TaskReceiptRecovery | undefined {
  const value = record(payload)?.receipt_recovery;
  if (value === undefined || value === null) return undefined;
  const parsed = ProviderReceiptRecoverySchema.parse(value);
  return {
    disposition: parsed.disposition,
    ...(parsed.failure_kind !== undefined ? { failureKind: parsed.failure_kind } : {}),
    ...(parsed.observed_at !== undefined ? { observedAt: parsed.observed_at } : {}),
    ...(parsed.terminal_billing_preserved !== undefined
      ? { terminalBillingPreserved: parsed.terminal_billing_preserved } : {}),
  };
}

export function readTaskReceiptRecovery(result: TaskResultDto): TaskReceiptRecovery | undefined {
  return result.receiptRecovery ?? readNewApiReceiptRecovery(record(result.raw)?.response);
}

export function receiptAwaitsEvidence(receipt: TaskReceiptRecovery | undefined): boolean {
  return receipt?.disposition === "pending" || receipt?.disposition === "awaiting_late_result";
}

export function receiptIsTerminal(receipt: TaskReceiptRecovery | undefined): boolean {
  return receipt?.disposition === "terminal" || receipt?.disposition === "action_failed";
}

export function readVideoNodeReceiptRecovery(data: Record<string, unknown>): TaskReceiptRecovery | undefined {
  if (data.videoReceiptRecovery === undefined || data.videoReceiptRecovery === null) return undefined;
  return TaskReceiptRecoverySchema.parse(data.videoReceiptRecovery);
}

/** Unknown failed projections require one original-handle GET to learn the current receipt. */
export function videoReceiptNeedsRecovery(data: Record<string, unknown>): boolean {
  if (videoNodeHasPendingHistoricalReceipts(data)) return true;
  const status = typeof data.status === "string" ? data.status.trim().toLowerCase() : "";
  const submission = typeof data.workflowSubmissionState === "string" ? data.workflowSubmissionState.trim().toLowerCase() : "";
  if (submission === "rejected_pre_upstream") return false;
  const receipt = readVideoNodeReceiptRecovery(data);
  if (receiptAwaitsEvidence(receipt)) return true;
  return !receipt && (status === "failed" || status === "error" || status === "canceled");
}

/** CAS callers append the old receipt's assets while leaving the active attempt untouched. */
export function appendSupersededVideoReceipt(input: {
  nodeData: Record<string, unknown>;
  taskId: string;
  vendor: string;
  result: TaskResultDto;
}): Record<string, unknown> | null {
  const history = Array.isArray(input.nodeData.videoReceiptHistory) ? input.nodeData.videoReceiptHistory : [];
  const urls = input.result.assets.filter((asset) => asset.type === "video").map((asset) => asset.url);
  const existingUrls = new Set(history.flatMap((entry: unknown) => {
    const receipt = record(entry);
    if (receipt?.taskId !== input.taskId || !Array.isArray(receipt.assets)) return [];
    return receipt.assets.flatMap((asset: unknown) => {
      const value = record(asset)?.url;
      return typeof value === "string" ? [value] : [];
    });
  }));
  if (urls.length === 0 || urls.every((url) => existingUrls.has(url))) return null;
  return {
    videoReceiptHistory: [...history, {
      taskId: input.taskId,
      vendor: input.vendor,
      status: input.result.status,
      assets: input.result.assets,
      ...(readTaskReceiptRecovery(input.result) ? { receiptRecovery: readTaskReceiptRecovery(input.result) } : {}),
      observedAt: new Date().toISOString(),
    }],
  };
}
