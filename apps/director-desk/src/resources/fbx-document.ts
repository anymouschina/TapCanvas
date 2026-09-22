/** Read FBX structure/metadata without decoding geometry arrays. Shared by packaging and browser loading. */
export interface FbxNode { name: string; values: (string | number | Uint8Array | null)[]; children: FbxNode[] }
export interface FbxDocument { version: number; nodes: FbxNode[]; ascii?: string }
const decoder = new TextDecoder('utf-8', { fatal: true });
const signature = 'Kaydara FBX Binary  \0\x1a\0';

export function readFbxDocument(bytes: Uint8Array): FbxDocument {
    if (new TextDecoder().decode(bytes.subarray(0, 23)) === signature) return readBinary(bytes);
    let text: string;
    try { text = decoder.decode(bytes); } catch { throw Error('FBX 文本编码无效'); }
    const version = Number(/\bFBXVersion:\s*(\d+)/.exec(text)?.[1]);
    if (!Number.isInteger(version) || version < 7000) throw Error('当前需要 ASCII FBX 7.0 或更新版本');
    return readAscii(text, version);
}

function csv(text: string): (string | number)[] {
    const result: (string | number)[] = []; let value = '', quote = false, quoted = false;
    const push = () => { const trimmed = value.trim(); if (trimmed || quoted) result.push(quoted ? value : Number.isFinite(Number(trimmed)) ? Number(trimmed) : trimmed); value = ''; quoted = false; };
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') { if (!quote) value = value.trimStart(); quote = !quote; quoted = true; }
        else if (c === ',' && !quote) push();
        else if (!quoted || quote || !/\s/.test(c)) value += c;
    }
    if (quote) throw Error('FBX 字符串引号未闭合');
    push(); return result;
}

function readAscii(text: string, version: number): FbxDocument {
    const nodes: FbxNode[] = [], stack: FbxNode[] = [], output: string[] = [];
    const arrays = new Map<FbxNode, string[]>();
    let statement = '', quote = false, comment = false, previous: FbxNode | undefined;
    const emit = (open: boolean) => {
        const value = statement.trim(); statement = ''; if (!value && !open) return;
        const match = /^(\w+)\s*:\s*([\s\S]*)$/.exec(value);
        if (!match) {
            if (open || !previous || !value) throw Error('FBX 节点结构无效');
            if (previous.name === 'Content') { previous.values = csv(value); output.push('\t'.repeat(stack.length) + value); }
            else if (previous.name === 'a') { output.push(value); arrays.get(stack.at(-1)!)?.push(value); }
            else throw Error('FBX 包含无法识别的续行');
            return;
        }
        const name = match[1];
        if (['__proto__', 'constructor', 'prototype'].includes(name)) throw Error('FBX 节点名称无效');
        const node: FbxNode = { name, values: name === 'a' ? [] : csv(match[2]), children: [] };
        (stack.at(-1)?.children ?? nodes).push(node);
        output.push('\t'.repeat(stack.length) + name + ': ' + match[2] + (open ? ' {' : ''));
        if (name === 'a' && stack.length) arrays.set(stack.at(-1)!, [match[2]]);
        previous = node;
        if (open) { if (stack.length >= 256) throw Error('FBX 节点嵌套过深'); stack.push(node); }
    };
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (comment) { if (c !== '\n' && c !== '\r') continue; comment = false; }
        if (c === '"') { quote = !quote; statement += c; continue; }
        if (!quote) {
            if (c === ';') { comment = true; continue; }
            if (c === '{') { emit(true); continue; }
            if (c === '}') {
                emit(false); if (!stack.length) throw Error('FBX 结束括号不匹配');
                const node = stack.pop()!, parts = arrays.get(node), count = /^\*(\d+)$/.exec(String(node.values[0]));
                if (count) {
                    const items = (parts ?? []).join('').split(','); if (items.at(-1)?.trim() === '') items.pop();
                    if (!Number.isSafeInteger(Number(count[1])) || items.length !== Number(count[1]) || items.some(v => !v.trim() || !Number.isFinite(Number(v)))) throw Error('FBX 数组数量或数值无效：' + node.name);
                    // A final comma makes Three keep the entire array as a string, corrupting material indices/normals.
                    if (parts) output[output.length - 1] = output.at(-1)!.replace(/,\s*$/, '');
                    arrays.delete(node);
                }
                output.push('\t'.repeat(stack.length) + '}'); previous = undefined; continue;
            }
            if (c === '\n' || c === '\r') { emit(false); continue; }
        }
        statement += c;
    }
    if (quote || stack.length) throw Error('FBX 文本被截断或括号不匹配');
    emit(false);
    // Three's ASCII probe samples the first ~210 characters rather than matching the binary signature.
    // A neutral FBX comment keeps normalized headers from accidentally matching that heuristic.
    return { version, nodes, ascii: ';' + '-'.repeat(255) + '\n' + output.join('\n') + '\n' };
}

function readBinary(bytes: Uint8Array): FbxDocument {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let offset = 23;
    const requireBytes = (count: number, end = bytes.length) => { if (!Number.isSafeInteger(count) || count < 0 || offset + count > end) throw Error('FBX 二进制数据被截断'); };
    const uint = (wide = false) => { requireBytes(wide ? 8 : 4); const n = wide ? Number(view.getBigUint64(offset, true)) : view.getUint32(offset, true); offset += wide ? 8 : 4; if (!Number.isSafeInteger(n)) throw Error('FBX 数据偏移超出安全范围'); return n; };
    const string = (length: number) => { requireBytes(length); const value = decoder.decode(bytes.subarray(offset, offset + length)); offset += length; return value; };
    const version = uint(); if (version < 6400) throw Error('当前需要二进制 FBX 6400 或更新版本');
    const wide = version >= 7500, headerSize = wide ? 25 : 13;
    const property = (end: number): FbxNode['values'][number] => {
        requireBytes(1, end); const type = String.fromCharCode(bytes[offset++]);
        const sizes: Record<string, number> = { Y: 2, C: 1, I: 4, F: 4, D: 8, L: 8 };
        if (sizes[type]) {
            requireBytes(sizes[type], end); let value: number;
            switch (type) {
                case 'Y': value = view.getInt16(offset, true); break;
                case 'C': value = bytes[offset] & 1; break;
                case 'I': value = view.getInt32(offset, true); break;
                case 'F': value = view.getFloat32(offset, true); break;
                case 'D': value = view.getFloat64(offset, true); break;
                default: value = Number(view.getBigInt64(offset, true));
            }
            offset += sizes[type]; return value;
        }
        if (type === 'S' || type === 'R') {
            requireBytes(4, end); const length = uint(); requireBytes(length, end);
            if (type === 'S') return string(length);
            const value = bytes.subarray(offset, offset + length); offset += length; return value;
        }
        if ('fdlibc'.includes(type)) {
            requireBytes(12, end); const count = uint(), encoding = uint(), length = uint(); requireBytes(length, end);
            const width = type === 'd' || type === 'l' ? 8 : type === 'f' || type === 'i' ? 4 : 1;
            if ((encoding !== 0 && encoding !== 1) || (!encoding && count * width !== length)) throw Error('FBX 数组编码或长度无效');
            offset += length; return null;
        }
        throw Error('不支持的 FBX 属性编码：' + type);
    };
    const node = (limit: number, depth: number): FbxNode | null => {
        requireBytes(headerSize, limit);
        const end = uint(wide), count = uint(wide), propertyLength = uint(wide), nameLength = bytes[offset++];
        if (!end) { if (count || propertyLength || nameLength) throw Error('FBX 空节点无效'); return null; }
        if (depth > 256 || end > limit || end <= offset || count > propertyLength) throw Error('FBX 节点边界无效');
        requireBytes(nameLength, end); const name = string(nameLength), propertyEnd = offset + propertyLength;
        if (propertyEnd > end || ['__proto__', 'constructor', 'prototype'].includes(name)) throw Error('FBX 属性边界或节点名称无效');
        const values: FbxNode['values'] = [];
        for (let i = 0; i < count; i++) values.push(property(propertyEnd));
        if (offset !== propertyEnd) throw Error('FBX 属性长度不符');
        const children: FbxNode[] = [];
        while (offset < end) { const child = node(end, depth + 1); if (child) children.push(child); else if (offset !== end) throw Error('FBX 空节点不在结束边界'); }
        return { name, values, children };
    };
    const nodes: FbxNode[] = []; let terminated = false;
    while (offset + headerSize <= bytes.length) { const value = node(bytes.length, 0); if (!value) { terminated = true; break; } nodes.push(value); }
    if (!nodes.length) throw Error('FBX 没有可读取节点');
    // The upstream geometry parser uses the standard footer to find its stopping point.
    if (!terminated || bytes.length - offset < 160) throw Error('FBX 文件尾缺失或被截断');
    return { version, nodes };
}
