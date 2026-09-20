import { z } from "zod";

export const MediaDeliveryCoverageSchema = z.object({
  status: z.enum(["complete", "partial"]),
  requestedDurationSeconds: z.number().positive(),
  deliveredDurationSeconds: z.number().positive(),
  completedItemIds: z.array(z.string().min(1)).min(1),
  missingItemIds: z.array(z.string().min(1)),
});

export type MediaDeliveryCoverage = Readonly<{
  status: "complete" | "partial";
  requestedDurationSeconds: number;
  deliveredDurationSeconds: number;
  completedItemIds: readonly string[];
  missingItemIds: readonly string[];
}>;

/** Completing preservation/assembly is not proof that the requested set was delivered. */
export function verifyMediaDeliveryCoverage(coverage: MediaDeliveryCoverage) {
  const identities = [...coverage.completedItemIds, ...coverage.missingItemIds];
  if (new Set(identities).size !== identities.length
    || (coverage.status === "complete") !== (coverage.missingItemIds.length === 0)) {
    throw new Error("Media delivery coverage has inconsistent membership facts");
  }
  return {
    expectedDelivery: { itemIds: identities, durationSeconds: coverage.requestedDurationSeconds },
    deliveryEvidence: { itemIds: coverage.completedItemIds, durationSeconds: coverage.deliveredDurationSeconds },
    deliveryVerification: {
      status: coverage.status === "complete" ? "satisfied" as const : "unsatisfied" as const,
      artifactPreserved: true,
      coverage: coverage.status,
      missingItemIds: coverage.missingItemIds,
      terminalAuthority: false,
    },
  };
}

/** Membership and duration are frozen facts, never inferred from prompt text. */
export function mediaDeliveryCoverage(
  expected: readonly Readonly<{ itemId: string; durationSeconds: number }>[],
  deliveredIds: readonly string[],
  allowPartial: boolean,
): MediaDeliveryCoverage {
  const expectedIds = new Set(expected.map(item => item.itemId));
  if (!expected.length || expectedIds.size !== expected.length
    || expected.some(item => !item.itemId || !Number.isFinite(item.durationSeconds) || item.durationSeconds <= 0)) {
    throw new Error("Media delivery requires unique frozen items and positive durations");
  }
  const delivered = new Set(deliveredIds);
  if (!delivered.size || delivered.size !== deliveredIds.length || deliveredIds.some(id => !expectedIds.has(id))) {
    throw new Error("Media delivery contains empty, duplicate or unexpected item identities");
  }
  const complete = expected.filter(item => delivered.has(item.itemId));
  const missing = expected.filter(item => !delivered.has(item.itemId));
  if (missing.length && !allowPartial) throw new Error("Partial media delivery is not authorized");
  return {
    status: missing.length ? "partial" : "complete",
    requestedDurationSeconds: expected.reduce((sum, item) => sum + item.durationSeconds, 0),
    deliveredDurationSeconds: complete.reduce((sum, item) => sum + item.durationSeconds, 0),
    completedItemIds: complete.map(item => item.itemId),
    missingItemIds: missing.map(item => item.itemId),
  };
}
