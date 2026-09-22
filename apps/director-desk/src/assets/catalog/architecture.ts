import type { AssetDefinition } from './types.ts';

export const lengthField = (label: string, value: number, min = .02, max = 100) => ({ label, default: value, min, max, step: .01, unit: '米' });
const angleField = (label: string, value: number, max = 160) => ({ label, default: value, min: 0, max, step: 1, unit: '度' });
export const integerField = (label: string, value: number, min = 1, max = 128) => ({ label, default: value, min, max, step: 1, integer: true });
const common = { kind: 'prop', icon: '▥', capabilities: { rig: 'none', actions: [], pose: false, path: true } } as const;
const components: Array<{ id: string; name: string; width: number; height: number; depth: number; extra: NonNullable<AssetDefinition['parameters']> }> = [
    { id: 'wall', name: '墙 · 可留洞', width: 4, height: 3, depth: .18, extra: { openingWidth: lengthField('洞宽 · 0 为封闭', 0, 0), openingHeight: lengthField('洞高', 2.1), sill: lengthField('洞底离地', 0, 0) } },
    { id: 'doorframe', name: '门框', width: 1.1, height: 2.2, depth: .18, extra: { frame: lengthField('框宽', .08) } },
    { id: 'door', name: '门 · 带框开合', width: 1.1, height: 2.2, depth: .18, extra: { frame: lengthField('框宽', .08), opening: angleField('门扇开合', 0) } },
    { id: 'windowframe', name: '窗框', width: 1.5, height: 1.2, depth: .16, extra: { frame: lengthField('框宽', .08) } },
    { id: 'window', name: '窗 · 可开窗扇', width: 1.5, height: 1.2, depth: .16, extra: { frame: lengthField('框宽', .08), opening: angleField('窗扇开合', 0) } },
    { id: 'column', name: '立柱', width: .4, height: 3, depth: .4, extra: {} },
    { id: 'beam', name: '横梁', width: 4, height: .35, depth: .3, extra: {} },
    { id: 'slab', name: '楼板', width: 4, height: .18, depth: 4, extra: {} },
];
export const ARCHITECTURE_ASSETS: readonly AssetDefinition[] = components.map(s => ({ ...common, id: 'structure-' + s.id, name: s.name, group: '建筑构件', family: 'architecture-v1', aliases: [s.id, '建筑'],
    parameters: { width: lengthField('宽度', s.width), height: lengthField('高度', s.height), depth: lengthField('进深／厚度', s.depth), ...s.extra } }));

const stairParameters = { width: lengthField('梯段宽度', 1.2), steps: integerField('每段级数', 8), rise: lengthField('踏步高度', .18), tread: lengthField('踏步进深', .28), landing: lengthField('平台进深', 1.2) };
export const CIRCULATION_ASSETS: readonly AssetDefinition[] = [
    ...(['straight', 'l', 'u', 'crest'] as const).map((style, i) => ({ ...common, id: 'structure-stairs-' + style, name: ['直楼梯', 'L 形楼梯', 'U 形楼梯', '双向升降楼梯'][i], group: '通行构件', family: 'circulation-v1', aliases: ['楼梯', 'stairs', style], parameters: { ...stairParameters } })),
    { ...common, id: 'structure-stairs-spiral', name: '螺旋楼梯', group: '通行构件', family: 'circulation-v1', aliases: ['楼梯', 'spiral'], parameters: { radius: lengthField('外半径', 1.5), width: lengthField('踏步径向宽度', 1), steps: integerField('总级数', 18), rise: lengthField('踏步高度', .18), turn: { ...angleField('总转角', 300, 1080), min: 30 } } },
    { ...common, id: 'structure-ramp', name: '坡道', group: '通行构件', family: 'circulation-v1', aliases: ['无障碍', 'ramp'], parameters: { width: lengthField('宽度', 1.5), height: lengthField('高差', 1), length: lengthField('水平长度', 5) } },
    { ...common, id: 'structure-ladder', name: '梯子', group: '通行构件', family: 'circulation-v1', aliases: ['ladder'], parameters: { width: lengthField('宽度', .5, .2), height: lengthField('高度', 3, .4), steps: integerField('横档数量', 10, 2, 64), tilt: { ...angleField('后倾角', 12, 50) } } },
    { ...common, id: 'structure-railing', name: '栏杆', group: '通行构件', family: 'circulation-v1', aliases: ['护栏', 'railing'], parameters: { length: lengthField('长度', 3, .2), height: lengthField('高度', 1.1, .2), posts: integerField('立杆数量', 7, 2, 128) } },
];
