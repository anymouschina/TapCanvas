// 【unknown-role 引用软告警】（吸收 LumenX 两段式解析的"分镜严格只引用已提取实体"约束）
//
// LumenX：Prompt A 先产稳定实体库，Prompt B 拆分镜【严格只准引用已提取实体名】，跨镜一致从"prompt
// 祈祷"降维成"代码解析"。TapCanvas 的失败面：clip.characterRoleNames 写了库里不存在的角色名（幻觉/错字）
// → resolveCharacterRoleImageUrls 静默 return []（orchestrate.ts:480）→ 该镜静默退回组内全部图自由生成、
// 身份漂移，且不可见。本闸在 estimate 期补一条【软告警】把这事变可见——不硬拦、不改解析/计费/拆段。
//
// 软告警非硬闸（按 MEMORY「正确默认>检测纠正>硬闸」）：幻觉名仍可起跑，仅提示；静默退兜底是可恢复降级。
// flag VIDEO_UNKNOWN_ROLE_REF_WARN 默认 ON。

import type { StoryPlanClip } from "./video-orchestrator.orchestrate";
import type { VideoFlowNode } from "./video-orchestrator.flow-io";
import { classifyCanvasCardForRegistry } from "./material-card-classify";

export function isUnknownRoleRefWarnEnabled(env: unknown): boolean {
  const raw = String(
    ((env as Record<string, unknown>)?.VIDEO_UNKNOWN_ROLE_REF_WARN ??
      globalThis.process?.env?.VIDEO_UNKNOWN_ROLE_REF_WARN ??
      "") as string,
  )
    .trim()
    .toLowerCase();
  return !(raw === "false" || raw === "0" || raw === "off" || raw === "no");
}

const readName = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * 扫 nodes 收集已验真的 character-card/v3 角色名。
 * label、裸 roleName、characterName 与旧 referenceType 节点不再建立角色身份。
 */
export function collectKnownRoleNames(nodes: readonly VideoFlowNode[]): Set<string> {
  const out = new Set<string>();
  for (const node of nodes) {
    const data = (node?.data ?? {}) as Record<string, unknown>;
    const classification = classifyCanvasCardForRegistry(data);
    if (classification?.kind === "character") out.add(classification.name);
  }
  return out;
}

/**
 * 遍历每 clip 的 characterRoleNames，收集不在 knownRoleNames 里的名字（精确匹配·繁简/错字=不在=报）；
 * 有则返回中文软告警串，无则 null。纯函数。
 */
export function buildUnknownRoleReferenceWarning(
  clips: readonly StoryPlanClip[],
  knownRoleNames: ReadonlySet<string>,
): string | null {
  const hits: string[] = [];
  clips.forEach((clip, index) => {
    const names = (clip as { characterRoleNames?: unknown }).characterRoleNames;
    if (!Array.isArray(names)) return;
    const unknowns = names
      .map((n) => readName(n))
      .filter((n) => n && !knownRoleNames.has(n));
    if (unknowns.length) {
      hits.push(`镜${index} 引用「${unknowns.join("、")}」`);
    }
  });
  if (!hits.length) return null;
  const known = Array.from(knownRoleNames);
  const knownNote = known.length ? `库内已建角色卡：${known.join("、")}` : "库内尚无任何角色卡";
  return (
    `检测到镜头引用了未建卡的角色名：${hits.join("；")}（${knownNote}）。` +
    `请先通过 tapcanvas-character-card 建立 character-card/v3 角色卡，或确认这不是别名/错字——` +
    `否则该镜会静默退回组内参考图自由生成、身份会漂移。`
  );
}
