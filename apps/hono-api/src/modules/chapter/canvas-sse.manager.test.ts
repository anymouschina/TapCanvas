import { describe, expect, it } from "vitest";
import { subscribeToChapter, countChapterConns, broadcastPatch, broadcastRunStatus, broadcastToolProgress } from "./canvas-sse.manager";

function fakeController() {
	return { enqueue() {}, close() {}, error() {} } as unknown as ReadableStreamDefaultController;
}

const canonicalStatusFields = {
	authoringState: null,
	authoringClipsReady: 0,
	authoringTotalClips: 0,
	chapterId: null,
	chapterTitle: null,
	updatedAt: "2026-08-03T05:00:00.000Z",
} as const;

describe("countChapterConns", () => {
	it("无连接为 0，订阅后递增，退订后归零", () => {
		const room = "proj-test-1";
		expect(countChapterConns(room)).toBe(0);
		const a = subscribeToChapter(room, "u1", fakeController());
		const b = subscribeToChapter(room, "u2", fakeController());
		expect(countChapterConns(room)).toBe(2);
		a.unsubscribe();
		expect(countChapterConns(room)).toBe(1);
		b.unsubscribe();
		expect(countChapterConns(room)).toBe(0);
	});
});

describe("admin workflow realtime visibility", () => {
	it("非 admin 连接不会收到受保护节点 payload，admin 保持完整 patch", () => {
		const room = `admin-workflow-${Math.random()}`;
		const memberWrites: string[] = [];
		const adminWrites: string[] = [];
		const controller = (writes: string[]) => ({
			enqueue(chunk: Uint8Array) { writes.push(new TextDecoder().decode(chunk)); },
			close() {},
			error() {},
		}) as unknown as ReadableStreamDefaultController;
		const member = subscribeToChapter(room, "member", controller(memberWrites));
		const admin = subscribeToChapter(room, "admin", controller(adminWrites), {
			canViewAdminWorkflow: true,
		});

		broadcastPatch(room, {
			upsertNodes: [
				{ id: "source", data: { kind: "text" } },
				{ id: "trigger", data: { kind: "workflowTrigger", adminWorkflow: true } },
			],
			upsertEdges: [{ id: "hidden-edge", source: "trigger", target: "source" }],
		}, "");
		member.unsubscribe();
		admin.unsubscribe();

		const memberPatch = JSON.parse(memberWrites[0].replace("data: ", "").trim()) as {
			upsertNodes: Array<{ id: string }>;
			upsertEdges: Array<{ id: string }>;
		};
		const adminPatch = JSON.parse(adminWrites[0].replace("data: ", "").trim()) as {
			upsertNodes: Array<{ id: string }>;
			upsertEdges: Array<{ id: string }>;
		};
		expect(memberPatch.upsertNodes.map((node) => node.id)).toEqual(["source"]);
		expect(memberPatch.upsertEdges).toEqual([]);
		expect(adminPatch.upsertNodes.map((node) => node.id)).toEqual(["source", "trigger"]);
		expect(adminPatch.upsertEdges.map((edge) => edge.id)).toEqual(["hidden-edge"]);
	});
});

describe("broadcastRunStatus", () => {
	it("向房间内所有连接发命名事件 run-status，无订阅者时静默", () => {
		const room = "proj-run-1";
		const writes: string[] = [];
		const ctrl = {
			enqueue(chunk: Uint8Array) { writes.push(new TextDecoder().decode(chunk)); },
			close() {}, error() {},
		} as unknown as ReadableStreamDefaultController;

		expect(() => broadcastRunStatus("nobody", {
			...canonicalStatusFields,
			runId: "r0", flowId: null, state: "scheduled",
			totalClips: 0, clipsDone: 0, errorMessage: null, completedAt: null,
		})).not.toThrow();

		const sub = subscribeToChapter(room, "u1", ctrl);
		broadcastRunStatus(room, {
			...canonicalStatusFields,
			runId: "r1", flowId: "f1", state: "video_running",
			totalClips: 8, clipsDone: 3, errorMessage: null, completedAt: null,
		});
		sub.unsubscribe();

		const connIdFrame = writes.find((w) => w.includes("run-status"));
		expect(connIdFrame).toBeDefined();
		expect(connIdFrame!.startsWith("event: run-status\ndata: ")).toBe(true);
		const json = JSON.parse(connIdFrame!.replace("event: run-status\ndata: ", "").trim());
		expect(json).toMatchObject({ runId: "r1", state: "video_running", clipsDone: 3, totalClips: 8 });
		expect(json.protocolVersion).toBe("2");
	});

	it("非法状态在广播边界显式失败，不进入 SSE", () => {
		expect(() => broadcastRunStatus("proj-invalid", {
			...canonicalStatusFields,
			runId: "invalid",
			flowId: null,
			state: "legacy_running_alias",
			totalClips: 1,
			clipsDone: 0,
			errorMessage: null,
			completedAt: null,
		})).toThrow("state is not canonical");
	});

	it("有 chapterId 时同时广播到 chapterId 房间（章节画布订阅的是 chapterId 房间）", () => {
		const decode = (c: Uint8Array) => new TextDecoder().decode(c);
		const projWrites: string[] = [];
		const chapWrites: string[] = [];
		const projCtrl = {
			enqueue(c: Uint8Array) { projWrites.push(decode(c)); }, close() {}, error() {},
		} as unknown as ReadableStreamDefaultController;
		const chapCtrl = {
			enqueue(c: Uint8Array) { chapWrites.push(decode(c)); }, close() {}, error() {},
		} as unknown as ReadableStreamDefaultController;

		const ps = subscribeToChapter("proj-mix", "u1", projCtrl);
		const cs = subscribeToChapter("chap-mix", "u2", chapCtrl);
		broadcastRunStatus("proj-mix", {
			...canonicalStatusFields,
			runId: "r2", flowId: "f1", state: "video_running",
			totalClips: 7, clipsDone: 1, errorMessage: null, completedAt: null,
			chapterId: "chap-mix", chapterTitle: "第43章",
		});
		ps.unsubscribe();
		cs.unsubscribe();

		// 项目房间收到（既有行为）
		expect(projWrites.some((w) => w.includes("run-status") && w.includes('"r2"'))).toBe(true);
		// 章节房间也收到（修复点）
		const chapFrame = chapWrites.find((w) => w.includes("run-status"));
		expect(chapFrame).toBeDefined();
		expect(JSON.parse(chapFrame!.replace("event: run-status\ndata: ", "").trim()))
			.toMatchObject({ runId: "r2", chapterId: "chap-mix" });
	});

	it("chapterId 与 projectId 相同时只发一次，不重复", () => {
		const writes: string[] = [];
		const ctrl = {
			enqueue(c: Uint8Array) { writes.push(new TextDecoder().decode(c)); }, close() {}, error() {},
		} as unknown as ReadableStreamDefaultController;
		const sub = subscribeToChapter("same-room", "u1", ctrl);
		broadcastRunStatus("same-room", {
			...canonicalStatusFields,
			runId: "r3", flowId: null, state: "video_running",
			totalClips: 1, clipsDone: 0, errorMessage: null, completedAt: null,
			chapterId: "same-room", chapterTitle: null,
		});
		sub.unsubscribe();
		expect(writes.filter((w) => w.includes("run-status")).length).toBe(1);
	});
});

describe("broadcastToolProgress", () => {
	const decode = (c: Uint8Array) => new TextDecoder().decode(c);

	it("发命名 tool-progress 事件到 project 房间，含 completed/total", () => {
		const room = `proj-tp-${Math.random()}`;
		const writes: string[] = [];
		const ctrl = {
			enqueue(c: Uint8Array) { writes.push(decode(c)); }, close() {}, error() {},
		} as unknown as ReadableStreamDefaultController;
		const sub = subscribeToChapter(room, "u1", ctrl);
		broadcastToolProgress(room, {
			toolCallId: "call-1", toolName: "tapcanvas_image_generate_to_canvas",
			completed: 3, total: 8, failed: 0, chapterId: null,
		});
		sub.unsubscribe();
		const frame = writes.find((w) => w.includes("event: tool-progress"));
		expect(frame).toBeDefined();
		expect(frame!.startsWith("event: tool-progress\ndata: ")).toBe(true);
		expect(JSON.parse(frame!.replace("event: tool-progress\ndata: ", "").trim()))
			.toMatchObject({ toolCallId: "call-1", completed: 3, total: 8, failed: 0 });
	});

	it("有 chapterId 时同时广播到 chapterId 房间", () => {
		const chapRoom = `chap-tp-${Math.random()}`;
		const writes: string[] = [];
		const ctrl = {
			enqueue(c: Uint8Array) { writes.push(decode(c)); }, close() {}, error() {},
		} as unknown as ReadableStreamDefaultController;
		const sub = subscribeToChapter(chapRoom, "u1", ctrl);
		broadcastToolProgress(`proj-tp-${Math.random()}`, {
			toolCallId: "call-2", toolName: "x", completed: 1, total: 2, failed: 0, chapterId: chapRoom,
		});
		sub.unsubscribe();
		expect(writes.some((w) => w.includes("event: tool-progress"))).toBe(true);
	});

	it("无订阅者静默返回（不抛）", () => {
		expect(() => broadcastToolProgress(`empty-${Math.random()}`, {
			toolCallId: "c", toolName: "x", completed: 0, total: 1, failed: 0, chapterId: null,
		})).not.toThrow();
	});
});
