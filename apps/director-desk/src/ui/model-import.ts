import type { AppContext } from '../app-context.ts';
import { workingElevation } from '../building/floors.ts';
import { clone, entity, type Vec3 } from '../model.ts';
import { packModelFiles, type ModelSourceFile } from '../resources/model-package.ts';
import { modelResourceId, type ModelResource } from '../resources/project-resources.ts';
import { $, button, escape } from './common.ts';

export function createModelImport(ctx: AppContext) {
    let libraryOnly = false;
    let files: File[] = [], pending: ModelResource | null = null, aborter: AbortController | null = null;
    const prune = () => ctx.engine.externalModels.retain([ctx.project, ...ctx.history.undoStack, ...ctx.history.redoStack]);
    const orientation = (): Vec3 => [Number($<HTMLSelectElement>('#model-up').value) * Math.PI / 180, Number($<HTMLInputElement>('#model-facing').value) * Math.PI / 180, 0];
    function open(library = false) {
        libraryOnly = library;
        pending = null; files = [];
        ctx.showModal('导入模型', `<p class="panel-help">支持 GLB、glTF、FBX、OBJ。请同时选择关联 BIN、MTL 和贴图，或选择包含它们的文件夹。</p>
            <div class="field-pair"><label class="field">选择文件<input id="model-files" type="file" multiple accept=".glb,.gltf,.fbx,.obj,.mtl,.bin,.png,.jpg,.jpeg,.webp,.avif,.bmp,.gif"/></label><label class="field">选择文件夹<input id="model-folder" type="file" webkitdirectory multiple/></label></div>
            <label class="field">模型主文件<select id="model-entry" aria-label="模型主文件"><option value="">先选择文件</option></select></label><p id="model-import-status" class="panel-help" role="status"></p>`, button('model-cancel', '取消', '', 'subtle') + button('model-load', '读取模型', '', 'primary'));
        for (const id of ['model-files', 'model-folder']) $<HTMLInputElement>('#' + id).addEventListener('change', event => {
            files = [...((event.target as HTMLInputElement).files ?? [])];
            const entries = files.map(file => file.webkitRelativePath || file.name).filter(path => /\.(glb|gltf|fbx|obj)$/i.test(path));
            $('#model-entry').innerHTML = entries.map(path => `<option value="${escape(path)}">${escape(path)}</option>`).join('') || '<option value="">未找到 GLB/glTF/FBX/OBJ</option>';
            $('#model-import-status').textContent = `已选择 ${files.length} 个文件；仅把主模型和实际引用的文件写入工程。`;
        });
    }
    async function load() {
        const entry = $<HTMLSelectElement>('#model-entry').value; if (!entry) { ctx.toast('请先选择模型主文件'); return; }
        const original = ctx.project, fingerprint = JSON.stringify(original); aborter = new AbortController(); ctx.busy = true; ctx.playing = false; ctx.updateTimeUI();
        $('#model-import-status').textContent = '正在读取模型与贴图…';
        try {
            const source: ModelSourceFile[] = [];
            for (const file of files) { aborter.signal.throwIfAborted(); source.push({ path: file.webkitRelativePath || file.name, bytes: new Uint8Array(await file.arrayBuffer()) }); }
            const data = packModelFiles(entry, source), id = await modelResourceId(data);
            const resource: ModelResource = { id, name: entry.split('/').at(-1)!.replace(/\.(glb|gltf|fbx|obj)$/i, ''), package: data, copyright: '', license: '', source: '' };
            const next = { ...ctx.project, version: 2 as const, resources: [...(ctx.project.resources ?? []).filter(r => r.id !== id), resource] };
            await ctx.engine.externalModels.prepare(next, aborter.signal);
            if (ctx.project !== original || JSON.stringify(ctx.project) !== fingerprint) throw Error('读取期间工程已变化，请重新导入');
            pending = resource; const info = ctx.engine.externalModels.inspection(resource); resource.copyright = info.copyright;
            if (!info.meshes && !libraryOnly) throw Error('这是独立动作文件，请从“用户动作库 → 导入动作”添加');
            if (libraryOnly) {
                pending = clone(ctx.project.resources?.find(r => r.id === resource.id) ?? resource);
                ctx.showModal('加入工程资源', `<label class="field"><span>资源名称</span><input id="model-name" maxlength="80" value="${escape(pending.name)}"/></label><p class="panel-help">${info.meshes} 个网格 · ${info.nodes.length} 个节点 · ${info.animations.length} 段动画。加入后可用于道具替换，不新建场景对象；相同内容仅保存一份。</p><label class="field"><span>许可备注</span><input id="model-license" maxlength="1000" value="${escape(pending.license)}"/></label><label class="field"><span>来源备注</span><input id="model-source" maxlength="1000" value="${escape(pending.source)}"/></label>`, button('model-cancel', '取消', '', 'subtle') + button('model-place', '加入工程资源', '', 'primary'));
                document.querySelector('.modal')!.addEventListener('director-before-close', () => { pending = null; prune(); }, { once: true });
                return;
            }
            const description = data.format === 'obj'
                ? `${info.meshes} 个网格。OBJ 不含骨架或动画，原材质按基础光照显示。可编辑位置和路径；单位与朝向需按实际校正。`
                : !info.bones.length ? `${info.meshes} 个网格，${info.animations.length} 段原生动画，未发现可调骨骼。可编排自带动画和路径；人形动作需要完整骨架映射。`
                : `${info.meshes} 个网格，${info.bones.length} 个骨骼，${info.animations.length} 段原生动画。可在骨架页配置映射和默认姿态；自带动画可编排，完整人形映射可使用通用动作预设。`;
            ctx.showModal('放置导入模型', `<div class="button-row" role="tablist"><button id="model-tab-settings" role="tab" aria-selected="true">模型设置</button><button id="model-tab-origin" role="tab" aria-selected="false">来源与说明</button></div><div id="model-import-settings"><label class="field">名称<input id="model-name" value="${escape(resource.name)}" maxlength="80"/></label>
                <div class="field-pair"><label class="field">用途<select id="model-kind"><option value="prop">家具／道具／建筑</option><option value="actor" ${info.skins ? 'selected' : ''}>人物</option></select></label><label class="field">显示方式<select id="model-appearance"><option value="original">原材质</option><option value="white">白模</option><option value="color">识别色</option></select></label></div>
                <div class="field-pair"><label class="field">校正单位<select id="model-units"><option value="1">${data.format === 'fbx' ? '米（FBX 已换算）' : '米'}</option><option value="0.01">厘米</option><option value="0.001">毫米</option><option value="0.0254">英寸</option></select></label><label class="field">校正向上轴<select id="model-up"><option value="0">+Y</option><option value="-90">+Z</option><option value="90">−Z</option><option value="180">−Y</option></select></label></div>
                <label class="field">朝向校正／度<input id="model-facing" type="number" value="0" step="90"/></label><p id="model-size" class="panel-help"></p>
                </div><div id="model-import-origin" hidden><p class="panel-help">${escape(description)}</p><p class="panel-help">${escape(info.copyright || '源文件未提供版权文本，请核实使用许可。')}</p><label class="field">许可备注<input id="model-license" maxlength="1000"/></label><label class="field">来源备注<input id="model-source" maxlength="1000"/></label></div>`, button('model-cancel', '取消', '', 'subtle') + button('model-place', '放入场景', '', 'primary'));
            document.querySelector('.modal')!.addEventListener('director-before-close', () => { pending = null; prune(); }, { once: true });
            for (const tab of ['settings', 'origin']) $('#model-tab-' + tab).addEventListener('click', () => {
                for (const name of ['settings', 'origin']) { $('#model-import-' + name).hidden = name !== tab; $('#model-tab-' + name).setAttribute('aria-selected', String(name === tab)); }
            });
            const measure = () => { const size = ctx.engine.externalModels.measure(resource, Number($<HTMLSelectElement>('#model-units').value), orientation()); $('#model-size').textContent = `校正后宽 ${size[0].toFixed(3)} × 高 ${size[1].toFixed(3)} × 深 ${size[2].toFixed(3)} 米；放置原点位于底部中心。`; };
            for (const id of ['model-units', 'model-up', 'model-facing']) $('#' + id).addEventListener('change', measure); measure();
        } catch (error) { prune(); if ((error as Error).name !== 'AbortError') ctx.toast((error as Error).message, true); }
        finally { const canceled = aborter?.signal.aborted; aborter = null; ctx.busy = false; if (canceled) ctx.closeModal(); ctx.updateTimeUI(); }
    }
    function place() {
        if (!pending) return;
        if (libraryOnly) {
            const resource = clone(pending); resource.name = $('#model-name').value || resource.name; resource.license = $('#model-license').value; resource.source = $('#model-source').value;
            if (ctx.change(() => { ctx.project.version = 2; ctx.project.resources ??= []; const old = ctx.project.resources.findIndex(r => r.id === resource.id); if (old < 0) ctx.project.resources.push(resource); else ctx.project.resources[old] = resource; }, false)) {
                pending = null; ctx.closeModal(); ctx.toast('资源已加入工程，可用于局部替换');
            }
            return;
        }
        const resource = pending, kind = $<HTMLSelectElement>('#model-kind').value === 'actor' ? 'actor' : 'prop';
        const unitScale = Number($<HTMLSelectElement>('#model-units').value), rotation = orientation();
        const size = ctx.engine.externalModels.measure(resource, unitScale, rotation);
        const name = $<HTMLInputElement>('#model-name').value || resource.name;
        resource.license = $<HTMLInputElement>('#model-license').value; resource.source = $<HTMLInputElement>('#model-source').value;
        const target = ctx.engine.orbit.target, e = entity(kind, 'external-model', name, ctx.engine.snapPosition([target.x, workingElevation(ctx.project), target.z]));
        e.position[1] = workingElevation(ctx.project);
        if (ctx.project.editorView?.activeFloorId) e.floorId = ctx.project.editorView.activeFloorId;
        e.external = { resourceId: resource.id, appearance: $<HTMLSelectElement>('#model-appearance').value as 'original' | 'white' | 'color', unitScale, orientation: rotation };
        if (kind === 'actor') e.height = size[1];
        if (ctx.change(() => {
            ctx.project.version = 2; ctx.project.resources ??= [];
            if (!ctx.project.resources.some(r => r.id === resource.id)) ctx.project.resources.push(clone(resource));
            ctx.project.entities.push(e); ctx.selected = e.id; ctx.inspectorTab = 'base'; ctx.sidebarTab = 'scene';
        })) { pending = null; ctx.closeModal(); ctx.engine.focus(e.id); ctx.toast('模型已放入场景，源文件将随工程保存'); }
    }
    return { handle(action: string) {
        if (action === 'model-import') { open(); return true; }
        if (action === 'model-library') { open(true); return true; }
        if (action === 'model-load') { void load(); return true; }
        if (action === 'model-place') { place(); return true; }
        if (action === 'model-cancel') { aborter?.abort(); pending = null; ctx.closeModal(); if (!aborter) prune(); return true; }
        if (action === 'close-modal' && pending) { pending = null; prune(); }
        return false;
    } };
}
