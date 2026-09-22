import { modelPath } from './model-path.ts';
import { readFbxDocument, type FbxDocument, type FbxNode } from './fbx-document.ts';

export interface FbxMedia { id: number; reference: string; request: string; embedded: boolean; content?: string | Uint8Array }
export interface FbxInfo { document: FbxDocument; media: FbxMedia[]; unitScale: number; unitKnown: boolean; upAxis: number; upSign: number }
export const fbxImageTypes = new Set(['png', 'jpg', 'jpeg', 'bmp', 'webp']);
const value = (node: FbxNode, name: string) => node.children.find(n => n.name === name)?.values[0];

export function inspectFbxSource(bytes: Uint8Array): FbxInfo {
    const document = readFbxDocument(bytes), objects = document.nodes.find(n => n.name === 'Objects');
    if (!objects) throw Error('FBX 缺少对象数据');
    const properties = document.nodes.find(n => n.name === 'GlobalSettings')?.children.find(n => n.name === 'Properties70')?.children ?? [];
    const number = (name: string, fallback: number) => {
        const p = properties.find(n => n.name === 'P' && n.values[0] === name), v = p?.values.at(-1) ?? fallback;
        if (typeof v !== 'number' || !Number.isFinite(v)) throw Error('FBX 单位或坐标轴信息无效'); return v;
    };
    const unitKnown = properties.some(n => n.name === 'P' && n.values[0] === 'UnitScaleFactor');
    const unitScale = number('UnitScaleFactor', 100) / 100, upAxis = number('UpAxis', 1), upSign = number('UpAxisSign', 1);
    if (unitScale <= 0 || ![0, 1, 2].includes(upAxis) || ![-1, 1].includes(upSign)) throw Error('FBX 单位或坐标轴信息无效');
    const videos = objects.children.filter(n => n.name === 'Video'), textures = objects.children.filter(n => n.name === 'Texture');
    const connections = document.nodes.find(n => n.name === 'Connections')?.children.filter(n => n.name === 'C') ?? [];
    const connected = new Set<number>();
    for (const texture of textures) {
        const id = texture.values[0], file = value(texture, 'FileName');
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || typeof file !== 'string' || !fbxImageTypes.has(file.split('.').at(-1)!.toLowerCase())) throw Error('FBX 贴图需要 PNG、JPG、BMP 或 WebP 图片');
        // FBXLoader follows the first child connection for each texture. Do not accept its silent placeholder fallback.
        const connection = connections.find(n => n.values[2] === id);
        if (!connection || typeof connection.values[1] !== 'number' || !videos.some(v => v.values[0] === connection.values[1])) throw Error('FBX 贴图缺少有效图片关联');
        connected.add(connection.values[1]);
    }
    const media = videos.map(video => {
        const id = video.values[0], reference = value(video, 'RelativeFilename') || value(video, 'Filename'), content = value(video, 'Content');
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || typeof reference !== 'string' || !reference || /[\x00-\x1f]/.test(reference)) throw Error('FBX 图片引用无效');
        if (/^[a-z][a-z\d+.-]*:/i.test(reference) && !/^[a-z]:[\\/]/i.test(reference)) throw Error('FBX 图片不能引用网址或数据协议');
        const embedded = content instanceof Uint8Array ? content.length > 0 : typeof content === 'string' && content.length > 0;
        if (embedded && !fbxImageTypes.has(reference.split('.').at(-1)!.toLowerCase())) throw Error('FBX 内嵌图片格式尚不支持');
        return { id, reference, request: reference.split('\\').at(-1)!, embedded, ...(embedded ? { content: content as string | Uint8Array } : {}) };
    }).filter(v => connected.has(v.id));
    return { document, media, unitScale, unitKnown, upAxis, upSign };
}

/** Relink exporter paths only within selected files. Absolute source directories are never read or requested. */
export function resolveFbxFile(entry: string, reference: string, files: ReadonlyMap<string, Uint8Array>): string {
    const path = reference.replace(/\\/g, '/'), base = path.split('/').at(-1)!;
    if (!base || /[\x00-\x1f:#?]/.test(base)) throw Error('FBX 贴图文件名无效');
    if (!path.startsWith('/') && !/^[a-z]:/i.test(path)) {
        let relative: string | undefined;
        try { relative = modelPath((entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/') + 1) : '') + path); } catch { /* Relink only to an explicitly selected file below. */ }
        if (relative && files.has(relative)) return relative;
    }
    const matches = [...files.keys()].filter(name => name.split('/').at(-1) === base);
    if (matches.length > 1) throw Error('FBX 贴图同名且无法确定关联：' + base + '；请保留相对目录或重命名后导出');
    if (!matches.length) throw Error('缺少模型关联文件：' + base);
    return matches[0];
}

export function collectFbxFiles(entry: string, files: ReadonlyMap<string, Uint8Array>, info = inspectFbxSource(files.get(entry)!)) {
    const needed = new Set([entry]), requests = new Map<string, string>();
    for (const media of info.media) if (!media.embedded) {
        const path = resolveFbxFile(entry, media.reference, files), old = requests.get(media.request);
        if (old && old !== path) throw Error('FBX 加载器无法区分同名贴图，请重命名后导出');
        needed.add(path); requests.set(media.request, path);
    }
    return { needed, requests, info };
}
