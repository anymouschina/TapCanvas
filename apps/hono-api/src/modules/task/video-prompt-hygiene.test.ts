import { describe, expect, it } from "vitest";
import {
  VIDEO_ANTI_AI_NEGATIVE,
  VIDEO_NO_BGM_DIRECTIVE,
  appendNoBgmDirective,
  mergeVideoAntiAiNegative,
  sanitizeVideoPrompt,
  stripOverSmoothingWords,
} from "./video-prompt-hygiene";

describe("stripOverSmoothingWords", () => {
  it("剥离逗号列表里的过度平滑样板词，保留其余", () => {
    const r = stripOverSmoothingWords(
      "一个女孩在雨中奔跑, 8K, masterpiece, 侧面跟拍, best quality, 暖色调",
    );
    expect(r.prompt).toBe("一个女孩在雨中奔跑, 侧面跟拍, 暖色调");
    expect(r.stripped).toEqual(expect.arrayContaining(["8K", "masterpiece", "best quality"]));
  });

  it("剥离中文画质样板词", () => {
    const r = stripOverSmoothingWords("超高清, 极致细节, 一只猫跳上桌子, 大师级");
    expect(r.prompt).toBe("一只猫跳上桌子");
    expect(r.stripped).toEqual(expect.arrayContaining(["超高清", "极致细节", "大师级"]));
  });

  it("不误伤包含子串的合法词（masterpieces / 4kg）", () => {
    const r = stripOverSmoothingWords("collection of masterpieces, a 4kg dumbbell on the floor");
    expect(r.prompt).toBe("collection of masterpieces, a 4kg dumbbell on the floor");
    expect(r.stripped).toEqual([]);
  });

  it("容忍连字符/多空格变体（ultra-hd / hyper  detailed）", () => {
    const r = stripOverSmoothingWords("a portrait, ultra-hd, hyper  detailed, cinematic");
    expect(r.prompt).toBe("a portrait, cinematic");
    expect(r.stripped.length).toBe(2);
  });

  it("无样板词时原样返回、stripped 为空", () => {
    const input = "一个男人走向窗边, 镜头缓推, 逆光";
    const r = stripOverSmoothingWords(input);
    expect(r.prompt).toBe(input);
    expect(r.stripped).toEqual([]);
  });

  it("不碰否定词（不要X 不属于职责）", () => {
    const input = "他不要命地奔跑, 不要慢动作";
    const r = stripOverSmoothingWords(input);
    expect(r.prompt).toBe(input);
  });
});

describe("mergeVideoAntiAiNegative", () => {
  it("空负向词 → 注入底座", () => {
    const r = mergeVideoAntiAiNegative("");
    expect(r.negativePrompt).toBe(VIDEO_ANTI_AI_NEGATIVE);
    expect(r.injected).toBe(true);
  });

  it("保留已有负向词并在其后追加底座", () => {
    const r = mergeVideoAntiAiNegative("camera shake, jitter");
    expect(r.negativePrompt).toBe(`camera shake, jitter, ${VIDEO_ANTI_AI_NEGATIVE}`);
    expect(r.injected).toBe(true);
  });

  it("幂等：已含底座不重复追加", () => {
    const once = mergeVideoAntiAiNegative("x").negativePrompt;
    const twice = mergeVideoAntiAiNegative(once);
    expect(twice.negativePrompt).toBe(once);
    expect(twice.injected).toBe(false);
  });

  it("底座不含运动行为词（不误杀有意慢镜）", () => {
    expect(VIDEO_ANTI_AI_NEGATIVE).not.toContain("slow motion");
    expect(VIDEO_ANTI_AI_NEGATIVE).not.toContain("motion blur");
  });
});

describe("appendNoBgmDirective", () => {
  it("空 prompt → 注入音频指令", () => {
    const r = appendNoBgmDirective("");
    expect(r.prompt).toBe(VIDEO_NO_BGM_DIRECTIVE);
    expect(r.injected).toBe(true);
  });

  it("普通 prompt → 末尾追加音频指令", () => {
    const r = appendNoBgmDirective("一个男人走向窗边, 镜头缓推");
    expect(r.prompt).toBe(`一个男人走向窗边, 镜头缓推 ${VIDEO_NO_BGM_DIRECTIVE}`);
    expect(r.injected).toBe(true);
  });

  it("幂等：已含「不要背景音乐」不重复注入", () => {
    const once = appendNoBgmDirective("奔跑").prompt;
    const twice = appendNoBgmDirective(once);
    expect(twice.prompt).toBe(once);
    expect(twice.injected).toBe(false);
  });

  it("识别已有等价表达（中文「无背景音乐」/ 英文 no background music）不重复", () => {
    expect(appendNoBgmDirective("一个场景, 无背景音乐").injected).toBe(false);
    expect(appendNoBgmDirective("a scene, no background music, only sfx").injected).toBe(false);
    expect(appendNoBgmDirective("a scene, NO BGM").injected).toBe(false);
  });
});

describe("sanitizeVideoPrompt", () => {
  it("端到端：剥词 + 注入音频指令 + 注入负向，changed=true", () => {
    const r = sanitizeVideoPrompt({
      prompt: "一个女孩奔跑, 8K, masterpiece",
      negativePrompt: "",
    });
    expect(r.prompt).toBe(`一个女孩奔跑 ${VIDEO_NO_BGM_DIRECTIVE}`);
    expect(r.negativePrompt).toBe(VIDEO_ANTI_AI_NEGATIVE);
    expect(r.changed).toBe(true);
    expect(r.strippedWords.length).toBe(2);
    expect(r.injectedNegative).toBe(true);
    expect(r.injectedNoBgm).toBe(true);
  });

  it("干净 prompt 首次注入音频指令 + 第二次幂等空跑（changed=false）", () => {
    const first = sanitizeVideoPrompt({ prompt: "一个男人走向窗边", negativePrompt: "" });
    expect(first.prompt).toBe(`一个男人走向窗边 ${VIDEO_NO_BGM_DIRECTIVE}`);
    expect(first.injectedNoBgm).toBe(true);
    const second = sanitizeVideoPrompt({
      prompt: first.prompt,
      negativePrompt: first.negativePrompt,
    });
    expect(second.changed).toBe(false);
    expect(second.prompt).toBe(first.prompt);
    expect(second.negativePrompt).toBe(first.negativePrompt);
    expect(second.injectedNoBgm).toBe(false);
  });

  it("容忍 null/undefined 输入", () => {
    const r = sanitizeVideoPrompt({ prompt: null, negativePrompt: undefined });
    expect(r.prompt).toBe(VIDEO_NO_BGM_DIRECTIVE);
    expect(r.negativePrompt).toBe(VIDEO_ANTI_AI_NEGATIVE);
    expect(r.changed).toBe(true);
  });
});

describe("人物介绍字卡·负向词放行（通用设计 2026-07-06）", () => {
	it("prompt 含「人物介绍字卡」→ 负向底座不含 on-screen text/subtitles，其余照压", () => {
		const r = sanitizeVideoPrompt({
			prompt: "镜1|中景|孟川首次亮相，身旁留白处叠加人物介绍字卡：孟川｜雲城二中·高二，约2s淡出",
			negativePrompt: "",
		});
		expect(r.negativePrompt).not.toContain("on-screen text");
		expect(r.negativePrompt).not.toContain("subtitles");
		expect(r.negativePrompt).toContain("watermark");
		expect(r.negativePrompt).toContain("plastic skin");
	});

	it("字卡镜连调用方自带的压字负向词也剔除", () => {
		const r = sanitizeVideoPrompt({
			prompt: "首次出场，画面叠加人物介绍字卡：任我行｜日月神教",
			negativePrompt: "subtitles, on-screen text, 字幕, blurry hands",
		});
		expect(r.negativePrompt).not.toContain("subtitles");
		expect(r.negativePrompt).not.toContain("on-screen text");
		expect(r.negativePrompt).not.toContain("字幕");
		expect(r.negativePrompt).toContain("blurry hands");
	});

	it("普通镜（无字卡标记）→ 底座仍压 on-screen text/subtitles（零回归）", () => {
		const r = sanitizeVideoPrompt({ prompt: "两人在码头对峙", negativePrompt: "" });
		expect(r.negativePrompt).toContain("on-screen text");
		expect(r.negativePrompt).toContain("subtitles");
	});
});

describe("负向底座冲突对账（2026-07-17 ch1 复盘：正向为准）", () => {
  it("正向要求过曝高光 → 负向剔除 blown-out highlights（其余照压）", () => {
    const r = sanitizeVideoPrompt({
      prompt: "油桶在正午顶光下反出刺眼金属高光，高光溢出过曝一线",
      negativePrompt: "",
    });
    expect(r.negativePrompt).not.toContain("blown-out highlights");
    expect(r.negativePrompt).toContain("plastic skin");
    expect(r.negativePrompt).toContain("oversaturated");
  });
  it("正向声明写实半CG → 负向剔除 cgi/3d render/video game render", () => {
    const r = sanitizeVideoPrompt({
      prompt: "【影调圣经】写实半CG精致渲染，暖白柔光",
      negativePrompt: "",
    });
    expect(r.negativePrompt).not.toContain("cgi");
    expect(r.negativePrompt).not.toContain("3d render");
    expect(r.negativePrompt).not.toContain("video game render");
    expect(r.negativePrompt).toContain("morphing artifacts");
  });
  it("调用方自带的冲突负向词同样被剔（不只底座）", () => {
    const r = sanitizeVideoPrompt({
      prompt: "3D质感角色，金属高光刺点",
      negativePrompt: "cgi, blown-out highlights, watermark",
    });
    expect(r.negativePrompt).not.toContain("cgi");
    expect(r.negativePrompt).not.toContain("blown-out highlights");
    expect(r.negativePrompt).toContain("watermark");
  });
  it("正向无声明 → 底座原样（零行为变化）", () => {
    const r = sanitizeVideoPrompt({ prompt: "两人在雨中对峙", negativePrompt: "" });
    expect(r.negativePrompt).toContain("blown-out highlights");
    expect(r.negativePrompt).toContain("cgi");
  });
});

describe("全片级「首次出场字卡」条件句剥除（2026-07-17 ch1-firstmin 复盘根治）", () => {
  const CH1_FOOTER =
    "【硬约束】无BGM(保留蝉鸣/车流等环境原声)；无字幕烧屏，仅林七夜与阿诺各首次出场叠一次≤10字人物介绍字卡约2s淡出；语言中文；街头青年一律无烟、手持冰饮。";
  it("非字卡镜：硬约束里的全片级条件句被剥除，负向底座恢复压 on-screen text", () => {
    const r = sanitizeVideoPrompt({
      prompt: `[2-6s] 镜2|中景·侧向跟移|少年牵着小女孩朝马路对面走去。 ${CH1_FOOTER}`,
      negativePrompt: "",
    });
    expect(r.prompt).not.toContain("首次出场");
    expect(r.prompt).not.toContain("人物介绍字卡");
    expect(r.prompt).toContain("无字幕烧屏");
    expect(r.prompt).toContain("语言中文");
    expect(r.negativePrompt).toContain("on-screen text");
    expect(r.negativePrompt).toContain("subtitles");
  });
  it("字卡镜：镜头行局部「叠「X」人物字卡」保留且继续享受负向放行", () => {
    const r = sanitizeVideoPrompt({
      prompt: `[1.5-3s] 镜2|中景·落定|横摇落定在黑色短袖少年身上。叠「林七夜」人物字卡约2s淡出。 ${CH1_FOOTER}`,
      negativePrompt: "",
    });
    expect(r.prompt).toContain("叠「林七夜」人物字卡");
    expect(r.prompt).not.toContain("首次出场");
    expect(r.negativePrompt).not.toContain("on-screen text");
    expect(r.negativePrompt).not.toContain("subtitles");
  });
  it("局部「首次出场，画面叠加人物介绍字卡：任我行」无条件量词 → 不受剥除（零回归）", () => {
    const r = sanitizeVideoPrompt({
      prompt: "首次出场，画面叠加人物介绍字卡：任我行｜日月神教",
      negativePrompt: "",
    });
    expect(r.prompt).toContain("人物介绍字卡：任我行");
    expect(r.negativePrompt).not.toContain("on-screen text");
  });
  it("幂等：剥除后的 prompt 再过一遍不再变化", () => {
    const once = sanitizeVideoPrompt({ prompt: `画面描述。 ${CH1_FOOTER}`, negativePrompt: "" });
    const twice = sanitizeVideoPrompt({ prompt: once.prompt, negativePrompt: once.negativePrompt });
    expect(twice.prompt).toBe(once.prompt);
  });
});
