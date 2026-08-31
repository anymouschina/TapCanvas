import { describe, expect, it } from "vitest";
import {
	ASYNC_DEPENDENCY_REPLAY_DENIED_REMOTE_TOOLS,
	resolveAsyncContinuationDeniedRemoteTools,
} from "./async-agent-continuation-effect-policy";

describe("async dependency continuation effect policy", () => {
	it("denies new provider submissions while an accepted artifact owns delivery", () => {
		const denied = resolveAsyncContinuationDeniedRemoteTools({
			resumeTrigger: "dependency",
			artifactDependencies: [{
				version: 2,
				artifactId: "image:node:cover-1",
				nodeId: "cover-1",
				taskId: "task-cover-1",
				runId: null,
				runProtocol: null,
			}],
		});

		expect(denied).toBe(ASYNC_DEPENDENCY_REPLAY_DENIED_REMOTE_TOOLS);
		expect(denied).toContain("tapcanvas_image_generate_to_canvas");
		expect(denied).toContain("tapcanvas_video_generate_to_canvas");
		expect(denied).not.toContain("tapcanvas_image_reconcile");
		expect(denied).not.toContain("tapcanvas_video_orchestrate");
	});

	it.each(["physical_budget", "replan"] as const)(
		"does not narrow ordinary %s execution windows",
		(resumeTrigger) => {
			expect(resolveAsyncContinuationDeniedRemoteTools({
				resumeTrigger,
				artifactDependencies: [{
					version: 2,
					artifactId: "image:node:cover-1",
					nodeId: "cover-1",
					taskId: "task-cover-1",
					runId: null,
					runProtocol: null,
				}],
			})).toEqual([]);
		},
	);

	it("does not invent an effect fence when the exact dependency tuple is absent", () => {
		expect(resolveAsyncContinuationDeniedRemoteTools({
			resumeTrigger: "dependency",
			artifactDependencies: [],
		})).toEqual([]);
	});
});
