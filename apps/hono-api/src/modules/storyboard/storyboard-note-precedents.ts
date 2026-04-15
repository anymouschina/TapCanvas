import fs from "node:fs/promises";
import path from "node:path";

export type StoryboardPrecedentSummary = {
	sourcePath: string;
	sourceName: string;
	title: string;
	kind: "creative_process_json" | "creative_process_text";
	synopsis?: string;
	theme?: string;
	tone?: string;
	arc?: string;
	pacing?: string;
	shotPatterns: string[];
	antiPatterns: string[];
	keywords: string[];
	evidence: string[];
};

export type StoryboardPrecedentMatch = {
	summary: StoryboardPrecedentSummary;
	score: number;
	reasons: string[];
};

type JsonLikeRecord = Record<string, unknown>;

type CachedIndex = {
	key: string;
	items: StoryboardPrecedentSummary[];
};

const NOTES_DIR_CANDIDATES = [
	path.resolve(process.cwd(), "assets", "notes"),
	path.resolve(process.cwd(), "..", "assets", "notes"),
	path.resolve(process.cwd(), "..", "..", "assets", "notes"),
];

let cachedIndexPromise: Promise<CachedIndex> | null = null;

function isRecord(value: unknown): value is JsonLikeRecord {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function uniqStrings(items: string[], limit = 8): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		const normalized = item.trim();
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		out.push(normalized);
		if (out.length >= limit) break;
	}
	return out;
}

function clipText(value: string, maxLength: number): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	if (!normalized) return "";
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, Math.max(1, maxLength - 1)).trim()}…`;
}

const NOTE_META_LABELS = ["扫书报告", "书评", "读后感", "推荐语", "作者说明", "后记", "完本感言", "不是正文", "整理"];
const NOTE_STORY_LABELS = ["内容简介", "剧情简介", "故事简介", "简介", "文案", "梗概"];
const NOTE_NOISE_TERMS = [
	"小说网",
	"最新章节",
	"无弹窗",
	"章节内容开始",
	"章节内容结束",
	"点击",
	"收藏",
	"投票",
	"打赏",
	"评论",
	"状态:",
	"状态：",
	"作者:",
	"作者：",
	"来源",
	"E-mail",
	"http",
	"www.",
];
const NOTE_STORY_SIGNAL_TERMS = [
	"发现",
	"追查",
	"逼近",
	"逃",
	"杀",
	"死",
	"醒来",
	"复生",
	"异响",
	"怪",
	"尸",
	"祠堂",
	"夜",
	"冲突",
	"调查",
	"背叛",
	"围攻",
	"真相",
	"危机",
	"线索",
	"阻止",
	"反击",
	"失控",
];
const NOTE_OPINION_TERMS = ["好看", "神作", "精彩", "上头", "推荐", "粮草", "毒草", "个人觉得", "我觉得", "读者"];

function isBoilerplateNoteText(text: string): boolean {
	const normalized = text.trim();
	if (!normalized) return true;
	return NOTE_NOISE_TERMS.some((term) => normalized.includes(term));
}

function decodeNoteBuffer(buffer: Buffer): string {
	const candidates = ["utf-8", "gb18030", "gbk"] as const;
	let bestText = "";
	let bestScore = Number.NEGATIVE_INFINITY;
	for (const encoding of candidates) {
		try {
			const decoded = new TextDecoder(encoding).decode(buffer);
			const cjkCount = Array.from(decoded).filter((char) => /[\u3400-\u9fff]/.test(char)).length;
			const replacementCount = decoded.split("\uFFFD").length - 1;
			const garbledCount = decoded.split("�").length - 1;
			const score = cjkCount * 2 - replacementCount * 10 - garbledCount * 10;
			if (score > bestScore) {
				bestScore = score;
				bestText = decoded;
			}
		} catch {
			continue;
		}
	}
	return bestText.trim();
}

function splitParagraphs(text: string): string[] {
	return text
		.split(/\r?\n+/)
		.map((item) => item.trim())
		.filter(Boolean);
}

function sanitizeNoteParagraph(line: string): string {
	return clipText(
		line
			.replace(/^\s*[-*#>\d.、\s]+/, "")
			.replace(/^[^:：]{0,12}[:：]\s*/, "")
			.trim(),
		220,
	);
}

function normalizeNoteParagraphs(text: string): string[] {
	return uniqStrings(
		splitParagraphs(text)
			.map((line) => line.replace(/\s+/g, " ").trim())
			.filter((line) => !isBoilerplateNoteText(line))
			.map((line) => sanitizeNoteParagraph(line))
			.filter(Boolean),
		32,
	);
}

function isMetaOpinionParagraph(line: string): boolean {
	return NOTE_META_LABELS.some((label) => line.includes(label)) || NOTE_OPINION_TERMS.some((term) => line.includes(term));
}

function isLikelyStoryParagraph(line: string): boolean {
	if (!line || isBoilerplateNoteText(line) || isMetaOpinionParagraph(line)) return false;
	if (NOTE_STORY_LABELS.some((label) => line.includes(label))) return true;
	return NOTE_STORY_SIGNAL_TERMS.some((term) => line.includes(term));
}

function tokenizeForRetrieval(text: string): string[] {
	const normalized = text.toLowerCase();
	const asciiWords = normalized.match(/[a-z0-9]{2,}/g) ?? [];
	const cjkOnly = Array.from(normalized).filter((char) => /[\u3400-\u9fff]/.test(char));
	const cjkBigrams: string[] = [];
	for (let index = 0; index < cjkOnly.length - 1; index += 1) {
		const token = `${cjkOnly[index]}${cjkOnly[index + 1]}`;
		cjkBigrams.push(token);
	}
	return uniqStrings([...asciiWords, ...cjkBigrams], 128);
}

function countOverlaps(left: string[], right: string[]): number {
	if (!left.length || !right.length) return 0;
	const rightSet = new Set(right);
	let score = 0;
	for (const token of left) {
		if (rightSet.has(token)) score += 1;
	}
	return score;
}

function extractJsonBlock(text: string): unknown | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	const directCandidates = [trimmed];
	const fencedMatches = Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi));
	for (const match of fencedMatches) {
		const candidate = asTrimmedString(match[1]);
		if (candidate) directCandidates.push(candidate);
	}
	for (const candidate of directCandidates) {
		try {
			return JSON.parse(candidate);
		} catch {
			continue;
		}
	}
	const starts: number[] = [];
	for (let index = 0; index < trimmed.length; index += 1) {
		const char = trimmed[index];
		if (char === "{" || char === "[") starts.push(index);
	}
	for (const start of starts) {
		let depth = 0;
		let inString = false;
		let escaped = false;
		for (let index = start; index < trimmed.length; index += 1) {
			const char = trimmed[index];
			if (inString) {
				if (escaped) {
					escaped = false;
					continue;
				}
				if (char === "\\") {
					escaped = true;
					continue;
				}
				if (char === "\"") {
					inString = false;
				}
				continue;
			}
			if (char === "\"") {
				inString = true;
				continue;
			}
			if (char === "{" || char === "[") depth += 1;
			if (char === "}" || char === "]") {
				depth -= 1;
				if (depth === 0) {
					try {
						return JSON.parse(trimmed.slice(start, index + 1));
					} catch {
						break;
					}
				}
			}
		}
	}
	return null;
}

function collectJsonValues(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap((item) => collectJsonValues(item));
	if (!isRecord(value)) return [];
	return Object.values(value).flatMap((item) => collectJsonValues(item));
}

function pickJsonField(record: JsonLikeRecord, keys: string[]): string {
	for (const key of keys) {
		const value = record[key];
		const direct = asTrimmedString(value);
		if (direct) return direct;
		if (Array.isArray(value)) {
			const items = value.map((item) => asTrimmedString(item)).filter(Boolean);
			if (items.length) return items.join("、");
		}
	}
	return "";
}

function pickJsonList(record: JsonLikeRecord, keys: string[]): string[] {
	for (const key of keys) {
		const value = record[key];
		if (Array.isArray(value)) {
			const items = value.map((item) => asTrimmedString(item)).filter(Boolean);
			if (items.length) return uniqStrings(items, 6);
		}
		const direct = asTrimmedString(value);
		if (direct) {
			return uniqStrings(
				direct
					.split(/[、,，;；/]/)
					.map((item) => item.trim())
					.filter(Boolean),
				6,
			);
		}
	}
	return [];
}

function inferKeywordsFromText(text: string): string[] {
	const tokens = tokenizeForRetrieval(text);
	return uniqStrings(tokens.filter((token) => token.length >= 2), 12);
}

function summarizeJsonPrecedent(input: {
	sourcePath: string;
	sourceName: string;
	text: string;
	record: JsonLikeRecord;
}): StoryboardPrecedentSummary {
	const title =
		pickJsonField(input.record, ["title", "name", "bookTitle", "项目", "标题", "书名"]) ||
		input.sourceName;
	const synopsis = pickJsonField(input.record, [
		"summary",
		"synopsis",
		"description",
		"简介",
		"内容简介",
		"storySummary",
	]);
	const theme = pickJsonField(input.record, ["theme", "themes", "主题", "核心主题", "母题"]);
	const tone = pickJsonField(input.record, ["tone", "mood", "语气", "风格基调"]);
	const arc = pickJsonField(input.record, ["arc", "storyArc", "角色弧光", "叙事弧线"]);
	const pacing = pickJsonField(input.record, ["pacing", "节奏", "rhythm"]);
	const shotPatterns = pickJsonList(input.record, [
		"shotPatterns",
		"shot_pattern",
		"镜头模式",
		"cameraPatterns",
	]);
	const antiPatterns = pickJsonList(input.record, [
		"antiPatterns",
		"anti_patterns",
		"禁忌",
		"avoid",
		"负面案例",
	]);
	const collectedValues = collectJsonValues(input.record).join(" ");
	const keywords = inferKeywordsFromText(
		[title, synopsis, theme, tone, arc, pacing, collectedValues].filter(Boolean).join(" "),
	);
	return {
		sourcePath: input.sourcePath,
		sourceName: input.sourceName,
		title: clipText(title, 80) || input.sourceName,
		kind: "creative_process_json",
		...(synopsis ? { synopsis: clipText(synopsis, 180) } : null),
		...(theme ? { theme: clipText(theme, 80) } : null),
		...(tone ? { tone: clipText(tone, 80) } : null),
		...(arc ? { arc: clipText(arc, 80) } : null),
		...(pacing ? { pacing: clipText(pacing, 60) } : null),
		shotPatterns,
		antiPatterns,
		keywords,
		evidence: uniqStrings(
			[
				theme ? "json.theme" : "",
				tone ? "json.tone" : "",
				arc ? "json.arc" : "",
				pacing ? "json.pacing" : "",
				shotPatterns.length ? "json.shotPatterns" : "",
				antiPatterns.length ? "json.antiPatterns" : "",
			].filter(Boolean),
			8,
		),
	};
}

function cleanNoteTitle(line: string, sourceName: string): string {
	const normalized = line
		.replace(/^[『《【\[]+/, "")
		.replace(/[』》】\]]+$/g, "")
		.replace(/^title\s*[:：]/i, "")
		.trim();
	return clipText(normalized || sourceName, 80);
}

function pickLabeledParagraph(lines: string[], labels: string[]): string {
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!labels.some((label) => line.includes(label))) continue;
		const inline = sanitizeNoteParagraph(line);
		if (inline && !isBoilerplateNoteText(inline) && !isMetaOpinionParagraph(inline)) return inline;
		if (index + 1 < lines.length) {
			const next = sanitizeNoteParagraph(lines[index + 1] || "");
			if (next && !isBoilerplateNoteText(next) && !isMetaOpinionParagraph(next)) return next;
		}
	}
	return "";
}

function pickFirstMeaningfulParagraph(lines: string[], startIndex: number): string {
	for (let index = startIndex; index < lines.length; index += 1) {
		const line = sanitizeNoteParagraph(lines[index] || "");
		if (/[：:]$/.test(line)) continue;
		if (isBoilerplateNoteText(line)) continue;
		if (isMetaOpinionParagraph(line)) continue;
		return clipText(line, 180);
	}
	return "";
}

function inferToneFromText(text: string): string {
	const toneRules: Array<{ label: string; terms: string[] }> = [
		{ label: "冷峻压迫", terms: ["残酷", "压抑", "黑暗", "阴森", "血", "死", "恐惧"] },
		{ label: "诡异民俗", terms: ["道士", "法术", "祭", "妖", "尸", "祠堂", "怪"] },
		{ label: "野心偏执", terms: ["执念", "目标", "利益", "算计", "不择手段", "野心"] },
		{ label: "热血升级", terms: ["战", "升级", "突破", "天才", "修炼", "胜"] },
	];
	let bestLabel = "";
	let bestCount = 0;
	for (const rule of toneRules) {
		const count = rule.terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
		if (count > bestCount) {
			bestCount = count;
			bestLabel = rule.label;
		}
	}
	return bestLabel;
}

function inferArcFromText(text: string): string {
	const arcRules: Array<{ label: string; terms: string[] }> = [
		{ label: "弱势开局后持续升级", terms: ["凡人", "贫", "弱", "修炼", "成长", "翻身"] },
		{ label: "目标驱动的黑暗攀升", terms: ["执念", "目标", "利益", "算计", "长生", "不择手段"] },
		{ label: "异变降临后的生存调查", terms: ["异", "怪", "尸", "夜", "追查", "发现"] },
	];
	let bestLabel = "";
	let bestCount = 0;
	for (const rule of arcRules) {
		const count = rule.terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
		if (count > bestCount) {
			bestCount = count;
			bestLabel = rule.label;
		}
	}
	return bestLabel;
}

function inferPacingFromText(text: string): string {
	if (text.includes("前慢后快")) return "前慢后快";
	if (text.includes("持续升级") || text.includes("层层升级")) return "冲突持续升级";
	if (text.includes("快节奏") || text.includes("节奏快")) return "快节奏推进";
	if (text.includes("慢热")) return "慢热铺垫后抬升";
	return "";
}

function summarizeTextPrecedent(input: {
	sourcePath: string;
	sourceName: string;
	text: string;
}): StoryboardPrecedentSummary {
	const rawLines = splitParagraphs(input.text);
	const lines = normalizeNoteParagraphs(input.text);
	const titleLine = lines[0] || sanitizeNoteParagraph(rawLines[0] || "") || input.sourceName;
	const labeledSynopsis = pickLabeledParagraph(rawLines, NOTE_STORY_LABELS);
	const storySynopsisCandidate = labeledSynopsis || pickFirstMeaningfulParagraph(lines, 1);
	const synopsis =
		(labeledSynopsis && !isMetaOpinionParagraph(labeledSynopsis)) ||
		isLikelyStoryParagraph(storySynopsisCandidate)
			? storySynopsisCandidate
			: "";
	const metaThemeCandidate = pickLabeledParagraph(rawLines, ["主题", "母题", "核心卖点"]);
	const rawThemeCandidate = metaThemeCandidate || synopsis;
	const tone = inferToneFromText(input.text);
	const arc = inferArcFromText(input.text);
	const pacing = inferPacingFromText(input.text);
	const antiPatterns = uniqStrings(
		[
			input.text.includes("作者") || input.text.includes("后记") ? "排除作者自述与章节外说明" : "",
			input.text.includes("评论") || input.text.includes("扫书报告") || input.text.includes("书评")
				? "排除读者评论与主观感想，优先保留剧情事实"
				: "",
			input.text.includes("http") || input.text.includes("www.") || input.text.includes("E-mail")
				? "排除站点水印、链接与平台导流文本"
				: "",
		].filter(Boolean),
		4,
	);
	const shotPatterns = uniqStrings(
		[
			input.text.includes("第一章") || input.text.includes("第一卷")
				? "先抓开场冲突与世界异常，再逐镜推进人物动作后果"
				: "",
			input.text.includes("对话") || input.text.includes("说道") || input.text.includes("开口")
				? "遇到对白段时先落角色动作和对峙关系，再补字幕/台词"
				: "",
			input.text.includes("夜") || input.text.includes("火") || input.text.includes("光")
				? "保留时间段与主光方向，避免镜头间跳光"
				: "",
		].filter(Boolean),
		4,
	);
	const keywords = inferKeywordsFromText(
		[pickLabeledParagraph(rawLines, ["关键词"]), synopsis, rawThemeCandidate, tone, arc, titleLine]
			.filter(Boolean)
			.join(" "),
	);
	const theme = clipText(
		rawThemeCandidate && !isMetaOpinionParagraph(rawThemeCandidate)
			? rawThemeCandidate
			: keywords.slice(0, 4).join("、") || cleanNoteTitle(titleLine, input.sourceName),
		80,
	);
	const evidence = uniqStrings(
		[
			pickLabeledParagraph(lines, ["内容简介", "简介"]) ? "text.synopsis" : "",
			tone ? "text.tone" : "",
			arc ? "text.arc" : "",
			pacing ? "text.pacing" : "",
			shotPatterns.length ? "text.shotPatterns" : "",
			antiPatterns.length ? "text.antiPatterns" : "",
		].filter(Boolean),
		8,
	);
	return {
		sourcePath: input.sourcePath,
		sourceName: input.sourceName,
		title: cleanNoteTitle(titleLine, input.sourceName),
		kind: "creative_process_text",
		...(synopsis ? { synopsis } : null),
		...(theme ? { theme } : null),
		...(tone ? { tone } : null),
		...(arc ? { arc } : null),
		...(pacing ? { pacing } : null),
		shotPatterns,
		antiPatterns,
		keywords,
		evidence,
	};
}

export function summarizeStoryboardPrecedentContent(input: {
	sourcePath: string;
	sourceName: string;
	text: string;
}): StoryboardPrecedentSummary | null {
	const normalizedText = input.text.trim();
	if (!normalizedText) return null;
	const parsed = extractJsonBlock(normalizedText);
	if (isRecord(parsed)) {
		return summarizeJsonPrecedent({
			sourcePath: input.sourcePath,
			sourceName: input.sourceName,
			text: normalizedText,
			record: parsed,
		});
	}
	return summarizeTextPrecedent({
		sourcePath: input.sourcePath,
		sourceName: input.sourceName,
		text: normalizedText,
	});
}

async function findNotesDirectory(): Promise<string | null> {
	for (const candidate of NOTES_DIR_CANDIDATES) {
		try {
			const stat = await fs.stat(candidate);
			if (stat.isDirectory()) return candidate;
		} catch {
			continue;
		}
	}
	return null;
}

async function buildNotesIndex(): Promise<CachedIndex> {
	const notesDir = await findNotesDirectory();
	if (!notesDir) {
		return { key: "missing", items: [] };
	}
	const dirEntries = await fs.readdir(notesDir, { withFileTypes: true });
	const files = dirEntries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
	const items: StoryboardPrecedentSummary[] = [];
	for (const fileName of files) {
		const sourcePath = path.join(notesDir, fileName);
		try {
			const buffer = await fs.readFile(sourcePath);
			const decoded = decodeNoteBuffer(buffer);
			const summary = summarizeStoryboardPrecedentContent({
				sourcePath,
				sourceName: fileName,
				text: decoded,
			});
			if (summary) items.push(summary);
		} catch {
			continue;
		}
	}
	return {
		key: `${notesDir}:${files.join("|")}`,
		items,
	};
}

export async function loadStoryboardPrecedentLibrary(): Promise<StoryboardPrecedentSummary[]> {
	if (!cachedIndexPromise) {
		cachedIndexPromise = buildNotesIndex();
	}
	const nextIndex = await buildNotesIndex();
	const cachedIndex = await cachedIndexPromise;
	if (cachedIndex.key !== nextIndex.key) {
		cachedIndexPromise = Promise.resolve(nextIndex);
		return nextIndex.items;
	}
	return cachedIndex.items;
}

export function retrieveRelevantStoryboardPrecedents(input: {
	summaries: StoryboardPrecedentSummary[];
	queryText: string;
	limit?: number;
}): StoryboardPrecedentMatch[] {
	const queryTokens = tokenizeForRetrieval(input.queryText);
	if (!queryTokens.length) return [];
	const limit = Math.max(1, Math.min(6, Math.trunc(input.limit ?? 2)));
	return input.summaries
		.map((summary) => {
			const corpus = [
				summary.title,
				summary.synopsis || "",
				summary.theme || "",
				summary.tone || "",
				summary.arc || "",
				summary.pacing || "",
				summary.shotPatterns.join(" "),
				summary.antiPatterns.join(" "),
				summary.keywords.join(" "),
			].join(" ");
			const corpusTokens = tokenizeForRetrieval(corpus);
			const overlap = countOverlaps(queryTokens, corpusTokens);
			const keywordBoost = countOverlaps(queryTokens, summary.keywords);
			const score = overlap + keywordBoost * 2;
			const reasons = uniqStrings(
				[
					countOverlaps(queryTokens, tokenizeForRetrieval(summary.title)) > 0 ? "title_overlap" : "",
					countOverlaps(queryTokens, tokenizeForRetrieval(summary.theme || "")) > 0 ? "theme_overlap" : "",
					countOverlaps(queryTokens, tokenizeForRetrieval(summary.tone || "")) > 0 ? "tone_overlap" : "",
					keywordBoost > 0 ? "keyword_overlap" : "",
				].filter(Boolean),
				4,
			);
			return { summary, score, reasons };
		})
		.filter((item) => item.score > 0)
		.sort((left, right) => right.score - left.score || left.summary.sourceName.localeCompare(right.summary.sourceName))
		.slice(0, limit);
}

export function buildStoryboardPrecedentPromptBlock(matches: StoryboardPrecedentMatch[]): string {
	if (!matches.length) return "";
	const lines = [
		"【本地 precedent 摘要库（来自 assets/notes，已压缩为结构化先例，不得照抄原文）】",
		"只把这些摘要当作镜头组织与审美取舍的参考，不要把 note 原文整段回填进最终输出。",
	];
	for (const match of matches) {
		const summary = match.summary;
		lines.push(
			[
				`- 来源：${summary.title}`,
				summary.theme ? `主题=${summary.theme}` : "",
				summary.tone ? `语气=${summary.tone}` : "",
				summary.arc ? `弧线=${summary.arc}` : "",
				summary.pacing ? `节奏=${summary.pacing}` : "",
				summary.shotPatterns.length ? `镜头组织=${summary.shotPatterns.join("；")}` : "",
				summary.antiPatterns.length ? `避免=${summary.antiPatterns.join("；")}` : "",
				summary.synopsis ? `摘要=${summary.synopsis}` : "",
				match.reasons.length ? `命中原因=${match.reasons.join("、")}` : "",
			]
				.filter(Boolean)
				.join(" | "),
		);
	}
	return lines.join("\n");
}
