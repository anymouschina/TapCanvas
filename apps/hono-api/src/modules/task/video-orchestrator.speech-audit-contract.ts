import type { AppContext } from "../../types";
import {
	VIDEO_ANALYSIS_EXECUTION_LIMITS,
	VIDEO_ANALYSIS_PRICING_VERSION,
} from "../billing/video-analysis-upfront-pricing";
import { requireSelectableVideoAnalysisModel } from "../new-api-models/new-api-video-analysis-model";

export type VideoSpeechAuditRequest = {
	kind: "video_speech_audit";
	modelKey: string;
	fps: number;
};

export type VideoSpeechAuditContract = VideoSpeechAuditRequest & {
	billingSpecKey: string;
	pricingVersion: typeof VIDEO_ANALYSIS_PRICING_VERSION;
	creditsPerCny: number;
};

function readRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function readText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function parseVideoSpeechAuditRequest(value: unknown): VideoSpeechAuditRequest | null {
	const record = readRecord(value);
	const modelKey = readText(record?.modelKey);
	const fps = Number(record?.fps);
	if (
		!record || record.kind !== "video_speech_audit" || !modelKey ||
		!Number.isFinite(fps) ||
		fps < VIDEO_ANALYSIS_EXECUTION_LIMITS.minFps ||
		fps > VIDEO_ANALYSIS_EXECUTION_LIMITS.maxFps
	) return null;
	return { kind: "video_speech_audit", modelKey, fps };
}

export function parseVideoSpeechAuditContract(value: unknown): VideoSpeechAuditContract | null {
	const request = parseVideoSpeechAuditRequest(value);
	const record = readRecord(value);
	const billingSpecKey = readText(record?.billingSpecKey);
	const creditsPerCny = Number(record?.creditsPerCny);
	if (
		!request || !record || !billingSpecKey ||
		record.pricingVersion !== VIDEO_ANALYSIS_PRICING_VERSION ||
		!Number.isFinite(creditsPerCny) || creditsPerCny <= 0
	) return null;
	return {
		...request,
		billingSpecKey,
		pricingVersion: VIDEO_ANALYSIS_PRICING_VERSION,
		creditsPerCny,
	};
}

function readBeatSheetMeta(beatSheet: unknown): Record<string, unknown> | null {
	return readRecord(readRecord(beatSheet)?.meta);
}

export function readBeatSheetSpeechAuditRequest(beatSheet: unknown): VideoSpeechAuditRequest | null {
	return parseVideoSpeechAuditRequest(readBeatSheetMeta(beatSheet)?.speechAudit);
}

export function readBeatSheetSpeechAuditContract(beatSheet: unknown): VideoSpeechAuditContract | null {
	return parseVideoSpeechAuditContract(readBeatSheetMeta(beatSheet)?.speechAuditContract);
}

export function readStoryPlanSpeechAuditContract(storyPlan: unknown): VideoSpeechAuditContract | null {
	return parseVideoSpeechAuditContract(readRecord(storyPlan)?.speechAuditContract);
}

export async function resolveVideoSpeechAuditContract(input: {
	c: AppContext;
	request: VideoSpeechAuditRequest;
}): Promise<VideoSpeechAuditContract> {
	const model = await requireSelectableVideoAnalysisModel(input.c, input.request.modelKey);
	const pricing = model.videoAnalysisPricing;
	if (!pricing?.enabled || pricing.mode !== "duration_metered") {
		throw new Error(`video_speech_audit_pricing_missing:${input.request.modelKey}`);
	}
	return {
		...input.request,
		modelKey: model.requestModelKey,
		billingSpecKey: pricing.specKey,
		pricingVersion: pricing.pricingVersion,
		creditsPerCny: pricing.creditsPerCny,
	};
}

export async function resolveBeatSheetVideoSpeechAuditContract(input: {
	c: AppContext;
	beatSheet: unknown;
}): Promise<VideoSpeechAuditContract | null> {
	const meta = readBeatSheetMeta(input.beatSheet);
	const request = readBeatSheetSpeechAuditRequest(input.beatSheet);
	const existing = readBeatSheetSpeechAuditContract(input.beatSheet);
	if (meta && Object.prototype.hasOwnProperty.call(meta, "speechAudit") && !request) {
		throw new Error("beat_sheet_speech_audit_request_invalid");
	}
	if (meta && Object.prototype.hasOwnProperty.call(meta, "speechAuditContract") && !existing) {
		throw new Error("beat_sheet_speech_audit_contract_invalid");
	}
	if (existing) {
		if (request && (
			request.kind !== existing.kind ||
			request.modelKey !== existing.modelKey ||
			request.fps !== existing.fps
		)) throw new Error("beat_sheet_speech_audit_contract_request_mismatch");
		return existing;
	}
	return request ? resolveVideoSpeechAuditContract({ c: input.c, request }) : null;
}
