import { createHash } from "node:crypto";

export const KEYFRAME_FOCUS_KINDS = [
  "environment",
  "character",
  "relationship",
  "object",
  "event",
] as const;
export const KEYFRAME_SHOT_SCALES = [
  "establishing",
  "wide",
  "full",
  "medium",
  "close",
  "detail",
] as const;
export const KEYFRAME_VISUAL_WEIGHTS = ["primary", "secondary", "context"] as const;
export const KEYFRAME_DEPTH_LAYERS = ["foreground", "midground", "background"] as const;
export const KEYFRAME_CENTER_PLACEMENTS = ["required", "allowed", "forbidden"] as const;

export type KeyframeFocusKind = (typeof KEYFRAME_FOCUS_KINDS)[number];
export type KeyframeShotScale = (typeof KEYFRAME_SHOT_SCALES)[number];
export type KeyframeVisualWeight = (typeof KEYFRAME_VISUAL_WEIGHTS)[number];
export type KeyframeDepthLayer = (typeof KEYFRAME_DEPTH_LAYERS)[number];
export type KeyframeCenterPlacement = (typeof KEYFRAME_CENTER_PLACEMENTS)[number];

export type KeyframeCompositionSubject = {
  name: string;
  visualWeight: KeyframeVisualWeight;
  depthLayer: KeyframeDepthLayer;
  centerPlacement: KeyframeCenterPlacement;
  maxFrameHeightRatio: number;
};

export type KeyframeCompositionContract = {
  narrativeTask: string;
  focusKind: KeyframeFocusKind;
  focusTargetNames: string[];
  focalPoint: [number, number];
  shotScale: KeyframeShotScale;
  environmentVisualWeight: KeyframeVisualWeight;
  subjects: KeyframeCompositionSubject[];
};

export type ParsedKeyframeCompositionContract =
  | { ok: true; contract: KeyframeCompositionContract; hash: string }
  | { ok: false; issues: string[] };

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readBoundedText(value: unknown, path: string, max: number, issues: string[]): string {
  if (typeof value !== "string" || !value.trim()) {
    issues.push(`${path} 必须是非空字符串`);
    return "";
  }
  const text = value.trim();
  if (text.length > max) issues.push(`${path} 最多 ${max} 字（收到 ${text.length}）`);
  return text.slice(0, max);
}

function readEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
  issues: string[],
): T | null {
  if (typeof value === "string" && values.includes(value as T)) return value as T;
  issues.push(`${path} 必须 ∈ {${values.join("/")}}`);
  return null;
}

function readPoint(value: unknown, path: string, issues: string[]): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) {
    issues.push(`${path} 必须是精确的 [x,y] 两项数组`);
    return null;
  }
  const x = Number(value[0]);
  const y = Number(value[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    issues.push(`${path} 两项都必须是 [0,1] 内有限数值`);
    return null;
  }
  return [x, y];
}

function readUniqueNames(value: unknown, path: string, issues: string[]): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`${path} 必须是至少一项的字符串数组`);
    return [];
  }
  if (value.length > 24) issues.push(`${path} 最多 24 项（收到 ${value.length}）`);
  const names = value.map((item, index) => readBoundedText(item, `${path}[${index}]`, 80, issues));
  const valid = names.filter(Boolean);
  if (new Set(valid).size !== valid.length) issues.push(`${path} 不允许重复名称`);
  return [...new Set(valid)];
}

function parseSubject(
  value: unknown,
  index: number,
  issues: string[],
): KeyframeCompositionSubject | null {
  const path = `compositionContract.subjects[${index}]`;
  const record = readRecord(value);
  if (!record) {
    issues.push(`${path} 必须是对象`);
    return null;
  }
  const name = readBoundedText(record.name, `${path}.name`, 80, issues);
  const visualWeight = readEnum(
    record.visualWeight,
    KEYFRAME_VISUAL_WEIGHTS,
    `${path}.visualWeight`,
    issues,
  );
  const depthLayer = readEnum(
    record.depthLayer,
    KEYFRAME_DEPTH_LAYERS,
    `${path}.depthLayer`,
    issues,
  );
  const centerPlacement = readEnum(
    record.centerPlacement,
    KEYFRAME_CENTER_PLACEMENTS,
    `${path}.centerPlacement`,
    issues,
  );
  const maxFrameHeightRatio = Number(record.maxFrameHeightRatio);
  if (
    !Number.isFinite(maxFrameHeightRatio) ||
    maxFrameHeightRatio < 0.05 ||
    maxFrameHeightRatio > 1
  ) {
    issues.push(`${path}.maxFrameHeightRatio 必须是 [0.05,1] 内有限数值`);
  }
  if (!name || !visualWeight || !depthLayer || !centerPlacement) return null;
  if (maxFrameHeightRatio < 0.05 || maxFrameHeightRatio > 1) return null;
  return { name, visualWeight, depthLayer, centerPlacement, maxFrameHeightRatio };
}

function canonicalContractJson(contract: KeyframeCompositionContract): string {
  return JSON.stringify({
    narrativeTask: contract.narrativeTask,
    focusKind: contract.focusKind,
    focusTargetNames: contract.focusTargetNames,
    focalPoint: contract.focalPoint,
    shotScale: contract.shotScale,
    environmentVisualWeight: contract.environmentVisualWeight,
    subjects: contract.subjects.map((subject) => ({
      name: subject.name,
      visualWeight: subject.visualWeight,
      depthLayer: subject.depthLayer,
      centerPlacement: subject.centerPlacement,
      maxFrameHeightRatio: subject.maxFrameHeightRatio,
    })),
  });
}

export function hashKeyframeCompositionContract(contract: KeyframeCompositionContract): string {
  return createHash("sha256").update(canonicalContractJson(contract)).digest("hex");
}

export function doesCompositionImageUrlCarryHash(imageUrl: string, hash: string): boolean {
  if (!hash) return false;
  try {
    return new URL(imageUrl).pathname.split("/").pop()?.startsWith(`${hash}-`) === true;
  } catch {
    return false;
  }
}

export function parseKeyframeCompositionContract(
  value: unknown,
): ParsedKeyframeCompositionContract {
  const issues: string[] = [];
  const record = readRecord(value);
  if (!record) return { ok: false, issues: ["compositionContract 必须是对象"] };

  const narrativeTask = readBoundedText(
    record.narrativeTask,
    "compositionContract.narrativeTask",
    240,
    issues,
  );
  const focusKind = readEnum(
    record.focusKind,
    KEYFRAME_FOCUS_KINDS,
    "compositionContract.focusKind",
    issues,
  );
  const focusTargetNames = readUniqueNames(
    record.focusTargetNames,
    "compositionContract.focusTargetNames",
    issues,
  );
  const focalPoint = readPoint(record.focalPoint, "compositionContract.focalPoint", issues);
  const shotScale = readEnum(
    record.shotScale,
    KEYFRAME_SHOT_SCALES,
    "compositionContract.shotScale",
    issues,
  );
  const environmentVisualWeight = readEnum(
    record.environmentVisualWeight,
    KEYFRAME_VISUAL_WEIGHTS,
    "compositionContract.environmentVisualWeight",
    issues,
  );

  if (!Array.isArray(record.subjects) || record.subjects.length === 0) {
    issues.push("compositionContract.subjects 必须至少包含一个角色");
  }
  const rawSubjects = Array.isArray(record.subjects) ? record.subjects : [];
  if (rawSubjects.length > 24) {
    issues.push(`compositionContract.subjects 最多 24 项（收到 ${rawSubjects.length}）`);
  }
  const subjects = rawSubjects
    .slice(0, 24)
    .map((subject, index) => parseSubject(subject, index, issues))
    .filter((subject): subject is KeyframeCompositionSubject => subject !== null);
  if (new Set(subjects.map((subject) => subject.name)).size !== subjects.length) {
    issues.push("compositionContract.subjects 不允许重复角色名");
  }

  if (
    issues.length > 0 ||
    !narrativeTask ||
    !focusKind ||
    !focalPoint ||
    !shotScale ||
    !environmentVisualWeight
  ) {
    return { ok: false, issues };
  }
  const contract: KeyframeCompositionContract = {
    narrativeTask,
    focusKind,
    focusTargetNames,
    focalPoint,
    shotScale,
    environmentVisualWeight,
    subjects,
  };
  return { ok: true, contract, hash: hashKeyframeCompositionContract(contract) };
}

export function validateCompositionSubjectCoverage(input: {
  contract: KeyframeCompositionContract;
  characterNames: string[];
}): string[] {
  const declared = new Set(input.contract.subjects.map((subject) => subject.name));
  const characters = new Set(input.characterNames.map((name) => name.trim()).filter(Boolean));
  const missing = [...characters].filter((name) => !declared.has(name));
  const extra = [...declared].filter((name) => !characters.has(name));
  return [
    ...(missing.length ? [`compositionContract.subjects 缺少站位角色：${missing.join("、")}`] : []),
    ...(extra.length ? [`compositionContract.subjects 含非站位角色：${extra.join("、")}`] : []),
  ];
}

export function renderKeyframeCompositionFacts(contract: KeyframeCompositionContract): string {
  const subjectFacts = contract.subjects
    .map(
      (subject) =>
        `${subject.name}=${subject.visualWeight}/${subject.depthLayer}/center:${subject.centerPlacement}/maxHeight:${subject.maxFrameHeightRatio}`,
    )
    .join("；");
  return [
    `叙事任务=${contract.narrativeTask}`,
    `焦点=${contract.focusKind}:${contract.focusTargetNames.join("+")}`,
    `焦点坐标=[${contract.focalPoint.join(",")}]`,
    `景别=${contract.shotScale}`,
    `环境权重=${contract.environmentVisualWeight}`,
    `角色=${subjectFacts}`,
  ].join("；");
}
