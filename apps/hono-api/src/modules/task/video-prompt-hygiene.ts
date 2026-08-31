/**
 * 视频生成提示词「卫生」确定性 sanitizer（纯函数，对标 gpt-image-2 去噪 appendGptImageDenoise）。
 *
 * 根因：视频正向 prompt 直透发往 new-api、负向词只 .trim()，没有任何项目级「反 AI 味」底座
 * （图片有 gpt-image-2 去噪后缀，视频没有），全靠小T 临场记 → 典型「软自检管不住」。
 * 这里在发往 new-api 的唯一上游做三件确定性的事：
 *   1) 剥离正向里的「过度平滑/完美」样板词（8K / masterpiece / 超高清 …）。
 *      这类词实测触发 over-smoothing 塑料感（vidhex / aivideobootcamp 2026-03 等多源实测），
 *      且几乎不会是真实画面内容（分辨率走 resolution 参数而非 prompt），剥离零误伤。
 *   2) 幂等追加「无背景音乐」音频指令到正向 prompt。根因：视频模型（seedance/pixverse 等）
 *      原生发声、默认会自作主张配 BGM 盖住人声；而 seedance 2.0 不吃独立 negative_prompt
 *      （doubao adaptor 的 requestPayload 无 negative 字段、metadata.negative_prompt 被丢弃，
 *      最终只发一个正向 text），所以「不要 BGM」**必须写进正向 prompt 才生效**（用户 2026-06-20
 *      实测正向句可只去 BGM、保留人声/音效）。这是与质检员「不带背景音乐」对齐的机制兜底。
 *   3) 幂等合并一套「反 AI 味」负向词底座——仅纹理/解剖/伪影类 + BGM/配乐类（对吃负向词的
 *      pixverse/kling 加固，对 seedance 无害因被丢弃），**不含 slow motion 等运动行为词**，
 *      避免误杀有意慢镜（知识卡 negative-prompt-de-ai-texture 红线）。
 *
 * 刻意不剥离用户写的否定词：中文「不要X」高频歧义（不要命/不要脸），硬剥/硬闸必误杀，
 * 留创作期 skill / 知识卡 anti-prompt-pollution-yifan 管。（注意：本模块只「注入」我们自己
 * 固定的音频否定指令，不「剥离」用户的否定词，二者不矛盾。）
 */

// —— 过度平滑/完美样板词（高置信、几乎不会是画面内容）——
// ASCII：大小写不敏感、ASCII 词边界匹配（避免 masterpieces / 4kg 之类误伤）。
const OVER_SMOOTHING_ASCII = [
  "8k resolution",
  "4k resolution",
  "8k",
  "4k",
  "16k",
  "uhd",
  "ultra hd",
  "ultra detailed",
  "hyperdetailed",
  "hyper detailed",
  "extremely detailed",
  "super detailed",
  "best quality",
  "highest quality",
  "masterpiece",
  "award winning",
];
// CJK：无词边界，作子串匹配，只收无歧义的画质样板词（不收「超清/杰作」等易混词）。
const OVER_SMOOTHING_CJK = [
  "超高清",
  "8K分辨率",
  "大师级",
  "极致细节",
  "极致画质",
  "最高画质",
  "顶级画质",
];

// —— 反 AI 味负向词底座（纹理/解剖/伪影；不含运动行为词，避免误杀慢镜）——
export const VIDEO_ANTI_AI_NEGATIVE =
  "plastic skin, waxy over-smoothed skin, airbrushed, doll-like, cgi, 3d render, " +
  "video game render, oversaturated, blown-out highlights, warped face, distorted facial features, " +
  "deformed hands, extra fingers, extra limbs, morphing artifacts, flickering, " +
  "watermark, on-screen text, subtitles, low quality, blurry, " +
  // 无背景音乐：对吃负向词的渠道（pixverse/kling）压 BGM/配乐；seedance 走正向指令（见 appendNoBgmDirective）。
  "background music, bgm, soundtrack, musical score";

// 幂等探测：用底座头部稳定子串判断是否已合并过（避免重复拼接）。
const NEGATIVE_MARKER = "plastic skin, waxy over-smoothed skin";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 把样板词编成弹性正则：词内分隔符（空格或连字符）互相容忍（ultra hd / ultra-hd / ultra  hd）。
function buildAsciiPattern(word: string): RegExp {
  const core = escapeRegExp(word).replace(/[\s-]+/g, "[-\\s]+");
  return new RegExp(`(?<![A-Za-z0-9])${core}(?![A-Za-z0-9])`, "gi");
}

const ASCII_PATTERNS = [...OVER_SMOOTHING_ASCII]
  // 长短语优先，避免「8k」先吃掉「8k resolution」的一半。
  .sort((a, b) => b.length - a.length)
  .map((w) => ({ word: w, re: buildAsciiPattern(w) }));

// 清理剥词后留下的分隔符碎屑（连续逗号/顿号、首尾分隔、多余空白）。
function tidy(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,，、。.])/g, "$1")
    .replace(/([,，、])(?:\s*[,，、])+/g, "$1")
    .replace(/^[\s,，、]+/, "")
    .replace(/[\s,，、]+$/, "")
    .trim();
}

/** 剥离正向 prompt 里的过度平滑/完美样板词。返回清理后的 prompt 与被剥离的词。 */
export function stripOverSmoothingWords(prompt: string): { prompt: string; stripped: string[] } {
  const base = typeof prompt === "string" ? prompt : "";
  if (!base) return { prompt: "", stripped: [] };
  let out = base;
  const stripped: string[] = [];
  for (const { re } of ASCII_PATTERNS) {
    out = out.replace(re, (match) => {
      stripped.push(match.trim());
      return "";
    });
  }
  for (const w of OVER_SMOOTHING_CJK) {
    if (out.includes(w)) {
      stripped.push(w);
      out = out.split(w).join("");
    }
  }
  const cleaned = stripped.length ? tidy(out) : base;
  return { prompt: cleaned, stripped };
}

// 【人物介绍字卡·通用设计（2026-07-06 用户拍板）】首次出场角色在画面内叠加电视剧式
// 人名字卡（姓名+门派/身份）。这是**有意的画面文字**——该镜的负向词底座若仍压
// on-screen text / subtitles 就会自打架（要么字不出来、要么出伪影）。正向 prompt 显式
// 请求字卡时，负向底座剔除这两个词（watermark 等其余照压），并同步清掉调用方自带
// 负向里的同义词。对白字幕仍由 SKILL 硬约束禁止（字卡≠字幕）。
export const INTRO_CARD_REQUEST_RE =
  /人物介绍字卡|介绍字卡|人名字卡|人物名牌|人物字卡|叠[^。；;，,|\n]{0,14}字卡|character intro (?:card|title)|name ?card overlay|intro title card/i;

// 【全片级字卡条件剥除·2026-07-17 ch1-firstmin 复盘根治】「仅XX首次出场叠一次…字卡…淡出」
// 是**全片级**条件——单镜模型不知道其它镜演过什么，这句被 writer 复制进每镜【硬约束】后，
// 每一镜都把自己当"首次出场"重新烧名字（ch1 实证：clip3 过马路镜 0:44 再烧「林七夜」、
// 渲成对白字幕样式）；且句中含「人物介绍字卡」字样，令所有镜命中 INTRO_CARD_REQUEST_RE
// 解除 on-screen text 负向压制。口径=字卡只认镜头行内的**局部显式指令**（叠「X」人物字卡）；
// 含「首次出场」的通用条件句一律从 prompt 剥除（该在哪镜出字卡由计划层的镜头行决定）。
// 判别口径：全片级条件句带**条件量词**（「仅…首次出场」/「首次出场…叠一次」）；局部指令
// （"首次出场，画面叠加人物介绍字卡：任我行"）无量词、不受影响。
export const FILM_LEVEL_INTRO_CARD_CONDITION_RE =
  /[;；，,]?\s*(?:仅[^;；。|\n]{0,30}首次出场[^;；。|\n]{0,50}?字卡|首次出场[^;；。|\n]{0,20}?叠一次[^;；。|\n]{0,30}?字卡)[^;；。，,|\n]{0,24}/g;

/** 剥除全片级「首次出场…字卡」条件句（纯函数、幂等）。局部「叠「X」字卡」镜头行不受影响。 */
export function stripFilmLevelIntroCardCondition(prompt: string): {
  prompt: string;
  stripped: string[];
} {
  const base = typeof prompt === "string" ? prompt : "";
  if (!base) return { prompt: "", stripped: [] };
  const stripped: string[] = [];
  const out = base.replace(FILM_LEVEL_INTRO_CARD_CONDITION_RE, (m) => {
    stripped.push(m.trim());
    return "";
  });
  return { prompt: stripped.length ? tidy(out) : base, stripped };
}

const ON_SCREEN_TEXT_NEGATIVE_RE = /(?:on[- ]?screen text|subtitles?|字幕)\s*[,，]?\s*/gi;

// —— 正文↔负向底座冲突对账（2026-07-17 ch1 复盘根治「负向模板不对账」）——
// 正向 prompt 明确要求的效果，负向底座若照压=两个真相源打架，模型两头猜（ch1 实证：
// 影调圣经「写实半CG精致渲染」vs 底座 cgi/3d render；「油桶高光过曝一线·刺眼金属高光」
// vs 底座 blown-out highlights——荒诞刺点被负向词精确抵消）。口径=正向为准：正向命中
// 声明词 → 从负向（底座+调用方自带）剔除对应词。与字卡豁免同构，纯函数、幂等。
const NEGATIVE_CONFLICT_RESOLVERS: Array<{ wants: RegExp; drop: RegExp }> = [
  {
    // 有意过曝/高光溢出（荒诞刺点/逆光剪影/圣光爆闪等都是合法演出语汇）
    wants: /过曝|高光溢出|blown[- ]?out|刺眼(?:的)?(?:金属)?高光|高光刺点/i,
    drop: /blown[- ]?out highlights?\s*[,，]?\s*/gi,
  },
  {
    // 有意 CG/三渲二质感（「写实半CG」「3D质感」是本项目质量底线词汇，禁被底座反杀）
    wants: /半\s*CG|三渲二|CG\s*(?:渲染|质感)|3D\s*质感|cel[- ]?shaded?|皮克斯|pixar/i,
    drop: /(?:cgi|3d render|video game render)\s*[,，]?\s*/gi,
  },
];

/** 按正向 prompt 声明计算需从负向剔除的冲突词模式（导出供测试/观测）。 */
export function negativeConflictDrops(prompt: string): RegExp[] {
  const p = typeof prompt === "string" ? prompt : "";
  return NEGATIVE_CONFLICT_RESOLVERS.filter((r) => r.wants.test(p)).map((r) => r.drop);
}

const VIDEO_ANTI_AI_NEGATIVE_TEXT_OK = VIDEO_ANTI_AI_NEGATIVE.replace(
  "watermark, on-screen text, subtitles, ",
  "watermark, ",
);

/** 幂等合并「反 AI 味」负向词底座到现有负向词后面。allowOnScreenText=true（人物介绍字卡镜）时底座不含 on-screen text/subtitles，并清掉调用方负向里的同义词。dropPatterns=正向声明的冲突词剔除（negativeConflictDrops 产出），对底座与调用方负向同时生效。 */
export function mergeVideoAntiAiNegative(
  negativePrompt: string,
  opts?: { allowOnScreenText?: boolean; dropPatterns?: RegExp[] },
): {
  negativePrompt: string;
  injected: boolean;
} {
  const applyDrops = (s: string): string => {
    const drops = opts?.dropPatterns ?? [];
    if (!drops.length) return s;
    let out = s;
    for (const re of drops) out = out.replace(re, "");
    return tidy(out);
  };
  let base = typeof negativePrompt === "string" ? negativePrompt.trim() : "";
  if (opts?.allowOnScreenText) {
    base = tidy(base.replace(ON_SCREEN_TEXT_NEGATIVE_RE, ""));
  }
  if (base.includes(NEGATIVE_MARKER)) {
    // 已合并过底座：字卡镜仍要把底座里的压字词剔掉（幂等重入场景）；冲突剔除同理幂等重入。
    if (opts?.allowOnScreenText) {
      return {
        negativePrompt: applyDrops(tidy(base.replace(ON_SCREEN_TEXT_NEGATIVE_RE, ""))),
        injected: false,
      };
    }
    return { negativePrompt: applyDrops(base), injected: false };
  }
  const bed = opts?.allowOnScreenText ? VIDEO_ANTI_AI_NEGATIVE_TEXT_OK : VIDEO_ANTI_AI_NEGATIVE;
  const merged = base ? `${base}, ${bed}` : bed;
  return { negativePrompt: applyDrops(merged), injected: true };
}

// —— 无背景音乐音频指令（注入正向 prompt；seedance 等只吃正向 text，故必须在此而非负向词）——
// 中文为主（seedance 中英都吃、推荐中文）+ BGM 英文别名提升跨模型命中。
export const VIDEO_NO_BGM_DIRECTIVE =
  "（音频：不要背景音乐/BGM，只保留人声对白与现场音效。）";

// 幂等探测：正向里已表达过「不要背景音乐」（我们注入的、或小T/用户自己写的中英等价句）则跳过。
const NO_BGM_PRESENT = /不要背景音乐|无背景音乐|no\s+background\s+music|no\s+bgm/i;

/** 幂等追加「无背景音乐」音频指令到正向 prompt 末尾。已表达过则原样返回。 */
export function appendNoBgmDirective(prompt: string): { prompt: string; injected: boolean } {
  const base = typeof prompt === "string" ? prompt.trim() : "";
  if (NO_BGM_PRESENT.test(base)) return { prompt: base, injected: false };
  const merged = base ? `${base} ${VIDEO_NO_BGM_DIRECTIVE}` : VIDEO_NO_BGM_DIRECTIVE;
  return { prompt: merged, injected: true };
}

export type VideoPromptHygieneResult = {
  prompt: string;
  negativePrompt: string;
  changed: boolean;
  strippedWords: string[];
  injectedNegative: boolean;
  injectedNoBgm: boolean;
};

/**
 * 视频提示词卫生入口：剥过度平滑词 + 幂等合并反 AI 味负向词底座。
 * 纯函数、确定性、幂等；不读 env（flag 判断留调用方）。
 */
export function sanitizeVideoPrompt(input: {
  prompt?: string | null;
  negativePrompt?: string | null;
}): VideoPromptHygieneResult {
  const { prompt: strippedPrompt, stripped } = stripOverSmoothingWords(
    typeof input.prompt === "string" ? input.prompt : "",
  );
  const { prompt: cardScopedPrompt, stripped: strippedCardFooter } =
    stripFilmLevelIntroCardCondition(strippedPrompt);
  stripped.push(...strippedCardFooter);
  const { prompt, injected: injectedNoBgm } = appendNoBgmDirective(cardScopedPrompt);
  const allowOnScreenText = INTRO_CARD_REQUEST_RE.test(prompt);
  const { negativePrompt, injected } = mergeVideoAntiAiNegative(
    typeof input.negativePrompt === "string" ? input.negativePrompt : "",
    { allowOnScreenText, dropPatterns: negativeConflictDrops(prompt) },
  );
  return {
    prompt,
    negativePrompt,
    changed: stripped.length > 0 || injected || injectedNoBgm,
    strippedWords: stripped,
    injectedNegative: injected,
    injectedNoBgm,
  };
}
