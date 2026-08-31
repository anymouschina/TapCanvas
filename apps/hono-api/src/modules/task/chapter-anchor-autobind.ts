// 章节锚·确定性自动绑定（2026-06-17）。
// 病根（ch38 V3.3 实测）：小T 调生成工具时手传 referenceImages 反复漏绑——lockedAnchors.character
// 明明列了 [李长安,山蜘蛛]，referenceImages 却只含李长安、丢了山蜘蛛；全局风格锚（万妖图录传）建出来了
// 却从不被当参考用 → 画风不变、反派漂移。喊话小T 每次都漏。这里改成服务端确定性补全：
// 角色卡与场景卡已硬切到 agents-cli 的结构化 ID 单轨，本模块不再按名称或 label 补 URL。
// 这里只保留非角色/场景的既有能力：风格锚与道具锚。

export type LockedAnchors = {
  /** 道具/法宝/武器等器物锚（2026-07-10 补齐：此前兜底绑定不覆盖道具 → 法宝跨镜漂移无人兜底）。 */
  prop?: string[];
};

export type AnchorRefSelection = {
  styleAnchorUrl: string | null;
  /** 可选：既有调用/测试字面量无此字段也合法；selectAnchorReferenceImages 恒返回。 */
  propUrls?: string[];
};

type NodeLike = { data?: unknown };

function nodeData(n: NodeLike): Record<string, unknown> {
  return n.data && typeof n.data === "object" && !Array.isArray(n.data)
    ? (n.data as Record<string, unknown>)
    : {};
}

function isHttpUrl(u: unknown): u is string {
  return typeof u === "string" && /^https?:\/\//.test(u);
}

/**
 * 从章节画布节点里，按 lockedAnchors 解析应当强制绑定的参考图：
 * - 风格锚：label 含「风格锚」或 productionLayer=style/styleAnchor 的图节点；同名多张时偏好「万妖/正式」且取最后出现（最新）。
 * - 道具卡：label 含「道具卡/法宝卡」等器物别名且命中 lockedAnchors.prop。
 * - 角色/场景：不处理；必须通过新版卡节点 ID / 资产 ID 显式绑定。
 * 纯函数，便于单测。
 */
const PROP_CARD_LABEL_RE = /(道具|法宝|法寶|灵宝|靈寶|法器|武器|兵器|器物|技能)[卡锚]|prop[\s_-]?card/i;

export function selectAnchorReferenceImages(
  nodes: NodeLike[],
  lockedAnchors: LockedAnchors | undefined,
): AnchorRefSelection {
  let styleAnchorUrl: string | null = null;
  let styleScore = -1;
  const propByName = new Map<string, string>();
  const propNames = (lockedAnchors?.prop ?? []).filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );

  for (const n of nodes) {
    const d = nodeData(n);
    if (String(d.kind ?? "").toLowerCase() !== "image") continue;
    const url = d.imageUrl;
    if (!isHttpUrl(url)) continue;
    const label = String(d.label ?? "");
    const layer = String(d.productionLayer ?? "").toLowerCase();

    if (/风格锚|style[\s_-]?anchor/i.test(label) || layer === "style" || layer === "styleanchor") {
      // 偏好万妖/正式版（score 2）；同分取后出现的（最新覆盖）。
      const score = /万妖|正式/.test(label) ? 2 : 1;
      if (score >= styleScore) {
        styleAnchorUrl = url;
        styleScore = score;
      }
      continue;
    }
    if (PROP_CARD_LABEL_RE.test(label)) {
      for (const name of propNames) {
        if (label.includes(name)) propByName.set(name, url);
      }
      continue;
    }
  }

  return {
    styleAnchorUrl,
    propUrls: propNames.map((n) => propByName.get(n)).filter(isHttpUrl),
  };
}

/**
 * 把非角色/场景锚定参考并入现有 referenceImages：风格锚 + 道具卡。
 * 去重、保序（现有在前、补全在后），并按 maxRefs 截断（保护已有靠前项不被挤掉，
 * 顺序为：现有 firstFrame/板 → 风格锚 → 道具卡。
 * 返回 {merged, injected}（injected=本次确实新补进去的，便于日志/统计）。
 */
export function mergeAnchorReferences(
  current: string[],
  selection: AnchorRefSelection,
  opts?: { maxRefs?: number },
): { merged: string[]; injected: string[] } {
  const maxRefs = Math.max(2, Math.floor(opts?.maxRefs ?? 7));
  const have = new Set(current.filter(isHttpUrl));
  const injected: string[] = [];
  const addList = [
    ...(selection.styleAnchorUrl ? [selection.styleAnchorUrl] : []),
    ...(selection.propUrls ?? []),
  ];
  for (const u of addList) {
    if (!isHttpUrl(u) || have.has(u)) continue;
    have.add(u);
    injected.push(u);
  }
  // 现有在前，补全在后；截断到 maxRefs。
  const merged = [...current.filter(isHttpUrl), ...injected].slice(0, maxRefs);
  return { merged, injected: injected.filter((u) => merged.includes(u)) };
}
