import { describe, expect, it } from "vitest";

import {
  lintIncomingClips,
  smallEditDistance,
  suggestKnownRoleName,
} from "./video-orchestrator.addclips-lint";

// ch3《说谎》真实卡司（画布 roleName 口径）。
const CH3_KNOWN = new Set([
  "人羊",
  "齐夏",
  "白大褂男",
  "花臂男",
  "黑T恤男",
  "健硕男",
  "尖叫女生",
  "清冷女人",
  "微笑青年",
]);

const CTX = {
  knownRoleNames: CH3_KNOWN,
  ensembleNodeIds: new Set(["ens-a"]) as ReadonlySet<string>,
  baseIndex: 0,
  paceRate: 4,
};

describe("smallEditDistance / suggestKnownRoleName（错字纠错）", () => {
  it("单字错字 → 距离 1", () => {
    expect(smallEditDistance("白大褥男", "白大褂男")).toBe(1);
    expect(smallEditDistance("张山", "张三")).toBe(1);
  });
  it("ch3 实测「白大褥男」→ 建议「白大褂男」", () => {
    expect(suggestKnownRoleName("白大褥男", CH3_KNOWN)).toBe("白大褂男");
  });
  it("互为包含（外号缩写）也能给建议", () => {
    expect(suggestKnownRoleName("黑T恤", CH3_KNOWN)).toBe("黑T恤男");
  });
  it("完全无关名 → null", () => {
    expect(suggestKnownRoleName("王警官", CH3_KNOWN)).toBeNull();
  });
});

describe("lintIncomingClips（add_clips 批次即时确定性 lint·质检左移）", () => {
  it("ch3 clip17 回放：characterRoleNames 带错字「白大褥男」→ 报警并给纠错建议", () => {
    const warnings = lintIncomingClips(
      [
        {
          clipPrompt: "【镜头表】镜1|近景|白大褂男敲桌。",
          characterRoleNames: ["白大褥男"],
          durationSeconds: 13,
          exitState: "白大褂男立于桌前,手仍压在桌面",
        },
      ],
      { ...CTX, baseIndex: 16 },
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("段17");
    expect(warnings[0]).toContain("白大褥男");
    expect(warnings[0]).toContain("白大褂男");
  });

  it("speakerBindings 中 character 错字被查；voice 通道不要求图片角色卡", () => {
    const warnings = lintIncomingClips(
      [
        {
          clipPrompt:
            "镜1|中景|@白大褥男（冷静）：「你这个计划很好。」 镜2|旁白|@旁白（低沉）：「这抽的不是身份。」",
          characterRoleNames: ["白大褂男"],
          speakerBindings: [
            { name: "白大褥男", assetKind: "character" },
            { name: "旁白", assetKind: "voice" },
          ],
          durationSeconds: 12,
          exitState: "白大褂男端坐桌后,目视前方",
        },
      ],
      CTX,
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("白大褥男");
  });

  it("ch3 clip14 回放：66 字对白塞 13s（4字/秒只够 52 字）→ 对白超容告警", () => {
    const dialogue = "一".repeat(66);
    const warnings = lintIncomingClips(
      [
        {
          clipPrompt: `镜1|中近景|@人羊（平静）：「${dialogue}」`,
          characterRoleNames: ["人羊"],
          durationSeconds: 13,
        },
      ],
      { ...CTX, baseIndex: 13 },
    );
    expect(warnings.some((w) => w.includes("段14") && w.includes("超容"))).toBe(true);
  });

  it("带对白但缺显式 durationSeconds → 告警要求补时长", () => {
    const warnings = lintIncomingClips(
      [{ clipPrompt: "@齐夏（低声）：「为什么偏偏是我。」", characterRoleNames: ["齐夏"] }],
      CTX,
    );
    expect(warnings.some((w) => w.includes("durationSeconds"))).toBe(true);
  });

  it("ch3 群像镜回放：九人围坐但画布无群像图 → 告警提示先建（start 会硬拦）", () => {
    const warnings = lintIncomingClips(
      [
        {
          clipPrompt: "镜1|俯拍大全景|九人围坐长桌，死寂一分钟。",
          characterRoleNames: ["人羊"],
          durationSeconds: 13,
        },
      ],
      { ...CTX, ensembleNodeIds: new Set<string>() },
    );
    expect(warnings.some((w) => w.includes("群像图"))).toBe(true);
  });

  it("画布有群像图但镜未绑 referenceImageNodeIds → 照样告警（2026-07-04 ch7 实测改逐镜）", () => {
    const warnings = lintIncomingClips(
      [
        {
          clipPrompt: "镜1|大全景|众人围坐。",
          characterRoleNames: ["人羊"],
          durationSeconds: 10,
        },
      ],
      CTX,
    );
    expect(warnings.some((w) => w.includes("videoReferenceNodeIds"))).toBe(true);
  });

  it("镜已绑群像图节点 id → 群像镜不报", () => {
    const warnings = lintIncomingClips(
      [
        {
          clipPrompt: "镜1|大全景|众人围坐。",
          characterRoleNames: ["人羊"],
          durationSeconds: 10,
          videoReferenceNodeIds: ["scene-1", "ens-a"],
        },
      ],
      CTX,
    );
    expect(warnings.filter((w) => w.includes("群像图"))).toEqual([]);
  });

  it("干净分段 → 零告警（一次质检通过的正例）", () => {
    const warnings = lintIncomingClips(
      [
        {
          clipPrompt:
            "镜1|中近景|@人羊（平静）：「很好，九位。」齐夏抬眼观察。|冷光|4s",
          characterRoleNames: ["人羊", "齐夏"],
          durationSeconds: 12,
          videoReferenceNodeIds: ["ens-a"],
          exitState: "人羊居中而坐,齐夏在侧目光下垂",
        },
      ],
      CTX,
    );
    expect(warnings).toEqual([]);
  });

  it("dialogueDurationReviewed:true 豁免对白容量（与 start 闸同口径）", () => {
    const dialogue = "一".repeat(66);
    const warnings = lintIncomingClips(
      [
        {
          clipPrompt: `@人羊：「${dialogue}」`,
          characterRoleNames: ["人羊"],
          durationSeconds: 5,
          dialogueDurationReviewed: true,
        },
      ],
      CTX,
    );
    expect(warnings.filter((w) => w.includes("超容"))).toEqual([]);
  });
});

describe("空间调度镜缺俯视站位图 lint（④·2026-07-05《喜剧之王》0张站位图实测）", () => {
	it("显式 spatialBlocking 且未填 blockingFrameNodeId → 提醒建站位图", () => {
		const warnings = lintIncomingClips(
			[
				{
					clipPrompt: "清冷女人与微笑青年在码头对峙，随后追逐冲向岸边。@清冷女人：「站住！」",
					characterRoleNames: ["清冷女人", "微笑青年"],
					spatialBlocking: true,
					durationSeconds: 10,
					dialogueDurationReviewed: true,
				},
			],
			CTX,
		);
		expect(warnings.some((w) => w.includes("俯视站位图") && w.includes("blockingFrameNodeId"))).toBe(true);
	});

	it("已填 blockingFrameNodeId → 不提醒", () => {
		const warnings = lintIncomingClips(
			[
				{
					clipPrompt: "清冷女人与微笑青年在码头对峙。",
					characterRoleNames: ["清冷女人", "微笑青年"],
					spatialBlocking: true,
					blockingFrameNodeId: "blk-1",
					durationSeconds: 8,
				},
			],
			CTX,
		);
		expect(warnings.some((w) => w.includes("俯视站位图"))).toBe(false);
	});

	it("prompt 动作词不触发本地语义判断；仅结构化 spatialBlocking 触发", () => {
		const w1 = lintIncomingClips(
			[{ clipPrompt: "微笑青年推门进屋环顾四周。", characterRoleNames: ["微笑青年"], durationSeconds: 6 }],
			CTX,
		);
		expect(w1.some((w) => w.includes("俯视站位图"))).toBe(false);
		const w2 = lintIncomingClips(
			[
				{
					clipPrompt: "清冷女人坐在窗前低头喝茶，神情落寞。",
					characterRoleNames: ["清冷女人"],
					durationSeconds: 6,
				},
			],
			CTX,
		);
		expect(w2.some((w) => w.includes("俯视站位图"))).toBe(false);
	});
});

describe("检查⑤ exitState 缺失提醒", () => {
  const ctx = {
    knownRoleNames: new Set(["甲"]),
    ensembleNodeIds: new Set<string>(),
    baseIndex: 0,
  };
  it("叙事镜(带 characterRoleNames)缺 exitState 汇总一条软提醒", () => {
    const warnings = lintIncomingClips(
      [
        { clipPrompt: "甲起身", characterRoleNames: ["甲"], durationSeconds: 8 },
        { clipPrompt: "甲出门", characterRoleNames: ["甲"], durationSeconds: 8, exitState: "甲已出门,门半开" },
      ],
      ctx,
    );
    expect(warnings.some((w) => w.includes("exitState") && w.includes("段1"))).toBe(true);
    expect(warnings.some((w) => w.includes("exitState") && w.includes("段2"))).toBe(false);
  });
  it("无具名角色的纯蒙太奇镜不提醒", () => {
    const warnings = lintIncomingClips([{ clipPrompt: "空镜,城市延时", durationSeconds: 6 }], ctx);
    expect(warnings.some((w) => w.includes("exitState"))).toBe(false);
  });
});

describe("检查⑥ 人物介绍字卡首出提醒（2026-07-06 ch2 实测整章漏字卡·opt-in）", () => {
  const ctxWithIntro = { ...CTX, introducedRoleNames: new Set(["齐夏"]) as ReadonlySet<string> };
  it("首次出场角色（不在 introducedRoleNames）且文本无「人物介绍字卡」→ 告警", () => {
    const warnings = lintIncomingClips(
      [{ characterRoleNames: ["人羊"], durationSeconds: 8, shots: [{ action: "人羊登场", durationSeconds: 8 }] }],
      ctxWithIntro,
    );
    expect(warnings.join()).toContain("人物介绍字卡");
    expect(warnings.join()).toContain("人羊");
  });
  it("shots 里写了「人物介绍字卡」→ 不告警", () => {
    const warnings = lintIncomingClips(
      [
        {
          characterRoleNames: ["人羊"],
          durationSeconds: 8,
          exitState: "人羊立于桌前",
          shots: [{ action: "人羊登场，右侧留白处叠加人物介绍字卡「人羊｜守局人」约2s淡出", durationSeconds: 8 }],
        },
      ],
      ctxWithIntro,
    );
    expect(warnings.filter((w) => w.includes("人物介绍字卡"))).toEqual([]);
  });
  it("已出场角色（introducedRoleNames 命中）→ 不告警；批内第二段同角色也不重复告警", () => {
    const warnings = lintIncomingClips(
      [
        { characterRoleNames: ["齐夏"], durationSeconds: 8, exitState: "x", shots: [{ action: "齐夏说话", durationSeconds: 8 }] },
        { characterRoleNames: ["人羊"], durationSeconds: 8, exitState: "x", shots: [{ action: "登场·画面叠人物介绍字卡", durationSeconds: 8 }] },
        { characterRoleNames: ["人羊"], durationSeconds: 8, exitState: "x", shots: [{ action: "人羊再出场", durationSeconds: 8 }] },
      ],
      ctxWithIntro,
    );
    expect(warnings.filter((w) => w.includes("人物介绍字卡"))).toEqual([]);
  });
  it("未传 introducedRoleNames（非章节链路）→ 检查关闭零回归", () => {
    const warnings = lintIncomingClips(
      [{ characterRoleNames: ["人羊"], durationSeconds: 8, exitState: "x", shots: [{ action: "人羊登场", durationSeconds: 8 }] }],
      CTX,
    );
    expect(warnings.filter((w) => w.includes("人物介绍字卡"))).toEqual([]);
  });
});

describe("检查⑥ 反向：复用角色禁再叠字卡（2026-07-07 用户拍板：字卡只给全剧新建卡角色）", () => {
  const ctxWithIntro = { ...CTX, introducedRoleNames: new Set(["齐夏"]) as ReadonlySet<string> };
  it("跨章复用角色（种子命中）的镜叠了字卡 → 告警要求删除", () => {
    const warnings = lintIncomingClips(
      [
        {
          characterRoleNames: ["齐夏"],
          durationSeconds: 8,
          exitState: "x",
          shots: [{ action: "齐夏入画，身旁留白处叠加人物介绍字卡：齐夏｜都市白领，约2s后淡出", durationSeconds: 8 }],
        },
      ],
      ctxWithIntro,
    );
    const hits = warnings.filter((w) => w.includes("复用角色") && w.includes("齐夏"));
    expect(hits.length).toBe(1);
  });
  it("『』括号写法也能识别", () => {
    const warnings = lintIncomingClips(
      [
        {
          characterRoleNames: ["齐夏"],
          durationSeconds: 8,
          exitState: "x",
          shots: [{ action: "叠加人物介绍字卡『齐夏｜都市白领』竖排小字", durationSeconds: 8 }],
        },
      ],
      ctxWithIntro,
    );
    expect(warnings.filter((w) => w.includes("复用角色") && w.includes("齐夏")).length).toBe(1);
  });
  it("新角色首出镜叠字卡 → 合法不告警", () => {
    const warnings = lintIncomingClips(
      [
        {
          characterRoleNames: ["人羊"],
          durationSeconds: 8,
          exitState: "x",
          shots: [{ action: "人羊登场，叠加人物介绍字卡：人羊｜守局人，约2s淡出", durationSeconds: 8 }],
        },
      ],
      ctxWithIntro,
    );
    expect(warnings.filter((w) => w.includes("复用角色"))).toEqual([]);
  });
  it("批内同角色第二段再叠字卡 → 告警（一人一次全剧守恒）", () => {
    const warnings = lintIncomingClips(
      [
        {
          characterRoleNames: ["人羊"],
          durationSeconds: 8,
          exitState: "x",
          shots: [{ action: "人羊登场，叠加人物介绍字卡：人羊｜守局人", durationSeconds: 8 }],
        },
        {
          characterRoleNames: ["人羊"],
          durationSeconds: 8,
          exitState: "x",
          shots: [{ action: "人羊再出场，叠加人物介绍字卡：人羊｜守局人", durationSeconds: 8 }],
        },
      ],
      ctxWithIntro,
    );
    expect(warnings.filter((w) => w.includes("复用角色") && w.includes("人羊")).length).toBe(1);
  });
  it("未传 introducedRoleNames → 反向检查同样关闭", () => {
    const warnings = lintIncomingClips(
      [
        {
          characterRoleNames: ["齐夏"],
          durationSeconds: 8,
          exitState: "x",
          shots: [{ action: "叠加人物介绍字卡：齐夏｜都市白领", durationSeconds: 8 }],
        },
      ],
      CTX,
    );
    expect(warnings.filter((w) => w.includes("复用角色"))).toEqual([]);
  });
});

describe("检查⑦ 台词镜口型可靠性三查（2026-07-06 seedance-2.0 调研折入）", () => {
  it("台词+极端运镜同镜 → 告警", () => {
    const warnings = lintIncomingClips(
      [{ characterRoleNames: ["齐夏"], durationSeconds: 8, exitState: "x", shots: [
        { shotNo: 1, cameraMove: "whip pan 甩镜到脸", action: "齐夏猛回头", dialogue: "@齐夏（急）：「谁在那里」", durationSeconds: 8 },
      ] }],
      CTX,
    );
    expect(warnings.join()).toContain("极端运镜");
  });
  it("单句对白 >20 字 → 提示拆句；≤20 字不报", () => {
    const long = "@齐夏（沉）：「" + "字".repeat(23) + "」";
    const warnings = lintIncomingClips(
      [{ characterRoleNames: ["齐夏"], durationSeconds: 8, exitState: "x", shots: [
        { shotNo: 1, cameraMove: "缓推", action: "齐夏站定说话", dialogue: long, durationSeconds: 8 },
      ] }],
      CTX,
    );
    expect(warnings.join()).toContain("一口气");
    const ok = lintIncomingClips(
      [{ characterRoleNames: ["齐夏"], durationSeconds: 8, exitState: "x", shots: [
        { shotNo: 1, cameraMove: "缓推", action: "齐夏站定说话", dialogue: "@齐夏（沉）：「二十字以内的台词没问题。」", durationSeconds: 8 },
      ] }],
      CTX,
    );
    expect(ok.filter((w) => w.includes("一口气"))).toEqual([]);
  });
  it("无台词的 <4s 动作子镜 → 不告警（电光火石密集节拍是刻意设计，2026-07-09 用户拍板）", () => {
    const warnings = lintIncomingClips(
      [{ characterRoleNames: ["齐夏"], durationSeconds: 7, exitState: "x", shots: [
        { shotNo: 1, cameraMove: "急推", action: "拔刀暴起", durationSeconds: 1 },
        { shotNo: 2, cameraMove: "跟摇", action: "格挡火花四溅", durationSeconds: 2 },
        { shotNo: 3, cameraMove: "固定", action: "转身走开", durationSeconds: 4 },
      ] }],
      CTX,
    );
    expect(warnings.join()).not.toContain("<4s");
  });
  it("带台词的 <4s 子镜 → 仍告警（口型/念白被压）", () => {
    const warnings = lintIncomingClips(
      [{ characterRoleNames: ["齐夏"], durationSeconds: 7, exitState: "x", shots: [
        { shotNo: 1, cameraMove: "缓推", action: "抬手", dialogue: "@齐夏（冷）：「住手」", durationSeconds: 3 },
        { shotNo: 2, cameraMove: "固定", action: "转身走开", durationSeconds: 4 },
      ] }],
      CTX,
    );
    expect(warnings.join()).toContain("<4s");
  });
});

describe("人物介绍字卡 — boilerplate 撞词免疫（2026-07-12 ch17「巖」实证）", () => {
  it("硬约束模板「(人物介绍字卡除外)」不算真字卡 → 首出角色仍告警", () => {
    const warnings = lintIncomingClips(
      [
        {
          clipIndex: 0,
          characterRoleNames: ["巖"],
          durationSeconds: 13,
          clipPrompt:
            "【镜头表】\n[0-2s] 镜1|中景|疤脸大汉倚门。\n【硬约束】无BGM盖人声；无字幕(人物介绍字卡除外)；守轴线。",
        },
      ],
      { introducedRoleNames: new Set(), knownRoleNames: new Set(["巖"]) } as never,
    );
    expect(warnings.join("\n")).toContain("人物介绍字卡");
  });

  it("时间轴里有真字卡拍 → 不告警", () => {
    const warnings = lintIncomingClips(
      [
        {
          clipIndex: 0,
          characterRoleNames: ["巖"],
          durationSeconds: 13,
          clipPrompt:
            "【镜头表】\n[0-2s] 镜1|中景|疤脸大汉倚门，身旁叠人物介绍字卡『巖｜狩猎队副队长』约2s淡出。\n【硬约束】无字幕(人物介绍字卡除外)。",
        },
      ],
      { introducedRoleNames: new Set(), knownRoleNames: new Set(["巖"]) } as never,
    );
    expect(warnings.filter((w) => w.includes("人物介绍字卡") && w.includes("首次出场"))).toEqual([]);
  });
});
