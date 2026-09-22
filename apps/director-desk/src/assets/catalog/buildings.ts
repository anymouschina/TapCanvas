import type { AssetDefinition } from './types.ts';
import { lengthField, integerField } from './architecture.ts';
const specs = [
    ['bungalow', '平房', 6, 5, 1], ['house', '两层住宅', 7, 6, 2], ['apartment', '公寓体块', 10, 8, 5], ['shop', '商铺', 5, 6, 1],
    ['warehouse', '仓库', 12, 8, 1], ['pavilion', '亭子', 4, 4, 1], ['fortwall', '城墙', 10, 2.5, 1], ['tower', '塔楼', 4, 4, 3],
] as const;
export const BUILDING_ASSETS: readonly AssetDefinition[] = specs.map(([style, name, width, depth, levels]): AssetDefinition => ({ id: 'building-' + style, name, kind: 'prop', group: '建筑外壳', icon: '▥', family: 'building-v1', aliases: [style, '建筑'],
    capabilities: { rig: 'none', actions: [], pose: false, path: true }, parameters: { width: lengthField('主体宽度', width, 2), depth: lengthField('主体进深', depth, 1),
        floorHeight: lengthField(style === 'fortwall' ? '墙体高度' : '层高', style === 'warehouse' ? 4.5 : 3, 2, 10), levels: integerField('层数', levels, 1, 16),
        ...(style === 'pavilion' ? {} : { bays: integerField(style === 'fortwall' ? '垛口数量' : '立面开间', 3, 1, 16) }), thickness: lengthField('墙柱厚度', .18, .05, 1),
        roofHeight: lengthField('屋顶／女儿墙／垛口高度', style === 'fortwall' || style === 'tower' ? .65 : 1, 0, 5),
        roofStyle: { label: '屋顶形式', default: ['fortwall','tower'].includes(style) ? 3 : ['apartment','shop'].includes(style) ? 0 : style === 'pavilion' ? 2 : 1,
            min: 0, max: 3, step: 1, integer: true, choices: style === 'fortwall' ? { '0': '平顶', '3': '垛口' } : { '0': '平顶', '1': '双坡顶', '2': '四坡顶', '3': '垛口' } } } }));
