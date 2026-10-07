import {
	chapterSequenceSchema,
	type AuthoredChapterSequence,
} from "../../../../../packages/schemas/chapter-sequence/index.mjs";
import { validateWorkflowToolArguments } from "./execution.json-schema-validator";
import { freezeWorkflowAuthoritativeSource, resolveWorkflowAuthoritativeSourceLineage } from "./execution.source-lineage";

type JsonRecord = Record<string, unknown>;
export type ChapterSequenceFrozenSource = Readonly<{ sourceId: string; sourceFingerprint: string; content: string }>;

function record(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalText(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value === value.trim();
}

export function frozenChapterSources(deliveryContract: unknown): readonly ChapterSequenceFrozenSource[] {
	if (!record(deliveryContract) || !record(deliveryContract.canvasFacts)
		|| !Array.isArray(deliveryContract.canvasFacts.authoritativeSources)
		|| deliveryContract.canvasFacts.authoritativeSources.length === 0) {
		throw new Error("Chapter sequence requires frozen delivery-contract.canvasFacts.authoritativeSources");
	}
	const sources = deliveryContract.canvasFacts.authoritativeSources.map((raw, index) => {
		if (!record(raw)) throw new Error(`authoritativeSources[${index}] must be a source record`);
		const source = freezeWorkflowAuthoritativeSource(raw);
		if (!canonicalText(source.sourceId) || !canonicalText(source.sourceFingerprint)
			|| typeof source.content !== "string" || !source.content.trim()) {
			throw new Error(`authoritativeSources[${index}] requires sourceId, sourceFingerprint and content`);
		}
		return { sourceId: source.sourceId, sourceFingerprint: source.sourceFingerprint, content: source.content };
	});
	resolveWorkflowAuthoritativeSourceLineage(sources);
	return sources;
}

export function parseAuthoredChapterSequence(value: unknown): AuthoredChapterSequence {
	const candidate = record(value) && typeof value.text === "string" ? value.text : value;
	let parsed: unknown;
	try {
		parsed = typeof candidate === "string" ? JSON.parse(candidate) : candidate;
	} catch {
		throw new Error("chapter-sequence must be one valid JSON object");
	}
	const issues = validateWorkflowToolArguments(chapterSequenceSchema, parsed);
	if (issues.length > 0) throw new Error(`chapter-sequence: ${issues.map((issue) => issue.message).join(" | ")}`);
	return parsed as AuthoredChapterSequence;
}
