import type { WorkerEnv } from "../../types";
import type { WorkflowPluginOwnerAdapter } from "./execution.plugin-runtime";

/**
 * Trusted plugin runtime adapters are code-owned capabilities. They must be
 * registered here and shipped with Hono; database manifests, environment URLs,
 * and user input can never create an executable adapter.
 *
 * The catalog intentionally starts empty. The persistence and admission layer
 * can accept a version only when its exact owner identity is present in this
 * list, so future custom nodes cannot turn declarative metadata into arbitrary
 * Worker code execution.
 */
export function createTrustedWorkflowPluginOwnerAdapters(
	_env: WorkerEnv,
): readonly WorkflowPluginOwnerAdapter[] {
	return Object.freeze([]);
}
