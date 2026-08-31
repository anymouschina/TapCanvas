import { describe, it, expect } from "vitest";
import {
  auditClipDialogueCount,
  auditClipInfoUnitCoverage,
  splitSpanInfoUnits,
  countSpanDialogueLines,
  isSourceCoverageWarnEnabled,
  normalizeWithMap,
  computeSourceCoverage,
  buildClipDialogueCoverageWarning,
  buildMidWriteCoverageWarning,
  buildSourceCoverageWarning,
  createMarkerLocator,
  repairClipSourceMarkers,
} from "./video-orchestrator.source-coverage";

const clip = (over: Record<string, unknown>) => over as never;

// 一段够长的章节原文（>200 归一化字），分四个自然节拍，每拍 ≥60 归一化字（> gapMin 默认 60）。
const CHAPTER = [
  "清晨的雾还没散，林越背着旧书包走进巷口，青石板上凝着薄薄的水汽，屋檐滴落的水珠一下一下敲在积水里，惊起一只蜷在墙角打盹的花猫，狭窄的巷子里只剩他一个人，脚步声在墙缝间回荡。", // 节拍1
  "拐过第二个弯，他撞见了守在杂货铺门前的老陈，老陈眯着眼笑，用沾着面粉的围裙擦了擦手，又随手拍了拍身上的灰，从灶台上热气腾腾的木桶里舀出满满一勺，招手让他过去喝碗热豆浆。", // 节拍2
  "两人闲聊时，一辆黑色轿车缓缓停在了街对面，引擎低沉地嗡鸣着迟迟没有熄火，车漆映出灰白阴沉的天光，驾驶座的车窗无声降下一半，露出一双冷漠打量的眼睛。", // 节拍3
  "林越心头一紧，攥紧了书包带，喉咙发干，后背瞬间沁出一层细密的冷汗，他强迫自己装作若无其事地向老陈摆手告别，压低了头加快脚步，很快便消失在通往学校的长街尽头。", // 节拍4·结尾
].join("");

describe("原文覆盖率机检·flag", () => {
  it("默认 ON，显式 off/0/false/no 关闭", () => {
    expect(isSourceCoverageWarnEnabled({})).toBe(true);
    expect(isSourceCoverageWarnEnabled({ VIDEO_SOURCE_COVERAGE_WARN: "off" })).toBe(false);
    expect(isSourceCoverageWarnEnabled({ VIDEO_SOURCE_COVERAGE_WARN: "0" })).toBe(false);
    expect(isSourceCoverageWarnEnabled({ VIDEO_SOURCE_COVERAGE_WARN: "false" })).toBe(false);
  });

});

describe("normalizeWithMap·索引映射", () => {
  it("去空白标点后 map 能映射回原文位置", () => {
    const { norm, map } = normalizeWithMap("你好， 世界！");
    expect(norm).toBe("你好世界");
    // norm[2]='世' 应映射回原文中 '世' 的真实下标
    expect("你好， 世界！"[map[2]]).toBe("世");
  });
});

describe("computeSourceCoverage·核心判定", () => {
  it("全片瓷砖铺满整章 → usable、无漏段、覆盖率高", () => {
    const clips = [
      clip({ clipPrompt: "a", sourceStartMarker: "清晨的雾还没散，林越背着旧书包", sourceEndMarker: "脚步声在墙缝间回荡。" }),
      clip({ clipPrompt: "b", sourceStartMarker: "拐过第二个弯，他撞见了守在", sourceEndMarker: "招手让他过去喝碗热豆浆。" }),
      clip({ clipPrompt: "c", sourceStartMarker: "两人闲聊时，一辆黑色轿车", sourceEndMarker: "露出一双冷漠打量的眼睛。" }),
      clip({ clipPrompt: "d", sourceStartMarker: "林越心头一紧，攥紧了书包带", sourceEndMarker: "消失在通往学校的长街尽头。" }),
    ];
    const r = computeSourceCoverage(clips, CHAPTER);
    expect(r.usable).toBe(true);
    expect(r.matchedClips).toHaveLength(4);
    expect(r.uncoveredSpans).toHaveLength(0);
    expect(r.coveredRatio).toBeGreaterThan(0.9);
    expect(buildSourceCoverageWarning(clips, CHAPTER)).toBeNull();
  });

  it("漏掉结尾节拍（ch129 结局缺失）→ 报 tail 漏段", () => {
    const clips = [
      clip({ clipPrompt: "a", sourceStartMarker: "清晨的雾还没散，林越背着旧书包", sourceEndMarker: "脚步声在墙缝间回荡。" }),
      clip({ clipPrompt: "b", sourceStartMarker: "拐过第二个弯，他撞见了守在", sourceEndMarker: "招手让他过去喝碗热豆浆。" }),
      clip({ clipPrompt: "c", sourceStartMarker: "两人闲聊时，一辆黑色轿车", sourceEndMarker: "露出一双冷漠打量的眼睛。" }),
      // 第4段（结尾）整段没做成镜头
    ];
    const r = computeSourceCoverage(clips, CHAPTER);
    expect(r.uncoveredSpans.some((s) => s.kind === "tail")).toBe(true);
    const msg = buildSourceCoverageWarning(clips, CHAPTER);
    expect(msg).toMatch(/零遗漏机检不通过/);
    expect(msg).toMatch(/结尾/);
  });

  it("漏掉中间节拍 → 报 gap 漏段", () => {
    const clips = [
      clip({ clipPrompt: "a", sourceStartMarker: "清晨的雾还没散，林越背着旧书包", sourceEndMarker: "脚步声在墙缝间回荡。" }),
      // 跳过节拍2、3
      clip({ clipPrompt: "d", sourceStartMarker: "林越心头一紧，攥紧了书包带", sourceEndMarker: "消失在通往学校的长街尽头。" }),
    ];
    const r = computeSourceCoverage(clips, CHAPTER);
    expect(r.uncoveredSpans.some((s) => s.kind === "gap")).toBe(true);
  });

  it("锚点杜撰（原文里没有）→ 全未命中，不报假漏段、报锚点未命中", () => {
    const clips = [
      clip({ clipPrompt: "a", sourceStartMarker: "这句话原文里根本不存在啊啊", sourceEndMarker: "另一句同样查无此据的杜撰" }),
    ];
    const r = computeSourceCoverage(clips, CHAPTER);
    expect(r.matchedClips).toHaveLength(0);
    expect(r.unmatchedMarkerClips).toHaveLength(1);
    expect(r.uncoveredSpans).toHaveLength(0); // 未命中不猜 gap
    expect(buildSourceCoverageWarning(clips, CHAPTER)).toMatch(/逐字命中/);
  });

  it("部分段没填锚点 → 相邻缝隙不猜 gap、只报缺锚点段；但末镜之后的 tail 照报", () => {
    const clips = [
      clip({ clipPrompt: "a", sourceStartMarker: "清晨的雾还没散，林越背着旧书包", sourceEndMarker: "脚步声在墙缝间回荡。" }),
      clip({ clipPrompt: "b" }), // 没填锚点：节拍2 可能由它承载 → 相邻缝隙绝不报 gap
      clip({ clipPrompt: "c", sourceStartMarker: "两人闲聊时，一辆黑色轿车", sourceEndMarker: "露出一双冷漠打量的眼睛。" }),
    ];
    const r = computeSourceCoverage(clips, CHAPTER);
    expect(r.missingMarkerClips).toContain(1);
    // 2026-07-11 逐边界语义：缺锚点段相邻缝隙仍不猜；但按 plan 顺序 clip b 只可能承载 a、c 之间
    // 的原文，末镜 c 之后的节拍4（结尾）没有任何镜可能承载 → tail 漏段是事实、照报（ch129 场景）。
    expect(r.uncoveredSpans.some((s) => s.kind === "gap")).toBe(false);
    expect(r.uncoveredSpans.some((s) => s.kind === "tail")).toBe(true);
    expect(buildSourceCoverageWarning(clips, CHAPTER)).toMatch(/未填/);
  });

  it("非叙事片（无 characterRoleNames）全片未用锚点 → 不检（usable=false），逐字等价旧行为", () => {
    const clips = [clip({ clipPrompt: "a" }), clip({ clipPrompt: "b" })];
    const r = computeSourceCoverage(clips, CHAPTER);
    expect(r.usable).toBe(false);
    expect(buildSourceCoverageWarning(clips, CHAPTER)).toBeNull();
  });

  // 2026-07-11 ch12 实证：叙事章节拆段全片不填锚点 → 机检整片静默失效，
  // 「紫霄宫听道」整段内心戏（章题题眼，~300字）被丢弃且 estimate 零告警。
  // 语义修正：有足量原文 + 叙事 clips（带 characterRoleNames）+ 全片零锚点 = 本身就是告警。
  it("叙事章节（有 characterRoleNames）全片未填锚点 → 报『全片缺锚点』告警而非静默", () => {
    const clips = [
      clip({ clipPrompt: "a", characterRoleNames: ["林越"] }),
      clip({ clipPrompt: "b", characterRoleNames: ["林越", "老陈"] }),
    ];
    const r = computeSourceCoverage(clips, CHAPTER);
    expect(r.usable).toBe(false);
    expect(r.textUsable).toBe(true);
    const warning = buildSourceCoverageWarning(clips, CHAPTER);
    expect(warning).toMatch(/全片.*(锚点|sourceStartMarker)/);
    expect(warning).toMatch(/零遗漏/);
  });

  it("原文过短时叙事 clips 无锚点 → 仍不检不告警（防误报）", () => {
    const clips = [clip({ clipPrompt: "a", characterRoleNames: ["林越"] })];
    expect(buildSourceCoverageWarning(clips, "太短了")).toBeNull();
  });

  it("无原文/原文过短 → 不检", () => {
    const clips = [clip({ clipPrompt: "a", sourceStartMarker: "xxxx", sourceEndMarker: "yyyy" })];
    expect(computeSourceCoverage(clips, "").usable).toBe(false);
    expect(computeSourceCoverage(clips, "太短了").usable).toBe(false);
    expect(buildSourceCoverageWarning(clips, "")).toBeNull();
  });

  it("分段乱序（起始锚点早于前一段）→ 报 outOfOrder", () => {
    const clips = [
      clip({ clipPrompt: "c", sourceStartMarker: "两人闲聊时，一辆黑色轿车", sourceEndMarker: "露出一双冷漠打量的眼睛。" }),
      clip({ clipPrompt: "a", sourceStartMarker: "清晨的雾还没散，林越背着旧书包", sourceEndMarker: "脚步声在墙缝间回荡。" }),
    ];
    const r = computeSourceCoverage(clips, CHAPTER);
    expect(r.outOfOrderClips).toContain(1);
  });

  it("原文与 marker 间有空白/标点差异 → 归一化后仍逐字命中", () => {
    const clips = [
      clip({ clipPrompt: "a", sourceStartMarker: "清晨的雾  还没散、林越背着旧书包", sourceEndMarker: "脚步声在墙缝间回荡" }),
      clip({ clipPrompt: "b", sourceStartMarker: "拐过第二个弯，他撞见了守在", sourceEndMarker: "招手让他过去喝碗热豆浆。" }),
      clip({ clipPrompt: "c", sourceStartMarker: "两人闲聊时，一辆黑色轿车", sourceEndMarker: "露出一双冷漠打量的眼睛。" }),
      clip({ clipPrompt: "d", sourceStartMarker: "林越心头一紧，攥紧了书包带", sourceEndMarker: "消失在通往学校的长街尽头。" }),
    ];
    const r = computeSourceCoverage(clips, CHAPTER);
    expect(r.matchedClips).toHaveLength(4);
    expect(r.uncoveredSpans).toHaveLength(0);
  });
});

// 2026-07-11 ch13 实证根治：7 镜里 5 镜锚点被意译改写（如「形似鳥卻生三頭的巨骨」vs 原文
// 「形似鳥類，卻生有三個腦袋的巨骨」）→ 旧防误报设计一见未命中就整片跳过 gap 检测 →
// 古战场穿行段 ~330 字大洞静默放行。修法：① fuzzy（LCS 滑窗）把意译锚点定位回原文；
// ② gap 检测改逐边界——相邻两镜 end/start 都已定位即可查该边界缝隙，不再全有全无。
describe("意译锚点 fuzzy 定位 + 逐边界 gap 检测（ch13 根治）", () => {
  it("意译锚点（字符局部增删改）→ fuzzy 命中计入 matched，gap 检测照跑", () => {
    const clips = [
      clip({ clipPrompt: "a", sourceStartMarker: "清晨的雾还没散，林越背着旧书包", sourceEndMarker: "脚步声在墙缝间回荡。" }),
      // 跳过节拍2、3（>60 字大洞），且第二段起止锚点均为意译：
      // 原文「林越心头一紧，攥紧了书包带」→ 意译「林越心头一紧攥紧书包带」（删字）
      // 原文「消失在通往学校的长街尽头」→ 意译「消失在通往学校的街尽头」（删字）
      clip({ clipPrompt: "d", sourceStartMarker: "林越心头一紧攥紧书包带", sourceEndMarker: "消失在通往学校的街尽头" }),
    ];
    const r = computeSourceCoverage(clips, CHAPTER);
    expect(r.matchedClips).toContain(1);
    expect(r.fuzzyMarkerClips.some((f) => f.index === 1)).toBe(true);
    expect(r.uncoveredSpans.some((s) => s.kind === "gap")).toBe(true);
    const msg = buildSourceCoverageWarning(clips, CHAPTER);
    expect(msg).toMatch(/零遗漏机检不通过/);
  });

  it("一段锚点彻底杜撰不再致盲全片：其余相邻已命中边界照查 gap", () => {
    const clips = [
      clip({ clipPrompt: "a", sourceStartMarker: "清晨的雾还没散，林越背着旧书包", sourceEndMarker: "脚步声在墙缝间回荡。" }),
      // 跳过节拍2（大洞）
      clip({ clipPrompt: "c", sourceStartMarker: "两人闲聊时，一辆黑色轿车", sourceEndMarker: "露出一双冷漠打量的眼睛。" }),
      // 末段杜撰——旧逻辑这里会让全片 gap 检测熄火
      clip({ clipPrompt: "x", sourceStartMarker: "这句话原文里根本不存在啊啊", sourceEndMarker: "另一句同样查无此据的杜撰" }),
    ];
    const r = computeSourceCoverage(clips, CHAPTER);
    expect(r.unmatchedMarkerClips.some((u) => u.index === 2)).toBe(true);
    // clip0→clip1 边界两端都命中 → 节拍2 的洞必须被检出
    expect(r.uncoveredSpans.some((s) => s.kind === "gap")).toBe(true);
    // 杜撰段相邻边界（clip1→clip2 之后、tail）不猜 gap
    expect(r.uncoveredSpans.some((s) => s.kind === "tail")).toBe(false);
  });

  it("缺锚点段的相邻边界仍不猜 gap（防误报语义保留）", () => {
    const clips = [
      clip({ clipPrompt: "a", sourceStartMarker: "清晨的雾还没散，林越背着旧书包", sourceEndMarker: "脚步声在墙缝间回荡。" }),
      clip({ clipPrompt: "b" }), // 没填锚点：节拍2、3 可能由它承载，绝不能报 gap
      clip({ clipPrompt: "d", sourceStartMarker: "林越心头一紧，攥紧了书包带", sourceEndMarker: "消失在通往学校的长街尽头。" }),
    ];
    const r = computeSourceCoverage(clips, CHAPTER);
    expect(r.uncoveredSpans).toHaveLength(0);
  });
});

describe("repairClipSourceMarkers·写入闸锚点代修", () => {
  it("意译锚点代修为原文逐字；逐字锚点原样不动；杜撰/过短出警告", () => {
    const clips = [
      // 起止都逐字 → 不动
      { clipPrompt: "a", sourceStartMarker: "清晨的雾还没散，林越背着旧书包", sourceEndMarker: "脚步声在墙缝间回荡。" },
      // 起止都是意译（删字）→ 代修成原文逐字
      { clipPrompt: "d", sourceStartMarker: "林越心头一紧攥紧书包带", sourceEndMarker: "消失在通往学校的街尽头" },
      // 起始杜撰 → 警告；结束逐字 → 不动
      { clipPrompt: "x", sourceStartMarker: "这句话原文里根本不存在啊啊", sourceEndMarker: "露出一双冷漠打量的眼睛。" },
    ];
    const r = repairClipSourceMarkers(clips, CHAPTER);
    expect(r.fixes.length).toBeGreaterThan(0);
    const c0 = r.clips[0] as Record<string, unknown>;
    expect(c0.sourceStartMarker).toBe("清晨的雾还没散，林越背着旧书包");
    const c1 = r.clips[1] as Record<string, unknown>;
    expect(CHAPTER).toContain(String(c1.sourceStartMarker));
    expect(CHAPTER).toContain(String(c1.sourceEndMarker));
    expect(String(c1.sourceStartMarker)).toMatch(/攥紧了书包带/);
    const c2 = r.clips[2] as Record<string, unknown>;
    expect(c2.sourceStartMarker).toBe("这句话原文里根本不存在啊啊"); // 定位不到不乱改
    expect(r.warnings.some((w) => w.index === 2 && w.which === "start")).toBe(true);
  });

  it("无原文/无锚点 → 原样返回不报", () => {
    const clips = [{ clipPrompt: "a" }];
    const r1 = repairClipSourceMarkers(clips, "");
    expect(r1.clips).toEqual(clips);
    expect(r1.fixes).toHaveLength(0);
    expect(r1.warnings).toHaveLength(0);
    const r2 = repairClipSourceMarkers(clips, CHAPTER);
    expect(r2.warnings).toHaveLength(0);
  });
});

describe("createMarkerLocator·逐字代修建议", () => {
  it("精确命中返回 exact + 原文逐字片段", () => {
    const locate = createMarkerLocator(CHAPTER);
    const hit = locate("清晨的雾  还没散、林越背着旧书包");
    expect(hit).not.toBeNull();
    expect(hit!.exact).toBe(true);
    expect(CHAPTER).toContain(hit!.verbatim);
  });

  it("意译锚点 fuzzy 定位并给出原文逐字建议（代修原料）", () => {
    const locate = createMarkerLocator(CHAPTER);
    const hit = locate("林越心头一紧攥紧书包带");
    expect(hit).not.toBeNull();
    expect(hit!.exact).toBe(false);
    expect(CHAPTER).toContain(hit!.verbatim);
    expect(hit!.verbatim).toMatch(/林越心头一紧/);
  });

  it("彻底杜撰返回 null", () => {
    const locate = createMarkerLocator(CHAPTER);
    expect(locate("这句话原文里根本不存在啊啊")).toBeNull();
  });
});

describe("clipSpans（逐 clip 覆盖跨度·密度算术用）", () => {
  it("双锚点命中的 clip 返回归一化字符跨度", () => {
    const clips = [
      clip({ clipPrompt: "a", sourceStartMarker: "清晨的雾还没散，林越背着旧书包", sourceEndMarker: "脚步声在墙缝间回荡。" }),
      clip({ clipPrompt: "b", sourceStartMarker: "拐过第二个弯，他撞见了守在", sourceEndMarker: "招手让他过去喝碗热豆浆。" }),
    ];
    const r = computeSourceCoverage(clips, CHAPTER);
    expect(r.usable).toBe(true);
    expect(r.clipSpans).toHaveLength(2);
    expect(r.clipSpans[0].index).toBe(0);
    expect(r.clipSpans[0].chars).toBeGreaterThan(30);
    expect(r.clipSpans[1].index).toBe(1);
    expect(r.clipSpans[1].chars).toBeGreaterThan(30);
  });

  it("锚点未命中的 clip 不进 clipSpans", () => {
    const clips = [
      clip({ clipPrompt: "x", sourceStartMarker: "完全杜撰的锚点内容确实不存在", sourceEndMarker: "也是杜撰的结束锚点内容啊" }),
      clip({ clipPrompt: "a", sourceStartMarker: "清晨的雾还没散，林越背着旧书包", sourceEndMarker: "脚步声在墙缝间回荡。" }),
    ];
    const r = computeSourceCoverage(clips, CHAPTER);
    expect(r.clipSpans).toHaveLength(1);
    expect(r.clipSpans[0].index).toBe(1);
  });
});

describe("buildMidWriteCoverageWarning·写入时缺口机检（ch14 根治·左移）", () => {
  const c0 = clip({
    clipPrompt: "a",
    sourceStartMarker: "清晨的雾还没散，林越背着旧书包走进巷口",
    sourceEndMarker: "脚步声在墙缝间回荡。",
  });
  const c1 = clip({
    clipPrompt: "b",
    sourceStartMarker: "拐过第二个弯，他撞见了守在杂货铺门前的老陈",
    sourceEndMarker: "招手让他过去喝碗热豆浆。",
  });
  const c2 = clip({
    clipPrompt: "c",
    sourceStartMarker: "两人闲聊时，一辆黑色轿车缓缓停在了街对面",
    sourceEndMarker: "露出一双冷漠打量的眼睛。",
  });

  it("相邻镜首尾相接=无告警；未写到的尾巴(tail)不报", () => {
    expect(buildMidWriteCoverageWarning([c0, c1], CHAPTER)).toBeNull();
    // 只写了第一镜：后面整章没覆盖也不算缺口（分批写作中）
    expect(buildMidWriteCoverageWarning([c0], CHAPTER)).toBeNull();
  });

  it("跳过整个节拍=当场回传同链修订证据，但不取得 start 终止权", () => {
    const w = buildMidWriteCoverageWarning([c0, c2], CHAPTER);
    expect(w).toMatch(/没进任何镜/);
    expect(w).not.toMatch(/source_coverage_gap/);
    expect(w).toMatch(/同一执行链继续修订/);
    expect(w).toMatch(/replaceAtIndex/);
  });

  it("按位提交空洞（undefined 槽位）相邻的接缝不猜 gap", () => {
    expect(buildMidWriteCoverageWarning([c0, undefined, c2], CHAPTER)).toBeNull();
  });

  it("开头漏掉的节拍(head)照报", () => {
    const w = buildMidWriteCoverageWarning([c1, c2], CHAPTER);
    expect(w).toMatch(/开头/);
  });

  it("空累积/无原文=不检", () => {
    expect(buildMidWriteCoverageWarning([], CHAPTER)).toBeNull();
    expect(buildMidWriteCoverageWarning([c0, c2], "")).toBeNull();
  });
});

describe("buildClipDialogueCoverageWarning·逐镜跨度对白覆盖（Tier1 左移）", () => {
  // 带引号台词的章节原文（>200 归一化字），两个节拍各含一句对白。
  const DLG_CHAPTER =
    "林越推开吱呀作响的木门，屋里的油灯早已熄灭，桌上摊着一封没写完的信，他借着月光眯眼辨认了许久，喉咙忽然发紧，攥着信纸的指节泛白，半晌才低声开口：「师父，你到底去了哪里，为什么连一句交代都不留给我。」" +
    "话音落下无人应答，他把信纸折好塞进怀里，转身取下墙上的旧剑，拂去剑鞘上的浮尘，掌心贴着冰凉的鞘身停了几息，随即咬牙说道：「不管你在天涯还是海角，我都要把你找回来，一步也不会停。」说罢推门而出，身影没入夜色。";

  const clipA = (over: Record<string, unknown> = {}) =>
    clip({
      clipPrompt: "镜头缓推，林越推门辨信，@林越（哽咽低声）：「师父，你到底去了哪里，为什么连一句交代都不留给我。」",
      sourceStartMarker: "林越推开吱呀作响的木门",
      sourceEndMarker: "都不留给我。」",
      ...over,
    });
  const clipB = (over: Record<string, unknown> = {}) =>
    clip({
      clipPrompt: "他折信取剑推门而出，身影没入夜色",
      sourceStartMarker: "话音落下无人应答",
      sourceEndMarker: "身影没入夜色。",
      ...over,
    });

  it("台词逐字在镜内=不告警", () => {
    expect(buildClipDialogueCoverageWarning([clipA()], DLG_CHAPTER)).toBeNull();
  });

  it("跨度内台词没进该镜=点名镜号与丢失台词", () => {
    const w = buildClipDialogueCoverageWarning([clipA(), clipB()], DLG_CHAPTER);
    expect(w).toMatch(/镜2/);
    expect(w).toMatch(/不管你在天涯还是海角/);
    expect(w).toMatch(/dialogueReviewed/);
  });

  it("台词写在 shots.dialogue 里也算覆盖", () => {
    const w = buildClipDialogueCoverageWarning(
      [clipB({ shots: [{ dialogue: "@林越：「不管你在天涯还是海角，我都要把你找回来，一步也不会停。」" }] })],
      DLG_CHAPTER,
    );
    expect(w).toBeNull();
  });

  it("dialogueReviewed:true 豁免；缺锚点/定位不到的镜不猜", () => {
    expect(buildClipDialogueCoverageWarning([clipB({ dialogueReviewed: true })], DLG_CHAPTER)).toBeNull();
    expect(
      buildClipDialogueCoverageWarning(
        [clip({ clipPrompt: "x", sourceStartMarker: "完全杜撰不存在的锚点文本", sourceEndMarker: "另一个杜撰锚点文本啊" })],
        DLG_CHAPTER,
      ),
    ).toBeNull();
    expect(buildClipDialogueCoverageWarning([clip({ clipPrompt: "x" })], DLG_CHAPTER)).toBeNull();
  });

  it("无原文/空 clips 不检", () => {
    expect(buildClipDialogueCoverageWarning([], DLG_CHAPTER)).toBeNull();
    expect(buildClipDialogueCoverageWarning([clipA()], "")).toBeNull();
  });
});

describe("auditClipDialogueCount — 台词条数守恒硬闸（2026-07-13 用户拍板·ch22-v2 丢3/12实证）", () => {
  const chapter = [
    "孟川睁开双眼望向火山口深处。",
    "「以我如今修为，配合乾坤尺遁行，应能省去不少时间。」",
    "「大工程。」",
    "他抬头望向东方。",
    "「得抓紧时间了。」",
    "妖蟒咆哮：「吼——！！」",
    "他转身踏入虚空消失不见。",
  ].join("\n");

  it("跨度内 3 条台词（吼为单字拟声不计）、clip 只有 1 条 → 出 issue 并给缺失提示", () => {
    const clips = [
      {
        sourceStartMarker: "孟川睁开双眼望向火山口深处。",
        sourceEndMarker: "他转身踏入虚空消失不见。",
        shots: [
          { action: "抬头", dialogue: "@孟川：「时间不多了」", durationSeconds: 3 },
          { action: "远望", durationSeconds: 3 },
        ],
      },
    ];
    const issues = auditClipDialogueCount(clips, chapter);
    expect(issues.length).toBe(1);
    expect(issues[0]!.need).toBe(3);
    expect(issues[0]!.got).toBe(1);
    expect(issues[0]!.missingHints.length).toBeGreaterThan(0);
  });

  it("条数够（内容已改编不逐字）→ 零 issue（内容可改编）", () => {
    const clips = [
      {
        sourceStartMarker: "孟川睁开双眼望向火山口深处。",
        sourceEndMarker: "他转身踏入虚空消失不见。",
        shots: [
          { action: "a", dialogue: "@孟川：「按老规矩，乾坤尺开路」", durationSeconds: 3 },
          { action: "b", dialogue: "@孟川：「够折腾的」", durationSeconds: 2 },
          { action: "c", dialogue: "@孟川：「走了」", durationSeconds: 2 },
        ],
      },
    ];
    expect(auditClipDialogueCount(clips, chapter)).toEqual([]);
  });

  it("无锚点/无 chapterText → 跳过（零回归）", () => {
    expect(auditClipDialogueCount([{ shots: [] }], chapter)).toEqual([]);
    expect(auditClipDialogueCount([{ sourceStartMarker: "孟川睁开双眼望向火山口深处。", sourceEndMarker: "他转身踏入虚空消失不见。", shots: [] }], "")).toEqual([]);
  });

  it("尾部台词顺延到下一镜：本段缺1条、相邻下一镜多带1条 → 顺延认账零 issue", () => {
    const clips = [
      {
        sourceStartMarker: "孟川睁开双眼望向火山口深处。",
        sourceEndMarker: "他抬头望向东方。", // 跨度含 2 条台词
        shots: [{ action: "a", dialogue: "@孟川：「乾坤尺开路」", durationSeconds: 3 }],
      },
      {
        sourceStartMarker: "「得抓紧时间了。」",
        sourceEndMarker: "他转身踏入虚空消失不见。", // 跨度含 1 条台词
        shots: [
          { action: "b", dialogue: "@孟川：「大工程，够折腾的」", durationSeconds: 2 },
          { action: "c", dialogue: "@孟川：「得抓紧时间了」", durationSeconds: 2 },
        ],
      },
    ];
    expect(auditClipDialogueCount(clips, chapter)).toEqual([]);
  });

  it("非相邻镜的富余不抵账（守恒只认相邻顺延）", () => {
    const clips = [
      {
        sourceStartMarker: "孟川睁开双眼望向火山口深处。",
        sourceEndMarker: "他抬头望向东方。", // need=2, got=1 → 缺1
        shots: [{ action: "a", dialogue: "@孟川：「乾坤尺开路」", durationSeconds: 3 }],
      },
      { shots: [{ action: "m", durationSeconds: 2 }] }, // 无锚点隔断镜（不审计·不供账）
      {
        sourceStartMarker: "「得抓紧时间了。」",
        sourceEndMarker: "他转身踏入虚空消失不见。", // need=1, got=2 → 富余1但与 clip0 不相邻
        shots: [
          { action: "b", dialogue: "@孟川：「大工程」", durationSeconds: 2 },
          { action: "c", dialogue: "@孟川：「得抓紧时间了」", durationSeconds: 2 },
        ],
      },
    ];
    const issues = auditClipDialogueCount(clips, chapter);
    expect(issues.length).toBe(1);
    expect(issues[0]!.index).toBe(0);
  });

  it("replace 模式经 opts.plan 用累积镜做邻位（先补收方再改让方）", () => {
    const receiver = {
      sourceStartMarker: "「得抓紧时间了。」",
      sourceEndMarker: "他转身踏入虚空消失不见。",
      shots: [
        { action: "b", dialogue: "@孟川：「大工程」", durationSeconds: 2 },
        { action: "c", dialogue: "@孟川：「得抓紧时间了」", durationSeconds: 2 },
      ],
    };
    const oldGiver = {
      sourceStartMarker: "孟川睁开双眼望向火山口深处。",
      sourceEndMarker: "他抬头望向东方。",
      shots: [
        { action: "a1", dialogue: "@孟川：「乾坤尺开路」", durationSeconds: 3 },
        { action: "a2", dialogue: "@孟川：「大工程」", durationSeconds: 2 },
      ],
    };
    const newGiver = {
      ...oldGiver,
      shots: [{ action: "a1", dialogue: "@孟川：「乾坤尺开路」", durationSeconds: 3 }],
    };
    // 收方(slot1)已先补足富余，再改让方(slot0)：经 plan 邻位认账 → 零 issue
    expect(
      auditClipDialogueCount([newGiver], chapter, { plan: [oldGiver, receiver], slotNos: [0] }),
    ).toEqual([]);
  });

  it("countSpanDialogueLines：≥3字计条，单字拟声不计", () => {
    const r = countSpanDialogueLines("「大工程。」「吼」「斩」「得抓紧时间了」");
    expect(r.count).toBe(2);
  });
});

describe("auditClipInfoUnitCoverage — 原文信息点守恒（要素守恒第二类型·2026-07-13 用户拍板「只能多不能缺」）", () => {
  // 繁体原文（对齐真实书源），四句信息句 + 一句台词 + 节奏短句 + 章题。
  const infoChapter = [
    "第9章 龍潭虎穴！",
    "　　孟川御劍橫越蒼茫雲海，抵達幽暗深谷的入口。",
    "　　守護谷口的是一頭渾身纏繞紫黑鎖鏈的九幽窮奇，兇焰滔天。",
    "　　谷底深處的龍族餘孽察覺到他懷中骨片散發的祖巫印記，竟悄然退避，不敢現身。",
    "　　「這氣息……惹不起。」",
    "　　轟！",
    "　　孟川渾然不覺，徑直踏入谷中，取走了那株九葉靈芝。",
  ].join("\n");
  const START = "孟川御劍橫越蒼茫雲海";
  const END = "取走了那株九葉靈芝";

  it("整段暗线蒸发（稀有判别词零命中）→ uncovered 硬报；简体承载句因繁简折叠不误报", () => {
    const clips = [
      {
        sourceStartMarker: START,
        sourceEndMarker: END,
        // 简体提示词：承载了御剑抵谷口、穷奇、取灵芝——但「龙族余孽因骨片祖巫印记退避」整句蒸发。
        clipPrompt:
          "孟川御剑横越苍茫云海抵达幽暗深谷入口；一头缠绕紫黑锁链的九幽穷奇凶焰滔天镇守谷口；孟川径直踏入谷中取走九叶灵芝。",
      },
    ];
    const issues = auditClipInfoUnitCoverage(clips, infoChapter);
    expect(issues.length).toBe(1);
    const heads = issues[0]!.uncovered.map((u) => u.head).join("|");
    expect(heads).toContain("龍族餘孽");
    // 已被简体承载的句子不得进 uncovered（繁简折叠 + 稀有 gram 命中）。
    expect(heads).not.toContain("九幽窮奇");
    expect(heads).not.toContain("九葉靈芝");
  });

  it("暗线补进 VO（意译可，关键实体词在）→ 零 uncovered", () => {
    const clips = [
      {
        sourceStartMarker: START,
        sourceEndMarker: END,
        clipPrompt:
          "孟川御剑横越苍茫云海抵达幽暗深谷入口；九幽穷奇镇守谷口；孟川踏入谷中取走九叶灵芝。",
        shots: [
          {
            action: "远景龙影退避",
            dialogue: "@旁白VO：「龙族余孽察觉他怀中骨片的祖巫印记，悄然退避。」",
            durationSeconds: 3,
          },
        ],
      },
    ];
    const issues = auditClipInfoUnitCoverage(clips, infoChapter);
    expect(issues.filter((i) => i.uncovered.length)).toEqual([]);
  });

  it("引号台词句/节奏短句/章题不计信息句（台词归台词闸辖区）", () => {
    const units = splitSpanInfoUnits(infoChapter);
    const heads = units.map((u) => u.head).join("|");
    expect(heads).not.toContain("這氣息");
    expect(heads).not.toContain("轟");
    expect(heads).not.toContain("第9章");
  });

  it("跨镜承载（carrierExtraText 并集口径）→ 不误报", () => {
    const clips = [
      {
        sourceStartMarker: START,
        sourceEndMarker: END,
        clipPrompt: "孟川御剑抵谷口；九幽穷奇镇守；取走九叶灵芝。",
      },
    ];
    const issues = auditClipInfoUnitCoverage(clips, infoChapter, {
      carrierExtraText: "另一镜的画面：龙族余孽窥见骨片祖巫印记幽光，悄然退避没入黑暗。",
    });
    expect(issues.filter((i) => i.uncovered.length)).toEqual([]);
  });

  it("无锚点/无 chapterText → 零回归", () => {
    expect(auditClipInfoUnitCoverage([{ clipPrompt: "x" }], infoChapter)).toEqual([]);
    expect(
      auditClipInfoUnitCoverage(
        [{ sourceStartMarker: START, sourceEndMarker: END, clipPrompt: "x" }],
        "",
      ),
    ).toEqual([]);
  });
});
