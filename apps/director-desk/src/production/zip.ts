export interface ZipEntry { name: string; data: Blob }
const table = Uint32Array.from({ length: 256 }, (_, i) => { let n = i; for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
export async function blobCrc32(blob: Blob, signal?: AbortSignal) {
    let crc = 0xffffffff; const reader = blob.stream().getReader();
    try { while (true) { signal?.throwIfAborted(); const { value, done } = await reader.read(); if (done) break; for (const b of value) crc = table[(crc ^ b) & 255] ^ crc >>> 8; } }
    finally { await reader.cancel(); reader.releaseLock(); }
    return (crc ^ 0xffffffff) >>> 0;
}
/** Standard UTF-8 ZIP, stored entries. Video/images are already compressed; Blob parts avoid concatenating large buffers. */
export async function createZip(entries: ZipEntry[], signal?: AbortSignal, progress: (done: number, total: number) => void = () => {}) {
    if (entries.length > 65535) throw new Error('素材包文件数量超过 ZIP 格式限制');
    const names = new Set<string>(), local: BlobPart[] = [], central: BlobPart[] = []; let offset = 0, directorySize = 0;
    for (const [index, entry] of entries.entries()) {
        signal?.throwIfAborted();
        if (!entry.name || entry.name.startsWith('/') || /[\\:\u0000]/.test(entry.name) || entry.name.split('/').some(p => p === '..' || p === '.' || !p) || names.has(entry.name)) throw new Error('素材包文件名无效或重复');
        names.add(entry.name); const name = new TextEncoder().encode(entry.name);
        if (name.length > 65535 || entry.data.size > 0xffffffff || offset + entry.data.size + name.length + 30 > 0xffffffff) throw new Error('素材包超过 4 GB，请分别导出视频与工程');
        const crc = await blobCrc32(entry.data, signal), header = new Uint8Array(30), h = new DataView(header.buffer);
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(12, 33, true);
        h.setUint32(14, crc, true); h.setUint32(18, entry.data.size, true); h.setUint32(22, entry.data.size, true); h.setUint16(26, name.length, true);
        local.push(header, name, entry.data);
        const directory = new Uint8Array(46), d = new DataView(directory.buffer);
        d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true); d.setUint16(14, 33, true);
        d.setUint32(16, crc, true); d.setUint32(20, entry.data.size, true); d.setUint32(24, entry.data.size, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true);
        central.push(directory, name); directorySize += 46 + name.length; offset += 30 + name.length + entry.data.size;
        progress(index + 1, entries.length); await new Promise(resolve => setTimeout(resolve, 0));
    }
    signal?.throwIfAborted();
    if (offset + directorySize + 22 > 0xffffffff) throw new Error('素材包超过 4 GB，请分别导出');
    const end = new Uint8Array(22), d = new DataView(end.buffer); d.setUint32(0, 0x06054b50, true); d.setUint16(8, entries.length, true); d.setUint16(10, entries.length, true);
    d.setUint32(12, directorySize, true); d.setUint32(16, offset, true);
    return new Blob([...local, ...central, end], { type: 'application/zip' });
}
