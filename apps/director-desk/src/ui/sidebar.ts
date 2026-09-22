import { createAssetBrowser } from './asset-browser.ts';
import { $ } from './common.ts';
import type { AppContext } from '../app-context.ts';
import { createSceneObjectBrowser } from './scene-object-browser.ts';
export function createSidebar(ctx: AppContext) {
    const objects = createSceneObjectBrowser(ctx, renderSidebar);
    const browser = createAssetBrowser(ctx);
    function renderSidebar() {
        document.querySelectorAll('[data-side]').forEach(el => el.classList.toggle('active', (el as HTMLElement).dataset.side === ctx.sidebarTab));
        const content = $('#sidebar-content');
        content.classList.toggle('asset-mode', ctx.sidebarTab === 'assets');
        content.classList.toggle('object-mode', ctx.sidebarTab === 'scene');
        if (ctx.sidebarTab !== 'assets') browser.leave();
        if (ctx.sidebarTab === 'assets') browser.render(content);
        else content.innerHTML = objects.render();
    }
    return { renderSidebar };
}
