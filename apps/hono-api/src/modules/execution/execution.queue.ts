import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import type { WorkerEnv } from "../../types";

export type WorkflowNodeJob = {
	executionId: string;
	nodeId: string;
};

export async function handleWorkflowNodeJob(
	env: WorkerEnv,
	job: WorkflowNodeJob,
): Promise<void> {
	const executionId = (job?.executionId || "").trim();
	const nodeId = (job?.nodeId || "").trim();
	if (!executionId || !nodeId) return;

	const ns = (env as any).EXECUTION_DO as DurableObjectNamespace | undefined;
	if (!ns) throw new Error("EXECUTION_DO binding missing");

	const id = ns.idFromName(executionId);
	const stub = ns.get(id);

	// Mark started
	await stub.fetch("https://do/nodeStarted", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ nodeId }),
	});

	// TODO: Replace with real node executor (Sora/Veo/etc.) using stored node data.
	// For now, simulate a small async delay.
	await new Promise((r) => setTimeout(r, 80));

	// Complete success
	await stub.fetch("https://do/nodeComplete", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ nodeId, ok: true }),
	});
}
