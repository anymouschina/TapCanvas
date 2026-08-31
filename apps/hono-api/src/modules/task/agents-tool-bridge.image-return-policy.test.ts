import { describe, expect, it } from "vitest";

import {
	isImageReconcileSweepEnabled,
	shouldReturnImageAsync,
} from "./agents-tool-bridge.image-return-policy";

describe("shouldReturnImageAsync（图生成异步策略，治 504 丢节点）", () => {
  it("无 taskId → 同步兜底(无从轮询)", () => {
    expect(shouldReturnImageAsync({})).toBe(false);
    expect(shouldReturnImageAsync({ taskId: "  " })).toBe(false);
  });

  it("章节内嵌画布 → 同步(无 reconcile 循环)", () => {
    expect(shouldReturnImageAsync({ taskId: "t1", chapterId: "ch1" })).toBe(false);
  });

  it("flows 默认异步(提交即返)", () => {
    expect(shouldReturnImageAsync({ taskId: "t1" })).toBe(true);
  });

  it("显式 waitForResult:true → 同步", () => {
    expect(shouldReturnImageAsync({ taskId: "t1", waitForResult: true })).toBe(false);
  });

  it("waitForResult 非 true（false/undefined）→ 异步", () => {
    expect(shouldReturnImageAsync({ taskId: "t1", waitForResult: false })).toBe(true);
    expect(shouldReturnImageAsync({ taskId: "t1", waitForResult: undefined })).toBe(true);
  });
});

describe("shouldReturnImageAsync · 三态 waitForResult", () => {
	it("显式 false = 调用方自带 reconcile，章节画布也准许异步", () => {
		expect(shouldReturnImageAsync({ taskId: "t1", chapterId: "ch1", waitForResult: false })).toBe(true);
		expect(shouldReturnImageAsync({ taskId: "t1", waitForResult: false })).toBe(true);
	});
	it("显式 false 但无 taskId 仍退回同步（无从轮询）", () => {
		expect(shouldReturnImageAsync({ chapterId: "ch1", waitForResult: false })).toBe(false);
	});
	it("未显式（undefined）保持旧默认：章节同步、flows 异步", () => {
		expect(shouldReturnImageAsync({ taskId: "t1", chapterId: "ch1" })).toBe(false);
		expect(shouldReturnImageAsync({ taskId: "t1" })).toBe(true);
	});
});

describe("shouldReturnImageAsync · 章节后台 reconcile sweep 兜底（IMAGE_NODE_RECONCILE_SWEEP）", () => {
	it("sweep 开启时，章节默认（undefined）准许异步——有后台兜底回收 running 节点", () => {
		expect(
			shouldReturnImageAsync({ taskId: "t1", chapterId: "ch1", chapterReconcileSweepEnabled: true }),
		).toBe(true);
	});
	it("sweep 开启但显式 waitForResult:true 仍同步（尊重'确需 inline 拿 URL'）", () => {
		expect(
			shouldReturnImageAsync({
				taskId: "t1",
				chapterId: "ch1",
				waitForResult: true,
				chapterReconcileSweepEnabled: true,
			}),
		).toBe(false);
	});
	it("sweep 开启但无 taskId 仍同步兜底（无从轮询）", () => {
		expect(
			shouldReturnImageAsync({ chapterId: "ch1", chapterReconcileSweepEnabled: true }),
		).toBe(false);
	});
	it("sweep 显式关闭：章节同步（逐字等价旧行为）", () => {
		expect(
			shouldReturnImageAsync({ taskId: "t1", chapterId: "ch1", chapterReconcileSweepEnabled: false }),
		).toBe(false);
		expect(shouldReturnImageAsync({ taskId: "t1", chapterId: "ch1" })).toBe(false);
	});
});

describe("isImageReconcileSweepEnabled（默认开：章节异步出图占位 + 后台 sweep）", () => {
	it("未设置 → 默认 ON", () => {
		expect(isImageReconcileSweepEnabled({})).toBe(true);
		expect(isImageReconcileSweepEnabled({ IMAGE_NODE_RECONCILE_SWEEP: "" })).toBe(true);
		expect(isImageReconcileSweepEnabled({ IMAGE_NODE_RECONCILE_SWEEP: "   " })).toBe(true);
	});
	it("显式开启值 → ON", () => {
		for (const v of ["1", "true", "on", "TRUE", "On"]) {
			expect(isImageReconcileSweepEnabled({ IMAGE_NODE_RECONCILE_SWEEP: v })).toBe(true);
		}
	});
	it("仅显式关闭值 → OFF（回旧同步行为）", () => {
		for (const v of ["0", "false", "off", "OFF", "False"]) {
			expect(isImageReconcileSweepEnabled({ IMAGE_NODE_RECONCILE_SWEEP: v })).toBe(false);
		}
	});
	it("其它非法值 → 视为 ON（默认开语义，不误退回同步）", () => {
		expect(isImageReconcileSweepEnabled({ IMAGE_NODE_RECONCILE_SWEEP: "yes" })).toBe(true);
	});
});
