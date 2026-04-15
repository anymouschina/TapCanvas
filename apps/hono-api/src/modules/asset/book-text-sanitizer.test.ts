import { describe, expect, it } from "vitest";
import {
	decodeHtmlEntities,
	sanitizeBookFieldText,
	sanitizeImportedBookText,
	sanitizeShotSummaryText,
	sanitizeShotTitleText,
} from "./book-text-sanitizer";

describe("book-text-sanitizer", () => {
	it("decodes numeric and named html entities", () => {
		expect(decodeHtmlEntities("&#20154; &quot;ok&quot; &#x72c2;")).toBe('人 "ok" 狂');
	});

	it("removes inline novel-site boilerplate and stray ascii noise lines", () => {
		const input = [
			"第一章七十二变 ，精彩小说无弹窗免费阅读！",
			"李老头死了。&#40;&#29378;&#95;&#20154;&#95;&#23567;&#95;&#35828;&#95;&#32593;&#45;&#119;&#119;&#119;&#46;&#120;&#105;&#97;&#111;&#115;&#104;&#117;&#111;&#46;&#107;&#114;&#41;",
			"&#20154; &#23567;",
			"&#119; &#119;",
			"手机端阅读：m.xiaoshuo.kr更多更好资源。。。。",
			"&#29378;&#20155;&#32;&#21715;&#35498;&#32178;&#120;&#105;&#97;&#111;&#115;&#104;&#117;&#111;&#46;&#107;&#114;",
		].join("\n");
		expect(sanitizeImportedBookText(input)).toBe(["第一章七十二变", "李老头死了。"].join("\n"));
	});

	it("suppresses low-signal shot fields produced from html entities", () => {
		expect(sanitizeShotTitleText("&#35828;")).toBeUndefined();
		expect(sanitizeShotSummaryText("&#119; &#120;")).toBeUndefined();
		expect(sanitizeShotTitleText("镜头 2 · 李老头死了")).toBe("镜头 2 · 李老头死了");
	});

	it("normalizes regular book fields without over-mutating text", () => {
		expect(sanitizeBookFieldText("  李老头死了。 &#29378; ")).toBe("李老头死了。 狂");
	});
});
