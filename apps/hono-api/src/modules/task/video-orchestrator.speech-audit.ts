import { createHash } from "node:crypto";

type UnknownRecord = Record<string, unknown>;

export type VideoSpeechAuditExpectedLine = {
	lineId: string;
	speakerName: string;
	delivery: "on_screen" | "off_screen" | "voice_over";
	text: string;
};

export type VideoSpeechAuditUtterance = {
	utteranceId: string;
	startSeconds: number;
	endSeconds: number;
	text: string;
};

export type VideoSpeechAuditTranscript = {
	version: 1;
	language: string;
	utterances: VideoSpeechAuditUtterance[];
};

export type VideoSpeechAuditVerification = {
	version: 1;
	satisfied: boolean;
	runId: string;
	clipIndex: number;
	model: string;
	responseId: string;
	mediaUrlHash: string;
	speechLedgerHash: string;
	transcriptHash: string;
	expected: {
		lineCount: number;
		normalizedCharacterCount: number;
	};
	observed: {
		utteranceCount: number;
		normalizedCharacterCount: number;
		language: string;
	};
	checks: {
		mediaIdentityPresent: boolean;
		modelIdentityPresent: boolean;
		responseIdentityPresent: boolean;
		transcriptStructureValid: boolean;
		orderedSpeechExact: boolean;
	};
	missingLineIds: string[];
	unauthorizedUtteranceIds: string[];
	firstMismatch: {
		normalizedCharacterOffset: number;
		expectedRemainder: string;
		observedRemainder: string;
	} | null;
	missingCriteria: string[];
	failureReason?: string;
	verifiedAt: string;
};

function readRecord(value: unknown): UnknownRecord | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as UnknownRecord
		: null;
}

function readText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readFiniteNonNegative(value: unknown): number | null {
	const numeric = Number(value);
	return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
	const normalize = (candidate: unknown): unknown => {
		if (Array.isArray(candidate)) return candidate.map(normalize);
		if (candidate === null || typeof candidate !== "object") return candidate;
		const record = candidate as UnknownRecord;
		return Object.fromEntries(
			Object.keys(record).sort().map((key) => [key, normalize(record[key])]),
		);
	};
	return JSON.stringify(normalize(value));
}

/**
 * ASR punctuation and spacing are not spoken content. Normalize only Unicode
 * separators, punctuation and control characters; letters, digits and symbols
 * remain evidence and therefore cannot be silently discarded.
 */
export function normalizeSpokenText(value: string): string {
	let normalized = "";
	for (const character of value.normalize("NFKC")) {
		if (/^[\p{P}\p{Z}\p{C}]$/u.test(character)) continue;
		normalized += character.toLocaleLowerCase("zh-CN");
	}
	return normalized;
}

export function parseVideoSpeechAuditTranscript(value: unknown): VideoSpeechAuditTranscript | null {
	const record = readRecord(value);
	if (!record || record.version !== 1 || !Array.isArray(record.utterances)) return null;
	const language = readText(record.language);
	if (!language) return null;
	const utterances: VideoSpeechAuditUtterance[] = [];
	let previousEndSeconds = 0;
	for (let index = 0; index < record.utterances.length; index += 1) {
		const utterance = readRecord(record.utterances[index]);
		const utteranceId = readText(utterance?.utteranceId);
		const startSeconds = readFiniteNonNegative(utterance?.startSeconds);
		const endSeconds = readFiniteNonNegative(utterance?.endSeconds);
		const text = readText(utterance?.text);
		if (
			!utteranceId || startSeconds === null || endSeconds === null || !text ||
			endSeconds <= startSeconds || startSeconds < previousEndSeconds
		) return null;
		utterances.push({ utteranceId, startSeconds, endSeconds, text });
		previousEndSeconds = endSeconds;
	}
	if (new Set(utterances.map((utterance) => utterance.utteranceId)).size !== utterances.length) {
		return null;
	}
	return { version: 1, language, utterances };
}

function firstMismatch(input: {
	expected: string;
	observed: string;
}): VideoSpeechAuditVerification["firstMismatch"] {
	if (input.expected === input.observed) return null;
	const limit = Math.min(input.expected.length, input.observed.length);
	let offset = 0;
	while (offset < limit && input.expected[offset] === input.observed[offset]) offset += 1;
	return {
		normalizedCharacterOffset: offset,
		expectedRemainder: input.expected.slice(offset, offset + 80),
		observedRemainder: input.observed.slice(offset, offset + 80),
	};
}

function collectMissingLineIds(
	lines: readonly VideoSpeechAuditExpectedLine[],
	observedText: string,
): string[] {
	let cursor = 0;
	const missing: string[] = [];
	for (const line of lines) {
		const normalized = normalizeSpokenText(line.text);
		if (!normalized) {
			missing.push(line.lineId);
			continue;
		}
		const index = observedText.indexOf(normalized, cursor);
		if (index < 0) {
			missing.push(line.lineId);
			continue;
		}
		cursor = index + normalized.length;
	}
	return missing;
}

function collectUnauthorizedUtteranceIds(
	utterances: readonly VideoSpeechAuditUtterance[],
	expectedText: string,
): string[] {
	let cursor = 0;
	const unauthorized: string[] = [];
	for (const utterance of utterances) {
		const normalized = normalizeSpokenText(utterance.text);
		if (!normalized) {
			unauthorized.push(utterance.utteranceId);
			continue;
		}
		const index = expectedText.indexOf(normalized, cursor);
		if (index < 0) {
			unauthorized.push(utterance.utteranceId);
			continue;
		}
		cursor = index + normalized.length;
	}
	return unauthorized;
}

export function buildVideoSpeechAuditVerification(input: {
	runId: string;
	clipIndex: number;
	model: string;
	responseId: string;
	mediaUrl: string;
	expectedLines: readonly VideoSpeechAuditExpectedLine[];
	transcript: unknown;
	verifiedAt: string;
}): VideoSpeechAuditVerification {
	const runId = input.runId.trim();
	const model = input.model.trim();
	const responseId = input.responseId.trim();
	const mediaUrl = input.mediaUrl.trim();
	const transcript = parseVideoSpeechAuditTranscript(input.transcript);
	const expectedText = input.expectedLines
		.map((line) => normalizeSpokenText(line.text))
		.join("");
	const observedText = transcript?.utterances
		.map((utterance) => normalizeSpokenText(utterance.text))
		.join("") ?? "";
	const checks = {
		mediaIdentityPresent: Boolean(mediaUrl),
		modelIdentityPresent: Boolean(model),
		responseIdentityPresent: Boolean(responseId),
		transcriptStructureValid: transcript !== null,
		orderedSpeechExact: transcript !== null && expectedText === observedText,
	};
	const missingCriteria = (Object.entries(checks) as Array<[keyof typeof checks, boolean]>)
		.filter(([, satisfied]) => !satisfied)
		.map(([criterion]) => `renderedSpeech.${criterion}`);
	const missingLineIds = transcript
		? collectMissingLineIds(input.expectedLines, observedText)
		: input.expectedLines.map((line) => line.lineId);
	const unauthorizedUtteranceIds = transcript
		? collectUnauthorizedUtteranceIds(transcript.utterances, expectedText)
		: [];
	const satisfied = missingCriteria.length === 0;
	return {
		version: 1,
		satisfied,
		runId,
		clipIndex: input.clipIndex,
		model,
		responseId,
		mediaUrlHash: mediaUrl ? sha256(mediaUrl) : "",
		speechLedgerHash: sha256(canonicalJson(input.expectedLines)),
		transcriptHash: transcript ? sha256(canonicalJson(transcript)) : "",
		expected: {
			lineCount: input.expectedLines.length,
			normalizedCharacterCount: expectedText.length,
		},
		observed: {
			utteranceCount: transcript?.utterances.length ?? 0,
			normalizedCharacterCount: observedText.length,
			language: transcript?.language ?? "",
		},
		checks,
		missingLineIds,
		unauthorizedUtteranceIds,
		firstMismatch: firstMismatch({ expected: expectedText, observed: observedText }),
		missingCriteria,
		...(!satisfied
			? { failureReason: `video_rendered_speech_verification_failed:${missingCriteria.join(",")}` }
			: {}),
		verifiedAt: input.verifiedAt,
	};
}

export function parseVideoSpeechAuditVerification(
	value: unknown,
): VideoSpeechAuditVerification | null {
	const record = readRecord(value);
	if (!record || record.version !== 1) return null;
	const checks = readRecord(record.checks);
	const expected = readRecord(record.expected);
	const observed = readRecord(record.observed);
	if (
		typeof record.satisfied !== "boolean" ||
		!readText(record.runId) ||
		!Number.isInteger(record.clipIndex) || Number(record.clipIndex) < 0 ||
		!readText(record.model) ||
		!readText(record.responseId) ||
		!readText(record.mediaUrlHash) ||
		!readText(record.speechLedgerHash) ||
		!readText(record.transcriptHash) ||
		!expected || !observed || !checks ||
		!Array.isArray(record.missingLineIds) ||
		!Array.isArray(record.unauthorizedUtteranceIds) ||
		!Array.isArray(record.missingCriteria)
	) return null;
	const booleanChecks = [
		"mediaIdentityPresent",
		"modelIdentityPresent",
		"responseIdentityPresent",
		"transcriptStructureValid",
		"orderedSpeechExact",
	] as const;
	if (booleanChecks.some((key) => typeof checks[key] !== "boolean")) return null;
	const parsed = value as VideoSpeechAuditVerification;
	return parsed.satisfied === Object.values(parsed.checks).every(Boolean) &&
		parsed.missingCriteria.length === Object.entries(parsed.checks).filter(([, ok]) => !ok).length
		? parsed
		: null;
}

export function videoSpeechAuditVerificationMatches(input: {
	verification: VideoSpeechAuditVerification;
	runId: string;
	clipIndex: number;
	mediaUrl: string;
	expectedLines: readonly VideoSpeechAuditExpectedLine[];
}): boolean {
	return input.verification.runId === input.runId.trim() &&
		input.verification.clipIndex === input.clipIndex &&
		input.verification.mediaUrlHash === sha256(input.mediaUrl.trim()) &&
		input.verification.speechLedgerHash === sha256(canonicalJson(input.expectedLines));
}
