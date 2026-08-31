import { describe, expect, it } from "vitest";

import {
	buildWorkflowCapabilityDescriptor,
	capabilityDescriptorSha256,
	detectBuiltInCapabilityConflicts,
	detectStructuralCapabilityConflicts,
	inspectVideoWorkflowCanvasDefinition,
	omitNonCompetingCapabilityConflicts,
	workflowCapabilityDescriptorsShareInvocationRoute,
} from "./capability-bay.descriptor";
import {
	VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
	VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
} from "@tapcanvas/video-orchestrator-protocol";

function workflowVersion(versionId: string, outputArtifactType = "video", description = "") {
	return {
		flow: {
			id: "flow-one-click",
			name: "一键成片",
			data: "{}",
			project_id: "project-1",
			canvas_revision: 8,
		},
		version: {
			id: versionId,
			data: JSON.stringify({
				...(description ? { workflowCapabilityDescription: description } : {}),
				nodes: [
					{ id: "trigger", data: { kind: "workflowTrigger" } },
					{
						id: "source",
						data: {
							kind: "workflowStage",
							workflowSourceMode: "inline_text",
							workflowAtomicSpec: { operation: "canvas_read", executorRef: "tapcanvas.canvas.group.read/v1" },
						},
					},
					{
						id: "planner",
						data: {
							kind: "workflowStage",
							label: "BeatSheet Agent",
							description: "规划片段并生成完整视频",
							outputArtifactType,
							workflowOutputArtifactType: "tapcanvas.master-video/v1",
							workflowInputPorts: ["delivery-contract"],
							workflowOutputPorts: ["master-video"],
							workflowAllowedTools: ["Skill", "tapcanvas_video_generate_to_canvas"],
							workflowToolId: "video_generate.submit",
							workflowAtomicSpec: {
								operation: "video_submission",
								toolId: "tapcanvas_video_generate_to_canvas",
								inputPorts: ["topic"],
								outputPorts: ["provider-receipts"],
							},
						},
					},
				],
			}),
		},
	};
}

describe("capability bay descriptor", () => {
	it("detects an obsolete canonical one-click canvas from structural versions", () => {
		const versionData = JSON.stringify({
			nodes: [
				{
					id: "trigger",
					data: {
						workflowKey: "one-click-production/v1",
						workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION - 1,
					},
				},
				{
					id: "stage",
					data: {
						workflowKey: "one-click-production/v1",
						workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
						workflowCanvasDefinitionFingerprint: VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
					},
				},
			],
		});

		expect(inspectVideoWorkflowCanvasDefinition(versionData)).toEqual({
			applicable: true,
			current: false,
			requiredVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
			requiredFingerprint: VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
			observedVersions: [
				VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION - 1,
				VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
			],
			observedFingerprints: [VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT],
			invalidNodeIds: ["trigger"],
		});
	});

	it("rejects a same-number canonical definition with a different executable fingerprint", () => {
		const state = inspectVideoWorkflowCanvasDefinition(JSON.stringify({
			nodes: [{
				id: "stage",
				data: {
					workflowKey: "one-click-production/v1",
					workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
					workflowCanvasDefinitionFingerprint: "sha256:stale-contract",
				},
			}],
		}));

		expect(state).toMatchObject({
			applicable: true,
			current: false,
			requiredFingerprint: VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
			observedFingerprints: ["sha256:stale-contract"],
			invalidNodeIds: ["stage"],
		});
	});

	it("does not apply the canonical version contract to unrelated workflows", () => {
		expect(inspectVideoWorkflowCanvasDefinition(JSON.stringify({
			nodes: [{ id: "custom", data: { workflowKey: "custom/v1" } }],
		}))).toMatchObject({ applicable: false, current: true });
	});

	it("derives one stable, version-pinned workflow capability", () => {
		const descriptor = buildWorkflowCapabilityDescriptor(workflowVersion("version-1"));

		expect(descriptor).toMatchObject({
			capabilityId: "workflow:flow-one-click",
			sourceVersionId: "version-1",
			triggerNodeId: "trigger",
			operations: ["canvas_read", "video_submission"],
			inputArtifacts: ["delivery-contract", "topic"],
			outputArtifacts: ["master-video", "provider-receipts", "tapcanvas.master-video/v1", "video"],
			requiredTools: ["Skill", "tapcanvas_video_generate_to_canvas", "video_generate.submit"],
			invocation: { sourceMode: "inline_text", requiredTriggerPayloadFields: ["source"] },
			sideEffects: ["external_mutation", "paid_generation"],
		});
		expect(capabilityDescriptorSha256(descriptor)).toHaveLength(64);
		expect(capabilityDescriptorSha256(descriptor)).toBe(capabilityDescriptorSha256({ ...descriptor }));
	});

	it("uses the version-pinned generated description as the routing summary", () => {
		const descriptor = buildWorkflowCapabilityDescriptor(workflowVersion(
			"version-description",
			"video",
			"接收小T按次传入的源文本，完成规划、生成和最终成片交付。",
		));

		expect(descriptor.summary).toBe("接收小T按次传入的源文本，完成规划、生成和最终成片交付。");
		expect(descriptor.invocation).toEqual({
			sourceMode: "inline_text",
			requiredTriggerPayloadFields: ["source"],
		});
	});

	it("declares project_context without a fabricated per-run source group field", () => {
		const input = workflowVersion("version-project-context");
		const data = JSON.parse(input.version.data) as { nodes: Array<{ data: Record<string, unknown> }> };
		data.nodes[1].data.workflowSourceMode = "project_context";
		input.version.data = JSON.stringify(data);

		const descriptor = buildWorkflowCapabilityDescriptor(input);

		expect(descriptor.invocation).toEqual({
			sourceMode: "project_context",
			requiredTriggerPayloadFields: [],
		});
	});

	it("derives videoModelKey from an unpinned Workflow IR delivery contract", () => {
		const input = workflowVersion("version-workflow-ir-video");
		const data = JSON.parse(input.version.data) as { nodes: Array<{ id: string; data: Record<string, unknown> }> };
		data.nodes[1].data.workflowSourceMode = "project_context";
		data.nodes.push({
			id: "delivery-contract",
			data: {
				kind: "workflowStage",
				workflowAtomicSpec: {
					operation: "delivery_contract",
					executorRef: "agents.delivery.contract/v2",
				},
			},
		});
		input.version.data = JSON.stringify(data);

		expect(buildWorkflowCapabilityDescriptor(input).invocation).toEqual({
			sourceMode: "project_context",
			requiredTriggerPayloadFields: ["videoModelKey"],
		});

		data.nodes.at(-1)!.data.workflowVideoModelKey = "catalog-video-model";
		input.version.data = JSON.stringify(data);
		expect(buildWorkflowCapabilityDescriptor(input).invocation).toEqual({
			sourceMode: "project_context",
			requiredTriggerPayloadFields: [],
		});
	});

	it("exposes the immutable video variant so full and first-video attachments are distinguishable", () => {
		const input = workflowVersion("version-first-video");
		const data = JSON.parse(input.version.data) as { nodes: Array<{ data: Record<string, unknown> }> };
		data.nodes[2].data.workflowExecutionVariant = "first_video";
		input.version.data = JSON.stringify(data);

		expect(buildWorkflowCapabilityDescriptor(input).invocation).toEqual({
			sourceMode: "inline_text",
			requiredTriggerPayloadFields: ["source"],
			executionVariant: "first_video",
		});
	});

	it("derives explicit per-run image generation fields from an unpinned image node", () => {
		const input = workflowVersion("version-workflow-ir-image");
		const data = JSON.parse(input.version.data) as { nodes: Array<{ id: string; data: Record<string, unknown> }> };
		data.nodes[1].data.workflowSourceMode = "project_context";
		data.nodes.push({
			id: "asset-image-generate",
			data: {
				kind: "workflowStage",
				workflowAtomicSpec: {
					operation: "image_generate",
					executorRef: "tapcanvas.image.generate/v1",
				},
			},
		});
		input.version.data = JSON.stringify(data);

		expect(buildWorkflowCapabilityDescriptor(input).invocation).toEqual({
			sourceMode: "project_context",
			requiredTriggerPayloadFields: ["imageModelKey", "imageAspectRatio", "imageSize"],
		});

		Object.assign(data.nodes.at(-1)!.data, {
			workflowImageModelKey: "gpt-image-2",
			workflowImageAspectRatio: "16:9",
			workflowImageSize: "2K",
		});
		input.version.data = JSON.stringify(data);
		expect(buildWorkflowCapabilityDescriptor(input).invocation).toEqual({
			sourceMode: "project_context",
			requiredTriggerPayloadFields: [],
		});
	});

	it("derives every missing video estimate field from the frozen Workflow IR", () => {
		const input = workflowVersion("version-workflow-ir-estimate");
		const data = JSON.parse(input.version.data) as { nodes: Array<{ id: string; data: Record<string, unknown> }> };
		data.nodes[1].data.workflowSourceMode = "project_context";
		data.nodes.push({
			id: "cost-estimate",
			data: {
				kind: "workflowStage",
				workflowAtomicSpec: {
					operation: "estimate",
					executorRef: "video.estimate/v1",
				},
			},
		});
		input.version.data = JSON.stringify(data);

		expect(buildWorkflowCapabilityDescriptor(input).invocation).toEqual({
			sourceMode: "project_context",
			requiredTriggerPayloadFields: ["videoModelKey", "videoResolution", "videoAspectRatio"],
		});

		Object.assign(data.nodes.at(-1)!.data, {
			workflowVideoModelKey: "doubao-seedance-2.0",
			workflowVideoResolution: "480p",
			workflowVideoAspectRatio: "16:9",
		});
		input.version.data = JSON.stringify(data);
		expect(buildWorkflowCapabilityDescriptor(input).invocation).toEqual({
			sourceMode: "project_context",
			requiredTriggerPayloadFields: [],
		});
	});

	it("treats a variant media node as pinned by its canonical configuration source", () => {
		const input = workflowVersion("version-workflow-ir-inherited-media");
		const data = JSON.parse(input.version.data) as { nodes: Array<{ id: string; data: Record<string, unknown> }> };
		data.nodes[1].data.workflowSourceMode = "project_context";
		data.nodes.push(
			{
				id: "workflow-1:asset-image-generate",
				data: {
					kind: "workflowStage",
					workflowInstanceId: "workflow-1",
					workflowNodeId: "asset-image-generate",
					workflowAtomicSpec: { executorRef: "tapcanvas.image.generate/v1" },
					workflowImageModelKey: "gpt-image-2",
					workflowImageAspectRatio: "16:9",
					workflowImageSize: "2K",
				},
			},
			{
				id: "workflow-1:launch-asset-image-generate",
				data: {
					kind: "workflowStage",
					workflowInstanceId: "workflow-1",
					workflowNodeId: "launch-asset-image-generate",
					workflowConfigurationSourceNodeId: "asset-image-generate",
					workflowAtomicSpec: { executorRef: "tapcanvas.image.generate/v1" },
				},
			},
		);
		input.version.data = JSON.stringify(data);

		expect(buildWorkflowCapabilityDescriptor(input).invocation).toEqual({
			sourceMode: "project_context",
			requiredTriggerPayloadFields: [],
		});
	});

	it("uses the trigger-pinned capability description before flow-root metadata", () => {
		const input = workflowVersion("version-trigger-description", "video", "legacy-root-description");
		const data = JSON.parse(input.version.data) as { nodes: Array<{ data: Record<string, unknown> }> };
		const trigger = data.nodes[0];
		trigger.data.workflowCapabilityDescription = "trigger-description";
		input.version.data = JSON.stringify(data);

		const descriptor = buildWorkflowCapabilityDescriptor(input);

		expect(descriptor.summary).toBe("trigger-description");
	});

	it("collects the complete frozen Skill dependency set from every workflow stage", () => {
		const input = workflowVersion("version-skills");
		const data = JSON.parse(input.version.data) as { nodes: Array<{ data: Record<string, unknown> }> };
		data.nodes[2].data.workflowRequiredSkills = ["tapcanvas-video-workflow", "tapcanvas-video-reviewer"];
		data.nodes[2].data.workflowSkillId = "tapcanvas-video-prompt-writer";
		input.version.data = JSON.stringify(data);

		const descriptor = buildWorkflowCapabilityDescriptor(input);

		expect(descriptor.requiredSkills).toEqual([
			"tapcanvas-video-prompt-writer",
			"tapcanvas-video-reviewer",
			"tapcanvas-video-workflow",
		]);
	});

	it("treats an overlap with an explicitly required Skill as delegation", () => {
		const target = {
			...buildWorkflowCapabilityDescriptor(workflowVersion("version-delegation")),
			requiredSkills: ["tapcanvas-video-workflow"],
		};
		const conflicts = [{
			id: "semantic-required-skill",
			severity: "warning" as const,
			category: "semantic_overlap" as const,
			withCapabilityId: "tapcanvas-video-workflow",
			resolutionMode: "choose_primary" as const,
			title: "主路径重叠",
			rationale: "两者都参与成片。",
			resolution: "选择主路径。",
		}, {
			id: "semantic-other",
			severity: "warning" as const,
			category: "semantic_overlap" as const,
			withCapabilityId: "tapcanvas-screenwriter",
			resolutionMode: "choose_primary" as const,
			title: "其它重叠",
			rationale: "另一个职责重叠。",
			resolution: "选择主路径。",
		}];

		expect(omitNonCompetingCapabilityConflicts(target, [], conflicts)).toEqual([conflicts[1]]);
	});

	it("keeps explicitly different workflow execution variants on separate invocation routes", () => {
		const base = buildWorkflowCapabilityDescriptor(workflowVersion("version-variant-routing"));
		const fullVideo = {
			...base,
			capabilityId: "workflow:full-video",
			sourceId: "full-video",
			invocation: {
				sourceMode: base.invocation!.sourceMode,
				requiredTriggerPayloadFields: base.invocation!.requiredTriggerPayloadFields,
				executionVariant: "full_video" as const,
			},
		};
		const firstVideo = {
			...base,
			capabilityId: "workflow:first-video",
			sourceId: "first-video",
			invocation: {
				sourceMode: base.invocation!.sourceMode,
				requiredTriggerPayloadFields: base.invocation!.requiredTriggerPayloadFields,
				executionVariant: "first_video" as const,
			},
		};
		const anotherFirstVideo = {
			...firstVideo,
			capabilityId: "workflow:another-first-video",
			sourceId: "another-first-video",
		};

		expect(workflowCapabilityDescriptorsShareInvocationRoute(fullVideo, firstVideo)).toBe(false);
		expect(workflowCapabilityDescriptorsShareInvocationRoute(firstVideo, anotherFirstVideo)).toBe(true);
		expect(detectStructuralCapabilityConflicts(firstVideo, [fullVideo])).toEqual([]);
		expect(detectStructuralCapabilityConflicts(firstVideo, [anotherFirstVideo])).toEqual([
			expect.objectContaining({
				withCapabilityId: "workflow:another-first-video",
				resolutionMode: "choose_primary",
			}),
		]);

		const semanticConflicts = [{
			id: "semantic-full-video",
			severity: "warning" as const,
			category: "semantic_overlap" as const,
			withCapabilityId: fullVideo.capabilityId,
			resolutionMode: "choose_primary" as const,
			title: "成片职责重叠",
			rationale: "共享底层成片工具。",
			resolution: "选择主路径。",
		}];
		expect(omitNonCompetingCapabilityConflicts(
			firstVideo,
			[fullVideo],
			semanticConflicts,
		)).toEqual([]);
	});

	it("reports version changes separately from functional overlap", () => {
		const target = buildWorkflowCapabilityDescriptor(workflowVersion("version-2"));
		const previous = buildWorkflowCapabilityDescriptor(workflowVersion("version-1"));
		const other = {
			...previous,
			capabilityId: "workflow:other",
			sourceId: "other",
			name: "另一个成片工作流",
		};

		const conflicts = detectStructuralCapabilityConflicts(target, [previous, other]);

		expect(conflicts.map((conflict) => conflict.category)).toEqual(["version_change", "functional_overlap"]);
		expect(conflicts[0]?.severity).toBe("info");
		expect(conflicts[0]?.resolutionMode).toBe("acknowledge");
		expect(conflicts[1]?.severity).toBe("warning");
		expect(conflicts[1]?.resolutionMode).toBe("choose_primary");
	});

	it("detects a built-in primary-route overlap from frozen tool-family ids", () => {
		const target = buildWorkflowCapabilityDescriptor(workflowVersion("version-built-in"));

		const conflicts = detectBuiltInCapabilityConflicts(target, [{
			id: "builtin:one_click_video",
			name: "一键成片",
			requiredTools: ["tapcanvas_video_generate_to_canvas"],
		}]);

		expect(conflicts).toEqual([expect.objectContaining({
			withCapabilityId: "builtin:one_click_video",
			resolutionMode: "choose_primary",
			category: "functional_overlap",
		})]);
	});

	it("keeps foundational media primitives available to workflows", () => {
		const target = buildWorkflowCapabilityDescriptor(workflowVersion("version-media-primitive"));

		const conflicts = detectBuiltInCapabilityConflicts(target, [{
			id: "builtin:paid_media_generation",
			name: "真实媒体生成",
			requiredTools: ["tapcanvas_video_generate_to_canvas"],
			replaceable: false,
		}]);

		expect(conflicts).toEqual([]);
	});
});
