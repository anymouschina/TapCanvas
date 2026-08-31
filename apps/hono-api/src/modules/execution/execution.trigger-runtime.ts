import {
	parseWorkflowTriggerSpec,
	type EventWorkflowTriggerSpecV1,
	type WebhookWorkflowTriggerSpecV1,
	type WorkflowTriggerSpecV1,
} from "@tapcanvas/workflow-kernel-protocol";
import type { WorkerEnv } from "../../types";
import type { FlowRow } from "../flow/flow.repo";
import { startWorkflowExecution, type StartWorkflowExecutionResult } from "./execution.start-service";

type TriggerCandidate<TSpec extends WorkflowTriggerSpecV1> = Readonly<{
	flow: FlowRow;
	triggerNodeId: string;
	workflowKey: string;
	workflowDefinitionVersion: number;
	spec: TSpec;
}>;

export type WorkflowTriggerDeliveryResult = Readonly<{
	flowId: string;
	triggerNodeId: string;
	created: boolean;
	executionId: string;
}>;

export type WorkflowTriggerDeliveryFailure = Readonly<{
	flowId: string;
	triggerNodeId: string;
	error: string;
}>;

export type WorkflowTriggerBatchResult = Readonly<{
	deliveries: readonly WorkflowTriggerDeliveryResult[];
	failures: readonly WorkflowTriggerDeliveryFailure[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, field: string): string {
	const value = record[field];
	return typeof value === "string" ? value.trim() : "";
}

function parseFlowData(flow: FlowRow): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(flow.data) as unknown;
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function candidatesFromFlow<TSpec extends WorkflowTriggerSpecV1>(
	flow: FlowRow,
	predicate: (spec: WorkflowTriggerSpecV1) => spec is TSpec,
): TriggerCandidate<TSpec>[] {
	const data = parseFlowData(flow);
	if (!data || !Array.isArray(data.nodes)) return [];
	return data.nodes.flatMap((rawNode): TriggerCandidate<TSpec>[] => {
		if (!isRecord(rawNode) || !isRecord(rawNode.data)) return [];
		const nodeData = rawNode.data;
		if (rawNode.type !== "taskNode" || nodeData.kind !== "workflowTrigger" || nodeData.adminWorkflow !== true) return [];
		const parsed = parseWorkflowTriggerSpec(nodeData.workflowTriggerSpec);
		if (!parsed.success || !predicate(parsed.data)) return [];
		const triggerNodeId = readString(rawNode, "id");
		const workflowKey = readString(nodeData, "workflowKey");
		const version = nodeData.workflowDefinitionVersion;
		if (!triggerNodeId || !workflowKey || !Number.isInteger(version) || Number(version) < 1) return [];
		return [{
			flow,
			triggerNodeId,
			workflowKey,
			workflowDefinitionVersion: Number(version),
			spec: parsed.data,
		}];
	});
}

async function listActiveAdminFlows(env: WorkerEnv, ownerId?: string): Promise<FlowRow[]> {
	const flows = await env.DB.flows.findMany({
		where: ownerId ? { owner_id: ownerId } : { owner_id: { not: null } },
		select: {
			id: true,
			name: true,
			data: true,
			owner_id: true,
			project_id: true,
			created_at: true,
			updated_at: true,
			canvas_revision: true,
		},
	});
	const activeAdmin = new Map<string, boolean>();
	const accepted: FlowRow[] = [];
	for (const flow of flows) {
		const flowOwnerId = flow.owner_id;
		if (!flowOwnerId) continue;
		let active = activeAdmin.get(flowOwnerId);
		if (active === undefined) {
			const owner = await env.DB.users.findUnique({
				where: { id: flowOwnerId },
				select: { role: true, disabled: true, deleted_at: true },
			});
			active = owner?.role === "admin" && owner.disabled === 0 && owner.deleted_at === null;
			activeAdmin.set(flowOwnerId, active);
		}
		if (active) accepted.push(flow);
	}
	return accepted;
}

function hex(bytes: ArrayBuffer): string {
	return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
	const length = Math.max(left.length, right.length);
	let difference = left.length ^ right.length;
	for (let index = 0; index < length; index += 1) {
		difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
	}
	return difference === 0;
}

async function verifyWebhookSignature(secret: string, rawBody: string, providedSignature: string): Promise<boolean> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
	return constantTimeEqual(`sha256=${hex(digest)}`, providedSignature.trim().toLowerCase());
}

function secretFromReference(env: WorkerEnv, secretRef: string): string | null {
	if (!secretRef.startsWith("env://")) return null;
	const binding = secretRef.slice("env://".length).trim();
	const secret = binding ? env[binding] : undefined;
	return typeof secret === "string" && secret.length > 0 ? secret : null;
}

async function startCandidate(
	env: WorkerEnv,
	candidate: TriggerCandidate<WorkflowTriggerSpecV1>,
	input: Readonly<{ trigger: string; deliveryId: string; payload: unknown; receivedAt: string }>,
): Promise<WorkflowTriggerDeliveryResult> {
	const ownerId = candidate.flow.owner_id;
	if (!ownerId) throw new Error("Workflow trigger flow has no owner");
	const result: StartWorkflowExecutionResult = await startWorkflowExecution(env, {
		flow: candidate.flow,
		ownerId,
		triggerNodeId: candidate.triggerNodeId,
		trigger: input.trigger,
		idempotencyKey: `${input.trigger}:${input.deliveryId}:${candidate.flow.id}:${candidate.triggerNodeId}`,
		triggerPayload: {
			version: 1,
			kind: candidate.spec.kind,
			deliveryId: input.deliveryId,
			receivedAt: input.receivedAt,
			workflowKey: candidate.workflowKey,
			workflowDefinitionVersion: candidate.workflowDefinitionVersion,
			payload: input.payload,
		},
	});
	return {
		flowId: candidate.flow.id,
		triggerNodeId: candidate.triggerNodeId,
		created: result.created,
		executionId: result.execution.id,
	};
}

async function startCandidates(
	env: WorkerEnv,
	candidates: readonly TriggerCandidate<WorkflowTriggerSpecV1>[],
	input: Readonly<{ trigger: string; deliveryId: string; payload: unknown; receivedAt: string }>,
): Promise<WorkflowTriggerBatchResult> {
	const settled = await Promise.all(candidates.map(async (candidate) => {
		try {
			return { ok: true as const, value: await startCandidate(env, candidate, input) };
		} catch (error: unknown) {
			return {
				ok: false as const,
				value: {
					flowId: candidate.flow.id,
					triggerNodeId: candidate.triggerNodeId,
					error: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}));
	return {
		deliveries: settled.flatMap((entry) => entry.ok ? [entry.value] : []),
		failures: settled.flatMap((entry) => entry.ok ? [] : [entry.value]),
	};
}

export async function deliverWorkflowWebhook(
	env: WorkerEnv,
	input: Readonly<{ webhookId: string; deliveryId: string; signature: string; rawBody: string; payload: unknown; receivedAt?: Date }>,
): Promise<WorkflowTriggerBatchResult> {
	const flows = await listActiveAdminFlows(env);
	const candidates = flows.flatMap((flow) => candidatesFromFlow(
		flow,
		(spec): spec is WebhookWorkflowTriggerSpecV1 => spec.kind === "webhook" && spec.webhookId === input.webhookId,
	));
	if (candidates.length === 0) throw new Error("workflow_webhook_not_found");
	const authenticated: TriggerCandidate<WebhookWorkflowTriggerSpecV1>[] = [];
	let missingSecrets = 0;
	for (const candidate of candidates) {
		const secret = secretFromReference(env, candidate.spec.secretRef);
		if (!secret) {
			missingSecrets += 1;
			continue;
		}
		if (await verifyWebhookSignature(secret, input.rawBody, input.signature)) authenticated.push(candidate);
	}
	if (authenticated.length === 0) {
		if (missingSecrets === candidates.length) throw new Error("workflow_webhook_secret_unavailable");
		throw new Error("workflow_webhook_signature_invalid");
	}
	const receivedAt = (input.receivedAt ?? new Date()).toISOString();
	return startCandidates(env, authenticated, {
		trigger: `webhook:${input.webhookId}`,
		deliveryId: input.deliveryId,
		payload: input.payload,
		receivedAt,
	});
}

function matchesEventFilter(payload: unknown, filter: EventWorkflowTriggerSpecV1["filter"]): boolean {
	if (Object.keys(filter).length === 0) return true;
	if (!isRecord(payload)) return false;
	return Object.entries(filter).every(([key, expected]) => Object.is(payload[key], expected));
}

export async function deliverWorkflowEvent(
	env: WorkerEnv,
	input: Readonly<{ ownerId: string; topic: string; eventId: string; payload: unknown; receivedAt?: Date }>,
): Promise<WorkflowTriggerBatchResult> {
	const flows = await listActiveAdminFlows(env, input.ownerId);
	const candidates = flows.flatMap((flow) => candidatesFromFlow(
		flow,
		(spec): spec is EventWorkflowTriggerSpecV1 => spec.kind === "event"
			&& spec.topic === input.topic
			&& matchesEventFilter(input.payload, spec.filter),
	));
	const receivedAt = (input.receivedAt ?? new Date()).toISOString();
	return startCandidates(env, candidates, {
		trigger: `event:${input.topic}`,
		deliveryId: input.eventId,
		payload: input.payload,
		receivedAt,
	});
}
