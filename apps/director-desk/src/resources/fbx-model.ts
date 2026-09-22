import * as T from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { modelPath, unpackModelFiles, type ModelPackage } from './model-package.ts';
import { collectFbxFiles } from './fbx-source.ts';
import { adoptModel, disposeSource, type LoadedModel, type ModelSource } from './model-runtime.ts';

const prefix = 'model-package:///';

export async function loadFbxModel(resource: ModelPackage, signal?: AbortSignal): Promise<LoadedModel> {
    signal?.throwIfAborted();
    const files = unpackModelFiles(resource), entry = modelPath(resource.entry), { info, requests } = collectFbxFiles(entry, files);
    const manager = new T.LoadingManager(), urls = new Set<string>(), external = new Map<string, string>();
    const source: ModelSource = { scene: new T.Group(), scenes: [], animations: [], cameras: [], textures: [] };
    source.scenes.push(source.scene);
    let failed = false;
    const ready = new Promise<void>(resolve => { manager.onLoad = resolve; });
    manager.onError = () => { failed = true; };
    const inline = new Set(info.media.filter(m => typeof m.content === 'string').map(m => {
        const ext = m.reference.split('.').at(-1)!.toLowerCase();
        return 'data:image/' + (ext === 'jpg' ? 'jpeg' : ext) + ';base64,' + m.content;
    }));
    manager.setURLModifier(url => {
        signal?.throwIfAborted();
        if (urls.has(url) || inline.has(url)) return url;
        if (!url.startsWith(prefix)) throw Error('FBX 尝试读取未打包的资源');
        const request = url.slice(prefix.length), path = requests.get(request);
        if (!path || !files.has(path)) throw Error('FBX 贴图没有对应的已选择文件');
        if (!external.has(path)) external.set(path, URL.createObjectURL(new Blob([new Uint8Array(files.get(path)!)])));
        return external.get(path)!;
    });
    class TrackedTextureLoader extends T.TextureLoader {
        override load(...args: Parameters<T.TextureLoader['load']>) { const texture = super.load(...args); source.textures!.push(texture); return texture; }
    }
    manager.addHandler(/\.(png|jpe?g|bmp|webp)$/i, new TrackedTextureLoader(manager));
    let parseError: unknown;
    // FBXLoader creates embedded image Blob URLs internally, including unused images.
    // Capture only its synchronous parse scope and restore immediately, before awaiting any work.
    const createURL = URL.createObjectURL;
    URL.createObjectURL = blob => { const url = createURL.call(URL, blob); urls.add(url); return url; };
    manager.itemStart('fbx-parse');
    try {
        const bytes = info.document.ascii ? new TextEncoder().encode(info.document.ascii) : new Uint8Array(files.get(entry)!);
        const scene = new FBXLoader(manager).parse(bytes.buffer as ArrayBuffer, prefix);
        source.scene.add(scene); source.animations = scene.animations;
        scene.traverse(node => { if (node instanceof T.Camera) source.cameras.push(node); });
        // FBXLoader already rotates +Z-up to +Y-up. This wrapper only supplies missing sign/X-axis correction.
        if (info.upAxis === 0) source.scene.rotation.z = info.upSign * Math.PI / 2;
        else if (info.upSign < 0) source.scene.rotation.x = Math.PI;
        source.scene.scale.setScalar(info.unitScale);
    } catch (error) { parseError = error; }
    finally { URL.createObjectURL = createURL; manager.itemEnd('fbx-parse'); }
    try {
        await ready;
        if (parseError) throw parseError;
        signal?.throwIfAborted();
        if (failed) throw Error('FBX 关联贴图无法解码，请检查图片文件');
        source.scene.traverse(node => { if (node instanceof T.Line || node instanceof T.Points) throw Error('当前 FBX 需要面网格，请将曲线或点转换为网格后导出'); });
    } catch (error) { disposeSource(source); throw error; }
    finally { urls.forEach(url => URL.revokeObjectURL(url)); }
    return adoptModel(source, '', [info.unitKnown ? 'FBX 已按文件单位换算为米，并校正向上轴为 +Y；单位与朝向控件用于额外校正。' : 'FBX 缺少单位标记，暂按一单位一米读取，请核实尺寸；向上轴已校正为 +Y。']);
}
