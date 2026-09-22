import * as T from 'three';
import type { Engine } from '../engine.ts';
import { resourceUsage } from './resource-usage.ts';

/** Allocated mesh resources, including hidden objects. Counts are not visibility or VRAM estimates. */
export function collectRenderStatistics(roots: readonly T.Object3D[]) {
    const visited = new Set<T.Object3D>(), geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures = new Set<T.Texture>();
    const buffers = new Set<ArrayBufferLike>(); let meshes = 0, instances = 0, triangles = 0, points = 0, lines = 0;
    for (const root of roots) root.traverse(object => {
        if (visited.has(object)) return; visited.add(object);
        if (!(object instanceof T.Mesh || object instanceof T.Points || object instanceof T.Line)) return;
        const count = object instanceof T.InstancedMesh ? object.count : 1;
        const vertices=object.geometry.index?.count ?? object.geometry.getAttribute('position')?.count ?? 0;
        if(object instanceof T.Mesh){meshes++;instances+=count;triangles+=Math.floor(vertices/3)*count;}
        else if(object instanceof T.Points)points+=vertices;
        else lines+=object instanceof T.LineSegments?Math.floor(vertices/2):Math.max(0,vertices-1);
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    for (const geometry of geometries) {
        for (const attribute of [geometry.index, ...Object.values(geometry.attributes), ...Object.values(geometry.morphAttributes).flat()]) {
            if (!attribute) continue;
            const array = attribute instanceof T.InterleavedBufferAttribute ? attribute.data.array : attribute.array;
            buffers.add(array.buffer);
        }
    }
    const addTexture = (value: unknown) => { if (value instanceof T.Texture) textures.add(value); else if (Array.isArray(value)) value.forEach(addTexture); };
    for (const material of materials) {
        Object.values(material).forEach(addTexture);
        if (material instanceof T.ShaderMaterial) Object.values(material.uniforms).forEach(uniform => addTexture(uniform.value));
    }
    let baseLevelTexels = 0, unknownTextureSizes = 0;
    for (const texture of textures) {
        const images: unknown[] = Array.isArray(texture.image) ? texture.image : [texture.image];
        let pixels = 0, known = !!images.length;
        for (const image of images) {
            const data = image as { width?: number; height?: number; depth?: number } | null;
            const size = (data?.width ?? 0) * (data?.height ?? 0) * (data?.depth ?? 1);
            if (!Number.isSafeInteger(size) || size <= 0) known = false; else pixels += size;
        }
        if (known) baseLevelTexels += pixels; else unknownTextureSizes++;
    }
    return { meshes, instances, triangles, points, lines, uniqueGeometries: geometries.size, geometryBufferBytes: [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0),
        materials: materials.size, textures: textures.size, baseLevelTexels, unknownTextureSizes };
}

export function sceneResourceReport(engine: Pick<Engine, 'project' | 'models' | 'roomGroup' | 'editorRenderer' | 'shotRenderer'>) {
    const usage = resourceUsage(engine.project);
    const renderer = (renderer: T.WebGLRenderer) => ({
        frame: renderer.info.render.frame, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
    });
    return { sources: { count: usage.length, bytes: usage.reduce((sum, r) => sum + r.sourceBytes, 0), unused: usage.filter(r => !r.used).length },
        scene: collectRenderStatistics([...engine.models.values(), engine.roomGroup]),
        lastRender: { editor: renderer(engine.editorRenderer), camera: renderer(engine.shotRenderer) },
        scope: 'scene 包含已分配的隐藏网格，不含编辑辅助线；共享几何、材质、纹理按对象身份去重。geometryBufferBytes 是去重后的 CPU 属性数组底层缓冲区字节；baseLevelTexels 只计可读尺寸的纹理基础层。均不是显存或进程内存。lastRender 是各视口最近一帧统计，含阴影等绘制；视口未绘制时可保留旧值，两个 WebGL 上下文的计数不能直接相加作为去重总量。' };
}
