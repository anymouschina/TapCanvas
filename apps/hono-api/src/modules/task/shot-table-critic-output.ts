export type ShotTableCriticDimensionMap = Record<string, string>;

export const SHOT_TABLE_CRITIC_DIMENSIONS = [
  "blocking",
  "axis",
  "focalAngle",
  "compositionDoF",
  "movement",
  "rhythm",
  "slowMo",
  "sound",
  "tailFrame",
  "infoDensity",
  "subjectMotion",
  "keyframe",
  "look",
  "structure",
  "plausibility",
  "aliveness",
  "sd2Fit",
  "ipSafety",
  "blindComprehension",
  "characterCausality",
  "directingCoherence",
  "subjectivePOV",
  "powerKnowledgeShift",
  "signalPurity",
] as const;

const DIMENSION_SET = new Set<string>(SHOT_TABLE_CRITIC_DIMENSIONS);
const DIMENSION_VALUES = new Set(["ok", "weak", "missing"]);
const MAX_JSON_CANDIDATES = 128;

export type ShotTableCriticModelVerdict = {
  pass: boolean;
  score: number;
  dims: ShotTableCriticDimensionMap;
  issues: string[];
  topFixes: string[];
  affectedClipIndexes: number[];
};

export type ShotTableCriticOutputDiagnostic = {
  failureReason:
    | "critic_output_empty"
    | "critic_json_object_missing"
    | "critic_schema_invalid";
  missingCriteria: string[];
  requiredActions: string[];
  rawChars: number;
  candidateCount: number;
};

export type ShotTableCriticOutputParseResult =
  | { ok: true; verdict: ShotTableCriticModelVerdict; candidateCount: number }
  | { ok: false; diagnostic: ShotTableCriticOutputDiagnostic };

type CandidateValidation =
  | { ok: true; verdict: ShotTableCriticModelVerdict }
  | { ok: false; missingCriteria: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStringArray(value: unknown, field: string, missingCriteria: string[]): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    missingCriteria.push(`${field}:string[]`);
    return [];
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function validateCandidate(obj: Record<string, unknown>): CandidateValidation {
  const missingCriteria: string[] = [];
  if (typeof obj.pass !== "boolean") missingCriteria.push("pass:boolean");
  const score = Number(obj.score);
  if (!Number.isFinite(score)) missingCriteria.push("score:number");

  const dims: ShotTableCriticDimensionMap = {};
  const rawDims = isRecord(obj.dims) ? obj.dims : null;
  if (!rawDims) {
    missingCriteria.push("dims:object");
  } else {
    const rawKeys = Object.keys(rawDims);
    const missingDimensions = SHOT_TABLE_CRITIC_DIMENSIONS.filter(
      (dimension) => !Object.prototype.hasOwnProperty.call(rawDims, dimension),
    );
    const unexpectedDimensions = rawKeys.filter((key) => !DIMENSION_SET.has(key));
    if (missingDimensions.length > 0) {
      missingCriteria.push(`dims.missing:${missingDimensions.join(",")}`);
    }
    if (unexpectedDimensions.length > 0) {
      missingCriteria.push(`dims.unexpected:${unexpectedDimensions.join(",")}`);
    }
    for (const dimension of SHOT_TABLE_CRITIC_DIMENSIONS) {
      const value = rawDims[dimension];
      if (typeof value !== "string" || !DIMENSION_VALUES.has(value)) {
        if (Object.prototype.hasOwnProperty.call(rawDims, dimension)) {
          missingCriteria.push(`dims.${dimension}:ok|weak|missing`);
        }
        continue;
      }
      dims[dimension] = value;
    }
  }

  const issues = readStringArray(obj.issues, "issues", missingCriteria).slice(0, 5);
  const topFixes = readStringArray(obj.topFixes, "topFixes", missingCriteria).slice(0, 3);
  const affectedClipIndexes: number[] = [];
  const rawAffectedClipIndexes = obj.affectedClipIndexes;
  if (
    !Array.isArray(rawAffectedClipIndexes) ||
    rawAffectedClipIndexes.some(
      (value) => typeof value !== "number" || !Number.isInteger(value) || value < 0,
    )
  ) {
    missingCriteria.push("affectedClipIndexes:nonNegativeInteger[]");
  } else {
    affectedClipIndexes.push(...new Set(rawAffectedClipIndexes as number[]));
    affectedClipIndexes.sort((left, right) => left - right);
  }

  if (missingCriteria.length > 0) return { ok: false, missingCriteria };
  return {
    ok: true,
    verdict: {
      pass: obj.pass as boolean,
      score: Math.max(0, Math.min(100, Math.round(score))),
      dims,
      issues,
      topFixes,
      affectedClipIndexes,
    },
  };
}

function tryParseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Collect every balanced JSON object, including nested objects, while respecting quoted braces.
 * This deliberately avoids first-"{"/last-"}" slicing, which breaks when a model emits prose or
 * more than one object around an otherwise valid verdict.
 */
function collectBalancedObjectCandidates(value: string): Record<string, unknown>[] {
  const starts: number[] = [];
  const serialized = new Set<string>();
  const candidates: Record<string, unknown>[] = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      starts.push(index);
      continue;
    }
    if (character !== "}" || starts.length === 0) continue;
    const start = starts.pop();
    if (typeof start !== "number") continue;
    const fragment = value.slice(start, index + 1);
    if (serialized.has(fragment)) continue;
    const candidate = tryParseObject(fragment);
    if (!candidate) continue;
    serialized.add(fragment);
    candidates.push(candidate);
    if (candidates.length >= MAX_JSON_CANDIDATES) break;
  }
  return candidates;
}

function extractSseText(value: string): string {
  if (!value.includes("data:")) return "";
  let accumulated = "";
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") continue;
    const event = tryParseObject(payload);
    if (!event) continue;
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      accumulated += event.delta;
      continue;
    }
    const choices = Array.isArray(event.choices) ? event.choices : [];
    const firstChoice = isRecord(choices[0]) ? choices[0] : null;
    const delta = firstChoice && isRecord(firstChoice.delta) ? firstChoice.delta.content : null;
    const message = firstChoice && isRecord(firstChoice.message) ? firstChoice.message.content : null;
    const piece = typeof delta === "string" ? delta : message;
    if (typeof piece === "string") accumulated += piece;
  }
  return accumulated;
}

function collectCandidates(raw: string): Record<string, unknown>[] {
  const text = raw.trim();
  const direct = tryParseObject(text);
  const sources = [extractSseText(text), text].filter(Boolean);
  const candidates = direct ? [direct] : [];
  for (const source of sources) candidates.push(...collectBalancedObjectCandidates(source));
  return candidates.slice(0, MAX_JSON_CANDIDATES);
}

export function parseShotTableCriticOutput(raw: string): ShotTableCriticOutputParseResult {
  const text = String(raw ?? "").trim();
  if (!text) {
    return {
      ok: false,
      diagnostic: {
        failureReason: "critic_output_empty",
        missingCriteria: ["non_empty_model_output", "single_json_verdict"],
        requiredActions: ["返回一个非空 JSON verdict", "禁止输出解释、Markdown 或前后缀"],
        rawChars: 0,
        candidateCount: 0,
      },
    };
  }

  const candidates = collectCandidates(text);
  if (candidates.length === 0) {
    return {
      ok: false,
      diagnostic: {
        failureReason: "critic_json_object_missing",
        missingCriteria: ["single_json_verdict"],
        requiredActions: ["仅返回一个以 { 开头、以 } 结尾的 JSON 对象", "禁止输出散文或代码围栏"],
        rawChars: text.length,
        candidateCount: 0,
      },
    };
  }

  let closestMissingCriteria: string[] | null = null;
  for (const candidate of candidates) {
    const validation = validateCandidate(candidate);
    if (validation.ok) {
      return { ok: true, verdict: validation.verdict, candidateCount: candidates.length };
    }
    if (
      closestMissingCriteria === null ||
      validation.missingCriteria.length < closestMissingCriteria.length
    ) {
      closestMissingCriteria = validation.missingCriteria;
    }
  }

  const missingCriteria = closestMissingCriteria ?? ["complete_critic_schema"];
  return {
    ok: false,
    diagnostic: {
      failureReason: "critic_schema_invalid",
      missingCriteria,
      requiredActions: [
        `修复且仅修复结构字段：${missingCriteria.join("；")}`,
        "29 个 dims 键必须完整且只能使用 ok、weak、missing",
        "仅返回单个紧凑 JSON，不得附加解释",
      ],
      rawChars: text.length,
      candidateCount: candidates.length,
    },
  };
}

export function normalizeShotTableCriticVerdict(
  obj: Record<string, unknown>,
): ShotTableCriticModelVerdict | null {
  const validation = validateCandidate(obj);
  return validation.ok ? validation.verdict : null;
}
