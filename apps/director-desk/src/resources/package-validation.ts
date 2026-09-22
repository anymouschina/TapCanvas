import { unpackModelFiles, type ModelPackage } from './model-package.ts';

/** Compare immutable strings directly, without allocating another Base64-sized JSON string. */
export function sameModelPackage(a: ModelPackage, b: ModelPackage): boolean {
    if (!a || !b || a.version !== b.version || a.format !== b.format || a.entry !== b.entry
        || !Array.isArray(a.files) || !Array.isArray(b.files) || a.files.length !== b.files.length) return false;
    // Preserve unknown serialized fields until the file schema explicitly rejects them.
    if ([a,b].some(p => Object.keys(p).some(k => !['version','format','entry','files'].includes(k))
        || p.files.some(f => !f || Object.keys(f).some(k => !['path','data'].includes(k))))) return JSON.stringify(a) === JSON.stringify(b);
    return a.files.every((f,i) => f.path === b.files[i].path && f.data === b.files[i].data);
}

// Only successful validations are remembered. Copies of the file records prevent in-place
// edits from changing the cached evidence; strings themselves are immutable. Bound retention.
const checked = new Map<string, { package: ModelPackage; chars: number }>();
let retainedChars = 0;
const maxChars = 32 * 1024 * 1024;
export function assertResourcePackage(id: string, data: ModelPackage) {
    const previous = checked.get(id);
    if (previous && sameModelPackage(previous.package, data)) return;
    unpackModelFiles(data);
    if (previous) { retainedChars -= previous.chars; checked.delete(id); }
    const chars = data.files.reduce((sum,f) => sum + f.data.length,0);
    if (chars > maxChars) return;
    while (checked.size >= 16 || retainedChars + chars > maxChars) {
        const oldest = checked.keys().next().value!;
        retainedChars -= checked.get(oldest)!.chars; checked.delete(oldest);
    }
    checked.set(id, { package: {version:data.version,format:data.format,entry:data.entry,files:data.files.map(f=>({path:f.path,data:f.data}))}, chars });
    retainedChars += chars;
}
