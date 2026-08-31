import { describe, expect, it } from "vitest";
import { pollUntilSettled } from "./task.polling-core";

describe("pollUntilSettled", () => {
	it("returns success when evaluator marks a value as success", async () => {
		let current = 0;
		const result = await pollUntilSettled({
			timeoutMs: 200,
			intervalMs: 1,
			pollOnce: async () => {
				current += 1;
				return current;
			},
			evaluate: (value) => (value >= 3 ? "success" : "continue"),
		});

		expect(result.state).toBe("success");
		expect(result.value).toBe(3);
		expect(result.attempts).toBe(3);
	});

	it("returns failure when evaluator marks a value as failure", async () => {
		const result = await pollUntilSettled({
			timeoutMs: 200,
			intervalMs: 1,
			pollOnce: async () => "failed",
			evaluate: (value) => (value === "failed" ? "failure" : "continue"),
		});

		expect(result.state).toBe("failure");
		expect(result.value).toBe("failed");
		expect(result.attempts).toBe(1);
	});
});
