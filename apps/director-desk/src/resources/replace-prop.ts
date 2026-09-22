import { findAsset } from '../asset-catalog.ts';
import { clone, type Project, type Vec3 } from '../model.ts';
import { LIGHT_TYPES, defaultLight } from '../lighting/model.ts';
export interface ReplacePropOptions {
    animation?: 'preserve' | 'clear';
    unitScale?: number;
    orientation?: Vec3;
    appearance?: 'original' | 'white' | 'color';
}

/** Replaces appearance/geometry, keeping identity and directing data. The caller validates and commits atomically. */
export function replaceProp(project: Project, id: string, asset: string, options: ReplacePropOptions = {}) {
    const e = project.entities.find(e => e.id === id); if (!e || e.kind !== 'prop') throw Error('局部替换需选择家具、道具或建筑对象');
    if (e.locked) throw Error('对象已锁定，请先解锁');
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => !['animation', 'unitScale', 'orientation', 'appearance'].includes(k))) throw Error('替换参数无效');
    const animation = options.animation ?? 'preserve'; if (!['preserve', 'clear'].includes(animation)) throw Error('原生动画处理方式无效');
    if (options.unitScale !== undefined && (!Number.isFinite(options.unitScale) || options.unitScale <= 0 || options.unitScale > 10000)
        || options.orientation !== undefined && (!Array.isArray(options.orientation) || options.orientation.length !== 3 || !options.orientation.every(Number.isFinite))
        || options.appearance !== undefined && !['original', 'white', 'color'].includes(options.appearance)) throw Error('模型单位、朝向或显示方式无效');
    const resource = project.resources?.find(r => r.id === asset), definition = findAsset(asset);
    if (!resource && definition?.kind !== 'prop') throw Error('请选择已导入模型资源或内置道具资产');
    if (!resource && (options.unitScale !== undefined || options.orientation !== undefined || options.appearance !== undefined)) throw Error('单位、轴校正和材质显示仅用于外部模型');
    const sameSource = resource ? e.external?.resourceId === resource.id : e.asset === asset;
    if (!sameSource && animation === 'preserve' && e.clips.some(c => c.action === 'native')) throw Error('不同源模型不能直接沿用原生动画，请明确选择清除原生动画');
    if (!sameSource) {
        delete e.parameters; delete e.assetParameters; delete e.contactAnchors;
        e.pose = {}; e.poseKeys = []; delete e.footContact;
    }
    if (animation === 'clear') e.clips = e.clips.filter(c => c.action !== 'native');
    if (resource) {
        const before = sameSource ? e.external : undefined;
        e.asset = 'external-model';
        e.external = { ...before, resourceId: resource.id, unitScale: options.unitScale ?? before?.unitScale ?? 1,
            orientation: clone(options.orientation ?? before?.orientation ?? [0, 0, 0]), appearance: options.appearance ?? before?.appearance ?? 'original' };
    } else { e.asset = asset; delete e.external; }
    if (!sameSource) { if (Object.hasOwn(LIGHT_TYPES, asset)) e.light = defaultLight(asset); else delete e.light; }
    // Structure links deliberately remain: unsupported replacement ports or locked dependants reject the transaction.
}
