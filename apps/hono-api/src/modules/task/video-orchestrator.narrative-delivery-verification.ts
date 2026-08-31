import {
	validateSourceCoveragePlan,
	validateSpeechLedgerAgainstBeats,
} from "./video-orchestrator.source-coverage-plan";
import { validateShotDialogueConservation } from "./video-orchestrator.dialogue-conservation";
import { verifyVideoPromptDeliveryContract } from "./video-prompt-delivery-contract";

type UnknownRecord = Record<string, unknown>;

export type VideoNarrativeDeliveryVerification = {
	version: 1;
	satisfied: boolean;
	deliveryScope: "full_chapter" | "bounded_duration" | null;
	expected: {
		persistedBeatSheet: true;
		sourceCoveragePlan: true;
		speechLedgerConservation: true;
		executableSpeechAuthority: true;
		authoritativePromptDelivery: true;
		plannedDuration: true;
		explicitConcatPolicy: true;
	};
	checks: {
		persistedBeatSheet: boolean;
		sourceCoveragePlan: boolean;
		speechLedgerConservation: boolean;
		executableSpeechAuthority: boolean;
		authoritativePromptDelivery: boolean;
		plannedDuration: boolean;
		explicitConcatPolicy: boolean;
	};
	facts: {
		beatCount: number;
		storyPlanClipCount: number;
		authoritativePromptClipCount: number;
		coverageSpanCount: number;
		speechLedgerLineCount: number;
		chapterSourceCharacters: number;
		beatDurationSeconds: number | null;
		storyPlanDurationSeconds: number | null;
		concatPolicy: {
			joinMode: "hard_cut" | "xfade";
			xfadeSeconds: number;
			colorMatch: boolean;
		} | null;
	};
	missingCriteria: string[];
	diagnostics: string[];
	failureReason?: string;
};

function readRecord(value: unknown): UnknownRecord | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as UnknownRecord
		: null;
}

function readDeliveryScope(value: unknown): "full_chapter" | "bounded_duration" | null {
	return value === "full_chapter" || value === "bounded_duration" ? value : null;
}

function readPositiveDuration(value: unknown): number | null {
	const duration = Number(value);
	return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function sumBeatDurations(beats: unknown[]): number | null {
	if (beats.length === 0) return null;
	const durations = beats.map((beat) => readPositiveDuration(readRecord(beat)?.durationBudget));
	if (durations.some((duration) => duration === null)) return null;
	const total = durations.reduce<number>((sum, duration) => sum + (duration ?? 0), 0);
	return total > 0 ? total : null;
}

function readDialogueScript(value: unknown): Array<{
	lineId: string;
	speakerName: string;
	text: string;
	delivery: "on_screen" | "off_screen" | "voice_over";
}> | null {
	if (!Array.isArray(value)) return null;
	const lines: Array<{
		lineId: string;
		speakerName: string;
		text: string;
		delivery: "on_screen" | "off_screen" | "voice_over";
	}> = [];
	for (const candidate of value) {
		const record = readRecord(candidate);
		const lineId = typeof record?.lineId === "string" ? record.lineId.trim() : "";
		const speakerName = typeof record?.speakerName === "string" ? record.speakerName.trim() : "";
		const text = typeof record?.text === "string" ? record.text.trim() : "";
		const delivery = record?.delivery;
		if (
			!lineId || !speakerName || !text ||
			(delivery !== "on_screen" && delivery !== "off_screen" && delivery !== "voice_over")
		) continue;
		lines.push({ lineId, speakerName, text, delivery });
	}
	return lines.length === value.length ? lines : null;
}

function validateExecutableSpeechAuthority(input: {
	beats: unknown[];
	storyPlan: unknown;
}): { clipCount: number; errors: string[] } {
	const storyPlan = readRecord(input.storyPlan);
	const clips = Array.isArray(storyPlan?.clips) ? storyPlan.clips : [];
	const errors: string[] = [];
	if (clips.length !== input.beats.length) {
		errors.push(
			`StoryPlan clips 与 BeatSheet beats 数量不一致：clips=${clips.length} beats=${input.beats.length}`,
		);
	}
	for (let clipIndex = 0; clipIndex < input.beats.length; clipIndex += 1) {
		const beat = readRecord(input.beats[clipIndex]);
		const clip = readRecord(clips[clipIndex]);
		const declaredClipIndex = Number(beat?.clipIndex);
		const dialogueScript = readDialogueScript(beat?.dialogueScript);
		if (declaredClipIndex !== clipIndex || !dialogueScript || !clip) {
			errors.push(`clip=${clipIndex} 缺少可核验的 BeatSheet dialogueScript 或 StoryPlan clip`);
			continue;
		}
		errors.push(
			...validateShotDialogueConservation({ clip, dialogueScript })
				.map((error) => `clip=${clipIndex} ${error}`),
		);
	}
	return { clipCount: clips.length, errors };
}

function readConcatPolicy(value: unknown): VideoNarrativeDeliveryVerification["facts"]["concatPolicy"] {
	const record = readRecord(value);
	const joinMode = record?.joinMode;
	const xfadeSeconds = Number(record?.xfadeSeconds);
	const colorMatch = record?.colorMatch;
	if (
		(joinMode !== "hard_cut" && joinMode !== "xfade") ||
		!Number.isFinite(xfadeSeconds) ||
		xfadeSeconds < 0 ||
		typeof colorMatch !== "boolean" ||
		(joinMode === "hard_cut" && xfadeSeconds !== 0) ||
		(joinMode === "xfade" && xfadeSeconds <= 0)
	) return null;
	return { joinMode, xfadeSeconds, colorMatch };
}

function findCanonicalComposeData(
	nodes: Array<UnknownRecord> | null,
	runId: string,
): UnknownRecord | null {
	const node = nodes?.find((candidate) => String(candidate.id ?? "").trim() === `film-${runId}`);
	const data = readRecord(node?.data);
	if (
		!data ||
		String(data.clipRunId ?? "").trim() !== runId ||
		String(data.status ?? "").trim().toLowerCase() !== "success"
	) return null;
	return data;
}

function readChapterSourceText(
	nodes: Array<UnknownRecord> | null,
	chapterId: string | null | undefined,
): string {
	const canonicalChapterId = String(chapterId ?? "").trim();
	if (!canonicalChapterId) return "";
	const node = nodes?.find(
		(candidate) => String(candidate.id ?? "").trim() === `chapter-seed-${canonicalChapterId}`,
	);
	const chapterText = readRecord(node?.data)?.chapterText;
	return typeof chapterText === "string" ? chapterText : "";
}

function validateAuthoritativePromptDelivery(input: {
	nodes: Array<UnknownRecord> | null;
	runId: string;
	expectedClipCount: number;
}): { verifiedClipCount: number; errors: string[] } {
	const errors: string[] = [];
	let verifiedClipCount = 0;
	for (let clipIndex = 0; clipIndex < input.expectedClipCount; clipIndex += 1) {
		const node = input.nodes?.find((candidate) => {
			const data = readRecord(candidate.data);
			return String(data?.clipRunId ?? "").trim() === input.runId &&
				Number(data?.clipIndex) === clipIndex &&
				String(data?.kind ?? "").trim().toLowerCase() === "video";
		});
		const data = readRecord(node?.data);
		if (!data || String(data.status ?? "").trim().toLowerCase() !== "success") {
			errors.push(`clip=${clipIndex} 缺少成功视频节点的权威提示词交付证据`);
			continue;
		}
		const prompt = typeof data.prompt === "string" ? data.prompt : "";
		const negativePrompt = typeof data.negativePrompt === "string" ? data.negativePrompt : "";
		const verification = verifyVideoPromptDeliveryContract({
			rawContract: data.promptDeliveryContract,
			prompt,
			negativePrompt,
		});
		if (!verification.ok || verification.contract === null) {
			errors.push(
				`clip=${clipIndex} 权威提示词交付合同未闭合：${verification.ok ? "contract_missing" : verification.code}`,
			);
			continue;
		}
		verifiedClipCount += 1;
	}
	return { verifiedClipCount, errors };
}

/**
 * Recompute final narrative-fidelity evidence exclusively from persisted,
 * structured facts. The verifier does not inspect prompt wording and does not
 * decide whether prose is dialogue, action, narration, or visual description;
 * that semantic authority remains the agents-authored speech ledger.
 */
export function buildVideoNarrativeDeliveryVerification(input: {
	runId: string;
	chapterId?: string | null;
	nodes: Array<UnknownRecord> | null;
	concatPolicy?: unknown;
	beatSheet: unknown;
	storyPlan: unknown;
	storyPlanDurationSeconds: number | null;
}): VideoNarrativeDeliveryVerification {
	const beatSheet = readRecord(input.beatSheet);
	const meta = readRecord(beatSheet?.meta);
	const deliveryScope = readDeliveryScope(meta?.deliveryScope);
	const beats = Array.isArray(beatSheet?.beats) ? beatSheet.beats : [];
	const chapterText = readChapterSourceText(input.nodes, input.chapterId);
	const coverage = validateSourceCoveragePlan({
		plan: beatSheet?.sourceCoveragePlan,
		expectedBeatCount: beats.length,
		deliveryScope: deliveryScope ?? "",
		chapterText,
	});
	const speechErrors = validateSpeechLedgerAgainstBeats({
		speechLedger: coverage.speechLedger,
		beats,
		deliveryScope: deliveryScope ?? "",
	});
	const executableSpeechAuthority = validateExecutableSpeechAuthority({
		beats,
		storyPlan: input.storyPlan,
	});
	const authoritativePromptDelivery = validateAuthoritativePromptDelivery({
		nodes: input.nodes,
		runId: input.runId,
		expectedClipCount: executableSpeechAuthority.clipCount,
	});
	const beatDurationSeconds = sumBeatDurations(beats);
	const storyPlanDurationSeconds = readPositiveDuration(input.storyPlanDurationSeconds);
	const concatPolicy = readConcatPolicy(input.concatPolicy) ?? readConcatPolicy(
		findCanonicalComposeData(input.nodes, input.runId)?.concatPolicy,
	);
	const checks = {
		persistedBeatSheet: beatSheet !== null && deliveryScope !== null && beats.length > 0,
		sourceCoveragePlan: deliveryScope !== null && coverage.ok,
		speechLedgerConservation:
			deliveryScope !== null && coverage.ok && speechErrors.length === 0,
		executableSpeechAuthority: executableSpeechAuthority.errors.length === 0,
		authoritativePromptDelivery: authoritativePromptDelivery.errors.length === 0,
		plannedDuration:
			beatDurationSeconds !== null &&
			storyPlanDurationSeconds !== null &&
			beatDurationSeconds === storyPlanDurationSeconds,
		explicitConcatPolicy: concatPolicy !== null,
	};
	const missingCriteria = (Object.entries(checks) as Array<[keyof typeof checks, boolean]>)
		.filter(([, satisfied]) => !satisfied)
		.map(([criterion]) => `narrativeFidelity.${criterion}`);
	const diagnostics = [
		...(!deliveryScope ? ["beatSheet.meta.deliveryScope 缺失或非法"] : []),
		...coverage.errors,
		...speechErrors,
		...executableSpeechAuthority.errors,
		...authoritativePromptDelivery.errors,
		...(checks.plannedDuration
			? []
			: [`BeatSheet 总时长与冻结 StoryPlan 不一致或不可验证：beats=${String(beatDurationSeconds)} storyPlan=${String(storyPlanDurationSeconds)}`]),
		...(!concatPolicy ? ["后端成片证据缺少合法的显式 concatPolicy"] : []),
	];
	const satisfied = missingCriteria.length === 0;
	return {
		version: 1,
		satisfied,
		deliveryScope,
		expected: {
			persistedBeatSheet: true,
			sourceCoveragePlan: true,
			speechLedgerConservation: true,
			executableSpeechAuthority: true,
			authoritativePromptDelivery: true,
			plannedDuration: true,
			explicitConcatPolicy: true,
		},
		checks,
		facts: {
			beatCount: beats.length,
			storyPlanClipCount: executableSpeechAuthority.clipCount,
			authoritativePromptClipCount: authoritativePromptDelivery.verifiedClipCount,
			coverageSpanCount: coverage.spans.length,
			speechLedgerLineCount: coverage.speechLedger.length,
			chapterSourceCharacters: chapterText.length,
			beatDurationSeconds,
			storyPlanDurationSeconds,
			concatPolicy,
		},
		missingCriteria,
		diagnostics,
		...(!satisfied
			? { failureReason: "video_narrative_fidelity_verification_not_satisfied" }
			: {}),
	};
}

export function parseVideoNarrativeDeliveryVerification(
	value: unknown,
): VideoNarrativeDeliveryVerification | null {
	const record = readRecord(value);
	const checks = readRecord(record?.checks);
	const expected = readRecord(record?.expected);
	const facts = readRecord(record?.facts);
	if (
		record?.version !== 1 ||
		typeof record.satisfied !== "boolean" ||
		readDeliveryScope(record.deliveryScope) === null ||
		!checks || !expected || !facts ||
		!Array.isArray(record.missingCriteria) ||
		!record.missingCriteria.every((criterion) => typeof criterion === "string") ||
		!Array.isArray(record.diagnostics) ||
		!record.diagnostics.every((diagnostic) => typeof diagnostic === "string")
	) return null;
	const checkKeys = [
		"persistedBeatSheet",
		"sourceCoveragePlan",
		"speechLedgerConservation",
		"executableSpeechAuthority",
		"authoritativePromptDelivery",
		"plannedDuration",
		"explicitConcatPolicy",
	] as const;
	const recomputedMissingCriteria = checkKeys
		.filter((key) => checks[key] !== true)
		.map((key) => `narrativeFidelity.${key}`);
	if (
		checkKeys.some((key) => typeof checks[key] !== "boolean" || expected[key] !== true) ||
		record.satisfied !== checkKeys.every((key) => checks[key] === true) ||
		record.missingCriteria.join("\u0000") !== recomputedMissingCriteria.join("\u0000")
	) return null;
	return record as VideoNarrativeDeliveryVerification;
}
