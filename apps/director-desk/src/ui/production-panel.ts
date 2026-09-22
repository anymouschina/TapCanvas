import type { AppContext } from '../app-context.ts';
import { clone, outputSize, uid, type ProductionNote } from '../model.ts';
import { productionData, putNote, safeFilename } from '../production/notes.ts';
import { productionEntries } from '../production/bundle.ts';
import { scenePromptFile } from '../production/prompts.ts';
import { createZip } from '../production/zip.ts';
import { download } from '../storage.ts';
import { $, button, escape, options } from './common.ts';
import { copyText } from './clipboard.ts';
import './production-panel.css';

export function createProductionPanel(ctx: AppContext) {
    let noteId = '', aborter: AbortController | null = null;
    let promptSceneId = '', promptSessionId = '', promptSceneName = '', promptOriginal = '';
    function noteFromForm(): ProductionNote {
        if (!$('#note-start').value.trim() || !$('#note-end').value.trim()) throw new Error('请输入备注开始和结束时间');
        return { id: noteId || uid(), start: Number($('#note-start').value), end: Number($('#note-end').value), actorId: $('#note-actor').value,
            story: $('#note-story').value, emotion: $('#note-emotion').value, dialogue: $('#note-dialogue').value, action: $('#note-action').value };
    }
    function saveNote(force = false): boolean {
        if (!document.querySelector('#note-start')) return true;
        try {
            const note = noteFromForm();
            if (!force && !noteId && ![note.story, note.emotion, note.dialogue, note.action].some(Boolean)) return true;
            const previous = productionData(ctx.project).notes.find(n => n.id === noteId);
            if (JSON.stringify(previous) === JSON.stringify(note)) return true;
            if (!ctx.change(() => putNote(ctx.project, note), false)) return false;
            noteId = note.id; updateNoteOptions(); $('#note-status').textContent = '已保存到工程（Ctrl+S 导出工程文件）'; return true;
        } catch (error) { ctx.toast((error as Error).message, true); return false; }
    }
    function updateNoteOptions() {
        $('#note-select').innerHTML = options([['', '新建备注'], ...productionData(ctx.project).notes.map(n => [n.id, `${n.start}—${n.end}s · ${n.dialogue || n.story || n.emotion || '表演备注'}`] as [string, string])], noteId);
    }
    function fillNote(id: string) {
        noteId = id;
        const n = productionData(ctx.project).notes.find(n => n.id === id) ?? { start: ctx.time, end: ctx.time + 2, actorId: ctx.current()?.kind === 'actor' ? ctx.selected : '', story: '', emotion: '', dialogue: '', action: '' };
        for (const key of ['start', 'end', 'actorId', 'story', 'emotion', 'dialogue', 'action'] as const) $('#note-' + (key === 'actorId' ? 'actor' : key)).value = String(n[key]);
        $('#note-status').textContent = id ? '已载入备注；编辑后离开输入框自动保存' : '填写后离开输入框自动保存，或点击保存备注';
        updateNoteOptions();
    }
    function openNotes() {
        ctx.playing = false; ctx.updateTimeUI();
        ctx.showModal('制作备注', `<div class="production-note-nav"><label>时间备注<select id="note-select"></select></label>${button('production-new-note', '新建', 'plus', 'subtle')}${button('production-delete-note', '删除本条', 'trash', 'subtle')}</div><div class="production-times"><label>开始 / 秒<input id="note-start" type="number" min="0" step=".1"/></label><label>结束 / 秒<input id="note-end" type="number" min="0" step=".1"/></label><label>关联角色<select id="note-actor">${options([['', '未指定'], ...ctx.project.entities.filter(e => e.kind === 'actor').map(e => [e.id, e.name] as [string, string])], '')}</select></label></div><div class="production-note-fields">${(['story', 'emotion', 'dialogue', 'action'] as const).map(key => `<label>${({ story: '剧情', emotion: '情绪', dialogue: '台词原文', action: '动作意图' })[key]}<textarea id="note-${key}" maxlength="20000"></textarea></label>`).join('')}</div><p id="note-status" role="status"></p>`,
            button('production-save-note', '保存备注', '', 'primary') + button('production-note-seek', '跳到开始时间', '', 'subtle') + (ctx.project.references.length ? button('production-references', '旧工程参考素材', '', 'subtle') : '') + button('production-prompt', '视频提示词', '', 'subtle') + button('production-delivery', '素材包导出', 'download', 'subtle'));
        $('.modal').classList.add('production-modal');
        fillNote(productionData(ctx.project).notes.some(n => n.id === noteId) ? noteId : '');
        $('.modal').addEventListener('director-before-close', event => { if (!saveNote()) event.preventDefault(); });
        $('.production-times').addEventListener('change', () => saveNote()); $('.production-note-fields').addEventListener('change', () => saveNote());
        $('#note-select').addEventListener('change', () => { const next = $('#note-select').value; if (saveNote()) fillNote(next); else updateNoteOptions(); });
    }
    function openReferences() {
        const actors = ctx.project.entities.filter(e => e.kind === 'actor'), refs = ctx.project.references.map(r => [r.id, r.name] as [string, string]);
        ctx.showModal('角色与参考图', `<div class="production-reference-controls"><label>角色<select id="production-actor">${options(actors.map(e => [e.id, e.name]), actors.some(e => e.id === ctx.selected) ? ctx.selected : actors[0]?.id ?? '')}</select></label><label>角色参考图<select id="production-reference">${options([['', '未关联'], ...refs], '')}</select></label></div><div id="production-reference-preview"></div><label>场景参考图<select id="production-scene-reference">${options([['', '选择场景参考图'], ...refs], '')}</select></label><div class="spatial-toolbar">${button('production-add-scene-reference', '加入场景参考', 'plus', 'subtle')}${button('production-remove-scene-reference', '移出场景参考', '', 'subtle')}</div><textarea id="production-scene-list" readonly aria-label="场景参考列表"></textarea><p>此处保留旧工程已有的参考素材及关联；图片不参与场景渲染。</p>`, button('production-delivery', '素材包导出', 'download', 'subtle'));
        $('.modal').classList.add('production-modal');
        const update = () => {
            const actor = ctx.project.entities.find(e => e.id === $('#production-actor').value), reference = ctx.project.references.find(r => r.id === actor?.reference);
            $('#production-reference').value = actor?.reference ?? ''; $('#production-reference').disabled = !actor || actor.locked;
            $('#production-reference-preview').innerHTML = reference ? `<img src="${reference.data}" alt="${escape(reference.name)}"/>` : '<span>尚未关联角色参考图</span>';
            $('#production-scene-list').value = productionData(ctx.project).sceneReferenceIds.map(id => ctx.project.references.find(r => r.id === id)?.name ?? id).join('\n') || '尚未关联场景参考图';
        };
        $('#production-actor').addEventListener('change', update);
        $('#production-reference').addEventListener('change', () => { const actor = ctx.project.entities.find(e => e.id === $('#production-actor').value); if (actor && !actor.locked) ctx.change(() => { actor.reference = $('#production-reference').value; }, false); update(); });
        update();
    }
    function openDelivery() {
        ctx.showModal('导出制作素材包', `<label>固定提示词头<textarea id="production-fixed-prompt" maxlength="50000" placeholder="粘贴项目已确认的风格、声音与表演要求"></textarea></label><label class="range-occlusion"><input id="production-with-video" type="checkbox" checked/>包含按切镜输出的整场 MP4（无声参考）</label><label>视频分辨率<select id="production-video-size">${options([['1920', '1080p 级'], ['1280', '720p 级'], ['640', '360p 级']], '1920')}</select></label><p>ZIP 内的工程包含全部独立戏段；逐场提示词包含各戏段已保存的文稿；视频、参考图、角色对应关系、切镜及剧情备注只导出当前戏段。备注不自动烧录为字幕或配音。</p><p id="production-progress" role="status">固定头编辑后离开输入框会保存到工程。导出过程中可以取消。</p>`,
            button('production-export-bundle', '导出 ZIP', 'download', 'primary') + button('production-cancel', '取消导出', '', 'subtle', 'disabled') + button('production-prompt', '视频提示词', '', 'subtle'));
        $('.modal').classList.add('production-modal'); $('#production-fixed-prompt').value = productionData(ctx.project).fixedPrompt;
        $('#production-fixed-prompt').addEventListener('change', () => ctx.change(() => { ctx.project.production ??= productionData(ctx.project); ctx.project.production.fixedPrompt = $('#production-fixed-prompt').value; }, false));
    }
    function savePrompt(): boolean {
        const input = document.querySelector<HTMLTextAreaElement>('#production-prompt-text');
        if (!input || input.value === promptOriginal) return true;
        if (promptSceneId !== ctx.scenes.context.sceneId || promptSessionId !== ctx.scenes.context.sessionId) {
            ctx.toast('戏段已切换，这份文稿未写入其他戏段；仍可复制或导出 TXT。', true); return true;
        }
        const saved = ctx.change(() => { ctx.project.production ??= productionData(ctx.project); ctx.project.production.promptText = input.value; }, false);
        if (saved) promptOriginal = input.value;
        return saved;
    }
    function openPrompt() {
        promptSceneId = ctx.scenes.context.sceneId; promptSessionId = ctx.scenes.context.sessionId;
        promptSceneName = ctx.scenes.list().find(scene => scene.id === promptSceneId)!.name;
        promptOriginal = productionData(ctx.project).promptText ?? '';
        ctx.showModal(`${escape(promptSceneName)} · 视频提示词`, `<label class="production-prompt-field">完整提示词<textarea id="production-prompt-text" maxlength="100000" placeholder="本场还没有保存提示词。可让 AI 为本场生成，也可手动粘贴。"></textarea></label><p>各戏段分别保存，可撤销。修改剧情、画幅或切镜后，请同步更新这份文稿；导出素材包会附带各戏段已保存的提示词。</p>`,
            button('production-download-prompt', '导出 TXT', 'download', 'primary') + button('production-copy-prompt', '复制全文', '', 'subtle') + button('production-delivery', '素材包导出', '', 'subtle'));
        $('.modal').classList.add('production-modal'); $('#production-prompt-text').value = productionData(ctx.project).promptText ?? '';
        $('#production-prompt-text').focus();
        $('#production-prompt-text').addEventListener('change', savePrompt);
        $('.modal').addEventListener('director-before-close', event => { if (!savePrompt()) event.preventDefault(); });
    }
    async function exportBundle() {
        const project = clone(ctx.project), includeVideo = $('#production-with-video').checked, [width, height] = outputSize(project.aspect, Number($('#production-video-size').value));
        aborter = new AbortController(); ctx.busy = true; ctx.playing = false; ctx.updateTimeUI();
        $('.production-modal').querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,select,button,textarea').forEach(e => e.disabled = true);
        $<HTMLButtonElement>('[data-act="production-cancel"]').disabled = false;
        try {
            let video: Blob | undefined;
            if (includeVideo) {
                const { exportVideo } = await import('../export.ts');
                video = (await exportVideo(ctx.engine, { start: 0, end: project.duration, fps: project.fps, width, height, cameraId: 'program', format: 'mp4', monochrome: false }, aborter.signal,
                    p => { $('#production-progress').textContent = `生成参考视频 ${Math.round(p * 100)}%`; })) ?? undefined;
            }
            aborter.signal.throwIfAborted(); $('#production-progress').textContent = '整理工程与参考图…';
            const entries = await productionEntries(project, video, ctx.scenes.document()); aborter.signal.throwIfAborted();
            const zip = await createZip(entries, aborter.signal, (done, total) => { $('#production-progress').textContent = `整理素材包 ${done} / ${total}`; });
            download(zip, `${safeFilename(project.name)}-制作素材包.zip`); $('#production-progress').textContent = '素材包已导出。';
        } catch (error) { $('#production-progress').textContent = (error as Error).name === 'AbortError' ? '已取消，工程保持原状。' : (error as Error).message; }
        finally {
            aborter = null; ctx.busy = false;
            $('.production-modal').querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,select,button,textarea').forEach(e => e.disabled = false);
            $<HTMLButtonElement>('[data-act="production-cancel"]').disabled = true; ctx.updateTimeUI();
        }
    }
    function handle(action: string, el?: HTMLElement) {
        if (!action.startsWith('production-')) return false;
        if (action === 'production-cancel') { aborter?.abort(); return true; }
        if (action === 'production-save-note') { saveNote(true); return true; }
        if (action === 'production-delete-note') {
            if (noteId && ctx.change(() => { ctx.project.production!.notes = ctx.project.production!.notes.filter(n => n.id !== noteId); }, false)) fillNote(''); return true;
        }
        if (!saveNote() || !savePrompt()) return true;
        if (action === 'production-open-note') {
            const note = productionData(ctx.project).notes.find(n => n.id === el?.dataset.noteId);
            if (note) { noteId = note.id; ctx.seek(note.start); openNotes(); } return true;
        }
        if (action === 'production-notes') openNotes();
        if (action === 'production-new-note') fillNote('');
        if (action === 'production-note-seek') { const at = Number($('#note-start').value); ctx.closeModal(); ctx.seek(at); }
        if (action === 'production-references') openReferences();
        if (action === 'production-delivery') openDelivery();
        if (action === 'production-prompt') openPrompt();
        if (action === 'production-download-prompt' || action === 'production-copy-prompt') {
            const text = $('#production-prompt-text').value;
            const file = scenePromptFile({ name: promptSceneName, production: { ...productionData(ctx.project), promptText: text } });
            if (!file) ctx.toast('当前戏段尚未填写完整提示词。');
            else if (action === 'production-download-prompt') download(file.data, file.name);
            else void copyText(text).then(() => ctx.toast('已复制提示词。'), () => ctx.toast('复制失败，可选中文字复制或导出 TXT。', true));
        }
        if (action === 'production-export-bundle') void exportBundle();
        if (action === 'production-add-scene-reference' || action === 'production-remove-scene-reference') {
            const id = $('#production-scene-reference').value;
            if (id && ctx.change(() => { const data = ctx.project.production ??= productionData(ctx.project);
                data.sceneReferenceIds = action === 'production-remove-scene-reference' ? data.sceneReferenceIds.filter(r => r !== id) : [...new Set([...data.sceneReferenceIds, id])];
            }, false)) $('#production-scene-list').value = productionData(ctx.project).sceneReferenceIds.map(id => ctx.project.references.find(r => r.id === id)!.name).join('\n') || '尚未关联场景参考图';
        }
        return true;
    }
    return { handle };
}
