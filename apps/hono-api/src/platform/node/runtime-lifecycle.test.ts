import { describe, expect, it } from "vitest";

import {
	getRuntimeLifecycleStatus,
	markRuntimeDraining,
	markRuntimeReady,
} from "./runtime-lifecycle";

describe("runtime lifecycle", () => {
	it("reports a non-ready draining state after shutdown begins", () => {
		markRuntimeReady();
		expect(getRuntimeLifecycleStatus()).toMatchObject({ ready: true, draining: false, reason: null });

		markRuntimeDraining("SIGTERM");
		expect(getRuntimeLifecycleStatus()).toMatchObject({
			ready: false,
			draining: true,
			reason: "SIGTERM",
		});
	});
});
