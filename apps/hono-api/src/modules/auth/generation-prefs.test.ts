import { describe, expect, it } from "vitest";
import {
	buildGenerationPrefsContextBlock,
	DEFAULT_USER_GENERATION_PREFS,
	parseUserGenerationPrefs,
	resolveEffectiveUserGenerationPrefs,
	resolveImageGenerateDefaults,
	sanitizeUserGenerationPrefs,
} from "./generation-prefs";

describe("parseUserGenerationPrefs", () => {
	it("空/坏 JSON → null", () => {
		expect(parseUserGenerationPrefs(null)).toBeNull();
		expect(parseUserGenerationPrefs("")).toBeNull();
		expect(parseUserGenerationPrefs("{oops")).toBeNull();
		expect(parseUserGenerationPrefs('"str"')).toBeNull();
	});

	it("合法 JSON → 只保留白名单字段并裁剪", () => {
		const prefs = parseUserGenerationPrefs(
			JSON.stringify({
				imageModel: "  gpt-image-2 ",
				videoModel: "doubao-seedance-2-0-260128",
				videoResolution: "720p",
				videoAspect: "16:9",
				imageSize: "2K",
				// 已删除的创作规划偏好不得再进入运行时上下文。
				videoDurationStrategy: "prefer_longest",
				videoClipCountStrategy: "minimize",
				videoPacingStrategy: "internal_editing_first",
				videoExtraClipDisclosure: "required",
				evil: "x",
			}),
		);
		expect(prefs).toEqual({
			imageModel: "gpt-image-2",
			videoModel: "doubao-seedance-2-0-260128",
			videoResolution: "720p",
			videoAspect: "16:9",
			imageSize: "2K",
		});
	});
});

describe("sanitizeUserGenerationPrefs", () => {
	it("非法枚举值剔除、超长模型名剔除、空对象返回 null", () => {
		expect(
			sanitizeUserGenerationPrefs({
				videoResolution: "8K",
				videoAspect: "2.35:1",
				imageSize: "16K",
				imageModel: "a".repeat(200),
			}),
		).toBeNull();
	});

	it("合法输入原样保留；空字符串视为清除该项", () => {
		expect(
			sanitizeUserGenerationPrefs({
				imageModel: "gpt-image-2",
				videoModel: "",
				videoResolution: "1440p",
				videoAspect: "9:16",
			}),
		).toEqual({ imageModel: "gpt-image-2", videoResolution: "1440p", videoAspect: "9:16" });
	});
});

describe("resolveImageGenerateDefaults", () => {
	const prefs = { imageModel: "gemini-3.1-flash-image-preview-ultra", imageSize: "1K" };

	it("节点显式模型/规格永远优先（画风锚 seedream 等工艺路径不受偏好影响）", () => {
		expect(
			resolveImageGenerateDefaults({
				prefs,
				explicitModelAlias: "doubao-seedream-5-0-pro-260628",
				explicitImageModel: "",
				explicitSize: "2K",
			}),
		).toEqual({ modelAlias: "doubao-seedream-5-0-pro-260628", imageSize: "2K" });
	});

	it("未显式指定时使用用户动态目录偏好", () => {
		expect(
			resolveImageGenerateDefaults({
				prefs,
				explicitModelAlias: "",
				explicitImageModel: "",
				explicitSize: "",
			}),
		).toEqual({ modelAlias: "gemini-3.1-flash-image-preview-ultra", imageSize: "1K" });
	});

	it("新账号使用固定初始模型和规格", () => {
		expect(
			resolveImageGenerateDefaults({
				prefs: null,
				explicitModelAlias: "",
				explicitImageModel: "",
				explicitSize: "",
			}),
		).toEqual({ modelAlias: "gpt-image-2", imageSize: "1K" });
	});

	it("nodeData.imageModel 形式的显式指定同样优先于偏好", () => {
		expect(
			resolveImageGenerateDefaults({
				prefs,
				explicitModelAlias: "",
				explicitImageModel: "gpt-image-2",
				explicitSize: "",
			}),
		).toEqual({ modelAlias: "gpt-image-2", imageSize: "1K" });
	});
});

describe("resolveEffectiveUserGenerationPrefs", () => {
	it("新账号采用产品初始偏好", () => {
		expect(resolveEffectiveUserGenerationPrefs(null)).toEqual(DEFAULT_USER_GENERATION_PREFS);
	});

	it("只用账号最近选择覆盖对应字段", () => {
		expect(resolveEffectiveUserGenerationPrefs({
			imageModel: "custom-image",
			videoResolution: "1080p",
		})).toEqual({
			...DEFAULT_USER_GENERATION_PREFS,
			imageModel: "custom-image",
			videoResolution: "1080p",
		});
	});
});

describe("buildGenerationPrefsContextBlock", () => {
	it("新账号也获得固定初始偏好上下文", () => {
		const block = buildGenerationPrefsContextBlock(null);
		expect(block).toContain("gpt-image-2");
		expect(block).toContain("minimax-h3");
		expect(block).toContain("768p");
		expect(block).toContain("16:9");
	});

	it("有偏好 → 生成上下文块，且明确禁止自动切换模型或规格", () => {
		const block = buildGenerationPrefsContextBlock({
			imageModel: "gpt-image-2",
			videoModel: "doubao-seedance-2-0-260128",
			videoResolution: "720p",
			videoAspect: "16:9",
		});
		expect(block).toContain("用户账号生成偏好");
		expect(block).toContain("gpt-image-2");
		expect(block).toContain("doubao-seedance-2-0-260128");
		expect(block).toContain("720p");
		expect(block).toContain("16:9");
		expect(block).not.toContain("最长合法单段时长");
		expect(block).not.toContain("减少付费生成片段数");
		expect(block).not.toContain("额外片段数");
		expect(block).toMatch(/film_spec.*优先|优先.*film_spec|章级/);
		expect(block).toContain("不是用户本轮已经确认的交付事实");
		expect(block).toContain("不得把本块值写入 UserIntentContract");
		expect(block).toContain("禁止自动切换");
	});
});
