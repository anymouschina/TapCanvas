import { describe, expect, it } from "vitest";

import {
	projectToolParametersBySelector,
	readToolSchemaOperationIndex,
} from "./agents-tool-schema-projection";

import { PUBLIC_FLOW_AUTHORITY_BASE_FRAME_STATUSES } from "../flow/flow.public.schemas";
import { PublicAgentsImageGenerateToCanvasArgsSchema } from "./agents-tool-bridge.generate-image-to-canvas";
import {
	inspectAgentsBridgeRemoteToolSurface,
} from "./task.agents-bridge";

type JsonSchemaNode = {
	properties?: Record<string, JsonSchemaNode>;
	items?: JsonSchemaNode;
	oneOf?: readonly JsonSchemaNode[];
	enum?: readonly unknown[];
	const?: unknown;
	required?: readonly string[];
	minItems?: number;
	not?: JsonSchemaNode;
	allOf?: readonly JsonSchemaNode[];
	if?: JsonSchemaNode;
	then?: JsonSchemaNode;
};

function buildGenericImageRequest(): Record<string, unknown> {
	return {
		node: {
			type: "taskNode",
			position: { x: 0, y: 0 },
			data: {
				kind: "image",
				prompt: "a small cat",
			},
		},
	};
}

function buildChapterImageRequest(input: {
	chapterGrounded?: unknown;
	status: unknown;
}): Record<string, unknown> {
	return {
		node: {
			type: "taskNode",
			position: { x: 0, y: 0 },
			data: {
				kind: "image",
				prompt: "chapter authority base frame",
				productionMetadata: {
					chapterGrounded: input.chapterGrounded ?? true,
					lockedAnchors: {
						character: [],
						scene: [],
						shot: [],
						continuity: [],
						missing: [],
					},
					authorityBaseFrame: {
						status: input.status,
						source: "chapter_context",
						reason: "No confirmed authority base frame exists yet.",
						nodeId: null,
					},
				},
			},
		},
	};
}

describe("tapcanvas_image_generate_to_canvas schema contract", () => {
	it("projects ordinary single-image generation to a bounded operation schema", () => {
		const surface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
		});
		const tool = [...surface.tools, ...surface.catalog].find(
			(candidate) => candidate.name === "tapcanvas_image_generate_to_canvas",
		);
		expect(tool).toBeDefined();
		const parameters = tool?.parameters as Record<string, unknown>;
		expect(readToolSchemaOperationIndex(parameters)).toEqual({
			field: "operation",
			values: ["generate", "generate_advanced"],
		});
		const projected = projectToolParametersBySelector({
			parameters,
			selector: { field: "operation", value: "generate" },
		});
		const serialized = JSON.stringify(projected);
		expect(serialized.length).toBeLessThan(8_000);
		expect(serialized).toContain('"imageModel"');
		expect(serialized).toContain('"imageSize"');
		expect(serialized).not.toContain('"identityBoardSpec"');
		expect(serialized).not.toContain('"productionMetadata"');
	});

	it("keeps the exact model and media specification contract in advanced image generation", () => {
		const surface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
		});
		const tool = [...surface.tools, ...surface.catalog].find(
			(candidate) => candidate.name === "tapcanvas_image_generate_to_canvas",
		);
		expect(tool).toBeDefined();
		const projected = projectToolParametersBySelector({
			parameters: tool?.parameters as Record<string, unknown>,
			selector: { field: "operation", value: "generate_advanced" },
		}) as JsonSchemaNode;
		const nodeData = projected.properties?.node?.properties?.data;
		const batchNodeData = projected.properties?.nodes?.items?.properties?.data;
		for (const data of [nodeData, batchNodeData]) {
			expect(data?.properties?.imageModel).toBeDefined();
			expect(data?.properties?.aspect).toBeDefined();
			expect(data?.properties?.imageSize).toBeDefined();
			expect(data?.properties?.referenceType).toBeDefined();
		}
	});

	it("omits chapter-only metadata from an ordinary project flow schema", () => {
		const genericSurface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
		});
		const genericTools = [...genericSurface.tools, ...genericSurface.catalog];
		const genericTool = genericTools.find(
			(candidate) => candidate.name === "tapcanvas_image_generate_to_canvas",
		);
		expect(genericTool).toBeDefined();
		expect(genericTool?.description).toContain("tapcanvas_story_preview_orchestrate");
		expect(genericTool?.description).toContain("本通用生图工具不接受 previewBoard");

		const parameters = genericTool?.parameters as JsonSchemaNode | undefined;
		const nodeData = parameters?.properties?.node?.properties?.data;
		const batchNodeData = parameters?.properties?.nodes?.items?.properties?.data;

		expect(nodeData?.properties?.kind?.enum).toEqual([
			"image",
			"imageEdit",
			"storyboardImage",
		]);
		expect(nodeData?.properties?.clipRunId).toBeDefined();
		expect(nodeData?.properties?.clipIndex).toBeDefined();
		expect(nodeData?.properties?.storyboardScope?.enum).toEqual(["clip"]);
		expect(nodeData?.properties?.storyboardFrameCount).toBeDefined();
		expect(nodeData?.properties?.storyPreviewContract).toBeUndefined();
		expect(nodeData?.properties?.referenceManifest).toBeUndefined();
		expect(nodeData?.properties?.storyPreviewCells).toBeUndefined();
		expect(nodeData?.properties?.creationStage).toBeDefined();
		expect(nodeData?.properties?.referenceType?.enum).toEqual([
			"character",
			"scene",
			"prop",
			"ensemble",
			"pose",
			"blocking",
		]);
		expect(nodeData?.properties?.roleName).toBeDefined();
		expect(nodeData?.properties?.sceneName).toBeDefined();
		expect(nodeData?.properties?.propName).toBeDefined();
		expect(nodeData?.properties?.stateKey).toBeDefined();
		expect(nodeData?.properties?.stateVersionId).toBeDefined();
		expect(nodeData?.properties?.visualStateFacts?.items?.required).toEqual(["key", "value"]);
		expect(nodeData?.properties?.characterAssetRole?.enum).toEqual([
			"identity_anchor",
			"state_variant",
		]);
		expect(nodeData?.properties?.characterProfileVersion?.enum).toEqual([
			"character-card/v3",
		]);
		expect(nodeData?.properties?.identityAnchors?.items).toBeDefined();
		expect(nodeData?.properties?.prohibitedDrift?.items).toBeDefined();
		expect(nodeData?.properties?.identityBoardSpec).toBeDefined();
		expect(nodeData?.properties?.sceneAssetRole?.enum).toEqual([
			"space_anchor",
			"lighting_variant",
			"state_variant",
		]);
		expect(nodeData?.properties?.sceneProfileVersion?.enum).toEqual(["scene-card/v1"]);
		expect(nodeData?.properties?.sceneAnchors?.items).toBeDefined();
		expect(nodeData?.properties?.prohibitedSceneDrift?.items).toBeDefined();
		expect(nodeData?.properties?.sceneLightingSpec?.properties?.version?.enum).toEqual([
			"scene-lighting/v1",
		]);
		expect(nodeData?.properties?.propAssetRole?.enum).toEqual([
			"identity_anchor",
			"state_variant",
		]);
		expect(nodeData?.properties?.propProfileVersion?.enum).toEqual(["prop-card/v1"]);
		expect(nodeData?.properties?.propAnchors?.items).toBeDefined();
		expect(nodeData?.properties?.prohibitedPropDrift?.items).toBeDefined();
		expect(nodeData?.properties?.propBoardSpec?.properties?.version?.enum).toEqual([
			"prop-board/v1",
		]);
		expect(nodeData?.properties?.propBoardSpec?.properties?.viewRoles?.minItems).toBe(1);
		expect(nodeData?.properties?.propBoardSpec?.properties?.viewRoles?.maxItems).toBeUndefined();
		expect(nodeData?.properties?.propFunctionSpec?.properties?.version?.enum).toEqual([
			"prop-function/v1",
		]);
		expect(nodeData?.properties?.productionMetadata).toBeUndefined();
		expect(batchNodeData?.properties?.productionMetadata).toBeUndefined();
		expect(nodeData?.not?.required).toEqual(["productionMetadata"]);
		expect(batchNodeData?.not?.required).toEqual(["productionMetadata"]);
		expect(batchNodeData?.properties?.waitForResult?.enum).toEqual([false]);
		expect(nodeData?.properties?.waitForResult?.enum).toEqual([false]);
		expect(parameters?.properties?.previewBoard).toBeUndefined();

		const flowPatch = genericTools.find(
			(candidate) => candidate.name === "tapcanvas_flow_patch",
		);
		const flowPatchParameters = flowPatch?.parameters as JsonSchemaNode | undefined;
		const flowPatchTaskNodeData =
			flowPatchParameters?.properties?.createNodes?.items?.oneOf?.[0]?.properties
				?.data;
		expect(flowPatchTaskNodeData?.properties?.productionMetadata).toBeUndefined();
		expect(flowPatchTaskNodeData?.properties?.referenceType).toBeDefined();
		expect(flowPatchTaskNodeData?.properties?.roleName).toBeDefined();
		expect(flowPatchTaskNodeData?.properties?.sceneName).toBeDefined();
		expect(flowPatchTaskNodeData?.properties?.propName).toBeDefined();
	});

	it("requires the complete strict metadata contract in a real chapter scope", () => {
		const chapterSurface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			chapterId: "book-1-ch1",
		});
		const chapterTools = [...chapterSurface.tools, ...chapterSurface.catalog];
		const orchestrator = chapterTools.find(
			(candidate) => candidate.name === "tapcanvas_story_preview_orchestrate",
		);
		expect(orchestrator).toBeDefined();
		expect(orchestrator?.requiredScope).toEqual([
			"project",
			"canvas",
			"chapter_canvas",
		]);
		const orchestratorParameters = orchestrator?.parameters as JsonSchemaNode | undefined;
		expect(orchestratorParameters?.oneOf).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					properties: expect.objectContaining({
						mode: expect.objectContaining({ const: "begin" }),
					}),
				}),
				expect.objectContaining({
					properties: expect.objectContaining({
						mode: expect.objectContaining({ const: "put_board_0" }),
					}),
				}),
			]),
		);
		const chapterTool = chapterTools.find(
			(candidate) => candidate.name === "tapcanvas_image_generate_to_canvas",
		);
		expect(chapterTool).toBeDefined();

		const parameters = chapterTool?.parameters as JsonSchemaNode | undefined;
		const nodeData = parameters?.properties?.node?.properties?.data;
		const batchNodeData = parameters?.properties?.nodes?.items?.properties?.data;
		const expectedStatuses = [...PUBLIC_FLOW_AUTHORITY_BASE_FRAME_STATUSES];
		const orchestratorCells = orchestratorParameters?.properties?.cells;

		expect(nodeData?.required).toEqual(expect.arrayContaining(["kind", "prompt"]));
		expect(batchNodeData?.required).toEqual(expect.arrayContaining(["kind", "prompt"]));
	expect(nodeData?.properties?.productionMetadata).toBeDefined();
	expect(batchNodeData?.properties?.productionMetadata).toBeDefined();
		expect(batchNodeData?.properties?.waitForResult?.enum).toEqual([false]);
		expect(nodeData?.properties?.waitForResult?.enum).toEqual([false]);
		expect(parameters?.properties?.previewBoard).toBeUndefined();
		expect(parameters?.properties?.mode).toBeUndefined();
		const chapterUpdate = chapterTools.find(
			(candidate) => candidate.name === "tapcanvas_project_chapter_update",
		);
		const previewContract = (chapterUpdate?.parameters as JsonSchemaNode | undefined)
			?.properties?.storyPreviewContract;
		expect(previewContract?.required).toContain("previewScope");
		expect(previewContract?.required).not.toContain("previewWindow");
		expect(previewContract?.properties?.previewScope?.enum).toEqual([
			"full_story",
			"user_window",
		]);
		expect(previewContract?.allOf?.[0]?.then?.required).toEqual(["previewWindow"]);
		expect(orchestratorCells?.items?.required).toEqual([
			"frame",
			"mid",
			"end",
			"camera",
			"feedback",
			"environment",
			"subjectRefIds",
		]);
		expect(
			nodeData?.properties?.productionMetadata?.properties?.chapterGrounded?.const,
		).toBe(true);
		expect(
			batchNodeData?.properties?.productionMetadata?.properties?.chapterGrounded?.const,
		).toBe(true);
		expect(
			nodeData?.properties?.productionMetadata?.properties?.authorityBaseFrame
				?.properties?.status?.enum,
		).toEqual(expectedStatuses);
		expect(
			batchNodeData?.properties?.productionMetadata?.properties?.authorityBaseFrame
				?.properties?.status?.enum,
		).toEqual(expectedStatuses);
		expect(
			nodeData?.properties?.productionMetadata?.properties?.blockingFrameNodeId,
		).toBeDefined();
		expect(
			nodeData?.properties?.productionMetadata?.properties?.spatialBlocking,
		).toBeDefined();
		const compositionContract =
			nodeData?.properties?.productionMetadata?.properties?.compositionContract;
		expect(compositionContract?.required).toEqual(
			expect.arrayContaining([
				"narrativeTask",
				"focusKind",
				"focusTargetNames",
				"focalPoint",
				"shotScale",
				"environmentVisualWeight",
				"subjects",
			]),
		);
		expect(compositionContract?.properties?.subjects?.minItems).toBe(1);
		expect(
			nodeData?.properties?.productionMetadata?.properties?.compositionContractHash,
		).toBeDefined();

		const blockingTool = chapterTools.find(
			(candidate) => candidate.name === "tapcanvas_render_blocking_diagram",
		);
		const blockingParameters = blockingTool?.parameters as JsonSchemaNode | undefined;
		expect(blockingParameters?.required).toEqual(
			expect.arrayContaining(["characters", "compositionContract"]),
		);
		expect(blockingParameters?.properties?.compositionContract?.properties?.subjects?.minItems).toBe(1);

		const flowPatch = chapterTools.find(
			(candidate) => candidate.name === "tapcanvas_flow_patch",
		);
		const flowPatchParameters = flowPatch?.parameters as JsonSchemaNode | undefined;
		const flowPatchTaskNodeData =
			flowPatchParameters?.properties?.createNodes?.items?.oneOf?.[0]?.properties
				?.data;
		expect(
			flowPatchTaskNodeData?.properties?.productionMetadata?.properties
				?.chapterGrounded?.const,
		).toBe(true);
		expect(flowPatchTaskNodeData?.properties?.bookBibleType?.enum).toEqual([
			"world",
			"roster",
			"redlines",
			"ip_safe",
		]);
	});

	it("rejects story-preview payloads on the public generic image schema", () => {
		expect(PublicAgentsImageGenerateToCanvasArgsSchema.safeParse({
			previewBoard: { boardIndex: 0 },
		}).success).toBe(false);

		const partial = PublicAgentsImageGenerateToCanvasArgsSchema.safeParse({
			previewBoard: {
				boardIndex: 0,
				openingState: "阿乔持枪戒备",
			},
		});
		expect(partial.success).toBe(false);
	});

	it("rejects synchronous waiting for a batch before any image task is submitted", () => {
		const batchRequest = {
			nodes: [
				{
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: {
						kind: "storyboardImage",
						prompt: "chapter keyframe",
						waitForResult: true,
					},
				},
			],
		};

		const rejected = PublicAgentsImageGenerateToCanvasArgsSchema.safeParse(batchRequest);
		expect(rejected.success).toBe(false);
		if (!rejected.success) {
			expect(rejected.error.issues[0]?.path).toEqual([
				"nodes",
				0,
				"data",
				"waitForResult",
			]);
		}

		const accepted = PublicAgentsImageGenerateToCanvasArgsSchema.safeParse({
			...batchRequest,
			nodes: batchRequest.nodes.map((node) => ({
				...node,
				data: { ...node.data, waitForResult: false },
			})),
		});
		expect(accepted.success).toBe(true);
	});

	it("rejects synchronous waiting for a single image before any paid submission", () => {
		const rejected = PublicAgentsImageGenerateToCanvasArgsSchema.safeParse({
			node: {
				type: "taskNode",
				position: { x: 0, y: 0 },
				data: {
					kind: "image",
					prompt: "style master",
					waitForResult: true,
				},
			},
		});

		expect(rejected.success).toBe(false);
		if (!rejected.success) {
			expect(rejected.error.issues[0]?.path).toEqual([
				"node",
				"data",
				"waitForResult",
			]);
		}
	});

	it("accepts an ordinary image request with no chapter metadata", () => {
		expect(
			PublicAgentsImageGenerateToCanvasArgsSchema.safeParse(
				buildGenericImageRequest(),
			).success,
		).toBe(true);
	});

	it("保留显式 clip 关键帧交接字段，不把它裁成孤立图片", () => {
		const parsed = PublicAgentsImageGenerateToCanvasArgsSchema.safeParse({
			node: {
				type: "taskNode",
				position: { x: 0, y: 0 },
				data: {
					kind: "storyboardImage",
					prompt: "clip keyframe",
					clipRunId: "video-run-1",
					clipIndex: 4,
					storyboardScope: "clip",
					storyboardFrameCount: 3,
					productionLayer: "design_board",
					creationStage: "beat_keyframe",
				},
			},
		});

		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.node?.data).toMatchObject({
				clipRunId: "video-run-1",
				clipIndex: 4,
				storyboardScope: "clip",
				storyboardFrameCount: 3,
				creationStage: "beat_keyframe",
			});
		}
	});

	it("accepts canonical chapter statuses and rejects non-contract variants", () => {
		for (const status of PUBLIC_FLOW_AUTHORITY_BASE_FRAME_STATUSES) {
			expect(
				PublicAgentsImageGenerateToCanvasArgsSchema.safeParse(
					buildChapterImageRequest({ status }),
				).success,
			).toBe(true);
		}

		expect(
			PublicAgentsImageGenerateToCanvasArgsSchema.safeParse(
				buildChapterImageRequest({ status: "not_required" }),
			).success,
		).toBe(false);
		expect(
			PublicAgentsImageGenerateToCanvasArgsSchema.safeParse(
				buildChapterImageRequest({
					chapterGrounded: false,
					status: "planned",
				}),
			).success,
		).toBe(false);
	});
});
