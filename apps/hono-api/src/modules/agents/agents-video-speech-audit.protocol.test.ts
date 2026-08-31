import { describe, expect, it } from "vitest";
import type { ResponsesOutputEnvelope } from "./agents-llm-protocol";
import {
	buildVideoSpeechAuditJsonSchema,
	parseVideoSpeechAuditEnvelope,
	VIDEO_SPEECH_AUDIT_PROMPT,
} from "./agents-video-speech-audit.protocol";

const MODEL = "doubao-seed-2-0-mini-260428";

function envelope(overrides: Partial<ResponsesOutputEnvelope> = {}): ResponsesOutputEnvelope {
	return {
		id: "resp-speech-1",
		model: MODEL,
		status: "completed",
		previousResponseId: null,
		store: true,
		text: JSON.stringify({
			version: 1,
			language: "zh",
			utterances: [{
				utteranceId: "u-1",
				startSeconds: 0.2,
				endSeconds: 1.4,
				text: "别开门",
			}],
		}),
		...overrides,
	};
}

describe("video speech audit structured protocol", () => {
	it("does not expose expected dialogue to the transcription model", () => {
		expect(VIDEO_SPEECH_AUDIT_PROMPT).not.toContain("speechLedger");
		expect(VIDEO_SPEECH_AUDIT_PROMPT).not.toContain("预期台词");
		expect(buildVideoSpeechAuditJsonSchema()).toMatchObject({
			type: "object",
			additionalProperties: false,
			required: ["version", "language", "utterances"],
		});
	});

	it("accepts a stored, exact-model structured transcript", () => {
		const parsed = parseVideoSpeechAuditEnvelope({ envelope: envelope(), expectedModel: MODEL });
		expect(parsed.transcript.utterances[0]?.text).toBe("别开门");
		expect(parsed.execution).toMatchObject({
			responseId: "resp-speech-1",
			model: MODEL,
			store: true,
			status: "completed",
		});
	});

	it("rejects model substitution and malformed transcript evidence", () => {
		expect(() => parseVideoSpeechAuditEnvelope({
			envelope: envelope({ model: "another-model", text: "{}" }),
			expectedModel: MODEL,
		})).toThrow("视频人声转写证据不符合结构或来源合同");
	});
});
