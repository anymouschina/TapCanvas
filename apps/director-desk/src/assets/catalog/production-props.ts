import type { AssetDefinition, AssetParameter } from './types.ts';
import { lengthField, integerField } from './architecture.ts';
const enabled = (label: string): AssetParameter => ({ label, default: 1, min: 0, max: 1, step: 1, integer: true, choices: { '0': '关闭', '1': '开启' } });
const common = { kind: 'prop', icon: '▣', capabilities: { rig: 'none', actions: [], pose: false, path: true } } as const;
const sizes = (w: number, h: number, d: number) => ({ width: lengthField('宽度', w, .1), height: lengthField('高度', h, .05), depth: lengthField('进深／长度', d, .1) });
const industrial = [
    ['container', '集装箱', 2.44, 2.59, 6.06], ['pallet', '托盘', 1.2, .15, 1], ['barrel', '油桶', .6, .9, .6], ['pipeline', '管线', 3, .5, .5],
    ['scaffold', '脚手架', 2, 6, 1.2], ['barrier', '施工围挡', 3, 2, .25], ['cone', '路锥', .4, .7, .4], ['handcart', '手推车', .7, 1.1, 1.2],
] as const;
export const INDUSTRIAL_ASSETS: readonly AssetDefinition[] = industrial.map(([style, name, w, h, d]): AssetDefinition => ({ ...common, id: 'industrial-' + style, name, family: 'industrial-v1', group: '工业施工', aliases: [style, '工业'],
    parameters: { ...sizes(w, h, d), ...(style === 'scaffold' ? { levels: integerField('平台层数', 2, 1, 12) } : {}), ...(style === 'container' ? { opening: { label: '箱门开合', default: 0, min: 0, max: 150, step: 1, unit: '度' } } : {}) } }));
const themed = [
    ['throne', '宝座', 1.1, 1.8, .9], ['table', '古式长案', 2, .8, .8], ['weaponrack', '兵器架', 1.8, 1.8, .6], ['flagpole', '旗杆', 1.4, 4, .5],
    ['altar', '祭坛', 3, 1.3, 2.4], ['ring', '擂台', 5, 1.6, 5], ['tent', '帐篷', 3, 2.5, 4], ['stall', '摊位', 2, 2.4, 1.2],
] as const;
export const THEMED_ASSETS: readonly AssetDefinition[] = themed.map(([style, name, w, h, d]): AssetDefinition => ({ ...common, id: 'theme-' + style, name, family: 'themed-v1', group: '古装舞台', aliases: [style, '古装', '舞台'],
    parameters: { ...sizes(w, h, d), ...(style === 'weaponrack' ? { slots: integerField('架位数量', 5, 1, 16) } : {}),
        ...(style === 'altar' ? { steps: integerField('台阶数量', 3, 1, 12) } : {}), ...(style === 'ring' ? { ropes: enabled('围绳') } : {}),
        ...(style === 'stall' ? { canopy: enabled('顶篷') } : {}), ...(style === 'flagpole' ? { flag: enabled('旗面') } : {}) } }));
const vehicles = [
    ['sedan', '轿车', 1.8, 1.45, 4.5, 4], ['suv', 'SUV', 1.95, 1.8, 4.8, 4], ['van', '面包车', 1.8, 2, 4.6, 6], ['bus', '公交车', 2.5, 3.1, 10, 16],
    ['truck', '卡车', 2.5, 3.2, 7, 2], ['bicycle', '自行车', .6, 1.1, 1.8, 1], ['motorcycle', '摩托车', .8, 1.3, 2.1, 1], ['boat', '小船', 1.5, .8, 3.6, 3],
] as const;
export const VEHICLE_ASSETS: readonly AssetDefinition[] = vehicles.map(([style, name, w, h, d, seats]): AssetDefinition => ({ ...common, id: 'vehicle-' + style, name, family: 'vehicle-v1', group: '交通工具', aliases: [style, '车辆'],
    parameters: { ...sizes(w, h, d), ...(!['bicycle', 'motorcycle'].includes(style) ? { seats: integerField('座位数量', seats, 1, style === 'bus' ? 40 : style === 'boat' ? 8 : 8) } : {}),
        ...(style !== 'boat' ? { wheelRatio: { label: '轮半径／车高', default: ['bicycle', 'motorcycle'].includes(style) ? .28 : .18, min: .08, max: .35, step: .01 },
            wheelbaseRatio: { label: '前后轴距倍率', default: 1, min: .8, max: 1.2, step: .01 },
            ...(!['bicycle','motorcycle'].includes(style) ? { trackRatio: { label: '左右轮距倍率', default: 1, min: .8, max: 1.15, step: .01 } } : {}) } : {}) } }));
