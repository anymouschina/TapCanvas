import { describe, expect, it } from "vitest";

import { isProviderTaskPendingStatus } from "./provider-task-status";

describe("provider task structural status", () => {
	it.each(["queued", "running", "submitted", "submitting"])(
		"treats %s as an accepted task that still requires reconciliation",
		(status) => {
			expect(isProviderTaskPendingStatus(status)).toBe(true);
		},
	);

	it.each(["success", "succeeded", "failed", "error", "", "unknown"])(
		"does not treat %s as pending",
		(status) => {
			expect(isProviderTaskPendingStatus(status)).toBe(false);
		},
	);
});
