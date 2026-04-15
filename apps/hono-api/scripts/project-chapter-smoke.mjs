import crypto from "node:crypto";

const API_BASE = process.env.API_BASE || "http://localhost:8788";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const SMOKE_USER_ID = process.env.SMOKE_USER_ID || "codex-local";
const SMOKE_USER_LOGIN = process.env.SMOKE_USER_LOGIN || "codex_local";

function makeDevToken() {
	const header = Buffer.from(
		JSON.stringify({ alg: "HS256", typ: "JWT" }),
	).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({
			sub: SMOKE_USER_ID,
			login: SMOKE_USER_LOGIN,
			name: "Project Chapter Smoke",
			role: "admin",
			guest: false,
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 3600 * 24 * 7,
		}),
	).toString("base64url");
	const data = `${header}.${payload}`;
	const signature = crypto
		.createHmac("sha256", JWT_SECRET)
		.update(data)
		.digest("base64url");
	return `${data}.${signature}`;
}

const token = makeDevToken();

async function req(path, init = {}) {
	const headers = {
		authorization: `Bearer ${token}`,
		...(init.headers || {}),
	};
	if (init.body != null && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
		headers["content-type"] = "application/json";
	}
	const response = await fetch(`${API_BASE}${path}`, {
		...init,
		headers,
	});
	const text = await response.text();
	let body = null;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		body = text;
	}
	if (!response.ok) {
		throw new Error(`${path} -> ${response.status} ${typeof body === "object" ? JSON.stringify(body) : body}`);
	}
	return body;
}

function buildBookText(chapterCount) {
	return Array.from({ length: chapterCount }, (_, index) => {
		const chapterNo = index + 1;
		return `第${chapterNo}章 章节${chapterNo}\n主角在第${chapterNo}章经历事件${chapterNo}，推进主线冲突。`;
	}).join("\n\n");
}

async function waitForUploadJob(projectId, jobId) {
	for (let attempt = 0; attempt < 120; attempt += 1) {
		const result = await req(
			`/assets/books/upload/jobs/${encodeURIComponent(jobId)}?projectId=${encodeURIComponent(projectId)}`,
			{ method: "GET" },
		);
		const job = result?.job || null;
		if (job?.status === "succeeded") return job;
		if (job?.status === "failed") {
			throw new Error(`upload job failed: ${JSON.stringify(job?.error || job)}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 1500));
	}
	throw new Error(`upload job timeout: ${jobId}`);
}

async function syncAllSourceChapters(projectId, bookId, sourceChapters) {
	for (const item of sourceChapters) {
		const created = await req(
			`/projects/${encodeURIComponent(projectId)}/chapters`,
			{
				method: "POST",
				body: JSON.stringify({
					title: item.title || `第${item.chapter}章`,
					summary: item.summary || item.coreConflict || "",
				}),
			},
		);
		await req(`/chapters/${encodeURIComponent(created.id)}`, {
			method: "PATCH",
			body: JSON.stringify({
				title: item.title || created.title || `第${item.chapter}章`,
				summary: item.summary || item.coreConflict || "",
				sourceBookId: bookId,
				sourceBookChapter: item.chapter,
			}),
		});
	}
}

async function runBasicCrudSmoke() {
	const project = await req("/projects", {
		method: "POST",
		body: JSON.stringify({ name: "Smoke Basic CRUD" }),
	});
	const chapter = await req(`/projects/${encodeURIComponent(project.id)}/chapters`, {
		method: "POST",
		body: JSON.stringify({ title: "第1章" }),
	});
	await req(`/chapters/${encodeURIComponent(chapter.id)}`, {
		method: "PATCH",
		body: JSON.stringify({ status: "archived" }),
	});
	await req(`/chapters/${encodeURIComponent(chapter.id)}`, {
		method: "PATCH",
		body: JSON.stringify({ status: "draft" }),
	});
	const shot = await req(`/chapters/${encodeURIComponent(chapter.id)}/shots`, {
		method: "POST",
		body: JSON.stringify({}),
	});
	await req(`/chapters/${encodeURIComponent(chapter.id)}`, { method: "DELETE" });
	return {
		projectId: project.id,
		chapterId: chapter.id,
		shotId: shot.id,
	};
}

async function runUploadSyncSmoke(chapterCount) {
	const content = buildBookText(chapterCount);
	const project = await req("/projects", {
		method: "POST",
		body: JSON.stringify({ name: `Smoke Upload ${chapterCount}` }),
	});
	const start = await req("/assets/books/upload/start", {
		method: "POST",
		body: JSON.stringify({
			projectId: project.id,
			title: `Smoke Upload ${chapterCount}`,
			contentBytes: Buffer.byteLength(content, "utf8"),
		}),
	});
	await req(
		`/assets/books/upload/${encodeURIComponent(start.uploadId)}/append?projectId=${encodeURIComponent(project.id)}`,
		{
			method: "POST",
			body: JSON.stringify({ chunk: content }),
		},
	);
	const finish = await req(
		`/assets/books/upload/${encodeURIComponent(start.uploadId)}/finish?projectId=${encodeURIComponent(project.id)}`,
		{
			method: "POST",
			body: JSON.stringify({ strictAgents: true }),
		},
	);
	const job = await waitForUploadJob(project.id, finish.job?.id);
	const books = await req(`/assets/books?projectId=${encodeURIComponent(project.id)}`, {
		method: "GET",
	});
	const book = Array.isArray(books) ? books[0] : null;
	if (!book?.bookId) {
		throw new Error("book upload finished but no project book was found");
	}
	const index = await req(
		`/assets/books/${encodeURIComponent(book.bookId)}/index?projectId=${encodeURIComponent(project.id)}`,
		{ method: "GET" },
	);
	const sourceChapters = Array.isArray(index?.chapters) ? index.chapters : [];
	await syncAllSourceChapters(project.id, book.bookId, sourceChapters);
	const chapterList = await req(
		`/projects/${encodeURIComponent(project.id)}/chapters`,
		{ method: "GET" },
	);
	const items = Array.isArray(chapterList?.items) ? chapterList.items : [];
	return {
		projectId: project.id,
		uploadJobStatus: job.status,
		bookId: book.bookId,
		sourceChapterCount: sourceChapters.length,
		projectChapterCount: items.length,
	};
}

async function main() {
	const basic = await runBasicCrudSmoke();
	const upload6 = await runUploadSyncSmoke(6);
	const upload32 = await runUploadSyncSmoke(32);

	console.log(
		JSON.stringify(
			{
				ok: true,
				apiBase: API_BASE,
				smokes: {
					basic,
					upload6,
					upload32,
				},
			},
			null,
			2,
		),
	);
}

main().catch((error) => {
	console.error("[project-chapter-smoke] failed:", error);
	process.exit(1);
});
