import { describe, expect, it } from "vitest";
import {
	createPromptHash,
	normalizePromptText,
	parseOpenNanaPromptLinksFromHtml,
	parseOpenNanaPromptPage,
	parseOpenNanaPromptSitemap,
	parsePromptLinksFromHtml,
	parsePromptSitemap,
	parseYouMindPromptPage,
} from "./prompt-library.parser";

describe("prompt library parser", () => {
	it("normalizes equivalent prompts to the same hash", () => {
		expect(createPromptHash("  一辆\t摩托车\r\n\r\n驶过雪山  ")).toBe(
			createPromptHash("一辆 摩托车\n\n驶过雪山"),
		);
		expect(normalizePromptText(" A  B ")).toBe("A B");
	});

	it("extracts unique prompt details from a model landing page", () => {
		const html = `<main>
			<a href="/zh-CN/prompts/one-1">One</a>
			<a href="/zh-CN/prompts/one-1">Duplicate</a>
			<a href="https://youmind.com/zh-CN/video-prompts/two-2">Two</a>
			<a href="https://example.com/prompts/no-3">External</a>
			<a href="/zh-CN/gpt-image-2-prompts">Landing</a>
		</main>`;
		expect(parsePromptLinksFromHtml(html, "https://youmind.com/zh-CN/gpt-image-2-prompts")).toEqual([
			"https://youmind.com/zh-CN/prompts/one-1",
			"https://youmind.com/zh-CN/video-prompts/two-2",
		]);
	});

	it("extracts and deduplicates public prompt detail URLs from a sitemap", () => {
		const xml = `<?xml version="1.0"?><urlset>
			<url><loc>https://youmind.com/prompts/example-1</loc></url>
			<url><loc>https://youmind.com/prompts/example-1</loc></url>
			<url><loc>https://youmind.com/video-prompts/example-2</loc></url>
			<url><loc>https://example.com/prompts/no-3</loc></url>
		</urlset>`;
		expect(parsePromptSitemap(xml)).toEqual([
			"https://youmind.com/prompts/example-1",
			"https://youmind.com/video-prompts/example-2",
		]);
	});

	it("extracts only public OpenNana detail pages from sitemap and gallery HTML", () => {
		const xml = `<?xml version="1.0"?><urlset>
			<url><loc>https://opennana.com/awesome-prompt-gallery/example-one</loc></url>
			<url><loc>https://opennana.com/awesome-prompt-gallery/example-one</loc></url>
			<url><loc>https://opennana.com/awesome-prompt-gallery</loc></url>
			<url><loc>https://api.opennana.com/api/prompts/1</loc></url>
		</urlset>`;
		expect(parseOpenNanaPromptSitemap(xml)).toEqual([
			"https://opennana.com/awesome-prompt-gallery/example-one",
		]);
		expect(parseOpenNanaPromptLinksFromHtml(
			'<a href="/awesome-prompt-gallery/example-two?from=home">Two</a><a href="/pricing">No</a>',
			"https://opennana.com/awesome-prompt-gallery",
		)).toEqual(["https://opennana.com/awesome-prompt-gallery/example-two"]);
	});

	it("reads immutable bilingual prompt text and multiple public outputs from OpenNana HTML", () => {
		const original = "Cinematic product prompt";
		const translated = "电影级产品提示词";
		const flightParts = [
			`1b:T${Buffer.byteLength(original, "utf8").toString(16)},${original}\n`,
			`a:{"promptId":24094,"initialLikeCount":7,"initialPrompts":[{"text":"$1b","type":"en"},{"text":"${translated}","type":"zh"}]}\n`,
		];
		const flightHtml = flightParts.map((part) => `<script>self.__next_f.push(${JSON.stringify([1, part])})</script>`).join("");
		const html = `<script type="application/ld+json">${JSON.stringify({
			"@type": "CreativeWork",
			name: "OpenNana 多图示例",
			description: "公开提示词案例",
			datePublished: "2026-08-25T00:00:00.000Z",
			keywords: "广告, 产品",
		})}</script>
		<div><span>来源: <a href="https://example.com/source?referrer=opennana.com">@creator</a></span><span>模型: GPT Image 2</span></div>
		<img alt="示例 1" src="https://cdn.example/one.jpg" />
		<img alt="示例 2" src="https://cdn.example/two.jpg" />${flightHtml}`;
		const parsed = parseOpenNanaPromptPage(
			html,
			"https://opennana.com/awesome-prompt-gallery/example",
		);
		expect(parsed).toMatchObject({
			sourcePromptId: "24094",
			promptText: translated,
			promptTextOriginal: original,
			modelSlug: "gpt-image-2",
			modelName: "GPT Image 2",
			sourceAuthor: "@creator",
			originalSourceUrl: "https://example.com/source",
			mediaType: "image",
			metrics: { likes: 7 },
		});
		expect(parsed?.media.map((item) => item.url)).toEqual([
			"https://cdn.example/one.jpg",
			"https://cdn.example/two.jpg",
		]);
	});

	it("reassembles split Next Flight JSON and reads the model from the public flight protocol", () => {
		const original = "Editorial portrait";
		const translated = "社论人像";
		const detail = `a:{"promptId":21566,"slug":"ultra-realistic-fashion-e`;
		const continuation = `ditorial","initialPrompts":[{"text":"${original}","type":"en"},{"text":"${translated}","type":"zh"}]}`;
		const model = `b:{"children":["模型: ","即梦"]}`;
		const flightHtml = [detail, continuation, model]
			.map((part) => `<script>self.__next_f.push(${JSON.stringify([1, part])})</script>`)
			.join("");
		const html = `<script type="application/ld+json">${JSON.stringify({
			"@type": "CreativeWork",
			name: "分段协议示例",
			image: "https://cdn.example/editorial.jpg",
		})}</script><img alt="示例 1" src="https://cdn.example/editorial.jpg" />${flightHtml}`;

		expect(parseOpenNanaPromptPage(
			html,
			"https://opennana.com/awesome-prompt-gallery/split-flight",
		)).toMatchObject({
			sourcePromptId: "21566",
			promptTextOriginal: original,
			promptText: translated,
			modelName: "即梦",
			modelSlug: "即梦",
		});
	});

	it("reads translated content and every output image from the public page", () => {
		const detail = {
			id: 9225,
			content: "A motorcycle on a mountain road",
			translatedContent: "摩托车驶过雪山公路",
			media: ["https://cdn.example/1.jpg", "https://cdn.example/2.jpg"],
			mediaThumbnails: ["https://cdn.example/t1.jpg", "https://cdn.example/t2.jpg"],
			mediaDimensions: [{ width: 1600, height: 900 }, { width: 900, height: 1600 }],
			categories: [{ name: "广告" }],
			raw: { likeCount: 7, viewCount: 99 },
		};
		const flightTuple = JSON.stringify([1, JSON.stringify(detail)]);
		const html = `<script type="application/ld+json">${JSON.stringify({
			"@type": "CreativeWork",
			identifier: "9225",
			name: "Karakoram 摩托车广告",
			description: "示例描述",
			about: { name: "Seedance 2.5" },
			author: { name: "Original", url: "https://example.com/author" },
			isBasedOn: "https://example.com/original",
			inLanguage: "en",
			image: "https://cdn.example/poster.jpg",
		})}</script><script>self.__next_f.push(${flightTuple})</script>`;
		const parsed = parseYouMindPromptPage(html, "https://youmind.com/prompts/example-9225");
		expect(parsed).toMatchObject({
			modelSlug: "seedance-2-5",
			promptText: "摩托车驶过雪山公路",
			promptTextOriginal: "A motorcycle on a mountain road",
			sourceAuthor: "Original",
			metrics: { likes: 7, views: 99 },
		});
		expect(parsed?.media).toHaveLength(2);
	});

	it("returns null for a model outside the configured collection scope", () => {
		const html = `<script type="application/ld+json">${JSON.stringify({
			"@type": "CreativeWork",
			identifier: "5",
			name: "Unsupported",
			description: "Prompt body",
			about: { name: "Other Model" },
			image: "https://cdn.example/image.jpg",
		})}</script>`;
		expect(parseYouMindPromptPage(html, "https://youmind.com/prompts/example-5")).toBeNull();
	});

	it("returns null when a prompt has no public output media", () => {
		const html = `<script type="application/ld+json">${JSON.stringify({
			"@type": "CreativeWork",
			identifier: "6",
			name: "Only reference inputs",
			text: "Prompt body",
			about: { name: "GPT Image 2" },
		})}</script>`;
		expect(parseYouMindPromptPage(html, "https://youmind.com/prompts/example-6")).toBeNull();
	});

	it("resolves hexadecimal flight text references and keeps every gallery image", () => {
		const original = "Original prompt with precise camera and lighting instructions.";
		const translated = "包含精确镜头与光线指令的中文提示词。";
		const imageUrls = ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg", "https://cdn.example/c.jpg"];
		const flightParts = [
			`31:{"title":"多图示例","images":${JSON.stringify(imageUrls)},"thumbnails":${JSON.stringify(imageUrls)},"imageDimensions":[{"width":900,"height":1125},{"width":900,"height":1125},{"width":900,"height":1125}],"videos":"$undefined"}\n`,
			`32:{"content":"$3b","promptId":88,"translatedContent":"$3c"}\n`,
			`3b:T${Buffer.byteLength(original, "utf8").toString(16)},${original}\n3c:T${Buffer.byteLength(translated, "utf8").toString(16)},${translated}\n`,
		];
		const flightHtml = flightParts.map((part) => `<script>self.__next_f.push(${JSON.stringify([1, part])})</script>`).join("");
		const html = `<script type="application/ld+json">${JSON.stringify({
			"@context": "https://schema.org",
			"@graph": [{
				"@type": "CreativeWork", name: "多图示例", text: original,
				about: { name: "GPT Image 2" }, image: imageUrls[0],
			}],
		})}</script>${flightHtml}`;
		const parsed = parseYouMindPromptPage(html, "https://youmind.com/zh-CN/prompts/gallery-88");
		expect(parsed?.promptText).toBe(translated);
		expect(parsed?.promptTextOriginal).toBe(original);
		expect(parsed?.media.map((item) => item.url)).toEqual(imageUrls);
	});

	it("uses UTF-8 byte lengths for flight text without consuming the next row", () => {
		const original = "Original prompt";
		const translated = "中文提示词";
		const flightParts = [
			`32:{"content":"$3b","promptId":89,"translatedContent":"$3c"}\n`,
			`3b:T${Buffer.byteLength(original, "utf8").toString(16)},${original}\n3c:T${Buffer.byteLength(translated, "utf8").toString(16)},${translated}\n33:["$","div",null,{"children":"must not leak"}]`,
		];
		const flightHtml = flightParts.map((part) => `<script>self.__next_f.push(${JSON.stringify([1, part])})</script>`).join("");
		const html = `<script type="application/ld+json">${JSON.stringify({
			"@type": "CreativeWork", identifier: "89", name: "UTF-8 示例", text: original,
			about: { name: "GPT Image 2" }, image: "https://cdn.example/output.jpg",
		})}</script>${flightHtml}`;
		const parsed = parseYouMindPromptPage(html, "https://youmind.com/zh-CN/prompts/utf8-89");
		expect(parsed?.promptText).toBe(translated);
		expect(parsed?.promptText).not.toContain("must not leak");
	});
});
