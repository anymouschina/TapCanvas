import { modelPath, resolveModelUri } from './model-path.ts';
export { modelPath, resolveModelUri } from './model-path.ts';
import { collectObjFiles } from './obj-source.ts';
import { collectFbxFiles } from './fbx-source.ts';

/** Portable source data. No Three.js types, filesystem paths or browser objects. */
export interface ModelSourceFile { path: string; bytes: Uint8Array }
export interface PackedModelFile { path: string; data: string }
export interface ModelPackage {
    version: 1;
    format: 'gltf' | 'obj' | 'fbx';
    entry: string;
    files: PackedModelFile[];
}
export interface GltfDocument {
    asset: { version: string; minVersion?: string; copyright?: string; generator?: string };
    buffers?: { uri?: string; byteLength: number }[];
    images?: { uri?: string; bufferView?: number; mimeType?: string }[];
    extensionsRequired?: string[];
    extensionsUsed?: string[];
    [key: string]: unknown;
}

export function encodeModelBytes(bytes: Uint8Array): string {
    let value = '';
    for (let start = 0; start < bytes.length; start += 32768) value += String.fromCharCode(...bytes.subarray(start, start + 32768));
    return btoa(value);
}
export function decodeModelBytes(data: string): Uint8Array {
    if (typeof data !== 'string' || data.length % 4 || /[^A-Za-z0-9+/=]/.test(data) || (data.includes('=') && !/^[^=]*={1,2}$/.test(data))) throw Error('模型资源的 Base64 数据损坏');
    const value = atob(data), bytes = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i);
    return bytes;
}
export function inlineModelBytes(uri: string): Uint8Array {
    const match = /^data:(application\/(?:octet-stream|gltf-buffer)|image\/(?:png|jpeg|webp));base64,([\s\S]*)$/.exec(uri);
    if (!match) throw Error('模型包含不支持的内嵌资源类型或编码');
    return decodeModelBytes(match[2]);
}
export function readGltfDocument(bytes: Uint8Array, entry: string): { document: GltfDocument; binaryBytes: number } {
    let json = bytes, binaryBytes = 0;
    if (/\.glb$/i.test(entry)) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) throw Error('GLB 文件头、版本或长度无效');
        let offset = 12, chunks = 0, foundBinary = false;
        while (offset < bytes.length) {
            if (offset + 8 > bytes.length) throw Error('GLB 数据块被截断');
            const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true); offset += 8;
            if (length % 4 || offset + length > bytes.length) throw Error('GLB 数据块长度无效');
            if (!chunks && type !== 0x4e4f534a) throw Error('GLB 首块必须为 JSON');
            if (type === 0x4e4f534a) { if (chunks) throw Error('GLB 包含重复 JSON'); json = bytes.subarray(offset, offset + length); }
            if (type === 0x004e4942) { if (foundBinary) throw Error('GLB 包含重复二进制块'); binaryBytes = length; foundBinary = true; }
            chunks++; offset += length;
        }
    } else if (!/\.gltf$/i.test(entry)) throw Error('请选择 GLB 或 glTF 模型文件');
    let document: GltfDocument;
    try { document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json)); } catch { throw Error('模型 JSON 无法解析'); }
    if (!document || typeof document !== 'object' || document.asset?.version !== '2.0' || (document.asset.minVersion && document.asset.minVersion !== '2.0')) throw Error('当前需要 glTF 2.0 模型');
    for (const key of ['buffers', 'images', 'extensionsRequired', 'extensionsUsed'] as const) if (document[key] !== undefined && !Array.isArray(document[key])) throw Error(`模型 ${key} 结构无效`);
    if ([...(document.extensionsRequired ?? []), ...(document.extensionsUsed ?? [])].some(v => typeof v !== 'string')) throw Error('模型扩展名无效');
    return { document, binaryBytes };
}

/** Include only referenced files. Missing dependencies fail together, without fetching the network. */
export function packModelFiles(entryPath: string, source: readonly ModelSourceFile[]): ModelPackage {
    const entry = modelPath(entryPath), available = new Map<string, Uint8Array>();
    for (const file of source) {
        const name = modelPath(file.path);
        if (available.has(name)) throw Error('模型资源文件名重复：' + name);
        if (!(file.bytes instanceof Uint8Array)) throw Error('模型资源必须是二进制数据');
        available.set(name, file.bytes);
    }
    const bytes = available.get(entry); if (!bytes) throw Error('未找到模型主文件：' + entry);
    if (/\.fbx$/i.test(entry)) {
        const { needed } = collectFbxFiles(entry, available);
        return { version: 1, format: 'fbx', entry, files: [...needed].sort().map(path => ({ path, data: encodeModelBytes(available.get(path)!) })) };
    }
    if (/\.obj$/i.test(entry)) {
        const needed = collectObjFiles(entry, available);
        return { version: 1, format: 'obj', entry, files: [...needed].sort().map(path => ({ path, data: encodeModelBytes(available.get(path)!) })) };
    }
    const { document, binaryBytes } = readGltfDocument(bytes, entry), needed = new Set([entry]), missing = new Set<string>();
    const dependency = (uri: unknown): Uint8Array | undefined => {
        if (typeof uri !== 'string' || !uri) throw Error('模型引用 URI 无效');
        if (uri.startsWith('data:')) return inlineModelBytes(uri);
        const name = resolveModelUri(entry, uri); needed.add(name);
        const data = available.get(name); if (!data) missing.add(name); return data;
    };
    for (const [index, buffer] of (document.buffers ?? []).entries()) {
        if (!buffer || !Number.isSafeInteger(buffer.byteLength) || buffer.byteLength < 1) throw Error('模型缓冲区长度无效');
        if (buffer.uri === undefined) {
            if (index || !/\.glb$/i.test(entry) || binaryBytes < buffer.byteLength || binaryBytes - buffer.byteLength > 3) throw Error('模型二进制缓冲区缺失或长度不符');
        } else { const data = dependency(buffer.uri); if (data && data.length < buffer.byteLength) throw Error('模型缓冲区被截断'); }
    }
    for (const image of document.images ?? []) {
        if (!image || typeof image !== 'object') throw Error('模型图片引用无效');
        if (image.uri !== undefined && image.bufferView !== undefined) throw Error('模型图片不能同时指定 URI 和缓冲区视图');
        if (image.uri !== undefined) dependency(image.uri);
        else if (!Number.isSafeInteger(image.bufferView) || image.bufferView! < 0 || typeof image.mimeType !== 'string') throw Error('模型图片缺少资源引用');
    }
    if (missing.size) throw Error('缺少模型关联文件：' + [...missing].join('、'));
    return { version: 1, format: 'gltf', entry, files: [...needed].sort().map(path => ({ path, data: encodeModelBytes(available.get(path)!) })) };
}

export function unpackModelFiles(input: ModelPackage): Map<string, Uint8Array> {
    if (!input || input.version !== 1 || !['gltf', 'obj', 'fbx'].includes(input.format) || typeof input.entry !== 'string' || !Array.isArray(input.files)) throw Error('模型资源包格式无效');
    const sources = input.files.map(file => {
        if (!file || typeof file.path !== 'string') throw Error('模型资源条目无效');
        return { path: file.path, bytes: decodeModelBytes(file.data) };
    });
    // Same checks on import and reopen; never trust a serialized package to be complete.
    const checked = packModelFiles(input.entry, sources);
    if (checked.format !== input.format) throw Error('模型资源包格式与主文件不符');
    if (checked.files.length !== sources.length) throw Error('模型资源包包含未引用的文件');
    return new Map(sources.map(file => [modelPath(file.path), file.bytes]));
}
