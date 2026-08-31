import { describe, expect, it, vi } from "vitest";

// ── 跨进程画布 SSE 中继回归 ──────────────────────────────────────────────────
// 用 vi.resetModules 加载两份 canvas-sse.manager 实例模拟两个进程（api / worker），
// 共享同一个假 Redis pub/sub hub：worker 侧 broadcast 必须经中继到达 api 侧的 SSE 连接；
// 同一实例自己 publish 的消息按 origin 跳过，不得重复投递。

type MessageHandler = (channel: string, raw: string) => void;

const messageHandlers: MessageHandler[] = [];

const fakeRedis = {
	publish(channel: string, raw: string) {
		for (const h of [...messageHandlers]) h(channel, raw);
		return Promise.resolve(messageHandlers.length);
	},
	duplicate() {
		return {
			on(event: string, cb: MessageHandler) {
				if (event === "message") messageHandlers.push(cb);
			},
			subscribe() {
				return Promise.resolve();
			},
		};
	},
};

vi.mock("../../platform/redis-shared", () => ({
	getSharedRedis: () => fakeRedis,
}));

async function loadIsolatedManager() {
	vi.resetModules();
	return await import("./canvas-sse.manager");
}

function collectController(writes: string[]): ReadableStreamDefaultController {
	return {
		enqueue(chunk: Uint8Array) {
			writes.push(new TextDecoder().decode(chunk));
		},
		close() {},
		error() {},
	} as unknown as ReadableStreamDefaultController;
}

const canonicalStatusFields = {
	authoringState: null,
	authoringClipsReady: 0,
	authoringTotalClips: 0,
	chapterId: null,
	chapterTitle: null,
	updatedAt: "2026-08-03T05:00:00.000Z",
} as const;

describe("canvas SSE 跨进程中继", () => {
	it("worker 进程的 broadcastPatch 经 Redis 到达 api 进程的 SSE 连接", async () => {
		const apiSide = await loadIsolatedManager();
		const workerSide = await loadIsolatedManager();

		const writes: string[] = [];
		const sub = apiSide.subscribeToChapter("proj-relay-1", "u1", collectController(writes));

		// worker 侧无任何本地连接（它从不 subscribeToChapter），纯 publish。
		workerSide.broadcastPatch("proj-relay-1", { upsertNodes: [{ id: "n-relay-1" }] }, "");
		sub.unsubscribe();

		const frame = writes.find((w) => w.includes("n-relay-1"));
		expect(frame).toBeDefined();
		expect(frame!.startsWith("data: ")).toBe(true);
	});

	it("worker 进程的 broadcastRunStatus 经 Redis 到达 api 进程（含 chapter 房间）", async () => {
		const apiSide = await loadIsolatedManager();
		const workerSide = await loadIsolatedManager();

		const chapWrites: string[] = [];
		const sub = apiSide.subscribeToChapter("chap-relay-2", "u1", collectController(chapWrites));

		workerSide.broadcastRunStatus("proj-relay-2", {
			...canonicalStatusFields,
			runId: "r-relay", flowId: "f1", state: "video_running",
			totalClips: 5, clipsDone: 2, errorMessage: null, completedAt: null,
			chapterId: "chap-relay-2", chapterTitle: "第1章",
		});
		sub.unsubscribe();

		const frame = chapWrites.find((w) => w.includes("event: run-status"));
		expect(frame).toBeDefined();
		expect(JSON.parse(frame!.replace("event: run-status\ndata: ", "").trim()))
			.toMatchObject({ runId: "r-relay", clipsDone: 2 });
	});

	it("同进程广播不重复投递（本地一次；自己的 relay 消息按 origin 跳过）", async () => {
		const mod = await loadIsolatedManager();

		const writes: string[] = [];
		const sub = mod.subscribeToChapter("proj-relay-3", "u1", collectController(writes));

		mod.broadcastPatch("proj-relay-3", { upsertNodes: [{ id: "n-once" }] }, "");
		sub.unsubscribe();

		expect(writes.filter((w) => w.includes("n-once")).length).toBe(1);
	});

	it("sender 连接跨进程也被抑制回显", async () => {
		const apiSide = await loadIsolatedManager();
		const workerSide = await loadIsolatedManager();

		const writes: string[] = [];
		const sub = apiSide.subscribeToChapter("proj-relay-4", "u1", collectController(writes));

		// 模拟同一浏览器连接发起的 canvas-patches 被别的进程转发：senderConnId 一致时不回显。
		workerSide.broadcastPatch("proj-relay-4", { upsertNodes: [{ id: "n-echo" }] }, sub.connId);
		sub.unsubscribe();

		expect(writes.some((w) => w.includes("n-echo"))).toBe(false);
	});
});
