// 世界书统一注入引擎（纯函数）。设计见 docs/design/world-info-injection-engine.md
// P0：关键词命中 + 块状拼装 + 尾部 recency 重述。无 sticky/group/递归/预算淘汰。

export type WorldEntryKind = "character" | "scene" | "prop" | "style" | "text";
export type PromptSlot = "styleConstant" | "sceneLock" | "charLock" | "userScript" | "tailReinforce";

export interface LabeledImage {
	url: string;
	role: "character" | "scene" | "prop" | "style";
	label: string;
}

export interface WorldEntry {
	id: string;
	source: "material" | "bible" | "sora" | "state";
	kind: WorldEntryKind;
	slot: Exclude<PromptSlot, "userScript" | "tailReinforce">;
	triggerKeys: string[];
	lockText: string;
	negativeText?: string;
	referenceImages: LabeledImage[];
	constant?: boolean;
	tailReinforce?: boolean;
	priority: number;
}

export interface PromptBlock {
	slot: PromptSlot;
	text: string;
	priority: number;
}

export interface InjectOutput {
	injectedEntries: { entry: WorldEntry; hitKey?: string; viaSticky: boolean }[];
	blocks: PromptBlock[];
	referenceImages: LabeledImage[];
	negativeBlock: string;
}

export interface BuildSources {
	characterBibles?: CharacterBibleLike[];
	materials?: MaterialLike[];
	styleBible?: StyleBibleLike | null;
}

export interface CharacterBibleLike {
	characterBibleId: string;
	name: string;
	identityHint?: string;
	outfit?: string;
	distinctiveFeatures?: string;
	era?: string;
	scene?: string;
	hasFullBody?: boolean;
	hasThreeView?: boolean;
}

export interface MaterialLike {
	id: string;
	kind: WorldEntryKind;
	name: string;
	imageUrl?: string;
	wi?: {
		triggerKeys?: string[];
		lockText?: string;
		negativeText?: string;
		constant?: boolean;
		tailReinforce?: boolean;
		priority?: number;
	};
}

export interface StyleBibleLike {
	styleName?: string;
	styleVisualDirectives?: string[];
	styleConsistencyRules?: string[];
	styleNegativeDirectives?: string[];
}

function clean(parts: (string | undefined)[]): string[] {
	return parts.map((s) => (s ?? "").trim()).filter(Boolean);
}

function imageRoleForKind(kind: WorldEntryKind): LabeledImage["role"] {
	return kind === "character" || kind === "scene" || kind === "prop" || kind === "style" ? kind : "scene";
}

function slotForKind(kind: WorldEntryKind): WorldEntry["slot"] {
	if (kind === "character") return "charLock";
	if (kind === "style") return "styleConstant";
	return "sceneLock"; // scene / prop / text 归场景槽
}

export function buildWorldEntries(sources: BuildSources): WorldEntry[] {
	const out: WorldEntry[] = [];

	for (const b of sources.characterBibles ?? []) {
		out.push({
			id: b.characterBibleId,
			source: "bible",
			kind: "character",
			slot: "charLock",
			triggerKeys: clean([b.name]),
			lockText: clean([b.identityHint, b.outfit, b.distinctiveFeatures, b.era, b.scene]).join("·"),
			referenceImages: [],
			tailReinforce: true,
			priority: 100,
		});
	}

	for (const m of sources.materials ?? []) {
		const wi = m.wi ?? {};
		const keys = wi.triggerKeys && wi.triggerKeys.length > 0 ? wi.triggerKeys : clean([m.name]);
		out.push({
			id: m.id,
			source: "material",
			kind: m.kind,
			slot: slotForKind(m.kind),
			triggerKeys: keys,
			lockText: wi.lockText ?? "",
			negativeText: wi.negativeText,
			referenceImages: m.imageUrl
				? [{ url: m.imageUrl, role: imageRoleForKind(m.kind), label: m.name }]
				: [],
			constant: wi.constant,
			tailReinforce: wi.tailReinforce ?? m.kind === "character",
			priority: wi.priority ?? 100,
		});
	}

	const sb = sources.styleBible;
	if (sb) {
		const lockText = clean([...(sb.styleVisualDirectives ?? []), ...(sb.styleConsistencyRules ?? [])]).join("，");
		const negativeText = clean(sb.styleNegativeDirectives ?? []).join("，");
		if (lockText || negativeText || sb.styleName) {
			out.push({
				id: "style-bible",
				source: "bible",
				kind: "style",
				slot: "styleConstant",
				triggerKeys: [],
				lockText: lockText || (sb.styleName ?? ""),
				negativeText: negativeText || undefined,
				constant: true,
				referenceImages: [],
				priority: 200,
			});
		}
	}

	return out;
}

export function inject(input: { shotText: string; entries: WorldEntry[] }): InjectOutput {
	const text = input.shotText ?? "";
	const injectedEntries: InjectOutput["injectedEntries"] = [];

	for (const entry of input.entries) {
		if (entry.constant) {
			injectedEntries.push({ entry, viaSticky: false });
			continue;
		}
		const hitKey = entry.triggerKeys.find((k) => k && text.includes(k));
		if (hitKey) injectedEntries.push({ entry, hitKey, viaSticky: false });
	}

	const blocks: PromptBlock[] = [];
	const referenceImages: LabeledImage[] = [];
	const negativeParts: string[] = [];
	const seenUrls = new Set<string>();

	for (const { entry } of injectedEntries) {
		if (entry.lockText) blocks.push({ slot: entry.slot, text: entry.lockText, priority: entry.priority });
		if (entry.negativeText) negativeParts.push(entry.negativeText);
		for (const img of entry.referenceImages) {
			if (seenUrls.has(img.url)) continue;
			seenUrls.add(img.url);
			referenceImages.push(img);
		}
		// 尾部 recency 重述：把锁定文在 prompt 末尾再压一次（见设计 §4.4）
		if (entry.tailReinforce && entry.lockText) {
			blocks.push({ slot: "tailReinforce", text: `保持一致：${entry.lockText}`, priority: entry.priority });
		}
	}

	return { injectedEntries, blocks, referenceImages, negativeBlock: negativeParts.join("，") };
}

export function assemblePrompt(
	out: InjectOutput,
	userScript: string,
): { prompt: string; negative: string; refs: LabeledImage[] } {
	const pick = (slot: PromptSlot): string[] =>
		out.blocks
			.filter((b) => b.slot === slot)
			.sort((a, b) => b.priority - a.priority)
			.map((b) => b.text);

	// 组装顺序（recency）：画风常驻 → 场景锁 → 用户脚本(居中) → 角色锁 → 尾部重述
	const segments = [
		...pick("styleConstant"),
		...pick("sceneLock"),
		userScript ?? "",
		...pick("charLock"),
		...pick("tailReinforce"),
	].filter((s) => s && s.trim());

	return { prompt: segments.join("\n"), negative: out.negativeBlock, refs: out.referenceImages };
}
