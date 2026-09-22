import type { AssetParameter } from './types.ts';
import type { HumanProportions } from './humans.ts';

export const HUMAN_RATIO_FIELDS = { shoulder: '肩宽', pelvis: '胯宽', torso: '躯干长度', thigh: '大腿长度', shin: '小腿长度', upperArm: '上臂长度', forearm: '前臂长度', head: '头部大小', girth: '身体厚度' } as const;
export const BODY_OUTFITS = [undefined, 'casual', 'dress', 'robe', 'armor', 'uniform'] as const;
export const HEADWEAR = [undefined, 'helmet', 'hat'] as const;
const choice = (label: string, labels: string[], value: number): AssetParameter => ({ label, default: value, min: 0, max: labels.length - 1, step: 1, integer: true, choices: Object.fromEntries(labels.map((name, i) => [String(i), name])) });
export function humanParameterSchema(profile: HumanProportions): Record<string, AssetParameter> {
    return {
        ...Object.fromEntries(Object.entries(HUMAN_RATIO_FIELDS).map(([key, label]) => [key + 'Ratio', { label: label + '比例', default: 1, min: .8, max: 1.2, step: .01 }])),
        outfit: choice('服装', ['无', '便装', '长裙', '长袍', '盔甲', '制服'], Math.max(0, BODY_OUTFITS.findIndex(value => value === profile.outfit))),
        headwear: choice('帽盔', ['无', '头盔', '宽檐帽'], Math.max(0, HEADWEAR.findIndex(value => value === profile.outfit))),
        backpack: choice('背包', ['无', '背包'], profile.outfit === 'backpack' ? 1 : 0),
        outfitLength: { label: '裙摆／衣袖长度倍率', default: 1, min: .5, max: 1, step: .05 },
        outfitThickness: { label: '服装厚度倍率', default: 1, min: .5, max: 2, step: .05 }
    };
}
