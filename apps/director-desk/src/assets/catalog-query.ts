import { ASSETS, ASSET_GROUPS, assetJoints, searchAssets } from '../asset-catalog.ts';
import { ACTIONS, type Action } from '../model.ts';
import type { AssetDefinition } from './catalog/types.ts';
import { parameterDefaults } from '../parametric-props.ts';

export interface AssetQuery {
    query?: string;
    queries?: string[];
    group?: string;
    kind?: AssetDefinition['kind'];
    rig?: NonNullable<AssetDefinition['capabilities']>['rig'];
    action?: Action;
    ids?: string[];
    details?: boolean;
    offset?: number;
    limit?: number;
}
function capabilities(asset: AssetDefinition): NonNullable<AssetDefinition['capabilities']> {
    return asset.capabilities ?? (asset.kind === 'actor' || asset.kind === 'crowd'
        ? { rig: 'human-legacy', actions: Object.keys(ACTIONS) as Action[], pose: true, path: true }
        : { rig: 'none', actions: [], pose: false, path: true });
}
/** Serializable discovery without constructing meshes or loading a renderer. */
export function queryAssetCatalog(query: AssetQuery = {}, allowedIds?: readonly string[]) {
    const offset = query.offset ?? 0, limit = query.limit ?? 8;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset 必须是非负安全整数');
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('limit 必须是 1—50 的整数');
    if (query.action !== undefined && !Object.hasOwn(ACTIONS, query.action)) throw new Error('未知动作标识');
    if (query.queries !== undefined && (!Array.isArray(query.queries) || !query.queries.length || query.queries.length > 20 || query.queries.some(q => typeof q !== 'string' || !q.trim()))) throw Error('queries 需要 1—20 个非空搜索词组，各组取并集；query 内的空格词取交集');
    if (query.group && query.group !== '全部' && !ASSET_GROUPS.includes(query.group)) throw Error('未知资产类别；可用 group：' + ASSET_GROUPS.join('、'));
    const hasTarget = !!(query.query?.trim() || query.queries?.length || query.ids?.length || query.group || query.kind || query.rig || query.action);
    const alternatives = query.queries ? new Set(query.queries.flatMap(q => searchAssets(q)).map(a => a.id)) : null;
    const list = (hasTarget ? searchAssets(query.query ?? '', query.group ?? '全部') : []).filter(asset => {
        const available = capabilities(asset);
        return (!allowedIds || allowedIds.includes(asset.id)) && (!alternatives || alternatives.has(asset.id)) && (!query.ids || query.ids.includes(asset.id)) && (!query.kind || asset.kind === query.kind)
            && (!query.rig || available.rig === query.rig) && (!query.action || available.actions.includes(query.action));
    });
    const assets = list.slice(offset, offset + limit).map(asset => {
        const available = capabilities(asset);
        const legacyDefaults = Object.hasOwn(parameterDefaults, asset.id) ? parameterDefaults[asset.id] : undefined;
        const parameterPatchField = asset.parameters ? 'assetParameters' : legacyDefaults ? 'parameters' : null;
        const basic = { id: asset.id, name: asset.name, kind: asset.kind, group: asset.group, defaults: asset.defaults,
            capabilities: available, parameterPatchField, parameterKeys: Object.keys(asset.parameters ?? legacyDefaults ?? {}) };
        return query.details ? { ...asset, ...basic, legacyParameterDefaults: legacyDefaults, joints: available.pose ? assetJoints(asset.id) : {},
            addExample: { operation: 'add', asset: asset.id, id: 'new-entity', ...(parameterPatchField ? { patch: { [parameterPatchField]: asset.parameters
                ? Object.fromEntries(Object.entries(asset.parameters).map(([key, field]) => [key, field.default])) : legacyDefaults } } : {}) } } : basic;
    });
    return structuredClone({
        found: list.length > 0,
        message: !hasTarget ? '请先指定要找的白模名称、关键词、ID 或类型；空查询不返回资产库。' : !list.length ? '没有找到符合条件的内置白模。' : `找到 ${list.length} 个匹配白模。`,
        total: list.length, offset, limit, nextOffset: offset + assets.length < list.length ? offset + assets.length : null,
        groups: [...new Set(list.map(asset => asset.group))].map(name => ({ name, count: list.filter(asset => asset.group === name).length })),
        missingQueries: [...new Set(query.queries ?? (query.query?.trim() ? [query.query] : []))].filter(term => { const matches = new Set(searchAssets(term).map(a => a.id)); return !list.some(asset => matches.has(asset.id)); }),
        missingIds: [...new Set(query.ids ?? [])].filter(id => !ASSETS.some(asset => asset.id === id && (!allowedIds || allowedIds.includes(id)))), assets,
        actions: Object.fromEntries([...new Set(assets.flatMap(asset => asset.capabilities.actions))].map(action => [action, ACTIONS[action]])),
        conventions: '默认分页返回摘要；用 ids 与 details:true 获取完整参数和关节。米／秒，rotation 弧度，pose 角度，+Y 向上、+Z 向前。新资产用 assetParameters；旧 stairs/road/wall/ground 用 parameters。动物当前只有待机、静态姿态与路径位移，没有自然步态。摄影机通过 asset:camera 新建，patch.camera 可只传要修改的字段，例如 {focal:70,target:[0,1.2,0]}，未提供的字段保留默认或原值。数组整体替换，实体 ID 保持稳定。'
    });
}
