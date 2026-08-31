import { createHash } from "node:crypto";

export const AGENTS_BRIDGE_SESSION_AFFINITY_HEADER =
	"x-tapcanvas-agent-session-affinity";

/**
 * Stateful bridge routes must share one replica identity without exposing a
 * raw user or session identifier to the load balancer. The versioned digest
 * is an internal routing key only; durable PostgreSQL state remains the
 * authority used after the owning replica actually disappears.
 */
export function buildAgentsBridgeSessionAffinity(input: {
	userId: string;
	sessionId: string | null | undefined;
}): string | null {
	const userId = input.userId.trim();
	const sessionId = input.sessionId?.trim() ?? "";
	if (!sessionId) return null;
	if (!userId) {
		throw new Error("agents_bridge_session_affinity_user_required");
	}
	return `v1-${createHash("sha256")
		.update(`${userId}\u0000${sessionId}`)
		.digest("hex")}`;
}

export function buildAgentsBridgeSessionAffinityHeader(input: {
	userId: string;
	sessionId: string | null | undefined;
}): Record<string, string> {
	const affinity = buildAgentsBridgeSessionAffinity(input);
	return affinity
		? { [AGENTS_BRIDGE_SESSION_AFFINITY_HEADER]: affinity }
		: {};
}
