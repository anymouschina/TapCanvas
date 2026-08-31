import { describe, expect, it } from "vitest";
import type { WorkerEnv } from "../../types";
import { runLocalWorkflowJavascript } from "./execution.javascript-runner";

describe("trusted local workflow JavaScript runner", () => {
	it("requires the administrator to enable trusted local scripts explicitly", async () => {
		await expect(runLocalWorkflowJavascript({} as WorkerEnv, {
			code: "return input",
			input: { text: "hello" },
		})).rejects.toThrow(/WORKFLOW_LOCAL_JAVASCRIPT_ENABLED=true/u);
	});

	it("runs JSON transformations in a bounded child process", async () => {
		const result = await runLocalWorkflowJavascript({
			WORKFLOW_LOCAL_JAVASCRIPT_ENABLED: "true",
		} as WorkerEnv, {
			code: "return { text: String(input.text).toUpperCase() }",
			input: { text: "hello" },
		});

		expect(result.output).toEqual({ text: "HELLO" });
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});
});
