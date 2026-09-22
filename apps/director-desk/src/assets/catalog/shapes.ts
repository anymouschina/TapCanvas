import type { AssetDefinition } from './types.ts';

const size = (label: string) => ({ label, default: 1, min: .02, max: 500, step: .05, unit: '米' });
const dimensions = { width: size('宽度'), height: size('高度'), depth: size('进深') };
const segments = (label: string, value: number) => ({ label, default: value, min: 6, max: 96, step: 1, integer: true });
const curved: Record<string, number> = { 'shape-sphere': 24, 'shape-cylinder': 24, 'shape-cone': 24, 'shape-capsule': 16, 'shape-torus': 32, 'shape-hemisphere': 24, 'shape-arch': 16, 'shape-tube': 24, 'shape-arc': 32 };
const presets = [
    ['shape-box', '方块', 'box cube'], ['shape-sphere', '球体', 'sphere ball'], ['shape-cylinder', '圆柱', 'cylinder'],
    ['shape-cone', '圆锥', 'cone'], ['shape-capsule', '胶囊', 'capsule'], ['shape-torus', '圆环', 'torus ring'],
    ['shape-pyramid', '棱锥', 'pyramid'], ['shape-plane', '平面板', 'plane slab'],
    ['shape-wedge', '楔块', 'wedge 坡道'], ['shape-ramp', '斜板', 'ramp'], ['shape-arch', '拱形', 'arch'],
    ['shape-hemisphere', '半球', 'hemisphere dome'], ['shape-tube', '空心管', 'tube pipe'],
    ['shape-l', 'L 形块', 'l block'], ['shape-u', 'U 形块', 'u block'], ['shape-arc', '圆弧段', 'arc']
] as const;
export const SHAPE_ASSETS: readonly AssetDefinition[] = presets.map(([id, name, aliases], i) => ({
    id, name, kind: 'prop', group: i < 8 ? '基础形状' : '结构形状', icon: '◇', family: 'shape-v1', aliases: aliases.split(' '),
    capabilities: { rig: 'none', actions: [], pose: false, path: true },
    parameters: { ...dimensions,
        ...(curved[id] ? { segments: segments('圆周细分', curved[id]) } : {}),
        ...(['shape-sphere','shape-hemisphere','shape-capsule','shape-torus','shape-arc'].includes(id) ? { crossSegments: segments('纵向／截面细分', id === 'shape-sphere' ? 16 : id === 'shape-capsule' ? 6 : 12) } : {}),
        ...(id === 'shape-arc' ? { angle: { label: '圆弧角度', default: 180, min: 10, max: 360, step: 1, unit: '度' } } : {}),
        ...(id === 'shape-plane' ? { height: { ...size('厚度'), default: .04 } } : {}),
        ...(['shape-torus','shape-arch','shape-tube','shape-l','shape-u','shape-arc','shape-ramp'].includes(id)
            ? { thickness: { label: '截面厚度比', default: .18, min: .03, max: .45, step: .01 } } : {}) }
}));
