// 每镜「资产绑定」结构化摘要 + 漂移诊断（纯函数，零依赖，可独立测试）。
//
// 背景：视频编排把角色卡/场景卡/道具卡/群像图解析成带标签的参考图（`角色卡·齐夏`、
// `场景卡｜密室`…），确定性渲染进 seedance prompt。但此前这些绑定只以「裸 URL 列表 + 一段
// 自由文本 prompt 块」落在节点上——无法从画布/日志结构化看出「每镜到底绑了谁、缺了谁」，
// 漂移（人物飘/场景飘/道具飘）发生了也无处定位。
//
// 本模块把标签还原成结构化 `ClipAssetBinding`（角色/场景/道具/群像 各是谁），并据此产出
// 漂移诊断告警（出镜角色无卡 / 参考图超上限被截断 / 一镜无场景）。编排在提交每镜时写回节点
// `data.assetBinding` 并打日志 → 可观测性链路的地基。

/** 参考图标签可还原出的资产类别。 */
export type ClipAssetKind =
  | "character"
  | "scene"
  | "prop"
  | "ensemble"
  | "blocking"
  | "other";

export type ParsedRefLabel = { kind: ClipAssetKind; name: string };

const SEP = "[｜|:：·]";
const CHAR_PREFIX = new RegExp(`^(角色卡|身份板)\\s*${SEP}\\s*`);
const SCENE_PREFIX = new RegExp(`^(场景[卡锚]|场景参考)\\s*${SEP}\\s*`);
const PROP_PREFIX = new RegExp(`^(道具[卡锚]|道具参考)\\s*${SEP}\\s*`);
const ENSEMBLE_PREFIX = new RegExp(`^(群像图|群像卡|群像)\\s*${SEP}?\\s*`);
// 尾部「·视图N」多视图后缀 + 「（状态描述）」括注，取纯资产名时剥掉。
const VIEW_SUFFIX = /\s*[·]?\s*视图\s*\d+\s*$/;
const STATE_PAREN = /（[^）]*）|\([^)]*\)/g;

function stripToName(s: string): string {
  return s.replace(VIEW_SUFFIX, "").replace(STATE_PAREN, "").trim();
}

/**
 * 从一条参考图标签还原资产身份。识别前缀（角色卡/场景卡/道具卡/群像图/站位图），
 * 剥前缀 + 尾部视图/状态括注得到纯名字。识别不出前缀 → other（不猜，宁漏勿误）。
 */
export function parseReferenceLabel(labelRaw: string): ParsedRefLabel {
  const label = String(labelRaw ?? "").trim();
  if (!label) return { kind: "other", name: "" };
  if (/站位图|blocking/i.test(label)) return { kind: "blocking", name: "" };
  if (CHAR_PREFIX.test(label)) {
    return { kind: "character", name: stripToName(label.replace(CHAR_PREFIX, "")) };
  }
  if (SCENE_PREFIX.test(label)) {
    return { kind: "scene", name: stripToName(label.replace(SCENE_PREFIX, "")) };
  }
  if (PROP_PREFIX.test(label)) {
    return { kind: "prop", name: stripToName(label.replace(PROP_PREFIX, "")) };
  }
  if (ENSEMBLE_PREFIX.test(label)) {
    return { kind: "ensemble", name: stripToName(label.replace(ENSEMBLE_PREFIX, "")) };
  }
  return { kind: "other", name: "" };
}

/** 每镜结构化资产绑定摘要：角色/场景/道具/群像各是谁 + 站位/其它计数 + 参考图总数。 */
export type ClipAssetBinding = {
  characters: string[];
  scenes: string[];
  props: string[];
  ensembles: string[];
  blocking: number;
  other: number;
  total: number;
};

function pushUnique(arr: string[], name: string): void {
  if (name && !arr.includes(name)) arr.push(name);
}

/** 把一组已解析的参考图条目（url+label）归类成结构化绑定摘要。同名去重，total=条目总数。 */
export function summarizeClipAssetBinding(
  entries: ReadonlyArray<{ url: string; label: string }>,
): ClipAssetBinding {
  const out: ClipAssetBinding = {
    characters: [],
    scenes: [],
    props: [],
    ensembles: [],
    blocking: 0,
    other: 0,
    total: 0,
  };
  for (const e of entries ?? []) {
    out.total += 1;
    const parsed = parseReferenceLabel(e.label);
    switch (parsed.kind) {
      case "character":
        pushUnique(out.characters, parsed.name);
        break;
      case "scene":
        pushUnique(out.scenes, parsed.name);
        break;
      case "prop":
        pushUnique(out.props, parsed.name);
        break;
      case "ensemble":
        pushUnique(out.ensembles, parsed.name);
        break;
      case "blocking":
        out.blocking += 1;
        break;
      default:
        out.other += 1;
    }
  }
  return out;
}

/**
 * 直接从 BeatSheet 的结构化对象合同汇总绑定。执行链不得再从 label 文案反推资产语义；
 * label 只用于人类可读日志，kind/name 才是权威事实。
 */
export function summarizeClipAssetContracts(
  contracts: ReadonlyArray<{ kind: string; name: string; referenceImageNodeIds: readonly string[] }>,
): ClipAssetBinding {
  const out: ClipAssetBinding = {
    characters: [],
    scenes: [],
    props: [],
    ensembles: [],
    blocking: 0,
    other: 0,
    total: 0,
  };
  for (const contract of contracts) {
    const referenceCount = contract.referenceImageNodeIds.length;
    out.total += referenceCount;
    switch (contract.kind) {
      case "character":
        pushUnique(out.characters, contract.name);
        break;
      case "scene":
        pushUnique(out.scenes, contract.name);
        break;
      case "prop":
        pushUnique(out.props, contract.name);
        break;
      default:
        out.other += referenceCount;
    }
  }
  return out;
}

export type ClipBindingDiagnostic = {
  level: "warn" | "info";
  code: "missing-character-card" | "refs-truncated" | "no-scene";
  message: string;
};

function normalizeRoleKey(s: string): string {
  return String(s ?? "").trim().toLowerCase();
}

/**
 * 每镜绑定漂移诊断：
 * - missing-character-card：文本声明出镜的角色没有任何卡绑进本镜（→ 该角色必凭空编脸漂移）。
 * - refs-truncated：解析出的参考图超过上限被截断（低优先级卡被丢，可能丢的正是某角色/道具）。
 * - no-scene：本镜没有任何场景绑定（场景全靠模型脑补 → 场景飘）。
 * 群像图里含该角色也算「有卡」（casting 一致性由群像图承载）。
 */
export function diagnoseClipBinding(input: {
  clipIndex: number;
  binding: ClipAssetBinding;
  onScreenRoleNames: ReadonlyArray<string>;
  cap: number;
  droppedCount: number;
}): ClipBindingDiagnostic[] {
  const diags: ClipBindingDiagnostic[] = [];
  const bound = new Set(input.binding.characters.map(normalizeRoleKey));
  const hasEnsemble = input.binding.ensembles.length > 0;
  const missing = (input.onScreenRoleNames ?? [])
    .map((n) => String(n ?? "").trim())
    .filter(Boolean)
    .filter((n) => !bound.has(normalizeRoleKey(n)) && !hasEnsemble);
  if (missing.length) {
    diags.push({
      level: "warn",
      code: "missing-character-card",
      message: `镜${input.clipIndex}：出镜角色未绑定角色卡 → ${missing.join("、")}（将凭空编脸，人物飘）`,
    });
  }
  if (input.droppedCount > 0) {
    diags.push({
      level: "warn",
      code: "refs-truncated",
      message: `镜${input.clipIndex}：参考图超上限（cap=${input.cap}）被截断，丢弃 ${input.droppedCount} 张低优先级卡（可能丢了某角色/道具的锚）`,
    });
  }
  if (input.binding.scenes.length === 0) {
    diags.push({
      level: "warn",
      code: "no-scene",
      message: `镜${input.clipIndex}：无任何场景卡绑定，场景全靠模型脑补（场景飘）`,
    });
  }
  return diags;
}
