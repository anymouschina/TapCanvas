import { describe, expect, it } from "vitest";

import { buildPhysicalContinuationLeaseTakeover } from "./agents-bridge-continuation-lease";

describe("buildPhysicalContinuationLeaseTakeover", () => {
	it("is absent from ordinary public chat requests", () => {
		expect(buildPhysicalContinuationLeaseTakeover({
			trustedPublicContinuation: false,
			logicalTaskId: "public-root-1",
		})).toBeNull();
	});

	it("binds trusted continuation takeover to the stable root identity", () => {
		expect(buildPhysicalContinuationLeaseTakeover({
			trustedPublicContinuation: true,
			logicalTaskId: " public-root-1 ",
		})).toEqual({
			version: 1,
			source: "trusted_public_continuation",
			logicalTaskId: "public-root-1",
		});
	});

	it("rejects a trusted continuation without a logical identity", () => {
		expect(() => buildPhysicalContinuationLeaseTakeover({
			trustedPublicContinuation: true,
			logicalTaskId: " ",
		})).toThrow(/requires logicalTaskId/);
	});
});

