import { describe, expect, it } from "vitest";

import {
	collectPublicChatMaterializedToolAssets,
	collectPublicChatToolDeliveryArtifacts,
} from "./public-chat-tool-asset-evidence";

describe("collectPublicChatMaterializedToolAssets", () => {
	it("counts real URLs from successful image and video tool outputs", () => {
		const result = collectPublicChatMaterializedToolAssets([
			{
				status: "succeeded",
				outputJson: {
					ok: true,
					nodeId: "cover-1",
					status: "success",
					imageUrl: "https://cdn.example/cover.png",
				},
			},
			{
				status: "succeeded",
				outputJson: {
					data: { videoResults: [{ url: "https://cdn.example/clip.mp4" }] },
				},
			},
		]);

		expect(result).toEqual({
			imageUrls: ["https://cdn.example/cover.png"],
			videoUrls: ["https://cdn.example/clip.mp4"],
		});
	});

	it("reads materialized URLs from canonical wrapped batch children", () => {
		const result = collectPublicChatMaterializedToolAssets([
			{
				status: "succeeded",
				outputJson: {
					ok: true,
					data: {
						results: [
							{ status: "success", imageUrl: "https://cdn.example/a.png" },
							{ status: "success", imageUrl: "https://cdn.example/b.png" },
						],
					},
				},
			},
		]);

		expect(result).toEqual({
			imageUrls: ["https://cdn.example/a.png", "https://cdn.example/b.png"],
			videoUrls: [],
		});
	});

	it("does not promote queued placeholders, failed outputs, or invalid URLs", () => {
		const result = collectPublicChatMaterializedToolAssets([
			{
				status: "succeeded",
				outputJson: { ok: true, status: "queued", nodeId: "cover-queued", taskId: "task-1" },
			},
			{
				status: "failed",
				outputJson: { imageUrl: "https://cdn.example/failed.png" },
			},
			{
				status: "succeeded",
				outputJson: { ok: false, imageUrl: "https://cdn.example/not-ok.png" },
			},
			{
				status: "succeeded",
				outputJson: { imageUrl: "not-a-url" },
			},
		]);

		expect(result).toEqual({ imageUrls: [], videoUrls: [] });
	});
});

describe("collectPublicChatToolDeliveryArtifacts", () => {
	it("projects workflow start and same-family resume receipts as execution family dependencies", () => {
		const result = collectPublicChatToolDeliveryArtifacts([
			"tapcanvas_equipped_workflow_run",
			"tapcanvas_workflow_resume",
		].map((name, index) => ({
			toolCallId: `call-workflow-${index}`,
			name,
			status: "succeeded",
			outputJson: {
				protocolVersion: "tapcanvas.workflow-execution-receipt/v1",
				runId: `workflow-execution-${index}`,
				executionFamilyId: "workflow-execution-root",
				status: "running",
				acceptedAsync: true,
			},
		})));

		expect(result).toHaveLength(2);
		expect(result).toEqual(expect.arrayContaining([
			expect.objectContaining({
				assetType: "workflow",
				deliveryState: "accepted_async",
				runProtocol: "workflow_execution_family",
			}),
		]));
	});

	it("preserves canonical materialized image evidence independently of output previews", () => {
		const result = collectPublicChatToolDeliveryArtifacts([
			{
				toolCallId: "call-image",
				name: "tapcanvas_image_generate_to_canvas",
				status: "succeeded",
				outputJson: {
					ok: true,
					status: "success",
					nodeId: "image-node",
					taskId: "image-task",
					imageUrl: "https://cdn.example/image.png",
				},
			},
		]);

		expect(result).toEqual([
			{
				toolCallId: "call-image",
				toolName: "tapcanvas_image_generate_to_canvas",
				assetType: "image",
				deliveryState: "materialized",
				nodeId: "image-node",
				taskId: "image-task",
				runId: null,
				clipIndex: null,
				assetUrl: "https://cdn.example/image.png",
			},
		]);
	});

	it("records queued image generation as accepted async only with stable identity", () => {
		const result = collectPublicChatToolDeliveryArtifacts([
			{
				toolCallId: "call-accepted",
				name: "tapcanvas_image_generate_to_canvas",
				status: "succeeded",
				outputJson: {
					ok: true,
					status: "running",
					nodeId: "image-node",
					taskId: "image-task",
				},
			},
			{
				toolCallId: "call-no-identity",
				name: "tapcanvas_image_generate_to_canvas",
				status: "succeeded",
				outputJson: { ok: true, status: "queued" },
			},
		]);

		expect(result).toEqual([
			{
				toolCallId: "call-accepted",
				toolName: "tapcanvas_image_generate_to_canvas",
				assetType: "image",
				deliveryState: "accepted_async",
				nodeId: "image-node",
				taskId: "image-task",
				runId: null,
				clipIndex: null,
				assetUrl: null,
			},
		]);
	});

	it("preserves the parent completion boundary on accepted image receipts", () => {
		const result = collectPublicChatToolDeliveryArtifacts([{
			toolCallId: "call-submitted-image",
			name: "tapcanvas_image_generate_to_canvas",
			status: "succeeded",
			outputJson: {
				ok: true,
				completionBoundary: "submission",
				results: [{
					ok: true,
					status: "running",
					nodeId: "image-node",
					taskId: "image-task",
				}],
			},
		}]);

		expect(result).toEqual([
			expect.objectContaining({
				deliveryState: "accepted_async",
				nodeId: "image-node",
				taskId: "image-task",
				completionBoundary: "submission",
			}),
		]);
	});

	it("preserves every node dependency from an async batch submission", () => {
		const result = collectPublicChatToolDeliveryArtifacts([
			{
				toolCallId: "call-batch",
				name: "tapcanvas_image_generate_to_canvas",
				status: "succeeded",
				outputJson: {
					ok: true,
					batch: true,
					status: "running",
					results: [
						{ nodeId: "anchor-hero", taskId: "task-hero", status: "running" },
						{ nodeId: "anchor-city", taskId: "task-city", status: "running" },
					],
				},
			},
		]);

		expect(result.map((artifact) => [artifact.nodeId, artifact.taskId])).toEqual([
			["anchor-hero", "task-hero"],
			["anchor-city", "task-city"],
		]);
	});

	it("preserves every dependency from the canonical wrapped batch response", () => {
		const result = collectPublicChatToolDeliveryArtifacts([
			{
				toolCallId: "call-wrapped-batch",
				name: "tapcanvas_image_generate_to_canvas",
				status: "succeeded",
				outputJson: {
					ok: true,
					content: "batch accepted",
					data: {
						ok: true,
						batch: true,
						results: [
							{ nodeId: "keyframe-before", taskId: "task-before", status: "running" },
							{ nodeId: "keyframe-after", taskId: "task-after", status: "queued" },
						],
					},
				},
			},
		]);

		expect(result).toEqual([
			{
				toolCallId: "call-wrapped-batch",
				toolName: "tapcanvas_image_generate_to_canvas",
				assetType: "image",
				deliveryState: "accepted_async",
				nodeId: "keyframe-before",
				taskId: "task-before",
				runId: null,
				clipIndex: null,
				assetUrl: null,
			},
			{
				toolCallId: "call-wrapped-batch",
				toolName: "tapcanvas_image_generate_to_canvas",
				assetType: "image",
				deliveryState: "accepted_async",
				nodeId: "keyframe-after",
				taskId: "task-after",
				runId: null,
				clipIndex: null,
				assetUrl: null,
			},
		]);
	});

	it("uses the explicit logical tool identity when wrapper input has already been redacted", () => {
		const result = collectPublicChatToolDeliveryArtifacts([
			{
				toolCallId: "call-redacted-wrapper-batch",
				name: "tapcanvas_call_tool",
				logicalToolName: "tapcanvas_image_generate_to_canvas",
				status: "succeeded",
				inputJson: {
					name: { type: "string", chars: 34, sha256: "redacted" },
					args: { nodes: [{ data: { prompt: { type: "string", chars: 120, sha256: "redacted" } } }] },
				},
				outputJson: {
					ok: true,
					data: {
						ok: true,
						batch: true,
						results: [
							{ nodeId: "asset-doctor", status: "running" },
							{ nodeId: "asset-old-home", status: "running" },
							{ nodeId: "asset-village", status: "running" },
							{ nodeId: "asset-matchmaking-home", status: "running" },
						],
					},
				},
			},
		]);

		expect(result.map((artifact) => [artifact.toolName, artifact.nodeId, artifact.deliveryState])).toEqual([
			["tapcanvas_image_generate_to_canvas", "asset-doctor", "accepted_async"],
			["tapcanvas_image_generate_to_canvas", "asset-old-home", "accepted_async"],
			["tapcanvas_image_generate_to_canvas", "asset-village", "accepted_async"],
			["tapcanvas_image_generate_to_canvas", "asset-matchmaking-home", "accepted_async"],
		]);
	});

	it("keeps materialized wrapped batch URLs paired with their own node identities", () => {
		const result = collectPublicChatToolDeliveryArtifacts([
			{
				toolCallId: "call-wrapped-complete",
				name: "tapcanvas_image_generate_to_canvas",
				status: "succeeded",
				outputJson: {
					ok: true,
					data: {
						results: [
							{
								nodeId: "image-a",
								taskId: "task-a",
								status: "success",
								imageUrl: "https://cdn.example/a.png",
							},
							{
								nodeId: "image-b",
								taskId: "task-b",
								status: "success",
								imageUrl: "https://cdn.example/b.png",
							},
						],
					},
				},
			},
		]);

		expect(result.map((artifact) => [artifact.nodeId, artifact.taskId, artifact.assetUrl])).toEqual([
			["image-a", "task-a", "https://cdn.example/a.png"],
			["image-b", "task-b", "https://cdn.example/b.png"],
		]);
	});

	it("reads accepted async lifecycle and identity from structured nested output", () => {
		const result = collectPublicChatToolDeliveryArtifacts([
			{
				toolCallId: "call-video",
				name: "tapcanvas_equipped_workflow_run",
				status: "succeeded",
				outputJson: {
					ok: true,
					data: { state: "video_running", runId: "video-run-1" },
				},
			},
		]);

		expect(result).toEqual([
			{
				toolCallId: "call-video",
				toolName: "tapcanvas_equipped_workflow_run",
				assetType: "workflow",
				deliveryState: "accepted_async",
				nodeId: null,
				taskId: null,
				runId: "video-run-1",
				runProtocol: "workflow_execution_family",
				clipIndex: null,
				assetUrl: null,
			},
		]);
	});

	it("treats an accepted orchestrator commit as asynchronous video delivery evidence", () => {
		const result = collectPublicChatToolDeliveryArtifacts([
			{
				toolCallId: "call-video-commit",
				name: "tapcanvas_equipped_workflow_run",
				status: "succeeded",
				outputJson: {
					ok: true,
					acceptedAsync: true,
					shouldYield: true,
					runId: "video-run-commit",
				},
			},
		]);

		expect(result).toEqual([
			{
				toolCallId: "call-video-commit",
				toolName: "tapcanvas_equipped_workflow_run",
				assetType: "workflow",
				deliveryState: "accepted_async",
				nodeId: null,
				taskId: null,
				runId: "video-run-commit",
				runProtocol: "workflow_execution_family",
				clipIndex: null,
				assetUrl: null,
			},
		]);
	});

	it("accepts capacity-waiting video and running audio submissions with stable identities", () => {
		const result = collectPublicChatToolDeliveryArtifacts([
			{
				toolCallId: "call-video-capacity",
				name: "tapcanvas_equipped_workflow_run",
				status: "succeeded",
				outputJson: { status: "submit_waiting_capacity", runId: "run-capacity" },
			},
			{
				toolCallId: "call-audio-running",
				name: "tapcanvas_audio_generate_to_canvas",
				status: "succeeded",
				outputJson: { status: "running", nodeId: "audio-node", taskId: "audio-task" },
			},
		]);

		expect(result.map((artifact) => [artifact.assetType, artifact.deliveryState])).toEqual([
			["workflow", "accepted_async"],
			["audio", "accepted_async"],
		]);
	});

	it("preserves a video clip index from structured input without parsing ids or prompts", () => {
		const result = collectPublicChatToolDeliveryArtifacts([
			{
				toolCallId: "call-scoped-video",
				name: "tapcanvas_video_generate_to_canvas",
				status: "succeeded",
				inputJson: {
					node: {
						id: "opaque-node-id",
						data: { clipIndex: 3 },
					},
				},
				outputJson: {
					ok: true,
					status: "running",
					nodeId: "opaque-node-id",
					taskId: "task-scoped-video",
				},
			},
		]);

		expect(result).toMatchObject([
			{
				assetType: "video",
				nodeId: "opaque-node-id",
				clipIndex: 3,
			},
		]);
	});

	it("does not treat URLs returned by read-only tools as generated delivery", () => {
		const result = collectPublicChatToolDeliveryArtifacts([
			{
				toolCallId: "call-read",
				name: "tapcanvas_get_style_reference",
				status: "succeeded",
				outputJson: {
					ok: true,
					imageUrl: "https://cdn.example/existing-style.png",
				},
			},
		]);

		expect(result).toEqual([]);
	});
});
