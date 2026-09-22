import { assertUserMotion, type UserMotion, type UserMotionAsset } from './user-motion.ts';
import { assertResourceHeader, modelResourceId, type ModelResource } from '../resources/project-resources.ts';
import { unpackModelFiles } from '../resources/model-package.ts';

const databaseName = 'director-user-motions-v1';
async function database(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') throw Error('此环境没有本机动作库；离线工程请使用已嵌入的动作资源和 retarget 片段');
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            db.createObjectStore('resources', { keyPath: 'id' });
            db.createObjectStore('motions', { keyPath: 'id' }).createIndex('resource', 'data.resourceId');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
async function transaction<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
    const db = await database();
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction(stores, mode); let value: T;
            tx.oncomplete = () => resolve(value);
            tx.onerror = tx.onabort = () => reject(tx.error ?? Error('动作库操作未完成'));
            try { work(tx, result => { value = result; }); } catch (error) { tx.abort(); reject(error); }
        });
    } finally { db.close(); }
}
export async function listUserMotions(query = '') {
    if (typeof indexedDB === 'undefined') return [];
    const motions = await transaction<UserMotion[]>(['motions'], 'readonly', (tx, result) => {
        tx.objectStore('motions').getAll().onsuccess = event => result((event.target as IDBRequest).result);
    });
    const needle = query.trim().toLocaleLowerCase();
    return motions.filter(m => !needle || `${m.name} ${m.id}`.toLocaleLowerCase().includes(needle)).sort((a, b) => a.name.localeCompare(b.name));
}
export async function getUserMotion(id: string): Promise<UserMotionAsset> {
    const value = await transaction<UserMotionAsset | null>(['motions', 'resources'], 'readonly', (tx, result) => {
        const request = tx.objectStore('motions').get(id);
        request.onsuccess = () => {
            const motion = request.result as UserMotion | undefined;
            if (!motion) { result(null); return; }
            const resource = tx.objectStore('resources').get(motion.data.resourceId);
            resource.onsuccess = () => result(resource.result ? { motion, resource: resource.result } : null);
        };
    });
    if (!value) throw Error('用户动作不存在，请重新查询动作库');
    assertUserMotion(value.motion); return value;
}
export async function saveUserMotion(motion: UserMotion, resource: ModelResource) {
    assertUserMotion(motion); assertResourceHeader(resource); unpackModelFiles(resource.package);
    if (resource.id !== motion.data.resourceId || await modelResourceId(resource.package) !== resource.id) throw Error('动作资源内容与标识不匹配');
    await transaction<void>(['motions', 'resources'], 'readwrite', tx => {
        tx.objectStore('resources').put(resource); tx.objectStore('motions').put(motion);
    });
}
export async function removeUserMotion(id: string) {
    await transaction<void>(['motions', 'resources'], 'readwrite', tx => {
        const store = tx.objectStore('motions'), request = store.get(id);
        request.onsuccess = () => {
            const motion = request.result as UserMotion | undefined; if (!motion) return;
            store.delete(id);
            const count = store.index('resource').count(motion.data.resourceId);
            count.onsuccess = () => { if (!count.result) tx.objectStore('resources').delete(motion.data.resourceId); };
        };
    });
}
