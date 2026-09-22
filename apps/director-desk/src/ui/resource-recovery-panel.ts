import type { AppContext } from '../app-context.ts';
import type { ModelResource } from '../resources/project-resources.ts';
import { ResourceRecovery } from '../resources/resource-recovery.ts';
import { $, escape } from './common.ts';
import './resource-recovery-panel.css';
import { readSceneDocument, projectForScene } from '../scenes/sequence-project.ts';

/** Called while the file-load transaction owns ctx.busy. No project/history mutation here. */
export async function readRecoverableProject(ctx: AppContext, input: unknown, signal?: AbortSignal, purpose: 'project' | 'template' = 'project') {
    const document = await readRecoverableDocument(ctx, input, signal, purpose);
    return projectForScene(document);
}
export async function readRecoverableDocument(ctx: AppContext, input: unknown, signal?: AbortSignal, purpose: 'project' | 'template' = 'project') {
    const draft = await ResourceRecovery.inspectDocument(input); signal?.throwIfAborted();
    if (!draft.problems.length) return readSceneDocument(draft.finish());
    await new Promise<void>((resolve, reject) => {
        let settled = false, loading = false, selected = draft.problems[0].id;
        const abort = () => finish(new DOMException('已取消工程读取', 'AbortError'));
        const escapeKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); abort(); } };
        function finish(error?: Error) {
            if (settled) return; settled = true;
            signal?.removeEventListener('abort', abort); document.removeEventListener('keydown', escapeKey, true);
            // closeModal intentionally refuses during ctx.busy; remove only our own modal.
            document.querySelector('#resource-recovery')?.closest('.modal-backdrop')?.remove();
            if (error) reject(error); else resolve();
        }
        function render() {
            const problems = draft.problems, problem = problems.find(p => p.id === selected) ?? problems[0]; selected = problem?.id ?? '';
            const details = problem ? `<div class="field-pair"><label class="field">待恢复资源<select id="recovery-resource">${problems.map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${escape(p.name)} · ${p.id.slice(-8)}</option>`).join('')}</select></label><label class="field">受影响对象与动作<select id="recovery-uses">${[...problem.entities.map(e => `<option>${escape(e.name)} · ${escape(e.id)}</option>`), ...problem.motionClips.map(c => `<option>动作 ${escape(c.clipId)} · ${escape(c.entityId)}</option>`)].join('') || '<option>暂无实例引用</option>'}</select></label></div>
                <textarea readonly rows="2" aria-label="资源问题" class="recovery-details">${escape(problem.reason)}${problem.entry ? ' · ' + escape(problem.entry) : ''}</textarea>
                <div class="field-pair"><label class="field">补回来源<select id="recovery-method"><option value="files">原模型文件</option><option value="folder">资源文件夹</option><option value="donor">完整工程</option></select></label><label class="field" id="recovery-entry-field">模型主文件<select id="recovery-entry"><option value="">先选择文件</option></select></label></div>
                <label class="field" id="recovery-files-field">选择模型和关联文件<input id="recovery-files" type="file" multiple/></label><label class="field" id="recovery-folder-field" hidden>选择完整资源文件夹<input id="recovery-folder" type="file" webkitdirectory multiple/></label><label class="field" id="recovery-donor-field" hidden>选择包含原资源的工程<input id="recovery-donor" type="file" accept=".director,.json"/></label>` : '<p class="panel-help">资源已补齐。打开前还会检查实际模型、骨架、动画和层级引用。</p>';
            ctx.showModal('恢复工程模型资源', `<div id="resource-recovery"><p class="panel-help">还有 ${problems.length} 项资源需要补回。选择原文件或包含原资源的工程，补齐并验证后打开。</p>${details}<textarea id="recovery-status" readonly rows="2" aria-label="恢复状态" role="status" class="recovery-details"></textarea></div>`, `<button id="recovery-cancel" class="subtle">取消</button>${problem ? '<button id="recovery-restore" class="primary">补回选中资源</button>' : '<button id="recovery-open" class="primary">验证并打开</button>'}`);
            if (purpose === 'template') {
                const open = document.querySelector('#recovery-open'); if (open) open.textContent = '继续读取模板';
                const help = document.querySelector('#resource-recovery > .panel-help');
                if (help) help.textContent = `还有 ${problems.length} 项资源需要补回。读取后可设置插入位置；插入时验证实际模型与引用。`;
            }
            const modal = document.querySelector('.modal')!;
            modal.querySelector('[data-act="close-modal"]')!.addEventListener('click', event => { event.stopPropagation(); abort(); });
            $('#recovery-cancel').onclick = abort;
            if (!problem) { $('#recovery-open').onclick = () => finish(); return; }
            $('#recovery-resource').onchange = () => { selected = $('#recovery-resource').value; render(); };
            let files: File[] = [];
            $('#recovery-method').onchange = () => {
                const method = $('#recovery-method').value;
                for (const name of ['files', 'folder', 'donor']) { $('#recovery-' + name + '-field').hidden = method !== name; $<HTMLInputElement>('#recovery-' + name).value = ''; }
                files = []; $('#recovery-entry').innerHTML = '<option value="">先选择文件</option>';
                $('#recovery-entry-field').hidden = method === 'donor';
            };
            for (const id of ['recovery-files', 'recovery-folder']) $<HTMLInputElement>('#' + id).onchange = event => {
                files = [...((event.target as HTMLInputElement).files ?? [])];
                $('#recovery-entry').innerHTML = files.map(f => f.webkitRelativePath || f.name).filter(path => /\.(glb|gltf|fbx|obj)$/i.test(path)).map(path => `<option value="${escape(path)}">${escape(path)}</option>`).join('') || '<option value="">未找到模型主文件</option>';
                $<HTMLInputElement>('#recovery-donor').value = '';
            };
            $('#recovery-restore').onclick = () => { void restore(files); };
        }
        async function restore(files: File[]) {
            if (settled || loading) return; loading = true;
            const id = selected, donor = $<HTMLInputElement>('#recovery-donor').files?.[0], entry = $('#recovery-entry').value;
            document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('#resource-recovery input,#resource-recovery select,#recovery-restore').forEach(el => el.disabled = true);
            $('#recovery-status').textContent = '读取并核对资源内容…';
            try {
                if (donor) {
                    const input = JSON.parse(await donor.text());
                    if (settled) return;
                    if (input?.format !== 'director-desk' || !Array.isArray(input.resources)) throw Error('请选择包含模型资源的导演台工程');
                    const matches = input.resources.filter((r: ModelResource) => r?.id === id);
                    if (matches.length !== 1) throw Error('所选工程未包含唯一匹配的原资源');
                    await draft.restore(id, matches[0]);
                } else {
                    if (!entry) throw Error('请选择原模型及关联文件，或包含原资源的工程');
                    const source = [];
                    for (const file of files) {
                        if (settled) return;
                        source.push({ path: file.webkitRelativePath || file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
                    }
                    if (settled) return;
                    await draft.restoreFiles(id, entry, source);
                }
                if (!settled) render();
            } catch (error) {
                if (!settled) {
                    document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('#resource-recovery input,#resource-recovery select,#recovery-restore').forEach(el => el.disabled = false);
                    $('#recovery-status').textContent = error instanceof Error ? error.message : String(error);
                }
            } finally { loading = false; }
        }
        signal?.addEventListener('abort', abort, { once: true }); document.addEventListener('keydown', escapeKey, true); render();
    });
    signal?.throwIfAborted(); return readSceneDocument(draft.finish());
}
