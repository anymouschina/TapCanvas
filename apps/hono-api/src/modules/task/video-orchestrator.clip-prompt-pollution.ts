// 【clip 提示词去污染·静默清理】把「通用 AI 套话」从视频正向 prompt 里静默剥掉，不阻塞流程
// （对标 video-prompt-hygiene 的 stripOverSmoothingWords：纯函数、确定性、幂等、在发往 new-api 的
// 唯一上游 mutate req.prompt）。
//
// 根因（2026-06-16 实测 project 6aec1e46）：小T 即便加载了 video-workflow skill + knowledge_search
// 取回导演方法论，产出的 clipPrompt 仍是英文通用模板——堆「冗余英文一致性套话」（consistent with the
// reference images，orchestrator 本来就会注入中文一致性后缀）和「空泛 hype 词」（high-energy / epic /
// 大片感，无具体画面内容）。这两类高置信、几乎不含画面信息，**静默剥离零误伤**，用户要的是
// 「质检完静默调整好提示词、尽量不阻塞流程」。
//
// 刻意不碰「通用角色占位词」（the hero / a lone fighter / 主角 / 年轻女性）：删了会断句、也无法确定性
// 替成哪个具名角色——这类「让模型用默认脸填空」的问题由 agents-cli writer 在同一执行链修正。
// 图片 @图N 属于结构化 renderer 或独立手工 prompt 的绑定语法；本清理器不剥离、不重排它，
// 也不承担最终 manifest 映射职责。
//
// flag VIDEO_PROMPT_DEPOLLUTE 默认 ON（kill-switch=off/0/false/no）。

export function isClipPromptDepolluteEnabled(env: unknown): boolean {
  const raw = String(
    ((env as Record<string, unknown>)?.VIDEO_PROMPT_DEPOLLUTE ??
      globalThis.process?.env?.VIDEO_PROMPT_DEPOLLUTE ??
      "") as string,
  )
    .trim()
    .toLowerCase();
  return !(raw === "off" || raw === "0" || raw === "false" || raw === "no");
}

// —— 冗余英文一致性套话：orchestrator 自己会加中文一致性后缀，模型再用英文写一遍 = 纯套模板 ——
// 优先整句剥（Keep … consistent with the reference images.），再兜底剥裸短语。
const CONSISTENCY_BOILERPLATE_STRIP: RegExp[] = [
  /[,，;；]?\s*(?:and\s+)?(?:keep|maintain|maintaining|stay|remain|preserve)\b[^.。!！?？]*?\bconsistent\s+with\s+the\s+reference\s+images?\b\s*[.。]?/gi,
  /[,，;；]?\s*consistent\s+with\s+the\s+reference\s+images?\b\s*[.。]?/gi,
  /[,，;；]?\s*(?:while\s+)?maintaining\s+(?:visual\s+)?consistency\s+with[^.。!！?？]*?[.。]?/gi,
];

// —— 空泛 hype 词（高置信、几乎不含画面内容；不收 cinematic/dramatic/atmospheric 这类可能带导演意图的词）——
const HYPE_FILLER_STRIP: RegExp[] = [
  /\bhigh[\s-]?energy\b/gi,
  /\bhigh[\s-]?octane\b/gi,
  /\bepic\b/gi,
  /\bbreathtaking\b/gi,
  /\bstunning\b/gi,
  /\bjaw[\s-]?dropping\b/gi,
  /\bawe[\s-]?inspiring\b/gi,
  /\bvisually\s+striking\b/gi,
  /\bmind[\s-]?blowing\b/gi,
  /大片感|史诗感|震撼感|高燃感|氛围感拉满|视觉冲击力/g,
];

// 清理剥词后留下的分隔符碎屑（连续逗号/顿号、首尾分隔、多余空白），对齐 hygiene 的 tidy。
function tidy(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,，、。.!！?？])/g, "$1")
    .replace(/([,，、])(?:\s*[,，、])+/g, "$1")
    .replace(/([.。])(?:\s*[.。])+/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/^[\s,，、.。]+/, "")
    .replace(/[\s,，、]+$/, "")
    .trim();
}

export type DepolluteResult = { prompt: string; stripped: string[]; changed: boolean };

/**
 * 静默剥离正向 prompt 里的「冗余英文一致性套话 + 空泛 hype 词」。
 * 纯函数、确定性、幂等；不读 env（flag 判断留调用方）。不碰通用角色占位词。
 */
export function stripPromptPollution(prompt: string): DepolluteResult {
  const base = typeof prompt === "string" ? prompt : "";
  if (!base.trim()) return { prompt: base, stripped: [], changed: false };
  let out = base;
  const stripped: string[] = [];
  for (const re of CONSISTENCY_BOILERPLATE_STRIP) {
    out = out.replace(re, (match) => {
      const t = match.trim();
      if (t) stripped.push(t);
      return " ";
    });
  }
  for (const re of HYPE_FILLER_STRIP) {
    out = out.replace(re, (match) => {
      const t = match.trim();
      if (t) stripped.push(t);
      return " ";
    });
  }
  if (!stripped.length) return { prompt: base, stripped: [], changed: false };
  return { prompt: tidy(out), stripped, changed: true };
}

// —— 检测（供 qa-reviewer / 软诊断参考；不参与硬拦）——
// 通用角色占位词：用通用档案词指代主体 = 让模型用默认脸填空（SKILL §护栏E）。这类无法确定性剥（断句），
// 仅作信号上报，由 qa-reviewer 改写治理。
const GENERIC_ROLE_PATTERNS: RegExp[] = [
  /\b(?:a|the|one|lone)\s+(?:lone\s+)?(?:hero|fighter|warrior|swordsman|gunman|assassin|knight|villain|opponent|challenger|stranger|figure|protagonist|antagonist)\b/gi,
  /\b(?:hero|opponent|villain|protagonist|antagonist|fighter|warrior)\s+(?:identity|figure|character|silhouette)\b/gi,
  /\bmysterious\s+(?:figure|man|woman|stranger|warrior|fighter)\b/gi,
  /\b(?:young|old|handsome|beautiful|pretty|tall|mysterious)\s+(?:man|woman|girl|boy|warrior|fighter|hero)\b/gi,
  /\bthe\s+(?:hero|opponent|villain|protagonist|antagonist|challenger|stranger)\b/gi,
];
const GENERIC_ROLE_CJK: string[] = [
  "主角", "男主", "女主", "神秘人", "神秘男子", "神秘女子", "神秘身影", "对手", "反派",
  "年轻女性", "年轻女子", "年轻男子", "英俊男子", "美丽女子", "一名战士", "一位战士", "一名武者",
];

/** 检出文本里的通用角色占位词（去重）；空数组=未命中。供 qa-reviewer 判是否需要改名为具名角色。 */
export function detectGenericRolePlaceholders(text: string): string[] {
  const base = String(text || "");
  const hits = new Set<string>();
  for (const re of GENERIC_ROLE_PATTERNS) {
    for (const m of base.matchAll(re)) hits.add(m[0].trim().toLowerCase());
  }
  for (const w of GENERIC_ROLE_CJK) if (base.includes(w)) hits.add(w);
  return [...hits];
}
