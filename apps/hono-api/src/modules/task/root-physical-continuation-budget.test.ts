import { describe, expect, it } from "vitest";

import {
	evaluateRootPhysicalNoProgressWindow,
	MAX_ROOT_PHYSICAL_WINDOWS_WITHOUT_PROGRESS,
} from "./root-physical-continuation-budget";

describe("root physical continuation progress budget", () => {
	it("exhausts after three physical windows at one durable revision", () => {
		const result = evaluateRootPhysicalNoProgressWindow({
			handledArtifactIds: [
				"root_physical_run:physical-1:7",
				"root_physical_run:physical-2:7",
				"video:run:durable-1",
			],
			progressRevision: 7,
		});

		expect(MAX_ROOT_PHYSICAL_WINDOWS_WITHOUT_PROGRESS).toBe(3);
		expect(result).toEqual({
			progressRevision: 7,
			priorWindowCount: 2,
			currentWindowCount: 3,
			exhausted: true,
		});
	});

	it("resets naturally when monotonic durable progress advances", () => {
		expect(evaluateRootPhysicalNoProgressWindow({
			handledArtifactIds: [
				"root_physical_run:physical-1:7",
				"root_physical_run:physical-2:7",
			],
			progressRevision: 8,
		})).toEqual({
			progressRevision: 8,
			priorWindowCount: 0,
			currentWindowCount: 1,
			exhausted: false,
		});
	});
});
