import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";
import { verifyUserIntentContract } from "../task/video-orchestrator.user-intent-contract";
import {
	LaunchEquippedWorkflowRequestSchema,
	type LaunchEquippedWorkflowRequest,
} from "./capability-bay.schemas";
import { launchEquippedWorkflowFromUserSelection } from "./equipped-workflow-launch.service";
import { resolveEquippedWorkflowExecutionTarget } from "./capability-bay.service";

const mocks = vi.hoisted(() => ({
	buildContext: vi.fn(),
	freezeVideoPlan: vi.fn(),
	getChapterFilmSpec: vi.fn(),
	loadMediaCatalog: vi.fn(),
	listTextModels: vi.fn(),
	projectExecution: vi.fn(),
	recordInvocation: vi.fn(),
	resolveTarget: vi.fn(),
	startExecution: vi.fn(),
}));

vi.mock("../model-catalog/model-catalog.public-chat-summary", () => ({
	loadPublicChatEnabledModelCatalogSummary: mocks.loadMediaCatalog,
}));
vi.mock("../new-api-models/new-api-models.service", () => ({
	listNewApiModels: mocks.listTextModels,
}));
vi.mock("../execution/execution.project-context-runtime", () => ({
	buildWorkflowProjectContextForRun: mocks.buildContext,
}));
vi.mock("../task/workflow-video-plan-admission", () => ({
	freezeWorkflowVideoPlanAtAdmission: mocks.freezeVideoPlan,
}));
vi.mock("../task/video-orchestrator.authoring.repo", () => ({
	getChapterFilmSpec: mocks.getChapterFilmSpec,
}));
vi.mock("../execution/execution.start-service", () => ({
	startWorkflowExecution: mocks.startExecution,
}));
vi.mock("./capability-bay.service", () => ({
	recordCapabilityInvocation: mocks.recordInvocation,
	resolveEquippedWorkflowExecutionTarget: mocks.resolveTarget,
}));
vi.mock("../task/equipped-workflow-execution-projection", () => ({
	upsertEquippedWorkflowExecutionProjection: mocks.projectExecution,
}));

const queuedExecution = {
	id: "execution-direct-1",
	flowId: "workflow-flow",
	flowVersionId: "workflow-version-7",
	ownerId: "user-1",
	status: "queued" as const,
	concurrency: 1,
	executionFamilyId: "family-direct-1",
	createdAt: "2026-09-23T00:00:00.000Z",
};

const target = {
	attachment: {
		id: "attachment-1",
		descriptor: {
			capabilityId: "workflow:short-film",
			name: "短片工作流",
			sourceId: "workflow-flow",
			sourceVersionId: "workflow-version-7",
			descriptorSha256: "sha256-descriptor",
			triggerNodeId: "trigger-1",
			invocation: {
				sourceMode: "project_context" as const,
				requiredTriggerPayloadFields: [],
				executionVariant: "full_video" as const,
			},
		},
	},
	flow: {
		id: "workflow-flow",
		data: JSON.stringify({ nodes: [{ id: "video-stage", data: {
			kind: "workflowStage",
			workflowAtomicSpec: { executorRef: "tapcanvas.video.generate/v1" },
			workflowVideoModelKey: "video-model",
		} }] }),
		project_id: "ai-workflow-project",
	},
} as unknown as Awaited<ReturnType<typeof resolveEquippedWorkflowExecutionTarget>>;

function context(): AppContext {
	return {
		env: { DB: {} },
		get: (key: string) => key === "userId" ? "user-1" : undefined,
	} as unknown as AppContext;
}

function request(patch: Partial<LaunchEquippedWorkflowRequest> = {}): LaunchEquippedWorkflowRequest {
	return LaunchEquippedWorkflowRequestSchema.parse({
		intent: "run_selected_equipped_workflow",
		attachmentId: "attachment-1",
		executionVariant: "full_video",
		projectId: "project-1",
		chapterId: "chapter-13",
		idempotencyKey: "launch-key-1",
		agentModelKey: "selected-text-model",
		...patch,
	});
}

function targetWithMedia(
	executorRef: string,
	data: Record<string, unknown> = {},
	requiredTriggerPayloadFields: readonly string[] = [],
) {
	return {
		...target,
		attachment: {
			...target.attachment,
			descriptor: {
				...target.attachment.descriptor,
				invocation: {
					sourceMode: "project_context" as const,
					requiredTriggerPayloadFields: [...requiredTriggerPayloadFields],
					executionVariant: "full_video" as const,
				},
			},
		},
		flow: {
			...target.flow,
			data: JSON.stringify({ nodes: [{ id: "media-stage", data: {
				kind: "workflowStage",
				workflowAtomicSpec: { executorRef },
				...data,
			} }] }),
		},
	} as unknown as typeof target;
}

describe("launchEquippedWorkflowFromUserSelection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.resolveTarget.mockResolvedValue(target);
		mocks.listTextModels.mockResolvedValue([{ kind: "text", requestModelKey: "selected-text-model", enabled: true }]);
		mocks.loadMediaCatalog.mockResolvedValue({
			summary: { imageModels: [], videoModels: [{ modelKey: "video-model" }] },
			error: null,
		});
		mocks.getChapterFilmSpec.mockResolvedValue({ onlyVideoNodes: true });
		mocks.freezeVideoPlan.mockImplementation(async (input: { triggerPayload?: Record<string, unknown> }) => ({
			triggerPayload: input.triggerPayload,
			durationPlan: null,
		}));
		mocks.buildContext.mockResolvedValue({
			projectContext: { projectId: "project-1", canvasId: "chapter:chapter-13" },
			callerCanvasSnapshot: { nodes: [], edges: [] },
		});
		mocks.startExecution.mockImplementation(async (_env: unknown, input: { materializeAcceptedExecution?: (execution: typeof queuedExecution) => Promise<void> }) => {
			await input.materializeAcceptedExecution?.(queuedExecution);
			return { created: true, execution: queuedExecution };
		});
	});

	it("creates a direct manual execution from the exact authorized attachment and chapter scope", async () => {
		const result = await launchEquippedWorkflowFromUserSelection(context(), "user-1", request());

		expect(result).toMatchObject({ created: true, execution: { id: queuedExecution.id, status: "queued" } });
		expect(mocks.resolveTarget).toHaveBeenCalledWith(expect.anything(), "user-1", "attachment-1");
		expect(mocks.buildContext).toHaveBeenCalledWith(expect.objectContaining({
			ownerId: "user-1",
			projectId: "project-1",
			canvasId: "chapter-13",
			chapterId: "chapter-13",
		}));
		expect(mocks.startExecution).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			flow: target.flow,
			ownerId: "user-1",
			trigger: "manual",
			triggerNodeId: "trigger-1",
			idempotencyKey: "capability:attachment-1:user-launch:launch-key-1",
			delivery: { flowId: "chapter-13", projectId: "project-1", chapterId: "chapter-13" },
			triggerPayload: expect.objectContaining({ onlyVideoNodes: true }),
			directAgentModelSelection: { model: "selected-text-model", source: "user_preference" },
		}));
		const startInput = mocks.startExecution.mock.calls[0]?.[1];
		const triggerPayload = startInput?.triggerPayload as Record<string, unknown>;
		const frozenIntent = triggerPayload.workflowUserIntent as { contract: unknown };
		const verification = verifyUserIntentContract(frozenIntent.contract);
		expect(verification.ok).toBe(true);
		if (verification.ok) {
			expect(verification.value.contract.delivery).toMatchObject({ mode: "async_artifact", mediaType: "video", kind: "workflow_execution" });
			expect(verification.value.contract.confirmedFacts).toEqual(expect.arrayContaining([
				expect.objectContaining({ id: "selected-workflow-attachment", evidence: ["attachment-1"] }),
				expect.objectContaining({ id: "selected-canvas-scope", evidence: ["project-1", "chapter-13"] }),
			]));
		}
		expect(mocks.recordInvocation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			userId: "user-1",
			workflowExecutionId: queuedExecution.id,
			agentExecutionId: null,
			sessionId: null,
			toolCallId: null,
		}));
	});

	it("rejects a disabled or stale user-selected text model before creating an execution", async () => {
		mocks.listTextModels.mockResolvedValue([]);
		await expect(launchEquippedWorkflowFromUserSelection(context(), "user-1", request()))
			.rejects.toMatchObject({ code: "workflow_agent_model_not_enabled" });
		expect(mocks.startExecution).not.toHaveBeenCalled();
	});

	it("rejects missing media fields required by the attached workflow", async () => {
		mocks.resolveTarget.mockResolvedValue(targetWithMedia(
			"tapcanvas.image.generate/v1",
			{},
			["imageModelKey", "imageAspectRatio", "imageSize"],
		));

		await expect(launchEquippedWorkflowFromUserSelection(context(), "user-1", request()))
			.rejects.toMatchObject({ code: "workflow_required_trigger_payload_fields_missing" });
		expect(mocks.startExecution).not.toHaveBeenCalled();
	});

	it("canonicalizes a selected image size against the enabled model catalog", async () => {
		mocks.resolveTarget.mockResolvedValue(targetWithMedia("tapcanvas.image.generate/v1"));
		mocks.loadMediaCatalog.mockResolvedValue({
			error: null,
			summary: {
				imageModels: [{
					modelKey: "image-model",
					imageOptions: {
						aspectRatioOptions: ["16:9"],
						imageSizeOptions: [{ value: "2K", label: "2K", priceLabel: null }],
					},
				}],
				videoModels: [],
			},
		});

		await launchEquippedWorkflowFromUserSelection(context(), "user-1", request({
			triggerPayload: { imageModelKey: "image-model", imageAspectRatio: "16:9", imageSize: "2k" },
		}));
		expect(mocks.startExecution).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			triggerPayload: expect.objectContaining({ imageSize: "2K" }),
		}));
	});

	it("rejects unsupported image media options before starting an execution", async () => {
		mocks.resolveTarget.mockResolvedValue(targetWithMedia("tapcanvas.image.generate/v1"));
		mocks.loadMediaCatalog.mockResolvedValue({
			error: null,
			summary: {
				imageModels: [{
					modelKey: "image-model",
					imageOptions: {
						aspectRatioOptions: ["16:9"],
						imageSizeOptions: [{ value: "2K", label: "2K", priceLabel: null }],
					},
				}],
				videoModels: [],
			},
		});

		await expect(launchEquippedWorkflowFromUserSelection(context(), "user-1", request({
			triggerPayload: { imageModelKey: "image-model", imageAspectRatio: "1:1", imageSize: "2K" },
		}))).rejects.toMatchObject({ code: "workflow_image_aspect_ratio_not_supported" });
		expect(mocks.startExecution).not.toHaveBeenCalled();
	});

	it("rejects video media options without an explicit or authored model", async () => {
		mocks.resolveTarget.mockResolvedValue(targetWithMedia("tapcanvas.video.generate/v1"));

		await expect(launchEquippedWorkflowFromUserSelection(context(), "user-1", request({
			triggerPayload: { videoAspectRatio: "9:16" },
		}))).rejects.toMatchObject({ code: "workflow_video_model_required_for_media_selection" });
		expect(mocks.startExecution).not.toHaveBeenCalled();
	});

	it.each([true, false])("freezes explicit onlyVideoNodes=%s over the saved chapter preference", async (onlyVideoNodes) => {
		mocks.getChapterFilmSpec.mockResolvedValue({ onlyVideoNodes: !onlyVideoNodes });
		await launchEquippedWorkflowFromUserSelection(context(), "user-1", request({
			triggerPayload: { onlyVideoNodes },
		}));
		expect(mocks.freezeVideoPlan).toHaveBeenCalledWith(expect.objectContaining({
			triggerPayload: expect.objectContaining({ onlyVideoNodes }),
		}));
		expect(mocks.startExecution).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			triggerPayload: expect.objectContaining({ onlyVideoNodes }),
		}));
	});

	it("retains an explicit node-only selection for a canvas without a chapter", async () => {
		await launchEquippedWorkflowFromUserSelection(context(), "user-1", request({
			chapterId: undefined,
			canvasFlowId: "canvas-1",
			triggerPayload: { onlyVideoNodes: true },
		}));
		expect(mocks.getChapterFilmSpec).not.toHaveBeenCalled();
		expect(mocks.startExecution).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			triggerPayload: expect.objectContaining({ onlyVideoNodes: true }),
		}));
	});

	it("rejects a non-boolean node-only selection before execution", () => {
		expect(LaunchEquippedWorkflowRequestSchema.safeParse({
			...request(), triggerPayload: { onlyVideoNodes: "true" },
		}).success).toBe(false);
		expect(mocks.startExecution).not.toHaveBeenCalled();
	});

	it("rejects malformed user intent and ambiguous canvas scope before execution", async () => {
		const malformedIntent = LaunchEquippedWorkflowRequestSchema.safeParse({
			...request(),
			intent: "infer_and_run_workflow",
		});
		const ambiguousScope = LaunchEquippedWorkflowRequestSchema.safeParse({
			...request(),
			canvasFlowId: "canvas-1",
		});
		expect(malformedIntent.success).toBe(false);
		expect(ambiguousScope.success).toBe(false);
		expect(mocks.startExecution).not.toHaveBeenCalled();
	});

	it("preserves attachment permission denial without starting an execution", async () => {
		mocks.resolveTarget.mockRejectedValue(new Error("capability_source_access_revoked"));

		await expect(launchEquippedWorkflowFromUserSelection(context(), "user-1", request()))
			.rejects.toThrow("capability_source_access_revoked");
		expect(mocks.startExecution).not.toHaveBeenCalled();
		expect(mocks.recordInvocation).not.toHaveBeenCalled();
	});

	it("keeps an accepted execution successful when invocation history persistence fails", async () => {
		const diagnosticLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
		mocks.recordInvocation.mockRejectedValue(new Error("invocation database unavailable"));

		const result = await launchEquippedWorkflowFromUserSelection(context(), "user-1", request());

		expect(result).toMatchObject({
			created: true,
			execution: { id: queuedExecution.id, status: "queued" },
			invocationRecord: { status: "failed", diagnosticId: expect.any(String) },
		});
		expect(mocks.startExecution).toHaveBeenCalledTimes(1);
		expect(diagnosticLog).toHaveBeenCalledWith(expect.stringContaining("equipped_workflow_invocation_persist_failed_after_acceptance"));
		diagnosticLog.mockRestore();
	});

	it("rejects a source mode that lacks its exact user supplied input", async () => {
		const canvasGroupTarget = {
			...target,
			attachment: {
				...target.attachment,
				descriptor: {
					...target.attachment.descriptor,
					invocation: {
						sourceMode: "canvas_group" as const,
						requiredTriggerPayloadFields: ["sourceGroupId"],
						executionVariant: "full_video" as const,
					},
				},
			},
		} as unknown as typeof target;
		mocks.resolveTarget.mockResolvedValue(canvasGroupTarget);

		await expect(launchEquippedWorkflowFromUserSelection(context(), "user-1", request()))
			.rejects.toMatchObject({ code: "workflow_canvas_source_group_required" });
		expect(mocks.startExecution).not.toHaveBeenCalled();
	});
});
