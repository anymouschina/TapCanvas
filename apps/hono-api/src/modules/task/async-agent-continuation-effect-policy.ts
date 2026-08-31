import type { AsyncAgentContinuation } from "./async-agent-continuation";

/**
 * Provider-submitting entry points must never be replayed by a dependency
 * continuation. The accepted artifact tuple already owns the delivery
 * obligation; a resumed physical run may reconcile it or advance an
 * idempotent durable orchestrator, but it cannot create a parallel paid job.
 *
 * This list is capability-based rather than delivery-kind based. It therefore
 * protects image, video, audio and future mixed-media tasks without inspecting
 * user prose, prompts, node labels or chapter-specific data.
 */
export const ASYNC_DEPENDENCY_REPLAY_DENIED_REMOTE_TOOLS = [
	"tapcanvas_image_generate_to_canvas",
	"tapcanvas_video_generate_to_canvas",
	"tapcanvas_voice_card_dub",
	"tapcanvas_capture_director_scene",
	"tapcanvas_render_director_clip",
	"tapcanvas_hyperframes_render",
	"tapcanvas_workflow_run",
	"tapcanvas_equipped_workflow_run",
] as const;

export function resolveAsyncContinuationDeniedRemoteTools(
	continuation: Pick<AsyncAgentContinuation, "resumeTrigger" | "artifactDependencies">,
): readonly string[] {
	if (
		continuation.resumeTrigger !== "dependency" ||
		!continuation.artifactDependencies ||
		continuation.artifactDependencies.length === 0
	) return [];
	return ASYNC_DEPENDENCY_REPLAY_DENIED_REMOTE_TOOLS;
}
