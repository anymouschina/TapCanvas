import { TOOL_DEFINITIONS } from './contract.ts';
type Schema = { type?: string; description?: string; enum?: readonly unknown[]; properties?: Record<string, Schema>; required?: readonly string[]; additionalProperties?: boolean; items?: Schema; minItems?: number; maxItems?: number };
// The tool contract uses this deliberately small JSON Schema subset. No generated code/eval.
export function validateToolInput(name: string, input: unknown) {
    const definition = TOOL_DEFINITIONS.find(t => t.name === name);
    if (!definition) throw new Error('未知工具');
    function visit(value: unknown, schema: Schema, at: string, depth = 0) {
        if (depth > 30) throw new Error('工具参数嵌套过深');
        const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
        if (schema.type && type !== schema.type || schema.enum && !schema.enum.includes(value)) throw new Error('工具参数类型或取值错误：' + at
            + `；需要 ${schema.enum ? schema.enum.map(v => JSON.stringify(v)).join(' / ') : schema.type}` + (schema.description ? `；${schema.description}` : ''));
        if (type === 'number' && !Number.isFinite(value)) throw new Error('工具参数必须是有限数字：' + at);
        if (Array.isArray(value)) {
            if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 10000)) throw new Error('工具参数数组长度错误：' + at);
            value.forEach((v, i) => visit(v, schema.items || {}, `${at}[${i}]`, depth + 1));
        } else if (value && typeof value === 'object') {
            for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new Error('缺少工具参数：' + at + '.' + key);
            for (const [key, v] of Object.entries(value)) {
                if (['__proto__', 'constructor', 'prototype'].includes(key) || schema.additionalProperties === false && !Object.hasOwn(schema.properties || {}, key)) throw new Error('未知工具参数：' + at + '.' + key);
                visit(v, schema.properties?.[key] || {}, at + '.' + key, depth + 1);
            }
        } else if (!['string', 'number', 'boolean', 'null'].includes(type)) throw new Error('工具参数不是 JSON：' + at);
    }
    visit(input, definition.inputSchema as Schema, name);
    if (name === 'director_apply') {
        const args = input as Record<string, unknown>;
        if (args.previewId !== undefined) {
            if (typeof args.previewId !== 'string' || !args.previewId || args.operations !== undefined || args.preview === true) throw Error('previewId 仅用于提交已有预检，不可同时提供 operations 或 preview:true');
        } else if (args.operations === undefined) throw Error('缺少工具参数：director_apply.operations 或 previewId');
    }
    if (JSON.stringify(input).length > (name==='director_media'?720_010_000:2_000_000)) throw new Error('工具参数过大');
}
