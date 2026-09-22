import type { AssetParameter } from './types.ts';
import type { QuadrupedShape } from './animals.ts';
import type { CreatureShape } from './creatures.ts';
const ratio = (labels: Record<string, string>) => Object.fromEntries(Object.entries(labels).map(([key, label]) => [key + 'Ratio', { label: label + '比例', default: 1, min: .8, max: 1.2, step: .01 } satisfies AssetParameter]));
export function quadrupedParameterSchema(shape: QuadrupedShape) {
    const labels: Record<string, string> = { body: '躯干长度', width: '身体宽度', leg: '腿长', head: '头部大小' };
    if (shape.species !== 'gorilla') {
        for (const [key, label] of [['neck', '颈部长度'], ['muzzle', '口鼻长度'], ['ear', '耳长'], ['tail', '尾长']] as const) if (shape[key] > 0) labels[key] = label;
        if (shape.species === 'elephant') labels.muzzle = '象鼻长度';
    }
    return ratio(labels);
}
export function creatureParameterSchema(shape: CreatureShape) {
    return ratio({ body: '躯干长度', width: '身体粗细', ...(shape.rig === 'bird' ? { leg: '腿长', neck: '颈长', wing: '翼展' } : shape.rig === 'fish' ? { wing: '鳍长' } : {}) });
}
