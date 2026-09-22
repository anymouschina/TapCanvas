import { modelPath } from './model-path.ts';

export const objTextureKeys = new Set(['map_kd', 'map_ks', 'map_ke', 'norm', 'map_bump', 'bump', 'disp', 'map_d']);
export interface ObjMaterial { name: string; properties: { key: string; value: string; texture?: { path: string; options: string } }[] }

/** OBJ/MTL paths are file names, not URLs: percent signs are literal, relative Windows separators are accepted. */
export function objFilePath(entry: string, reference: string): string {
    const path = reference.replace(/\\/g, '/');
    if (path.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(path)) throw Error('OBJ/MTL 关联文件必须使用所选目录内的相对路径');
    return modelPath((entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/') + 1) : '') + path);
}
export function sourceLines(bytes: Uint8Array): { key: string; value: string }[] {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw Error('OBJ/MTL 文本需要 UTF-8 编码'); }
    return text.replace(/\\\r?\n/g, '').split(/\r?\n/).flatMap(line => {
        // Keep # inside quoted file names; outside quotes it starts a comment.
        let quote = '';
        for (let i = 0; i < line.length; i++) {
            if (line[i] === '"' || line[i] === "'") { if (!quote) quote = line[i]; else if (quote === line[i]) quote = ''; }
            else if (line[i] === '#' && !quote) { line = line.slice(0, i); break; }
        }
        const match = /^\s*(\S+)(?:\s+(.*?))?\s*$/.exec(line);
        return match ? [{ key: match[1].toLowerCase(), value: match[2] ?? '' }] : [];
    });
}
function tokens(value: string): string[] {
    const result: string[] = []; let token = '', quote = '', started = false;
    for (const char of value) {
        if (quote) { if (char === quote) quote = ''; else token += char; }
        else if (char === '"' || char === "'") { quote = char; started = true; }
        else if (/\s/.test(char)) { if (started) result.push(token); token = ''; started = false; }
        else { token += char; started = true; }
    }
    if (quote) throw Error('OBJ/MTL 文件名引号未闭合');
    if (started) result.push(token);
    return result;
}
export function objLibraries(entry: string, bytes: Uint8Array, available: ReadonlyMap<string, Uint8Array>): string[] {
    const libraries = new Set<string>();
    for (const line of sourceLines(bytes)) if (line.key === 'mtllib') {
        if (!line.value) throw Error('OBJ 材质库名称为空');
        // Some exporters leave a single name containing spaces unquoted.
        const whole = !/["']/.test(line.value) ? objFilePath(entry, line.value) : '';
        if (whole && available.has(whole)) libraries.add(whole);
        else for (const name of tokens(line.value)) libraries.add(objFilePath(entry, name));
    }
    return [...libraries];
}
function textureReference(entry: string, value: string) {
    const items = tokens(value), options: string[] = [];
    while (items[0]?.startsWith('-')) {
        const option = items.shift()!, values: number[] = [];
        const max = option === '-s' || option === '-o' ? 3 : option === '-bm' ? 1 : option === '-mm' ? 2 : 0;
        if (!max) throw Error('暂不支持 MTL 贴图参数：' + option);
        while (values.length < max && items.length && items[0] !== '' && Number.isFinite(Number(items[0]))) values.push(Number(items.shift()));
        if (!values.length || ((option === '-bm' || option === '-mm') && values.length !== max)) throw Error('MTL 贴图参数缺少数值：' + option);
        while (values.length < max) values.push(option === '-s' ? 1 : 0);
        options.push(option, ...values.map(String));
    }
    const name = items.join(' '); if (!name) throw Error('MTL 贴图文件名为空');
    return { path: objFilePath(entry, name), options: options.join(' ') };
}
export function readObjMaterials(entry: string, bytes: Uint8Array): ObjMaterial[] {
    const materials: ObjMaterial[] = []; let current: ObjMaterial | undefined;
    for (const { key, value } of sourceLines(bytes)) {
        if (key === 'newmtl') {
            if (!value || ['__proto__', 'constructor', 'prototype'].includes(value)) throw Error('MTL 材质名称无效');
            if (materials.some(m => m.name === value)) throw Error('MTL 材质名称重复：' + value);
            current = { name: value, properties: [] }; materials.push(current);
        } else if (current) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('MTL 属性名称无效');
            if ((key.startsWith('map_') || key === 'refl') && !objTextureKeys.has(key)) throw Error('暂不支持 MTL 贴图类型：' + key);
            if (['ka', 'kd', 'ks', 'ke', 'ns', 'd', 'tr'].includes(key)) {
                const values = value.split(/\s+/).map(Number), count = ['ka', 'kd', 'ks', 'ke'].includes(key) ? 3 : 1;
                if (!value || values.length !== count || values.some(n => !Number.isFinite(n))) throw Error('MTL 材质数值无效：' + key);
            }
            const texture = objTextureKeys.has(key) ? textureReference(entry, value) : undefined;
            current.properties.push({ key, value, ...(texture ? { texture } : {}) });
        }
    }
    return materials;
}
export function collectObjFiles(entry: string, files: ReadonlyMap<string, Uint8Array>): Set<string> {
    const bytes = files.get(entry)!, needed = new Set([entry]), missing = new Set<string>(), materials = new Set<string>();
    for (const library of objLibraries(entry, bytes, files)) {
        needed.add(library); const data = files.get(library);
        if (!data) { missing.add(library); continue; }
        for (const material of readObjMaterials(library, data)) {
            if (materials.has(material.name)) throw Error('多个材质库的材质名称冲突：' + material.name);
            materials.add(material.name);
            for (const property of material.properties) if (property.texture) {
                needed.add(property.texture.path);
                if (!files.has(property.texture.path)) missing.add(property.texture.path);
            }
        }
    }
    if (missing.size) throw Error('缺少模型关联文件：' + [...missing].join('、'));
    for (const line of sourceLines(bytes)) if (line.key === 'usemtl' && !materials.has(line.value)) throw Error('OBJ 使用了未定义的材质：' + line.value + '；请提供对应 MTL 文件');
    return needed;
}
