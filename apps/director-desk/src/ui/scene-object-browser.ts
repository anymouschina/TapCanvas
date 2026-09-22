import type { AppContext } from '../app-context.ts';
import type { Kind } from '../model.ts';
import { button, escape, icon, options } from './common.ts';

/** Sized pages keep object controls available without nested panel scrolling. */
export function createSceneObjectBrowser(ctx: AppContext, refresh: () => void) {
    let kind = '*', floor = '*', page = 0, lastSelected = '', lastQuery = '', rows = 6;
    const content = document.querySelector<HTMLElement>('#sidebar-content')!;
    const kinds: [string, string][] = [['*', '全部对象'], ['actor', '人物与动物'], ['camera', '摄影机'], ['crowd', '群演'], ['prop', '场景道具']];
    content.addEventListener('change', event => {
        const input = event.target as HTMLSelectElement;
        if (!['scene-kind-filter', 'scene-floor-filter'].includes(input.id)) return;
        event.stopPropagation(); if (input.id === 'scene-kind-filter') kind = input.value; else floor = input.value;
        page = 0; refresh();
    });
    content.addEventListener('click', event => {
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-object-page]');
        if (!target) return;
        event.stopPropagation(); page += Number(target.dataset.objectPage); refresh();
    });
    new ResizeObserver(() => {
        const next = Math.max(1, Math.floor((content.clientHeight - 112) / 34));
        if (next !== rows) { rows = next; if (ctx.sidebarTab === 'scene') refresh(); }
    }).observe(content);
    return { render() {
        if (floor && floor !== '*' && !ctx.project.floors?.some(f => f.id === floor)) floor = '*';
        if (ctx.query !== lastQuery) { page = 0; lastQuery = ctx.query; }
        const filtered = ctx.project.entities.filter(e => (kind === '*' || e.kind === kind) && e.name.toLowerCase().includes(ctx.query.toLowerCase()) && (floor === '*' || (e.floorId ?? '') === floor));
        if (ctx.selected !== lastSelected) {
            const index = filtered.findIndex(e => e.id === ctx.selected); if (index >= 0) page = Math.floor(index / rows);
            lastSelected = ctx.selected;
        }
        const pages = Math.max(1, Math.ceil(filtered.length / rows)); page = Math.max(0, Math.min(pages - 1, page));
        const labels: Record<Kind, string> = { actor: '人物', prop: '道具', camera: '机位', crowd: '群演' };
        return `<div class="scene-object-browser"><div class="object-filters"><select id="scene-kind-filter" aria-label="场景对象类型">${options(kinds, kind)}</select><div class="object-floor-row"><select id="scene-floor-filter" aria-label="场景对象楼层筛选">${options([['*', '全部楼层'], ['', '未归层'], ...(ctx.project.floors ?? []).map(f => [f.id, f.name] as [string, string])], floor)}</select>${button('floor-open', '楼层', '', 'subtle')}${button('zone-open', '区域', '', 'subtle')}</div></div><div class="object-list">${filtered.slice(page * rows, (page + 1) * rows).map(e => `<div class="object-row ${e.id === ctx.selected ? 'selected' : ''} ${e.visible ? '' : 'dimmed'}" data-select="${e.id}"><span class="object-symbol" style="color:${e.kind === 'actor' || e.kind === 'crowd' ? e.color : '#aaa'}">${e.kind === 'camera' ? icon('camera') : e.kind === 'prop' ? '◇' : '●'}</span><span class="object-name" title="${escape(e.name)}">${escape(e.name)}</span><small>${labels[e.kind]}</small><button class="mini-button ${e.visible ? '' : 'off'}" data-act="visibility" data-id="${e.id}" title="参与拍摄 / 隐藏（影响导出）">${icon('eye')}</button></div>`).join('') || '<div class="empty-state">没有匹配的对象</div>'}</div><div class="object-pager"><button data-object-page="-1" aria-label="上一页对象" ${page === 0 ? 'disabled' : ''}>‹</button><span>${page + 1} / ${pages} · ${filtered.length} 个</span><button data-object-page="1" aria-label="下一页对象" ${page + 1 === pages ? 'disabled' : ''}>›</button></div></div>`;
    } };
}
