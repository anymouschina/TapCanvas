const NAMED_HTML_ENTITY_MAP: Record<string, string> = {
	amp: "&",
	apos: "'",
	gt: ">",
	lt: "<",
	nbsp: " ",
	quot: '"',
};

const INLINE_NOISE_PATTERNS = [
	/[，,\s]*精彩小说无弹窗免费阅读[！!。.]*/giu,
	/[，,\s]*最新章节[^\n]{0,24}免费阅读[！!。.]*/giu,
	/[，,\s]*手机用户请[^\n]{0,32}阅读[！!。.]*/giu,
	/手机端阅读[:：]?\s*[a-z0-9./_-]+[^\n]{0,20}/giu,
	/更多更好资源[。.！!、]*?/giu,
	/[（(][^()\n]{0,64}(?:xiaoshuo\.[a-z]{2,8}|狂[_\s]*[人亻][_\s]*[小哓晓][_\s]*[说說説][_\s]*[网網])[^()\n]{0,64}[）)]/giu,
	/狂[_\s]*[人亻][_\s]*[小哓晓][_\s]*[说說説][_\s]*[网網](?:[-_\s]*[a-z0-9./_-]*)?/giu,
	/[a-z0-9._-]*xiaoshuo\.[a-z]{2,8}[a-z0-9._/-]*/giu,
	/[，,\s]*请收藏(?:本站|本书)?[^\n]{0,24}/giu,
];

const WHOLE_LINE_NOISE_PATTERNS = [
	/^https?:\/\/\S+$/iu,
	/^www\.[a-z0-9.-]+$/iu,
	/^(?:wap|www|com|cn|net|org|io|xs|txt|shu|book|read|xiaoshuo|novel)[a-z0-9.-]*$/iu,
	/^狂[人亻][小哓晓][说說説][网網]$/u,
];

function decodeHtmlEntityToken(token: string): string | null {
	const trimmed = String(token || "").trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("#x") || trimmed.startsWith("#X")) {
		const codePoint = Number.parseInt(trimmed.slice(2), 16);
		return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : null;
	}
	if (trimmed.startsWith("#")) {
		const codePoint = Number.parseInt(trimmed.slice(1), 10);
		return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : null;
	}
	return NAMED_HTML_ENTITY_MAP[trimmed.toLowerCase()] ?? null;
}

export function decodeHtmlEntities(value: string): string {
	return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (match, token: string) => {
		const decoded = decodeHtmlEntityToken(token);
		return decoded ?? match;
	});
}

function stripInlineNovelNoise(value: string): string {
	let next = value;
	for (const pattern of INLINE_NOISE_PATTERNS) {
		next = next.replace(pattern, "");
	}
	return next;
}

function isWholeLineNoise(value: string): boolean {
	const compact = value.replace(/\s+/g, "").trim();
	if (!compact) return true;
	if (WHOLE_LINE_NOISE_PATTERNS.some((pattern) => pattern.test(compact))) return true;
	if (/^[\p{Script=Han}]+$/u.test(compact) && compact.length <= 3) return true;
	return /^[a-z0-9._/-]{1,12}$/iu.test(compact);
}

export function sanitizeImportedBookText(value: string): string {
	const decoded = decodeHtmlEntities(String(value || "")).replace(/\u00a0/g, " ");
	const cleanedLines = decoded
		.replace(/\r/g, "\n")
		.split(/\n+/)
		.map((line) => stripInlineNovelNoise(line).replace(/[ \t]+/g, " ").trim())
		.filter((line) => {
			if (!line) return false;
			return !isWholeLineNoise(line);
		});
	return cleanedLines.join("\n").trim();
}

function normalizeSingleLineText(value: string): string {
	return stripInlineNovelNoise(decodeHtmlEntities(String(value || "")))
		.replace(/\u00a0/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function sanitizeShotTitleText(value: string | null | undefined): string | undefined {
	const raw = String(value || "");
	const normalized = normalizeSingleLineText(raw);
	if (!normalized) return undefined;
	if (/&(#x?[0-9a-f]+|[a-z]+);/iu.test(raw) && normalized.length <= 3) return undefined;
	if (isWholeLineNoise(normalized)) return undefined;
	return normalized;
}

export function sanitizeShotSummaryText(value: string | null | undefined): string | undefined {
	const raw = String(value || "");
	const normalized = normalizeSingleLineText(raw);
	if (!normalized) return undefined;
	if (/&(#x?[0-9a-f]+|[a-z]+);/iu.test(raw) && normalized.length <= 8) return undefined;
	if (isWholeLineNoise(normalized)) return undefined;
	return normalized;
}

export function sanitizeBookFieldText(value: string | null | undefined): string | null {
	const normalized = normalizeSingleLineText(String(value || ""));
	return normalized || null;
}
