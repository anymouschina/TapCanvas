import type { Vec3 } from '../model.ts';
import { isBonePath } from './rig-definition.ts';
import type { ModelNodeDescriptor } from './native-animation.ts';
export interface ModelNodeEdit { name?: string; category?: string; hidden?: boolean; offset?: Vec3; rotation?: Vec3; scale?: Vec3 }
export type ModelNodeEdits = Record<string, ModelNodeEdit>;
export function assertModelNodeEdits(edits: ModelNodeEdits | undefined) {
    if (edits === undefined) return;
    if (!edits || typeof edits !== 'object' || Array.isArray(edits) || Object.keys(edits).length > 10000) throw Error('模型节点编辑格式无效');
    for (const [path, edit] of Object.entries(edits)) {
        if (!isBonePath(path) || !edit || typeof edit !== 'object' || Array.isArray(edit) || Object.keys(edit).some(k => !['name', 'category', 'hidden', 'offset', 'rotation', 'scale'].includes(k))) throw Error('模型节点路径或编辑字段无效');
        for (const key of ['name', 'category'] as const) if (edit[key] !== undefined && (typeof edit[key] !== 'string' || edit[key]!.length > 200)) throw Error('节点名称或分类过长');
        if (edit.hidden !== undefined && typeof edit.hidden !== 'boolean') throw Error('节点隐藏设置必须为布尔值');
        for (const key of ['offset', 'rotation', 'scale'] as const) {
            const value = edit[key];
            if (value !== undefined && (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite) || key === 'scale' && value.some(v => v <= 0))) throw Error('节点变换参数无效');
        }
    }
}
export function assertModelNodeBindings(edits: ModelNodeEdits | undefined, nodes: readonly ModelNodeDescriptor[]) {
    assertModelNodeEdits(edits);
    const lookup = new Map(nodes.map(n => [n.path, n]));
    for (const [path, edit] of Object.entries(edits ?? {})) {
        const node = lookup.get(path); if (!node) throw Error('模型编辑节点不存在：' + path);
        if ((edit.offset || edit.rotation || edit.scale || edit.hidden !== undefined) && !node.editable) throw Error('骨架、蒙皮及其相关层级请使用人物或动画工具；这里只能重命名和分类');
    }
}
