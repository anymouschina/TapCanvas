import { describe, expect, it } from "vitest";
import {
  buildAccumulatedClipUpdateData,
  isTerminalVideoRunState,
  isVideoRunAwaitingClientConcat,
  nextNoProgressDecision,
  nextStallStrikeDecision,
  VIDEO_RUN_TERMINAL_STATES,
} from "./video-run.repo";

describe("buildAccumulatedClipUpdateData", () => {
  it("省略 scope 时不生成 null 覆盖字段", () => {
    expect(
      buildAccumulatedClipUpdateData({
        nowIso: "2026-08-03T16:00:00.000Z",
        storyPlanJson: "{\"clips\":[]}",
      }),
    ).toEqual({
      updated_at: "2026-08-03T16:00:00.000Z",
      story_plan: "{\"clips\":[]}",
    });
  });

  it("传入 scope 时完整保留当前画布身份", () => {
    expect(
      buildAccumulatedClipUpdateData({
        nowIso: "2026-08-03T16:00:00.000Z",
        storyPlanJson: "{\"clips\":[]}",
        projectId: "project-1",
        flowId: "flow-1",
        chapterId: "chapter-1",
      }),
    ).toEqual({
      updated_at: "2026-08-03T16:00:00.000Z",
      story_plan: "{\"clips\":[]}",
      project_id: "project-1",
      flow_id: "flow-1",
      chapter_id: "chapter-1",
    });
  });
});

// 守护前后端 canonical active 状态集一致：planned/video_success/concatenating
// 必须算非终态 → 后端可驱动/可取消/握手回放，否则会复现"幽灵进度 chip + 取消无效"。
describe("video-run terminal-state classification", () => {
  it("terminal set mirrors frontend videoRunStore TERMINAL_STATES", () => {
    expect([...VIDEO_RUN_TERMINAL_STATES].sort()).toEqual(
      ["cancelled", "concatenated", "failed"],
    );
  });

  it("limbo states are NON-terminal (drivable + cancellable)", () => {
    for (const s of ["planned", "video_success", "concatenating"]) {
      expect(isTerminalVideoRunState(s)).toBe(false);
    }
  });

  it("scheduled / video_running are non-terminal", () => {
    expect(isTerminalVideoRunState("scheduled")).toBe(false);
    expect(isTerminalVideoRunState("video_running")).toBe(false);
  });

  it("terminal states are terminal", () => {
    for (const s of ["concatenated", "failed", "cancelled"]) {
      expect(isTerminalVideoRunState(s)).toBe(true);
    }
  });
});

describe("isVideoRunAwaitingClientConcat", () => {
	it("treats a full video_success run as waiting for the user's WebAV action", () => {
		expect(
			isVideoRunAwaitingClientConcat({ state: "video_success", clipsDone: 8, totalClips: 8 }),
		).toBe(true);
	});

	it.each([
		{ state: "video_success", clipsDone: 7, totalClips: 8 },
		{ state: "video_running", clipsDone: 8, totalClips: 8 },
		{ state: "video_success", clipsDone: 0, totalClips: 0 },
		{ state: "video_success", clipsDone: 8, totalClips: 8, errorMessage: "durable upload failed" },
	])("does not hide a genuinely incomplete run: %o", (input) => {
		expect(isVideoRunAwaitingClientConcat(input)).toBe(false);
	});
});

describe("nextStallStrikeDecision（三振出局）", () => {
	it("首次 stall 只记一振，不出局", () => {
		expect(nextStallStrikeDecision(null)).toEqual({ action: "strike", strikes: 1 });
		expect(nextStallStrikeDecision("")).toEqual({ action: "strike", strikes: 1 });
		expect(nextStallStrikeDecision("图片生成超时：任务仍未完成")).toEqual({ action: "strike", strikes: 1 });
	});
	it("累计达到 STALL_STRIKES_TO_CANCEL 才出局", () => {
		expect(nextStallStrikeDecision("stall_strike:1")).toEqual({ action: "strike", strikes: 2 });
		expect(nextStallStrikeDecision("stall_strike:2")).toEqual({ action: "cancel", strikes: 3 });
		expect(nextStallStrikeDecision("stall_strike:99")).toEqual({ action: "cancel", strikes: 100 });
	});
	it("健康推进清空 error_message 后重新计数", () => {
		// run-driver 无错推进会写 errorMessage=null → 下次 stall 又从第一振开始
		expect(nextStallStrikeDecision(null).strikes).toBe(1);
	});
});

// fix #2：真实进度水位标。根治"run 被 driver 每分钟驱动(last_drive_at 一直新鲜)、但 clips_done
// 永不前进"的死循环（如某镜反复被上游版权审核打回→无限重提烧钱却永不收尾）。判据从"最近是否被
// 驱动"改为"clips_done 是否真在前进"：同一 clips_done 卡满窗口才取消，前进即清零、不误杀慢渲染。
describe("nextNoProgressDecision（真实进度水位标·无进展超时取消）", () => {
	const STALL = 25 * 60 * 1000;
	const base = {
		nowIso: "2026-06-15T06:00:00.000Z",
		stallCancelMs: STALL,
	};

	it("有真实进度(clips_done 前进或终态) → 清空水位标，绝不取消", () => {
		expect(
			nextNoProgressDecision({ ...base, errorMessage: "noprogress:4:2026-06-15T05:00:00.000Z", clipsDone: 5, madeProgress: true }),
		).toEqual({ action: "clear", errorMessage: null });
	});

	it("首次无进展 → 打水位标(记当前 clips_done + 起始时刻)，不取消", () => {
		expect(
			nextNoProgressDecision({ ...base, errorMessage: null, clipsDone: 4, madeProgress: false }),
		).toEqual({ action: "mark", errorMessage: "noprogress:4:2026-06-15T06:00:00.000Z" });
	});

	it("clips_done 与水位标不同(刚前进过被清，又卡新档) → 重新打标、起始时刻刷新为 now", () => {
		expect(
			nextNoProgressDecision({ ...base, errorMessage: "noprogress:3:2026-06-15T05:00:00.000Z", clipsDone: 4, madeProgress: false }),
		).toEqual({ action: "mark", errorMessage: "noprogress:4:2026-06-15T06:00:00.000Z" });
	});

	it("同一 clips_done 持续卡住但未满窗口 → 保留原起始时刻(不刷新)，不取消", () => {
		// 起始 05:50，now 06:00，仅 10min < 25min 窗口
		expect(
			nextNoProgressDecision({ ...base, errorMessage: "noprogress:4:2026-06-15T05:50:00.000Z", clipsDone: 4, madeProgress: false }),
		).toEqual({ action: "mark", errorMessage: "noprogress:4:2026-06-15T05:50:00.000Z" });
	});

	it("同一 clips_done 卡满窗口 → 取消(no_progress_timeout)", () => {
		// 起始 05:30，now 06:00 = 30min ≥ 25min 窗口
		expect(
			nextNoProgressDecision({ ...base, errorMessage: "noprogress:4:2026-06-15T05:30:00.000Z", clipsDone: 4, madeProgress: false }),
		).toEqual({ action: "cancel", errorMessage: "no_progress_timeout_auto_cancelled" });
	});

	it("error_message 是别的内容(非 noprogress 令牌) → 视为新窗口起点，不误判已超时", () => {
		expect(
			nextNoProgressDecision({ ...base, errorMessage: "stall_strike:1", clipsDone: 4, madeProgress: false }),
		).toEqual({ action: "mark", errorMessage: "noprogress:4:2026-06-15T06:00:00.000Z" });
	});
});
