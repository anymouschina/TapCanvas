import { describe, expect, it } from "vitest";
import {
	assertCodexTaskTransition,
	canTransitionCodexTask,
} from "./codex-state-machine";

describe("Codex task state machine", () => {
	it("allows the remote-first success path", () => {
		const path = [
			"queued",
			"claimed",
			"codex_running",
			"remote_build_queued",
			"remote_build_running",
			"succeeded",
		] as const;
		for (let index = 1; index < path.length; index += 1) {
			expect(canTransitionCodexTask(path[index - 1], path[index])).toBe(true);
		}
	});

	it("allows a Codex turn to finish with a response or a user question", () => {
		expect(canTransitionCodexTask("codex_running", "succeeded")).toBe(true);
		expect(
			canTransitionCodexTask("codex_running", "awaiting_user_input"),
		).toBe(true);
	});

	it("allows local Docker only after an infrastructure failure and approval", () => {
		expect(
			canTransitionCodexTask(
				"remote_build_failed_infrastructure",
				"fallback_waiting_approval",
			),
		).toBe(true);
		expect(
			canTransitionCodexTask(
				"fallback_waiting_approval",
				"local_fallback_approved",
			),
		).toBe(true);
		expect(
			canTransitionCodexTask("remote_build_failed_code", "local_build_running"),
		).toBe(false);
	});

	it("keeps terminal states immutable", () => {
		expect(() =>
			assertCodexTaskTransition("succeeded", "remote_build_running"),
		).toThrow(/transition rejected/);
		expect(() =>
			assertCodexTaskTransition("awaiting_user_input", "codex_running"),
		).toThrow(/transition rejected/);
	});
});
