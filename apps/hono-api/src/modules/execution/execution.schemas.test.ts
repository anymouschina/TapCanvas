import { describe, expect, it } from "vitest";
import {
	ExecutionEventTypeSchema,
	RunFlowExecutionRequestSchema,
	WorkflowExecutionEventSchema,
	WorkflowExecutionResumeRequestSchema,
} from "./execution.schemas";

describe("workflow execution event schemas", () => {
	it("accepts persisted node progress checkpoints", () => {
		expect(ExecutionEventTypeSchema.parse("node_heartbeat")).toBe("node_heartbeat");
		expect(ExecutionEventTypeSchema.parse("node_progress")).toBe("node_progress");
		expect(
			WorkflowExecutionEventSchema.parse({
				id: "event-1",
				executionId: "execution-1",
				seq: 1,
				eventType: "node_progress",
				level: "info",
				nodeId: "prompt-agent",
				message: null,
				data: {
					completedItems: 3,
					settledItems: 3,
					totalItems: 30,
				},
				createdAt: "2026-08-12T00:00:00.000Z",
			}),
		).toMatchObject({
			eventType: "node_progress",
			nodeId: "prompt-agent",
		});
	});
});

describe("workflow execution resume schema", () => {
	it("requires an explicit exact model contract for cutover", () => {
		expect(WorkflowExecutionResumeRequestSchema.parse({})).toEqual({});
		expect(WorkflowExecutionResumeRequestSchema.parse({
			providerBalanceRestored: true,
		})).toEqual({ providerBalanceRestored: true });
		expect(WorkflowExecutionResumeRequestSchema.parse({
			cancellationRevoked: true,
		})).toEqual({ cancellationRevoked: true });
		expect(WorkflowExecutionResumeRequestSchema.parse({
			agentModelCutover: {
				targetModelKey: "doubao-seed-2-0-lite-260428",
				apiStyle: "chat",
			},
		})).toEqual({
			agentModelCutover: {
				targetModelKey: "doubao-seed-2-0-lite-260428",
				apiStyle: "chat",
			},
		});
		expect(WorkflowExecutionResumeRequestSchema.safeParse({
			agentModelCutover: { targetModelKey: "doubao-seed-2-0-lite-260428" },
		}).success).toBe(false);
		expect(WorkflowExecutionResumeRequestSchema.safeParse({
			providerBalanceRestored: false,
		}).success).toBe(false);
		expect(WorkflowExecutionResumeRequestSchema.safeParse({
			cancellationRevoked: false,
		}).success).toBe(false);
		expect(WorkflowExecutionResumeRequestSchema.safeParse({
			providerBalanceRestored: true,
			cancellationRevoked: true,
		}).success).toBe(false);
		expect(WorkflowExecutionResumeRequestSchema.safeParse({
			providerBalanceRestored: true,
			agentModelCutover: {
				targetModelKey: "doubao-seed-2-0-lite-260428",
				apiStyle: "chat",
			},
		}).success).toBe(false);
	});
});

describe("RunFlowExecutionRequestSchema", () => {
	it("keeps explicit triggerPayload facts available to project-context construction", () => {
		const parsed = RunFlowExecutionRequestSchema.parse({
			flowId: "flow-1",
			triggerNodeId: "trigger-1",
			trigger: "agent",
			triggerPayload: {
				styleFacts: {
					styleName: "用户确认的二维赛璐璐",
					visualDirectives: ["高对比蓝紫夜色"],
				},
			},
		});

		expect(parsed.triggerPayload).toEqual({
			styleFacts: {
				styleName: "用户确认的二维赛璐璐",
				visualDirectives: ["高对比蓝紫夜色"],
			},
		});
	});
});
