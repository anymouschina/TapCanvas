import { describe, expect, it } from "vitest";

import {
  buildClipTimespanBlockMessage,
  detectTimeJumpMarkers,
  findOverloadedClips,
} from "./video-orchestrator.clip-timespan";

describe("detectTimeJumpMarkers", () => {
  it("命中各组时间跳迁词", () => {
    expect(detectTimeJumpMarkers("她关灯躺下沉沉睡去")).toContain("fall-asleep");
    expect(detectTimeJumpMarkers("两天后清晨")).toEqual(
      expect.arrayContaining(["days-later", "morning"]),
    );
    expect(detectTimeJumpMarkers("次日醒来")).toEqual(
      expect.arrayContaining(["next-day", "wake-up"]),
    );
  });
  it("同组多词只算一次（清晨+早晨=morning 一个锚）", () => {
    expect(detectTimeJumpMarkers("清晨的早晨天亮了")).toEqual(["morning"]);
  });
  it("无时间跳迁的纯动作镜不命中", () => {
    expect(detectTimeJumpMarkers("她捧着牛奶低头承受，镜头缓推")).toEqual([]);
    expect(detectTimeJumpMarkers("")).toEqual([]);
  });
});

describe("findOverloadedClips（ch3 睡觉镜复盘）", () => {
  it("ch3 clip3 式时空过载（睡着+两天后+清晨）被标记", () => {
    const clips = [
      { clipPrompt: "落不下笔，喝完牛奶关灯躺下睡着；两天后清晨在客卧与餐桌往返；餐桌接电话" },
    ];
    const out = findOverloadedClips(clips);
    expect(out.length).toBe(1);
    expect(out[0]?.index).toBe(0);
    expect(out[0]?.markers.length).toBeGreaterThanOrEqual(2);
  });
  it("单个时间跳迁不算过载（睡着但不跳日）", () => {
    expect(findOverloadedClips([{ clipPrompt: "她疲惫地关灯躺下睡着，镜头定住" }])).toEqual([]);
  });
  it("timespanReviewed 豁免有意为之的时空蒙太奇", () => {
    const clips = [
      { clipPrompt: "睡着→两天后清晨", timespanReviewed: true },
    ];
    expect(findOverloadedClips(clips)).toEqual([]);
  });
  it("storyboardPrompt 命中也计入", () => {
    const out = findOverloadedClips([
      { clipPrompt: "纯动作", storyboardPrompt: "她睡去，次日清晨醒来" },
    ]);
    expect(out.length).toBe(1);
  });
  it("正常分段（每条单一时间段）不拦", () => {
    expect(
      findOverloadedClips([
        { clipPrompt: "夜里落不下笔，镜头缓推" },
        { clipPrompt: "她关灯躺下睡去，镜头定住" },
        { clipPrompt: "清晨她在餐桌创作，动作利落" },
      ]),
    ).toEqual([]);
  });
});

describe("buildClipTimespanBlockMessage", () => {
  it("过载 → 返回可执行拦截文案并点名 clip", () => {
    const msg = buildClipTimespanBlockMessage([
      { clipPrompt: "睡着；两天后清晨；第三天来电" },
    ]);
    expect(msg).toBeTruthy();
    expect(msg).toContain("clip0");
    expect(msg).toContain("timespanReviewed");
  });
  it("全部干净 → null", () => {
    expect(buildClipTimespanBlockMessage([{ clipPrompt: "她捧牛奶垂眸" }])).toBeNull();
    expect(buildClipTimespanBlockMessage([])).toBeNull();
  });
});
