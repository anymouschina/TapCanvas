"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asRecord = asRecord;
exports.pushIssue = pushIssue;
exports.ensureAllowedKeys = ensureAllowedKeys;
exports.readRequiredRecord = readRequiredRecord;
exports.readRequiredArray = readRequiredArray;
exports.readRequiredString = readRequiredString;
exports.validateOptionalString = validateOptionalString;
exports.readRequiredFiniteNumber = readRequiredFiniteNumber;
exports.validateRequiredBoolean = validateRequiredBoolean;
exports.readStringArray = readStringArray;
exports.validateStringFields = validateStringFields;
exports.parseStoryPoint = parseStoryPoint;
exports.compareStoryPoints = compareStoryPoints;
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function hasOwn(record, key) {
    return Object.prototype.hasOwnProperty.call(record, key);
}
function pushIssue(issues, code, path, message) {
    issues.push({ code, path, message });
}
function ensureAllowedKeys(record, allowedKeys, path, issues) {
    const allowed = new Set(allowedKeys);
    for (const key of Object.keys(record)) {
        if (allowed.has(key))
            continue;
        pushIssue(issues, "additional_property_forbidden", `${path}.${key}`, `不允许字段 ${key}`);
    }
}
function readRequiredRecord(record, key, path, issues) {
    const value = asRecord(record[key]);
    if (value)
        return value;
    pushIssue(issues, "required_object_missing", `${path}.${key}`, `${key} 必须是对象`);
    return null;
}
function readRequiredArray(record, key, path, issues, minItems = 0) {
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
function readRequiredString(record, key, path, issues, maxLength = 4_000) {
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
function validateOptionalString(record, key, path, issues, maxLength = 4_000) {
    if (!hasOwn(record, key))
        return;
    if (typeof record[key] !== "string" || record[key].length > maxLength) {
        pushIssue(issues, "optional_string_invalid", `${path}.${key}`, `${key} 必须是长度不超过 ${maxLength} 的字符串`);
    }
}
function readRequiredFiniteNumber(record, key, path, issues, options = {}) {
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
            pushIssue(issues, "number_below_minimum", `${path}.${key}`, `${key} 必须${options.exclusiveMin ? "大于" : "不小于"} ${options.min}`);
        }
    }
    if (options.max !== undefined && value > options.max) {
        pushIssue(issues, "number_above_maximum", `${path}.${key}`, `${key} 不能大于 ${options.max}`);
    }
    return value;
}
function validateRequiredBoolean(record, key, path, issues) {
    if (typeof record[key] !== "boolean") {
        pushIssue(issues, "required_boolean_missing", `${path}.${key}`, `${key} 必须是布尔值`);
    }
}
function readStringArray(value, path, issues, options = {}) {
    if (!Array.isArray(value)) {
        pushIssue(issues, "string_array_required", path, "必须是字符串数组");
        return [];
    }
    const minItems = options.minItems ?? 0;
    const maxItems = options.maxItems ?? 1_000;
    if (value.length < minItems)
        pushIssue(issues, "array_too_short", path, `至少需要 ${minItems} 项`);
    if (value.length > maxItems)
        pushIssue(issues, "array_too_long", path, `最多允许 ${maxItems} 项`);
    const normalized = [];
    const seen = new Set();
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
function validateStringFields(record, requiredKeys, path, issues) {
    for (const key of requiredKeys)
        readRequiredString(record, key, path, issues);
}
function parseStoryPoint(value, path, issues) {
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
    if (chapter === null || sequence === null)
        return null;
    const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : undefined;
    return { chapter, sequence, ...(label ? { label } : null) };
}
function compareStoryPoints(left, right) {
    if (left.chapter !== right.chapter)
        return left.chapter - right.chapter;
    return left.sequence - right.sequence;
}
