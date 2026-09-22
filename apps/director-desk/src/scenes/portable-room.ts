import { clone, entity, type Project } from '../model.ts';
import { emptyEditorView } from '../building/floors.ts';
import { ROOM_PARTS, ROOM_PART_NAMES } from '../assets/catalog/room-parts.ts';

/** Materialise the built-in room before merging: neither project may overwrite the other's room. */
export function portableRoom(source: Project): Project {
    const p = clone(source), ids = new Map<string, string>();
    if (p.room.enabled) {
        ROOM_PARTS.forEach((side, part) => {
            const e = entity('prop', 'room-part', `房间 · ${ROOM_PART_NAMES[part]}`);
            while (p.entities.some(other => other.id === e.id)) e.id = crypto.randomUUID();
            e.assetParameters = { width: p.room.width, depth: p.room.depth, height: p.room.height, part };
            p.entities.push(e); ids.set(side, e.id);
        });
        p.editorView ??= emptyEditorView();
        p.editorView.hiddenEntityIds.push(ids.get('ceiling')!);
    }
    for (const e of p.entities) {
        if (e.camera) {
            const hidden = [...(e.camera.hiddenEntityIds ?? []), ...e.camera.hideWalls.flatMap(side => ids.has(side) ? [ids.get(side)!] : [])];
            if (hidden.length) e.camera.hiddenEntityIds = [...new Set(hidden)];
            e.camera.hideWalls = [];
        }
        if (p.editorView?.hideWalls && (['wall', 'structure-wall'].includes(e.asset) || e.asset === 'room-part' && e.assetParameters?.part !== 0))
            p.editorView.hiddenEntityIds.push(e.id);
    }
    if (p.editorView) { p.editorView.hiddenEntityIds = [...new Set(p.editorView.hiddenEntityIds)]; p.editorView.hideWalls = false; }
    p.room.enabled = false;
    return p;
}
