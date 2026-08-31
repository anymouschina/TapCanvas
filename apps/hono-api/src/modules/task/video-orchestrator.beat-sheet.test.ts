import { describe, expect, it } from "vitest";

import {
  enrichBeatsWithSourceSpans,
  splitBeatClipTasks,
  validateBeatSheet,
  type Beat,
  type BeatSheet,
} from "./video-orchestrator.beat-sheet";
import type {
  AssetObjectContract,
  AssetObjectKind,
} from "./video-orchestrator.asset-object-contract";
import { buildSourceUnits, compileSourceCoverageSelection } from "./video-orchestrator.source-units";

const GENERATION_CONTRACT = {
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

function objectContract(kind: AssetObjectKind, name: string): AssetObjectContract {
  return {
    kind,
    name,
    referenceImageNodeIds: [`asset-${kind}-${name}`],
    referenceRole: kind === "character" ? "identity" : kind === "scene" ? "environment" : kind,
    forbiddenTransfer: `${name} 的参考背景、姿势与无关对象不得迁移`,
    identityInvariant: `${name} 身份不变`,
    startState: `${name} 起态`,
    spatialRelation: `${name} 空间关系`,
    scale: `${name} 尺度`,
    driver: `${name} 驱动`,
    stateChange: `${name} 变化`,
    endState: `${name} 终态`,
  };
}

function makeBeat(clipIndex: number): Beat {
  return {
    clipIndex,
    logline: `事件 ${clipIndex}`,
    startKeyframe: `起始画面 ${clipIndex}`,
    endKeyframe: `结束画面 ${clipIndex}`,
    exitState: `人物停在位置 ${clipIndex}`,
    storyFactLocks: {
      effectiveAt: null,
      bindings: [],
      revealGuards: [],
    },
    rhythmRole: clipIndex % 2 === 0 ? "铺垫" : "爆发",
    arcContract: {
      arcRole: "continuous",
      closureMode: "open_motion",
      arcFunction: "在整体压力升级中继续推进，不独立收束",
      sequenceContext: "200 秒连续序列中的一个 10 秒技术窗口",
    },
    dramaticChange: {
      objective: "抵达宫门",
      obstacle: "混沌威压阻路",
      stake: "无法赴约将失去入门资格",
      choice: "顶住威压继续前行",
      consequence: "暴露真实承压极限",
      stateDelta: "从观望变为主动闯关",
      stateTransitions: [{
        actionId: `state-action-${clipIndex}`,
        entity: "孟川",
        dimension: "strategy",
        before: clipIndex === 0 ? "观望" : `主动承压-${clipIndex - 1}`,
        after: `主动承压-${clipIndex}`,
        causeCausalityIndex: 0,
        persistence: "chapter",
      }],
    },
    audienceExperience: {
      pov: "跟随孟川的有限视点",
      knowledgeGap: "观众与孟川都不知道门后是谁",
      revealOrder: "先见威压反馈，再见宫门开启",
      intendedQuestion: "门后的人为何此刻开门",
    },
    payoff: {
      debtId: `debt-palace-gate-${clipIndex}`,
      lifecycleAction: "plant",
      eligibleFromClipIndex: clipIndex,
      setupDebt: "此前宫门紧闭的等待",
      payoffType: "部分兑现并升级",
      payoffMoment: "孟川抵达时宫门自行开启",
      visibleConsequence: "玉门裂开一道强光",
      reactionCarrier: "孟川停步抬眼",
    },
    emotionTurn: {
      residueIn: clipIndex === 0 ? "上一章留下的戒备" : "戒备升级为主动试探",
      before: "克制观察",
      trigger: "威压突然加重",
      suppressionLeak: "维持步速但指节收紧",
      after: "警觉且决意前行",
      actionChange: "由试探改为正面承压",
      residueOut: "戒备升级为主动试探",
    },
    pacingDecision: {
      sourceTreatment: "compress",
      essentialCausality: ["威压阻路促使孟川主动闯关"],
      causalProvenance: [{ evidenceType: "source_fact", sourceMarker: `本段正文开始标记${clipIndex}` }],
      handoffToNext: "宫门开启但门后身份未知",
    },
    durationBudget: 10,
    sourceStartMarker: `本段正文开始标记${clipIndex}`,
    sourceEndMarker: `本段正文结束标记${clipIndex}`,
    sceneName: "紫霄宫道途",
    characterRoleNames: ["孟川"],
    speakerNames: [],
    dialogueScript: [],
    storyboardImageNodeId: `keyframe-${clipIndex}`,
    storyboardFrameCount: 1,
    videoReferenceNodeIds: [],
    continuityMode: "editorial_cut",
    vfxNames: [],
    assetObjectContracts: [
      objectContract("character", "孟川"),
      objectContract("scene", "紫霄宫道途"),
    ],
  };
}

function makeSheet(count = 2): BeatSheet {
  return {
    version: 2,
    runId: "run-keyframe-v2",
    chapterId: "book-demo-ch30",
    storyFactsContext: {
      mode: "task_context",
      sourceLabel: "beat-sheet-test",
      bookId: null,
      ledgerRevision: null,
      effectiveAt: null,
      consumedFactIds: [],
      consumedContextKeys: [],
    },
    beats: Array.from({ length: count }, (_, index) => makeBeat(index)),
    filmBible: {
      directorTone: "克制的洪荒史诗",
      visualBible: "冷灰混沌与玉白轮廓光",
      emotionalArc: "观察到压力逐步抬升",
      characterArcs: "孟川由旁观转为主动前行",
      continuityBible: "服装、空间方向与光源连续",
      atmosphereStrategy: "只在换场时使用环境建立镜",
      hardRules: "无字幕",
    },
    adaptationStrategy: { hook: "远处宫门开启" },
    castManifest: [
      { kind: "character", name: "孟川" },
      { kind: "scene", name: "紫霄宫道途" },
    ],
    meta: {
      executionScope: "media_delivery",
      deliveryScope: "full_chapter",
      videoModel: GENERATION_CONTRACT.videoModel,
      generationContract: GENERATION_CONTRACT,
    },
  };
}

function chapterText(count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `本段正文开始标记${index}，正文事件${index}，本段正文结束标记${index}。`,
  ).join("\n");
}

describe("Keyframe BeatSheet v2 validation", () => {
	it("uses canonical source coverage instead of requiring redundant per-beat task bindings", () => {
		const sheet = makeSheet(1);
		sheet.storyFactsContext = {
			...sheet.storyFactsContext,
			consumedContextKeys: ["chapter-source"],
		};
		const result = validateBeatSheet(sheet, chapterText(1), {
			generationContract: GENERATION_CONTRACT,
		});
		expect(result.errors).toEqual([]);
		expect(result.ok).toBe(true);
	});

	it("rejects a paid clip without a canonical scene asset contract", () => {
		const sheet = makeSheet(1);
		sheet.beats[0]!.assetObjectContracts = sheet.beats[0]!.assetObjectContracts.filter(
			(contract) => contract.kind !== "scene",
		);
		const result = validateBeatSheet(sheet, chapterText(1), {
			generationContract: GENERATION_CONTRACT,
		});
		expect(result.ok).toBe(false);
		expect(result.errors.join("|")).toContain("sceneName 必填");
	});

	it("rejects a full-chapter plan whose source ranges leave the opening uncovered", () => {
		const sheet = makeSheet(2);
		sheet.beats[0]!.sourceStartMarker = "本段正文开始标记1";
		sheet.beats[0]!.sourceEndMarker = "本段正文结束标记1";
		const result = validateBeatSheet(sheet, chapterText(2), {
			generationContract: GENERATION_CONTRACT,
		});
		expect(result.ok).toBe(false);
		expect(result.errors.join("|")).toContain("meta.deliveryScope=full_chapter 但原文覆盖在 clip 0 前存在区间缺口");
	});

	it("derives full-chapter duration from all beats without persisting a target", () => {
		const sheet = makeSheet(2);
		const result = validateBeatSheet(sheet, chapterText(2), {
			generationContract: GENERATION_CONTRACT,
		});
		expect(result.ok).toBe(true);
		expect(result.normalized.beats.reduce((sum, beat) => sum + beat.durationBudget, 0)).toBe(20);
		expect(result.normalized.meta).not.toHaveProperty("targetDurationSeconds");
		expect(validateBeatSheet(result.normalized, chapterText(2), {
			generationContract: GENERATION_CONTRACT,
		}).ok).toBe(true);
	});

	it("rejects a caller-supplied target for a full chapter", () => {
		const sheet = makeSheet(2);
		sheet.meta = { ...sheet.meta, targetDurationSeconds: 20 };
		const result = validateBeatSheet(sheet, chapterText(2), {
			generationContract: GENERATION_CONTRACT,
		});
		expect(result.ok).toBe(false);
		expect(result.errors).toContain(
			"meta.deliveryScope=full_chapter 时禁止提交 targetDurationSeconds；整章总时长只能由完整 beats[].durationBudget 求和产生",
		);
	});

	it("keeps a single submitted technical window open when the larger sequence continues", () => {
		const sheet = makeSheet(1);
		sheet.adaptationStrategy.hook = "刀锋交汇后强光定格";
		const result = validateBeatSheet(sheet, chapterText(1), {
			generationContract: GENERATION_CONTRACT,
		});

		expect(result.ok).toBe(true);
		expect(result.normalized.beats[0]?.arcContract).toEqual({
			arcRole: "continuous",
			closureMode: "open_motion",
			arcFunction: "在整体压力升级中继续推进，不独立收束",
			sequenceContext: "200 秒连续序列中的一个 10 秒技术窗口",
		});
		expect(result.normalized.adaptationStrategy.hook).toBe("刀锋交汇后强光定格");
	});

	it("injects a hook only for an explicit sequence resolution", () => {
		const sheet = makeSheet(1);
		sheet.beats[0]!.arcContract = {
			arcRole: "resolution",
			closureMode: "sequence_resolution",
			arcFunction: "完成用户要求的整体收束",
			sequenceContext: "独立 10 秒完整短片",
		};
		const result = validateBeatSheet(sheet, chapterText(1), {
			generationContract: GENERATION_CONTRACT,
		});
		expect(result.ok).toBe(true);
		expect(result.normalized.beats[0]?.arcContract).toEqual({
			arcRole: "resolution",
			closureMode: "sequence_resolution",
			arcFunction: "完成用户要求的整体收束",
			sequenceContext: "独立 10 秒完整短片",
		});
	});

	it("reports sequence resolution before the final beat without blocking execution", () => {
		const sheet = makeSheet(2);
		sheet.beats[0]!.arcContract.closureMode = "sequence_resolution";
		const result = validateBeatSheet(sheet, chapterText(2), {
			generationContract: GENERATION_CONTRACT,
		});

		expect(result.ok).toBe(true);
		expect(result.warnings.join("|")).toContain("sequence_resolution 出现在非末 beat");
	});
	it("removes legacy project style URLs from the normalized agent-visible contract", () => {
		const sheet = makeSheet(1);
		(sheet.meta as Record<string, unknown>).styleReferenceImageUrl =
			"https://assets.test/project-style.png";

		const result = validateBeatSheet(sheet, chapterText(1), {
			generationContract: GENERATION_CONTRACT,
		});

		expect(result.ok).toBe(true);
		expect(result.normalized.meta).not.toHaveProperty("styleReferenceImageUrl");
		expect(JSON.stringify(result.normalized)).not.toContain("project-style.png");
	});

	it("validates learning adoption provenance as an append-only query subset", () => {
		const valid = makeSheet(1);
		valid.meta = {
			...valid.meta,
			learningProvenance: {
				queryToolCallId: "query-validated-1",
				queriedValidatedCandidateIds: ["candidate-a", "candidate-b"],
				adoptedCandidateIds: ["candidate-b"],
			},
		};
		const validResult = validateBeatSheet(valid, chapterText(1));
		expect(validResult.errors).not.toEqual(expect.arrayContaining([
			expect.stringContaining("learningProvenance"),
		]));
		expect(validResult.normalized.meta?.learningProvenance).toEqual(valid.meta.learningProvenance);

		const forged = makeSheet(1);
		forged.meta = {
			...forged.meta,
			learningProvenance: {
				queryToolCallId: "query-validated-1",
				queriedValidatedCandidateIds: ["candidate-a"],
				adoptedCandidateIds: ["forged"],
			},
		};
		expect(validateBeatSheet(forged, chapterText(1)).errors).toEqual(expect.arrayContaining([
			expect.stringContaining("必须是 queriedValidatedCandidateIds 子集"),
		]));
	});

	it("derives speaker authority from dialogueScript without imposing a pre-handoff voice-reference budget", () => {
		const missing = makeSheet(1) as unknown as { beats: Array<Record<string, unknown>> };
		delete missing.beats[0]!.speakerNames;
		const missingResult = validateBeatSheet(missing, chapterText(1), {
			generationContract: GENERATION_CONTRACT,
		});
		expect(missingResult.ok).toBe(true);
		expect(missingResult.normalized.beats[0]?.speakerNames).toEqual([]);

		const overBudget = makeSheet(1);
		overBudget.beats[0]!.dialogueScript = ["甲", "乙", "丙", "丁"].map((speakerName, index) => ({
			lineId: `line-${index}`,
			speakerName,
			text: `台词${index}`,
			delivery: "on_screen" as const,
		}));
		overBudget.beats[0]!.dialoguePaceRate = 4;
		const multiSpeakerResult = validateBeatSheet(overBudget, chapterText(1), {
			generationContract: GENERATION_CONTRACT,
		});
		expect(multiSpeakerResult.ok).toBe(true);
		expect(multiSpeakerResult.normalized.beats[0]?.speakerNames).toEqual(["甲", "乙", "丙", "丁"]);
	});

	it("ignores duplicated speakerNames and projects the dialogueScript speaker set", () => {
		const sheet = makeSheet(1);
		sheet.beats[0]!.speakerNames = ["旁白·冷漠男友 2.0"];

		const result = validateBeatSheet(sheet, chapterText(1), {
			generationContract: GENERATION_CONTRACT,
		});

		expect(result.ok).toBe(true);
		expect(result.normalized.beats[0]?.speakerNames).toEqual([]);
	});

	it("projects dialogueScript speaker names before writer dispatch", () => {
		const sheet = makeSheet(1);
		sheet.beats[0]!.dialogueScript = [{
			lineId: "beat-0-line-0",
			speakerName: "孟川",
			text: "我回来了",
			delivery: "on_screen",
		}];
		sheet.beats[0]!.dialoguePaceRate = 4;

		const result = validateBeatSheet(sheet, chapterText(1), {
			generationContract: GENERATION_CONTRACT,
		});

		expect(result.ok).toBe(true);
		expect(result.normalized.beats[0]?.speakerNames).toEqual(["孟川"]);
	});

	it("projects source and narrative speakers while preserving separate speech ledgers", () => {
		const sheet = makeSheet(1);
		sheet.beats[0]!.dialogueScript = [{
			lineId: "source-line-0",
			speakerName: "医生",
			text: "想好了就开始吧。",
			delivery: "on_screen",
		}];
		sheet.beats[0]!.narrativeAudioPlan = {
			strategy: "mixed",
			rationale: "画面展示当下动作，内心声连接改命决定。",
			lines: [{
				lineId: "narrative-line-0",
				speakerName: "沈知夏·内心",
				text: "这一次，我不能再走向原来的结局。",
				delivery: "voice_over",
				afterSourceLineId: "source-line-0",
				sourceEvidence: ["source-unit-0009"],
			}],
		};
		sheet.beats[0]!.speakerNames = ["医生", "沈知夏·内心"];
		sheet.beats[0]!.dialoguePaceRate = 4;

		const result = validateBeatSheet(sheet, chapterText(1), {
			generationContract: GENERATION_CONTRACT,
		});

		expect(result.ok).toBe(true);
		expect(result.normalized.beats[0]?.speakerNames).toEqual(["医生", "沈知夏·内心"]);
		expect(result.normalized.beats[0]?.dialogueScript).toHaveLength(1);
		expect(result.normalized.beats[0]?.narrativeAudioPlan?.lines).toHaveLength(1);
	});

	it("accepts an exact dialogueScript when speakerNames are declared", () => {
		const sheet = makeSheet(1);
		const structuredSheet = {
			...sheet,
			beats: [{
				...sheet.beats[0]!,
				speakerNames: ["旁白·冷漠男友 2.0"],
				dialogueScript: [{
					lineId: "beat-0-line-0",
					speakerName: "旁白·冷漠男友 2.0",
					text: "我回来了",
					delivery: "voice_over",
				}],
				dialoguePaceRate: 4,
			}],
		};

		const result = validateBeatSheet(structuredSheet, chapterText(1), {
			generationContract: GENERATION_CONTRACT,
		});

		expect(result.ok).toBe(true);
		expect(result.normalized.beats[0]?.dialogueScript).toEqual(structuredSheet.beats[0]?.dialogueScript);
	});

	it("preserves the durable source speech ledger and rejects full-chapter dialogue drift", () => {
		const sheet = makeSheet(1);
		const sourceText = "本段正文开始标记0，孟川说：我会赴约。正文事件0，本段正文结束标记0。";
		const units = buildSourceUnits({ chapterText: sourceText, expectedBeatCount: 1 });
		sheet.sourceCoveragePlan = compileSourceCoverageSelection({
			chapterText: sourceText,
			expectedBeatCount: 1,
			deliveryScope: "full_chapter",
			selection: {
				endUnitIds: [units.at(-1)!.unitId],
				speechLedger: [{
				lineId: "chapter-line-1",
				speakerName: "孟川",
				text: "我会赴约。",
				}],
			},
		}).plan;
		sheet.beats[0] = {
			...sheet.beats[0],
			sourceStartMarker: sheet.sourceCoveragePlan.spans[0]!.sourceStartMarker,
			sourceEndMarker: sheet.sourceCoveragePlan.spans[0]!.sourceEndMarker,
			speakerNames: ["孟川"],
			dialogueScript: [{
				lineId: "chapter-line-1",
				speakerName: "孟川",
				text: "我会赴约。",
				delivery: "on_screen",
			}],
			dialoguePaceRate: 4,
		};

		const exact = validateBeatSheet(sheet, sourceText, { generationContract: GENERATION_CONTRACT });
		expect(exact.ok).toBe(true);
		expect(exact.normalized.sourceCoveragePlan?.speechLedger).toEqual(sheet.sourceCoveragePlan!.speechLedger);

		sheet.beats[0] = {
			...sheet.beats[0],
			dialogueScript: [{
				lineId: "chapter-line-1",
				speakerName: "孟川",
				text: "我去赴约。",
				delivery: "voice_over",
			}],
		};
		const drifted = validateBeatSheet(sheet, sourceText, { generationContract: GENERATION_CONTRACT });
		expect(drifted.ok).toBe(false);
		expect(drifted.errors.join("|")).toContain("text 不一致");
	});

	it("requires blocking only when agents explicitly classify the beat as spatial", () => {
		const sheet = makeSheet(1);
		sheet.beats[0]!.characterRoleNames = ["孟川", "后土"];
		sheet.beats[0]!.assetObjectContracts.push(objectContract("character", "后土"));
		const nonSpatial = validateBeatSheet(sheet, chapterText(1), {
			generationContract: GENERATION_CONTRACT,
		});
		expect(nonSpatial.errors.join("|")).not.toContain("blockingFrameNodeId 必填");

		sheet.beats[0]!.spatialBlocking = true;
		const rejected = validateBeatSheet(sheet, chapterText(1), {
			generationContract: GENERATION_CONTRACT,
		});
		expect(rejected.ok).toBe(false);
		expect(rejected.errors.join("|")).toContain("blockingFrameNodeId 必填");

		sheet.beats[0]!.blockingFrameNodeId = "blocking-0";
		const accepted = validateBeatSheet(sheet, chapterText(1), {
			generationContract: GENERATION_CONTRACT,
		});
		expect(accepted.errors.join("|")).not.toContain("blockingFrameNodeId 必填");
	});

	it("rejects a blocking frame that is not backed by an explicit spatial decision", () => {
		const sheet = makeSheet(1);
		sheet.beats[0]!.blockingFrameNodeId = "blocking-0";
		const result = validateBeatSheet(sheet, chapterText(1), {
			generationContract: GENERATION_CONTRACT,
		});
		expect(result.ok).toBe(false);
		expect(result.errors.join("|")).toContain("spatialBlocking 必须为 true");
	});

  it("rejects v1 instead of running a compatibility branch", () => {
    const legacy = { ...makeSheet(1), version: 1 };
    const result = validateBeatSheet(legacy, chapterText(1), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join("|")).toContain("旧 BeatSheet 不兼容");
  });

  it("keeps missing creative metadata as non-blocking diagnostics", () => {
    const sheet = makeSheet(1);
    delete (sheet.beats[0] as Record<string, unknown>).dramaticChange;
    delete (sheet.beats[0] as Record<string, unknown>).pacingDecision;

    const result = validateBeatSheet(sheet, chapterText(1), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings.join("|")).toContain("dramaticChange.objective 必填");
    expect(result.warnings.join("|")).toContain("pacingDecision.essentialCausality");
    expect(result.errors).toEqual([]);
  });

  it("keeps keyframes optional but rejects clips that detach from source markers", () => {
    const sheet = makeSheet(1);
    const beat = sheet.beats[0] as unknown as Record<string, unknown>;
    delete beat.startKeyframe;
    delete beat.endKeyframe;
    delete beat.sourceStartMarker;
    delete beat.sourceEndMarker;

    const result = validateBeatSheet(sheet, chapterText(1), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(false);
    expect(result.warnings.join("|")).toContain("startKeyframe 未声明");
    expect(result.warnings.join("|")).toContain("endKeyframe 未声明");
    expect(result.errors.join("|")).toContain("必须同时提供 sourceStartMarker/sourceEndMarker");
  });

  it("normalizes structured keyframe narration instead of rejecting the beat", () => {
    const sheet = makeSheet(1);
    (sheet.beats[0] as unknown as Record<string, unknown>).startKeyframe = {
      subject: "沈知夏",
      action: "从雨幕中抬眼",
    };
    (sheet.beats[0] as unknown as Record<string, unknown>).endKeyframe = [
      "镜头停在她握紧的手",
      "远处车灯熄灭",
    ];

    const result = validateBeatSheet(sheet, chapterText(1), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(true);
    expect(result.normalized.beats[0].startKeyframe).toContain("subject: 沈知夏");
    expect(result.normalized.beats[0].endKeyframe).toContain("镜头停在她握紧的手");
  });

  it("rejects markers that cannot be found in the authoritative source", () => {
    const result = validateBeatSheet(makeSheet(1), "另一段正文", {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join("|")).toContain("无法在章节原文定位");
  });

  it("reports an explicit length error for a source marker that normalizes below the locator minimum", () => {
    const sheet = makeSheet(1);
    sheet.beats[0].sourceEndMarker = "紫霄宮，到了。";
    const result = validateBeatSheet(
      sheet,
      `${sheet.beats[0].sourceStartMarker}。一座古樸道宮靜靜懸於混沌中央。紫霄宮，到了。`,
      { generationContract: GENERATION_CONTRACT },
    );

    expect(result.ok).toBe(false);
    // 拒因尾部会追加「可用锚点」候选清单（2026-07-28 拒因可执行化），故断言改为前缀匹配。
    expect(
      result.errors.some((e) =>
        e.startsWith("beats[0].sourceEndMarker 归一化后仅 5 个实义字符，至少需要 6 个"),
      ),
    ).toBe(true);
    expect(result.errors.join("|")).not.toContain("sourceEndMarker 无法在起始锚点之后定位");
  });

  it("accepts twenty clips with the runtime dramatic contract", () => {
    const result = validateBeatSheet(makeSheet(20), chapterText(20), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(true);
    expect(result.normalized.version).toBe(2);
    expect(result.normalized.beats).toHaveLength(20);
    expect(result.normalized.beats[19]).toMatchObject({
      clipIndex: 19,
      startKeyframe: "起始画面 19",
      endKeyframe: "结束画面 19",
    });
  });

  it("accepts one debt carried across beats and resolved at its eligible beat", () => {
    const sheet = makeSheet(3);
    sheet.beats.forEach((beat, index) => {
      beat.payoff = {
        ...beat.payoff!,
        debtId: "debt-shared-gate",
        lifecycleAction: index === 0 ? "plant" : index === 1 ? "escalate" : "resolve",
        eligibleFromClipIndex: 2,
      };
    });

    const result = validateBeatSheet(sheet, chapterText(3), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(true);
  });

  it("diagnoses resolving a narrative debt before its eligible beat", () => {
    const sheet = makeSheet(1);
    sheet.beats[0].payoff = {
      ...sheet.beats[0].payoff!,
      lifecycleAction: "resolve",
      eligibleFromClipIndex: 1,
    };

    const result = validateBeatSheet(sheet, chapterText(1), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings.join("|")).toContain("在 eligibleFromClipIndex=1 前提前兑现");
  });

  it("diagnoses an eligible beat outside the submitted chapter", () => {
    const sheet = makeSheet(2);
    sheet.beats[1].payoff = {
      ...sheet.beats[1].payoff!,
      debtId: "debt-next-chapter",
      lifecycleAction: "plant",
      eligibleFromClipIndex: 2,
    };

    const result = validateBeatSheet(sheet, chapterText(2), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toContain(
      "beats[1].payoff.eligibleFromClipIndex=2 超出本章 clipIndex 范围 0..1",
    );
  });

  it("diagnoses an emotional residue discontinuity between adjacent beats", () => {
    const sheet = makeSheet(2);
    sheet.beats[1].emotionTurn = {
      ...sheet.beats[1].emotionTurn!,
      residueIn: "无缘无故恢复平静",
    };

    const result = validateBeatSheet(sheet, chapterText(2), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings.join("|")).toContain("residueIn 未逐字承接上一拍 residueOut");
  });

  it("diagnoses causal provenance that is not aligned with essential causality", () => {
    const sheet = makeSheet(1);
    sheet.beats[0].pacingDecision = {
      ...sheet.beats[0].pacingDecision!,
      essentialCausality: ["第一条因果", "第二条因果"],
    };

    const result = validateBeatSheet(sheet, chapterText(1), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings.join("|")).toContain("causalProvenance 必须与 essentialCausality 一一对应");
    expect(result.warnings.join("|")).toContain("essentialCausality=2，causalProvenance=1，缺失索引=1");
  });

  it("diagnoses source-fact provenance outside the beat source span without blocking source-covered execution", () => {
    const sheet = makeSheet(1);
    sheet.beats[0].pacingDecision = {
      ...sheet.beats[0].pacingDecision!,
      causalProvenance: [{ evidenceType: "source_fact", sourceMarker: "原文从未出现的确定事实" }],
    };

    const result = validateBeatSheet(sheet, chapterText(1), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings.join("|")).toContain("sourceMarker 无法在本拍原文跨度定位");
  });

  it("replays story state transitions across beats", () => {
    const sheet = makeSheet(3);
    const result = validateBeatSheet(sheet, chapterText(3), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(true);
    expect(result.normalized.beats[2].dramaticChange?.stateTransitions[0]).toMatchObject({
      actionId: "state-action-2",
      before: "主动承压-1",
      after: "主动承压-2",
      causeCausalityIndex: 0,
    });
  });

  it("diagnoses duplicate state action IDs and broken before/after replay", () => {
    const sheet = makeSheet(2);
    const first = sheet.beats[0].dramaticChange!.stateTransitions[0];
    sheet.beats[1].dramaticChange!.stateTransitions[0] = {
      ...sheet.beats[1].dramaticChange!.stateTransitions[0],
      actionId: first.actionId,
      before: "未承接上一终态",
    };

    const result = validateBeatSheet(sheet, chapterText(2), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings.join("|")).toContain("actionId 重复");
    expect(result.warnings.join("|")).toContain("before 未逐字承接同一实体/维度的上一终态");
  });

  it("diagnoses a state transition that cites a missing causal edge", () => {
    const sheet = makeSheet(1);
    sheet.beats[0].dramaticChange!.stateTransitions[0].causeCausalityIndex = 3;

    const result = validateBeatSheet(sheet, chapterText(1), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings.join("|")).toContain("超出本拍 essentialCausality 索引范围");
  });

  it("rejects a duration outside the frozen model contract", () => {
    const sheet = makeSheet(1);
    sheet.beats[0].durationBudget = 12;
    const result = validateBeatSheet(sheet, chapterText(1), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join("|")).toContain("durationOptions=[5/10/15]");
  });

  it("rejects an impossible parent duration without deleting any frozen line", () => {
    const sheet = makeSheet(1);
    sheet.beats[0].dialogueScript = [{
      lineId: "beat-0-line-0",
      speakerName: "孟川",
      text: "一".repeat(41),
      delivery: "on_screen",
    }];
    sheet.beats[0].speakerNames = ["孟川"];
    sheet.beats[0].dialoguePaceRate = 4;

    const result = validateBeatSheet(sheet, chapterText(1), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "beats[0].durationBudget=10s 无法容纳全部冻结人声：按 Agent 提交的 4字/秒及逐行0.5秒向上取整，最低需要 10.5s；这是可执行时长合同矛盾。禁止删词、提速或让 writer 承担不可能预算，请由 agents 在同一创作链内增加本拍合法时长或重规划 clip 边界",
    );
    expect(result.normalized.beats[0]?.dialogueScript[0]?.text).toBe("一".repeat(41));
  });

	it("requires an explicit Agent-authored dialogue pace whenever a beat carries speech", () => {
		const sheet = makeSheet(1);
		sheet.beats[0].dialogueScript = [{
			lineId: "beat-0-line-0",
			speakerName: "孟川",
			text: "我回来了",
			delivery: "on_screen",
		}];
		sheet.beats[0].speakerNames = ["孟川"];
		delete sheet.beats[0].dialoguePaceRate;

		const result = validateBeatSheet(sheet, chapterText(1), {
			generationContract: GENERATION_CONTRACT,
		});

		expect(result.ok).toBe(false);
		expect(result.errors).toContain(
			"beats[0] 含有冻结人声时 dialoguePaceRate 必填，且必须由 BeatSheet Agent 根据当前说话情境提交正数；宿主不再以固定 4 字/秒代替创作裁决",
		);
	});

	it("accepts dialogueScript exactly at the declared capacity", () => {
		const sheet = makeSheet(1);
		sheet.beats[0].dialogueScript = [{
			lineId: "beat-0-line-0",
			speakerName: "孟川",
			text: "一".repeat(40),
			delivery: "on_screen",
		}];
		sheet.beats[0].speakerNames = ["孟川"];
    sheet.beats[0].dialoguePaceRate = 4;

    const result = validateBeatSheet(sheet, chapterText(1), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(true);
  });

  it("accounts for per-line half-second rounding at the parent Beat boundary", () => {
    const sheet = makeSheet(1);
    sheet.beats[0].durationBudget = 5;
    sheet.beats[0].dialogueScript = Array.from({ length: 20 }, (_, index) => ({
      lineId: `beat-0-line-${index}`,
      speakerName: "孟川",
      text: "一",
      delivery: "on_screen" as const,
    }));
    sheet.beats[0].speakerNames = ["孟川"];
    sheet.beats[0].dialoguePaceRate = 4;

    const result = validateBeatSheet(sheet, chapterText(1), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join("|")).toContain(
      "beats[0].durationBudget=5s 无法容纳全部冻结人声",
    );
    expect(result.errors.join("|")).toContain("最低需要 10s");
    expect(result.normalized.beats[0]?.dialogueScript).toHaveLength(20);
  });

  it("preserves verified storyboard and target tail frames for bridge mode", () => {
    const sheet = makeSheet(2);
    sheet.beats[0] = {
      ...sheet.beats[0],
		spatialBlocking: true,
      blockingFrameNodeId: "blocking-0",
      storyboardImageNodeId: "keyframe-0",
    };
    const result = validateBeatSheet(sheet, chapterText(2), {
      generationContract: GENERATION_CONTRACT,
    });
    expect(result.ok).toBe(true);
    expect(result.normalized.beats[0]).toMatchObject({
		spatialBlocking: true,
      blockingFrameNodeId: "blocking-0",
      storyboardImageNodeId: "keyframe-0",
    });

    sheet.beats[0].lastFrameImageNodeId = "bridge-01";
    sheet.beats[1].continuityMode = "bridge_frames";
    sheet.beats[1].storyboardImageNodeId = "bridge-01";
    const bridge = validateBeatSheet(sheet, chapterText(2), {
      generationContract: GENERATION_CONTRACT,
    });
    expect(bridge.ok).toBe(true);
    expect(bridge.normalized.beats[0]).toMatchObject({
      continuityMode: "editorial_cut",
      lastFrameImageNodeId: "bridge-01",
    });
    expect(bridge.normalized.beats[1]).toMatchObject({
      continuityMode: "bridge_frames",
      storyboardImageNodeId: "bridge-01",
    });

    sheet.beats[1].continuityMode = "editorial_cut";
    const mismatchedTail = validateBeatSheet(sheet, chapterText(2), {
      generationContract: GENERATION_CONTRACT,
    });
    expect(mismatchedTail.ok).toBe(false);
    expect(mismatchedTail.errors.join("|")).toContain("只允许服务下一 clip 的 continuityMode=bridge_frames");
    delete sheet.beats[0].lastFrameImageNodeId;

    const withoutKeyframeSheet = makeSheet(1);
    delete (withoutKeyframeSheet.beats[0] as unknown as Record<string, unknown>).storyboardImageNodeId;
    delete (withoutKeyframeSheet.beats[0] as unknown as Record<string, unknown>).storyboardFrameCount;
    const withoutKeyframe = validateBeatSheet(withoutKeyframeSheet, chapterText(1), {
      generationContract: GENERATION_CONTRACT,
    });
    expect(withoutKeyframe.ok).toBe(true);

    const bridgeWithoutStartSheet = makeSheet(2);
    bridgeWithoutStartSheet.beats[0].lastFrameImageNodeId = "bridge-01";
    bridgeWithoutStartSheet.beats[1].continuityMode = "bridge_frames";
    delete (bridgeWithoutStartSheet.beats[1] as unknown as Record<string, unknown>).storyboardImageNodeId;
    delete (bridgeWithoutStartSheet.beats[1] as unknown as Record<string, unknown>).storyboardFrameCount;
    const bridgeWithoutStart = validateBeatSheet(bridgeWithoutStartSheet, chapterText(2), {
      generationContract: GENERATION_CONTRACT,
    });
    expect(bridgeWithoutStart.ok).toBe(false);
    expect(bridgeWithoutStart.errors.join("|")).toContain(
      "bridge_frames 必须绑定与上一拍共用的真实桥接帧",
    );
  });

  it("rejects one-click chaining fields at beat and meta level", () => {
    const sheet = makeSheet(1);
    (sheet.beats[0] as unknown as Record<string, unknown>).chainFromPrev = true;
    (sheet.meta as Record<string, unknown>).clipChaining = "auto";
    const result = validateBeatSheet(sheet, chapterText(1), {
      generationContract: GENERATION_CONTRACT,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("|")).toContain("chainFromPrev 是执行派生字段");
    expect(result.errors.join("|")).toContain("meta.clipChaining 禁止由根级覆盖");
  });

  it("ignores duplicated prop selectors and derives props from object contracts", () => {
    const sheet = makeSheet(1);
    sheet.beats[0].propNames = ["混沌钟"];
    const result = validateBeatSheet(sheet, chapterText(1), {
      generationContract: GENERATION_CONTRACT,
    });
    expect(result.ok).toBe(true);
		expect(result.normalized.beats[0]?.propNames).toBeUndefined();
	});

	it("derives prop and VFX selectors from supplied object contracts", () => {
    const sheet = makeSheet(1);
    sheet.beats[0].propNames = ["青萍剑"];
    sheet.beats[0].vfxNames = ["青萍剑光"];
    sheet.beats[0].assetObjectContracts.push(objectContract("prop", "青萍剑"));

		sheet.beats[0].assetObjectContracts.push(objectContract("vfx", "青萍剑光"));
    const valid = validateBeatSheet(sheet, chapterText(1), {
      generationContract: GENERATION_CONTRACT,
    });
    expect(valid.ok).toBe(true);
    expect(valid.normalized.beats[0].propNames).toEqual(["青萍剑"]);
    expect(valid.normalized.beats[0].vfxNames).toEqual(["青萍剑光"]);
  });

  it("requires each clip storyboard to contain one to three ordered keyframes", () => {
    const single = makeSheet(1);
    single.beats[0]!.storyboardFrameCount = 1;
    expect(validateBeatSheet(single, chapterText(1), { generationContract: GENERATION_CONTRACT }).ok).toBe(true);

    const triple = makeSheet(1);
    triple.beats[0]!.storyboardFrameCount = 3;
    expect(validateBeatSheet(triple, chapterText(1), { generationContract: GENERATION_CONTRACT }).ok).toBe(true);

    const excessive = makeSheet(1);
    excessive.beats[0]!.storyboardFrameCount = 4;
    expect(
      validateBeatSheet(excessive, chapterText(1), { generationContract: GENERATION_CONTRACT }).errors.join("|"),
    ).toContain("storyboardFrameCount 必须是 1～3 的整数");
  });

  it("counts object-contract references together with the storyboard before production", () => {
    const sheet = makeSheet(1);
    sheet.beats[0]!.assetObjectContracts = [
      objectContract("character", "孟川"),
      objectContract("scene", "紫霄宫道途"),
      ...Array.from({ length: 7 }, (_, index) => objectContract("prop", `道具${index}`)),
    ];

    const result = validateBeatSheet(sheet, chapterText(1), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join("|")).toContain("合并后需要 10 个业务图片槽");
    expect(result.errors.join("|")).toContain("当前 generationContract 仅允许 9 个");
  });

  it("keeps unmaterialized object contracts in planning but rejects them at execution", () => {
    const sheet = makeSheet(1);
    sheet.beats[0]!.assetObjectContracts = sheet.beats[0]!.assetObjectContracts.map((contract) => ({
      ...contract,
      referenceImageNodeIds: [],
    }));

    const planning = validateBeatSheet(sheet, chapterText(1), {
      generationContract: GENERATION_CONTRACT,
      phase: "planning",
    });
    const execution = validateBeatSheet(sheet, chapterText(1), {
      generationContract: GENERATION_CONTRACT,
      phase: "execution",
    });

    expect(planning.ok).toBe(true);
    expect(planning.normalized.beats[0]?.assetObjectContracts).toHaveLength(2);
    expect(execution.ok).toBe(false);
    expect(execution.errors.join("|")).toContain(
			"必须通过 referenceImageNodeIds 或 referenceAssetIds 绑定真实图片资产",
    );
  });
});

describe("one writer task per clip", () => {
  it("creates exactly one independent task for every absolute clip index", () => {
    expect(splitBeatClipTasks(makeSheet(4).beats)).toEqual([
      { clipIndex: 0 },
      { clipIndex: 1 },
      { clipIndex: 2 },
      { clipIndex: 3 },
    ]);
  });

});

describe("source span materialization", () => {
  it("stores the exact marker-bounded chapter span for the owned writer", () => {
    const sheet = makeSheet(1);
    enrichBeatsWithSourceSpans(
      sheet,
      "前文。本段正文开始标记0，孟川抬眼，继续前行，本段正文结束标记0。后文。",
    );
    expect(sheet.beats[0].sourceSpanText).toBe(
      "本段正文开始标记0，孟川抬眼，继续前行，本段正文结束标记0",
    );
  });
});

describe("duration scope contract", () => {
  it("requires an explicit exact target only for bounded-duration work", () => {
    const sheet = makeSheet(2);
    sheet.beats[0]!.durationBudget = 15;
    sheet.beats[1]!.durationBudget = 15;
    sheet.meta = {
      ...sheet.meta,
      deliveryScope: "bounded_duration",
      targetDurationSeconds: 30,
    };

    const result = validateBeatSheet(sheet, chapterText(2), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(true);
    expect(result.normalized.meta?.targetDurationSeconds).toBe(30);
  });

  it("rejects bounded-duration work when its explicit target is missing", () => {
    const sheet = makeSheet(2);
    sheet.meta = {
      ...sheet.meta,
      deliveryScope: "bounded_duration",
    };

    const result = validateBeatSheet(sheet, chapterText(4), {
      generationContract: GENERATION_CONTRACT,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "meta.deliveryScope=bounded_duration 时 targetDurationSeconds 必填，且必须来自用户明确指定的时长",
    );
  });
});
