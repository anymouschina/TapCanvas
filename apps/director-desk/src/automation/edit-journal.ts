import type { EditLocation } from './edit-locations.ts';
export interface EditReceipt { id: string; sceneId: string; sceneName: string; created: number; label: string; locations: EditLocation[] }
const memory = new Map<string, EditReceipt>(), listeners = new Set<() => void>();
async function database() {
    if (typeof indexedDB === 'undefined') return null;
    return await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('director-edit-locations', 1);
        request.onupgradeneeded = () => { const store = request.result.createObjectStore('receipts', { keyPath: 'id' }); store.createIndex('scene', 'sceneId'); };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
}
export function recordEdits(receipt: EditReceipt) {
    if (!receipt.locations.length || memory.has(receipt.id)) return;
    memory.set(receipt.id, structuredClone(receipt));
    for (const listener of listeners) { try { listener(); } catch (error) { console.error('修改记录界面刷新失败', error); } }
    void database().then(async db => {
        if (!db) return;
        try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('receipts', 'readwrite'); tx.objectStore('receipts').put(receipt); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); }
        finally { db.close(); }
    }).catch(error => console.warn('修改定位记录未能保存到本机；当前会话记录仍可查看', error));
}
export async function readEdits(sceneIds: string[]) {
    const db = await database().catch(error => { console.warn('无法读取已保存的修改定位记录，显示当前会话记录', error); return null; });
    if (db) try {
        const tx = db.transaction('receipts'), index = tx.objectStore('receipts').index('scene');
        const lists = await Promise.all(sceneIds.map(id => new Promise<EditReceipt[]>((resolve, reject) => { const q = index.getAll(id); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); })));
        for (const record of lists.flat()) if (!memory.has(record.id)) memory.set(record.id, record);
    } finally { db.close(); }
    return [...memory.values()].filter(r => sceneIds.includes(r.sceneId)).sort((a, b) => b.created - a.created || b.id.localeCompare(a.id));
}
export function onEditReceipt(callback: () => void) { listeners.add(callback); return () => { listeners.delete(callback); }; }
