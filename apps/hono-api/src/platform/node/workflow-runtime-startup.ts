import type { WorkerEnv } from "../../types";

export type WorkflowRuntimeStartupFacts = Readonly<{
	agentsBridgeOrigin: string;
	callbackOrigin: string;
}>;

function readRequiredHttpOrigin(value: unknown, field: string): string {
	const raw = typeof value === "string" ? value.trim().replace(/\/+$/u, "") : "";
	if (!raw) throw new Error(`Workflow runtime startup requires ${field}`);
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`Workflow runtime startup ${field} must be an absolute URL`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Workflow runtime startup ${field} must use http or https`);
	}
	return url.origin;
}

/**
 * The Node API owns restart recovery. It must prove both halves of the Agents
 * transport before touching a persisted workflow: the outbound bridge and the
 * inbound remote-tool callback. Refusing startup preserves the task for a
 * correctly configured owner instead of consuming retries and terminalizing it.
 */
export function assertWorkflowRuntimeStartupReady(
	env: Pick<WorkerEnv, "AGENTS_BRIDGE_BASE_URL" | "TAPCANVAS_API_INTERNAL_BASE" | "TAPCANVAS_API_BASE_URL">,
): WorkflowRuntimeStartupFacts {
	return {
		agentsBridgeOrigin: readRequiredHttpOrigin(
			env.AGENTS_BRIDGE_BASE_URL,
			"AGENTS_BRIDGE_BASE_URL",
		),
		callbackOrigin: readRequiredHttpOrigin(
			env.TAPCANVAS_API_INTERNAL_BASE ?? env.TAPCANVAS_API_BASE_URL,
			"TAPCANVAS_API_INTERNAL_BASE or TAPCANVAS_API_BASE_URL",
		),
	};
}
