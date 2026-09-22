import type { ModelPackage } from './model-package.ts';
import type { LoadedModel } from './model-runtime.ts';

export async function loadModelPackage(resource: ModelPackage, signal?: AbortSignal): Promise<LoadedModel> {
    if (resource.format === 'fbx') return (await import('./fbx-model.ts')).loadFbxModel(resource, signal);
    if (resource.format === 'obj') return (await import('./obj-model.ts')).loadObjModel(resource, signal);
    return (await import('./gltf-model.ts')).loadGltfModel(resource, signal);
}
