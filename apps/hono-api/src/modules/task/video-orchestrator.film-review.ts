/**
 * 成片剪辑师可选诊断：concat 产出整片后，可用视频理解模型对照
 * 成片审核 V1-V7 铁律（蒸馏自 agents-cli skill `tapcanvas-video-reviewer` 的 mode=video 标准）
 * 做一次导演级整片 QA，verdict 落在成片 composeVideo 节点 data 上：
 *   filmReviewVerdict(pass|fail) / filmReviewScore / filmReviewDimensions / filmReviewFailed /
 *   filmReviewSuggestion / filmReviewErrorCount。
 *
 * - 通过 → 节点记录 pass 诊断。
 * - 不通过 → 节点记录 fail + 失败项 + 修复建议，run 仍进 concatenated（**绝不自动整片返工烧钱**），
 *   由小T/用户按建议决定是否返工（小T 会把 verdict 翻成人话呈现，不裸 JSON）。
 * - 审片调用连续出错 ≥FILM_REVIEW_MAX_ERRORS 次 → skipped 放行，绝不让审片故障卡死 run。
 *
 * flag VIDEO_FINAL_REVIEW 默认 OFF（出片后不自动审片）；concat 直接进终态。
 * 显式开 VIDEO_FINAL_REVIEW=true 才追加整片审片诊断；诊断不得延迟或否决交付。
 */

export const FILM_REVIEW_MAX_ERRORS = 2;

export type FilmReviewDimensions = {
  fidelity: number;
  visual: number;
  motion: number;
  coherence: number;
  aesthetic: number;
  usable: number;
  overall: number;
};

export type FilmReviewVerdict = {
  verdict: "pass" | "fail";
  score: number;
  dimensionScores: FilmReviewDimensions | null;
  failedCriteria: Array<{ id: string; name: string; reason: string }>;
  passCriteria: string[];
  suggestion: string;
  // 失败镜归因（1-based 段号，对应 prompt 里的「第N段」）：仅用于只读诊断展示。
  // 空数组 = 模型未归因到具体段；任何 verdict 都不得触发自动返工。
  failedClipIndices: number[];
};

export type FilmReviewNodeState = {
  verdict: string;
  errors: number;
};

export function readFilmReviewState(
  data: Record<string, unknown> | undefined,
): FilmReviewNodeState {
  const d = data ?? {};
  const verdict =
    typeof d.filmReviewVerdict === "string" ? d.filmReviewVerdict.trim() : "";
  const errors = Number(d.filmReviewErrorCount);
  return {
    verdict,
    errors: Number.isFinite(errors) && errors > 0 ? Math.trunc(errors) : 0,
  };
}

/**
 * 成片审片 prompt：对照成片审核 V1-V7。
 * ⚠️ **判据唯一真相源 = agents-cli skill `tapcanvas-video-reviewer` mode=video（V1-V7 表）**；
 * 本函数是它的服务端镜像（跨 app 无法 import，只能镜像）。改判据请**先改该 skill 再同步此处**，
 * 否则两份漂移（V3「质感·去AI味」、V4「动作·表演不木偶」已与 skill 对齐）。
 */
export function buildFilmReviewPrompt(input: {
  logline?: string;
  targetDurationSeconds?: number;
  clipPrompts?: string[];
}): string {
  const duration = input.targetDurationSeconds
    ? `${input.targetDurationSeconds}s`
    : "未知";
  const intent = [
    input.logline ? `整片立意：${input.logline}` : "",
    Array.isArray(input.clipPrompts) && input.clipPrompts.length
      ? `分段设计意图：\n${input.clipPrompts
          .map((p, i) => `· 第${i + 1}段：${String(p || "").slice(0, 280)}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return [
    "你是 TapCanvas 的成片剪辑师/审片师。下面是这条整片的设计意图，请观看实际成片后逐条对照 V1-V7 铁律做导演级审片。",
    "",
    `【成片设计意图】（目标时长 ${duration}）`,
    intent || "（无额外设计说明，按通用叙事成片标准审）",
    "",
    "【成片审核标准 V1-V7】逐条判 pass/fail，全部满足才整体 pass：",
    "V1 角色身份连贯：全程角色脸/服饰/体型与设定一致，无身份漂移、无串脸；多角色同框可区分。",
    "V2 时序结构清晰：呈现「上下文→关键动作→反应」的铺垫，不是单一动作堆砌，至少 3 个时间段的画面变化。",
    "V3 质感落地·去AI味：实际影调/光线/焦段感与设计描述一致（夜景就是夜景冷调、写实就别漂成插画）；写实/真人档无明显「AI 塑料味」——皮肤不像塑料/打蜡、不过度磨皮无毛孔、暗部不纯黑死黑无细节、高光不死白连成一片、画面不是零颗粒零空气介质的渲染图般过度干净（anime/二维/插画档不适用此条）。【局部豁免】设计意图中明确标注为 Q版/SD/变形/chibi 内心戏插入段的镜头（心理外化手法故意切画风），该段不按写实「去AI味」判，只要求其 Q版风格在插入段内部一致、进出有写实锚帧框住即可，不得因该段不写实而判 V3 fail。",
    "V4 动作物理合理·表演不木偶：设计的具体动作正确呈现，无穿模/畸变/幻影微光/手指错位；表演有变化非木偶脸、日常镜也不演过头。",
    "V5 视觉一致性：无日夜混乱、运镜与设计一致、不切换互斥风格、镜间衔接连贯不跳。",
    "V6 无禁止元素：无意外 BGM 盖人声/乱码字幕/水印/随机文字；应禁止的画风未出现。",
    "V7 成片可用：整体可直接作成片交付，无致命瑕疵（脸崩/肢体错位/比例失调/严重闪烁）。",
    "",
    "只输出一个 JSON 对象，不要任何其它文字：",
    '{"verdict":"pass|fail","score":0-7,"dimensionScores":{"fidelity":0-10,"visual":0-10,"motion":0-10,"coherence":0-10,"aesthetic":0-10,"usable":0-10,"overall":0-100},"failedCriteria":[{"id":"V?","name":"标准名","reason":"一句话"}],"failedClipIndices":[出问题的段号],"passCriteria":["V1","..."],"suggestion":"若 fail 给一句最小返工方向，pass 可空"}',
    "判定规则：V1-V7 任一明显不达标即该项进 failedCriteria；verdict=pass 当且仅当 7 条全过（score=7）。",
    "failedClipIndices：把每条 fail 尽量精确归因到上面「第N段」的段号（用 1 起始的整数，如第3段串脸就填 3），可多段；定位不到具体段时留空数组。该字段只用于诊断展示，不触发自动返工。",
  ].join("\n");
}

/** 宽容解析成片审片 verdict：截首个 {...} 块；解析失败或缺 verdict 返回 null（调用方按错误计数处理）。 */
export function parseFilmReviewVerdict(text: string): FilmReviewVerdict | null {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const rec = obj as Record<string, unknown>;
  const v = String(rec.verdict ?? "").trim().toLowerCase();
  if (v !== "pass" && v !== "fail") return null;

  const num = (x: unknown): number => {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  };
  let dims: FilmReviewDimensions | null = null;
  const ds = rec.dimensionScores;
  if (ds && typeof ds === "object" && !Array.isArray(ds)) {
    const d = ds as Record<string, unknown>;
    dims = {
      fidelity: num(d.fidelity),
      visual: num(d.visual),
      motion: num(d.motion),
      coherence: num(d.coherence),
      aesthetic: num(d.aesthetic),
      usable: num(d.usable),
      overall: num(d.overall),
    };
  }
  const failedCriteria = Array.isArray(rec.failedCriteria)
    ? rec.failedCriteria
        .map((f) => {
          const fr = (f ?? {}) as Record<string, unknown>;
          return {
            id: String(fr.id ?? "").trim(),
            name: String(fr.name ?? "").trim(),
            reason: String(fr.reason ?? "").trim(),
          };
        })
        .filter((f) => f.id || f.name || f.reason)
    : [];
  const passCriteria = Array.isArray(rec.passCriteria)
    ? rec.passCriteria.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];
  const failedClipIndices = Array.isArray(rec.failedClipIndices)
    ? rec.failedClipIndices.filter(
        (n): n is number => typeof n === "number" && Number.isFinite(n) && Number.isInteger(n),
      )
    : [];
  return {
    verdict: v,
    score: Math.max(0, Math.min(7, Math.trunc(num(rec.score)))),
    dimensionScores: dims,
    failedCriteria,
    passCriteria,
    suggestion: String(rec.suggestion ?? "").trim().slice(0, 500),
    failedClipIndices,
  };
}

/** verdict → 写到成片 composeVideo 节点的 data 字段（结构化存储，供 UI/小T 翻成人话呈现）。 */
export function formatFilmReviewNodeData(
  verdict: FilmReviewVerdict,
): Record<string, unknown> {
  return {
    filmReviewVerdict: verdict.verdict,
    filmReviewScore: verdict.score,
    ...(verdict.dimensionScores
      ? { filmReviewDimensions: verdict.dimensionScores }
      : {}),
    ...(verdict.failedCriteria.length
      ? { filmReviewFailed: verdict.failedCriteria }
      : {}),
    ...(verdict.passCriteria.length
      ? { filmReviewPassed: verdict.passCriteria }
      : {}),
    ...(verdict.suggestion ? { filmReviewSuggestion: verdict.suggestion } : {}),
  };
}
