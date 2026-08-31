import {
	buildShotTableAnalysisInstruction,
	buildShotTableAnalysisJsonSchema,
	SHOT_TABLE_ANALYSIS_OUTPUT_MODE,
	SHOT_TABLE_ANALYSIS_SCHEMA_NAME,
	VIDEO_EVIDENCE_SHOT_TABLE_COLUMNS,
} from "@tapcanvas/shot-table-protocol";
import { VIDEO_ANALYSIS_EXECUTION_LIMITS } from "../billing/video-analysis-upfront-pricing";
import {
	buildVideoSpeechAuditJsonSchema,
	VIDEO_SPEECH_AUDIT_OUTPUT_MODE,
	VIDEO_SPEECH_AUDIT_PROMPT,
	VIDEO_SPEECH_AUDIT_SCHEMA_NAME,
} from "./agents-video-speech-audit.protocol";

export type VideoUnderstandOutputMode =
	| "free-text"
	| typeof SHOT_TABLE_ANALYSIS_OUTPUT_MODE
	| typeof VIDEO_SPEECH_AUDIT_OUTPUT_MODE;

export type VideoUnderstandingTransport = {
	type: "media-worker-understanding-proxy-v1";
	url: string;
	sizeBytes: number;
	durationSeconds: number;
};

const buildShotTablePrompt = (analysisFocus: string, verifiedDurationSeconds: number): string => {
	const contract = buildShotTableAnalysisInstruction({ verifiedDurationSeconds });
	const focus = analysisFocus.trim();
	return focus
		? `${contract}\n\n用户补充的分析重点：\n${focus}`
		: contract;
};

export const buildVideoUnderstandResponsesRequest = (input: {
	model: string;
	videoUrl: string;
	fps: number;
	userPrompt: string;
	outputMode: VideoUnderstandOutputMode;
	verifiedDurationSeconds?: number;
}): Record<string, unknown> => {
	const isShotTable = input.outputMode === SHOT_TABLE_ANALYSIS_OUTPUT_MODE;
	const isSpeechAudit = input.outputMode === VIDEO_SPEECH_AUDIT_OUTPUT_MODE;
	if (
		isShotTable
		&& (
			input.verifiedDurationSeconds === undefined
			|| !Number.isFinite(input.verifiedDurationSeconds)
			|| input.verifiedDurationSeconds <= 0
		)
	) {
		throw new Error("shot-table-v1 requires a verified positive media duration");
	}
	const prompt = isShotTable
		? buildShotTablePrompt(input.userPrompt, input.verifiedDurationSeconds as number)
		: isSpeechAudit
			? VIDEO_SPEECH_AUDIT_PROMPT
			: input.userPrompt.trim();
	return {
		model: input.model,
		store: true,
		max_output_tokens: VIDEO_ANALYSIS_EXECUTION_LIMITS.maxOutputTokens,
		input: [
			{
				type: "message",
				role: "user",
				content: [
					{ type: "input_video", video_url: input.videoUrl, fps: input.fps },
					...(prompt ? [{ type: "input_text", text: prompt }] : []),
				],
			},
		],
		...(isShotTable || isSpeechAudit
			? {
					text: {
						format: {
							type: "json_schema",
							name: isShotTable
								? SHOT_TABLE_ANALYSIS_SCHEMA_NAME
								: VIDEO_SPEECH_AUDIT_SCHEMA_NAME,
							strict: true,
							schema: isShotTable
								? buildShotTableAnalysisJsonSchema(VIDEO_EVIDENCE_SHOT_TABLE_COLUMNS)
								: buildVideoSpeechAuditJsonSchema(),
						},
					},
				}
			: {}),
	};
};
