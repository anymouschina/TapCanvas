import * as T from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { modelPath, unpackModelFiles, type ModelPackage } from './model-package.ts';
import { objLibraries, readObjMaterials, sourceLines } from './obj-source.ts';
import { adoptModel, disposeSource, type LoadedModel, type ModelSource } from './model-runtime.ts';

const prefix = 'model-package:///';

export async function loadObjModel(resource: ModelPackage, signal?: AbortSignal): Promise<LoadedModel> {
    signal?.throwIfAborted();
    const files = unpackModelFiles(resource), entry = modelPath(resource.entry), bytes = files.get(entry)!;
    const manager = new T.LoadingManager(), urls = new Map<string, string>();
    let failed = false;
    const ready = new Promise<void>(resolve => { manager.onLoad = resolve; });
    manager.onError = () => { failed = true; };
    manager.setURLModifier(url => {
        signal?.throwIfAborted();
        if (!url.startsWith(prefix)) throw Error('OBJ 尝试读取未打包的资源');
        const name = modelPath(decodeURIComponent(url.slice(prefix.length))), file = files.get(name);
        if (!file) throw Error('模型资源缺失：' + name);
        if (!urls.has(name)) urls.set(name, URL.createObjectURL(new Blob([new Uint8Array(file)])));
        return urls.get(name)!;
    });
    // One creator combines libraries; texture references retain each MTL's own directory.
    const text = objLibraries(entry, bytes, files).flatMap(library => readObjMaterials(library, files.get(library)!).flatMap(material => [
        'newmtl ' + material.name,
        ...material.properties.map(p => p.key + ' ' + (p.texture ? p.texture.options + ' ' + prefix + p.texture.path.split('/').map(encodeURIComponent).join('/') : p.value))
    ])).join('\n');
    const materials = new MTLLoader(manager).parse(text, '');
    const source: ModelSource = { scene: new T.Group(), scenes: [], animations: [], cameras: [], textures: [] };
    // A later map can fail before its material is constructed. Track earlier textures independently.
    const loadTexture = materials.loadTexture.bind(materials);
    materials.loadTexture = (...args: Parameters<typeof loadTexture>) => { const texture = loadTexture(...args); source.textures!.push(texture); return texture; };
    let parseError: unknown;
    manager.itemStart('obj-parse');
    try {
        const normalized = sourceLines(bytes).map(line => line.key + ' ' + line.value).join('\n');
        source.scene = new OBJLoader(manager).setMaterials(materials).parse(normalized);
        source.scenes.push(source.scene);
    } catch (error) { parseError = error; }
    finally { manager.itemEnd('obj-parse'); }
    try {
        // OBJLoader.parse is synchronous; images are not. Do not revoke URLs or commit before they finish.
        await ready;
        source.materials = Object.values(materials.materials);
        if (parseError) throw parseError;
        source.scene.traverse(node => { if (node instanceof T.Line || node instanceof T.Points) throw Error('当前 OBJ 需要面网格，请将线或点对象转换为网格后导出'); });
        signal?.throwIfAborted();
        if (failed) throw Error('模型关联贴图无法解码，请检查图片文件');
    } catch (error) { disposeSource(source); throw error; }
    finally { urls.forEach(url => URL.revokeObjectURL(url)); }
    return adoptModel(source, '', ['OBJ 不记录可靠的单位与向上轴；请按实际尺寸校正。', 'OBJ 按静态网格读取，不包含蒙皮或动画。']);
}
