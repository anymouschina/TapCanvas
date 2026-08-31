// 统一 Kling V3/O3 视频请求侧助手（APIMart + FunAI 渠道）。
//
// 上游协议（https://docs.apimart.ai/cn/api-reference/videos/kling-v3-omni/generation）：
//   - 首尾帧用 image_with_roles（omni）/ 有序 image_urls（v3，≤2 张）表达；
//   - resolution 不是上游字段，需翻译成 mode(std|pro|4k)；
//   - audio 与 video_list 互斥。
// Hono 只负责把统一结构发全（content[] role、typed references、metadata.audio），
// 渠道差异与实际 provider model key 由 new-api task adaptor 闭环。

const KLING_V3_FAMILY_MODELS = new Set(["kling-v3", "kling-v3-omni", "kling-o3"]);
const KLING_V3_OMNI_MODELS = new Set(["kling-v3-omni"]);
const KLING_V3_REFERENCE_VIDEO_MODELS = new Set(["kling-v3", "kling-v3-omni"]);
const KLING_V3_PRICING_MODELS = new Set(["kling-v3", "kling-v3-omni"]);

function klingModelBase(model: string): string {
	let base = typeof model === "string" ? model.trim().toLowerCase() : "";
	for (const suffix of ["-apimart", "-suchuang", "-all", "-funai"]) {
		if (base.endsWith(suffix)) base = base.slice(0, -suffix.length);
	}
	return base;
}

/** 公共 kling-v3 / kling-o3 与历史 omni 渠道别名；不含 motion-control / 旧代 Kling。 */
export function isKlingV3FamilyVideoModel(model: string): boolean {
	return KLING_V3_FAMILY_MODELS.has(klingModelBase(model));
}

export function isKlingV3OmniVideoModel(model: string): boolean {
	return KLING_V3_OMNI_MODELS.has(klingModelBase(model));
}

/** Public Kling V3 and its legacy omni alias both accept a source video. */
export function isKlingV3ReferenceVideoModel(model: string): boolean {
	return KLING_V3_REFERENCE_VIDEO_MODELS.has(klingModelBase(model));
}

/**
 * Read explicit style/element reference fields without folding them into the
 * ordinary image list. Their roles select different FunAI provider SKUs, so
 * losing that structure would make routing ambiguous.
 */
export function collectKlingStructuredReferenceUrls(...values: unknown[]): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const items = Array.isArray(value) ? value : [value];
		for (const item of items) {
			if (typeof item !== "string") continue;
			const trimmed = item.trim();
			if (!trimmed) continue;
			try {
				const parsed = new URL(trimmed);
				if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
			} catch {
				continue;
			}
			if (seen.has(trimmed)) continue;
			seen.add(trimmed);
			result.push(trimmed);
		}
	}
	return result;
}

export type KlingVideoReferType = "base" | "feature";

/**
 * 统一「参考视频用途」参数（kling-v3-omni 动作迁移开关）：
 *   - "feature"（动作迁移）：提取参考视频的动作/运镜/风格，应用到参考图给出的新主体；
 *   - "base"（默认）：把参考视频当底片做重绘/续演。
 * 未显式给值时返回 null（调用方不注入 metadata，保持旧行为零回归）。
 * 链路：节点 data.videoReferType → extras.videoReferType → metadata.video_refer_type
 * → new-api apimart adaptor video_list[].refer_type。
 */
export function normalizeKlingVideoReferType(value: unknown): KlingVideoReferType | null {
	const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (raw === "feature") return "feature";
	if (raw === "base") return "base";
	return null;
}

export type KlingV3ImageContentItem = {
	type: "image_url";
	image_url: { url: string };
	role: "first_frame" | "last_frame" | "reference_image";
};

/**
 * 把参考图全集 + 显式首尾帧整理成带 role 的 content[]（role 词表与 ARK 对齐，
 * 由 apimart adaptor 转 image_with_roles / 有序 image_urls）。
 * 仅接受 http(s) 直链（kling 走 apimart，asset:// 是 ARK 专用引用，喂过去必拒）。
 */
export function buildKlingV3ImageContentItems(input: {
	refs: string[];
	firstFrameUrl?: unknown;
	lastFrameUrl?: unknown;
}): KlingV3ImageContentItem[] {
	const isHttpUrl = (value: unknown): value is string =>
		typeof value === "string" && /^https?:\/\//i.test(value.trim());
	const firstFrameUrl = isHttpUrl(input.firstFrameUrl) ? input.firstFrameUrl.trim() : "";
	const lastFrameUrlRaw = isHttpUrl(input.lastFrameUrl) ? input.lastFrameUrl.trim() : "";
	// 首尾同图视为只有首帧（成对发同 URL 上游会拒或产出静止镜头）。
	const lastFrameUrl = lastFrameUrlRaw && lastFrameUrlRaw !== firstFrameUrl ? lastFrameUrlRaw : "";

	const items: KlingV3ImageContentItem[] = [];
	const seen = new Set<string>();
	const push = (url: string, role: KlingV3ImageContentItem["role"]) => {
		if (!url || seen.has(url)) return;
		seen.add(url);
		items.push({ type: "image_url", image_url: { url }, role });
	};

	push(firstFrameUrl, "first_frame");
	push(lastFrameUrl, "last_frame");
	for (const ref of Array.isArray(input.refs) ? input.refs : []) {
		if (!isHttpUrl(ref)) continue;
		push(ref.trim(), "reference_image");
	}
	return items;
}

/**
 * 有声/视频参考计费档：kling 定价表（new-api pricing.go linearVideoPricingRules）
 * 对 audio / video_list 有独立的 `{res}+sound` / `{res}+video` 档。把基础
 * `video:{res}:{n}s` spec key 改写到对应档，保证扣费与上游实付一致。
 * 已带后缀（或非标准格式）的 spec key 原样返回，保证幂等。
 */
export function adjustKlingV3BillingSpecKey(input: {
	model: string;
	specKey: string | null | undefined;
	audio: boolean;
	hasVideoReference: boolean;
}): string | null {
	const specKey = typeof input.specKey === "string" ? input.specKey.trim() : "";
	if (!specKey) return null;
	if (!KLING_V3_PRICING_MODELS.has(klingModelBase(input.model))) return specKey;
	const match = specKey.match(/^video:(\d+p|4k):(\d+s)$/i);
	if (!match) return specKey;
	// video_list 与 audio 上游互斥，视频参考优先（与 adaptor 行为一致）。
	// +video 档仅 720p/1080p（定价表无 4k+video），4k 保持基础档避免命中不存在的规格。
	const resolution = match[1].toLowerCase();
	if (
		input.hasVideoReference &&
		isKlingV3ReferenceVideoModel(input.model) &&
		(resolution === "720p" || resolution === "1080p")
	) {
		return `video:${resolution}+video:${match[2]}`;
	}
	if (input.audio) {
		return `video:${match[1]}+sound:${match[2]}`;
	}
	return specKey;
}
