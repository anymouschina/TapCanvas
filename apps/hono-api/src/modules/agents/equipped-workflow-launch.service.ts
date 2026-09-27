import { createHash, randomUUID } from "node:crypto";
import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { loadPublicChatEnabledModelCatalogSummary } from "../model-catalog/model-catalog.public-chat-summary";
import { listNewApiModels } from "../new-api-models/new-api-models.service";
import { buildWorkflowProjectContextForRun } from "../execution/execution.project-context-runtime";
import { freezeWorkflowUserIntent, WORKFLOW_USER_INTENT_FIELD } from "../execution/execution.workflow-user-intent";
import { resolveOnlyVideoNodes } from "../task/workflow-video-delivery-selection";
import { getChapterFilmSpec } from "../task/video-orchestrator.authoring.repo";
import { readWorkflowCanvasGroupFromFlowData } from "../execution/execution.canvas-source-runner";
import { startWorkflowExecution } from "../execution/execution.start-service";
import { WorkflowExecutionSchema } from "../execution/execution.schemas";
import { materializeWorkflowConfigurationInheritance } from "../execution/execution.workflow-configuration";
import {
	recordCapabilityInvocation,
	resolveEquippedWorkflowExecutionTarget,
} from "./capability-bay.service";
import { flattenWorkflowNodeTree } from "../execution/execution.node-tree";
import type { LaunchEquippedWorkflowRequest } from "./capability-bay.schemas";
import { upsertEquippedWorkflowExecutionProjection } from "../task/equipped-workflow-execution-projection";

type JsonRecord = Record<string, unknown>;

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === "object") {
		const record = value as JsonRecord;
		return Object.fromEntries(
			Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]),
		);
	}
	return value;
}

function makeUserSelectionContract(input: Readonly<{
	attachmentId: string;
	projectId: string;
	chapterId?: string;
	canvasFlowId?: string;
	executionVariant: "full_video" | "first_video" | null;
}>): JsonRecord {
	const scopeLabel = input.chapterId
		? `project ${input.projectId}, chapter ${input.chapterId}`
		: `project ${input.projectId}, canvas ${input.canvasFlowId}`;
	const contract: JsonRecord = {
		version: 2,
		must: [{
			id: "run-explicitly-selected-workflow",
			statement: "Run the workflow attachment explicitly selected by the authenticated user for the supplied canvas scope.",
			source: "authenticated_user_selection",
			evidence: [input.attachmentId, scopeLabel],
		}],
		forbid: [],
		prefer: [],
		confirmedFacts: [
			{
				id: "selected-workflow-attachment",
				statement: "The workflow attachment was explicitly selected by the authenticated user.",
				source: "authenticated_user_selection",
				evidence: [input.attachmentId],
			},
			{
				id: "selected-canvas-scope",
				statement: `The requested workflow scope is ${scopeLabel}.`,
				source: "authenticated_user_selection",
				evidence: [input.projectId, ...(input.chapterId ? [input.chapterId] : []), ...(input.canvasFlowId ? [input.canvasFlowId] : [])],
			},
			{
				id: "selected-execution-variant",
				statement: input.executionVariant
					? `The requested workflow variant is ${input.executionVariant}.`
					: "The selected workflow does not declare a video execution variant.",
				source: "authenticated_user_selection",
				evidence: input.executionVariant ? [input.executionVariant] : [],
			},
		],
		unresolved: [],
		precedence: ["authenticated_user_selection", "equipped_workflow_execution_contract"],
		delivery: {
			mode: "async_artifact",
			mediaType: input.executionVariant ? "video" : null,
			kind: "workflow_execution",
			output: "The accepted execution and artifacts produced by the selected workflow.",
		},
	};
	contract.contractHash = createHash("sha256").update(JSON.stringify(canonicalize(contract))).digest("hex");
	return contract;
}

function hasValue(value: unknown): boolean {
	if (typeof value === "string") return value.trim().length > 0;
	if (Array.isArray(value)) return value.length > 0;
	return value !== null && value !== undefined;
}

function readRecord(value: unknown): JsonRecord | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as JsonRecord
		: null;
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function authoredMediaConfiguration(flowData: string): Readonly<{
	imageModelKeys: readonly string[];
	videoModelKeys: readonly string[];
	hasImageStage: boolean;
	hasVideoStage: boolean;
}> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(flowData);
	} catch (error: unknown) {
		throw new AppError("已装配工作流的媒体配置不是合法 JSON", {
			status: 409,
			code: "workflow_media_configuration_invalid",
			details: { reason: error instanceof Error ? error.message : String(error) },
		});
	}
	const root = readRecord(parsed);
	if (!root || !Array.isArray(root.nodes)) {
		throw new AppError("已装配工作流缺少有效节点配置", {
			status: 409,
			code: "workflow_media_configuration_invalid",
		});
	}
	let nodes: unknown[];
	try {
		nodes = materializeWorkflowConfigurationInheritance(flattenWorkflowNodeTree(root.nodes));
	} catch (error: unknown) {
		throw new AppError("已装配工作流的媒体配置无法解析", {
			status: 409,
			code: "workflow_media_configuration_invalid",
			details: { reason: error instanceof Error ? error.message : String(error) },
		});
	}
	const image = new Set<string>();
	const video = new Set<string>();
	let hasImageStage = false;
	let hasVideoStage = false;
	for (const node of nodes) {
		const data = readRecord(readRecord(node)?.data);
		const spec = readRecord(data?.workflowAtomicSpec);
		const executorRef = readString(spec?.executorRef);
		if (executorRef === "tapcanvas.image.generate/v1") {
			hasImageStage = true;
			const modelKey = readString(data?.workflowImageModelKey);
			if (modelKey) image.add(modelKey);
		}
		if (executorRef === "agents.delivery.contract/v2"
			|| executorRef === "video.estimate/v1"
			|| executorRef === "tapcanvas.video.generate/v1") {
			hasVideoStage = true;
			const modelKey = readString(data?.workflowVideoModelKey);
			if (modelKey) video.add(modelKey);
		}
	}
	return {
		imageModelKeys: [...image],
		videoModelKeys: [...video],
		hasImageStage,
		hasVideoStage,
	};
}

function canonicalCatalogImageSize(requested: string, supported: readonly string[]): string | null {
	if (supported.length === 0) return requested;
	const exact = supported.find((value) => value === requested);
	if (exact) return exact;
	const matches = supported.filter((value) => value.toLocaleLowerCase("en-US") === requested.toLocaleLowerCase("en-US"));
	return matches.length === 1 ? matches[0]! : null;
}

async function requireEnabledMediaCatalog(c: AppContext, userId: string) {
	const result = await loadPublicChatEnabledModelCatalogSummary(c, userId);
	if (result.error || !result.summary) {
		throw new AppError("无法读取当前可执行媒体模型目录", {
			status: 503,
			code: "workflow_media_model_catalog_unavailable",
			details: { reason: result.error || "catalog_summary_missing" },
		});
	}
	return result.summary;
}

function validateRequiredMediaModels(input: Readonly<{
	triggerPayload: JsonRecord | undefined;
	requiredFields: readonly string[];
	catalog: Awaited<ReturnType<typeof requireEnabledMediaCatalog>> | null;
	authoredImageModelKeys: readonly string[];
	authoredVideoModelKeys: readonly string[];
	hasImageStage: boolean;
	hasVideoStage: boolean;
}>): JsonRecord | undefined {
	const payload = input.triggerPayload;
	const missing = input.requiredFields.filter((field) => !hasValue(payload?.[field]));
	if (missing.length > 0) {
		throw new AppError("工作流需要的输入尚未提供", {
			status: 400,
			code: "workflow_required_trigger_payload_fields_missing",
			details: { requiredTriggerPayloadFields: missing },
		});
	}
	const catalog = input.catalog;
	if (!catalog && (input.authoredImageModelKeys.length > 0 || input.authoredVideoModelKeys.length > 0
		|| readString(payload?.videoModelKey) || readString(payload?.imageModelKey))) {
		throw new AppError("工作流媒体模型目录不可用，不能受理执行", {
			status: 503,
			code: "workflow_media_model_catalog_unavailable",
		});
	}
	const videoModelKey = readString(payload?.videoModelKey);
	const hasVideoMediaSelection = Boolean(videoModelKey
		|| readString(payload?.videoResolution)
		|| readString(payload?.videoSize)
		|| readString(payload?.videoAspectRatio));
	if (hasVideoMediaSelection && !input.hasVideoStage) {
		throw new AppError("工作流没有接收视频媒体选择的节点", {
			status: 400,
			code: "workflow_video_media_selection_without_target",
		});
	}
	const videoModelKeys = videoModelKey ? [videoModelKey] : input.authoredVideoModelKeys;
	if (hasVideoMediaSelection && videoModelKeys.length === 0) {
		throw new AppError("视频媒体输入缺少可验证的模型选择", {
			status: 400,
			code: "workflow_video_model_required_for_media_selection",
		});
	}
	for (const modelKey of videoModelKeys) {
		if (!catalog?.videoModels.some((model) => model.modelKey === modelKey)) {
			throw new AppError(`视频模型未在当前账号启用：${modelKey}`, {
				status: 409,
				code: "workflow_video_model_not_enabled",
				details: { modelKey },
			});
		}
	}
	const selectedImageModelKey = readString(payload?.imageModelKey);
	const imageModelKeys = selectedImageModelKey ? [selectedImageModelKey] : input.authoredImageModelKeys;
	const hasImageMediaSelection = Boolean(selectedImageModelKey
		|| readString(payload?.imageAspectRatio)
		|| readString(payload?.imageSize));
	if (hasImageMediaSelection && !input.hasImageStage) {
		throw new AppError("工作流没有接收图片媒体选择的节点", {
			status: 400,
			code: "workflow_image_media_selection_without_target",
		});
	}
	if (hasImageMediaSelection && imageModelKeys.length === 0) {
		throw new AppError("图片媒体输入缺少可验证的模型选择", {
			status: 400,
			code: "workflow_image_model_required_for_media_selection",
		});
	}
	const imageModels = imageModelKeys.map((modelKey) => {
		const model = catalog?.imageModels.find((item) => item.modelKey === modelKey);
		if (!model) {
			throw new AppError(`图片模型未在当前账号启用：${modelKey}`, {
				status: 409,
				code: "workflow_image_model_not_enabled",
				details: { modelKey },
			});
		}
		return model;
	});
	const aspectRatio = readString(payload?.imageAspectRatio);
	for (const model of imageModels) {
		const aspectOptions = model.imageOptions?.aspectRatioOptions ?? [];
		if (aspectRatio && aspectOptions.length > 0 && !aspectOptions.includes(aspectRatio)) {
			throw new AppError(`图片模型 ${model.modelKey} 不支持画幅 ${aspectRatio}`, {
				status: 400,
				code: "workflow_image_aspect_ratio_not_supported",
				details: { modelKey: model.modelKey, imageAspectRatio: aspectRatio, supported: aspectOptions },
			});
		}
	}
	const imageSize = readString(payload?.imageSize);
	if (imageSize && imageModels.length > 0) {
		const canonicalSizes = imageModels.map((model) => {
			const options = (model.imageOptions?.imageSizeOptions ?? []).map((option) => option.value);
			const canonical = canonicalCatalogImageSize(imageSize, options);
			if (!canonical) {
				throw new AppError(`图片模型 ${model.modelKey} 不支持尺寸 ${imageSize}`, {
					status: 400,
					code: "workflow_image_size_not_supported",
					details: { modelKey: model.modelKey, imageSize, supported: options },
				});
			}
			return canonical;
		});
		if (new Set(canonicalSizes).size > 1) {
			throw new AppError("多个图片模型对同一尺寸输入的目录规范化结果不一致", {
				status: 400,
				code: "workflow_image_size_not_supported",
				details: { imageSize, modelKeys: imageModelKeys, supported: canonicalSizes },
			});
		}
		const canonical = canonicalSizes[0];
		if (canonical && canonical !== imageSize && payload) return { ...payload, imageSize: canonical };
	}
	return payload;
}

function deliveryForCaller(input: Readonly<{
	workflowFlowId: string;
	projectId: string;
	canvasFlowId: string;
	chapterId?: string;
}>): Readonly<{ flowId: string; projectId: string | null; chapterId?: string }> | null {
	if (input.canvasFlowId === input.workflowFlowId) return null;
	return {
		flowId: input.canvasFlowId,
		projectId: input.projectId,
		...(input.chapterId ? { chapterId: input.chapterId } : {}),
	};
}

export async function launchEquippedWorkflowFromUserSelection(
	c: AppContext,
	userId: string,
	request: LaunchEquippedWorkflowRequest,
) {
	const callerChapterId = request.chapterId;
	const callerCanvasFlowId = callerChapterId ?? request.canvasFlowId;
	if (!callerCanvasFlowId) {
		throw new AppError("必须提供当前章节或画布范围", {
			status: 400,
			code: "workflow_project_context_required",
		});
	}
	const target = await resolveEquippedWorkflowExecutionTarget(c, userId, request.attachmentId);
	const invocation = target.attachment.descriptor.invocation;
	if (!invocation) {
		throw new AppError("已装配工作流缺少可执行调用合同", {
			status: 409,
			code: "capability_workflow_invocation_contract_missing",
			details: { attachmentId: request.attachmentId },
		});
	}
	const actualVariant = invocation.executionVariant ?? null;
	if (request.executionVariant !== actualVariant) {
		throw new AppError("请求的工作流变体与已装配版本不一致", {
			status: 409,
			code: "workflow_execution_variant_mismatch",
			details: {
				attachmentId: request.attachmentId,
				requestedWorkflowExecutionVariant: request.executionVariant,
				actualWorkflowExecutionVariant: actualVariant,
			},
		});
	}
	const source = request.triggerPayload?.source;
	const sourceGroupId = request.triggerPayload?.sourceGroupId;
	if (invocation.sourceMode === "inline_text" && (!source || sourceGroupId)) {
		throw new AppError("该工作流需要用户提供文本来源，且不能同时提供画布组", {
			status: 400,
			code: "workflow_inline_source_required",
		});
	}
	if (invocation.sourceMode === "canvas_group" && (!sourceGroupId || source)) {
		throw new AppError("该工作流需要当前画布中明确选择的来源组", {
			status: 400,
			code: "workflow_canvas_source_group_required",
		});
	}
	if ((invocation.sourceMode === "project_context" || invocation.sourceMode === "none") && (source || sourceGroupId)) {
		throw new AppError("本工作流的来源合同不接受文本或来源组覆盖", {
			status: 400,
			code: "workflow_source_mode_payload_mismatch",
		});
	}

	let triggerPayload: JsonRecord | undefined = request.triggerPayload
		? { ...request.triggerPayload }
		: undefined;
	if (callerChapterId) {
		const chapterSpec = await getChapterFilmSpec(callerChapterId);
		triggerPayload = {
			...(triggerPayload ?? {}),
			onlyVideoNodes: resolveOnlyVideoNodes(request.triggerPayload?.onlyVideoNodes, chapterSpec?.onlyVideoNodes),
		};
	}
	const authoredMedia = authoredMediaConfiguration(target.flow.data);
	if (authoredMedia.hasVideoStage) {
		const { freezeWorkflowVideoPlanAtAdmission } = await import("../task/workflow-video-plan-admission");
		const admittedVideoPlan = await freezeWorkflowVideoPlanAtAdmission({
			c,
			triggerPayload,
			workflowData: target.flow.data,
		});
		triggerPayload = admittedVideoPlan.triggerPayload;
	}
	const requiredFields = invocation.requiredTriggerPayloadFields;
	const hasMediaRequirements = requiredFields.some((field) => (
		field === "videoModelKey"
		|| field === "videoResolution"
		|| field === "videoAspectRatio"
		|| field === "imageModelKey"
		|| field === "imageAspectRatio"
		|| field === "imageSize"
	));
	const hasMediaOverrides = Boolean(
		triggerPayload?.videoModelKey
		|| triggerPayload?.imageModelKey
		|| triggerPayload?.videoResolution
		|| triggerPayload?.videoSize
		|| triggerPayload?.videoAspectRatio
		|| triggerPayload?.imageAspectRatio
		|| triggerPayload?.imageSize
	);
	let mediaCatalog: Awaited<ReturnType<typeof requireEnabledMediaCatalog>> | null = null;
	if (hasMediaRequirements || hasMediaOverrides || authoredMedia.hasImageStage || authoredMedia.hasVideoStage) {
		mediaCatalog = await requireEnabledMediaCatalog(c, userId);
	}
	triggerPayload = validateRequiredMediaModels({
		triggerPayload,
		requiredFields,
		catalog: mediaCatalog,
		authoredImageModelKeys: authoredMedia.imageModelKeys,
		authoredVideoModelKeys: authoredMedia.videoModelKeys,
		hasImageStage: authoredMedia.hasImageStage,
		hasVideoStage: authoredMedia.hasVideoStage,
	});
	const enabledTextModels = await listNewApiModels(c.env, { kind: "text", enabled: true, fresh: true });
	const selectedAgentModel = enabledTextModels.find((model) => model.requestModelKey === request.agentModelKey);
	if (!selectedAgentModel) {
		throw new AppError(`当前选择的语言模型未启用：${request.agentModelKey}`, {
			status: 409,
			code: "workflow_agent_model_not_enabled",
			details: { modelKey: request.agentModelKey },
		});
	}

	const contract = makeUserSelectionContract({
		attachmentId: request.attachmentId,
		projectId: request.projectId,
		...(callerChapterId ? { chapterId: callerChapterId } : { canvasFlowId: callerCanvasFlowId }),
		executionVariant: request.executionVariant,
	});
	const workflowUserIntent = freezeWorkflowUserIntent({ ownerId: userId, contract });
	if (workflowUserIntent) {
		triggerPayload = { ...(triggerPayload ?? {}), [WORKFLOW_USER_INTENT_FIELD]: workflowUserIntent };
	}

	const runContext = await buildWorkflowProjectContextForRun({
		c,
		ownerId: userId,
		projectId: request.projectId,
		canvasId: callerCanvasFlowId,
		...(callerChapterId ? { chapterId: callerChapterId } : {}),
		activeNodeId: request.canvasNodeId ?? null,
		triggerPayload,
	});
	if (invocation.sourceMode === "canvas_group" && sourceGroupId) {
		try {
			readWorkflowCanvasGroupFromFlowData({
				flowId: callerCanvasFlowId,
				groupId: sourceGroupId,
				rowData: JSON.stringify(runContext.callerCanvasSnapshot),
			});
		} catch (error: unknown) {
			throw new AppError(error instanceof Error ? error.message : "来源组不在当前画布中", {
				status: 400,
				code: "workflow_canvas_source_group_invalid",
				details: { sourceGroupId },
			});
		}
	}
	const delivery = deliveryForCaller({
		workflowFlowId: target.flow.id,
		projectId: request.projectId,
		canvasFlowId: callerCanvasFlowId,
		...(callerChapterId ? { chapterId: callerChapterId } : {}),
	});
	const result = await startWorkflowExecution(c.env, {
		flow: target.flow,
		ownerId: userId,
		triggerNodeId: target.attachment.descriptor.triggerNodeId,
		trigger: "manual",
		triggerPayload,
		directAgentModelSelection: { model: selectedAgentModel.requestModelKey, source: "user_preference" },
		...(delivery ? { delivery } : {}),
		projectContext: runContext.projectContext,
		callerCanvasSnapshot: runContext.callerCanvasSnapshot,
		idempotencyKey: `capability:${target.attachment.id}:user-launch:${request.idempotencyKey}`,
		materializeAcceptedExecution: async (execution) => {
			await upsertEquippedWorkflowExecutionProjection({
				c,
				ownerId: userId,
				flowId: callerCanvasFlowId,
				...(callerChapterId ? { chapterId: callerChapterId } : {}),
				execution,
			});
		},
	});
	const execution = WorkflowExecutionSchema.parse(result.execution);
	try {
		await recordCapabilityInvocation(c, {
			userId,
			attachment: target.attachment,
			workflowExecutionId: execution.id,
			agentExecutionId: null,
			sessionId: null,
			toolCallId: null,
			invocationInput: {
				projectId: request.projectId,
				...(callerChapterId ? { chapterId: callerChapterId } : { canvasFlowId: callerCanvasFlowId }),
				...(request.canvasNodeId ? { canvasNodeId: request.canvasNodeId } : {}),
				...(sourceGroupId ? { sourceGroupId } : {}),
				variant: request.executionVariant,
				sourceMode: invocation.sourceMode,
			},
		});
		return { created: result.created, execution, invocationRecord: { status: "recorded" as const } };
	} catch (error: unknown) {
		const diagnosticId = randomUUID();
		console.error(JSON.stringify({
			event: "equipped_workflow_invocation_persist_failed_after_acceptance",
			diagnosticId,
			userId,
			attachmentId: target.attachment.id,
			workflowExecutionId: execution.id,
			error: String(error instanceof Error ? error.message : error).slice(0, 600),
		}));
		return {
			created: result.created,
			execution,
			invocationRecord: { status: "failed" as const, diagnosticId },
		};
	}
}
