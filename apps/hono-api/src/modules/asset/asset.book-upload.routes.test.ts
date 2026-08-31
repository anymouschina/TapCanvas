import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sha256Hex } from "./book-content-hash";
import {
	BookEvidenceError,
	searchBookEvidence,
} from "./book-evidence-index";
import {
	appendUploadChunk,
	buildBookDirectory,
	buildUploadSessionMetaPath,
	buildUploadSourcePath,
	cleanupBookUploadTestRepo,
	createBookUploadTestApp,
	finishUpload,
	type FinishUploadResponse,
	getBookUploadRouteTestMocks,
	readJson,
	resetBookUploadTestRepo,
	startUpload,
	TEST_PROJECT_ID,
	type UploadJob,
	waitForPathMissing,
	waitForReconfirmWorker,
	waitForUploadJob,
} from "./asset.book-upload.routes.test-fixture";

describe("assetRouter book upload integration", () => {
	let repoRoot = "";

	beforeEach(async () => {
		repoRoot = await resetBookUploadTestRepo();
	});

	afterEach(async () => {
		await cleanupBookUploadTestRepo(repoRoot);
	});

	it("preserves raw bytes, builds verifiable evidence, and reuses the finalized job", async () => {
		const app = createBookUploadTestApp();
		const rawText = [
			"第一章 雨夜",
			"林舟推开门，潮湿的风吹灭了灯。",
			"",
			"第二章 密室",
			"银钥匙藏在旧钟背后，只有林舟知道。",
		].join("\n");
		const sourceBytes = new TextEncoder().encode(rawText);
		const started = await startUpload({
			app,
			title: "雨夜密室",
			sourceFileName: "雨夜密室.txt",
			contentBytes: sourceBytes.byteLength,
		});

		const splitOffset = 5;
		const firstAppend = await appendUploadChunk({
			app,
			uploadId: started.uploadId,
			offset: 0,
			bytes: sourceBytes.slice(0, splitOffset),
		});
		expect(firstAppend.status, await firstAppend.text()).toBe(200);
		const secondAppend = await appendUploadChunk({
			app,
			uploadId: started.uploadId,
			offset: splitOffset,
			bytes: sourceBytes.slice(splitOffset),
		});
		expect(secondAppend.status, await secondAppend.text()).toBe(200);

		const firstFinish = await finishUpload({ app, uploadId: started.uploadId });
		const firstFinishPayload = await readJson<FinishUploadResponse>(firstFinish);
		expect(firstFinish.status, JSON.stringify(firstFinishPayload)).toBe(202);
		expect(firstFinishPayload).toMatchObject({ ok: true, reused: false });

		const queuedRetry = await finishUpload({ app, uploadId: started.uploadId });
		const queuedRetryPayload = await readJson<FinishUploadResponse>(queuedRetry);
		expect(queuedRetry.status, JSON.stringify(queuedRetryPayload)).toBe(202);
		expect(queuedRetryPayload).toMatchObject({
			ok: true,
			reused: true,
			job: { id: firstFinishPayload.job.id },
		});

		const terminalJob = await waitForUploadJob({
			app,
			jobId: firstFinishPayload.job.id,
		});
		expect(terminalJob.status, JSON.stringify(terminalJob.error)).toBe("succeeded");
		expect(terminalJob.result).toMatchObject({
			ok: true,
			title: "雨夜密室",
			chapterCount: 2,
			processedBy: "agents-cli-on-demand",
		});
		if (!terminalJob.result) {
			throw new Error("succeeded upload job is missing its result");
		}

		await waitForReconfirmWorker({
			app,
			bookId: terminalJob.result.bookId,
		});
		await waitForPathMissing(buildUploadSourcePath(repoRoot, started.uploadId));
		const finalizedSession = JSON.parse(
			await fs.readFile(
				buildUploadSessionMetaPath(repoRoot, started.uploadId),
				"utf8",
			),
		) as { finalizedJobId?: string };
		expect(finalizedSession.finalizedJobId).toBe(firstFinishPayload.job.id);

		const completedRetry = await finishUpload({ app, uploadId: started.uploadId });
		const completedRetryPayload = await readJson<FinishUploadResponse>(completedRetry);
		expect(completedRetry.status, JSON.stringify(completedRetryPayload)).toBe(200);
		expect(completedRetryPayload).toMatchObject({
			ok: true,
			reused: true,
			job: {
				id: firstFinishPayload.job.id,
				status: "succeeded",
			},
		});

		const bookDirectory = buildBookDirectory(repoRoot, terminalJob.result.bookId);
		const storedSource = new Uint8Array(
			await fs.readFile(path.join(bookDirectory, "source", "original.txt")),
		);
		expect(storedSource).toEqual(sourceBytes);
		expect(await fs.readFile(path.join(bookDirectory, "raw.md"), "utf8")).toBe(rawText);
		const persistedIndex = JSON.parse(
			await fs.readFile(path.join(bookDirectory, "index.json"), "utf8"),
		) as {
			source?: {
				originalFileName?: string;
				sourceByteLength?: number;
				sourceSha256?: string;
				sourceTextSha256?: string;
			};
			evidenceIndex?: {
				schemaVersion?: string;
				sourceTextSha256?: string;
				segmentCount?: number;
			};
		};
		expect(persistedIndex.source).toMatchObject({
			originalFileName: "雨夜密室.txt",
			sourceByteLength: sourceBytes.byteLength,
			sourceSha256: sha256Hex(sourceBytes),
			sourceTextSha256: sha256Hex(rawText),
		});
		expect(persistedIndex.evidenceIndex).toMatchObject({
			schemaVersion: "book-evidence-index/v1",
			sourceTextSha256: sha256Hex(rawText),
			segmentCount: 2,
		});

		const evidence = await searchBookEvidence({
			bookDirectory,
			query: "银钥匙",
			chapterStart: 2,
			chapterEnd: 2,
		});
		expect(evidence).toMatchObject({
			schemaVersion: "book-evidence-search/v1",
			bookId: terminalJob.result.bookId,
			projectId: TEST_PROJECT_ID,
		});
		expect(evidence.results).toHaveLength(1);
		const hit = evidence.results[0];
		expect(hit.quote).toContain("银钥匙藏在旧钟背后");
		expect(
			rawText.slice(
				hit.evidence.quoteStartOffset,
				hit.evidence.quoteEndOffset,
			),
		).toBe(hit.quote);

		await fs.writeFile(
			path.join(bookDirectory, "raw.md"),
			`${rawText}\n篡改内容`,
			"utf8",
		);
		await expect(
			searchBookEvidence({
				bookDirectory,
				query: "银钥匙",
				chapterStart: 2,
				chapterEnd: 2,
			}),
		).rejects.toMatchObject({
			name: BookEvidenceError.name,
			code: "book_evidence_source_mismatch",
		});

		expect(getBookUploadRouteTestMocks().createAssetRow).toHaveBeenCalledTimes(1);
		expect(getBookUploadRouteTestMocks().upsertChaptersFromBook).toHaveBeenCalledTimes(1);
	});

	it("retains the same explicit failure for retries after asynchronous parsing fails", async () => {
		const app = createBookUploadTestApp();
		const invalidUtf8 = new Uint8Array([0xff, 0xfe, 0xfd]);
		const started = await startUpload({
			app,
			title: "非法编码",
			sourceFileName: "invalid-utf8.txt",
			contentBytes: invalidUtf8.byteLength,
		});
		const append = await appendUploadChunk({
			app,
			uploadId: started.uploadId,
			offset: 0,
			bytes: invalidUtf8,
		});
		expect(append.status, await append.text()).toBe(200);

		const finish = await finishUpload({ app, uploadId: started.uploadId });
		const finishPayload = await readJson<FinishUploadResponse>(finish);
		expect(finish.status, JSON.stringify(finishPayload)).toBe(202);
		const terminalJob = await waitForUploadJob({
			app,
			jobId: finishPayload.job.id,
		});
		expect(terminalJob).toMatchObject({
			id: finishPayload.job.id,
			status: "failed",
			error: {
				code: "BOOK_SOURCE_INVALID_UTF8",
			},
		});
		await waitForPathMissing(buildUploadSourcePath(repoRoot, started.uploadId));

		const retry = await finishUpload({ app, uploadId: started.uploadId });
		const retryPayload = await readJson<{
			code: string;
			job: UploadJob;
		}>(retry);
		expect(retry.status, JSON.stringify(retryPayload)).toBe(409);
		expect(retryPayload).toMatchObject({
			code: "BOOK_UPLOAD_FINALIZED_JOB_FAILED",
			job: {
				id: finishPayload.job.id,
				status: "failed",
				error: {
					code: "BOOK_SOURCE_INVALID_UTF8",
				},
			},
		});
		expect(getBookUploadRouteTestMocks().createAssetRow).not.toHaveBeenCalled();
	});
});
