import { SHAPE_ASSETS } from './catalog/shapes.ts';

export type CreationMode = 'full' | 'geometry';
export const GEOMETRY_ASSET_IDS = SHAPE_ASSETS.map(asset => asset.id);
export const isGeometryAsset = (id: string) => (GEOMETRY_ASSET_IDS as readonly string[]).includes(id);
/** Small, complete working palette: the assistant can create geometry without discovering a catalog. */
export function geometryCreationGuide() {
    return {
        assets: GEOMETRY_ASSET_IDS.map(id => { const asset = SHAPE_ASSETS.find(a => a.id === id)!; return { id, name: asset.name }; }),
        parameterPatchField: 'assetParameters', dimensions: ['width', 'height', 'depth'],
        conventions: '这些几何体均为 prop。尺寸单位米，每轴 0.02—500，通常默认 1，shape-plane 的 height 默认 0.04；position 为底面中心，rotation 为弧度，颜色用 color:#RRGGBB；尺寸填写 patch.assetParameters:{width,height,depth}，scale 默认 [1,1,1]。摄影机仍使用 asset:camera。几何角色的 notes.actorId 用空字符串，在剧情和对白中写角色名。',
        workflow: '仅几何体模式：直接使用下列几何体组合、命名、上色并安排路径；已知 ID 且宽高深够用时直接写入。需要 angle、thickness、segments 等未知参数时，仅用 director_assets({ids:[需要的ID],details:true}) 查询这些形状的参数，不扫全库，不检索人物、家具或动作库。人物用有角色姓名和独立颜色的胶囊占位，配 path 表达走位，不给 prop 添加人形动作；剧情动作写 notes。家具和建筑用少量几何体组成，门洞保留真实空隙。动态角色优先用单个胶囊；多个几何体不会自动绑定，需保持各自路径的相对偏移。保留已有对象，不为切换模式清空或转换场景。',
    };
}
