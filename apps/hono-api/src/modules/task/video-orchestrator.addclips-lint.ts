// 【add_clips 批次即时确定性 lint · 质检左移（2026-07-04 用户「提高质检前质量·一次质检通过」）】
//
// 病根（ch3《说谎》六会话实测）：未知角色名错字（「白大褥男」失配锁脸）、对白容量超载、群像镜缺群像图
// 这些确定性问题以前要到 estimate/start 才反馈——那时整章 20+ 段已全部灌完，改一个字只能整批 reset 重发
// （实测 21 段镜头表被重灌了 4 遍）。左移到 add_clips：每批 1-4 段收批当场反馈，小T 当场改当场重发这一批，
// 到 estimate/critic 时已是干净版 → 一次过审。
//
// 全部确定性规则都只产生可检索诊断，不拦批、不把语义质量升级为任务终态；
// 真正保留的边界只属于权限、协议、计费幂等、真实资产 URL 与供应商硬上限。
// 与 estimate 期 narrative-lint / start 期 unknown-role-ref 同口径，不引入新判据分叉。

import {
  extractClipDialogueLoad,
  resolveClipPaceRate,
  DEFAULT_DIALOGUE_CHARS_PER_SEC,
  DIALOGUE_PACE_CEILING,
} from "./video-orchestrator.dialogue-capacity";
import { readClipSpeakerBindings } from "./video-orchestrator.speaker-contract";
// clipNeedsBlockingDiagram：与 shots 闸同口径的俯视站位图判定（clip 自身文本·不吃 filmBible 污染）。
import { clipNeedsEnsemble, clipNeedsBlockingDiagram } from "./video-orchestrator.asset-selfheal";
import type { StoryPlanClip } from "./video-orchestrator.orchestrate";

/** 小编辑距离（≤2 提前剪枝）：用于「白大褥男→白大褂男」这类单字错字的纠错建议。 */
export function smallEditDistance(a: string, b: string, cap = 2): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > cap) return cap + 1;
  const dp = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) dp[j] = j;
  for (let i = 1; i <= la; i++) {
    let prev = dp[0];
    dp[0] = i;
    let rowMin = dp[0];
    for (let j = 1; j <= lb; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
      if (dp[j] < rowMin) rowMin = dp[j];
    }
    if (rowMin > cap) return cap + 1;
  }
  return dp[lb];
}

/** 在已知角色名里给未知名找最像的纠错候选（编辑距离 ≤1，或互为包含且长度差 ≤2）。无则 null。 */
export function suggestKnownRoleName(
  unknown: string,
  knownNames: ReadonlySet<string>,
): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const known of knownNames) {
    const d = smallEditDistance(unknown, known, 1);
    if (d <= 1 && d < bestDist) {
      best = known;
      bestDist = d;
    }
  }
  if (best) return best;
  for (const known of knownNames) {
    if (
      Math.abs(known.length - unknown.length) <= 2 &&
      known.length >= 2 &&
      unknown.length >= 2 &&
      (known.includes(unknown) || unknown.includes(known))
    ) {
      return known;
    }
  }
  return null;
}

export type AddClipsLintContext = {
  /** 画布 + 素材库里已有卡的角色名集合。 */
  knownRoleNames: ReadonlySet<string>;
  /** 画布上群像图节点 id 集合（referenceType=ensemble 或 label 含「群像」）——2026-07-04 起逐镜绑定检查。 */
  ensembleNodeIds: ReadonlySet<string>;
  /** 本批第一段的全局镜号（= 累积前已有段数），报告用「镜N」与最终 clipIndex 一致。 */
  baseIndex: number;
  /** 念白语速（字当量/秒），与 estimate 同源。 */
  paceRate?: number;
  /** 此前批次已出场过的具名角色（累积区里 characterRoleNames 的并集）——人物介绍字卡只查首次出场。 */
  introducedRoleNames?: ReadonlySet<string>;
};

/**
 * 对一批刚提交的分段跑确定性 lint，返回告警行（空数组 = 全净）。
 * 检查项：
 *  ① characterRoleNames / 台词「@角色」标记未解析到已建卡角色（含错字纠错建议）——失配 = 该镜锁脸/锁嗓静默失效；
 *  ② 对白容量：带引号对白的镜缺显式 durationSeconds，或字数装不下时长；
 *  ③ 群像镜（≥3 具名同框或人群取景词）但画布尚无群像图——记录资产绑定诊断，供同链修订参考。
 */
export function lintIncomingClips(
  clips: readonly unknown[],
  ctx: AddClipsLintContext,
): string[] {
  const warnings: string[] = [];
  const paceDefault = ctx.paceRate ?? DEFAULT_DIALOGUE_CHARS_PER_SEC;
  const ensembleGapClips: number[] = [];
  const blockingGapClips: number[] = [];
  const exitStateGapClips: number[] = [];
  // 人物介绍字卡首出登记：从此前批次已出场角色起算（章节链路含跨章种子），批内滚动累积。
  const introduced = new Set(ctx.introducedRoleNames ?? []);
  const introCardGaps: Array<{ clipNo: number; roles: string[] }> = [];
  const introCardExcess: Array<{ clipNo: number; roles: string[] }> = [];

  clips.forEach((raw, offset) => {
    const clip = (raw && typeof raw === "object" ? raw : {}) as StoryPlanClip &
      Record<string, unknown>;
    const clipNo = ctx.baseIndex + offset + 1; // 1-based，全局镜号
    const clipPrompt = String(clip.clipPrompt ?? "");

    // ① 角色名解析（画面角色 + speakerBindings 中 assetKind=character 的说话人）。
    // 纯声音通道不要求图片角色卡；禁止从 dialogue 文案猜说话人类型。
    const referenced = new Set<string>();
    if (Array.isArray(clip.characterRoleNames)) {
      for (const r of clip.characterRoleNames) {
        const nm = String(r ?? "").trim();
        if (nm) referenced.add(nm);
      }
    }
    for (const binding of readClipSpeakerBindings(clip).bindings) {
      if (binding.assetKind === "character") referenced.add(binding.name);
    }
    for (const name of referenced) {
      if (ctx.knownRoleNames.has(name)) continue;
      const suggestion = suggestKnownRoleName(name, ctx.knownRoleNames);
      warnings.push(
        suggestion
          ? `段${clipNo}（clipIndex=${clipNo - 1}）引用「${name}」未建卡——疑为「${suggestion}」的错字。characterRoleNames 与台词「@角色」标记必须与卡上 roleName 逐字一致，否则该镜锁脸/锁嗓静默失效。请改成「${suggestion}」后用 replaceAtIndex 重发本段。`
          : `段${clipNo}（clipIndex=${clipNo - 1}）引用「${name}」在画布/素材库均无角色卡——先建 roleName=「${name}」的角色卡（或改成已有卡名），否则该镜参考图绑定失效、身份漂移。`,
      );
    }

    // ② 对白容量（单镜口径，与 dialogue-capacity 同算法）。
    const load = extractClipDialogueLoad(clip);
    if (load > 0 && clip.dialogueDurationReviewed !== true) {
      const rate = resolveClipPaceRate(clip, paceDefault);
      const required = Math.ceil(load / rate);
      const dur = Number(clip.durationSeconds);
      if (!Number.isFinite(dur) || dur <= 0) {
        warnings.push(
          `段${clipNo}（clipIndex=${clipNo - 1}）有对白（${load} 字当量）但缺显式 durationSeconds——按 ${rate} 字/秒需 ≥${required}s，请补时长。`,
        );
      } else if (load > dur * rate) {
        // 【可行解直给（2026-07-17 ch1 三次假死结复盘）】缺口常常只有 1-2s——直接替 writer 算出
        // 「标多少语速就装下」，避免 LLM 在脑内按保守 4 字/秒得出"数学死结"回去问用户。
        const fitRate = Math.ceil((load / dur) * 10) / 10;
        const paceHint =
          fitRate <= DIALOGUE_PACE_CEILING
            ? `⭐本段按 ≥${fitRate} 字/秒即装下——由 Agent 根据真实表演情境决定是否提交数值 dialoguePaceRate:${fitRate}；若无依据则增加时长或重分配完整语句，内容一字不动；`
            : `本段即使按物理上限 ${DIALOGUE_PACE_CEILING} 字/秒仍差 ${Math.max(1, Math.ceil(load / DIALOGUE_PACE_CEILING - dur))}s——语速救不了，走重排/拆镜；`;
        warnings.push(
          `段${clipNo}（clipIndex=${clipNo - 1}）对白超容：${load} 字当量塞 ${dur}s（按 ${rate} 字/秒只够念 ${Math.floor(dur * rate)} 字，需 ≥${required}s）——念不完会被碎读/截断。${paceHint}段未到 15s 顶=加时长或拆镜按序念全；已到顶=优先把尾部台词顺延到下一镜开头跨镜重排（总段数不变）；别删句。`,
        );
      }
    }

    // ③ 群像镜必须逐镜绑群像图（2026-07-04 ch7 实测：画布有图但镜未绑照样漂移）。
    if (clipNeedsEnsemble(clip)) {
      const refs = Array.isArray(clip.videoReferenceNodeIds) ? clip.videoReferenceNodeIds : [];
      const bound = refs.some((id) => ctx.ensembleNodeIds.has(String(id ?? "").trim()));
      if (!bound) ensembleGapClips.push(clipNo);
    }

    // ④ agents 已明确声明 spatialBlocking 的镜头必须绑定真实站位图。
    if (clipNeedsBlockingDiagram(clip)) blockingGapClips.push(clipNo);

    // ⑥ 人物介绍字卡（2026-07-06 ch2 实测：canned intent 硬要求被整章漏掉+hardRules「无烧屏文字」
    // 反向压制；2026-07-07 用户拍板改「全剧首次」口径：introducedRoleNames 由调用方带上跨章
    // 已出场种子，复用角色不再算首出、也禁再叠字卡）：具名角色全剧首次出场的段，shots/clipPrompt
    // 里必须出现「人物介绍字卡」字样；反之，本镜之前已出场的角色再叠字卡 → 要求删除。
    // opt-in：调用方传 introducedRoleNames（章节成片链路）才启用；未传=旧行为零回归。
    if (ctx.introducedRoleNames) {
      const clipText = `${JSON.stringify((clip as { shots?: unknown }).shots ?? "")}${clipPrompt}`;
      const firstTimers: string[] = [];
      if (Array.isArray(clip.characterRoleNames)) {
        for (const r of clip.characterRoleNames) {
          const nm = String(r ?? "").trim();
          if (!nm) continue;
          if (!introduced.has(nm) && !firstTimers.includes(nm)) firstTimers.push(nm);
        }
      }
      // 【boilerplate 撞词免疫·2026-07-12 ch17「巖」无字卡漏网实证】旧检查对整段 clipText 做
      // substring——硬约束固定头「无字幕(人物介绍字卡除外)」的模板措辞撞上关键词 → 误判已有字卡。
      // 真字卡证据 = shots 结构里出现、或 clipPrompt 的非豁免声明行出现（含「除外/例外/唯一允许」的行不算）。
      const shotsOnlyText = JSON.stringify((clip as { shots?: unknown }).shots ?? "");
      const hasRealIntroCard =
        shotsOnlyText.includes("人物介绍字卡") ||
        clipPrompt
          .split(/\n/)
          .some((line) => line.includes("人物介绍字卡") && !/除外|例外|唯一允许|豁免/.test(line));
      if (firstTimers.length && !hasRealIntroCard) {
        introCardGaps.push({ clipNo, roles: firstTimers });
      }
      // 反向：字卡点名的角色若在本镜之前已出场（跨章复用/本片前镜已介绍）→ 不许再标。
      // 名字从「人物介绍字卡：<姓名>｜」「…字卡『<姓名>｜…』」两类写法里抽取。
      const excessRoles: string[] = [];
      for (const m of clipText.matchAll(
        /人物介绍字卡\s*[：:『「]?\s*([^『「」』｜|：:，。、\s]{1,20})\s*[｜|]/g,
      )) {
        const nm = m[1]?.trim() ?? "";
        if (nm && introduced.has(nm) && !excessRoles.includes(nm)) excessRoles.push(nm);
      }
      if (excessRoles.length) introCardExcess.push({ clipNo, roles: excessRoles });
      for (const nm of firstTimers) introduced.add(nm);
    }

    // ⑦ 台词镜口型可靠性三查（2026-07-06 seedance-2.0 竞品调研 audio-guide/model-mechanics：
    // 口型是音画联合约束，"every extra head or camera motion tightens it"；可靠同步单位=一口气一句；
    // 多镜每子镜 ≈4-6s，塞短了 beats 挨饿被压缩跳拍）。全部软告警不拦。
    {
      const shots = Array.isArray((clip as { shots?: unknown }).shots)
        ? ((clip as unknown as { shots: unknown[] }).shots as Array<Record<string, unknown>>)
        : [];
      const EXTREME_MOVE_RE =
        /甩镜|甩向|whip|crash\s*zoom|急推|急拉|疾速环绕|快速环绕|高速环绕|翻转镜头|滚镜|barrel|剧烈晃动|猛烈摇/i;
      const HEAD_TURN_RE = /猛回头|急转身|甩头|疾转身/;
      const lipRiskShots: number[] = [];
      const longSentences: string[] = [];
      const starvedShots: number[] = [];
      shots.forEach((s, si) => {
        const no = typeof s.shotNo === "number" ? (s.shotNo as number) : si + 1;
        const dialogue = String(s.dialogue ?? "").trim();
        const hasDialogue = Boolean(dialogue) && dialogue !== "[无台词]";
        const moveText = `${String(s.cameraMove ?? "")} ${String(s.action ?? "")}`;
        if (hasDialogue) {
          if (EXTREME_MOVE_RE.test(moveText) || HEAD_TURN_RE.test(moveText)) {
            lipRiskShots.push(no);
          }
          for (const m of dialogue.match(/「([^」]*)」/g) ?? []) {
            for (const sentence of m
              .slice(1, -1)
              .split(/[。！？!?；;]/)
              .map((x) => x.replace(/[\s，、,]/g, ""))
              .filter(Boolean)) {
              if (sentence.length > 20) longSentences.push(`镜${no}「${sentence.slice(0, 12)}…」${sentence.length}字`);
            }
          }
        }
        // <4s「拍点挨饿」只对【带台词】镜告警——台词镜 <4s 念白/口型被压缩跳拍是真问题；
        // 无台词的动作/打斗镜 1~2s 是「电光火石」密集节拍的刻意设计（2026-07-09 用户拍板），不告警。
        const dur = Number(s.durationSeconds);
        if (hasDialogue && Number.isFinite(dur) && dur > 0 && dur < 4) starvedShots.push(no);
      });
      if (lipRiskShots.length) {
        warnings.push(
          `段${clipNo}（clipIndex=${clipNo - 1}）镜${lipRiskShots.join("/")}台词与极端运镜/急转头同镜——口型是音画联合约束，大幅头部/相机运动会明显降低对口型可靠度。台词期间改稳定中近景+微推，甩镜/急转放到无台词拍。`,
        );
      }
      if (longSentences.length) {
        warnings.push(
          `段${clipNo}（clipIndex=${clipNo - 1}）单句对白超「一口气」预算（>20字）：${longSentences.join("；")}——可靠对口型的安全单位是一口气一句（~2-3s一个意思），长句按语义拆成多句（保留原文用句读拆，禁删词）。`,
        );
      }
      if (starvedShots.length) {
        warnings.push(
          `段${clipNo}（clipIndex=${clipNo - 1}）镜${starvedShots.join("/")}带台词却 <4s——台词镜念白/口型需 ≈4-6s 才念得完一句，塞短会被压缩或跳字；给台词镜加时长或把台词挪到更长的镜。（注：无台词的动作/打斗镜 1~2s 是电光火石密集节拍、不在此限）`,
        );
      }
    }

    // ⑤ 叙事镜缺 exitState（退出态）：cut 并发镜间零信息传递，退出态是下一镜承接注入与
    // critic 逐对比对的结构化锚。只查叙事镜（带具名角色卡），纯蒙太奇/空镜不扰。
    const isNarrative =
      Array.isArray(clip.characterRoleNames) && clip.characterRoleNames.length > 0;
    if (isNarrative && !String((clip as { exitState?: unknown }).exitState ?? "").trim()) {
      exitStateGapClips.push(clipNo);
    }
  });

  if (ensembleGapClips.length) {
    warnings.push(
      ctx.ensembleNodeIds.size
        ? `段${ensembleGapClips.join("/")}（段号=clipIndex+1，指整段 clip 非 shot 镜号）是群像段（≥3 人同框或人群取景）但没把群像图节点 id 绑进该镜 videoReferenceNodeIds——画布有图≠镜里生效，不绑必身份漂移/同脸。用 replaceAtIndex 把对应「群像图｜…」节点 id 加进这些镜的 videoReferenceNodeIds。`
        : `段${ensembleGapClips.join("/")}（段号=clipIndex+1，指整段 clip 非 shot 镜号）是群像段（≥3 人同框或人群取景）但画布还没有群像图——记录为非阻塞资产绑定诊断。` +
          `现在就建（label「群像图｜…」+ referenceType:"ensemble" + characterRoleNames 列全出镜者，≤5 人一张、超员拆多张），并把节点 id 绑进对应镜 videoReferenceNodeIds。`,
    );
  }
  if (blockingGapClips.length) {
    warnings.push(
      `段${blockingGapClips.join("/")}（段号=clipIndex+1，指整段 clip 非 shot 镜号）是空间调度段（对峙/打斗/追逐/走位/进出门等）但未带俯视站位图——` +
        `按 SKILL「俯视站位图默认必带」纪律：先 tapcanvas_render_blocking_diagram 出站位图（站位 at+朝向 facingTo+走位 moveTo+机位），` +
        `把返回节点 id 用 replaceAtIndex 填进该镜 blockingFrameNodeId（orchestrate 自动作空间调度上下文参考、非视频首帧）；` +
        `相机运动轨迹写进 clipPrompt 文字。不带则多人走位/朝向/衔接靠模型乱猜，跨镜必不连贯。`,
    );
  }
  if (introCardGaps.length) {
    warnings.push(
      introCardGaps
        .map((g) => `段${g.clipNo}（clipIndex=${g.clipNo - 1}）首次出场角色【${g.roles.join("、")}】`)
        .join("；") +
        `缺「人物介绍字卡」——每个具名角色**全剧首次出场**（本章新建卡、前章画布无此角色）的镜必须在画面内叠加` +
        `人物介绍字卡（<姓名>｜<门派/身份>，≤10字，角色旁留白处小字卡约2s淡出），且该镜 shots 文本里必须出现` +
        `「人物介绍字卡」字样（服务端据此在硬约束里豁免画面文字，否则会被「无烧屏文字」压掉）。` +
        `用 replaceAtIndex 把字卡写进对应镜的 composition/action。`,
    );
  }
  if (introCardExcess.length) {
    warnings.push(
      introCardExcess
        .map((g) => `段${g.clipNo}（clipIndex=${g.clipNo - 1}）给复用角色【${g.roles.join("、")}】叠了人物介绍字卡`)
        .join("；") +
        `——字卡一人一次、全剧守恒：该角色前章已出场（或本片前镜已介绍过），复用角色不再标。` +
        `用 replaceAtIndex 删掉这些镜里的字卡描述（其余内容保持不变）。`,
    );
  }
  if (exitStateGapClips.length) {
    warnings.push(
      `段${exitStateGapClips.join("/")}（段号=clipIndex+1）未写 exitState（退出态一句话：谁在哪/姿态/视线/手中道具/伤况/光线，≤80字）——` +
        `服务端会把上镜 exitState 确定性注入下镜提示词、critic 逐对核「退出态↔下镜进入态」；缺它相邻镜衔接退回纯自律。` +
        `用 replaceAtIndex 补齐（写法=「下镜开场的起跳台」，见知识卡 状态连续性/cut-mode-prompt-state-relay）。`,
    );
  }
  return warnings;
}
