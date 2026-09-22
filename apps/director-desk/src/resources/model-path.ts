export function modelPath(value: string): string {
    if (typeof value !== 'string' || !value || /[\x00-\x1f\\:#?]/.test(value) || value.startsWith('/')) throw Error('模型资源需使用相对文件名');
    const segments: string[] = [];
    for (const part of value.split('/')) {
        if (part === '..') { if (!segments.length) throw Error('模型引用超出已选择的文件目录'); segments.pop(); }
        else if (part && part !== '.') segments.push(part);
    }
    if (!segments.length) throw Error('模型资源文件名为空');
    return segments.join('/');
}
export function resolveModelUri(entry: string, uri: string): string {
    // URI paths may encode spaces/non-ASCII characters. Decode once; selected file names are already decoded.
    let decoded: string;
    try { decoded = decodeURIComponent(uri); } catch { throw Error('模型引用包含无效 URI 编码'); }
    if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith('/') || decoded.includes('\\')) throw Error('模型引用必须来自所选本地文件，不能引用网址或系统路径');
    const parent = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/') + 1) : '';
    return modelPath(parent + decoded);
}
