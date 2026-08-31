import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { sha256Hex } from "./book-content-hash";
import {
	buildBookEvidenceIndex,
	searchBookEvidence,
	writeBookEvidenceIndex,
} from "./book-evidence-index";
import type { BookSourceMetadataV1 } from "./book-source-parser";

const temporaryDirectories: string[] = [];

async function makeBookDirectory(): Promise<string> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tapcanvas-book-evidence-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			fs.rm(directory, { recursive: true, force: true }),
		),
	);
});

function buildSourceMetadata(rawText: string): BookSourceMetadataV1 {
	return {
		schemaVersion: "book-source/v1",
		originalFileName: "story.txt",
		format: "plain_text",
		mediaType: "text/plain",
		sourceByteLength: Buffer.byteLength(rawText, "utf8"),
		sourceSha256: sha256Hex(rawText),
		sourceTextSha256: sha256Hex(rawText),
		sourceEncoding: "utf-8",
		extractedDocumentCount: 1,
	};
}

describe("book-evidence-index", () => {
	it("returns exact, hash-verifiable book evidence scoped by chapter", async () => {
		const chapterOne = "第一章 雨夜\n林舟在门边等雨停。";
		const chapterTwo = "第二章 密室\n银钥匙藏在旧钟背后，只有顾遥知道。";
		const rawText = `${chapterOne}\n\n${chapterTwo}`;
		const chapterTwoStart = rawText.indexOf(chapterTwo);
		const bookDirectory = await makeBookDirectory();
		await fs.writeFile(path.join(bookDirectory, "raw.md"), rawText, "utf8");
		const index = buildBookEvidenceIndex({
			bookId: "book-1",
			projectId: "project-1",
			title: "雨夜",
			rawText,
			chapters: [
				{
					chapter: 1,
					title: "第一章 雨夜",
					startOffset: 0,
					endOffset: chapterTwoStart - 2,
				},
				{
					chapter: 2,
					title: "第二章 密室",
					startOffset: chapterTwoStart,
					endOffset: rawText.length,
				},
			],
			source: buildSourceMetadata(rawText),
			nowIso: "2026-07-31T00:00:00.000Z",
		});
		const summary = await writeBookEvidenceIndex({ bookDirectory, index });

		const response = await searchBookEvidence({
			bookDirectory,
			query: "银钥匙在哪里",
			chapterStart: 2,
			chapterEnd: 2,
			limit: 3,
		});

		expect(summary).toMatchObject({
			schemaVersion: "book-evidence-index/v1",
			sourceTextSha256: sha256Hex(rawText),
			segmentCount: 2,
		});
		expect(response.schemaVersion).toBe("book-evidence-search/v1");
		expect(response.searchedSegmentCount).toBe(1);
		expect(response.results).toHaveLength(1);
		const result = response.results[0];
		expect(result.quote).toContain("银钥匙藏在旧钟背后");
		expect(result.evidence).toMatchObject({
			schemaVersion: "book-evidence-ref/v1",
			bookId: "book-1",
			projectId: "project-1",
			chapter: 2,
			sourceTextSha256: sha256Hex(rawText),
			quoteSha256: sha256Hex(result.quote),
		});
		expect(
			rawText.slice(
				result.evidence.quoteStartOffset,
				result.evidence.quoteEndOffset,
			),
		).toBe(result.quote);
	});

	it("returns an empty result set without inventing fallback evidence", async () => {
		const rawText = "第一章 雨夜\n林舟在门边等雨停。";
		const bookDirectory = await makeBookDirectory();
		await fs.writeFile(path.join(bookDirectory, "raw.md"), rawText, "utf8");
		const index = buildBookEvidenceIndex({
			bookId: "book-1",
			projectId: "project-1",
			title: "雨夜",
			rawText,
			chapters: [
				{
					chapter: 1,
					title: "第一章 雨夜",
					startOffset: 0,
					endOffset: rawText.length,
				},
			],
			source: buildSourceMetadata(rawText),
		});
		await writeBookEvidenceIndex({ bookDirectory, index });

		const response = await searchBookEvidence({
			bookDirectory,
			query: "火星殖民地",
		});

		expect(response.results).toEqual([]);
	});

	it("refuses stale evidence when raw.md no longer matches the indexed source", async () => {
		const rawText = "第一章 雨夜\n林舟在门边等雨停。";
		const bookDirectory = await makeBookDirectory();
		await fs.writeFile(path.join(bookDirectory, "raw.md"), rawText, "utf8");
		const index = buildBookEvidenceIndex({
			bookId: "book-1",
			projectId: "project-1",
			title: "雨夜",
			rawText,
			chapters: [
				{
					chapter: 1,
					title: "第一章 雨夜",
					startOffset: 0,
					endOffset: rawText.length,
				},
			],
			source: buildSourceMetadata(rawText),
		});
		await writeBookEvidenceIndex({ bookDirectory, index });
		await fs.writeFile(path.join(bookDirectory, "raw.md"), `${rawText}\n正文被改动`, "utf8");

		await expect(
			searchBookEvidence({ bookDirectory, query: "林舟" }),
			).rejects.toMatchObject({
				code: "book_evidence_source_mismatch",
			});
	});

	it("rejects a corrupted selected segment even when that segment would not rank", async () => {
		const chapterOne = "第一章 雨夜\n林舟在门边等雨停。";
		const chapterTwo = "第二章 清晨\n顾遥沿着河岸慢慢回家。";
		const rawText = `${chapterOne}\n\n${chapterTwo}`;
		const chapterTwoStart = rawText.indexOf(chapterTwo);
		const bookDirectory = await makeBookDirectory();
		await fs.writeFile(path.join(bookDirectory, "raw.md"), rawText, "utf8");
		const index = buildBookEvidenceIndex({
			bookId: "book-1",
			projectId: "project-1",
			title: "雨夜",
			rawText,
			chapters: [
				{
					chapter: 1,
					title: "第一章 雨夜",
					startOffset: 0,
					endOffset: chapterTwoStart - 2,
				},
				{
					chapter: 2,
					title: "第二章 清晨",
					startOffset: chapterTwoStart,
					endOffset: rawText.length,
				},
			],
			source: buildSourceMetadata(rawText),
		});
		const secondSegment = index.segments[1];
		expect(secondSegment).toBeDefined();
		if (!secondSegment) throw new Error("second evidence segment is required");
		secondSegment.contentSha256 = "0".repeat(64);
		await writeBookEvidenceIndex({ bookDirectory, index });

		await expect(
			searchBookEvidence({ bookDirectory, query: "林舟" }),
		).rejects.toMatchObject({
			code: "book_evidence_source_mismatch",
			details: { evidenceId: secondSegment.evidenceId },
		});
	});
});
