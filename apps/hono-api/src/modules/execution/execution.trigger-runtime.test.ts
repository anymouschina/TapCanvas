import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerEnv } from "../../types";
import { startWorkflowExecution } from "./execution.start-service";
import { deliverWorkflowEvent, deliverWorkflowWebhook } from "./execution.trigger-runtime";

vi.mock("./execution.start-service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./execution.start-service")>();
	return { ...actual, startWorkflowExecution: vi.fn() };
});

function flowWithTrigger(spec: Record<string, unknown>, id = "flow-1") {
	return {
		id,
		name: "Workflow",
		data: JSON.stringify({
			nodes: [{
				id: "trigger-1",
				type: "taskNode",
				data: {
					kind: "workflowTrigger",
					adminWorkflow: true,
					workflowKey: "agent-workflow/v1",
					workflowDefinitionVersion: 3,
					workflowTriggerSpec: spec,
				},
			}],
			edges: [],
		}),
		owner_id: "owner-1",
		project_id: "project-1",
		created_at: "2026-08-13T00:00:00.000Z",
		updated_at: "2026-08-13T00:00:00.000Z",
		canvas_revision: 1,
	};
}

function envWithFlows(flows: readonly ReturnType<typeof flowWithTrigger>[], secrets: Record<string, string> = {}): WorkerEnv {
	return {
		...secrets,
		DB: {
			flows: { findMany: vi.fn(async () => flows) },
			users: { findUnique: vi.fn(async () => ({ role: "admin", disabled: 0, deleted_at: null })) },
		},
		JWT_SECRET: "test",
	} as unknown as WorkerEnv;
}

function envWithFlow(flow: ReturnType<typeof flowWithTrigger>, secrets: Record<string, string> = {}): WorkerEnv {
	return envWithFlows([flow], secrets);
}

async function signature(secret: string, rawBody: string): Promise<string> {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
	const value = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `sha256=${value}`;
}

describe("workflow external trigger runtime", () => {
	beforeEach(() => {
		vi.mocked(startWorkflowExecution).mockReset();
		vi.mocked(startWorkflowExecution).mockImplementation(async (_env, input) => ({
			created: true,
			execution: {
				id: `execution-${input.triggerNodeId}`,
				executionFamilyId: `execution-${input.triggerNodeId}`,
				flowId: input.flow.id,
				flowVersionId: "runtime-version",
				ownerId: input.ownerId,
				status: "running",
				concurrency: 1,
				trigger: input.trigger,
				createdAt: "2026-08-13T00:00:00.000Z",
				startedAt: null,
				finishedAt: null,
			},
		}));
	});

	it("authenticates the raw webhook body and freezes its payload with an idempotent delivery identity", async () => {
		const rawBody = JSON.stringify({ action: "publish", itemId: "item-1" });
		const secret = "webhook-secret";
		const flow = flowWithTrigger({ version: 1, kind: "webhook", webhookId: "publish", secretRef: "env://WEBHOOK_SECRET" });
		const result = await deliverWorkflowWebhook(envWithFlow(flow, { WEBHOOK_SECRET: secret }), {
			webhookId: "publish",
			deliveryId: "delivery-1",
			signature: await signature(secret, rawBody),
			rawBody,
			payload: JSON.parse(rawBody) as unknown,
			receivedAt: new Date("2026-08-13T01:00:00.000Z"),
		});
		expect(result).toEqual({
			deliveries: [{ flowId: "flow-1", triggerNodeId: "trigger-1", created: true, executionId: "execution-trigger-1" }],
			failures: [],
		});
		expect(startWorkflowExecution).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			trigger: "webhook:publish",
			idempotencyKey: "webhook:publish:delivery-1:flow-1:trigger-1",
			triggerPayload: expect.objectContaining({ kind: "webhook", deliveryId: "delivery-1", payload: { action: "publish", itemId: "item-1" } }),
		}));
	});

	it("delivers an authenticated event only when its scalar filter matches", async () => {
		const flow = flowWithTrigger({ version: 1, kind: "event", topic: "asset.ready", filter: { assetType: "video", ready: true } });
		const result = await deliverWorkflowEvent(envWithFlow(flow), {
			ownerId: "owner-1",
			topic: "asset.ready",
			eventId: "event-1",
			payload: { assetType: "video", ready: true, assetId: "asset-1" },
		});
		expect(result.deliveries).toHaveLength(1);
		expect(startWorkflowExecution).toHaveBeenCalledTimes(1);
		vi.mocked(startWorkflowExecution).mockClear();
		const ignored = await deliverWorkflowEvent(envWithFlow(flow), {
			ownerId: "owner-1",
			topic: "asset.ready",
			eventId: "event-2",
			payload: { assetType: "image", ready: true },
		});
		expect(ignored).toEqual({ deliveries: [], failures: [] });
		expect(startWorkflowExecution).not.toHaveBeenCalled();
	});

	it("preserves successful deliveries and reports every failed candidate", async () => {
		const first = flowWithTrigger({ version: 1, kind: "event", topic: "asset.ready", filter: {} }, "flow-1");
		const second = flowWithTrigger({ version: 1, kind: "event", topic: "asset.ready", filter: {} }, "flow-2");
		vi.mocked(startWorkflowExecution).mockImplementation(async (_env, input) => {
			if (input.flow.id === "flow-2") throw new Error("scheduler rejected flow-2");
			return {
				created: true,
				execution: {
					id: "execution-trigger-1",
					executionFamilyId: "execution-trigger-1",
					flowId: input.flow.id,
					flowVersionId: "runtime-version",
					ownerId: input.ownerId,
					status: "running",
					concurrency: 1,
					trigger: input.trigger,
					createdAt: "2026-08-13T00:00:00.000Z",
					startedAt: null,
					finishedAt: null,
				},
			};
		});
		const result = await deliverWorkflowEvent(envWithFlows([first, second]), {
			ownerId: "owner-1",
			topic: "asset.ready",
			eventId: "event-partial",
			payload: { assetId: "asset-1" },
		});
		expect(result).toEqual({
			deliveries: [{ flowId: "flow-1", triggerNodeId: "trigger-1", created: true, executionId: "execution-trigger-1" }],
			failures: [{ flowId: "flow-2", triggerNodeId: "trigger-1", error: "scheduler rejected flow-2" }],
		});
	});
});
