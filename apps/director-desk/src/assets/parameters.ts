import { findAsset } from '../asset-catalog.ts';
import type { Entity } from '../model.ts';

export function assetParameters(e: Pick<Entity, 'asset' | 'assetParameters'>): Record<string, number> {
    const definition = findAsset(e.asset);
    return { ...Object.fromEntries(Object.entries(definition?.parameters ?? {}).map(([k, v]) => [k, v.default])), ...e.assetParameters };
}
export function validateAssetParameters(e: Entity) {
    if (e.assetParameters === undefined) return;
    const schema = findAsset(e.asset)?.parameters;
    if (!schema || !e.assetParameters || typeof e.assetParameters !== 'object' || Array.isArray(e.assetParameters))
        throw new Error('该资产没有可用的白模参数，或参数格式无效');
    for (const [key, value] of Object.entries(e.assetParameters)) {
        const field = Object.hasOwn(schema, key) ? schema[key] : undefined;
        if (!field || !Number.isFinite(value) || value < field.min || value > field.max || field.integer && !Number.isInteger(value) || field.choices && !Object.hasOwn(field.choices, String(value)))
            throw new Error(`白模参数 ${key} 超出范围或不受支持`);
    }
    const values = assetParameters(e);
    if (findAsset(e.asset)?.family === 'vehicle-v1' && e.asset !== 'vehicle-boat' && values.height * values.wheelRatio * 2 > values.depth * .40) throw new Error('车轮过大，请减小轮半径比例或增加车身长度');
    if (e.asset === 'industrial-scaffold' && values.height / (values.levels + 1) < .12) throw new Error('脚手架平台过密，请减少层数或增加高度');
    if (findAsset(e.asset)?.family === 'building-v1') {
        if (values.thickness * 4 >= Math.min(values.width, values.depth)) throw new Error('墙柱厚度过大，建筑内部需保留空间');
        if (Math.min(values.width, values.depth - 2 * values.thickness) / values.bays < .5) throw new Error('立面开间过密，请减少开间数或增加建筑尺寸');
    }
    if (findAsset(e.asset)?.family === 'architecture-v1') {
        if (values.frame !== undefined && values.frame * 2 >= Math.min(values.width, values.height)) throw new Error('框宽必须小于门窗宽高的一半');
        if (e.asset === 'structure-window' && values.frame * 3.2 >= Math.min(values.width, values.height)) throw new Error('窗框需为内侧窗扇留出空间，请减小框宽或增加宽高');
        if (values.openingWidth > 0 && (values.openingWidth >= values.width || values.sill + values.openingHeight > values.height)) throw new Error('洞口必须容纳在墙体宽高以内');
    }
    if (findAsset(e.asset)?.family === 'circulation-v1') {
        if (e.asset === 'structure-stairs-spiral' && (values.width >= values.radius || values.turn / values.steps > 90)) throw new Error('螺旋梯需保留内孔，每级转角不得超过 90 度');
        if (e.asset === 'structure-stairs-l' && values.landing < values.width) throw new Error('L 形楼梯平台进深不得小于梯段宽度');
        if (e.asset === 'structure-ladder' && values.height / (values.steps + 1) < .07) throw new Error('梯子横档过密，请减少横档数量或增加高度');
        if (e.asset === 'structure-railing' && values.length / (values.posts - 1) < .07) throw new Error('栏杆立杆过密，请减少数量或增加长度');
    }
    if (findAsset(e.asset)?.family === 'road-v1') {
        if (e.asset === 'road-curve' && values.radius <= values.width / 2) throw new Error('弯路中心线半径必须大于路宽的一半');
        if (e.asset === 'road-junction' && values.length <= values.width) throw new Error('路口总长度必须大于道路宽度');
        if (e.asset === 'road-busstop' && (values.width < .6 || values.length < .4)) throw new Error('站亭至少需要 0.6 米宽、0.4 米进深');
    }
    if (findAsset(e.asset)?.family === 'furniture-v1' && values.surfaceHeight !== undefined && values.surfaceHeight > values.height * .8)
        throw new Error('座面／床面／台面高度不得超过整体高度的 80%，请增加整体高度或降低承托面');
    if (findAsset(e.asset)?.family === 'furniture-v1' && values.layers !== undefined) {
        const board = Math.min(.045,values.width*.08,values.height*.08,values.depth*.08);
        if ((values.height-board)/(values.layers-1) <= board*1.5) throw new Error('层板过密，请减少层数或增加高度');
    }
}
