import {
	parseWorkflowKnowledgeCandidateSetV1,
	parseWorkflowKnowledgeCardV1,
	type WorkflowKnowledgeCandidateSetV1,
	type WorkflowKnowledgeCardV1,
} from "@tapcanvas/workflow-kernel-protocol";
import type { WorkerEnv } from "../../types";

export type WorkflowKnowledgeSearchRequest = Readonly<{
	ownerId: string;
	rawUserRequest: string;
	query: string;
	roleScope: string | null;
	domain: string | null;
	strictFilters: boolean;
	limit: number;
}>;

function bridgeBaseUrl(env: WorkerEnv): string {
	const value = String(env.AGENTS_BRIDGE_BASE_URL ?? "").trim().replace(/\/+$/u, "");
	if (!value) throw new Error("Workflow knowledge requires AGENTS_BRIDGE_BASE_URL");
	return value;
}

function bridgeTimeoutMs(env: WorkerEnv): number {
	const raw = String(env.AGENTS_BRIDGE_TIMEOUT_MS ?? "").trim();
	if (!raw) return 120_000;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1_000) {
		throw new Error("AGENTS_BRIDGE_TIMEOUT_MS must be an integer of at least 1000ms");
	}
	return value;
}

async function requestWorkflowKnowledge(env: WorkerEnv, pathname: string, body: unknown): Promise<unknown> {
	let response: Response;
	try {
		response = await fetch(`${bridgeBaseUrl(env)}${pathname}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(String(env.AGENTS_BRIDGE_TOKEN ?? "").trim()
					? { Authorization: `Bearer ${String(env.AGENTS_BRIDGE_TOKEN).trim()}` }
					: {}),
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(bridgeTimeoutMs(env)),
		});
	} catch (error: unknown) {
		throw new Error(`Workflow knowledge bridge request failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	const raw = await response.text();
	let payload: unknown = null;
	if (raw.trim()) {
		try {
			payload = JSON.parse(raw) as unknown;
		} catch {
			throw new Error(`Workflow knowledge bridge returned invalid JSON (${response.status})`);
		}
	}
	if (!response.ok) {
		const message = payload && typeof payload === "object" && !Array.isArray(payload)
			&& typeof (payload as Record<string, unknown>).message === "string"
			? String((payload as Record<string, unknown>).message)
			: `Workflow knowledge bridge failed (${response.status})`;
		throw new Error(message);
	}
	return payload;
}

export async function searchWorkflowKnowledge(
	env: WorkerEnv,
	request: WorkflowKnowledgeSearchRequest,
): Promise<WorkflowKnowledgeCandidateSetV1> {
	return parseWorkflowKnowledgeCandidateSetV1(await requestWorkflowKnowledge(
		env,
		"/workflow/knowledge/search",
		request,
	));
}

export async function readWorkflowKnowledge(
	env: WorkerEnv,
	request: Readonly<{ candidateSet: WorkflowKnowledgeCandidateSetV1; cardId: string }>,
): Promise<WorkflowKnowledgeCardV1> {
	return parseWorkflowKnowledgeCardV1(await requestWorkflowKnowledge(
		env,
		"/workflow/knowledge/read",
		request,
	));
}
