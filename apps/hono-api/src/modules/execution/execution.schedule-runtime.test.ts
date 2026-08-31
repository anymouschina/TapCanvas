import { beforeEach, describe, expect, it, vi } from "vitest";
import { createScheduleWorkflowTriggerSpec } from "@tapcanvas/workflow-kernel-protocol";
import type { WorkerEnv } from "../../types";

const startWorkflowExecution = vi.hoisted(() => vi.fn(async () => ({
	created: true,
	execution: { id: "execution-1" },
})));

vi.mock("./execution.start-service", () => ({ startWorkflowExecution }));

import {
	parseScheduledForFromExecutionTrigger,
	previewWorkflowSchedule,
	resolveDueScheduleOccurrence,
	scanDueWorkflowSchedules,
	serializeScheduleExecutionTrigger,
} from "./execution.schedule-runtime";

const schedule = createScheduleWorkflowTriggerSpec({
	scheduleId: "schedule-1",
	cron: "0 9 * * *",
	timezone: "UTC",
	enabled: true,
	misfirePolicy: "skip",
	maxCatchUpRuns: 0,
});

function scheduledFlow(): Readonly<Record<string, unknown>> {
	return {
		id: "flow-1",
		name: "Scheduled workflow",
		owner_id: "admin-1",
		project_id: "project-1",
		created_at: "2026-08-11T08:00:00.000Z",
		updated_at: "2026-08-11T08:59:30.000Z",
		canvas_revision: 4,
		data: JSON.stringify({
			nodes: [
				{
					id: "trigger-1",
					type: "taskNode",
					data: {
						kind: "workflowTrigger",
						adminWorkflow: true,
						workflowKey: "agent-workflow/v1",
						workflowDefinitionVersion: 1,
						workflowTriggerSpec: schedule,
					},
				},
			],
			edges: [],
		}),
	};
}

describe("workflow schedule runtime", () => {
	beforeEach(() => {
		startWorkflowExecution.mockClear();
		startWorkflowExecution.mockResolvedValue({ created: true, execution: { id: "execution-1" } });
	});

	it("previews timezone-aware future runs and rejects invalid cron", () => {
		expect(previewWorkflowSchedule(schedule, new Date("2026-08-11T08:30:00.000Z"), 2).nextRuns).toEqual([
			"2026-08-11T09:00:00.000Z",
			"2026-08-12T09:00:00.000Z",
		]);
		expect(() => previewWorkflowSchedule({ ...schedule, cron: "not a cron" })).toThrow();
	});

	it("runs an on-time occurrence, skips an old misfire, and coalesces run_once", () => {
		const now = new Date("2026-08-11T09:00:30.000Z");
		expect(resolveDueScheduleOccurrence({
			spec: schedule,
			baseline: new Date("2026-08-11T08:59:00.000Z"),
			now,
		})?.toISOString()).toBe("2026-08-11T09:00:00.000Z");
		expect(resolveDueScheduleOccurrence({
			spec: schedule,
			baseline: new Date("2026-08-10T08:00:00.000Z"),
			now: new Date("2026-08-11T12:00:00.000Z"),
		})).toBeNull();
		expect(resolveDueScheduleOccurrence({
			spec: { ...schedule, misfirePolicy: "run_once", maxCatchUpRuns: 1 },
			baseline: new Date("2026-08-10T08:00:00.000Z"),
			now: new Date("2026-08-11T12:00:00.000Z"),
		})?.toISOString()).toBe("2026-08-11T09:00:00.000Z");
	});

	it("serializes and parses an occurrence identity without ambiguity", () => {
		const trigger = serializeScheduleExecutionTrigger({
			scheduleId: "schedule|with spaces",
			triggerNodeId: "trigger/1",
			scheduledFor: "2026-08-11T09:00:00.000Z",
		});
		expect(parseScheduledForFromExecutionTrigger(
			trigger,
			"schedule|with spaces",
			"trigger/1",
		)?.toISOString()).toBe("2026-08-11T09:00:00.000Z");
	});

	it("creates one durable execution for a due administrator schedule", async () => {
		const env = {
			DB: {
				flows: { findMany: vi.fn(async () => [scheduledFlow()]) },
				users: { findUnique: vi.fn(async () => ({ role: "admin", disabled: 0, deleted_at: null })) },
				workflow_executions: { findFirst: vi.fn(async () => null) },
			},
		} as unknown as WorkerEnv;
		const result = await scanDueWorkflowSchedules(env, new Date("2026-08-11T09:00:10.000Z"));
		expect(result).toMatchObject({ schedules: 1, due: 1, created: 1, deduplicated: 0, diagnostics: [] });
		expect(startWorkflowExecution).toHaveBeenCalledTimes(1);
		expect(startWorkflowExecution).toHaveBeenCalledWith(env, expect.objectContaining({
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			idempotencyKey: "flow-1:trigger-1:schedule-1:2026-08-11T09:00:00.000Z",
		}));
	});

	it("reports an inactive owner instead of silently running the schedule", async () => {
		const env = {
			DB: {
				flows: { findMany: vi.fn(async () => [scheduledFlow()]) },
				users: { findUnique: vi.fn(async () => ({ role: "member", disabled: 0, deleted_at: null })) },
				workflow_executions: { findFirst: vi.fn(async () => null) },
			},
		} as unknown as WorkerEnv;
		const result = await scanDueWorkflowSchedules(env, new Date("2026-08-11T09:00:10.000Z"));
		expect(result.diagnostics).toEqual([expect.objectContaining({ code: "schedule_owner_not_admin" })]);
		expect(startWorkflowExecution).not.toHaveBeenCalled();
	});

	it("reclaims the same queued occurrence after a crash before scheduler start", async () => {
		const trigger = serializeScheduleExecutionTrigger({
			scheduleId: "schedule-1",
			triggerNodeId: "trigger-1",
			scheduledFor: "2026-08-11T09:00:00.000Z",
		});
		startWorkflowExecution.mockResolvedValueOnce({ created: false, execution: { id: "execution-1" } });
		const env = {
			DB: {
				flows: { findMany: vi.fn(async () => [scheduledFlow()]) },
				users: { findUnique: vi.fn(async () => ({ role: "admin", disabled: 0, deleted_at: null })) },
				workflow_executions: { findFirst: vi.fn(async () => ({ trigger, status: "queued" })) },
			},
		} as unknown as WorkerEnv;
		const result = await scanDueWorkflowSchedules(env, new Date("2026-08-11T09:02:00.000Z"));
		expect(result).toMatchObject({ due: 1, created: 0, deduplicated: 1 });
		expect(startWorkflowExecution).toHaveBeenCalledWith(env, expect.objectContaining({
			idempotencyKey: "flow-1:trigger-1:schedule-1:2026-08-11T09:00:00.000Z",
		}));
	});
});
