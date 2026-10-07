import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentsBridgeStreamEvent } from "../task/task.agents-bridge";
import {
	createWorkflowAgentActivityReporter,
	projectWorkflowAgentActivityEvent,
	type WorkflowAgentActivitySnapshot,
} from "./execution.agent-progress";

afterEach(() => { vi.useRealTimers(); });

describe("workflow Agent activity projection", () => {
	it("projects only bounded structured metadata and counts content without retaining it", () => {
		const counter = { streamedOutputChars: 0, observedEventCount: 0 };
		const progress = projectWorkflowAgentActivityEvent({
			event: {
				event: "tool",
				data: {
					toolName: "Skill",
					phase: "completed",
					status: "succeeded",
					input: { secretPrompt: "do not persist this" },
					outputPreview: "private output",
				},
			},
			counter,
			nowIso: "2026-09-29T02:30:00.000Z",
			context: {
				displayName: "章节编排",
				runtimeNodeId: `runtime-${"r".repeat(300)}`,
				itemId: `item-${"i".repeat(300)}`,
				itemIndex: 2,
			},
		});
		expect(progress).toMatchObject({
			eventType: "tool",
			displayName: "章节编排",
			runtimeNodeId: `runtime-${"r".repeat(300)}`,
			itemId: `item-${"i".repeat(300)}`,
			itemIndex: 2,
			tool: { name: "Skill", phase: "completed", status: "succeeded" },
			streamedOutputChars: 0,
			observedEventCount: 1,
		});
		expect(JSON.stringify(progress)).not.toContain("do not persist this");
		expect(JSON.stringify(progress)).not.toContain("private output");

		const content = projectWorkflowAgentActivityEvent({
			event: { event: "content", data: { delta: "model text" } },
			counter,
			nowIso: "2026-09-29T02:30:01.000Z",
		});
		expect(content).toMatchObject({ eventType: "content", streamedOutputChars: 10, observedEventCount: 2 });
		expect(JSON.stringify(content)).not.toContain("model text");
	});

	it("keeps an actual status-update phase distinct from streamed model output", () => {
		const progress = projectWorkflowAgentActivityEvent({
			event: { event: "status-update", data: { phase: "agent_reasoning", timeoutMs: 120_000 } },
			counter: { streamedOutputChars: 0, observedEventCount: 0 },
			nowIso: "2026-09-29T02:30:00.000Z",
		});
		expect(progress).toMatchObject({ eventType: "status-update", phase: "agent_reasoning", streamedOutputChars: 0 });
	});

	it("preserves full runtime identity up to its protocol bound and rejects overflow instead of truncating", () => {
		const fullRuntimeNodeId = `runtime-${"r".repeat(1_016)}`;
		const progress = projectWorkflowAgentActivityEvent({
			event: { event: "item.started", data: {} },
			counter: { streamedOutputChars: 0, observedEventCount: 0 },
			nowIso: "2026-09-29T02:30:00.000Z",
			context: { runtimeNodeId: fullRuntimeNodeId },
		});
		expect(progress.runtimeNodeId).toBe(fullRuntimeNodeId);
		expect(() => projectWorkflowAgentActivityEvent({
			event: { event: "item.started", data: {} },
			counter: { streamedOutputChars: 0, observedEventCount: 0 },
			nowIso: "2026-09-29T02:30:00.000Z",
			context: { runtimeNodeId: `${fullRuntimeNodeId}x` },
		})).toThrow();
	});

	it("throttles intermediate writes, flushes the latest snapshot, absorbs write failure, and closes to late events", async () => {
		vi.useFakeTimers();
		const writes: WorkflowAgentActivitySnapshot[] = [];
		const write = vi.fn(async (snapshot: WorkflowAgentActivitySnapshot) => {
			if (snapshot.eventType === "status-update") throw new Error("telemetry-only write failure");
			writes.push(snapshot);
		});
		const writeErrors: string[] = [];
		const projectionErrors: string[] = [];
		const reporter = createWorkflowAgentActivityReporter({
			write,
			onWriteError: (_error, snapshot) => writeErrors.push(snapshot.eventType),
			onProjectionError: (_error, event) => projectionErrors.push(event.event),
			intervalMs: 1_000,
		});

		reporter.observe({ event: "status-update", data: { phase: "agent_reasoning" } });
		await vi.advanceTimersByTimeAsync(0);
		expect(writes).toHaveLength(0);
		expect(writeErrors).toEqual(["status-update"]);

		reporter.observe({ event: "tool", data: { toolName: "Skill", phase: "started", input: { text: "private" } } });
		reporter.observe({ event: "content", data: { delta: "latest" } });
		await reporter.flush();
		expect(writes).toHaveLength(1);
		expect(writeErrors).toEqual(["status-update"]);
		expect(projectionErrors).toEqual([]);

		reporter.observe({ event: "content", data: { delta: "late" } });
		await vi.advanceTimersByTimeAsync(2_000);
		expect(write).toHaveBeenCalledTimes(2);
		expect(writes).toHaveLength(1);
	});

	it("records malformed projection input without throwing into the bridge stream", async () => {
		const write = vi.fn();
		const projectionErrors: string[] = [];
		const reporter = createWorkflowAgentActivityReporter({
			write,
			onWriteError: () => undefined,
			onProjectionError: (_error, event) => projectionErrors.push(event.event),
			intervalMs: 0,
			toIsoString: () => "invalid-time",
		});
		expect(() => reporter.observe({ event: "content", data: { delta: "text" } } satisfies AgentsBridgeStreamEvent)).not.toThrow();
		await reporter.flush();
		expect(projectionErrors).toEqual(["content"]);
		expect(write).not.toHaveBeenCalled();
	});
});
