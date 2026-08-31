import { createHash } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import {
	SUPPORTED_PROMPT_MODELS,
	type ParsedPromptMedia,
	type ParsedPromptSource,
} from "./prompt-library.types";

type JsonRecord = Record<string, unknown>;

const modelByNormalizedName = new Map(
	SUPPORTED_PROMPT_MODELS.map((model) => [normalizeModelName(model.name), model]),
);

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function normalizeModelName(value: string): string {
	return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/[._-]+/g, " ").replace(/\s+/g, " ");
}

export function normalizePromptText(value: string): string {
	return value
		.normalize("NFKC")
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.replace(/[\t ]+/g, " ").trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function createPromptHash(value: string): string {
	return createHash("sha256").update(normalizePromptText(value), "utf8").digest("hex");
}

export function parsePromptSitemap(xml: string): string[] {
	const document = new DOMParser().parseFromString(xml, "application/xml");
	const parserErrors = document.getElementsByTagName("parsererror");
	if (parserErrors.length > 0) {
		throw new Error(`提示词站点地图 XML 无法解析：${parserErrors.item(0)?.textContent ?? "未知错误"}`);
	}
	const urls = Array.from(document.getElementsByTagName("loc"))
		.map((node) => node.textContent?.trim() ?? "")
		.filter((url) => {
			try {
				const parsed = new URL(url);
				return parsed.hostname === "youmind.com" && /\/(?:video-)?prompts\//.test(parsed.pathname);
			} catch {
				return false;
			}
		});
	return [...new Set(urls)];
}

export function parseOpenNanaPromptSitemap(xml: string): string[] {
	const document = new DOMParser().parseFromString(xml, "application/xml");
	const parserErrors = document.getElementsByTagName("parsererror");
	if (parserErrors.length > 0) {
		throw new Error(`OpenNana 站点地图 XML 无法解析：${parserErrors.item(0)?.textContent ?? "未知错误"}`);
	}
	const urls = Array.from(document.getElementsByTagName("loc"))
		.map((node) => node.textContent?.trim() ?? "")
		.filter((value) => {
			try {
				const url = new URL(value);
				return url.hostname === "opennana.com"
					&& /^\/awesome-prompt-gallery\/[^/]+\/?$/u.test(url.pathname);
			} catch {
				return false;
			}
		});
	return [...new Set(urls)];
}

export function parseOpenNanaPromptLinksFromHtml(html: string, baseUrl: string): string[] {
	const document = new DOMParser().parseFromString(`<html><body>${html}</body></html>`, "text/html");
	const urls = Array.from(document.getElementsByTagName("a")).flatMap((node) => {
		const href = node.getAttribute("href")?.trim();
		if (!href) return [];
		try {
			const url = new URL(href, baseUrl);
			url.search = "";
			url.hash = "";
			return url.hostname === "opennana.com"
				&& /^\/awesome-prompt-gallery\/[^/]+\/?$/u.test(url.pathname)
				? [url.toString()]
				: [];
		} catch {
			return [];
		}
	});
	return [...new Set(urls)];
}

export function parsePromptLinksFromHtml(html: string, baseUrl: string): string[] {
	const document = new DOMParser().parseFromString(html, "text/html");
	const urls = Array.from(document.getElementsByTagName("a")).flatMap((node) => {
		const href = node.getAttribute("href")?.trim();
		if (!href) return [];
		try {
			const url = new URL(href, baseUrl);
			return url.hostname === "youmind.com" && /\/(?:video-)?prompts\/[^/]+\/?$/.test(url.pathname) ? [url.toString()] : [];
		} catch {
			return [];
		}
	});
	return [...new Set(urls)];
}

function parseJsonLdDocuments(html: string): JsonRecord[] {
	const documents: JsonRecord[] = [];
	const scriptPattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
	for (const match of html.matchAll(scriptPattern)) {
		const raw = match[1]?.trim();
		if (!raw) continue;
		try {
			const value: unknown = JSON.parse(raw);
			const values = Array.isArray(value) ? value : [value];
			for (const item of values) {
				if (!isRecord(item)) continue;
				documents.push(item);
				const graph = Array.isArray(item["@graph"]) ? item["@graph"] : [];
				for (const graphItem of graph) {
					if (isRecord(graphItem)) documents.push(graphItem);
				}
			}
		} catch (error) {
			throw new Error(`提示词详情 JSON-LD 无法解析：${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return documents;
}

function extractNextFlightText(html: string): string {
	const parts: string[] = [];
	const pushPattern = /self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g;
	for (const match of html.matchAll(pushPattern)) {
		try {
			const tuple: unknown = JSON.parse(match[1]);
			if (Array.isArray(tuple) && typeof tuple[1] === "string") parts.push(tuple[1]);
		} catch {
			// A malformed flight segment is not accepted as data; other segments can still carry the object.
		}
	}
	// Next Flight may split one JSON string at an arbitrary byte boundary. Reassemble the
	// transport frames without injecting characters so the public protocol remains parseable.
	return parts.join("");
}

function findJsonObjectContaining(source: string, marker: string): JsonRecord | null {
	let cursor = source.indexOf(marker);
	while (cursor >= 0) {
		let start = cursor;
		while (start >= 0 && source[start] !== "{") start -= 1;
		for (; start >= 0; start = source.lastIndexOf("{", start - 1)) {
			let depth = 0;
			let quoted = false;
			let escaped = false;
			for (let index = start; index < source.length; index += 1) {
				const char = source[index];
				if (quoted) {
					if (escaped) escaped = false;
					else if (char === "\\") escaped = true;
					else if (char === '"') quoted = false;
					continue;
				}
				if (char === '"') quoted = true;
				else if (char === "{") depth += 1;
				else if (char === "}") {
					depth -= 1;
					if (depth === 0) {
						try {
							const candidate: unknown = JSON.parse(source.slice(start, index + 1));
							if (isRecord(candidate) && source.slice(start, index + 1).includes(marker)) return candidate;
						} catch {
							break;
						}
					}
				}
			}
		}
		cursor = source.indexOf(marker, cursor + marker.length);
	}
	return null;
}

function findJsonObjectContainingWhere(
	source: string,
	marker: string,
	predicate: (candidate: JsonRecord) => boolean,
): JsonRecord | null {
	let markerIndex = source.indexOf(marker);
	while (markerIndex >= 0) {
		for (let start = source.lastIndexOf("{", markerIndex); start >= 0; start = source.lastIndexOf("{", start - 1)) {
			let depth = 0;
			let quoted = false;
			let escaped = false;
			for (let index = start; index < source.length; index += 1) {
				const char = source[index];
				if (quoted) {
					if (escaped) escaped = false;
					else if (char === "\\") escaped = true;
					else if (char === '"') quoted = false;
					continue;
				}
				if (char === '"') quoted = true;
				else if (char === "{") depth += 1;
				else if (char === "}") {
					depth -= 1;
					if (depth === 0) {
						if (index < markerIndex) break;
						try {
							const candidate: unknown = JSON.parse(source.slice(start, index + 1));
							if (isRecord(candidate) && predicate(candidate)) return candidate;
						} catch {
							break;
						}
						break;
					}
				}
			}
		}
		markerIndex = source.indexOf(marker, markerIndex + marker.length);
	}
	return null;
}

function readJsonArrayAfter(source: string, keyIndex: number): unknown[] | null {
	const colonIndex = source.indexOf(":", keyIndex);
	if (colonIndex < 0 || colonIndex - keyIndex > 32) return null;
	let arrayStart = colonIndex + 1;
	while (arrayStart < source.length && /\s/.test(source[arrayStart])) arrayStart += 1;
	if (source[arrayStart] !== "[") return null;
	let depth = 0;
	let quoted = false;
	let escaped = false;
	for (let index = arrayStart; index < source.length; index += 1) {
		const char = source[index];
		if (quoted) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') quoted = false;
			continue;
		}
		if (char === '"') quoted = true;
		else if (char === "[") depth += 1;
		else if (char === "]") {
			depth -= 1;
			if (depth === 0) {
				try {
					const parsed: unknown = JSON.parse(source.slice(arrayStart, index + 1));
					return Array.isArray(parsed) ? parsed : null;
				} catch {
					return null;
				}
			}
		}
	}
	return null;
}

function readGalleryNearImage(source: string, imageUrl: string): JsonRecord | null {
	let imageIndex = source.indexOf(imageUrl);
	while (imageIndex >= 0) {
		const imagesKey = source.lastIndexOf('"images":', imageIndex);
		if (imagesKey >= 0 && imageIndex - imagesKey < 2_000) {
			const images = readJsonArrayAfter(source, imagesKey);
			if (images?.includes(imageUrl)) {
				const windowEnd = Math.min(source.length, imageIndex + 5_000);
				const thumbnailsKey = source.indexOf('"thumbnails":', imagesKey);
				const dimensionsKey = source.indexOf('"imageDimensions":', imagesKey);
				const videosKey = source.indexOf('"videos":', imagesKey);
				return {
					images,
					thumbnails: thumbnailsKey >= 0 && thumbnailsKey < windowEnd ? readJsonArrayAfter(source, thumbnailsKey) : null,
					imageDimensions: dimensionsKey >= 0 && dimensionsKey < windowEnd ? readJsonArrayAfter(source, dimensionsKey) : null,
					videos: videosKey >= 0 && videosKey < windowEnd ? readJsonArrayAfter(source, videosKey) : null,
				};
			}
		}
		imageIndex = source.indexOf(imageUrl, imageIndex + imageUrl.length);
	}
	return null;
}

function readFlightTextReference(source: string, reference: unknown): string | null {
	const ref = readString(reference);
	if (!ref?.startsWith("$") || ref.length < 2) return null;
	const marker = `${ref.slice(1)}:T`;
	const markerIndex = source.indexOf(marker);
	if (markerIndex < 0) return null;
	const lengthStart = markerIndex + marker.length;
	const commaIndex = source.indexOf(",", lengthStart);
	if (commaIndex < 0) return null;
	const length = Number.parseInt(source.slice(lengthStart, commaIndex), 16);
	if (!Number.isInteger(length) || length < 0) return null;
	const payload = Buffer.from(source.slice(commaIndex + 1), "utf8");
	if (payload.byteLength < length) return null;
	return payload.subarray(0, length).toString("utf8");
}

function readName(value: unknown): string | null {
	if (typeof value === "string") return readString(value);
	return isRecord(value) ? readString(value.name) : null;
}

function resolveModel(jsonLd: JsonRecord, detail: JsonRecord | null): { slug: string; name: string } | null {
	const names = [readName(jsonLd.about), readString(detail?.model), readName(detail?.model)];
	for (const name of names) {
		if (!name) continue;
		const exact = modelByNormalizedName.get(normalizeModelName(name));
		if (exact) return exact;
	}
	return null;
}

function readInteractionCount(jsonLd: JsonRecord, suffix: string): number {
	const interactions = Array.isArray(jsonLd.interactionStatistic) ? jsonLd.interactionStatistic : [];
	for (const interaction of interactions) {
		if (!isRecord(interaction)) continue;
		const interactionType = interaction.interactionType;
		const type = readName(interactionType) ?? (isRecord(interactionType) ? readString(interactionType["@type"]) : null);
		if (type?.toLocaleLowerCase("en-US").includes(suffix)) return readNumber(interaction.userInteractionCount);
	}
	return 0;
}

function parseMedia(
	detail: JsonRecord | null,
	gallery: JsonRecord | null,
	jsonLd: JsonRecord,
	videoJsonLd: JsonRecord | null,
	mediaType: "image" | "video",
): ParsedPromptMedia[] {
	const mediaValues = Array.isArray(detail?.media)
		? detail.media
		: Array.isArray(gallery?.images) ? gallery.images : [];
	const thumbnailValues = Array.isArray(detail?.mediaThumbnails)
		? detail.mediaThumbnails
		: Array.isArray(gallery?.thumbnails) ? gallery.thumbnails : [];
	const dimensions = Array.isArray(detail?.mediaDimensions)
		? detail.mediaDimensions
		: Array.isArray(gallery?.imageDimensions) ? gallery.imageDimensions : [];
	const result: ParsedPromptMedia[] = [];
	for (let index = 0; index < mediaValues.length; index += 1) {
		const url = readString(mediaValues[index]);
		if (!url) continue;
		const dimension = isRecord(dimensions[index]) ? dimensions[index] : null;
		result.push({
			kind: "image",
			url,
			thumbnailUrl: readString(thumbnailValues[index]),
			width: dimension ? readNumber(dimension.width) || null : null,
			height: dimension ? readNumber(dimension.height) || null : null,
		});
	}
	const galleryVideos = Array.isArray(gallery?.videos) ? gallery.videos : [];
	const videoUrls = [detail?.video, videoJsonLd?.contentUrl, ...galleryVideos].flatMap((value) => {
		if (typeof value === "string") return [value];
		if (!isRecord(value)) return [];
		return [readString(value.url) ?? readString(value.src) ?? readString(value.sourceUrl) ?? readString(value.contentUrl)].filter((url): url is string => Boolean(url));
	});
	for (const videoUrl of [...new Set(videoUrls)].reverse()) {
		result.unshift({ kind: "video", url: videoUrl, thumbnailUrl: readString(jsonLd.image), width: null, height: null });
	}
	if (mediaType === "video" && result.some((media) => media.kind === "video")) {
		return result.filter((media) => media.kind === "video");
	}
	if (result.length === 0) {
		const imageUrl = readString(jsonLd.image);
		if (imageUrl) result.push({ kind: mediaType, url: imageUrl, thumbnailUrl: null, width: null, height: null });
	}
	return result;
}

function readCategories(detail: JsonRecord | null, jsonLd: JsonRecord): string[] {
	const values: string[] = [];
	const rawDetailCategories = Array.isArray(detail?.categories) ? detail.categories : [];
	for (const category of rawDetailCategories) {
		const value = readName(category);
		if (value) values.push(value);
	}
	const keywords = jsonLd.keywords;
	if (Array.isArray(keywords)) {
		for (const keyword of keywords) {
			const value = readString(keyword);
			if (value) values.push(value);
		}
	} else {
		const keywordText = readString(keywords);
		if (keywordText) values.push(...keywordText.split(",").map((value) => value.trim()).filter(Boolean));
	}
	return [...new Set(values)];
}

export function parseYouMindPromptPage(html: string, sourceUrl: string): ParsedPromptSource | null {
	const jsonLdDocuments = parseJsonLdDocuments(html);
	const jsonLd = jsonLdDocuments.find((item) => {
		const type = readString(item["@type"]);
		return type === "CreativeWork" || type === "VideoObject" || type === "ImageObject";
	});
	if (!jsonLd) throw new Error("提示词详情缺少 CreativeWork JSON-LD");
	const sourcePromptId = readString(jsonLd.identifier) ?? sourceUrl.match(/-(\d+)(?:\/?(?:\?.*)?)$/)?.[1] ?? null;
	if (!sourcePromptId) throw new Error("提示词详情缺少稳定来源 ID");
	const flightText = extractNextFlightText(html);
	const detail = findJsonObjectContainingWhere(
		flightText,
		`\"promptId\":${sourcePromptId}`,
		(candidate) => "content" in candidate || "translatedContent" in candidate,
	) ?? findJsonObjectContaining(flightText, `\"id\":${sourcePromptId}`);
	const model = resolveModel(jsonLd, detail);
	if (!model) return null;
	const originalPrompt = readFlightTextReference(flightText, detail?.content)
		?? readString(detail?.content)
		?? readString(jsonLd.text)
		?? readString(jsonLd.description);
	if (!originalPrompt) throw new Error("提示词详情缺少原始提示词正文");
	const translatedPrompt = readFlightTextReference(flightText, detail?.translatedContent)
		?? readString(detail?.translatedContent);
	const promptText = normalizePromptText(translatedPrompt ?? originalPrompt);
	const promptTextOriginal = normalizePromptText(originalPrompt);
	if (!promptText) throw new Error("提示词正文规范化后为空");
	const pathname = new URL(sourceUrl).pathname;
	const mediaType = pathname.includes("/video-prompts/") ? "video" : "image";
	const author = isRecord(jsonLd.author) ? jsonLd.author : null;
	const raw = isRecord(detail?.raw) ? detail.raw : null;
	const jsonLdImage = readString(jsonLd.image);
	const gallery = jsonLdImage
		? readGalleryNearImage(flightText, jsonLdImage) ?? findJsonObjectContainingWhere(
			flightText,
			JSON.stringify(jsonLdImage),
			(candidate) => Array.isArray(candidate.images) || Array.isArray(candidate.videos),
		)
		: null;
	const videoJsonLd = jsonLdDocuments.find((item) => readString(item["@type"]) === "VideoObject") ?? null;
	const media = parseMedia(detail, gallery, jsonLd, videoJsonLd, mediaType);
	if (media.length === 0) return null;
	return {
		sourcePromptId,
		sourceUrl,
		title: readString(jsonLd.name) ?? `提示词 ${sourcePromptId}`,
		description: readString(jsonLd.description),
		promptText,
		promptTextOriginal,
		mediaType,
		media,
		sourceAuthor: readString(author?.name),
		sourceAuthorUrl: readString(author?.url),
		originalLanguage: readString(jsonLd.inLanguage),
		modelSlug: model.slug,
		modelName: model.name,
		originalSourceUrl: readString(jsonLd.isBasedOn),
		categories: readCategories(detail, jsonLd),
		publishedAt: readString(jsonLd.datePublished),
		metrics: {
			likes: readNumber(raw?.likeCount) || readInteractionCount(jsonLd, "likeaction"),
			views: readNumber(raw?.viewCount) || readInteractionCount(jsonLd, "viewaction"),
			shares: readNumber(raw?.shareCount) || readInteractionCount(jsonLd, "shareaction"),
			comments: readNumber(raw?.commentCount) || readInteractionCount(jsonLd, "commentaction"),
			bookmarks: readNumber(raw?.bookmarkCount),
			quotes: readNumber(raw?.quoteCount),
		},
	};
}

function stripOpenNanaReferrer(value: string | null): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		url.searchParams.delete("referrer");
		return url.toString();
	} catch {
		return value;
	}
}

function normalizeExternalModelSlug(value: string): string {
	const slug = value
		.normalize("NFKC")
		.trim()
		.toLocaleLowerCase("en-US")
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
	if (!slug) throw new Error("OpenNana 详情缺少可持久化的模型标识");
	return slug;
}

function openNanaPromptDetail(flightText: string): JsonRecord | null {
	return findJsonObjectContainingWhere(
		flightText,
		'"initialPrompts":',
		(candidate) => Array.isArray(candidate.initialPrompts) && "promptId" in candidate,
	);
}

function openNanaModelName(document: Document, flightText: string): string | null {
	for (const span of Array.from(document.getElementsByTagName("span"))) {
		const text = span.textContent?.replace(/\s+/gu, " ").trim() ?? "";
		if (!text.startsWith("模型:")) continue;
		const value = text.slice("模型:".length).trim();
		if (value) return value;
	}
	const flightModel = findJsonObjectContainingWhere(
		flightText,
		'"模型: "',
		(candidate) => (
			Array.isArray(candidate.children)
			&& candidate.children[0] === "模型: "
			&& Boolean(readString(candidate.children[1]))
		),
	);
	if (Array.isArray(flightModel?.children)) return readString(flightModel.children[1]);
	return null;
}

function openNanaAuthor(document: Document): { name: string | null; url: string | null } {
	for (const anchor of Array.from(document.getElementsByTagName("a"))) {
		const name = anchor.textContent?.trim() ?? "";
		const href = anchor.getAttribute("href")?.trim() ?? "";
		if (!name.startsWith("@") || !href) continue;
		return { name, url: stripOpenNanaReferrer(href) };
	}
	return { name: null, url: null };
}

function openNanaMedia(document: Document): ParsedPromptMedia[] {
	const media: ParsedPromptMedia[] = [];
	for (const image of Array.from(document.getElementsByTagName("img"))) {
		const alt = image.getAttribute("alt")?.trim() ?? "";
		const url = image.getAttribute("src")?.trim() ?? "";
		if (!alt.startsWith("示例 ") || !url) continue;
		media.push({ kind: "image", url, thumbnailUrl: null, width: null, height: null });
	}
	for (const video of Array.from(document.getElementsByTagName("video"))) {
		const directUrl = video.getAttribute("src")?.trim() ?? "";
		const sourceUrl = Array.from(video.getElementsByTagName("source"))
			.map((source) => source.getAttribute("src")?.trim() ?? "")
			.find(Boolean) ?? "";
		const url = directUrl || sourceUrl;
		if (!url) continue;
		media.push({
			kind: "video",
			url,
			thumbnailUrl: video.getAttribute("poster")?.trim() || null,
			width: null,
			height: null,
		});
	}
	const seen = new Set<string>();
	return media.filter((item) => {
		if (seen.has(item.url)) return false;
		seen.add(item.url);
		return true;
	});
}

export function parseOpenNanaPromptPage(html: string, sourceUrl: string): ParsedPromptSource | null {
	const document = new DOMParser().parseFromString(`<html><body>${html}</body></html>`, "text/html");
	const jsonLdDocuments = parseJsonLdDocuments(html);
	const jsonLd = jsonLdDocuments.find((item) => readString(item["@type"]) === "CreativeWork");
	if (!jsonLd) throw new Error("OpenNana 详情缺少 CreativeWork JSON-LD");
	const flightText = extractNextFlightText(html);
	const detail = openNanaPromptDetail(flightText);
	if (!detail) throw new Error("OpenNana 详情缺少公开 initialPrompts 协议数据");
	const promptId = readNumber(detail.promptId);
	if (!promptId) throw new Error("OpenNana 详情缺少稳定 promptId");
	const rawPrompts = Array.isArray(detail.initialPrompts) ? detail.initialPrompts : [];
	const prompts = rawPrompts.flatMap((value) => {
		if (!isRecord(value)) return [];
		const text = readFlightTextReference(flightText, value.text) ?? readString(value.text);
		return text ? [{ type: readString(value.type), text: normalizePromptText(text) }] : [];
	});
	const original = prompts.find((item) => item.type === "en")?.text ?? prompts[0]?.text ?? null;
	const translated = prompts.find((item) => item.type === "zh")?.text ?? original;
	if (!original || !translated) return null;
	const modelName = openNanaModelName(document, flightText);
	if (!modelName) throw new Error("OpenNana 详情缺少模型名称");
	const media = openNanaMedia(document);
	if (media.length === 0) return null;
	const author = openNanaAuthor(document);
	const keywords = readString(jsonLd.keywords)?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
	const mediaType = media.some((item) => item.kind === "video") ? "video" : "image";
	return {
		sourcePromptId: String(promptId),
		sourceUrl,
		title: readString(jsonLd.name) ?? `OpenNana 提示词 ${promptId}`,
		description: readString(jsonLd.description),
		promptText: translated,
		promptTextOriginal: original,
		mediaType,
		media: mediaType === "video" ? media.filter((item) => item.kind === "video") : media,
		sourceAuthor: author.name,
		sourceAuthorUrl: author.url,
		originalLanguage: prompts.some((item) => item.type === "en") ? "en" : null,
		modelSlug: normalizeExternalModelSlug(modelName),
		modelName,
		originalSourceUrl: author.url,
		categories: [...new Set(keywords)],
		publishedAt: readString(jsonLd.datePublished),
		metrics: {
			likes: readNumber(detail.initialLikeCount),
			views: 0,
			shares: 0,
			comments: 0,
			bookmarks: 0,
			quotes: 0,
		},
	};
}
