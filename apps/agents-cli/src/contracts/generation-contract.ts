const GENERATION_CONTRACT_VERSION = "v1" as const;
const GENERATION_CONTRACT_MAX_LIST_ITEMS = 12;
const GENERATION_CONTRACT_MAX_TEXT_LENGTH = 240;
const GENERATION_CONTRACT_MAX_ID_LENGTH = 160;
const GENERATION_CONTRACT_ALLOWED_KEYS = new Set([
  "version",
  "lockedAnchors",
  "editableVariable",
  "forbiddenChanges",
  "approvedKeyframeId",
]);

export type GenerationContract = {
  version: typeof GENERATION_CONTRACT_VERSION;
  lockedAnchors: string[];
  editableVariable: string | null;
  forbiddenChanges: string[];
  approvedKeyframeId: string | null;
};

export type GenerationContractParseResult =
  | { ok: true; value: GenerationContract | null }
  | { ok: false; error: string };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeBoundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeStringList(
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = normalizeBoundedString(item, maxLength);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= maxItems) break;
  }
  return out;
}

function parseNullableString(
  value: unknown,
  maxLength: number,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, value: null };
  const normalized = normalizeBoundedString(value, maxLength);
  if (!normalized) {
    return {
      ok: false,
      error: "must be a non-empty string or null",
    };
  }
  return { ok: true, value: normalized };
}

export function parseGenerationContract(input: unknown): GenerationContractParseResult {
  if (typeof input === "undefined" || input === null) {
    return { ok: true, value: null };
  }
  if (!isPlainRecord(input)) {
    return { ok: false, error: "generationContract must be a plain object" };
  }

  const extraKeys = Object.keys(input).filter((key) => !GENERATION_CONTRACT_ALLOWED_KEYS.has(key));
  if (extraKeys.length > 0) {
    return {
      ok: false,
      error: `generationContract contains unsupported keys: ${extraKeys.join(", ")}`,
    };
  }

  const version = normalizeBoundedString(input.version, 16);
  if (version !== GENERATION_CONTRACT_VERSION) {
    return {
      ok: false,
      error: `generationContract.version must be ${GENERATION_CONTRACT_VERSION}`,
    };
  }

  const lockedAnchors = normalizeStringList(
    input.lockedAnchors,
    GENERATION_CONTRACT_MAX_LIST_ITEMS,
    GENERATION_CONTRACT_MAX_TEXT_LENGTH,
  );
  if (lockedAnchors === null) {
    return {
      ok: false,
      error: "generationContract.lockedAnchors must be an array of strings",
    };
  }

  const forbiddenChanges = normalizeStringList(
    input.forbiddenChanges,
    GENERATION_CONTRACT_MAX_LIST_ITEMS,
    GENERATION_CONTRACT_MAX_TEXT_LENGTH,
  );
  if (forbiddenChanges === null) {
    return {
      ok: false,
      error: "generationContract.forbiddenChanges must be an array of strings",
    };
  }

  if (!Object.prototype.hasOwnProperty.call(input, "editableVariable")) {
    return {
      ok: false,
      error: "generationContract.editableVariable is required",
    };
  }

  const editableVariable = parseNullableString(
    input.editableVariable,
    GENERATION_CONTRACT_MAX_TEXT_LENGTH,
  );
  if (!editableVariable.ok) {
    return {
      ok: false,
      error: `generationContract.editableVariable ${editableVariable.error}`,
    };
  }

  if (!Object.prototype.hasOwnProperty.call(input, "approvedKeyframeId")) {
    return {
      ok: false,
      error: "generationContract.approvedKeyframeId is required",
    };
  }

  const approvedKeyframeId = parseNullableString(
    input.approvedKeyframeId,
    GENERATION_CONTRACT_MAX_ID_LENGTH,
  );
  if (!approvedKeyframeId.ok) {
    return {
      ok: false,
      error: `generationContract.approvedKeyframeId ${approvedKeyframeId.error}`,
    };
  }

  return {
    ok: true,
    value: {
      version: GENERATION_CONTRACT_VERSION,
      lockedAnchors,
      editableVariable: editableVariable.value,
      forbiddenChanges,
      approvedKeyframeId: approvedKeyframeId.value,
    },
  };
}

export function formatGenerationContractPromptLines(contract: GenerationContract | null): string[] {
  if (!contract) return [];
  return [
    "GenerationContract:",
    `- version: ${contract.version}`,
    `- lockedAnchors: ${contract.lockedAnchors.length ? contract.lockedAnchors.join(" | ") : "(none)"}`,
    `- editableVariable: ${contract.editableVariable ?? "(none)"}`,
    `- forbiddenChanges: ${contract.forbiddenChanges.length ? contract.forbiddenChanges.join(" | ") : "(none)"}`,
    `- approvedKeyframeId: ${contract.approvedKeyframeId ?? "(none)"}`,
    "- Treat this contract as explicit upstream execution state. Do not invent missing fields or silently widen it.",
  ];
}

export {
  GENERATION_CONTRACT_MAX_ID_LENGTH,
  GENERATION_CONTRACT_MAX_LIST_ITEMS,
  GENERATION_CONTRACT_MAX_TEXT_LENGTH,
  GENERATION_CONTRACT_VERSION,
};
