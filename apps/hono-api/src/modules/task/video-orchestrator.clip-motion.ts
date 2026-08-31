// 【防"动态PPT" + 防"丢对白" 双诊断】（2026-06-13 用户实测：ch32 整章被压成 4 镜/24s、
// 全程无 spoken dialogue 对白；clipPrompt 偏静态描述靠故事板首帧带 → 幻灯片感）。
//
// 根因：动态五件套 / 对白完整 只写在 SKILL 散文里（soft 规则），小T 会绕过。把这两条从
// 由确定性函数产出 diagnostics，供 agents 同链修订；不阻止生成与交付。
//
// 闸 1（防 PPT）：单镜 clipPrompt 既无【运镜线索】又无【物理动作动词】= 纯静态 → 拒绝。
//   （只拦"两者皆无"的极端静态，避免误伤"锁机位+主体大动作"或"静态主体+运镜"这类合法镜。）
// 闸 2（防丢对白）：叙事片（非 montage）且有具名角色，却"全片所有镜 clipPrompt 都没有任何
//   spoken dialogue 标记" = 对白被整体丢弃 → 拒绝。逼小T把原文对白写进镜。
//
// 单 clip 偏静态或叙事片疑似丢对白都不得因环境开关重新升级成硬门禁。

import type { StoryPlanClip } from "./video-orchestrator.orchestrate";

// 运镜线索：命中表示该镜有明确的相机运动（含锁机位的反例不算运动，故"固定/锁定"不在内）。
// export 供 clip-field-echo 复用（叠加"无运镜"条件防误伤合法首尾帧镜）——纯加 export 关键字，正则零改动。
export const CAMERA_MOVE_PATTERN =
  /推近|推进|推镜|缓推|快推|拉远|拉镜|拉出|后拉|横移|平移|移镜|侧移|跟拍|跟随|跟摇|摇镜|摇向|上摇|下摇|左摇|右摇|环绕|绕行|升镜|降镜|俯拍|俯冲|仰拍|仰角|变焦|镜头(推|拉|摇|移|升|降|俯|仰|跟|绕|从|向)|push[\s-]?in|pull[\s-]?(out|back)|dolly|truck|\bpan\b|tracking|track(ing)?\s*shot|\btilt\b|orbit|\barc\b|crane|\bzoom\b|handheld|follow(ing)?\s*shot|aerial|drone|whip[\s-]?pan/i;

// 物理动作动词（有幅度的身体/物体运动）。微表情类（垂眼/眨眼/凝视…）单独排除、不算动作。
// export 供 clip-field-echo 复用——纯加 export 关键字，正则零改动。
export const ACTION_PATTERN =
  /走|跑|冲|奔|迈|踱|挥|砍|劈|抓|握|攥|抬|举|甩|拽|拉开|推开|转身|起身|坐下|站起|蹲|跪|低头|抬头|伸手|收拢|碾|捏|砸|踢|打|击|拔|扑|跃|跳|端起|放下|倒|斟|饮|喝|咀嚼|穿梭|游走|端着|扛|背着|系|绑|摩挲|搓|磨|吹|点燃|翻|掀|落下|飘|扬起|涌|簌簌|飞溅|溅|滚动|起伏|摆动|拂动|飘动|摇曳|掠过|颤抖|踉跄|扑倒|拥|抱|拍|指向|挡|举起|握紧|松开|walk|run|rush|stride|step|swing|strike|slash|grab|grip|lift|raise|throw|toss|turn|kneel|rise|stand|crouch|reach|cup|pour|drink|chew|sway|drift|fall|ripple|flutter|trail|burst|splash|stagger|tremble|shove|push|pull|leap|jump|dash/i;

// spoken dialogue 对白标记：中文引号台词 / 「」『』 / 直引号 / "说道/喝道/低声：" 等。
const DIALOGUE_PATTERN =
  /[“”「」『』]|["'][^"']{2,}["']|(说|道|问|答|喝|嚷|低声|冷笑|怒喝|呢喃|喊|叫|念)[道：:]|spoken dialogue|台词[:：]/;

// 题材豁免（2026-06-14 用户定调：「对白要区分场景——叙事漫剧/短剧需要对白，纯电商/复刻广告片可豁免」）。
// 这些题材天然无角色对白（靠卡点节拍/口播旁白/纯画面叙事），不该被"叙事片丢对白"闸误拦。
// 命中即对白闸豁免；叙事/剧情/漫剧/短剧/故事 等不在内，仍强制对白。
const NO_DIALOGUE_GENRE_PATTERN =
  /电商|带货|种草|广告|宣传片|promo|tvc|advert|\bad\b|时尚|穿搭|fashion|lookbook|美妆|product|产品|开箱|复刻|replica|replicat|转场|transition|\bmv\b|music\s*video|音乐|空镜|broll|b[\s-]?roll|vlog|旅拍|风光|宣发/i;

/** 题材是否为"天然无对白"类（电商/广告/时尚/MV/复刻/转场/B-roll…）→ 对白闸豁免。 */
export function isNoDialogueGenre(filmGenre?: string): boolean {
  const g = String(filmGenre || "").trim();
  if (!g) return false;
  return NO_DIALOGUE_GENRE_PATTERN.test(g);
}

export type StaticClip = { index: number };

/** 找出"纯静态"镜：clipPrompt（含 storyboardPrompt）既无运镜线索、又无物理动作动词。 */
export function findStaticClips(clips: readonly StoryPlanClip[]): StaticClip[] {
  const out: StaticClip[] = [];
  clips.forEach((clip, index) => {
    if ((clip as { motionReviewed?: boolean }).motionReviewed === true) return;
    const text = `${clip.clipPrompt || ""}\n${clip.storyboardPrompt || ""}`;
    if (!text.trim()) return; // 空 prompt 交给别的校验，不在本闸误报
    const hasCamera = CAMERA_MOVE_PATTERN.test(text);
    const hasAction = ACTION_PATTERN.test(text);
    if (!hasCamera && !hasAction) out.push({ index });
  });
  return out;
}

/** 构建静态PPT拦截文案；无静态镜返回 null。 */
export function buildClipMotionBlockMessage(clips: readonly StoryPlanClip[]): string | null {
  const staticClips = findStaticClips(clips);
  if (!staticClips.length) return null;
  const detail = staticClips.map((s) => `clip${s.index}`).join("、");
  return (
    `拒绝起跑：检测到纯静态镜 [${detail}]——这些镜的 clipPrompt 既没有运镜线索、也没有任何物理动作动词，` +
    "靠故事板首帧带画面 = 动态PPT/幻灯片感（实测高频故障）。每镜 clipPrompt 必须自含动态：" +
    "① 至少一句【主体物理动作】（有幅度的动作动词+微动作，如「五指收拢碾碎石皮，碎屑簌簌而落」，不能只有垂眼/微笑级微表情）；" +
    "② 至少一句【运镜】（确切动词：推近/拉远/横移/跟摇/环绕/上摇，用节奏词不写 fast/不写 f 值）。" +
    "改完每镜都带上动作+运镜再 start；确属有意的纯静态定格镜，给该 clip 标 motionReviewed:true 豁免。"
  );
}

/**
 * 【静态镜写入告警·2026-07-11 链路审计左移】findStaticClips 原只服务 start 硬闸（06-30 去硬闸后默认 OFF、
 * 实际不跑）。改为 add_clips 每批入库后以**检测纠正告警**复活：写手趁上下文热单段修，不硬拦。
 */
export function buildStaticClipsWarning(clips: readonly StoryPlanClip[]): string | null {
  const staticClips = findStaticClips(clips);
  if (!staticClips.length) return null;
  const detail = staticClips.map((s) => `镜${s.index + 1}`).join("、");
  return (
    `⚠️纯静态镜机检：[${detail}] 的 clipPrompt 既无运镜线索、也无物理动作动词——静帧靠模型即兴＝动态PPT。` +
    `给每镜补【主体物理动作】（有幅度的动作动词）+【运镜】（推近/拉远/横移/跟摇/环绕…确切动词）后 ` +
    `add_clips{runId, replaceAtIndex:<镜号-1>, clips:[改好的那段]} 单段重发；确属有意的纯静态定格镜，给该 clip 标 motionReviewed:true 豁免。`
  );
}

/** 是否叙事片（非 montage、非无对白题材）且有具名角色——这类片"全程无对白"高度可疑（对白被丢）。 */
function isCharacterNarrative(plan: {
  editingStyle?: string;
  filmGenre?: string;
  clips: readonly StoryPlanClip[];
}): boolean {
  if (plan.editingStyle === "montage") return false;
  // 题材豁免：电商/广告/时尚/MV/复刻/转场 等天然无对白片，不当叙事片对待（用户定调）。
  if (isNoDialogueGenre(plan.filmGenre)) return false;
  const namedClips = plan.clips.filter(
    (c) => (c.characterRoleNames?.length ?? 0) > 0,
  );
  return namedClips.length >= 2;
}

/** 全片是否没有任何一镜带 spoken dialogue 标记。 */
export function hasNoDialogueAtAll(clips: readonly StoryPlanClip[]): boolean {
  return clips.every(
    (c) => !DIALOGUE_PATTERN.test(`${c.clipPrompt || ""}\n${c.storyboardPrompt || ""}`),
  );
}

/** 构建"叙事片全程丢对白"拦截文案；不触发返回 null。 */
export function buildDialoguePresenceBlockMessage(plan: {
  editingStyle?: string;
  filmGenre?: string;
  dialogueReviewed?: boolean;
  clips: readonly StoryPlanClip[];
}): string | null {
  if (plan.dialogueReviewed === true) return null;
  if (!isCharacterNarrative(plan)) return null;
  if (!hasNoDialogueAtAll(plan.clips)) return null;
  return (
    "拒绝起跑：本片是有具名角色的叙事片，却全片所有镜都没有任何 spoken dialogue 对白——" +
    "对白是剧情硬信息（用户铁律：原文对白一字不丢），整体丢弃会让观众看不懂剧情。" +
    "请把原文里每一句带引号的角色对白逐字写进对应镜的 clipPrompt（锚在动作上：先动作后台词），" +
    "对白长就加时长或拆成同场景连续多镜按序念全；改完再 start。" +
    "（若本片是电商/广告/时尚/MV/复刻/转场等天然无对白题材，给 StoryPlan 标 filmGenre（如 \"电商复刻\"/\"时尚广告\"）即自动豁免；" +
    "确属无对白的纯空镜/B-roll，也可标 dialogueReviewed:true 豁免。）"
  );
}
