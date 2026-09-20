import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppEnv, WorkerEnv } from "../../types";
import { parseWorkflowNodeOutputV1 } from "./execution.node-runtime";

const fake = vi.hoisted(() => ({ persisted: undefined as unknown }));
vi.mock("../../middleware/auth", () => ({ authMiddleware: (async (c, next) => {
	c.set("userId", "owner"); await next();
}) satisfies MiddlewareHandler<AppEnv> }));
vi.mock("../team/team.service", async (original) => ({ ...await original<typeof import("../team/team.service")>(), isAdminRequest: () => true }));
vi.mock("../../platform/node/prisma", () => ({ getPrismaClient: () => ({ workflow_node_runs: {
	findUnique: async () => ({ status: "waiting_external", output_refs: JSON.stringify({
		protocolVersion: "1", executorRef: "workflow.human.approval/v1", nodeId: "approval", executionMode: "once",
		ports: {}, artifacts: [], evidence: { executorCompleted: false }, itemRuns: [], externalCheck: { version: 1, mode: "signal_only" },
	}) }),
} }) }));
vi.mock("./execution.repo", async (original) => ({
	...await original<typeof import("./execution.repo")>(),
	getExecutionForOwner: async () => ({ id: "exec" }),
	updateNodeRun: async (_db: unknown, input: { outputRefs: unknown }) => { fake.persisted = input.outputRefs; },
}));
vi.mock("./execution.node-attempt", async (original) => ({
	...await original<typeof import("./execution.node-attempt")>(),
	createWorkflowNodeJob: async () => ({ executionId: "exec", nodeId: "approval", nodeRunId: "run", attempt: 1, phase: "await_external" }),
}));
import { executionRouter } from "./execution.routes";
import { resumeWaitingWorkflowNodes } from "./execution.queue";

describe("durable explicit workflow wakeup", () => {
	it("recovers the actual HTTP-persisted signal after publication fails", async () => {
		const app = new Hono<AppEnv>();
		app.route("/executions", executionRouter);
		app.onError(() => new Response("queue publication failed", { status: 503 }));
		const env = {
			DB: {},
			WORKFLOW_NODE_QUEUE: { send: vi.fn(async () => { throw new Error("queue unavailable"); }) },
		} as unknown as WorkerEnv;
		const response = await app.request("http://local/executions/exec/human-response", {
			method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nodeId: "approval", response: "approved" }),
		}, env);
		expect(response.status).toBe(503);
		const receipt = parseWorkflowNodeOutputV1(fake.persisted);
		expect(receipt?.externalCheck?.mode).toBe("poll");
		expect(receipt?.evidence.humanResponse).toBe("approved");
		const send = vi.fn(async () => undefined);
		const restoredEnv = {
			DB: { workflow_node_runs: { findMany: async () => [{ id: "run", execution_id: "exec", node_id: "approval", attempt: 1, output_refs: JSON.stringify(fake.persisted) }] } },
			WORKFLOW_NODE_QUEUE: { send },
		} as unknown as WorkerEnv;
		await expect(resumeWaitingWorkflowNodes(restoredEnv)).resolves.toBe(1);
		expect(send).toHaveBeenCalledWith({ executionId: "exec", nodeId: "approval", nodeRunId: "run", attempt: 1, phase: "await_external" }, { delaySeconds: 0 });
	});
});
