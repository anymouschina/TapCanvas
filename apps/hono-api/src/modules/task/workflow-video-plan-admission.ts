import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { parseUserGenerationPrefs } from "../auth/generation-prefs";
import { materializeWorkflowConfigurationInheritance } from "../execution/execution.workflow-configuration";
import { flattenWorkflowNodeTree, mapWorkflowNodeTreeScopes } from "../execution/execution.node-tree";
import {
	freezeWorkflowVideoDurationPlan,
	WORKFLOW_VIDEO_DURATION_PLAN_TRIGGER_FIELD,
	type FrozenWorkflowVideoDurationPlan,
} from "../execution/execution.video-workflow-contract";
import { resolveModelMediaOptions } from "./video-orchestrator.model-duration";
import { projectVideoAspectRatio, type VideoFrameSizeOption } from "./video-frame-domain";

function readTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolve the media values frozen into the authored workflow graph. */
export function resolveAuthoredWorkflowVideoMediaConfiguration(
	flowData: unknown,
): Readonly<{ modelKey: string; resolution: string; size: string; aspectRatio: string }> {
	let parsed: unknown = flowData;
	if (typeof flowData === "string") {
		try {
			parsed = JSON.parse(flowData);
		} catch (error: unknown) {
			throw new AppError("Workflow video media configuration is not valid JSON", {
				status: 409,
				code: "workflow_video_media_configuration_invalid",
				details: { reason: error instanceof Error ? error.message : String(error) },
			});
		}
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.nodes)) {
		throw new AppError("Workflow video media configuration requires a nodes array", {
			status: 409,
			code: "workflow_video_media_configuration_invalid",
		});
	}
	const configuredTree = mapWorkflowNodeTreeScopes(parsed.nodes, materializeWorkflowConfigurationInheritance);
	const materialized = flattenWorkflowNodeTree(configuredTree);
	const candidateNodes = materialized.filter((rawNode) => {
		if (!isRecord(rawNode) || !isRecord(rawNode.data)) return false;
		const spec = isRecord(rawNode.data.workflowAtomicSpec) ? rawNode.data.workflowAtomicSpec : null;
		const executorRef = typeof spec?.executorRef === "string" ? spec.executorRef : "";
		return executorRef === "agents.delivery.contract/v2"
			|| executorRef === "video.estimate/v1"
			|| executorRef === "tapcanvas.video.generate/v1";
	});
	const estimateNodes = candidateNodes.filter((rawNode) => {
		if (!isRecord(rawNode) || !isRecord(rawNode.data)) return false;
		const spec = isRecord(rawNode.data.workflowAtomicSpec) ? rawNode.data.workflowAtomicSpec : null;
		return spec?.executorRef === "video.estimate/v1";
	});
	const nodesToRead = estimateNodes.length > 0 ? estimateNodes : candidateNodes;
	const fields = { modelKey: "", resolution: "", size: "", aspectRatio: "" };
	for (const rawNode of nodesToRead) {
		if (!isRecord(rawNode) || !isRecord(rawNode.data)) continue;
		const spec = isRecord(rawNode.data.workflowAtomicSpec) ? rawNode.data.workflowAtomicSpec : null;
		const executorRef = typeof spec?.executorRef === "string" ? spec.executorRef : "";
		if (executorRef !== "agents.delivery.contract/v2"
			&& executorRef !== "video.estimate/v1"
			&& executorRef !== "tapcanvas.video.generate/v1") continue;
		const values = {
			modelKey: readTrimmedString(rawNode.data.workflowVideoModelKey),
			resolution: readTrimmedString(rawNode.data.workflowVideoResolution),
			size: readTrimmedString(rawNode.data.workflowVideoSize),
			aspectRatio: readTrimmedString(rawNode.data.workflowVideoAspectRatio),
		};
		for (const field of ["modelKey", "resolution", "size", "aspectRatio"] as const) {
			if (!values[field]) continue;
			if (fields[field] && fields[field] !== values[field]) {
				throw new AppError(
					`Workflow video media configuration drift at ${field}: ${fields[field]} vs ${values[field]}`,
					{ status: 409, code: "workflow_video_media_configuration_drift" },
				);
			}
			fields[field] = values[field];
		}
	}
	return fields;
}

/** Canonicalize only values present in the executable model catalog. */
function resolveWorkflowVideoMediaSelection(input: Readonly<{
	modelKey: string;
	resolution?: string;
	size?: string;
	aspectRatio?: string;
	resolutionOptions: readonly string[];
	sizeOptions?: readonly string[];
	aspectRatioOptions: readonly string[];
	frameSizeOptions?: readonly VideoFrameSizeOption[];
}>): Readonly<{ resolution: string | null; size?: string; aspectRatio: string | null }> {
	const resolution = readTrimmedString(input.resolution);
	const size = readTrimmedString(input.size);
	const aspectRatio = readTrimmedString(input.aspectRatio);
	const canonicalResolution = resolution
		? resolveCanonicalCatalogValue(resolution, input.resolutionOptions)
		: null;
	if (resolution && !canonicalResolution) {
		throw new AppError(
			`Video model ${input.modelKey} does not support resolution ${resolution}; supported: ${input.resolutionOptions.join("/")}`,
			{ status: 400, code: "workflow_video_resolution_not_supported" },
		);
	}
	const canonicalSize = size ? resolveCanonicalCatalogValue(size, input.sizeOptions ?? []) : null;
	if (size && !canonicalSize) {
		throw new AppError(
			`Video model ${input.modelKey} does not support size ${size}; supported: ${(input.sizeOptions ?? []).join("/")}`,
			{ status: 400, code: "workflow_video_size_not_supported" },
		);
	}
	let canonicalAspectRatio = aspectRatio
		? resolveCanonicalCatalogValue(aspectRatio, input.aspectRatioOptions)
		: null;
	if (aspectRatio && !canonicalAspectRatio) {
		const projected = projectVideoAspectRatio({ requested: aspectRatio, sizeOptions: input.frameSizeOptions ?? [] });
		if (projected.kind === "resolved") {
			canonicalAspectRatio = resolveCanonicalCatalogValue(projected.aspectRatio, input.aspectRatioOptions);
		}
	}
	if (aspectRatio && !canonicalAspectRatio) {
		throw new AppError(
			`Video model ${input.modelKey} does not support aspect ratio ${aspectRatio}; supported: ${input.aspectRatioOptions.join("/")}`,
			{ status: 400, code: "workflow_video_aspect_ratio_not_supported" },
		);
	}
	return {
		resolution: canonicalResolution,
		...(canonicalSize ? { size: canonicalSize } : {}),
		aspectRatio: canonicalAspectRatio,
	};
}

function resolveCanonicalCatalogValue(requested: string, supported: readonly string[]): string | null {
	if (supported.length === 0) return requested;
	const exact = supported.find((value) => value === requested);
	if (exact) return exact;
	const normalized = requested.toLocaleLowerCase("en-US");
	const matches = supported.filter((value) => value.toLocaleLowerCase("en-US") === normalized);
	return matches.length === 1 ? matches[0]! : null;
}

type WorkflowVideoAdmissionErrorCode =
	| "video_model_key_required"
	| "video_model_not_enabled"
	| "video_model_catalog_unavailable"
	| "video_model_options_missing"
	| "video_model_duration_options_missing";

export function normalizeWorkflowVideoAdmissionError(error: unknown): AppError | null {
	if (error instanceof AppError) return error;
	if (!(error instanceof Error)) return null;
	const message = error.message.trim();
	const separator = message.indexOf(":");
	const rawCode = separator >= 0 ? message.slice(0, separator) : message;
	const errorCodes = new Set<WorkflowVideoAdmissionErrorCode>([
		"video_model_key_required", "video_model_not_enabled", "video_model_catalog_unavailable",
		"video_model_options_missing", "video_model_duration_options_missing",
	]);
	if (!errorCodes.has(rawCode as WorkflowVideoAdmissionErrorCode)) return null;
	const detail = separator >= 0 ? message.slice(separator + 1).trim() : "";
	const modelKey = rawCode === "video_model_key_required" ? "" : detail;
	const config: Readonly<Record<WorkflowVideoAdmissionErrorCode, Readonly<{
		status: number; code: string; message: string;
	}>>> = {
		video_model_key_required: { status: 400, code: "workflow_video_model_key_required", message: "视频工作流缺少视频模型键，无法冻结可执行的媒体配置" },
		video_model_not_enabled: { status: 409, code: "workflow_video_model_not_enabled", message: "当前视频模型未启用或没有可执行的上游路由" },
		video_model_catalog_unavailable: { status: 503, code: "video_model_catalog_unavailable", message: "无法读取当前可执行的视频模型目录" },
		video_model_options_missing: { status: 409, code: "workflow_video_model_options_missing", message: "当前视频模型没有完整的可执行媒体规格" },
		video_model_duration_options_missing: { status: 409, code: "workflow_video_model_duration_options_missing", message: "当前视频模型没有可用的时长规格" },
	};
	const current = config[rawCode as WorkflowVideoAdmissionErrorCode];
	return new AppError(`${current.message}${modelKey ? `：${modelKey}` : ""}`, {
		status: current.status,
		code: current.code,
		details: {
			...(modelKey ? { modelKey } : {}),
			...(rawCode === "video_model_catalog_unavailable" && detail ? { reason: detail } : {}),
		},
		severity: "error",
	});
}

/** Freeze effective model/media settings and the duration plan before admission. */
export async function freezeWorkflowVideoPlanAtAdmission(input: Readonly<{
	c: AppContext;
	triggerPayload: Record<string, unknown> | undefined;
	workflowData?: unknown;
}>): Promise<Readonly<{
	triggerPayload: Record<string, unknown> | undefined;
	durationPlan: FrozenWorkflowVideoDurationPlan | null;
}>> {
	const authoredMedia = input.workflowData === undefined
		? { modelKey: "", resolution: "", size: "", aspectRatio: "" }
		: resolveAuthoredWorkflowVideoMediaConfiguration(input.workflowData);
	const userId = String(input.c.get("userId") ?? "").trim();
	let userPrefs = null;
	if (userId) {
		const user = await input.c.env.DB.users.findUnique({ where: { id: userId }, select: { generation_prefs: true } });
		const storedPrefs = parseUserGenerationPrefs(user?.generation_prefs ?? null);
		userPrefs = storedPrefs?.videoPreferenceEnabled === true ? storedPrefs : null;
	}
	const targetDurationValue = input.triggerPayload?.targetDurationSeconds;
	const modelKey = readTrimmedString(input.triggerPayload?.videoModelKey)
		|| userPrefs?.videoModel
		|| authoredMedia.modelKey;
	const hasTargetDuration = targetDurationValue !== undefined;
	const targetDurationSeconds = Number(targetDurationValue);
	const requestedClipCountValue = input.triggerPayload?.requestedClipCount;
	const requestedClipCount = requestedClipCountValue === undefined ? null : Number(requestedClipCountValue);
	const requestedClipDurationsValue = input.triggerPayload?.requestedClipDurationsSeconds;
	const requestedClipDurationsSeconds = requestedClipDurationsValue === undefined
		? null
		: Array.isArray(requestedClipDurationsValue) && requestedClipDurationsValue.length > 0
			? requestedClipDurationsValue
			: null;
	const hasRequestedClipDurations = requestedClipDurationsValue !== undefined
		&& (!Array.isArray(requestedClipDurationsValue) || requestedClipDurationsValue.length > 0);
	if (hasTargetDuration && (!Number.isInteger(targetDurationSeconds) || targetDurationSeconds <= 0)) {
		throw new AppError("targetDurationSeconds must be a positive integer", { status: 400, code: "workflow_video_target_duration_invalid" });
	}
	if (hasTargetDuration && !modelKey) {
		throw new AppError("videoModelKey is required when targetDurationSeconds is provided", {
			status: 400,
			code: "workflow_video_model_key_required",
			severity: "error",
			details: { reason: "targetDurationSeconds_requires_authored_or_explicit_video_model" },
		});
	}
	if (requestedClipCount !== null && (!Number.isInteger(requestedClipCount) || requestedClipCount <= 0)) {
		throw new AppError("requestedClipCount must be a positive integer", { status: 400, code: "workflow_requested_clip_count_invalid" });
	}
	if (hasRequestedClipDurations && (
		!requestedClipDurationsSeconds || requestedClipDurationsSeconds.length === 0
		|| requestedClipDurationsSeconds.length > 64
		|| requestedClipDurationsSeconds.some((duration) => typeof duration !== "number" || !Number.isInteger(duration) || duration <= 0)
	)) {
		throw new AppError("requestedClipDurationsSeconds must contain 1..64 positive integers", { status: 400, code: "workflow_requested_clip_durations_invalid" });
	}
	if (hasTargetDuration && requestedClipDurationsSeconds && requestedClipCount === null) {
		throw new AppError("requestedClipCount is required when requestedClipDurationsSeconds is provided", {
			status: 400, code: "workflow_requested_clip_count_required_for_durations",
		});
	}
	if (hasTargetDuration && requestedClipDurationsSeconds && requestedClipCount !== null
		&& requestedClipDurationsSeconds.length !== requestedClipCount) {
		throw new AppError("requestedClipCount must match requestedClipDurationsSeconds.length", {
			status: 400, code: "workflow_requested_clip_count_duration_mismatch",
		});
	}
	if (hasTargetDuration && requestedClipDurationsSeconds
		&& requestedClipDurationsSeconds.reduce((total, duration) => total + Number(duration), 0) !== targetDurationSeconds) {
		throw new AppError("requestedClipDurationsSeconds must sum to targetDurationSeconds", {
			status: 400, code: "workflow_requested_clip_duration_total_mismatch",
		});
	}
	if (!modelKey) return { triggerPayload: input.triggerPayload, durationPlan: null };
	let mediaOptions: Awaited<ReturnType<typeof resolveModelMediaOptions>>;
	try {
		mediaOptions = await resolveModelMediaOptions({ c: input.c, modelKey });
	} catch (error: unknown) {
		const normalized = normalizeWorkflowVideoAdmissionError(error);
		if (normalized) throw normalized;
		throw error;
	}
	const preferenceApplies = userPrefs?.videoModel === modelKey;
	const mediaSelection = resolveWorkflowVideoMediaSelection({
		modelKey,
		resolution: readTrimmedString(input.triggerPayload?.videoResolution) || (preferenceApplies ? userPrefs?.videoResolution : "") || authoredMedia.resolution,
		size: readTrimmedString(input.triggerPayload?.videoSize) || authoredMedia.size,
		aspectRatio: readTrimmedString(input.triggerPayload?.videoAspectRatio) || (preferenceApplies ? userPrefs?.videoAspect : "") || authoredMedia.aspectRatio,
		resolutionOptions: mediaOptions.resolutionOptions,
		sizeOptions: mediaOptions.sizeOptions,
		aspectRatioOptions: mediaOptions.aspectRatioOptions,
		frameSizeOptions: mediaOptions.frameSizeOptions,
	});
	const durationPlan = hasTargetDuration
		? freezeWorkflowVideoDurationPlan({
			targetDurationSeconds,
			modelKey,
			durationOptions: mediaOptions.durationOptions,
			maxReferenceImages: mediaOptions.maxReferenceImages,
			supportsReferenceImages: mediaOptions.supportsReferenceImages,
			supportsFirstLastFrame: mediaOptions.supportsFirstLastFrame,
			...(requestedClipDurationsSeconds ? { explicitDurations: requestedClipDurationsSeconds as number[] } : {}),
		})
		: null;
	const nextTriggerPayload = {
		...(input.triggerPayload ?? {}),
		videoModelKey: modelKey,
		videoMediaSelectionSource: {
			model: readTrimmedString(input.triggerPayload?.videoModelKey) ? "request" : userPrefs?.videoModel ? "user_preferences" : "workflow",
			resolvedAt: new Date().toISOString(),
		},
		...(mediaSelection.resolution ? { videoResolution: mediaSelection.resolution } : {}),
		...(mediaSelection.size ? { videoSize: mediaSelection.size } : {}),
		...(mediaSelection.aspectRatio ? { videoAspectRatio: mediaSelection.aspectRatio } : {}),
		...(hasTargetDuration ? {
			targetDurationSeconds,
			...(requestedClipCount === null ? {} : { requestedClipCount }),
			...(requestedClipDurationsSeconds ? { requestedClipDurationsSeconds } : {}),
			[WORKFLOW_VIDEO_DURATION_PLAN_TRIGGER_FIELD]: durationPlan,
		} : {}),
	};
	return { triggerPayload: nextTriggerPayload, durationPlan };
}
