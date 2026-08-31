// 画布卡节点「分类」纯函数（零依赖，可独立测试）。
//
// 从 material-auto-register.ts 抽出：原文件顶层 import 了 material.service / prisma，
// 任何复用这些纯分类逻辑的模块（如 chapter-canvas-dedupe）都会被迫拖入 DB 依赖链。
// 这里只放识别逻辑，material-auto-register.ts 继续 re-export 以保持既有 import 不变。

import { readPropMaterialIdentity } from "./prop-material-identity";

export type CanvasCardClassification = {
  kind: "character" | "scene" | "ensemble" | "prop" | "pose";
  name: string;
};

// 群像图：多人同框设定图（主角+路人A/B/C，含站位），作为可绑定的视频群像参考。
// 注意命名避开「站位图」——orchestrate 把 label 含「站位图/blocking」的剔出视频参考
// （那是俯视抽象示意图，context-only）；群像图是可上色的真实参考帧，必须能绑进群像镜。
const ENSEMBLE_LABEL_RE = /^(群像图|群像卡|群像)\s*[｜|:：·]?/;
const ENSEMBLE_NAME_STRIP_RE = /^(群像图|群像卡|群像)\s*[｜|:：·]\s*/;
// 姿态图（2026-07-16 用户拍板·类比群像图）：人物×道具非常规组合形态的单格设定图
// （扛/挑/背/骑/抱/拖等交互姿势）。命名同样避开「站位图」（orchestrate 会剔 label 含
// 「站位图/blocking」的项）；姿态图是要真喂进视频的彩色参考帧，必须可绑定。
// 表情图/情绪图（2026-07-16 用户拍板：情绪变化也是资产）与姿态图同族——都是「单主体
// 形态锚」（一个锁身体×道具形态，一个锁脸部情绪形态），归并 kind=pose 复用同一套
// 入库/按名跨章复用/anchor_candidates 链路，表情从角色卡表情栏+情绪词表选、禁凭空发明。
const POSE_LABEL_RE = /^(姿态图|姿势图|姿态卡|表情图|表情卡|情绪图)\s*[｜|:：·]?/;
const POSE_NAME_STRIP_RE = /^(姿态图|姿势图|姿态卡|表情图|表情卡|情绪图)\s*[｜|:：·]\s*/;
// 道具卡：可复用的关键道具设定图（山羊头面具/座钟/吊灯等），根治「道具飘」——
// 从此道具与角色/场景对称入库、可跨镜按名引用。与场景卡同构：label 前缀「道具卡/道具锚/道具参考＋分隔符＋名字」，
// 或 referenceType==='prop' 显式标记。宁漏勿误：裸「道具卡」无名字不注册。
// 2026-07-10 ch11 混元金斗实测：agent 产卡习惯写「法宝卡·混元金斗」→ 正则只认「道具」→ 永不入库 →
// 每章重画同一法宝。项目资产统一方案：法宝/灵宝/法器/武器/兵器/器物/技能等可复用器物类别名一并归 prop。
const PROP_KIND_WORDS = "道具|法宝|法寶|灵宝|靈寶|法器|武器|兵器|器物|技能";
const PROP_LABEL_RE = new RegExp(`(?:${PROP_KIND_WORDS})(?:[卡锚]|参考)?\\s*[｜|:：·]`);
const PROP_NAME_STRIP_RE = new RegExp(
	`^(?:${PROP_KIND_WORDS})(?:[卡锚]|参考)?\\s*[｜|:：·]\\s*`,
);

// 历史画布 label 常见坏习惯：名字尾带章节标记（「混元金斗(ch9)」「祭坛残殿（第9章）」）。
// 命名铁律＝章节号永不进 name（进了就裂成每章一个新资产、永远互不复用），入库前统一剥掉。
const CHAPTER_SUFFIX_RE = /\s*[（(]\s*(?:ch\s*\d+|第\s*\d+\s*章)\s*[)）]\s*$/i;
// 同理：版本号也永不进 name（「街角围观小年轻·v3c」入库即裂成每版一个新资产）。
const VERSION_SUFFIX_RE = /\s*[·．.\s]?v\d+[a-z]?\s*$/i;

function stripChapterSuffix(name: string): string {
  return name.replace(CHAPTER_SUFFIX_RE, "").replace(VERSION_SUFFIX_RE, "").trim();
}

export function classifyCanvasCardForRegistry(
  nodeData: Record<string, unknown> | null | undefined,
): CanvasCardClassification | null {
  const d = nodeData ?? {};
  const kind = String(d.kind ?? "").trim().toLowerCase();
  // 只认图节点产物（storyboardImage 是分镜帧不是设定卡，排除）。
  // 2026-07-17 ch1 实测补洞：imageEdit 也是设定卡的正统产出路径——连载身份连续性铁律要求
  // 衍生角色卡必须从基准脸「编辑」得来（禁独立 t2i），此前只认 kind="image" → 编辑产出的
  // 角色卡/群像图永不入库（同伴甲/知情青年丁/cos青年丙三张卡成孤儿、跨章复用断链）。
  if (kind && kind !== "image" && kind !== "imageedit") return null;
  // 镜头帧类节点（关键帧/分镜/故事板/设计板/站位图/俯视底图）不是设定卡：即使误带 roleName
  // 也不得注册（放开 imageEdit 后此类节点更常见，前置排除防误入库）。
  const earlyLabel = String(d.label ?? d.title ?? "").trim();
  if (/^(关键帧|分镜|故事板|设计板|分镜设计板|站位图|俯视底图)/.test(earlyLabel)) return null;
  // 群像图优先识别：referenceType=ensemble 显式标记，或 label「群像图｜<组名>」。
  // 放在 roleName/角色卡之前，避免群像节点误带 roleName 时被当成单人角色卡。
  const refType = String(d.referenceType ?? "").trim().toLowerCase();
  const labelRaw = String(d.label ?? d.title ?? "").trim();
  if (refType === "ensemble" || (labelRaw && ENSEMBLE_LABEL_RE.test(labelRaw))) {
    const name =
      String(d.ensembleTitle ?? "").trim() ||
      labelRaw.replace(ENSEMBLE_NAME_STRIP_RE, "").trim() ||
      labelRaw ||
      "群像图";
    return { kind: "ensemble", name: stripChapterSuffix(name) || name };
  }
  // 姿态图优先识别（同群像图：放在 roleName/角色卡之前——姿态图节点必带主角 roleName，
  // 后判会被误分类成单人角色卡、以三视图规范复用导致形态丢失）。
  if (refType === "pose" || (labelRaw && POSE_LABEL_RE.test(labelRaw))) {
    const name =
      String(d.poseTitle ?? "").trim() ||
      labelRaw.replace(POSE_NAME_STRIP_RE, "").trim() ||
      labelRaw ||
      "姿态图";
    return { kind: "pose", name: stripChapterSuffix(name) || name };
  }
  const label = String(d.label ?? d.title ?? "").trim();
  // 道具仍沿用现有 materialIdentity/显式 prop 合同。角色与场景已经硬切到各自
  // agents-cli 单轨，必须同时携带机器身份和唯一 profileVersion；label 只用于展示。
  const propMaterialIdentity = readPropMaterialIdentity(d);
  if (propMaterialIdentity) {
    return { kind: "prop", name: propMaterialIdentity.canonicalName };
  }
  if (refType === "prop") {
    const explicitPropName = String(d.propName ?? "").trim();
    const name = stripChapterSuffix(
      explicitPropName || label.replace(PROP_NAME_STRIP_RE, "").trim() || labelRaw,
    );
    if (name) return { kind: "prop", name };
  }
  if (label && PROP_LABEL_RE.test(label)) {
    const name = label.replace(PROP_NAME_STRIP_RE, "").trim();
    // 必须真剥出名字（带分隔符）：裸「道具卡」strip 后仍等于原串 → 不注册（宁漏勿误）。
    if (name && name !== label) return { kind: "prop", name: stripChapterSuffix(name) || name };
  }
  if (refType === "scene" && String(d.sceneProfileVersion ?? "").trim() === "scene-card/v1") {
    const name = stripChapterSuffix(String(d.sceneName ?? "").trim());
    if (name) return { kind: "scene", name };
  }
  if (
    refType === "character" &&
    String(d.characterProfileVersion ?? "").trim() === "character-card/v3"
  ) {
    const name = stripChapterSuffix(String(d.roleName ?? "").trim());
    if (name) return { kind: "character", name };
  }
  return null;
}

export type CanvasCardStateMarker = {
  stateDescription: string;
  stateKey: string;
};

/** 读取状态更新标记（护栏 B 分支 B 的状态更新卡靠它触发版本追加）。 */
export function readCanvasCardStateMarker(
  nodeData: Record<string, unknown> | null | undefined,
): CanvasCardStateMarker | null {
  const d = nodeData ?? {};
  const stateDescription = String(d.stateDescription ?? "").trim();
  const stateKey = String(d.stateKey ?? "").trim();
  if (!stateDescription && !stateKey) return null;
  return { stateDescription, stateKey };
}
