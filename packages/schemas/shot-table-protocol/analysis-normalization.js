"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseShotTableAnalysisJson = exports.inspectShotTableAnalysisJson = exports.normalizeShotTableAnalysis = exports.normalizeShotTableAnalysisDetailed = void 0;
const column_contract_1 = require("./column-contract");
const defaults_1 = require("./defaults");
const analysis_invariants_1 = require("./analysis-invariants");
const types_1 = require("./types");
const readActualValue = (value, present = true) => {
    if (!present)
        return 'missing';
    if (value === null)
        return 'null';
    if (Array.isArray(value))
        return 'array';
    if (typeof value === 'object')
        return 'object';
    if (typeof value === 'string')
        return 'string';
    if (typeof value === 'number')
        return 'number';
    if (typeof value === 'boolean')
        return 'boolean';
    if (typeof value === 'undefined')
        return 'undefined';
    return 'other';
};
const violation = (input) => ({ ...input, path: [...input.path] });
const failure = (document, violations) => ({
    ok: false,
    issues: violations.map((entry) => entry.message),
    violations,
    document,
});
const readExactStringRecord = (value, expectedKeys, context, path) => {
    if (!(0, types_1.isShotTableRecord)(value)) {
        return {
            value: null,
            violations: [violation({
                    code: 'expected_object',
                    path,
                    expected: 'object',
                    actual: readActualValue(value),
                    message: `${context}不是对象。`,
                })],
        };
    }
    const violations = [];
    const expected = new Set(expectedKeys);
    for (const key of expectedKeys) {
        const present = Object.prototype.hasOwnProperty.call(value, key);
        if (!present) {
            violations.push(violation({
                code: 'missing_field',
                path: [...path, key],
                expected: 'string',
                actual: 'missing',
                message: `${context}缺少字段：${key}。`,
            }));
            continue;
        }
        const raw = value[key];
        if (typeof raw !== 'string') {
            violations.push(violation({
                code: 'expected_string',
                path: [...path, key],
                expected: 'string',
                actual: readActualValue(raw),
                message: `${context}的“${key}”不是字符串。`,
            }));
        }
    }
    for (const key of Object.keys(value)) {
        if (expected.has(key))
            continue;
        violations.push(violation({
            code: 'unexpected_field',
            path: [...path, key],
            expected: 'declared_fields_only',
            actual: readActualValue(value[key]),
            message: `${context}包含未声明字段：${key}。`,
        }));
    }
    if (violations.length > 0)
        return { value: null, violations };
    const output = {};
    for (const key of expectedKeys) {
        const raw = value[key];
        if (typeof raw === 'string')
            output[key] = raw.trim();
    }
    return { value: output, violations: [] };
};
const readAnalysisShot = (value, index, shotKeys, timelineKeys) => {
    const context = `第 ${index + 1} 个镜头`;
    const path = ['shots', index];
    if (!(0, types_1.isShotTableRecord)(value)) {
        return {
            value: null,
            violations: [violation({
                    code: 'expected_object',
                    path,
                    expected: 'object',
                    actual: readActualValue(value),
                    message: `${context}不是对象。`,
                })],
        };
    }
    const violations = [];
    const rootKeys = new Set(['shot', 'timeline']);
    for (const key of Object.keys(value)) {
        if (rootKeys.has(key))
            continue;
        violations.push(violation({
            code: 'unexpected_field',
            path: [...path, key],
            expected: 'declared_fields_only',
            actual: readActualValue(value[key]),
            message: `${context}包含未声明字段：${key}。`,
        }));
    }
    let shot;
    if (!Object.prototype.hasOwnProperty.call(value, 'shot')) {
        shot = {
            value: null,
            violations: [violation({
                    code: 'missing_field',
                    path: [...path, 'shot'],
                    expected: 'object',
                    actual: 'missing',
                    message: `${context}缺少 shot 对象。`,
                })],
        };
    }
    else {
        shot = readExactStringRecord(value.shot, shotKeys, `${context}的 shot`, [...path, 'shot']);
    }
    violations.push(...shot.violations);
    const timeline = [];
    if (!Object.prototype.hasOwnProperty.call(value, 'timeline')) {
        violations.push(violation({
            code: 'missing_field',
            path: [...path, 'timeline'],
            expected: 'array',
            actual: 'missing',
            message: `${context}缺少 timeline 数组。`,
        }));
    }
    else if (!Array.isArray(value.timeline)) {
        violations.push(violation({
            code: 'expected_array',
            path: [...path, 'timeline'],
            expected: 'array',
            actual: readActualValue(value.timeline),
            message: `${context}的 timeline 不是数组。`,
        }));
    }
    else if (value.timeline.length === 0) {
        violations.push(violation({
            code: 'empty_array',
            path: [...path, 'timeline'],
            expected: 'non_empty_array',
            actual: 'array',
            message: `${context}的 timeline 至少需要一个时序段。`,
        }));
    }
    else {
        value.timeline.forEach((entry, timelineIndex) => {
            const parsed = readExactStringRecord(entry, timelineKeys, `${context}第 ${timelineIndex + 1} 个时序`, [...path, 'timeline', timelineIndex]);
            violations.push(...parsed.violations);
            if (parsed.value)
                timeline.push(parsed.value);
        });
    }
    return violations.length > 0 || !shot.value
        ? { value: null, violations }
        : { value: { shot: shot.value, timeline }, violations: [] };
};
const normalizeShotTableAnalysisDetailed = (value, columns = defaults_1.DEFAULT_SHOT_TABLE_COLUMNS, options = {}) => {
    const resolved = (0, column_contract_1.resolveShotTableColumnContract)(columns);
    if (!resolved.ok) {
        return failure(value, resolved.issues.map((message) => violation({
            code: 'column_contract_invalid',
            path: [],
            expected: 'column_contract',
            actual: 'other',
            message,
        })));
    }
    if (!(0, types_1.isShotTableRecord)(value)) {
        return failure(value, [violation({
                code: 'expected_object',
                path: [],
                expected: 'object',
                actual: readActualValue(value),
                message: '分镜分析结果不是对象。',
            })]);
    }
    const violations = [];
    const rootKeys = new Set(['version', 'overview', 'shots']);
    for (const key of Object.keys(value)) {
        if (rootKeys.has(key))
            continue;
        violations.push(violation({
            code: 'unexpected_field',
            path: [key],
            expected: 'declared_fields_only',
            actual: readActualValue(value[key]),
            message: `分镜分析结果包含未声明字段：${key}。`,
        }));
    }
    if (value.version !== 1) {
        violations.push(violation({
            code: 'invalid_version',
            path: ['version'],
            expected: 'version_1',
            actual: readActualValue(value.version, Object.prototype.hasOwnProperty.call(value, 'version')),
            message: '分镜分析结果版本必须为 1。',
        }));
    }
    let overview;
    if (!Object.prototype.hasOwnProperty.call(value, 'overview')) {
        overview = {
            value: null,
            violations: [violation({
                    code: 'missing_field',
                    path: ['overview'],
                    expected: 'object',
                    actual: 'missing',
                    message: '分镜分析结果缺少 overview 对象。',
                })],
        };
    }
    else {
        overview = readExactStringRecord(value.overview, defaults_1.SHOT_TABLE_OVERVIEW_ORDER, '镜头总览', ['overview']);
    }
    violations.push(...overview.violations);
    const shots = [];
    if (!Object.prototype.hasOwnProperty.call(value, 'shots')) {
        violations.push(violation({
            code: 'missing_field',
            path: ['shots'],
            expected: 'array',
            actual: 'missing',
            message: '分镜分析结果缺少 shots 数组。',
        }));
    }
    else if (!Array.isArray(value.shots)) {
        violations.push(violation({
            code: 'expected_array',
            path: ['shots'],
            expected: 'array',
            actual: readActualValue(value.shots),
            message: '分镜分析结果的 shots 不是数组。',
        }));
    }
    else if (value.shots.length === 0) {
        violations.push(violation({
            code: 'empty_array',
            path: ['shots'],
            expected: 'non_empty_array',
            actual: 'array',
            message: '分镜分析结果至少需要一个镜头。',
        }));
    }
    else {
        const shotKeys = resolved.value.shotColumns.map((column) => column.key);
        const timelineKeys = resolved.value.timelineColumns.map((column) => column.key);
        value.shots.forEach((entry, index) => {
            const parsed = readAnalysisShot(entry, index, shotKeys, timelineKeys);
            violations.push(...parsed.violations);
            if (parsed.value)
                shots.push(parsed.value);
        });
    }
    if (violations.length > 0 || !overview.value)
        return failure(value, violations);
    const payload = {
        version: 1,
        overview: overview.value,
        shots,
    };
    const invariantViolations = (0, analysis_invariants_1.inspectShotTableAnalysisInvariants)(payload, options).map((entry) => violation({
        ...entry,
        actual: 'string',
    }));
    if (invariantViolations.length > 0)
        return failure(value, invariantViolations);
    const rows = [];
    payload.shots.forEach((entry, shotIndex) => {
        const shotId = `shot-${shotIndex + 1}`;
        entry.timeline.forEach((timeline, timelineIndex) => {
            rows.push({
                id: `${shotId}-segment-${timelineIndex + 1}`,
                shotId,
                values: Object.fromEntries(resolved.value.columns.map((column) => [
                    column.key,
                    column.scope === 'shot' ? entry.shot[column.key] ?? '' : timeline[column.key] ?? '',
                ])),
            });
        });
    });
    return {
        ok: true,
        document: payload,
        table: {
            version: 1,
            overview: payload.overview,
            columns: resolved.value.columns,
            rows,
        },
    };
};
exports.normalizeShotTableAnalysisDetailed = normalizeShotTableAnalysisDetailed;
const normalizeShotTableAnalysis = (value, columns = defaults_1.DEFAULT_SHOT_TABLE_COLUMNS, options = {}) => {
    const result = (0, exports.normalizeShotTableAnalysisDetailed)(value, columns, options);
    return result.ok ? { ok: true, table: result.table } : { ok: false, issues: result.issues };
};
exports.normalizeShotTableAnalysis = normalizeShotTableAnalysis;
const inspectShotTableAnalysisJson = (rawText, columns = defaults_1.DEFAULT_SHOT_TABLE_COLUMNS, options = {}) => {
    const text = rawText.trim();
    if (!text) {
        return failure(null, [violation({
                code: 'json_empty',
                path: [],
                expected: 'json',
                actual: 'missing',
                message: '分镜分析 JSON 为空。',
            })]);
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch (error) {
        return failure(null, [violation({
                code: 'json_invalid',
                path: [],
                expected: 'json',
                actual: 'string',
                message: `分镜分析结果不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
            })]);
    }
    return (0, exports.normalizeShotTableAnalysisDetailed)(parsed, columns, options);
};
exports.inspectShotTableAnalysisJson = inspectShotTableAnalysisJson;
const parseShotTableAnalysisJson = (rawText, columns = defaults_1.DEFAULT_SHOT_TABLE_COLUMNS, options = {}) => {
    const result = (0, exports.inspectShotTableAnalysisJson)(rawText, columns, options);
    return result.ok ? { ok: true, table: result.table } : { ok: false, issues: result.issues };
};
exports.parseShotTableAnalysisJson = parseShotTableAnalysisJson;
