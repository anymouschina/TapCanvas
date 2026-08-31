import { describe, expect, it, vi } from "vitest";

import {
	acquireWorkflowRuntimeOwnership,
	buildWorkflowRuntimeOwnershipKey,
} from "./workflow-runtime-ownership";

function databaseUrl(host: string): string {
	return `postgresql://tapcanvas:secret@${host}:5432/tapcanvas?schema=public`;
}

describe("workflow runtime ownership", () => {
	it("uses the shared database namespace instead of deployment-specific host names", () => {
		expect(buildWorkflowRuntimeOwnershipKey(databaseUrl("postgres"))).toBe(
			buildWorkflowRuntimeOwnershipKey(databaseUrl("127.0.0.1")),
		);
	});

	it("refuses a second runtime before startup recovery can mutate persisted work", async () => {
		const redis = {
			set: vi.fn(async () => null),
			eval: vi.fn(async () => 0),
		};
		await expect(acquireWorkflowRuntimeOwnership({
			redis,
			databaseUrl: databaseUrl("postgres"),
			token: "runtime-b",
		})).rejects.toThrow("workflow_runtime_owner_already_active");
		expect(redis.eval).not.toHaveBeenCalled();
	});

	it("renews only the matching generation and releases it with compare-and-delete", async () => {
		vi.useFakeTimers();
		try {
			const redis = {
				set: vi.fn(async () => "OK"),
				eval: vi.fn(async () => 1),
			};
			const ownership = await acquireWorkflowRuntimeOwnership({
				redis,
				databaseUrl: databaseUrl("postgres"),
				leaseMs: 3_000,
				renewIntervalMs: 1_000,
				token: "runtime-a",
			});
			await vi.advanceTimersByTimeAsync(1_000);
			expect(redis.eval).toHaveBeenCalledWith(
				expect.stringContaining("PEXPIRE"),
				1,
				ownership.key,
				"runtime-a",
				3_000,
			);
			ownership.assertOwned();
			await ownership.release();
			expect(redis.eval).toHaveBeenLastCalledWith(
				expect.stringContaining("DEL"),
				1,
				ownership.key,
				"runtime-a",
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it("surfaces generation replacement so the API can drain", async () => {
		vi.useFakeTimers();
		try {
			const redis = {
				set: vi.fn(async () => "OK"),
				eval: vi.fn(async () => 0),
			};
			const ownership = await acquireWorkflowRuntimeOwnership({
				redis,
				databaseUrl: databaseUrl("postgres"),
				leaseMs: 3_000,
				renewIntervalMs: 1_000,
				token: "runtime-a",
			});
			const lossPromise = ownership.lost;
			await vi.advanceTimersByTimeAsync(1_000);
			await expect(lossPromise).resolves.toMatchObject({
				code: "workflow_runtime_ownership_replaced",
			});
			expect(() => ownership.assertOwned()).toThrow("workflow_runtime_ownership_replaced");
			await ownership.release();
		} finally {
			vi.useRealTimers();
		}
	});
});
