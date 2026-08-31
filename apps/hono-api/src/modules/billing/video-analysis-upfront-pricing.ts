import { normalizeBillingModelKey } from "./billing.models";

// 火山方舟官方视频理解与音频理解文档：
// https://www.volcengine.com/docs/82379/1895586
// https://www.volcengine.com/docs/82379/2377589
const OFFICIAL_PRICING_TIER_MAX_INPUT_TOKENS = 128_000;
const OFFICIAL_MAX_VIDEO_TOKENS = 81_920;
const OFFICIAL_AUDIO_TOKENS_PER_SECOND = 6.25;
// 时间戳属于平台在视觉帧之外注入的文本；32 tokens/帧是内部保守上界，
// 不是拿实耗反推价格。协议文本再按 UTF-8 一字节一 token 计入，继续留出余量。
const MAX_TIMESTAMP_TOKENS_PER_FRAME = 32;
// 与 new-api 中 Doubao Seed 2.0 260428 已发布的 1.5 售价倍率保持一致。
export const SALE_PRICE_MULTIPLIER = 1.5;
export const VIDEO_ANALYSIS_CREDITS_PER_CNY = 100;
export const VIDEO_ANALYSIS_PRICING_VERSION = "video-analysis-duration-v1";
export const SEEDANCE_20_STANDARD_480P_PRICE_CNY_PER_SECOND = 1.25;

export const VIDEO_ANALYSIS_BILLING_SPEC_KEY =
	"video-understand:duration-metered:60s:5fps:16k-output:v1";
export const VIDEO_ANALYSIS_CAPABILITY_TAG =
	"tapcanvas:capability=video-analysis";

export const VIDEO_ANALYSIS_EXECUTION_LIMITS = {
	maxDurationSeconds: 60,
	maxVideoBytes: 50 * 1024 * 1024,
	minFps: 0.2,
	maxFps: 5,
	maxSampledFrames: 300,
	maxPromptBytes: 2_048,
	maxRequestBodyBytes: 16_384,
	maxOutputTokens: 16_384,
} as const;

export const VIDEO_ANALYSIS_TOKEN_BUDGET = {
	maxVideoInputTokens: OFFICIAL_MAX_VIDEO_TOKENS,
	maxNonAudioInputTokens: 120_000,
	maxAudioInputTokens: 375,
	maxTotalInputTokens: 120_375,
	maxOutputTokens: VIDEO_ANALYSIS_EXECUTION_LIMITS.maxOutputTokens,
} as const;

type OfficialTokenPricesCnyPerMillion = {
	nonAudioInput: number;
	audioInput: number;
	output: number;
};

const LITE_260428_TIER_32K_TO_128K_PRICES: OfficialTokenPricesCnyPerMillion = {
	// https://www.volcengine.com/docs/82379/1544106
	nonAudioInput: 0.9,
	audioInput: 13.5,
	output: 5.4,
};

const OFFICIAL_PRICE_BY_MODEL_KEY = new Map<string, OfficialTokenPricesCnyPerMillion>([
	["doubao-seed-2-0-pro-260428", { nonAudioInput: 4.8, audioInput: 0, output: 24 }],
	["doubao-seed-2-0-lite-260428", LITE_260428_TIER_32K_TO_128K_PRICES],
	["doubao-seed-2-0-mini-260428", { nonAudioInput: 0.4, audioInput: 6, output: 4 }],
]);

const DURATION_PRICE_RATIO_BY_MODEL = new Map<string, number>([
	["doubao-seed-2-0-pro-260428", 1 / 3],
	["doubao-seed-2-0-lite-260428", 1 / 10],
	["doubao-seed-2-0-mini-260428", 1 / 20],
]);

export type VideoAnalysisUpfrontPricing = {
	mode: "duration_metered";
	pricingVersion: typeof VIDEO_ANALYSIS_PRICING_VERSION;
	unit: "second";
	priceCnyPerSecond: number;
	creditsPerCny: number;
	minimumCredits: number;
	specKey: typeof VIDEO_ANALYSIS_BILLING_SPEC_KEY;
	cost: number;
	enabled: true;
	officialCostCny: number;
	priceCny: number;
	salePriceMultiplier: number;
	limits: typeof VIDEO_ANALYSIS_EXECUTION_LIMITS;
	tokenBudget: typeof VIDEO_ANALYSIS_TOKEN_BUDGET;
};

export type VideoAnalysisDurationQuote = {
	mode: "duration_metered";
	pricingVersion: typeof VIDEO_ANALYSIS_PRICING_VERSION;
	modelKey: string;
	durationSeconds: number;
	priceCnyPerSecond: number;
	retailPriceCny: number;
	exactCredits: number;
	creditsCharged: number;
};

export function calculateVideoAnalysisDurationQuote(input: {
	modelKey: string;
	durationSeconds: number;
	creditsPerCny: number;
}): VideoAnalysisDurationQuote | null {
	const modelKey = normalizeBillingModelKey(input.modelKey);
	const ratio = DURATION_PRICE_RATIO_BY_MODEL.get(modelKey);
	if (!ratio) return null;
	if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
		throw new RangeError("视频分析时长必须为正数");
	}
	if (!Number.isFinite(input.creditsPerCny) || input.creditsPerCny <= 0) {
		throw new RangeError("视频分析要求有效的 creditsPerCny");
	}
	const durationSeconds = Number(input.durationSeconds.toFixed(3));
	const priceCnyPerSecond = Number((SEEDANCE_20_STANDARD_480P_PRICE_CNY_PER_SECOND * ratio).toFixed(9));
	const retailPriceCny = Number((durationSeconds * priceCnyPerSecond).toFixed(9));
	const exactCredits = Number((retailPriceCny * input.creditsPerCny).toFixed(8));
	return {
		mode: "duration_metered",
		pricingVersion: VIDEO_ANALYSIS_PRICING_VERSION,
		modelKey,
		durationSeconds,
		priceCnyPerSecond,
		retailPriceCny,
		exactCredits,
		creditsCharged: Math.max(1, Math.ceil(exactCredits - 1e-10)),
	};
}

export type VideoAnalysisLimitViolation = {
	code:
		| "video_analysis_duration_invalid"
		| "video_analysis_duration_limit_exceeded"
		| "video_analysis_video_size_limit_exceeded"
		| "video_analysis_fps_limit_exceeded"
		| "video_analysis_frame_limit_exceeded"
		| "video_analysis_prompt_limit_exceeded"
		| "video_analysis_request_limit_exceeded";
	message: string;
	details: Record<string, number>;
};

const utf8ByteLength = (value: string): number =>
	new TextEncoder().encode(value).byteLength;

export const videoAnalysisPromptByteLength = (prompt: string): number =>
	utf8ByteLength(prompt);

export function resolveVideoAnalysisUpfrontPricing(input: {
	modelKey: string;
	creditsPerCny: number;
}): VideoAnalysisUpfrontPricing | null {
	const normalizedModelKey = normalizeBillingModelKey(input.modelKey);
	const prices = OFFICIAL_PRICE_BY_MODEL_KEY.get(normalizedModelKey);
	if (!prices) return null;
	if (!Number.isFinite(input.creditsPerCny) || input.creditsPerCny <= 0) {
		throw new Error("视频分析前置计价要求有效的 creditsPerCny");
	}

	const officialCostCny = (
		VIDEO_ANALYSIS_TOKEN_BUDGET.maxNonAudioInputTokens * prices.nonAudioInput
		+ VIDEO_ANALYSIS_TOKEN_BUDGET.maxAudioInputTokens * prices.audioInput
		+ VIDEO_ANALYSIS_TOKEN_BUDGET.maxOutputTokens * prices.output
	) / 1_000_000;
	const priceCny = officialCostCny * SALE_PRICE_MULTIPLIER;
	const cost = Math.ceil(priceCny * input.creditsPerCny - 1e-9);

	return {
		mode: "duration_metered",
		pricingVersion: VIDEO_ANALYSIS_PRICING_VERSION,
		unit: "second",
		priceCnyPerSecond: Number(((DURATION_PRICE_RATIO_BY_MODEL.get(normalizedModelKey) ?? 0) * SEEDANCE_20_STANDARD_480P_PRICE_CNY_PER_SECOND).toFixed(9)),
		creditsPerCny: input.creditsPerCny,
		minimumCredits: 1,
		specKey: VIDEO_ANALYSIS_BILLING_SPEC_KEY,
		cost,
		enabled: true,
		officialCostCny,
		priceCny,
		salePriceMultiplier: SALE_PRICE_MULTIPLIER,
		limits: VIDEO_ANALYSIS_EXECUTION_LIMITS,
		tokenBudget: VIDEO_ANALYSIS_TOKEN_BUDGET,
	};
}

export function validateVideoAnalysisExecutionLimits(input: {
	durationSeconds: number;
	videoSizeBytes: number;
	fps: number;
	userPrompt: string;
	requestBody: string;
}): VideoAnalysisLimitViolation | null {
	if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
		return {
			code: "video_analysis_duration_invalid",
			message: "无法取得有效的视频时长，不能证明本次请求处于前置计价上限内",
			details: { durationSeconds: input.durationSeconds },
		};
	}
	if (input.durationSeconds > VIDEO_ANALYSIS_EXECUTION_LIMITS.maxDurationSeconds) {
		return {
			code: "video_analysis_duration_limit_exceeded",
			message: `视频分析最长支持 ${VIDEO_ANALYSIS_EXECUTION_LIMITS.maxDurationSeconds} 秒`,
			details: {
				durationSeconds: input.durationSeconds,
				maxDurationSeconds: VIDEO_ANALYSIS_EXECUTION_LIMITS.maxDurationSeconds,
			},
		};
	}
	if (
		!Number.isFinite(input.videoSizeBytes)
		|| input.videoSizeBytes <= 0
		|| input.videoSizeBytes > VIDEO_ANALYSIS_EXECUTION_LIMITS.maxVideoBytes
	) {
		return {
			code: "video_analysis_video_size_limit_exceeded",
			message: `视频分析代理文件必须小于等于 ${VIDEO_ANALYSIS_EXECUTION_LIMITS.maxVideoBytes} 字节`,
			details: {
				videoSizeBytes: input.videoSizeBytes,
				maxVideoBytes: VIDEO_ANALYSIS_EXECUTION_LIMITS.maxVideoBytes,
			},
		};
	}
	if (
		!Number.isFinite(input.fps)
		|| input.fps < VIDEO_ANALYSIS_EXECUTION_LIMITS.minFps
		|| input.fps > VIDEO_ANALYSIS_EXECUTION_LIMITS.maxFps
	) {
		return {
			code: "video_analysis_fps_limit_exceeded",
			message: `视频分析帧率必须处于 ${VIDEO_ANALYSIS_EXECUTION_LIMITS.minFps}–${VIDEO_ANALYSIS_EXECUTION_LIMITS.maxFps} fps`,
			details: {
				fps: input.fps,
				minFps: VIDEO_ANALYSIS_EXECUTION_LIMITS.minFps,
				maxFps: VIDEO_ANALYSIS_EXECUTION_LIMITS.maxFps,
			},
		};
	}

	const sampledFrames = Math.max(16, Math.ceil(input.durationSeconds * input.fps));
	if (sampledFrames > VIDEO_ANALYSIS_EXECUTION_LIMITS.maxSampledFrames) {
		return {
			code: "video_analysis_frame_limit_exceeded",
			message: `视频分析最多允许 ${VIDEO_ANALYSIS_EXECUTION_LIMITS.maxSampledFrames} 个抽帧位置`,
			details: {
				sampledFrames,
				maxSampledFrames: VIDEO_ANALYSIS_EXECUTION_LIMITS.maxSampledFrames,
			},
		};
	}

	const promptBytes = videoAnalysisPromptByteLength(input.userPrompt);
	if (promptBytes > VIDEO_ANALYSIS_EXECUTION_LIMITS.maxPromptBytes) {
		return {
			code: "video_analysis_prompt_limit_exceeded",
			message: `视频分析补充要求最多 ${VIDEO_ANALYSIS_EXECUTION_LIMITS.maxPromptBytes} 字节`,
			details: {
				promptBytes,
				maxPromptBytes: VIDEO_ANALYSIS_EXECUTION_LIMITS.maxPromptBytes,
			},
		};
	}

	const requestBodyBytes = utf8ByteLength(input.requestBody);
	if (requestBodyBytes > VIDEO_ANALYSIS_EXECUTION_LIMITS.maxRequestBodyBytes) {
		return {
			code: "video_analysis_request_limit_exceeded",
			message: "视频分析协议体超过前置计价允许的输入上限",
			details: {
				requestBodyBytes,
				maxRequestBodyBytes: VIDEO_ANALYSIS_EXECUTION_LIMITS.maxRequestBodyBytes,
			},
		};
	}
	return null;
}

export function assertVideoAnalysisBudgetInvariant(): void {
	const derivedSampledFrames = Math.max(
		16,
		Math.ceil(
			VIDEO_ANALYSIS_EXECUTION_LIMITS.maxDurationSeconds
			* VIDEO_ANALYSIS_EXECUTION_LIMITS.maxFps,
		),
	);
	if (derivedSampledFrames > VIDEO_ANALYSIS_EXECUTION_LIMITS.maxSampledFrames) {
		throw new Error("视频分析抽帧上限不足以覆盖最大时长与 fps");
	}
	const derivedAudioUpperBound =
		VIDEO_ANALYSIS_EXECUTION_LIMITS.maxDurationSeconds
		* OFFICIAL_AUDIO_TOKENS_PER_SECOND;
	if (derivedAudioUpperBound > VIDEO_ANALYSIS_TOKEN_BUDGET.maxAudioInputTokens) {
		throw new Error("视频分析音频 Token 上限不足以覆盖最大时长");
	}
	const derivedNonAudioUpperBound =
		VIDEO_ANALYSIS_TOKEN_BUDGET.maxVideoInputTokens
		+ VIDEO_ANALYSIS_EXECUTION_LIMITS.maxSampledFrames * MAX_TIMESTAMP_TOKENS_PER_FRAME
		+ VIDEO_ANALYSIS_EXECUTION_LIMITS.maxRequestBodyBytes;
	if (derivedNonAudioUpperBound > VIDEO_ANALYSIS_TOKEN_BUDGET.maxNonAudioInputTokens) {
		throw new Error("视频分析非音频 Token 上限不足以覆盖执行约束");
	}
	if (
		VIDEO_ANALYSIS_TOKEN_BUDGET.maxVideoInputTokens !== OFFICIAL_MAX_VIDEO_TOKENS
		|| VIDEO_ANALYSIS_TOKEN_BUDGET.maxTotalInputTokens
			!== VIDEO_ANALYSIS_TOKEN_BUDGET.maxNonAudioInputTokens
				+ VIDEO_ANALYSIS_TOKEN_BUDGET.maxAudioInputTokens
		|| VIDEO_ANALYSIS_TOKEN_BUDGET.maxOutputTokens
			!== VIDEO_ANALYSIS_EXECUTION_LIMITS.maxOutputTokens
	) {
		throw new Error("视频分析 Token 预算字段之间不一致");
	}
	if (
		VIDEO_ANALYSIS_TOKEN_BUDGET.maxTotalInputTokens
		> OFFICIAL_PRICING_TIER_MAX_INPUT_TOKENS
	) {
		throw new Error("视频分析输入 Token 上限越过官方 128K 计价档");
	}
}

assertVideoAnalysisBudgetInvariant();
