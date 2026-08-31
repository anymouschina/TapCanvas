import type {
  StoryboardDirectorV12ValidationIssue,
  StoryboardStoryPoint,
} from "./types";

export type UnknownRecord = Record<string, unknown>;

export function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function pushIssue(
  issues: StoryboardDirectorV12ValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

export function ensureAllowedKeys(
  record: UnknownRecord,
  allowedKeys: readonly string[],
  path: string,
  issues: StoryboardDirectorV12ValidationIssue[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (allowed.has(key)) continue;
    pushIssue(issues, "additional_property_forbidden", `${path}.${key}`, `不允许字段 ${key}`);
  }
}

export function readRequiredRecord(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: StoryboardDirectorV12ValidationIssue[],
): UnknownRecord | null {
  const value = asRecord(record[key]);
  if (value) return value;
  pushIssue(issues, "required_object_missing", `${path}.${key}`, `${key} 必须是对象`);
  return null;
}

export function readRequiredArray(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: StoryboardDirectorV12ValidationIssue[],
  minItems = 0,
): unknown[] | null {
  const value = record[key];
  if (!Array.isArray(value)) {
    pushIssue(issues, "required_array_missing", `${path}.${key}`, `${key} 必须是数组`);
    return null;
  }
  if (value.length < minItems) {
    pushIssue(issues, "array_too_short", `${path}.${key}`, `${key} 至少需要 ${minItems} 项`);
  }
  return value;
}

export function readRequiredString(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: StoryboardDirectorV12ValidationIssue[],
  maxLength = 4_000,
): string {
  const value = typeof record[key] === "string" ? record[key].trim() : "";
  if (!value) {
    pushIssue(issues, "required_string_missing", `${path}.${key}`, `${key} 必须是非空字符串`);
    return "";
  }
  if (value.length > maxLength) {
    pushIssue(issues, "string_too_long", `${path}.${key}`, `${key} 长度不能超过 ${maxLength}`);
  }
  return value;
}

export function validateOptionalString(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: StoryboardDirectorV12ValidationIssue[],
  maxLength = 4_000,
): void {
  if (!hasOwn(record, key)) return;
  if (typeof record[key] !== "string" || record[key].length > maxLength) {
    pushIssue(issues, "optional_string_invalid", `${path}.${key}`, `${key} 必须是长度不超过 ${maxLength} 的字符串`);
  }
}

export function readRequiredFiniteNumber(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: StoryboardDirectorV12ValidationIssue[],
  options: { min?: number; max?: number; exclusiveMin?: boolean; integer?: boolean } = {},
): number | null {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    pushIssue(issues, "required_number_missing", `${path}.${key}`, `${key} 必须是有限数字`);
    return null;
  }
  if (options.integer && !Number.isInteger(value)) {
    pushIssue(issues, "integer_required", `${path}.${key}`, `${key} 必须是整数`);
  }
  if (options.min !== undefined) {
    const invalid = options.exclusiveMin ? value <= options.min : value < options.min;
    if (invalid) {
      pushIssue(
        issues,
        "number_below_minimum",
        `${path}.${key}`,
        `${key} 必须${options.exclusiveMin ? "大于" : "不小于"} ${options.min}`,
      );
    }
  }
  if (options.max !== undefined && value > options.max) {
    pushIssue(issues, "number_above_maximum", `${path}.${key}`, `${key} 不能大于 ${options.max}`);
  }
  return value;
}

export function validateRequiredBoolean(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: StoryboardDirectorV12ValidationIssue[],
): void {
  if (typeof record[key] !== "boolean") {
    pushIssue(issues, "required_boolean_missing", `${path}.${key}`, `${key} 必须是布尔值`);
  }
}

export function readStringArray(
  value: unknown,
  path: string,
  issues: StoryboardDirectorV12ValidationIssue[],
  options: { minItems?: number; maxItems?: number; unique?: boolean; itemMaxLength?: number } = {},
): string[] {
  if (!Array.isArray(value)) {
    pushIssue(issues, "string_array_required", path, "必须是字符串数组");
    return [];
  }
  const minItems = options.minItems ?? 0;
  const maxItems = options.maxItems ?? 1_000;
  if (value.length < minItems) pushIssue(issues, "array_too_short", path, `至少需要 ${minItems} 项`);
  if (value.length > maxItems) pushIssue(issues, "array_too_long", path, `最多允许 ${maxItems} 项`);
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const item = typeof value[index] === "string" ? value[index].trim() : "";
    if (!item) {
      pushIssue(issues, "string_array_item_invalid", `${path}[${index}]`, "数组项必须是非空字符串");
      continue;
    }
    if (item.length > (options.itemMaxLength ?? 4_000)) {
      pushIssue(issues, "string_array_item_too_long", `${path}[${index}]`, "数组项过长");
    }
    if (options.unique && seen.has(item)) {
      pushIssue(issues, "string_array_duplicate", `${path}[${index}]`, `重复值 ${item}`);
      continue;
    }
    seen.add(item);
    normalized.push(item);
  }
  return normalized;
}

export function validateStringFields(
  record: UnknownRecord,
  requiredKeys: readonly string[],
  path: string,
  issues: StoryboardDirectorV12ValidationIssue[],
): void {
  for (const key of requiredKeys) readRequiredString(record, key, path, issues);
}

export function parseStoryPoint(
  value: unknown,
  path: string,
  issues: StoryboardDirectorV12ValidationIssue[],
): StoryboardStoryPoint | null {
  const record = asRecord(value);
  if (!record) {
    pushIssue(issues, "story_point_invalid", path, "故事点必须是对象");
    return null;
  }
  ensureAllowedKeys(record, ["chapter", "sequence", "label"], path, issues);
  const chapter = readRequiredFiniteNumber(record, "chapter", path, issues, {
    min: 1,
    max: 999_999,
    integer: true,
  });
  const sequence = readRequiredFiniteNumber(record, "sequence", path, issues, {
    min: 0,
    max: 999_999,
    integer: true,
  });
  validateOptionalString(record, "label", path, issues, 160);
  if (chapter === null || sequence === null) return null;
  const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : undefined;
  return { chapter, sequence, ...(label ? { label } : null) };
}

export function compareStoryPoints(left: StoryboardStoryPoint, right: StoryboardStoryPoint): number {
  if (left.chapter !== right.chapter) return left.chapter - right.chapter;
  return left.sequence - right.sequence;
}
