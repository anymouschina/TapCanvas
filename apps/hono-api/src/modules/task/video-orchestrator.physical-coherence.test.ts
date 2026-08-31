import { describe, expect, it } from "vitest";
import {
  validateCausalProvenanceDiscipline,
  validateClipScaleFramingCoherence,
  validateClipSpatialCoherence,
} from "./video-orchestrator.physical-coherence";

describe("闸B 空间自洽（v18 荒谬抛投回归）", () => {
  it("拦住 v18 clip:5 原样数据：贴身距离 + 抛物线同时硬约束", () => {
    const issues = validateClipSpatialCoherence({
      startKeyframe: "黑暗荒野小木屋外，苏晓、查尔斯、阿菲娅、兹德内克围在木门与短阶附近；苏晓右手为空。",
      shots: [
        { shotNo: 2, action: "查尔斯身体前倾半步试探开价；四人之间的距离与抛接轴线不变。", framing: "中景双人关系镜" },
        { shotNo: 5, action: "肩胯转动带动右臂加速，核心沿抛物线飞过两人之间。", framing: "宽中景，释放点、抛物线和查尔斯双手同框。" },
      ],
      assetObjectContracts: [{ name: "查尔斯", spatialRelation: "苏晓前方中景，处于可接住抛物线的距离。" }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].problem).toContain("围在");
    expect(issues[0].problem).toContain("抛");
    expect(issues[0].problem).toContain("二选一改写");
  });

  it("只有远距离抛投不拦（拉开距离保持警戒是合法写法）", () => {
    expect(validateClipSpatialCoherence({
      startKeyframe: "两人隔着十余步残墙对峙，互不靠近。",
      shots: [{ shotNo: 1, action: "苏晓把核心沿抛物线抛过空地。", framing: "全景" }],
    })).toHaveLength(0);
  });

  it("只有贴身递交不拦", () => {
    expect(validateClipSpatialCoherence({
      startKeyframe: "四人围在木门附近。",
      shots: [{ shotNo: 1, action: "苏晓把核心放进查尔斯掌心。", framing: "中近景" }],
    })).toHaveLength(0);
  });
});

describe("闸C 景别与尺度链互斥（v18 主角小到读不出回归）", () => {
  it("拦住 v18 clip:5 镜1：全片大全景却要求单人占画面五成", () => {
    const issues = validateClipScaleFramingCoherence({
      shots: [{ shotNo: 1, framing: "大全景，建立木屋与四人空间关系。" }],
      assetObjectContracts: [{ name: "苏晓", scale: "全身约画面高度五成，手臂与抛物线清晰。" }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("assetObjectContracts[苏晓].scale");
    expect(issues[0].problem).toContain("静默作废");
  });

  it("clip 内有中近景镜时放行（尺度链可挂在那一镜）", () => {
    expect(validateClipScaleFramingCoherence({
      shots: [
        { shotNo: 1, framing: "大全景，建立空间。" },
        { shotNo: 2, framing: "中近景，掌心与半身同框。" },
      ],
      assetObjectContracts: [{ name: "苏晓", scale: "全身约画面高度五成。" }],
    })).toHaveLength(0);
  });

  it("大景别配相符比例不拦", () => {
    expect(validateClipScaleFramingCoherence({
      shots: [{ shotNo: 1, framing: "大远景，航拍庇护城。" }],
      assetObjectContracts: [{ name: "苏晓", scale: "约画面高度一成，仅可辨轮廓。" }],
    })).toHaveLength(0);
  });
});

describe("闸A 溯源纪律（v18 凭空发明抛投回归）", () => {
  const v18SourceFacts = [
    { evidenceType: "source_fact", sourceMarker: "火焰核心是苏晓赢下乐园争夺战的战利品之一" },
    { evidenceType: "source_fact", sourceMarker: "一位教士从怀中，掏出一颗跳动的机械心脏，它" },
    { evidenceType: "necessary_physical_result", sourceMarker: "苏晓主动从个人储存空间取出，实体出现在掌中" },
    { evidenceType: "necessary_physical_result", sourceMarker: "火焰核心真实照亮手掌、衣物、面部、烟尘与黑暗" },
    { evidenceType: "necessary_physical_result", sourceMarker: "抛出后查尔斯下意识接住并牢牢握紧" },
  ];

  it("拦住 v18 essentialCausality[4]「苏晓直接抛出而非递交」", () => {
    const errors = validateCausalProvenanceDiscipline({
      beatIndex: 5,
      essentialCausality: ["核心是战利品", "存于储存空间", "取出后照亮环境", "查尔斯试图开价", "苏晓直接抛出而非递交"],
      causalProvenance: v18SourceFacts,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("essentialCausality[4]");
    expect(errors[0]).toContain("手法取舍句式");
    expect(errors[0]).toContain("不得盖章升格为硬因果");
  });

  it("真正的必要物理结果放行（照亮/接住/握紧不含取舍与投掷）", () => {
    expect(validateCausalProvenanceDiscipline({
      beatIndex: 5,
      essentialCausality: ["取出后照亮手掌与烟尘", "查尔斯接住并握紧"],
      causalProvenance: [
        { evidenceType: "necessary_physical_result", sourceMarker: "核心真实照亮手掌" },
        { evidenceType: "necessary_physical_result", sourceMarker: "接住后牢牢握紧" },
      ],
    })).toHaveLength(0);
  });

  it("原文真写了抛时放行（同 beat 有 source_fact 引用即不算发明）", () => {
    expect(validateCausalProvenanceDiscipline({
      beatIndex: 3,
      essentialCausality: ["原文交代核心易主", "苏晓把核心抛向对方"],
      causalProvenance: [
        { evidenceType: "source_fact", sourceMarker: "原文：他随手一抛，火焰核心落进对方手里" },
        { evidenceType: "necessary_physical_result", sourceMarker: "抛出后对方接住" },
      ],
    })).toHaveLength(0);
  });

  it("source_fact 条目不受本闸约束（原文怎么写就怎么记）", () => {
    expect(validateCausalProvenanceDiscipline({
      beatIndex: 1,
      essentialCausality: ["他抛出而非递交"],
      causalProvenance: [{ evidenceType: "source_fact", sourceMarker: "原文：他抛出而非递交" }],
    })).toHaveLength(0);
  });
});
