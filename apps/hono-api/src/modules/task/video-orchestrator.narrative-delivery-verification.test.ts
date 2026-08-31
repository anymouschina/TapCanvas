import { describe, expect, it } from "vitest";
import { normalizeWithMap } from "./video-orchestrator.source-coverage";
import { buildVideoNarrativeDeliveryVerification } from "./video-orchestrator.narrative-delivery-verification";
import { buildVideoPromptDeliveryContract } from "./video-prompt-delivery-contract";

const runId = "run-narrative";
const chapterId = "chapter-1";
const chapterText = "甲说：你好。乙回答：收到。";
const chapterLength = normalizeWithMap(chapterText).norm.length;

function buildBeatSheet(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		version: 2,
		runId,
		meta: { executionScope: "media_delivery", deliveryScope: "full_chapter" },
		sourceCoveragePlan: {
			spans: [{
				clipIndex: 0,
				sourceStartMarker: "甲说",
				sourceEndMarker: "收到。",
				sourceStartOffset: 0,
				sourceEndOffset: chapterLength,
			}],
			speechLedger: [
				{ lineId: "line-1", speakerName: "甲", text: "你好。", sourceMarker: "甲说：你好。" },
				{ lineId: "line-2", speakerName: "乙", text: "收到。", sourceMarker: "乙回答：收到。" },
			],
		},
		beats: [{
			clipIndex: 0,
			durationBudget: 12,
			dialogueScript: [
				{ lineId: "line-1", speakerName: "甲", text: "你好。", delivery: "on_screen" },
				{ lineId: "line-2", speakerName: "乙", text: "收到。", delivery: "on_screen" },
			],
		}],
		...overrides,
	};
}

function buildNodes(concatPolicy: unknown = {
	joinMode: "hard_cut",
	xfadeSeconds: 0,
	colorMatch: false,
}): Array<Record<string, unknown>> {
	const prompt = "【唯一人声轨】〈发声正文〉你好。〈/发声正文〉";
	return [
		{ id: `chapter-seed-${chapterId}`, data: { chapterText } },
		{
			id: `video-${runId}-0`,
			data: {
				kind: "video",
				status: "success",
				clipRunId: runId,
				clipIndex: 0,
				prompt,
				promptDeliveryContract: buildVideoPromptDeliveryContract({ prompt }),
				videoUrl: "https://files.example/clip-0.mp4",
			},
		},
		{
			id: `film-${runId}`,
			data: {
				kind: "composeVideo",
				status: "success",
				clipRunId: runId,
				videoUrl: "https://files.example/final.mp4",
				concatPolicy,
			},
		},
	];
}

function buildStoryPlan(dialogueText = "你好。收到。"): Record<string, unknown> {
	return {
		targetDurationSeconds: 12,
		clips: [{
			durationSeconds: 12,
			speechEvents: [
				{
					speechEventId: "speech-line-1",
					lineId: "line-1",
					speakerName: "甲",
					delivery: "on_screen",
					spokenText: dialogueText.slice(0, 3),
				},
				{
					speechEventId: "speech-line-2",
					lineId: "line-2",
					speakerName: "乙",
					delivery: "on_screen",
					spokenText: dialogueText.slice(3),
				},
			],
		}],
	};
}

describe("buildVideoNarrativeDeliveryVerification", () => {
	it("verifies source coverage, exact speech conservation, duration, and explicit concat policy", () => {
		const result = buildVideoNarrativeDeliveryVerification({
			runId,
			chapterId,
			nodes: buildNodes(),
			beatSheet: buildBeatSheet(),
			storyPlan: buildStoryPlan(),
			storyPlanDurationSeconds: 12,
		});

		expect(result.satisfied).toBe(true);
		expect(result.missingCriteria).toEqual([]);
		expect(result.checks).toEqual({
			persistedBeatSheet: true,
			sourceCoveragePlan: true,
			speechLedgerConservation: true,
			executableSpeechAuthority: true,
			authoritativePromptDelivery: true,
			plannedDuration: true,
			explicitConcatPolicy: true,
		});
		expect(result.facts).toMatchObject({
			beatCount: 1,
			storyPlanClipCount: 1,
			authoritativePromptClipCount: 1,
			coverageSpanCount: 1,
			speechLedgerLineCount: 2,
			storyPlanDurationSeconds: 12,
		});
	});

	it("uses the backend concat policy when the canvas film projection is absent", () => {
		const result = buildVideoNarrativeDeliveryVerification({
			runId,
			chapterId,
			nodes: buildNodes().filter((node) => node.id !== `film-${runId}`),
			concatPolicy: { joinMode: "hard_cut", xfadeSeconds: 0, colorMatch: false },
			beatSheet: buildBeatSheet(),
			storyPlan: buildStoryPlan(),
			storyPlanDurationSeconds: 12,
		});

		expect(result.satisfied).toBe(true);
		expect(result.checks.explicitConcatPolicy).toBe(true);
	});

	it("preserves legacy output evidence but refuses a narrative completion claim without the contracts", () => {
		const result = buildVideoNarrativeDeliveryVerification({
			runId,
			chapterId,
			nodes: buildNodes(null),
			beatSheet: { version: 2, beats: [{ durationBudget: 90 }] },
			storyPlan: { clips: [{}] },
			storyPlanDurationSeconds: 90,
		});

		expect(result.satisfied).toBe(false);
		expect(result.missingCriteria).toEqual(expect.arrayContaining([
			"narrativeFidelity.persistedBeatSheet",
			"narrativeFidelity.sourceCoveragePlan",
			"narrativeFidelity.explicitConcatPolicy",
		]));
	});

	it("detects dialogue deletion or mutation against the agents-authored speech ledger", () => {
		const beatSheet = buildBeatSheet();
		beatSheet.beats = [{
			clipIndex: 0,
			durationBudget: 12,
			dialogueScript: [{
				lineId: "line-1",
				speakerName: "甲",
				text: "早上好。",
				delivery: "voice_over",
			}],
		}];
		const result = buildVideoNarrativeDeliveryVerification({
			runId,
			chapterId,
			nodes: buildNodes(),
			beatSheet,
			storyPlan: buildStoryPlan(),
			storyPlanDurationSeconds: 12,
		});

		expect(result.satisfied).toBe(false);
		expect(result.missingCriteria).toContain("narrativeFidelity.speechLedgerConservation");
		expect(result.diagnostics.join("|")).toMatch(/数量不一致|text 不一致/);
	});

	it("rejects action or rewritten prose injected into executable spoken shots", () => {
		const result = buildVideoNarrativeDeliveryVerification({
			runId,
			chapterId,
			nodes: buildNodes(),
			beatSheet: buildBeatSheet(),
			storyPlan: buildStoryPlan("甲抬手。乙后退。"),
			storyPlanDurationSeconds: 12,
		});

		expect(result.satisfied).toBe(false);
		expect(result.missingCriteria).toContain("narrativeFidelity.executableSpeechAuthority");
		expect(result.diagnostics.join("|")).toContain("必须逐字还原原文");
	});

	it("requires the persisted compose node to expose its actual join policy", () => {
		const result = buildVideoNarrativeDeliveryVerification({
			runId,
			chapterId,
			nodes: buildNodes({ joinMode: "hard_cut", xfadeSeconds: 0 }),
			beatSheet: buildBeatSheet(),
			storyPlan: buildStoryPlan(),
			storyPlanDurationSeconds: 12,
		});

		expect(result.satisfied).toBe(false);
		expect(result.missingCriteria).toContain("narrativeFidelity.explicitConcatPolicy");
	});

	it("rejects a clip whose provider prompt drifted after the structured contract was frozen", () => {
		const nodes = buildNodes();
		const clipData = nodes[1]?.data as Record<string, unknown>;
		clipData.prompt = `${String(clipData.prompt)}（追加固定旁白配置）`;
		const result = buildVideoNarrativeDeliveryVerification({
			runId,
			chapterId,
			nodes,
			beatSheet: buildBeatSheet(),
			storyPlan: buildStoryPlan(),
			storyPlanDurationSeconds: 12,
		});

		expect(result.satisfied).toBe(false);
		expect(result.missingCriteria).toContain("narrativeFidelity.authoritativePromptDelivery");
		expect(result.diagnostics.join("|")).toContain("video_prompt_delivery_prompt_mismatch");
	});
});
