import type { AppContext } from '../app-context.ts';
import { clone } from '../model.ts';
import { $, button, escape, options } from './common.ts';
import { importMotionFile, motionFromSource } from '../animation/import-user-motion.ts';
import { MotionPreview } from '../animation/motion-preview.ts';
import { assertUserMotion, type UserMotion } from '../animation/user-motion.ts';
import { getUserMotion, listUserMotions, removeUserMotion, saveUserMotion } from '../animation/user-motion-store.ts';
import { HUMAN_BONES, assertRigBindings, rigStatus, type HumanBone } from '../resources/rig-definition.ts';
import { canRetarget } from '../resources/retarget-animation.ts';
import { assertAnimationBinding } from '../resources/native-animation.ts';
import { applyOperationsWithResources } from '../automation/edits.ts';
import './user-motion-panel.css';

export function createUserMotionPanel(ctx: AppContext) {
    let loaded: Awaited<ReturnType<typeof importMotionFile>> | undefined, motion: UserMotion | undefined, preview: MotionPreview | undefined;
    let entries: UserMotion[] = [], query = '', page = 0, tab = 'action', bone: HumanBone = 'hips';
    let active = false, working = false, generation = 0;
    const release = () => { preview?.dispose(); preview = undefined; loaded?.model.dispose(); loaded = undefined; motion = undefined; };
    const error = (e: unknown) => ctx.toast(e instanceof Error ? e.message : '动作操作失败', true);
    async function task(run: () => Promise<void>) {
        if (working || ctx.busy) return;
        working = true; ctx.busy = true; ctx.playing = false; ctx.updateTimeUI();
        try { await run(); } catch (e) { error(e); }
        finally { working = false; ctx.busy = false; ctx.updateTimeUI(); }
    }
    function show() {
        ctx.showModal('用户动作库', `<div class="user-motion-layout"><aside class="user-motion-list">
            <input id="user-motion-search" placeholder="搜索已收藏动作" aria-label="搜索用户动作" value="${escape(query)}"/>
            <div id="user-motion-list"></div><div id="user-motion-pages" class="button-row"></div>
            <button id="user-motion-import" type="button">导入动作文件</button><button id="user-motion-folder" type="button">选择资源文件夹</button>
            <input id="user-motion-files" type="file" multiple hidden accept=".fbx,.glb,.gltf,.bin,.png,.jpg,.jpeg,.webp"/>
            <input id="user-motion-directory" type="file" multiple webkitdirectory hidden/>
            <p class="panel-help">本机收藏可跨工程使用。删除收藏不影响已应用的工程。</p>
        </aside><div class="user-motion-detail"><div id="user-motion-preview"><p>选择或导入动作进行预览</p></div>
            <div class="user-motion-toolbar"><span id="user-motion-status">支持独立骨架或带模型的 FBX、GLB/glTF 动作</span><button id="user-motion-play" type="button">暂停预览</button></div>
            <div class="button-row" role="tablist">${[['action', '动作'], ['rig', '骨架映射'], ['source', '来源']].map(([id, name]) => `<button data-user-motion-tab="${id}" role="tab" aria-selected="${tab === id}">${name}</button>`).join('')}</div>
            <div id="user-motion-settings"></div></div></div>`, button('close-modal', '关闭', '', 'subtle') + '<button id="user-motion-delete" class="subtle">删除收藏</button><button id="user-motion-save" class="subtle">存入动作库</button><button id="user-motion-apply" class="primary">添加到当前人物</button>');
        const modal = $('.modal'); modal.classList.add('user-motion-modal');
        modal.addEventListener('director-before-close', () => { active = false; generation++; release(); }, { once: true });
        $('#user-motion-search').addEventListener('input', () => { query = $('#user-motion-search').value; page = 0; renderList(); });
        $('#user-motion-import').onclick = () => $('#user-motion-files').click();
        $('#user-motion-folder').onclick = () => $('#user-motion-directory').click();
        for (const id of ['user-motion-files', 'user-motion-directory']) $( '#' + id).onchange = event => {
            const files = [...((event.target as HTMLInputElement).files ?? [])]; if (!files.length) return;
            const mainFiles = files.filter(f => /\.(fbx|glb|gltf)$/i.test(f.name));
            if (mainFiles.length !== 1) { ctx.toast('每次请选择一个动作主文件及其关联 BIN、贴图；文件夹中也应只含一个主文件', true); return; }
            void task(async () => {
                $('#user-motion-status').textContent = '正在读取动作…';
                const source = await Promise.all(files.map(async file => ({ path: file.webkitRelativePath || file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
                const asset = await importMotionFile(mainFiles[0].webkitRelativePath || mainFiles[0].name, source);
                release(); loaded = asset;
                chooseClip(asset.model.inspection.animations.find(a => a.duration > 0 && a.tracks > 0)!.index);
            });
        };
        modal.addEventListener('click', event => {
            const target = event.target as HTMLElement, item = target.closest<HTMLElement>('[data-user-motion-id]');
            if (working) return;
            if (item) void select(item.dataset.userMotionId!);
            const pager = target.closest<HTMLElement>('[data-user-motion-page]');
            if (pager) { page += Number(pager.dataset.userMotionPage); renderList(); }
            const section = target.closest<HTMLElement>('[data-user-motion-tab]');
            if (section) { tab = section.dataset.userMotionTab!; renderSettings(); }
        });
        $('#user-motion-play').onclick = () => { if (preview) { preview.playing = !preview.playing; $('#user-motion-play').textContent = preview.playing ? '暂停预览' : '播放预览'; } };
        $('#user-motion-save').onclick = () => void task(async () => {
            if (!motion || !loaded) return;
            assertUserMotion(motion); assertRigBindings(motion.data.rig, motion.data.referencePose, loaded.model.inspection.bones);
            assertAnimationBinding(motion.data, loaded.model.inspection.animations, loaded.model.inspection.nodes);
            await saveUserMotion(motion, loaded.resource); entries = await listUserMotions(); renderList(); renderSettings(); ctx.toast('已存入本机动作库');
        });
        $('#user-motion-delete').onclick = () => void task(async () => {
            if (!motion) return; await removeUserMotion(motion.id); entries = await listUserMotions(); release(); renderList(); renderSettings(); ctx.toast('收藏已删除，工程中的动作保留');
        });
        $('#user-motion-apply').onclick = () => void apply();
        renderList(); renderSettings();
    }
    function renderList() {
        const filtered = entries.filter(m => `${m.name} ${m.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
        page = Math.max(0, Math.min(page, Math.ceil(filtered.length / 5) - 1));
        $('#user-motion-list').innerHTML = filtered.slice(page * 5, page * 5 + 5).map(m => `<button data-user-motion-id="${escape(m.id)}" class="${motion?.id === m.id ? 'active' : ''}" title="${escape(m.name)}"><span>${escape(m.name)}</span><small>${m.duration.toFixed(2)} 秒${rigStatus(m.data.rig).complete ? '' : ' · 待映射'}</small></button>`).join('') || '<p class="panel-help">没有匹配的收藏动作</p>';
        $('#user-motion-pages').innerHTML = `<button data-user-motion-page="-1" ${page ? '' : 'disabled'}>上一页</button><span>${page + 1} / ${Math.max(1, Math.ceil(filtered.length / 5))}</span><button data-user-motion-page="1" ${(page + 1) * 5 < filtered.length ? '' : 'disabled'}>下一页</button>`;
    }
    async function select(id: string) {
        await task(async () => {
            const { loadModelPackage } = await import('../resources/model-loader.ts');
            const token = ++generation, asset = await getUserMotion(id), model = await loadModelPackage(asset.resource.package);
            if (!active || token !== generation) { model.dispose(); return; }
            release(); loaded = { resource: asset.resource, model }; motion = asset.motion; renderList(); renderSettings(); startPreview();
        });
    }
    function chooseClip(index: number) {
        if (!loaded) return;
        motion = motionFromSource(loaded.resource, loaded.model.inspection, index);
        bone = rigStatus(motion.data.rig).missing[0] ?? 'hips'; renderSettings(); startPreview();
    }
    function startPreview() {
        preview?.dispose(); preview = undefined;
        if (motion && loaded) {
            try { preview = new MotionPreview($('#user-motion-preview'), loaded.model, motion); $('#user-motion-play').textContent = '暂停预览'; }
            catch (e) { error(e); }
        }
    }
    function renderSettings() {
        document.querySelectorAll<HTMLElement>('[data-user-motion-tab]').forEach(el => el.setAttribute('aria-selected', String(el.dataset.userMotionTab === tab)));
        const target = ctx.current(), usable = motion && rigStatus(motion.data.rig).complete && target && canRetarget(target) && !target.locked;
        $('#user-motion-apply').toggleAttribute('disabled', !usable);
        $('#user-motion-apply').textContent = target && canRetarget(target) ? `添加到 ${target.name}` : '请先选中人形人物';
        $('#user-motion-save').toggleAttribute('disabled', !motion);
        $('#user-motion-delete').toggleAttribute('disabled', !entries.some(m => m.id === motion?.id));
        if (!motion || !loaded) { $('#user-motion-settings').innerHTML = '<p class="panel-help">支持 FBX、GLB/glTF。动作入库后可在不同工程重复使用。</p>'; return; }
        const m = motion, info = loaded.model.inspection, status = rigStatus(m.data.rig);
        $('#user-motion-status').textContent = `${m.duration.toFixed(2)} 秒 · ${info.bones.length} 个骨骼 · ${status.complete ? '映射完整' : `待映射 ${status.missing.length} 处`} · 源动作预览`;
        const choose = (id: string, label: string, pairs: [string, string][], val: string) => `<label class="field"><span>${label}</span><select id="${id}">${options(pairs, val)}</select></label>`;
        $('#user-motion-settings').innerHTML = tab === 'action' ? `<div class="field-pair">
            ${choose('uml-clip', '源文件动作', info.animations.filter(a => a.duration > 0 && a.tracks > 0).map(a => [String(a.index), a.name]), String(m.data.index))}
            <label class="field"><span>收藏名称</span><input id="uml-name" maxlength="100" value="${escape(m.name)}"/></label>
            ${choose('uml-loop', '播放方式', [['false', '播放一次'], ['true', '循环播放']], String(m.data.loop))}
            ${choose('uml-motion', '走位方式', [['path', '由导演路径控制'], ['source', '保留素材位移']], m.data.motion ? 'path' : 'source')}
            <label class="field"><span>应用时长 / 秒</span><input id="uml-duration" type="number" min=".01" step=".1" value="${m.duration.toFixed(3)}"/></label>
            <p class="panel-help">从 ${ctx.time.toFixed(2)} 秒后的空闲位置添加，可在时间轴裁剪和调速。</p></div>`
            : tab === 'source' ? `<label class="field"><span>来源网址或作者</span><input id="uml-source" maxlength="1000" value="${escape(loaded.resource.source)}"/></label><label class="field"><span>许可备注</span><input id="uml-license" maxlength="1000" value="${escape(loaded.resource.license)}"/></label><p class="panel-help">使用时源文件随工程保存；本机收藏不会进入软件安装包。</p>`
            : `<div class="field-pair">${choose('uml-part', '人体部位', Object.entries(HUMAN_BONES).map(([key, label]) => [key, label + (m.data.rig.bones[key as HumanBone] ? '' : ' · 未映射')]), bone)}
                ${choose('uml-bone', '对应源骨骼', [['', '未映射'], ...info.bones.map(b => [b.path, b.name || b.path] as [string, string])], m.data.rig.bones[bone] ?? '')}
                <label class="field"><span>单位倍率 · FBX 已换算为米</span><input id="uml-scale" type="number" min=".0001" step=".01" value="${m.data.unitScale}"/></label>
                <label class="field"><span>朝向校正 Y / 度</span><input id="uml-facing" type="number" step="90" value="${m.data.orientation[1] * 180 / Math.PI}"/></label></div><p class="panel-help">${status.complete ? '映射完整。应用时仍会检查骨架比例和可用性。' : '需要补齐：' + status.missing.map(key => HUMAN_BONES[key]).join('、')}</p>`;
        $('#user-motion-settings').onchange = event => {
            const input = event.target as HTMLInputElement;
            try {
                if (input.id === 'uml-clip') { chooseClip(Number(input.value)); return; }
                if (input.id === 'uml-name') m.name = input.value;
                if (input.id === 'uml-loop') m.data.loop = input.value === 'true';
                if (input.id === 'uml-motion') {
                    if (input.value === 'source') delete m.data.motion;
                    else { if (!m.data.rig.bones.hips) throw Error('请先映射骨盆'); m.data.motion = { mode: 'inPlace', node: m.data.rig.bones.hips }; }
                    startPreview();
                }
                if (input.id === 'uml-source') loaded!.resource.source = input.value;
                if (input.id === 'uml-license') loaded!.resource.license = input.value;
                if (input.id === 'uml-part') { bone = input.value as HumanBone; renderSettings(); }
                if (input.id === 'uml-bone') { if (input.value) m.data.rig.bones[bone] = input.value; else delete m.data.rig.bones[bone]; if (bone === 'hips' && m.data.motion) { if (input.value) m.data.motion.node = input.value; else delete m.data.motion; } renderSettings(); }
                if (input.id === 'uml-scale' || input.id === 'uml-facing') {
                    const number = Number(input.value); if (!Number.isFinite(number) || input.id === 'uml-scale' && (number <= 0 || number > 10000)) throw Error('请输入有效校正值');
                    if (input.id === 'uml-scale') m.data.unitScale = number; else m.data.orientation[1] = number * Math.PI / 180; startPreview();
                }
            } catch (e) { error(e); renderSettings(); }
        };
    }
    async function apply() {
        if (!motion || !loaded || !ctx.current()) return;
        const asset = { motion: clone(motion), resource: clone(loaded.resource) }, id = ctx.selected;
        const duration = Number($('#uml-duration')?.value ?? motion.duration), before = ctx.project, context = ctx.scenes.context;
        await task(async () => {
            const after = await applyOperationsWithResources(before, [{ operation: 'motion', id, asset: asset.motion.id, time: ctx.time, duration }], new Map([[asset.motion.id, asset]]));
            await ctx.engine.externalModels.prepare(after);
            if (ctx.project !== before || ctx.scenes.context.revision !== context.revision || ctx.history.pending) throw Error('工程已变化，请重新应用');
            ctx.busy = false;
            if (ctx.change(() => { ctx.project = after; ctx.inspectorTab = 'retarget'; })) { ctx.closeModal(); ctx.toast('动作已添加，可在时间轴调整，源素材随工程保存'); }
        });
        ctx.engine.externalModels.retain([ctx.project, ...ctx.history.undoStack, ...ctx.history.redoStack]);
    }
    async function open(fromModel: boolean) {
        release(); active = true; query = ''; page = 0; tab = 'action';
        await task(async () => {
            entries = await listUserMotions();
            const target = ctx.current(), sourceIndex = Number($('#native-source')?.value ?? 0);
            show();
            if (fromModel && target?.external) {
                const { loadModelPackage } = await import('../resources/model-loader.ts');
                const resource = clone(ctx.project.resources!.find(r => r.id === target.external!.resourceId)!);
                const model = await loadModelPackage(resource.package);
                if (!model.inspection.bones.length) { model.dispose(); throw Error('此动画不含人形骨架，请继续在模型的“动画”页使用'); }
                loaded = { resource, model }; chooseClip(sourceIndex);
                if (target.external.rig) motion!.data.rig = clone(target.external.rig);
                if (motion!.data.motion) {
                    if (motion!.data.rig.bones.hips) motion!.data.motion.node = motion!.data.rig.bones.hips;
                    else delete motion!.data.motion;
                }
                motion!.data.unitScale = target.external.unitScale; motion!.data.orientation = clone(target.external.orientation);
                if (target.external.defaultPose) motion!.data.referencePose = clone(target.external.defaultPose);
                renderSettings(); startPreview();
            }
        });
    }
    return { handle(action: string) {
        if (action === 'user-motion-library' || action === 'user-motion-from-model') { void open(action === 'user-motion-from-model'); return true; }
        return false;
    } };
}
