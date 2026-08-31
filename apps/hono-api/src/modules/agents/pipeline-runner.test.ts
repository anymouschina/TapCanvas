// apps/hono-api/src/modules/agents/pipeline-runner.test.ts
import { describe, it, expect, vi } from "vitest";
import {
	migrateStagesJson,
	hashInput,
	executeStage,
	type StageExecution,
	type StageDefinition,
} from "./pipeline-runner";

describe("migrateStagesJson", () => {
	it("migrates string[] to StageExecution[]", () => {
		const result = migrateStagesJson(["storyboard_gen", "media_gen"]);
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ id: "storyboard_gen", status: "pending", attempt: 0 });
	});

	it("passes through already-migrated StageExecution[]", () => {
		const existing: StageExecution[] = [
			{
				id: "step-1",
				label: "Step 1",
				status: "done",
				attempt: 1,
				inputHash: "abc123",
				outputRef: '{"ok":true}',
				errorMessage: null,
				startedAt: "2026-01-01T00:00:00Z",
				finishedAt: "2026-01-01T00:01:00Z",
			},
		];
		const result = migrateStagesJson(existing);
		expect(result).toEqual(existing);
	});

	it("returns [] for null/undefined", () => {
		expect(migrateStagesJson(null)).toEqual([]);
		expect(migrateStagesJson(undefined)).toEqual([]);
	});
});

describe("hashInput", () => {
	it("returns consistent hash for same input", () => {
		expect(hashInput("test")).toBe(hashInput("test"));
	});

	it("returns different hash for different inputs", () => {
		expect(hashInput("a")).not.toBe(hashInput("b"));
	});

	it("handles objects", () => {
		const h1 = hashInput({ a: 1, b: 2 });
		const h2 = hashInput({ a: 1, b: 2 });
		expect(h1).toBe(h2);
	});
});

describe("executeStage", () => {
	it("skips done stage with same inputHash", async () => {
		const runFn = vi.fn().mockResolvedValue("output");
		const stage: StageDefinition<string, string> = {
			id: "test",
			label: "Test",
			run: runFn,
		};
		const existingExecution: StageExecution = {
			id: "test",
			label: "Test",
			status: "done",
			attempt: 1,
			inputHash: hashInput("same-input"),
			outputRef: '"cached-output"',
			errorMessage: null,
			startedAt: "2026-01-01T00:00:00Z",
			finishedAt: "2026-01-01T00:01:00Z",
		};

		const { execution, output } = await executeStage({
			stage,
			existingExecution,
			input: "same-input",
			onUpdate: vi.fn(),
		});

		expect(runFn).not.toHaveBeenCalled();
		expect(execution.status).toBe("done");
		expect(output).toBe("cached-output");
	});

	it("re-runs done stage when input changes", async () => {
		const runFn = vi.fn().mockResolvedValue("new-output");
		const stage: StageDefinition<string, string> = {
			id: "test",
			label: "Test",
			run: runFn,
		};
		const existingExecution: StageExecution = {
			id: "test",
			label: "Test",
			status: "done",
			attempt: 1,
			inputHash: hashInput("old-input"),
			outputRef: '"old-output"',
			errorMessage: null,
			startedAt: "2026-01-01T00:00:00Z",
			finishedAt: "2026-01-01T00:01:00Z",
		};

		const { execution, output } = await executeStage({
			stage,
			existingExecution,
			input: "new-input",
			onUpdate: vi.fn(),
		});

		expect(runFn).toHaveBeenCalledOnce();
		expect(execution.status).toBe("done");
		expect(output).toBe("new-output");
	});

	it("retries on validation failure up to maxAttempts", async () => {
		let callCount = 0;
		const stage: StageDefinition<string, string> = {
			id: "test",
			label: "Test",
			maxAttempts: 3,
			run: async () => {
				callCount++;
				return "bad-output";
			},
			validate: (output) =>
				output === "bad-output"
					? { ok: false, error: "Expected good output" }
					: { ok: true },
		};

		const { execution } = await executeStage({
			stage,
			existingExecution: null,
			input: "input",
			onUpdate: vi.fn(),
		});

		expect(callCount).toBe(3);
		expect(execution.status).toBe("failed");
		expect(execution.errorMessage).toBe("Expected good output");
	});

	it("succeeds on second attempt after validation failure", async () => {
		let callCount = 0;
		const stage: StageDefinition<string, string> = {
			id: "test",
			label: "Test",
			maxAttempts: 3,
			run: async () => {
				callCount++;
				return callCount === 1 ? "bad" : "good";
			},
			validate: (output) =>
				output === "good" ? { ok: true } : { ok: false, error: "bad output" },
		};

		const { execution, output } = await executeStage({
			stage,
			existingExecution: null,
			input: "input",
			onUpdate: vi.fn(),
		});

		expect(callCount).toBe(2);
		expect(execution.status).toBe("done");
		expect(output).toBe("good");
	});

	it("marks failed when run throws and exhausts retries", async () => {
		const stage: StageDefinition<string, string> = {
			id: "test",
			label: "Test",
			maxAttempts: 2,
			run: async () => {
				throw new Error("network error");
			},
		};

		const { execution } = await executeStage({
			stage,
			existingExecution: null,
			input: "input",
			onUpdate: vi.fn(),
		});

		expect(execution.status).toBe("failed");
		expect(execution.errorMessage).toBe("network error");
		expect(execution.attempt).toBe(2);
	});

	it("re-runs stage when existingExecution has attempt >= maxAttempts", async () => {
		const runFn = vi.fn().mockResolvedValue("fresh-output");
		const stage: StageDefinition<string, string> = {
			id: "test",
			label: "Test",
			maxAttempts: 2,
			run: runFn,
		};
		const existingExecution: StageExecution = {
			id: "test",
			label: "Test",
			status: "failed",
			attempt: 2, // 已达 maxAttempts
			inputHash: hashInput("input"),
			outputRef: null,
			errorMessage: "previous error",
			startedAt: "2026-01-01T00:00:00Z",
			finishedAt: "2026-01-01T00:01:00Z",
		};

		const { execution, output } = await executeStage({
			stage,
			existingExecution,
			input: "input",
			onUpdate: vi.fn(),
		});

		expect(runFn).toHaveBeenCalledOnce();
		expect(execution.status).toBe("done");
		expect(output).toBe("fresh-output");
	});

	it("re-runs stage when outputRef is corrupted JSON", async () => {
		const runFn = vi.fn().mockResolvedValue("recovered-output");
		const stage: StageDefinition<string, string> = {
			id: "test",
			label: "Test",
			run: runFn,
		};
		const existingExecution: StageExecution = {
			id: "test",
			label: "Test",
			status: "done",
			attempt: 1,
			inputHash: hashInput("input"),
			outputRef: "{corrupted json{{",
			errorMessage: null,
			startedAt: "2026-01-01T00:00:00Z",
			finishedAt: "2026-01-01T00:01:00Z",
		};

		const { execution, output } = await executeStage({
			stage,
			existingExecution,
			input: "input",
			onUpdate: vi.fn(),
		});

		expect(runFn).toHaveBeenCalledOnce();
		expect(execution.status).toBe("done");
		expect(output).toBe("recovered-output");
	});
});

describe("executeStagesConcurrently", () => {
	it("executes multiple stages and returns all results", async () => {
		const makeStage = (i: number): StageDefinition<string, string> & { input: string } => ({
			id: `stage-${i}`,
			label: `Stage ${i}`,
			input: `input-${i}`,
			run: async (inp) => `output-for-${inp}`,
		});

		const { executeStagesConcurrently } = await import("./pipeline-runner");
		const results = await executeStagesConcurrently({
			stages: [makeStage(0), makeStage(1), makeStage(2)],
			existingExecutions: new Map(),
			concurrency: 2,
			onUpdate: vi.fn(),
		});

		expect(results.size).toBe(3);
		expect(results.get("stage-0")?.output).toBe("output-for-input-0");
		expect(results.get("stage-1")?.output).toBe("output-for-input-1");
		expect(results.get("stage-2")?.output).toBe("output-for-input-2");
		for (const [, { execution }] of results) {
			expect(execution.status).toBe("done");
		}
	});

	it("respects concurrency limit", async () => {
		let concurrentCount = 0;
		let maxConcurrent = 0;
		const makeStage = (i: number): StageDefinition<string, string> & { input: string } => ({
			id: `stage-${i}`,
			label: `Stage ${i}`,
			input: `input-${i}`,
			run: async () => {
				concurrentCount++;
				maxConcurrent = Math.max(maxConcurrent, concurrentCount);
				await new Promise((r) => setTimeout(r, 10));
				concurrentCount--;
				return `output-${i}`;
			},
		});

		const { executeStagesConcurrently } = await import("./pipeline-runner");
		await executeStagesConcurrently({
			stages: [makeStage(0), makeStage(1), makeStage(2), makeStage(3), makeStage(4)],
			existingExecutions: new Map(),
			concurrency: 2,
			onUpdate: vi.fn(),
		});

		expect(maxConcurrent).toBeLessThanOrEqual(2);
	});
});
