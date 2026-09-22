import { ASSET_GROUPS, searchAssets } from '../asset-catalog.ts';
import { isGeometryAsset } from '../assets/creation-mode.ts';
import { libraryPreferences } from '../assets/library-preferences.ts';
import type { AppContext } from '../app-context.ts';
import { escape, options } from './common.ts';

export function createAssetBrowser(ctx: AppContext) {
    let view = localStorage.getItem('director-asset-view') === 'list' ? 'list' : 'grid';
    let layoutGrid = () => {};
    let creationMode = ctx.project.creationMode ?? 'full';
    let scope = 'all', page = 0, pageSize = 6, generation = 0, signature = '', host: HTMLElement | undefined;
    let observer: ResizeObserver | undefined;
    function mount(content: HTMLElement) {
        observer?.disconnect(); host = content;
        content.innerHTML = '<div class="asset-browser"><div class="library-tools"><div class="library-top"><label class="library-category">分类<select id="asset-category" aria-label="白模分类"></select></label><div class="library-view" role="group" aria-label="资产视图"><button data-library-view="list" title="列表：仅名称">列表</button><button data-library-view="grid" title="宫格：预览与名称">宫格</button></div></div><div class="library-scopes"><button data-library-scope="all">全部</button><button data-library-scope="favorites">收藏</button><button data-library-scope="recent">最近</button><span id="library-count"></span></div></div><div class="library-grid" aria-label="白模资源"></div><div class="library-pager"><button data-library-page="-1" aria-label="上一页白模">‹ <span class="pager-label">上页</span></button><span id="library-page" aria-live="polite"></span><button data-library-page="1" aria-label="下一页白模"><span class="pager-label">下页</span> ›</button></div></div>';
        const browser = content.firstElementChild as HTMLElement, grid = browser.querySelector<HTMLElement>('.library-grid')!;
        browser.addEventListener('click', event => {
            const target = (event.target as HTMLElement).closest<HTMLElement>('[data-library-view],[data-library-scope],[data-library-page],[data-favorite],[data-library-all]');
            if (!target) return;
            event.stopPropagation();
            if (target.dataset.libraryView) { view = target.dataset.libraryView; localStorage.setItem('director-asset-view',view); page = 0; layoutGrid(); }
            if (target.dataset.libraryScope) { scope = target.dataset.libraryScope; page = 0; }
            if (target.dataset.libraryPage) page = Math.max(0, page + Number(target.dataset.libraryPage));
            if (target.dataset.favorite) { libraryPreferences.toggle(target.dataset.favorite); return; }
            if (target.hasAttribute('data-library-all')) {
                if (ctx.assetFilter === '全部' && scope === 'all') { ctx.query = ''; document.querySelector<HTMLInputElement>('#search')!.value = ''; }
                ctx.assetFilter = '全部'; scope = 'all'; page = 0;
            }
            render(content);
        });
        browser.addEventListener('change', event => {
            const select = event.target as HTMLSelectElement;
            if (select.id === 'asset-category') { event.stopPropagation(); ctx.assetFilter = select.value; page = 0; render(content); }
        });
        layoutGrid = () => {
            if (!browser.isConnected) return;
            const width = grid.clientWidth, height = grid.clientHeight;
            const cols = view === 'list' ? 1 : Math.max(1, Math.min(4, Math.floor((width + 8) / 145))), rows = Math.max(1, Math.floor((height + 8) / (view === 'list' ? 36 : 170)));
            browser.classList.toggle('list-view',view === 'list');
            grid.style.gridTemplateColumns = `repeat(${cols},minmax(0,1fr))`;
            grid.style.gridTemplateRows = `repeat(${rows},minmax(0,1fr))`;
            browser.classList.toggle('compact', height < 105);
            if (pageSize !== cols * rows) { const start = page * pageSize; pageSize = cols * rows; page = Math.floor(start / pageSize); render(content); }
        }; observer = new ResizeObserver(layoutGrid); observer.observe(grid);
    }
    function render(content: HTMLElement) {
        if (!content.querySelector('.asset-browser')) mount(content);
        const focusedFavorite = content.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.favorite : undefined;
        const mode = ctx.project.creationMode ?? 'full';
        if (mode !== creationMode) {
            creationMode = mode; scope = 'all'; ctx.assetFilter = '全部'; ctx.query = '';
            const search = document.querySelector<HTMLInputElement>('#search'); if (search) search.value = '';
        }
        const next = ctx.query + '\u0000' + ctx.assetFilter + '\u0000' + scope + '\u0000' + mode;
        if (next !== signature) { signature = next; page = 0; }
        const grid = content.querySelector<HTMLElement>('.library-grid')!;
        content.querySelectorAll<HTMLElement>('[data-library-view]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.libraryView===view)));
        const favorites = new Set(libraryPreferences.favorites), recent = libraryPreferences.recent;
        let list = searchAssets(ctx.query, ctx.assetFilter);
        if (ctx.project.creationMode === 'geometry') list = list.filter(a => isGeometryAsset(a.id));
        if (scope === 'favorites') list = list.filter(a => favorites.has(a.id));
        if (scope === 'recent') list = list.filter(a => recent.includes(a.id)).sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id));
        const pages = Math.max(1, Math.ceil(list.length / pageSize)); page = Math.min(page, pages - 1);
        content.querySelector<HTMLSelectElement>('#asset-category')!.innerHTML = options((ctx.project.creationMode === 'geometry' ? ['全部', '基础形状', '结构形状'] : ['全部', ...ASSET_GROUPS]).map(g => [g, g]), ctx.assetFilter);
        content.querySelectorAll<HTMLElement>('[data-library-scope]').forEach(el => { const active = el.dataset.libraryScope === scope; el.classList.toggle('active', active); el.setAttribute('aria-pressed', String(active)); });
        content.querySelector('#library-count')!.textContent = `${list.length} 项`;
        content.querySelector('#library-page')!.textContent = `${page + 1} / ${pages}`;
        content.querySelector<HTMLButtonElement>('[data-library-page="-1"]')!.disabled = page === 0;
        content.querySelector<HTMLButtonElement>('[data-library-page="1"]')!.disabled = page === pages - 1;
        const visible = list.slice(page * pageSize, (page + 1) * pageSize);
        grid.innerHTML = visible.map(a => view === 'list' ? `<button class="asset-list-item" draggable="true" data-asset="${a.id}" title="${escape(a.name)}">${escape(a.name)}</button>` : `<article class="library-card"><button class="asset-card" draggable="true" data-asset="${a.id}" title="${escape(a.name)} · 点击添加，或拖入布景"><span class="asset-preview"><span class="asset-symbol">${a.icon}</span><img alt="${escape(a.name)}白模预览" data-thumbnail="${a.id}" hidden/></span><strong>${escape(a.name)}</strong><span class="asset-caption">${a.kind === 'actor' ? `${a.defaults?.height ?? (a.id === 'woman' ? 1.65 : 1.75)} m · 姿态可调` : escape(a.group)}</span></button><button class="asset-favorite" data-favorite="${a.id}" aria-pressed="${favorites.has(a.id)}" aria-label="${favorites.has(a.id) ? '取消收藏' : '收藏'}${escape(a.name)}">${favorites.has(a.id) ? '★' : '☆'}</button></article>`).join('') || `<div class="library-empty">${scope === 'favorites' ? '还没有匹配的收藏' : scope === 'recent' ? '还没有匹配的使用记录' : '没有匹配的白模'}<small>按名称、类别或别名搜索</small><button data-library-all>${scope === 'all' && ctx.assetFilter === '全部' ? '清空搜索' : '搜索全部资源'}</button></div>`;
        if (focusedFavorite) (content.querySelector<HTMLElement>(`[data-favorite="${focusedFavorite}"]`) ?? content.querySelector<HTMLElement>(`[data-library-scope="${scope}"]`))?.focus({ preventScroll: true });
        const current = ++generation;
        if (view === 'list') return;
        void (async () => {
            const { thumbnail } = await import('../assets/thumbnails.ts');
            for (const a of visible) {
                const img = grid.querySelector<HTMLImageElement>(`[data-thumbnail="${a.id}"]`);
                const wanted = () => current === generation && !!img?.isConnected && !ctx.busy;
                if (!wanted()) break;
                try {
                    const data = await thumbnail(a.id, wanted);
                    if (data && wanted()) { img!.src = data; img!.hidden = false; img!.parentElement!.querySelector<HTMLElement>('.asset-symbol')!.hidden = true; }
                } catch { if (img?.isConnected) img.dataset.previewError = 'true'; }
            }
        })();
    }
    libraryPreferences.subscribe(() => { if (host?.isConnected && ctx.sidebarTab === 'assets') render(host); });
    return { render, leave() { generation++; observer?.disconnect(); host = undefined; } };
}
