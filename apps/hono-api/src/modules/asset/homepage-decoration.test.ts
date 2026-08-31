import { describe, expect, it } from "vitest";
import { sanitizeHomepageDecoration } from "./homepage-decoration";

describe("sanitizeHomepageDecoration", () => {
	it("null/非对象输入返回全默认", () => {
		for (const input of [null, undefined, "x", 42, []]) {
			expect(sanitizeHomepageDecoration(input)).toEqual({
				greetingSubtitle: null,
				heroPlaceholder: null,
				skillCards: [],
				loginVideos: [],
			});
		}
	});

	it("剔除无 title 的 skillCard、无 url 的 loginVideo，trim 字符串", () => {
		const out = sanitizeHomepageDecoration({
			greetingSubtitle: "  说说你的创意 ",
			heroPlaceholder: "",
			skillCards: [
				{ title: " 摄影SKILL ", subtitle: "摄影KS", imageUrl: "", link: "/x" },
				{ title: "", subtitle: "没标题该被剔除" },
				"garbage",
			],
			loginVideos: [
				{ url: " https://a/v.mp4 ", posterUrl: null, caption: "你不需要知道" },
				{ url: "", caption: "没url该被剔除" },
			],
		});
		expect(out.greetingSubtitle).toBe("说说你的创意");
		expect(out.heroPlaceholder).toBeNull();
		expect(out.skillCards).toEqual([
			{ title: "摄影SKILL", subtitle: "摄影KS", imageUrl: null, link: "/x" },
		]);
		expect(out.loginVideos).toEqual([
			{ url: "https://a/v.mp4", posterUrl: null, caption: "你不需要知道" },
		]);
	});
});
