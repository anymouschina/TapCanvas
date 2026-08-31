import { describe, it, expect, beforeEach } from "vitest";
import {
	putChapterCanvasFlow,
	CanvasFlowRevisionConflictError,
} from "./chapter.canvas-flow.service";
import {
	makeCtx,
	type FakeChapter,
} from "./chapter.canvas-flow.test-helpers";

// Full snapshots are revision-bound regardless of caller. Browser and agent
// writes must both surface a conflict; agent patch layers then re-read and
// re-apply their structured mutation to the latest graph.
describe("putChapterCanvasFlow stale snapshot rejection", () => {
	let chapters: Map<string, FakeChapter>;
	beforeEach(() => {
		chapters = new Map();
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: "{}",
			canvas_flow_revision: 5,
		});
	});

	it("source:'user' 落后版本 → 立即抛 CanvasFlowRevisionConflictError（只尝试一次，不取并集）", async () => {
		const ctx = makeCtx(chapters);
		await expect(
			putChapterCanvasFlow(ctx, "u1", "c1", {
				expectedRevision: 3,
				flow: { nodes: [], edges: [] },
				source: "user",
			}),
		).rejects.toMatchObject({
			name: "CanvasFlowRevisionConflictError",
			expected: 3,
			actual: 5,
		});
		// 只做一次乐观写(count===0 即抛)，绝不进 6 次 CAS 重试。
		expect(
			(ctx.env.DB.chapters.updateMany as { mock: { calls: unknown[] } }).mock
				.calls.length,
		).toBe(1);
		expect(ctx.env.DB.projects.updateMany).not.toHaveBeenCalled();
		// 版本号/画布未被改动（保存被硬挡）。
		expect(chapters.get("c1")!.canvas_flow_revision).toBe(5);
		expect(chapters.get("c1")!.canvas_flow).toBe("{}");
	});

	it("source:'user' 落后版本 → 抛的是 CanvasFlowRevisionConflictError 实例（路由据此 409）", async () => {
		const ctx = makeCtx(chapters);
		await expect(
			putChapterCanvasFlow(ctx, "u1", "c1", {
				expectedRevision: 0,
				flow: { nodes: [{ id: "x" }], edges: [] },
				source: "user",
			}),
		).rejects.toBeInstanceOf(CanvasFlowRevisionConflictError);
	});

	it("source:'agent'（显式）落后版本 → 同样显式冲突，不覆盖最新图", async () => {
		const ctx = makeCtx(chapters);
		await expect(
			putChapterCanvasFlow(ctx, "u1", "c1", {
				expectedRevision: 3,
				flow: { nodes: [{ id: "agent-node" }], edges: [] },
				source: "agent",
			}),
		).rejects.toMatchObject({ expected: 3, actual: 5 });
		expect(chapters.get("c1")!.canvas_flow_revision).toBe(5);
		expect(
			(ctx.env.DB.chapters.updateMany as { mock: { calls: unknown[] } }).mock
				.calls.length,
		).toBe(1);
	});

	it("source 缺省（不传）落后版本 → 仍显式冲突", async () => {
		const ctx = makeCtx(chapters);
		await expect(
			putChapterCanvasFlow(ctx, "u1", "c1", {
				expectedRevision: 3,
				flow: { nodes: [{ id: "stale" }], edges: [] },
			}),
		).rejects.toMatchObject({ expected: 3, actual: 5 });
		expect(chapters.get("c1")!.canvas_flow).toBe("{}");
	});

	it("source:'user' 版本匹配 → 正常保存成功（硬挡只针对落后，不误伤正常保存）", async () => {
		const ctx = makeCtx(chapters);
		const res = await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 5,
			flow: { nodes: [{ id: "y" }], edges: [] },
			source: "user",
		});
		expect(res.revision).toBe(6);
		expect(chapters.get("c1")!.canvas_flow_revision).toBe(6);
		expect(ctx.env.DB.projects.updateMany).toHaveBeenCalledWith({
			where: {
				id: "project-1",
				owner_id: "u1",
				updated_at: { lt: expect.any(String) },
			},
			data: { updated_at: expect.any(String) },
		});
	});
});
