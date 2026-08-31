import { describe, expect, it } from "vitest";
import { normalizeRoleKey, validateStoryPlan } from "./video-orchestrator.orchestrate";
import {
  validateBeatSheet as validateBeatSheetWithContract,
  type BeatSheet,
} from "./video-orchestrator.beat-sheet";
import { clipNeedsEnsemble } from "./video-orchestrator.asset-selfheal";

const TEST_GENERATION_CONTRACT = {
  videoModel: "doubao-seedance-2-0-260128",
  durationOptions: [5, 10, 15],
  maxDurationSeconds: 15,
  referenceImagePolicy: {
    countUnit: "unique_url" as const,
    maximumTotalImages: 9,
    maximumBusinessImages: 9,
  },
  referenceAudioPolicy: {
    minimumDurationSeconds: 1.8,
    maximumDurationSeconds: 30.2,
  },
};

const storyFactsContext: BeatSheet["storyFactsContext"] = {
  mode: "task_context" as const,
  sourceLabel: "prop-binding-test",
  bookId: null,
  ledgerRevision: null,
  effectiveAt: null,
  consumedFactIds: [],
  consumedContextKeys: [],
};

const storyFactLocks = {
  effectiveAt: null,
  bindings: [],
  revealGuards: [],
};

const objectContract = (kind: "character" | "scene" | "prop" | "vfx", name: string) => ({
  kind,
  name,
  referenceImageNodeIds: [`asset-${kind}-${name}`],
  referenceRole: kind === "character" ? "identity" as const : kind === "scene" ? "environment" as const : kind,
  forbiddenTransfer: "不迁移参考资产的背景、姿势或无关内容",
  identityInvariant: `${name} 身份不变`,
  startState: `${name} 起态`,
  spatialRelation: `${name} 空间关系`,
  scale: `${name} 尺度`,
  driver: `${name} 驱动`,
  stateChange: `${name} 变化`,
  endState: `${name} 终态`,
});

const validateBeatSheet = (input: unknown, chapterText: string) =>
  validateBeatSheetWithContract(input, chapterText, {
    generationContract: TEST_GENERATION_CONTRACT,
  });

describe("道具 canonical 名归一化", () => {
  it("normalizeRoleKey 繁简折叠：繁体卡名与简体文本同键", () => {
    expect(normalizeRoleKey("弒神槍殘體")).toBe(normalizeRoleKey("弑神枪残体"));
    expect(normalizeRoleKey("龍族·餘孽")).toBe(normalizeRoleKey("龙族余孽"));
  });

  it("不会把不同 canonical 名折叠成同一实体", () => {
    expect(normalizeRoleKey("弒神槍殘體")).not.toBe(normalizeRoleKey("青萍剑"));
  });
});

describe("propNames 申报链（2026-07-14 根治终态：LLM申报·服务端确定性绑卡）", () => {
  it("validateBeatSheet 归一化 propNames + castManifest 缺卡告警", () => {
    const v = validateBeatSheet(
      {
        version: 2,
        runId: "ch92-v1",
        storyFactsContext,
        beats: [
          {
            clipIndex: 0, logline: "试枪", startKeyframe: "孟川察觉枪身震动", endKeyframe: "孟川握枪站定", exitState: "e", rhythmRole: "爆发", arcContract: { arcRole: "continuous", closureMode: "open_motion", arcFunction: "连续推进", sequenceContext: "多段序列中的技术窗口" }, durationBudget: 10,
            characterRoleNames: ["孟川"], speakerNames: [], dialogueScript: [], propNames: [" 弒神槍殘體 ", "弒神槍殘體", "无卡幻剑"],
            storyboardImageNodeId: "keyframe-ch92-0",
            storyboardFrameCount: 1,
            videoReferenceNodeIds: [],
            continuityMode: "editorial_cut",
            vfxNames: [],
            storyFactLocks,
            dramaticChange: {
              objective: "在威胁逼近前试枪",
              obstacle: "未知威胁与枪身异动",
              stake: "失去先手就会被压制",
              choice: "握紧枪身跨出一步",
              consequence: "暴露攻击意图",
              stateDelta: "由警觉转为主动承担风险",
              stateTransitions: [{
                actionId: "state-meng-strategy-0",
                entity: "孟川",
                dimension: "strategy",
                before: "观察",
                after: "主动试枪",
                causeCausalityIndex: 2,
                persistence: "chapter",
              }],
            },
            audienceExperience: {
              pov: "跟随孟川有限感知",
              knowledgeGap: "观众知道威胁逼近，孟川只知道枪身反馈",
              revealOrder: "先反应后揭枪身变化",
              intendedQuestion: "逼近的威胁是什么",
            },
            payoff: {
              debtId: "debt-gun-awakening",
              lifecycleAction: "plant",
              eligibleFromClipIndex: 0,
              setupDebt: "枪身异动意味着未知力量",
              payoffType: "部分兑现",
              payoffMoment: "孟川握紧枪身时反馈增强",
              visibleConsequence: "枪身震动并发出摩擦声",
              reactionCarrier: "孟川跨步取得一次出手机会",
            },
            emotionTurn: {
              residueIn: "未知威胁留下的警觉",
              before: "警觉试探",
              trigger: "枪身反馈增强",
              suppressionLeak: "维持站姿但握力收紧",
              after: "决意主动出手",
              actionChange: "由观察改为跨步试枪",
              residueOut: "主动迎击仍伴随对威胁来源的不确定",
            },
            pacingDecision: {
              sourceTreatment: "retain",
              essentialCausality: ["察觉枪身异动", "判断威胁", "握枪主动迎击"],
              causalProvenance: [
                { evidenceType: "source_fact", sourceMarker: "孟川心下一沉" },
                { evidenceType: "source_fact", sourceMarker: "孟川心下一沉" },
                { evidenceType: "source_fact", sourceMarker: "用力握紧了枪身" },
              ],
              handoffToNext: "孟川已暴露攻击意图",
            },
            assetObjectContracts: [
              objectContract("character", "孟川"),
              objectContract("scene", "洪荒荒野"),
              objectContract("prop", "弒神槍殘體"),
              objectContract("prop", "无卡幻剑"),
            ],
            emotionPlan: {
              audienceIntent: "感到武器威胁逼近",
              entryState: "警觉",
              trigger: "孟川握紧枪身",
              progression: "警觉升级为决意",
              visualCarrier: "握力、视线与肩线变化",
              soundCarrier: "枪身摩擦声与呼吸",
              exitState: "决意已定",
            },
            dramaticPlan: {
              focusCharacter: "孟川",
              objective: "在威胁逼近前试枪",
              stake: "失去先手就会被压制",
              perception: "枪身反馈正在增强",
              judgment: "此刻可以主动出手",
              choice: "握紧枪身跨出一步",
              consequence: "暴露攻击意图",
              arcChange: "由警觉转为主动承担风险",
            },
            directorPlan: {
              primaryDramaticChange: "孟川从警觉转为主动试枪",
              shotPOV: "跟随孟川有限感知",
              audienceKnowledge: "观众知道威胁逼近",
              characterKnowledge: "孟川只知道枪身反馈",
              revealOrder: "先反应后揭枪身变化",
              powerBefore: "威胁占主动",
              powerAfter: "孟川取得一次出手机会",
              soundPerspective: "收窄到枪身摩擦与呼吸",
              essentialCausality: ["察觉", "判断", "握枪"],
              continuityLocks: ["枪身形制与持握方向"],
              optionalTexture: ["尘屑"],
              capacityDecision: "keep",
              capacityRationale: "单一试枪变化可读",
            },
            sourceStartMarker: "很快，孟川心下一沉",
            sourceEndMarker: "他随即用力握紧了枪身",
          },
        ],
        filmBible: {
          directorTone: "t",
          visualBible: "v",
          emotionalArc: "警觉→决意",
          characterArcs: "孟川：警觉试探→主动承担风险",
          continuityBible: "角色服装、枪身形制与场景拓扑不变",
          atmosphereStrategy: "本拍无功能性空镜",
        },
        adaptationStrategy: {},
        meta: { executionScope: "media_delivery", deliveryScope: "full_chapter" },
        castManifest: [
          { kind: "character", name: "孟川" },
          {
            kind: "prop",
            name: "弒神槍殘體",
            materialIdentity: { mode: "base", canonicalName: "弒神槍殘體" },
          },
        ],
      },
      "很快，孟川心下一沉。他随即用力握紧了枪身。",
    );
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.normalized.beats[0]!.propNames).toEqual(["弒神槍殘體", "无卡幻剑"]);
    expect(v.warnings.join("|")).toContain("无卡幻剑");
    expect(v.warnings.join("|")).not.toContain("道具「弒神槍殘體」");
  });

  it("rejects a prop without explicit canonical/state identity", () => {
    const v = validateBeatSheet(
      {
        version: 2,
        runId: "ch-prop-invalid",
        beats: [],
        filmBible: {},
        adaptationStrategy: {},
        castManifest: [{ kind: "prop", name: "混元金斗清光" }],
      },
      "",
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join("|")).toContain("materialIdentity");
  });

  it("keeps a prop state under the canonical name", () => {
    const v = validateBeatSheet(
      {
        version: 2,
        runId: "ch-prop-state",
        beats: [],
        filmBible: {},
        adaptationStrategy: {},
        castManifest: [
          {
            kind: "prop",
            name: "混元金斗",
            materialIdentity: {
              mode: "state",
              canonicalName: "混元金斗",
              canonicalAssetId: "asset-hunyuan-jindou",
              stateKey: "clear-light",
              stateDescription: "斗身释放清光",
            },
          },
        ],
      },
      "",
    );
    expect(v.normalized.castManifest[0]).toMatchObject({
      name: "混元金斗",
      materialIdentity: {
        mode: "state",
        canonicalName: "混元金斗",
        stateKey: "clear-light",
      },
    });
  });

  it("validateStoryPlan 透传 clip.propNames（防白名单剥字段）", () => {
    const contracts = [
      objectContract("character", "孟川"),
      objectContract("prop", "弒神槍殘體"),
    ];
    const plan = validateStoryPlan({
      runId: "ch92-v1", targetDurationSeconds: 12, videoModel: "doubao-seedance-2-0-260128",
      clips: [{
        clipPrompt: "x".repeat(20),
        propNames: ["弒神槍殘體", " "],
        characterRoleNames: ["孟川"],
        videoReferenceNodeIds: [],
        continuityMode: "editorial_cut",
        assetObjectContracts: contracts,
      }],
    });
    expect(plan.clips[0]!.propNames).toEqual(["弒神槍殘體"]);
    expect(plan.clips[0]!.videoReferenceNodeIds).toEqual([
      "asset-character-孟川",
      "asset-prop-弒神槍殘體",
    ]);
  });

  it("validateStoryPlan 透传 canonical sceneName，供最终请求精确绑定场景卡", () => {
    const sceneContract = objectContract("scene", "罗家顶层复式客厅");
    const plan = validateStoryPlan({
      runId: "ch92-scene",
      targetDurationSeconds: 12,
      videoModel: "doubao-seedance-2-0-260128",
      clips: [{
        clipPrompt: "x".repeat(20),
        sceneName: "罗家顶层复式客厅",
        videoReferenceNodeIds: [],
        continuityMode: "editorial_cut",
        assetObjectContracts: [sceneContract],
      }],
    });
    expect(plan.clips[0]?.sceneName).toBe("罗家顶层复式客厅");
    expect(plan.clips[0]?.videoReferenceNodeIds).toEqual([
      "asset-scene-罗家顶层复式客厅",
    ]);
  });

  it("validateStoryPlan preserves valid object contracts and rejects malformed ones", () => {
    const contract = objectContract("vfx", "青萍剑光");
    const plan = validateStoryPlan({
      runId: "ch92-object-contract",
      targetDurationSeconds: 10,
      videoModel: "doubao-seedance-2-0-260128",
      clips: [{
        clipIndex: 0,
        clipPrompt: "剑光横越混沌",
        videoReferenceNodeIds: [],
        continuityMode: "editorial_cut",
        assetObjectContracts: [contract],
      }],
    });
    expect(plan.clips[0]?.assetObjectContracts).toEqual([
      expect.objectContaining(contract),
    ]);
    expect(plan.clips[0]?.videoReferenceNodeIds).toEqual(["asset-vfx-青萍剑光"]);
    const withoutContract = validateStoryPlan({
      runId: "ch92-object-contract-selector-ignored",
      targetDurationSeconds: 10,
      videoModel: "doubao-seedance-2-0-260128",
      clips: [{
        clipIndex: 0,
        clipPrompt: "剑光横越混沌",
        vfxNames: ["模型重复填写的青萍剑光"],
        videoReferenceNodeIds: [],
        continuityMode: "editorial_cut",
        assetObjectContracts: [],
      }],
    });
    expect(withoutContract.clips[0]?.vfxNames).toEqual(["模型重复填写的青萍剑光"]);
    expect(withoutContract.clips[0]?.assetObjectContracts).toEqual([]);
  });
});

describe("多元素同框实体泛化（2026-07-14 群像图针对资产不止角色）", () => {
  it("角色+申报道具合计≥4 → 需要合成参考图；纯道具无角色不触发；旧≥3人规则保留", () => {
    expect(clipNeedsEnsemble({ clipPrompt: "x", characterRoleNames: ["孟川", "青龙"], propNames: ["弒神槍殘體", "乾坤尺"] })).toBe(true);
    expect(clipNeedsEnsemble({ clipPrompt: "x", characterRoleNames: [], propNames: ["a", "b", "c", "d"] })).toBe(false);
    expect(clipNeedsEnsemble({ clipPrompt: "x", characterRoleNames: ["孟川"], propNames: ["乾坤尺"] })).toBe(false);
    expect(clipNeedsEnsemble({ clipPrompt: "x", characterRoleNames: ["甲", "乙", "丙"] })).toBe(true);
  });

});
