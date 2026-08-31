// apps/hono-api/src/modules/task/host-stream-sanitizer.ts
// 宿主协议 v1.1 流内文本清洗器：对 content delta 流做跨 chunk 剥离，产出干净文本 + 结构化卡。
// 背景：模型正文自带 ```choices / ```tc-card 围栏 JSON（native 前端靠客户端剥离 + 服务端
// block 清洗才不显示），OpenAI facade 若直通会把原始 JSON 泄漏进宿主聊天气泡。
// 算法语义对齐 native（apps/agents-cli content-blocks-build.ts extractChoicesCardBlocks /
// apps/web choicesCard.ts，只参考语义不跨包 import），流式化改造：
// - 非卡片文本零延迟透传；只有「行首」出现疑似卡片起点才扣留后续文本（保守判定，
//   正文行中的普通 { 不触发缓冲）。
// - 围栏卡以闭合 ``` 为界；裸 JSON（漏围栏的行首 {"question"...）用括号配平试解。
// - 闭合 + 解析成功 → 产 card 丢弃原文；解析失败 → 原文吐回（暴露问题而不是吞掉）；
//   到 flush 仍未闭合 → 原文原样吐回（宁漏勿吞正文）。
// - 缓冲字节上限 + JSON 深度上限防炸：超限即放弃识别、全部吐回。
// 另剥离「工具调用写成文本」的 antml XML（见 TOOL_XML_MARKERS），同属「内核中间态不该进宿主气泡」。

export type HostUiCardKind = "choices" | "tc-card";

export type HostUiCard = {
	kind: HostUiCardKind;
	payload: unknown;
	raw: string;
};

/**
 * 已注册富卡 name。**权威源 = agents-cli src/types/content-blocks.ts 的
 * KNOWN_DATA_BLOCK_NAMES**（那里列了全部需同步的副本）；此处按本文件既有约定
 * 「只参考语义不跨包 import」复制一份，增删卡名两边必须一起改。
 * 用途：漏围栏的裸 JSON 兜底识别时收紧判定——只有已注册 name 才当卡片吃掉，
 * 未注册的 {"name":...} 原样当正文吐回（可见可排查，不静默吞）。
 */
const KNOWN_TC_CARD_NAMES = new Set([
	"character_cards",
	"scene_list",
	"artifact",
	"action_banner",
	"source_contract",
	"generation_task",
	"choices",
	"role_note",
]);

export type SanitizeFeedResult = {
	text: string;
	cards: HostUiCard[];
};

export type ChoicesCardPayload = {
	question?: string;
	options: Array<{
		label: string;
		description?: string;
		value?: string;
		metadata?: {
			kind: "sba_branch";
			version: 1;
			selectionEventId: string;
			branchNodeId: string;
			sbaPath: string;
			basisFingerprint: string;
		};
	}>;
	sba?: boolean;
};

/** 扣留缓冲上限：疑似卡片超过此长度仍未闭合 → 放弃识别原样吐回（防吞正文/防内存涨）。 */
const MAX_CARD_BUFFER = 20_000;
/** 裸 JSON 括号配平的嵌套深度上限（防恶意/病态输入炸扫描）。 */
const MAX_JSON_DEPTH = 64;

type CandidateType =
	| "fence-choices"
	| "fence-tc-card"
	| "rawjson-choices"
	| "rawjson-choices-array"
	| "rawjson-tccard"
	| "tool-xml-tag"
	| "tool-xml-block";

/** 行首才认的卡片起点（保守判定：正文行中的普通 { / ``` 不触发缓冲）。 */
const MARKERS: Array<{ prefix: string; type: CandidateType }> = [
	{ prefix: "```choices", type: "fence-choices" },
	{ prefix: "```tc-card", type: "fence-tc-card" },
	{ prefix: '{"question"', type: "rawjson-choices" },
	// 漏围栏兜底：模型偶尔直接吐裸卡 JSON（或围栏被 ```json 等写错），行首 {"name"
	// 命中后按已注册 name 收紧判定，避免 artifact 之类原始 JSON 泄漏进宿主气泡。
	{ prefix: '{"name"', type: "rawjson-tccard" },
	// 漏围栏又漏 question 的顶层裸数组（2026-07-29 实测整坨 [{"label":…}] 裸显）。
	// 行首 `[{` 只是起手，真正收口在 isBareOptionsArray（每项都得是 choices 合同对象），
	// 故正文里的普通 JSON 数组不会被吃掉。`[` 与 `[ {` 两种写法都认。
	{ prefix: "[{", type: "rawjson-choices-array" },
	{ prefix: "[ {", type: "rawjson-choices-array" },
	{ prefix: "[\n", type: "rawjson-choices-array" },
];

/**
 * 「工具调用写成文本」格式滑落（判据与 agents-cli agent-loop.ts 的
 * textContainsTextualToolInvocation 同源）：opus 偶发在正文里手写 antml XML 而非发原生 tool_use。
 *
 * 为什么只有 facade 需要剥：native 前端天生免疫——收尾时拿服务端 canonical 的**最后一轮**文本
 * 整体覆盖气泡（apps/web AiChatDialog.tsx `content: reply`，reply ← resp.text），被 agent-loop
 * 纠正层作废的那一轮（`turn -= 1` 重跑）连同 XML 一起被冲掉，用户根本看不见。但 OpenAI
 * chat.completion.chunk 流是纯 append-only 的，facade 只搬了 delta 通道、丢掉了 result.text 那条
 * canonical 真值通道（见 public-openai-compat.ts 的 result 分支只捞 assets），「覆盖」语义过不来
 * → 作废轮次的 XML 在宿主气泡里永久可见（2026-07-16 Tanva 实测：整坨 flow_patch XML 露给用户）。
 *
 * 判定无歧义：真的 flow_patch 走 tool 事件通道、不经正文，故 content 里出现这些标记一律是滑落。
 * 与卡片标记不同，这几个**不限行首**——模型常把 XML 直接接在正文句尾。
 */
/** 模型偶尔带命名空间前缀写（<antml:invoke …>），两种形态都认。 */
const TOOL_XML_NS_PREFIXES = ["", "antml:"] as const;

const TOOL_XML_MARKERS: Array<{ prefix: string; type: "tool-xml-tag" | "tool-xml-block" }> =
	TOOL_XML_NS_PREFIXES.flatMap((ns) => [
		// 块：连 <parameter> 体一起吃到配对的 </invoke>。带尾空格是为对齐内核正则的 `invoke\s+name`，
		// 顺带避免误伤正文里的 <invoked> 之类词。
		{ prefix: `<${ns}invoke `, type: "tool-xml-block" as const },
		// 裸标签：<function_calls> 壳内只包 invoke、本身无正文；</invoke> 孤儿闭合同理。逐个丢即可。
		{ prefix: `<${ns}function_calls>`, type: "tool-xml-tag" as const },
		{ prefix: `</${ns}function_calls>`, type: "tool-xml-tag" as const },
		{ prefix: `</${ns}invoke>`, type: "tool-xml-tag" as const },
	]);

/** tool-xml-block 的闭合标记（取最先出现的一个）。 */
const TOOL_XML_CLOSE_TAGS = TOOL_XML_NS_PREFIXES.map((ns) => `</${ns}invoke>`);

/**
 * 括号配平找 JSON 值结束位（字符串/转义感知）。对象 `{}` 与数组 `[]` 都认（顶层裸数组选项卡
 * 需要后者）。-1=未闭合，-2=深度超限（放弃）。
 */
function findJsonObjectEnd(text: string, start: number): number {
	let depth = 0;
	let inString = false;
	let escape = false;
	for (let i = start; i < text.length; i++) {
		const c = text[i]!;
		if (escape) {
			escape = false;
			continue;
		}
		if (c === "\\" && inString) {
			escape = true;
			continue;
		}
		if (c === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;
		if (c === "{" || c === "[") {
			depth++;
			if (depth > MAX_JSON_DEPTH) return -2;
		} else if (c === "}" || c === "]") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/**
 * 顶层裸数组当选项卡的收口判据（与 native choicesCard.ts / content-blocks-build.ts 同步）：
 * 非空，且每一项都是「带非空 label 字符串」的对象，键集合不超出 choices 合同字段。
 * 正文里合法的 JSON 数组示例（如 `[{"id":1}]`）不满足 → 不吃，原样吐回当正文。
 */
const OPTION_KEYS = new Set(["label", "description", "value", "metadata"]);
function isBareOptionsArray(value: unknown): value is Array<Record<string, unknown>> {
	if (!Array.isArray(value) || !value.length) return false;
	return value.every((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return false;
		const o = item as Record<string, unknown>;
		if (typeof o.label !== "string" || !o.label.trim()) return false;
		return Object.keys(o).every((k) => OPTION_KEYS.has(k));
	});
}

function parseSbaChoiceMetadata(value: unknown): ChoicesCardPayload["options"][number]["metadata"] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const selectionEventId = typeof record.selectionEventId === "string" ? record.selectionEventId.trim() : "";
	const branchNodeId = typeof record.branchNodeId === "string" ? record.branchNodeId.trim() : "";
	const sbaPath = typeof record.sbaPath === "string" ? record.sbaPath.trim() : "";
	const basisFingerprint = typeof record.basisFingerprint === "string" ? record.basisFingerprint.trim() : "";
	if (record.kind !== "sba_branch" || record.version !== 1 || !selectionEventId || !branchNodeId || !sbaPath || !basisFingerprint) return undefined;
	return { kind: "sba_branch", version: 1, selectionEventId, branchNodeId, sbaPath, basisFingerprint };
}

/** 与 native parseChoicesPayload 同语义：options 必须至少 1 个有效 label，[SBA] 前缀转 sba 标记。 */
export function parseChoicesPayload(jsonText: string): ChoicesCardPayload | null {
	try {
		const value = JSON.parse(jsonText) as unknown;
		// 顶层裸数组（漏围栏又漏 question）：整个数组就是 options 本身，卡片无标题。
		const parsed = (
			Array.isArray(value) ? (isBareOptionsArray(value) ? { options: value } : null) : value
		) as { question?: unknown; options?: unknown } | null;
		if (!parsed || typeof parsed !== "object") return null;
		const rawOpts = Array.isArray(parsed.options)
			? (parsed.options as Array<Record<string, unknown>>)
			: [];
		const options = rawOpts
			.filter((o) => o && typeof o.label === "string" && (o.label as string).trim())
			.map((o) => ({
				label: (o.label as string).trim(),
				...(typeof o.description === "string" && (o.description as string).trim()
					? { description: (o.description as string).trim() }
					: {}),
				...(typeof o.value === "string" && o.value.trim()
					? { value: o.value.trim() }
					: {}),
				...(parseSbaChoiceMetadata(o.metadata)
					? { metadata: parseSbaChoiceMetadata(o.metadata) }
					: {}),
			}));
		if (!options.length) return null;
		const rawQuestion =
			typeof parsed.question === "string" ? (parsed.question as string).trim() : "";
		const sba = rawQuestion.startsWith("[SBA]");
		const question = sba ? rawQuestion.slice(5).trim() : rawQuestion;
		return {
			...(question ? { question } : {}),
			options,
			...(sba ? { sba: true } : {}),
		};
	} catch {
		return null;
	}
}

function parseTcCardBody(body: string): { name: string; payload: unknown } | null {
	try {
		const parsed = JSON.parse(body.trim()) as { name?: unknown; payload?: unknown };
		const name = String(parsed?.name || "").trim();
		if (!name || typeof parsed?.payload !== "object" || parsed.payload === null) return null;
		return { name, payload: parsed.payload };
	} catch {
		return null;
	}
}

/** choices 卡降级为纯文本（宿主未声明 choices UI 时不丢信息）。 */
export function choicesCardToText(payload: ChoicesCardPayload): string {
	const lines: string[] = [];
	if (payload.question) lines.push(payload.question);
	payload.options.forEach((o, i) => {
		lines.push(`${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ""}`);
	});
	return lines.join("\n");
}

/**
 * tc-card 富卡降级为纯文本（宿主未在 manifest.ui 声明该卡时不丢信息）。
 * 语义对齐 apps/web DataCardViews 各卡的可读信息：文档/点评摊平成 markdown 正文，
 * 列表类摊平成「名称：摘要」列点，横幅摊平成标题+说明。未注册 name 返回 ""（不下发）。
 */
export function tcCardToText(name: string, payload: unknown): string {
	const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
	const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
	const items = (v: unknown): Array<Record<string, unknown>> =>
		Array.isArray(v) ? (v.filter((i) => i && typeof i === "object") as Array<Record<string, unknown>>) : [];
	const lines: string[] = [];
	switch (name) {
		case "artifact": {
			const title = str(p.title);
			const body = str(p.markdown);
			if (!title && !body) return "";
			if (title) lines.push(`## ${title}`);
			if (str(p.summary)) lines.push(str(p.summary));
			if (body) lines.push(body);
			break;
		}
		case "role_note": {
			const body = str(p.markdown);
			const who = str(p.roleName);
			if (!body) return "";
			lines.push(`**${who || "点评"}${str(p.label) ? `（${str(p.label)}）` : ""}**`);
			lines.push(body);
			break;
		}
		case "character_cards":
		case "scene_list": {
			const list = items(p.items).filter((i) => str(i.name));
			if (!list.length) return "";
			lines.push(str(p.title) || (name === "character_cards" ? "角色设计" : "场景列表"));
			list.forEach((i, idx) => {
				const desc = str(i.description) || str(i.summary);
				lines.push(`${idx + 1}. ${str(i.name)}${desc ? ` — ${desc}` : ""}`);
			});
			break;
		}
		case "action_banner": {
			const title = str(p.title);
			if (!title) return "";
			lines.push(`**${title}**`);
			if (str(p.description)) lines.push(str(p.description));
			break;
		}
		case "source_contract": {
			const source = str(p.source);
			const scope = str(p.scope);
			const mode = str(p.mode);
			if (!source || !scope || !mode) return "";
			lines.push(str(p.title) || "本轮创作范围");
			lines.push(`来源：${source}`);
			lines.push(`范围：${scope}`);
			lines.push(`方式：${mode}`);
			for (const [label, key] of [["已确认", "confirmed"], ["推断", "assumptions"], ["待确认", "unresolved"]] as const) {
				const values = Array.isArray(p[key]) ? p[key].filter((v): v is string => typeof v === "string" && v.trim()).map((v) => v.trim()) : [];
				if (values.length) lines.push(`${label}：\n${values.map((v, i) => `${i + 1}. ${v}`).join("\n")}`);
			}
			break;
		}
		case "generation_task": {
			const title = str(p.title);
			const status = str(p.status);
			if (!title || !status) return "";
			lines.push(`**${title}**（${status}）`);
			if (str(p.summary)) lines.push(str(p.summary));
			if (str(p.model)) lines.push(`模型：${str(p.model)}`);
			if (str(p.prompt)) lines.push(`提示词：\n${str(p.prompt)}`);
			if (str(p.failureReason)) lines.push(`失败原因：${str(p.failureReason)}`);
			break;
		}
		default:
			return ""; // 未注册卡：不下发（与 v1.1 抑制行为一致）
	}
	return lines.filter(Boolean).join("\n\n");
}

type ConsumeStep = { text?: string; card?: HostUiCard; needMore?: boolean };

export class HostStreamSanitizer {
	/** 扣留中的未处理文本（潜在卡片 + 未扫描尾部） */
	private pending = "";
	/** pending[0] 是否处于行首（用于保守的起点判定） */
	private atLineStart = true;

	feed(delta: string): SanitizeFeedResult {
		this.pending += String(delta ?? "");
		return this.drain();
	}

	/** 流结束收尾：扣留中仍未闭合的疑似卡片原文原样吐回（宁漏勿吞）。 */
	flush(): string {
		const out = this.pending;
		this.pending = "";
		this.atLineStart = true;
		return out;
	}

	private drain(): SanitizeFeedResult {
		let text = "";
		const cards: HostUiCard[] = [];
		while (this.pending) {
			const cand = this.findCandidate();
			if (!cand) {
				text += this.take(this.pending.length);
				break;
			}
			if (cand.index > 0) text += this.take(cand.index);
			if (cand.type === "partial") break; // 尾部疑似起点，等更多数据
			const step =
				cand.type === "tool-xml-tag" || cand.type === "tool-xml-block"
					? this.consumeToolXml(cand.type)
					: cand.type === "rawjson-choices" ||
						  cand.type === "rawjson-choices-array" ||
						  cand.type === "rawjson-tccard"
						? this.consumeRawJson(cand.type)
						: this.consumeFence(cand.type);
			if (step.needMore) break;
			if (step.text) text += step.text;
			if (step.card) cards.push(step.card);
		}
		return { text, cards };
	}

	/** 吐出前 n 个字符为正文。 */
	private take(n: number): string {
		const out = this.pending.slice(0, n);
		this.pending = this.pending.slice(n);
		if (out) this.atLineStart = out.endsWith("\n");
		return out;
	}

	/** 丢弃前 n 个字符（卡片原文）。 */
	private drop(n: number): void {
		const dropped = this.pending.slice(0, n);
		this.pending = this.pending.slice(n);
		if (dropped) this.atLineStart = dropped.endsWith("\n");
	}

	/** 卡片起点（限行首）与工具 XML 起点（不限行首）取更早的一个。 */
	private findCandidate(): { index: number; type: CandidateType | "partial" } | null {
		const card = this.findLineStartCandidate();
		const xml = this.findToolXmlCandidate();
		if (!card) return xml;
		if (!xml) return card;
		return xml.index < card.index ? xml : card;
	}

	/**
	 * 找最早的工具 XML 起点。不限行首（模型常把 XML 接在正文句尾），故用 indexOf 全串扫。
	 * 无整标记命中时才看尾部分片，避免把后面已成形的整标记让位给一个尾巴。
	 */
	private findToolXmlCandidate(): { index: number; type: CandidateType | "partial" } | null {
		const s = this.pending;
		let best: { index: number; type: CandidateType | "partial" } | null = null;
		for (const m of TOOL_XML_MARKERS) {
			const idx = s.indexOf(m.prefix);
			if (idx !== -1 && (!best || idx < best.index)) best = { index: idx, type: m.type };
		}
		if (best) return best;
		for (const m of TOOL_XML_MARKERS) {
			for (let len = Math.min(m.prefix.length - 1, s.length); len > 0; len--) {
				if (!s.endsWith(m.prefix.slice(0, len))) continue;
				const idx = s.length - len;
				if (!best || idx < best.index) best = { index: idx, type: "partial" };
				break;
			}
		}
		return best;
	}

	/**
	 * 找最早的疑似卡片起点。只匹配「行首」（字符串开头且 atLineStart，或紧跟 \n），
	 * 避免正文行中的普通 { / ``` 触发缓冲。partial = 尾部是某 marker 的前缀（跨 chunk 分片）。
	 */
	private findLineStartCandidate(): { index: number; type: CandidateType | "partial" } | null {
		const s = this.pending;
		let p: number;
		if (this.atLineStart) {
			p = 0;
		} else {
			const nl = s.indexOf("\n");
			if (nl === -1) return null;
			p = nl + 1;
		}
		while (p < s.length) {
			const rest = s.slice(p);
			for (const m of MARKERS) {
				if (rest.startsWith(m.prefix)) return { index: p, type: m.type };
			}
			for (const m of MARKERS) {
				if (rest.length < m.prefix.length && m.prefix.startsWith(rest)) {
					// rest 必到字符串末尾（slice 到底），只可能是尾部分片
					return { index: p, type: "partial" };
				}
			}
			const nl = s.indexOf("\n", p);
			if (nl === -1) return null;
			p = nl + 1;
		}
		return null;
	}

	/**
	 * 剥离写成文本的工具调用 XML（见 TOOL_XML_MARKERS）。不产 card——这是内核中间态，
	 * 对宿主没有任何信息价值（真调用走 tool 事件通道），直接丢弃、不降级不吐回。
	 */
	private consumeToolXml(type: "tool-xml-tag" | "tool-xml-block"): ConsumeStep {
		const s = this.pending;
		if (type === "tool-xml-tag") {
			const tag = TOOL_XML_MARKERS.find((m) => m.type === type && s.startsWith(m.prefix));
			if (!tag) return { text: this.take(1) }; // 不可达（findCandidate 已确认前缀）；保底推进防死循环
			this.drop(tag.prefix.length);
			return {};
		}
		let closeEnd = -1;
		for (const t of TOOL_XML_CLOSE_TAGS) {
			const i = s.indexOf(t);
			if (i !== -1 && (closeEnd === -1 || i + t.length < closeEnd)) closeEnd = i + t.length;
		}
		if (closeEnd === -1) {
			// 未闭合 → 等后续 chunk。超上限即放弃识别、原样吐回（对齐本文件宁漏勿吞）：
			// 未闭合意味着这一轮在 XML 中途就断了，而纠正轮的正文会顺着**同一条** content 流
			// 续在后面 —— 若在这里改成丢弃，就会把后面那段有用的回复一起吞掉。
			return s.length > MAX_CARD_BUFFER ? { text: this.take(s.length) } : { needMore: true };
		}
		this.drop(closeEnd);
		return {};
	}

	private consumeFence(type: "fence-choices" | "fence-tc-card"): ConsumeStep {
		const s = this.pending;
		const tag = type === "fence-choices" ? "```choices" : "```tc-card";
		let i = tag.length;
		while (i < s.length && (s[i] === " " || s[i] === "\t")) i++;
		if (i >= s.length) {
			return s.length > MAX_CARD_BUFFER ? { text: this.take(s.length) } : { needMore: true };
		}
		if (s[i] !== "\n") {
			// ```choicesXxx —— 不是本协议围栏，吐回 marker 继续扫描其余文本
			return { text: this.take(i) };
		}
		const bodyStart = i + 1;
		// 闭合位判定按围栏类型分别对齐内核正则（apps/agents-cli content-blocks-build.ts），
		// 两者语义本就不同，统一处理会与内核分叉：
		// - tc-card（TC_CARD_FENCE_RE `\n([\s\S]*?)\n\`\`\``）：闭合前换行**必需** → 只认行首 ```。
		//   不能用裸 indexOf("```")：artifact 卡的 markdown 正文合法地含代码围栏，其 ``` 会把
		//   body 提前截断→JSON.parse 失败→原始卡 JSON 当正文吐回（宿主气泡泄漏 {"name":"artifact"...}）。
		//   单行 JSON 里的 \n 是转义两字符、不是真换行，故 "\n```" 不可能落在 JSON 字符串内。
		// - choices（CHOICES_FENCE_RE `\n([\s\S]*?)\n?\`\`\``）：闭合前换行**可选** → 保持裸
		//   indexOf，否则 `{...}\`\`\`` 这种同行收尾内核认、这里不认，会退化成原文泄漏。
		const close =
			type === "fence-tc-card"
				? (() => {
						const nl = s.indexOf("\n```", bodyStart - 1);
						return nl === -1 ? -1 : nl + 1;
					})()
				: s.indexOf("```", bodyStart);
		if (close === -1) {
			return s.length > MAX_CARD_BUFFER ? { text: this.take(s.length) } : { needMore: true };
		}
		let end = close + 3;
		if (s[end] === "\n") end += 1;
		let body = s.slice(bodyStart, close);
		if (body.endsWith("\n")) body = body.slice(0, -1);
		const raw = s.slice(0, end);
		if (type === "fence-choices") {
			const payload = parseChoicesPayload(body);
			if (!payload) return { text: this.take(end) }; // 解析失败原样吐回（暴露问题）
			this.drop(end);
			return { card: { kind: "choices", payload, raw } };
		}
		const parsed = parseTcCardBody(body);
		if (!parsed) return { text: this.take(end) };
		this.drop(end);
		return { card: { kind: "tc-card", payload: parsed, raw } };
	}

	private consumeRawJson(
		type: "rawjson-choices" | "rawjson-choices-array" | "rawjson-tccard",
	): ConsumeStep {
		const s = this.pending;
		const end = findJsonObjectEnd(s, 0);
		if (end === -2) return { text: this.take(s.length) }; // 深度超限：放弃识别全吐回
		if (end === -1) {
			return s.length > MAX_CARD_BUFFER ? { text: this.take(s.length) } : { needMore: true };
		}
		const jsonText = s.slice(0, end + 1);
		if (type === "rawjson-tccard") {
			const parsed = parseTcCardBody(jsonText);
			// 未注册 name 不吃（可能是正文里合法的 {"name":...} JSON 示例）→ 原样吐回
			if (!parsed || !KNOWN_TC_CARD_NAMES.has(parsed.name)) return { text: this.take(end + 1) };
			this.drop(end + 1);
			return { card: { kind: "tc-card", payload: parsed, raw: jsonText } };
		}
		const payload = parseChoicesPayload(jsonText);
		if (!payload) return { text: this.take(end + 1) }; // 配平但非有效 choices → 吐回
		this.drop(end + 1);
		return { card: { kind: "choices", payload, raw: jsonText } };
	}
}
