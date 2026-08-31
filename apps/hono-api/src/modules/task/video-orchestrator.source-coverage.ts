// 【原文覆盖率机检·确定性零遗漏告警】(2026-07-02 用户：根治「章节整段做成视频丢内容」)
//
// 病根：章节文本→N 条 clip 的分段全靠 LLM 自觉，服务端从不核对「N 段是否铺满整章、有没有漏掉节拍」。
// StoryPlanClip 早有 sourceStartMarker/sourceEndMarker（每段起止各约 20 字原文逐字锚点），但一直是「纯元数据·
// 服务端不消费」（见 orchestrate.ts 字段注释、知识卡 叙事改编/segment-by-source-anchor-markers、
// FEATURE_GAPS#clip-source-anchor-marker）。本模块把这两字段真正接上：拿每段 marker 回原文定位，
// 「首尾相接像瓷砖铺满整章、无缝无缺口」＝零遗漏；出现「两个相邻覆盖区间之间夹着没被任何段覆盖的原文」＝漏了节拍。
// 这是 root-persona「反向映射回原文」自检的可执行版——不再靠肉眼通读，靠锚点拼图。
//
// 与全仓一致：**这是告警不是硬拦**（去硬闸）。机器逐字算出事实，注入 estimate 响应 sourceCoverageWarning，
// 喂给叙事终审 + 小T，由它们在 clipPrompt 文字层补段后重新 estimate（检测纠正循环），而非 422 硬闸起跑。
//
// 防误报是第一要务（假漏段比不检查更烦人）：
//   ① 无原文 / 原文过短 / 全片没用锚点约定 → 直接不检（usable=false），逐字等价旧行为；
//   ② 漏段(gap/head/tail)检测**仅在全片每段都填了双锚点且都在原文逐字命中时**才跑——只要有段没填/没命中，
//      就无从知道它覆盖了哪段原文，此时只报「哪些段缺锚点/没命中」（可执行提示），绝不猜 gap；
//   ③ 只有相邻覆盖区间之间空缺 > gapMinChars（默认 60 归一化字≈一整句以上）才算漏，滤掉连接词级小缝。
//      （相邻段 marker 首尾相接时 gap≈0，故 60 阈值只会命中真被跳过的原文，不会误伤紧邻段。）
//
// flag VIDEO_SOURCE_COVERAGE_WARN 默认 ON；kill-switch 置 off/0/false/no 逐字等价旧行为。

import type { StoryPlanClip } from "./video-orchestrator.orchestrate";
import { foldT2S } from "./video-orchestrator.t2s-fold";

export function isSourceCoverageWarnEnabled(env: unknown): boolean {
  const raw = String(
    ((env as Record<string, unknown>)?.VIDEO_SOURCE_COVERAGE_WARN ??
      globalThis.process?.env?.VIDEO_SOURCE_COVERAGE_WARN ??
      "") as string,
  )
    .trim()
    .toLowerCase();
  return !(raw === "false" || raw === "0" || raw === "off" || raw === "no");
}

// 归一化：去空白 / 中英标点，小写。用于「实义字符」逐字比对，容忍原文与 marker 间的空白/标点差异。
const COVERAGE_STRIP_RE =
  /[\s　，。、；：！？“”‘’「」『』（）【】,.;:!?"'()[\]…—\-~·]/;

export const DEFAULT_MIN_SOURCE_MARKER_CHARS = 6;

/** 归一化并保留 归一索引 → 原文索引 的映射（用于把命中位置映射回原文取片段）。 */
export function normalizeWithMap(text: string): { norm: string; map: number[] } {
  const src = String(text || "");
  const chars: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (COVERAGE_STRIP_RE.test(ch)) continue;
    chars.push(ch.toLowerCase());
    map.push(i);
  }
  return { norm: chars.join(""), map };
}

function normalizeMarker(s: unknown): string {
  return normalizeWithMap(String(s || "")).norm;
}

function trimmed(s: unknown): string {
  return String(s ?? "").trim();
}

// ============ 意译锚点 fuzzy 定位（2026-07-11 ch13 根治） ============
// ch13 实测：7 镜里 5 镜锚点被意译改写（「形似鳥卻生三頭的巨骨」vs 原文「形似鳥類，卻生有三個
// 腦袋的巨骨」）→ 精确 indexOf 全 MISS → 旧防误报设计整片跳过 gap 检测 → 古战场穿行段 ~330 字
// 大洞静默放行。fuzzy＝LCS 滑窗：意译锚点仍能定位回原文（比率≥0.7），机检不再被改写致盲；
// 同时给出命中处的原文原样片段，供写入闸把锚点代修成逐字（恢复精确可核对）。

export type MarkerHit = {
  /** 命中区间（归一化坐标，end 开区间）。 */
  start: number;
  end: number;
  /** 是否逐字精确命中（false＝按相似度 fuzzy 定位）。 */
  exact: boolean;
  /** 命中处的原文原样片段（含标点空白）——锚点代修/建议的原料。 */
  verbatim: string;
};

export type MarkerLocator = ((marker: unknown, fromNorm?: number) => MarkerHit | null) & {
  /** 归一化后原文长度（0=原文空）。 */
  normLength: number;
};

/** fuzzy 防御上限：归一化原文超此长度跳过 fuzzy（只走精确），防病态输入拖垮请求。 */
const FUZZY_MAX_TEXT_CHARS = 60_000;
/** marker 参与比对的最大归一化长度（超长截断，锚点约定本就是 ~20 字）。 */
const FUZZY_MAX_MARKER_CHARS = 48;

/** 滑窗 LCS：在 norm[from..] 找与 marker 最相似的窗口，比率≥minRatio 才算命中。 */
function fuzzyLocate(
  norm: string,
  marker: string,
  minRatio: number,
  from: number,
): { start: number; end: number } | null {
  const n = norm.length;
  const mLen = marker.length;
  if (!mLen || !n || n > FUZZY_MAX_TEXT_CHARS) return null;
  const win = Math.min(n, mLen + Math.max(4, Math.ceil(mLen * 0.8)));
  const markerChars = new Set(marker);
  const need = Math.ceil(mLen * minRatio);
  // DP 表复用（banded LCS，窗口定长）。
  const rows = mLen + 1;
  const cols = win + 1;
  const dp = new Uint16Array(rows * cols);
  let best: { score: number; start: number; end: number } | null = null;
  for (let off = Math.max(0, from); off <= n - need; off++) {
    // 预筛：窗口首字符必须出现在 marker 里（意译锚点几乎必然共享首部字符，杜撰段被大量剪枝）。
    if (!markerChars.has(norm[off])) continue;
    const w = Math.min(win, n - off);
    for (let i = 1; i <= mLen; i++) {
      const mc = marker[i - 1];
      const rowBase = i * cols;
      const prevBase = rowBase - cols;
      for (let j = 1; j <= w; j++) {
        dp[rowBase + j] =
          mc === norm[off + j - 1]
            ? dp[prevBase + j - 1] + 1
            : Math.max(dp[prevBase + j], dp[rowBase + j - 1]);
      }
    }
    const score = dp[mLen * cols + w];
    if (score >= need && (!best || score > best.score)) {
      // 回溯取命中跨度（窗口内首/末个匹配字符）。
      let i = mLen;
      let j = w;
      let first = -1;
      let last = -1;
      while (i > 0 && j > 0) {
        if (marker[i - 1] === norm[off + j - 1] && dp[i * cols + j] === dp[(i - 1) * cols + j - 1] + 1) {
          if (last < 0) last = j - 1;
          first = j - 1;
          i--;
          j--;
        } else if (dp[(i - 1) * cols + j] >= dp[i * cols + j - 1]) i--;
        else j--;
      }
      if (first >= 0) best = { score, start: off + first, end: off + last + 1 };
      if (score === mLen) break; // 满分提前收
    }
  }
  return best ? { start: best.start, end: best.end } : null;
}

/**
 * 构建原文锚点定位器（一次归一化，多次定位）。精确 indexOf 优先；未命中退 fuzzy（LCS 相似度
 * ≥0.7）；都不中返回 null（真杜撰）。verbatim 恒为原文原样片段，可直接用于把意译锚点代修成逐字。
 */
export function createMarkerLocator(
  chapterText: string,
  opts: { minMarkerChars?: number; fuzzyMinRatio?: number } = {},
): MarkerLocator {
  const minMarker = opts.minMarkerChars ?? DEFAULT_MIN_SOURCE_MARKER_CHARS;
  const minRatio = opts.fuzzyMinRatio ?? 0.7;
  const raw = String(chapterText || "");
  const { norm, map } = normalizeWithMap(raw);
  const toVerbatim = (s: number, e: number): string => {
    if (!map.length) return "";
    const os = map[Math.min(s, map.length - 1)] ?? 0;
    const oe = (map[Math.min(Math.max(e - 1, 0), map.length - 1)] ?? raw.length - 1) + 1;
    return raw.slice(os, oe);
  };
  const locate = (marker: unknown, fromNorm = 0): MarkerHit | null => {
    const m = normalizeMarker(marker).slice(0, FUZZY_MAX_MARKER_CHARS);
    if (m.length < minMarker || !norm.length) return null;
    let idx = norm.indexOf(m, fromNorm);
    if (idx < 0 && fromNorm > 0) idx = norm.indexOf(m); // 回退全局（与旧行为一致）
    if (idx >= 0) {
      return { start: idx, end: idx + m.length, exact: true, verbatim: toVerbatim(idx, idx + m.length) };
    }
    const f = fuzzyLocate(norm, m, minRatio, fromNorm) ?? (fromNorm > 0 ? fuzzyLocate(norm, m, minRatio, 0) : null);
    if (!f) return null;
    return { start: f.start, end: f.end, exact: false, verbatim: toVerbatim(f.start, f.end) };
  };
  return Object.assign(locate, { normLength: norm.length });
}

export type UncoveredSpan = {
  kind: "head" | "gap" | "tail";
  /** 空缺起点在原文的大致百分比位置。 */
  approxPct: number;
  /** 空缺长度（归一化实义字符数）。 */
  chars: number;
  /** 该段未覆盖原文的开头片段（原文原样，供小T 一眼认出漏了什么）。 */
  snippet: string;
};

export type SourceCoverageResult = {
  /** 是否具备机检条件：有足量原文 且 全片至少一段填了双锚点。false=不检（逐字等价旧行为）。 */
  usable: boolean;
  /** 原文本身是否足量可检（≥minTextChars 归一化字）。用于区分「没原文不检」与「有原文但全片没填锚点」。 */
  textUsable: boolean;
  totalClips: number;
  /** 双锚点都在原文逐字命中的 clip index。 */
  matchedClips: number[];
  /** 全片在用锚点约定、但本段两个锚点都空的 clip index。 */
  missingMarkerClips: number[];
  /** 锚点非空、但精确+fuzzy 都定位不到的 clip（真杜撰）。 */
  unmatchedMarkerClips: Array<{ index: number; which: "start" | "end" | "both"; sample: string }>;
  /** 锚点非逐字、但 fuzzy 已定位的 clip（意译改写）——附原文逐字建议，供代修/提示。 */
  fuzzyMarkerClips: Array<{
    index: number;
    which: "start" | "end" | "both";
    suggestedStart?: string;
    suggestedEnd?: string;
  }>;
  /** 起始锚点早于前一段=分段乱序。 */
  outOfOrderClips: number[];
  /** 没被任何镜头覆盖的原文区间（漏掉的节拍）。仅全片满锚点+全命中时才计算。 */
  uncoveredSpans: UncoveredSpan[];
  /** 双锚点命中 clip 的覆盖跨度（归一化实义字符数），供密度算术（source-density）消费。 */
  clipSpans: Array<{ index: number; chars: number }>;
  /** 已覆盖归一化字符占全章比例 [0,1]。 */
  coveredRatio: number;
};

export type CoverageOptions = {
  /** 判为漏段的最小空缺（归一化实义字符数）。默认 60。 */
  gapMinChars?: number;
  /** 原文短于此不检（归一化字符）。默认 200。 */
  minTextChars?: number;
  /** marker 短于此视为太短不可靠、按未命中处理（归一化字符）。默认 6。 */
  minMarkerChars?: number;
};

export type SourceAnchoredClip = Pick<StoryPlanClip, "sourceStartMarker" | "sourceEndMarker">;

/**
 * 【写入闸锚点代修·2026-07-11 ch13 根治】add_clips 收批时把意译改写的 sourceStartMarker/EndMarker
 * 服务端代修成原文逐字片段（fuzzy 定位到哪句就替换成那句原样）——与「对白超容/段长对齐」同一
 * 「确定性问题代修不退回」契约：LLM 抄不准原文是常态，零容差退回=打地鼠。定位不到（真杜撰/过短）
 * 不乱改，出警告让写手从原文复制。无原文/无锚点原样返回（逐字等价旧行为）。
 */
export function repairClipSourceMarkers(
  clips: readonly unknown[],
  chapterText: string,
  opts: { minMarkerChars?: number } = {},
): {
  clips: unknown[];
  /** 已代修说明（人读）：第N段起始锚点「意译」→「原文逐字」。 */
  fixes: string[];
  /** 定位不到的锚点（疑似杜撰/过短）——喂 lint 警告，不乱改原值。 */
  warnings: Array<{ index: number; which: "start" | "end"; marker: string }>;
} {
  const list = Array.isArray(clips) ? clips : [];
  const out = { clips: list.slice() as unknown[], fixes: [] as string[], warnings: [] as Array<{ index: number; which: "start" | "end"; marker: string }> };
  const raw = String(chapterText || "");
  if (!raw.trim() || !list.length) return out;
  const locate = createMarkerLocator(raw, opts);
  if (!locate.normLength) return out;
  out.clips = list.map((c, index) => {
    if (!c || typeof c !== "object" || Array.isArray(c)) return c;
    const rec = c as Record<string, unknown>;
    const rawStart = trimmed(rec.sourceStartMarker);
    const rawEnd = trimmed(rec.sourceEndMarker);
    if (!rawStart && !rawEnd) return c;
    let next: Record<string, unknown> | null = null;
    const sHit = rawStart ? locate(rawStart) : null;
    if (rawStart) {
      if (!sHit) out.warnings.push({ index, which: "start", marker: rawStart.slice(0, 24) });
      else if (!sHit.exact && sHit.verbatim && sHit.verbatim !== rawStart) {
        next = { ...(next ?? rec), sourceStartMarker: sHit.verbatim };
        out.fixes.push(`第${index + 1}段起始锚点非原文逐字，已代修「${rawStart.slice(0, 20)}」→「${sHit.verbatim.slice(0, 24)}」`);
      }
    }
    if (rawEnd) {
      const eHit = locate(rawEnd, sHit ? sHit.end : 0);
      if (!eHit) out.warnings.push({ index, which: "end", marker: rawEnd.slice(0, 24) });
      else if (!eHit.exact && eHit.verbatim && eHit.verbatim !== rawEnd) {
        next = { ...(next ?? rec), sourceEndMarker: eHit.verbatim };
        out.fixes.push(`第${index + 1}段结束锚点非原文逐字，已代修「${rawEnd.slice(0, 20)}」→「${eHit.verbatim.slice(0, 24)}」`);
      }
    }
    return next ?? c;
  });
  return out;
}

/**
 * 【缺口机检左移进写入·2026-07-11 ch14 根治】ch14 实测：缺口在 estimate/start 才首次暴露，
 * start 被 source_coverage_gap 拒了两次、每次逼一整轮「改镜→再估→再起跑」LLM 往返（~50 分钟
 * 打地鼠）；且第二个缺口正是 replace 修第一个缺口时挪锚点**新造**的。改为 add_clips 每批入库后
 * 就对「已累积的相邻镜」逐边界核对锚点接缝，缺口当场回在本批响应里——写手趁上下文还热一次
 * replaceAtIndex 修掉（检测纠正）。该结果只作为同链修订证据，不取得启动或任务终止权。
 * 只报 head/gap，不报 tail：分批写作中"还没写到的尾巴"不是缺口（防误报第一要务）；
 * 按位提交的空洞占位成空对象落进 missingMarkerClips，其相邻边界自动跳过、绝不猜 gap。
 */
export function buildMidWriteCoverageWarning(
  accumClips: readonly unknown[],
  chapterText: string,
  opts: { gapMinChars?: number } = {},
): string | null {
  const list = Array.isArray(accumClips) ? accumClips : [];
  if (!list.length) return null;
  const safe = list.map((c) => (c && typeof c === "object" && !Array.isArray(c) ? c : {}));
  const r = computeSourceCoverage(safe as readonly StoryPlanClip[], chapterText, {
    ...(opts.gapMinChars !== undefined ? { gapMinChars: opts.gapMinChars } : {}),
  });
  if (!r.usable) return null;
  const spans = r.uncoveredSpans.filter((s) => s.kind !== "tail");
  if (!spans.length) return null;
  const kindLabel: Record<"head" | "gap", string> = { head: "开头", gap: "中间" };
  const shown = spans.slice(0, 6);
  const detail = shown
    .map((sp) => `原文${kindLabel[sp.kind as "head" | "gap"]}约${sp.approxPct}%处 ${sp.chars} 字没进任何镜「${sp.snippet}…」`)
    .join("；");
  const more = spans.length > shown.length ? `（另 ${spans.length - shown.length} 处）` : "";
  return (
    `⚠️已累积镜的原文接缝有缺口（结构性覆盖证据·请在同一执行链继续修订）：${detail}${more}。` +
    `修法＝把缺口并入相邻镜：扩大该镜 sourceStartMarker/EndMarker 跨度到与邻镜首尾相接、shots 里补上对应节拍，` +
    `add_clips{runId, replaceAtIndex:<镜号>, clips:[改好的那段]} 单段重发；改锚点后注意别在另一侧撕开新缝（相邻段首尾相接、瓷砖铺满）；禁删原文内容顶缺口。`
  );
}

// 原文引号台词提取：「」/“” 引住的 2~80 字。跨段嵌套不追求完美配对，超长截断防误配。
const SPAN_DIALOGUE_RE = /[「“]([^」”]{2,80})[」”]/g;

/**
 * 【对白覆盖机检·逐镜跨度版（2026-07-11 链路审计左移）】旧 clip_dialogue_dropped 闸是"全片零对白"
 * 级粗判且默认 OFF；本函数按每镜 sourceStartMarker/EndMarker 圈出的原文跨度提取引号台词，逐句核对
 * 是否（归一化后逐字）出现在该镜的 clipPrompt/shots 里——「原文对白一字不丢」铁律的可执行版。
 * add_clips 写入时当场报（检测纠正非硬闸）。防误报：锚点缺失/定位不到的镜不查；<4 归一字的短叹词不查；
 * 简繁/改写不匹配按丢失报（逐字铁律本就禁改写）；clip 标 dialogueReviewed:true 豁免（cuts 已登记的删减走此口）。
 */
export function buildClipDialogueCoverageWarning(
  clips: readonly unknown[],
  chapterText: string,
): string | null {
  const raw = String(chapterText || "");
  const list = Array.isArray(clips) ? clips : [];
  if (!raw.trim() || !list.length) return null;
  const locate = createMarkerLocator(raw);
  if (!locate.normLength) return null;
  const { map } = normalizeWithMap(raw);
  const problems: string[] = [];
  list.forEach((clip, index) => {
    if (!clip || typeof clip !== "object" || Array.isArray(clip)) return;
    const c = clip as Record<string, unknown>;
    if (c.dialogueReviewed === true) return;
    const sMarker = trimmed(c.sourceStartMarker);
    const eMarker = trimmed(c.sourceEndMarker);
    if (!sMarker || !eMarker) return;
    const sHit = locate(sMarker);
    if (!sHit) return;
    const eHit = locate(eMarker, sHit.end);
    if (!eHit) return;
    const origStart = map[Math.min(sHit.start, map.length - 1)] ?? 0;
    const origEnd = (map[Math.min(Math.max(eHit.end - 1, 0), map.length - 1)] ?? raw.length - 1) + 1;
    const spanText = raw.slice(origStart, origEnd);
    const shots = Array.isArray(c.shots) ? (c.shots as Array<Record<string, unknown>>) : [];
    const clipTextNorm = normalizeWithMap(
      [
        String(c.clipPrompt ?? ""),
        String(c.storyboardPrompt ?? ""),
        ...shots.map((sh) => String(sh?.dialogue ?? "")),
        ...shots.map((sh) => String(sh?.action ?? "")),
      ].join("\n"),
    ).norm;
    const missing: string[] = [];
    SPAN_DIALOGUE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SPAN_DIALOGUE_RE.exec(spanText))) {
      const quote = m[1];
      const qNorm = normalizeWithMap(quote).norm;
      if (qNorm.length < 4) continue;
      if (!clipTextNorm.includes(qNorm)) missing.push(quote.slice(0, 18));
      if (missing.length >= 3) break;
    }
    if (missing.length) problems.push(`镜${index + 1}丢对白「${missing.join("」「")}」`);
  });
  if (!problems.length) return null;
  const shown = problems.slice(0, 5);
  const more = problems.length > shown.length ? `（另 ${problems.length - shown.length} 镜）` : "";
  return (
    `⚠️对白覆盖机检（按锚点跨度逐镜比对原文引号台词·逐字归一化）：${shown.join("；")}${more}——` +
    `原文对白一字不丢（铁律，简繁/意译改写同样算丢）：保留的逐字写进该镜（spoken-dialogue 语法，锚在动作上）后 replaceAtIndex 单段重发；` +
    `确要删的在 adaptationStrategy.cuts 登记并给该镜标 dialogueReviewed:true 豁免。`
  );
}

/** 跨度内原文台词条数（归一化后 ≥minChars 个字符才计条；纯拟声/单字爆喝如「吼」「斬」不计）。 */
export function countSpanDialogueLines(
  spanText: string,
  minChars = 3,
): { count: number; lines: string[] } {
  const lines: string[] = [];
  SPAN_DIALOGUE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPAN_DIALOGUE_RE.exec(String(spanText || "")))) {
    const quote = m[1] ?? "";
    if (normalizeWithMap(quote).norm.length >= minChars) lines.push(quote);
  }
  return { count: lines.length, lines };
}

export type DialogueCountIssue = {
  /** 批内下标（与传入 clips 对位）。 */
  index: number;
  need: number;
  got: number;
  /** 疑似未承载的原文台词头 12 字（逐字未命中·内容可改编时仅供参考）。 */
  missingHints: string[];
};

/**
 * 【台词条数守恒审计·2026-07-13 用户拍板「原文台词条数必须齐全（对应画面承载），内容可以改编」】
 * 逐段按 sourceStartMarker/EndMarker 回原文取跨度，数跨度内原文台词条数（引号句·归一化≥3字），
 * 要求该段产出的台词行数（shots[].dialogue 非空行；无 shots 时数 clipPrompt 的 @…「」行）≥ 原文条数。
 * 只比条数不比内容——改编/拆行/换措辞全合法，删条不合法（ch22-v2 实测丢 3/12 条台词）。
 * 无 chapterText / 无锚点的段跳过（逐字等价旧行为）。
 *
 * 【相邻镜顺延认账·2026-07-17 用户拍板「标准要一致」】超容处置序①教 writer「尾部台词顺延到
 * 下一镜开头」，但 writer 禁改锚点——逐段死核会把合法顺延打回（重排死循环三角）。守恒律本就是
 * 总条数不蒸发：本段缺口允许由**相邻段位**的富余台词行抵账（富余=该邻镜台词行数−其自身跨度
 * 条数，仅锚点可定位的镜供账），左→右贪心、先取前邻再取后邻、富余池不重复消费。
 * replace 单段重发时邻镜不在本批——经 opts.plan（累积镜）+ opts.slotNos（全局段位）拼出全片
 * 有效排布后按段位邻接认账；顺延两段同改须**先补收方再改让方**（收方先落库富余才可查证）。
 */
export function auditClipDialogueCount(
  clips: readonly unknown[],
  chapterText: string,
  opts?: { plan?: readonly unknown[]; slotNos?: readonly number[] },
): DialogueCountIssue[] {
  const raw = String(chapterText || "");
  const batch = Array.isArray(clips) ? clips : [];
  if (!raw.trim() || !batch.length) return [];
  const locate = createMarkerLocator(raw);
  if (!locate.normLength) return [];
  const { map } = normalizeWithMap(raw);

  // 拼出全片有效排布：plan 模式=累积镜上把本批按段位覆盖；否则本批即全排布（beat 合同层传全量）。
  let list: unknown[];
  let batchIndexBySlot: Map<number, number> | null = null;
  if (opts?.plan && Array.isArray(opts.slotNos) && opts.slotNos.length === batch.length) {
    list = [...opts.plan];
    batchIndexBySlot = new Map();
    opts.slotNos.forEach((slot, bi) => {
      if (!Number.isInteger(slot) || slot < 0) return;
      while (list.length <= slot) list.push(null);
      list[slot] = batch[bi];
      batchIndexBySlot!.set(slot, bi);
    });
  } else {
    list = [...batch];
  }

  type SlotStat = {
    audited: boolean;
    need: number;
    got: number;
    surplus: number;
    missingHints: string[];
  };
  const stats: SlotStat[] = list.map((clip) => {
    const stat: SlotStat = { audited: false, need: 0, got: 0, surplus: 0, missingHints: [] };
    if (!clip || typeof clip !== "object" || Array.isArray(clip)) return stat;
    const c = clip as Record<string, unknown>;
    const sMarker = trimmed(c.sourceStartMarker);
    const eMarker = trimmed(c.sourceEndMarker);
    if (!sMarker || !eMarker) return stat;
    const sHit = locate(sMarker);
    if (!sHit) return stat;
    const eHit = locate(eMarker, sHit.end);
    if (!eHit) return stat;
    const origStart = map[Math.min(sHit.start, map.length - 1)] ?? 0;
    const origEnd = (map[Math.min(Math.max(eHit.end - 1, 0), map.length - 1)] ?? raw.length - 1) + 1;
    const span = countSpanDialogueLines(raw.slice(origStart, origEnd));
    const shots = Array.isArray(c.shots) ? (c.shots as Array<Record<string, unknown>>) : [];
    let got = 0;
    if (shots.length) {
      got = shots.filter((sh) => String(sh?.dialogue ?? "").trim().length > 0).length;
    } else {
      const p = String(c.clipPrompt ?? "");
      got = (p.match(/@[^\n]{0,60}[:：][^\n]{0,10}[「“]/g) || []).length;
    }
    stat.audited = true;
    stat.need = span.count;
    stat.got = got;
    stat.surplus = Math.max(0, got - span.count);
    if (span.count > got) {
      const clipTextNorm = normalizeWithMap(
        [String(c.clipPrompt ?? ""), ...shots.map((sh) => String(sh?.dialogue ?? "")), ...shots.map((sh) => String(sh?.action ?? ""))].join("\n"),
      ).norm;
      stat.missingHints = span.lines
        .filter((q) => !clipTextNorm.includes(normalizeWithMap(q).norm))
        .map((q) => q.slice(0, 12))
        .slice(0, 4);
    }
    return stat;
  });

  // 相邻顺延认账：左→右消化缺口，先取前邻富余再取后邻，池子扣减防双花。
  const issues: DialogueCountIssue[] = [];
  stats.forEach((stat, slot) => {
    if (!stat.audited || stat.need <= 0) return;
    let deficit = stat.need - stat.got;
    if (deficit <= 0) return;
    const prev = stats[slot - 1];
    if (prev?.audited && prev.surplus > 0 && deficit > 0) {
      const take = Math.min(prev.surplus, deficit);
      prev.surplus -= take;
      deficit -= take;
    }
    const next = stats[slot + 1];
    if (next?.audited && next.surplus > 0 && deficit > 0) {
      const take = Math.min(next.surplus, deficit);
      next.surplus -= take;
      deficit -= take;
    }
    if (deficit <= 0) return;
    if (batchIndexBySlot) {
      const bi = batchIndexBySlot.get(slot);
      if (bi === undefined) return; // 存量镜不在本批，无法就地退回（其写入时已审）
      issues.push({ index: bi, need: stat.need, got: stat.got, missingHints: stat.missingHints });
    } else {
      issues.push({ index: slot, need: stat.need, got: stat.got, missingHints: stat.missingHints });
    }
  });
  return issues;
}

// ============ 原文信息点守恒（要素守恒第二类型·2026-07-13 用户拍板） ============
// 「原文全部内容都要有体现，而不是摘要——只能比原文信息多，不能缺」。
// 台词条数守恒管引号台词；本审计管其余叙事句：逐段按锚点跨度取原文，切成信息句（剥台词、
// 滤节奏短句/章题），每句取判别性 2-gram（繁→简折叠 + 剔章内高频 gram），在承载文本
// （本段 clip 全文 + 调用方补充的邻段/全片文本）里算命中率——
// 接近零命中＝该句信息点整体蒸发（ch23 实证：龙族余孽因骨片祖巫印记退避的整段暗线，
// 跨度归属镜6 却被摘要式取舍掉，锚点瓷砖机检+台词闸+critic 97 分全部放行）。
// 判定双档（与下方实现一致·OCR 2026-07-13 对齐）：确证丢失＝该句稀有判别 gram（章内频次≤3·
// ≥2 个）在承载文本里**零命中**（实体词全灭级）；命中率 <WEAK(0.30) 但稀有 gram 有命中＝弱承载
//（软告警喂终审）。paraphrase 天然打折，稀有 gram 零命中判据防误伤改编（ch23 三轮校准定稿）。

/** 弱承载线：与承载合同 CARRIER_RATIO_FLOOR 同源校准（paraphrase 实测 ~0.32）。 */
export const INFO_UNIT_WEAK_FLOOR = 0.3;
/** 信息句最短归一化长度（更短的多为节奏句「轰！」「继续。」，不计信息点）。 */
export const INFO_UNIT_MIN_CHARS = 8;
/** 章内高频 gram 剔除线（主角名/口头禅这类全章刷屏 gram 不参与命中率分母）。 */
const INFO_UNIT_GRAM_FREQ_CAP = 8;
/** 稀有判别词线：章内出现 ≤ 此次数的 2-gram/单字才算「这句独有的记号」。 */
const INFO_UNIT_RARE_FREQ_CAP = 3;

const QUOTED_SEGMENT_RE = /[「“『][^」”』]*[」”』]/g;
const SENTENCE_SPLIT_RE = /[。！？；…\n]+/;
const CHAPTER_TITLE_RE = /^第[0-9零一二三四五六七八九十百千]+[章节節回卷]/;

export type InfoUnitFinding = { head: string; ratioPct: number };
export type InfoUnitIssue = {
  /** 批内下标（与传入 clips 对位）。 */
  index: number;
  /** 确证丢失的信息句（句头 ~16 字·命中率%）。 */
  uncovered: InfoUnitFinding[];
  /** 弱承载信息句（软告警级）。 */
  weak: InfoUnitFinding[];
};

/** 跨度原文 → 信息句（剥引号台词=台词闸辖区；滤章题/节奏短句；norm 已折简归一）。 */
export function splitSpanInfoUnits(
  spanText: string,
  minChars = INFO_UNIT_MIN_CHARS,
): Array<{ head: string; norm: string }> {
  const noQuotes = String(spanText || "").replace(QUOTED_SEGMENT_RE, "");
  const units: Array<{ head: string; norm: string }> = [];
  for (const seg of noQuotes.split(SENTENCE_SPLIT_RE)) {
    const raw = seg.trim();
    if (!raw || CHAPTER_TITLE_RE.test(raw)) continue;
    const norm = normalizeWithMap(foldT2S(raw)).norm;
    if (norm.length < minChars) continue;
    units.push({ head: raw.slice(0, 16), norm });
  }
  return units;
}

function collectClipCarrierText(c: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of ["clipPrompt", "logline", "title", "exitState"]) {
    const v = c[k];
    if (typeof v === "string") parts.push(v);
  }
  const shots = Array.isArray(c.shots) ? (c.shots as unknown[]) : [];
  for (const sh of shots) {
    if (!sh || typeof sh !== "object") continue;
    for (const v of Object.values(sh as Record<string, unknown>)) {
      if (typeof v === "string") parts.push(v);
    }
  }
  return parts.join("\n");
}

/** 全部镜的承载文本并集（estimate/start 全片口径：原文信息在任一镜有体现即算承载）。 */
export function collectClipsCarrierText(clips: readonly unknown[]): string {
  return (Array.isArray(clips) ? clips : [])
    .map((c) =>
      c && typeof c === "object" && !Array.isArray(c)
        ? collectClipCarrierText(c as Record<string, unknown>)
        : "",
    )
    .join("\n");
}

function buildGramCounter(normText: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i + 2 <= normText.length; i += 1) {
    const g = normText.slice(i, i + 2);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return counts;
}

/**
 * 【原文信息点守恒审计】逐段按锚点跨度切信息句，核对每句在承载文本中的判别 gram 命中率。
 * carrierExtraText：调用方补充的额外承载面（add_clips 传已累积镜文本防跨镜承载误报；
 * estimate/start 传全片镜文本＝「全片任一处有体现」即合规）。
 * 无 chapterText / 无锚点的段跳过（逐字等价旧行为）。
 */
export function auditClipInfoUnitCoverage(
  clips: readonly unknown[],
  chapterText: string,
  opts: { carrierExtraText?: string; minSentenceChars?: number } = {},
): InfoUnitIssue[] {
  const raw = String(chapterText || "");
  const list = Array.isArray(clips) ? clips : [];
  if (!raw.trim() || !list.length) return [];
  const locate = createMarkerLocator(raw);
  if (!locate.normLength) return [];
  const { map } = normalizeWithMap(raw);
  const chapterNorm = normalizeWithMap(foldT2S(raw)).norm;
  const chapterGramCounts = buildGramCounter(chapterNorm);
  const extraNorm = normalizeWithMap(foldT2S(String(opts.carrierExtraText ?? ""))).norm;
  const issues: InfoUnitIssue[] = [];
  list.forEach((clip, index) => {
    if (!clip || typeof clip !== "object" || Array.isArray(clip)) return;
    const c = clip as Record<string, unknown>;
    const sMarker = trimmed(c.sourceStartMarker);
    const eMarker = trimmed(c.sourceEndMarker);
    if (!sMarker || !eMarker) return;
    const sHit = locate(sMarker);
    if (!sHit) return;
    const eHit = locate(eMarker, sHit.end);
    if (!eHit) return;
    const origStart = map[Math.min(sHit.start, map.length - 1)] ?? 0;
    const origEnd = (map[Math.min(Math.max(eHit.end - 1, 0), map.length - 1)] ?? raw.length - 1) + 1;
    const units = splitSpanInfoUnits(raw.slice(origStart, origEnd), opts.minSentenceChars);
    if (!units.length) return;
    const carrierNorm =
      normalizeWithMap(foldT2S(collectClipCarrierText(c))).norm + "\n" + extraNorm;
    const uncovered: InfoUnitFinding[] = [];
    const weak: InfoUnitFinding[] = [];
    for (const unit of units) {
      const grams: string[] = [];
      const rareGrams: string[] = [];
      for (let i = 0; i + 2 <= unit.norm.length; i += 1) {
        const g = unit.norm.slice(i, i + 2);
        const freq = chapterGramCounts.get(g) ?? 0;
        if (freq < INFO_UNIT_GRAM_FREQ_CAP && !grams.includes(g)) grams.push(g);
        if (freq <= INFO_UNIT_RARE_FREQ_CAP && !rareGrams.includes(g)) rareGrams.push(g);
      }
      if (!grams.length) continue; // 全句都是高频 gram（口头禅级复读句）→ 无判别力，不检
      const hits = grams.filter((g) => carrierNorm.includes(g)).length;
      const ratio = hits / grams.length;
      if (ratio >= INFO_UNIT_WEAK_FLOOR) continue;
      const finding = { head: unit.head, ratioPct: Math.round(ratio * 100) };
      // 确证丢失＝这句独有的记号（章内稀有 2-gram）在承载文本里**零命中**——意译改写几乎必然
      // 保留至少一个实体记号 gram（ch23 校准：VO 逐字承载句曾被高频剔除误判 5%，稀有 gram「精纯」
      // 命中即免罚）；全部记号消失（骨片/祖巫/印记级实体蒸发）才判丢。单字通道试过太宽
      //（着/属/于折简后章内稀有、承载文本却必然出现）会漏放真丢失，弃用。
      const rareGramHit = rareGrams.some((g) => carrierNorm.includes(g));
      if (rareGrams.length >= 2 && !rareGramHit) uncovered.push(finding);
      else weak.push(finding);
    }
    if (uncovered.length || weak.length) issues.push({ index, uncovered, weak });
  });
  return issues;
}

export function computeSourceCoverage(
  clips: readonly SourceAnchoredClip[] | undefined,
  chapterText: string,
  opts: CoverageOptions = {},
): SourceCoverageResult {
  const gapMin = opts.gapMinChars ?? 60;
  const minText = opts.minTextChars ?? 200;
  const minMarker = opts.minMarkerChars ?? 6;
  const list = Array.isArray(clips) ? clips : [];
  const result: SourceCoverageResult = {
    usable: false,
    textUsable: false,
    totalClips: list.length,
    matchedClips: [],
    missingMarkerClips: [],
    unmatchedMarkerClips: [],
    fuzzyMarkerClips: [],
    outOfOrderClips: [],
    uncoveredSpans: [],
    clipSpans: [],
    coveredRatio: 0,
  };

  const { norm, map } = normalizeWithMap(chapterText);
  if (norm.length < minText) return result; // 原文缺失/过短 → 不检
  result.textUsable = true;
  const usesMarkers = list.some((c) => trimmed(c.sourceStartMarker) && trimmed(c.sourceEndMarker));
  if (!usesMarkers) return result; // 全片没用锚点约定 → 区间机检无从谈起；叙事片的告警由 builder 兜底（见下）
  result.usable = true;

  // 逐 clip 定位：精确 indexOf 优先，未命中退 fuzzy（意译改写不再致盲机检·2026-07-11 ch13 根治）。
  const locate = createMarkerLocator(chapterText, { minMarkerChars: minMarker });
  // 半分辨也记录（start/end 独立）：gap 检测按边界用「左镜 end + 右镜 start」，一端命中即可核对该缝。
  const startHits: Array<MarkerHit | null> = new Array(list.length).fill(null);
  const endHits: Array<MarkerHit | null> = new Array(list.length).fill(null);
  const intervals: Array<{ index: number; start: number; end: number }> = [];
  list.forEach((clip, index) => {
    const rawStart = trimmed(clip.sourceStartMarker);
    const rawEnd = trimmed(clip.sourceEndMarker);
    if (!rawStart && !rawEnd) {
      result.missingMarkerClips.push(index);
      return;
    }
    const sHit = rawStart ? locate(rawStart) : null;
    const eHit = rawEnd ? locate(rawEnd, sHit ? sHit.end : 0) : null;
    startHits[index] = sHit;
    endHits[index] = eHit;
    if (!sHit || !eHit) {
      result.unmatchedMarkerClips.push({
        index,
        which: !sHit && !eHit ? "both" : !sHit ? "start" : "end",
        sample: (rawStart || rawEnd).slice(0, 18),
      });
      return;
    }
    if (!sHit.exact || !eHit.exact) {
      result.fuzzyMarkerClips.push({
        index,
        which: !sHit.exact && !eHit.exact ? "both" : !sHit.exact ? "start" : "end",
        ...(!sHit.exact ? { suggestedStart: sHit.verbatim } : {}),
        ...(!eHit.exact ? { suggestedEnd: eHit.verbatim } : {}),
      });
    }
    const start = sHit.start;
    const end = Math.max(eHit.end, sHit.end);
    intervals.push({ index, start, end });
    result.matchedClips.push(index);
    result.clipSpans.push({ index, chars: end - start });
  });

  // 乱序：命中区间按 plan 顺序，起点递减处＝没按原文时序推进。
  let prevStart = -1;
  for (const iv of intervals) {
    if (prevStart >= 0 && iv.start < prevStart) result.outOfOrderClips.push(iv.index);
    prevStart = iv.start;
  }

  // 覆盖率（严格合并重叠区间，不含空缺容差）。
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else merged.push({ start: iv.start, end: iv.end });
  }
  const coveredLen = merged.reduce((s, m) => s + (m.end - m.start), 0);
  result.coveredRatio = norm.length ? coveredLen / norm.length : 0;

  // 漏段检测·逐边界（2026-07-11 ch13 根治）：旧版要求「全片每段双锚点全命中」才跑，一段意译/
  // 杜撰就整片熄火——ch13 古战场穿行段 ~330 字大洞因此静默放行。改为逐边界独立核对：
  //   相邻两镜中「左镜 end 锚点」与「右镜 start 锚点」都已定位（精确或 fuzzy）→ 该缝隙可核对；
  //   任一端没定位（缺锚点/杜撰）→ 该缝隙不猜（防误报语义保留：那段原文可能正由未定位镜承载）；
  //   乱序镜相邻的缝隙跳过（倒叙/闪回不按原文时序，gap 无意义，已由 outOfOrder 单独报）。
  {
    const raw = String(chapterText || "");
    const outOfOrder = new Set(result.outOfOrderClips);
    const pushSpan = (s: number, e: number, kind: UncoveredSpan["kind"]) => {
      if (e - s <= gapMin) return;
      const origStart = map[Math.min(s, map.length - 1)] ?? 0;
      const origEndClamp = map[Math.min(e, map.length - 1)] ?? map[map.length - 1] ?? raw.length;
      const snippet = raw
        .slice(origStart, Math.min(origStart + 30, origEndClamp + 1))
        .replace(/\s+/g, " ")
        .trim();
      result.uncoveredSpans.push({
        kind,
        approxPct: Math.round((s / norm.length) * 100),
        chars: e - s,
        snippet,
      });
    };
    const firstStart = startHits[0];
    if (firstStart && !outOfOrder.has(0)) pushSpan(0, firstStart.start, "head");
    for (let i = 0; i + 1 < list.length; i++) {
      const left = endHits[i];
      const right = startHits[i + 1];
      if (!left || !right) continue;
      if (outOfOrder.has(i) || outOfOrder.has(i + 1)) continue;
      if (right.start > left.end) pushSpan(left.end, right.start, "gap");
    }
    const lastEnd = endHits[list.length - 1];
    if (lastEnd && !outOfOrder.has(list.length - 1)) pushSpan(lastEnd.end, norm.length, "tail");
  }

  return result;
}

/** 把覆盖率机检结果拼成给叙事终审/小T 看的软告警文案；全清返回 null。 */
export function buildSourceCoverageWarning(
  clips: readonly StoryPlanClip[] | undefined,
  chapterText: string,
  opts: CoverageOptions = {},
): string | null {
  const r = computeSourceCoverage(clips, chapterText, opts);
  if (!r.usable) {
    // 2026-07-11 ch12 实证修正：叙事章节拆段（clips 带 characterRoleNames）全片不填锚点时，
    // 机检曾整片静默失效——「紫霄宫听道」整段内心戏被丢弃且 estimate 零告警。
    // 有足量原文的叙事片，「全片零锚点」本身就是告警（仍是检测纠正，不硬拦）；
    // 无原文/原文过短/非叙事片（无角色名，如 MV 快切）维持不检不误伤。
    const narrative = (Array.isArray(clips) ? clips : []).some(
      (c) => Array.isArray(c.characterRoleNames) && c.characterRoleNames.length > 0,
    );
    if (r.textUsable && r.totalClips > 0 && narrative) {
      return (
        `【原文覆盖率机检·确定性告警（喂给叙事终审·非硬拦）】` +
        `⚠️全片 ${r.totalClips} 段没有任何一段带 sourceStartMarker/sourceEndMarker——零遗漏机检整片失效，` +
        `改编丢内容将无从检出（改编只许补全、不许删减）。叙事章节拆段每段必须从原文原样复制约 20 字起止锚点` +
        `（相邻段首尾相接、瓷砖铺满整章），补齐后重新 estimate 让机检核对覆盖。`
      );
    }
    return null;
  }

  const lines: string[] = [];
  const kindLabel: Record<UncoveredSpan["kind"], string> = { head: "开头", gap: "中间", tail: "结尾" };

  if (r.uncoveredSpans.length) {
    const shown = r.uncoveredSpans.slice(0, 4);
    const detail = shown
      .map(
        (sp) =>
          `原文${kindLabel[sp.kind]}约${sp.approxPct}%处有${sp.chars}字未被任何镜头覆盖「${sp.snippet}…」`,
      )
      .join("；");
    const more = r.uncoveredSpans.length > 4 ? `（另 ${r.uncoveredSpans.length - 4} 处）` : "";
    lines.push(
      `⚠️零遗漏机检不通过——${detail}${more}。这些原文节拍没进任何 clip＝改编丢内容，` +
        `把它们补成镜头（相邻段 end_marker 之后紧接下段 start_marker、瓷砖铺满整章无缝隙），别删句。`,
    );
  }

  if (r.matchedClips.length === 0 && r.unmatchedMarkerClips.length) {
    lines.push(
      `⚠️全部 ${r.unmatchedMarkerClips.length} 段的原文锚点都无法在章节原文里逐字命中——` +
        `锚点疑似改写/杜撰而非原文逐字片段。sourceStartMarker/EndMarker 必须从原文原样复制约 20 字（含标点），` +
        `否则零遗漏机检失效、真相源失守。`,
    );
  } else if (r.unmatchedMarkerClips.length) {
    const list = r.unmatchedMarkerClips
      .slice(0, 6)
      .map(
        (u) =>
          `clip${u.index}(${u.which === "both" ? "起止" : u.which === "start" ? "起始" : "结束"}锚点未命中)`,
      )
      .join("、");
    lines.push(
      `⚠️部分镜锚点未在原文逐字命中（fuzzy 也定位不到＝疑似杜撰或过短）：${list}——从原文原样复制约 20 字（太短的锚点同样视为不可靠），否则这些段的覆盖无法核对、可能悄悄漏内容。`,
    );
  }

  if (r.fuzzyMarkerClips.length) {
    const list = r.fuzzyMarkerClips
      .slice(0, 6)
      .map((f) => {
        const pos = f.which === "both" ? "起止" : f.which === "start" ? "起始" : "结束";
        const sug = [f.suggestedStart, f.suggestedEnd].filter(Boolean).map((s) => `「${s}」`).join("/");
        return `clip${f.index}(${pos}锚点非逐字${sug ? `→原文实为${sug}` : ""})`;
      })
      .join("、");
    lines.push(
      `⚠️部分镜锚点是意译改写、非原文逐字（机检已按相似度定位，本次仍可核对）：${list}——` +
        `锚点必须从原文原样复制粘贴（含繁简/标点），意译会降低机检可靠性。`,
    );
  }

  if (r.missingMarkerClips.length) {
    const list = r.missingMarkerClips.slice(0, 8).map((i) => `clip${i}`).join("、");
    lines.push(
      `⚠️镜 ${list} 未填 sourceStartMarker/EndMarker（其余段已填）——补上原文起止锚点，零遗漏机检才能覆盖全片。`,
    );
  }

  if (r.outOfOrderClips.length) {
    const list = r.outOfOrderClips.slice(0, 8).map((i) => `clip${i}`).join("、");
    lines.push(
      `⚠️镜 ${list} 的起始锚点早于前一段＝分段乱序（未按原文顺序推进），确认叙事时序是否有意（倒叙/闪回）。`,
    );
  }

  if (!lines.length) return null;
  return (
    `【原文覆盖率机检·确定性告警（喂给叙事终审·非硬拦）】把「反向映射回原文·逐句覆盖到结尾」从口号变成可核对——` +
    `按每段 sourceStartMarker/EndMarker 回原文拼图，机器逐字算出的遗漏/错位（LLM 通读容易漏），进 start/出片前先在 clipPrompt 修掉：\n` +
    lines.map((l) => `· ${l}`).join("\n")
  );
}

// —— 锚点候选提取（拒因可执行化·2026-07-28）————————————————————————————————
// 根因：sourceMarker/sourceEndMarker 类拒因此前只说「定位不到」「太短」，不给出路。规划层于是陷入
// 「读原文→猜一个→被拒→再读」的循环，实测 ch1197 v19 连续 4 次拒因里 3 次是锚点/索引类，
// 第二轮甚至把 turn 预算全烧在反复取证上、压根没走到 commit。
// 校验器手上本就握着章节原文与本拍跨度，缺的只是把它吐出来：把「自己猜一个」变成「从清单里挑一个」。
const CANDIDATE_SPLIT_RE = /[。！？；\n]+/;

/**
 * 从原文的指定归一化跨度内，摘出若干「长度达标、可逐字定位」的锚点候选。
 * 按句切分后取原文原样片段——规划层直接抄任一条即可通过定位与长度双校验。
 */
export function suggestSourceMarkerCandidates(input: {
  chapterText: string;
  /** 归一化坐标系下的跨度；缺省为全文。 */
  fromNorm?: number;
  toNorm?: number;
  minChars?: number;
  limit?: number;
}): string[] {
  const raw = String(input.chapterText || "");
  if (!raw.trim()) return [];
  const minChars = input.minChars ?? DEFAULT_MIN_SOURCE_MARKER_CHARS;
  const limit = Math.max(1, input.limit ?? 5);
  const { norm, map } = normalizeWithMap(raw);
  if (!norm.length || !map.length) return [];
  const from = Math.max(0, Math.min(input.fromNorm ?? 0, norm.length));
  const to = Math.max(from, Math.min(input.toNorm ?? norm.length, norm.length));
  const originalStart = map[Math.min(from, map.length - 1)] ?? 0;
  const originalEnd = (map[Math.min(Math.max(to - 1, 0), map.length - 1)] ?? raw.length - 1) + 1;
  const slice = raw.slice(originalStart, originalEnd);
  const out: string[] = [];
  for (const piece of slice.split(CANDIDATE_SPLIT_RE)) {
    const text = piece.trim();
    if (!text) continue;
    // 达标判据与校验器一致：归一化后实义字符数 >= minChars，确保抄回来必然过闸。
    if (normalizeWithMap(text).norm.length < minChars) continue;
    out.push(text.length > 40 ? text.slice(0, 40) : text);
    if (out.length >= limit) break;
  }
  return out;
}
