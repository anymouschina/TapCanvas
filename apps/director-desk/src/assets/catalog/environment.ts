import type { AssetDefinition } from './types.ts';
import { lengthField, integerField } from './architecture.ts';
const common = { kind: 'prop', icon: '♠', capabilities: { rig: 'none', actions: [], pose: false, path: true } } as const;
const plants = [
    ['broadleaf', '阔叶树', 3.5, 5, 3.5], ['conifer', '针叶树', 2.6, 6, 2.6], ['palm', '棕榈树', 4, 6, 4], ['dead', '枯树', 3, 4.5, 3],
    ['bush', '灌木', 1.4, 1.2, 1.2], ['hedge', '树篱', 4, 1.5, .7], ['grass', '草丛', .8, .5, .8], ['potted', '盆栽', .65, 1, .65],
] as const;
const seed = integerField('外形种子', 1, 0, 2147483647);
export const PLANT_ASSETS: readonly AssetDefinition[] = plants.map(([style, name, width, height, depth]) => ({ ...common, id: 'plant-' + style, name, group: '植物', family: 'plant-v1', aliases: [style, '植物'],
    parameters: { width: lengthField('冠幅／宽度', width), height: lengthField('总高度', height), depth: lengthField('进深', depth), density: integerField('枝叶密度', style === 'grass' ? 24 : 12, 4, 48), seed } }));

const terrains = [
    ['ground', '地面块', 10, .2, 10], ['slope', '土坡', 5, 2, 5], ['hill', '丘陵块', 8, 3, 8], ['rock', '岩石 · 种子外形', 2, 1.5, 1.6],
    ['cliff', '岩壁', 8, 5, 2], ['ditch', '沟渠', 4, 1.2, 8], ['riverbed', '河床', 8, 1, 12], ['water', '水面占位', 8, .02, 12],
] as const;
export const TERRAIN_ASSETS: readonly AssetDefinition[] = terrains.map(([style, name, width, height, depth]) => ({ ...common, id: 'terrain-' + style, name, group: '地形自然', family: 'terrain-v1', aliases: [style, '地形'],
    parameters: { width: lengthField('宽度', width), height: lengthField(style === 'water' ? '占位厚度' : '高度／起伏', height), depth: lengthField('进深', depth),
        ...(['rock', 'cliff', 'hill', 'riverbed'].includes(style) ? { roughness: { label: '表面不规则度', default: .2, min: 0, max: .7, step: .05 }, seed } : {}) } }));
