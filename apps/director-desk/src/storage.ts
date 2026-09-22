import { clone, type Project } from './model.ts';
import { readSceneDocument, type SceneDocument } from './scenes/sequence-project.ts';
import type { SceneView } from './scenes/sequence-session.ts';
export interface ResourceOwner { resources?: readonly { id: string }[] }
export interface EditorHistory {
    readonly undoStack: readonly ResourceOwner[];
    readonly redoStack: readonly ResourceOwner[];
    readonly pending: Project | null;
    readonly restoredSelection: string | undefined;
    readonly restoredView?: SceneView;
    begin(project: Project): void;
    commit(project: Project): void;
    rollback(): Project | null;
    undo(project: Project): Project | null;
    redo(project: Project): Project | null;
}
const DB_NAME = 'director-desk-v1';
async function database() { return await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(DB_NAME, 1); r.onupgradeneeded = () => r.result.createObjectStore('projects'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
export async function autosave(project: Project | SceneDocument | (() => SceneDocument | null)) {
    // A provider creates one owned snapshot only after the database is ready. Returning null
    // defers capture while the editor is dragging, without cloning or storing a partial gesture.
    const snapshot = typeof project === 'function' ? undefined : clone(project);
    const db = await database(); try {
    const data = typeof project === 'function' ? project() : snapshot;
    if (!data) return false;
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(data, 'recovery'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
    return true;
}
finally {
    db.close();
} }
export async function recover(): Promise<SceneDocument | null> { const db = await database(); try {
    const data = await new Promise<unknown>((resolve, reject) => { const r = db.transaction('projects').objectStore('projects').get('recovery'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    return data ? readSceneDocument(data) : null;
}
finally {
    db.close();
} }
export function download(blob: Blob, name: string) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
