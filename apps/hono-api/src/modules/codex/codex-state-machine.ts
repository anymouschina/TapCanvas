import {
	isCodexTerminalTaskState,
	type CodexTaskState,
} from "@tapcanvas/codex-task-protocol";

const allowedTransitions: Readonly<
	Record<CodexTaskState, ReadonlySet<CodexTaskState>>
> = {
	queued: new Set(["claimed", "canceled"]),
	claimed: new Set(["codex_running", "failed", "canceled", "unknown"]),
	codex_running: new Set([
		"awaiting_user_input",
		"remote_build_queued",
		"succeeded",
		"codex_failed",
		"canceled",
		"unknown",
	]),
	awaiting_user_input: new Set(),
	codex_failed: new Set(),
	remote_build_queued: new Set([
		"remote_build_running",
		"failed",
		"canceled",
		"unknown",
	]),
	remote_build_running: new Set([
		"succeeded",
		"failed",
		"remote_build_failed_code",
		"remote_build_failed_infrastructure",
		"canceled",
		"unknown",
	]),
	remote_build_failed_code: new Set(),
	remote_build_failed_infrastructure: new Set([
		"fallback_waiting_approval",
		"failed",
		"unknown",
	]),
	fallback_waiting_approval: new Set([
		"local_fallback_approved",
		"failed",
		"canceled",
	]),
	local_fallback_approved: new Set([
		"local_build_running",
		"failed",
		"canceled",
	]),
	local_build_running: new Set(["succeeded", "failed", "canceled", "unknown"]),
	succeeded: new Set(),
	failed: new Set(),
	canceled: new Set(),
	unknown: new Set(),
};

export function canTransitionCodexTask(
	from: CodexTaskState,
	to: CodexTaskState,
): boolean {
	if (from === to) return !isCodexTerminalTaskState(from);
	return allowedTransitions[from].has(to);
}

export function assertCodexTaskTransition(
	from: CodexTaskState,
	to: CodexTaskState,
): void {
	if (canTransitionCodexTask(from, to)) return;
	throw new Error(`Codex task state transition rejected: ${from} -> ${to}`);
}
