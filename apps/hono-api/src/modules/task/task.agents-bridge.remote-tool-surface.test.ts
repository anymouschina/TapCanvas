import { describe, expect, it } from "vitest";

import {
	BOOK_SCOPED_PERSISTENCE_REMOTE_TOOL_NAMES,
	listBuiltInSmallTCapabilities,
	measureRemoteToolCatalogIndex,
	measureRemoteToolSurface,
	readRemoteToolSurfaceMetadata,
} from "./agents-bridge-remote-tool-surface";
import { buildHostFlowPatchTool, type HostCapabilityManifest } from "./host-canvas-protocol";
import {
	inspectAgentsBridgeRemoteToolSurface,
	compactRemoteToolCatalog,
	resolveUniqueProjectCanvasFlowId,
	shouldDeferPublicChatDirectTools,
} from "./task.agents-bridge";

const hostManifest: HostCapabilityManifest = {
	protocol_version: "1",
	host: "surface-test-host",
	patchOps: ["addNode", "connectEdge", "runNode"],
	nodeSpecs: [
		{
			type: "imageGenerator",
			label: "Image Generator",
			params: {
				prompt: { type: "string" },
			},
		},
	],
};

function asSchemaRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

describe("deterministic agents bridge remote tool surface", () => {
	it("defers the large direct payload for an empty public chat while retaining catalog discovery", () => {
		expect(shouldDeferPublicChatDirectTools({
			publicAgentsRequest: true,
			requestKind: "chat",
			hostManifestPresent: false,
			canvasNodeId: "",
			assetInputCount: 0,
			referenceImageCount: 0,
			forceAssetGeneration: false,
			hasGenerationContract: false,
			hasChapterContext: false,
			hasForcedAgentRole: false,
			requiredSkillCount: 0,
		})).toBe(true);
		expect(shouldDeferPublicChatDirectTools({
			publicAgentsRequest: true,
			requestKind: "chat",
			hostManifestPresent: false,
			canvasNodeId: "node-1",
			assetInputCount: 0,
			referenceImageCount: 0,
			forceAssetGeneration: false,
			hasGenerationContract: false,
			hasChapterContext: false,
			hasForcedAgentRole: false,
			requiredSkillCount: 0,
		})).toBe(false);
		expect(shouldDeferPublicChatDirectTools({
			publicAgentsRequest: true,
			requestKind: "chat",
			hostManifestPresent: false,
			canvasNodeId: "",
			assetInputCount: 0,
			referenceImageCount: 0,
			forceAssetGeneration: false,
			hasGenerationContract: false,
			hasChapterContext: true,
			hasForcedAgentRole: false,
			requiredSkillCount: 0,
		})).toBe(false);
	});

	it("assigns deterministic metadata to catalog discovery wrappers", () => {
		expect(readRemoteToolSurfaceMetadata("tapcanvas_tool_catalog_get")).toEqual({
			requiredScope: [],
			capability: "project_discovery",
			capabilityGated: false,
		});
		expect(readRemoteToolSurfaceMetadata("tapcanvas_tool_schema_get")).toEqual({
			requiredScope: [],
			capability: "project_discovery",
			capabilityGated: false,
		});
		const projectDiscovery = listBuiltInSmallTCapabilities().find(
			(item) => item.key === "project_discovery",
		);
		expect(projectDiscovery?.requiredTools).not.toContain("tapcanvas_tool_catalog_get");
		expect(projectDiscovery?.requiredTools).not.toContain("tapcanvas_tool_schema_get");
	});

	it("keeps the equipped-workflow gateway outside replaceable built-in capability gates", () => {
		expect(readRemoteToolSurfaceMetadata("tapcanvas_equipped_workflow_run")).toEqual({
			requiredScope: [],
			capability: "workflow_execution",
			capabilityGated: false,
		});
		expect(readRemoteToolSurfaceMetadata("tapcanvas_workflow_run")).toEqual({
			requiredScope: ["project", "canvas"],
			capability: "workflow_execution",
			capabilityGated: true,
		});
		expect(readRemoteToolSurfaceMetadata("tapcanvas_workflow_execution_inspect")).toEqual({
			requiredScope: ["project", "canvas"],
			capability: "execution_diagnostics",
			capabilityGated: true,
		});
		expect(readRemoteToolSurfaceMetadata("tapcanvas_workflow_resume")).toEqual({
			requiredScope: ["project", "canvas"],
			capability: "workflow_execution",
			capabilityGated: false,
		});
	});

	it("exposes cross-chapter creative-brief persistence as an explicit project mutation", () => {
		expect(readRemoteToolSurfaceMetadata("tapcanvas_project_creative_brief_update")).toEqual({
			requiredScope: ["project"],
			capability: "project_persistence",
			capabilityGated: true,
		});
		const capability = listBuiltInSmallTCapabilities().find(
			(item) => item.key === "project_persistence",
		);
		expect(capability).toMatchObject({
			name: "项目设定持久化",
			sideEffects: ["external_mutation"],
			requiredTools: [
				"tapcanvas_project_chapter_update",
				"tapcanvas_project_creative_brief_update",
				"tapcanvas_prompt_library_sync",
			],
		});
		expect(readRemoteToolSurfaceMetadata("tapcanvas_prompt_library_sync")).toEqual({
			requiredScope: ["project", "canvas"],
			capability: "project_persistence",
			capabilityGated: true,
		});
	});

	it("derives the conflict catalog from the same built-in tool contracts used at runtime", () => {
		const capabilities = listBuiltInSmallTCapabilities();
		const paidMedia = capabilities.find((item) => item.key === "paid_media_generation");
		const oneClickVideo = capabilities.find((item) => item.key === "one_click_video");
		const workflowExecution = capabilities.find((item) => item.key === "workflow_execution");

		expect(capabilities).toHaveLength(16);
		expect(paidMedia).toMatchObject({
			id: "builtin:paid_media_generation",
			name: "真实媒体生成",
			sideEffects: ["paid_generation"],
			replaceable: false,
		});
		expect(paidMedia?.requiredTools).not.toContain("tapcanvas_video_orchestrate");
		expect(oneClickVideo).toMatchObject({
			id: "builtin:one_click_video",
			name: "一键成片",
			sideEffects: ["paid_generation"],
			requiredTools: [],
			replaceable: true,
		});
		expect(workflowExecution?.requiredTools).toEqual(["tapcanvas_workflow_run"]);
	});

	it("keeps host mode at the single manifest-driven execution tool", () => {
		const tools = [buildHostFlowPatchTool(hostManifest)];

		expect(tools.map((tool) => tool.name)).toEqual(["flow_patch"]);
		expect(measureRemoteToolSurface(tools)).toEqual({
			visibleToolCount: 1,
			descriptionChars: 115,
			schemaChars: 552,
		});
	});

	it("removes every remote tool when the request lacks public-agents permission", () => {
		const surface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: false,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			bookId: "book-1",
			chapterId: "chapter-1",
		});

		expect(surface.tools).toEqual([]);
		expect(surface.before).toEqual({
			visibleToolCount: 0,
			descriptionChars: 0,
			schemaChars: 0,
		});
		expect(surface.after).toEqual(surface.before);
	});

	it("keeps scope-bound product tools hidden when an authorized project scope is absent", () => {
		const surface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: null,
			canvasFlowId: "flow-without-project",
			bookId: null,
			chapterId: null,
		});

		expect(surface.tools).toEqual([]);
		expect(surface.hiddenToolNames).toContain("tapcanvas_flow_patch");
		expect(surface.explicitCapabilityTools.map((tool) => tool.name)).toEqual([
			"tapcanvas_shot_table_critic",
		]);
		expect(surface.before.visibleToolCount).toBe(38);
		expect(surface.after.visibleToolCount).toBe(0);
		expect(surface.catalogIndexMeasurement).toEqual({
			visibleToolCount: 0,
			nameChars: 0,
			enumJsonChars: 0,
			duplicatedWrapperEnumChars: 0,
			capabilityCounts: {},
		});
	});

	it("keeps an equipped workflow executable without an open project or canvas", () => {
		const surface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: null,
			canvasFlowId: null,
			bookId: null,
			chapterId: null,
			disabledBuiltInCapabilities: ["workflow_execution"],
			equippedWorkflows: [
				{
					attachmentId: "attachment-one-click-video",
					name: "一键成片工作流",
					summary: "从冻结合同生成完整成片",
				},
			],
		});
		const directNames = surface.tools.map((tool) => tool.name);

		expect(directNames).toContain("tapcanvas_equipped_workflow_run");
		expect(directNames).not.toContain("tapcanvas_workflow_run");
		expect(surface.hiddenToolNames).not.toContain("tapcanvas_equipped_workflow_run");
	});

	it("keeps the canvas structural tools direct and excludes unsatisfied scope domains", () => {
		const surface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			bookId: null,
			chapterId: null,
		});
		const names = surface.tools.map((tool) => tool.name);

		expect(names).toEqual([
			"tapcanvas_project_context_get",
			"tapcanvas_project_chapters_list",
			"tapcanvas_project_chapter_get",
			"tapcanvas_books_list",
			"tapcanvas_material_assets_list",
			"tapcanvas_material_asset_versions_get",
			"tapcanvas_storyboard_anchor_candidates",
			"tapcanvas_pipeline_runs_list",
			"tapcanvas_pipeline_run_get",
			"tapcanvas_executions_list",
			"tapcanvas_execution_get",
			"tapcanvas_execution_node_runs_get",
			"tapcanvas_execution_events_list",
			"tapcanvas_workflow_execution_inspect",
			"tapcanvas_image_refs_get",
			"tapcanvas_flow_get",
			"tapcanvas_flow_search",
			"tapcanvas_flow_patch",
		]);
		expect(surface.hiddenToolNames).toEqual(expect.arrayContaining([
			"tapcanvas_shot_table_critic",
			"tapcanvas_story_facts_get",
			"tapcanvas_story_facts_commit",
			"tapcanvas_book_chapter_get",
			"tapcanvas_node_context_bundle_get",
			"tapcanvas_node_text_edit",
		]));
		const catalogNames = surface.catalog.map((tool) => tool.name);
		for (const deferredReadName of [
			"tapcanvas_book_index_get",
			"tapcanvas_book_chapter_get",
			"tapcanvas_story_facts_get",
		]) {
			expect(catalogNames).not.toContain(deferredReadName);
		}
		for (const hiddenName of BOOK_SCOPED_PERSISTENCE_REMOTE_TOOL_NAMES) {
			expect(names).not.toContain(hiddenName);
			expect(catalogNames).not.toContain(hiddenName);
			expect(surface.hiddenToolNames).toContain(hiddenName);
		}
		expect(catalogNames).toEqual(
			expect.arrayContaining([
				"tapcanvas_material_asset_version_create",
				"tapcanvas_set_style_reference",
			]),
		);
		expect(catalogNames).not.toContain("tapcanvas_video_orchestrate");
		expect(catalogNames).not.toContain("tapcanvas_storyboard_source_bundle_get");
		expect(catalogNames).not.toContain("tapcanvas_execution_get");
		expect(names).toContain("tapcanvas_execution_get");
		expect(names).not.toContain("tapcanvas_shot_table_critic");
	});

	it("keeps image generation discoverable in the deferred canvas catalog", () => {
		const surface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			bookId: null,
			chapterId: null,
		});
		const imageTool = compactRemoteToolCatalog(surface.catalog).find(
			(tool) => tool.name === "tapcanvas_image_generate_to_canvas",
		);

		expect(imageTool).toBeDefined();
		expect(imageTool?.description).toContain("Generate an image");
		expect(imageTool?.description).toContain("capability=paid_media_generation");
		expect(imageTool?.schemaDeferred).toBe(true);
	});

	it("resolves a missing project canvas only when exactly one flow is visible", () => {
		expect(resolveUniqueProjectCanvasFlowId([])).toBeNull();
		expect(resolveUniqueProjectCanvasFlowId(["flow-1", "flow-1"])).toBe("flow-1");
		expect(resolveUniqueProjectCanvasFlowId(["flow-1", "flow-2"])).toBeNull();
		expect(resolveUniqueProjectCanvasFlowId(["", "  "])).toBeNull();
	});

	it("stops built-in one-click video without removing lower-level media generation", () => {
		const surface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			bookId: null,
			chapterId: null,
			disabledBuiltInCapabilities: ["one_click_video"],
		});
		const visibleNames = [
			...surface.tools.map((tool) => tool.name),
			...surface.catalog.map((tool) => tool.name),
		];

		expect(visibleNames).not.toContain("tapcanvas_video_orchestrate");
		expect(visibleNames).toContain("tapcanvas_image_generate_to_canvas");
		expect(visibleNames).toContain("tapcanvas_video_generate_to_canvas");
		expect(surface.hiddenToolNames).not.toContain("tapcanvas_video_orchestrate");
	});

	it("keeps an equipped replacement executable when built-in workflow execution is disabled", () => {
		const surface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			bookId: null,
			chapterId: null,
			adminWorkflowAccess: true,
			disabledBuiltInCapabilities: ["workflow_execution"],
			equippedWorkflows: [
				{
					attachmentId: "attachment-one-click-video",
					name: "一键成片工作流",
					summary: "从冻结合同生成完整成片",
				},
			],
		});
		const visibleNames = [
			...surface.tools.map((tool) => tool.name),
			...surface.catalog.map((tool) => tool.name),
		];

		expect(visibleNames).toContain("tapcanvas_equipped_workflow_run");
		expect(visibleNames).not.toContain("tapcanvas_workflow_run");
		expect(surface.hiddenToolNames).toContain("tapcanvas_workflow_run");
		expect(surface.hiddenToolNames).not.toContain("tapcanvas_equipped_workflow_run");
	});

	it("keeps a project-only catalog executable by its authenticated callback envelope", () => {
		const surface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: null,
			bookId: null,
			chapterId: null,
		});
		const catalogNames = surface.catalog.map((tool) => tool.name);

		expect(
			surface.catalog.every(
				(tool) =>
					!tool.requiredScope.includes("canvas") &&
					!tool.requiredScope.includes("chapter_canvas"),
			),
		).toBe(true);
		const catalogCapabilities = surface.catalog.map((tool) => tool.capability);
		for (const unavailableCapability of [
			"canvas_core",
			"canvas_extended",
			"node_diagnostics",
			"media_analysis",
			"director_console",
		]) {
			expect(catalogCapabilities).not.toContain(unavailableCapability);
		}
		expect(surface.tools.map((tool) => tool.name)).toEqual([
			"tapcanvas_project_flows_list",
			"tapcanvas_project_context_get",
			"tapcanvas_project_chapters_list",
			"tapcanvas_project_chapter_get",
			"tapcanvas_books_list",
			"tapcanvas_material_assets_list",
			"tapcanvas_material_asset_versions_get",
			"tapcanvas_pipeline_runs_list",
			"tapcanvas_pipeline_run_get",
		]);
		expect(catalogNames).toEqual([
			"tapcanvas_project_creative_brief_update",
			"tapcanvas_material_asset_delete",
			"tapcanvas_get_style_reference",
			"tapcanvas_project_look_bible_get",
			"tapcanvas_storyboard_anchor_candidates",
			"tapcanvas_hyperframes_render",
		]);
		expect(
			surface.catalog.find((tool) => tool.name === "tapcanvas_hyperframes_render"),
		).toMatchObject({
			requiredScope: ["project"],
			capability: "paid_media_generation",
			execution: {
				sideEffect: "paid_generation",
				retrySafety: "unsafe",
				executionMode: "exclusive",
			},
		});
		for (const unavailableName of [
			"tapcanvas_executions_list",
			"tapcanvas_execution_get",
			"tapcanvas_execution_node_runs_get",
			"tapcanvas_execution_events_list",
			"tapcanvas_workflow_execution_inspect",
			"tapcanvas_material_asset_version_create",
			"tapcanvas_set_style_reference",
			"tapcanvas_flow_patch",
			"tapcanvas_image_generate_to_canvas",
			"tapcanvas_storyboard_source_bundle_get",
			"tapcanvas_node_context_bundle_get",
		]) {
			expect(catalogNames).not.toContain(unavailableName);
			expect(surface.hiddenToolNames).toContain(unavailableName);
		}
	});

	it("keeps project narrative context and chapter discovery available from a chapter-only canvas", () => {
		const surface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: null,
			bookId: "book-1",
			chapterId: "chapter-1",
		});
		const directNames = surface.tools.map((tool) => tool.name);
		const catalogNames = surface.catalog.map((tool) => tool.name);

		expect(directNames).toEqual(
			expect.arrayContaining([
				"tapcanvas_project_context_get",
				"tapcanvas_project_chapters_list",
				"tapcanvas_project_chapter_get",
			]),
		);
		expect(catalogNames).toContain("tapcanvas_project_creative_brief_update");
		expect(directNames).not.toContain("tapcanvas_storyboard_source_bundle_get");
		expect(catalogNames).not.toContain("tapcanvas_storyboard_source_bundle_get");
		expect(surface.hiddenToolNames).toContain("tapcanvas_storyboard_source_bundle_get");
		expect(catalogNames).toContain("tapcanvas_render_blocking_diagram");
	});

	it("requires a resolved book envelope for both direct reads and deferred writes", () => {
		const bookScoped = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			bookId: "book-1",
			chapterId: null,
		});
		const chapterScoped = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			bookId: null,
			chapterId: "chapter-1",
		});

		for (const persistenceToolName of BOOK_SCOPED_PERSISTENCE_REMOTE_TOOL_NAMES) {
			expect(bookScoped.tools.map((tool) => tool.name)).not.toContain(persistenceToolName);
			expect(chapterScoped.tools.map((tool) => tool.name)).not.toContain(persistenceToolName);
			expect(bookScoped.catalog.map((tool) => tool.name)).toContain(persistenceToolName);
			expect(chapterScoped.catalog.map((tool) => tool.name)).not.toContain(persistenceToolName);
			expect(chapterScoped.hiddenToolNames).toContain(persistenceToolName);
		}
		expect(bookScoped.tools.map((tool) => tool.name)).toContain("tapcanvas_book_chapter_get");
		expect(chapterScoped.tools.map((tool) => tool.name)).not.toContain("tapcanvas_book_chapter_get");
		expect(chapterScoped.catalog.map((tool) => tool.name)).not.toContain("tapcanvas_book_chapter_get");
		expect(chapterScoped.hiddenToolNames).toContain("tapcanvas_book_chapter_get");
	});

	it("derives the authorized book scope from a canonical chapter canvas id", () => {
		const surface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: null,
			bookId: null,
			chapterId: "book-book-1-ch12",
		});
		const directNames = surface.tools.map((tool) => tool.name);
		const catalogNames = surface.catalog.map((tool) => tool.name);

		expect(surface.satisfiedScopes).toEqual(
			expect.arrayContaining(["project", "canvas", "chapter_canvas", "book"]),
		);
		expect(directNames).toContain("tapcanvas_story_facts_get");
		expect(directNames).toContain("tapcanvas_book_chapter_get");
		for (const persistenceToolName of BOOK_SCOPED_PERSISTENCE_REMOTE_TOOL_NAMES) {
			expect(catalogNames).toContain(persistenceToolName);
		}
	});

	it("locks before and after prompt-surface measurements for the scope matrix", () => {
		const projectOnly = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: null,
			bookId: null,
			chapterId: null,
		});
		const flowWithoutBook = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			bookId: null,
			chapterId: null,
		});
		const bookFlow = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			bookId: "book-1",
			chapterId: null,
		});

		expect({
			projectOnly: {
				before: projectOnly.before,
				after: projectOnly.after,
				catalog: projectOnly.catalogMeasurement,
			},
			flowWithoutBook: {
				before: flowWithoutBook.before,
				after: flowWithoutBook.after,
				catalog: flowWithoutBook.catalogMeasurement,
			},
			bookFlow: {
				before: bookFlow.before,
				after: bookFlow.after,
				catalog: bookFlow.catalogMeasurement,
			},
		}).toEqual({
			projectOnly: {
				before: { visibleToolCount: 68, descriptionChars: 29168, schemaChars: 87329 },
				after: { visibleToolCount: 9, descriptionChars: 2437, schemaChars: 2337 },
				catalog: { visibleToolCount: 6, descriptionChars: 1951, schemaChars: 1432 },
			},
			flowWithoutBook: {
				before: { visibleToolCount: 68, descriptionChars: 29168, schemaChars: 87329 },
				after: { visibleToolCount: 18, descriptionChars: 5140, schemaChars: 12209 },
				catalog: { visibleToolCount: 32, descriptionChars: 18449, schemaChars: 56427 },
			},
			bookFlow: {
				before: { visibleToolCount: 68, descriptionChars: 29168, schemaChars: 87329 },
				after: { visibleToolCount: 23, descriptionChars: 6558, schemaChars: 15008 },
				catalog: { visibleToolCount: 38, descriptionChars: 20018, schemaChars: 65332 },
			},
		});
	});

	it("measures the duplicated wrapper enums after structural scope slicing", () => {
		const projectOnly = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: null,
			bookId: null,
			chapterId: null,
		});
		const flowWithoutBook = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			bookId: null,
			chapterId: null,
		});
		const bookFlow = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			bookId: "book-1",
			chapterId: null,
		});

		expect({
			projectOnly: projectOnly.catalogIndexMeasurement,
			flowWithoutBook: flowWithoutBook.catalogIndexMeasurement,
			bookFlow: bookFlow.catalogIndexMeasurement,
		}).toEqual({
			projectOnly: {
				visibleToolCount: 6,
				nameChars: 197,
				enumJsonChars: 216,
				duplicatedWrapperEnumChars: 432,
				capabilityCounts: {
					material_persistence: 1,
					material_read: 3,
					paid_media_generation: 1,
					project_persistence: 1,
				},
			},
			flowWithoutBook: {
				visibleToolCount: 32,
				nameChars: 963,
				enumJsonChars: 1060,
				duplicatedWrapperEnumChars: 2120,
				capabilityCounts: {
					material_persistence: 5,
					material_read: 2,
					project_persistence: 1,
					canvas_extended: 6,
					paid_media_generation: 8,
					media_analysis: 6,
					director_console: 4,
				},
			},
			bookFlow: {
				visibleToolCount: 38,
				nameChars: 1161,
				enumJsonChars: 1276,
				duplicatedWrapperEnumChars: 2552,
				capabilityCounts: {
					book_persistence: 5,
					book_read: 1,
					material_persistence: 5,
					material_read: 2,
					project_persistence: 1,
					canvas_extended: 6,
					paid_media_generation: 8,
					media_analysis: 6,
					director_console: 4,
				},
			},
		});
		expect(measureRemoteToolCatalogIndex(bookFlow.catalog)).toEqual(
			bookFlow.catalogIndexMeasurement,
		);
	});

	it("locks the ten largest candidate definitions and the direct flow patch weight", () => {
		const surface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			bookId: "book-1",
			chapterId: "chapter-1",
		});
		const weighted = [
			...surface.tools,
			...surface.catalog,
			...surface.explicitCapabilityTools,
		]
			.map((tool) => ({
				name: tool.name,
				descriptionChars: tool.description.length,
				schemaChars: JSON.stringify(tool.parameters ?? {}).length,
				totalChars:
					tool.description.length + JSON.stringify(tool.parameters ?? {}).length,
			}))
			.sort((left, right) => right.totalChars - left.totalChars);

		expect(weighted.slice(0, 10)).toEqual([
			{ name: "tapcanvas_image_generate_to_canvas", descriptionChars: 2428, schemaChars: 34924, totalChars: 37352 },
			{ name: "tapcanvas_flow_patch", descriptionChars: 646, schemaChars: 9591, totalChars: 10237 },
			{ name: "tapcanvas_story_facts_commit", descriptionChars: 368, schemaChars: 6471, totalChars: 6839 },
			{ name: "tapcanvas_render_blocking_diagram", descriptionChars: 1280, schemaChars: 4144, totalChars: 5424 },
			{ name: "tapcanvas_story_preview_orchestrate", descriptionChars: 1052, schemaChars: 3902, totalChars: 4954 },
			{ name: "tapcanvas_render_director_clip", descriptionChars: 2482, schemaChars: 1739, totalChars: 4221 },
			{ name: "tapcanvas_shot_table_critic", descriptionChars: 310, schemaChars: 3846, totalChars: 4156 },
			{ name: "tapcanvas_video_generate_to_canvas", descriptionChars: 883, schemaChars: 3218, totalChars: 4101 },
			{ name: "tapcanvas_project_chapter_update", descriptionChars: 1055, schemaChars: 2270, totalChars: 3325 },
			{ name: "tapcanvas_capture_director_scene", descriptionChars: 1296, schemaChars: 1970, totalChars: 3266 },
		]);
		expect(weighted.find((tool) => tool.name === "tapcanvas_flow_patch")).toEqual({
			name: "tapcanvas_flow_patch",
			descriptionChars: 646,
			schemaChars: 9591,
			totalChars: 10237,
		});
	});

	it("preserves the flow_patch protocol structure while keeping descriptions compact", () => {
		const surface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			bookId: "book-1",
			chapterId: "chapter-1",
		});
		const flowPatch = surface.tools.find((tool) => tool.name === "tapcanvas_flow_patch");
		const parameters = asSchemaRecord(flowPatch?.parameters);
		const properties = asSchemaRecord(parameters.properties);
		const createNodes = asSchemaRecord(properties.createNodes);
		const createNodeItems = asSchemaRecord(createNodes.items);
		const nodeAlternatives = Array.isArray(createNodeItems.oneOf)
			? createNodeItems.oneOf
			: [];
		const taskNode = asSchemaRecord(nodeAlternatives[0]);
		const taskNodeProperties = asSchemaRecord(taskNode.properties);
		const taskNodeData = asSchemaRecord(taskNodeProperties.data);
		const taskNodeDataProperties = asSchemaRecord(taskNodeData.properties);
		const productionMetadata = asSchemaRecord(taskNodeDataProperties.productionMetadata);
		const productionProperties = asSchemaRecord(productionMetadata.properties);
		const compositionContract = asSchemaRecord(productionProperties.compositionContract);

		expect(Object.keys(properties)).toMatchInlineSnapshot(`
			[
			  "allowOverwrite",
			  "deleteNodeIds",
			  "deleteEdgeIds",
			  "createNodes",
			  "createEdges",
			  "patchNodeData",
			  "appendNodeArrays",
			]
		`);
		expect(parameters).toMatchObject({
			type: "object",
			additionalProperties: false,
		});
		expect(asSchemaRecord(taskNodeProperties.type)).toMatchObject({
			type: "string",
			enum: ["taskNode"],
		});
		expect(taskNode.required).toEqual(["type", "position", "data"]);
		expect(taskNode.additionalProperties).toBe(true);
		expect(asSchemaRecord(taskNodeDataProperties.kind)).toMatchObject({
			type: "string",
			enum: expect.arrayContaining(["text", "image", "video", "composeVideo", "audio"]),
		});
		expect(asSchemaRecord(taskNodeDataProperties.audioType)).toMatchObject({
			type: "string",
			enum: ["speech", "music"],
		});
		expect(asSchemaRecord(taskNodeDataProperties.audioModel)).toMatchObject({ type: "string" });
		expect(surface.catalog.map((tool) => tool.name)).not.toContain(
			"tapcanvas_audio_generate_to_canvas",
		);
		expect(flowPatch?.description).toContain("分镜表 / shot table");
		expect(flowPatch?.description).toContain("data.kind='shotTable' plus valid data.shotTable");
		const shotTable = asSchemaRecord(taskNodeDataProperties.shotTable);
		expect(shotTable).toMatchObject({
			type: "object",
			description: expect.stringContaining("rows:Array<{id,shotId,values:Record<string,string>}>")
		});
		expect(productionMetadata).toMatchObject({
			type: "object",
			required: ["chapterGrounded", "lockedAnchors", "authorityBaseFrame"],
			additionalProperties: false,
		});
		expect(compositionContract).toMatchObject({
			type: "object",
			required: [
				"narrativeTask",
				"focusKind",
				"focusTargetNames",
				"focalPoint",
				"shotScale",
				"environmentVisualWeight",
				"subjects",
			],
			additionalProperties: false,
		});
		expect(
			flowPatch!.description.length + JSON.stringify(flowPatch!.parameters).length,
		).toBeLessThanOrEqual(10_500);
	});

	it("discloses workflowTrigger and workflowStage create kinds only to an authenticated admin surface", () => {
		const readKinds = (adminWorkflowAccess: boolean): unknown[] => {
			const surface = inspectAgentsBridgeRemoteToolSurface({
				publicAgentsRequest: true,
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				adminWorkflowAccess,
			});
			const flowPatch = surface.tools.find((tool) => tool.name === "tapcanvas_flow_patch");
			const properties = asSchemaRecord(asSchemaRecord(flowPatch?.parameters).properties);
			const createNodes = asSchemaRecord(properties.createNodes);
			const alternatives = asSchemaRecord(asSchemaRecord(createNodes.items)).oneOf;
			const taskNode = asSchemaRecord(Array.isArray(alternatives) ? alternatives[0] : null);
			const taskData = asSchemaRecord(asSchemaRecord(asSchemaRecord(taskNode.properties).data).properties);
			const kindSchema = asSchemaRecord(taskData.kind);
			return Array.isArray(kindSchema.enum) ? kindSchema.enum : [];
		};

		expect(readKinds(false)).not.toContain("workflowTrigger");
		expect(readKinds(false)).not.toContain("workflowStage");
		expect(readKinds(true)).toEqual(expect.arrayContaining(["workflowTrigger", "workflowStage"]));
	});

	it("discloses the idempotent durable workflow starter only to an authenticated admin surface", () => {
		const readTool = (adminWorkflowAccess: boolean) => inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			adminWorkflowAccess,
		}).tools.find((tool) => tool.name === "tapcanvas_workflow_run");

		expect(readTool(false)).toBeUndefined();
		expect(readTool(true)).toMatchObject({
			execution: {
				retrySafety: "idempotency_key_required",
				idempotencyKeyField: "idempotencyKey",
			},
		});
		const parameters = asSchemaRecord(readTool(true)?.parameters);
		expect(parameters.required).toEqual(["triggerNodeId", "idempotencyKey"]);
		const properties = asSchemaRecord(parameters.properties);
		expect(properties.replayFromExecutionId).toMatchObject({ type: "string", minLength: 1 });
		expect(properties.startFromNodeId).toMatchObject({ type: "string", minLength: 1 });

		const readResumeTool = (adminWorkflowAccess: boolean) => inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			adminWorkflowAccess,
		}).tools.find((tool) => tool.name === "tapcanvas_workflow_resume");
		expect(readResumeTool(false)).toBeUndefined();
		expect(readResumeTool(true)).toMatchObject({
			execution: {
				sideEffect: "external_mutation",
				retrySafety: "unsafe",
			},
		});
		const resumeParameters = asSchemaRecord(readResumeTool(true)?.parameters);
		const resumeBranches = Array.isArray(resumeParameters.oneOf)
			? resumeParameters.oneOf.map(asSchemaRecord)
			: [];
		expect(resumeBranches).toHaveLength(5);
		expect(resumeBranches[0]).toMatchObject({
			required: ["sourceExecutionId"],
			additionalProperties: false,
		});
		const branchProperty = (name: string) => asSchemaRecord(
			asSchemaRecord(resumeBranches.find((branch) =>
				Array.isArray(branch.required) && branch.required.includes(name),
			)?.properties)[name],
		);
		expect(branchProperty("providerBalanceRestored")).toMatchObject({
			type: "boolean",
			const: true,
		});
		expect(branchProperty("cancellationRevoked")).toMatchObject({
			type: "boolean",
			const: true,
		});
		expect(branchProperty("agentModelCutover")).toMatchObject({
			type: "object",
			required: ["targetModelKey", "apiStyle"],
			additionalProperties: false,
		});
		expect(branchProperty("definitionCutover")).toMatchObject({
			type: "object",
			required: ["mode"],
			additionalProperties: false,
		});

		const continuationResumeTool = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			adminWorkflowAccess: false,
			workflowRecoveryAccess: true,
		}).tools.find((tool) => tool.name === "tapcanvas_workflow_resume");
		expect(continuationResumeTool).toMatchObject({
			execution: {
				sideEffect: "external_mutation",
				retrySafety: "unsafe",
			},
		});
		expect(inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			adminWorkflowAccess: false,
			workflowRecoveryAccess: true,
		}).tools.find((tool) => tool.name === "tapcanvas_workflow_run")).toBeUndefined();
	});

	it("keeps workflow SOP prose out of remote tool descriptions", () => {
		const surface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			bookId: "book-1",
			chapterId: "chapter-1",
		});
		const descriptions = [
			...surface.tools,
			...surface.catalog,
			...surface.explicitCapabilityTools,
		].map((tool) => tool.description).join("\n");

		for (const retiredSop of [
			"IMPORTANT: If this returns an empty list",
			"成片收尾时调用一次",
			"Use this before chapter asset generation",
			"后续章节增量更新节点即可",
			"A blank text node must be a taskNode",
			"Handle matrix:",
			"按内容/类型定位节点优先用",
		]) {
			expect(descriptions).not.toContain(retiredSop);
		}
	});
});
