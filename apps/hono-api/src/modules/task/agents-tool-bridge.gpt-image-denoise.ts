/**
 * gpt-image-2 生图固定追加「去噪点」提示词（用户规则，纯函数）。
 *
 * 用户提供的去噪提示词（备忘录英文版）：正向质量描述 + `--no` 负向（噪点/颗粒/瑕疵/塑料质感等）。
 * 服务端在工具层对所有 gpt-image-2 生图固定追加（像 videoAspect 那样钉死，不靠小T 每次记），
 * 让出图干净、无高频噪点/颗粒/油腻高光/塑料感。幂等：已含则不重复追加。
 */
// 用户要求：严格使用备忘录原文（开头 "clean illustration"，不再改写为 "clean rendering"）。
export const GPT_IMAGE_DENOISE_SUFFIX =
  "clean illustration, smooth and natural shading, soft diffused lighting, controlled details, " +
  "minimal but refined texture, high clarity, crisp refined edges, clean color transitions, " +
  "smooth gradients, balanced contrast, polished finish, clear subject, visually clean composition " +
  "--no noise, grain, artifacts, dirty texture, muddy colors, over-sharpening, blotchy shadows, " +
  "chaotic details, excessive high-frequency noise, harsh contrast, greasy highlights, plastic texture.";

// 【史诗电影级变体】（2026-07-02 用户拍板：史诗电影级效果 + 不要因为违禁/去噪牺牲画面质感）。
// 默认去噪后缀的「soft diffused lighting / minimal texture / balanced contrast / polished finish」会把
// 电影级戏剧光影、材质颗粒、强明暗对比压平 → 出片"干净但寡淡"。电影级镜头改用本变体：**只压 gpt-image-2
// 真正的塑料/高频噪点伪影**（塑料感/蜡质/油腻高光/压缩伪影/过锐），**保留**戏剧布光、体积光、强对比、
// 丰富材质细节。非电影级 prompt 仍用上方原文（不动 06-18 锁定行为）。
export const GPT_IMAGE_DENOISE_SUFFIX_CINEMATIC =
  "epic cinematic film-grade quality, dramatic volumetric lighting, rich chiaroscuro contrast, " +
  "deep detailed shadows, refined material texture, high clarity, crisp clean edges, clear subject, rich accurate colors " +
  "--no compression artifacts, digital sensor noise, muddy colors, over-sharpening halos, blotchy banding, " +
  "greasy plastic highlights, waxy plastic skin, chaotic high-frequency noise.";

// 电影级意图探测：prompt/label 含这些词 → 用电影级变体（保质感）。
const CINEMATIC_INTENT_RE =
  /电影级|电影质感|电影感|史诗|cinematic|chiaroscuro|film[-\s]?grade|movie[-\s]?grade|次世代/i;

// 幂等探测：任一变体的稳定负向子串已在 → 不重复追加。
const DENOISE_MARKER = "--no noise, grain, artifacts";
const DENOISE_MARKER_CINEMATIC = "--no compression artifacts, digital sensor noise";

function lc(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

// 标点/空格收尾：剥词后可能留下「，，」「,,」「、、」或首尾悬挂分隔符，统一收拢。
function tidyPunctuation(text: string): string {
  return text
    .replace(/\s{2,}/g, " ")
    .replace(/(,\s*){2,}/g, ", ")
    .replace(/(，\s*){2,}/g, "，")
    .replace(/(、\s*){2,}/g, "、")
    .replace(/\s*([,，、])\s*\1*/g, "$1")
    .replace(/[\s,，、]+$/g, "")
    .replace(/^[\s,，、]+/g, "")
    .trim();
}

// 【禁用「写实」关键词】（2026-06-18 用户拍板）：本项目画风是风格化国漫，"写实/超写实/写实质感"
// 这类词会把模型往实拍/塑料质感带，统一在工具层确定性剥除（含常见复合词），不靠小T 每次记。
// 仅删风格描述词，不动正文叙事——"写实"几乎只作画风形容词出现，删后用 tidyPunctuation 收尾。
const REALISM_TERM_RE = /(超|高度|极致|偏)?写实(主义|风格|质感|感|画风)?/g;

export function stripRealismStyleTerms(prompt: string): string {
  if (typeof prompt !== "string" || !prompt) return typeof prompt === "string" ? prompt : "";
  if (!prompt.includes("写实")) return prompt;
  return tidyPunctuation(prompt.replace(REALISM_TERM_RE, ""));
}

// 【剥噪点触发词】（仅 gpt-image-2）：gpt-image-2 噪点根因是模型级高频伪影，"胶片颗粒/做旧/grain/
// 35mm/噪点" 这类词会主动诱发颗粒。出图前确定性删除这些触发词（正向去噪后缀仍由下方追加补偿）。
const NOISE_TRIGGER_RES: RegExp[] = [
  /胶片颗粒感?/g,
  /颗粒感|噪点感?|做旧|复古颗粒|胶片质感/g,
  /\bfilm\s*grain\b/gi,
  /\bgrain(y)?\b/gi,
  /\banalog\s*(grain|noise|film)\b/gi,
  /\b(vintage|retro)\s*grain\b/gi,
  /\b35\s*mm\s*film\b/gi,
];

export function stripNoiseTriggerTerms(prompt: string, isGptImage: boolean): string {
  if (!isGptImage || typeof prompt !== "string" || !prompt) {
    return typeof prompt === "string" ? prompt : "";
  }
  let out = prompt;
  for (const re of NOISE_TRIGGER_RES) out = out.replace(re, "");
  return tidyPunctuation(out);
}

export function isGptImageModel(model: { modelKey?: string; modelAlias?: string }): boolean {
  return lc(model.modelKey).includes("gpt-image-2") || lc(model.modelAlias).includes("gpt-image-2");
}

/** 当模型是 gpt-image-2（含 -official/-apimart 等变体）时，给 prompt 追加去噪后缀；否则原样返回。 */
export function appendGptImageDenoise(
  prompt: string,
  model: { modelKey?: string; modelAlias?: string },
): string {
  const isGptImage =
    lc(model.modelKey).includes("gpt-image-2") || lc(model.modelAlias).includes("gpt-image-2");
  if (!isGptImage) return typeof prompt === "string" ? prompt : "";
  const base = typeof prompt === "string" ? prompt.trim() : "";
  // 幂等：任一变体已在 → 不重复追加（防电影级/普通两次拼接叠加）。
  if (base.includes(DENOISE_MARKER) || base.includes(DENOISE_MARKER_CINEMATIC)) return base;
  // 电影级意图 → 保质感变体；否则用 06-18 锁定的干净变体。
  const suffix = CINEMATIC_INTENT_RE.test(base)
    ? GPT_IMAGE_DENOISE_SUFFIX_CINEMATIC
    : GPT_IMAGE_DENOISE_SUFFIX;
  return base ? `${base}, ${suffix}` : suffix;
}
