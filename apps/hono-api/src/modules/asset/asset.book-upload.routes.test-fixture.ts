import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Next } from "hono";
import { Hono } from "hono";
import { expect, vi } from "vitest";

import type { AppContext, AppEnv, WorkerEnv } from "../../types";

export const TEST_USER_ID = "book-upload-user";
export const TEST_PROJECT_ID = "book-upload-project";

const bookUploadRouteTestMocks = vi.hoisted(() => ({
	authMiddleware: vi.fn(async (context: AppContext, next: Next) => {
		context.set("userId", "book-upload-user");
		await next();
	}),
	createAssetRow: vi.fn(async () => ({
		id: "book-upload-asset",
		name: "测试小说",
		data: null,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		owner_id: "book-upload-user",
		project_id: "book-upload-project",
	})),
	getProjectForOwner: vi.fn(async () => ({
		id: "book-upload-project",
		owner_id: "book-upload-user",
	})),
	resolveProjectDataRepoRoot: vi.fn(() => ""),
	runAgentsBridgeChatTask: vi.fn(async () => {
		throw new Error("test intentionally stops the asynchronous deep reconfirm job");
	}),
	upsertChaptersFromBook: vi.fn(async () => undefined),
}));

vi.mock("../../middleware/auth", () => ({
	authMiddleware: bookUploadRouteTestMocks.authMiddleware,
	resolveAuth: vi.fn(),
	tryGetUserDbAuthState: vi.fn(),
}));

vi.mock("../project/project.repo", () => ({
	getProjectForOwner: bookUploadRouteTestMocks.getProjectForOwner,
}));

vi.mock("../project/project-activity.repo", () => ({
	touchProjectActivity: vi.fn(async () => undefined),
}));

vi.mock("../chapter/chapter.repo", () => ({
	upsertChaptersFromBook: bookUploadRouteTestMocks.upsertChaptersFromBook,
}));

vi.mock("../task/task.agents-bridge", () => ({
	runAgentsBridgeChatTask: bookUploadRouteTestMocks.runAgentsBridgeChatTask,
}));

vi.mock("./project-data-root", () => ({
	resolveProjectDataRepoRoot: bookUploadRouteTestMocks.resolveProjectDataRepoRoot,
}));

vi.mock("./asset.repo", () => ({
	createAssetRow: bookUploadRouteTestMocks.createAssetRow,
	deleteAssetRow: vi.fn(),
	deleteBookPointerAssetsForUser: vi.fn(),
	getAssetByIdForUser: vi.fn(),
	getGlobalAssetByName: vi.fn(),
	listAssetsForUser: vi.fn(),
	listAssetsForUserByKind: vi.fn(),
	listProjectsTvInfo: vi.fn(),
	listPublicAssets: vi.fn(),
	listPublishRecordAssets: vi.fn(),
	renameAssetRow: vi.fn(),
	updateAssetDataRow: vi.fn(),
}));

import { assetRouter } from "./asset.routes";

export function getBookUploadRouteTestMocks(): typeof bookUploadRouteTestMocks {
	return bookUploadRouteTestMocks;
}

export type StartUploadResponse = {
	ok: boolean;
	uploadId: string;
	projectId: string;
	title: string;
	sourceFileName: string;
};

export type UploadJob = {
	id: string;
	status: "queued" | "running" | "succeeded" | "failed";
	result?: {
		ok: true;
		bookId: string;
		title: string;
		chapterCount: number;
		processedBy: string;
		warnings: string[];
	};
	error?: {
		code: string;
		message: string;
	} | null;
};

export type FinishUploadResponse = {
	ok: boolean;
	reused: boolean;
	job: UploadJob;
};

const TEST_ENV: WorkerEnv = {
	DB: Object.create(null) as WorkerEnv["DB"],
	JWT_SECRET: "book-upload-test-secret",
};

export function createBookUploadTestApp(): Hono<AppEnv> {
	const app = new Hono<AppEnv>();
	app.route("/assets", assetRouter);
	return app;
}

export async function resetBookUploadTestRepo(): Promise<string> {
	vi.clearAllMocks();
	const repoRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), "tapcanvas-book-upload-route-"),
	);
	bookUploadRouteTestMocks.resolveProjectDataRepoRoot.mockReturnValue(repoRoot);
	bookUploadRouteTestMocks.getProjectForOwner.mockResolvedValue({
		id: TEST_PROJECT_ID,
		owner_id: TEST_USER_ID,
	});
	bookUploadRouteTestMocks.runAgentsBridgeChatTask.mockRejectedValue(
		new Error("test intentionally stops the asynchronous deep reconfirm job"),
	);
	return repoRoot;
}

export async function cleanupBookUploadTestRepo(repoRoot: string): Promise<void> {
	await fs.rm(repoRoot, { recursive: true, force: true });
}

export async function readJson<T>(response: Response): Promise<T> {
	return (await response.json()) as T;
}

function toRequestBody(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
}

export async function startUpload(input: {
	app: Hono<AppEnv>;
	title: string;
	sourceFileName: string;
	contentBytes: number;
}): Promise<StartUploadResponse> {
	const response = await input.app.request(
		"/assets/books/upload/start",
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				projectId: TEST_PROJECT_ID,
				title: input.title,
				sourceFileName: input.sourceFileName,
				contentBytes: input.contentBytes,
			}),
		},
		TEST_ENV,
	);
	const payload = await readJson<StartUploadResponse>(response);
	expect(response.status, JSON.stringify(payload)).toBe(200);
	expect(payload).toMatchObject({
		ok: true,
		projectId: TEST_PROJECT_ID,
		title: input.title,
		sourceFileName: input.sourceFileName,
	});
	expect(payload.uploadId).not.toBe("");
	return payload;
}

export async function appendUploadChunk(input: {
	app: Hono<AppEnv>;
	uploadId: string;
	offset: number;
	bytes: Uint8Array;
	contentType?: string;
	projectId?: string;
}): Promise<Response> {
	const projectId = input.projectId ?? TEST_PROJECT_ID;
	return input.app.request(
		`/assets/books/upload/${encodeURIComponent(input.uploadId)}/append?projectId=${encodeURIComponent(projectId)}&offset=${input.offset}`,
		{
			method: "POST",
			headers: {
				"content-type": input.contentType ?? "application/octet-stream",
			},
			body: toRequestBody(input.bytes),
		},
		TEST_ENV,
	);
}

export async function finishUpload(input: {
	app: Hono<AppEnv>;
	uploadId: string;
	projectId?: string;
}): Promise<Response> {
	const projectId = input.projectId ?? TEST_PROJECT_ID;
	return input.app.request(
		`/assets/books/upload/${encodeURIComponent(input.uploadId)}/finish?projectId=${encodeURIComponent(projectId)}`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ strictAgents: true }),
		},
		TEST_ENV,
	);
}

export async function waitForUploadJob(input: {
	app: Hono<AppEnv>;
	jobId: string;
}): Promise<UploadJob> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		const response = await input.app.request(
			`/assets/books/upload/jobs/${encodeURIComponent(input.jobId)}?projectId=${encodeURIComponent(TEST_PROJECT_ID)}`,
			{},
			TEST_ENV,
		);
		const payload = await readJson<{ job: UploadJob }>(response);
		expect(response.status, JSON.stringify(payload)).toBe(200);
		if (payload.job.status === "succeeded" || payload.job.status === "failed") {
			return payload.job;
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`book upload job ${input.jobId} did not reach a terminal state`);
}

export async function waitForReconfirmWorker(input: {
	app: Hono<AppEnv>;
	bookId: string;
}): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		const response = await input.app.request(
			`/assets/books/reconfirm/jobs/latest?projectId=${encodeURIComponent(TEST_PROJECT_ID)}&bookId=${encodeURIComponent(input.bookId)}`,
			{},
			TEST_ENV,
		);
		const payload = await readJson<{
			job: { status: "queued" | "running" | "succeeded" | "failed" } | null;
		}>(response);
		expect(response.status, JSON.stringify(payload)).toBe(200);
		if (payload.job?.status === "succeeded" || payload.job?.status === "failed") {
			return;
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`book reconfirm worker for ${input.bookId} did not finish`);
}

export function buildUploadSourcePath(repoRoot: string, uploadId: string): string {
	return path.join(
		repoRoot,
		"project-data",
		"users",
		TEST_USER_ID,
		"projects",
		TEST_PROJECT_ID,
		"books",
		".uploads",
		`${uploadId}.part.bin`,
	);
}

export function buildUploadSessionMetaPath(
	repoRoot: string,
	uploadId: string,
): string {
	return path.join(
		repoRoot,
		"project-data",
		"users",
		TEST_USER_ID,
		"projects",
		TEST_PROJECT_ID,
		"books",
		".uploads",
		`${uploadId}.json`,
	);
}

export function buildBookDirectory(repoRoot: string, bookId: string): string {
	return path.join(
		repoRoot,
		"project-data",
		"users",
		TEST_USER_ID,
		"projects",
		TEST_PROJECT_ID,
		"books",
		bookId,
	);
}

export async function waitForPathMissing(targetPath: string): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		try {
			await fs.access(targetPath);
		} catch {
			return;
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`path was not cleaned up: ${targetPath}`);
}
