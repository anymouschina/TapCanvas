import type { AppContext } from '../app-context.ts';
import { onEditReceipt, readEdits, type EditReceipt } from '../automation/edit-journal.ts';
import { escape, options } from './common.ts';
import './ai-edit-locations.css';
export function createAIEditLocations(ctx: AppContext) {
    let records: EditReceipt[] = [], selected = '', page = 0, generation = 0;
    const button = document.createElement('button'); button.id = 'ai-changes-toggle'; button.className = 'subtle'; button.textContent = 'AI 改动'; button.dataset.act = 'ai-changes-open';
    document.querySelector('.header-actions')!.prepend(button);
    async function refresh() {
        const token = ++generation;
        try { const next = await readEdits(ctx.scenes.list().map(s => s.id)); if (token !== generation) return; records = next; if (!records.some(r => r.id === selected)) { selected = records[0]?.id ?? ''; page = 0; } if (ctx.inspectorTab === 'ai-changes') ctx.renderInspector(); }
        catch { ctx.toast('无法读取本机修改定位记录', true); }
    }
    onEditReceipt(() => { button.textContent = 'AI 改动 · 新'; selected = ''; page = 0; void refresh(); });
    function render() {
        const ids = new Set(ctx.scenes.list().map(s => s.id)); records = records.filter(r => ids.has(r.sceneId));
        const record = records.find(r => r.id === selected), pages = Math.max(1, Math.ceil((record?.locations.length ?? 0) / 3)); page = Math.min(page, pages - 1);
        if (!record) return '<p class="panel-help">当前工程暂无 AI 修改记录。内置助手和 MCP 提交成功后，可在这里查看对象、修改项和相关时段。</p>';
        return `<div class="ai-edit-locations"><select id="ai-change-batch" aria-label="AI 修改批次">${options(records.map(r => [r.id, `${new Date(r.created).toLocaleTimeString()} · ${r.sceneName} · ${r.label}`]), selected)}</select><small>提交时的记录；后续编辑或撤销可能改变现状。时段包含相邻插值范围。</small>${record.locations.slice(page * 3, page * 3 + 3).map((row, i) => `<button data-change-location="${page * 3 + i}" title="${escape(row.name + ' · ' + row.field)}"><strong>${{ added: '新增', updated: '修改', removed: '删除' }[row.action]} · ${escape(row.name)}</strong><span>${escape(row.field)} · ${row.start.toFixed(2)}—${row.end.toFixed(2)} 秒</span></button>`).join('')}<div class="button-row"><button data-change-page="-1" ${page === 0 ? 'disabled' : ''}>上一页</button><span>${page + 1}/${pages}</span><button data-change-page="1" ${page >= pages - 1 ? 'disabled' : ''}>下一页</button></div></div>`;
    }
    function bind() {
        const root = document.querySelector<HTMLElement>('.ai-edit-locations'); if (!root) return;
        root.querySelector<HTMLSelectElement>('select')!.onchange = event => { selected = (event.target as HTMLSelectElement).value; page = 0; ctx.renderInspector(); };
        root.onclick = event => {
            const target = (event.target as Element).closest<HTMLElement>('button'); if (!target) return;
            if (target.dataset.changePage) { page += Number(target.dataset.changePage); ctx.renderInspector(); return; }
            if (target.dataset.changeLocation === undefined || ctx.busy || ctx.history.pending || ctx.draft) return;
            const record = records.find(r => r.id === selected), row = record?.locations[Number(target.dataset.changeLocation)]; if (!row) return;
            if (!ctx.scenes.list().some(s => s.id === record!.sceneId)) { ctx.toast('此戏段已删除'); return; }
            if (ctx.scenes.context.sceneId !== record!.sceneId) ctx.switchScene(record!.sceneId, ctx.scenes.context);
            const entity = ctx.project.entities.find(e => e.id === row.entityId);
            ctx.playing = false; ctx.seek(Math.min(ctx.project.duration, row.start));
            if (entity) {
                ctx.selectEntity(entity.id);
                if (entity.camera) { ctx.preview = entity.id; ctx.renderCameras(); }
                if (row.field === '运动路径') ctx.inspectorTab = 'path';
                else if (row.field === '动作') ctx.inspectorTab = 'actions';
                else if (row.field === '摄影机') ctx.inspectorTab = 'effects';
                else if (entity.light) ctx.inspectorTab = 'light';
                ctx.renderInspector();
            } else if (row.entityId) ctx.toast('该对象当前已不存在，已定位到所属戏段与时刻');
            ctx.updateTimeUI(); document.querySelector<HTMLButtonElement>('#timeline-center')?.click();
            if (entity) {const track=document.querySelector<HTMLElement>(`#timeline-content [data-select="${CSS.escape(entity.id)}"]`);if(track) {const container=document.querySelector<HTMLElement>('#timeline-content')!;container.scrollTop += track.getBoundingClientRect().top-container.getBoundingClientRect().top-container.clientHeight/2;}}

        };
    }
    return { render, bind, open() { button.textContent = 'AI 改动'; ctx.inspectorTab = 'ai-changes'; ctx.renderInspector(); void refresh(); } };
}
