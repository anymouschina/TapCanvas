import { describe, expect, it } from "vitest";
import { VIDEO_ATOMIC_WORKFLOW_NODE_IDS } from "@tapcanvas/video-orchestrator-protocol";
import { buildVideoAtomicWorkflowSnapshot } from "./video-atomic-workflow-projection";

const now = "2026-08-12T08:00:00.000Z";

function artifact(
	artifactKey: string,
	status = "ready",
	payload: unknown = { artifactKey },
) {
	return {
		artifact_key: artifactKey,
		status,
		payload: JSON.stringify(payload),
		error: status === "failed" ? `${artifactKey}_failed` : null,
		created_at: now,
		updated_at: now,
	};
}

type RunFact = {
	id: string;
	state: string;
	authoring_state: string | null;
	beat_sheet: string | null;
	total_clips: number;
	clips_done: number;
	error_message: string | null;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
};

function run(overrides: Partial<RunFact> = {}): RunFact {
	return {
		id: "run-atomic",
		state: "collecting",
		authoring_state: "authoring_done",
		beat_sheet: JSON.stringify({ beats: [{ clipIndex: 0 }, { clipIndex: 1 }] }),
		total_clips: 2,
		clips_done: 0,
		error_message: null,
		created_at: now,
		updated_at: now,
		completed_at: null,
		...overrides,
	};
}

function manifest(executionScope: "prompt_only" | "media_delivery") {
	return artifact("graph:manifest", "ready", {
		protocolVersion: "2",
		runId: "run-atomic",
		executionScope,
		nodes: [
			{ key: "beat_sheet", kind: "beat_sheet", dependsOn: [] },
			{ key: "clip:0", kind: "clip_writer", clipIndex: 0, dependsOn: ["beat_sheet"] },
			{ key: "clip:1", kind: "clip_writer", clipIndex: 1, dependsOn: ["beat_sheet"] },
		],
	});
}

describe("video atomic workflow projection", () => {
	it("projects the canonical fifteen operations with independent prompt-only outputs", () => {
		const snapshot = buildVideoAtomicWorkflowSnapshot({
			run: run(),
			artifacts: [
				manifest("prompt_only"),
				artifact("beat_sheet", "ready", { beats: [{ clipIndex: 0 }, { clipIndex: 1 }] }),
				artifact("clip:0", "ready", { clipIndex: 0, clip: { clipPrompt: "提示词 A" } }),
				artifact("clip:1", "ready", { clipIndex: 1, clip: { clipPrompt: "提示词 B" } }),
				artifact("assembly:verification"),
				artifact("prompt:package", "ready", { clipCount: 2 }),
			],
			generatedAt: now,
		});

		expect(snapshot.nodes.map((node) => node.atomicNodeId)).toEqual(VIDEO_ATOMIC_WORKFLOW_NODE_IDS);
		expect(snapshot.executionScope).toBe("prompt_only");
		expect(snapshot.nodes.find((node) => node.atomicNodeId === "clip-fan-out")).toMatchObject({
			status: "succeeded",
			completedUnits: 2,
			totalUnits: 2,
		});
		const writer = snapshot.nodes.find((node) => node.atomicNodeId === "clip-writer-agent");
		expect(writer?.status).toBe("succeeded");
		expect(writer?.outputRefs.itemRuns).toEqual([
			expect.objectContaining({ itemId: "clip-0", status: "success", ports: { "clip-prompts": { text: "提示词 A", clipIndex: 0 } } }),
			expect.objectContaining({ itemId: "clip-1", status: "success", ports: { "clip-prompts": { text: "提示词 B", clipIndex: 1 } } }),
		]);
		expect(snapshot.nodes.find((node) => node.atomicNodeId === "prompt-package")?.status).toBe("succeeded");
		expect(snapshot.nodes.find((node) => node.atomicNodeId === "cost-estimate")?.status).toBe("queued");
	});

	it("keeps submission receipts separate from video result assets", () => {
		const snapshot = buildVideoAtomicWorkflowSnapshot({
			run: run({ state: "video_running", authoring_state: "authoring_done", clips_done: 1 }),
			artifacts: [
				manifest("media_delivery"),
				artifact("beat_sheet"),
				artifact("asset:coverage", "ready", {
					required: [
						{ kind: "character", name: "主角" },
						{ kind: "scene", name: "雨巷" },
					],
					available: [
						{ kind: "character", name: "主角" },
						{ kind: "scene", name: "雨巷" },
					],
					missing: [],
					requiredCount: 2,
					availableCount: 2,
					complete: true,
				}),
				artifact("clip:0", "ready", { clip: { clipPrompt: "A" } }),
				artifact("clip:1", "ready", { clip: { clipPrompt: "B" } }),
				artifact("assembly:verification"),
				artifact("estimate:auto"),
				artifact("production:handoff"),
				artifact("video-submission:0"),
				artifact("video-submission:1"),
				artifact("video-result:0", "ready", { clipIndex: 0, videoUrl: "https://cdn.example/0.mp4" }),
				artifact("video-result:1", "waiting_external", { clipIndex: 1 }),
			],
			effects: [0, 1].map((clipIndex) => ({
				id: `effect-${clipIndex}`,
				effect_key: `video-clip:${clipIndex}`,
				operation: "generate-video",
				status: "accepted",
				provider: "provider-a",
				provider_task_id: `task-${clipIndex}`,
				asset_url: clipIndex === 0 ? "https://cdn.example/0.mp4" : null,
				error_code: null,
				error_message: null,
				created_at: now,
				updated_at: now,
				accepted_at: now,
				materialized_at: clipIndex === 0 ? now : null,
				finished_at: null,
			})),
			generatedAt: now,
		});

		const submit = snapshot.nodes.find((node) => node.atomicNodeId === "video-submit");
		expect(submit).toMatchObject({ status: "succeeded", completedUnits: 2, totalUnits: 2 });
		expect(submit?.outputRefs.itemRuns).toHaveLength(2);
		const results = snapshot.nodes.find((node) => node.atomicNodeId === "video-results");
		expect(results).toMatchObject({ status: "waiting_external", completedUnits: 1, totalUnits: 2 });
		expect(results?.outputRefs.itemRuns[0]).toMatchObject({
			status: "success",
			artifacts: [{ type: "tapcanvas.video/v1", value: "https://cdn.example/0.mp4" }],
		});
		expect(snapshot.nodes.find((node) => node.atomicNodeId === "asset-fan-out")).toMatchObject({
			status: "succeeded",
			completedUnits: 2,
			totalUnits: 2,
		});
		expect(snapshot.nodes.find((node) => node.atomicNodeId === "asset-image-generate")).toMatchObject({
			status: "succeeded",
			completedUnits: 2,
			totalUnits: 2,
		});
	});

	it("projects a missing asset frontier as waiting without fabricating generated media", () => {
		const snapshot = buildVideoAtomicWorkflowSnapshot({
			run: run({ authoring_state: "asset_repair_required" }),
			artifacts: [
				manifest("media_delivery"),
				artifact("beat_sheet"),
				artifact("asset:coverage", "pending", {
					required: [
						{ kind: "character", name: "主角" },
						{ kind: "scene", name: "雨巷" },
					],
					available: [{ kind: "character", name: "主角" }],
					missing: [{ kind: "scene", name: "雨巷" }],
					requiredCount: 2,
					availableCount: 1,
					complete: false,
				}),
			],
			generatedAt: now,
		});

		const materialize = snapshot.nodes.find((node) => node.atomicNodeId === "asset-image-generate");
		expect(materialize).toMatchObject({
			status: "waiting_external",
			completedUnits: 1,
			totalUnits: 2,
			outputArtifactIds: ["character:主角"],
		});
		expect(materialize?.outputRefs.itemRuns).toEqual([
			expect.objectContaining({ itemId: "character:主角", status: "success", artifacts: [] }),
			expect.objectContaining({ itemId: "scene:雨巷", status: "waiting_external", artifacts: [] }),
		]);
	});

	it("surfaces corrupt persisted payloads as node errors without hiding the artifact", () => {
		const broken = { ...artifact("clip:0"), payload: "{not-json" };
		const snapshot = buildVideoAtomicWorkflowSnapshot({
			run: run({ total_clips: 1 }),
			artifacts: [manifest("prompt_only"), artifact("beat_sheet"), broken],
			generatedAt: now,
		});
		const writer = snapshot.nodes.find((node) => node.atomicNodeId === "clip-writer-agent");
		expect(writer?.outputArtifactIds).toEqual(["clip:0"]);
		expect(writer?.errorMessages).toContain("artifact_payload_invalid_json:clip:0");
	});
});
