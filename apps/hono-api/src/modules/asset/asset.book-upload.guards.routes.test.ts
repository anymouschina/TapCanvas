import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	appendUploadChunk,
	buildUploadSourcePath,
	cleanupBookUploadTestRepo,
	createBookUploadTestApp,
	finishUpload,
	getBookUploadRouteTestMocks,
	readJson,
	resetBookUploadTestRepo,
	startUpload,
} from "./asset.book-upload.routes.test-fixture";

describe("assetRouter book upload guards", () => {
	let repoRoot = "";

	beforeEach(async () => {
		repoRoot = await resetBookUploadTestRepo();
	});

	afterEach(async () => {
		await cleanupBookUploadTestRepo(repoRoot);
	});

	it("rejects cross-project access, invalid content type, duplicate offsets, and disk tampering", async () => {
		const app = createBookUploadTestApp();
		const sourceBytes = new TextEncoder().encode("第一章 雨夜\n林舟推开门。");
		const started = await startUpload({
			app,
			title: "上传一致性",
			sourceFileName: "consistency.md",
			contentBytes: sourceBytes.byteLength,
		});

		const crossProjectAppend = await appendUploadChunk({
			app,
			uploadId: started.uploadId,
			projectId: "different-project",
			offset: 0,
			bytes: sourceBytes,
		});
		expect(crossProjectAppend.status).toBe(404);
		expect(await readJson<{ error: string }>(crossProjectAppend)).toMatchObject({
			error: "upload session not found",
		});
		const crossProjectFinish = await finishUpload({
			app,
			uploadId: started.uploadId,
			projectId: "different-project",
		});
		expect(crossProjectFinish.status).toBe(404);
		expect(await readJson<{ error: string }>(crossProjectFinish)).toMatchObject({
			error: "upload session not found",
		});

		const invalidContentType = await appendUploadChunk({
			app,
			uploadId: started.uploadId,
			offset: 0,
			bytes: sourceBytes,
			contentType: "text/plain",
		});
		expect(invalidContentType.status).toBe(415);
		expect(await readJson<{ code: string }>(invalidContentType)).toMatchObject({
			code: "BOOK_UPLOAD_CONTENT_TYPE_INVALID",
		});

		const firstHalf = sourceBytes.slice(0, 7);
		const firstAppend = await appendUploadChunk({
			app,
			uploadId: started.uploadId,
			offset: 0,
			bytes: firstHalf,
		});
		expect(firstAppend.status, await firstAppend.text()).toBe(200);

		const duplicateOffset = await appendUploadChunk({
			app,
			uploadId: started.uploadId,
			offset: 0,
			bytes: sourceBytes.slice(7),
		});
		expect(duplicateOffset.status).toBe(409);
		expect(await readJson<{ code: string; expectedOffset: number }>(duplicateOffset)).toEqual(
			expect.objectContaining({
				code: "BOOK_UPLOAD_OFFSET_MISMATCH",
				expectedOffset: firstHalf.byteLength,
			}),
		);

		const finalAppend = await appendUploadChunk({
			app,
			uploadId: started.uploadId,
			offset: firstHalf.byteLength,
			bytes: sourceBytes.slice(firstHalf.byteLength),
		});
		expect(finalAppend.status, await finalAppend.text()).toBe(200);

		const sourcePath = buildUploadSourcePath(repoRoot, started.uploadId);
		await fs.appendFile(sourcePath, new Uint8Array([0x21]));

		const finish = await finishUpload({ app, uploadId: started.uploadId });
		expect(finish.status).toBe(409);
		expect(await readJson<{ code: string; storedBytes: number }>(finish)).toMatchObject({
			code: "BOOK_UPLOAD_SIZE_MISMATCH",
			storedBytes: sourceBytes.byteLength + 1,
		});
		expect(getBookUploadRouteTestMocks().createAssetRow).not.toHaveBeenCalled();
	});

	it("serializes concurrent same-offset appends without duplicating bytes", async () => {
		const app = createBookUploadTestApp();
		const sourceBytes = new TextEncoder().encode("第一章 并发\n只允许写入一次。");
		const started = await startUpload({
			app,
			title: "并发上传",
			sourceFileName: "concurrent.txt",
			contentBytes: sourceBytes.byteLength,
		});

		const responses = await Promise.all([
			appendUploadChunk({
				app,
				uploadId: started.uploadId,
				offset: 0,
				bytes: sourceBytes,
			}),
			appendUploadChunk({
				app,
				uploadId: started.uploadId,
				offset: 0,
				bytes: sourceBytes,
			}),
		]);
		expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
		const failedResponse = responses.find((response) => response.status === 409);
		if (!failedResponse) {
			throw new Error("concurrent upload did not expose its rejected response");
		}
		expect([
			"BOOK_UPLOAD_OFFSET_MISMATCH",
			"BOOK_UPLOAD_SESSION_BUSY",
		]).toContain((await readJson<{ code: string }>(failedResponse)).code);

		const sourcePath = buildUploadSourcePath(repoRoot, started.uploadId);
		expect(new Uint8Array(await fs.readFile(sourcePath))).toEqual(sourceBytes);
	});
});
