import { afterEach, describe, expect, it } from "vitest";

import {
  appendAccumulatedClips,
  loadAccumulatedClips,
  clearAccumulatedClips,
  replaceAccumulatedClips,
  replaceAccumulatedClip,
  __clearAllAccumulatedClips,
} from "./video-orchestrator.clip-accumulator";

afterEach(() => __clearAllAccumulatedClips());

const clip = (i: number) => ({ clipPrompt: `镜${i}`, characterRoleNames: ["齐夏"], durationSeconds: 12 });

describe("增量分段累积 — 分小批提交按 runId 累积", () => {
  it("多批 append 累加，保序，返回 total/added", async () => {
    expect(await appendAccumulatedClips("run-a", [clip(1), clip(2)])).toMatchObject({ total: 2, added: 2 });
    expect(await appendAccumulatedClips("run-a", [clip(3)])).toMatchObject({ total: 3, added: 1 });
    const all = await loadAccumulatedClips("run-a");
    expect(all.map((c: any) => c.clipPrompt)).toEqual(["镜1", "镜2", "镜3"]);
  });

  it("不同 runId 互相隔离", async () => {
    await appendAccumulatedClips("run-b", [clip(1)]);
    await appendAccumulatedClips("run-c", [clip(9)]);
    expect((await loadAccumulatedClips("run-b")).length).toBe(1);
    expect((await loadAccumulatedClips("run-c")).length).toBe(1);
  });

  it("空 runId / 空批不炸", async () => {
    expect((await appendAccumulatedClips("", [clip(1)])).total).toBe(0);
    expect((await appendAccumulatedClips("run-d", [])).total).toBe(0);
    expect(await loadAccumulatedClips("run-d")).toEqual([]);
  });

  it("reset:true 清旧批再追加（OCR#3 防重跑污染）", async () => {
    await appendAccumulatedClips("run-r", [clip(1), clip(2)]);
    const r = await appendAccumulatedClips("run-r", [clip(9)], Date.now(), true);
    expect(r.total).toBe(1);
    expect((await loadAccumulatedClips("run-r")).map((c: any) => c.clipPrompt)).toEqual(["镜9"]);
  });

  it("load 返回浅拷贝·下游 mutation 不污染累积区（OCR#2）", async () => {
    await appendAccumulatedClips("run-m", [clip(1)]);
    const got = await loadAccumulatedClips("run-m");
    got.push(clip(99)); // 下游 mutation
    expect((await loadAccumulatedClips("run-m")).length).toBe(1); // 累积区未被污染
  });

  it("replaceAtIndex 指向下一空槽时明确指导按 clipIndex 追加", async () => {
    await appendAccumulatedClips("run-missing-slot", [clip(1)]);
    const result = await replaceAccumulatedClip("run-missing-slot", 1, clip(2));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("缺失的新槽位");
    expect(result.message).toContain("不要传 replaceAtIndex");
    expect(result.message).toContain("不要 reset");
  });

  it("clear 清空", async () => {
    await appendAccumulatedClips("run-e", [clip(1), clip(2)]);
    clearAccumulatedClips("run-e");
    expect(await loadAccumulatedClips("run-e")).toEqual([]);
  });

  it("过期条目在 append 时被 prune（注入未来 now）", async () => {
    await appendAccumulatedClips("run-f", [clip(1)], 1000);
    const r = await appendAccumulatedClips("run-f", [clip(2)], 1000 + 25 * 60 * 60 * 1000);
    expect(r.total).toBe(1);
  });
});

describe("replaceAccumulatedClip（单段外科替换·质检左移配套）", () => {
  it("原位替换镜N，其余段不动（修一个错字不必整批重灌）", async () => {
    await appendAccumulatedClips("run-x", [clip(1), clip(2), clip(3)]);
    const r = await replaceAccumulatedClip("run-x", 1, clip(99));
    expect(r.ok).toBe(true);
    expect(r.total).toBe(3);
    expect((await loadAccumulatedClips("run-x")).map((c: any) => c.clipPrompt)).toEqual([
      "镜1",
      "镜99",
      "镜3",
    ]);
  });

  it("索引越界 → ok:false 带范围提示", async () => {
    await appendAccumulatedClips("run-y", [clip(1)]);
    const r = await replaceAccumulatedClip("run-y", 5, clip(9));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("越界");
  });

  it("累积区为空 → ok:false 提示重新 add_clips", async () => {
    const r = await replaceAccumulatedClip("run-none", 0, clip(1));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("累积区为空");
  });
});

describe("replaceAccumulatedClips（冻结装配精确覆盖）", () => {
  it("用权威 clips 整体替换，删除旧数组尾部残留", async () => {
    await appendAccumulatedClips("run-frozen", [clip(0), clip(1), clip(2), clip(3)]);

    await expect(replaceAccumulatedClips("run-frozen", [clip(8), clip(9)])).resolves.toEqual({
      total: 2,
    });
    const replaced = await loadAccumulatedClips("run-frozen");
    expect(replaced).toHaveLength(2);
    expect(
      replaced.map((entry) =>
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? String((entry as Record<string, unknown>).clipPrompt ?? "")
          : "",
      ),
    ).toEqual(["镜8", "镜9"]);
  });

  it("拒绝空 runId、空 clips 与超上限覆盖", async () => {
    await expect(replaceAccumulatedClips("", [clip(0)])).rejects.toThrow(
      "replace_accumulated_clips_run_id_required",
    );
    await expect(replaceAccumulatedClips("run-empty", [])).rejects.toThrow(
      "replace_accumulated_clips_non_empty_array_required",
    );
    await expect(
      replaceAccumulatedClips(
        "run-overflow",
        Array.from({ length: 61 }, (_, index) => clip(index)),
      ),
    ).rejects.toThrow("replace_accumulated_clips_limit_exceeded:61");
  });
});
