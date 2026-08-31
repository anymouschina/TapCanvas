import { createHash } from "node:crypto";
import { AppError } from "../../middleware/error";
import type { ResponsesOutputEnvelope } from "./agents-llm-protocol";
import {
	parseVideoSpeechAuditTranscript,
	type VideoSpeechAuditTranscript,
} from "../task/video-orchestrator.speech-audit";

export const VIDEO_SPEECH_AUDIT_OUTPUT_MODE = "speech-audit-v1" as const;
export const VIDEO_SPEECH_AUDIT_SCHEMA_NAME = "tapcanvas_video_speech_audit_v1";

export const VIDEO_SPEECH_AUDIT_PROMPT = [
	"只转写这段视频中真实可听见的人声，不做剧情概括，不描述动作、画面、环境或镜头。",
	"逐条记录人实际说出的内容，包括对白、画外音、旁白、OS、广告口播和误生成的人声；不要把字幕当作声音。",
	"text 尽量逐字保留实际听到的词；听不清的片段按实际可辨内容记录，不得参考预期剧本补写。",
	"无任何可听人声时 utterances 必须为空数组。时间为当前视频片段内的秒数，按先后顺序且不得重叠。",
].join("\n");

export function buildVideoSpeechAuditJsonSchema(): Record<string, unknown> {
	return {
		type: "object",
		additionalProperties: false,
		properties: {
			version: { type: "integer", const: 1 },
			language: {
				type: "string",
				description: "实际人声的主要语言 BCP-47/简写；无声时写 und。",
			},
			utterances: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						utteranceId: { type: "string" },
						startSeconds: { type: "number", minimum: 0 },
						endSeconds: { type: "number", exclusiveMinimum: 0 },
						text: { type: "string" },
					},
					required: ["utteranceId", "startSeconds", "endSeconds", "text"],
				},
			},
		},
		required: ["version", "language", "utterances"],
	};
}

export type VideoSpeechAuditExecutionEvidence = {
	responseId: string;
	model: string;
	outputSha256: string;
	outputLength: number;
	store: true;
	status: "completed";
};

export function parseVideoSpeechAuditEnvelope(input: {
	envelope: ResponsesOutputEnvelope;
	expectedModel: string;
}): {
	transcript: VideoSpeechAuditTranscript;
	execution: VideoSpeechAuditExecutionEvidence;
} {
	const issues: string[] = [];
	if (!input.envelope.id) issues.push("response_id_missing");
	if (input.envelope.model !== input.expectedModel) issues.push("response_model_mismatch");
	if (input.envelope.status !== "completed") issues.push("response_status_invalid");
	if (input.envelope.store !== true) issues.push("response_store_unverified");
	if (input.envelope.previousResponseId !== null) issues.push("unexpected_previous_response_id");
	let parsed: unknown = null;
	try {
		parsed = JSON.parse(input.envelope.text) as unknown;
	} catch {
		issues.push("transcript_json_invalid");
	}
	const transcript = parseVideoSpeechAuditTranscript(parsed);
	if (!transcript) issues.push("transcript_structure_invalid");
	if (issues.length > 0 || !transcript) {
		throw new AppError("视频人声转写证据不符合结构或来源合同", {
			status: 502,
			code: "video_speech_audit_response_invalid",
			details: {
				expectedModel: input.expectedModel,
				responseId: input.envelope.id,
				responseModel: input.envelope.model,
				responseStatus: input.envelope.status,
				responseStore: input.envelope.store,
				issues: Array.from(new Set(issues)),
			},
		});
	}
	return {
		transcript,
		execution: {
			responseId: input.envelope.id,
			model: input.expectedModel,
			outputSha256: createHash("sha256").update(input.envelope.text).digest("hex"),
			outputLength: input.envelope.text.length,
			store: true,
			status: "completed",
		},
	};
}
