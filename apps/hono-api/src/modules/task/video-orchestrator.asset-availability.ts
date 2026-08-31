/**
 * A user or agent may explicitly reject a generated identity card without
 * deleting it. Rejected nodes remain durable history, but they must never be
 * rebound or reused as executable authoring assets.
 *
 * This is a structural state check only. It does not inspect labels, prompts,
 * pixels, or narrative semantics.
 */
export function isExplicitlyRejectedAsset(
  data: Record<string, unknown>,
): boolean {
  return typeof data.approvalStatus === "string" &&
    data.approvalStatus.trim().toLowerCase() === "rejected";
}
