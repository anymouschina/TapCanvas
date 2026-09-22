import type { Project } from '../model.ts';

/** Lock protects entity edits across properties, commands and timeline operations. */
export function assertLockedEntitiesUnchanged(before: Project, after: Project) {
    for (const original of before.entities.filter(e => e.locked)) {
        const next = after.entities.find(e => e.id === original.id);
        if (!next || JSON.stringify({ ...original, locked: false }) !== JSON.stringify({ ...next, locked: false }))
            throw new Error(`「${original.name}」已锁定，请先解锁再编辑`);
    }
}
