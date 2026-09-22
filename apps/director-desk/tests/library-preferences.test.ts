import test from 'node:test';
import assert from 'node:assert/strict';
import { AssetLibraryPreferences, type PreferenceStorage } from '../src/assets/library-preferences.ts';
import { ASSETS } from '../src/asset-catalog.ts';

test('library saves only valid asset IDs, restores favorites and keeps bounded MRU order', () => {
    let value = JSON.stringify({ favorites: ['person', 'person', 'unknown', 3], recent: ['person'] });
    const storage: PreferenceStorage = { getItem: () => value, setItem: (_, next) => value = next };
    const prefs = new AssetLibraryPreferences(storage); assert.deepEqual(prefs.favorites, ['person']);
    let notifications = 0; prefs.subscribe(() => notifications++);
    prefs.toggle('person'); assert.deepEqual(prefs.favorites, []);
    prefs.toggle('animal-cat'); prefs.toggle('unknown'); assert.deepEqual(prefs.favorites, ['animal-cat']);
    ASSETS.slice(0, 50).forEach(a => prefs.used(a.id)); prefs.used('animal-cat'); prefs.used('animal-cat');
    assert.equal(prefs.recent.length, 40); assert.equal(prefs.recent[0], 'animal-cat'); assert.equal(new Set(prefs.recent).size, 40);
    const restored = new AssetLibraryPreferences(storage); assert.deepEqual(restored.favorites, prefs.favorites); assert.deepEqual(restored.recent, prefs.recent);
    assert.deepEqual(Object.keys(JSON.parse(value)).sort(), ['favorites', 'recent']); assert.ok(notifications > 50);
});
test('blocked or corrupted storage still allows in-memory favorites and usage', () => {
    const failed: PreferenceStorage = { getItem: () => { throw new Error('disabled'); }, setItem: () => { throw new Error('disabled'); } };
    const prefs = new AssetLibraryPreferences(failed); prefs.toggle('person'); prefs.used('person'); assert.deepEqual(prefs.favorites, ['person']); assert.deepEqual(prefs.recent, ['person']);
    const malformed = new AssetLibraryPreferences({ getItem: () => 'null', setItem: () => {} }); assert.deepEqual(malformed.favorites, []);
});
