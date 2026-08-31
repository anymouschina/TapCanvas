import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { sha256Hex } from "./book-content-hash";
import type { BookSourceMetadataV1 } from "./book-source-parser";

const EVIDENCE_INDEX_FILE_NAME = "evidence-index.json";
const SEGMENT_MAX_CHARS = 2_200;
const SEGMENT_OVERLAP_CHARS = 280;
const QUOTE_MAX_CHARS = 720;
const MAX_SEARCH_QUERY_CHARS = 500;
const MAX_SEARCH_RESULTS = 20;

export type BookEvidenceChapterSource = {
	chapter: number;
	title: string;
	startOffset: number;
	endOffset: number;
};

export type BookEvidenceSegmentV1 = {
	evidenceId: string;
	chapter: number;
	chapterTitle: string;
	segmentIndex: number;
	startOffset: number;
	endOffset: number;
	contentSha256: string;
	characterCount: number;
};

export type BookEvidenceIndexV1 = {
	schemaVersion: "book-evidence-index/v1";
	bookId: string;
	projectId: string;
	title: string;
	sourceFileSha256: string;
	sourceTextSha256: string;
	sourceTextCharacterCount: number;
	segmentCount: number;
	builtAt: string;
	segments: BookEvidenceSegmentV1[];
};

export type BookEvidenceIndexSummaryV1 = {
	schemaVersion: "book-evidence-index/v1";
	path: string;
	sourceTextSha256: string;
	segmentCount: number;
	builtAt: string;
};

export type BookEvidenceRefV1 = {
	schemaVersion: "book-evidence-ref/v1";
	bookId: string;
	projectId: string;
	evidenceId: string;
	chapter: number;
	chapterTitle: string;
	sourceTextSha256: string;
	segmentStartOffset: number;
	segmentEndOffset: number;
	segmentSha256: string;
	quoteStartOffset: number;
	quoteEndOffset: number;
	quoteSha256: string;
};

export type BookEvidenceSearchResultV1 = {
	score: number;
	quote: string;
	evidence: BookEvidenceRefV1;
};

export type BookEvidenceSearchResponseV1 = {
	schemaVersion: "book-evidence-search/v1";
	bookId: string;
	projectId: string;
	query: string;
	sourceTextSha256: string;
	evidenceIndexSha256: string;
	searchedSegmentCount: number;
	results: BookEvidenceSearchResultV1[];
};

export type BookEvidenceErrorCode =
	| "book_evidence_index_invalid"
	| "book_evidence_index_not_found"
	| "book_evidence_query_invalid"
	| "book_evidence_source_mismatch"
	| "book_evidence_source_not_found";

export class BookEvidenceError extends Error {
	readonly code: BookEvidenceErrorCode;
	readonly details?: Record<string, unknown>;

	constructor(
		code: BookEvidenceErrorCode,
		message: string,
		details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "BookEvidenceError";
		this.code = code;
		this.details = details;
	}
}

type ScoredSegment = {
	segment: BookEvidenceSegmentV1;
	text: string;
	score: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readNonNegativeInteger(value: unknown): number | null {
	const numeric = Number(value);
	return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

function isWhitespace(value: string): boolean {
	return /\s/u.test(value);
}

function trimBounds(
	rawText: string,
	startOffset: number,
	endOffset: number,
): { startOffset: number; endOffset: number } {
	let start = Math.max(0, startOffset);
	let end = Math.min(rawText.length, Math.max(start, endOffset));
	while (start < end && isWhitespace(rawText[start] || "")) start += 1;
	while (end > start && isWhitespace(rawText[end - 1] || "")) end -= 1;
	return { startOffset: start, endOffset: end };
}

function resolveSegmentEnd(rawText: string, startOffset: number, chapterEndOffset: number): number {
	const hardEnd = Math.min(chapterEndOffset, startOffset + SEGMENT_MAX_CHARS);
	if (hardEnd >= chapterEndOffset) return chapterEndOffset;
	const preferredFloor = startOffset + Math.floor(SEGMENT_MAX_CHARS * 0.58);
	const paragraphBoundary = rawText.lastIndexOf("\n\n", hardEnd);
	if (paragraphBoundary >= preferredFloor) return paragraphBoundary + 2;
	const lineBoundary = rawText.lastIndexOf("\n", hardEnd);
	if (lineBoundary >= preferredFloor) return lineBoundary + 1;
	return hardEnd;
}

function buildChapterSegments(input: {
	rawText: string;
	bookId: string;
	chapter: BookEvidenceChapterSource;
}): BookEvidenceSegmentV1[] {
	const chapterStart = Math.max(0, Math.min(input.rawText.length, input.chapter.startOffset));
	const chapterEnd = Math.max(
		chapterStart,
		Math.min(input.rawText.length, input.chapter.endOffset),
	);
	const segments: BookEvidenceSegmentV1[] = [];
	let cursor = chapterStart;
	let segmentIndex = 1;
	while (cursor < chapterEnd) {
		const proposedEnd = resolveSegmentEnd(input.rawText, cursor, chapterEnd);
		const bounds = trimBounds(input.rawText, cursor, proposedEnd);
		if (bounds.endOffset > bounds.startOffset) {
			const text = input.rawText.slice(bounds.startOffset, bounds.endOffset);
			const contentSha256 = sha256Hex(text);
			segments.push({
				evidenceId: [
					"evidence",
					String(input.chapter.chapter),
					String(segmentIndex),
					contentSha256.slice(0, 16),
				].join("-"),
				chapter: input.chapter.chapter,
				chapterTitle: input.chapter.title,
				segmentIndex,
				startOffset: bounds.startOffset,
				endOffset: bounds.endOffset,
				contentSha256,
				characterCount: text.length,
			});
			segmentIndex += 1;
		}
		if (proposedEnd >= chapterEnd) break;
		const nextCursor = Math.max(cursor + 1, proposedEnd - SEGMENT_OVERLAP_CHARS);
		cursor = Math.min(chapterEnd, nextCursor);
	}
	return segments;
}

export function buildBookEvidenceIndex(input: {
	bookId: string;
	projectId: string;
	title: string;
	rawText: string;
	chapters: readonly BookEvidenceChapterSource[];
	source: BookSourceMetadataV1;
	nowIso?: string;
}): BookEvidenceIndexV1 {
	const sourceTextSha256 = sha256Hex(input.rawText);
	if (sourceTextSha256 !== input.source.sourceTextSha256) {
		throw new BookEvidenceError(
			"book_evidence_source_mismatch",
			"构建证据索引时发现正文 SHA 与书籍源元数据不一致",
			{
				expectedSha256: input.source.sourceTextSha256,
				actualSha256: sourceTextSha256,
			},
		);
	}
	const orderedChapters = input.chapters
		.slice()
		.sort((left, right) => left.chapter - right.chapter);
	const segments = orderedChapters.flatMap((chapter) =>
		buildChapterSegments({
			rawText: input.rawText,
			bookId: input.bookId,
			chapter,
		}),
	);
	if (segments.length === 0) {
		throw new BookEvidenceError(
			"book_evidence_index_invalid",
			"书籍没有可建立证据索引的章节正文",
		);
	}
	return {
		schemaVersion: "book-evidence-index/v1",
		bookId: input.bookId,
		projectId: input.projectId,
		title: input.title,
		sourceFileSha256: input.source.sourceSha256,
		sourceTextSha256,
		sourceTextCharacterCount: input.rawText.length,
		segmentCount: segments.length,
		builtAt: input.nowIso || new Date().toISOString(),
		segments,
	};
}

export function buildBookEvidenceIndexPath(bookDirectory: string): string {
	return path.join(bookDirectory, EVIDENCE_INDEX_FILE_NAME);
}

export async function writeBookEvidenceIndex(input: {
	bookDirectory: string;
	index: BookEvidenceIndexV1;
}): Promise<BookEvidenceIndexSummaryV1> {
	const indexPath = buildBookEvidenceIndexPath(input.bookDirectory);
	const temporaryPath = `${indexPath}.${process.pid}.${randomUUID()}.tmp`;
	await fs.mkdir(input.bookDirectory, { recursive: true });
	await fs.writeFile(temporaryPath, JSON.stringify(input.index, null, 2), "utf8");
	await fs.rename(temporaryPath, indexPath);
	return {
		schemaVersion: input.index.schemaVersion,
		path: path.relative(process.cwd(), indexPath),
		sourceTextSha256: input.index.sourceTextSha256,
		segmentCount: input.index.segmentCount,
		builtAt: input.index.builtAt,
	};
}

function parseEvidenceSegment(value: unknown, sourceLength: number): BookEvidenceSegmentV1 | null {
	if (!isRecord(value)) return null;
	const evidenceId = readString(value.evidenceId);
	const chapter = readNonNegativeInteger(value.chapter);
	const chapterTitle = readString(value.chapterTitle);
	const segmentIndex = readNonNegativeInteger(value.segmentIndex);
	const startOffset = readNonNegativeInteger(value.startOffset);
	const endOffset = readNonNegativeInteger(value.endOffset);
	const contentSha256 = readString(value.contentSha256);
	const characterCount = readNonNegativeInteger(value.characterCount);
	if (
		!evidenceId ||
		chapter === null ||
		chapter < 1 ||
		!chapterTitle ||
		segmentIndex === null ||
		segmentIndex < 1 ||
		startOffset === null ||
		endOffset === null ||
		endOffset <= startOffset ||
		endOffset > sourceLength ||
		!/^[a-f0-9]{64}$/u.test(contentSha256) ||
		characterCount === null ||
		characterCount !== endOffset - startOffset
	) {
		return null;
	}
	return {
		evidenceId,
		chapter,
		chapterTitle,
		segmentIndex,
		startOffset,
		endOffset,
		contentSha256,
		characterCount,
	};
}

function parseBookEvidenceIndex(value: unknown): BookEvidenceIndexV1 {
	if (!isRecord(value) || value.schemaVersion !== "book-evidence-index/v1") {
		throw new BookEvidenceError(
			"book_evidence_index_invalid",
			"书籍证据索引 schemaVersion 无效",
		);
	}
	const bookId = readString(value.bookId);
	const projectId = readString(value.projectId);
	const title = readString(value.title);
	const sourceFileSha256 = readString(value.sourceFileSha256);
	const sourceTextSha256 = readString(value.sourceTextSha256);
	const sourceTextCharacterCount = readNonNegativeInteger(value.sourceTextCharacterCount);
	const segmentCount = readNonNegativeInteger(value.segmentCount);
	const builtAt = readString(value.builtAt);
	const rawSegments = Array.isArray(value.segments) ? value.segments : null;
	if (
		!bookId ||
		!projectId ||
		!title ||
		!/^[a-f0-9]{64}$/u.test(sourceFileSha256) ||
		!/^[a-f0-9]{64}$/u.test(sourceTextSha256) ||
		sourceTextCharacterCount === null ||
		segmentCount === null ||
		!builtAt ||
		!rawSegments
	) {
		throw new BookEvidenceError(
			"book_evidence_index_invalid",
			"书籍证据索引缺少必需字段",
		);
	}
	const segments = rawSegments.map((segment) =>
		parseEvidenceSegment(segment, sourceTextCharacterCount),
	);
	if (segments.some((segment) => segment === null)) {
		throw new BookEvidenceError(
			"book_evidence_index_invalid",
			"书籍证据索引包含无效片段",
		);
	}
	const verifiedSegments = segments.filter(
		(segment): segment is BookEvidenceSegmentV1 => segment !== null,
	);
	if (verifiedSegments.length !== segmentCount || segmentCount === 0) {
		throw new BookEvidenceError(
			"book_evidence_index_invalid",
			"书籍证据索引片段数量不一致",
			{ declared: segmentCount, actual: verifiedSegments.length },
		);
	}
	return {
		schemaVersion: "book-evidence-index/v1",
		bookId,
		projectId,
		title,
		sourceFileSha256,
		sourceTextSha256,
		sourceTextCharacterCount,
		segmentCount,
		builtAt,
		segments: verifiedSegments,
	};
}

export async function readBookEvidenceIndex(bookDirectory: string): Promise<BookEvidenceIndexV1> {
	const indexPath = buildBookEvidenceIndexPath(bookDirectory);
	let raw = "";
	try {
		raw = await fs.readFile(indexPath, "utf8");
	} catch (error) {
		const errorCode =
			isRecord(error) && typeof error.code === "string" ? error.code : "";
		if (errorCode === "ENOENT") {
			throw new BookEvidenceError(
				"book_evidence_index_not_found",
				"书籍证据索引不存在；请重新导入或重建书籍索引",
				{ indexPath },
			);
		}
		throw error;
	}
	try {
		return parseBookEvidenceIndex(JSON.parse(raw) as unknown);
	} catch (error) {
		if (error instanceof BookEvidenceError) throw error;
		throw new BookEvidenceError(
			"book_evidence_index_invalid",
			"书籍证据索引不是有效 JSON",
			{ reason: error instanceof Error ? error.message : String(error) },
		);
	}
}

function normalizeForSearch(value: string): string {
	return String(value || "")
		.normalize("NFKC")
		.toLocaleLowerCase("und")
		.replace(/\s+/g, " ")
		.trim();
}

function buildSearchTerms(query: string): string[] {
	const normalizedQuery = normalizeForSearch(query);
	const wordRuns = normalizedQuery.match(/[\p{L}\p{N}]+/gu) || [];
	const candidates: string[] = [...wordRuns];
	for (const run of wordRuns) {
		const hanCharacters = Array.from(run).filter((character) =>
			/\p{Script=Han}/u.test(character),
		);
		if (hanCharacters.length === Array.from(run).length) {
			for (let index = 0; index + 1 < hanCharacters.length; index += 1) {
				candidates.push(hanCharacters.slice(index, index + 2).join(""));
			}
		}
	}
	const seen = new Set<string>();
	const terms: string[] = [];
	for (const candidate of candidates) {
		const term = candidate.trim();
		if (!term || seen.has(term)) continue;
		seen.add(term);
		terms.push(term);
		if (terms.length >= 64) break;
	}
	return terms;
}

function countOccurrences(text: string, term: string): number {
	if (!term) return 0;
	let count = 0;
	let offset = 0;
	while (offset < text.length) {
		const found = text.indexOf(term, offset);
		if (found < 0) break;
		count += 1;
		offset = found + Math.max(1, term.length);
	}
	return count;
}

function verifySelectedSegments(input: {
	rawText: string;
	segments: readonly BookEvidenceSegmentV1[];
}): void {
	for (const segment of input.segments) {
		const actualSegmentText = input.rawText.slice(
			segment.startOffset,
			segment.endOffset,
		);
		const actualSegmentSha256 = sha256Hex(actualSegmentText);
		if (actualSegmentSha256 !== segment.contentSha256) {
			throw new BookEvidenceError(
				"book_evidence_source_mismatch",
				"证据索引片段 SHA 校验失败",
				{
					evidenceId: segment.evidenceId,
					expectedSha256: segment.contentSha256,
					actualSha256: actualSegmentSha256,
				},
			);
		}
	}
}

function scoreSegments(input: {
	rawText: string;
	segments: readonly BookEvidenceSegmentV1[];
	query: string;
	terms: readonly string[];
}): ScoredSegment[] {
	const documents = input.segments.map((segment) => {
		const text = input.rawText.slice(segment.startOffset, segment.endOffset);
		return {
			segment,
			text,
			normalizedText: normalizeForSearch(text),
		};
	});
	if (documents.length === 0) return [];
	const averageLength =
		documents.reduce((total, document) => total + document.normalizedText.length, 0) /
		documents.length;
	const documentFrequency = new Map<string, number>();
	for (const term of input.terms) {
		documentFrequency.set(
			term,
			documents.reduce(
				(count, document) => count + (document.normalizedText.includes(term) ? 1 : 0),
				0,
			),
		);
	}
	const normalizedQuery = normalizeForSearch(input.query);
	const documentCount = documents.length;
	const k1 = 1.5;
	const b = 0.72;
	return documents
		.map((document): ScoredSegment => {
			let score = 0;
			for (const term of input.terms) {
				const termFrequency = countOccurrences(document.normalizedText, term);
				if (termFrequency === 0) continue;
				const frequency = documentFrequency.get(term) || 0;
				const inverseDocumentFrequency = Math.log(
					1 + (documentCount - frequency + 0.5) / (frequency + 0.5),
				);
				const lengthRatio =
					averageLength > 0 ? document.normalizedText.length / averageLength : 1;
				const saturation =
					(termFrequency * (k1 + 1)) /
					(termFrequency + k1 * (1 - b + b * lengthRatio));
				score += inverseDocumentFrequency * saturation;
			}
			if (normalizedQuery && document.normalizedText.includes(normalizedQuery)) {
				score += 2.5;
			}
			return {
				segment: document.segment,
				text: document.text,
				score,
			};
		})
		.filter((result) => result.score > 0)
		.sort(
			(left, right) =>
				right.score - left.score ||
				left.segment.startOffset - right.segment.startOffset,
		);
}

function buildQuote(input: {
	rawText: string;
	scored: ScoredSegment;
	terms: readonly string[];
}): { quote: string; startOffset: number; endOffset: number } {
	const normalizedSegment = input.scored.text.toLocaleLowerCase("und");
	let firstMatch = -1;
	for (const term of input.terms) {
		const candidateOffset = normalizedSegment.indexOf(term.toLocaleLowerCase("und"));
		if (candidateOffset >= 0 && (firstMatch < 0 || candidateOffset < firstMatch)) {
			firstMatch = candidateOffset;
		}
	}
	const center = firstMatch >= 0 ? firstMatch : 0;
	const localStart = Math.max(
		0,
		Math.min(
			input.scored.text.length,
			center - Math.floor(QUOTE_MAX_CHARS * 0.35),
		),
	);
	const localEnd = Math.min(input.scored.text.length, localStart + QUOTE_MAX_CHARS);
	const globalBounds = trimBounds(
		input.rawText,
		input.scored.segment.startOffset + localStart,
		input.scored.segment.startOffset + localEnd,
	);
	return {
		quote: input.rawText.slice(globalBounds.startOffset, globalBounds.endOffset),
		startOffset: globalBounds.startOffset,
		endOffset: globalBounds.endOffset,
	};
}

export async function searchBookEvidence(input: {
	bookDirectory: string;
	query: string;
	chapterStart?: number;
	chapterEnd?: number;
	limit?: number;
}): Promise<BookEvidenceSearchResponseV1> {
	const query = String(input.query || "").trim();
	if (!query || query.length > MAX_SEARCH_QUERY_CHARS) {
		throw new BookEvidenceError(
			"book_evidence_query_invalid",
			`证据检索 query 必须为 1-${MAX_SEARCH_QUERY_CHARS} 个字符`,
		);
	}
	const terms = buildSearchTerms(query);
	if (terms.length === 0) {
		throw new BookEvidenceError(
			"book_evidence_query_invalid",
			"证据检索 query 不包含可检索的文字或数字",
		);
	}
	const index = await readBookEvidenceIndex(input.bookDirectory);
	const rawPath = path.join(input.bookDirectory, "raw.md");
	let rawText = "";
	try {
		rawText = await fs.readFile(rawPath, "utf8");
	} catch (error) {
		throw new BookEvidenceError(
			"book_evidence_source_not_found",
			"书籍 raw.md 不存在，无法验证证据索引",
			{
				rawPath,
				reason: error instanceof Error ? error.message : String(error),
			},
		);
	}
	const actualSourceSha256 = sha256Hex(rawText);
	if (
		actualSourceSha256 !== index.sourceTextSha256 ||
		rawText.length !== index.sourceTextCharacterCount
	) {
		throw new BookEvidenceError(
			"book_evidence_source_mismatch",
			"书籍正文与证据索引版本不一致；拒绝返回不可验证引文",
			{
				expectedSha256: index.sourceTextSha256,
				actualSha256: actualSourceSha256,
				expectedCharacterCount: index.sourceTextCharacterCount,
				actualCharacterCount: rawText.length,
			},
		);
	}
	const chapterStart =
		Number.isInteger(input.chapterStart) && Number(input.chapterStart) > 0
			? Number(input.chapterStart)
			: 1;
	const chapterEnd =
		Number.isInteger(input.chapterEnd) && Number(input.chapterEnd) >= chapterStart
			? Number(input.chapterEnd)
			: Number.POSITIVE_INFINITY;
	if (
		input.chapterStart !== undefined &&
		(!Number.isInteger(input.chapterStart) || input.chapterStart < 1)
	) {
		throw new BookEvidenceError(
			"book_evidence_query_invalid",
			"chapterStart 必须是正整数",
		);
	}
	if (
		input.chapterEnd !== undefined &&
		(!Number.isInteger(input.chapterEnd) || input.chapterEnd < chapterStart)
	) {
		throw new BookEvidenceError(
			"book_evidence_query_invalid",
			"chapterEnd 必须是不小于 chapterStart 的正整数",
		);
	}
	const selectedSegments = index.segments.filter(
		(segment) => segment.chapter >= chapterStart && segment.chapter <= chapterEnd,
	);
	verifySelectedSegments({ rawText, segments: selectedSegments });
	const scored = scoreSegments({
		rawText,
		segments: selectedSegments,
		query,
		terms,
	});
	const limit = Math.min(
		MAX_SEARCH_RESULTS,
		Math.max(1, Number.isInteger(input.limit) ? Number(input.limit) : 8),
	);
	const results = scored.slice(0, limit).map((item): BookEvidenceSearchResultV1 => {
		const quote = buildQuote({ rawText, scored: item, terms });
		return {
			score: Number(item.score.toFixed(6)),
			quote: quote.quote,
			evidence: {
				schemaVersion: "book-evidence-ref/v1",
				bookId: index.bookId,
				projectId: index.projectId,
				evidenceId: item.segment.evidenceId,
				chapter: item.segment.chapter,
				chapterTitle: item.segment.chapterTitle,
				sourceTextSha256: index.sourceTextSha256,
				segmentStartOffset: item.segment.startOffset,
				segmentEndOffset: item.segment.endOffset,
				segmentSha256: item.segment.contentSha256,
				quoteStartOffset: quote.startOffset,
				quoteEndOffset: quote.endOffset,
				quoteSha256: sha256Hex(quote.quote),
			},
		};
	});
	return {
		schemaVersion: "book-evidence-search/v1",
		bookId: index.bookId,
		projectId: index.projectId,
		query,
		sourceTextSha256: index.sourceTextSha256,
		evidenceIndexSha256: sha256Hex(JSON.stringify(index)),
		searchedSegmentCount: selectedSegments.length,
		results,
	};
}
