import { findAsset } from '../asset-catalog.ts';
export interface PreferenceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
const key = 'director-asset-library-v1';
/** Asset IDs only; private project data and reference images never enter this store. */
export class AssetLibraryPreferences {
    favorites: string[] = [];
    recent: string[] = [];
    private listeners = new Set<() => void>();
    private storage?: PreferenceStorage;
    constructor(storage?: PreferenceStorage) {
        this.storage = storage;
        try {
            const data = JSON.parse(storage?.getItem(key) ?? '{}');
            const valid = (values: unknown, max: number) => Array.isArray(values) ? [...new Set(values.filter((id): id is string => typeof id === 'string' && !!findAsset(id)))].slice(0, max) : [];
            this.favorites = valid(data.favorites, 500); this.recent = valid(data.recent, 40);
        } catch { /* Storage disabled or malformed: usable in-memory preferences. */ }
    }
    subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    private save() {
        try { this.storage?.setItem(key, JSON.stringify({ favorites: this.favorites, recent: this.recent })); } catch { /* In-memory state still works. */ }
        this.listeners.forEach(fn => fn());
    }
    toggle(id: string) {
        if (!findAsset(id)) return;
        this.favorites = this.favorites.includes(id) ? this.favorites.filter(x => x !== id) : [...this.favorites, id]; this.save();
    }
    used(id: string) {
        if (!findAsset(id)) return;
        this.recent = [id, ...this.recent.filter(x => x !== id)].slice(0, 40); this.save();
    }
}
function browserStorage() { try { return globalThis.localStorage; } catch { return undefined; } }
export const libraryPreferences = new AssetLibraryPreferences(browserStorage());
