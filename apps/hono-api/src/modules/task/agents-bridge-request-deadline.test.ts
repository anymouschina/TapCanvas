import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentsBridgeRequestDeadlineController } from "./agents-bridge-request-deadline";

describe("createAgentsBridgeRequestDeadlineController", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("does not allow semantic progress to extend the immutable physical attempt deadline", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-29T06:00:00.000Z"));
		const deadline = createAgentsBridgeRequestDeadlineController({
			idleTimeoutMs: 60_000,
			admissionTimeoutMs: 10_000,
			absoluteDeadlineAt: "2026-08-29T06:00:05.000Z",
		});
		deadline.confirmAdmission();
		vi.advanceTimersByTime(4_000);
		deadline.confirmAdmission();
		expect(deadline.signal.aborted).toBe(false);
		vi.advanceTimersByTime(1_000);
		expect(deadline.signal.aborted).toBe(true);
		expect((deadline.signal.reason as Error & { code?: string }).code)
			.toBe("workflow_agent_role_timeout");
		deadline.cleanup();
	});

	it("continues to enforce the shorter admission inactivity boundary", () => {
		vi.useFakeTimers();
		const deadline = createAgentsBridgeRequestDeadlineController({
			idleTimeoutMs: 60_000,
			admissionTimeoutMs: 2_000,
		});
		vi.advanceTimersByTime(2_000);
		expect(deadline.signal.aborted).toBe(true);
		expect((deadline.signal.reason as Error & { code?: string }).code)
			.toBe("agents_bridge_admission_timeout");
		deadline.cleanup();
	});
});
