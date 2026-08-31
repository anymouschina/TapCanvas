/**
 * 【物理自洽合同·2026-07-28 ch1197-v18 实证】三条确定性闸，堵住"写出来就荒谬"的产物。
 *
 * v18 成片实证的病灶：规划层凭空发明"苏晓直接抛出而非递交"并盖上 necessary_physical_result
 * 的章，于是它成为 causality 硬覆盖项、分镜层无权拒绝；同一 clip 又把"围在木门与短阶附近"
 * （贴身距离）和"抛物线/抛接轴线"（远距离动作）同时写成硬约束。渲染层判断这个距离抛不起来，
 * 悄悄把"抛"渲染成"递"，但上一镜又真的渲染了一颗飞行火球 → 成片自相矛盾，观众直接看出荒谬。
 *
 * 现有闸只管对白容量、说话人逐字相等、因果覆盖率，没有任何一条管"这个距离能不能做这个动作"，
 * 所以这类矛盾一路过闸。三条闸全是纯文本确定性判据：可单测、零 LLM 成本、判据不散写在调用点。
 */

/** 改变物理接触关系的"投掷"类动作词——近距离下做这些动作即荒谬。 */
const THROW_ACTION_WORDS = ["抛", "扔", "掷", "投掷", "丢", "甩出", "抛物线", "抛接"];

/** 贴身/伸手可及距离的判据词。只收明确表述近距离的，"面向/朝向"不算（远距离也能面向）。 */
const NEAR_DISTANCE_WORDS = [
  "面对面",
  "围在",
  "围拢",
  "伸手可及",
  "一臂之内",
  "一臂距离",
  "咫尺",
  "贴身",
  "近在眼前",
  "前倾半步",
  "身前半步",
  "手可触及",
];

/** 大范围景别词——这些景别下单个角色不可能占画面高度半数。 */
const WIDE_FRAMING_WORDS = ["大全景", "远景", "大远景", "全景俯瞰", "航拍"];

/** 声明"单人占画面近半或更多"的尺度词。 */
const LARGE_SCALE_PATTERNS = [
  /画面高度(五成|六成|七成|八成|九成|一半|过半)/,
  /占画面(五成|六成|七成|八成|九成|一半|过半)/,
  /(50|60|70|80|90)\s*%\s*画面/,
  /画面高度\s*(5|6|7|8|9)\s*成/,
];

export type PhysicalCoherenceIssue = { path: string; problem: string };

function hitWords(text: string, words: readonly string[]): string[] {
  return words.filter((w) => text.includes(w));
}

/**
 * 闸 B：同一 clip 内不得同时把"贴身距离"和"投掷动作"写成硬约束。
 *
 * 判据取 clip 的全部空间性文本：镜头 action/framing/composition、以及 writer 自己写的
 * assetObjectContracts.spatialRelation。两类词同时命中即判失败——不猜哪个对，交回 writer
 * 二选一（拉开距离并给出戒备理由，或改成递交）。这是 v18 唯一能在写作期拦住的病灶。
 */
export function validateClipSpatialCoherence(clip: {
  shots?: Array<Record<string, unknown>> | null;
  startKeyframe?: string | null;
  assetObjectContracts?: Array<Record<string, unknown>> | null;
}): PhysicalCoherenceIssue[] {
  const spatialTexts: Array<{ path: string; text: string }> = [];
  (clip.shots ?? []).forEach((shot, index) => {
    const no = String(shot?.shotNo ?? index + 1);
    for (const field of ["action", "framing", "composition"] as const) {
      const text = String(shot?.[field] ?? "");
      if (text) spatialTexts.push({ path: `shots[镜${no}].${field}`, text });
    }
  });
  if (clip.startKeyframe) spatialTexts.push({ path: "startKeyframe", text: String(clip.startKeyframe) });
  (clip.assetObjectContracts ?? []).forEach((contract, index) => {
    const name = String(contract?.name ?? index);
    const text = String(contract?.spatialRelation ?? "");
    if (text) spatialTexts.push({ path: `assetObjectContracts[${name}].spatialRelation`, text });
  });

  const joined = spatialTexts.map((t) => t.text).join("\n");
  const nearHits = hitWords(joined, NEAR_DISTANCE_WORDS);
  const throwHits = hitWords(joined, THROW_ACTION_WORDS);
  if (!nearHits.length || !throwHits.length) return [];

  const nearPaths = spatialTexts.filter((t) => hitWords(t.text, NEAR_DISTANCE_WORDS).length).map((t) => t.path);
  const throwPaths = spatialTexts.filter((t) => hitWords(t.text, THROW_ACTION_WORDS).length).map((t) => t.path);
  return [{
    path: "clip.spatialCoherence",
    problem:
      `同一 clip 同时声明贴身距离（${nearHits.join("/")} @ ${nearPaths.slice(0, 3).join("、")}）` +
      `与投掷动作（${throwHits.join("/")} @ ${throwPaths.slice(0, 3).join("、")}）——` +
      "这个距离做投掷在画面上必然荒谬。二选一改写：要么把人物距离在首镜就明确拉开并给出戒备/不信任的动机，" +
      "要么把投掷改为递交/放置并相应改写接取方的反应（不得再写被冲量带退）。",
  }];
}

/**
 * 闸 C：景别与尺度链互斥校验。
 *
 * v18 实测：镜1 framing 写"大全景，建立木屋与四人空间关系"，资产合同却要求苏晓"全身约画面
 * 高度五成"。大全景里单人不可能占五成——渲染忠实执行大全景，尺度链被静默作废（成片里主角
 * 小到读不出来，观众收不到"回到现实"的信号，这就是"承接不好"的直接来源）。
 * 两者现在可以各写各的，加这条让矛盾在写作期就暴露。
 */
export function validateClipScaleFramingCoherence(clip: {
  shots?: Array<Record<string, unknown>> | null;
  assetObjectContracts?: Array<Record<string, unknown>> | null;
}): PhysicalCoherenceIssue[] {
  const wideShots = (clip.shots ?? [])
    .map((shot, index) => ({
      no: String(shot?.shotNo ?? index + 1),
      framing: String(shot?.framing ?? ""),
    }))
    .filter((shot) => hitWords(shot.framing, WIDE_FRAMING_WORDS).length);
  if (!wideShots.length) return [];
  // 只有全片镜头都是大范围景别时才判矛盾：clip 内有近景镜时，尺度链可挂在那一镜上。
  const hasCloserShot = (clip.shots ?? []).some(
    (shot) => String(shot?.framing ?? "") && !hitWords(String(shot?.framing ?? ""), WIDE_FRAMING_WORDS).length,
  );
  if (hasCloserShot) return [];

  const issues: PhysicalCoherenceIssue[] = [];
  (clip.assetObjectContracts ?? []).forEach((contract, index) => {
    const name = String(contract?.name ?? index);
    const scale = String(contract?.scale ?? "");
    if (!scale) return;
    if (!LARGE_SCALE_PATTERNS.some((re) => re.test(scale))) return;
    issues.push({
      path: `assetObjectContracts[${name}].scale`,
      problem:
        `本 clip 全部镜头均为大范围景别（${wideShots.map((s) => `镜${s.no}:${s.framing.slice(0, 12)}`).join("、")}），` +
        `但尺度链声明"${scale.slice(0, 40)}"——大全景/远景下单个对象不可能占画面近半，该尺度链会被渲染静默作废。` +
        "改写：要么补一个中近景镜承载该尺度链，要么把尺度链改成与大景别相符的比例。",
    });
  });
  return issues;
}

/** "不是 A 而是 B"式的手法选择句式——这是作者的取舍，不是物理必然。 */
const CHOICE_CONSTRUCTS = ["而非", "而不是", "不是递", "并非", "取代", "代替"];

/**
 * 闸 A：necessary_physical_result 不得给"动作手法的自由选择"盖章。
 *
 * v18 根因：essentialCausality[4]="苏晓直接抛出而非递交" 挂在 necessary_physical_result 下，
 * 而原文 source_fact 只有"核心是战利品/教士掏出机械心脏/声望11400"三条——"抛"是规划代理凭空
 * 发明的。盖章后它进入 causality 硬覆盖，分镜层必须演、preflight 还会校验覆盖率，等于把一个
 * 编造的手法升格成不可推翻的合同。
 *
 * 判据：necessary_physical_result 条目若含投掷类动作词，或含"而非/而不是"这类手法取舍句式，
 * 则必须能在同一 beat 的某条 source_fact 里找到同一动作词作为依据；找不到即判非法。
 * 真正的必要物理结果（照亮、接住、握紧、后退、烟尘扬起）不含这些词，不受影响。
 */
export function validateCausalProvenanceDiscipline(input: {
  beatIndex: number;
  essentialCausality: readonly string[];
  causalProvenance: readonly { evidenceType: string; sourceMarker: string }[];
}): string[] {
  const sourceFactText = input.causalProvenance
    .filter((p) => p.evidenceType === "source_fact")
    .map((p) => p.sourceMarker)
    .join("\n");
  const errors: string[] = [];
  input.essentialCausality.forEach((causality, index) => {
    const provenance = input.causalProvenance[index];
    if (!provenance || provenance.evidenceType !== "necessary_physical_result") return;
    const throwHits = hitWords(causality, THROW_ACTION_WORDS);
    const choiceHits = hitWords(causality, CHOICE_CONSTRUCTS);
    if (!throwHits.length && !choiceHits.length) return;
    // 投掷动作有原文依据时放行（原文真写了"抛"就不算发明）。
    if (throwHits.length && throwHits.some((w) => sourceFactText.includes(w)) && !choiceHits.length) return;
    errors.push(
      `beats[${input.beatIndex}].pacingDecision.essentialCausality[${index}]「${causality.slice(0, 40)}」` +
      `标为 necessary_physical_result，但它${choiceHits.length ? `含手法取舍句式（${choiceHits.join("/")}）` : `含投掷动作（${throwHits.join("/")}）`}` +
      "且无同 beat source_fact 支撑——这是作者自选手法而非物理必然，不得盖章升格为硬因果。" +
      "改法：要么补一条真正引用原文的 source_fact，要么把该条从 essentialCausality 移除（手法交给分镜层自由决定）。",
    );
  });
  return errors;
}
