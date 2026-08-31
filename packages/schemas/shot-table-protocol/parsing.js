"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseShotTableText = void 0;
const normalizeInput = (rawText) => rawText.replace(/\r\n?/g, '\n').trim();
const appendField = (fields, rawLabel, rawValue, context) => {
    const label = rawLabel.trim();
    if (!label) {
        fields.issues.push(`${context}存在空字段名。`);
        return null;
    }
    if (label in fields.values) {
        fields.issues.push(`${context}字段“${label}”重复。`);
        return null;
    }
    fields.order.push(label);
    fields.values[label] = rawValue.trim();
    return label;
};
const parseLabeledLines = (rawText, context) => {
    const fields = { values: {}, order: [], issues: [] };
    let activeLabel = null;
    for (const rawLine of rawText.split('\n')) {
        const line = rawLine.trim();
        if (!line) {
            activeLabel = null;
            continue;
        }
        const match = /^([^：:\n]{1,100})[：:]\s*(.*)$/.exec(line);
        if (match) {
            activeLabel = appendField(fields, match[1] ?? '', match[2] ?? '', context);
            continue;
        }
        if (activeLabel) {
            fields.values[activeLabel] = fields.values[activeLabel]
                ? `${fields.values[activeLabel]}\n${line}`
                : line;
            continue;
        }
        fields.issues.push(`${context}存在无法识别的内容：“${line.slice(0, 80)}”。`);
    }
    return fields;
};
const splitShotBlocks = (text) => {
    const starts = Array.from(text.matchAll(/^=========单镜头开始=========\s*$/gm));
    if (starts.length === 0) {
        return { ok: false, issues: ['没有解析到完整的“=========单镜头开始=========”标记。'] };
    }
    const blocks = [];
    for (let index = 0; index < starts.length; index += 1) {
        const start = starts[index];
        const contentStart = (start.index ?? 0) + start[0].length;
        const nextStart = starts[index + 1]?.index ?? text.length;
        const slice = text.slice(contentStart, nextStart);
        const end = /^=========单镜头结束=========\s*$/m.exec(slice);
        if (!end || end.index === undefined) {
            return { ok: false, issues: [`第 ${index + 1} 个镜头缺少完整的“=========单镜头结束=========”标记。`] };
        }
        const trailing = slice.slice(end.index + end[0].length).trim();
        if (trailing) {
            return { ok: false, issues: [`第 ${index + 1} 个镜头结束标记后存在额外内容。`] };
        }
        blocks.push({ body: slice.slice(0, end.index).trim(), index });
    }
    return blocks;
};
const parseTimelineRows = (rawText, shotIndex) => {
    if (!rawText.trim()) {
        return { ok: false, issues: [`第 ${shotIndex + 1} 个镜头的时序细分为空。`] };
    }
    const rows = [];
    let current = null;
    let activeLabel = null;
    const pushCurrent = () => {
        if (current)
            rows.push(current);
        current = null;
        activeLabel = null;
    };
    for (const rawLine of rawText.split('\n')) {
        const line = rawLine.trim();
        if (!line) {
            activeLabel = null;
            continue;
        }
        const match = /^([^：:\n]{1,100})[：:]\s*(.*)$/.exec(line);
        if (!match) {
            if (current && activeLabel) {
                current.values[activeLabel] = current.values[activeLabel]
                    ? `${current.values[activeLabel]}\n${line}`
                    : line;
            }
            else if (current) {
                current.issues.push(`第 ${shotIndex + 1} 个镜头时序存在无法识别的内容：“${line.slice(0, 80)}”。`);
            }
            else {
                return { ok: false, issues: [`第 ${shotIndex + 1} 个镜头的时序字段必须从“时间段”开始。`] };
            }
            continue;
        }
        const label = (match[1] ?? '').trim();
        if (label === '时间段') {
            pushCurrent();
            current = { values: {}, order: [], issues: [] };
        }
        else if (!current) {
            return { ok: false, issues: [`第 ${shotIndex + 1} 个镜头的时序字段必须从“时间段”开始。`] };
        }
        if (current) {
            activeLabel = appendField(current, label, match[2] ?? '', `第 ${shotIndex + 1} 个镜头第 ${rows.length + 1} 个时序`);
        }
    }
    pushCurrent();
    if (rows.length === 0) {
        return { ok: false, issues: [`第 ${shotIndex + 1} 个镜头没有解析到任何“时间段”行。`] };
    }
    const issues = rows.flatMap((row) => row.issues);
    return issues.length > 0 ? { ok: false, issues } : rows;
};
const addColumn = (columns, seen, label, scope) => {
    if (!seen.has(label)) {
        seen.add(label);
        columns.push({ key: label, label, scope });
    }
};
const validateExpectedColumns = (columns) => {
    const labels = new Set();
    const issues = [];
    for (const column of columns) {
        if (labels.has(column.label))
            issues.push(`当前分镜表存在重复列名：“${column.label}”。`);
        labels.add(column.label);
    }
    if (!columns.some((column) => column.scope === 'timeline' && column.label === '时间段')) {
        issues.push('当前分镜表缺少时序列“时间段”，无法使用结构化文本协议。');
    }
    return issues;
};
const validateFieldSet = (fields, expected, scope, context) => {
    const expectedLabels = expected.filter((column) => column.scope === scope).map((column) => column.label);
    const expectedSet = new Set(expectedLabels);
    const actualSet = new Set(fields.order);
    const missing = expectedLabels.filter((label) => !actualSet.has(label));
    const unexpected = fields.order.filter((label) => !expectedSet.has(label));
    return [
        ...(missing.length > 0 ? [`${context}缺少字段：${missing.join('、')}。`] : []),
        ...(unexpected.length > 0 ? [`${context}包含当前表不存在的字段：${unexpected.join('、')}。`] : []),
    ];
};
const buildOutputColumns = (expectedColumns, shotColumns, timelineColumns) => {
    if (expectedColumns)
        return expectedColumns.map((column) => ({ ...column }));
    const timeColumn = timelineColumns.find((column) => column.label === '时间段');
    return [
        ...(timeColumn ? [timeColumn] : []),
        ...shotColumns,
        ...timelineColumns.filter((column) => column.label !== '时间段'),
    ];
};
const mapRowsToColumns = (rows, columns) => rows.map((row) => ({
    ...row,
    values: Object.fromEntries(columns.map((column) => [column.key, row.values[column.label] ?? ''])),
}));
const parseShotTableText = (rawText, options = {}) => {
    const text = normalizeInput(rawText);
    if (!text)
        return { ok: false, issues: ['分镜原文为空。'] };
    if (text.startsWith('```') || text.endsWith('```')) {
        return { ok: false, issues: ['分镜原文包含禁止的代码围栏。'] };
    }
    if (!text.startsWith('【镜头总览】')) {
        return { ok: false, issues: ['分镜原文必须从“【镜头总览】”开始，前面不能包含解释或其他内容。'] };
    }
    const expectedIssues = options.expectedColumns
        ? validateExpectedColumns(options.expectedColumns)
        : [];
    if (expectedIssues.length > 0)
        return { ok: false, issues: expectedIssues };
    const parsedBlocks = splitShotBlocks(text);
    if (!Array.isArray(parsedBlocks))
        return parsedBlocks;
    const firstShotStart = text.indexOf('=========单镜头开始=========');
    const overviewText = text.slice('【镜头总览】'.length, firstShotStart);
    const parsedOverview = parseLabeledLines(overviewText, '镜头总览');
    if (parsedOverview.issues.length > 0)
        return { ok: false, issues: parsedOverview.issues };
    if (parsedOverview.order.length === 0)
        return { ok: false, issues: ['“【镜头总览】”没有字段。'] };
    const shotColumns = [];
    const timelineColumns = [];
    const seenColumns = new Set();
    const rows = [];
    const structuralFields = [];
    for (const block of parsedBlocks) {
        const timelineMatch = /^---镜头内时序细分\s*$/m.exec(block.body);
        if (!timelineMatch || timelineMatch.index === undefined) {
            return { ok: false, issues: [`第 ${block.index + 1} 个镜头缺少“---镜头内时序细分”区块。`] };
        }
        const shotText = block.body.slice(0, timelineMatch.index).trim();
        const timelineText = block.body.slice(timelineMatch.index + timelineMatch[0].length).trim();
        const shotFields = parseLabeledLines(shotText, `第 ${block.index + 1} 个镜头`);
        if (shotFields.issues.length > 0)
            return { ok: false, issues: shotFields.issues };
        if (shotFields.order.length === 0) {
            return { ok: false, issues: [`第 ${block.index + 1} 个镜头没有镜头级字段。`] };
        }
        const timelineRows = parseTimelineRows(timelineText, block.index);
        if (!Array.isArray(timelineRows))
            return timelineRows;
        if (options.expectedColumns) {
            const shotIssues = validateFieldSet(shotFields, options.expectedColumns, 'shot', `第 ${block.index + 1} 个镜头`);
            if (shotIssues.length > 0)
                return { ok: false, issues: shotIssues };
        }
        shotFields.order.forEach((label) => addColumn(shotColumns, seenColumns, label, 'shot'));
        structuralFields.push({ fields: shotFields, scope: 'shot', context: `第 ${block.index + 1} 个镜头` });
        for (let timelineIndex = 0; timelineIndex < timelineRows.length; timelineIndex += 1) {
            const timeline = timelineRows[timelineIndex];
            if (!timeline)
                continue;
            if (options.expectedColumns) {
                const timelineIssues = validateFieldSet(timeline, options.expectedColumns, 'timeline', `第 ${block.index + 1} 个镜头第 ${timelineIndex + 1} 个时序`);
                if (timelineIssues.length > 0)
                    return { ok: false, issues: timelineIssues };
            }
            timeline.order.forEach((label) => addColumn(timelineColumns, seenColumns, label, 'timeline'));
            structuralFields.push({
                fields: timeline,
                scope: 'timeline',
                context: `第 ${block.index + 1} 个镜头第 ${timelineIndex + 1} 个时序`,
            });
            rows.push({
                id: `shot-${block.index + 1}-segment-${timelineIndex + 1}`,
                shotId: `shot-${block.index + 1}`,
                values: { ...shotFields.values, ...timeline.values },
            });
        }
    }
    if (!options.expectedColumns) {
        const discovered = [...shotColumns, ...timelineColumns];
        for (const entry of structuralFields) {
            const issues = validateFieldSet(entry.fields, discovered, entry.scope, entry.context);
            if (issues.length > 0)
                return { ok: false, issues };
        }
    }
    const columns = buildOutputColumns(options.expectedColumns, shotColumns, timelineColumns);
    if (columns.length === 0 || rows.length === 0) {
        return { ok: false, issues: ['分镜结果没有形成可编辑的列和行。'] };
    }
    return {
        ok: true,
        table: {
            version: 1,
            overview: parsedOverview.values,
            columns,
            rows: mapRowsToColumns(rows, columns),
        },
    };
};
exports.parseShotTableText = parseShotTableText;
