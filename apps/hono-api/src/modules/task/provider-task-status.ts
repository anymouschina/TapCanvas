const PROVIDER_TASK_PENDING_STATUSES = new Set([
	"queued",
	"running",
	"submitted",
	"submitting",
]);

/**
 * Structural provider states that prove an accepted task has not reached a
 * deterministic terminal result yet. `submitting` is included because the
 * provider can finish after the receipt is persisted but before the canvas
 * projection advances to `running`.
 */
export function isProviderTaskPendingStatus(status: string): boolean {
	return PROVIDER_TASK_PENDING_STATUSES.has(status.trim().toLowerCase());
}
