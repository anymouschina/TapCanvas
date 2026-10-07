import type { AppContext } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { listProjectChaptersForUser } from "../chapter/chapter.service";
import { decodeWorkflowOutput } from "./execution.output-storage";
import {
	listSuccessfulNodeRunsForOwnerCanvas,
} from "./execution.repo";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as JsonRecord : null;
}

function nonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

export type PreviousChapterExitEvidence = Readonly<{
	chapterId: string;
	sourceBookId: string;
	sourceBookChapter: number;
	executionId: string;
	clipId: string;
	state: string;
	visual: string;
}>;

/** Read a successfully authored last Clip, even when later media work failed. */
export function extractLastChapterSequenceExit(output: unknown): Readonly<{
	clipId: string; state: string; visual: string;
}> | null {
	const artifacts = record(output)?.artifacts;
	if (!Array.isArray(artifacts)) return null;
	const sequence = artifacts.map(record).find((artifact) => artifact?.type === "tapcanvas.chapter-sequence-bound/v2");
	const clips = record(sequence?.value)?.clips;
	if (!Array.isArray(clips) || clips.length === 0) return null;
	const last = record(clips.at(-1));
	const end = record(last?.endKeyframe);
	const clipId = nonEmptyString(last?.clipId);
	const state = nonEmptyString(end?.state);
	const visual = nonEmptyString(end?.visual);
	return clipId && state && visual ? { clipId, state, visual } : null;
}

export async function loadPreviousChapterExitEvidence(input: Readonly<{
	c: AppContext;
	ownerId: string;
	projectId: string;
	currentChapter: Readonly<{ sourceBookId?: string | null; sourceBookChapter?: number | null }>;
}>): Promise<PreviousChapterExitEvidence | null> {
	const sourceBookId = nonEmptyString(input.currentChapter.sourceBookId);
	const sourceBookChapter = input.currentChapter.sourceBookChapter;
	if (!sourceBookId || typeof sourceBookChapter !== "number" || !Number.isInteger(sourceBookChapter) || sourceBookChapter <= 1) return null;
	const chapters = await listProjectChaptersForUser(input.c, input.ownerId, input.projectId);
	const previous = chapters.find((chapter) => (
		chapter.sourceBookId === sourceBookId && chapter.sourceBookChapter === sourceBookChapter - 1
	));
	if (!previous) return null;
	const db = getPrismaClient();
	const runs = await listSuccessfulNodeRunsForOwnerCanvas(db, {
		ownerId: input.ownerId,
		canvasId: `chapter:${previous.id}`,
	});
	for (const run of runs) {
		const exit = extractLastChapterSequenceExit(decodeWorkflowOutput(run.output_refs));
		if (!exit) continue;
		return {
			chapterId: previous.id,
			sourceBookId,
			sourceBookChapter: sourceBookChapter - 1,
			executionId: run.execution_id,
			...exit,
		};
	}
	return null;
}
