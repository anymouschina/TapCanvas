import { describe, expect, it } from "vitest";
import {
	buildVideoSpeechAuditVerification,
	normalizeSpokenText,
	parseVideoSpeechAuditTranscript,
	parseVideoSpeechAuditVerification,
	videoSpeechAuditVerificationMatches,
	type VideoSpeechAuditExpectedLine,
} from "./video-orchestrator.speech-audit";

const expectedLines: VideoSpeechAuditExpectedLine[] = [
	{ lineId: "line-1", speakerName: "林遥", delivery: "on_screen", text: "你迟到了。" },
	{ lineId: "line-2", speakerName: "周峥", delivery: "off_screen", text: "先别开门！" },
];

const transcript = {
	version: 1,
	language: "zh",
	utterances: [
		{ utteranceId: "u-1", startSeconds: 0.4, endSeconds: 1.8, text: "你迟到了" },
		{ utteranceId: "u-2", startSeconds: 2.1, endSeconds: 3.6, text: "先别开门" },
	],
};

describe("video rendered speech audit", () => {
	it("normalizes only non-spoken punctuation and spacing", () => {
		expect(normalizeSpokenText(" 你，迟 到了！A+1 ")).toBe("你迟到了a+1");
	});

	it("accepts an ordered transcript that exactly conserves the frozen lines", () => {
		const verification = buildVideoSpeechAuditVerification({
			runId: "run-1",
			clipIndex: 0,
			model: "doubao-seed-2-0-mini-260428",
			responseId: "resp-1",
			mediaUrl: "https://cdn.example.com/clip-0.mp4",
			expectedLines,
			transcript,
			verifiedAt: "2026-08-09T10:00:00.000Z",
		});
		expect(verification).toMatchObject({
			satisfied: true,
			missingLineIds: [],
			unauthorizedUtteranceIds: [],
			firstMismatch: null,
		});
		expect(parseVideoSpeechAuditVerification(verification)).toEqual(verification);
		expect(videoSpeechAuditVerificationMatches({
			verification,
			runId: "run-1",
			clipIndex: 0,
			mediaUrl: "https://cdn.example.com/clip-0.mp4",
			expectedLines,
		})).toBe(true);
	});

	it("reports missing dialogue and action text spoken as unauthorized narration", () => {
		const verification = buildVideoSpeechAuditVerification({
			runId: "run-1",
			clipIndex: 0,
			model: "doubao-seed-2-0-mini-260428",
			responseId: "resp-2",
			mediaUrl: "https://cdn.example.com/clip-0.mp4",
			expectedLines,
			transcript: {
				version: 1,
				language: "zh",
				utterances: [
					{ utteranceId: "u-1", startSeconds: 0.4, endSeconds: 1.8, text: "你迟到了" },
					{ utteranceId: "u-action", startSeconds: 2, endSeconds: 3.2, text: "他推开房门" },
				],
			},
			verifiedAt: "2026-08-09T10:00:00.000Z",
		});
		expect(verification.satisfied).toBe(false);
		expect(verification.missingLineIds).toEqual(["line-2"]);
		expect(verification.unauthorizedUtteranceIds).toEqual(["u-action"]);
		expect(verification.missingCriteria).toEqual(["renderedSpeech.orderedSpeechExact"]);
		expect(verification.firstMismatch?.expectedRemainder).toContain("先别开门");
		expect(verification.firstMismatch?.observedRemainder).toContain("他推开房门");
	});

	it("proves a silent clip has no unauthorized speech", () => {
		const verification = buildVideoSpeechAuditVerification({
			runId: "run-silent",
			clipIndex: 3,
			model: "doubao-seed-2-0-mini-260428",
			responseId: "resp-silent",
			mediaUrl: "https://cdn.example.com/clip-3.mp4",
			expectedLines: [],
			transcript: { version: 1, language: "zh", utterances: [] },
			verifiedAt: "2026-08-09T10:00:00.000Z",
		});
		expect(verification.satisfied).toBe(true);
		expect(verification.observed.utteranceCount).toBe(0);
	});

	it("rejects malformed or overlapping transcript evidence", () => {
		expect(parseVideoSpeechAuditTranscript({
			version: 1,
			language: "zh",
			utterances: [
				{ utteranceId: "u-1", startSeconds: 1, endSeconds: 3, text: "第一句" },
				{ utteranceId: "u-2", startSeconds: 2, endSeconds: 4, text: "第二句" },
			],
		})).toBeNull();
	});

	it("invalidates evidence when the media URL or ledger changes", () => {
		const verification = buildVideoSpeechAuditVerification({
			runId: "run-1",
			clipIndex: 0,
			model: "doubao-seed-2-0-mini-260428",
			responseId: "resp-1",
			mediaUrl: "https://cdn.example.com/clip-0.mp4",
			expectedLines,
			transcript,
			verifiedAt: "2026-08-09T10:00:00.000Z",
		});
		expect(videoSpeechAuditVerificationMatches({
			verification,
			runId: "run-1",
			clipIndex: 0,
			mediaUrl: "https://cdn.example.com/replaced.mp4",
			expectedLines,
		})).toBe(false);
		expect(videoSpeechAuditVerificationMatches({
			verification,
			runId: "run-1",
			clipIndex: 0,
			mediaUrl: "https://cdn.example.com/clip-0.mp4",
			expectedLines: [{ ...expectedLines[0]!, text: "另一句" }, expectedLines[1]!],
		})).toBe(false);
	});
});
