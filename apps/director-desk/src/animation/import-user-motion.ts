import { packModelFiles, type ModelSourceFile } from '../resources/model-package.ts';
import { modelResourceId, type ModelResource } from '../resources/project-resources.ts';
import type { ModelInspection } from '../resources/model-runtime.ts';
import { userMotionId, type UserMotion } from './user-motion.ts';

export async function importMotionFile(entry: string, files: ModelSourceFile[], signal?: AbortSignal) {
    if (!/\.(fbx|glb|gltf)$/i.test(entry)) throw Error('动作导入支持 FBX、GLB 和 glTF');
    const data = packModelFiles(entry, files), id = await modelResourceId(data);
    const { loadModelPackage } = await import('../resources/model-loader.ts');
    const model = await loadModelPackage(data, signal), info = model.inspection;
    if (!info.bones.length || !info.animations.some(a => a.duration > 0 && a.tracks > 0)) {
        model.dispose(); throw Error('文件没有可用的人形骨架动作；模型自带的非骨骼动画请使用模型的“动画”页');
    }
    const resource: ModelResource = { id, name: entry.split('/').at(-1)!.replace(/\.[^.]+$/, ''), package: data,
        copyright: info.copyright, source: '', license: '' };
    return { resource, model };
}
export function motionFromSource(resource: ModelResource, info: ModelInspection, index: number): UserMotion {
    const animation = info.animations.find(a => a.index === index && a.duration > 0 && a.tracks > 0);
    if (!animation) throw Error('请选择有可播放内容的动作');
    const rig = structuredClone(info.rigSuggestion.rig);
    return { id: userMotionId(resource.id, index), name: `${resource.name} / ${animation.name}`.slice(0, 100), duration: animation.duration,
        data: { resourceId: resource.id, index, rig, unitScale: 1, orientation: [0, 0, 0], loop: false, blend: .2,
            ...(rig.bones.hips ? { motion: { mode: 'inPlace', node: rig.bones.hips } as const } : {}) } };
}
