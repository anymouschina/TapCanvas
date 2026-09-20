import { describe, expect, it } from "vitest";

import {
  buildProjectStyleFingerprint,
  buildProjectStyleProvenance,
  isCurrentStyleAsset,
  normalizeStyleReferenceImages,
  readAuthoringReferenceStyleTransition,
  resolveProjectStyleAnchorSources,
  styleLockFromTriggerFacts,
} from "./authoring-style-provenance";

const styleLock = {
  styleId: "guofeng-3d",
  styleName: "国风三维动画",
  stylePrompt: "三维国风动画渲染，非真人摄影",
  category: "anime",
};

describe("authoring style provenance", () => {
	it("按次风格事实与 Look Bible 使用同一结构投影，不发明色卡", () => {
		const styleLock = styleLockFromTriggerFacts({
			styleName: "用户指定赛璐璐夜战",
			visualDirectives: ["高对比蓝紫夜色"],
			consistencyRules: ["角色服装与能力颜色固定"],
			negativeDirectives: ["不切换写实媒介"],
		});
		expect(styleLock).toEqual(expect.objectContaining({
			styleId: "run-trigger-style-facts",
			styleName: "用户指定赛璐璐夜战",
			category: "run-trigger-style-facts",
		}));
		expect(styleLock?.stylePrompt).toContain("高对比蓝紫夜色");
		expect(styleLock?.stylePrompt).not.toContain("#");
		expect(styleLockFromTriggerFacts({})).toBeNull();
	});

	it("统一所有入口的风格来源优先级，并在无项目锁时继承书级事实", () => {
		const bookSources = resolveProjectStyleAnchorSources({
			canvasStyleReferenceImages: [],
			canvasStyleLock: null,
			activeLookBible: null,
			triggerStyleFacts: null,
			bookStyleFacts: {
				styleName: "书级赛璐璐",
				visualDirectives: ["二维"],
				referenceImages: ["https://cdn.test/book-style.png"],
			},
		});
		expect(bookSources.styleReferenceImages).toEqual(["https://cdn.test/book-style.png"]);
		expect(bookSources.styleLock?.styleName).toBe("书级赛璐璐");

		const explicitRunSources = resolveProjectStyleAnchorSources({
			canvasStyleReferenceImages: [],
			canvasStyleLock: null,
			activeLookBible: null,
			triggerStyleFacts: { styleName: "本轮写实摄影", visualDirectives: ["真实镜头"] },
			bookStyleFacts: {
				styleName: "书级赛璐璐",
				referenceImages: ["https://cdn.test/book-style.png"],
			},
		});
		expect(explicitRunSources.styleLock?.styleName).toBe("本轮写实摄影");
		expect(explicitRunSources.styleReferenceImages).toEqual([]);
	});

  it("对真实 URL 去重排序，输入顺序不影响指纹", () => {
    const left = buildProjectStyleFingerprint({
      styleReferenceImages: ["https://cdn.test/b.png", "https://cdn.test/a.png", "https://cdn.test/a.png"],
      styleLock,
    });
    const right = buildProjectStyleFingerprint({
      styleReferenceImages: ["https://cdn.test/a.png", "https://cdn.test/b.png"],
      styleLock,
    });
    expect(left).toBe(right);
    expect(normalizeStyleReferenceImages(["asset://bad", "https://cdn.test/a.png"])).toEqual([
      "https://cdn.test/a.png",
    ]);
  });

  it("画风锁或真实参考图变化会改变指纹", () => {
    const baseline = buildProjectStyleFingerprint({
      styleReferenceImages: ["https://cdn.test/a.png"],
      styleLock,
    });
    expect(
      buildProjectStyleFingerprint({
        styleReferenceImages: ["https://cdn.test/b.png"],
        styleLock,
      }),
    ).not.toBe(baseline);
    expect(
      buildProjectStyleFingerprint({
        styleReferenceImages: ["https://cdn.test/a.png"],
        styleLock: { ...styleLock, stylePrompt: "水墨二维动画" },
      }),
    ).not.toBe(baseline);
  });

	it("没有项目画风图时保留空 provenance，不阻断纯文字生产", () => {
		expect(buildProjectStyleProvenance({ styleReferenceImages: [], styleLock: null }).styleFingerprint).toBeNull();
		expect(buildProjectStyleProvenance({ styleReferenceImages: [], styleLock })).toMatchObject({
			styleReferenceImages: [],
			styleSource: "project_style_reference",
		});
		expect(buildProjectStyleProvenance({ styleReferenceImages: ["asset://placeholder"], styleLock })).toMatchObject({
			styleReferenceImages: [],
			styleSource: "project_style_reference",
		});
  });

  it("只有指纹完全匹配才是当前画风资产", () => {
    const current = buildProjectStyleProvenance({
      styleReferenceImages: ["https://cdn.test/a.png"],
      styleLock,
    });
    expect(isCurrentStyleAsset({ styleFingerprint: current.styleFingerprint }, current.styleFingerprint!)).toBe(true);
    expect(isCurrentStyleAsset({}, current.styleFingerprint!)).toBe(false);
    expect(isCurrentStyleAsset({ styleFingerprint: "sha256:old" }, current.styleFingerprint!)).toBe(false);
  });

  it("把可审计来源画风与目标生成画风分开，不把跨画风身份参考误判为缺失", () => {
    expect(
      readAuthoringReferenceStyleTransition(
        { styleFingerprint: "sha256:source" },
        "sha256:target",
      ),
    ).toEqual({
      sourceStyleFingerprint: "sha256:source",
      targetStyleFingerprint: "sha256:target",
      transformRequired: true,
    });
    expect(
      readAuthoringReferenceStyleTransition(
        { styleFingerprint: "sha256:target" },
        "sha256:target",
      ),
    ).toEqual({
      sourceStyleFingerprint: "sha256:target",
      targetStyleFingerprint: "sha256:target",
      transformRequired: false,
    });
  });

  it("来源画风 provenance 缺失时继续显式拒绝，不做隐式兼容", () => {
    expect(readAuthoringReferenceStyleTransition({}, "sha256:target")).toBeNull();
    expect(
      readAuthoringReferenceStyleTransition(
        { styleFingerprint: "sha256:source" },
        "",
      ),
    ).toBeNull();
  });
});
