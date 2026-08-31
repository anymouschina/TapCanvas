import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveProjectDataRepoRoot } from "../asset/project-data-root";
import { sha256Hex } from "../asset/book-content-hash";
import {
	buildBookEvidenceIndex,
	writeBookEvidenceIndex,
} from "../asset/book-evidence-index";
import type { BookSourceMetadataV1 } from "../asset/book-source-parser";
import { AppError } from "../../middleware/error";
import { resolveProjectBookDirectoryName } from "./agents-tool-bridge.book-lookup";
import {
	selectStoryboardPlanReadResult,
	type StoryboardPlanRecord,
} from "./agents-tool-bridge.storyboard-plan";

const STORYBOARD_PLAN_REQUIRED_FIELDS = {
	storyboardArtifact: {},
	artifactSha256: "a".repeat(64),
	storyboardStructured: {},
} satisfies Pick<StoryboardPlanRecord, "storyboardArtifact" | "artifactSha256" | "storyboardStructured">;

const {
	getVideoRun,
	resolveExecutionImageReferences,
	resolveImageReferencesForInspection,
	generateImageToCanvas,
	inspectStoryPreviewRunSnapshot,
	loadChapterCanvasAsFlowRow,
	getExecutionTraceAcceptedSnapshot,
	getExecutionTraceLifecycleSnapshot,
} = vi.hoisted(() => ({
	getVideoRun: vi.fn(),
	resolveExecutionImageReferences: vi.fn(),
	resolveImageReferencesForInspection: vi.fn(),
	generateImageToCanvas: vi.fn(),
	inspectStoryPreviewRunSnapshot: vi.fn(),
	loadChapterCanvasAsFlowRow: vi.fn(),
	getExecutionTraceAcceptedSnapshot: vi.fn(),
	getExecutionTraceLifecycleSnapshot: vi.fn(),
}));

// Mock heavy dependencies so we can import the route handler in isolation
vi.mock("../flow/flow.repo", () => ({
	getFlowForOwner: vi.fn(),
	getFlowByIdUnsafe: vi.fn(),
	mapFlowRowToDto: vi.fn(),
	updateFlow: vi.fn(),
	updateFlowByIdUnsafe: vi.fn(),
	createFlowVersion: vi.fn(),
	listFlowsByOwner: vi.fn(),
	listFlowsByProject: vi.fn(),
}));
vi.mock("../flow/flow.service", () => ({ sanitizeFlowDataForStorage: vi.fn() }));
vi.mock("../flow/flow.public.service", () => ({ applyPublicFlowGraphPatch: vi.fn() }));
vi.mock("../flow/flow.canvas-book-sync", () => ({ syncCanvasBookFromFlow: vi.fn() }));
vi.mock("../project/project.repo", () => ({
	getProjectById: vi.fn(),
	getProjectForOwner: vi.fn(),
}));
vi.mock("../chapter/chapter.repo", () => ({
	listChaptersByProjectForOwner: vi.fn(),
}));
vi.mock("../agents/agents.service", () => ({
	getUserAgentPipelineRunById: vi.fn(),
	getNodeContextBundle: vi.fn(),
	getUserProjectWorkspaceContext: vi.fn(),
	getStoryboardSourceBundle: vi.fn(),
	getStoryboardContinuityEvidence: vi.fn(),
	getVideoReviewBundle: vi.fn(),
	listUserAgentPipelineRuns: vi.fn(),
}));
vi.mock("./agents-tool-bridge.generate-image-to-canvas", () => ({
	generateImageToCanvas,
	inspectStoryPreviewRunSnapshot,
}));
vi.mock("./agents-tool-bridge.generate-video-to-canvas", () => ({ generateVideoToCanvas: vi.fn() }));
vi.mock("./agents-tool-bridge.chapter-canvas-write", () => ({
	applyFlowPatchToChapterCanvas: vi.fn(),
	loadChapterCanvasAsFlowRow,
	mutateChapterCanvasGraph: vi.fn(),
}));
vi.mock("./agents-tool-bridge.image-reference-ids", () => ({
	resolveExecutionImageReferences,
	resolveImageReferencesForInspection,
	describeExecutionImageReference: (reference: Record<string, unknown>) => {
		const { url: _url, ...visible } = reference;
		return { ...visible, mediaType: "image", ready: true };
	},
}));
vi.mock("../execution/execution.repo", () => ({
	getExecutionForOwner: vi.fn(),
	listExecutionEvents: vi.fn(),
	listExecutionsForOwnerFlow: vi.fn(),
	listNodeRunsForExecutionOwner: vi.fn(),
	mapExecutionEventRow: vi.fn(),
	mapExecutionRow: vi.fn(),
	mapNodeRunRow: vi.fn(),
}));
vi.mock("../execution/execution.family-store", () => ({
	getWorkflowExecutionFamilyPageForOwner: vi.fn(),
	listWorkflowNodeAttemptsPageForExecutionOwner: vi.fn(),
}));
vi.mock("../agents/capability-bay.service", async (importOriginal) => {
	const original = await importOriginal<typeof import("../agents/capability-bay.service")>();
	type CapabilityPreferenceRow = {
		capability_id: string;
		disabled_reason?: string | null;
	};
	type CapabilitySettingRow = { capability_id: string };
	type CapabilityAvailabilityContext = {
		env: {
			DB: {
				agent_capability_preferences?: {
					findMany: (args: unknown) => Promise<CapabilityPreferenceRow[]>;
				};
				agent_builtin_capability_settings?: {
					findMany: (args: unknown) => Promise<CapabilitySettingRow[]>;
				};
			};
		};
	};
	return {
		...original,
		getBuiltInCapabilityAvailability: vi.fn(async (context?: CapabilityAvailabilityContext) => {
			const database = context?.env?.DB;
			const [systemRows, userRows] = await Promise.all([
				database?.agent_builtin_capability_settings?.findMany({
					where: { enabled: 0 },
					select: { capability_id: true },
					orderBy: { capability_id: "asc" },
				}) ?? Promise.resolve([]),
				database?.agent_capability_preferences?.findMany({
					where: { capability_kind: "built_in", enabled: 0 },
					select: { capability_id: true, disabled_reason: true },
					orderBy: { capability_id: "asc" },
				}) ?? Promise.resolve([]),
			]);
			const systemDisabledKeys = systemRows.map((row) => row.capability_id);
			const userDisabledKeys = userRows.map((row) => row.capability_id);
			return {
				systemDisabledKeys,
				userDisabledKeys,
				disabledKeys: [...new Set([...systemDisabledKeys, ...userDisabledKeys])].sort(),
			};
		}),
	};
});
vi.mock("./video-run.repo", async (importOriginal) => ({
	...(await importOriginal<typeof import("./video-run.repo")>()),
	getVideoRun,
}));
vi.mock("../storyboard/storyboard-structure", () => ({
	deriveShotPromptsFromStructuredData: vi.fn(),
	normalizeStoryboardStructuredData: vi.fn(),
}));
vi.mock("./shot-table-critic", () => ({
	critiqueShotTable: vi.fn(),
	critiqueTextStoryboard: vi.fn(),
}));
vi.mock("../../platform/redis-shared", () => ({ getSharedRedis: () => null }));
vi.mock("../memory/execution-trace-events.repo", () => ({
	getExecutionTraceAcceptedSnapshot,
	getExecutionTraceLifecycleSnapshot,
}));

// Pre-load apiKey.routes FIRST (side-effect import) to resolve the fragile apiKey ⇄ bridge
// import cycle: apiKey.routes calls registerPublicAgentsToolBridgeRoutes at module top-level,
// so the bridge routes module must fully evaluate before that call. Importing the bridge routes
// module first (as the dynamic imports below do) hits the cycle mid-init → "not a function".
// In the full suite this happens to be satisfied by load order; in isolation it is not.
import "../apiKey/apiKey.routes";

describe("public workflow recovery lifecycle authorization", () => {
	it("authorizes only the exact waiting logical root turn", async () => {
		const { isPublicWorkflowRecoveryLifecycleEligible } = await import(
			"./agents-tool-bridge.routes"
		);
		const publicTurnId = "public-chat-turn:root-1";
		const lifecycle = {
			traceId: publicTurnId,
			status: "waiting_async" as const,
			logicalTaskId: publicTurnId,
			rootTraceId: publicTurnId,
			startedAt: "2026-08-22T00:00:00.000Z",
			updatedAt: "2026-08-22T00:01:00.000Z",
			finishedAt: "2026-08-22T00:01:00.000Z",
		};
		expect(isPublicWorkflowRecoveryLifecycleEligible({ publicTurnId, lifecycle })).toBe(true);
		expect(isPublicWorkflowRecoveryLifecycleEligible({
			publicTurnId,
			lifecycle: { ...lifecycle, status: "succeeded" },
		})).toBe(false);
		expect(isPublicWorkflowRecoveryLifecycleEligible({
			publicTurnId,
			lifecycle: { ...lifecycle, logicalTaskId: "another-task" },
		})).toBe(false);
		expect(isPublicWorkflowRecoveryLifecycleEligible({ publicTurnId, lifecycle: null })).toBe(false);
	});
});

describe("equipped workflow trigger payload normalization", () => {
	it("reads only the immutable accepted request prompt as the public-chat video source", async () => {
		const {
			readAcceptedPublicChatPrompt,
			resolvePublicChatTurnPrompt,
		} = await import("./agents-tool-bridge.routes");
		expect(readAcceptedPublicChatPrompt({ prompt: "  创作雨夜追逐视频  ", displayPrompt: "伪装文案" }))
			.toBe("创作雨夜追逐视频");
		expect(readAcceptedPublicChatPrompt({ input: "不能从非权威字段猜来源" })).toBe("");

		getExecutionTraceAcceptedSnapshot.mockResolvedValueOnce({
			request: { prompt: "  创作二十秒雨夜追逐视频  ", input: "非权威覆盖值" },
			recoveryContext: null,
		});
		await expect(resolvePublicChatTurnPrompt({
			c: { env: { DB: { marker: "db" } } } as never,
			userId: "user-1",
			publicTurnId: "public-chat-turn:source-1",
		})).resolves.toBe("创作二十秒雨夜追逐视频");
		expect(getExecutionTraceAcceptedSnapshot).toHaveBeenCalledWith(
			{ marker: "db" },
			{
				traceId: "public-chat-turn:source-1",
				userId: "user-1",
			},
		);
	});

	it("keeps canonical chapter text as the source for chapter-scoped public workflow runs", async () => {
		const { shouldUseAcceptedPublicChatTurnAsWorkflowSource } = await import(
			"./agents-tool-bridge.routes"
		);
		expect(shouldUseAcceptedPublicChatTurnAsWorkflowSource({
			publicTurnId: "public-chat-turn:standalone",
			sourceMode: "project_context",
			chapterId: "",
		})).toBe(true);
		expect(shouldUseAcceptedPublicChatTurnAsWorkflowSource({
			publicTurnId: "public-chat-turn:chapter",
			sourceMode: "project_context",
			chapterId: "book-demo-ch1",
		})).toBe(false);
		expect(shouldUseAcceptedPublicChatTurnAsWorkflowSource({
			publicTurnId: "",
			sourceMode: "project_context",
			chapterId: "",
		})).toBe(false);
	});

	it("carries explicit public-chat asset IDs into the frozen workflow selection", async () => {
		const {
			readAcceptedPublicChatAssetIds,
			mergeAcceptedPublicChatAssetSelection,
		} = await import("./agents-tool-bridge.routes");
		const acceptedAssetIds = readAcceptedPublicChatAssetIds({
			assetInputs: [
				{ assetId: "asset-liu-xiu", role: "character" },
				{ nodeId: "chapter-node-only", role: "context" },
				{ assetId: "asset-qin-jia", role: "scene" },
				{ assetId: "asset-liu-xiu", role: "character" },
			],
		});
		expect(acceptedAssetIds).toEqual(["asset-liu-xiu", "asset-qin-jia"]);
		expect(mergeAcceptedPublicChatAssetSelection({
			triggerPayload: { selectedAssetIds: ["asset-agent-choice"] },
			acceptedAssetIds,
		})).toEqual({
			selectedAssetIds: ["asset-liu-xiu", "asset-qin-jia", "asset-agent-choice"],
		});
	});

	it("builds a stable versioned workflow receipt for durable continuation", async () => {
		const {
			buildWorkflowExecutionAgentSummary,
			buildWorkflowExecutionReceipt,
			workflowExecutionMatchesCanvasScope,
		} = await import("./agents-tool-bridge.routes");
		const execution = {
			id: "workflow-execution-1",
			executionFamilyId: "workflow-execution-root",
			status: "queued",
		} as never;

		expect(buildWorkflowExecutionReceipt(execution)).toEqual({
			protocolVersion: "tapcanvas.workflow-execution-receipt/v1",
			runId: "workflow-execution-1",
			executionId: "workflow-execution-1",
			executionFamilyId: "workflow-execution-root",
			status: "queued",
			acceptedAsync: true,
			inspection: {
				toolName: "tapcanvas_workflow_execution_inspect",
				familyArgs: { executionId: "workflow-execution-1", view: "family" },
				attemptArgs: { executionId: "workflow-execution-1", view: "attempts" },
			},
		});
		expect(buildWorkflowExecutionReceipt(execution)).toEqual(buildWorkflowExecutionReceipt(execution));
		const summary = buildWorkflowExecutionAgentSummary({
			id: "workflow-execution-1",
			executionFamilyId: "workflow-execution-root",
			flowId: "flow-1",
			flowVersionId: "flow-version-1",
			ownerId: "user-1",
			status: "running",
			concurrency: 1,
			projectId: "project-1",
			canvasId: "chapter:book-1-ch35",
			projectContext: { sentinel: "must-not-enter-agent-summary" },
			assetSnapshot: { sentinel: "must-not-enter-agent-summary" },
			userInput: "must-not-enter-agent-summary",
			createdAt: "2026-08-22T00:00:00.000Z",
			startedAt: "2026-08-22T00:00:01.000Z",
			finishedAt: null,
		} as never);
		expect(summary).toMatchObject({
			executionId: "workflow-execution-1",
			executionFamilyId: "workflow-execution-root",
			status: "running",
			terminal: false,
			projectId: "project-1",
			canvasId: "chapter:book-1-ch35",
		});
		expect(JSON.stringify(summary)).not.toContain("must-not-enter-agent-summary");
		expect(summary).not.toHaveProperty("projectContext");
		expect(summary).not.toHaveProperty("assetSnapshot");
		expect(summary).not.toHaveProperty("userInput");
		const successfulSummary = buildWorkflowExecutionAgentSummary({
			id: "workflow-execution-1",
			executionFamilyId: "workflow-execution-root",
			status: "success",
		} as never, [{
			nodeId: "output-1",
			nodeRunId: "run-output-1",
			ports: { output: { text: ["固定交付"] } },
			artifacts: [],
		}]);
		expect(successfulSummary).toMatchObject({
			terminal: true,
			workflowOutputs: [{
				nodeId: "output-1",
				ports: { output: { text: ["固定交付"] } },
			}],
		});
		expect(workflowExecutionMatchesCanvasScope({
			executionFlowId: "shared-workflow-flow",
			executionCanvasId: "chapter:book-1-ch35",
			executionProjectId: "project-1",
			scopeFlowId: "book-1-ch35",
			scopeProjectId: "project-1",
			isChapterScope: true,
		})).toBe(true);
		expect(workflowExecutionMatchesCanvasScope({
			executionFlowId: "shared-workflow-flow",
			executionCanvasId: "chapter:book-1-ch35",
			executionProjectId: "other-project",
			scopeFlowId: "book-1-ch35",
			scopeProjectId: "project-1",
			isChapterScope: true,
		})).toBe(false);
	});

	it("projects flattened media fields into the documented triggerPayload shape", async () => {
		const { normalizeEquippedWorkflowTriggerPayload } = await import("./agents-tool-bridge.routes");
		expect(normalizeEquippedWorkflowTriggerPayload({
			attachmentId: "attachment-a",
			idempotencyKey: "run-1",
			targetDurationSeconds: 60,
			requestedClipCount: 6,
			requestedClipDurationsSeconds: [10, 10, 10, 10, 10, 10],
			videoModelKey: "doubao-seedance-2.0",
			imageModelKey: "gpt-image-2",
			imageSize: "2K",
			videoResolution: "480p",
			videoAspectRatio: "16:9",
			imageAspectRatio: "16:9",
		})).toEqual({
			targetDurationSeconds: 60,
			requestedClipCount: 6,
			requestedClipDurationsSeconds: [10, 10, 10, 10, 10, 10],
			videoModelKey: "doubao-seedance-2.0",
			imageModelKey: "gpt-image-2",
			imageSize: "2K",
			videoResolution: "480p",
			videoAspectRatio: "16:9",
			imageAspectRatio: "16:9",
		});
	});

	it("preserves nested trigger payloads and rejects conflicting flattened fields", async () => {
		const { normalizeEquippedWorkflowTriggerPayload } = await import("./agents-tool-bridge.routes");
		expect(normalizeEquippedWorkflowTriggerPayload({
			triggerPayload: { targetDurationSeconds: 60, videoModelKey: "doubao-seedance-2.0" },
			videoResolution: "480p",
		})).toEqual({
			targetDurationSeconds: 60,
			videoModelKey: "doubao-seedance-2.0",
			videoResolution: "480p",
		});
		expect(() => normalizeEquippedWorkflowTriggerPayload({
			triggerPayload: { videoModelKey: "doubao-seedance-2.0" },
			videoModelKey: "doubao-seedance-2.5",
		})).toThrow("triggerPayload.videoModelKey conflicts with flattened tool argument");
	});

	it("canonicalizes only a unique case-insensitive catalog image size", async () => {
		const { resolveCanonicalCatalogImageSize } = await import("./agents-tool-bridge.routes");
		expect(resolveCanonicalCatalogImageSize("2K", ["1k", "2k", "4k"])).toBe("2k");
		expect(resolveCanonicalCatalogImageSize("2k", ["1k", "2k", "4k"])).toBe("2k");
		expect(resolveCanonicalCatalogImageSize("3K", ["1k", "2k", "4k"])).toBeNull();
		expect(resolveCanonicalCatalogImageSize("2K", [])).toBe("2K");
	});

	it("rejects model-supplied workflow source authority", async () => {
		const { normalizeEquippedWorkflowTriggerPayload } = await import("./agents-tool-bridge.routes");
		expect(() => normalizeEquippedWorkflowTriggerPayload({
			triggerPayload: {
				workflowAcceptedTurnSource: {
					protocolVersion: "tapcanvas.workflow-accepted-turn-source/v1",
				},
			},
		})).toThrow("workflowAcceptedTurnSource is server-owned");
	});

	it("binds equipped workflow idempotency to the immutable public turn", async () => {
		const { resolveEquippedWorkflowIdempotencyKey } = await import("./agents-tool-bridge.routes");
		expect(resolveEquippedWorkflowIdempotencyKey({
			requestedKey: "model-key-first",
			publicTurnId: "public-chat-turn:stable",
		})).toBe("public-turn:public-chat-turn:stable");
		expect(resolveEquippedWorkflowIdempotencyKey({
			requestedKey: "model-key-changed-on-continuation",
			publicTurnId: "public-chat-turn:stable",
		})).toBe("public-turn:public-chat-turn:stable");
		expect(resolveEquippedWorkflowIdempotencyKey({
			requestedKey: "non-chat-key",
			publicTurnId: "",
		})).toBe("non-chat-key");
	});

	it("rejects unsupported per-run video media options before a workflow execution is created", async () => {
		const { assertWorkflowVideoMediaSelectionSupported } = await import("./agents-tool-bridge.routes");
		expect(() => assertWorkflowVideoMediaSelectionSupported({
			modelKey: "doubao-seedance-2.5",
			resolution: "1080p",
			aspectRatio: "16:9",
			resolutionOptions: ["480p", "720p"],
			aspectRatioOptions: ["16:9", "9:16"],
		})).toThrow("does not support resolution 1080p; supported: 480p/720p");
		expect(() => assertWorkflowVideoMediaSelectionSupported({
			modelKey: "doubao-seedance-2.5",
			resolution: "720p",
			aspectRatio: "21:9",
			resolutionOptions: ["480p", "720p"],
			aspectRatioOptions: ["16:9", "9:16"],
		})).toThrow("does not support aspect ratio 21:9; supported: 16:9/9:16");
		expect(() => assertWorkflowVideoMediaSelectionSupported({
			modelKey: "doubao-seedance-2.5",
			resolution: "720p",
			aspectRatio: "9:16",
			resolutionOptions: ["480p", "720p"],
			aspectRatioOptions: ["16:9", "9:16"],
		})).not.toThrow();
	});
});

describe("registerPublicAgentsToolBridgeRoutes – equipped workflow catalog", () => {
	it("loads the current user's attachments into both catalog and schema discovery", async () => {
		const ownerId = "capability-owner";
		const attachmentId = "capability-attachment-1";
		const descriptor = {
			protocolVersion: "tapcanvas.agent-capability/v1",
			capabilityId: "workflow:flow-equipped",
			kind: "workflow",
			name: "一键成片工作流",
			summary: "从主题生成完整视频",
			sourceId: "flow-equipped",
			sourceVersionId: "version-equipped",
			sourceRevision: 1,
			projectId: "project-equipped",
			triggerNodeId: "trigger-equipped",
			nodeCount: 2,
			operations: ["video_submission"],
			requiredSkills: [],
			requiredTools: ["tapcanvas_video_generate_to_canvas"],
			inputArtifacts: ["topic"],
			outputArtifacts: ["video"],
			permissions: ["workflow:invoke"],
			sideEffects: ["paid_generation"],
			semanticEvidence: [],
		};
		const conflictReport = {
			protocolVersion: "tapcanvas.capability-conflict-report/v1",
			targetCapabilityId: descriptor.capabilityId,
			checkedAt: "2026-08-15T00:00:00.000Z",
			descriptorSha256: "a".repeat(64),
			conflicts: [],
			blocking: false,
			requiresConfirmation: false,
		};
		const attachmentRow = {
			id: attachmentId,
			user_id: ownerId,
			capability_kind: "workflow",
			source_id: descriptor.sourceId,
			source_version_id: descriptor.sourceVersionId,
			descriptor_json: JSON.stringify(descriptor),
			descriptor_sha256: conflictReport.descriptorSha256,
			conflict_report_json: JSON.stringify(conflictReport),
			route_decisions_json: "[]",
			conflict_report_revision: 1,
			created_at: "2026-08-15T00:00:00.000Z",
			updated_at: "2026-08-15T00:00:00.000Z",
		};
		const frozenWorkflowVersionData = JSON.stringify({
			nodes: [{
				id: "beat-sheet",
				data: {
					workflowNodeId: "beat-sheet-agent",
					workflowAtomicSpec: { executorRef: "agents.logical-task/v2" },
					workflowAgentJsonObjectContract: {
						requiredStringFields: ["protocolVersion"],
						requiredObjectFields: ["filmBible", "meta"],
						requiredArrayFields: ["beats"],
						arrayItemRequiredStringFields: { beats: ["clipId"] },
						allowedFields: ["protocolVersion", "filmBible", "meta", "beats"],
					},
				},
			}],
		});
		const { OpenAPIHono } = await import("@hono/zod-openapi");
		const { registerPublicAgentsToolBridgeRoutes } = await import("./agents-tool-bridge.routes");
		const router = new OpenAPIHono<{
			Variables: { userId: string; devPublicBypass: boolean };
		}>();
		router.use("*", async (c, next) => {
			c.set("userId", ownerId);
			c.set("devPublicBypass", false);
			await next();
		});
		registerPublicAgentsToolBridgeRoutes(router as never);
		const env = {
			DB: {
				flows: {
					findMany: vi.fn().mockResolvedValue([{
						id: descriptor.sourceId,
						data: frozenWorkflowVersionData,
					}]),
				},
				agent_capability_attachments: {
					findMany: vi.fn().mockResolvedValue([attachmentRow]),
				},
				agent_capability_preferences: {
					findMany: vi.fn().mockResolvedValue([{
						capability_kind: "built_in",
						capability_id: "one_click_video",
						enabled: 0,
						disabled_reason: "replaced",
						replaced_by_capability_id: descriptor.capabilityId,
					}]),
				},
				agent_builtin_capability_settings: {
					findMany: vi.fn().mockResolvedValue([]),
				},
				flow_versions: {
					findMany: vi.fn().mockResolvedValue([{
						id: descriptor.sourceVersionId,
						data: frozenWorkflowVersionData,
					}]),
				},
			},
		};

		const catalogResponse = await router.request("/agents/tools/execute", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				toolName: "tapcanvas_tool_catalog_get",
				canvasProjectId: "project-equipped",
				canvasFlowId: "flow-equipped",
				args: {},
			}),
		}, env);
		const catalogBody = await catalogResponse.json() as {
			data?: {
				tools?: Array<{ name?: string; description?: string }>;
				primaryCapabilityRoutes?: Array<{
					capabilityId?: string;
					toolName?: string;
					attachmentId?: string;
				}>;
			};
		};
		expect(catalogResponse.status).toBe(200);
		expect(catalogBody.data?.tools?.some((tool) => tool.name === "tapcanvas_equipped_workflow_run")).toBe(true);
		expect(catalogBody.data?.tools?.some((tool) => tool.name === "tapcanvas_video_orchestrate")).toBe(false);
		expect(catalogBody.data?.tools?.find((tool) => tool.name === "tapcanvas_equipped_workflow_run")?.description)
			.toContain("builtin:one_click_video（一键成片）");
		expect(catalogBody.data?.primaryCapabilityRoutes).toEqual([{
			capabilityId: "builtin:one_click_video",
			toolName: "tapcanvas_equipped_workflow_run",
			attachmentId,
		}]);

		const schemaResponse = await router.request("/agents/tools/execute", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				toolName: "tapcanvas_tool_schema_get",
				canvasProjectId: "project-equipped",
				canvasFlowId: "flow-equipped",
				args: { name: "tapcanvas_equipped_workflow_run" },
			}),
		}, env);
		const schemaBody = await schemaResponse.json() as {
			data?: { parameters?: {
				required?: string[];
				properties?: { attachmentId?: { enum?: string[] }; concurrency?: unknown };
				oneOf?: Array<{
					properties?: { triggerPayload?: {
						required?: string[];
						properties?: { preparedBeatSheet?: {
							additionalProperties?: boolean;
							properties?: { protocolVersion?: { const?: string }; version?: unknown };
						} };
					} };
				}>;
			} };
		};
		expect(schemaResponse.status).toBe(200);
		expect(schemaBody.data?.parameters?.properties?.attachmentId).toBeUndefined();
		expect(schemaBody.data?.parameters?.required).toEqual(["idempotencyKey"]);
		expect(schemaBody.data?.parameters?.properties?.concurrency).toBeUndefined();
		expect(schemaBody.data?.parameters?.oneOf?.[0]?.properties?.triggerPayload).toBeUndefined();
	});
});

describe("registerPublicAgentsToolBridgeRoutes – durable story preview", () => {
	const ownerId = "story-preview-owner";
	const projectId = "story-preview-project";
	const chapterId = "story-preview-chapter";
	const row = {
		id: chapterId,
		name: "Story preview chapter",
		data: JSON.stringify({ nodes: [], edges: [] }),
		owner_id: ownerId,
		project_id: projectId,
		created_at: "2026-08-20T00:00:00.000Z",
		updated_at: "2026-08-20T00:00:00.000Z",
	};
	const snapshot = {
		chapterId,
		runId: "story-preview:chapter:r7:hash:0-60",
		revision: "r7:hash",
		sourceChapterRevision: 7,
		sourceHash: "hash",
		boardCount: 7,
		boards: Array.from({ length: 7 }, (_, boardIndex) => ({
			boardIndex,
			startSeconds: boardIndex * 9,
			endSeconds: Math.min(60, (boardIndex + 1) * 9),
			expectedCellCount: boardIndex === 6 ? 6 : 9,
			sourceExcerpt: boardIndex === 6
				? "【54-60s】现实阿乔；赛博街景；继续游戏；存档点亮"
				: `【${boardIndex * 9}-${Math.min(60, (boardIndex + 1) * 9)}s】章节原文`,
			referenceOptions: [{
				refId: "node:ajiao",
				role: "identity",
				entityKind: "character",
				entityName: "阿乔",
			}],
			status: boardIndex < 6 ? "success" : "missing",
			nodeId: boardIndex < 6 ? `node-${boardIndex}` : null,
			taskId: boardIndex < 6 ? `task-${boardIndex}` : null,
		})),
		nextBoardIndex: 6,
	};
	const testEnv = () => ({
		DB: {
			agent_capability_attachments: { findMany: vi.fn().mockResolvedValue([]) },
			agent_capability_preferences: { findMany: vi.fn().mockResolvedValue([]) },
			agent_builtin_capability_settings: { findMany: vi.fn().mockResolvedValue([]) },
		},
	});

	async function buildRouter() {
		const { OpenAPIHono } = await import("@hono/zod-openapi");
		const { registerPublicAgentsToolBridgeRoutes } = await import("./agents-tool-bridge.routes");
		const { getProjectForOwner } = await import("../project/project.repo");
		const { getFlowForOwner } = await import("../flow/flow.repo");
		const billingScope = await import("./agents-tool-bridge.billing-scope");
		vi.mocked(getProjectForOwner).mockResolvedValue({ owner_id: ownerId } as never);
		vi.mocked(getFlowForOwner).mockResolvedValue(row as never);
		vi.spyOn(billingScope, "resolveProjectBillingTeamId").mockResolvedValue("personal");
		loadChapterCanvasAsFlowRow.mockResolvedValue(row);
		inspectStoryPreviewRunSnapshot.mockReturnValue(snapshot);
		const router = new OpenAPIHono<{
			Variables: { userId: string; devPublicBypass: boolean };
		}>();
		router.use("*", async (context, next) => {
			context.set("userId", ownerId);
			context.set("devPublicBypass", false);
			await next();
		});
		router.onError((error, context) => {
			if (error instanceof AppError) {
				return context.json(
					{ message: error.message, code: error.code, details: error.details },
					error.status as never,
				);
			}
			return context.json({
				message: error instanceof Error ? error.message : "Internal Server Error",
			}, 500);
		});
		registerPublicAgentsToolBridgeRoutes(router as never);
		return router;
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("projects the exact six-cell schema only for the current tail board", async () => {
		const router = await buildRouter();
		const response = await router.request("/agents/tools/execute", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				toolName: "tapcanvas_tool_schema_get",
				canvasProjectId: projectId,
				canvasFlowId: chapterId,
				chapterId,
				args: {
					name: "tapcanvas_story_preview_orchestrate",
					selector: { field: "mode", value: "put_board_6" },
				},
			}),
		}, testEnv());
		const body = await response.json() as {
			data?: {
				parameters?: {
					description?: string;
					properties?: {
						cells?: {
							minItems?: number;
							maxItems?: number;
							items?: {
								required?: string[];
								properties?: { subjectRefIds?: { items?: { enum?: string[] } } };
							};
						};
					};
				};
			};
		};

		expect(response.status, JSON.stringify(body)).toBe(200);
		expect(body.data?.parameters?.properties?.cells).toMatchObject({
			minItems: 6,
			maxItems: 6,
		});
		expect(body.data?.parameters?.properties?.cells?.items?.required).toContain("subjectRefIds");
		expect(
			body.data?.parameters?.properties?.cells?.items?.properties?.subjectRefIds?.items?.enum,
		).toEqual(["node:ajiao"]);
		expect(body.data?.parameters?.description).toContain("现实阿乔");
	});

	it("returns a recoverable same-frontier correction before any paid call", async () => {
		const router = await buildRouter();
		const response = await router.request("/agents/tools/execute", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				toolName: "tapcanvas_story_preview_orchestrate",
				canvasProjectId: projectId,
				canvasFlowId: chapterId,
				chapterId,
				args: { mode: "put_board_5", openingState: "stale", cells: [] },
			}),
		}, testEnv());
		const body = await response.json() as {
			data?: {
				ok?: boolean;
				code?: string;
				nextAction?: string;
				recovery?: { immutableArgs?: { mode?: string } };
			};
		};

		expect(response.status, JSON.stringify(body)).toBe(200);
		expect(body.data).toMatchObject({
			ok: false,
			code: "story_preview_operation_not_ready",
			nextAction: "put_board_6",
			recovery: { immutableArgs: { mode: "put_board_6" } },
		});
		expect(generateImageToCanvas).not.toHaveBeenCalled();
	});

	it("keeps the same board when structural contract validation rejects it", async () => {
		generateImageToCanvas.mockRejectedValueOnce(new AppError(
			"故事预览节点缺少完整的逐格结构数据",
			{
				status: 400,
				code: "invalid_story_preview_node_contract",
				details: { field: "storyPreviewCells" },
			},
		));
		const router = await buildRouter();
		const cell = {
			frame: "阿乔仍站在黑风山战场看向朝阳",
			mid: "阿乔扛着火铳向朝阳方向继续行走",
			end: "黑风山战场在暖金色晨光中恢复平静",
			camera: "中远景缓慢向后拉远",
			feedback: "脚步踩过碎石带起轻微尘土",
			environment: "暖金色晨光覆盖旧战场",
			subjectRefIds: ["node:ajiao"],
		};
		const response = await router.request("/agents/tools/execute", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				toolName: "tapcanvas_story_preview_orchestrate",
				canvasProjectId: projectId,
				canvasFlowId: chapterId,
				chapterId,
				args: {
					mode: "put_board_6",
					openingState: "黑风山战斗刚刚结束，错误地准备走向朝阳",
					cells: Array.from({ length: 6 }, () => cell),
				},
			}),
		}, testEnv());
		const body = await response.json() as {
			data?: { code?: string; nextAction?: string; issues?: unknown };
		};

		expect(response.status, JSON.stringify(body)).toBe(200);
		expect(body.data).toMatchObject({
			code: "invalid_story_preview_node_contract",
			nextAction: "put_board_6",
			issues: { field: "storyPreviewCells" },
		});
		expect(generateImageToCanvas).toHaveBeenCalledTimes(1);
	});
});

describe("resolveProjectBookDirectoryName", () => {
	it("resolves a physical book directory by logical bookId from index.json", async () => {
		const projectId = "project-book-lookup";
		const userId = "user-book-lookup";
		const dirName = "______-1774356427374";
		const logicalBookId = "real-book-id-1";
		const booksRoot = path.join(
			resolveProjectDataRepoRoot(),
			"project-data",
			"users",
			userId,
			"projects",
			projectId,
			"books",
		);
		const bookDir = path.join(booksRoot, dirName);
		await fs.mkdir(bookDir, { recursive: true });
		await fs.writeFile(
			path.join(bookDir, "index.json"),
			JSON.stringify({
				bookId: logicalBookId,
				projectId,
				title: "地煞七十二变",
				chapters: [],
			}),
			"utf8",
		);

		const resolved = await resolveProjectBookDirectoryName({
			projectId,
			userId,
			requestedBookId: logicalBookId,
		});

		expect(resolved).toBe(dirName);
	});
});

describe("registerPublicAgentsToolBridgeRoutes – book evidence search", () => {
	it("returns project-scoped quotes with exact source offsets and hashes", async () => {
		const ownerId = "book-evidence-owner";
		const projectId = "book-evidence-project";
		const bookId = "book-evidence-1";
		const bookDirectory = path.join(
			resolveProjectDataRepoRoot(),
			"project-data",
			"users",
			ownerId,
			"projects",
			projectId,
			"books",
			bookId,
		);
		const rawText = "第一章 雨夜\n林舟推开门。\n\n第二章 密室\n银钥匙藏在旧钟背后。";
		const chapterTwoStart = rawText.indexOf("第二章");
		const source: BookSourceMetadataV1 = {
			schemaVersion: "book-source/v1",
			originalFileName: "story.txt",
			format: "plain_text",
			mediaType: "text/plain",
			sourceByteLength: Buffer.byteLength(rawText, "utf8"),
			sourceSha256: sha256Hex(rawText),
			sourceTextSha256: sha256Hex(rawText),
			sourceEncoding: "utf-8",
			extractedDocumentCount: 1,
		};
		await fs.mkdir(bookDirectory, { recursive: true });
		await fs.writeFile(path.join(bookDirectory, "raw.md"), rawText, "utf8");
		await fs.writeFile(
			path.join(bookDirectory, "index.json"),
			JSON.stringify({
				bookId,
				projectId,
				title: "雨夜",
				chapters: [
					{ chapter: 1, title: "第一章 雨夜", startOffset: 0, endOffset: chapterTwoStart - 2 },
					{ chapter: 2, title: "第二章 密室", startOffset: chapterTwoStart, endOffset: rawText.length },
				],
			}),
			"utf8",
		);
		await writeBookEvidenceIndex({
			bookDirectory,
			index: buildBookEvidenceIndex({
				bookId,
				projectId,
				title: "雨夜",
				rawText,
				chapters: [
					{
						chapter: 1,
						title: "第一章 雨夜",
						startOffset: 0,
						endOffset: chapterTwoStart - 2,
					},
					{
						chapter: 2,
						title: "第二章 密室",
						startOffset: chapterTwoStart,
						endOffset: rawText.length,
					},
				],
				source,
			}),
		});

		try {
			const { OpenAPIHono } = await import("@hono/zod-openapi");
			const { registerPublicAgentsToolBridgeRoutes } = await import(
				"./agents-tool-bridge.routes"
			);
			const { getProjectForOwner } = await import("../project/project.repo");
			const billingScope = await import("./agents-tool-bridge.billing-scope");
			vi.mocked(getProjectForOwner).mockResolvedValue({ owner_id: ownerId } as never);
			vi.spyOn(billingScope, "resolveProjectBillingTeamId").mockResolvedValue("personal");
			const router = new OpenAPIHono<{
				Variables: { userId: string; devPublicBypass: boolean };
			}>();
			router.use("*", async (context, next) => {
				context.set("userId", ownerId);
				context.set("devPublicBypass", false);
				await next();
			});
			router.onError((error, context) => {
				if (error instanceof AppError) {
					return context.json(
						{ message: error.message, code: error.code, details: error.details },
						error.status as never,
					);
				}
				return context.json({ message: "Internal Server Error" }, 500);
			});
			registerPublicAgentsToolBridgeRoutes(router as never);

			const response = await router.request(
				"/agents/tools/execute",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						toolName: "tapcanvas_book_evidence_search",
						canvasProjectId: projectId,
						args: {
							bookId,
							query: "银钥匙",
							chapterStart: 2,
							chapterEnd: 2,
						},
					}),
				},
				{ DB: {} },
			);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as {
				projectId: string;
				results: Array<{
					quote: string;
					evidence: {
						quoteStartOffset: number;
						quoteEndOffset: number;
						quoteSha256: string;
					};
				}>;
			};

			expect(response.status, JSON.stringify(body)).toBe(200);
			expect(data.projectId).toBe(projectId);
			expect(data.results).toHaveLength(1);
			const hit = data.results[0];
			expect(hit.quote).toContain("银钥匙藏在旧钟背后");
			expect(
				rawText.slice(
					hit.evidence.quoteStartOffset,
					hit.evidence.quoteEndOffset,
				),
			).toBe(hit.quote);
			expect(hit.evidence.quoteSha256).toBe(sha256Hex(hit.quote));
		} finally {
			await fs.rm(bookDirectory, { recursive: true, force: true });
		}
	});
});

describe("registerPublicAgentsToolBridgeRoutes – image reference IDs", () => {
	const OWNER = "image-ref-owner";
	const PROJECT_ID = "image-ref-project";
	const FLOW_ID = "image-ref-flow";

	beforeEach(() => {
		vi.clearAllMocks();
	});

	async function buildImageReferenceRouter() {
		const { OpenAPIHono } = await import("@hono/zod-openapi");
		const { registerPublicAgentsToolBridgeRoutes } = await import("./agents-tool-bridge.routes");
		const { getProjectForOwner } = await import("../project/project.repo");
		const { listChaptersByProjectForOwner } = await import("../chapter/chapter.repo");
		const { getFlowForOwner } = await import("../flow/flow.repo");
		const billingScope = await import("./agents-tool-bridge.billing-scope");

		vi.mocked(getProjectForOwner).mockResolvedValue({ owner_id: OWNER } as never);
		vi.mocked(listChaptersByProjectForOwner).mockResolvedValue([]);
		vi.mocked(getFlowForOwner).mockResolvedValue({
			id: FLOW_ID,
			name: "Image refs",
			data: JSON.stringify({ nodes: [], edges: [] }),
			owner_id: OWNER,
			project_id: PROJECT_ID,
			created_at: "2026-07-30T00:00:00.000Z",
			updated_at: "2026-07-30T00:00:00.000Z",
		} as never);
		vi.spyOn(billingScope, "resolveProjectBillingTeamId").mockResolvedValue("personal");

		const router = new OpenAPIHono<{
			Variables: { userId: string; devPublicBypass: boolean };
		}>();
		router.use("*", async (c, next) => {
			c.set("userId", OWNER);
			c.set("devPublicBypass", false);
			await next();
		});
		router.onError((error, c) => {
			if (error instanceof AppError) {
				return c.json(
					{ message: error.message, code: error.code, details: error.details },
					error.status as never,
				);
			}
			return c.json({ message: "Internal Server Error" }, 500);
		});
		registerPublicAgentsToolBridgeRoutes(router as never);
		return router;
	}

	it("returns resolvable names and IDs without exposing the internal URL", async () => {
		const router = await buildImageReferenceRouter();
		resolveImageReferencesForInspection.mockResolvedValue([
			{
				referenceId: "node:node-style",
				source: "node",
				nodeId: "node-style",
				assetId: "asset-style",
				assetRefId: null,
				name: "项目全局画风",
				url: "https://file.beqlee.icu/style.png",
			},
		]);

		const response = await router.request(
			"/agents/tools/execute",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					toolName: "tapcanvas_image_refs_get",
					canvasProjectId: PROJECT_ID,
					canvasFlowId: FLOW_ID,
					args: { nodeIds: ["node-style"] },
				}),
			},
			{ DB: {} },
		);
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(200);
		expect(resolveImageReferencesForInspection).toHaveBeenCalledTimes(1);
		expect(resolveExecutionImageReferences).not.toHaveBeenCalled();
		expect(String(body.content || "")).not.toContain("https://");
		expect(JSON.parse(String(body.content || "{}"))).toEqual({
			references: [
				{
					referenceId: "node:node-style",
					source: "node",
					nodeId: "node-style",
					assetId: "asset-style",
					assetRefId: null,
					name: "项目全局画风",
					mediaType: "image",
					ready: true,
				},
			],
			count: 1,
		});
	});

	it("fails before lookup when the authorized flow scope is missing", async () => {
		const router = await buildImageReferenceRouter();
		const response = await router.request(
			"/agents/tools/execute",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					toolName: "tapcanvas_image_refs_get",
					canvasProjectId: PROJECT_ID,
					args: { nodeIds: ["node-style"] },
				}),
			},
			{ DB: {} },
		);
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(400);
		expect(body.code).toBe("flow_id_required");
		expect(resolveImageReferencesForInspection).not.toHaveBeenCalled();
		expect(resolveExecutionImageReferences).not.toHaveBeenCalled();
	});

	it("rejects a legacy URL-bearing referenceImages field before paid generation", async () => {
		const router = await buildImageReferenceRouter();
		const response = await router.request(
			"/agents/tools/execute",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					toolName: "tapcanvas_image_generate_to_canvas",
					canvasProjectId: PROJECT_ID,
					canvasFlowId: FLOW_ID,
					args: {
						node: {
							type: "taskNode",
							data: {
								kind: "imageEdit",
								prompt: "保持构图",
								referenceImages: ["https://file.beqlee.icu/style.png"],
							},
						},
					},
				}),
			},
			{ DB: {} },
		);
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(400);
		expect(body.code).toBe("agents_tool_legacy_image_reference_field_forbidden");
		expect(body.details).toMatchObject({
			forbiddenField: "args.node.data.referenceImages",
		});
	});

	it("rejects a raw image URL pasted into a generation prompt", async () => {
		const router = await buildImageReferenceRouter();
		const response = await router.request(
			"/agents/tools/execute",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					toolName: "tapcanvas_image_generate_to_canvas",
					canvasProjectId: PROJECT_ID,
					canvasFlowId: FLOW_ID,
					args: {
						node: {
							id: "image-prompt-url",
							type: "taskNode",
							data: {
								kind: "imageEdit",
								prompt: "复用 https://file.beqlee.icu/style.png 的画风",
								referenceImageNodeIds: ["node-style"],
							},
						},
					},
				}),
			},
			{ DB: {} },
		);
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(400);
		expect(body.code).toBe("agents_tool_raw_image_url_forbidden");
	});

	it("rejects legacy image reference fields even when they contain no URL", async () => {
		const router = await buildImageReferenceRouter();
		const response = await router.request(
			"/agents/tools/execute",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					toolName: "tapcanvas_video_generate_to_canvas",
					canvasProjectId: PROJECT_ID,
					canvasFlowId: FLOW_ID,
					args: {
						node: {
							id: "video-legacy-reference",
							type: "taskNode",
							data: {
								kind: "video",
								prompt: "保持既定画风",
								referenceImages: [],
							},
						},
					},
				}),
			},
			{ DB: {} },
		);
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(400);
		expect(body.code).toBe("agents_tool_legacy_image_reference_field_forbidden");
		expect(body.details).toMatchObject({
			forbiddenField: "args.node.data.referenceImages",
		});
	});
});

describe("registerPublicAgentsToolBridgeRoutes – execution scope", () => {
	const OWNER = "execution-owner";
	const PROJECT_ID = "execution-project";
	const FLOW_ID = "execution-flow";
	const EXECUTION_ID = "execution-1";

	beforeEach(() => {
		vi.clearAllMocks();
	});

	async function buildExecutionRouter(flowProjectId = PROJECT_ID) {
		const { OpenAPIHono } = await import("@hono/zod-openapi");
		const { registerPublicAgentsToolBridgeRoutes } = await import("./agents-tool-bridge.routes");
		const { getProjectForOwner } = await import("../project/project.repo");
		const { listChaptersByProjectForOwner } = await import("../chapter/chapter.repo");
		const { getFlowForOwner } = await import("../flow/flow.repo");
		const billingScope = await import("./agents-tool-bridge.billing-scope");

		vi.mocked(getProjectForOwner).mockResolvedValue({ owner_id: OWNER } as never);
		vi.mocked(listChaptersByProjectForOwner).mockResolvedValue([]);
		vi.mocked(getFlowForOwner).mockResolvedValue({
			id: FLOW_ID,
			name: "Execution scope",
			data: JSON.stringify({ nodes: [], edges: [] }),
			owner_id: OWNER,
			project_id: flowProjectId,
			created_at: "2026-08-04T00:00:00.000Z",
			updated_at: "2026-08-04T00:00:00.000Z",
		} as never);
		vi.spyOn(billingScope, "resolveProjectBillingTeamId").mockResolvedValue("personal");

		const router = new OpenAPIHono<{
			Variables: { userId: string; devPublicBypass: boolean };
		}>();
		router.use("*", async (c, next) => {
			c.set("userId", OWNER);
			c.set("devPublicBypass", false);
			await next();
		});
		router.onError((error, c) => {
			if (error instanceof AppError) {
				return c.json(
					{ message: error.message, code: error.code, details: error.details },
					error.status as never,
				);
			}
			return c.json({ message: "Internal Server Error" }, 500);
		});
		registerPublicAgentsToolBridgeRoutes(router as never);
		return router;
	}

	async function requestExecutionTool(
		router: Awaited<ReturnType<typeof buildExecutionRouter>>,
		toolName:
			| "tapcanvas_execution_get"
			| "tapcanvas_execution_node_runs_get"
			| "tapcanvas_execution_events_list"
			| "tapcanvas_workflow_execution_inspect",
		args: Record<string, unknown> = { executionId: EXECUTION_ID },
	) {
		return router.request(
			"/agents/tools/execute",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					toolName,
					canvasProjectId: PROJECT_ID,
					canvasFlowId: FLOW_ID,
					args,
				}),
			},
			{ DB: {} },
		);
	}

	it("rejects an execution event read that is not owned by the request user", async () => {
		const router = await buildExecutionRouter();
		const { getExecutionForOwner, listExecutionEvents } = await import(
			"../execution/execution.repo"
		);
		vi.mocked(getExecutionForOwner).mockResolvedValue(null);

		const response = await requestExecutionTool(
			router,
			"tapcanvas_execution_events_list",
		);
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(404);
		expect(body.code).toBe("execution_not_found");
		expect(getExecutionForOwner).toHaveBeenCalledWith({}, EXECUTION_ID, OWNER);
		expect(listExecutionEvents).not.toHaveBeenCalled();
	});

	it.each([
		"tapcanvas_execution_get",
		"tapcanvas_execution_node_runs_get",
		"tapcanvas_execution_events_list",
		"tapcanvas_workflow_execution_inspect",
	] as const)("rejects %s when the execution belongs to another flow", async (toolName) => {
		const router = await buildExecutionRouter();
		const executionRepo = await import("../execution/execution.repo");
		vi.mocked(executionRepo.getExecutionForOwner).mockResolvedValue({
			id: EXECUTION_ID,
			flow_id: "another-flow",
		} as never);

		const response = await requestExecutionTool(
			router,
			toolName,
			toolName === "tapcanvas_workflow_execution_inspect"
				? { executionId: EXECUTION_ID, view: "family" }
				: { executionId: EXECUTION_ID },
		);
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(404);
		expect(body.code).toBe("execution_not_found");
		expect(executionRepo.listExecutionEvents).not.toHaveBeenCalled();
		expect(executionRepo.listNodeRunsForExecutionOwner).not.toHaveBeenCalled();
	});

	it("rejects execution events when the envelope flow belongs to another project", async () => {
		const router = await buildExecutionRouter("another-project");
		const { getExecutionForOwner, listExecutionEvents } = await import(
			"../execution/execution.repo"
		);
		vi.mocked(getExecutionForOwner).mockResolvedValue({
			id: EXECUTION_ID,
			flow_id: FLOW_ID,
		} as never);

		const response = await requestExecutionTool(
			router,
			"tapcanvas_execution_events_list",
		);
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(404);
		expect(body.code).toBe("flow_not_found");
		expect(listExecutionEvents).not.toHaveBeenCalled();
	});

	it("returns a bounded execution-family page from the authorized flow", async () => {
		const router = await buildExecutionRouter();
		const executionRepo = await import("../execution/execution.repo");
		const familyStore = await import("../execution/execution.family-store");
		vi.mocked(executionRepo.getExecutionForOwner).mockResolvedValue({
			id: EXECUTION_ID,
			flow_id: FLOW_ID,
			canvas_id: FLOW_ID,
			project_id: PROJECT_ID,
			execution_family_id: "execution-family-1",
		} as never);
		vi.mocked(familyStore.getWorkflowExecutionFamilyPageForOwner).mockResolvedValue({
			executionFamilyId: "execution-family-1",
			rootExecutionId: "execution-family-1",
			latestExecutionId: EXECUTION_ID,
			latestExecutionStatus: "running",
			activeExecutionIds: [EXECUTION_ID],
			activeExecutionCount: 1,
			activeExecutionIdsTruncated: false,
			executionCount: 2,
			successfulExecutionCount: 0,
			nodeAttemptCount: 3,
			createdAt: "2026-08-20T00:00:00.000Z",
			updatedAt: "2026-08-20T00:01:00.000Z",
			executions: [],
			nextCursor: "execution-next",
		});

		const response = await requestExecutionTool(
			router,
			"tapcanvas_workflow_execution_inspect",
			{ executionId: EXECUTION_ID, view: "family", cursor: "execution-cursor", limit: 25 },
		);
		const body = (await response.json()) as { data?: Record<string, unknown> };

		expect(response.status).toBe(200);
		expect(body.data).toMatchObject({
			view: "family",
			family: {
				executionFamilyId: "execution-family-1",
				executionCount: 2,
				nodeAttemptCount: 3,
				nextCursor: "execution-next",
			},
		});
		expect(familyStore.getWorkflowExecutionFamilyPageForOwner).toHaveBeenCalledWith({}, {
			ownerId: OWNER,
			executionId: EXECUTION_ID,
			cursor: "execution-cursor",
			limit: 25,
		});
	});

	it("returns immutable node-attempt pages and rejects a cursor from another execution", async () => {
		const router = await buildExecutionRouter();
		const executionRepo = await import("../execution/execution.repo");
		const familyStore = await import("../execution/execution.family-store");
		vi.mocked(executionRepo.getExecutionForOwner).mockResolvedValue({
			id: EXECUTION_ID,
			flow_id: FLOW_ID,
			canvas_id: FLOW_ID,
			project_id: PROJECT_ID,
			execution_family_id: "execution-family-1",
		} as never);
		vi.mocked(familyStore.listWorkflowNodeAttemptsPageForExecutionOwner)
			.mockRejectedValueOnce(new Error("workflow_node_attempt_cursor_invalid"));

		const response = await requestExecutionTool(
			router,
			"tapcanvas_workflow_execution_inspect",
			{ executionId: EXECUTION_ID, view: "attempts", cursor: "foreign-attempt", limit: 10 },
		);
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(400);
		expect(body.code).toBe("workflow_node_attempt_cursor_invalid");
		expect(familyStore.listWorkflowNodeAttemptsPageForExecutionOwner).toHaveBeenCalledWith({}, {
			ownerId: OWNER,
			executionId: EXECUTION_ID,
			cursor: "foreign-attempt",
			limit: 10,
		});
	});

	it.each([
		{ toolName: "tapcanvas_flow_get", args: {} },
		{ toolName: "tapcanvas_flow_patch", args: { patchNodeData: [] } },
		{ toolName: "tapcanvas_image_generate_to_canvas", args: {} },
	] as const)("rejects cross-project flow envelope for $toolName", async ({ toolName, args }) => {
		const router = await buildExecutionRouter("another-project");
		const { applyPublicFlowGraphPatch } = await import("../flow/flow.public.service");
		const { generateImageToCanvas } = await import(
			"./agents-tool-bridge.generate-image-to-canvas"
		);
		const response = await router.request(
			"/agents/tools/execute",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					toolName,
					canvasProjectId: PROJECT_ID,
					canvasFlowId: FLOW_ID,
					args,
				}),
			},
			{ DB: {} },
		);
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(404);
		expect(body.code).toBe("flow_not_found");
		expect(applyPublicFlowGraphPatch).not.toHaveBeenCalled();
		expect(generateImageToCanvas).not.toHaveBeenCalled();
	});

	it("uses the resolved chapter canvas row id for execution listing", async () => {
		const router = await buildExecutionRouter();
		const { loadChapterCanvasAsFlowRow } = await import(
			"./agents-tool-bridge.chapter-canvas-write"
		);
		const { listExecutionsForOwnerFlow } = await import("../execution/execution.repo");
		vi.mocked(loadChapterCanvasAsFlowRow).mockResolvedValue({
			id: "chapter-canvas-row",
			name: "Chapter canvas",
			data: JSON.stringify({ nodes: [], edges: [] }),
			owner_id: OWNER,
			project_id: PROJECT_ID,
			created_at: "2026-08-04T00:00:00.000Z",
			updated_at: "2026-08-04T00:00:00.000Z",
		} as never);
		vi.mocked(listExecutionsForOwnerFlow).mockResolvedValue([]);

		const response = await router.request(
			"/agents/tools/execute",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					toolName: "tapcanvas_executions_list",
					canvasProjectId: PROJECT_ID,
					chapterId: "chapter-1",
					args: {},
				}),
			},
			{ DB: {} },
		);

		expect(response.status).toBe(200);
		expect(listExecutionsForOwnerFlow).toHaveBeenCalledWith(
			{},
			{
				ownerId: OWNER,
				flowId: "chapter-canvas-row",
				limit: 20,
			},
		);
	});

});

describe("selectStoryboardPlanReadResult", () => {
	it("selects the exact planId when one task has multiple retained plan versions", () => {
		const base = {
			taskId: "task-shared",
			chapter: 5,
			mode: "single" as const,
			groupSize: 25 as const,
			...STORYBOARD_PLAN_REQUIRED_FIELDS,
			shotPrompts: ["镜头"],
			createdBy: "user-1",
			updatedBy: "user-1",
		};
		const { matchedPlan, chapterPlans } = selectStoryboardPlanReadResult({
			plans: [
				{
					...base,
					planId: "plan-run-1",
					createdAt: "2026-04-04T09:00:00.000Z",
					updatedAt: "2026-04-04T09:05:00.000Z",
				},
				{
					...base,
					planId: "plan-run-2",
					createdAt: "2026-04-04T10:00:00.000Z",
					updatedAt: "2026-04-04T10:05:00.000Z",
				},
			],
			chapter: 5,
			planId: "plan-run-1",
		});

		expect(chapterPlans.map((plan) => plan.planId)).toEqual(["plan-run-2", "plan-run-1"]);
		expect(matchedPlan?.planId).toBe("plan-run-1");
	});

	it("prefers the newest plan within the requested chapter when no ids are provided", () => {
		const { matchedPlan, chapterPlans } = selectStoryboardPlanReadResult({
			plans: [
				{
					planId: "plan-older",
					taskId: "task-older",
					chapter: 5,
					mode: "full",
					groupSize: 9,
					...STORYBOARD_PLAN_REQUIRED_FIELDS,
					shotPrompts: ["镜头一"],
					createdAt: "2026-04-04T09:00:00.000Z",
					updatedAt: "2026-04-04T09:05:00.000Z",
					createdBy: "user-1",
					updatedBy: "user-1",
				},
				{
					planId: "plan-newer",
					taskId: "task-newer",
					chapter: 5,
					mode: "full",
					groupSize: 9,
					...STORYBOARD_PLAN_REQUIRED_FIELDS,
					shotPrompts: ["镜头二"],
					createdAt: "2026-04-04T09:10:00.000Z",
					updatedAt: "2026-04-04T09:15:00.000Z",
					createdBy: "user-1",
					updatedBy: "user-1",
				},
				{
					planId: "plan-other-chapter",
					taskId: "task-other",
					chapter: 6,
					mode: "full",
					groupSize: 9,
					...STORYBOARD_PLAN_REQUIRED_FIELDS,
					shotPrompts: ["镜头三"],
					createdAt: "2026-04-04T10:00:00.000Z",
					updatedAt: "2026-04-04T10:05:00.000Z",
					createdBy: "user-1",
					updatedBy: "user-1",
				},
			],
			chapter: 5,
		});

		expect(chapterPlans.map((plan) => plan.planId)).toEqual(["plan-newer", "plan-older"]);
		expect(matchedPlan?.planId).toBe("plan-newer");
	});

	it("uses taskId inside the requested chapter without crossing into other chapters", () => {
		const { matchedPlan, chapterPlans } = selectStoryboardPlanReadResult({
			plans: [
				{
					planId: "plan-ch5",
					taskId: "task-shared",
					chapter: 5,
					mode: "full",
					groupSize: 9,
					...STORYBOARD_PLAN_REQUIRED_FIELDS,
					shotPrompts: ["镜头一"],
					createdAt: "2026-04-04T09:00:00.000Z",
					updatedAt: "2026-04-04T09:05:00.000Z",
					createdBy: "user-1",
					updatedBy: "user-1",
				},
				{
					planId: "plan-ch6",
					taskId: "task-shared",
					chapter: 6,
					mode: "full",
					groupSize: 9,
					...STORYBOARD_PLAN_REQUIRED_FIELDS,
					shotPrompts: ["镜头二"],
					createdAt: "2026-04-04T10:00:00.000Z",
					updatedAt: "2026-04-04T10:05:00.000Z",
					createdBy: "user-1",
					updatedBy: "user-1",
				},
			],
			chapter: 5,
			taskId: "task-shared",
		});

		expect(chapterPlans).toHaveLength(1);
		expect(matchedPlan?.planId).toBe("plan-ch5");
	});
});

describe("registerPublicAgentsToolBridgeRoutes – CANVAS_PATCH_TOOLS echo", () => {
	it("add_node returns op echo with nodeId", async () => {
		const { OpenAPIHono } = await import("@hono/zod-openapi");
		const { registerPublicAgentsToolBridgeRoutes } = await import("./agents-tool-bridge.routes");

		const router = new OpenAPIHono<{ Variables: { userId: string; devPublicBypass: boolean } }>();
		// Inject userId so requireUserId() does not throw
		router.use("*", async (c, next) => {
			c.set("userId" as any, "test-user-1");
			await next();
		});
		registerPublicAgentsToolBridgeRoutes(router as any);

		const res = await router.request("/agents/tools/execute", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				toolName: "add_node",
				args: { id: "node-abc" },
			}),
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		const parsed = JSON.parse(body.content);
		expect(parsed.status).toBe("queued");
		expect(parsed.nodeId).toBe("node-abc");
	});

	it("connect_edge returns op echo with source and target", async () => {
		const { OpenAPIHono } = await import("@hono/zod-openapi");
		const { registerPublicAgentsToolBridgeRoutes } = await import("./agents-tool-bridge.routes");

		const router = new OpenAPIHono<{ Variables: { userId: string; devPublicBypass: boolean } }>();
		router.use("*", async (c, next) => {
			c.set("userId" as any, "test-user-2");
			await next();
		});
		registerPublicAgentsToolBridgeRoutes(router as any);

		const res = await router.request("/agents/tools/execute", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				toolName: "connect_edge",
				args: { source: "node-a", target: "node-b" },
			}),
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		const parsed = JSON.parse(body.content);
		expect(parsed.status).toBe("queued");
		expect(parsed.tool).toBe("connect_edge");
		expect(parsed.source).toBe("node-a");
		expect(parsed.target).toBe("node-b");
	});
});

describe("registerPublicAgentsToolBridgeRoutes – caller-bound critic model", () => {
	const criticClips = [
		{
			clipIndex: 0,
			logline: "甲扑空，乙夺得奇物",
			continuity: "同一时间线连续",
			durationSeconds: 5,
			shots: [
				{
					action: "甲向奇物扑去却抓空，乙从侧面探手将奇物收入掌中",
					durationSeconds: 5,
				},
			],
		},
	];
	const generationContract = {
		videoModel: "doubao-seedance-2-0-260128",
		durationOptions: [5, 10, 15],
		maxDurationSeconds: 15,
		referenceImagePolicy: {
			countUnit: "unique_url",
			maximumTotalImages: 9,
			maximumBusinessImages: 9,
		},
		referenceAudioPolicy: {
			minimumDurationSeconds: 1.8,
			maximumDurationSeconds: 30.2,
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		{
			label: "another owner",
			run: {
				owner_id: "other-user",
				project_id: "critic-project",
				flow_id: "critic-flow",
				chapter_id: "critic-chapter",
			},
		},
		{
			label: "another project",
			run: {
				owner_id: "critic-user",
				project_id: "other-project",
				flow_id: "critic-flow",
				chapter_id: "critic-chapter",
			},
		},
		{
			label: "another flow",
			run: {
				owner_id: "critic-user",
				project_id: "critic-project",
				flow_id: "other-flow",
				chapter_id: "critic-chapter",
			},
		},
		{
			label: "another chapter",
			run: {
				owner_id: "critic-user",
				project_id: "critic-project",
				flow_id: "critic-flow",
				chapter_id: "other-chapter",
			},
		},
	] as const)("hides a runId that belongs to $label", async ({ run }) => {
		const { OpenAPIHono } = await import("@hono/zod-openapi");
		const { registerPublicAgentsToolBridgeRoutes } = await import("./agents-tool-bridge.routes");
		const { critiqueShotTable } = await import("./shot-table-critic");
		getVideoRun.mockResolvedValue({ id: "foreign-run", ...run } as never);

		const router = new OpenAPIHono<{
			Variables: { userId: string; devPublicBypass: boolean };
		}>();
		router.use("*", async (c, next) => {
			c.set("userId", "critic-user");
			c.set("devPublicBypass", false);
			await next();
		});
		router.onError((error, c) => {
			if (error instanceof AppError) {
				return c.json({ message: error.message, code: error.code }, error.status as never);
			}
			return c.json({ message: "Internal Server Error" }, 500);
		});
		registerPublicAgentsToolBridgeRoutes(router as never);

		const response = await router.request("/agents/tools/execute", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				toolName: "tapcanvas_shot_table_critic",
				canvasProjectId: "critic-project",
				canvasFlowId: "critic-flow",
				chapterId: "critic-chapter",
				args: { reviewMode: "video_clips", runId: "foreign-run" },
				parentAgentExecution: { model: "gpt-5.6-sol", apiStyle: "responses" },
			}),
		});

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ code: "video_run_not_found" });
		expect(critiqueShotTable).not.toHaveBeenCalled();
	});

	it("uses parentAgentExecution.model and exposes no model choice in args", async () => {
		const { OpenAPIHono } = await import("@hono/zod-openapi");
		const { registerPublicAgentsToolBridgeRoutes } = await import("./agents-tool-bridge.routes");
		const { critiqueShotTable } = await import("./shot-table-critic");
		vi.mocked(critiqueShotTable).mockResolvedValue({
			mergedDims: {},
			overallScore: 88,
			pass: true,
			topFixes: [],
		} as never);

		const router = new OpenAPIHono<{ Variables: { userId: string; devPublicBypass: boolean } }>();
		router.use("*", async (c, next) => {
			c.set("userId", "critic-user");
			c.set("devPublicBypass", false);
			await next();
		});
		registerPublicAgentsToolBridgeRoutes(router as never);

		const res = await router.request("/agents/tools/execute", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				toolName: "tapcanvas_shot_table_critic",
				args: {
					reviewMode: "video_clips",
					clips: criticClips,
					generationContract,
					brief: "战术争夺",
				},
				parentAgentExecution: { model: "gpt-5.6-sol", apiStyle: "responses" },
			}),
		});

		expect(res.status).toBe(200);
		expect(critiqueShotTable).toHaveBeenCalledTimes(1);
		expect(vi.mocked(critiqueShotTable).mock.calls[0]?.[1]).toMatchObject({
			criticModel: "gpt-5.6-sol",
			criticApiStyle: "responses",
			clips: criticClips,
			generationContract,
		});
		const payload = await res.json();
		expect(payload).toMatchObject({
			ok: true,
			data: {
				overallScore: 88,
				pass: true,
			},
		});
		expect(payload.data).not.toHaveProperty("shotApprovalToken");
		expect(payload.data).not.toHaveProperty("approvedShape");
		expect(payload.data).not.toHaveProperty("approved");
	});

	it("fails before critic execution when runtime identity is missing or args tries to override it", async () => {
		const { OpenAPIHono } = await import("@hono/zod-openapi");
		const { honoErrorHandler } = await import("../../middleware/error");
		const { registerPublicAgentsToolBridgeRoutes } = await import("./agents-tool-bridge.routes");
		const { critiqueShotTable } = await import("./shot-table-critic");
		vi.mocked(critiqueShotTable).mockClear();

		const router = new OpenAPIHono<{ Variables: { userId: string; devPublicBypass: boolean } }>();
		router.onError(honoErrorHandler as never);
		router.use("*", async (c, next) => {
			c.set("userId", "critic-user");
			c.set("devPublicBypass", false);
			await next();
		});
		registerPublicAgentsToolBridgeRoutes(router as never);

		const missingRuntimeResponse = await router.request("/agents/tools/execute", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				toolName: "tapcanvas_shot_table_critic",
				args: { reviewMode: "video_clips", clips: criticClips, generationContract },
			}),
		});
		expect(missingRuntimeResponse.status).toBe(400);
		expect(await missingRuntimeResponse.json()).toMatchObject({
			code: "parent_agent_execution_required",
		});

		const modelOverrideResponse = await router.request("/agents/tools/execute", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				toolName: "tapcanvas_shot_table_critic",
				args: {
					reviewMode: "video_clips",
					clips: criticClips,
					generationContract,
					criticModel: "doubao-seedance-2-0-260128",
				},
				parentAgentExecution: { model: "gpt-5.6-sol", apiStyle: "responses" },
			}),
		});
		expect(modelOverrideResponse.status).toBe(400);
		expect(await modelOverrideResponse.json()).toMatchObject({
			code: "execution_model_argument_forbidden",
		});

		expect(critiqueShotTable).not.toHaveBeenCalled();
	});

	it("reviews a final text storyboard without requiring video clips or a generation contract", async () => {
		const { OpenAPIHono } = await import("@hono/zod-openapi");
		const { registerPublicAgentsToolBridgeRoutes } = await import("./agents-tool-bridge.routes");
		const { critiqueTextStoryboard } = await import("./shot-table-critic");
		vi.mocked(critiqueTextStoryboard).mockResolvedValue({
			mergedDims: {},
			overallScore: 91,
			pass: false,
			issues: ["镜头反应不足"],
			topFixes: ["补足听者的呼吸与手部反应"],
			affectedClipIndexes: [0],
			perModel: [],
		} as never);

		const router = new OpenAPIHono<{ Variables: { userId: string; devPublicBypass: boolean } }>();
		router.use("*", async (c, next) => {
			c.set("userId", "critic-user");
			c.set("devPublicBypass", false);
			await next();
		});
		registerPublicAgentsToolBridgeRoutes(router as never);

		const res = await router.request("/agents/tools/execute", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				toolName: "tapcanvas_shot_table_critic",
				args: {
					reviewMode: "text_storyboard",
					shotTable: "【镜头总览】\n总镜数：1\n=========单镜头开始=========\n镜号：M001\n---镜头内时序细分\n时间段：0-2s\n=========单镜头结束=========",
					sourceMaterial: "门内传来脚步声。",
					brief: "自然主义快切",
				},
				parentAgentExecution: { model: "gpt-5.6-sol", apiStyle: "responses" },
			}),
		});

		expect(res.status).toBe(200);
		expect(critiqueTextStoryboard).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				shotTable: expect.stringContaining("镜号：M001"),
				sourceMaterial: "门内传来脚步声。",
				criticModel: "gpt-5.6-sol",
				criticApiStyle: "responses",
			}),
		);
		const payload = await res.json();
		expect(payload).toMatchObject({
			ok: true,
			data: {
				reviewMode: "text_storyboard",
				reviewedSource: "caller_final_text_storyboard",
			},
		});
	});

	it("marks malformed text storyboard arguments as repairable without hiding the validation failure", async () => {
		const { OpenAPIHono } = await import("@hono/zod-openapi");
		const { honoErrorHandler } = await import("../../middleware/error");
		const { registerPublicAgentsToolBridgeRoutes } = await import("./agents-tool-bridge.routes");
		const { critiqueTextStoryboard } = await import("./shot-table-critic");
		vi.mocked(critiqueTextStoryboard).mockClear();

		const router = new OpenAPIHono<{ Variables: { userId: string; devPublicBypass: boolean } }>();
		router.onError(honoErrorHandler as never);
		router.use("*", async (c, next) => {
			c.set("userId", "critic-user");
			c.set("devPublicBypass", false);
			await next();
		});
		registerPublicAgentsToolBridgeRoutes(router as never);

		const response = await router.request("/agents/tools/execute", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				toolName: "tapcanvas_shot_table_critic",
				args: {
					reviewMode: "text_storyboard",
					shotTable: { overview: { 总镜数: "13" }, shots: [] },
				},
				parentAgentExecution: { model: "deepseek-v4-flash", apiStyle: "chat" },
			}),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			code: "shot_critic_text_storyboard_required",
			terminal: false,
			details: {
				issues: [{
					code: "invalid_type",
					path: ["shotTable"],
					expected: "non-empty string",
					received: "object",
				}],
			},
		});
		expect(critiqueTextStoryboard).not.toHaveBeenCalled();
	});
});

describe("registerPublicAgentsToolBridgeRoutes – owner-scope material reads", () => {
	const OWNER = "owner-scope-user";
	const PROJECT_ID = "project-scope-1";

	beforeEach(() => {
		vi.clearAllMocks();
	});

	async function buildRouter() {
		const { OpenAPIHono } = await import("@hono/zod-openapi");
		const { registerPublicAgentsToolBridgeRoutes } = await import("./agents-tool-bridge.routes");
		const { getProjectForOwner } = await import("../project/project.repo");
		const { listChaptersByProjectForOwner } = await import("../chapter/chapter.repo");
		const { getFlowForOwner } = await import("../flow/flow.repo");
		const { loadChapterCanvasAsFlowRow } = await import("./agents-tool-bridge.chapter-canvas-write");
		const materialService = await import("../material/material.service");
		const billingScope = await import("./agents-tool-bridge.billing-scope");

		vi.mocked(getProjectForOwner).mockResolvedValue({ owner_id: OWNER } as never);
		vi.mocked(listChaptersByProjectForOwner).mockResolvedValue([]);
		vi.mocked(getFlowForOwner).mockResolvedValue({
			id: "material-flow",
			name: "Material flow",
			data: JSON.stringify({ nodes: [], edges: [] }),
			owner_id: OWNER,
			project_id: PROJECT_ID,
			created_at: "2026-07-30T00:00:00.000Z",
			updated_at: "2026-07-30T00:00:00.000Z",
		} as never);
		vi.mocked(loadChapterCanvasAsFlowRow).mockResolvedValue({
			id: "material-chapter-flow",
			name: "Material chapter flow",
			data: JSON.stringify({ nodes: [], edges: [] }),
			owner_id: OWNER,
			project_id: PROJECT_ID,
			created_at: "2026-07-30T00:00:00.000Z",
			updated_at: "2026-07-30T00:00:00.000Z",
		} as never);
		const listMaterialAssetsForOwner = vi.fn().mockResolvedValue([] as never);
		vi.spyOn(materialService, "listMaterialAssetsForOwner")
			.mockImplementation(listMaterialAssetsForOwner as never);
		vi.spyOn(materialService, "listProjectNodeAssetsForOwner")
			.mockImplementation(listMaterialAssetsForOwner as never);
		vi.spyOn(billingScope, "resolveProjectBillingTeamId").mockResolvedValue("personal");

		const router = new OpenAPIHono<{ Variables: { userId: string; devPublicBypass: boolean } }>();
		router.use("*", async (c, next) => {
			c.set("userId" as any, OWNER);
			await next();
		});
		router.onError((error, c) => {
			if (error instanceof AppError) {
				return c.json(
					{ message: error.message, code: error.code, details: error.details },
					error.status as never,
				);
			}
			return c.json({ message: "Internal Server Error" }, 500);
		});
		registerPublicAgentsToolBridgeRoutes(router as any);
		return { router, listMaterialAssetsForOwner, listChaptersByProjectForOwner };
	}

	async function execute(
		router: any,
		toolName: string,
		args: Record<string, unknown>,
		chapterId?: string,
		flowId?: string,
	) {
		const res = await router.request(
			"/agents/tools/execute",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					toolName,
					canvasProjectId: PROJECT_ID,
					...(flowId ? { canvasFlowId: flowId } : {}),
					...(chapterId ? { chapterId } : {}),
					args,
				}),
			},
			// Provide env bindings (c.env.DB) — getProjectForOwner / billing are mocked/spied,
			// so a stub DB is enough to get past the env access.
			{ DB: {} },
		);
		const body = await res.json();
		return { res, body, parsed: body.ok ? JSON.parse(body.content) : null };
	}

	it("material_assets_list default scope locks the current projectId", async () => {
		const { router, listMaterialAssetsForOwner } = await buildRouter();
		listMaterialAssetsForOwner.mockResolvedValue([] as never);

		const { res, parsed } = await execute(router, "tapcanvas_material_assets_list", {});

		expect(res.status).toBe(200);
		expect(parsed.scope).toBe("project");
		// Project-node reads are always scoped to the authenticated project.
		expect(listMaterialAssetsForOwner).toHaveBeenCalledWith(
			expect.anything(),
			OWNER,
			expect.objectContaining({ projectId: PROJECT_ID }),
		);
	});

	it("material_assets_list paginates large project libraries and omits redundant fields", async () => {
		const { router, listMaterialAssetsForOwner } = await buildRouter();
		listMaterialAssetsForOwner.mockResolvedValue(
			Array.from({ length: 45 }, (_, index) => ({
				id: `asset-${index}`,
				projectId: PROJECT_ID,
				kind: "character",
				name: `角色${index}`,
				currentVersion: 1,
				updatedAt: "2026-07-29T00:00:00.000Z",
				latestVersion: {
					data: {
						imageUrl: `https://file.beqlee.icu/${index}.png`,
						sourceChapterId: "book-x-ch1",
					},
				},
			})) as never,
		);

		const first = await execute(router, "tapcanvas_material_assets_list", { kind: "character" });
		expect(first.res.status).toBe(200);
		expect(first.parsed.count).toBe(40);
		expect(first.parsed.totalCount).toBe(45);
		expect(first.parsed.hasMore).toBe(true);
		expect(first.parsed.nextOffset).toBe(40);
		expect(first.parsed.items[0]).not.toHaveProperty("projectId");
		expect(first.parsed.items[0]).toHaveProperty("updatedAt", "2026-07-29T00:00:00.000Z");

		const second = await execute(router, "tapcanvas_material_assets_list", {
			kind: "character",
			offset: first.parsed.nextOffset,
		});
		expect(second.parsed.count).toBe(5);
		expect(second.parsed.hasMore).toBe(false);
		expect(second.parsed.nextOffset).toBeNull();
	});

	it("material_assets_list hides visual draft nodes unless metadata inspection is explicit", async () => {
		const { router, listMaterialAssetsForOwner } = await buildRouter();
		listMaterialAssetsForOwner.mockResolvedValue([
			{
				id: "ready-character",
				projectId: PROJECT_ID,
				kind: "character",
				name: "真实角色图",
				latestVersion: { data: { imageUrl: "https://file.beqlee.icu/ready.png" } },
			},
			{
				id: "draft-character",
				projectId: PROJECT_ID,
				kind: "character",
				name: "只有文字设定",
				latestVersion: { data: { roleName: "只有文字设定" } },
			},
		] as never);

		const readyOnly = await execute(router, "tapcanvas_material_assets_list", { kind: "character" });
		expect(readyOnly.res.status).toBe(200);
		expect(readyOnly.parsed.items.map((item: { id: string }) => item.id)).toEqual(["ready-character"]);
		expect(readyOnly.parsed.items[0].referenceAssetIds).toEqual(["ready-character"]);

		const withDrafts = await execute(router, "tapcanvas_material_assets_list", {
			kind: "character",
			includeDrafts: true,
		});
		expect(withDrafts.res.status).toBe(200);
		expect(withDrafts.parsed.items.map((item: { id: string }) => item.id)).toEqual([
			"ready-character",
			"draft-character",
		]);
		expect(withDrafts.parsed.items[1].referenceAssetIds).toEqual([]);
	});

	// 【项目隔离硬规则·用户定】scope=owner/all 跨项目逃生门已封：参数被忽略，始终 project 级。
	// 杜绝别项目的角色/场景卡（含不同画风）被本项目按名捞进来导致画风不统一。
	it("material_assets_list ignores scope=owner — stays project-locked (cross-project escape 封)", async () => {
		const { router, listMaterialAssetsForOwner } = await buildRouter();
		listMaterialAssetsForOwner.mockResolvedValue([] as never);

		const { res, parsed } = await execute(router, "tapcanvas_material_assets_list", {
			scope: "owner",
		});

		expect(res.status).toBe(200);
		expect(parsed.scope).toBe("project");
		const callArgs = listMaterialAssetsForOwner.mock.calls[0]?.[2] as Record<string, unknown>;
		expect(callArgs).toHaveProperty("projectId", PROJECT_ID);
	});

	it("material_assets_list ignores scope=all — stays project-locked", async () => {
		const { router, listMaterialAssetsForOwner } = await buildRouter();
		listMaterialAssetsForOwner.mockResolvedValue([] as never);

		const { res, parsed } = await execute(router, "tapcanvas_material_assets_list", {
			scope: "all",
		});

		expect(res.status).toBe(200);
		expect(parsed.scope).toBe("project");
		const callArgs = listMaterialAssetsForOwner.mock.calls[0]?.[2] as Record<string, unknown>;
		expect(callArgs).toHaveProperty("projectId", PROJECT_ID);
	});

	it("material_asset_delete verifies current-project ownership and exact name", async () => {
		const { router, listMaterialAssetsForOwner } = await buildRouter();
		const materialService = await import("../material/material.service");
		listMaterialAssetsForOwner.mockResolvedValue([
			{ id: "asset-wrong-state", name: "混元金斗清光" },
		] as never);
		const remove = vi
			.spyOn(materialService, "deleteMaterialAssetForOwner")
			.mockResolvedValue(undefined);

		const { res, parsed } = await execute(
			router,
			"tapcanvas_material_asset_delete",
			{ assetId: "asset-wrong-state", expectedName: "混元金斗清光" },
		);

		expect(res.status).toBe(200);
		expect(parsed).toEqual({
			deleted: true,
			assetId: "asset-wrong-state",
			name: "混元金斗清光",
			projectId: PROJECT_ID,
		});
		expect(remove).toHaveBeenCalledWith(
			expect.anything(),
			OWNER,
			"asset-wrong-state",
		);
	});

	it("material_asset_version_create appends a verified canonical base version", async () => {
		const { router, listMaterialAssetsForOwner } = await buildRouter();
		const materialService = await import("../material/material.service");
		listMaterialAssetsForOwner.mockResolvedValue([
			{ id: "asset-canonical-prop", name: "混元金斗" },
		] as never);
		const createVersion = vi
			.spyOn(materialService, "createMaterialVersionForOwner")
			.mockResolvedValue({ id: "version-5", version: 5 } as never);

		const imageUrl = "https://file.test/hunyuan-jindou-current.png";
		resolveExecutionImageReferences.mockResolvedValue([
			{
				referenceId: "node:canvas-prop-node",
				source: "node",
				nodeId: "canvas-prop-node",
				assetId: "asset-source-image",
				assetRefId: null,
				name: "混元金斗当前基态",
				url: imageUrl,
			},
		]);
		const { res, body, parsed } = await execute(
			router,
			"tapcanvas_material_asset_version_create",
			{
				assetId: "asset-canonical-prop",
				expectedName: "混元金斗",
				sourceNodeId: "canvas-prop-node",
			},
			"book-x-ch30",
			"material-flow",
		);

		expect(res.status).toBe(200);
		expect(parsed).toEqual({
			created: true,
			assetId: "asset-canonical-prop",
			name: "混元金斗",
			versionId: "version-5",
			version: 5,
			sourceReference: {
				referenceId: "node:canvas-prop-node",
				source: "node",
				nodeId: "canvas-prop-node",
				assetId: "asset-source-image",
				assetRefId: null,
				name: "混元金斗当前基态",
				mediaType: "image",
				ready: true,
			},
			materialIdentity: { mode: "base", canonicalName: "混元金斗" },
			projectId: PROJECT_ID,
		});
		expect(String(body.content || "")).not.toContain(imageUrl);
		expect(createVersion).toHaveBeenCalledWith(
			expect.anything(),
			OWNER,
			"asset-canonical-prop",
			{
				data: {
					imageUrl,
					materialIdentity: { mode: "base", canonicalName: "混元金斗" },
					sourceNodeId: "canvas-prop-node",
					sourceChapterId: "book-x-ch30",
				},
				note: "显式登记当前 canonical 基态",
			},
		);
	});

	it("get_style_reference returns one authoritative project-style snapshot", async () => {
		const { router } = await buildRouter();
		const materialService = await import("../material/material.service");
		const styleLock = {
			stylePrompt: "低饱和水墨动画",
		};
		const cinematicCamera = {
			aspectRatio: "16:9",
		};
		vi.spyOn(materialService, "getProjectStyleImagesForOwner").mockResolvedValue([
			"https://file.beqlee.icu/project-style.png",
		]);
		vi.spyOn(materialService, "getProjectStyleLockForOwner").mockResolvedValue(
			styleLock as never,
		);
		vi.spyOn(materialService, "getProjectCinematicCameraForOwner").mockResolvedValue(
			cinematicCamera as never,
		);

		const { res, parsed } = await execute(router, "tapcanvas_get_style_reference", {});

		expect(res.status).toBe(200);
		expect(parsed).toEqual({
			hasStyleReference: true,
			count: 1,
			styleLock,
			cinematicCamera,
			executionPolicy: "server_auto_inject",
		});
	});

	it("get_style_reference propagates style-lock read failures", async () => {
		const { router } = await buildRouter();
		const materialService = await import("../material/material.service");
		vi.spyOn(materialService, "getProjectStyleImagesForOwner").mockResolvedValue([]);
		vi.spyOn(materialService, "getProjectStyleLockForOwner").mockRejectedValue(
			new AppError("项目画风锁读取失败", {
				status: 503,
				code: "project_style_lock_read_failed",
			}),
		);
		vi.spyOn(materialService, "getProjectCinematicCameraForOwner").mockResolvedValue(null);

		const { res, body } = await execute(router, "tapcanvas_get_style_reference", {});

		expect(res.status).toBe(503);
		expect(body).toMatchObject({
			message: "项目画风锁读取失败",
			code: "project_style_lock_read_failed",
		});
	});

	it("get_style_reference propagates cinematic-camera read failures", async () => {
		const { router } = await buildRouter();
		const materialService = await import("../material/material.service");
		vi.spyOn(materialService, "getProjectStyleImagesForOwner").mockResolvedValue([]);
		vi.spyOn(materialService, "getProjectStyleLockForOwner").mockResolvedValue(null);
		vi.spyOn(materialService, "getProjectCinematicCameraForOwner").mockRejectedValue(
			new AppError("项目摄像机规格读取失败", {
				status: 503,
				code: "project_cinematic_camera_read_failed",
			}),
		);

		const { res, body } = await execute(router, "tapcanvas_get_style_reference", {});

		expect(res.status).toBe(503);
		expect(body).toMatchObject({
			message: "项目摄像机规格读取失败",
			code: "project_cinematic_camera_read_failed",
		});
	});

	it("set_style_reference is an idempotent no-op in chapter scope when project style is already locked", async () => {
		const { router } = await buildRouter();
		const materialService = await import("../material/material.service");
		const styleUrl = "https://file.beqlee.icu/project-style.png";
		resolveExecutionImageReferences.mockResolvedValue([
			{
				referenceId: "node:style-node",
				source: "node",
				nodeId: "style-node",
				assetId: "asset-style",
				assetRefId: null,
				name: "项目全局画风",
				url: styleUrl,
			},
		]);
		vi.spyOn(materialService, "getProjectStyleImagesForOwner").mockResolvedValue([styleUrl]);
		const write = vi
			.spyOn(materialService, "setProjectStyleImagesForOwner")
			.mockResolvedValue([styleUrl]);

		const { res, body, parsed } = await execute(
			router,
			"tapcanvas_set_style_reference",
			{ nodeIds: ["style-node"] },
			"book-x-ch28",
			"material-flow",
		);

		expect(res.status).toBe(200);
		expect(parsed.writeMode).toBe("idempotent_reuse");
		expect(parsed.references).toEqual([
			{
				referenceId: "node:style-node",
				source: "node",
				nodeId: "style-node",
				assetId: "asset-style",
				assetRefId: null,
				name: "项目全局画风",
				mediaType: "image",
				ready: true,
			},
		]);
		expect(String(body.content || "")).not.toContain(styleUrl);
		expect(write).not.toHaveBeenCalled();
	});

	it("storyboard_anchor_candidates default scope locks projectId on every kind read", async () => {
		const { router, listMaterialAssetsForOwner } = await buildRouter();
		listMaterialAssetsForOwner.mockResolvedValue([] as never);

		const { res, parsed } = await execute(router, "tapcanvas_storyboard_anchor_candidates", {});

		expect(res.status).toBe(200);
		expect(parsed.scope).toBe("project");
		expect(parsed.projectHasAnchorAssets).toBe(false);
		// The complete project node projection is scanned once, then split by kind in memory.
		expect(listMaterialAssetsForOwner).toHaveBeenCalledTimes(1);
		for (const call of listMaterialAssetsForOwner.mock.calls) {
			expect(call[2]).toMatchObject({ projectId: PROJECT_ID });
		}
	});

	it("storyboard_anchor_candidates ignores scope=owner — project-locked, orphaned cross-project anchors NOT surfaced", async () => {
		const { router, listMaterialAssetsForOwner } = await buildRouter();
		listMaterialAssetsForOwner.mockImplementation(async (_c, _userId, input: any) => {
			if (input?.kind === "character") {
				return [
					{
						id: "card-1",
						kind: "character",
						name: "张三",
						latestVersion: { data: { imageUrl: "https://file.beqlee.icu/a.png" } },
					},
				] as never;
			}
			return [] as never;
		});

		const { res, parsed } = await execute(router, "tapcanvas_storyboard_anchor_candidates", {
			scope: "owner",
		});

		expect(res.status).toBe(200);
		// scope=owner 被忽略：始终 project 级，每次读都带 projectId 约束（不做 owner 级/孤儿跨项目读）。
		expect(parsed.scope).toBe("project");
		for (const call of listMaterialAssetsForOwner.mock.calls) {
			expect(call[2]).toHaveProperty("projectId", PROJECT_ID);
		}
	});

	// 【章节复用策略·就近原则】bare 列举（无 name 收窄）+ 章节会话：跨章卡按同名实体就近去重，
	// 不同名称的历史场景仍可复用；未来章节卡不回流。name 查卡是显式按名找，不裁章节。
	it("material_assets_list bare list keeps reusable historical scenes in nearest-first order", async () => {
		const { router, listMaterialAssetsForOwner } = await buildRouter();
		listMaterialAssetsForOwner.mockResolvedValue([
			{
				id: "s-cur",
				kind: "scene",
				name: "火海云层",
				updatedAt: "2026-06-27T00:00:00Z",
				latestVersion: {
					data: { imageUrl: "https://file.beqlee.icu/cur.png", sourceChapterId: "book-x-ch129" },
				},
			},
			{
				id: "s-old",
				kind: "scene",
				name: "月下断崖",
				updatedAt: "2026-06-22T00:00:00Z",
				latestVersion: {
					data: { imageUrl: "https://file.beqlee.icu/old.png", sourceChapterId: "book-x-ch17" },
				},
			},
		] as never);

		const { res, parsed } = await execute(
			router,
			"tapcanvas_material_assets_list",
			{ kind: "scene" },
			"book-x-ch129",
		);

		expect(res.status).toBe(200);
		expect(parsed.scope).toBe("project");
		expect(parsed.items.map((item: { id: string }) => item.id)).toEqual([
			"s-cur",
			"s-old",
		]);
	});

	it("material_assets_list no longer depends on a chapter-index lookup", async () => {
		const {
			router,
			listMaterialAssetsForOwner,
			listChaptersByProjectForOwner,
		} = await buildRouter();
		listMaterialAssetsForOwner.mockResolvedValue([] as never);
		vi.mocked(listChaptersByProjectForOwner).mockRejectedValue(
			new AppError("章节索引读取失败", {
				status: 503,
				code: "chapter_index_read_failed",
			}),
		);

		const { res, body } = await execute(
			router,
			"tapcanvas_material_assets_list",
			{ kind: "scene" },
			"book-x-ch129",
		);

		expect(res.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(listChaptersByProjectForOwner).not.toHaveBeenCalled();
	});

	it("material_assets_list can lock an exact chapter, node, and state", async () => {
		const { router, listMaterialAssetsForOwner } = await buildRouter();
		listMaterialAssetsForOwner.mockResolvedValue([
			{
				id: "project-node:chapter:ch2:role-hcy",
				kind: "character",
				name: "霍春燕",
				updatedAt: "2026-08-08T11:00:00.000Z",
				currentVersion: 3,
				origin: {
					type: "project_node",
					ownerType: "chapter",
					ownerId: "ch2",
					ownerLabel: "第二章",
					flowId: "chapter:ch2",
					nodeId: "role-hcy",
				},
				latestVersion: {
					id: "version-3",
					data: { imageUrl: "https://file.beqlee.icu/hcy-v3.png", stateKey: "battle" },
				},
			},
			{
				id: "project-node:chapter:ch1:role-hcy",
				kind: "character",
				name: "霍春燕",
				updatedAt: "2026-08-07T11:00:00.000Z",
				currentVersion: 2,
				origin: {
					type: "project_node",
					ownerType: "chapter",
					ownerId: "ch1",
					flowId: "chapter:ch1",
					nodeId: "role-hcy",
				},
				latestVersion: {
					id: "version-2",
					data: { imageUrl: "https://file.beqlee.icu/hcy-v2.png", stateKey: "daily" },
				},
			},
		] as never);

		const { res, parsed } = await execute(router, "tapcanvas_material_assets_list", {
			name: "霍春燕",
			nodeId: "role-hcy",
			sourceChapterId: "ch2",
			stateKey: "battle",
		});

		expect(res.status).toBe(200);
		expect(parsed.items).toHaveLength(1);
		expect(parsed.items[0]).toMatchObject({
			nodeId: "role-hcy",
			ownerId: "ch2",
			ownerLabel: "第二章",
			stateKey: "battle",
			updatedAt: "2026-08-08T11:00:00.000Z",
			referenceAssetIds: ["project-node:chapter:ch2:role-hcy"],
		});
	});

	it("material_assets_list name lookup is NOT chapter-narrowed (回基态/跨章按名查找)", async () => {
		const { router, listMaterialAssetsForOwner } = await buildRouter();
		listMaterialAssetsForOwner.mockResolvedValue([
			{
				id: "s-old",
				kind: "scene",
				name: "月下断崖",
				updatedAt: "2026-06-22T00:00:00Z",
				latestVersion: {
					data: { imageUrl: "https://file.beqlee.icu/old.png", sourceChapterId: "book-x-ch17" },
				},
			},
		] as never);

		const { res, parsed } = await execute(
			router,
			"tapcanvas_material_assets_list",
			{ kind: "scene", name: "月下断崖" },
			"book-x-ch129",
		);

		expect(res.status).toBe(200);
		// 显式按名查卡：即便 ch17 ≠ 当前 ch129，也原样返回（按名查找不裁章节）。
		expect(parsed.items.map((item: { id: string }) => item.id)).toEqual(["s-old"]);
	});
});
